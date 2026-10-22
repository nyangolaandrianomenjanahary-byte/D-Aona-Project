# PLAN DE REFONTE - D-Aona

Objectif : un jeu = un dossier autonome, un fichier = une responsabilite.
Pilote par un orchestrateur (chef-refonte) et six agents specialises, avec
verification obligatoire apres chaque lot.

## Definition de fin (DoD)

1. Un dossier par variante : manifest.json, engine.js, ai.js, board.js, ui.js, README.md, test.js.
2. Aucune duplication de moteur : le serveur require() la copie web.
3. Aucun identifiant de jeu en dur dans le socle (registres uniquement).
4. Aucun fichier de production au-dela de 400 lignes.
5. index.html : coquille de moins de 200 lignes.
6. server.js : moins de 250 lignes.
7. npm test et la campagne UI verts, compteurs au moins egaux a la reference.
8. ARCHITECTURE.md decrit les deux contrats.

## Etat des lots

| Lot | Objet | Etat | Preuve |
|-----|-------|------|--------|
| T0 | Reference (baseline) | VERT | npm test 18 s, RESULTAT : TOUS LES TESTS PASSENT ; S3+SX 10/10 |
| T1 | Hygiene du depot | VERT | 14 morceaux dans test/ui/parts, build.js regenere le harnais a l identique (git diff vide) ; 101 scripts jetables dans tools/ (ignore) |
| T2 | Moteur Tsivy hors de game.js | VERT | exports identiques (9 cles), npm test vert, S3 10/10 |
| T3a | Etat partage + files jeu/format | VERT | 8 Maps retirees, test/matchmaking.js vert, npm test vert |
| T3b | game/host.js (sessions, horloges, Elo) | A FAIRE | |
| T3c | ws/handler.js (switch WebSocket) | A FAIRE | |
| T3d | http/routes/* (handleRest, 650 lignes) | A FAIRE | |
| T3e | tournaments/* (bracket, avancement) | A FAIRE | |
| T3f | server.js sous 250 lignes | A FAIRE | |
| T4 | Coquille web + modules ES | A FAIRE | |
| T5 | Plateau Tsivy extrait du index.html | A FAIRE | |
| T6 | Dossier Telo autonome | VERT | 7 fichiers, node test.js : TOUS LES TESTS PASSENT |
| T7 | Dossier Dimy | VERT | 7 fichiers, node test.js : 85/85 ; dialogue des variantes + partie 5x5 verifies en navigateur (sonde) |
| T8 | Docs + garde-fou structurel | VERT | ARCHITECTURE.md + test/structure.js : bloque un dossier de jeu non conforme, liste la dette de taille |
| T9 | Entree par variante dans l assistant | VERT | clic Fanorona -> dialogue 3 plateaux ; modes filtres par variante ; Telo et Dimy jouables (IA + 2 joueurs) ; Tsivy inchange |

## Contrats geles

### 1. manifest.json

    id, family, name, board { rows, cols, topology }, players { pawns },
    phases [placement|movement|play], captures (bool), eloKey, formats [blitz|rapide|pro]

### 2. Contrat moteur (ce que le socle attend d un jeu)

    createState(opts) -> state
    legalMoves(state) -> [move]
    isLegal(state, move) -> bool
    applyMove(state, move) -> { ok, state } | { ok:false, error }
    status(state) -> { over, winner, reason, line }
    key(state) -> string
    ai.chooseMove(state, { level, budgetMs, rng }) -> { move, score, nodes }

### 3. Contrat interface (ce qu un module de jeu recoit)

    L hote possede mise en page, horloge, chat, spectateurs.
    Le module de jeu ne recoit que { state, mySide, onMove } et ne connait
    ni le reseau ni les comptes.

## Troupe d agents

.claude/agents/ (non versionne) : chef-refonte, intendant-depot, moteur-serveur,
hote-serveur, extracteur-web, greffier-jeux, documentaliste + code-reviewer
(installe via claude-code-templates). Chaque agent ecrit dans un perimetre
strict et rend un rapport Portee / Objectifs / Preuves / Ecarts / Non-verifie / Etat.

## Boucle de verification (apres CHAQUE action)

1. node --check sur chaque fichier touche.
2. node -e require(...) pour prouver que les exports n ont pas bouge.
3. npm test (4 suites).
4. node test_ui_scenarios.js (campagne ou scenario cible).
5. git diff --stat : la portee reelle doit egaler la portee declaree.
6. Un commit par lot ; git revert doit passer sans conflit.

## Ecarts assumes

- T1 : data.js (286 lignes, purement declaratif) n a pas ete eclate en data/*.js.
  Il respecte deja la limite de 400 lignes ; le decoupage aurait fait courir un
  risque de transcription sur 34 exports sans gain structurel. A reprendre si un
  fichier doit etre < 150 lignes.
- T2 : games/fanoron-tsivy/ reste cote serveur (CommonJS) ; sa consolidation
  dans D-aona/d-aona-web/games/ est prevue au lot T5, avec un moteur UMD.
- S6 (spectature) est ROUGE avant et apres refonte : defaut preexistant, mesure
  par stash sur le commit b1b0bf4. Il ne compte donc pas comme regression.
- T7 : le plateau Dimy est ecrit en 5x5 — lecture retenue de « fanoron-dimy »
  (dimy = cinq) — avec 12 pions par camp (deux rangees pleines, centre vide),
  prises par approche/retrait et AUCUNE chaine de prise. Ces trois points sont
  consignes dans games/fanoron-dimy/README.md : a confirmer par le referent jeu.
- T9 : Telo et Dimy n ont pas encore de session serveur. Ils sont jouables
  contre l IA et a deux sur un ecran (aucun Elo, aucun wallet) ; les modes
  « En ligne » et « Defi » ne leur sont donc PAS proposes, et le choix de la
  variante filtre l etape 2. Le matchmaking inter-variantes reste a cadrer.
- T9 : les vignettes de plateau du dialogue n affichent pas les diagonales
  (illisibles a 58 px). La geometrie complete reste dans board.js et sur le
  plateau joue ; c est un choix d affichage, pas une simplification du jeu.

## Reste a faire, dans l ordre

T3b -> T3c -> T3d -> T3e -> T3f -> T4 -> T5 -> (T7 apres confirmation de la
geometrie Dimy) -> T8 final (compteurs de campagne UI >= reference).