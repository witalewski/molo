export function encodeWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767),
      true,
    );
  return new Blob([buffer], { type: "audio/wav" });
}
export async function toWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (audio.duration > 12.2 || audio.duration < 0.35)
      throw Error("Nagranie musi trwać od 0,35 do 12 sekund.");
    const offline = new OfflineAudioContext(
        1,
        Math.ceil(audio.duration * 16000),
        16000,
      ),
      source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0));
  } finally {
    await context.close();
  }
}
export type Recording = { stop: () => void; cancel: () => void };
export async function startRecording(
  onDone: (blob: Blob) => void,
  onError: (message: string) => void,
): Promise<Recording> {
  if (!window.isSecureContext)
    throw Error("Mikrofon wymaga HTTPS albo adresu localhost.");
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw Error(
      "Ta przeglądarka nie obsługuje nagrywania. Spróbuj aktualnego Safari lub Chrome albo użyj pliku audio.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
  const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const chunks: BlobPart[] = [];
  let cancelled = false;
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const timer = window.setTimeout(() => {
    if (recorder.state === "recording") recorder.stop();
  }, 11000);
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onerror = () => {
    clearTimeout(timer);
    release();
    const report = !cancelled;
    cancelled = true;
    if (report) onError("Błąd mikrofonu. Spróbuj nagrać ponownie.");
  };
  recorder.onstop = () => {
    clearTimeout(timer);
    release();
    if (!cancelled) onDone(new Blob(chunks, { type: recorder.mimeType }));
  };
  try {
    recorder.start(150);
  } catch (error) {
    clearTimeout(timer);
    release();
    throw error;
  }
  return {
    stop: () => {
      if (recorder.state === "recording") recorder.stop();
    },
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
      if (recorder.state === "recording") recorder.stop();
      release();
    },
  };
}
export function micError(e: unknown) {
  const error = e as Error;
  if (error.name === "NotAllowedError")
    return "Dostęp do mikrofonu został zablokowany. Zezwól na mikrofon w ustawieniach przeglądarki i spróbuj ponownie.";
  if (error.name === "NotFoundError")
    return "Nie znaleziono mikrofonu. Podłącz go albo użyj pliku z nagraniem.";
  return error.message || "Nie udało się uruchomić mikrofonu.";
}
