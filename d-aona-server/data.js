/* =========================================================
   D-aôna — Données statiques serveur (module CommonJS)
   ========================================================= */
"use strict";

const PROVINCES = [
  "Antananarivo", "Antsiranana", "Fianarantsoa",
  "Mahajanga", "Toamasina", "Toliara",
];

/* --- Badges de classement national (6 au total) ---
   `color` = teinte décorative (fond 8 %, bordure 40 %) ET encre du thème nuit ;
   `ink` = encre du thème jour, plus foncée. Le client choisit selon le thème.
   Cet inventaire et celui de index.html doivent rester alignés. */
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

/* --- Camps de pions : passerelle entre le GROUPE d'une couleur et le camp du
   plateau. Le tirage (`state.toss.starter`) décide qui joue les clairs :
     light → pions clairs (groupe « clair ») · dark → pions sombres (groupe « sombre »)
   Une couleur claire ne peut être enregistrée que pour `light`, une sombre que
   pour `dark` (`pionColorFitsCamp`) : un compte a deux apparences indépendantes. */
const PION_CAMPS = [
  { id: "light", label: "Pions clairs",  group: "clair",  target: "me",  who: "le camp clair — celui qui commence" },
  { id: "dark",  label: "Pions sombres", group: "sombre", target: "opp", who: "le camp sombre" },
];
/* Camp par défaut : celui des pions du joueur (clients qui n'annoncent aucun camp). */
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

/* =========================================================
   Historique du wallet — familles et moyens de paiement
   ---------------------------------------------------------
   L'écran Wallet filtre les mouvements par FAMILLE (dépôt, retrait, gain…).
   Ces motifs sont la SOURCE DE VÉRITÉ du classement : /api/transactions et
   /api/transactions/export filtrent avec, et chaque ligne renvoyée porte déjà
   son `kind` et son `method` — le client les AFFICHE, il ne reclasse rien,
   donc le filtre et l'étiquette affichée ne peuvent pas diverger.
   L'ORDRE compte : le premier motif qui correspond gagne, du plus spécifique
   au plus général (« Defi annule - remboursement » est un remboursement, pas
   une mise). Les motifs couvrent les libellés réellement produits par les
   appels Wallet.credit / Wallet.spend de server.js.
   ========================================================= */
const TX_KINDS = [
  ["deposit",  "Dépôt",         /Depot|Dépôt/i],
  ["withdraw", "Retrait",       /Retrait/i],
  ["refund",   "Remboursement", /remboursement/i],
  ["purchase", "Achat",         /Achat/i],
  ["gain",     "Gain",          /Gain|Cashprice/i],
  ["wager",    "Mise",          /Mise/i],
  ["bonus",    "Bonus",         /Bonus|bienvenue/i],
  ["other",    "Autre",         null],
];
function txKind(label) {
  const l = String(label || "");
  for (const [id, , re] of TX_KINDS) if (re && re.test(l)) return id;
  return "other";
}
function txKindLabel(id) {
  const k = TX_KINDS.find(([kid]) => kid === id);
  return k ? k[1] : "Autre";
}
/* Moyen de paiement, DÉDUIT du libellé : les dépôts/retraits portent le nom de
   l'opérateur (« Depot MVola ») ; tout le reste est interne → Da-ona. */
const TX_METHOD_INTERNAL = "Da-ona";
const TX_METHODS = [
  ["MVola", /mvola/i],
  ["Orange Money", /orange/i],
  ["Airtel Money", /airtel/i],
];
function txMethod(label) {
  const l = String(label || "");
  for (const [name, re] of TX_METHODS) if (re.test(l)) return name;
  return TX_METHOD_INTERNAL;
}
/* CSV de l'historique (export de l'écran Wallet) : séparateur « ; » et BOM
   UTF-8 (Excel français), guillemets doublés à l'intérieur des valeurs,
   montant SIGNÉ (négatif en sortie) pour survivre à un tri en tableur. */
function txCsv(rows) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const lines = [["Date", "Heure", "Opération", "Type", "Moyen", "Statut", "Direction", "Montant (Ar)"].map(q).join(";")];
  for (const t of rows) {
    const [day = "", time = ""] = String(t.created_at || "").split(" ");
    lines.push([
      q(day), q(time.slice(0, 5)), q(t.label), q(txKindLabel(t.kind || txKind(t.label))),
      q(t.method || txMethod(t.label)), q(t.status === "pending" ? "En attente" : "Réussi"),
      q(t.dir === "in" ? "Entrée" : "Sortie"),
      q(t.dir === "in" ? t.amount : -t.amount),
    ].join(";"));
  }
  return "\ufeff" + lines.join("\r\n");
}

module.exports = {
  PROVINCES, GAMES_CATALOG, FORMATS, OPPONENT_POOL, LEADERBOARD_POOL,
  SKINS_CATALOG, OPERATORS, BADGES, badgeFor,
  skinSlot, skinSlotMatches,
  PION_COLORS, PION_GROUPS, PION_PATTERNS, pionColor, pionPattern,
  PION_CAMPS, PION_CAMP_GROUP, PION_DEFAULTS, PION_DEFAULT_CAMP, pionCamp, pionColorFitsCamp,
  TX_KINDS, txKind, txKindLabel, TX_METHODS, TX_METHOD_INTERNAL, txMethod, txCsv,
};
