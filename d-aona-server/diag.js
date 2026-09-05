"use strict";
/* Diagnostic réseau : vérifie si le serveur est accessible */
const http = require("http");
const os = require("os");
const fs = require("fs");

function fetchUrl(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve({ status: "OK " + res.statusCode, url });
      res.resume();
    });
    req.on("error", (e) => resolve({ status: "ERREUR: " + e.code, url }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ status: "TIMEOUT", url }); });
  });
}

(async () => {
  const out = [];
  out.push("=== DIAGNOSTIC RESEAU D-AONA ===");
  out.push("");

  const loc = await fetchUrl("http://localhost:8080/");
  out.push("[1] localhost:8080 => " + loc.status);

  const interfaces = os.networkInterfaces();
  out.push("");
  out.push("[2] IPs du PC (a partager avec les telephones) :");
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        const ip = iface.address;
        const r = await fetchUrl("http://" + ip + ":8080/");
        out.push("    - " + name + " : http://" + ip + ":8080 => " + r.status);
      }
    }
  }

  out.push("");
  out.push("[3] Verifications : le serveur ecoute sur 0.0.0.0 (oui).");
  out.push("    Le pare-feu Windows doit autoriser le port 8080.");
  out.push("    Les telephones doivent etre sur le MEME reseau que le PC.");
  out.push("    Avec le hotspot Windows, adresse = 192.168.137.1");
  out.push("");
  out.push("=== FIN DIAGNOSTIC ===");

  fs.writeFileSync("diag_result.txt", out.join("\n"), "utf8");
  console.log(out.join("\n"));
  process.exit(0);
})();