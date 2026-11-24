/* =========================================================
   D-aôna — Administration : accès aux données (rôles, droits, journal, pubs)
   ---------------------------------------------------------
   Toute la SQL de l'espace d'administration est ICI. Le routeur
   (admin/index.js) ne compose que des appels à ces fonctions : une requête
   préparée écrite ailleurs serait invisible à la relecture de sécurité.

   Deux invariants portés par ce fichier :
     1. `can()` refuse TOUJOURS par défaut. Une permission inconnue, un rôle
        inconnu, un module éteint, un joueur sans rôle : refus.
     2. `ensureSeed()` n'écrase JAMAIS un droit existant (INSERT OR IGNORE) :
        un administrateur qui retire « ads.delete » au rôle Marketing ne le
        voit pas revenir au prochain démarrage.
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { db } = require("../db");
const { MODULES, ROLES, ALL_MODULES, isPermission, isCore } = require("./permissions");

/* Chemin du fichier de bannières historique : sert UNIQUEMENT de source de
   reprise pour la première alimentation de la table `ads` (le carrousel lisait
   ce fichier avant l'arrivée du back-office). Absent → on ne copie rien. */
const PUBS_JSON = path.resolve(__dirname, "..", "..", "..", "apps", "web", "assets", "ad", "pubs.json");

/* ---------- Amorçage idempotent ---------- */
function ensureSeed() {
  const insModule = db.prepare("INSERT OR IGNORE INTO admin_modules (id, enabled) VALUES (?, 1)");
  for (const m of ALL_MODULES) insModule.run(m);

  const insRole = db.prepare(
    "INSERT OR IGNORE INTO admin_roles (id, label, description, protected) VALUES (?, ?, ?, ?)"
  );
  const insGrant = db.prepare(
    "INSERT OR IGNORE INTO admin_grants (role_id, module, action, allowed) VALUES (?, ?, ?, ?)"
  );

  for (const [roleId, def] of Object.entries(ROLES)) {
    insRole.run(roleId, def.label, def.description || null, def.protected ? 1 : 0);
    /* Les droits par défaut sont écrits EN ENTIER, y compris les refus : une
       ligne « allowed=0 » explicite dit « ce rôle n'a pas ce droit ici », ce qui
       est plus lisible en base qu'une absence de ligne. */
    for (const mod of ALL_MODULES) {
      const allowed = def.rights === null ? MODULES[mod].actions : (def.rights[mod] || []);
      for (const act of MODULES[mod].actions) insGrant.run(roleId, mod, act, allowed.includes(act) ? 1 : 0);
    }
  }

  seedAdsFromLegacyFile();
}

/* Reprise des bannières du fichier statique : uniquement si la table est vide.
   Les identifiants d'origine (`slug`) sont conservés → une deuxième exécution
   ne crée pas de doublon. */
