/* =========================================================
   D-aôna — Générateur du golden file de comparaison
   ---------------------------------------------------------
   Le prompt d'installation annonce `scripts/export-reference.ts` et
   `REFERENCE-DEMO.json`. Aucun des deux n'était présent (cf.
   `reference/LOCK.json → missingProvidedAssets`).

   Ce script joue le même rôle, sans rien inventer : il ouvre la DÉMO RÉELLE
   dans un navigateur, force une écriture (le store ne persiste qu'après une
   COMMANDE — le bouton de thème en est une), lit l'état complet dans
   `localStorage` et en DÉRIVE les agrégats attendus.

   Aucune valeur du golden file n'est saisie à la main. C'est la seule façon
   honnête de produire un oracle : si la démo change, l'oracle change avec elle.

   Usage : node scripts/export-reference.js
   Sortie : reference/REFERENCE-DEMO.json
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

/* Playwright vit dans les dépendances du serveur, pas à la racine. */
const { chromium } = require(path.join(__dirname, "..", "d-aona-server", "node_modules", "playwright"));

const DEMO = path.join(__dirname, "..", "reference", "D-aona-Administration.html");
const OUT = path.join(__dirname, "..", "reference", "REFERENCE-DEMO.json");
const STORAGE_KEY = "daona.admin.v2";

/* La démo ancre toutes ses dates sur cette journée (constante `mn` du bundle). */
const TODAY = "2026-11-02";

/* Table commande -> [module, action], EXTRAITE du bundle (objet `ln`).
   Recopiée ici parce qu'elle est minifiée et inatteignable à l'exécution ;
   la source exacte est citée pour que toute divergence soit détectable. */
const COMMANDS = {
  "kyc.review": ["kyc", "review"],
  "kyc.open": ["kyc", "read"],
  "user.sanction": ["users", "edit"],
  "user.role": ["roles", "edit"],
  "withdrawal.review": ["withdrawals", "review"],
  "withdrawal.pay": ["withdrawals", "review"],
  "tournament.create": ["tournaments", "create"],
  "tournament.edit": ["tournaments", "edit"],
  "tournament.transition": ["tournaments", "edit"],
  "tournament.enroll": ["tournaments", "edit"],
  "tournament.withdraw": ["tournaments", "edit"],
  "tournament.start": ["tournaments", "review"],
  "match.result": ["matches", "review"],
  "dispute.open": ["disputes", "create"],
  "dispute.resolve": ["disputes", "review"],
  "game.save": ["games", "edit"],
  "game.status": ["games", "edit"],
  "campaign.save": ["campaigns", "edit"],
  "campaign.pause": ["campaigns", "edit"],
  "campaign.delete": ["campaigns", "delete"],
  "roles.save": ["roles", "edit"],
  "module.toggle": ["modules", "edit"],
  "settings.save": ["settings", "edit"],
  "badges.save": ["ranking", "edit"],
  "theme.toggle": ["overview", "read"],
};

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toLowerCase();

function dayOf(v) { return String(v || "").slice(0, 10); }

async function readState() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file:///" + DEMO.replace(/\\/g, "/"));
  await page.waitForTimeout(2600);

  let raw = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  let triggered = null;
  if (!raw) {
    /* Le store ne persiste qu'après une commande. `theme.toggle` en est une et
       n'a aucun effet sur les données métier : c'est la commande la moins
       intrusive pour forcer l'écriture. */
    const btn = page.locator('[data-action="theme"]').first();
    if (await btn.count()) {
      await btn.click({ timeout: 4000 }).catch(() => {});
      triggered = "theme.toggle";
    }
    await page.waitForTimeout(1400);
    raw = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  }
  const title = await page.title();
  await browser.close();
  if (!raw) throw new Error("la démo n'a rien persisté : impossible de produire un oracle");
  return { state: JSON.parse(raw), errors, triggered, title };
}

