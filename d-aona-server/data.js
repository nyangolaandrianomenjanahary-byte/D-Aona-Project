/* =========================================================
   D-aôna — Données statiques serveur (PRD v1.1)
   Même données que le frontend mais en module CommonJS.
   ========================================================= */
"use strict";

const RANKS = [
  { name: "Bronze",       min: 0,    max: 799,   color: "#8a5a3b" },
  { name: "Argent",       min: 800,  max: 1199,  color: "#9aa3ad" },
  { name: "Or",           min: 1200, max: 1499,  color: "#e3b23c" },
  { name: "Platine",      min: 1500, max: 1599,  color: "#4f8ff7" },
  { name: "Diamant",      min: 1600, max: 1799,  color: "#22c55e" },
  { name: "Maître",       min: 1800, max: 1999,  color: "#e59e27" },
  { name: "Grand Maître", min: 2000, max: 99999, color: "#e5484d" },
];

const PROVINCES = [
  "Antananarivo", "Antsiranana", "Fianarantsoa",
  "Mahajanga", "Toamasina", "Toliara",
];

/* --- Badges de classement national (6 au total) --- */
const BADGES = [
  { name: "Remenabila",  icon: "👑", color: "#e3b23c", min: 1,  max: 1 },
  { name: "Malaso",      icon: "⚔️", color: "#9aa3ad", min: 2,  max: 2 },
  { name: "Dahalo",      icon: "🗡️", color: "#b0703c", min: 3,  max: 3 },
  { name: "Totakely",    icon: "🛡️", color: "#4f8ff7", min: 4,  max: 25 },
  { name: "Akofa",       icon: "🎋", color: "#22c55e", min: 26, max: 50 },
  { name: "Vary masaka", icon: "🍚", color: "#8a8fa3", min: 51, max: Infinity },
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
  { id: "pro",    name: "Pro",    time: 7200, label: "2 h",     desc: "Format long — tournois Masters / Grand Maître." },
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

const SKINS_CATALOG = [
  { id: "pions-classique",  name: "Pions Vato",         kind: "pions",  price: 0,   desc: "Pions traditionnels clairs et sombres." },
  { id: "pions-emeraude",   name: "Pions Émeraude",     kind: "pions",  price: 800,  desc: "Liseré vert D-aôna et éclat poli." },
  { id: "pions-obsidienne", name: "Pions Obsidienne",   kind: "pions",  price: 1200, desc: "Noir volcanique, reflets violets." },
  { id: "plateau-anosy",    name: "Plateau Nuit d'Anosy", kind: "plateau", price: 1500, desc: "Teinte indigo profonde et liseret doré." },
  { id: "trace-emeraude",   name: "Trace d'émeraude",   kind: "effet",  price: 600,  desc: "Traînée lumineuse sur le dernier coup joué." },
  { id: "anim-flamme",      name: "Victoire — Flamme",  kind: "effet",  price: 2000, desc: "Explosion de braises sur l'écran de victoire." },
];

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

function rankFor(elo) {
  return RANKS.find((r) => elo >= r.min && elo <= r.max) || RANKS[0];
}

function rankProgress(elo) {
  const r = rankFor(elo);
  if (r.name === "Grand Maître") return 100;
  return Math.round(((elo - r.min) / (r.max + 1 - r.min)) * 100);
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
  RANKS, PROVINCES, GAMES_CATALOG, FORMATS, OPPONENT_POOL, LEADERBOARD_POOL,
  SKINS_CATALOG, OPERATORS, CHAT_REPLIES, BADGES, badgeFor,
  fmtAr, rankFor, rankProgress, countdownParts, eloDelta,
};
