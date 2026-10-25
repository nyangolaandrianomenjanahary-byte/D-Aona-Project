# ARCHITECTURE - D-Aona

## Principe

Un jeu = un dossier autonome. Un fichier = une responsabilite. Le socle
(serveur, hote, interface) ne connait AUCUN jeu par son nom : il lit un
registre et parle aux contrats ci-dessous.

## Arborescence cible

    D-aona/d-aona-web/
      index.html              coquille (< 200 lignes)
      variant-match.js        hote leger des variantes locales (Telo, Dimy),
                              embarque a l etape 4 de l assistant (option `host`)
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

    UN SEUL systeme de plateau pour les fanorona : `games/fanorona-board.js`
    (treillis grave, pions poses SUR les intersections, cibles de clic qui
    couvrent le plateau, habillage de pion `--pion-*` du compte). Le board.js
    d une variante ne fournit que sa GEOMETRIE — `create({ rows, cols,
    topology })`, ou `topology` dit EXACTEMENT quelles diagonales le moteur
    autorise : "strong" (Dimy, points forts) ou "main" (Telo, les deux grandes
    diagonales). Un plateau bati sur ce module ne peut donc pas montrer une
    ligne impraticable, ni un pion sans le skin du joueur.

## Contrat 4 - session autoritaire (serveur)

    new GameSession(sessionId, player1, player2, mode, format, wager)
    getState()        -> etat complet publiable (plateau, joueurs, horloge)
    getLegalMoves()   -> coups du joueur au trait
    applyMove(move)   -> { ok:true, gameOver?, winner?, reason?, state } | { ok:false, error }
    resign(playerNum) -> { ok:true, gameOver, winner, reason, state }
    tickClock()       -> null | { gameOver, winner, reason }
    finish(winner)    -> { winnerId, delta1, delta2 }   (0/0,5/1 : la nulle compte)
    piecesLeft(side)  -> entier

`d-aona-server/games/registry.js` associe `<id>` -> module du jeu. Le socle ne
nomme aucun jeu : `createGameSession(..., game)` demande la session au registre
et pose `session.game` sur l instance. Un identifiant inconnu retombe sur le
jeu par defaut (Tsivy) — jamais sur une session d un autre plateau.

- Les REGLES ne sont ecrites qu une fois : le dossier de jeu de l interface
  (`D-aona/d-aona-web/games/<slug>/engine.js`) a un pied UMD, donc le serveur
  le `require()`. `d-aona-server/games/<slug>/engine.js` est une facade de deux
  lignes, exigee par `test/structure.js` — aucune copie des regles.
- L Elo est UN seul bareme (celui du moteur Tsivy) et UNE seule colonne
  (`users.elo`) : les trois plateaux partagent le classement. `games.game` et
  `challenges.game` (migration 015) disent seulement sur QUEL plateau la partie
  ou le defi s est joue.
- `game` voyage avec `game_start`, `game_state`, `game_end` : le client peint le
  plateau recu, sans deviner ce qu il croyait lancer (reprise, rechargement,
  defi recu). `game_state` porte AUSSI `playerNum` : le camp joue ne se deduit
  plus de l ordre d arrivee des messages.

## Contrat 5 - REPRENDRE une partie (identique pour tous les jeux)

Reprendre n est pas un mode de jeu : c est le meme chemin qu une partie neuve,
rejoue sur un etat deja avance. Un seul contrat, deux verrous de test.

