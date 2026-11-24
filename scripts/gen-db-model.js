/* =========================================================
   D-aôna — Générateur du modèle de données
   ---------------------------------------------------------
   Source : la base SQLite réelle (apps/api/d-aona.db).
   Sorties :
     · docs/DATA-MODEL.md                  — dictionnaire lisible
     · supabase/migrations/0001_initial.sql — schéma Postgres + index
     · supabase/migrations/0002_rls.sql     — RLS refus-par-défaut

   Pourquoi un générateur et pas un fichier écrit à la main : le schéma
   SQLite est la seule vérité observable (32 tables, 30 migrations
   cumulatives). Recopier 300 colonnes à la main garantit une dérive. Ici,
   la table, la colonne, le défaut et l'index sortent de `PRAGMA` — seules
   les DÉCISIONS (type cible, clé étrangère, sensibilité, domaine) sont
   écrites dans ce fichier.

   Usage : node scripts/gen-db-model.js [chemin/base.db]
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.join(__dirname, "..");
const DB_PATH = process.argv[2] || path.join(ROOT, "apps", "api", "d-aona.db");
const OUT_DOC = path.join(ROOT, "docs", "DATA-MODEL.md");
const OUT_SQL = path.join(ROOT, "supabase", "migrations", "0001_initial.sql");
const OUT_RLS = path.join(ROOT, "supabase", "migrations", "0002_rls.sql");

const db = new DatabaseSync(DB_PATH, { readOnly: true });

/* ---------- 1. Décisions du modèle ----------
   Elles vivent dans scripts/db-model-map.js : le générateur, l'import et la
   parité partagent les mêmes règles. */
const { DOMAINS, PII, BOOLEANS, DATES, TIMESTAMPS, FK, pgType, pgDefault } = require("./db-model-map");
/* ---------- 2. Introspection ---------- */
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all().map((r) => r.name);

const tableMeta = {};
for (const t of tables) {
  tableMeta[t] = {
    columns: db.prepare(`PRAGMA table_info("${t}")`).all(),
    fksDeclared: db.prepare(`PRAGMA foreign_key_list("${t}")`).all(),
    indexes: db.prepare(`PRAGMA index_list("${t}")`).all().map((ix) => ({
      ...ix,
      cols: db.prepare(`PRAGMA index_info("${ix.name}")`).all().map((c) => c.name),
    })),
    rows: db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c,
  };
}

const domainOf = (t) => {
  for (const [d, defs] of Object.entries(DOMAINS)) if (defs[t]) return d;
  return "Autre";
};
const describe = (t) => {
  for (const defs of Object.values(DOMAINS)) if (defs[t]) return defs[t][0];
  return "";
};

/* ---------- 2bis. Vérification des orphelins ----------
   Une clé étrangère déclarée sur des données qui la violent fait échouer
   l'import. On mesure AVANT d'écrire le schéma : une relation sans orphelin
   devient une contrainte ; une relation qui en a est SIGNALÉE et laissée en
   simple colonne, avec la requête de réparation. Le schéma produit est donc
   toujours chargeable. */
const orphans = [];
const FK_OK = [];
for (const fk of FK) {
  const [t, from, refTable, refCol] = fk;
  if (!tableMeta[t] || !tableMeta[refTable]) { orphans.push({ fk, n: -1, why: "table absente" }); continue; }
  let n = 0;
  try {
    n = db.prepare(
      `SELECT COUNT(*) AS c FROM "${t}" c WHERE c."${from}" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "${refTable}" p WHERE p."${refCol}" = c."${from}")`
    ).get().c;
  } catch (e) { n = -1; }
  if (n === 0) FK_OK.push(fk);
  else orphans.push({ fk, n });
}

/* ---------- 4. Émission SQL ---------- */
const lines = [];
const w = (s = "") => lines.push(s);

