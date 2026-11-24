/* =========================================================
   D-aôna — Trousse visuelle de la MAQUETTE (fidélité au pixel)
   ---------------------------------------------------------
   Objectif : ≤ 0,5 % de pixels différents entre la maquette de référence et le
   back-office livré. Ce seuil n'est atteignable qu'à une condition : produire
   le MÊME balisage, avec les MÊMES classes, sous la MÊME feuille.

   D'où ce fichier. Il ne réinvente rien : il reproduit les primitives de la
   maquette — icônes SVG, avatar, personne, statut, panneau, métrique, tableau,
   onglets, bouton, état vide, fanorona décoratif — telles qu'elles sont
   écrites dans le bundle de référence (déjà extraites, jamais devinées).

   Les noms de classes sont ceux de la maquette (`.panel`, `.metric`,
   `.status`, `.btn`…) et ils sont volontairement NON préfixés : c'est ce qui
   permet à `admin.demo.css` (feuille de la maquette, scopée sous #admin-root)
   de les habiller à l'identique. La feuille de la v2 (`admin.css`, classes
   `a-*`) reste chargée pour LES ÉCRANS PAS ENCORE PORTÉS : les deux jeux de
   classes ne se croisent pas, la migration peut donc se faire écran par écran
   sans jamais casser l'application.
   ========================================================= */

/* ---------- Icônes : les tracés EXACTS de la maquette ---------- */
export const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  flag: '<path d="M4 22V3m0 0c5-4 11 4 16 0v12c-5 4-11-4-16 0"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18m6-18v18M3 3l18 18M21 3 3 21"/>',
  swords: '<path d="m14.5 3 3 3L3 20l1 1L18 6l3-3h-6.5ZM3 3l3 3m6 6 8 8-1 1-8-8M3 3h5L3 8V3Zm12 15 4-4M5 14l5 5"/>',
  trophy: '<path d="M8 21h8m-4-5v5M7 3h10v6a5 5 0 0 1-10 0V3Zm0 2H4a2 2 0 0 0-2 2v1a4 4 0 0 0 5 4m10-7h3a2 2 0 0 1 2 2v1a4 4 0 0 1-5 4"/>',
  chart: '<path d="M3 3v18h18M7 14l4-4 4 3 6-8"/>',
  wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6m18 6h-5v6h5"/><path d="M16 15h.01"/>',
  out: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3Zm4 4 1 6h3l-1-5M3 9v7"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2"/>',
  settings: '<path d="m9 3 1-1h4l1 3 3 1 3 1v4l-2 2 1 3-2 3-3-1-3 3H9l-1-3-3-1-2-3 2-3V9l3-1 1-5Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  external: '<path d="M15 3h6v6m0-6L10 14m0-11H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5m-5-1a8 8 0 0 1 13-6l3 3M4 16l3 3a8 8 0 0 0 13-6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8m-8 4h5"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m7 4 14 8-14 8V4Z"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
};

