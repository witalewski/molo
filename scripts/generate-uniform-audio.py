"""Stage a complete, free private-study quantized Higgs bank with one fixed synthetic voice.

Default: replay checked sources offline. --generate enables local inference;
--download-model explicitly permits downloading the pinned public checkpoint.
The script never writes to the live public/ or tests/ audio directories.
"""

import argparse
import hashlib
import importlib.metadata
import io
import json
from math import gcd
from pathlib import Path
import random
import re
import subprocess
import sys
import os

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent.parent
STANDARD = ROOT / "scripts/audio-standard.json"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode()


def load_voice(standard):
    file = ROOT / standard["voice"]["file"]
    if sha256(file.read_bytes()) != standard["voice"]["sha256"]:
        raise ValueError("Voice profile checksum mismatch")
    voice = json.loads(file.read_text())
    if sha256((file.parent / voice["sourceFile"]).read_bytes()) != voice["sourceSha256"]:
        raise ValueError("Voice source checksum mismatch")
    return voice


def request_for(text, seed, standard):
    return {
        "model": standard["model"], "codec": standard["codec"], "runtime": standard["runtime"],
        "voiceSha256": standard["voice"]["sha256"],
        "sourceSampleRate": standard["sourceSampleRate"],
        "generation": standard["generation"], "text": text, "seed": seed,
    }


def decode_source(data, rate):
    with sf.SoundFile(io.BytesIO(data)) as source:
        if source.format != "WAV" or source.channels != 1 or source.samplerate != rate:
            raise ValueError("Expected source WAV mono at the configured sample rate")
        audio = source.read(dtype="float64")
    if not np.all(np.isfinite(audio)) or len(audio) < rate * 0.15:
        raise ValueError("Source contains invalid or insufficient audio")
    if np.sqrt(np.mean(audio**2)) < 0.001:
        raise ValueError("Source contains no usable speech")
    return audio


def cache_source(request, audio, standard, cache, execution=None):
    if audio.ndim != 1 or not np.all(np.isfinite(audio)):
        raise ValueError("Generated source contains non-finite samples")
    stream = io.BytesIO()
    sf.write(stream, audio, standard["sourceSampleRate"], format="WAV", subtype="FLOAT")
    data = stream.getvalue()
    decode_source(data, standard["sourceSampleRate"])
    key = sha256(json_bytes(request))
    cache.mkdir(parents=True, exist_ok=True)
    wav, receipt = cache / f"{key}.wav", cache / f"{key}.json"
    if wav.exists() or receipt.exists():
        raise ValueError(f"Refusing to overwrite an existing source: {key}")
    wav.write_bytes(data)
    receipt.write_bytes(json_bytes({"request": request, "sha256": sha256(data), "execution": execution}))


def source_audio(request, standard, cache, synthesizer=None):
    key = sha256(json_bytes(request))
    wav, receipt = cache / f"{key}.wav", cache / f"{key}.json"
    if not wav.exists() and not receipt.exists():
        if synthesizer is None:
            raise ValueError("Source is not cached. Use --generate for free local inference (and --download-model on first setup).")
        generated = synthesizer(request)
        execution = synthesizer.execution if isinstance(synthesizer, LocalSynthesis) else None
        cache_source(request, generated, standard, cache, execution)
    if not wav.exists() or not receipt.exists():
        raise ValueError(f"Incomplete source cache: {key}")
    metadata = json.loads(receipt.read_text())
    data = wav.read_bytes()
    if metadata.get("request") != request or metadata.get("sha256") != sha256(data):
        raise ValueError(f"Source cache checksum mismatch: {key}")
    return decode_source(data, standard["sourceSampleRate"]), sha256(data)