SERVEUR (aucun plateau nomme) :

    sync_game { sessionId? }  -> game_state { sessionId, game, playerNum, state }
                              -> no_active_game            (rien a reprendre)
    auth (reconnexion)        -> game_state ...             (publication d office)
    game_end                  -> result.game                (le plateau du resultat)

  - `findUserSession(userId)` retrouve la session en cours du joueur (la plus
    recente) : c est lui qui rend la reprise possible APRES UN RECHARGEMENT, ou
    le client a tout oublie. La deconnexion laisse un delai de grace (20 s)
    avant l abandon : recharger ne perd pas la partie. Ce delai est arme PAR
    PARTIE (cle `joueur|session`) : un joueur peut avoir deux parties vivantes,
    les deux doivent s eteindre — sinon la seconde restait figee pour toujours,
    adversaire compris.
  - `dispatchGameState()` publie `game` + `playerNum` aux DEUX joueurs : le
    client sait quel plateau peindre et quel camp il tient. C est le SEUL
    emetteur d etat : aucun autre `type: "game_state"` dans le socle, et le
    spectateur (`spectate_state`) recoit le meme `game`.
  - `getState()` rend une COPIE : muter l etat publie ne touche pas la partie
    (le socle le stocke en base et le met sur le reseau).

PERSISTANCE (la partie survit a un REDEMARRAGE du serveur) :

    state_json          = { v: 1, session: <instantane de la session> }
    persistSession()    a la creation, a chaque coup / fin de chaine / choix de
                        face / coup de l IA, et toutes les 20 s (horloge)
    rehydrateSessions() au demarrage, AVANT l ecoute :
                        Object.create(<Session du registre>.prototype)
                        + Object.assign(instantane)

  - l instantane n est PAS l etat publie : `getState()` omet les champs INTERNES
    du jeu (choix du tirage, chaine de prises, horloge reelle). Le socle ne
    connait aucun de ces champs — il photographie la session et la reconstitue a
    l identique, donc tout plateau futur est repris sans une ligne de plus.
  - une ligne dont l instantane est illisible, d un ancien format, ou d un
    plateau absent du registre est close en `abandoned` : on ne devine jamais
    une partie a moitie (le client recoit `no_active_game`).
  - les horloges ne repartent pas seules : `gameLoop` ne fait tic-tac que si le
    joueur au trait a une socket ouverte. Une partie rechargee sans personne en
    ligne reste figee jusqu au retour d un joueur — un redemarrage ne consomme
    pas le temps des absents.


INTERFACE (un seul point par plateau) :

    FANORON_VARIANTS[i].screen = "board" | "play"
        l ecran ou ce plateau se JOUE : #/board (plateau historique Tsivy) ou
        #/play (carte de jeu de l assistant, tenue par VariantMatch)
    S.currentSession / S.currentGame      la session ET son plateau
    ecranDeJeu(game)  -> ecran declare     (le socle ne teste aucun identifiant)
    resumeGame()      -> route vers cet ecran, puis sync_game
    retenirSession()  -> adoption SILENCIEUSE (rechargement) : bandeau seul
    detacherLive()    -> quitter l ECRAN sans quitter la PARTIE
    route()           -> detache AUSSI (historique du navigateur) : un minuteur
                         d IA ne joue jamais hors champ

  Une reprise emprunte donc `game_state` comme une partie neuve ; seule
  l intention change (`naviguer === false` = retenir l etat sans deplacer le
  joueur). Pour une partie locale (entrainement), c est `playLive.state` qui
  survit — `VariantMatch.open({ onState })` le tient a jour, et l ecran se
  remonte a l identique. `VariantMatch.open` REARME le tour de l IA : une
  partie locale reprise au tour de l adversaire continue, elle ne reste pas
  bloquee sur « L IA reflechit… ».

  Une partie LOCALE survit aussi a un RECHARGEMENT DE PAGE (F5) : `playLive` est
  recopie sur l appareil a chaque etat (`localStorage`, cle
  `daona_partie_locale`, version 1 : plateau + etat publie) et relu au demarrage.
  `hasActiveGame()` la voit donc, et le bandeau « Reprendre » la remonte — aucun
  serveur, aucun message, meme geste que pour une partie classee. Une partie
  TERMINEE efface la copie : « Reprendre » ne propose pas un plateau fini.

  Les SORTIES ne detruisent plus une partie : `renderPlay()` et les pastilles
  DETACHENT (`detacherLive`), la fleche de sortie CONSERVE la partie locale
  (seule une partie EN LIGNE demande confirmation : elle appartient aux deux
  joueurs), et `quitterLive()` reste le seul geste qui efface — reserve a
  « Nouvelle partie » et a l abandon assume. Le resultat d une partie locale
  s affiche dans le bandeau de titre de la carte (aucune modale de fin ne la
  concerne). `estSurLEcranDeJeu()` ne compte une variante que si son plateau est
  REELLEMENT monte (`playLive.ecran`), pas si l assistant affiche son
  recapitulatif.

