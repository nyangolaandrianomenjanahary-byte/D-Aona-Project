# Les quatre motifs illustrés du pion — deux dessins par motif

Dossier des **motifs de pion peints comme des images** — le zébu, le ravinala, le
lémurien et le crocodile — affichés par `index.html` dans la boutique `#/skins`
(aperçu en grand, vignettes de motif, échantillon à la taille réelle du plateau) et
sur le plateau lui-même. Les cinq autres motifs du catalogue (`cameleon`, `pra`,
`pangalatra`, `lefona` et `aucun`) restent des **silhouettes SVG** embarquées dans le
script : ce dossier ne concerne que la famille `img`.

**Chaque camp a SON dessin** : les pions **clairs** portent le lot
`Assets-premiere-version` (dessiné sur les pions blancs de la première planche), les
pions **sombres** le lot `Assets-noirs-contraste-initial` (extrait des pions noirs de
la même planche). Huit fichiers, donc — quatre motifs × deux camps :

| Fichier ici | Camp | Motif (`PION_PATTERNS`) | Nom affiché | Contenu |
|---|---|---|---|---|
| `zebu.png` | clairs | `zebu` | Tête de zébu | tête cornue, noir et blanc (dessin des pions blancs) |
| `ravinala.png` | clairs | `ravinala` | Ravinala | l'arbre du voyageur en éventail, vert |
| `lemurien.png` | clairs | `lemurien` | Lémurien | face de lémurien, yeux orange |
| `crocodile.png` | clairs | `crocodile` | Voay — Crocodile | gueule ouverte, verte et beige |
| `zebu-sombre.png` | sombres | `zebu` | Tête de zébu | tête cornue, **blanc-dominant** (dessin des pions noirs) |
| `ravinala-sombre.png` | sombres | `ravinala` | Ravinala | l'arbre du voyageur, vert clair |
| `lemurien-sombre.png` | sombres | `lemurien` | Lémurien | face de lémurien, yeux orange |
| `crocodile-sombre.png` | sombres | `crocodile` | Voay — Crocodile | gueule ouverte, verte et beige |

Chaque fichier est le PNG **RGBA transparent** livré par son lot, copié ici **sans
ré-encodage** : réseau d'aplats, aucun dégradé, aucun contour ajouté.

## Provenance et refaire la copie

Deux lots, deux jeux de dessins — **aucun nouveau dessin généré**, dans un cas comme
dans l'autre.

**1. Pions clairs** — lot `Assets-premiere-version` : motifs extraits des **pions
blancs de la toute première planche générée**. Son LISEZ-MOI prévenait : « utiliser le
même fichier sur les deux couleurs de pion. Les parties sombres peuvent manquer de
contraste sur un pion noir » — c'est exactement ce que le second lot est venu corriger.

**2. Pions sombres** — lot `Assets-noirs-contraste-initial` (« contraste de la première
proposition ») : « extraction raster directe des motifs figurant sur les pions noirs de
la toute première planche. Aucun nouveau dessin généré. Support et ombre retirés. Les
zones sombres internes au motif sont conservées. » Son LISEZ-MOI précise aussi : « ces
dessins sont ceux de la version noire initiale : ils diffèrent des dessins de la version
blanche initiale. Pour avoir un dessin strictement identique entre les deux camps, une
déclinaison colorimétrique basée sur un seul de ces dessins sera nécessaire. » — les deux
camps affichent donc deux dessins **parentés mais différents**, c'est voulu (le zébu
sombre est blanc-dominant là où celui des clairs est noir-dominant).

Les deux lots livrent plusieurs tailles et **ne sont pas vectoriels** : c'est la version
**256 px** qui est retenue (voir « Ce qui doit rester vrai »). Les noms de fichiers sont
alignés sur les `id` du catalogue, d'où `lemur-256.png` → `lemurien.png`.

⚠ **Piège de nommage** : le lot sombre nomme ses fichiers `<motif>-noir-*.png` — **sauf
le lémurien**, livré en `lemur-*.png`, exactement comme la source claire. Les deux
`lemur-256.png` existent donc bel et bien dans deux dossiers différents : ne jamais
copier l'un sur l'autre (et ne jamais écraser `lemurien.png`, qui est le dessin CLAIR).