function seedAdsFromLegacyFile() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM ads").get();
  if (count && count.c > 0) return;
  let pubs = [];
  try {
    const raw = JSON.parse(fs.readFileSync(PUBS_JSON, "utf8"));
    pubs = Array.isArray(raw && raw.pubs) ? raw.pubs : [];
  } catch (e) { return; }
  if (!pubs.length) return;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO ads (slug, titre, image, repli, lien, debut, fin, position, actif, ordre)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'accueil', 1, ?)`
  );
  pubs.forEach((p, i) => {
    if (!p || !p.image) return;
    ins.run(String(p.id || `pub-${i + 1}`).slice(0, 60), String(p.titre || "Publicité").slice(0, 200),
      String(p.image).slice(0, 300), p.repli ? String(p.repli).slice(0, 300) : null,
      p.lien ? String(p.lien).slice(0, 500) : null, p.debut || null, p.fin || null, i);
  });
}

/* ---------- Rôles d'un joueur ---------- */
function rolesOf(userId) {
  if (!userId) return [];
  return db.prepare("SELECT role_id FROM admin_assignments WHERE user_id = ? ORDER BY role_id")
    .all(userId).map((r) => r.role_id);
}

function hasRole(userId, roleId) {
  return rolesOf(userId).includes(roleId);
}

/* Un module peut être ÉTEINT globalement (interrupteur du back-office) : toutes
   ses routes répondent alors 403, quel que soit le rôle — y compris pour un
   super-administrateur, sans quoi l'interrupteur ne servirait à rien. */
function moduleEnabled(module) {
  const row = db.prepare("SELECT enabled FROM admin_modules WHERE id = ?").get(module);
  return !row || !!row.enabled;
}

/* Droit effectif. Toute anomalie vaut refus. */
function can(userId, perm) {
  if (!userId || !isPermission(perm)) return false;
  const [mod, act] = perm.split(".");
  if (!moduleEnabled(mod)) return false;
  const roles = rolesOf(userId);
  if (!roles.length) return false;
  if (roles.includes("super_admin")) return true;
  const ph = roles.map(() => "?").join(",");
  return !!db.prepare(
    `SELECT 1 FROM admin_grants WHERE role_id IN (${ph}) AND module = ? AND action = ? AND allowed = 1`
  ).get(...roles, mod, act);
}

/* Droits effectifs, sous la forme { module: [actions…] } — sert à l'interface
   pour n'afficher que les écrans autorisés (la décision, elle, reste serveur). */
function rightsOf(userId) {
  const out = {};
  for (const m of ALL_MODULES) out[m] = [];
  const roles = rolesOf(userId);
  if (!roles.length) return out;
  if (roles.includes("super_admin")) {
    for (const m of ALL_MODULES) out[m] = MODULES[m].actions.slice();
    return out;
  }
  const ph = roles.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT module, action FROM admin_grants WHERE role_id IN (${ph}) AND allowed = 1`
  ).all(...roles);
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.module}.${r.action}`;
    if (seen.has(key) || !MODULES[r.module]) continue;
    seen.add(key);
    out[r.module].push(r.action);
  }
  for (const m of ALL_MODULES) if (!moduleEnabled(m)) out[m] = [];
  return out;
}

/* ---------- Attribution des rôles ---------- */
function grantRole(userId, roleId, grantedBy = null) {
  db.prepare("INSERT OR IGNORE INTO admin_assignments (user_id, role_id, granted_by) VALUES (?, ?, ?)")
    .run(userId, roleId, grantedBy);
}

function revokeRole(userId, roleId) {
  db.prepare("DELETE FROM admin_assignments WHERE user_id = ? AND role_id = ?").run(userId, roleId);
}

/* Combien de joueurs portent ce rôle — sert à interdire la suppression du
   dernier super-administrateur (sinon plus personne ne peut réparer les droits). */
function countRole(roleId) {
  return db.prepare("SELECT COUNT(*) AS c FROM admin_assignments WHERE role_id = ?").get(roleId).c;
}

function listAssignments() {
  return db.prepare(
    `SELECT a.user_id, a.role_id, a.granted_at, a.granted_by, u.pseudo, u.elo
     FROM admin_assignments a JOIN users u ON u.id = a.user_id
     ORDER BY a.role_id, u.pseudo`
  ).all();
}

/* ---------- Catalogue des rôles et de leurs droits ---------- */
function fullRights() {
  const out = {};
  for (const m of ALL_MODULES) {
    out[m] = {};
    for (const a of MODULES[m].actions) out[m][a] = true;
  }
  return out;
}

function listRoles() {
  const roles = db.prepare("SELECT * FROM admin_roles ORDER BY protected DESC, id").all();
  const grants = db.prepare("SELECT role_id, module, action, allowed FROM admin_grants").all();
  const byRole = new Map();
  for (const g of grants) {
    if (!byRole.has(g.role_id)) byRole.set(g.role_id, {});
    const r = byRole.get(g.role_id);
    if (!r[g.module]) r[g.module] = {};
    r[g.module][g.action] = !!g.allowed;
  }
  const counts = db.prepare("SELECT role_id, COUNT(*) AS c FROM admin_assignments GROUP BY role_id").all();
  const countBy = new Map(counts.map((c) => [c.role_id, c.c]));
  return roles.map((r) => ({
    id: r.id, label: r.label, description: r.description, protected: !!r.protected,
    members: countBy.get(r.id) || 0,
    /* Le rôle protégé affiche tous les droits, quelle que soit la base. */
    rights: r.protected ? fullRights() : (byRole.get(r.id) || {}),
  }));
}

/* Applique une modification de droits. `changes` = [{ module, action, allowed }].
   Renvoie le nombre de lignes réellement modifiées (0 = rien à changer). */
function setGrants(roleId, changes) {
  const up = db.prepare("UPDATE admin_grants SET allowed = ? WHERE role_id = ? AND module = ? AND action = ?");
  let touched = 0;
  for (const c of changes) {
    if (!c || !MODULES[c.module] || !MODULES[c.module].actions.includes(c.action)) continue;
    const r = up.run(c.allowed ? 1 : 0, roleId, c.module, c.action);
    touched += r.changes || 0;
  }
  return touched;
}

function setModuleEnabled(module, enabled) {
  if (!MODULES[module]) return false;
  /* Second verrou, volontairement redondant avec le 409 de la route : un
     script d'exploitation ou un test appelle cette fonction directement, et
     couper « roles » depuis là laisserait le back-office sans moyen de se
     rallumer. La redondance est le prix d'un interrupteur qui ne doit jamais
     pouvoir éteindre la lumière du tableau électrique. */
  if (!enabled && isCore(module)) return false;
  db.prepare(
    "UPDATE admin_modules SET enabled = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(enabled ? 1 : 0, module);
  return true;
}

function listModules() {
  const rows = db.prepare("SELECT id, enabled FROM admin_modules").all();
  const state = new Map(rows.map((r) => [r.id, !!r.enabled]));
  return ALL_MODULES.map((id) => ({
    id, label: MODULES[id].label, desc: MODULES[id].desc || null,
    group: MODULES[id].group || null, core: !!MODULES[id].core,
    actions: MODULES[id].actions, enabled: state.get(id) !== false,
  }));
}

/* ---------- Journal ---------- */
/* `detail` est sérialisé et BORNÉ : un journal qui accepte des objets entiers
   (image, corps de requête) devient un second stockage de données personnelles. */
function audit({ actorId = null, actorPseudo = null, action, target = null, detail = null, ip = null }) {
  let json = null;
  if (detail != null) {
    try { json = JSON.stringify(detail).slice(0, 2000); } catch (e) { json = null; }
  }
  db.prepare(
    "INSERT INTO admin_audit (actor_id, actor_pseudo, action, target, detail_json, ip) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(actorId, actorPseudo, String(action).slice(0, 80),
    target ? String(target).slice(0, 120) : null, json, ip ? String(ip).slice(0, 64) : null);
}

function listAudit(limit = 100) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  return db.prepare("SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?").all(n).map((r) => ({
    id: r.id, at: r.at, actor_id: r.actor_id, actor_pseudo: r.actor_pseudo,
    action: r.action, target: r.target,
    detail: r.detail_json ? JSON.parse(r.detail_json) : null, ip: r.ip,
  }));
}

/* ---------- Publicités ---------- */
const AD_FIELDS = ["titre", "image", "repli", "lien", "debut", "fin", "position", "actif", "ordre"];
/* Emplacements acceptés. `both` = la bannière s'affiche à l'accueil ET dans les
   profils ; c'est une valeur de la BASE, pas un raccourci du client : sans elle,
   publier la même bannière aux deux endroits demanderait deux lignes à garder
   synchronisées à la main. */
const AD_POSITIONS = ["accueil", "profil", "both"];
const adPosition = (v) => (AD_POSITIONS.includes(v) ? v : "accueil");

/* Bannières actives à une date donnée. `debut`/`fin` sont des dates ISO
   (AAAA-MM-JJ) comparées comme des textes : sur ce format, l'ordre
   lexicographique EST l'ordre chronologique — c'est déjà la règle appliquée par
   le client (`pubsActives`), les deux ne peuvent pas diverger. */
function adsActive(position = "accueil", day = null) {
  const d = day || new Date().toISOString().slice(0, 10);
  const pos = position === "profil" ? "profil" : "accueil";
  return db.prepare(
    `SELECT id, slug, titre, image, repli, lien, debut, fin, ordre
     FROM ads
     WHERE actif = 1 AND (position = ? OR position = 'both')
       AND (debut IS NULL OR debut = '' OR debut <= ?)
       AND (fin   IS NULL OR fin   = '' OR fin   >= ?)
     ORDER BY ordre ASC, id ASC`
  ).all(pos, d, d);
}

function adsList() {
  return db.prepare("SELECT * FROM ads ORDER BY position, ordre, id").all()
    .map((r) => ({ ...r, actif: !!r.actif, ordre: r.ordre || 0 }));
}

function adGet(id) {
  const r = db.prepare("SELECT * FROM ads WHERE id = ?").get(id);
  return r ? { ...r, actif: !!r.actif } : null;
}

function adCreate(data, defaultSlug) {
  const slug = String(data.slug || defaultSlug || `pub-${Date.now()}`).toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `pub-${Date.now()}`;
  const info = db.prepare(
    `INSERT INTO ads (slug, titre, image, repli, lien, debut, fin, position, actif, ordre)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(slug, String(data.titre || "").slice(0, 200), String(data.image || "").slice(0, 300),
    data.repli || null, data.lien || null, data.debut || null, data.fin || null,
    adPosition(data.position), data.actif === false ? 0 : 1,
    parseInt(data.ordre, 10) || 0);
  return adGet(info.lastInsertRowid);
}

function adUpdate(id, data) {
  const sets = [];
  const vals = [];
  for (const f of AD_FIELDS) {
    if (!(f in data)) continue;
    sets.push(`${f} = ?`);
    if (f === "actif") vals.push(data.actif ? 1 : 0);
    else if (f === "ordre") vals.push(parseInt(data.ordre, 10) || 0);
    else if (f === "position") vals.push(adPosition(data.position));
    else vals.push(data[f] == null ? null : String(data[f]).slice(0, f === "lien" ? 500 : 300));
  }
  if (!sets.length) return adGet(id);
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE ads SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return adGet(id);
}

function adDelete(id) {
  return (db.prepare("DELETE FROM ads WHERE id = ?").run(id).changes || 0) > 0;
}

module.exports = {
  ensureSeed, rolesOf, hasRole, can, rightsOf, moduleEnabled,
  grantRole, revokeRole, countRole, listAssignments,
  listRoles, fullRights, setGrants, setModuleEnabled, listModules,
  audit, listAudit,
  adsActive, adsList, adGet, adCreate, adUpdate, adDelete,
};
