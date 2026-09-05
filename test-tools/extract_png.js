// Extrait le PNG embarqué dans plateau_exact.svg
const fs = require("fs");
const svg = fs.readFileSync(
  "d:/Project/D-Aona/Root/D-aona/d-aona-web/assets/board/plateau_exact.svg",
  "utf8"
);
const m = svg.match(/base64,([A-Za-z0-9+/=]+)/);
if (!m) throw new Error("pas de PNG embarqué");
fs.writeFileSync(
  "d:/Project/D-Aona/Root/test-tools/shots/plateau.png",
  Buffer.from(m[1], "base64")
);
console.log("PNG extrait");
