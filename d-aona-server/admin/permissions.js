/* =========================================================
   D-aôna — Administration : catalogue des modules, rôles et règles d'accès
   ---------------------------------------------------------
   Ce fichier est la SOURCE DE VÉRITÉ de ce qui est administrable :
     · MODULES — les 15 écrans du back-office ;
     · ACTIONS — les 6 verbes possibles ;
     · ROLES   — les 7 rôles livrés et leurs droits PAR DÉFAUT.

   Une permission s'écrit « module.action » (« kyc.review », « campaigns.edit »…) :
   aucune table de correspondance à maintenir.

   GRILLE COMPLÈTE 15 × 6 = 90 — et non un sous-ensemble. La maquette de
   référence accorde `read create edit review export` à l'administrateur sur
   TOUS les modules sauf `roles`, et `review` sur `overview` au rôle Finance :
   ces combinaisons n'existent que si la grille est complète. Restreindre le
   catalogue aux seules actions « utiles » rend le modèle plus joli mais
   INCOMPARABLE à l'oracle (`REFERENCE-DEMO.json → structure.defaultPermissions`),
   et les 630 assertions rôle × module × action du plan de comparaison
   deviennent impossibles. L'oracle gagne.

   Les droits effectifs vivent en base (table `admin_grants`) : ce fichier ne
   fournit que le DÉFAUT, recopié une fois par `ensureSeed()`. Si un
   administrateur retire « campaigns.delete » au rôle Marketing, la modification
   survit aux redémarrages.

   `super_admin` ne dépend d'AUCUNE ligne en base : `can()` et `rightsOf()`
   court-circuitent. Un rôle protégé qui reposerait sur des lignes modifiables
   pourrait se retrouver vide, et le dernier super-administrateur ne pourrait
   plus rien réparer.
   ========================================================= */
"use strict";

/* Les six actions possibles, dans l'ordre où l'interface les présente.
   `label` est le verbe affiché sur la case à cocher : un administrateur doit
   lire « Décider », pas « review ». */
const ACTIONS = {
  read:   "Consulter",
  create: "Créer",
  edit:   "Modifier",
  review: "Décider",
  export: "Exporter",
  delete: "Supprimer",
};

const ALL_ACTIONS = Object.keys(ACTIONS);

/* Ordre d'affichage des groupes. Déclaré ici et non dans l'interface : ajouter
   un module dans un groupe existant ne doit pas demander de toucher au rendu. */
const GROUPS = ["Pilotage", "Communauté", "Compétition", "Finances", "Configuration"];

/* `desc` ne sert QU'À l'affichage des cartes du gestionnaire de modules. Une
   description qui mentirait sur le contenu serait pire que pas de description :
   chacune dit ce que l'écran fait réellement, pas ce qu'il devrait faire.

   `core: true` = module socle, non désactivable. Un back-office entièrement
   éteint ne peut plus se rallumer : les cinq modules qui portent la capacité
   de se gouverner sont donc hors d'atteinte de l'interrupteur. */
const MODULE_META = {
  overview: {
    label: "Vue d'ensemble", group: "Pilotage", core: true,
    desc: "L'activité, les soldes et les prochaines décisions à prendre.",
  },
  users: {
    label: "Joueurs", group: "Communauté",
    desc: "Comptes, portefeuille, identité et sanctions.",
  },
  kyc: {
    label: "Vérification d'identité", group: "Communauté",
    desc: "Dossiers recto/verso à examiner et décisions motivées.",
  },
  disputes: {
    label: "Fair-play & litiges", group: "Communauté",
    desc: "Signalements, contrôle des résultats et suites données.",
  },
  games: {
    label: "Jeux & règles", group: "Compétition",
    desc: "Variantes de Fanorona : publication, durée, classement, texte des règles.",
  },
  matches: {
    label: "Parties", group: "Compétition",
    desc: "Suivi des parties en cours, validation ou correction des résultats.",
  },
  tournaments: {
    label: "Tournois", group: "Compétition",
    desc: "Créer un tournoi, suivre ses inscriptions, l'annuler avec remboursement.",
  },
  ranking: {
    label: "Classement & badges", group: "Compétition",
    desc: "Distribution des classements et bornes de rang des badges.",
  },
  finance: {
    label: "Portefeuilles & flux", group: "Finances",
    desc: "Soldes, fonds réservés, grand livre en ariary et export CSV.",
  },
  withdrawals: {
    label: "Demandes de retrait", group: "Finances",
    desc: "Instruire une demande, la refuser motivée, la payer avec sa référence.",
  },
  campaigns: {
    label: "Campagnes", group: "Finances",
    desc: "Bannières de l'accueil et des profils : dates, ordre, emplacement.",
  },
  roles: {
    label: "Rôles & permissions", group: "Configuration", core: true,
    desc: "Une permission explicite par module et par action, plus les attributions.",
  },
  modules: {
    label: "Modules", group: "Configuration", core: true,
    desc: "Activation des espaces, sans suppression de données.",
  },
  audit: {
    label: "Journal d'audit", group: "Configuration", core: true,
    desc: "Traçabilité des décisions et des changements, en ajout seul.",
  },
  settings: {
    label: "Paramètres", group: "Configuration", core: true,
    desc: "Identité de la plateforme, inscriptions et mode maintenance.",
  },
};

