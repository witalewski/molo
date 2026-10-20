import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  compareTranscript,
  editDistance,
  normalize,
  parseWav,
  assessAnalysis,
} from "../server/speech.mjs";
const course = JSON.parse(
  fs.readFileSync(new URL("../src/course.json", import.meta.url)),
);
test("all shipped lesson audio is valid 16kHz PCM and contains sound", () => {
  for (const p of course.flatMap((l) => l.phrases)) {
    const samples = parseWav(
      fs.readFileSync(new URL(`../public/audio/${p.id}.wav`, import.meta.url)),
    );
    assert.ok(
      samples.some((n) => Math.abs(n) > 0.04),
      p.id,
    );
  }
});
test("WAV parser rejects malformed files", () => {
  for (const buffer of [Buffer.from("invalid"), Buffer.alloc(44)])
    assert.throws(() => parseWav(buffer), /WAV/);
});
test("WAV parser rejects unsupported sampling rate", () => {
  const file = Buffer.from(
    fs.readFileSync(new URL("./fixtures/molo.wav", import.meta.url)),
  );
  file.writeUInt32LE(44100, 24);
  assert.throws(() => parseWav(file), /16 kHz/);
});
test("WAV parser rejects truncated data", () => {
  const file = fs.readFileSync(new URL("./fixtures/molo.wav", import.meta.url));
  assert.throws(() => parseWav(file.subarray(0, 100)), /niepełne/);
});
test("normalization ignores punctuation and capitalization", () => {
  assert.equal(normalize("  Enkosi, TATA! "), "enkosi tata");
  assert.equal(editDistance("molo", "mama"), 3);
  assert.equal(compareTranscript("molo tata", "Molo, tata!").passed, true);
});
test("honorifics cannot be substituted even for otherwise similar phrases", () => {
  assert.equal(compareTranscript("enkosi mama", "Enkosi, tata!").passed, false);
  assert.equal(compareTranscript("uxolo tata", "Uxolo, mama!").passed, false);
});
test("goodbye direction cannot be substituted", () => {
  assert.equal(
    compareTranscript("hamba kakuhle", "Sala kakuhle!").passed,
    false,
  );
  for (const [heard, target] of [
    ["hambani kakuhle", "Salani kakuhle!"],
    ["hamba kakuhle", "Hambani kakuhle!"],
    ["sala kakuhle", "Salani kakuhle!"],
  ])
    assert.equal(compareTranscript(heard, target).passed, false);
});
test("new age and number distinctions cannot be substituted", () => {
  for (const [heard, target] of [
    ["molo tata", "Molo, tat’omkhulu!"],
    ["molo mama", "Molo, makhulu!"],
    ["molo bhuti", "Molo, sisi!"],
    ["unjani", "Ninjani?"],
    ["ndiphilile enkosi", "Siphilile, enkosi."],
  ])
    assert.equal(compareTranscript(heard, target).passed, false);
  assert.equal(
    compareTranscript("MOLO, TAT'OMKHULU!", "Molo, tat’omkhulu!").passed,
    true,
  );
});
test("empty or unrelated recognized speech cannot complete an exercise", () => {
  for (const text of [
    "",
    "hello",
    "ndifuna ukufunda namhlanje",
    "molo molo molo",
  ])
    assert.equal(compareTranscript(text, "Molo!").passed, false);
});
test("missing and extra words are rejected", () => {
  assert.equal(compareTranscript("enkosi", "Enkosi, tata!").passed, false);
  assert.equal(
    compareTranscript("enkosi tata mama", "Enkosi, tata!").passed,
    false,
  );
});

test("acoustic comparison is symmetric in identity and rejects missing evidence", async () => {
  const { acousticDistance } = await import("../server/acoustic.mjs");
  assert.equal(
    acousticDistance(
      [
        [1, 0],
        [0, 1],
      ],
      [
        [1, 0],
        [0, 1],
      ],
    ),
    0,
  );
  assert.equal(acousticDistance([], [[1, 0]]), 1);
  assert.equal(acousticDistance([[1, 0]], [[0, 1]]), 1);
});
test("acoustic alignment tolerates slower repetition of the same sounds", async () => {
  const { acousticDistance } = await import("../server/acoustic.mjs");
  assert.ok(
    acousticDistance(
      [
        [1, 0],
        [0, 1],
      ],
      [
        [1, 0],
        [1, 0],
        [0, 1],
        [0, 1],
      ],
    ) < 0.1,
  );
});

test("alternate acoustic readings rank as one phrase and preserve the next distinct candidate", async () => {
  const { rankReferences } = await import("../server/acoustic.mjs");
  const ranking = rankReferences(
    [[1, 0]],
    [
      { phrase: { id: "a" }, featureSets: [[[0, 1]], [[1, 0]], [[1, 0]]] },
      { phrase: { id: "b" }, featureSets: [[[0, 1]]] },
    ],
  );
  assert.deepEqual(
    ranking.map((r) => [r.phrase.id, r.distance]),
    [
      ["a", 0],
      ["b", 1],
    ],
  );
});

test("a confident singular transcription cannot pass the plural through similar acoustic references", () => {
  const analysis = {
    transcript: "hamba ka kuhle",
    confidence: 0.98,
    features: [[], [], []],
  };
  const ranking = [
    { phrase: { xh: "Hambani kakuhle!" }, distance: 0.08 },
    { phrase: { xh: "Hamba kakuhle!" }, distance: 0.22 },
  ];
  const plural = assessAnalysis(analysis, ranking, "Hambani kakuhle!");
  assert.equal(plural.passed, false);
  assert.equal(plural.transcript, "Hamba kakuhle!");
  assert.equal(plural.method, "ctc-transcription");
  assert.equal(
    assessAnalysis(analysis, ranking, "Hamba kakuhle!").passed,
    true,
  );
});

test("acoustic predictions are independent of the expected answer", () => {
  const analysis = {
    transcript: "unreliable spelling",
    confidence: 0.9,
    features: [[], [], []],
  };
  const ranking = [
    { phrase: { xh: "Molo!" }, distance: 0.1 },
    { phrase: { xh: "Molweni!" }, distance: 0.3 },
  ];
  assert.equal(assessAnalysis(analysis, ranking, "Molo!").passed, true);
  const differentTarget = assessAnalysis(analysis, ranking, "Molweni!");
  assert.equal(differentTarget.passed, false);
  assert.equal(differentTarget.transcript, "Molo!");
});
