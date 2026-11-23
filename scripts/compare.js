/* =========================================================
   D-aôna — Comparateur démo (oracle) ↔ application réelle
   ---------------------------------------------------------
   Lit `reference/REFERENCE-DEMO.json` (produit depuis la démo) et
   `reference/ACTUAL.json` (produit depuis la base réelle), compare champ par
   champ, écrit `reports/compare-seed-AAAA-MM-JJ.md` et **sort en code non nul
   dès qu'un écart BLOQUANT subsiste**.

   Règles de classement (cahier des charges §11.1) :
     · BLOQUANT — montant, solde, réserve, statut, décision, permission,
                  invariant, comptage ;
     · MAJEUR   — comportement, code d'erreur, ordre de workflow, export ;
     · MINEUR   — libellé, formulation, ordre de colonnes secondaires.

   Usage : node scripts/compare.js
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const REF = path.join(__dirname, "..", "reference", "REFERENCE-DEMO.json");
const ACT = path.join(__dirname, "..", "reference", "ACTUAL.json");
const REPORTS = path.join(__dirname, "..", "reports");

for (const f of [REF, ACT]) {
  if (!fs.existsSync(f)) {
    console.error("Fichier manquant : " + f);
    console.error("  → node scripts/export-reference.js  puis  node scripts/export-actual.js");
    process.exit(2);
  }
}
const ref = JSON.parse(fs.readFileSync(REF, "utf8"));
const act = JSON.parse(fs.readFileSync(ACT, "utf8"));

const rows = [];
let blocking = 0;
let major = 0;
let minor = 0;
let compared = 0;

function push(domain, expected, obtained, level, note = "") {
  compared++;
  const same = JSON.stringify(expected) === JSON.stringify(obtained);
  if (same) {
    rows.push({ domain, expected, obtained, level: "—", verdict: "conforme", note });
    return;
  }
  if (level === "BLOQUANT") blocking++;
  else if (level === "MAJEUR") major++;
  else minor++;
  rows.push({ domain, expected, obtained, level, verdict: "ÉCART", note });
}

/* ---------- 1. Comptages du seed (§11.2) ---------- */
const C = ref.seed.counts;
const c = act.seed.counts;
push("Comptes", C.users, c.users, "BLOQUANT");
push("Dossiers KYC — à vérifier", C.kyc.pending, c.kyc.pending, "BLOQUANT");
push("Dossiers KYC — vérifiés", C.kyc.verified, c.kyc.verified, "BLOQUANT");
push("Dossiers KYC — refusés", C.kyc.rejected, c.kyc.rejected, "BLOQUANT");
push("Retraits — en attente", C.withdrawals.pending, c.withdrawals.pending, "BLOQUANT");
push("Retraits — payés", C.withdrawals.paid, c.withdrawals.paid, "BLOQUANT");
push("Litiges — ouverts", C.disputes.open, c.disputes.open, "BLOQUANT");
push("Litiges — en examen", C.disputes.investigating, c.disputes.investigating, "BLOQUANT");
push("Tournois", C.tournaments, c.tournaments, "BLOQUANT");
push("Inscriptions", C.registrations, c.registrations, "BLOQUANT");
push("Écritures du grand livre", C.ledgerEntries, c.ledgerEntries, "BLOQUANT");
push("Réserves actives", C.activeHolds, c.activeHolds, "BLOQUANT");
push("Parties", C.matches, c.matches, "BLOQUANT");
push("Campagnes", C.campaigns, c.campaigns, "BLOQUANT");

/* ---------- 2. Totaux financiers (§11.2) ---------- */
const T = ref.seed.totals;
const t = act.seed.totals;
push("Solde total (Ar)", T.balance, t.balance, "BLOQUANT");
push("Réservé (Ar)", T.reserved, t.reserved, "BLOQUANT");
push("Disponible (Ar)", T.available, t.available, "BLOQUANT");
push("Total crédits (Ar)", T.credits, t.credits, "BLOQUANT");
push("Total débits (Ar)", T.debits, t.debits, "BLOQUANT");
push("Crédits − débits = Σ soldes", T.credits - T.debits, t.credits - t.debits, "BLOQUANT");

/* ---------- 3. Portefeuille par portefeuille (§11.3) ---------- */
const byDemoId = new Map((act.seed.wallets || []).map((w) => [w.demoId, w]));
for (const w of ref.seed.wallets || []) {
  const got = byDemoId.get(w.demoId);
  if (!got) {
    rows.push({ domain: `Portefeuille ${w.demoId}`, expected: "présent", obtained: "absent", level: "BLOQUANT", verdict: "ÉCART", note: "" });
    compared++; blocking++;
    continue;
  }
  push(`Solde ${w.demoId} (${w.pseudo})`, w.balance, got.balance, "BLOQUANT");
  push(`Réservé ${w.demoId}`, w.reserved, got.reserved, "BLOQUANT");
  push(`Disponible ${w.demoId}`, w.available, got.available, "BLOQUANT");
  push(`Elo ${w.demoId}`, w.elo, got.elo, "BLOQUANT");
  push(`Victoires ${w.demoId}`, w.wins, got.wins, "BLOQUANT");
  push(`Défaites ${w.demoId}`, w.losses, got.losses, "BLOQUANT");
}

