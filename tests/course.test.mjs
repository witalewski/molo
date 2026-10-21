import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  course,
  modules,
  phrases,
  isLessonUnlocked,
  isModuleReady,
  requiredCorrect,
  gradeModule,
} from "../src/lib/course.ts";
import {
  parseWav,
  referenceFiles,
  REFERENCE_VARIANTS,
} from "../server/speech.mjs";

test("module one contains the existing two lessons followed by exactly three new lessons", () => {
  assert.equal(modules.length, 1);
  assert.deepEqual(
    course.map((l) => l.id),
    [
      "greetings",
      "courtesy",
      "how-are-you",
      "polite-requests",
      "respect-and-goodbyes",
    ],
  );
  assert.deepEqual(
    modules[0].lessonIds,
    course.map((l) => l.id),
  );
  assert.deepEqual(
    course.map((l) => l.number),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    course.map((l) => l.phrases.length),
    [6, 6, 6, 6, 8],
  );
  assert.equal(phrases.length, 32);
  assert.equal(new Set(phrases.map((p) => p.id)).size, phrases.length);
  assert.equal(new Set(phrases.map((p) => p.xh)).size, phrases.length);
  for (const phrase of phrases) {
    assert.match(phrase.id, /^[a-z]+(?:-[a-z]+)*$/);
    for (const field of ["xh", "pl", "context", "tip"])
      assert.ok(phrase[field].trim(), `${phrase.id}.${field}`);
  }
});

test("every phrase has both a usable reference and an independently generated voice-test recording", () => {
  for (const phrase of phrases) {
    const fixture = fs.readFileSync(
      new URL(`./fixtures/${phrase.id}.wav`, import.meta.url),
    );
    const references = referenceFiles(phrase.id).map((file) =>
      fs.readFileSync(file),
    );
    for (const file of [...references, fixture]) {
      const samples = parseWav(file);
      assert.ok(
        samples.some((n) => Math.abs(n) > 0.04),
        phrase.id,
      );
    }
    for (const reference of references)
      assert.notDeepEqual(
        fixture,
        reference,
        `${phrase.id} must not be tested against an identical audio file`,
      );
  }
  const provenance = JSON.parse(
    fs.readFileSync(
      new URL("../public/audio/provenance.json", import.meta.url),
    ),
  );
  assert.deepEqual(
    provenance.referenceVariants.map((variant) => variant.id),
    REFERENCE_VARIANTS,
  );
  assert.ok(!REFERENCE_VARIANTS.includes(provenance.testSeed));
});

test("the complete live bank matches one pinned synthetic voice and independently seeded fixtures", () => {
  const read = (name) =>
    fs.readFileSync(new URL(`../${name}`, import.meta.url));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const manifest = JSON.parse(read("public/audio/provenance.json"));
  const standard = JSON.parse(read("scripts/audio-standard.json"));
  assert.equal(manifest.status, "in-use");
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.completeUtterances, true);
  assert.deepEqual(manifest.standard, standard);
  assert.equal(manifest.revision, standard.model.revision);
  assert.equal(hash(read(standard.voice.file)), standard.voice.sha256);
  assert.equal(hash(read("uv.lock")), manifest.dependencyLockSha256);
  assert.equal(
    hash(read("scripts/generate-uniform-audio.py")),
    manifest.generatorSha256,
  );
  assert.equal(manifest.files.length, 129);
  assert.equal(new Set(manifest.files.map((item) => item.file)).size, 129);
  for (const item of manifest.files) {
    const file = item.file.startsWith("audio/")
      ? `public/${item.file}`
      : `tests/${item.file}`;
    assert.equal(hash(read(file)), item.sha256, file);
    assert.equal(
      item.seed,
      item.role === "reference" ? standard.seed : standard.testSeed,
    );
  }
  for (const phrase of phrases) {
    const records = manifest.files.filter((item) => item.id === phrase.id);
    assert.equal(records.length, 4, phrase.id);
    assert.ok(records.every((item) => item.text === phrase.xh));
    assert.equal(
      new Set(
        records
          .filter((item) => item.role === "reference")
          .map((item) => item.sourceSha256),
      ).size,
      1,
    );
    assert.notEqual(
      records[0].sourceSha256,
      records.find((item) => item.role === "independent-test").sourceSha256,
    );
  }
});

test("lessons unlock in sequence and existing two-lesson progress unlocks lesson three", () => {
  const completed = {};
  for (const [index, lesson] of course.entries()) {
    assert.equal(isModuleReady(modules[0], completed), false);
    for (const [candidateIndex, candidate] of course.entries()) {
      assert.equal(
        isLessonUnlocked(candidate.id, completed),
        candidateIndex <= index,
        candidate.id,
      );
    }
    completed[lesson.id] = { date: "2026-10-19", accuracy: 100 };
  }
  assert.equal(isModuleReady(modules[0], completed), true);
  assert.equal(isLessonUnlocked("missing", completed), false);
  // A partial/corrupt save cannot bypass earlier lessons by marking only the previous one.
  assert.equal(isLessonUnlocked(course[2].id, { [course[1].id]: {} }), false);
  assert.equal(isModuleReady(modules[0], { [course[4].id]: {} }), false);
});

test("the situational test references unambiguous course options and covers every lesson", () => {
  const module = modules[0];
  assert.equal(module.questions.length, 12);
  assert.equal(
    new Set(module.questions.map((q) => q.id)).size,
    module.questions.length,
  );
  for (const question of module.questions) {
    assert.ok(question.prompt && question.explanation);
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.ok(question.options.includes(question.correctPhraseId));
    for (const option of question.options)
      assert.ok(
        phrases.some((p) => p.id === option),
        option,
      );
  }
  for (const lesson of course)
    assert.ok(
      module.questions.some((q) =>
        lesson.phrases.some((p) => p.id === q.correctPhraseId),
      ),
      lesson.id,
    );
});

test("the module test requires all answers and at least ten correct, including the boundary", () => {
  const module = modules[0];
  const answers = module.questions.map((q) => q.correctPhraseId);
  assert.equal(requiredCorrect(module), 10);
  assert.deepEqual(gradeModule(module, answers), {
    correct: 12,
    total: 12,
    passed: true,
  });
  assert.equal(gradeModule(module, answers.slice(0, 11)).passed, false);
  assert.equal(gradeModule(module, [...answers, answers[0]]).passed, false);
  assert.equal(gradeModule(module, []).passed, false);
  assert.equal(
    gradeModule(
      module,
      answers.map((a, i) => (i < 2 ? "wrong" : a)),
    ).passed,
    true,
  );
  assert.equal(
    gradeModule(
      module,
      answers.map((a, i) => (i < 3 ? "wrong" : a)),
    ).passed,
    false,
  );
});
