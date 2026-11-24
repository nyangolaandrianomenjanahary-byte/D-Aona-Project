/* =========================================================
   D-aôna — Administration v2 : noyau (état, client API, coquille, dialogues)
   ---------------------------------------------------------
   Pourquoi ce module existe : le back-office de la v1 vivait dans le
   mono-fichier `index.html` (1 000 lignes de rendu, 4 000 de CSS). Le porter
   ici, en modules ES chargés à la demande, permet de le remplacer écran par
   écran sans toucher au reste de l'application — et de sortir 6 000 lignes du
   fichier qu'on essaie de vider.

   CE QUI N'EST PAS ICI, ET NE DOIT JAMAIS Y VENIR : la décision d'accès. Ce
   module MASQUE ce que l'appelant ne peut pas faire ; le serveur refuse de
   toute façon chaque route (trois barrières : session, module, droit). Un
   `can()` qui deviendrait une sécurité serait un défaut, pas une fonction.
   ========================================================= */

/* ---------- État ---------- */
import * as uikit from "./admin.uikit.js";
export const S = {
  me: null,          // réponse de /api/admin/me (rôles, permissions, modules)
  view: "overview",  // module affiché
  data: null,        // dernière charge utile de la vue
  busy: false,
  error: null,
  tab: {},           // onglet courant par module
};

const TOKEN = () => { try { return localStorage.getItem("daona_token") || null; } catch (e) { return null; } };

/* ---------- Client HTTP ----------
   Une seule porte vers le serveur. Elle lève une erreur typée (`code`) pour que
   l'appelant puisse réagir au CODE — « MODULE_SOCLE », « ETAT_INVALIDE » — et
   pas à une phrase française qui changera. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || "Erreur");
    this.name = "ApiError";
    this.status = status;
    this.code = code || null;
  }
}

export async function api(path, method = "GET", body = null) {
  const token = TOKEN();
  const opt = { method, headers: { "Content-Type": "application/json" }, cache: "no-store" };
  if (token) opt.headers.Authorization = "Bearer " + token;
  if (body != null) opt.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(path, opt);
  } catch (e) {
    throw new ApiError(0, "RESEAU", "Serveur injoignable. Vérifiez votre connexion.");
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  if (!res.ok) throw new ApiError(res.status, json && json.code, (json && json.error) || "Erreur " + res.status);
  return json || {};
}

/* ---------- Échappement ----------
   Une seule fonction, utilisée par TOUS les rendus. Un back-office qui affiche
   un pseudo non échappé est un XSS stocké : le pseudo vient du joueur. */
export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Formats ---------- */
export const money = (n) => Number(n || 0).toLocaleString("fr-FR") + " Ar";
export const num = (n) => Number(n || 0).toLocaleString("fr-FR");

export function when(v, withTime = true) {
  const raw = String(v || "").trim();
  if (!raw) return "—";
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return withTime
    ? d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR");
}

export function day(v) { return when(v, false); }

/* ---------- Droits (masquage seulement) ---------- */
export const can = (perm) => !!(S.me && (S.me.permissions || []).includes(perm));
export const roles = () => (S.me && S.me.roles) || [];
export const isSuper = () => !!(S.me && S.me.superAdmin);
export const modules = () => (S.me && S.me.modules) || [];

/* ---------- Fragments réutilisables ---------- */
export const tag = (text, kind = "neutral") =>
  `<span class="a-tag ${kind}">${esc(text)}</span>`;

export const metric = (label, value, caption) =>
  `<div class="a-metric"><span class="a-metric-label">${esc(label)}</span>
     <strong class="a-metric-value">${esc(value)}</strong>
     ${caption ? `<span class="a-metric-caption">${esc(caption)}</span>` : ""}</div>`;

export function panel(title, bodyHtml, actionsHtml = "", footHtml = "") {
  return `<section class="a-panel">
    ${title ? `<div class="a-panel-head"><h2>${esc(title)}</h2>
      ${actionsHtml ? `<div class="a-actions">${actionsHtml}</div>` : ""}</div>` : ""}
    <div class="a-panel-body">${bodyHtml}</div>
    ${footHtml ? `<div class="a-panel-foot">${footHtml}</div>` : ""}
  </section>`;
}

