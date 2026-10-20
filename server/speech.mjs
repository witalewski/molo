import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-node";
import { posteriorFeatures, rankReferences } from "./acoustic.mjs";
const lessonPhrases = JSON.parse(
  fs.readFileSync(new URL("../src/course.json", import.meta.url)),
).flatMap((l) => l.phrases);
let referencePromise;
export const MODEL_ID = "OpenVoiceOS/misterkissi-w2v2-lg-xls-r-300m-xhosa-onnx";
const directory = path.resolve(import.meta.dirname, "../models/xhosa-asr");
let sessionPromise;
let vocabulary;
export const REFERENCE_SEEDS = [1337, 7331, 7332];
export function referenceFiles(phraseId) {
  return [
    new URL(`../public/audio/${phraseId}.wav`, import.meta.url),
    ...REFERENCE_SEEDS.slice(1).map(
      (seed) =>
        new URL(
          `../public/audio/variants/${phraseId}-${seed}.wav`,
          import.meta.url,
        ),
    ),
  ];
}
export function modelsPresent() {
  return ["model.onnx", "model.onnx.data", "vocab.txt"].every((n) =>
    fs.existsSync(path.join(directory, n)),
  );
}
export async function loadModel() {
  if (!modelsPresent())
    throw Error("Brak modelu Xhosa. Uruchom mise run voice.");
  if (!sessionPromise) {
    vocabulary = Object.fromEntries(
      fs
        .readFileSync(path.join(directory, "vocab.txt"), "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const [token, id] = line.split(" ");
          return [Number(id), token];
        }),
    );
    sessionPromise = ort.InferenceSession.create(
      path.join(directory, "model.onnx"),
      {
        executionProviders: ["cpu"],
        intraOpNumThreads: 4,
        interOpNumThreads: 1,
        graphOptimizationLevel: "all",
      },
    ).catch((e) => {
      sessionPromise = undefined;
      throw e;
    });
  }
  return sessionPromise;
}
export function parseWav(buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  )
    throw Error("Wybierz poprawne nagranie WAV PCM 16 bit, mono, 16 kHz.");
  let format, channels, rate, bits, data;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const tag = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length)
      throw Error("Nagranie WAV jest niepełne.");
    if (tag === "fmt ") {
      if (size < 16) throw Error("Niepoprawny format WAV.");
      format = buffer.readUInt16LE(start);
      channels = buffer.readUInt16LE(start + 2);
      rate = buffer.readUInt32LE(start + 4);
      bits = buffer.readUInt16LE(start + 14);
    }
    if (tag === "data") data = buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (
    format !== 1 ||
    channels !== 1 ||
    rate !== 16000 ||
    bits !== 16 ||
    !data ||
    data.length % 2
  )
    throw Error("Wymagany format WAV PCM 16 bit, mono, 16 kHz.");
  const samples = new Float32Array(data.length / 2);
  if (samples.length < 5600 || samples.length > 192000)
    throw Error("Nagranie musi trwać od 0,35 do 12 sekund.");
  for (let i = 0; i < samples.length; i++)
    samples[i] = data.readInt16LE(i * 2) / 32768;
  return samples;
}
export const normalize = (text) =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
export function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(
        Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)),
      );
    row = next;
  }
  return row[b.length];
}
export function compareTranscript(transcript, target) {
  const heard = normalize(transcript),
    expected = normalize(target);
  const score = heard
    ? Math.max(
        0,
        Math.round(
          100 *
            (1 -
              editDistance(heard, expected) /
                Math.max(heard.length, expected.length)),
        ),
      )
    : 0;
  const targetWords = expected.split(" "),
    heardWords = heard.split(" ");
  const critical = targetWords.filter((w) =>
    [
      "molo",
      "molweni",
      "tata",
      "mama",
      "bhuti",
      "sisi",
      "tatomkhulu",
      "makhulu",
      "hamba",
      "sala",
      "hambani",
      "salani",
      "uxolo",
      "unjani",
      "ninjani",
      "ndiphilile",
      "siphilile",
      "wena",
      "nam",
      "hayi",
      "ndicela",
    ].includes(w),
  );
  const passed =
    score >= 88 &&
    targetWords.length === heardWords.length &&
    critical.every((w) => heardWords.includes(w));
  return {
    score,
    passed,
    words: targetWords.map((word, index) => ({
      word,
      matched: heardWords[index] === word,
    })),
  };
}
export async function recognize(samples) {
  const session = await loadModel();
  const output = await session.run({
    input_values: new ort.Tensor("float32", samples, [1, samples.length]),
    input_lengths: new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(samples.length)]),
      [1],
    ),
  });
  const logits = output.logprobs ?? Object.values(output)[0];
  const classes = logits.dims.at(-1);
  const frames = logits.data.length / classes;
  let previous = -1,
    transcript = "";
  const confidence = [];
  for (let frame = 0; frame < frames; frame++) {
    let best = 0;
    for (let k = 1; k < classes; k++)
      if (
        logits.data[frame * classes + k] > logits.data[frame * classes + best]
      )
        best = k;
    if (best !== 28 && best !== previous) {
      const token = vocabulary[best] ?? "";
      if (!token.startsWith("<") && token !== "[UNK]") {
        transcript += token === "▁" ? " " : token;
        confidence.push(Math.exp(logits.data[frame * classes + best]));
      }
    }
    previous = best;
  }
  return {
    transcript: transcript.trim().replace(/\s+/g, " "),
    confidence: confidence.length
      ? confidence.reduce((a, b) => a + b, 0) / confidence.length
      : 0,
    features: posteriorFeatures(logits),
  };
}
export async function prepareReferences() {
  if (!referencePromise) {
    referencePromise = (async () => {
      const items = [];
      for (const phrase of lessonPhrases) {
        const featureSets = [];
        for (const file of referenceFiles(phrase.id)) {
          const result = await recognize(parseWav(fs.readFileSync(file)));
          featureSets.push(result.features);
        }
        items.push({ phrase, featureSets });
      }
      return items;
    })().catch((error) => {
      referencePromise = undefined;
      throw error;
    });
  }
  return referencePromise;
}
export async function evaluate(samples, target) {
  const rms = Math.sqrt(
    samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
  );
  if (rms < 0.004)
    return {
      transcript: "",
      score: 0,
      passed: false,
      reason: "silence",
      words: normalize(target)
        .split(" ")
        .map((word) => ({ word, matched: false })),
      method: "acoustic-reference",
    };
  const analysis = await recognize(samples);
  const references = await prepareReferences();
  const ranking = rankReferences(analysis.features, references);
  return assessAnalysis(analysis, ranking, target);
}

