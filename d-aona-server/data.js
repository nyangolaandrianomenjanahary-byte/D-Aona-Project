/* =========================================================
   D-aôna — Données statiques serveur (PRD v1.1)
   Même données que le frontend mais en module CommonJS.
   ========================================================= */
"use strict";

/* Les paliers de rang (Bronze → Grand Maître) ont été RETIRÉS du jeu : il ne reste
   que l'Elo et le classement par place, avec ses badges (BADGES / badgeFor). */

const PROVINCES = [
  "Antananarivo", "Antsiranana", "Fianarantsoa",
  "Mahajanga", "Toamasina", "Toliara",
];

/* --- Badges de classement national (6 au total) ---
   `color` = teinte décorative (fond 8 %, bordure 40 %) ET encre du thème nuit ;
   `ink` = encre du thème jour, plus foncée. Le client choisit selon le thème.
   Les encres viennent de la revue UX/UI §3 (lot S2 : l'or tombait à 1,86:1) et le
   bronze a été éclairci au lot S7 (4,46:1 sur les surfaces de nuit relevées) —
   cet inventaire et celui de l'index doivent rester alignés. */
const BADGES = [
  { name: "Remenabila",  icon: "👑", color: "#e3b23c", ink: "#7a5a00", min: 1,  max: 1 },
  { name: "Malaso",      icon: "⚔️", color: "#9aa3ad", ink: "#48525c", min: 2,  max: 2 },
  { name: "Dahalo",      icon: "🗡️", color: "#bc7a44", ink: "#7a4210", min: 3,  max: 3 },
  { name: "Totakely",    icon: "🛡️", color: "#4f8ff7", ink: "#1e40af", min: 4,  max: 25 },
  { name: "Akofa",       icon: "🎋", color: "#22c55e", ink: "#0f6b33", min: 26, max: 50 },
  { name: "Vary masaka", icon: "🍚", color: "#8a8fa3", ink: "#525669", min: 51, max: Infinity },
];
function badgeFor(rank) {
  return BADGES.find((b) => rank >= b.min && rank <= b.max) || BADGES[BADGES.length - 1];
}

const GAMES_CATALOG = [
  { id: "fanorona", name: "Fanorona", type: "Stratégie / Plateau", status: "mvp",
    desc: "Le jeu de plateau national malgache. Captures par approche ou par retrait, prises en chaîne obligatoires." },
  { id: "katro", name: "Katro", type: "Stratégie", status: "soon",
    desc: "Variante malgache du Mancala — comptage et anticipation. Prévu post-MVP." },
  { id: "points", name: "Jeu de points", type: "Stratégie", status: "soon",
    desc: "Troisième titre du catalogue, en cours d'évaluation." },
];

const FORMATS = [
  { id: "blitz",  name: "Blitz",  time: 600,  label: "10 min",  desc: "Partie rapide, idéale pour le matchmaking classé." },
  { id: "rapide", name: "Rapide", time: 3600, label: "60 min",  desc: "Format standard pour tournois et défis." },
  { id: "pro",    name: "Pro",    time: 7200, label: "2 h",     desc: "Format long — tournois à cagnotte." },
];

const OPPONENT_POOL = [
  { pseudo: "MamyLeo",    elo: 1080, province: "Antananarivo" },
  { pseudo: "NirinaZ",    elo: 1150, province: "Antananarivo" },
  { pseudo: "HeryTana",   elo: 1210, province: "Antananarivo" },
  { pseudo: "RijaRM",     elo: 1175, province: "Toamasina" },
  { pseudo: "TokyRabe",   elo: 1055, province: "Mahajanga" },
  { pseudo: "Fitiavana",  elo: 1240, province: "Antananarivo" },
  { pseudo: "Voahangy",   elo: 1122, province: "Fianarantsoa" },
  { pseudo: "JeanLucTsr", elo: 1188, province: "Toamasina" },
];

