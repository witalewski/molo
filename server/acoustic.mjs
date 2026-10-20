/** Hellinger posterior features keep phonetic evidence, independent of CTC spelling. */
export function posteriorFeatures(logits) {
  const width = logits.dims.at(-1),
    frames = logits.data.length / width,
    features = [];
  for (let t = 0; t < frames; t++) {
    const offset = t * width;
    if (Math.exp(logits.data[offset + 28]) > 0.8) continue;
    const values = new Float32Array(27);
    let sum = 0;
    for (let i = 0; i < 27; i++) {
      values[i] = Math.exp(logits.data[offset + i]);
      sum += values[i];
    }
    if (sum < 0.05) continue;
    for (let i = 0; i < 27; i++) values[i] = Math.sqrt(values[i] / sum);
    features.push(values);
  }
  return features;
}
/** Dynamic time warping compares complete sequences and tolerates speaking speed. */
export function acousticDistance(a, b) {
  if (!a.length || !b.length) return 1;
  let previous = new Float64Array(b.length + 1).fill(Infinity),
    lengths = new Uint32Array(b.length + 1);
  previous[0] = 0;
  for (let i = 0; i < a.length; i++) {
    const current = new Float64Array(b.length + 1).fill(Infinity),
      steps = new Uint32Array(b.length + 1);
    for (let j = 0; j < b.length; j++) {
      let similarity = 0;
      for (let k = 0; k < a[i].length; k++) similarity += a[i][k] * b[j][k];
      const distance = Math.max(0, Math.min(1, 1 - similarity));
      let cost = previous[j],
        count = lengths[j];
      if (previous[j + 1] < cost) {
        cost = previous[j + 1];
        count = lengths[j + 1];
      }
      if (current[j] < cost) {
        cost = current[j];
        count = steps[j];
      }
      current[j + 1] = cost + distance;
      steps[j + 1] = count + 1;
    }
    previous = current;
    lengths = steps;
  }
  const lengthRatio =
    Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return Math.min(
    1,
    previous[b.length] / Math.max(1, lengths[b.length]) +
      Math.max(0, 0.6 - lengthRatio) * 0.35,
  );
}

/** Rank phrases, not individual recordings, so alternate readings do not compete. */
export function rankReferences(features, references) {
  return references
    .map((ref) => ({
      phrase: ref.phrase,
      distance: Math.min(
        ...ref.featureSets.map((sample) => acousticDistance(features, sample)),
      ),
    }))
    .sort((a, b) => a.distance - b.distance);
}
