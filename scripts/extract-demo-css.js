/* =========================================================
   D-aôna — Extraction et scoping du CSS de la MAQUETTE
   ---------------------------------------------------------
   Le CSS de la référence (≈ 104 Ko, 170 classes) est la seule source possible
   d'une fidélité au pixel. Il est minifié dans le bundle, sous un unique
   `<style rel="stylesheet">`.

   Ce script l'extrait et le SCOPÉ sous `#admin-root`, parce que la maquette
   définit des noms GLOBAUX qui entrent en collision avec la feuille de
   l'application (`.panel` ×24, `.status` ×82, `.btn` ×55, `.badge` ×22) :
   sans scope, l'importer repeindrait l'accueil, le profil et le plateau.

   Transformations appliquées :
     :root                      → #admin-root          (les jetons deviennent locaux)
     :root[data-theme=dark]     → html[data-theme="night"] #admin-root
     html, body                 → #admin-root          (la maquette est une page)
     *                          → #admin-root *
     .x   ...                   → #admin-root .x       (chaque sélecteur d'une liste)
   Conservés tels quels : @font-face, @keyframes, @media (dont on scope
   l'INTÉRIEUR), @supports.

   Les polices ne sont pas recopiées : la maquette embarque Roboto en base64
   (≈ 40 Ko). L'application utilise déjà Roboto dans sa pile système — vérifié
   côté rendu par la mesure, pas supposé.

   Usage : node scripts/extract-demo-css.js
   Sortie : D-aona/d-aona-web/admin/admin.demo.css
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const DEMO = path.join(__dirname, "..", "reference", "D-aona-Administration.html");
const OUT = path.join(__dirname, "..", "apps", "web", "admin", "admin.demo.css");
const SCOPE = "#admin-root";

const html = fs.readFileSync(DEMO, "utf8");

/* ---------- 1. Extraire le bloc <style> ---------- */
const open = html.search(/<style[^>]*>/i);
if (open < 0) { console.error("aucun <style> dans la maquette"); process.exit(2); }
const bodyStart = html.indexOf(">", open) + 1;
const close = html.toLowerCase().indexOf("</style>", bodyStart);
if (close < 0) { console.error("</style> introuvable"); process.exit(2); }
let css = html.slice(bodyStart, close);

/* On retire les @font-face : ils embarquent Roboto en base64 (≈ 40 Ko de
   données binaires). La famille est déjà disponible dans l'application ; la
   garder doublerait le poids de la feuille pour un rendu identique. */
css = css.replace(/@font-face\s*\{[^}]*\}/g, "");

/* ---------- 2. Découper en règles de premier niveau ---------- */
/* Un découpage naïf sur « } » casserait les @media imbriqués : on suit la
   profondeur des accolades en ignorant ce qui est entre guillemets. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { out.push(text.slice(start, i + 1)); start = i + 1; }
    }
  }
  if (start < text.length) {
    const tail = text.slice(start).trim();
    if (tail) out.push(tail);
  }
  return out;
}

/* ---------- 3. Scoper un sélecteur ---------- */
function scopeSelector(sel) {
  const s = sel.trim();
  if (!s) return s;
  /* Le jeton `:root` devient la racine scopée. */
  if (/^:root\b/.test(s)) {
    const rest = s.replace(/^:root/, "");
    /* `:root[data-theme=dark]` → thème NUIT de l'application. */
    if (/^\[data-theme=["']?dark["']?\]/.test(rest)) {
      return `html[data-theme="night"] ${SCOPE}` + rest.replace(/^\[data-theme=["']?dark["']?\]/, "");
    }
    return SCOPE + rest;
  }
  /* `html` et `body` désignent la page de la maquette : ici, notre racine. */
  if (/^(html|body)$/.test(s)) return SCOPE;
  if (/^html\s+body$/.test(s)) return SCOPE;
  if (/^\*$/.test(s)) return `${SCOPE} *`;
  /* Déjà scopé : on n'empile pas. */
  if (s.startsWith(SCOPE)) return s;
  /* Une règle commençant par html[data-theme…] (thème) reste un ancêtre. */
  if (/^html\[/.test(s)) return s.replace(/^html/, "html") + ` ${SCOPE}`.replace(SCOPE, "");
  return `${SCOPE} ${s}`;
}

function scopeSelectorList(list) {
  return list.split(",").map(scopeSelector).join(",");
}

/* ---------- 4. Traiter chaque règle ---------- */
const kept = [];
let rules = 0;
let atRules = 0;

for (const chunk of splitTopLevel(css)) {
  const braceAt = chunk.indexOf("{");
  if (braceAt < 0) { continue; }
  const head = chunk.slice(0, braceAt).trim();
  const body = chunk.slice(braceAt);
  if (!head) continue;

  if (head.startsWith("@")) {
    atRules++;
    /* @media / @supports : on scope l'INTÉRIEUR, on garde la condition. */
    if (/^@(media|supports)\b/.test(head)) {
      const inner = body.slice(1, body.lastIndexOf("}"));
      const innerRules = splitTopLevel(inner).map((r) => {
        const b = r.indexOf("{");
        if (b < 0) return r;
        const h = scopeSelectorList(r.slice(0, b));
        return h + r.slice(b);
      }).join("");
      kept.push(`${head}{${innerRules}}`);
      continue;
    }
    /* @keyframes et autres : intacts (ils ne portent aucun sélecteur de page). */
    kept.push(chunk);
    continue;
  }

  rules++;
  kept.push(scopeSelectorList(head) + body);
}

const header = `/* =========================================================
   D-aona — Feuille de la MAQUETTE de reference, scopee (GENERE)
   ---------------------------------------------------------
   Source : reference/D-aona-Administration.html (SHA-256 verrouille)
   Genere par : scripts/extract-demo-css.js — NE PAS EDITER A LA MAIN.

   Tout est prefixe par ${SCOPE} : la maquette definit des noms globaux
   (.panel, .btn, .status, .badge) qui collisionnent avec la feuille de
   l'application. Ce fichier est la seule facon d'obtenir une fidelite au
   pixel sans repeindre le reste du produit.

   Les @font-face ne sont pas recopies (Roboto deja disponible).
   ========================================================= */

`;

fs.writeFileSync(OUT, header + kept.join("\n"), "utf8");

/* ---------- 5. Contrôles de non-fuite ---------- */
const written = fs.readFileSync(OUT, "utf8");
const leaks = [];
const bare = written.split("\n").filter((l) => /^\./.test(l.trim()));
if (bare.length) leaks.push(`${bare.length} regle(s) commencant par un point (non scopee)`);
const bareTags = written.split("\n").filter((l) => /^(html|body|table|input|button|svg|a|p|h1|h2|h3)\b\s*[,{]/.test(l.trim()));
if (bareTags.length) leaks.push(`${bareTags.length} regle(s) sur une balise nue`);

console.log("CSS de la maquette -> " + OUT);
console.log(`  regles ordinaires : ${rules}`);
console.log(`  at-rules          : ${atRules}`);
console.log(`  octets            : ${Buffer.byteLength(written, "utf8")}`);
console.log(leaks.length ? "  ATTENTION : " + leaks.join(" · ") : "  scope : aucune fuite detectee");
if (leaks.length) process.exit(1);
