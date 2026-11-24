# D-aôna — Application web (PRD v1.2 · 2026)

Frontend **mono-fichier** de D-aôna, la plateforme compétitive de jeux
traditionnels malgaches (Fanorona, Katro…). HTML/CSS/JS vanilla embarqué dans
`index.html` — aucune dépendance, aucun build.

## Lancer l'application

Le frontend est servi par le backend (`d-aona-server/server.js`) :

```bash
cd d-aona-server && node server.js
# → http://localhost:8080  (ou http://<ip-locale>:8080 pour les autres appareils)
```

Le client communique avec le serveur via l'API REST (`/api/*`) et le WebSocket
(`/ws`) : auth, matchmaking, parties temps réel, amis, chat, wallet, tournois.

## Ce que couvre la maquette (cartographie PRD)

| Écran / flux | PRD |
|---|---|
| Auth (téléphone/email/Google, note OTP & compte unique) | §2.2, §7.1 |
| Accueil : wallet, tournoi à la une + countdown, jeux, top 5, activité | §7.1 |
| Jeux : Fanorona MVP (+ Katro « arrive bientôt »), modes Classé / Défi / Entraînement IA | §2.3, §2.5 |
| Formats Blitz 10 min · Rapide 60 min · Pro 2 h (Pro bloqué en matchmaking) | §2.4 |
| **Plateau Fanorona 9×5 jouable** : captures par approche/retrait, déplacement libre, prises en chaîne, IA comportementale (plafond de difficulté), pendules, journal des coups, abandon = forfait | §2.5, §19 (anti-triche), Glossaire |
| Matchmaking simulé ±200 Elo, élargissement progressif, 60 s max | §2.5 Mode 1 |
| Défi entre amis : mise optionnelle, lien partageable (WhatsApp/Messenger/SMS), expiration 15 min, commission 10% | §2.5 Mode 3, §8.1 |
| Entraînement IA : accessible sans KYC, aucun impact Elo/wallet | §2.5 Mode 4, §4.4 |
| Lien spectateur & lien d'invitation (parrainage +1 000 Ar) | §2.6, §16.3 |
| Système Elo (K=32), classement par place et badges (paliers de rang retirés), règles de saison | §3 |
| Classement national / provincial (podium + liste + carte personnelle, maquette « proposition 2 ») | §9 |
| Tournois : mise remboursable top 3, répartition 50/25/0 + commission 25%, bracket auto, **simulation complète** avec distribution et contrôle d'équilibre du pool | §2.5 Mode 2, §4.3 |
| Wallet : dépôt/retrait MVola · Orange Money · Airtel Money (~2% opérateur), 0% commission interne, retrait min 1 000 / max 500 000 Ar/j (plafond **appliqué côté serveur**), bonus de bienvenue non retirable, carte « Frais transparents » + historique **paginé et filtré par le serveur** (période, type, moyen, statut, recherche), fiche détail et export CSV | §4 |
| KYC par photo CIN obligatoire avant toute transaction réelle (flux simulé) | §4.4 |
| Skins et pions — **deux apparences par joueur** (une pour le camp clair, une pour le camp sombre), appliquées à **SES** pions selon le camp que le tirage lui donne : **forme × couleur × motif** indépendants (3 formes, 8 + 8 couleurs, 9 motifs — **4 illustrés** servis par `assets/pions/`, 5 silhouettes SVG), et l'adversaire garde la sienne — la vôtre ne l'habille **jamais** (elle voyage avec l'état du match) ; les familles « Plateau & effets » ne sont plus proposées (le catalogue et l'API d'achat restent, pour les achats existants) | §2.7, §8.1 |
| Chat textuel restreint aux contacts connus | §12 |
| Back-office admin (KPIs, file KYC, tickets service client, suivi dev) | §10, §11, §13 |
| Toasts sonores visuels : grain discret, animations, responsive mobile | §6.3 Design System |

## Arborescence

```
d-aona-web/
├── index.html               Application complète (SPA : design system, moteur
│                            Fanorona, client API/WebSocket, toutes les vues)
└── assets/
    ├── board/               Image du plateau de Fanorona
    ├── coins/               Les deux faces de la pièce du tirage au sort
    │                        (dessins vectoriels, cf. son README)
    ├── pions/               Les quatre motifs de pion illustrés — lémurien,
    │                        zébu, crocodile, ravinala (cf. son README)
    └── ad/                  Bandeaux publicitaires : celui du Profil (WebP officiel
                             + SVG de secours) et le carrousel de l'Accueil
                             (`pubs.json` + bannière maison, cf. son README)
```

Le design system est embarqué dans `index.html` : **thème Jour (défaut) et
thème Nuit OLED**, tokens motion/relief, écran « Bon retour » adaptatif
desktop/mobile, barre d'onglets lumineuse.

**Formes des tuiles — échelle unique (28/09/2026).** Une même famille de surface
portait jusqu'à **23 rayons différents** (5, 6, 7, 8, 9, 10, 12, 13, 14, 16, 18,
19, 20, 24, 26, 28, 30 px…) : deux cartes voisines ne se ressemblaient donc pas.
Une seule échelle les remplace, calquée sur la maquette de référence :

