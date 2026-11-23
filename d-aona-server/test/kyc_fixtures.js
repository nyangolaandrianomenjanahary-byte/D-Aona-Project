/* =========================================================
   D-aôna — Fixtures partagées des campagnes de test : images KYC et rôle admin
   ---------------------------------------------------------
   Deux besoins identiques dans test_scenarios.js et test_ui_scenarios.js :

     1. produire de VRAIES images (un PNG décodable par un navigateur *et*
        accepté par le contrôle binaire du serveur) pour les deux faces d'une
        carte d'identité — un fichier texte renommé « .png » est justement ce
        que le serveur doit refuser ;
     2. se donner un rôle d'administration sur la COPIE jetable de la base,
        sans passer par un lien d'invitation (qui n'existe pas) : c'est le
        script hôte `admin_grant.js` qui est utilisé, exactement comme
        l'exploitant le ferait.

   Rien ici ne touche la base réelle : les chemins sont fournis par l'appelant
   (dossier temporaire créé par la campagne).
   ========================================================= */
"use strict";

const zlib = require("node:zlib");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/* ---------- CRC-32 (requis par le conteneur PNG) ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------- PNG vrai (RGB 8 bits, sans filtre) ----------
   `decor` dessine deux bandes et un cadre : deux faces différentes doivent
   avoir des OCTETS différents, sinon l'empreinte SHA-256 serait identique et le
   serveur refuserait le dossier (c'est précisément ce que teste « faces
   identiques »). */
function makePng(w, h, [r, g, b], decor = false) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;                                    // filtre « None »
    for (let x = 0; x < w; x++) {
      const bord = decor && (x < 4 || y < 4 || x >= w - 4 || y >= h - 4);
      const bande = decor && y > h / 2;
      raw[o++] = bord ? 30 : (bande ? Math.min(255, r + 60) : r);
      raw[o++] = bord ? 30 : (bande ? Math.min(255, g + 60) : g);
      raw[o++] = bord ? 30 : (bande ? Math.min(255, b + 60) : b);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dataUrl = (buf) => "data:image/png;base64," + buf.toString("base64");

/* Deux faces de tailles DIFFÉRENTES (une carte d'identité photographiée n'est
   jamais deux fois identique) — donc deux empreintes différentes. */
function rectoBuffer() { return makePng(320, 200, [70, 120, 190], true); }
function versoBuffer() { return makePng(320, 190, [200, 150, 70], true); }
/* SELFIE (troisième pièce du dossier) : une image distincte des deux faces —
   le serveur REFUSE un visage identique à la carte (`MEME_IMAGE`), et c'est
   exactement ce que le parcours réel envoie depuis la caméra frontale. */
function visageBuffer() { return makePng(240, 320, [90, 180, 120], true); }
function recto() { return dataUrl(rectoBuffer()); }
function verso() { return dataUrl(versoBuffer()); }
function visage() { return dataUrl(visageBuffer()); }

/* Objet prêt pour Playwright `setInputFiles({ name, mimeType, buffer })`. */
function rectoFile() { return { name: "cin-recto.png", mimeType: "image/png", buffer: rectoBuffer() }; }
function versoFile() { return { name: "cin-verso.png", mimeType: "image/png", buffer: versoBuffer() }; }
function visageFile() { return { name: "selfie.png", mimeType: "image/png", buffer: visageBuffer() }; }

/* ---------- Rôle d'administration sur la copie jetable ----------
   Passe par le script HÔTE (pas par une route HTTP) : c'est le seul chemin
   d'amorçage existant, et le tester ici garantit qu'il fonctionne le jour où
   l'exploitant en a besoin. Le script écrit dans `admin_audit` — la trace existe
   donc aussi pour une attribution faite hors interface. */
function grantAdmin(dbPath, pseudo, role = "super_admin") {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "admin_grant.js"), "grant", pseudo, role], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, D_AONA_DB_PATH: dbPath },
    encoding: "utf8",
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  return { ok: r.status === 0, status: r.status, out };
}

module.exports = {
  makePng, dataUrl, rectoBuffer, versoBuffer, visageBuffer,
  recto, verso, visage, rectoFile, versoFile, visageFile, grantAdmin,
};
