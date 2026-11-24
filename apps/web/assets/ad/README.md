# Bandeaux publicitaires (Profil et Accueil)

Dossier de la publicité du site : le bandeau partenaire affiché en haut de la colonne
droite du Profil (emplacement `#pf3-ad`, rendu par `adBannerHtml()` dans
`index.html`) **et** le **carrousel de l'Accueil** (`#ad-car`), dont TOUT le contenu
est configurable — voir plus bas.

| Fichier | Rôle |
|---|---|
| `pubs.json` | **configuration du carrousel de l'Accueil** : une entrée par bannière (`id`, `titre`, `image`, `repli` facultatif, `lien`, `debut` / `fin` facultatifs) — le seul fichier à toucher pour changer une campagne |
| `d-aona-maison.svg` | bannière **maison** du carrousel (dessin vectoriel autonome, 1 983 o) |
| `yas-nperf-2025.webp` | **l'asset officiel du partenaire**, demandé en premier par la page et servi tel quel — 2 560 × 960 (ratio 2,67:1), 247 Ko |
| `yas-nperf-2025.svg` | version **vectorielle de secours**, prise par le repli `onerror` si le WebP manque (2 304 × 864, dessin à sa propre échelle) |

Le WebP vient du CDN de yas.mg :

```text
https://cdn-ilcckdj.nitrocdn.com/QlUnTVTrZOOqlaTqMQtiukCnxjpNglhu/assets/images/
  optimized/rev-d1dba53/www.yas.mg/wp-content/uploads/2025/04/NPERF-yas.mg_2560x960.webp
```

> **Pourquoi un WebP servi tel quel, et non un JPEG renommé** : le fichier est
> envoyé avec son vrai type — une entrée `image/webp` a été ajoutée à la table MIME
> de `d-aona-server/server.js`. Le renommer `.jpg` obligerait le navigateur à
> deviner le format en reniflant un en-tête qui mentirait ; tous les navigateurs
> capables d'exécuter l'application décodent le WebP, et le repli `onerror` couvre
> les autres. Le 404 en console qui motivait la rasterisation d'appoint a disparu
> **sans qu'aucun fichier ne soit fabriqué** : ni JPEG, ni script de conversion.

## Remplacer le visuel (nouvelle campagne du partenaire)

Il suffit de déposer le nouveau fichier sous le nom `yas-nperf-2025.webp` : aucune
ligne de code à changer, la page le sert immédiatement. Cibles et conséquences :

- **cadre** : libre, mais la **taille native est vérifiée** par `_apercu_pub.js`
  (constante `NATIF`). Si la définition change, mettre à jour cette constante, et
  `NATIF_SECOURS` si le SVG maison est retouché dans la foulée ;
- **ratio** : 2,67:1 est celui du visuel actuel. Un autre ratio ne déforme rien
  (`height: auto`), mais déplace le plafond de hauteur et la fenêtre du recadrage
  mobile — les deux sont recalculés et imprimés à chaque run du harnais ;
- **zone sûre** : rien d'essentiel sur ~70 px en haut et ~85 px en bas (le plafond
  `max-height: 420px` rogne le visuel au-delà de ~1 500 px d'écran), ni au-delà de
  ~1 700 px depuis la gauche si le cadrage mobile 16:9 doit rester lisible ;
- **poids** : 247 Ko ici ; viser ≤ 400 Ko, l'emplacement s'affiche sur l'accueil du
  Profil, sous la ligne de flottaison sur téléphone.

## Carrousel de l'Accueil — tout passe par `pubs.json`

Le carrousel lit `pubs.json` à l'ouverture de l'écran et le serveur le sert **sans
cache** : une entrée ajoutée, retirée ou modifiée est visible au rechargement suivant,
sans redémarrer le serveur. `debut` / `fin` (`AAAA-MM-JJ`, facultatifs) bornent la
campagne ; hors fenêtre la bannière n'est pas affichée, et s'il n'en reste **aucune**,
le bloc n'est pas rendu du tout — pas d'espace vide.

Ce que le visuel doit respecter — **mesuré par la campagne, pas jugé à l'œil** :

- **colonne de gauche** : le texte doit commencer à **au moins 32 px** du bord gauche
  de l'image ; les flèches (visibles au survol seulement) occupent 4 → 30 px. Le
  contrôle S2 de `test_ui_scenarios.js` relit chaque bannière servie dans un canevas
  et rejoue la mesure à chaque campagne de tests ;
- **bande médiane** (25 → 85 % de la hauteur) : c'est là que la mesure cherche le
  texte — un visuel qui n'écrit que plus haut ou plus bas passe sans discussion ;
- **poids et ratio** : libres (`width: 100%`, `height: auto`, plafond
  `min(38vh, 320px)` en `object-fit: cover`), comme pour le bandeau du Profil ;
- **`image`** : chemin depuis la racine de l'application (`assets/ad/…`) ; `repli`
  prend le relais si le premier fichier manque (`onerror`).

Captures de référence : `graphify-out/revue-ui/accueil-carrousel-et-saison-jour.png`,
`accueil-carrousel-fleches-au-survol-jour.png` et `accueil-pleine-page-jour.png`
(rejouables par `d-aona-server/_shots_panneaux.js`, base jetable).

## Ce que fait la version vectorielle de secours

`yas-nperf-2025.svg` reprend la composition de l'annonce — champ jaune, tache
bleue et logo yas, titre, logo nPerf, médaille nPerf Awards 2025, pictogramme
5G, www.yas.mg — mais la **photo du groupe est remplacée par une illustration**
(six personnes attablées devant un téléphone, terrasse de café). C'est le seul
écart avec le visuel du partenaire : un dessin de repli, pas une seconde version
de l'annonce. Il n'est plus affiché tant que le WebP répond.

Contraintes du fichier, à conserver si on le retouche :

- **autonome** — un SVG chargé par `<img>` n'a accès à aucune ressource externe
  (police, image) : texte en polices système, aucun `@import` ;
- **commentaires sans `--`** — interdit en XML ; un `---` décoratif fait échouer
  le parsing en silence (`naturalWidth === 0`, image vide).

## Vérifier

```bash
cd d-aona-server
node _diag_svg.js        # validité XML du secours, police, rendu navigateur
node _apercu_pub.js      # 42 contrôles + captures (graphify-out/pub/)
```

`_apercu_pub.js` vérifie les **deux chemins** — le WebP officiel servi sans 404 à
cinq largeurs de colonne (1 334 → 292 px, du grand écran au mobile 320), et le
repli `onerror` sur le SVG (une carte réclame exprès un nom de fichier inexistant)
— ainsi que la fenêtre du **recadrage mobile 16:9**, le ratio conservé, l'encre
porteuse de sens (titre, 5G, logo nPerf, `www.yas.mg`) mesurée au pixel et
entièrement contenue, et l'absence de débordement. Aucun script de conversion
n'est plus nécessaire : le WebP est servi tel quel.

L'intégration dans l'application est couverte par
`_probe_profil_v3.js` (**41/41** : présence du bandeau, fermeture ✕ mémorisée,
aucune erreur JavaScript) et `_revue_ui.js` (contraste, cibles tactiles,
captures du Profil — dont une **pleine page** à 390 px, `mobile-390__profile-pleine-page.png`,
le bandeau tombant sous la ligne de flottaison sur téléphone).