| Jeton | Valeur | Famille |
|---|---|---|
| `--r-sm` | 10 px | contrôles et rangées : boutons, champs, sélecteurs, boutons de date, pastilles carrées |
| `--r-md` (= `--radius-card`) | 16 px | **tuiles et panneaux** : `.panel`, cartes de jeu, défis, tournois, skins, bannière partenaire, wallet |
| `--r-lg` | 24 px | très grandes surfaces : héros, modales, carte d'authentification, barre d'onglets, scène `/play` |
| `--r-pill` | 999 px | pastilles, chips, segments, barres de recherche |
| `50 %` | — | cercles par nature : avatars, points, pions, **tuiles D / S / M / A** |

*Exceptions assumées* : les tuiles d'**icône** décoratives gardent un rayon
proportionnel à leur taille (`.pg-icon-card`, `.wb-mini`) — des pictogrammes, pas
des surfaces de contenu — et les formes **accrochées à un bord** (`.chat-pop`,
`.chat-panel`, `.chat-fab`, `.pod`, queues des bulles `.msg`) conservent un rayon
*partiel*, ajusté sur place.

*Mesure* : `node _shape_scan.js --no-var` (inventaire des rayons de la feuille)
et `_probe_formes.js` (rayon **effectif** relevé par le navigateur — 10 écrans,
deux thèmes, mobile 390 px, captures dans `graphify-out/formes/`).

**Revue UX/UI mesurée (23-24/09/2026)** — contrastes AA, gabarits 1440 / 390 / 360 px, thèmes
jour/nuit, cibles tactiles, accessibilité de base : rapport complet et lots correctifs dans
[`REVUE_UI_UX.md`](../../REVUE_UI_UX.md) (preuves : `graphify-out/revue-ui/` — 54 captures,
`mesures.txt` ; rejouable par `d-aona-server/_revue_ui.js`). **Les huit lots S1→S8 issus de la revue sont
appliqués** (§11 à §18 du rapport) : contraste AA **139 → 0**, cibles tactiles **77 → 65**, cliquables
rendus au clavier **236 → 0**, barre haute mobile **107 → 50 px**, surfaces de nuit détachées,
15 contenus internes retirés, tirage au sort non modal — devenu le 03/10/2026 un **lancer
plein écran joué AVANT la partie** (voir « Pièce du tirage au sort » ci-dessous).

**Couche système responsive (27/09/2026)** — le frontend est désormais piloté par une **échelle** et
des **bornes**, mesurées avant/après sur **192 relevés** (16 résolutions × 12 vues) par
`d-aona-server/_audit_responsive.js` (rapports : `graphify-out/audit-responsive/rapport-avant.md`
puis `rapport-apres.md` ; diff : `node d-aona-server/_audit_compare.js`). Ce que l'audit a révélé,
et ce qui a été corrigé :

| Défaut mesuré | Avant | Après |
|---|---|---|
| Zone de contenu à 2 560 px (aucune borne : `max-width: none`) | **2 500 px** | **1 608 px** |
| Gouttière au seuil de rupture 1080 → 1081 px | 30 px → **18 px** (saut de 12 px) | 17 px → **17 px** (continue) |
| Carte la plus large — Classement / Wallet / Amis / Notifications | 2 184 / 2 104 / **2 500** / 2 500 px | 1 275 / 1 215 / 1 619 / 1 619 px |
| Cartes étirées au-delà de 560 px | 9 vues sur 12 | 8 (les tableaux et listes gardent la largeur, à dessein) |
| Débordement horizontal (320 px, plateau) | 1 relevé (+20 px) | **0** |
| Bords de cartes hors grille — Skins | 5 | 4 |