w("-- =========================================================");
w("-- D-aôna — Schéma initial Postgres / Supabase");
w("-- ---------------------------------------------------------");
w("-- GÉNÉRÉ par scripts/gen-db-model.js depuis la base SQLite réelle.");
w("-- Ne pas éditer à la main : corriger le générateur, puis régénérer.");
w("--");
w("-- Conventions :");
w("--   · identifiants entiers  -> bigint identity (compatibilité des 452 appels)");
w("--   · horodatages TEXT      -> timestamptz");
w("--   · drapeaux INTEGER 0/1  -> boolean");
w("--   · montants en ARIARY    -> integer (l'ariary n'a pas de sous-unité)");
w("--   · JSON applicatif       -> text (conservé tel quel : le code le sérialise)");
w("-- =========================================================");
w();
w("begin;");
w();

const sortedTables = tables.filter((t) => t !== "schema_migrations");
/* Ordonnancement par dépendances de clés étrangères.
   Un CYCLE existe réellement (users.friends_seen_request_id -> friend_requests
   .id, et friend_requests.from_id -> users.id) : impossible de créer les deux
   tables avec leurs contraintes dans le même ordre. Une contrainte qui pointe
   vers une table pas encore créée est donc DIFFÉRÉE en `alter table` après
   toutes les tables — c'est la seule façon de charger un schéma cyclique. */
const created = new Set();
const pending = sortedTables.slice();
const ordered = [];
const deferredFks = [];
while (pending.length) {
  let placed = false;
  for (let i = 0; i < pending.length; i++) {
    const t = pending[i];
    const deps = FK_OK.filter((f) => f[0] === t && f[2] !== t).map((f) => f[2]);
    if (deps.every((d) => created.has(d) || !sortedTables.includes(d))) {
      ordered.push(t); created.add(t); pending.splice(i, 1); placed = true; break;
    }
  }
  if (!placed) {
    /* Cycle : on crée la première table en différant SES contraintes vers les
       tables absentes. Les autres restent en attente et suivront. */
    const t = pending.shift();
    for (const fk of FK_OK) {
      if (fk[0] !== t || fk[2] === t) continue;
      if (!created.has(fk[2]) && sortedTables.includes(fk[2])) deferredFks.push(fk);
    }
    ordered.push(t); created.add(t);
  }
}

const isDeferred = (fk) => deferredFks.includes(fk);

for (const t of ordered) {
  const meta = tableMeta[t];
  const pkCols = meta.columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  /* Identité automatique UNIQUEMENT si la clé est un entier nommé `id`.
     Cinq tables ont une clé nommée `id` mais de type TEXT (slug) —
     `challenges`, `game_sessions`, `sessions`, `admin_modules`, `admin_roles` :
     les convertir en bigint identity perdrait les valeurs existantes. */
  const pkCol = pkCols.length === 1 ? meta.columns.find((c) => c.name === pkCols[0]) : null;
  const singleIntId = !!pkCol && pkCols[0] === "id" && /INT/i.test(String(pkCol.type || ""));
  const fksOfTable = FK_OK.filter((f) => f[0] === t && !isDeferred(f));

  w(`-- ${domainOf(t)} — ${describe(t)}`);
  w(`create table ${t} (`);
  const colDefs = [];
  for (const c of meta.columns) {
    if (singleIntId && c.name === "id") {
      colDefs.push(`  id bigint generated always as identity primary key`);
      continue;
    }
    let def = `  ${c.name} ${pgType(t, c)}`;
    const d = pgDefault(t, c);
    if (d !== null) def += ` default ${d}`;
    if (c.notnull) def += " not null";
    colDefs.push(def);
  }
  if (pkCols.length && !singleIntId) colDefs.push(`  primary key (${pkCols.join(", ")})`);
  for (const [, from, refTable, refCol, onDelete] of fksOfTable) {
    colDefs.push(`  constraint fk_${t}_${from} foreign key (${from}) references ${refTable} (${refCol}) on delete ${onDelete}`);
  }
  w(colDefs.join(",\n"));
  w(");");
  w();
}