/* Tableau. Un en-tête peut être TRIABLE : `{ label, sort: "clé" }` avec l'état
   courant `sort = { key, dir }` (dir +1 croissant, -1 décroissant). Le tri est
   fait par l'appelant sur les données qu'il a chargées — aucune requête de plus,
   et le clic sur l'en-tête recharge la vue avec le nouvel ordre.

   `aria-sort` est posé parce qu'un ordre invisible est un ordre inutilisable au
   lecteur d'écran ; la flèche le double visuellement. */
export function table({ head = [], rows = [], empty = "Aucune donnée.", cls = "", sort = null }) {
  if (!rows.length) return `<div class="a-empty"><span class="a-empty-icon">◌</span>${esc(empty)}</div>`;
  const th = head.map((h) => {
    const isNum = typeof h === "object" && h && h.num;
    const label = typeof h === "object" && h ? h.label : h;
    const key = typeof h === "object" && h ? h.sort : null;
    const cls2 = isNum ? ' class="num"' : "";
    if (!key) return `<th${cls2}>${esc(label)}</th>`;
    const actif = sort && sort.key === key;
    const dir = actif ? sort.dir : 0;
    return `<th${cls2} aria-sort="${actif ? (dir > 0 ? "ascending" : "descending") : "none"}">`
      + `<button type="button" class="a-thsort${actif ? " on" : ""}" data-sort="${esc(key)}"`
      + ` title="Trier par ${esc(label)}">${esc(label)}`
      + `<span class="a-thsort-dir" aria-hidden="true">${actif ? (dir > 0 ? "▲" : "▼") : "↕"}</span>`
      + `</button></th>`;
  }).join("");
  const tr = rows.map((cells) => `<tr>${cells.map((c) => {
    const cell = typeof c === "object" && c && "html" in c ? c.html : esc(c);
    const num = typeof c === "object" && c && c.num;
    const label = typeof c === "object" && c && c.label ? ` data-label="${esc(c.label)}"` : "";
    return `<td${num ? ' class="num"' : ""}${label}>${cell}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="a-table-wrap"><table class="a-table ${cls}">
    <thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

export function tabs(items, current, attr = "tab") {
  return `<div class="a-tabs" role="tablist">${items.map(([id, label, count]) => `
    <button type="button" role="tab" data-${attr}="${esc(id)}"
      aria-selected="${id === current ? "true" : "false"}">${esc(label)}${
      count == null ? "" : ` <span class="a-muted">(${esc(count)})</span>`}</button>`).join("")}</div>`;
}

/* ---------- Notifications ---------- */
/* Le toast s'auto-détruit (5,2 s) et se ferme AUSSI d'un clic : c'est le geste
   qu'on essaie spontanément devant un message qui traîne. Il ne se ferme
   jamais au clic « à côté » — un voile permanent en bas de l'écran n'aurait
   aucun sens, et le toast n'est pas un pop-up bloquant. */
export function toast(message, kind = "") {
  const host = document.querySelector("#admin-root .a-toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "a-toast " + kind;
  el.setAttribute("role", "status");
  el.textContent = message;
  el.onclick = () => el.remove();
  host.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

/* ---------- Dialogue ----------
   `dialog()` sert à TOUT : confirmation ET formulaire. Le formulaire est
   construit par l'appelant ; ce module ne fait que la mécanique (focus,
   annulation, remontée d'erreur sans fermer).

   `critical` : l'action engage quelque chose d'irréversible (suspendre,
   retirer une vérification, refuser un dossier, annuler une partie). Ces
   dialogues EXIGENT un geste explicite : ni clic à côté, ni clic sur le fond
   ne les ferment. Il reste trois sorties volontaires — la croix, « Annuler »
   et Échap — pour qu'on ne s'enferme jamais dans une boîte.

   Un clic DANS la carte ne ferme rien dans les deux cas : la cible est un
   élément interne, jamais `<dialog>` lui-même. */
export function dialog({ title, bodyHtml = "", okLabel = "Valider", danger = false, critical = false, onOk }) {
  const root = document.getElementById("admin-root");
  const el = document.createElement("dialog");
  el.className = "a-dialog";
  el.innerHTML = `<form method="dialog">
    <div class="a-dialog-head"><h2>${esc(title)}</h2>
      <button type="button" class="a-dialog-x" data-x aria-label="Fermer">✕</button></div>
    <div class="a-dialog-body"><p class="a-err" role="alert" hidden></p>${bodyHtml}</div>
    <div class="a-dialog-foot">
      <button type="button" class="a-btn" data-cancel>Annuler</button>
      <button type="submit" class="a-btn ${danger ? "danger" : "primary"}" data-ok>${esc(okLabel)}</button>
    </div></form>`;
  root.appendChild(el);
  const err = el.querySelector(".a-err");
  /* Fermeture IDEMPOTENTE : trois chemins y mènent (croix, Annuler, Échap,
     clic extérieur) et un double appel ne doit ni lever ni laisser un
     écouteur derrière lui. */
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (el.open) el.close();
    el.remove();
  };
  el.querySelector("[data-cancel]").onclick = close;
  el.querySelector("[data-x]").onclick = close;
  el.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  /* Le fond du `<dialog>` modal reçoit le clic sur `<dialog>` lui-même (la
     cible d'un clic dans la carte est toujours un descendant). */
  if (!critical) el.addEventListener("click", (e) => { if (e.target === el) close(); });
  el.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const ok = el.querySelector("[data-ok]");
    const fields = {};
    el.querySelectorAll("[name]").forEach((i) => {
      fields[i.name] = i.type === "checkbox" ? i.checked : i.value;
    });
    ok.disabled = true;
    err.hidden = true;
    try {
      const r = await onOk(fields, el);
      if (r === false) return;              // l'appelant garde la main (erreur de validation)
      close();
    } catch (ex) {
      err.textContent = ex && ex.message ? ex.message : "Échec de l'opération.";
      err.hidden = false;
    } finally {
      ok.disabled = false;
    }
  };
  el.showModal();
  const first = el.querySelector(".a-dialog-body input, .a-dialog-body textarea, .a-dialog-body select");
  if (first) first.focus();
  return el;
}

/* Demande de motif : le geste le plus fréquent du back-office (refuser,
   suspendre, annuler). Un seul endroit, donc un seul comportement — et
   toujours `critical` : ce sont exactement les actions irréversibles. */
export function askReason({ title, question, okLabel = "Confirmer", danger = true, min = 5 }) {
  return new Promise((resolve) => {
    let answered = false;
    dialog({
      title, okLabel, danger, critical: true,
      bodyHtml: `<p class="a-muted" style="margin-bottom:10px">${esc(question)}</p>
        <label class="a-field"><span>Motif (obligatoire)</span>
          <textarea name="reason" rows="3" maxlength="500" required minlength="${min}"
            placeholder="Ce que le joueur lira…"></textarea></label>`,
      onOk: (f) => {
        const reason = String(f.reason || "").trim();
        if (reason.length < min) throw new ApiError(400, "MOTIF_MANQUANT", "Motif trop court.");
        answered = true;
        resolve(reason);
        return true;
      },
    }).addEventListener("close", () => { if (!answered) resolve(null); });
  });
}

/* ---------- Coquille ---------- */
const GROUP_ORDER = ["Pilotage", "Communauté", "Compétition", "Finances", "Configuration"];

/* Libellés courts et icônes de navigation : ceux de la maquette (extraits). */
const SHORT = {
  overview: "Vue d'ensemble", users: "Joueurs", kyc: "Identités", disputes: "Litiges",
  games: "Jeux & règles", matches: "Parties", tournaments: "Tournois", ranking: "Classement",
  finance: "Portefeuilles", withdrawals: "Retraits", campaigns: "Campagnes",
  roles: "Rôles & accès", modules: "Modules", audit: "Journal d'audit", settings: "Paramètres",
};
const MODULE_ICON = {
  overview: "grid", users: "users", kyc: "shield", disputes: "flag", games: "board",
  matches: "swords", tournaments: "trophy", ranking: "chart", finance: "wallet",
  withdrawals: "out", campaigns: "megaphone", roles: "key", modules: "layers",
  audit: "history", settings: "settings",
};

/* Coquille FIDÈLE À LA MAQUETTE.
   Sa mise en page n'est pas une grille : la barre latérale est `position:fixed`
   et la zone principale porte `margin-left:236px` (voir `admin.demo.css`).
   On ajoute donc `demo-shell` sur la racine pour neutraliser la grille de la v2
   — sans quoi le `margin-left` du canvas s'ajouterait à une colonne de 236 px. */
export function renderShell(def, bodyHtml) {
  const root = document.getElementById("admin-root");
  if (!root) return null;
  root.classList.add("demo-shell");

  const mods = modules();
  const groups = new Map();
  for (const m of mods) {
    const g = m.group || "Autres";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(m);
  }
  const order = [...GROUP_ORDER.filter((g) => groups.has(g)),
    ...[...groups.keys()].filter((g) => !GROUP_ORDER.includes(g))];

  const nav = order.map((g) => `<div class="nav-group"><div class="nav-label">${esc(g)}</div>`
    + groups.get(g).map((m) => `<a class="nav-item${S.view === m.id ? " active" : ""}"
        href="#/admin" data-voir="${esc(m.id)}"${S.view === m.id ? ' aria-current="page"' : ""}>
        ${uikit.icon(MODULE_ICON[m.id] || "grid", 16)}<span>${esc(SHORT[m.id] || m.label)}</span>
        ${m.enabled ? "" : '<span class="nav-count">off</span>'}</a>`).join("")
    + `</div>`).join("");

  const night = document.documentElement.dataset.theme === "night";
  const me = S.me || {};
  const roleLabel = (() => {
    const r = (me.roles || [])[0];
    return ({ super_admin: "Super administrateur", admin: "Administrateur",
      moderation: "Modération", finance: "Finance", tournaments: "Responsable tournois",
      marketing: "Marketing", observer: "Observateur" })[r] || "Administrateur";
  })();

  root.innerHTML = `<a class="skip-link" href="#main-content">Aller au contenu</a>
    <div class="mobile-header">
      <button class="icon-btn" data-mobile-toggle aria-label="Ouvrir la navigation" aria-expanded="false">
        <span class="t-icon-swap" data-state="a"><span class="t-icon" data-icon="a">${uikit.icon("menu", 21)}</span><span class="t-icon" data-icon="b">${uikit.icon("close", 21)}</span></span>
      </button>
      <a href="#/admin" class="brand">${uikit.fanorona()}<span class="brand-name">D-aôna</span></a>
      <button class="icon-btn" aria-label="Recherche globale">${uikit.icon("search", 19)}</button>
    </div>
    <div class="mobile-backdrop" data-mobile-toggle></div>
    <aside class="sidebar" id="sidebar" aria-label="Navigation principale">
      <a class="brand" href="#/admin" aria-label="D-aôna, administration">
        ${uikit.fanorona()}
        <div><div class="brand-name">D-aôna</div><span class="brand-sub">Administration</span></div>
      </a>
      <div class="workspace">${uikit.icon("board", 15)}<span>Plateau Madagascar</span><span class="status-dot"></span></div>
      <nav class="nav-scroll">${nav}</nav>
      <div class="sidebar-bottom">
        <button class="text-link sidebar-note"><span class="status-dot"></span>Données de démonstration ${uikit.icon("info", 13)}</button>
        <div class="account">${uikit.avatar({ pseudo: me.pseudo || "Admin", hue: 155 }, "tiny")}
          <div><strong>${esc(me.pseudo || "")}</strong><small>${esc(roleLabel)}</small></div>
          <button class="icon-btn" data-theme-toggle aria-label="Changer de thème" title="Changer de thème">
            <span class="t-icon-swap" data-state="${night ? "b" : "a"}">
              <span class="t-icon" data-icon="a">${uikit.icon("moon", 17)}</span>
              <span class="t-icon" data-icon="b">${uikit.icon("sun", 17)}</span>
            </span>
          </button>
        </div>
      </div>
    </aside>
    <main class="canvas" id="main-content">
      <div id="system-notices"></div>
      <div class="scope-row">
        <span class="scope-label"><span class="status-dot"></span>Administration <span class="muted">/</span>
          <span id="scope-module">${esc(SHORT[def.id] || def.label)}</span></span>
        <div class="row">
          <button class="icon-btn" data-refresh aria-label="Actualiser les données" title="Actualiser">${uikit.icon("refresh", 16)}</button>
        </div>
      </div>
      <div id="view-content" class="view-content">${bodyHtml}</div>
      <footer class="app-footer"><span>${uikit.icon("lock", 12)} Données de démonstration</span><span>D-aôna Administration · Madagascar, UTC+03</span></footer>
    </main>`;

  root.querySelectorAll("[data-voir]").forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); go(a.dataset.voir); };
  });
  root.querySelectorAll("[data-refresh]").forEach((b) => { b.onclick = () => reload(); });
  root.querySelectorAll("[data-theme-toggle]").forEach((b) => {
    b.onclick = () => {
      const next = document.documentElement.dataset.theme === "night" ? "light" : "night";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("daona_theme", next); } catch (e) {}
      renderShell(def, bodyHtml);
      reload();
    };
  });
  root.querySelectorAll("[data-mobile-toggle]").forEach((b) => {
    b.onclick = () => {
      const open = !root.querySelector(".sidebar").classList.contains("open");
      root.querySelector(".sidebar").classList.toggle("open", open);
      root.querySelector(".mobile-backdrop").classList.toggle("open", open);
      const t = root.querySelector('.mobile-header [data-mobile-toggle]');
      if (t) { t.setAttribute("aria-expanded", String(open)); t.querySelector(".t-icon-swap")?.setAttribute("data-state", open ? "b" : "a"); }
    };
  });
  return root.querySelector("#view-content");
}