OBLIGATOIRE (present et futur) :

  - `test/variantes.js` boucle sur `Registry.ids()` : etat publiable
    (game, turn, over, mode, format, clock, moves, player1/2, opponent, wage,
    plateau board|grid), instantane PUR (deux lectures identiques), horloge des
    deux camps seulement, `session.game` publie ;
  - `test/structure.js` : chaque `games/<slug>/session.js` pose
    `this.game = "<slug>"` et publie `game: this.game` ; chaque entree du
    catalogue declare `screen`.
  - `test/variantes.js` verrouille aussi l ENVELOPPE (un seul emetteur de
    `game_state`, spectateur servi comme les joueurs) et l ISOLATION de
    `getState()` (muter l etat publie ne corrompt pas la partie) ;
    `test/structure.js` relie `games/` au registre dans les deux sens. Un
    dossier non enregistre n est jamais jouable. Enfin `DEFAULT_GAME` de
    l appariement doit etre un id du registre (`test/variantes.js`).
  - `test/variantes.js` verrouille la PERSISTANCE : instantane JSON ->
    session reconstruite -> meme `getState()`, meme horloge, et la copie sait
    encore jouer ; un SEUL point d ecriture (`persistSession`),
    `rehydrateSessions()` appele au demarrage, abandon arme par session.
  Un plateau qui rate ces points fait echouer `npm test` — il ne peut pas
  entrer dans le jeu sans la reprise.

PREUVES (hors `npm test`, comme les autres sondes) :

    node tools/_variantes_resume.js       WebSocket reel : rechargement, sync sans
                                          identifiant, etat conserve, fin, plus rien
    node tools/_variantes_redemarrage.js  PROCESSUS TUE puis relance : les trois
                                          plateaux reprennent (etat + horloge), et
                                          deux parties vivantes sont abandonnees
                                          ensemble a la deconnexion
    node tools/_resume_ui.js              navigateur reel : bandeau -> « Reprendre »
                                          -> meme position (Telo local, Telo local
                                          apres F5, pastilles, Dimy classe avec
                                          rechargement de page)


## Ajouter un jeu en 6 etapes

1. Creer D-aona/d-aona-web/games/<slug>/ avec les 7 fichiers.
2. Ecrire manifest.json (identite, plateau, phases, formats).
3. Ecrire engine.js (contrat 2) et le couvrir par test.js.
4. Ecrire ai.js (chooseMove) - niveau et budget injectables.
5. Ecrire board.js et ui.js (contrat 3). Un plateau de fanorona se construit
   sur `games/fanorona-board.js` (une ligne : `FP.create({ rows, cols,
   topology })`, puis un `render` qui transmet `board` et le dernier coup) :
   il herite du treillis, des cibles de clic et du skin de pion du compte.
6. Ajouter UNE ligne au registre de l interface — avec son `screen` (« board »
   ou « play ») : c est l ecran ou sa partie se joue, donc la seule chose que
   la reprise demande au jeu (contrat 5). Si le plateau doit se jouer en ligne,
   ajouter aussi son dossier serveur (manifest.json, facade engine.js,
   session.js, index.js) et UNE ligne a `d-aona-server/games/registry.js` :
   `session.js` pose `this.game = "<slug>"` et publie `game: this.game` dans
   `getState()` — sans quoi `npm test` refuse le jeu. Aucune autre modification
   du socle.

## Choix d une variante (entree « Fanorona »)