/** A confident, complete known transcription takes priority over acoustic similarity. */
export function assessAnalysis(analysis, ranking, target) {
  const best = ranking[0],
    margin = ranking[1].distance - best.distance;
  const targetReference = ranking.find(
    (item) => normalize(item.phrase.xh) === normalize(target),
  );
  const confident =
    analysis.features.length >= 3 && best.distance <= 0.42 && margin >= 0.035;
  const recognizedText = normalize(analysis.transcript).replaceAll(" ", "");
  const transcribedPhrase =
    analysis.confidence >= 0.65
      ? lessonPhrases.find(
          (phrase) =>
            normalize(phrase.xh).replaceAll(" ", "") === recognizedText,
        )
      : undefined;
  const predicted = transcribedPhrase
    ? transcribedPhrase.xh
    : confident
      ? best.phrase.xh
      : analysis.transcript;
  const passed = transcribedPhrase
    ? normalize(transcribedPhrase.xh) === normalize(target)
    : confident && normalize(best.phrase.xh) === normalize(target);
  const comparison = compareTranscript(predicted, target);
  const score = transcribedPhrase
    ? passed
      ? Math.round(analysis.confidence * 100)
      : comparison.score
    : Math.max(0, Math.round(100 * (1 - (targetReference?.distance ?? 1))));
  return {
    ...comparison,
    score,
    passed,
    transcript: predicted,
    rawTranscript: analysis.transcript,
    reason: passed ? "matched" : "mismatch",
    method: transcribedPhrase ? "ctc-transcription" : "acoustic-reference",
    confidence: Math.round(analysis.confidence * 100),
    acousticMargin: Number(margin.toFixed(4)),
  };
}