Le système tient en trois décisions, toutes inscrites dans le CSS sous le titre
« COUCHE SYSTÈME RESPONSIVE » (fin de la feuille `index.html`) :

1. **Échelle d'espacement** `--sp-1..--sp-6` (4/8/12/16/24/32 px) et **rayons** `--r-s/--r-m/--r-l`.
   Les grilles de structure ne consomment plus de valeurs ad hoc : elles passaient de 7 `gap`
   différents (8, 9, 10, 12, 14, 16, 30) à trois crans de l'échelle.
2. **Conteneur unique** — une seule gouttière fluide `--gouttiere: clamp(14px, 1.6vw, 36px)` pour les
   deux régimes (flux et plein écran), et une borne haute `--contenu-max: 1680px` remplaçant
   `max-width: none`. Au-delà, ce sont les **grilles** qui ajoutent des colonnes, pas les cartes qui
   s'élargissent. « Jeux » et le Plateau conservent leur gabarit à 1 180 px (hauteur calculée et
   ratio 1647/955) — décision du 20/09 conservée.
3. **Colonnes latérales fluides** — les colonnes figées en pixels (280/300/320/330/380 px, soit 35 %
   de la largeur à 1 081 px et 15 % à 2 560 px) deviennent des fourchettes `minmax()`.

**Ce qui reste à faire** (mesuré, non traité) : les `gap` **internes aux composants** gardent des
valeurs hors échelle (7, 9, 10, 11, 14, 26 px — le Profil en compte 9 sur un même écran) ; la
normalisation est mécanique mais touche ~130 déclarations, chacune à vérifier visuellement. Les
listes « Amis » et « Notifications » occupent encore 1 619 px sur un écran de 1 920 px : elles
gagneraient à passer en grille de cartes, ce qui demande de revoir leur markup.


**Emplacement publicitaire du Profil (27/09/2026)** — la carte verte « Bannière Sample » (placeholder
de la maquette) devient un **visuel réel** : l'annonce « Yas, élu meilleur réseau mobile de Madagascar
— trophée nPerf 2025 ». Le visuel affiché est désormais **l'asset officiel du partenaire**,
`assets/ad/yas-nperf-2025.webp` (2 560 × 960, 247 Ko) ; le dessin vectoriel maison
`yas-nperf-2025.svg` ne sert plus que de **repli** si le WebP manque (cf.
[`assets/ad/README.md`](assets/ad/README.md)).

| Point | Décision |
|---|---|
| Visuel | `assets/ad/yas-nperf-2025.webp` — l'asset du partenaire, servi avec son vrai type (`image/webp` ajouté à la table MIME de `server.js`) ; repli `onerror` sur `…svg`, donc ni image cassée ni 404 en console |
| Placement | haut de la colonne droite, pleine largeur ; `#pf3-ad` et `#pf3-ad-close` inchangés (`_probe_profil_v3.js`) |
| Ratio | 2,67:1 conservé (`width: 100%`, `height: auto`) ; plafond `max-height: 420px` + `object-fit: cover` / `object-position: 50% 45%`, qui n'agit qu'au-delà de ~1 500 px d'écran et ne rogne que le ciel et le bois de la table |
| Lisibilité mobile | **traitée le 27/09/2026** : sous 560 px la boîte passe en **16:9 ancrée à gauche** (`aspect-ratio: 16 / 9` + `object-position: 0% 50%`) — à 390 px elle mesure 362 × 204 et la fenêtre source visible x 0 → 1707 / y 0 → 960 conserve tout le bloc informatif (titre, 5G, logo nPerf, médaillon, `www.yas.mg`) ; seul l'emblème `yas` du coin droit sort du cadre, à dessein |
| Déformation | nulle par construction : soit la boîte garde le ratio natif, soit le rognage est purement horizontal (cadrage mobile) ou vertical (plafond) — mesuré à 1 334 / 1 040 / 718 / 342 / 292 px **et** 362 px par `d-aona-server/_apercu_pub.js` (**42 contrôles**, `graphify-out/pub/`) |
| Transparence | pastille « Publicité » posée **sur** le visuel, fond sombre translucide : le contraste AA ne dépend pas des couleurs du partenaire |
| Lien | l'annonce ouvre `https://www.yas.mg` dans un nouvel onglet (`rel="noopener noreferrer"`) |
| ✕ | fermeture mémorisée sur l'appareil (inchangée) ; zone de touche portée de 26 à **44 px** par un pseudo-élément, sans changer le visuel |