const ICONS = {};
void ICONS;

/* ---------- Navigation ---------- */
let VIEWS = {};
export function registerViews(map) { VIEWS = map; }
export const views = () => VIEWS;

export async function go(view) {
  const def = VIEWS[view];
  if (!def) return;
  S.view = view;
  if (typeof App !== "undefined" && App && typeof App.setRoute === "function") App.setRoute("admin/" + view);

  /* Le droit est vérifié AVANT de peindre : un écran vide avec un bouton
     inerte est pire qu'un refus annoncé. */
  if (def.perm && !can(def.perm)) {
    renderShell(def, `<div class="a-notice bad">Votre rôle ne donne pas accès à ce module
      (<code>${esc(def.perm)}</code>).</div>`);
    return;
  }
  const body = renderShell(def, `<div class="a-loading">Chargement…</div>`);
  if (!body) return;
  try {
    const data = await def.load();
    /* La vue a pu changer pendant le chargement (double clic) : ne pas écraser
       l'écran courant avec une réponse périmée. */
    if (S.view !== view) return;
    S.data = data;
    const out = def.render(data);
    body.innerHTML = out.html;
    if (out.wire) out.wire(body, data);
    def.headActions && def.headActions(data) && (body.parentElement.querySelector(".a-actions").innerHTML = def.headActions(data));
    if (def.wireHead) def.wireHead(body.parentElement.querySelector(".a-actions"), data);
  } catch (e) {
    if (S.view !== view) return;
    body.innerHTML = e instanceof ApiError && e.status === 403
      ? `<div class="a-notice bad">Accès refusé (${esc(e.code || e.status)}).</div>`
      : `<div class="a-notice bad">${esc(e.message || "Chargement impossible.")}</div>`;
  }
}