function aggregates(st) {
  /* --- portefeuilles, dérivés du grand livre (jamais d'un solde stocké) --- */
  const balanceBy = new Map();
  let credits = 0;
  let debits = 0;
  for (const e of st.ledger || []) {
    balanceBy.set(e.userId, (balanceBy.get(e.userId) || 0) + e.amount);
    if (e.amount > 0) credits += e.amount; else debits += -e.amount;
  }
  const reservedBy = new Map();
  let activeHolds = 0;
  for (const h of st.holds || []) {
    if (!h.active) continue;
    activeHolds++;
    reservedBy.set(h.userId, (reservedBy.get(h.userId) || 0) + h.amount);
  }

  const wallets = (st.users || []).map((u) => {
    const balance = balanceBy.get(u.id) || 0;
    const reserved = reservedBy.get(u.id) || 0;
    return {
      demoId: u.id, pseudo: u.pseudo, elo: u.elo, wins: u.wins, losses: u.losses,
      balance, reserved, available: balance - reserved,
      role: u.role || null, blocked: !!u.blocked,
    };
  });

  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const balance = sum(wallets, (w) => w.balance);
  const reserved = sum(wallets, (w) => w.reserved);

  /* --- compétition --- */
  const matches = st.matches || [];
  const gamesToday = matches.filter((m) => dayOf(m.startedAt) === TODAY).length;
  const since = new Date(TODAY + "T00:00:00+03:00");
  since.setDate(since.getDate() - 6);
  const from6 = since.toISOString().slice(0, 10);
  const games7d = matches.filter((m) => {
    const d = dayOf(m.startedAt);
    return d >= from6 && d <= TODAY;
  }).length;

  const tournaments = st.tournaments || [];
  const openTournaments = tournaments.filter((t) => t.status === "open");
  const openIds = new Set(openTournaments.map((t) => t.id));
  const registrations = st.registrations || [];

  /* --- files de décision --- */
  const kycPending = (st.kyc || []).filter((k) => k.status === "pending").length;
  const withdrawalsPending = (st.withdrawals || []).filter((w) => w.status === "pending").length;
  const disputesOpen = (st.disputes || []).filter((d) => d.status === "open" || d.status === "investigating").length;

  const badgeOf = (rank) => {
    const list = st.badges || [];
    return (list.find((b) => rank >= b.minRank && (b.maxRank == null || rank <= b.maxRank)) || list[list.length - 1] || {}).name || null;
  };
  const top = wallets.slice().sort((a, b) => b.elo - a.elo).slice(0, 5)
    .map((w, i) => ({ rank: i + 1, demoId: w.demoId, pseudo: w.pseudo, elo: w.elo, badge: badgeOf(i + 1) }));

  return {
    seed: {
      counts: {
        users: (st.users || []).length,
        kyc: {
          pending: kycPending,
          verified: (st.kyc || []).filter((k) => k.status === "verified").length,
          rejected: (st.kyc || []).filter((k) => k.status === "rejected").length,
          total: (st.kyc || []).length,
        },
        withdrawals: {
          pending: withdrawalsPending,
          approved: (st.withdrawals || []).filter((w) => w.status === "approved").length,
          paid: (st.withdrawals || []).filter((w) => w.status === "paid").length,
          rejected: (st.withdrawals || []).filter((w) => w.status === "rejected").length,
        },
        disputes: {
          open: (st.disputes || []).filter((d) => d.status === "open").length,
          investigating: (st.disputes || []).filter((d) => d.status === "investigating").length,
        },
        tournaments: tournaments.length,
        registrations: registrations.length,
        ledgerEntries: (st.ledger || []).length,
        activeHolds,
        matches: matches.length,
        campaigns: (st.campaigns || []).length,
      },
      totals: {
        balance, reserved, available: balance - reserved, credits, debits,
      },
      wallets,
      top5: top,
    },
    dashboard: {
      players: (st.users || []).length,
      gamesToday,
      games7d,
      openTournaments: openTournaments.length,
      openRegistrations: registrations.filter((r) => openIds.has(r.tournamentId)).length,
      pendingDecisions: { kyc: kycPending, withdrawals: withdrawalsPending, disputes: disputesOpen,
        total: kycPending + withdrawalsPending + disputesOpen },
    },
    structure: {
      modules: Object.keys(st.modules || {}),
      groups: ["Pilotage", "Communauté", "Compétition", "Finances", "Configuration"],
      roles: Object.keys(st.permissions || {}),
      actions: ["read", "create", "edit", "review", "export", "delete"],
      defaultPermissions: st.permissions || {},
      badgeRules: st.badges || [],
    },
    commands: COMMANDS,
    invariants: invariantNames(),
    meta: {
      schemaVersion: st.schemaVersion, revision: st.revision,
      settings: st.settings || {},
      auditEntries: (st.audit || []).length,
    },
  };
}

/* Les invariants que la nouvelle implémentation doit tenir APRÈS CHAQUE
   commande (prompt §11.5). Nommés ici pour que le rapport de comparaison
   puisse les citer un par un. */
function invariantNames() {
  return [
    "balance = somme des écritures du joueur",
    "available = balance - réserves actives",
    "crédits - débits = somme des soldes",
    "une seule inscription ACTIVE par (joueur, tournoi)",
    "référence comptable unique",
    "paiement de retrait = débit + levée de réserve dans la même transaction",
    "dotation = somme des frais non remboursés",
    "Elo zero-sum (K=32) appliqué une seule fois",
    "litige ouvert bloque la validation du résultat",
    "capacité de tournoi = puissance de 2",
    "badges continus, sans trou ni chevauchement",
    "dernier super administrateur protégé",
    "commande refusée sans effet de bord",
  ];
}

(async () => {
  const hash = sha256(DEMO);
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "reference", "LOCK.json"), "utf8"));
  if (hash !== String(lock.sha256).toLowerCase()) {
    console.error("REFUS : la démo ne correspond plus au verrou.\n  attendu " + lock.sha256 + "\n  obtenu  " + hash);
    process.exit(2);
  }
  const { state, errors, triggered, title } = await readState();
  const doc = {
    generatedAt: new Date().toISOString(),
    source: "reference/D-aona-Administration.html",
    sha256: hash,
    demoTitle: title,
    persistedBy: triggered || "écriture préexistante",
    pageErrors: errors,
    ...aggregates(state),
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log("Golden file écrit : " + OUT);
  console.log("  comptes " + doc.seed.counts.users
    + " · écritures " + doc.seed.counts.ledgerEntries
    + " · réserves " + doc.seed.counts.activeHolds);
  console.log("  solde " + doc.seed.totals.balance
    + " Ar · réservé " + doc.seed.totals.reserved
    + " Ar · disponible " + doc.seed.totals.available + " Ar");
  console.log("  crédits " + doc.seed.totals.credits + " Ar · débits " + doc.seed.totals.debits + " Ar");
  console.log("  aujourd'hui " + doc.dashboard.gamesToday + " parties · 7 j " + doc.dashboard.games7d
    + " · décisions en attente " + doc.dashboard.pendingDecisions.total);
  if (errors.length) console.log("  ATTENTION erreurs de page : " + errors.join(" | "));
})();
