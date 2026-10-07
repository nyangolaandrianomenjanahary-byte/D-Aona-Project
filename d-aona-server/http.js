/* =========================================================
   D-aôna — Utilitaires HTTP : fichiers statiques (anti-traversée),
   corps borné, IP cliente, jetons Bearer, limitation de débit,
   réponses JSON.
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Auth = require("./auth");

const ROOT = path.resolve(__dirname, "../D-aona/d-aona-web");

/* ---------- Static file serving ---------- */
const MIME = { ".html":"text/html",".css":"text/css",".js":"application/javascript",
  ".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  /* Le visuel du partenaire est un WebP (`assets/ad/`) : sans ce type déclaré,
     il partait en `application/octet-stream` et l'image ne s'affichait pas. */
  ".webp":"image/webp",
  ".svg":"image/svg+xml",".ico":"image/x-icon",".woff":"font/woff",".woff2":"font/woff2",".txt":"text/plain" };
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/" || urlPath === "/index.html") urlPath = "/index.html";
  // Servir les uploads (avatars) depuis le dossier du serveur
  let filePath;
  if (urlPath.startsWith("/uploads/")) {
    filePath = path.normalize(path.join(__dirname, urlPath));
    if (!filePath.startsWith(path.join(__dirname, "uploads"))) { res.writeHead(403); res.end("Forbidden"); return; }
  } else {
    filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (e, data) => {
      if (e) { res.writeHead(500); res.end("Error"); return; }
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  });
}

/* ---------- REST API ---------- */

/* Adresse réelle du client. Derrière le tunnel Cloudflare (ou tout autre
   proxy), le socket local n'est PAS le client : on lit alors l'en-tête
   transmis — mais UNIQUEMENT si l'exploitant l'autorise explicitement
   (D_AONA_TRUST_PROXY=1). Sans cette précaution, n'importe quel client
   pourrait annoncer une autre IP et contourner la limitation de débit. */
const TRUST_PROXY = process.env.D_AONA_TRUST_PROXY === "1";
function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers["cf-connecting-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0];
    if (fwd && String(fwd).trim()) return String(fwd).trim().slice(0, 64);
  }
  return ((req.socket && req.socket.remoteAddress) || "inconnu").slice(0, 64);
}

function bearerToken(req) {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) return null;
  const raw = header.slice(7).trim();
  return raw || null;
}

/* Résout l'en-tête Authorization en identifiant d'utilisateur, via la base.
   Renvoie null si la session est inconnue, expirée ou révoquée. */
function authMiddleware(req) {
  const raw = bearerToken(req);
  if (!raw) return null;
  const session = Auth.resolveSession(raw);
  return session ? session.userId : null;
}

/* Applique la limitation de débit des routes d'authentification.
   Renvoie true (et répond 429) si le quota de l'IP est épuisé. */
function isRateLimited(req, res) {
  const rl = Auth.rateLimit(clientIp(req));
  if (rl.allowed) return false;
  respond(res, { error: `Trop de tentatives — réessayez dans ${rl.retryAfter} s.` }, 429);
  return true;
}

/* Lecture du corps BORNÉE. Sans limite, un client peut envoyer un flux
   arbitrairement long : la concaténation grossit sans fin et épuise la
   mémoire du serveur — qui héberge aussi les parties en cours, un arrêt
   mémoire coupe donc tous les joueurs. */
function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve) => {
    let data = "";
    let size = 0;
    let ended = false;
    req.on("data", (chunk) => {
      if (ended) return;
      size += chunk.length;
      if (size > maxBytes) {
        ended = true;
        resolve({ __tooLarge: true });
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => { if (!ended) { ended = true; try { resolve(JSON.parse(data)); } catch (e) { resolve({}); } } });
    req.on("error", () => { if (!ended) { ended = true; resolve({}); } });
  });
}
function respond(res, obj, code = 200) {
  /* `no-store` : une réponse d'API (classement, historique) ne doit jamais être
     servie depuis un cache navigateur ou proxy. */
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(obj));
}


module.exports = { serveStatic, clientIp, bearerToken, authMiddleware, isRateLimited, readBody, respond };