const LEADERBOARD_POOL = [
  { pseudo: "SolofoGM",    elo: 2124, province: "Antananarivo",        wins: 341, games: 402 },
  { pseudo: "RadoTheKing", elo: 1992, province: "Toamasina",        wins: 288, games: 355 },
  { pseudo: "MialyPro",    elo: 1875, province: "Antananarivo",        wins: 260, games: 340 },
  { pseudo: "TianaDiam",   elo: 1701, province: "Mahajanga",             wins: 244, games: 330 },
  { pseudo: "KantoV",      elo: 1633, province: "Antananarivo",    wins: 231, games: 320 },
  { pseudo: "HajaPlt",     elo: 1540, province: "Antananarivo",        wins: 212, games: 305 },
  { pseudo: "Faniry_",     elo: 1488, province: "Fianarantsoa",   wins: 204, games: 298 },
  { pseudo: "ZoFighter",   elo: 1402, province: "Toamasina",        wins: 190, games: 289 },
  { pseudo: "LovaTms",     elo: 1355, province: "Toamasina",        wins: 177, games: 271 },
  { pseudo: "AndryF",      elo: 1290, province: "Antsiranana",             wins: 163, games: 262 },
  { pseudo: "MioraRts",    elo: 1248, province: "Antananarivo",        wins: 158, games: 250 },
  { pseudo: "NadiaBe",     elo: 1199, province: "Mahajanga",             wins: 141, games: 240 },
  { pseudo: "Tsiory9",     elo: 1085, province: "Antananarivo",        wins: 120, games: 211 },
  { pseudo: "BemaT",       elo: 990,  province: "Antananarivo",    wins: 102, games: 199 },
  { pseudo: "Sariaka",     elo: 902,  province: "Fianarantsoa",   wins: 89,  games: 178 },
  { pseudo: "DeraMG",      elo: 801,  province: "Antananarivo",        wins: 71,  games: 150 },
  { pseudo: "FenoAria",    elo: 640,  province: "Toliara",  wins: 52,  games: 121 },
  { pseudo: "MandaK",      elo: 410,  province: "Antsiranana",             wins: 31,  games: 90  },
];

/* Catalogue des skins — SOURCE DE VÉRITÉ côté serveur (prix ET types) : un skin
   absent d'ici est refusé, et c'est le prix d'ici qui est débité.
   `type` n'existe que pour les pions : LIGHT = pions clairs, DARK = pions
   sombres. Les deux catégories sont indépendantes (achat, prix, équipement) :
   acheter « Dragon — pions clairs » ne débloque PAS « Ombres — pions sombres ».
   Les anciens ids (`pions-classique`, `pions-emeraude`, `pions-obsidienne`) ont
   été scindés/normalisés par la migration 008, sans jamais perdre un achat. */
const SKINS_CATALOG = [
  { id: "pions-clair-classique",   name: "Pions Vato — clairs",   kind: "pions", type: "LIGHT", price: 0,    desc: "Pions traditionnels clairs." },
  { id: "pions-sombre-classique",  name: "Pions Vato — sombres",  kind: "pions", type: "DARK",  price: 0,    desc: "Pions traditionnels sombres." },
  { id: "pions-clair-emeraude",    name: "Émeraude — clairs",     kind: "pions", type: "LIGHT", price: 800,  desc: "Liseré vert D-aôna et éclat poli sur vos pions." },
  { id: "pions-sombre-emeraude",   name: "Émeraude — sombres",    kind: "pions", type: "DARK",  price: 800,  desc: "Éclat vert profond, version pions sombres." },
  { id: "pions-clair-obsidienne",  name: "Obsidienne — clairs",   kind: "pions", type: "LIGHT", price: 1200, desc: "Or fondu et reflets chauds sur vos pions." },
  { id: "pions-sombre-obsidienne", name: "Obsidienne — sombres",  kind: "pions", type: "DARK",  price: 1200, desc: "Noir volcanique, reflets violets." },
  { id: "pions-clair-dragon",      name: "Dragon — clairs",       kind: "pions", type: "LIGHT", price: 1800, desc: "Écaille ambrée et lueur d'or fondu." },
  { id: "pions-sombre-ombres",     name: "Ombres — sombres",      kind: "pions", type: "DARK",  price: 1800, desc: "Encre nocturne, reflets d'orage." },
  { id: "plateau-anosy",           name: "Plateau Nuit d'Anosy",  kind: "plateau", price: 1500, desc: "Teinte indigo profonde et liseret doré." },
  { id: "trace-emeraude",          name: "Trace d'émeraude",      kind: "effet",   price: 600,  desc: "Traînée lumineuse sur le dernier coup joué." },
  { id: "anim-flamme",             name: "Victoire — Flamme",     kind: "effet",   price: 2000, desc: "Explosion de braises sur l'écran de victoire." },
];

