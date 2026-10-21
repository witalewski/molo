import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  prepareReferences,
  recognize,
  parseWav,
  assessAnalysis,
  evaluate,
} from "../server/speech.mjs";
import { rankReferences } from "../server/acoustic.mjs";

const phrases = JSON.parse(
  fs.readFileSync(new URL("../src/course.json", import.meta.url)),
).flatMap((l) => l.phrases);
const samplesFor = (id) =>
  parseWav(fs.readFileSync(new URL(`./fixtures/${id}.wav`, import.meta.url)));

test("independently generated synthetic corpus accepts each phrase and rejects every other lesson target", async () => {
  const references = await prepareReferences();
  const failures = [];
  for (const recording of phrases) {
    const analysis = await recognize(samplesFor(recording.id));
    const ranking = rankReferences(analysis.features, references);
    for (const target of phrases) {
      const result = assessAnalysis(analysis, ranking, target.xh);
      if (result.passed !== (recording.id === target.id))
        failures.push({ recording: recording.id, target: target.id, result });
    }
  }
  assert.deepEqual(
    failures,
    [],
    "Every recording must pass only its own target, including number and age distinctions",
  );
});

test("unrelated speech and silence cannot complete any phrase in the module", async () => {
  const references = await prepareReferences();
  const analysis = await recognize(samplesFor("wrong-phrase"));
  const ranking = rankReferences(analysis.features, references);
  for (const phrase of phrases) {
    assert.equal(
      assessAnalysis(analysis, ranking, phrase.xh).passed,
      false,
      phrase.id,
    );
    assert.equal(
      (await evaluate(samplesFor("silence"), phrase.xh)).passed,
      false,
      phrase.id,
    );
  }
});