class LocalSynthesis:
    def __init__(self, standard, download=False, device="auto"):
        self.standard, self.download, self.device = standard, download, device
        self.model = self.prompt = None
        self.execution = None

    def __call__(self, request):
        import mlx.core as mx
        from huggingface_hub import snapshot_download
        from mlx_audio.tts.utils import load
        from mlx_audio.tts.models.higgs_audio_v3.generation import apply_delay_pattern

        if self.device not in ("auto", "mps"):
            raise ValueError("This pinned MLX backend requires Apple Silicon; CPU fallback is disabled")
        if self.model is None:
            if self.standard["model"]["id"] != "whitelabel/mlx-q6-higgs-tts-3-4b":
                raise ValueError("Unsupported synthesis backend; offline replay is still available")
            for package, version in self.standard["runtime"].items():
                if importlib.metadata.version(package) != version:
                    raise ValueError(f"Expected {package}=={version}; run uv sync --locked")
            # Check before loading, including when the OS has other apps open.
            check_resource_budget(self.standard)
            mx.set_memory_limit(self.standard["resources"]["metalLimitBytes"])
            mx.set_cache_limit(self.standard["resources"]["metalCacheBytes"])
            voice = load_voice(self.standard)
            pinned = self.standard["model"]
            location = Path(snapshot_download(
                pinned["id"], revision=pinned["revision"],
                cache_dir=str(ROOT / "models/hf-cache"), token=False,
                local_files_only=not self.download, ignore_patterns=["samples/*"],
            ))
            # Hash in chunks: do not read the multi-gigabyte model into RAM.
            for name, expected in pinned["fileSha256"].items():
                digest = hashlib.sha256()
                with (location / name).open("rb") as file:
                    for chunk in iter(lambda: file.read(8 * 1024 * 1024), b""):
                        digest.update(chunk)
                if digest.hexdigest() != expected:
                    raise ValueError(f"Model checksum mismatch: {name}")
            self.model = load(location, strict=True)
            self.prompt = apply_delay_pattern(
                mx.array(voice["ref_audio_tokens"], dtype=mx.int32).T,
                boc_id=self.model.config.audio_boc_token_id,
                eoc_id=self.model.config.audio_eoc_token_id,
            )
            mx.eval(self.prompt)
            self.reference_text = voice["ref_text"]
            self.execution = {"device": "mlx-metal", "quantization": "affine-6bit-group64", "metalLimitBytes": self.standard["resources"]["metalLimitBytes"]}
        check_resource_budget(self.standard, loaded=True)
        random.seed(request["seed"])
        np.random.seed(request["seed"])
        settings = dict(request["generation"])
        text = settings.pop("textPrefix") + request["text"]
        # One complete utterance; same prompt, settings and seed for every phrase.
        result = next(self.model.generate(
            text, ref_audio_codes=self.prompt, ref_text=self.reference_text,
            seed=request["seed"], **settings,
        ))
        if result.sample_rate != self.standard["sourceSampleRate"]:
            raise ValueError("Unexpected model output sample rate")
        audio = np.array(result.audio, dtype=np.float32)
        self.execution["peakMetalBytes"] = mx.get_peak_memory()
        mx.clear_cache()
        return audio


def check_resource_budget(standard, loaded=False):
    limits = standard["resources"]
    if not 0 < limits["metalLimitBytes"] <= 5 * 1024**3 or not 0 <= limits["metalCacheBytes"] <= 64 * 1024**2:
        raise ValueError("Unsafe memory limits: maximum 5 GiB Metal and 64 MiB cache")
    pressure = subprocess.check_output(["/usr/bin/memory_pressure", "-Q"], text=True)
    available = re.search(r"free percentage: (\d+)%", pressure)
    if not available:
        raise ValueError("Cannot verify available memory; refusing to load the model")
    percent = int(available[1])
    physical = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
    minimum = 15 if loaded else max(35, limits["minimumFreePercent"])
    # Keep an extra GiB for Python, tokenization and non-Metal allocations.
    required = 1024**3 if loaded else limits["metalLimitBytes"] + 1024**3
    if percent < minimum or physical * percent / 100 < required:
        raise ValueError("Insufficient available memory; generation stopped safely. Close other large workloads before retrying")


