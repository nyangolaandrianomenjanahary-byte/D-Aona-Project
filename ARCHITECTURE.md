# ARCHITECTURE - D-Aona

## Principe

Un jeu = un dossier autonome. Un fichier = une responsabilite. Le socle
(serveur, hote, interface) ne connait AUCUN jeu par son nom : il lit un
registre et parle aux contrats ci-dessous.

## Arborescence cible

    D-aona/d-aona-web/
      index.html              coquille (< 200 lignes)
      variant-match.js        hote leger des variantes locales (Telo, Dimy)
      styles/                 jetons, base, mise en page, ecrans
      app/                    core, net, ui, screens, boot.js
      games/<slug>/           manifest.json engine.js ai.js board.js ui.js README.md test.js
    d-aona-server/
      server.js               amorcage (< 250 lignes)
      live/                   state.js, matchmaking.js
      game/                   host.js, elo.js, registry.js
      http/                   routes par domaine
      games/<slug>/           moteur autoritaire (engine, session, manifest)
      test/                   ui/parts, ui/build.js, matchmaking.js, structure.js

## Contrat 1 - manifest.json

    {
      "id": "fanoron-telo",
      "family": "fanoron",
      "name": "Fanoron-Telo",
      "board": { "rows": 3, "cols": 3, "topology": "grid" },
      "players": { "pawns": 3 },
      "phases": ["placement", "movement"],
      "captures": false,
      "eloKey": "fanoron-telo",
      "formats": ["blitz", "rapide", "pro"]
    }

## Contrat 2 - moteur

    createState(opts) -> state
    legalMoves(state) -> [move]
    isLegal(state, move) -> bool
    applyMove(state, move) -> { ok:true, state } | { ok:false, error }
    status(state) -> { over, winner, reason, line }
    key(state) -> string        (cle de repetition, pour la nulle)
    ai.chooseMove(state, { level, budgetMs, rng }) -> { move, score, nodes }

Forme des coups : { type:"place", to } | { type:"move", from, to }.
Le moteur ne connait ni horloge, ni compte, ni reseau, ni DOM.

## Contrat 3 - interface

    L hote possede mise en page, horloge, chat, spectateurs, resultat.
    Le module de jeu recoit { state, mySide, onMove } et rend son plateau.
    board.js : geometrie + rendu, aucune regle.
    ui.js    : interaction (selection, validation), aucune regle.

## Ajouter un jeu en 6 etapes

1. Creer D-aona/d-aona-web/games/<slug>/ avec les 7 fichiers.
2. Ecrire manifest.json (identite, plateau, phases, formats).
3. Ecrire engine.js (contrat 2) et le couvrir par test.js.
4. Ecrire ai.js (chooseMove) - niveau et budget injectables.
5. Ecrire board.js et ui.js (contrat 3).
6. Ajouter UNE ligne au registre. Aucune autre modification du socle.

## Choix d une variante (entree « Fanorona »)

Le catalogue ne contient toujours qu un jeu, `fanorona`. L etape 1 de
l assistant ouvre un DIALOGUE DE VARIANTES (Tsivy 9x5, Dimy 5x5, Telo 3x3) :

- `FANORON_VARIANTS` (index.html) declare, pour chaque plateau, ses modes
  disponibles. Le Tsivy garde `online`, `defi`, `ai` ; Dimy et Telo exposent
  `ai` et `local2p` (deux joueurs sur un ecran).
- Le choix filtre l etape 2 : aucun mode non tenu n est propose, donc
  l assistant ne peut pas lancer une partie en ligne sur une variante qui
  n a pas encore de session serveur.
- `launchGame()` aiguille : Tsivy -> moteur historique ; Dimy/Telo ->
  `VariantMatch.open({ game, mode })`.

`variant-match.js` est de la GLUE : il monte l ecran (joueurs, plateau,
statut, regles), branche `ui.createController` du dossier de jeu et fait
jouer `ai.chooseMove`. Il n implemente aucune regle et ne connait ni App ni
le reseau ; chaque coup passe par `engine.applyMove`.

## Etat reel (verifie par test/structure.js)

- Fanoron-Telo : dossier complet, autonome, harnais vert ; JOUABLE dans
  l application (IA et deux joueurs).
- Fanoron-Dimy : dossier complet (5x5, prises approche/retrait), harnais
  vert ; JOUABLE dans l application (IA et deux joueurs).
- Fanoron-Tsivy : moteur eclate cote serveur (engine, session, manifest)
  et facade game.js ; board.js et ui.js restent encore dans index.html (lot T5).
- Variantes : pas encore de session serveur ni de matchmaking pour Dimy et
  Telo (lot a cadrer). Les modes en ligne ne sont donc pas proposes.
- Socle : server.js 1709 lignes (objectif 250), index.html mono-fichier
  (objectif : coquille). Voir PLAN-REFONTE.md pour l ordre des lots.

## Regle de verification

Aucun lot n est declare termine sans : node --check, exports inchanges, npm test,
campagne UI, git diff --stat conforme. Voir PLAN-REFONTE.md.