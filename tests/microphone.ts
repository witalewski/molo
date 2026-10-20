import type { Page } from "@playwright/test";
/** A real MediaStream with deterministic audio; never mocks MediaRecorder or ASR. */
export async function installAudioInput(page: Page, fixture: string) {
  await page.route("**/__test__/microphone.wav", (route) =>
    route.fulfill({ path: fixture, contentType: "audio/wav" }),
  );
  await page.addInitScript(() => {
    (window as any).__streams = [];
    (window as any).__captureContexts = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints.audio)
        throw new DOMException("Audio only fixture", "NotFoundError");
      const context = new AudioContext({
        sampleRate: 16000,
        sinkId: { type: "none" },
      } as AudioContextOptions);
      (window as any).__captureContexts.push(context);
      await context.resume();
      const response = await fetch("/__test__/microphone.wav");
      const buffer = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      const source = context.createBufferSource();
      source.buffer = buffer;
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.start(context.currentTime + 0.15);
      (window as any).__streams.push(destination.stream);
      return destination.stream;
    };
  });
}