export function icon(name, size = 18) {
  const path = ICONS[name] || ICONS.grid;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
    + `stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/* Plateau décoratif de la marque (même tracé que la maquette). */
export function fanorona(large = false) {
  let d = "";
  for (let a = 0; a < 5; a++) d += `<path d="M12 ${12 + a * 19}H164"/>`;
  for (let a = 0; a < 9; a++) d += `<path d="M${12 + a * 19} 12V88"/>`;
  for (let a = 0; a < 4; a++) for (let n = 0; n < 8; n++) if ((n + a) % 2 === 0) d += `<path d="M${12 + n * 19} ${12 + a * 19}l19 19m0-19-19 19"/>`;
  return `<svg class="fanorona ${large ? "large" : ""}" viewBox="0 0 176 100" fill="none" aria-hidden="true">`
    + `<g stroke="currentColor" stroke-width="${large ? ".8" : "1.5"}" opacity="${large ? ".75" : ".85"}">${d}</g>`
    + `<g fill="currentColor"><circle cx="31" cy="31" r="5"/><circle cx="69" cy="50" r="5"/><circle cx="126" cy="31" r="5"/></g>`
    + `<g fill="var(--surface)"><circle cx="50" cy="69" r="5" stroke="currentColor" stroke-width="2"/>`
    + `<circle cx="145" cy="69" r="5" stroke="currentColor" stroke-width="2"/></g></svg>`;
}

/* ---------- Échappement et formats ---------- */
export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const money = (n) => Number(n || 0).toLocaleString("fr-FR") + " Ar";
export const num = (n) => Number(n || 0).toLocaleString("fr-FR");

/* Dates : la maquette affiche jour + heure en français, dans le fuseau du poste. */
export function fmtDate(v, withTime = false) {
  const raw = String(v || "").trim();
  if (!raw) return "—";
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return withTime
    ? d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR");
}

/* ---------- Primitives ---------- */
export const avatar = (person, extra = "") => person
  ? `<span class="avatar ${extra}" style="--hue:${person.hue == null ? 0 : person.hue}" aria-hidden="true">`
    + `${esc(String(person.pseudo || "").replace(/^Demo/, "").slice(0, 2).toUpperCase())}</span>`
  : '<span class="avatar">—</span>';

export const person = (p, sub = "") =>
  `<div class="person">${avatar(p)}<div><strong>${esc((p && p.pseudo) || "Joueur inconnu")}</strong>`
  + `<span>${esc(sub || (p && p.city) || "")}</span></div></div>`;

export function status(text, kind = "neutral", dot = true) {
  return `<span class="status ${kind}">${dot ? '<span class="status-dot"></span>' : ""}${esc(text)}</span>`;
}

export function metric(label, value, caption) {
  return `<div class="metric"><span class="metric-label">${esc(label)}</span>`
    + `<strong class="metric-value">${esc(value)}</strong>`
    + `<span class="metric-caption">${esc(caption || "")}</span></div>`;
}

export const metrics = (items) =>
  `<div class="metrics" style="--count:${items.length}">${items.join("")}</div>`;

/* Panneau : structure RELEVÉE dans la maquette.
   Deux détails qui décident de plusieurs pixels :
     · le corps est enveloppé dans `.panel-body` SAUF pour les tableaux, listes
       et files, qui sont enfants DIRECTS du panneau (`bare`) ;
     · `.panel-foot` est un FRÈRE du panneau, pas un enfant — c'est ainsi que la
       maquette empile `chart` puis `panel-foot` dans la colonne principale. */
export function panel(title, body = "", opts = {}) {
  const { actions = "", desc = "", foot = "", bare = false } = opts;
  /* Un panneau SANS titre n'a pas d'en-tête : la maquette pose alors son
     contenu (tableau, liste, file) en premier enfant. */
  const head = (title || actions || desc)
    ? `<div class="panel-head"><div><h2>${esc(title)}</h2>${desc ? `<p>${esc(desc)}</p>` : ""}</div>`
      + `${actions ? `<div class="row">${actions}</div>` : ""}</div>`
    : "";
  const inner = body ? (bare ? body : `<div class="panel-body">${body}</div>`) : "";
  const section = `<section class="panel">${head}${inner}</section>`;
  return foot ? section + `<div class="panel-foot">${foot}</div>` : section;
}

/* Date courte de la maquette : « 02 nov., 08:30 ». */
export function fmtShort(v) {
  const raw = String(v || "").trim();
  if (!raw) return "—";
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) + ", "
    + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function button(label, kind = "", action = "", id = "", ico = "") {
  return `<button type="button" class="btn ${kind}"`
    + (action ? ` data-action="${esc(action)}"` : "")
    + (id ? ` data-id="${esc(id)}"` : "") + `>`
    + (ico ? icon(ico, 16) : "") + esc(label) + `</button>`;
}

export function empty(title, text, extra = "") {
  return `<div class="empty"><span class="empty-icon">${icon("search", 25)}</span>`
    + `<h3>${esc(title)}</h3><p>${esc(text)}</p>${extra}</div>`;
}

export function notice(kind, text) {
  return `<div class="notice ${kind}">${icon(kind === "warning" ? "shield" : "info", 17)}<span>${esc(text)}</span></div>`;
}

/* Tableau : la maquette pose `data-label` sur chaque cellule (colonne repliée
   sur mobile en fiche) et marque les colonnes numériques d'un `#` en tête. */
export function table(caption, head, rows) {
  if (!rows.length) return empty("Aucun résultat", "Cette vue est vide pour le moment.");
  const th = head.map((h) => {
    const label = typeof h === "object" ? h.label : h;
    const isNum = typeof h === "object" ? h.num : String(h).startsWith("#");
    return `<th${isNum ? ' class="num"' : ""}>${esc(String(label).replace(/^#/, ""))}</th>`;
  }).join("");
  const tr = rows.map((cells) => `<tr>${cells.map((c, i) => {
    const raw = typeof c === "object" && c && "html" in c ? c.html : esc(c);
    const isNum = typeof c === "object" && c ? c.num : String(head[i] || "").startsWith("#");
    const label = String(typeof head[i] === "object" ? head[i].label : head[i] || "").replace(/^#/, "");
    return `<td data-label="${esc(label)}"${isNum ? ' class="num"' : ""}>${raw}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><caption class="sr-only">${esc(caption)}</caption>`
    + `<thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/* Onglets : la pastille mobile de la maquette est conservée (`.t-tabs-pill`). */
export function tabs(items, current, attr = "tab") {
  return `<div class="tabs t-tabs" role="tablist">`
    + `<span class="t-tabs-pill" aria-hidden="true"></span>`
    + items.map(([id, label, count]) => `<button type="button" role="tab" `
      + `data-${attr}="${esc(id)}" aria-selected="${id === current ? "true" : "false"}">`
      + `${esc(label)}${count == null ? "" : ` <span class="tab-count">${esc(count)}</span>`}</button>`).join("")
    + `</div>`;
}

/* En-tête de vue : même structure que la maquette (sur-titre, titre, résumé,
   actions à droite). */
export function pageHead(eyebrow, title, sub, actions = "") {
  return `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div>`
    + `<h1>${esc(title)}</h1><p>${esc(sub)}</p></div>`
    + (actions ? `<div class="page-actions">${actions}</div>` : "") + `</div>`;
}

/* Libellés courts de navigation, identiques à ceux de la maquette. */
export const SHORT = {
  overview: "Vue d'ensemble", users: "Joueurs", kyc: "Identités", disputes: "Litiges",
  games: "Jeux & règles", matches: "Parties", tournaments: "Tournois", ranking: "Classement",
  finance: "Portefeuilles", withdrawals: "Retraits", campaigns: "Campagnes",
  roles: "Rôles & accès", modules: "Modules", audit: "Journal d'audit", settings: "Paramètres",
};

/* Icône de module, identique à celle de la maquette. */
export const MODULE_ICON = {
  overview: "grid", users: "users", kyc: "shield", disputes: "flag", games: "board",
  matches: "swords", tournaments: "trophy", ranking: "chart", finance: "wallet",
  withdrawals: "out", campaigns: "megaphone", roles: "key", modules: "layers",
  audit: "history", settings: "settings",
};