**Carrousel publicitaire de l'Accueil (n° 4, 10/10/2026)** — le bloc de profil
« Saison 2 2026 » de la tête de l'accueil est remplacé par un **carrousel de
bannières**, et son contenu ne vit PAS dans le code : il est lu dans
[`assets/ad/pubs.json`](assets/ad/pubs.json), servi **sans cache** — l'équipe change
une campagne sans toucher à l'écran ni redémarrer le serveur. Deux bannières sont en
place : le partenaire **Yas** (l'asset existant, avec son repli SVG) et une bannière
**maison** (`assets/ad/d-aona-maison.svg`).

| Point | Décision |
|---|---|
| Contenu | `pubs.json` : `image`, `titre` (lu par les lecteurs d'écran), `lien`, `debut` / `fin` facultatifs. Fonction **pure** `App.pubsActives()` ; hors fenêtre de dates la bannière n'est pas affichée, et s'il n'en reste **aucune**, le bloc **n'est pas rendu** — pas d'espace vide |
| Gestes | défilement automatique toutes les 6 s ; **pause au survol, au focus et pendant un glissement** — trois états indépendants, car au relâchement le curseur est encore sur le carrousel (un seul booléen faisait repartir la rotation sous les yeux, et pouvait télescoper le geste) ; points cliquables ; **glissement horizontal** au doigt ; flèches sur desktop |
| Flèches | visibles **au survol seulement** (au clavier, `visibility` les sort de l'ordre de tabulation), 26 px bordées à 4 px. **Mesuré au pixel** : elles laissent 3 px au texte du partenaire (qui commence à 34 px du bord) et 15 px à la bannière maison ; la campagne rejoue cette mesure **sur chaque bannière servie** (`test_ui_scenarios.js`, S2) |
| Points | cible de **24 × 24 px** (WCAG 2.2) pour un point visible de 8 px (20 px allumé) : l'apparence ne bouge pas, seule la zone tapée grandit |
| Liens | chaque bannière ouvre son lien dans un **nouvel onglet** (`target="_blank" rel="noopener noreferrer"`) |
| Contraste | pastille « Publicité », fond sombre à **62 %** d'opacité : **5,8:1** mesurés (elle tombait à 4,47:1 à 55 %, relevé par `_revue_ui.js`) |

**Carte de saison de l'Accueil (n° 5, 10/10/2026)** — la carte de tournoi de la
colonne de droite laisse la place au **bloc de saison** de la maquette : fil d'Ariane
**cliquable** (« Wallet · tournois · jeux · classement »), saison, avatar, pseudo,
pastille d'**Elo** et **trois indicateurs** (parties jouées, victoires, solde wallet).
Toutes les valeurs viennent des **données réelles** du joueur connecté — rien n'est
codé en dur — et suivent la mise en forme du reste du site : séparateur de milliers
(espace fine) et unité « Ar ». Les tournois restent accessibles par le fil d'Ariane
(« tournois » ouvre l'onglet Tournois de l'écran Match) et par le bloc
« Mes tournois en cours », inchangé quand on est inscrit.

## Pièce du tirage au sort (28/09/2026 ; photos détourées le 03/10/2026 ; lancer plein écran le 03/10/2026 ; le gagnant prend les pions clairs le 03/10/2026)

La pièce du tirage au sort n'est plus dessinée en CSS (un rond doré portant le mot
« PILE » ou « FACE ») : ses **deux faces** sont les **photographies** de la pièce malgache
de **50 ariary (1992)** — `assets/coins/pile.webp` (étoile, couronne de laurier, « 50 »,
millésime) et `assets/coins/face.webp` (baobabs et devise *TANINDRAZANA · FAHAFAHANA ·
FAHAMARINANA*) — détourées : 192 × 192, fond transparent.

**Depuis le 03/10/2026, le résultat n'est plus une bande non modale** (lot S8, retirée) :
le lancer est un **voile plein écran `#coin-toss` joué AVANT le premier coup** — la pièce
vole 2 s en 3D (les deux faces se succèdent réellement), retombe sur la face tirée, puis
le verdict nomme les **deux camps** (qui a PILE, qui a FACE, qui commence). « Commencer »,
Échap, un clic sur le voile ou un repli à 12 s ferment l'annonce ; à la reprise d'une
partie (`animate:false`), rien ne se rejoue.

**Depuis le 03/10/2026, ce que le tirage désigne est aussi une COULEUR** : le gagnant prend les
**pions clairs** et joue le premier, le perdant joue les **pions sombres**. Le camp n'est plus un
point de vue — avant, chacun voyait toujours ses propres pions en clair — : `campOf()` le déduit de
`state.toss.starter`, le plateau porte `.clair` / `.sombre` (`.me` / `.opp` restent, eux, l'appartenance),
et chaque barre de joueur affiche sa pastille **Clairs** / **Sombres**, sans quoi le perdant ne
reconnaîtrait plus ses pions. Le voile le dit également sur chaque ligne (« pions clairs » sur la ligne
gagnante). Les **apparences**, elles, restent celles de chaque joueur : voir la section suivante — le skin
réglé pour un camp n'habille que **vos** pions (cf. `PION_CAMPS.who` pour le vocabulaire de la boutique).

### Les apparences de pions appartiennent au joueur, pas à la couleur (03/10/2026)

Le plateau porte **quatre** jeux de variables CSS — (moi | adversaire) × (clair | sombre) — que
`Fanorona.paintPionStyles()` écrit d'un bloc : les miens (`data-pion-color` / `data-pion-color-dark`,
sens **inchangé** pour les sondes qui les lisent) et ceux de l'adversaire (`data-pion-color-opp` /
`data-pion-color-opp-dark`), que `.piece.opp` rebinde sur les génériques. Régler un skin pour les clairs
n'habille donc **jamais** les pions clairs d'en face — c'était la fuite : le plateau ne portait que les
deux apparences du compte local, et la couleur seule décidait. Faute d'apparence connue (IA
d'entraînement, adversaire sans compte), le repli est le **pion Vato**, jamais le vôtre.

L'apparence de l'adversaire ne peut venir que de l'**état du serveur** (`getState().player1/2.pionStyles`,
posés par `createGameSession()` depuis `pion_style`) : le client ne connaît pas le compte d'en face, et un
**spectateur** n'est ni l'un ni l'autre joueur — il reçoit P1 à « moi » et P2 à « adversaire », comme les
barres. Tant que le match dure, un passage en boutique n'écrase pas ces apparences (`serverStyles`) ; en
quittant, le plateau revient à MON apparence de compte (un spectateur ne garde pas celle de P1).

