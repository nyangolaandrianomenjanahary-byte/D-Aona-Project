# Fanoron-Dimy

Variante moyenne du fanorona : plateau 5 x 5, douze pions par camp, prises
par approche et par retrait.

## Regles

1. DOUZE pions par camp. Position de depart : deux rangees pleines de chaque
   cote, rangee centrale alternee, centre vide (1 point libre sur 25).
2. DEPLACEMENT LIBRE le long des lignes gravees : orthogonal partout,
   diagonal uniquement depuis un point fort (ligne + colonne paire).
   Une case d arrivee occupee interdit le pas, quel que soit le camp du pion.
3. PRISE PAR APPROCHE : les pions adverses consecutifs derriere la case
   d arrivee, dans l axe du deplacement, sont captures.
4. PRISE PAR RETRAIT : les pions adverses consecutifs derriere la case de
   depart, dans l axe oppose, sont captures.
5. Une prise n est JAMAIS obligatoire. Un meme deplacement peut offrir les
   deux sens : approche et retrait sont alors deux coups distincts.
6. Victoire : l adversaire n a plus de pion, ou plus aucun coup possible
   (blocage). Nulle : 60 demi-coups sans aucune prise.

## Hypotheses a confirmer (consignees, pas cachees)

- **5 x 5** : c est la lecture retenue pour « fanoron-dimy » (dimy = cinq).
  Le plateau Tsivy reste la variante 9 x 5.
- **Douze pions** : deux rangees pleines + deux pions de la rangee centrale,
  soit 25 - 1 point libre. Meme logique que les 22 pions du Tsivy.
- **Pas de chaine** : une prise termine le coup. Le Tsivy du projet autorise
  la continuation de prise ; cette variante ne la reprend pas.
- **Elo** : `eloKey` existe dans le manifeste, mais aucune partie classee
  n est ouverte pour cette variante (entrainement et deux joueurs seulement).

## Geometrie

Cases numerotees 0..24, index = ligne * 5 + colonne.

      0  1  2  3  4
      5  6  7  8  9
     10 11 12 13 14
     15 16 17 18 19
     20 21 22 23 24

Position de depart (1 = clairs, 2 = sombres, 0 = vide) :

      2 2 2 2 2
      2 2 2 2 2
      2 1 0 1 2
      1 1 1 1 1
      1 1 1 1 1

## Plateaux

Le plateau est une PLAQUE GRAVEE, la meme que celle du Tsivy : geometrie et rendu
par `games/fanorona-board.js`, habillage `.fp-plate` dans `index.html`. Le PAS
(la maille) est commun aux trois variantes et vaut `--fp-pitch` : le 5 x 5 remplit
la carte, le 3 x 3 du Telo garde la meme maille et le meme pion (0,57 pas) dans
une plaque plus petite. Ne jamais regler une largeur de plateau pour rattraper une
taille de pion : c'est le pas qui porte l'echelle.

## Coups

- deplacement : { from: 12, to: 7 }   (le sens est deduit de la geometrie)
- sens impose : { from: 12, to: 7, kind: "apr" } ou kind: "ret"

## Contrat respecte

- engine.js  : createState, legalMoves, isLegal, applyMove, status, key, clone
- ai.js      : chooseMove(state, { level, budgetMs, rng })
- board.js   : geometrie (5 x 5, diagonales des points forts) et rendu par
               `games/fanorona-board.js`, aucune regle
- ui.js      : interaction (selection, validation, onMove), aucune regle
- test.js    : harnais autonome (node test.js)
- manifest.json : identite et capacites du jeu

## Verifier

    node test.js
