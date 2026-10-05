/* Assemble les morceaux _pN.js en test_ui_scenarios.js (ordre explicite). */
"use strict";
const fs = require("node:fs");
const PARTS = ["_p1.js", "_p2.js", "_p3.js", "_p4.js", "_p5.js", "_p6.js",
               "_p7.js", "_p8.js", "_p9.js", "_p10.js", "_p11.js", "_p12.js", "_p13.js", "_p14.js"];
const out = [];
for (const p of PARTS) {
  if (!fs.existsSync(p)) throw new Error("morceau manquant : " + p);
  const t = fs.readFileSync(p, "utf8").replace(/\s+$/, "");
  if (!t.trim()) throw new Error("morceau vide : " + p);
  out.push(t);
}
const text = out.join("\r\n\r\n") + "\r\n";
fs.writeFileSync("test_ui_scenarios.js", text, "utf8");
const L = text.split(/\r?\n/);
console.log("Assemblé : " + L.length + " lignes");
const fns = L.map((l, i) => [i + 1, l]).filter(([, l]) => /^(async function|const SCENARIOS|\(async )/.test(l));
for (const [n, l] of fns) console.log("  " + String(n).padStart(5) + ": " + l.slice(0, 64));