def prepare_audio(audio, standard, speed=1.0):
    rate = standard["sampleRate"]
    settings = standard["processing"]
    active = np.flatnonzero(np.abs(audio) > 10 ** (settings["silenceThresholdDbfs"] / 20))
    if not len(active):
        raise ValueError("Source contains no usable speech")
    margin = round(rate * settings["trimMarginMs"] / 1000)
    audio = audio[max(0, active[0] - margin):min(len(audio), active[-1] + margin + 1)].copy()
    if speed != 1:
        from fractions import Fraction
        factor = Fraction(1 / speed).limit_denominator(10000)
        audio = resample_poly(audio, factor.numerator, factor.denominator)
    fade = min(round(rate * settings["fadeMs"] / 1000), len(audio) // 2)
    if fade:
        audio[:fade] *= np.linspace(0, 1, fade)
        audio[-fade:] *= np.linspace(1, 0, fade)
    meter = pyln.Meter(rate, block_size=min(0.4, len(audio) / rate / 2))
    loudness = meter.integrated_loudness(audio)
    if not np.isfinite(loudness):
        raise ValueError("Cannot measure speech loudness")
    gain = 10 ** ((settings["targetLufs"] - loudness) / 20)
    ceiling = 10 ** (settings["maximumPeakDbfs"] / 20)
    audio *= min(gain, ceiling / np.max(np.abs(audio)))
    audio = np.concatenate([
        np.zeros(round(rate * settings["leadingSilenceMs"] / 1000)), audio,
        np.zeros(round(rate * settings["trailingSilenceMs"] / 1000)),
    ])
    if not 0.35 <= len(audio) / rate <= 12:
        raise ValueError("Processed clip is outside the app's 0.35–12 second limit")
    stream = io.BytesIO()
    sf.write(stream, audio, rate, format="WAV", subtype="PCM_16")
    return stream.getvalue()


def bank_requests(phrases, standard):
    # Generate independent tests after all playback sources, keeping roles explicit.
    for role, seed in [("reference", standard["seed"]), ("independent-test", standard["testSeed"])]:
        for phrase in phrases:
            yield {"id": phrase["id"], "role": role, "request": request_for(phrase["xh"], seed, standard)}
    yield {"id": "wrong-phrase", "role": "independent-test", "request": request_for("Ndifuna ukufunda namhlanje.", standard["testSeed"], standard)}


def generate_bank(phrases, standard, output, cache, synthesizer=None):
    load_voice(standard)
    output.mkdir(parents=True, exist_ok=True)
    (output / "provenance.json").unlink(missing_ok=True)
    records = []
    for item in bank_requests(phrases, standard):
        source, source_hash = source_audio(item["request"], standard, cache, synthesizer)
        factor = gcd(standard["sourceSampleRate"], standard["sampleRate"])
        source = resample_poly(source, standard["sampleRate"] // factor, standard["sourceSampleRate"] // factor)
        receipt = json.loads((cache / f'{sha256(json_bytes(item["request"]))}.json').read_text())
        variants = standard["references"] if item["role"] == "reference" else [{"id": None, "speed": 1}]
        for variant in variants:
            if item["role"] == "independent-test":
                relative = f'fixtures/{item["id"]}.wav'
            elif variant["id"] == standard["references"][0]["id"]:
                relative = f'audio/{item["id"]}.wav'
            else:
                relative = f'audio/variants/{item["id"]}-{variant["id"]}.wav'
            data = prepare_audio(source, standard, variant["speed"])
            destination = output / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            records.append({
                "id": item["id"], "role": item["role"], "file": relative,
                "text": item["request"]["text"], "seed": item["request"]["seed"],
                "speed": variant["speed"], "sourceSha256": source_hash, "sha256": sha256(data),
                "execution": receipt.get("execution"),
            })
        print(f'Staged {item["role"]}: {item["id"]}', flush=True)
    silence = io.BytesIO()
    sf.write(silence, np.zeros(32000), standard["sampleRate"], format="WAV", subtype="PCM_16")
    (output / "fixtures/silence.wav").write_bytes(silence.getvalue())
    manifest = {
        "schemaVersion": 2, "model": standard["model"]["id"], "revision": standard["model"]["revision"],
        "license": standard["model"]["license"], "synthetic": True, "sampleRate": standard["sampleRate"],
        "seed": standard["seed"], "testSeed": standard["testSeed"],
        "referenceVariants": standard["references"], "standard": standard,
        "standardSha256": sha256(json_bytes(standard)), "courseSha256": sha256(json_bytes(phrases)),
        "generatorSha256": sha256(Path(__file__).read_bytes()),
        "dependencyLockSha256": sha256((ROOT / "uv.lock").read_bytes()),
        "completeUtterances": True, "humanPhoneticReview": False, "status": "trial",
        "reproducibility": "Pinned local model, fixed synthetic voice prompt, per-phrase seed, immutable source WAV checksums",
        "files": records,
    }
    (output / "provenance.json").write_bytes(json_bytes(manifest))
    print(f"Complete staged bank: {output}. Audit the whole bank before replacing live files.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--generate", action="store_true", help="Enable free local inference for missing cached sources")
    parser.add_argument("--download-model", action="store_true", help="Allow downloading the pinned public checkpoint")
    parser.add_argument("--device", choices=["auto", "mps", "cpu"], default="auto")
    parser.add_argument("--output", type=Path, default=ROOT / "models/higgs-mlx-candidate")
    parser.add_argument("--standard", type=Path, default=STANDARD, help="Pinned standard or a completed bank manifest (offline replay)")
    parser.add_argument("--cache", type=Path, default=ROOT / "models/audio-source-cache")
    args = parser.parse_args()
    standard = json.loads(args.standard.read_text())
    standard = standard.get("standard", standard)
    phrases = [p for lesson in json.loads((ROOT / "src/course.json").read_text()) for p in lesson["phrases"]]
    if args.plan:
        requests = list(bank_requests(phrases, standard))
        print(json.dumps({"model": standard["model"], "voice": standard["voice"], "sources": len(requests), "output": str(args.output), "requests": requests}, indent=2, ensure_ascii=False))
        return
    output = args.output.resolve()
    if output == ROOT or output.is_relative_to(ROOT / "public") or output.is_relative_to(ROOT / "tests"):
        raise ValueError("Use a staging folder outside public/ and tests/")
    if args.download_model and not args.generate:
        parser.error("--download-model requires --generate")
    synthesizer = LocalSynthesis(standard, args.download_model, args.device) if args.generate else None
    generate_bank(phrases, standard, output, args.cache, synthesizer)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sf.LibsndfileError) as error:
        sys.exit(str(error))
