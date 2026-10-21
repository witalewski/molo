"""Offline checks of source integrity and reproducibility, not phonetic quality."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("uniform_audio", ROOT / "scripts/generate-uniform-audio.py")
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)


def signal(frequency=300):
    return np.sin(np.arange(24000) * 2 * np.pi * frequency / 24000) * 0.1


class AudioGenerationTests(unittest.TestCase):
    def setUp(self):
        self.standard = json.loads((ROOT / "scripts/audio-standard.json").read_text())
        self.phrases = [p for lesson in json.loads((ROOT / "src/course.json").read_text()) for p in lesson["phrases"]]

    def test_memory_guard_refuses_large_limits_and_pressure_before_and_during_generation(self):
        unsafe = {**self.standard, "resources": {**self.standard["resources"], "metalLimitBytes": 8 * 1024**3}}
        with patch.object(audio.subprocess, "check_output") as command:
            with self.assertRaisesRegex(ValueError, "Unsafe memory limits"):
                audio.check_resource_budget(unsafe)
            command.assert_not_called()
        with patch.object(audio.os, "sysconf", side_effect=lambda name: 1048576 if name == "SC_PHYS_PAGES" else 16384):
            for percent, loaded in [(30, False), (10, True)]:
                with patch.object(audio.subprocess, "check_output", return_value=f"System-wide memory free percentage: {percent}%"):
                    with self.assertRaisesRegex(ValueError, "stopped safely"):
                        audio.check_resource_budget(self.standard, loaded=loaded)
            with patch.object(audio.subprocess, "check_output", return_value="System-wide memory free percentage: 60%"):
                audio.check_resource_budget(self.standard)
            with patch.object(audio.subprocess, "check_output", return_value="unavailable"):
                with self.assertRaisesRegex(ValueError, "Cannot verify"):
                    audio.check_resource_budget(self.standard)

    def test_offline_build_reproduces_the_whole_bank_without_loading_a_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root, cache = Path(directory), Path(directory) / "cache"
            requests = list(audio.bank_requests(self.phrases, self.standard))
            self.assertEqual(len(requests), 65)
            for item in requests:
                frequency = 300 if item["role"] == "reference" else 500
                audio.cache_source(item["request"], signal(frequency), self.standard, cache)
            with patch.object(audio.LocalSynthesis, "__call__", side_effect=AssertionError("No inference allowed")), patch("builtins.print"):
                audio.generate_bank(self.phrases, self.standard, root / "first", cache)
                audio.generate_bank(self.phrases, self.standard, root / "second", cache)
            files = [p.relative_to(root / "first") for p in (root / "first").rglob("*.wav")]
            self.assertEqual(len(files), 130)
            for name in files + [Path("provenance.json")]:
                self.assertEqual((root / "first" / name).read_bytes(), (root / "second" / name).read_bytes())
            manifest = json.loads((root / "first/provenance.json").read_text())
            self.assertFalse(manifest["humanPhoneticReview"])
            self.assertEqual(manifest["standard"]["voice"], self.standard["voice"])
            for item in manifest["files"]:
                self.assertEqual(audio.sha256((root / "first" / item["file"]).read_bytes()), item["sha256"])
            primary, rate = sf.read(root / "first/audio/molo.wav")
            self.assertEqual(rate, 16000)
            self.assertLessEqual(np.max(np.abs(primary)), 10 ** (-1 / 20) + 1 / 32768)
            self.assertTrue(np.all(primary[:2400] == 0))
            self.assertNotEqual((root / "first/audio/molo.wav").read_bytes(), (root / "first/fixtures/molo.wav").read_bytes())

    def test_missing_or_corrupt_sources_never_trigger_an_implicit_model_fallback(self):
        request = audio.request_for("Molo!", self.standard["seed"], self.standard)
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            with self.assertRaisesRegex(ValueError, "not cached"):
                audio.source_audio(request, self.standard, cache)
            audio.cache_source(request, signal(), self.standard, cache)
            file = next(cache.glob("*.wav"))
            file.write_bytes(file.read_bytes() + b"corrupt")
            synthesizer = Mock()
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                audio.source_audio(request, self.standard, cache, synthesizer)
            synthesizer.assert_not_called()

    def test_explicit_inference_is_cached_and_voice_hash_is_enforced(self):
        request = audio.request_for("Uxolo, tata!", self.standard["seed"], self.standard)
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            synthesizer = Mock(return_value=signal())
            first, first_hash = audio.source_audio(request, self.standard, cache, synthesizer)
            second, second_hash = audio.source_audio(request, self.standard, cache, synthesizer)
            synthesizer.assert_called_once_with(request)
            self.assertEqual(first_hash, second_hash)
            np.testing.assert_array_equal(first, second)
        altered = {**self.standard, "voice": {**self.standard["voice"], "sha256": "wrong"}}
        with self.assertRaisesRegex(ValueError, "Voice profile checksum mismatch"):
            audio.load_voice(altered)

    def test_failed_build_cannot_retain_an_old_complete_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root, output = Path(directory), Path(directory) / "bank"
            output.mkdir()
            (output / "provenance.json").write_text("old completed build")
            with self.assertRaisesRegex(ValueError, "not cached"):
                audio.generate_bank(self.phrases, self.standard, output, root / "cache")
            self.assertFalse((output / "provenance.json").exists())

    def test_invalid_sources_and_live_output_are_rejected(self):
        for samples, message in [(np.zeros(24000), "no usable speech"), (np.full(24000, np.nan), "invalid")]:
            stream = io.BytesIO()
            sf.write(stream, samples, 24000, format="WAV", subtype="FLOAT")
            with self.assertRaisesRegex(ValueError, message):
                audio.decode_source(stream.getvalue(), 24000)
        before = audio.sha256((ROOT / "public/audio/molo.wav").read_bytes())
        result = subprocess.run([sys.executable, str(ROOT / "scripts/generate-uniform-audio.py"), "--output", str(ROOT / "public/audio")], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("staging folder", result.stderr)
        self.assertEqual(before, audio.sha256((ROOT / "public/audio/molo.wav").read_bytes()))


if __name__ == "__main__":
    unittest.main()
