/* =========================================================
   D-aôna — Base de données : point d'entrée et câblage (SQLite)
   ---------------------------------------------------------
   Le module est découpé par responsabilité (dossier db/) :
     · db/core.js   — la connexion (chemin, ouverture, PRAGMA) ;
     · db/schema.js — l'amorçage du schéma (CREATE/ALTER tolérants) ;
     · db/stores.js — les magasins métier (User, Wallet, Chat…).
   Ce fichier n'est QUE le câblage : il conserve la MÊME surface publique
   qu'avant le découpage — aucun require("./db") n'a besoin de changer.
   ========================================================= */
"use strict";

const { db } = require("./db/core");
const schema = require("./db/schema");
const stores = require("./db/stores");

schema.init();

/* ---------- Migrations versionnées ----------
   Le schéma hérité ci-dessus est conservé tel quel (il utilise des
   ALTER TABLE tolérants aux relances). Toute NOUVELLE évolution du schéma
   passe en revanche par un fichier versionné dans migrations/, appliqué
   ici au démarrage : la base ne peut plus être modifiée « à la main ».
   Une migration en échec interrompt le démarrage plutôt que de laisser
   tourner le serveur sur un schéma incohérent. */
require("./migrate").runMigrations(db);

module.exports = { db, ...stores };
