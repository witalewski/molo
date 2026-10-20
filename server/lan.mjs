import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { X509Certificate, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

export function isPrivateIPv4(address) {
  const parts = address.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
  )
    return false;
  const [a, b] = parts.map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

export function selectLANAddress(interfaces, preferred) {
  const names = Object.keys(interfaces).sort((a, b) => {
    const rank = (name) =>
      name === "en0"
        ? 0
        : name === "en1"
          ? 1
          : /^(en|wl|eth)/.test(name)
            ? 2
            : 3;
    return rank(a) - rank(b);
  });
  const candidates = names
    .flatMap((name) => interfaces[name] ?? [])
    .filter(
      (entry) =>
        entry.family === "IPv4" &&
        !entry.internal &&
        isPrivateIPv4(entry.address),
    );
  const selected = preferred
    ? candidates.find((entry) => entry.address === preferred)
    : candidates[0];
  if (!selected)
    throw new Error(
      "Nie znaleziono prywatnego adresu IPv4. Połącz komputer z Wi-Fi; opcjonalnie ustaw MOLO_LAN_IP na adres aktywnego interfejsu.",
    );
  return selected.address;
}

export function ensureLANCertificates(directory, address, openssl = "openssl") {
  if (!isPrivateIPv4(address))
    throw new Error("Tryb telefonu wymaga prywatnego adresu IPv4.");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const rootKey = path.join(directory, "molo-ca.key");
  const rootCert = path.join(directory, "molo-ca.crt");
  const key = path.join(directory, "molo-server.key");
  const cert = path.join(directory, "molo-server.crt");
  const run = (args) =>
    execFileSync(openssl, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (!fs.existsSync(rootKey) || !fs.existsSync(rootCert)) {
    run([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "1095",
      "-keyout",
      rootKey,
      "-out",
      rootCert,
      "-subj",
      "/CN=Molo Local Wi-Fi CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE,pathlen:0",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    ]);
  }
  const authority = new X509Certificate(fs.readFileSync(rootCert));
  if (Date.parse(authority.validTo) <= Date.now())
    throw new Error(
      "Wygasł lokalny certyfikat CA. Przygotuj nowy katalog .certs i ponownie zainstaluj certyfikat na telefonie.",
    );
  let reusable = false;
  if (fs.existsSync(cert) && fs.existsSync(key)) {
    try {
      const existing = new X509Certificate(fs.readFileSync(cert));
      reusable =
        !!existing.checkIP(address) &&
        existing.verify(authority.publicKey) &&
        Date.parse(existing.validTo) > Date.now() + 86400000;
    } catch {
      /* Regenerate an incomplete or outdated development certificate. */
    }
  }
  if (!reusable) {
    const request = path.join(directory, "molo-server.csr");
    const extensions = path.join(directory, "molo-server.ext");
    fs.writeFileSync(
      extensions,
      `subjectAltName=IP:${address},IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`,
    );
    run([
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-keyout",
      key,
      "-out",
      request,
      "-subj",
      "/CN=Molo Wi-Fi",
    ]);
    run([
      "x509",
      "-req",
      "-in",
      request,
      "-CA",
      rootCert,
      "-CAkey",
      rootKey,
      "-CAcreateserial",
      "-out",
      cert,
      "-days",
      "30",
      "-sha256",
      "-extfile",
      extensions,
    ]);
  }
  fs.chmodSync(rootKey, 0o600);
  fs.chmodSync(key, 0o600);
  return { key, cert, rootCert, fingerprint: authority.fingerprint256 };
}

export function createPhoneSetupServer({
  address,
  httpsPort,
  rootCert,
  fingerprint,
}) {
  if (!isPrivateIPv4(address))
    throw new Error("Niepoprawny adres sieci lokalnej.");
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535)
    throw new Error("Niepoprawny port HTTPS.");
  const certificate = fs.readFileSync(rootCert);
  const der = new X509Certificate(certificate).raw.toString("base64");
  const appURL = `https://${address}:${httpsPort}`;
  const profile = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadContent</key><array><dict><key>PayloadCertificateFileName</key><string>molo-ca.cer</string><key>PayloadContent</key><data>${der}</data><key>PayloadDescription</key><string>Lokalny certyfikat Molo w domowej sieci Wi-Fi.</string><key>PayloadDisplayName</key><string>Molo Local Wi-Fi CA</string><key>PayloadIdentifier</key><string>local.molo.certificate</string><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadUUID</key><string>${randomUUID()}</string><key>PayloadVersion</key><integer>1</integer></dict></array><key>PayloadDisplayName</key><string>Molo Wi-Fi</string><key>PayloadDescription</key><string>Certyfikat HTTPS do lokalnej aplikacji Molo. Instalacja i zaufanie wymagają Twojej decyzji w ustawieniach telefonu.</string><key>PayloadIdentifier</key><string>local.molo.wifi</string><key>PayloadRemovalDisallowed</key><false/><key>PayloadType</key><string>Configuration</string><key>PayloadUUID</key><string>${randomUUID()}</string><key>PayloadVersion</key><integer>1</integer></dict></plist>`;
  const html = `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Molo — dostęp z telefonu</title><style>*{box-sizing:border-box}body{font:16px/1.7 system-ui,sans-serif;background:#faf9f6;color:#254b3d;max-width:700px;padding:28px 22px;margin:auto}h1{line-height:1.25}section{background:white;border:1px solid #dfe6d8;padding:20px;border-radius:14px;margin:20px 0}a{color:#176454}a.button{display:inline-block;background:#176454;color:white;border-radius:10px;padding:12px 16px;text-decoration:none;margin:8px 0}code{overflow-wrap:anywhere}small{font-size:12px;overflow-wrap:anywhere}li{margin-bottom:10px}</style><h1>Molo na twoim telefonie</h1><p>Połącz telefon z tą samą siecią Wi-Fi co komputer. Dostęp do mikrofonu wymaga zaufanego HTTPS, dlatego najpierw zainstaluj lokalny certyfikat Molo.</p><section><h2>iPhone / iPad</h2><ol><li>Otwórz tę stronę w Safari i pobierz profil poniżej.</li><li>W Ustawieniach otwórz pobrany profil i zainstaluj „Molo Wi-Fi” (może być w Ogólne → VPN i zarządzanie urządzeniem).</li><li>Włącz zaufanie do „Molo Local Wi-Fi CA”: Ustawienia → Ogólne → To urządzenie → Ustawienia zaufania certyfikatów.</li></ol><a class="button" href="/molo.mobileconfig">Pobierz profil dla iPhone’a</a><p><a href="https://support.apple.com/pl-pl/102390">Instrukcja Apple dotycząca zaufania do certyfikatu</a></p></section><section><h2>Android</h2><ol><li>Pobierz certyfikat poniżej.</li><li>W Ustawieniach wyszukaj „Zainstaluj certyfikat” i wybierz certyfikat CA. Zainstaluj pobrany plik „molo-ca.crt”.</li><li>Po instalacji otwórz aplikację w Chrome.</li></ol><a class="button" href="/molo-ca.crt">Pobierz certyfikat dla Androida</a><p><a href="https://support.google.com/pixelphone/answer/2844832?hl=pl">Instrukcja Google dotycząca certyfikatów</a></p></section><section><h2>Gotowe? Otwórz Molo</h2><a class="button" href="${appURL}">Przejdź do aplikacji</a><p><code>${appURL}</code></p><p>Zezwól przeglądarce na mikrofon po dotknięciu przycisku nagrywania. Komputer musi być włączony, z uruchomioną aplikacją.</p></section><p>Ten profil zawiera wyłącznie lokalny certyfikat CA. Nie instaluje VPN ani zarządzania telefonem. Klucze prywatne zostają na komputerze. Instalację i zaufanie wykonujesz samodzielnie; po testach certyfikat możesz usunąć z telefonu.</p><small>Odcisk SHA-256 certyfikatu — porównaj z terminalem komputera:<br>${fingerprint}</small></html>`;
  return http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const pathname = new URL(req.url, "http://localhost").pathname;
    let body;
    if (pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      body = html;
    } else if (pathname === "/molo-ca.crt") {
      res.setHeader("Content-Type", "application/x-x509-ca-cert");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="molo-ca.crt"',
      );
      body = certificate;
    } else if (pathname === "/molo.mobileconfig") {
      res.setHeader("Content-Type", "application/x-apple-aspen-config");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="molo.mobileconfig"',
      );
      body = profile;
    } else {
      res.writeHead(404);
      res.end("Nie znaleziono.");
      return;
    }
    res.end(req.method === "HEAD" ? undefined : body);
  });
}
