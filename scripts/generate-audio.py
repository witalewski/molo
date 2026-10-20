"""Generate CC BY 4.0 Simba Xhosa audio, plus independent-seed E2E inputs."""
import json
import argparse
from pathlib import Path
import numpy as np
import torch
import soundfile as sf
from scipy.signal import resample_poly
from transformers import VitsModel, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--only-missing", action="store_true", help="Preserve existing reference and test recordings")
args = parser.parse_args()
MODEL = "UBC-NLP/Simba-TTS-xho"
revision = "1bd104d6fe7a687bbc1e9b36031ab51d605e151c"
reference_seeds = [1337, 7331, 7332]
print(f"Loading {MODEL}@{revision}", flush=True)
torch.set_num_threads(4)
model = VitsModel.from_pretrained(MODEL, revision=revision, token=False)
tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=revision, token=False)
phrases = [p for lesson in json.loads((ROOT / "src/course.json").read_text()) for p in lesson["phrases"]]

def generate(text, output, seed):
    if args.only_missing and output.exists():
        return
    torch.manual_seed(seed)
    inputs = tokenizer(text.lower(), return_tensors="pt")
    with torch.no_grad():
        audio = model(**inputs).waveform[0].cpu().numpy()
    rate = model.config.sampling_rate
    if rate != 16000:
        from math import gcd
        factor = gcd(rate, 16000)
        audio = resample_poly(audio, 16000 // factor, rate // factor)
    audio = np.concatenate([np.zeros(2400), audio, np.zeros(3200)])
    audio = audio / max(1.0, float(np.max(np.abs(audio))) / 0.92)
    sf.write(output, audio, 16000, subtype="PCM_16")
    print(f"Generated {output.name}: {len(audio)/16000:.2f}s", flush=True)

for phrase in phrases:
    generate(phrase["xh"], ROOT / "public/audio" / f'{phrase["id"]}.wav', 1337)
    variants = ROOT / "public/audio/variants"
    variants.mkdir(parents=True, exist_ok=True)
    for seed in reference_seeds[1:]:
        generate(phrase["xh"], variants / f'{phrase["id"]}-{seed}.wav', seed)
    generate(phrase["xh"], ROOT / "tests/fixtures" / f'{phrase["id"]}.wav', 2026)
generate("Ndifuna ukufunda namhlanje.", ROOT / "tests/fixtures/wrong-phrase.wav", 42)
sf.write(ROOT / "tests/fixtures/silence.wav", np.zeros(32000), 16000, subtype="PCM_16")
(ROOT / "public/audio/provenance.json").write_text(json.dumps({"model": MODEL, "revision": revision, "license": "CC-BY-4.0", "synthetic": True, "sampleRate": 16000, "seed": 1337, "referenceSeeds": reference_seeds, "testSeed": 2026}, indent=2))
