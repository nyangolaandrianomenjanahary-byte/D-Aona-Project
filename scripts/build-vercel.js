"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "D-aona", "d-aona-web");
const OUT = path.join(ROOT, "public");

if (!fs.existsSync(SRC)) {
  console.error("[build-vercel] Source introuvable :", SRC);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let copied = 0;
function copyTree(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || entry.name === "README.md") continue;
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      copied++;
    }
  }
}

copyTree(SRC, OUT);
console.log(`[build-vercel] ${copied} fichier(s) copié(s) vers ${path.relative(ROOT, OUT)}/`);
