import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  selectLANAddress,
  ensureLANCertificates,
  createPhoneSetupServer,
} from "../server/lan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const address = selectLANAddress(
  os.networkInterfaces(),
  process.env.MOLO_LAN_IP,
);
const httpsPort = Number(process.env.MOLO_PHONE_PORT || 8443);
const setupPort = Number(process.env.MOLO_SETUP_PORT || 4174);
if (
  ![httpsPort, setupPort].every(
    (port) => Number.isInteger(port) && port >= 1024 && port <= 65535,
  ) ||
  httpsPort === setupPort
)
  throw new Error("Wybierz dwa różne porty w zakresie 1024–65535.");
const build = spawnSync("npm", ["run", "build"], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status || 1);
const certificates = ensureLANCertificates(
  path.join(root, ".certs"),
  address,
  process.env.OPENSSL_BIN || "openssl",
);
const setup = createPhoneSetupServer({
  address,
  httpsPort,
  rootCert: certificates.rootCert,
  fingerprint: certificates.fingerprint,
});
await new Promise((resolve, reject) => {
  setup.once("error", reject);
  setup.listen(setupPort, address, resolve);
});
console.log(`\nKonfiguracja telefonu: http://${address}:${setupPort}`);
console.log(
  `Aplikacja po instalacji certyfikatu: https://${address}:${httpsPort}`,
);
console.log(`SHA-256 lokalnego CA: ${certificates.fingerprint}\n`);
process.env.NODE_ENV = "production";
process.env.MOLO_HOST = address;
process.env.PORT = String(httpsPort);
process.env.MOLO_TLS_KEY = certificates.key;
process.env.MOLO_TLS_CERT = certificates.cert;
await import("../server/index.mjs");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => setup.close());