| Fichier ici | Source du lot (Downloads) | Poids | SHA-256 (identique source et copie) |
|---|---|---|---|
| `zebu.png` | `Assets-premiere-version\zebu-256.png` | 40 483 o | `14c0a35918c203ae5769341fcc7de430a16de62df2a9648a6f0ea937070c3605` |
| `ravinala.png` | `Assets-premiere-version\ravinala-256.png` | 64 311 o | `24113bd282c178bbf830f357d03bd4de1427659eb7607624fbbe5fd97d2eb474` |
| `lemurien.png` | `Assets-premiere-version\lemur-256.png` | 57 476 o | `94ef6b67418fb1bbe0b8c5a865418ffe5fba569186e2dbfbeb4ebd5a57d903e6` |
| `crocodile.png` | `Assets-premiere-version\crocodile-256.png` | 78 289 o | `b80d4e20a828e6b66e62b61a122c25f8bfd3704742ef41b29e44ae468d184891` |
| `zebu-sombre.png` | `Assets-noirs-contraste-initial\zebu-noir-256.png` | 38 279 o | `2cab1e3940a5c5240e4570559cab02ccd591ed4344cd540601ff0f9ad7786c29` |
| `ravinala-sombre.png` | `Assets-noirs-contraste-initial\ravinala-noir-256.png` | 58 583 o | `65be4baa65abfbea906414391656cb48df08a26cc01b81a6c0416f1bbba9996b` |
| `lemurien-sombre.png` | `Assets-noirs-contraste-initial\lemur-256.png` | 40 992 o | `e815b146d211a75f218f94939fed030b04f9fb8cdde3ba66a9906b83944c9772` |
| `crocodile-sombre.png` | `Assets-noirs-contraste-initial\crocodile-noir-256.png` | 86 359 o | `9dfd404753eb67612625b91554087f4a0e3c7e58d03a77148264860579906f51` |

Les deux lots livrent aussi des variantes plus grandes (512 px, et jusqu'à 1024 px pour
le lémurien sombre) : elles ne sont **pas** copiées ici.

```powershell
# Refaire les copies telles quelles (aucun ré-encodage) :
$clair = "$env:USERPROFILE\Downloads\Assets-premiere-version"
$sombre = "$env:USERPROFILE\Downloads\Assets-noirs-contraste-initial"
$dst = "d-aona-web\assets\pions"
Copy-Item "$clair\zebu-256.png"        "$dst\zebu.png"              -Force
Copy-Item "$clair\ravinala-256.png"    "$dst\ravinala.png"          -Force
Copy-Item "$clair\lemur-256.png"       "$dst\lemurien.png"          -Force   # le nom suit l'id
Copy-Item "$clair\crocodile-256.png"   "$dst\crocodile.png"         -Force
Copy-Item "$sombre\zebu-noir-256.png"      "$dst\zebu-sombre.png"      -Force
Copy-Item "$sombre\ravinala-noir-256.png"  "$dst\ravinala-sombre.png"  -Force
Copy-Item "$sombre\lemur-256.png"          "$dst\lemurien-sombre.png"  -Force   # lot SOMBRE
Copy-Item "$sombre\crocodile-noir-256.png" "$dst\crocodile-sombre.png" -Force
```

Après copie, `Get-ChildItem d-aona-web\assets\pions -Filter *.png | Get-FileHash -Algorithm SHA256`
doit redonner les huit empreintes ci-dessus.

## Comment l'application les peint

Le catalogue du client (`PION_PATTERNS`, `index.html`) donne à ces quatre motifs un
champ `img` — le dessin des pions **clairs** — et un champ `imgDark` — celui des pions
**sombres** — au lieu de `svg`. `mountPionStyles()` génère alors, par jeu de variables
(les MÊMES que les silhouettes : moi / adversaire × camp clair / camp sombre) :

```css
[data-pion-motif="zebu"]           { --pion-mask: none; --pion-motif-ink: transparent;
                                     --pion-motif-img: url("assets/pions/zebu.png"); }
[data-pion-motif-dark="zebu"]      { --pion-mask-dark: none; --pion-motif-ink-dark: transparent;
                                     --pion-motif-img-dark: url("assets/pions/zebu-sombre.png"); }
[data-pion-motif-opp="zebu"]       { …url("assets/pions/zebu.png")… }
[data-pion-motif-opp-dark="zebu"]  { …url("assets/pions/zebu-sombre.png")… }
```

