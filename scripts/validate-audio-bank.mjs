/** Check a staged bank against all lesson targets before updating live audio. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import {
  recognize,
  parseWav,
  assessAnalysis,
  REFERENCE_VARIANTS,
} from "../server/speech.mjs";
import { rankReferences } from "../server/acoustic.mjs";
const { values } = parseArgs({
  options: { bank: { type: "string", default: "models/audio-candidate" } },
});
const bank = path.resolve(values.bank);
const manifest = JSON.parse(
  fs.readFileSync(path.join(bank, "provenance.json")),
);
for (const item of manifest.files) {
  const data = fs.readFileSync(path.join(bank, item.file));
  if (createHash("sha256").update(data).digest("hex") !== item.sha256)
    throw Error(`Checksum mismatch: ${item.file}`);
}
const phrases = JSON.parse(
  fs.readFileSync(new URL("../src/course.json", import.meta.url)),
).flatMap((l) => l.phrases);
const references = [];
for (const phrase of phrases) {
  const files = [
    path.join(bank, "audio", `${phrase.id}.wav`),
    ...REFERENCE_VARIANTS.slice(1).map((id) =>
      path.join(bank, "audio/variants", `${phrase.id}-${id}.wav`),
    ),
  ];
  const featureSets = [];
  for (const file of files)
    featureSets.push(
      (await recognize(parseWav(fs.readFileSync(file)))).features,
    );
  references.push({ phrase, featureSets });
}
const failures = [],
  recordings = [];
for (const phrase of [...phrases, { id: "wrong-phrase" }]) {
  const samples = parseWav(
    fs.readFileSync(path.join(bank, "fixtures", `${phrase.id}.wav`)),
  );
  const analysis = await recognize(samples),
    ranking = rankReferences(analysis.features, references);
  const accepted = [];
  for (const target of phrases) {
    const result = assessAnalysis(analysis, ranking, target.xh);
    if (result.passed) accepted.push(target.id);
    if (result.passed !== (phrase.id === target.id))
      failures.push({
        recording: phrase.id,
        target: target.id,
        rawTranscript: analysis.transcript,
        result,
      });
  }
  recordings.push({
    id: phrase.id,
    rawTranscript: analysis.transcript,
    accepted,
  });
  console.log(JSON.stringify(recordings.at(-1)));
}
const silence = parseWav(
  fs.readFileSync(path.join(bank, "fixtures/silence.wav")),
);
const silenceRms = Math.sqrt(
  silence.reduce((sum, value) => sum + value * value, 0) / silence.length,
);
if (silenceRms >= 0.004)
  failures.push({
    recording: "silence",
    error: "Silence fixture is not silent",
  });
const report = {
  method:
    "Existing speech classifier with only staged references; separate generation seed for test speech",
  humanPhoneticReview: false,
  pairs: phrases.length * phrases.length,
  negativeTargets: phrases.length,
  silenceRms,
  passed: failures.length === 0,
  recordings,
  failures,
};
fs.writeFileSync(
  path.join(bank, "recognition-check.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `Staged recognition: ${report.pairs} phrase pairs and ${report.negativeTargets} unrelated-speech targets; ${failures.length} failures`,
);
if (failures.length) process.exitCode = 1;
