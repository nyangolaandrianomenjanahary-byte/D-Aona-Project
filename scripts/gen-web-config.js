/* =========================================================
   D-aôna — Génère apps/web/config.js depuis l'environnement
   ---------------------------------------------------------
   Le frontend est statique : il n'a aucun build pour injecter des
   variables (import.meta.env suppose un bundler, lot L8). Ce script
   écrit donc le SEUL fichier de configuration que le navigateur lit,
   avec les valeurs du déploiement.
   
   Exécuté par Vercel (buildCommand de apps/web/vercel.json) :
     D_AONA_PUBLIC_API_URL=https://d-aona-api.onrender.com
     D_AONA_PUBLIC_WS_URL=wss://d-aona-api.onrender.com

   Sans variables, le fichier produit le comportement historique :
   même origine (le serveur Node sert le web et l'API).
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "apps", "web", "config.js");

const apiUrl = (process.env.D_AONA_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
/* wsUrl déduit de apiUrl quand il n'est pas fourni : une seule variable à
   renseigner, et l'erreur « http dans une socket » devient impossible. */
const wsUrl = (process.env.D_AONA_PUBLIC_WS_URL || "").trim().replace(/\/+$/, "")
  || (apiUrl ? apiUrl.replace(/^http/, "ws") : "");

const body = `/* =========================================================
   D-aôna — Configuration de déploiement du frontend
   ---------------------------------------------------------
   GÉNÉRÉ par scripts/gen-web-config.js à partir de :
     D_AONA_PUBLIC_API_URL=${apiUrl || "(vide → même origine)"}
     D_AONA_PUBLIC_WS_URL=${wsUrl || "(vide → déduit de l'API)"}

   Ne pas éditer à la main en production : ce fichier est réécrit à
   chaque build. En local, il reste vide = même origine.
   Aucun secret ne doit figurer ici : ce fichier est public.
   ========================================================= */
window.DAONA_CONFIG = Object.assign({
  apiUrl: ${JSON.stringify(apiUrl)},
  wsUrl: ${JSON.stringify(wsUrl)},
}, window.DAONA_CONFIG || {});
`;

fs.writeFileSync(OUT, body, "utf8");
console.log("OK  apps/web/config.js");
console.log("    apiUrl = " + (apiUrl || "(même origine)"));
console.log("    wsUrl  = " + (wsUrl || "(déduit)"));
