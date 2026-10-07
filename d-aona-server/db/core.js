/* =========================================================
   D-aôna — Base de données : connexion (SQLite)
   ---------------------------------------------------------
   Chemin, ouverture, PRAGMA. Le reste du module vit dans db.js
   (câblage), db/schema.js (schéma) et db/stores.js (magasins métier).
   ========================================================= */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

/* Chemin de la base. Par défaut : d-aona.db à la racine du serveur
   (comportement historique, inchangé — « .. » car ce fichier vit dans db/).
   D_AONA_DB_PATH permet de pointer ailleurs — utilisé par les campagnes de
   tests pour travailler sur une copie jetable de la base, sans jamais
   écrire dans les données réelles. */
const DB_PATH = process.env.D_AONA_DB_PATH
  ? path.resolve(process.env.D_AONA_DB_PATH)
  : path.join(__dirname, "..", "d-aona.db");
const db = new DatabaseSync(DB_PATH);

/* SQLite n'applique PAS les clés étrangères par défaut : sans cette
   activation, les contraintes REFERENCES et ON DELETE CASCADE des
   nouvelles tables (auth_credentials, sessions) seraient décoratives. */
db.exec("PRAGMA foreign_keys = ON;");

module.exports = { db, DB_PATH };
