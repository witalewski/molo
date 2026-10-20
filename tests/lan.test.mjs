import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import {
  selectLANAddress,
  ensureLANCertificates,
  createPhoneSetupServer,
} from "../server/lan.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "molo-lan-test-"));
let certificates;
before(() => {
  certificates = ensureLANCertificates(directory, "192.168.1.12");
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));

function request(client, options) {
  return new Promise((resolve, reject) => {
    const req = client.get(options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode,
          type: response.headers["content-type"],
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on("error", reject);
  });
}

test("phone address prefers private Wi-Fi IPv4 and avoids public interfaces", () => {
  assert.equal(
    selectLANAddress({
      utun0: [{ family: "IPv4", address: "10.1.2.3", internal: false }],
      en0: [
        { family: "IPv6", address: "2001:db8::1", internal: false },
        { family: "IPv4", address: "192.168.1.12", internal: false },
      ],
    }),
    "192.168.1.12",
  );
  assert.throws(
    () =>
      selectLANAddress({
        en0: [{ family: "IPv4", address: "8.8.8.8", internal: false }],
      }),
    /prywatnego/,
  );
});

test("explicit phone address must belong to a private active interface", () => {
  const interfaces = {
    en0: [{ family: "IPv4", address: "192.168.1.12", internal: false }],
  };
  assert.equal(selectLANAddress(interfaces, "192.168.1.12"), "192.168.1.12");
  assert.throws(() => selectLANAddress(interfaces, "0.0.0.0"));
  assert.throws(() => selectLANAddress(interfaces, "192.168.1.99"));
});

test("IP changes renew the leaf certificate while preserving the trusted CA", () => {
  const original = new X509Certificate(fs.readFileSync(certificates.cert));
  const reused = ensureLANCertificates(directory, "192.168.1.12");
  assert.equal(
    new X509Certificate(fs.readFileSync(reused.cert)).fingerprint256,
    original.fingerprint256,
  );
  const changed = ensureLANCertificates(directory, "192.168.1.99");
  const leaf = new X509Certificate(fs.readFileSync(changed.cert));
  assert.equal(changed.fingerprint, certificates.fingerprint);
  assert.ok(leaf.checkIP("192.168.1.99"));
  assert.equal(leaf.checkIP("192.168.1.12"), undefined);
  assert.ok(
    leaf.verify(
      new X509Certificate(fs.readFileSync(changed.rootCert)).publicKey,
    ),
  );
  assert.equal(fs.statSync(changed.key).mode & 0o777, 0o600);
});

test("phone setup serves public certificates and profiles without exposing private keys", async () => {
  const server = createPhoneSetupServer({
    address: "192.168.1.12",
    httpsPort: 8443,
    rootCert: certificates.rootCert,
    fingerprint: certificates.fingerprint,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const base = { hostname: "127.0.0.1", port: server.address().port };
    const page = await request(http, { ...base, path: "/" });
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("https://192.168.1.12:8443"));
    const certificate = await request(http, { ...base, path: "/molo-ca.crt" });
    assert.equal(certificate.status, 200);
    assert.ok(certificate.body.includes("BEGIN CERTIFICATE"));
    const profile = await request(http, {
      ...base,
      path: "/molo.mobileconfig",
    });
    assert.equal(profile.type, "application/x-apple-aspen-config");
    assert.ok(profile.body.includes("com.apple.security.root"));
    assert.equal(
      (await request(http, { ...base, path: "/.certs/molo-ca.key" })).status,
      404,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("local HTTPS verifies its chain and hostname with the generated CA", async () => {
  const server = https.createServer(
    {
      key: fs.readFileSync(certificates.key),
      cert: fs.readFileSync(certificates.cert),
    },
    (_req, res) => res.end("Molo"),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await request(https, {
      hostname: "127.0.0.1",
      port: server.address().port,
      ca: fs.readFileSync(certificates.rootCert),
    });
    assert.equal(response.status, 200);
    assert.equal(response.body, "Molo");
  } finally {
    server.close();
    await once(server, "close");
  }
});