/* Slot d'équipement d'un skin — TOUJOURS DÉRIVÉ DE SON TYPE, jamais de la
   requête du client : LIGHT → pions clairs, DARK → pions sombres. C'est ce
   même calcul qui interdit d'équiper un skin clair sur des pions sombres. */
function skinSlot(sk) {
  if (!sk) return null;
  if (sk.kind === "pions") return sk.type === "DARK" ? "pions_dark" : "pions_light";
  if (sk.kind === "plateau") return "plateau";
  if (sk.kind === "effet") return "effet";
  return null;
}

/* Contrôle de compatibilité : ce que le client prétend viser (type « LIGHT » /
   « DARK » ou nom de slot) doit concorder avec le slot réel du skin. Un appel
   direct ne peut donc pas forcer un skin incompatible sur un camp donné. */
function skinSlotMatches(sk, claimed) {
  const slot = skinSlot(sk);
  if (!slot) return false;
  if (claimed === null || claimed === undefined || claimed === "") return true;
  const c = String(claimed).toUpperCase();
  if (c === slot.toUpperCase()) return true;
  return (slot === "pions_light" && c === "LIGHT") || (slot === "pions_dark" && c === "DARK");
}


/* =========================================================
   Apparence des pions — COULEUR × MOTIF, PAR CAMP
   ---------------------------------------------------------
   Deux catalogues TOTALEMENT INDÉPENDANTS. Le serveur est la source de vérité
   des IDENTIFIANTS : il refuse (400) une couleur ou un motif absent d'ici et ne
   stocke JAMAIS de combinaison — `pion_style` porte un `color` et un `pattern`
   séparés, si bien que 16 couleurs × 9 motifs sont possibles sans qu'aucune des
   144 combinaisons n'existe en base ni en CSS. Ajouter « Rose » ici (et son
   apparence côté client) suffit : elle se combine aussitôt à tous les motifs.
   L'apparence (dégradés, encre, géométrie des motifs) vit côté client, comme
   `grad` pour les skins — le serveur, lui, ne connaît que l'identité.
   Depuis la migration 010, chaque COMPTE porte DEUX apparences indépendantes,
   une par camp (`light` = les pions clairs, `dark` = les pions sombres), et une
   couleur n'est acceptée que dans le camp de son groupe (voir PION_CAMPS et
   `pionColorFitsCamp` ci-dessous).
   ========================================================= */
const PION_COLORS = [
  { id: "rouge_clair",   name: "Rouge clair",   group: "clair" },
  { id: "vert_clair",    name: "Vert clair",    group: "clair" },
  { id: "bleu_clair",    name: "Bleu clair",    group: "clair" },
  { id: "jaune",         name: "Jaune",         group: "clair" },
  { id: "blanc",         name: "Blanc",         group: "clair" },
  { id: "gris_clair",    name: "Gris clair",    group: "clair" },
  { id: "orange_clair",  name: "Orange clair",  group: "clair" },
  { id: "violet_clair",  name: "Violet clair",  group: "clair" },
  { id: "grenat",        name: "Rouge sombre — Grenat",   group: "sombre" },
  { id: "vert_arme",     name: "Vert sombre — Vert armé", group: "sombre" },
  { id: "bleu_marine",   name: "Bleu marine",   group: "sombre" },
  { id: "marron",        name: "Marron",        group: "sombre" },
  { id: "noir",          name: "Noir",          group: "sombre" },
  { id: "gris_sombre",   name: "Gris sombre",   group: "sombre" },
  { id: "orange_sombre", name: "Orange sombre", group: "sombre" },
  { id: "violet_sombre", name: "Violet sombre", group: "sombre" },
];
const PION_GROUPS = [["clair", "Couleurs claires"], ["sombre", "Couleurs sombres"]];
const PION_PATTERNS = [
  { id: "aucun",      name: "Aucun motif" },
  { id: "zebu",       name: "Tête de zébu" },
  { id: "ravinala",   name: "Ravinala" },
  { id: "lemurien",   name: "Lémurien" },
  { id: "cameleon",   name: "Tanala — Caméléon" },
  { id: "crocodile",  name: "Voay — Crocodile" },
  { id: "pra",        name: "Police — PRA" },
  { id: "pangalatra", name: "Voleur — Pangalatra" },
  { id: "lefona",     name: "Lefona — Lance" },
];
const pionColor = (id) => PION_COLORS.find((c) => c.id === id) || null;
const pionPattern = (id) => PION_PATTERNS.find((p) => p.id === id) || null;

