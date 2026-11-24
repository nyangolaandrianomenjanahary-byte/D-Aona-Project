/* =========================================================
   D-aôna — Configuration du backend (lue UNE fois, au démarrage)
   ---------------------------------------------------------
   Tout ce que le serveur apprend de son environnement passe par ici.
   La règle : une variable mal formée arrête le démarrage plutôt que de
   produire un service qui a l'air de tourner (c'est exactement ce qui
   casse un déploiement : le port est bon, mais l'origine autorisée ne
   l'est pas, et personne ne le voit avant le premier joueur).

   Aucune de ces variables n'est obligatoire en mode hôte : les valeurs par
   défaut reproduisent le comportement historique.
   ========================================================= */
"use strict";

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    console.error("Configuration invalide : " + name + "=\"" + raw + "\" (entier attendu).");
    process.exit(1);
  }
  return n;
}

/* Origines autorisées à ouvrir une WebSocket depuis un navigateur.
   En mode hôte (même origine), la liste est vide : seul l'hôte de la requête
   est accepté, comportement historique inchangé.
   En déploiement séparé (frontend Vercel → API Render/Railway), renseigner :
     D_AONA_ALLOWED_ORIGINS=https://d-aona.vercel.app,https://d-aona-git-main.vercel.app
   Sans cette liste, le frontend Vercel est REFUSÉ à la connexion WebSocket :
   le jeu en ligne ne s'ouvrirait pas, alors que le HTTP fonctionnerait. */
const allowedOrigins = (process.env.D_AONA_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const port = int("D_AONA_PORT", int("PORT", 8080));

/* Délai de grâce avant abandon sur déconnexion (ms). */
const graceMs = int("D_AONA_GRACE_MS", 20000);

/* Derrière un proxy de confiance (Render, Railway, Cloudflare) : lit l'IP
   réelle dans X-Forwarded-For / CF-Connecting-IP. SANS ce réglage sur un
   hébergeur, TOUS les joueurs partagent l'IP du proxy : la limitation de
   débit d'authentification (12 tentatives / 300 s) bloque la salle entière. */
const trustProxy = process.env.D_AONA_TRUST_PROXY === "1";

/* Adresse publique de l'API (facultative) : utilisée pour les liens partagés. */
const publicUrl = (process.env.D_AONA_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");

/* Origines à autoriser dans la CSP `connect-src` (HTTP + WS). */
function connectSources() {
  const all = [];
  for (const o of allowedOrigins) {
    all.push(o);
    all.push(o.replace(/^https:/, "wss:").replace(/^http:/, "ws:"));
  }
  if (publicUrl) {
    all.push(publicUrl);
    all.push(publicUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:"));
  }
  return all.join(" ");
}

/* Contrôle de cohérence : un déploiement séparé sans liste d'origines est
   une panne programmée. On le dit à voix haute dans les journaux. */
function check() {
  if (publicUrl && !allowedOrigins.length) {
    console.warn(
      "[config] D_AONA_PUBLIC_API_URL est défini mais D_AONA_ALLOWED_ORIGINS est vide :\n" +
      "         le navigateur sera refusé à la connexion WebSocket."
    );
  }
  return { ok: true };
}

module.exports = {
  port, graceMs, trustProxy, allowedOrigins, publicUrl, connectSources, check,
  nodeEnv: process.env.NODE_ENV || "development",
  version: process.env.D_AONA_VERSION || require("./package.json").version,
};