| Point | Décision |
|---|---|
| Rendu | `#coin-air` empile **deux** plans 3D (`coin-front` / `coin-back`, un `<img>` par face) ; en vol, la classe `pile` / `face` fixe l'angle d'arrivée (1080° / 1260°) et, à l'atterrissage, `.landed` coupe l'animation et montre par `display` le plan de la face tirée — mesuré : une rotation **animée** aplatit la 3D dans Chromium et rendait la face avant en miroir, d'où l'arrivée pilotée par `display`, insensible au moteur. Aucun texte de pièce n'est stylé : le voile ne peut pas montrer une autre face que celle qu'il annonce |
| Choix des faces | chaque bouton de la modale porte l'**image** du côté qu'il désigne (56 px) : le joueur voit la pièce qu'il choisit, au lieu des emojis 💙 / ✋ qui ne correspondaient à aucun dessin |
| Convention | **PILE** = le côté où la valeur est écrite en chiffres (le « 50 »), **FACE** = le côté du décor national (baobabs, devise). Elle est dite en clair dans la modale **et** dans les règles du jeu, et s'inverse en échangeant les deux attributs `src` |
| Camps | **le gagnant du tirage prend les pions CLAIRS** et commence : `campOf()` (dans `renderPieces()`) lit `toss.starter`, le CSS peint `.piece.clair` / `.piece.sombre`, chaque barre affiche sa pastille `Clairs` / `Sombres` (`updateCamps()`), et le voile écrit le camp de chaque ligne. Les **apparences** ne suivent pas la couleur mais le **propriétaire** : `paintPionStyles()` écrit les quatre jeux (`-dark` pour moi, `-opp` / `-opp-dark` pour l'adversaire) depuis les apparences des deux comptes, publiées par `getState()` |
| Provenance | **photographies** fournies par le joueur, prises sur fond noir opaque ; détourées par `d-aona-server/_coin_prep.js` (Chromium + `<canvas>` — le projet n'a ni `sharp` ni `jimp` : seuil d'Otsu, flood fill du fond depuis les bords, plus grande composante, érosion 2 px, recadrage carré, 192 px, rampe d'alpha, puis **décontamination du contour**, sans quoi un liseré noir restait collé à la pièce). Les sources ayant été retirées du disque, ces deux fichiers sont la seule copie : cf. [`assets/coins/README.md`](assets/coins/README.md) |
| Format | **WebP** à canal alpha — 13,2 Ko (pile) + 12,0 Ko (face), cinq fois moins que les PNG équivalents ; `.webp` et `.svg` étaient déjà servis par `server.js` |
| Tailles | fichier de 192 px ; affiché à **112–184 px** en vol (`clamp(112px, 26vw, 184px)`), 56 px sur les boutons du choix et 40 px dans les lignes d'attribution |
| Vérification | `d-aona-server/_coin_verif.js` — contrôles **P1 à P9** : deux faces chargées et distinctes, **quatre coins transparents et centre opaque** (la forme octogonale vient de l'image : sans transparence, un carré s'afficherait autour de la pièce), face montrée = face annoncée (tirage rendu déterministe, **PILE** puis **FACE**), deux attributions nommées dont un seul « commence », pièce en vol ≥ 112 px, fermeture par « Commencer », pas de rejeu à la reprise (`animate:false`), hit-test P9 sur le plan rendu, **aucun 404**, zéro erreur JavaScript. L'arbitrage inversé (plateau bloqué pendant le voile, cliquable après) et la règle des camps sont rejoués par `d-aona-server/_s8_verif.js` (**31 contrôles** : deux issues déterministes du tirage vérifiées **sur le plateau** — 22 pions clairs / 22 sombres, jamais de mélange — et **neuf contrôles V8** sur les apparences de pions, le skin clair d'un compte ne devant habiller les pions de l'adversaire **ni en couleur ni en motif**) |

### Les motifs de pion : quatre illustrations à DEUX dessins, cinq silhouettes (03/10/2026 · 04/10/2026)

Le catalogue `PION_PATTERNS` porte **deux familles** de géométrie, jamais les deux à la
fois pour un même motif :

- **silhouette** (`svg`) — caméléon, PRA, pangalatra, lefona et `aucun` : un tracé
  24 × 24 embarqué dans `index.html`, posé en `mask-image` et peint à l'**encre** de la
  couleur choisie (`--pion-ink`), donc lisible sur « Blanc » comme sur « Noir » ;
- **image** (`img` / `imgDark`) — **lémurien, zébu, crocodile, ravinala** : le PNG
  détouré de `assets/pions/` (256 × 256, fond transparent, servi tel quel) est posé en
  `background-image` et peint **tel quel**, à ses propres couleurs (les yeux orange du
  lémurien, le vert du ravinala et du crocodile). Un masque resterait collé au contour
  de la silhouette du même nom et rognerait l'illustration : il vaut donc `none`
  (`--pion-motif-img` remplace `--pion-mask`, `--pion-motif-ink` passe à `transparent`).
  **Le dessin suit le camp** : `img` (lot `Assets-premiere-version`, extrait des pions
  blancs) habille les pions clairs, `imgDark` (lot `Assets-noirs-contraste-initial`,
  extrait des pions noirs de la même planche) les sombres — deux dessins distincts du
  même sujet (le zébu sombre est blanc-dominant là où celui des clairs est noir-dominant).

`mountPionStyles()` génère les deux familles dans les **quatre** jeux de variables
(moi | adversaire × clair | sombre), si bien que l'aperçu, les vignettes de la boutique
et le plateau consomment exactement les mêmes règles : c'est le **groupe du jeu** qui
choisit le fichier (suffixes clairs → lot clair, suffixes sombres → lot sombre), donc
l'onglet « Pions sombres » montre bien le dessin sombre, sur le plateau comme dans
l'aperçu. Le premier lot prévenait que « les parties sombres peuvent manquer de contraste
sur un pion noir » : le second lot répond précisément à cet avertissement, sans qu'aucun
contour ait été ajouté aux dessins.

**Vérification.** `d-aona-server/_pions_verif.js` — **54/54**, 0 erreur JS : les **huit**
fichiers servis en 200 / `image/png` / 256 × 256 avec leurs quatre coins d'alpha nul, la
peinture par `background-image` **sans masque ni encre** pour les quatre motifs **dans les
deux camps** (l'onglet clair peint le lot initial, l'onglet sombre `<motif>-sombre.png` —
aperçu ET vignette de la carte), les deux dessins d'un même motif vérifiés **différents**
(octets, pixels et poids), la silhouette témoin `lefona` toujours en masque SVG, `aucun`
neutralisé sur les trois couches, les 20 règles image de la feuille générée (chacune avec
le dessin de son camp), et la peinture **sur le plateau** pour mon camp et celui de
l'adversaire (captures dans `%TEMP%\daona_shots\pions-*.png`). Provenance, poids,
empreintes et refaire la copie : [`assets/pions/README.md`](assets/pions/README.md).

### La FORME du pion : ronde, carrée, triangulaire (13/10/2026)

Troisième **axe indépendant** de la personnalisation, à côté de la couleur et du
motif, et réglé **par camp** comme eux : `pion_style` gagne une colonne `shape`
(migration `014_pion_style_shape.sql`, `NOT NULL DEFAULT 'ronde'`) — un compte qui
n'a rien choisi garde donc **exactement** la silhouette d'avant, et une base
restaurée depuis une sauvegarde antérieure reste lisible.

| Forme | Rayon | Découpe | Anneau (sélection / « jouable ») |
|---|---|---|---|
| Ronde | `50 %` | aucune | autour du pion (`inset: -14 %` / `-16 %`) |
| Carrée | `22 %` | aucune | autour, coins arrondis |
| Triangulaire | `0` | `polygon(50% 2%, 98% 96%, 2% 96%)` | **à l'intérieur** (`+12 %`), sinon la découpe l'emporterait |

Le triangle n'existe que par **`clip-path`** : la découpe **rogne les enfants** (le
motif et l'anneau suivent donc la forme) et **emporte la `box-shadow`** du pion —
l'ombre est donc **reposée** en `drop-shadow`, qui épouse la silhouette. Les
impulsions de refus et d'indice, qui n'étaient qu'une `box-shadow`, reçoivent le même
halo : sur un pion triangulaire elles resteraient sinon invisibles. Une forme tient
en six valeurs, générées par `mountPionStyles` sous les **quatre jeux de variables**
(mes pions clairs et sombres, ceux de l'adversaire) : 3 formes × 4 = **12 règles**,
mêmes suffixes que la couleur. La boutique gagne un panneau **« Forme — <camp> »**
(trois vignettes de pion nu sur **monture blanche**, comme les motifs) et le résumé
porte trois lignes : Forme, Couleur, Motif.

**Ce qui a été retiré.** Les familles **« Plateau & effets »** ne sont plus proposées
(demande de terrain) : leur vitrine (`.skc`, reflet au survol, tags, achat/équipement)
et ses helpers sont supprimés au profit des formes. Le catalogue, l'achat
(`/api/skins/buy`) et l'équipement (`/api/skins/equip`) restent en place côté
serveur : **aucun achat passé n'est perdu**, les comptes qui possèdent un plateau ou
un effet les gardent en base.

**Vérification.** Campagne API **277/277** (+10) : catalogue des trois formes, défaut
`ronde` par camp, écriture par camp, forme inconnue refusée (400), **forme conservée
quand l'appel n'en porte pas** (compatibilité d'un client d'avant), persistance,
étanchéité par compte, trois axes présents dans l'apparence relayée au plateau. Sonde
dédiée : rayon et découpe **mesurés** par forme, enregistrement puis relecture après
rechargement complet, deux camps indépendants, et **sur une vraie partie
d'entraînement IA : les 22 pièces du camp clair rendues en `polygon(…)`, les 22 du
camp sombre en `none`** — 0 erreur JS.

## Classement — l'organisation de la maquette « proposition 2 » (13/10/2026)

Le **podium passe en tête**, pleine largeur, et porte le **sélecteur de portée**
(🇲🇬 MG National / 📍 Province) : c'est lui qui gouverne tout l'écran — podium, liste
et carte personnelle. Trois marches de hauteurs croissantes (62 / 44 / 34 px mesurés),
médailles, avatar (photo réelle), pseudo cliquable, province, badge de rang et Elo ;
un bandeau de pied rappelle que le classement est actualisé après chaque match et
situe la portée (« Madagascar · toutes les provinces » ou « Province d'Analamanga »).

En dessous, **deux colonnes** :

| Colonne | Contenu |
|---|---|
| **Le classement** (la plus large) | compteur des joueurs **affichés**, recherche dépliable (inchangée), pastille de portée, en-tête `# / Joueur / Elo`, rang sur deux chiffres, badge sur chaque ligne, pied « Saison 2 · classement … » et bouton **« Voir tous les joueurs »** (désactivé quand tout est déjà affiché, sinon il revient au national complet) |
| **Votre classement** | identité + badge, **ELO ACTUEL** et rang (national, ou provincial recalculé), **progression vers le prochain palier**, trois statistiques, note de calibration, « Voir mon profil » (ouvre l'écran Profil) et partage (`copyLink`) |

**Données réelles uniquement.** Elo, rang, parties jouées et victoires viennent du
classement serveur ; le **palier** est le multiple de 50 suivant (les rangs nommés ont
été retirés le 20/09) ; le **delta sur 30 jours** est lu sur les instantanés de parties
(`eloSeries("M")`, la même source que la courbe du Profil) et s'affiche « — » quand la
fenêtre ne contient pas deux parties suivies.

**Décisions assumées.** La colonne latérale disparaît (la carte personnelle passe à
droite, et **en premier** en une seule colonne à ≤ 1080 px, comme la maquette mobile) ;
la colonne 🏅 du tableau disparaît (les médailles vivent sur le podium) ; le
**sélecteur de saison de la maquette n'est pas repris** — le serveur ne connaît qu'un
Elo, sans historique par saison : un bouton sans effet serait un mensonge (la pastille
de saison du bandeau d'écran reste).

**Vérification.** Campagne UI **126/126** ; captures jour / portée Province / nuit /
mobile 390 : 0 débordement, marches 44 / 62 / 34 px, 3 colonnes de tableau, compteur
« 19 joueurs », carte personnelle avant la liste en mobile, 0 erreur JS.

## Statistiques du Profil et courbe de progression Elo (27/09/2026)

La carte d'identité porte **trois statistiques** (Elo · Parties · Rang) puis une **rangée
secondaire** sous un filet (Gagné · Défaite) ; la carte **Courbe Elo** trace la progression
depuis les **instantanés réels** de `games` (migration `006`), avec les périodes
**D / S / M / A** (« A » par défaut).

| Point | Décision |
|---|---|
| Source | `elo1_before/after` et `elo2_before/after`, écrits à la fin de chaque partie ; l'interface n'invente jamais un point — une partie sans instantané reste « Données indisponibles » |
| Ordre du tracé | chronologique **explicite** : tri par date **puis** par identifiant de partie (`eloSeries`), sinon deux parties du même jour feraient varier l'ordre |
| Périodes | fenêtre calculée sur la **date réelle** de chaque partie ; une fenêtre vide affiche « Aucune partie suivie… », et un compte à moins de deux points « Pas encore de courbe… » |
| Statistiques | Elo / Parties / Gagné / Défaite viennent de `/api/user`, le rang du classement réel ; l'invariant `Parties = Gagné + Défaite` est contrôlé par la sonde |
| Profil public | mêmes 3 + 2 statistiques pour le joueur consulté, **sans** courbe (bloc privé) |
| Vérification | `_probe_elo_stats.js` — **31 contrôles** : valeurs = API, un point par partie suivie, géométrie du tracé ≤ 0,75 px, filtres D/S/M/A, états vides, thèmes jour/nuit ; `_dbg_elo.js` mesure l'écart point ↔ tracé |
| Données antérieures | les parties jouées avant la livraison de la migration `006` n'ont pas d'instantané : `_backfill_elo.js` les reconstitue depuis `users.elo` + les écarts enregistrés (mesure seule par défaut, écriture après sauvegarde vérifiée) ; `_sync_compteurs.js` réaligne `users.wins/losses` sur l'historique |
| Volume affiché | `/api/games/history` sert au plus **50 lignes** : la période « A » de la courbe montre donc **au plus 50 points**, même pour un compte à 188 parties |
| Jeu de test | `_seed_parties_elo.js` étoffe l'historique d'un compte (par défaut « Ny Angola », porté à **50 parties**, 912 → 1084) sans toucher aux données existantes : insertion **avant** la plus ancienne partie, ancre sur `users.elo`, adversaire dédié et manifeste d'annulation |

## Limites

- Les paiements (MVola, Orange Money…) restent des simulations à but démonstratif.
- Le back-office admin affiche des données de démo.
