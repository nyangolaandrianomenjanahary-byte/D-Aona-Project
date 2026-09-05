"use strict";
const DATA = require("./data");
const assert = require("node:assert");

/* --- Badges --- */
assert.equal(DATA.badgeFor(1).name, "Remenabila");
assert.equal(DATA.badgeFor(2).name, "Malaso");
assert.equal(DATA.badgeFor(3).name, "Dahalo");
assert.equal(DATA.badgeFor(4).name, "Totakely");
assert.equal(DATA.badgeFor(25).name, "Totakely");
assert.equal(DATA.badgeFor(26).name, "Akofa");
assert.equal(DATA.badgeFor(50).name, "Akofa");
assert.equal(DATA.badgeFor(51).name, "Vary masaka");
assert.equal(DATA.badgeFor(500).name, "Vary masaka");
console.log("✓ Badges: 1→Remenabila, 2→Malaso, 3→Dahalo, 4-25→Totakely, 26-50→Akofa, 51+→Vary masaka");

/* --- 6 provinces --- */
assert.equal(DATA.PROVINCES.length, 6);
console.log("✓ 6 provinces présentes");

/* --- Decay inactivité : −30 Elo / mois après 30 j --- */
const { db, applyInactivityDecay } = require("./db");
// Cas A : 65 jours d'inactivité → 2 mois → −60 Elo
const oldA = new Date(Date.now() - 65 * 86400000).toISOString();
db.prepare("UPDATE users SET last_seen=?, last_decay=NULL WHERE pseudo='SolofoGM'").run(oldA);
const before = db.prepare("SELECT elo FROM users WHERE pseudo='SolofoGM'").get().elo;
const changed = applyInactivityDecay();
const after = db.prepare("SELECT elo FROM users WHERE pseudo='SolofoGM'").get().elo;
console.log(`  SolofoGM: ${before} → ${after} (attendu −60)`);
assert.equal(before - after, 60, "65 j → −60 Elo");
// Cas B : ré-application immédiate → 0 (déjà appliqué)
const changed2 = applyInactivityDecay();
const after2 = db.prepare("SELECT elo FROM users WHERE pseudo='SolofoGM'").get().elo;
assert.equal(after2, after, "pas de double pénalité");
console.log("✓ Pas de double pénalité au 2ᵉ passage");
// Cas C : 20 jours → pas de pénalité
const oldC = new Date(Date.now() - 20 * 86400000).toISOString();
db.prepare("UPDATE users SET last_seen=?, last_decay=NULL WHERE pseudo='RadoTheKing'").run(oldC);
const rkBefore = db.prepare("SELECT elo FROM users WHERE pseudo='RadoTheKing'").get().elo;
applyInactivityDecay();
const rkAfter = db.prepare("SELECT elo FROM users WHERE pseudo='RadoTheKing'").get().elo;
assert.equal(rkBefore, rkAfter, "20 j → 0 pénalité");
console.log("✓ 20 j d'inactivité → aucune pénalité");

/* --- Leaderboard : badge + region exposés --- */
const server = require("node:fs").readFileSync("./server.js", "utf8");
console.log("✓ Tous les tests badges/decay passent");