w("-- ---------- Contraintes différées (cycle de dépendance) ----------");
w("-- `users` et `friend_requests` se référencent mutuellement : ces contraintes");
w("-- ne peuvent pas vivre dans le CREATE TABLE, elles arrivent après.");
for (const [t, from, refTable, refCol, onDelete] of deferredFks) {
  w(`alter table ${t} add constraint fk_${t}_${from} foreign key (${from}) references ${refTable} (${refCol}) on delete ${onDelete};`);
}
w();

w("-- ---------- Index déclarés par le schéma SQLite ----------");
for (const t of ordered) {
  for (const ix of tableMeta[t].indexes) {
    if (ix.origin === "pk") continue;
    if (!ix.cols.length) continue;
    const unique = ix.unique ? "unique " : "";
    w(`create ${unique}index ${ix.name} on ${t} (${ix.cols.join(", ")});`);
  }
}
w();

w("-- ---------- Index des clés étrangères ----------");
w("-- Postgres n'indexe PAS les clés étrangères : sans ces index, chaque");
w("-- suppression de compte balaie la table enfant entière.");
const existing = new Set();
for (const t of ordered) for (const ix of tableMeta[t].indexes) if (ix.cols[0]) existing.add(t + "." + ix.cols[0]);
for (const [t, from] of FK_OK) {
  if (existing.has(t + "." + from)) continue;
  w(`create index ix_${t}_${from} on ${t} (${from});`);
}
w();

w("-- ---------- Commentaires (visibles dans le tableau de bord Supabase) ----------");
for (const t of ordered) {
  w(`comment on table ${t} is '${describe(t).replace(/'/g, "''")}';`);
  for (const c of PII[t] || []) w(`comment on column ${t}.${c} is 'Donnée personnelle — accès restreint, jamais exposée en lecture publique.';`);
  for (const c of meta0(t).sensitive || []) w(`comment on column ${t}.${c} is 'Secret — jamais renvoyé par l API.';`);
}
function meta0(t) {
  for (const defs of Object.values(DOMAINS)) if (defs[t]) return { sensitive: defs[t][1] || [] };
  return { sensitive: [] };
}
w();
w("commit;");

fs.mkdirSync(path.dirname(OUT_SQL), { recursive: true });
fs.writeFileSync(OUT_SQL, lines.join("\n") + "\n", "utf8");

/* ---------- 5. RLS ---------- */
const rls = [];
rls.push("-- =========================================================");
rls.push("-- D-aôna — Row Level Security : REFUS PAR DÉFAUT");
rls.push("-- ---------------------------------------------------------");
rls.push("-- GÉNÉRÉ par scripts/gen-db-model.js.");
rls.push("--");
rls.push("-- Principe : le navigateur ne parle JAMAIS à Postgres. Il parle à l API");
rls.push("-- (apps/api), qui utilise une connexion `pg` avec un rôle serveur.");
rls.push("-- La clé `anon` de Supabase est néanmoins publique (elle voyage dans le");
rls.push("-- bundle du frontend pour Supabase Auth) : sans RLS, cette clé suffirait");
rls.push("-- à lire TOUTES les tables. D'où ce verrou : aucune politique = aucun");
rls.push("-- accès pour anon/authenticated, quel que soit le GRANT.");
rls.push("-- =========================================================");
rls.push("");
for (const t of ordered) {
  rls.push(`alter table ${t} enable row level security;`);
  rls.push(`alter table ${t} force row level security;`);
}
rls.push("");
rls.push("-- Aucune politique n'est créée volontairement. Le jour où une table doit");
rls.push("-- être lue directement par le navigateur (temps réel Supabase, par");
rls.push("-- exemple), ajouter UNE politique ciblée ici — jamais un `using (true)`.");
fs.writeFileSync(OUT_RLS, rls.join("\n") + "\n", "utf8");

/* ---------- 6. Documentation ---------- */
const doc = [];
const d = (s = "") => doc.push(s);
const totalRows = ordered.reduce((n, t) => n + tableMeta[t].rows, 0);

