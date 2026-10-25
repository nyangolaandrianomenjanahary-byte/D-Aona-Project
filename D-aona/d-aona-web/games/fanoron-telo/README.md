# Fanoron-Telo

Variante courte du fanorona : grille 3x3, trois pions par camp, aucune prise.

## Regles

1. POSE : chacun pose ses trois pions sur une case libre, a tour de role.
2. MOUVEMENT : on glisse un pion vers une intersection VOISINE laissee vide
   (orthogonale ou diagonale, y compris depuis le centre).
3. Victoire : ALIGNEMENT de ses trois pions sur une des 8 lignes (3 lignes,
   3 colonnes, 2 diagonales).
4. Defaite : BLOCAGE, aucun coup possible a son tour.
5. Nulle : triple repetition de la meme position.

Aucune prise, jamais : ce n est pas un fanorona de capture.

## Geometrie

Cases numerotees 0..8, index = ligne * 3 + colonne.

    0 1 2
    3 4 5
    6 7 8

## Coups

- pose   : { type: "place", to: 4 }
- glisse : { type: "move", from: 0, to: 1 }

## Contrat respecte

- engine.js  : createState, legalMoves, isLegal, applyMove, status, key, clone
- ai.js      : chooseMove(state, { level, budgetMs, rng })
- board.js   : geometrie (3 x 3, orthogonales + les deux grandes diagonales)
               et rendu par `games/fanorona-board.js`, aucune regle
- ui.js      : interaction (selection, validation, onMove), aucune regle
- test.js    : harnais autonome (node test.js)
- manifest.json : identite et capacites du jeu

## Verifier

    node test.js