/* --- Camps de pions : la passerelle entre le GROUPE d'une couleur et le camp
   du plateau qu'elle habille. Depuis que le TIRAGE décide de la couleur (le gagnant
   prend les clairs), le camp du plateau est décidé par `state.toss.starter` :
     light → les pions clairs    (`.piece.clair`)   — groupe « clair »
     dark  → les pions sombres   (`.piece.sombre`)  — groupe « sombre »
   Une même apparence `light` peut donc habiller l'un ou l'autre joueur selon le
   tirage. C'est cette table qui rend les deux apparences ÉTANCHES : une couleur claire
   ne peut être enregistrée que pour `light`, une couleur sombre que pour `dark`
   (`pionColorFitsCamp`). Un compte possède donc DEUX apparences indépendantes,
   une par camp, chacune avec sa couleur et son motif. */
const PION_CAMPS = [
  { id: "light", label: "Pions clairs",  group: "clair",  target: "me",  who: "le camp clair — celui qui commence" },
  { id: "dark",  label: "Pions sombres", group: "sombre", target: "opp", who: "le camp sombre" },
];
/* Camp par défaut : celui des pions du joueur (compatibilité — un client qui
   n'annonce aucun camp écrit là où l'ancien `pion_style` écrivait). */
const PION_DEFAULT_CAMP = "light";
const PION_CAMP_GROUP = Object.freeze({ light: "clair", dark: "sombre" });
/* Apparence par défaut de CHAQUE camp : les deux pions Vato de l'inscription. */
const PION_DEFAULTS = Object.freeze({
  light: { color: "blanc", pattern: "aucun" },
  dark:  { color: "noir",  pattern: "aucun" },
});
const pionCamp = (id) => PION_CAMPS.find((c) => c.id === id) || null;
/* Contrôle d'appartenance : la couleur visée doit être du groupe du camp. */
function pionColorFitsCamp(colorId, campId) {
  const c = pionColor(colorId), k = pionCamp(campId);
  return !!(c && k && c.group === PION_CAMP_GROUP[k.id]);
}

const OPERATORS = [
  { id: "mvola",    name: "MVola",         sub: "Telma Madagascar · frais ~2%", color: "#7ac142", txt: "M" },
  { id: "om",       name: "Orange Money",  sub: "Orange Madagascar · frais ~2%", color: "#ff7900", txt: "O" },
  { id: "airtel",   name: "Airtel Money",  sub: "Airtel Madagascar · frais ~2%", color: "#e40000", txt: "A" },
];

const CHAT_REPLIES = [
  "Bien joué ! 😅",
  "Ok, on fait ça en Blitz ?",
  "Ha ! Tu vas regretter ce coup…",
  "Je te préviens, je me suis entraîné contre l'IA toute la semaine.",
  "On se revoit au tournoi samedi 💪",
];

/* --- Helpers --- */
function fmtAr(n) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " Ar";
}

function countdownParts(sec) {
  if (sec <= 0) return "maintenant";
  const j = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (j > 0) return `${j} j ${String(h).padStart(2, "0")} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function eloDelta(me, opp, result) {
  const expected = 1 / (1 + Math.pow(10, (opp - me) / 400));
  return Math.round(32 * (result - expected));
}

module.exports = {
  PROVINCES, GAMES_CATALOG, FORMATS, OPPONENT_POOL, LEADERBOARD_POOL,
  SKINS_CATALOG, OPERATORS, CHAT_REPLIES, BADGES, badgeFor,
  skinSlot, skinSlotMatches,
  PION_COLORS, PION_GROUPS, PION_PATTERNS, pionColor, pionPattern,
  PION_CAMPS, PION_CAMP_GROUP, PION_DEFAULTS, PION_DEFAULT_CAMP, pionCamp, pionColorFitsCamp,
  fmtAr, countdownParts, eloDelta,
};