/* ---------- 4. Tableau de bord (§11.2) ---------- */
const D = ref.dashboard;
const d = act.dashboard;
push("Joueurs inscrits", D.players, d.players, "BLOQUANT");
push("Parties aujourd'hui", D.gamesToday, d.gamesToday, "BLOQUANT");
push("Parties sur 7 jours", D.games7d, d.games7d, "BLOQUANT");
push("Tournois ouverts", D.openTournaments, d.openTournaments, "BLOQUANT");
push("Inscriptions sur tournois ouverts", D.openRegistrations, d.openRegistrations, "BLOQUANT");
push("Décisions en attente — total", D.pendingDecisions.total, d.pendingDecisions.total, "BLOQUANT");
push("Décisions en attente — KYC", D.pendingDecisions.kyc, d.pendingDecisions.kyc, "BLOQUANT");
push("Décisions en attente — retraits", D.pendingDecisions.withdrawals, d.pendingDecisions.withdrawals, "BLOQUANT");
push("Décisions en attente — litiges", D.pendingDecisions.disputes, d.pendingDecisions.disputes, "BLOQUANT");

/* ---------- 5. Top 5 et badges ---------- */
const refTop = (ref.seed.top5 || []).map((x) => [x.rank, x.pseudo, x.elo, x.badge]);
const actTop = (act.seed.top5 || []).map((x) => [x.rank, x.pseudo, x.elo, x.badge]);
push("Top 5 (rang, pseudo, Elo, badge)", refTop, actTop, "BLOQUANT");

/* ---------- 6. Structure (§11.6) ---------- */
const S = ref.structure;
const s = act.structure;
push("Modules", S.modules.slice().sort(), s.modules.slice().sort(), "BLOQUANT");
push("Groupes", S.groups.slice().sort(), s.groups.slice().sort(), "BLOQUANT");
push("Rôles", S.roles.slice().sort(), s.roles.slice().sort(), "BLOQUANT");
push("Actions", S.actions.slice().sort(), s.actions.slice().sort(), "BLOQUANT");

/* ---------- 7. Matrice de permissions (§11.6) ---------- */
/* `super_admin` est protégé : la référence ne stocke que `read` pour lui, mais
   son `can()` renvoie TOUJOURS vrai. On compare donc son droit EFFECTIF, sinon
   on signalerait un écart qui n'en est pas un — et le signaler serait plus
   trompeur que l'ignorer. */
const ALL = S.actions.slice().sort();
for (const role of S.roles) {
  for (const mod of S.modules) {
    const want = role === "super_admin"
      ? ALL
      : ((S.defaultPermissions[role] && S.defaultPermissions[role][mod]) || []).slice().sort();
    const got = ((s.defaultPermissions[role] && s.defaultPermissions[role][mod]) || []).slice().sort();
    push(`Droits ${role} × ${mod}`, want, got, "BLOQUANT",
      role === "super_admin" ? "rôle protégé : droits calculés, pas stockés" : "");
  }
}

/* ---------- 8. Règles de badge ---------- */
const refBadges = (S.badgeRules || []).map((b) => [b.name, b.minRank, b.maxRank]);
const actBadges = (s.badgeRules || []).map((b) => [b.name, b.minRank, b.maxRank]);
push("Barème des badges", refBadges, actBadges, "BLOQUANT");

/* ---------- Rapport ---------- */
const today = new Date().toISOString().slice(0, 10);
const out = path.join(REPORTS, `compare-seed-${today}.md`);
if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });

const fmt = (v) => {
  const str = typeof v === "string" ? v : JSON.stringify(v);
  return str && str.length > 60 ? str.slice(0, 57) + "…" : str;
};
const ecarts = rows.filter((r) => r.verdict === "ÉCART");
const conformes = rows.filter((r) => r.verdict === "conforme");

const lines = [
  `# Comparaison oracle ↔ réel — ${today}`,
  "",
  `Référence : \`reference/REFERENCE-DEMO.json\` (SHA-256 démo verrouillé)`,
  `Réel : \`reference/ACTUAL.json\` (base \`${act.db ? path.basename(act.db) : "?"}\`)`,
  "",
  "| Domaine | Attendu (démo) | Obtenu (nouveau) | Écart | Niveau | Verdict |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.domain}${r.note ? " — *" + r.note + "*" : ""} | ${fmt(r.expected)} | ${fmt(r.obtained)} | ${r.verdict === "ÉCART" ? "OUI" : "—"} | ${r.level} | ${r.verdict} |`),
  "",
  "## Synthèse",
  "",
  `- Comparaisons effectuées : **${compared}**`,
  `- Conformes : **${conformes.length}**`,
  `- Écarts BLOQUANTS : **${blocking}**`,
  `- Écarts MAJEURS : **${major}**`,
  `- Écarts MINEURS : **${minor}**`,
  "",
  `## Verdict : **${blocking === 0 ? "GO" : "NO-GO"}**`,
  "",
  blocking === 0
    ? "Aucun écart bloquant. La parité du seed, de la structure et de la matrice de permissions est atteinte."
    : "Des écarts bloquants subsistent : voir la liste ci-dessus. Aucun passage en production avec un écart BLOQUANT ouvert.",
  "",
];
fs.writeFileSync(out, lines.join("\n"), "utf8");

console.log(lines.slice(-8).join("\n"));
console.log("\nRapport écrit : " + out);
if (blocking > 0) {
  const first = ecarts.filter((r) => r.level === "BLOQUANT").slice(0, 8);
  console.log("\nPremiers écarts bloquants :");
  for (const r of first) console.log(`  ${r.domain} : attendu ${fmt(r.expected)} · obtenu ${fmt(r.obtained)}`);
  process.exit(1);
}
process.exit(0);
