import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "models/xhosa-asr");
fs.mkdirSync(dir, { recursive: true });
const id = "OpenVoiceOS/misterkissi-w2v2-lg-xls-r-300m-xhosa-onnx";
const revision = "280b60187dcee95efc7911a4a9bfcccf9ce8504d";
const info = await fetch(
  `https://huggingface.co/api/models/${id}/revision/${revision}?blobs=true`,
).then((r) => {
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  return r.json();
});
for (const name of [
  "model.onnx",
  "model.onnx.data",
  "vocab.txt",
  "config.json",
]) {
  const file = info.siblings.find((f) => f.rfilename === name);
  const target = path.join(dir, name);
  if (fs.existsSync(target) && fs.statSync(target).size === file.size) {
    console.log("Already present:", name);
    continue;
  }
  console.log("Downloading:", name, Math.round(file.size / 1e6) + " MB");
  const temp = target + ".download";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const offset = fs.existsSync(temp) ? fs.statSync(temp).size : 0;
      if (offset === file.size) break;
      const response = await fetch(
        `https://huggingface.co/${id}/resolve/${info.sha}/${name}`,
        { headers: offset ? { Range: `bytes=${offset}-` } : {} },
      );
      if (!response.ok) throw Error(`Download failed ${response.status}`);
      const append =
        response.status === 206 &&
        response.headers.get("content-range")?.startsWith(`bytes ${offset}-`);
      console.log(
        append
          ? "Resuming from " + Math.round(offset / 1e6) + " MB"
          : "Receiving " + name,
      );
      await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(temp, { flags: append ? "a" : "w" }),
      );
      break;
    } catch (error) {
      console.error("Download attempt " + (attempt + 1) + ": " + error.message);
      if (attempt === 3) throw error;
    }
  }
  if (fs.statSync(temp).size !== file.size)
    throw Error("Invalid size: " + name);
  if (file.lfs) {
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(temp)) hash.update(chunk);
    if (hash.digest("hex") !== file.lfs.sha256)
      throw Error("Invalid SHA256: " + name);
  }
  fs.renameSync(temp, target);
}
fs.writeFileSync(
  path.join(dir, "provenance.json"),
  JSON.stringify(
    { id, revision: info.sha, license: info.cardData.license },
    null,
    2,
  ),
);
if (process.argv.includes("--download-only")) process.exit(0);
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(command + " exited " + code)),
    );
  });
}
await run("uv", ["sync", "--locked"]);
await run("uv", ["run", "--locked", "python", "scripts/generate-audio.py"]);
