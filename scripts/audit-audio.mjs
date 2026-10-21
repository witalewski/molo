/** Screen audio independently of the app's acoustic-reference pass/fail logic. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import {
  recognize,
  parseWav,
  normalize,
  editDistance,
  REFERENCE_VARIANTS,
} from "../server/speech.mjs";

const { values } = parseArgs({
  options: {
    "audio-dir": { type: "string", default: "public/audio" },
    "fixtures-dir": { type: "string", default: "tests/fixtures" },
    output: { type: "string", default: "reports/audio-audit.json" },
    "primary-only": { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
  },
});
const phrases = JSON.parse(
  fs.readFileSync(new URL("../src/course.json", import.meta.url)),
).flatMap((lesson) => lesson.phrases);
const results = [];
const compact = (text) => normalize(text).replaceAll(" ", "");
for (const phrase of phrases) {
  const files = [
    {
      kind: "primary",
      file: path.join(values["audio-dir"], `${phrase.id}.wav`),
    },
  ];
  if (!values["primary-only"]) {
    for (const variant of REFERENCE_VARIANTS.slice(1))
      files.push({
        kind: `reference-${variant}`,
        file: path.join(
          values["audio-dir"],
          "variants",
          `${phrase.id}-${variant}.wav`,
        ),
      });
    files.push({
      kind: "independent-test",
      file: path.join(values["fixtures-dir"], `${phrase.id}.wav`),
    });
  }
  for (const { kind, file } of files) {
    const bytes = fs.readFileSync(file);
    const samples = parseWav(bytes);
    let peak = 0,
      energy = 0,
      clipped = 0;
    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample));
      energy += sample * sample;
      if (Math.abs(sample) >= 0.99) clipped++;
    }
    const analysis = await recognize(samples);
    const heard = compact(analysis.transcript),
      expected = compact(phrase.xh);
    const similarity = Math.max(
      0,
      1 -
        editDistance(heard, expected) / Math.max(heard.length, expected.length),
    );
    const rms = Math.sqrt(energy / samples.length);
    const checks = {
      transcriptMatches: heard === expected,
      containsSpeech: rms > 0.004,
      noClipping: clipped === 0,
    };
    const row = {
      id: phrase.id,
      kind,
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      expected: phrase.xh,
      transcript: analysis.transcript,
      confidence: analysis.confidence,
      similarity,
      duration: samples.length / 16000,
      peak,
      rms,
      checks,
    };
    results.push(row);
    console.log(
      JSON.stringify({
        id: phrase.id,
        kind,
        transcript: analysis.transcript,
        similarity,
        checks,
      }),
    );
  }
}
const report = {
  method:
    "Independent raw CTC transcription and signal measurements; no expected-phrase substitution or acoustic-reference acceptance",
  humanPhoneticReview: false,
  limitation:
    "Transcript mismatches are review flags, not proof of incorrect pronunciation. Exact transcription does not validate clicks, tones, or accent.",
  total: results.length,
  exactTranscripts: results.filter((row) => row.checks.transcriptMatches)
    .length,
  results,
};
fs.mkdirSync(path.dirname(values.output), { recursive: true });
fs.writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
console.log(
  `Audio audit: ${report.exactTranscripts}/${report.total} exact raw transcripts. ${values.output}`,
);
if (
  values.strict &&
  results.some((row) => Object.values(row.checks).some((value) => !value))
)
  process.exitCode = 1;