C'est le **groupe du jeu de variables** — celui qui décide déjà quelle couleur ce camp a
le droit de porter — qui choisit le fichier : suffixes clairs (`""`, `-opp`) → lot
initial, suffixes sombres (`-dark`, `-opp-dark`) → lot sombre. Un motif sans `imgDark`
(ajout futur) garde le fichier clair sur les deux camps. Le pseudo-élément `::before` du
pion (`.piece.clair` / `.piece.sombre` sur le plateau, `.pion-view` dans la boutique)
peint ce fichier **tel quel** (`background-image`, `background-size: contain`) :
contrairement à une silhouette, une image ne prend pas l'encre `--pion-ink` de la couleur
choisie — elle porte ses propres couleurs. Le masque est mis à `none` **exprès** : s'il
restait posé, il rognerait l'illustration sur le contour de la silhouette du même nom.
Aperçu, vignettes et plateau consomment les mêmes variables (les pions sombres par le
rebinding `-dark` → génériques), un écart entre eux est donc impossible.

## Ce qui doit rester vrai si on retouche les fichiers

- **fond transparent** (RGBA) : le pion est un disque coloré ; un fond opaque
  dessinerait un carré dans le cercle, en thème **jour** comme en thème **nuit** ;
- **cadrage carré, dessin centré** : les conteneurs sont carrés (34 px en vignette de
  motif, **104 px** en aperçu, 20 px à la taille réelle, ~28 px sur le plateau) et
  l'image est peinte en `background-size: contain` — c'est donc le cadrage du fichier
  qui décide de la place du motif dans le pion ;
- **256 × 256 suffit** : c'est la taille qui reste nette jusqu'à l'aperçu de 104 px sur
  un écran à 2,4× de densité ; les fichiers ne sont chargés que si un élément porte la
  variable (`background-image` d'un motif non utilisé = `none`) ;
- **un dessin PAR CAMP, et ils diffèrent** : les deux lots sont des dessins distincts du
  même sujet — le LISEZ-MOI du lot sombre l'annonce (« ils diffèrent des dessins de la
  version blanche initiale »). C'est la réponse au contraste, pas un oubli : le zébu
  sombre est blanc-dominant. Un dessin **strictement identique** décliné en deux coloris
  demanderait une déclinaison colorimétrique depuis une seule source ;
- **huit fichiers, un seul chargé par pion** : ≈ 454 Ko au total (240 Ko pour les clairs,
  224 Ko pour les sombres), mais le navigateur ne télécharge que les motifs réellement
  portés (`background-image` d'un motif non utilisé = `none`) ;
- **aucune table MIME à compléter** : `.png` est déjà servi par `d-aona-server/server.js`
  (les chemins sont relatifs, donc valables partout où l'application est servie).

## Vérifier

```bash
cd d-aona-server
node _pions_verif.js   # les quatre motifs, en vrai navigateur (base jetable, port 8095)
node _check_html.js    # syntaxe du script en ligne + balises du mono-fichier
```

`_pions_verif.js` (jetable, port 8095) ouvre `#/skins` et contrôle, **pour les deux camps
de chaque motif** : le fichier réellement peint (`background-image` du pseudo-élément, URL
absolue du PNG — `zebu.png` à l'onglet clair, `zebu-sombre.png` à l'onglet sombre),
l'absence de masque **et** d'encre (sinon l'image serait rognée ou doublée), le **code
HTTP**, les dimensions réelles et la transparence des **huit** PNG, la neutralité de
`aucun`, la présence d'un masque SVG pour une silhouette témoin (`lefona`), les règles de
la feuille générée (les 4 motifs × 4 jeux, chacune avec le dessin de son camp), la
peinture **sur le plateau** pour les deux rôles (mes pions, ceux de l'adversaire) — et
**zéro erreur JavaScript**. Deux contrôles visent la demande elle-même : les deux dessins
d'un même motif **diffèrent** octet par octet, et un même motif ne peint **jamais** le
même fichier dans les deux camps. Captures : `%TEMP%\daona_shots\pions-*.png`
(`pions-<motif>.png` en clair, `pions-<motif>-sombre.png` en sombre,
`pions-boutique-clairs.png` / `-sombres.png`, `pions-plateau-images.png`).
