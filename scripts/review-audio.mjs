/** Local read-only comparison of the staged bank with the current lesson audio. */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
const root = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    bank: { type: "string", default: "models/higgs-mlx-candidate" },
    port: { type: "string", default: "4175" },
  },
});
const bank = path.resolve(root, values.bank);
const deployed = JSON.parse(
  fs.readFileSync(path.join(root, "public/audio/provenance.json")),
);
const candidate = JSON.parse(
  fs.readFileSync(path.join(bank, "provenance.json")),
);
const inUse =
  deployed.status === "in-use" &&
  deployed.standardSha256 === candidate.standardSha256;
const backupFile = path.join(root, "models/audio-backups/latest.json");
const previous =
  inUse && fs.existsSync(backupFile)
    ? path.join(JSON.parse(fs.readFileSync(backupFile)).backup, "audio")
    : path.join(root, "public/audio");
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Invalid preview port");
const phrases = JSON.parse(
  fs.readFileSync(path.join(root, "src/course.json")),
).flatMap((l) => l.phrases);
const ids = new Set(phrases.map((p) => p.id));
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const app = express();
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
for (const [route, directory] of [
  ["current", previous],
  ["candidate", path.join(bank, "audio")],
]) {
  app.get(`/${route}/:id.wav`, (req, res) => {
    if (!ids.has(req.params.id)) return res.sendStatus(404);
    res
      .type("audio/wav")
      .sendFile(path.join(directory, `${req.params.id}.wav`));
  });
}
app.get("/", (_req, res) => {
  const reportFile = path.join(bank, "audit.json");
  const report = fs.existsSync(reportFile)
    ? JSON.parse(fs.readFileSync(reportFile))
    : { results: [] };
  const rows = new Map(
    report.results.filter((r) => r.kind === "primary").map((r) => [r.id, r]),
  );
  const matched = [...rows.values()].filter(
    (r) => r.checks.transcriptMatches,
  ).length;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bank, "provenance.json")),
  );
  const cards = phrases
    .map((p) => {
      const row = rows.get(p.id);
      return `<article><h2>${escape(p.xh)}</h2><p>${escape(p.pl)}</p><div class="players"><label>${inUse ? "Poprzedni zestaw (kopia)" : "Obecne w aplikacji"}<audio controls preload="none" src="/current/${p.id}.wav"></audio></label><label>${inUse ? "Nowy zestaw — używany w lekcjach" : "Nowy zestaw próbny"}<audio controls preload="none" src="/candidate/${p.id}.wav"></audio></label></div><p class="transcript">Surowa transkrypcja: <strong>${escape(row?.transcript || "—")}</strong></p><p class="${row?.checks.transcriptMatches ? "match" : "review"}">${row ? (row.checks.transcriptMatches ? "Tekst zgodny w kontroli automatycznej" : "Rozbieżność — wymaga odsłuchu") : "Audyt w przygotowaniu"}</p></article>`;
    })
    .join("");
  res
    .type("html")
    .send(
      `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Molo — porównanie nagrań</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#18352c;background:#f4f7f3;margin:0}main{max-width:960px;margin:auto;padding:28px 20px}h1{font-size:30px;line-height:1.2}header{margin-bottom:28px}article{padding:20px;margin:16px 0;border:1px solid #d3ded5;border-radius:14px;background:white}h2{margin:0;font-size:23px}article>p{margin:6px 0 14px;color:#496050}.players{display:grid;grid-template-columns:1fr 1fr;gap:24px}label{font-weight:600}audio{display:block;width:100%;margin:8px 0}.transcript{font-size:14px}.review{color:#8b5316!important}.match{color:#236549!important}small{color:#496050}@media(max-width:640px){.players{grid-template-columns:1fr;gap:12px}main{padding:18px 12px}article{padding:16px}}</style><main><header><h1>Porównaj wszystkie 32 nagrania</h1><p>Nowy zestaw: ${escape(manifest.model)}. Jeden stały głos i jedna procedura generowania.</p><p>Zgodna surowa transkrypcja: ${matched}/${rows.size || 32}. Rozbieżność może być błędem rozpoznawania. Zgodny tekst nie potwierdza poprawności mlasków, tonów ani akcentu.</p><small>Ta strona służy odsłuchowi. Nie zmienia nagrań używanych przez lekcje.</small></header>${cards}</main><script>document.addEventListener('play',e=>{if(e.target instanceof HTMLAudioElement)document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true)</script></html>`,
    );
});
app.listen(port, "127.0.0.1", () =>
  console.log(`Audio comparison: http://127.0.0.1:${port}`),
);
