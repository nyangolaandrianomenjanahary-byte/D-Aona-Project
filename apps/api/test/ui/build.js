/* Assemble les morceaux de test/ui/parts/ en test_ui_scenarios.js (ordre explicite).
   Le harnais livre reste a la racine : npm test l appelle par ce chemin. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const PARTS_DIR = path.join(__dirname, "parts");
const OUT = path.join(__dirname, "..", "..", "test_ui_scenarios.js");
const PARTS = ["_p1.js", "_p2.js", "_p3.js", "_p4.js", "_p5.js", "_p6.js", "_p7.js",
               "_p8.js", "_p9.js", "_p10.js", "_p11.js", "_p12.js", "_p13.js", "_p14.js"];
const out = [];
for (const p of PARTS) {
  const file = path.join(PARTS_DIR, p);
  if (!fs.existsSync(file)) throw new Error("morceau manquant : " + file);
  const t = fs.readFileSync(file, "utf8").replace(/\s+$/, "");
  if (!t.trim()) throw new Error("morceau vide : " + file);
  out.push(t);
}
const text = out.join("\r\n\r\n") + "\r\n";
fs.writeFileSync(OUT, text, "utf8");
const L2 = text.split(/\r?\n/);
console.log("Assemble : " + L2.length + " lignes -> " + OUT);
const fns = L2.map((l, i) => [i + 1, l]).filter(([, l]) => /^(async function|const SCENARIOS|\(async )/.test(l));
for (const [n, l] of fns) console.log("  " + String(n).padStart(5) + ": " + l.slice(0, 64));