/* Chaque module expose les SIX actions (grille 15 × 6 = 90). Voir l'en-tête :
   c'est une exigence de comparabilité, pas un oubli de conception. */
const MODULES = {};
for (const [id, meta] of Object.entries(MODULE_META)) {
  MODULES[id] = { ...meta, actions: ALL_ACTIONS.slice() };
}

const ALL_MODULES = Object.keys(MODULES);

/* Modules socles : ni éteignables, ni supprimables. */
const CORE_MODULES = ALL_MODULES.filter((m) => MODULES[m].core);

/* Tous les droits, sous la forme { module: [actions…] }. */
function fullRights() {
  const out = {};
  for (const m of ALL_MODULES) out[m] = MODULES[m].actions.slice();
  return out;
}

/* Tous les droits SAUF quelques permissions précises (« roles.edit »…). */
function rightsExcept(excluded = []) {
  const out = {};
  for (const m of ALL_MODULES) {
    const acts = MODULES[m].actions.filter((a) => !excluded.includes(`${m}.${a}`));
    if (acts.length) out[m] = acts;
  }
  return out;
}

/* Les mêmes actions sur tous les modules, sauf ceux écartés. Sert à
   l'administrateur : tout le back-office sauf `roles`. */
function everyModule(actions, except = []) {
  const out = {};
  for (const m of ALL_MODULES) if (!except.includes(m)) out[m] = actions.slice();
  return out;
}

/* Lecture seule sur tout : { module: ["read"] }. Écrit comme une fonction et
   non comme une liste recopiée — un module ajouté plus tard doit apparaître
   dans le rôle Observateur sans qu'on y pense. */
function readOnly() {
  const out = {};
  for (const m of ALL_MODULES) out[m] = ["read"];
  return out;
}

/* ---------- Rôles ----------
   Les défauts ci-dessous sont EXACTEMENT ceux de la maquette de référence
   (`REFERENCE-DEMO.json → structure.defaultPermissions`). Trois points
   contre-intuitifs, conservés volontairement parce que l'oracle les impose :
     · `admin` n'a AUCUN droit sur `roles` — il ne peut pas se donner de rôle ;
     · `finance` a `review` sur `overview` (il arbitre des décisions, pas des
       montants) ;
     · aucun rôle ne reçoit `delete` sauf Marketing sur les campagnes.
   `delete` existe donc dans la grille sans être distribué : c'est un droit
   que l'on accorde explicitement, jamais un dû. */
const ROLES = {
  super_admin: {
    label: "Super administrateur",
    description: "Tous les droits, y compris la gestion des rôles. Rôle protégé : " +
      "ne peut pas être retiré au dernier titulaire.",
    protected: true,
    rights: null,            // null = tous les droits, calculés
  },
  admin: {
    label: "Administrateur",
    description: "Tout le back-office en lecture, création, modification, décision " +
      "et export — sauf les rôles, qu'il ne peut ni lire ni modifier.",
    rights: everyModule(["read", "create", "edit", "review", "export"], ["roles"]),
  },
  moderation: {
    label: "Modération",
    description: "Joueurs, identités, litiges et parties : lire, décider, corriger.",
    rights: {
      overview: ["read"],
      users: ["read", "review", "edit"],
      kyc: ["read", "review", "edit"],
      disputes: ["read", "review", "edit"],
      matches: ["read", "review", "edit"],
    },
  },
  finance: {
    label: "Finance",
    description: "Portefeuilles, flux et demandes de retrait.",
    rights: {
      overview: ["read", "review"],
      finance: ["read", "export"],
      withdrawals: ["read", "review"],
    },
  },
  tournaments: {
    label: "Responsable tournois",
    description: "Tournois et parties : créer, organiser, décider. Classement et " +
      "catalogue en lecture.",
    rights: {
      overview: ["read"],
      games: ["read"],
      matches: ["read", "create", "edit", "review"],
      tournaments: ["read", "create", "edit", "review"],
      ranking: ["read"],
    },
  },
  marketing: {
    label: "Marketing",
    description: "Bannières publicitaires de l'accueil et des profils.",
    rights: {
      overview: ["read"],
      campaigns: ["read", "create", "edit", "delete"],
    },
  },
  observer: {
    label: "Observateur",
    description: "Lecture seule sur tout le back-office.",
    rights: readOnly(),
  },
};

/* Vérifie qu'une permission existe vraiment. Une faute de frappe
   (« kyc.aprouve ») doit refuser, jamais ouvrir un accès par défaut. */
function isPermission(perm) {
  if (typeof perm !== "string" || perm.indexOf(".") < 0) return false;
  const [mod, act] = perm.split(".");
  return !!(MODULES[mod] && MODULES[mod].actions.includes(act));
}

/* Le module est-il un socle ? Utilisé par l'interrupteur global : refuser
   d'éteindre `roles` évite de se couper l'herbe sous le pied en une requête. */
function isCore(module) {
  return !!(MODULES[module] && MODULES[module].core);
}

/* Liste plate de toutes les permissions connues — utilisée par l'interface. */
function allPermissions() {
  const out = [];
  for (const m of ALL_MODULES) for (const a of MODULES[m].actions) out.push(`${m}.${a}`);
  return out;
}

module.exports = {
  MODULES, ROLES, ACTIONS, ALL_ACTIONS, GROUPS, ALL_MODULES, CORE_MODULES,
  isPermission, isCore, allPermissions, fullRights,
};