/* Rafraîchit la vue courante sans changer d'écran. */
export function reload() { return go(S.view); }

/* ---------- Temps réel ----------
   Le serveur diffuse un SIGNAL `admin_update` (module concerné) aux seules
   sessions porteuses d'un rôle : il ne transporte aucune donnée. Le client
   recharge donc ce qu'il affiche, et les droits sont revérifiés à ce
   moment-là. Un regroupement de 350 ms évite cinq rechargements quand cinq
   commandes partent ensemble. */
let reloadTimer = null;
export function watchLive() {
  if (!window.API || typeof window.API.on !== "function") return;
  window.API.on("admin_update", (msg) => {
    const module = msg && msg.module;
    if (module && module !== S.view) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { if (S.view) reload(); }, 350);
  });
}

/* ---------- Démarrage ---------- */
export async function boot() {
  const root = document.getElementById("admin-root");
  if (!root) return;
  if (!TOKEN()) {
    root.innerHTML = `<div class="a-notice bad">Session requise : reconnectez-vous.</div>`;
    return;
  }
  try {
    /* `me` est la seule réponse dont l'interface a besoin pour savoir quoi
       afficher. Un 401/403 signifie ici « pas d'espace d'administration » :
       ce n'est pas une erreur à montrer, c'est un refus attendu. */
    S.me = await api("/api/admin/me");
  } catch (e) {
    root.innerHTML = `<div class="a-notice bad">Accès refusé : votre compte ne détient
      aucune permission d'administration.</div>`;
    return;
  }
  watchLive();
  /* On ouvre sur le premier module autorisé : imposer « Vue d'ensemble » à un
     rôle Finance qui n'y a pas droit serait une porte fermée en arrivant. */
  const first = modules().find((m) => VIEWS[m.id] && (!VIEWS[m.id].perm || can(VIEWS[m.id].perm)));
  await go(S.view && VIEWS[S.view] && (!VIEWS[S.view].perm || can(VIEWS[S.view].perm))
    ? S.view
    : (first ? first.id : "overview"));
}