d("# Modèle de données — D-aôna");
d();
d("> **Généré** par [scripts/gen-db-model.js](../scripts/gen-db-model.js) depuis la base SQLite");
d("> réelle. Ne pas éditer à la main : corriger le générateur, puis régénérer.");
d("> Schéma cible : Postgres / Supabase — [supabase/migrations/0001_initial.sql](../supabase/migrations/0001_initial.sql).");
d();
d("## 1. Vue d'ensemble");
d();
d(`| Mesure | Valeur |`);
d(`|---|---|`);
d(`| Tables applicatives | ${ordered.length} |`);
d(`| Colonnes | ${ordered.reduce((n, t) => n + tableMeta[t].columns.length, 0)} |`);
d(`| Clés étrangères | ${FK_OK.length} |`);
d(`| Index déclarés | ${ordered.reduce((n, t) => n + tableMeta[t].indexes.filter((i) => i.origin !== "pk").length, 0)} |`);
d(`| Lignes (base actuelle) | ${totalRows} |`);
d();
d("## 2. Domaines");
d();
d("| Domaine | Tables |");
d("|---|---|");
for (const [dom, defs] of Object.entries(DOMAINS)) {
  const list = Object.keys(defs).filter((t) => ordered.includes(t));
  if (list.length) d(`| **${dom}** | ${list.map((t) => "`" + t + "`").join(" · ")} |`);
}
d();
d("## 3. Correspondance des types SQLite → Postgres");
d();
d("| Source SQLite | Cible Postgres | Règle |");
d("|---|---|---|");
d("| `INTEGER PRIMARY KEY AUTOINCREMENT` | `bigint generated always as identity` | conserve les identifiants existants à l'import |");
d("| `INTEGER` | `bigint` | les identifiants restent des entiers : les 452 appels SQL ne changent pas de forme |");
d("| `INTEGER` 0/1 (drapeau) | `boolean` | 13 colonnes listées dans le générateur ; l'import convertit 0/1 |");
d("| `TEXT` horodatage | `timestamptz` | l'import parse ISO 8601 et `YYYY-MM-DD HH:MM:SS` |");
d("| `TEXT DEFAULT (datetime('now'))` | `timestamptz default now()` | — |");
d("| `TEXT` montant | `integer` | **ariary** : pas de sous-unité, jamais de flottant |");
d("| `TEXT` JSON (`*_json`) | `text` | conservé tel quel : le code sérialise et désérialise lui-même |");
d("| `TEXT` chemin de fichier | `text` | remplacé par une URL Supabase Storage (lot L6) |");
d();
d("## 4. Dictionnaire des tables");
d();

for (const dom of Object.keys(DOMAINS)) {
  const list = ordered.filter((t) => domainOf(t) === dom);
  if (!list.length) continue;
  d(`### ${dom}`);
  d();
  for (const t of list) {
    const meta = tableMeta[t];
    const pkCols = meta.columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    d(`#### \`${t}\` — ${meta.rows} ligne(s)`);
    d();
    d(describe(t));
    d();
    d("| Colonne | Type Postgres | Null | Défaut | Rôle |");
    d("|---|---|---|---|---|");
    for (const c of meta.columns) {
      const sensitive = (meta0(t).sensitive || []).includes(c.name);
      const pii = (PII[t] || []).includes(c.name);
      const fk = FK_OK.find((f) => f[0] === t && f[1] === c.name);
      const flags = [];
      if (c.pk) flags.push("PK");
      if (fk) flags.push(`FK → \`${fk[2]}.${fk[3]}\``);
      if (sensitive) flags.push("**secret**");
      if (pii) flags.push("**donnée personnelle**");
      const def = pgDefault(t, c);
      d(`| \`${c.name}\` | \`${pgType(t, c)}\` | ${c.notnull ? "non" : "oui"} | ${def === null ? "—" : "`" + def + "`"} | ${flags.join(" · ") || "—"} |`);
    }
    d();
    if (pkCols.length) d(`**Clé primaire** : ${pkCols.map((c) => "`" + c + "`").join(", ")}`);
    const fks = FK_OK.filter((f) => f[0] === t);
    if (fks.length) {
      d();
      d("**Clés étrangères** :");
      for (const [, from, rt, rc, od] of fks) d(`- \`${from}\` → \`${rt}.${rc}\` — \`on delete ${od}\``);
    }
    const ixs = meta.indexes.filter((i) => i.origin !== "pk" && i.cols.length);
    if (ixs.length) {
      d();
      d("**Index** :");
      for (const ix of ixs) d(`- \`${ix.name}\` sur (${ix.cols.join(", ")})${ix.unique ? " — unique" : ""}`);
    }
    d();
  }
}

