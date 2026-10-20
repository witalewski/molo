import express from "express";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import {
  loadModel,
  prepareReferences,
  modelsPresent,
  evaluate,
  parseWav,
  MODEL_ID,
  referenceFiles,
} from "./speech.mjs";
const root = path.resolve(import.meta.dirname, "..");
const course = JSON.parse(
  fs.readFileSync(path.join(root, "src/course.json"), "utf8"),
);
const phrases = new Map(course.flatMap((l) => l.phrases).map((p) => [p.id, p]));
const app = express();
app.disable("x-powered-by");
let status = "loading",
  modelError = "",
  busy = false;
async function warmup() {
  if (status === "ready") return;
  try {
    await loadModel();
    await prepareReferences();
    status = "ready";
    modelError = "";
    console.log("Xhosa speech model ready.");
  } catch (e) {
    status = "unavailable";
    modelError = e.message;
  }
}
app.get("/api/health", (_req, res) =>
  res.json({
    status,
    language: "xh-ZA",
    model: MODEL_ID,
    audioReady: course.every((l) =>
      l.phrases.every((p) =>
        referenceFiles(p.id).every((file) => fs.existsSync(file)),
      ),
    ),
    ...(modelError ? { error: modelError } : {}),
  }),
);
app.post(
  "/api/evaluate/:id",
  express.raw({
    type: ["audio/wav", "audio/x-wav", "application/octet-stream"],
    limit: "400kb",
  }),
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    const origin = req.get("origin");
    if (origin && new URL(origin).host !== req.get("host"))
      return res
        .status(403)
        .json({ error: "To nagranie musi pochodzić z aplikacji Molo." });
    const phrase = phrases.get(req.params.id);
    if (!phrase)
      return res.status(404).json({ error: "Nie znaleziono zwrotu." });
    if (status !== "ready")
      return res.status(503).json({
        error:
          status === "loading"
            ? "Model mowy jeszcze się uruchamia. Spróbuj za chwilę."
            : "Model Xhosa jest niedostępny. Uruchom mise run voice.",
      });
    if (busy)
      return res
        .status(429)
        .json({ error: "Trwa analiza innego nagrania. Spróbuj za chwilę." });
    if (!Buffer.isBuffer(req.body))
      return res.status(415).json({ error: "Prześlij nagranie WAV." });
    let samples;
    try {
      samples = parseWav(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    busy = true;
    try {
      res.json(await evaluate(samples, phrase.xh));
    } catch (e) {
      console.error("Speech evaluation:", e.message);
      res.status(500).json({
        error: "Nie udało się przeanalizować nagrania. Spróbuj ponownie.",
      });
    } finally {
      busy = false;
    }
  },
);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Nie znaleziono endpointu." }),
);
app.use((error, _req, res, next) => {
  if (error?.type === "entity.too.large")
    return res.status(413).json({
      error: "Nagranie jest za duże. Maksymalna długość to 12 sekund.",
    });
  if (error) return res.status(500).json({ error: "Wystąpił błąd serwera." });
  next();
});
if (process.env.NODE_ENV === "development") {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root, "dist")));
  app.get(/.*/, (_req, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
}
const port = Number(process.env.PORT || 4173);
const host = process.env.MOLO_HOST || "127.0.0.1";
const tlsKey = process.env.MOLO_TLS_KEY;
const tlsCert = process.env.MOLO_TLS_CERT;
if (Boolean(tlsKey) !== Boolean(tlsCert))
  throw new Error("HTTPS wymaga jednocześnie MOLO_TLS_KEY i MOLO_TLS_CERT.");
const server = tlsKey
  ? https.createServer(
      { key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) },
      app,
    )
  : http.createServer(app);
const protocol = tlsKey ? "https" : "http";
server.listen(port, host, () =>
  console.log(
    `Molo · ${protocol}://${host === "127.0.0.1" ? "localhost" : host}:${port}`,
  ),
);
server.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
void warmup();
const retry = setInterval(() => {
  if (status === "unavailable" && modelsPresent()) {
    status = "loading";
    void warmup();
  }
}, 5000);
retry.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(retry);
    server.close(() => process.exit(0));
  });
