# Les deux faces de la pièce du tirage au sort

Dossier de la pièce lancée au démarrage de chaque partie (choix **PILE / FACE**, puis
**lancer plein écran** `#coin-toss` joué AVANT le premier coup — arbitrage inversé du
03/10/2026 : la bande non modale `#toss-banner` du lot S8 est retirée). Les fichiers sont
affichés par `index.html` dans les deux plans 3D de la pièce en vol
(`<i class="coin-front">` / `<i class="coin-back">` dans `.coin-air`), dans les boutons du
choix (`.coin-thumb`) et dans les lignes d'attribution (`.ow img`). En vol, les classes
`pile` / `face` décident de l'angle d'arrivée (1080° ou 1260°) ; à l'atterrissage,
`.landed` coupe l'animation et c'est `display` qui montre le plan de la face **tirée**
(CSS `.coin-air`, section « Lancer de pièce ») — l'image affichée ne peut pas diverger du
verdict.

| Fichier | Face | Vue |
|---|---|---|
| `pile.webp` | **PILE** | le côté où la valeur est écrite en chiffres : étoile, légende circulaire « REPOBLIKA DEMOKRATIKA MALAGASY », « ariary », le grand **50**, couronne de laurier, millésime **1992** |
| `face.webp` | **FACE** | le côté du décor national : légende « ARIARY DIMAMPOLO », deux **baobabs**, brousse, ruban de la devise « TANINDRAZANA · FAHAFAHANA · FAHAMARINANA » |

Ce sont les **photographies** de la pièce malgache de 50 ariary (1992) fournies par le
joueur, **détourées** : fond transparent, cadrage carré au plus juste, ramenées de
1024 × 1024 à **192 × 192** — de quoi rester nettes jusqu'aux 184 px du lancer plein
écran. Poids : 13,2 Ko (pile) et 12,0 Ko (face), très en deçà des 60 Ko visés.

## D'où viennent les fichiers, et comment les refaire

Les clichés d'origine (`coin_pile_raw.png`, `coin_face_raw.png`) sont des photographies
**opaques, prises sur fond noir**. Ils ont été détourés par un outil du dépôt, puis les
sources ont quitté le disque : **les deux `.webp` de ce dossier sont la seule copie
conservée**, et ils se régénèrent à l'identique depuis les sources si elles reviennent.

```bash
cd d-aona-server
node _coin_prep.js                     # sources : %USERPROFILE%\Downloads\coin\coin_*_raw.png
node _coin_prep.js --src "C:\chemin\vers\coin"   # autre dossier de sources
node _coin_prep.js --alpha-min 72 --erosion 3     # détourage plus strict
```

`_coin_prep.js` (jetable) ouvre un serveur statique local et fait tout le travail dans un
`<canvas>` de Chromium — le projet n'a ni `sharp` ni `jimp`. La chaîne, dans l'ordre :
seuil automatique d'**Otsu** → **flood fill** du fond depuis les bords → plus **grande
composante** connexe (les poussières claires du fond tombent) → **érosion** de 2 px →
recadrage carré → réduction à 192 px → **rampe d'alpha** → **décontamination du contour**
(les pixels de bord, mélangés au noir du fond, sont « dés-mélangés » : leur luminance
moyenne passe de ~126 à ~213, sans quoi un liseré sombre resterait collé à la pièce).
Il écrit dans ce dossier, journalise les poids, et laisse un aperçu des deux faces aux
quatre tailles d'usage sur fond **jour**, **nuit** et **rouge vif** —
`%TEMP%\daona_shots\apercu-pieces-nouvelles.png` : c'est le rouge vif qui révèle un
contour mal détouré, avant même de lancer l'application.

## Ce qui doit rester vrai si on retouche les fichiers

Aucune table MIME à compléter : `.png`, `.jpg`, `.jpeg`, `.webp` et `.svg` sont déjà
servis par `d-aona-server/server.js`. Les invariants, eux, sont dans le rendu :

- **fond transparent** : la pièce s'affiche sur le thème jour **et** sur le thème nuit, et
  sa forme octogonale vient de l'image elle-même — il n'y a ni `border-radius` ni `border`
  à l'écran, un fond opaque dessinerait un carré autour de la pièce (le harnais le
  contrôle : les **quatre coins** de chaque image doivent avoir un alpha nul) ;
- **cadrage carré**, la pièce centrée : les conteneurs sont carrés (56 px sur les boutons
  du choix, 40 px dans les lignes d'attribution, **112 à 184 px** en vol — `clamp(112px,
  26vw, 184px)`) et l'image les remplit ; `object-fit` n'est pas appliqué, c'est donc le
  cadrage du fichier qui décide ;
- **lisibilité à 40 px** : à cette taille, seuls les aplats comptent — c'est ce qui
  distingue les deux faces ici (le « 50 » et la couronne d'un côté, les baobabs de
  l'autre) ;
- **poids** : viser ≤ 60 Ko par face ; les deux images sont chargées avec la page,
  y compris sur téléphone.

## Inverser PILE et FACE

La convention retenue est celle de l'usage : **PILE** = le côté de la valeur chiffrée
(le « 50 »), **FACE** = le côté du décor national (baobabs et devise). Pour l'inverser,
échanger les deux attributs `src` (ou le contenu des deux fichiers) : les libellés
« PILE » / « FACE » des boutons, des règles et de l'annonce suivent automatiquement,
puisqu'ils nomment la face et non le fichier.

## Vérifier

```bash
cd d-aona-server
node _coin_apercu.js     # les deux faces à 168, 84, 56 et 44 px, thèmes jour et nuit, hors application
node _coin_verif.js      # contrôles P1 à P9 + captures (base jetable, port 8094)
```

`_coin_apercu.js` sert à **juger les images** : il affiche les deux faces côte à côte aux
quatre tailles d'usage sur fond clair, sur fond nuit et sur aplat **rouge vif**, et
enregistre `%TEMP%\daona_shots\apercu-pieces.png`. C'est l'outil qui a permis de voir le
liseré noir du détourage, puis de le corriger, sans passer par l'application. Il suppose
le serveur en écoute sur 8080 (`assets/` y est servi tel quel).

Le harnais rejoue une partie d'entraînement complète (Jeux → IA → LANCER) et contrôle,
dans le navigateur : les deux faces du choix chargées et **distinctes** (56 × 56), leur
**fond transparent** (coins d'alpha nul, centre opaque), le voile de lancer qui nomme les
**DEUX camps** (face de chacun, un seul « commence », cohérent avec la face tirée, et le
**camp** de chaque ligne : « pions clairs » pour le gagnant, qui les prend et commence), la
face montrée par la pièce posée **égale à la face annoncée** — dans les deux issues du
tirage, `Math.random` figé —, la pièce en vol **≥ 112 px**, la fermeture par
« Commencer », l'absence de rejeu quand le tirage est déjà résolu (`animate:false`), le
hit-test P9 (le plan rendu au centre porte bien le fichier de la face tirée, non
miroité), l'absence de tout 404 sur ce dossier et zéro erreur JavaScript.
Captures : `%TEMP%\daona_shots\pieces-*.png`.