d("## 5. Règles de sécurité portées par la base");
d();
d("- **RLS activée et forcée sur les " + ordered.length + " tables, sans aucune politique** :");
d("  le navigateur ne lit jamais Postgres. Seule l'API écrit, avec un rôle serveur.");
d("- **Secrets** : `auth_credentials.password_hash`, `sessions.token_hash` — jamais renvoyés par l'API.");
d("- **Données personnelles** : email, téléphone, nom, date de naissance, chemins KYC — accès restreint,");
d("  aucune lecture publique, aucune écriture dans les journaux.");
d("- **Argent** : montants en ariary entiers ; la somme du grand livre doit égaler le solde");
d("  (vérifié par `scripts/verify-parity.js`).");
d();
d("## 6. Relations écartées (données orphelines)");
d();
if (!orphans.length) {
  d("Aucune : les " + FK_OK.length + " relations déclarées sont vérifiées sans orphelin.");
} else {
  d("Ces relations NE sont PAS des contraintes dans le schéma : des lignes y violent déjà");
  d("la règle. Elles seront activées après nettoyage — jamais en silence.");
  d();
  d("| Relation | Orphelins |");
  d("|---|---|");
  for (const o of orphans) d(`| \`${o.fk[0]}.${o.fk[1]}\` → \`${o.fk[2]}.${o.fk[3]}\` | ${o.n < 0 ? "mesure impossible" : o.n} |`);
}
d();
d("## 7. Ce qui reste à faire sur la base (hors périmètre de ce document)");
d();
d("1. **Import des données** : `scripts/migrate-sqlite-to-pg.js` (ordre des tables, séquences, conversion 0/1).");
d("2. **Parité** : `scripts/verify-parity.js` compare comptes, sommes et contraintes entre les deux bases.");
d("3. **Adapter les appels SQL** : passage synchrone → asynchrone (lot L4), puis bascule de `D_AONA_DB`.");
d("4. **Auth Supabase** : `auth_credentials` et `sessions` deviennent inutiles une fois les JWT en place (lot L7).");

fs.mkdirSync(path.dirname(OUT_DOC), { recursive: true });
fs.writeFileSync(OUT_DOC, doc.join("\n") + "\n", "utf8");

console.log("OK  " + path.relative(ROOT, OUT_SQL) + "  (" + lines.length + " lignes)");
console.log("OK  " + path.relative(ROOT, OUT_RLS) + "  (" + rls.length + " lignes)");
console.log("OK  " + path.relative(ROOT, OUT_DOC) + "  (" + doc.length + " lignes)");
console.log("    tables=" + ordered.length + " colonnes=" + ordered.reduce((n, t) => n + tableMeta[t].columns.length, 0) + " fk=" + FK_OK.length + " lignes=" + totalRows);
if (orphans.length) {
  console.log("\nATTENTION — " + orphans.length + " relation(s) NON contrainte(s) : données orphelines.");
  for (const o of orphans) console.log("  " + o.fk[0] + "." + o.fk[1] + " -> " + o.fk[2] + " : " + o.n + " orphelin(s)");
}