Le catalogue ne contient toujours qu un jeu, `fanorona`. La tuile « Fanorona »
de l etape 1 ouvre une SOUS-VUE DE PLATEAUX dans la MEME scene (Tsivy 9x5,
Dimy 5x5, Telo 3x3) : memes tuiles `.pg-opt` que la liste des jeux, meme
en-tete 01/04, memes pastilles — aucune modale. Le choix vaut validation.

- `FANORON_VARIANTS` (index.html) declare, pour chaque plateau, les MODES qu il
  tient : les trois tiennent `online`, `defi` et `ai`. L etape 2 affiche donc la
  MEME grille de trois modes, TOUS actifs, quel que soit le plateau.
- Le mode « deux joueurs, un ecran » a ete retire : il n avait ni Elo ni
  classement, et faisait doublon avec l entrainement. Les controleurs des jeux
  savent toujours jouer `mySide: 0` (les tests s en servent), mais l assistant
  ne le propose plus.
- `launchGame()` aiguille par MODE, pas par plateau : `ai` -> plateau local
  (Tsivy via `Fanorona.start`, Dimy/Telo via `renderLive()` +
  `VariantMatch.open({ host })`) ; `defi` -> `send_challenge` avec `game` ;
  `online` -> `find_match` avec `game`, meme file et meme matchmaking pour les
  trois.
- La sous-vue des plateaux rejoue l entree de la scene (`pgFadeUp`) : changer
  de sous-vue EST un changement d ecran, meme a etape constante. Seul un
  re-rendu du meme contenu (mise, adversaire, formulaire de defi) pose
  `pg-noanim` et conserve le defilement du centre.

`variant-match.js` est de la GLUE : il monte l ecran (joueurs, plateau,
statut, regles), branche `ui.createController` du dossier de jeu et fait
jouer `ai.chooseMove`. Il n implemente aucune regle et ne connait ni App ni
le reseau ; chaque coup passe par `engine.applyMove`.

En LIGNE (`open({ remote:true, state, mySide, onMove })`) il ne cree aucun
etat : il peint celui du serveur, appelle `onMove(move)` et se laisse
recorriger par `VariantMatch.sync(state)`. Le camp jouable vient du serveur,
les deux pseudos aussi (affiches par CAMP, pas par « moi / adversaire »).

La partie RESTE DANS L ASSISTANT : `open({ host })` embarque l ecran dans
`#pg-live-slot`, a l etape 4 de la carte (meme en-tete 04/04, meme bouton
Regles, meme bandeau bas ; la fleche ramene au recapitulatif, le CTA remonte
un plateau neuf). Sans `host`, `open()` reprend son comportement historique
d overlay plein ecran. En mode embarque, la coquille perd sa barre de titre
et ses actions (`.vm-shell--inline` : la carte les fournit) et les jetons de
couleur sont redefinis localement — la carte est sombre dans les deux themes,
alors que `--panel` / `--text` suivent le theme clair de l application. Les
modules de jeu n ont donc rien a savoir de leur hote.

## Etat reel (verifie par test/structure.js)

- Fanoron-Telo : dossier complet, autonome, harnais vert ; JOUABLE dans
  l application (classee, defi, entrainement).
- Fanoron-Dimy : dossier complet (5x5, prises approche/retrait), harnais
  vert ; JOUABLE dans l application (classee, defi, entrainement).
- Fanoron-Tsivy : moteur eclate cote serveur (engine, session, manifest)
  et facade game.js ; board.js et ui.js restent encore dans index.html (lot T5).
- Variantes : les trois plateaux ont une session serveur, une file de
  matchmaking par couple (plateau, format) et le meme Elo. Verifie par
  `test/variantes.js` (contrat), `tools/_variantes_online.js` (duel
  WebSocket + historique) et `tools/_variantes_duel.js` (duel de deux
  navigateurs).
- Socle : server.js 1709 lignes (objectif 250), index.html mono-fichier
  (objectif : coquille). Voir PLAN-REFONTE.md pour l ordre des lots.

## Regle de verification

Aucun lot n est declare termine sans : node --check, exports inchanges, npm test,
campagne UI, git diff --stat conforme. Voir PLAN-REFONTE.md.