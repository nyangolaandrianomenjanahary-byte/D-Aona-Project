# Revue UX/UI — D-aôna

**Date** : 23/09/2026 · **Périmètre** : SPA mono-fichier `apps/web/index.html` —
3 gabarits (1440, 390, 360 px), 2 thèmes (jour/nuit), 10 routes + états particuliers
(modales, vues profondes, onglets) + un compte neuf (tous les états vides).
**But** : confronter l'application à des **mesures objectives** avant de figer quoi que ce soit,
puis proposer des correctifs hiérarchisés.

## 0. Comment la revue a été produite (et comment la rejouer)

`apps/api/_revue_ui.js` (outil jetable, motif `_*.js`, hors git) :

1. **Instance jetable** : copie de la base réelle par `VACUUM INTO` (la source n'est ouverte
   qu'en lecture seule), serveur de travail sur le port **8095**, base temporaire supprimée
   à la fin. **Aucun compte réel n'est ouvert, modifié ni photographié.**
2. Deux comptes de revue créés sur la copie : `ZzRevueUI` (KYC vérifié) et `ZzRevueVide`
   (compte neuf), puis le **jeu de démonstration** (`demo_seed.js --user ZzRevueUI`) est
   appliqué à la copie pour obtenir des écrans remplis (défis, amis, messagerie, tournois, wallet).
3. Captures + mesures sur les états réels de l'application (jeton posé avant le démarrage de
   la SPA, clics réels, aucun état forcé par injection de contenu).

Rejouer : `cd apps/api && node _revue_ui.js` (≈ 4 min).
Preuves : `graphify-out/revue-ui/` — **53 PNG**, `mesures.txt` (journal lisible),
`mesures.json` (brut), `captures.md` (index des captures).

## 1. Ce que mesure l'outil — et ses limites

| Contrôle | Méthode |
|---|---|
| Contraste AA | styles calculés : la couleur de texte est **composée** sur le fond réel (empilement des couches alpha), seuils WCAG 1.4.3 : 4,5 (ou 3,0 pour le grand texte) |
| Débordement horizontal | `documentElement.scrollWidth` vs `innerWidth` + liste des éléments dépassant |
| Cibles tactiles | WCAG 2.2 §2.5.8 : repérage des cibles < 44 px et < 24 px |
| Accessibilité de base | nom accessible des `button`/`a`, `alt` des images, association des champs |
| Robustesse | erreurs JavaScript (`pageerror`) pendant toute la campagne |

**Limites assumées (faux positifs écartés du décompte)**

- Les **emojis ignorent `color`** : les `span.bi` relevés à 1,86–2,93:1 sont des artefacts
  de mesure, pas des défauts (≈ 12 lignes). Même remarque pour les emojis dans les pastilles.
- Les nœuds **cachés restent dans le DOM** : `input#wd-phone`, `input#wd-amount`,
  `input#avatar-input` sont signalés « sans étiquette » sur des écrans où ils ne sont pas
  visibles — le signalement reste valable (voir §4.9) mais il n'est pas propre à l'écran.
- Les éléments **hors écran au moment de la mesure** ne sont pas évalués (une mesure par écran,
  en haut de page).
- Le **contraste des surfaces** (fond de panneau vs fond de page) n'est pas normé : il reste
  un jugement visuel (§5).
- 4 passages mesurés à cette étape, avant le rafraîchissement de la revue suivante.

**Validation du moteur de mesure** : en thème nuit, `--muted: #5E6072` sur `--panel: #0A0A0C`
donne **3,196:1** au calcul manuel → l'outil mesure **3,20:1** sur le même couple. Le calcul
de contraste est donc fiable au centième.

## 2. Chiffres clés

| Indicateur | Valeur |
|---|---|
| Captures | **53** (desktop jour, desktop nuit, 390, 360, états, compte vide) |
| Mesures d'écran | **36** (10 routes × 3 gabarits + 4 écrans en 360 px + compte neuf + un retour d'états) |
| Segments de texte mesurés | **411** |
| Non-conformités AA listées | **133** (≈ 12 = faux positifs emoji → ≈ 121 réelles) |
| Débordement horizontal | **0** sur 1440 / 390 / 360 px |
| Erreurs JavaScript | **0** |
| Boutons/liens sans nom accessible | **0** |
| Images sans `alt` | **0** |
| Cibles < 24 px | **77**, dont ≈ 60 liens de texte en ligne (exception « inline » WCAG 2.2) et 4 pastilles de pagination de 9×9 px |

Le socle est sain : **aucune erreur JavaScript, aucun débordement, aucune image sans `alt`,
aucun bouton anonyme** sur 36 écrans mesurés.

> **Mise à jour du 23/09/2026** — les lots **S1 à S7** ont été appliqués le jour même. Les
> non-conformités de contraste AA sont **réparées et mesurées** : **139 → 99 → 67 → 0** sur les
> 411 → **417** segments de texte des 36 écrans ; les cibles tactiles sont passées de **77 à 65**, les
> **serrures** du clavier ont été ouvertes (236 → 0 cliquables non focusables) et la barre haute mobile
> est revenue sur **une ligne** (107 → 50 px). Détail et preuves aux **§11 à §17**.

## 3. Contraste — 133 relevés, 12 causes racines

Les 133 lignes de non-conformité se réduisent à **12 familles** : corriger les jetons, pas les écrans.

| Cause racine (jeton / sélecteur) | Ratio mesuré | Occurrences | Écrans |
|---|---|---|---|
| Thème **nuit** `--muted` `#5E6072` sur `--panel` `#0A0A0C` | **2,96 – 3,20** | 7× `div.panel-title` + ≈ 30 textes | **tous les écrans nuit** |
| `.badge-chip` badges de rang (Remenabila 1,86 · Malaso 2,40 · Totakely 2,93 · Dahalo 3,66) | **1,86 – 3,66** | 6× | Classement, Profil, Match |
| `.pill.light` / `.pill.dark` — type de pion (« Clairs » / « Sombres ») | **2,30 – 2,59** | 4× (8 cartes) | Boutique |
| `.mono.amber` — prix des skins | **2,67** | 11× | Boutique |
| `.skin-group-title.light` / `.dark` — « Pions clairs / sombres » | 3,18 – 3,19 | 4× | Boutique |
| `.pill.green` « Possédé » · `.small.pos` « Gratuit » | 3,62 · 4,02 | 4× | Boutique |
| `.wc-ic` — pastille wallet de la barre haute (11 px) | 3,63 | **26×** | **tous** |
| `.pill` générique (« 📍 Antananarivo · Saison 2 », « En attente », « 🔒 Aucune messagerie… ») | 4,23 | 14× | tous |
| `button.chip` / `.chip.on` — filtres du Classement | 4,23 – 4,33 | 4× | Classement |
| `div.k` libellés de tuiles · initiales `.avatar` · `.tx-amt.pos` montants crédités | 4,23 – 4,34 | 10× | Accueil, Profil, Wallet |
| `span.at` horodatages du chat — **10 px** | 4,12 (jour) · **2,61** (nuit) | 4× | Messagerie |
| Textes `muted` sur fond teinté en nuit (état vide Accueil, descriptions boutique 3,01) | 3,01 – 3,20 | 6× | Accueil, Boutique |

> **Ces douze causes sont éteintes** (23/09/2026) : chaque famille a été reprise par un lot correctif
> (§11 S1, §12 S2, §13 S3) et la dernière campagne ne relève **plus aucune** non-conformité AA sur
> les 411 segments de texte des 36 écrans. Le tableau ci-dessus reste la photographie de l'état
> initial.

**Lecture.** En **jour**, les écarts sont *rampants* : les familles de petit texte gris/couleur
tombent entre 3,6 et 4,34 (soit à 0,2–0,9 du seuil) — seuls les **badges de rang**, les
**pastilles de type** et les **prix** sont franchement insuffisants (1,86–2,67).
En **nuit**, le défaut est **systémique** : le jeton `--muted` est *plus sombre que celui du
thème jour* (`#5E6072` vs `#6B6E80`) alors que le fond passe de `#FFFFFF` à `#0A0A0C` — tous les
textes secondaires, **y compris les titres de panneaux** (`.panel-title`), sont à 3,2:1.
Le thème jour est donc globalement conforme (`--muted` sur blanc = 5,04:1, au-delà de 4,5),
le thème nuit ne l'est pas.

## 4. Points majeurs (hors contraste)

**4.1 — Références internes « PRD §x.y » affichées aux joueurs.** *Retenu.*
Cinq emplacements visibles : « BOUTIQUE — SKINS (PRD §2.7) », « Règles du wallet (PRD §4) »,
« Joueur → opérateur → Wallet D-aôna… (PRD §4.1) », « National · régional · par jeu · saisonnier —
données joueurs collectées (**PRD §9**) ». Le lecteur n'est pas un développeur : remplacer par un
bénéfice joueur (« Skins de pions », « Comment fonctionne le wallet ») ou retirer la parenthèse.

> **Inventaire complet avant le lot S5** : la chaîne apparaît **16 fois** dans `index.html` —
> **15 emplacements visibles** (sous-titres des pages Classement et Messagerie, panneau KYC, dépôt,
> retrait, note du défi, entraînement, répartition du cashprice, règles du wallet, boutique, règle
> du forfait, aide, abandon, verrou du chat) et **1 commentaire de code** (barème du cashprice, à
> conserver). Le lot S5 traitera chaque site : bénéfice joueur ou retrait de la parenthèse.
>
> **Soldé par le lot S5** (§15) : les **15 sites visibles** ont été traités — soit remplacés par un
> bénéfice joueur, soit réduits au titre nu. Il ne reste dans `index.html` que **1 mention en
> commentaire de code** (conservée : elle documente le barème pour la maintenance) et **3 mentions
> invisibles** (sous-titre `<meta>`, intitulé du bloc « Design System », note de pied de la scène
> « Bon retour » qui annonce la version de la maquette). Vérifié dans le navigateur : **aucune
> référence « PRD § » dans le texte visible de 14 écrans** (compte vierge et compte rempli).

**4.2 — Entraînement IA : la barre joueur (bas du plateau) reste figée sur la maquette.** *Retenu.*
Captures `desktop-jour__plateau-ia.png`, `desktop-nuit__plateau-ia.png`,
`mobile-390__plateau-ia.png` : la carte du bas affiche **« TR »**, **« 1126 Elo »** et le nom par
défaut « Vous », alors que le compte a **1100 Elo** (visible sur l'Accueil et le Profil) et que la
carte adverse affiche un Elo dérivé du vrai Elo du joueur.
Cause : le mode IA démarre par `Fanorona.start(...)` (`index.html` l. 5765-5774) et **ne passe
jamais par** `startServerGame`, seul endroit qui remplit le HUD (l. 5837-5839 :
`hud-me-avatar` ← `S.pseudo.slice(0,2).toUpperCase()`). Le balisage porte les valeurs de
maquette : l. 3134 `>TR<`, l. 3137 `>1126 Elo<`.
Correctif : extraire le remplissage du HUD en une fonction commune et l'appeler aussi dans le
flux IA (3 lignes), puis neutraliser les valeurs de maquette du balisage (`—`).

> **Soldé par le lot S6** (§16) : `fillHudMe(pseudo, elo)` est le **seul** point de remplissage, et
> il est appelé par **les trois flux** qui affichent la barre — partie serveur (`startServerGame`),
> **entraînement contre l'IA** (`launchGame`) et **mode spectateur**. Les valeurs de maquette du
> balisage sont remplacées par `—`. Vérifié dans le navigateur : en entraînement IA la barre affiche
> « ZzRevueUI » · « **1100 Elo** » · avatar « ZZ », les valeurs du compte.

**4.3 — Modale de dépôt : la récapitulation ne s'additionne pas.** *Retenu.*
Capture `etat__wallet-depot.png` : « Montant du dépôt 5 000 Ar » / « **Frais opérateur estimés
(~2%) 100 Ar** » / « **Crédité sur le wallet 5 000 Ar** ». Impossible de savoir si les frais sont
prélevés (crédit 4 900), ajoutés (payé 5 100) ou offerts. À trancher et à écrire :
« Vous payez 5 100 Ar · crédité 5 000 Ar », par exemple.

> **Soldé par le lot S6** (§16) : la règle du serveur (`Wallet.credit(user.id, payload.amount)`)
> devient lisible à l'écran — « Montant du dépôt **5 000** » + « Frais opérateur estimés (~2%)
> **100** » = « **Total à payer chez l'opérateur 5 100** », puis « Crédité sur votre wallet
> **5 000** », expliqué par une phrase (les frais vont à l'opérateur, D-aôna ne prélève rien sur un
> dépôt). Le récapitulatif **suit désormais la pastille choisie** — avant, il restait figé sur la
> valeur d'ouverture alors que c'est la pastille sélectionnée qui partait au serveur. Vérifié par un
> **dépôt réel** : solde 150 000 → 155 000, soit **+5 000 Ar exactement**.

**4.4 — Classement : la liste passe sous la barre d'onglets.** *Retenu.*
Capture `desktop-jour__ranks.png` : la 8e ligne (« Ifehzoro ») est **coupée par la barre
d'onglets** — le conteneur défilant manque de marge basse. Correctif : `padding-bottom`
équivalent à la hauteur de la barre fixe.

> **Traité par le lot S7, avec une nuance qui compte** (§17) : la sonde **scrolle chaque zone jusqu'en bas
> avant de mesurer** — à cette position, **aucun** contenu n'était recouvert par la barre d'onglets (la
> réserve de 96 px de `#screens` suffisait) : le constat, tel que décrit, **ne reproduit pas**. La capture
> montrait une ligne sous la ligne de flottaison, ce qui est normal pour une liste qui défile. Le contrôle
> dédié a toutefois trouvé **deux zones finissant sans air** (0 px sur l'écran Amis, −1 px sur la colonne
> Boutique du Profil) : une réserve de **16 px** en bas des colonnes défilantes les corrige (**0** zone à
> moins de 12 px d'air sur 40 relevées).

**4.5 — Accueil : six tuiles pour quatre valeurs, dont une contradiction.** *Retenu.*
Capture `desktop-jour__home.png` : tuile 1 « 0 **VICTOIRES** » et tuile 5 « 0% **VICTOIRES** »
(même donnée, deux unités) ; « 0% WIN RATE » alors qu'**aucune partie n'a été jouée** (« — » serait
juste) ; au total 6 cartes pour 4 informations. Correctif : 3 tuiles (Parties jouées · Victoires ·
Solde wallet), et « — » quand le dénominateur est nul.

> **Soldé par le lot S7** (§17) : **trois tuiles pour trois valeurs** — Parties jouées · Victoires · Solde
> wallet. Le « WIN RATE » contradictoire disparaît de l'Accueil (le taux vit sur le Profil, où il est
> détaillé et où le dénominateur est visible) et le montant en Ariary se réduit avec la largeur au lieu de
> déborder de sa tuile.

**4.6 — Accueil : état vide faible qui mange la moitié de l'écran.** *Retenu.*
« Aucune partie pour le moment. » occupe un panneau d'≈ 440 px de haut, sans icône, sans CTA —
alors que l'état vide de **Match** (« Aucune partie chez vos contacts » : icône, phrase,
deux boutons) est **exemplaire** et devrait servir de modèle. Correctif : reprendre cette
grammaire (icône + phrase + « Trouver un adversaire »).

> **Soldé par le lot S5** (§15) : le panneau monte désormais l'état vide de Match (icône œil, titre,
> phrase, bouton « Trouver un adversaire » qui mène au Match — clic vérifié) et il **se centre dans
> la zone de défilement** au lieu de flotter en haut d'un panneau vide.

**4.7 — « Tournoi introuvable. » : impasse.** *Retenu.*
Mesures `desktop-nuit/tournament` et `mobile-390/tournament` : un lien profond périmé aboutit à un
paragraphe isolé (15 px, 3,2:1 en nuit), **sans bouton retour ni CTA**. Correctif : « Revenir aux
tournois » et un ton neutre.

> **Soldé par le lot S5** (§15) : même gabarit d'état vide que le reste de l'application (icône
> d'alerte, titre, phrase qui dit où sont les tournois ouverts, bouton **« Revenir aux tournois »**) ;
> le bouton ouvre bien **l'onglet Tournois de l'écran Match** — clic vérifié en 1440 px et en 390 px.

**4.8 — Cibles tactiles : les pastilles de pagination.** *Retenu (à confirmer).*
`button.pg-dot` mesure **9×9 px** (30×9 pour l'actif) sur l'écran Jeux : sous la cible de 24 px de
la WCAG 2.2 §2.5.8. L'**exception d'espacement** peut s'appliquer (points très espacés) — à
vérifier au calculateur ; sinon agrandir la zone cliquable (padding + pseudo-élément) **sans
changer le dessin**. Les ≈ 60 liens `.link-pseudo` de 16–22 px relèvent, eux, de l'exception
« cible en ligne » : **non retenus** comme défauts.

> **Vérification apportée par le lot S4** : l'**exception d'espacement ne s'appliquait pas** — avec
> un `gap` de 9 px, les cercles de 24 px centrés sur chaque pastille se recouvrent. La zone
> cliquable est passée à **24×24 px** sans changer le dessin (§14). Relevé complet des cibles :
> `graphify-out/revue-ui/S4-avant/perimetre-cibles.txt`.

**4.9 — Champs sans nom accessible.** *Retenu.*
`input#wd-phone` et `input#wd-amount` ont des **libellés visibles** (« Numéro destinataire »,
« Montant (disponible : …) ») mais les `<label>` n'ont **pas d'attribut `for`** et les champs ne
sont pas imbriqués : un lecteur d'écran annonce « zone de texte » sans nom. `input#avatar-input`
(fichier, masqué) n'a ni `for` ni `aria-label`. Correctif : 3 attributs.

> **Soldé par le lot S6** (§16) — et **le chiffre de ce point était sous-estimé** : le relevé du lot
> a trouvé **8 champs** sans nom, pas 3 (les trois ci-dessus **plus** `#province-select`, `#chat-field`,
> le champ de la fenêtre de chat flottante, `#sp-motif` et `#sp-msg` des deux modales de support).
> Les huit sont nommés ; l'audit du lot contrôle **tous les champs réellement montés** —
> 116 sur les écrans et les trois modales ouvertes, **tous nommés**.

**4.10 — Horodatages du chat à 10 px.** *Retenu.*
`span.at` mesure 10 px (4,12:1 jour, **2,61:1 nuit**), sous le plancher de lisibilité du reste de
l'interface (11 px). Correctif : 11 px + jeton de contraste corrigé (voir §7).

> **Corrigé par les lots S1 et S4** : le contraste par le lot S1 (jeton `--muted` de nuit), la
> **taille** par le lot S4 (10 → 11 px, §14). Le lot S4 a aussi mis à niveau l'horodatage de la
> **fenêtre de chat flottante** (9,5 px à 60 % d'opacité : **2,74 – 3,30:1** composés), surface que
> les 36 écrans capturés ne montraient pas.

## 5. Points mineurs

- **« Ar 150 000 Ar »** dans la pastille wallet de la barre haute : l'unité est affichée deux fois
  (icône « Ar » + suffixe). Un seul suffit.
  *(Soldé par le lot S5, §15 : l'unité ne subsiste que dans l'icône ; le montant n'est plus qu'un
  nombre.)*
- **Pastilles étirées** dans les conteneurs flex : « Saison 2 — 2026 · classé ouvert » (héro
  Accueil) et « ID joueur unique · journal d'audit complet » (haut de Profil) occupent toute la
  largeur au lieu de s'ajuster au texte.
  *(Soldé par le lot S7, §17 : `align-self: flex-start` sur les deux — la pastille se dimensionne sur son
  texte ; la sonde géométrique passe de **2 pastilles étirées à 0** sur les 36 écrans.)*
- **En-têtes du Classement** : la colonne « # » et la dernière colonne n'ont pas de libellé (icône
  seule) ; le badge du joueur est affiché **deux fois** (pastille texte à côté du pseudo + colonne
  d'icônes de fin de ligne).
  *(**Constat rectifié au lot S8, §18** : vérification faite au code, `badgeChip()` — badge
  d'appartenance, avec son nom — et `medalFor()` — 🥇🥈🥉 des rangs 1 à 3 — sont **deux informations
  différentes**, pas un doublon ; et les quatre colonnes ont un libellé accessible (« # » avec
  `aria-label="Position"`, « Joueur », « Elo », médaille avec `aria-label` et `title`). **Rien à
  corriger** : ce point était une erreur de lecture de la capture.)*
- **Cohérence des avatars** : circulaires dans la barre haute, carrés arrondis dans le panneau
  « Votre classement » ; le **podium n'affiche aucun avatar** alors que la table juste à côté en a.
  *(Le **podium** est soldé par le lot S7, §17 : il affiche le même avatar 34 px que la table voisine, sous
  la médaille. La différence de forme entre les contextes est conservée : elle distingue le repère
  d'identité (barre haute) du portrait de tableau.)*
- **Thème nuit : séparation des surfaces faible** — les tuiles de statistiques se distinguent à
  peine du fond (un cran de gris) : la hiérarchie repose alors presque uniquement sur les
  bordures. Un `--panel` légèrement plus clair en nuit rendrait les blocs lisibles comme en jour.
  *(Soldé par le lot S7, §17 : échelle des surfaces relevée d'un cran — `--panel` `#0A0A0C → #0E0E12`,
  `--panel-2` `→ #18181F`, `--panel-3` `→ #1F1F28`, soit **1,09 / 1,19 / 1,28:1** du fond noir — et voile
  clair sur les tuiles du héro de nuit. Deux encres ont dû suivre : le bronze du badge et l'horodatage des
  bulles de mes messages.)*
- **Barre haute en mobile (390 px)** : elle occupe **deux lignes** (~85 px) — « KYC vérifiée » +
  deux icônes sur la première, cloche/wallet/avatar sur la seconde. Le regroupement paraît
  accidentel : à resserrer (toutes les icônes ensemble, KYC déplacé).
  *(Soldé par le lot S7, §17 : **50 px sur une ligne** à 390 px comme à 360 px (107 px auparavant). Le nom
  de l'application cède la place au logo, la pastille KYC se réduit à sa coche — intitulé complet conservé en
  infobulle, en nom accessible et sur l'écran Profil.)*
- **Modale de dépôt** : le chevron « › » de chaque opérateur suggère une navigation alors que la
  ligne **sélectionne** (affordance trompeuse) ; MVola est présélectionné sans que ce soit dit.
  *(Soldé par le lot S6, §16 : le chevron cède la place à une **coche**, affichée sur la ligne active
  seulement — l'affordance dit vrai et la présélection se voit ; l'état passe aussi par `aria-pressed`
  pour les technologies d'assistance.)*
- **Mobile** : le bouton flottant de messagerie recouvre le contenu (panneau « Vérification KYC »
  à 390 px) → prévoir une marge basse sur les écrans longs.
  *(Contrôlé par le lot S7, §17 : la sonde géométrique mesure **0 recouvrement** — le bouton flottant est
  hors du flux et le contenu défile sous lui sans qu'aucune cible ne devienne inatteignable ; le contrôle de
  fin de course confirme **16 px d'air minimum** sous le dernier contenu des 40 zones relevées.)*
- **Match — « VOS CONTACTS »** : « 0 en ligne · **5** contact(s) » mais **4 lignes** affichées et
  « Voir tous vos contacts (5) » → ajouter « et 1 autre » ou tout afficher.
  *(Soldé par le lot S5, §15 : le compteur dit ce qui est **affiché** — « 4 sur 5 contact(s) » tant
  que la liste est repliée, « 5 contact(s) » une fois dépliée.)*
- **Tirage au sort** : la modale de résultat s'affiche en plein écran (voile flouté) **par-dessus le
  plateau, au moment précis où le joueur doit regarder la position** — il faut la fermer avant de
  voir l'échiquier (constaté pendant la campagne : l'outil doit explicitement la refermer pour
  photographier la position). Une bande non modale (« Vous jouez PILE — vous commencez »)
  laisserait le plateau visible et resterait aussi claire.
  *(**Soldé par le lot S8, §18** : l'annonce est passée en **bande non modale** au-dessus du plateau
  (`role="status"`, `aria-live="polite"`, effacement à 7 s ou sur clic). La vérification fonctionnelle
  clique pendant l'annonce : le plateau **sélectionne une pièce**, il n'est plus recouvert. Le même
  contrôle a fait apparaître un second défaut — l'annonce disait « Vous jouez en premier » même quand
  la pièce désignait l'IA en entraînement : cause et correction au §18.)*

## 6. Ce qui est déjà solide (à préserver)

Une revue n'est utile que si elle dit aussi ce qui marche — et ici le socle est bon :

- **Aucun débordement horizontal** à 1440, 390 et 360 px (36 mesures d'écran) ; **aucune erreur
  JavaScript** ; **aucun bouton ni lien sans nom accessible** ; **aucune image sans `alt`**.
- **Barre d'onglets exemplaire** : `role="tablist"`/`role="tab"`, `aria-selected`, `aria-controls`
  — l'état actif est en plus porté par une couleur d'accent **par section** (vert/ambre/rouge/bleu).
- **Plateau** : la convention de camp est immédiatement lisible (mes pions en bas, clairs ; les
  siens en haut, sombres), la carte « Vous » est surlignée, les aides au déplacement sont des
  pastilles discrètes, le tirage au sort est expliqué en français (« Le tirage au sort désigne
  Vous (Noir)… »), et le mode spectateur est annoncé (« Lecture seule : les coups viennent du
  serveur »).
- **État vide de Match** : icône, phrase explicative, deux actions — le modèle à généraliser (§4.6).
- **Grammaire des modales** : voile flouté, titre, récapitulation, action primaire + annulation
  (dépôt, retrait, choix du camp) — cohérente d'un bout à l'autre.
- **Boutique de skins** : les 11 skins sont visuellement distincts (clairs chauds / sombres
  profonds), les sections, les filtres, les prix et les états « Possédé »/« Équipé » sont
  compréhensibles au premier regard ; la carte équipée est soulignée d'un liseré vert.
- **Vocabulaire constant** : tout est en français, l'ariary est noté « Ar », l'Elo est toujours
  suffixé, les pseudos cliquables sont signalés — aucune incohérence terminologique relevée.

## 7. Un seul grand gain (« one big win »)

**Recalibrer les jetons de texte secondaire des deux thèmes.** À lui seul, ce lot supprime
**≈ 100 des 133 non-conformités** relevées, sur tous les écrans, sans toucher à la mise en page :

| Jeton | Aujourd'hui | Mesure | Cible proposée | Résultat attendu |
|---|---|---|---|---|
| Nuit `--muted` | `#5E6072` | **3,20:1** | `#85879A` | **≈ 5,6:1** (7 titres de panneaux + ≈ 30 textes réparés) |
| Jour `.pill` / `.chip` / `.k` | texte sur teinte « soft » | 4,23 – 4,34 | teinte de fond rapprochée du panneau (ou texte assombri) | ≥ 4,5:1 (≈ 28 occurrences) |
| `.wc-ic` (pastille wallet) | 11 px, 3,63:1 | 3,63 | teinte de fond adoucie | ≥ 4,5:1 (26 écrans) |
| Badges de rang `.badge-chip` | 1,86 – 3,66 | **1,86** | texte foncé sur teinte claire | ≥ 4,5:1 |
| Prix `.mono.amber` · type `.pill.light/.dark` · titres de section boutique | 2,30 – 3,19 | **2,30** | encre dédiée (texte foncé) plutôt que la teinte de marque | ≥ 4,5:1 |

Ces valeurs sont **indicatives** : elles doivent être passées à la sonde de contraste du projet
avant d'être figées (voir §9). Le calcul manuel de la ligne `--muted` nuit a déjà été vérifié
(§1), et le thème jour n'a besoin que de retouches légères — le thème nuit est le vrai chantier.

> **Le jeton nuit est fait** : `--muted` est passé de `#5E6072` à **`#85879A`** le 23/09/2026
> (5,59:1 sur `--panel`, 5,13:1 sur `--panel-3`, 4,53:1 même sur une teinte de marque). Les
> valeurs du tableau ci-dessus sont donc **mesurées**, plus estimées — voir le §11.

> **Le tableau est soldé** (23/09/2026) : les cinq chantiers ont été appliqués et mesurés — §11
> (S1), §12 (S2), §13 (S3). Cumul : **139 → 99 → 67 → 0**. Le gain estimé « ≈ 100 des 133 » s'est
> vérifié, et au-delà : il ne subsiste **aucune** non-conformité AA, à mise en page constante et
> sans abandonner une seule teinte de marque — elles sont désormais réservées aux fonds, bordures
> et dégradés, où elles sont conformes.

## 8. Propositions retenues, propositions écartées

**Retenus** : les 12 familles de contraste du §3 (priorité : jeton nuit, badges, prix, pastilles de
type) ; puis §4.1 à §4.10 ; puis les dix points mineurs du §5 — dont les deux corrections les plus
rentables : **retirer les « PRD §x.y »** de l'interface et **défiger la barre joueur de
l'entraînement IA**.

**Écartés après vérification** (il est aussi important de dire ce qu'on n'a *pas* retenu) :

| Observation | Motif de l'abandon |
|---|---|
| Faute de frappe « Défs » sur la tuile Match | Vérification au fichier, l. 3212 : le libellé est bien **« Défis »**. La faute venait de l'affichage du terminal, qui avait avalé un caractère. |
| Balise invalide `<spanclass="s">` (l. 3212) | Le fichier contient `<span class="s">` ; le détecteur de balises incomplètes (`<spanclass`, `<divclass`, …) renvoie **0** occurrence. Artefact d'affichage, aucun correctif. |
| Tuiles Match : « carte blanche » incohérente avec les deux autres | C'est la grammaire **active/inactive** de l'écran (l'onglet actif est la carte pleine) — comportement documenté (scénario S12). Conservé tel quel. |
| Barre d'onglets claire en thème nuit | Inversion volontaire pour détacher la navigation du fond sombre ; cohérente avec la barre haute. Conservé tel quel. |
| ≈ 60 liens de pseudo mesurés à 16–22 px | Exception « cible en ligne » (WCAG 2.2 §2.5.8) : le lien est inséré dans une phrase, il n'a pas à mesurer 24 px. |
| Emojis mesurés entre 1,86 et 2,93:1 (🥇 🛡️ 👑) | Les emojis ignorent la propriété `color` : la mesure ne porte sur rien. Exclus du décompte. |
| `#avatar-input`, `#wd-phone`, `#wd-amount` « sans étiquette » sur des écrans sans modale | Nœuds cachés présents dans le DOM. Le fond du constat reste valable (§4.9) ; l'occurrence multiple, non. |
| Pastilles de pagination 9×9 px | Retenu **sous réserve** : l'exception d'espacement de la WCAG peut s'appliquer. À trancher au calculateur avant d'y toucher. |

## 9. Suite proposée (lots correctifs, après validation de ce rapport)

Aucun code applicatif n'a été modifié pendant la revue : les travaux ont eu lieu sur une **copie
jetable** de la base et de l'instance. Les lots ci-dessous sont ordonnés **par rendement décroissant**
(le nombre indiqué est le nombre de non-conformités mesurées que le lot supprime) :

| Lot | Contenu | Rendement attendu |
|---|---|---|
| **S1** | Jetons du thème nuit (`--muted`, teintes de surfaces) | ≈ 37 |
| **S2** | Badges de rang, prix, pastilles de type « Clairs/Sombres », titres de section de la boutique (encre dédiée) | ≈ 21 |
| **S3** | Familles de petit texte du jour (`.pill`, `.chip`, `.k`, `.wc-ic`, `.tx-amt`, initiales d'avatar) | ≈ 45 |
| **S4** | Tailles : horodatages 10 → 11 px ; zone cliquable des pastilles de pagination | 4 |
| **S5** | Contenus : retrait des « PRD §x.y », état vide de l'Accueil, « Tournoi introuvable », contacts tronqués, doublon « Ar » | — |
| **S6** | Comportements : HUD de l'entraînement IA, récapitulation du dépôt, chevron trompeur, noms accessibles des 3 champs | — |
| **S7** | Gabarits : marge basse du Classement et du bouton flottant, barre haute mobile, pastilles étirées, séparation des surfaces en nuit — **plus** les 236 cliquables inatteignables au clavier relevés par le lot S6 | — |

> **S1 à S8 sont appliqués** (23-24/09/2026) — mesures avant/après aux **§11 à §18** :
> **139 → 99 → 67 → 0** non-conformités de contraste (chaque passe mesurée avec le même outil),
> **77 → 65** cibles tactiles sous 24 px, **15 contenus internes** retirés de l'interface,
> **8 champs** de formulaire nommés pour les lecteurs d'écran, **236 → 0** cliquables rendus au clavier,
> barre haute mobile **107 → 50 px** sur une ligne, surfaces de nuit détachées (1,06 → 1,09/1,19/1,28:1),
> et **le tirage au sort rendu non modal** (le plateau reste jouable pendant l'annonce).
> **La file des huit lots est terminée et les deux arbitrages éditoriaux sont tranchés** (§18) ;
> aucun point de la revue ne reste ouvert.

**Protocole de validation de chaque lot** (dans cet ordre) :

1. `node test_ui_scenarios.js` → **110/110** (et `node test_scenarios.js` → 226/226 si le serveur est touché) ;
2. `node _check_html.js` → OK (le mono-fichier reste bien formé) ;
3. sonde de contraste du projet, **jour et nuit**, sur les jetons modifiés ;
4. **0 erreur JavaScript** dans la campagne d'interface ;
5. re-capture ciblée dans `graphify-out/revue-ui/` (avant/après) pour garder la preuve visuelle.

Si un test doit bouger, rappel : `test_ui_scenarios.js` est **assemblé** par `node _build.js`
(morceaux `_p*.js`) — il ne s'édite pas directement.

## 10. Annexe — où sont les preuves

| Fichier | Contenu |
|---|---|
| `graphify-out/revue-ui/captures.md` | index des **53** captures (une ligne par écran) |
| `graphify-out/revue-ui/*.png` | desktop-jour **12** · desktop-nuit **12** · mobile-390 **12** · mobile-360 **4** · états **7** · compte vide **6** |
| `graphify-out/revue-ui/mesures.txt` | journal lisible : thème appliqué, ratios fautifs écran par écran, débordements, cibles, a11y, erreurs JS |
| `graphify-out/revue-ui/mesures.json` | données brutes — **rejouables** : même entrée, mêmes chiffres |

**Dossiers par lot** (à partir de S1) — chaque lot laisse sa baseline **et** son état final, plus ses
propres relevés : `S1-avant/` … `S7-apres/` (53 captures + `mesures.txt/json` + `captures.md` + journal de
campagne par passe), et, selon le lot : `perimetre.txt` (relevé **avant** correction), `comparaison.txt`
(bilan avant/après), `segments-par-ecran.txt`, `verification-fonctionnelle.txt`, `releve-geometrie.txt`
(sonde de géométrie), `fin-de-course.txt` (air sous le dernier contenu), `defauts-identifies-mi-lot.txt`
(écarts transitoires attrapés pendant le lot). Les outils jetables correspondants sont dans
`apps/api/` : `_revue_ui.js` (campagne), `_s1_analyse.js`/`_s2_scope.js` (périmètres), `_s4_cibles.js`,
`_s5_verif.js`, `_s6_probe.js`/`_s6_verif.js`, `_s7_probe.js`/`_s7_fin.js`, `_s5_seg.js`, `_s1_compare.js`.

**Groupes de captures**

- `desktop-jour__*`, `desktop-nuit__*`, `mobile-390__*` : `home`, `play`, `match`, `ranks`, `wallet`,
  `profile`, `chat`, `friends`, `notifications`, `tournament`, puis `plateau-ia` (position initiale
  d'un entraînement réel) et `plateau-ia-coups` (pièce sélectionnée, aides au déplacement affichées).
- `mobile-360__{home,match,profile,tournament}` : les quatre écrans critiques en 360 px.
- `etat__*` : `match-defis`, `match-tournois`, `ranks-province` (recherche ouverte), `wallet-depot`,
  `wallet-retrait`, `tournoi-detail` (détail + bracket), `profil-public`.
- `vide__*` : `home`, `wallet`, `notifications`, `friends`, `chat`, `tournament` sur un **compte neuf**.

**Rappel de méthode.** L'outil (`apps/api/_revue_ui.js`) est **jetable** (motif `_*.js`, hors
git) et n'écrit rien dans l'application : il copie la base, y crée ses deux comptes de revue, y
applique le jeu de démonstration, démarre une instance sur le port 8095, capture, mesure, puis
supprime la copie. Aucune donnée réelle n'est exposée dans les captures : les écrans sont remplis
par `demo_seed.js` (pseudos « Demo… »), et les montants, défis et messages photographiés sont
**fictifs**.

## 11. Suivi — lot S1 appliqué, mesuré, prouvé (23/09/2026)

**Ce qui a changé dans l'application** — une seule ligne, le jeton du thème nuit :
`html[data-theme="night"] { --muted: #5E6072 → #85879A }` (`index.html`, l. 126-131, commentaire
de justification inclus). Aucune autre règle CSS, aucun script, aucun jeton du thème jour.

**Protocole de preuve** — la campagne complète (`node apps/api/_revue_ui.js`) a été rejouée
**deux fois avec le même outil** : une passe **avant** la modification (baseline), une passe
**après**. La sonde enregistre désormais, pour chaque ligne fautive, **l'encre et le fond
réellement composés** : les non-conformités se classent donc **par jeton**, et l'on peut prouver
qu'une famille est réparée *sans* en abîmer une autre.

| Indicateur (36 écrans) | Avant | Après | Delta |
|---|---|---|---|
| Segments de texte mesurés | 411 | 411 | — |
| **Non-conformités AA** | **139** | **99** | **−40** |
| Erreurs JavaScript | 0 | 0 | — |
| Débordements horizontaux | 0 | 0 | — |
| Boutons/liens sans nom accessible | 0 | 0 | — |
| Images sans `alt` | 0 | 0 | — |
| Cibles < 24 px | 77 | 77 | — |

**Par famille d'encre** — une seule bouge : celle du jeton corrigé.

| Encre | Jeton / sélecteur | Avant | Après |
|---|---|---|---|
| `#5E6072` | **nuit `--muted`** | **40** | **0** ✅ |
| `#6B6E80` | jour `--muted` | 26 | 26 |
| `#0F8A64` | jour `--brand-2` (pastille wallet) | 31 | 31 |
| `#4F8FF7` | `--blue` | 18 | 18 |
| `#D97706` | `--amber` (prix) | 8 | 8 |
| `#E3B23C` · `#9AA3AD` · `#B0703C` | badges de rang | 2 · 2 · 2 | 2 · 2 · 2 |
| `#04150E` | `.chip.on` | 2 | 2 |
| `#15803D` · `#17825F` | avatar vert · `--brand` | 1 · 1 | 1 · 1 |

> Lecture : la sonde ne remonte que **14 lignes fautives par écran** ; les deux écrans de Profil du
> thème jour en comptent 17 chacun, donc les familles listées ici sont un **plancher** (93 des 99).
> La ligne `#5E6072` est, elle, **exacte** : aucun écran de nuit n'atteint le plafond de 14, son
> compte était de 40 avant, il est de 0 après — et c'est exactement le delta du bilan (−40).
> **Correction apportée par le lot S2** : ce plafond fausse aussi la lecture de la famille
> `#6B6E80` (elle passe de 26 à 30 alors que le total baisse) — voir la note de méthode du §12.

Les familles restantes sont **exactement** celles des lots S2 (badges, prix, pastilles de type) et
S3 (petit texte du jour) : **rien de nouveau n'est apparu**.

**Par écran (thème nuit)** — huit écrans passent à zéro : Accueil 4→0, Match 1→0, Classement 8→0,
Wallet 3→0, Profil 10→0, Messagerie 7→0, Amis 4→0, Tournois 1→0 ; Notifications 3→1 (il reste la
ligne d'encre `#17825F`, lot S2). Sur les **26 écrans jour et mobile**, le compte est **identique à
l'unité près** : le lot ne touche que la nuit, et la mesure le confirme (aucun effet de bord).

**Hiérarchie conservée, avec une nuance assumée.** `#85879A` reste plus sombre que `--text`
(`#9C9EAE`) : **1,33:1 entre les deux encres**, contre 2,13:1 dans le thème jour. La nuit est donc
un peu plus « plate » entre texte courant et texte secondaire. Pour retrouver l'écart du jour, le
levier est `--text` (la **remonter**, pas rabaisser `--muted`) — choix esthétique, hors du lot S1,
sans effet sur les conformités.

**Deux contournements ne sont plus obligatoires.** `index.html` en porte deux, écrits pour ce
défaut : « Sous-libellé d'un titre de panneau : en `--text`, pas `--muted` (AA la nuit) » (l. 1407)
et « la charte nuit ne donne que 3,1:1 avec `--muted` » (l. 1613). Ils **restent valides** — une
encre plus forte n'est jamais un défaut — les rétablir en `--muted` serait un changement visuel à
part entière, à décider explicitement.

**Validation du lot** — `node _check_html.js` OK (mono-fichier bien formé) ·
`node test_ui_scenarios.js` **110/110** (dont « le serveur sert bien la version courante de
l'interface » et 0 erreur JS) · `node test_scenarios.js` **non rejoué** : le serveur n'a pas été
touché · relecture visuelle des captures nuit avant/après (Profil, Accueil, Classement, Messagerie).

**Preuves.** `graphify-out/revue-ui/S1-avant/` · `S1-apres/` : les **53 captures**, `mesures.txt`,
`mesures.json` et le **journal de campagne** de chaque passe, plus `comparaison.txt` (les tables
ci-dessus, régénérables par `node apps/api/_s1_compare.js`). Le dossier principal
`graphify-out/revue-ui/` porte l'état **après** S1 ; `S1-avant/` porte l'état décrit aux §2 à §5.

> **Sur les chiffres.** Le §2 annonce **133** non-conformités : cette campagne-là avait été mesurée
> en plusieurs passes (§1, limites), avant un rafraîchissement de la revue. La comparaison qui fait
> foi pour ce lot est la paire **139 → 99**, mesurée deux fois d'affilée avec le même outil et le
> même état de démonstration ; les deux lectures ne sont pas à comparer entre elles.

## 12. Suivi — lot S2 appliqué, mesuré, prouvé (23/09/2026)

**Ce qui a changé** — des **encres dédiées** pour le thème jour (les teintes de marque restent
décoratives : elles ne portent plus le texte), et une encre de badge qui dépend enfin du thème.

| Élément | Avant | Après |
|---|---|---|
| **Badges de rang** (6, catalogue `BADGES`) | teinte de marque en texte — or `#e3b23c` à **1,86:1** | une encre par badge dans la même famille : `#7a5a00` or · `#48525c` argent · `#7a4210` bronze · `#1e40af` bleu · `#0f6b33` vert · `#525669` gris. La nuit garde la teinte claire (≈ 9:1 sur le noir) |
| **Prix de la boutique** (`.skin-card .amber`) | `--amber`, **2,67:1** | `#92400e` — la convention que `.pill.amber` utilisait déjà en mode clair |
| **Pastilles de type** « Clairs / Sombres » | `--amber` **2,38 / 2,59:1** · `--blue` **2,30 / 2,51:1** | `#92400e` · `#05507f` |
| **Titres de section de la boutique** | **3,19 / 3,18:1** | les mêmes encres |
| Choix de l'encre du badge | couleur en **style en ligne** (insensible au thème) | variables CSS `--b-ink` / `--b-ink-day` posées en ligne, **la règle de thème choisit** |

Le thème **nuit n'est pas touché** : ses teintes claires y donnent 6,3 à 8,7:1 sur le noir.

**Mesure** — même protocole qu'au §11 (campagne complète avant/après, classement par encre) :

| Indicateur (36 écrans) | Avant | Après | Delta |
|---|---|---|---|
| **Non-conformités AA** | **99** | **67** | **−32** |
| Erreurs JavaScript · débordements · cibles < 24 px | 0 · 0 · 77 | 0 · 0 · 77 | — |

| Famille réparée | Jeton / éléments | Avant | Après |
|---|---|---|---|
| `#4F8FF7` | `--blue` jour : pastilles `.dark`, titres boutique, badge Totakely | 18 | **0** |
| `#D97706` | `--amber` jour : prix, pastilles `.light`, titres boutique | 8 | **0** |
| `#E3B23C` · `#9AA3AD` · `#B0703C` | badges or / argent / bronze | 2 · 2 · 2 | **0 · 0 · 0** |

Total réparé : **32 relevés**, soit **exactement** le delta du bilan. **Aucun écran en hausse** sur
les 25 écrans jour/mobile (Classement 12 → 4, Profil 17 → 8, mobile 5 → 3) ; les écrans de nuit
restent conformes, hors la ligne `--brand` (lot S3).

**Une correction en deux temps — et c'est écrit exprès.** La première encre bleue retenue,
`#0369a1`, mesurait **4,29:1** sur la teinte *réelle* de la pastille (`#D4DBF1`) et non sur le
`#E0F2FE` du jeton (`--blue-soft` posé sur une carte grise). La campagne l'a rattrapée : encre
assombrie en `#05507f` (**6,18:1** sur ce même fond), campagne rejouée. C'est précisément ce que le
§7 annonçait — ces valeurs sont **indicatives**, la sonde tranche.

**Note de méthode — le plafond de 14 lignes.** La sonde ne remonte que 14 lignes fautives par
écran ; là où un écran en comptait 17, trois lignes restaient invisibles. Conséquence
contre-intuitive : après une correction, des lignes **masquées réapparaissent** et le compte d'une
famille **monte** alors que le total baisse — c'est arrivé à `#6B6E80` (26 → 30) et à `.chip.on`
(2 → 4), deux familles du lot S3 restées intactes. Le tableau par famille est donc un **plancher** :
la preuve d'un lot, ce sont le **total** et les familles **tombées à zéro**.

**Vérifications.** `node _check_html.js` OK (mono-fichier bien formé, syntaxe du script en ligne
validée) · `node test_ui_scenarios.js` **110/110** · contrôle visuel des captures jour avant/après
(boutique : prix, pastilles, titres ; Classement : les quatre badges affichés) · `test_scenarios.js`
non rejoué, le serveur n'a pas été touché.

**Preuves.** `graphify-out/revue-ui/S2-avant/` (baseline = état après S1) et `S2-apres/` : les 53
captures, `mesures.txt`, `mesures.json`, le journal de campagne de chaque passe, `comparaison.txt`
et `perimetre.txt` (les 13 éléments visés, relevés **avant** correction). Outils : `_s2_scope.js`
(périmètre d'un lot) et `_s1_compare.js`, désormais générique —
`node apps/api/_s1_compare.js S2-avant`.

**État cumulé : 139 → 99 (S1) → 67 (S2).** Restent les familles du **lot S3** : `--brand-2` (31 :
pastille wallet, « Gratuit », initiales d'avatar) · `--muted` jour (30 : pastilles génériques,
chips, libellés de tuiles, horodatages 10 px) · `.chip.on` (4) · initiales vertes (1) · `--brand`
nuit (1).

## 13. Suivi — lot S3 appliqué, mesuré, prouvé (23/09/2026) — le contraste AA est réglé

**Ce qui a changé dans l'application** — trois jetons et une quinzaine de sélecteurs, tous
d'apparence, aucun de structure :

| Élément | Avant | Après |
|---|---|---|
| **`--brand-2` employé comme encre** : `.pill.green` « Possédé », `.wc-ic` (pastille wallet), `.small.pos` « Gratuit », `.tx-amt.pos` (montants crédités) | `#0f8a64`, **3,62 – 4,34:1** selon la teinte | nouveau jeton **`--brand-ink`**, une **encre** distincte du jeton **décoratif** : `#0A6B4C` en jour (6,5:1 sur blanc, 5,4:1 sur la pastille la plus foncée) et `#2BA37E` en nuit (l'ancienne teinte claire, 6,3:1 sur le noir) |
| `--muted` **jour** | `#6B6E80` : 5,04:1 sur blanc, mais **4,23:1** sur `--panel-2` et 4,35:1 sur `--panel-3` | `#5C5F72` : **6,30:1** sur blanc, 5,28:1 sur `--panel-2`, 4,77:1 sur `--panel-3` (le fond le plus sombre de la charte claire) |
| **`.chip.on`** — filtre actif du Classement | encre `#04150e` à **4,33:1** : le fond vert clair était trop clair pour toute encre de 13 px | **jour** : fond `--brand-ink`, encre **blanche** (6,5:1) ; **nuit** : inchangé (5,9:1, mesuré conforme) |
| `.avatar.av-g` — initiales d'avatar vertes | `--mt-green` **4,30:1** | `--brand-ink` |

**L'arbitrage de `.chip.on`** mérite d'être noté : l'encre y était déjà à son maximum atteignable
(4,33:1 sur un fond `#0F8A64` trop clair — aucune encre n'y passe 4,5:1 en 13 px). Deux voies
possibles : assombrir une encre qui ne peut pas l'être, ou **déplacer le fond**. C'est le fond qui a
bougé. Effet secondaire heureux : le filtre actif se lit désormais franchement comme un **état
sélectionné**.

**Quelques retouches de cohérence**, alignées sur `--brand-ink` sans qu'elles apparaissent aux
relevés (états non photographiés, grand texte, ou élément déjà conforme) : `.logo-name em`,
`.kpi .v`, `.help-toggle .help-state`, `#hint`, les deux étapes KYC « ✓ ». La mention **« Non lu »**
(nuit), elle, **était** relevée (4,14:1, encre `--brand`) — elle est réparée comme les autres. La
famille reste ainsi cohérente : plus aucune teinte de marque en position d'encre de texte.

**Mesure** — même protocole qu'aux §11 et §12 (campagne complète, classement par encre) :

| Indicateur (36 écrans) | Avant | Après | Delta |
|---|---|---|---|
| **Non-conformités AA** | **67** | **0** | **−67** |
| Erreurs JavaScript · débordements · boutons anonymes | 0 · 0 · 0 | 0 · 0 · 0 | — |

| Famille (encre mesurée) | Jeton d'origine | Avant | Après |
|---|---|---|---|
| `#0F8A64` | `--brand-2` en encre | 31 | **0** |
| `#6B6E80` | `--muted` jour | 30 | **0** |
| `#04150E` | `.chip.on` | 4 | **0** |
| `#15803D` | `.avatar.av-g` | 1 | **0** |
| `#17825F` | `--brand` nuit (« Non lu ») | 1 | **0** |

**Aucun écran en hausse** : les 25 écrans jour/mobile et les 11 écrans de nuit sont tous à zéro.
Les **411 segments de texte** des 36 écrans respectent désormais **AA**.

**Le jalon.** Cumul : **139 → 99 (S1) → 67 (S2) → 0 (S3)**. Le « one big win » du §7 est soldé :
le gain estimé « ≈ 100 des 133 non-conformités » s'est vérifié, et au-delà — il n'en reste aucune, à
mise en page constante et sans abandonner une seule teinte de marque (elles sont désormais réservées
aux **fonds, bordures et dégradés**, où elles sont conformes).

**Vérifications.** `node _check_html.js` OK (mono-fichier bien formé, syntaxe du script en ligne) ·
`node test_ui_scenarios.js` **110/110** · contrôle visuel avant/après (Classement : le filtre actif
passe au vert profond, les badges restent nets ; Accueil : KPI et libellés plus francs) ·
`test_scenarios.js` non rejoué, le serveur n'a pas été touché.

**Preuves.** `graphify-out/revue-ui/S3-avant/` (baseline = état après S2) et `S3-apres/` — les 53
captures, `mesures.txt`, `mesures.json`, le journal de campagne de chaque passe, `comparaison.txt`,
`perimetre.txt` (les 14 éléments visés, relevés **avant** correction) et `releve-encres.txt` (où les
jetons de marque servaient d'encre). Outils : `_s2_scope.js` est devenu générique —
`node apps/api/_s2_scope.js S3-avant` — et `_s3_grep.js` a produit le relevé des encres.

**Ce qui reste.** Les lots **S4** (tailles : horodatages 10 → 11 px, pastilles de pagination),
**S5** (contenus), **S6** (comportements), **S7** (gabarits). Aucun ne porte d'écart de contraste :
la question posée au §3 est close. Une décision **esthétique** reste ouverte, notée au §11 :
remonter `--text` du thème nuit si l'on veut retrouver l'écart de hiérarchie du thème clair.

## 14. Suivi — lot S4 appliqué, mesuré, prouvé (23/09/2026) — tailles et cibles tactiles

**Ce qui a changé dans l'application** — trois règles : deux de taille, une de zone cliquable.
Aucune de structure, et **le dessin de la maquette ne bouge pas** :

| Élément | Avant | Après |
|---|---|---|
| **Pastilles de pagination** de l'écran Jeux (`button.pg-dot`) | **9×9 px** (30×9 pour l'étape active) — sous la cible de 24 px de la WCAG 2.2 §2.5.8 | le point visuel garde sa taille (9 px ; 30 px pour l'actif) mais il est tracé par un pseudo-élément **au centre d'une boîte cliquable de 24×24 px** ; le `gap` passe de 9 px à 0 pour que l'espacement perçu reste le même |
| Horodatage du chat (`span.at`, écran Messagerie) | 10 px | **11 px**, le plancher de lisibilité du reste de l'interface |
| Horodatage de la **fenêtre de chat flottante** (`.chat-pop .cp-msgs .msg .at`) | 9,5 px **et `opacity: .6`** | **11 px**, sans opacité |

**L'exception d'espacement ne s'appliquait pas.** La WCAG 2.2 §2.5.8 dispense de la cible de 24 px
les petites cibles assez espacées pour qu'un cercle de 24 px centré sur chacune n'en touche aucune
autre. Ici le `gap` valait **9 px** : les cercles se recouvraient. La zone cliquable a donc été
élargie — **sans changer le dessin**, ce qui préserve la maquette à l'identique.

**Un défaut que la campagne ne voyait pas (consigné exprès).** La fenêtre de chat flottante n'est
pas l'un des 36 écrans capturés : son horodatage — 9,5 px à **60 % d'opacité** — n'apparaissait
dans aucun relevé, si bien que le « zéro non-conformité » du §13 ne couvrait pas cette surface. Un
calculateur dédié (`node apps/api/_s4_pop.js`) compose les couleurs comme le navigateur (alpha
de l'élément, puis fond du message) :

| Bulle | Jour avant | Jour après | Nuit avant | Nuit après |
|---|---|---|---|---|
| `.them` — texte sur `--panel-2` | **3,18:1** | **9,01:1** | **3,30:1** | **7,16:1** |
| `.me` — blanc sur `--brand` | **3,03:1** | **5,50:1** | **2,74:1** | **4,78:1** |

C'est ce lot qui met cette surface à niveau — et l'occasion de noter qu'une sonde d'écrans ne
mesure que ce qu'elle photographie.

**Mesure** — même protocole qu'aux §11 à §13, campagne complète avant/après :

| Indicateur (36 écrans) | Avant | Après | Delta |
|---|---|---|---|
| **Cibles tactiles < 24 px** | **77** | **65** | **−12** |
| Non-conformités AA | 0 | 0 | — (aucune régression) |
| Segments de texte mesurés | 411 | 410 | −1 |
| Erreurs JavaScript · débordements · boutons anonymes | 0 · 0 · 0 | 0 · 0 · 0 | — |

| Sélecteur visé | Avant | Après |
|---|---|---|
| `button.pg-dot` | 9 | **0** |
| `button.pg-dot.active` | 3 | **0** |

Les **65** relevés restants sont tous des **liens de pseudo en ligne** (`b.link-pseudo`,
`span.who-pseudo.link-pseudo`, `span.link-pseudo`, `b.pn.link-pseudo`, 16–22 px de haut) : ils
relèvent de l'**exception « cible en ligne »** de la WCAG et n'ont pas été retenus comme défauts
(§4.8). **Aucun écran en hausse** — 25 écrans jour/mobile et 11 écrans de nuit, tous conformes.

**Deux notes honnêtes.**
1. Le segment en moins (`411 → 410`) vient de l'écran Messagerie : l'horodatage passe de 10 à 11 px,
   donc la clé de déduplication de la sonde (`sel|ratio|px`) change et deux exemplaires identiques
   n'en font plus qu'un. Vérifié **stable sur deux campagnes**.
2. Une première passe avait aussi montré un segment de moins sur l'écran Wallet : les deux captures
   sont **identiques au pixel près** — c'était la **variabilité de la sonde**, pas un effet. La
   comparaison finale repose sur la seconde passe, relue avant consignation.

**Ce que le lot n'a pas touché.** Les micro-libellés **en capitales** à 10–10,5 px qui ponctuent
l'interface (`.logo-tag`, `.k` des tuiles de statistiques, en-têtes de table, `.pg-chip` de la scène
Jeux, `.help-state`) forment une **famille typographique homogène** (capitales espacées de 0,8 à
1,4 px, mesurée **conforme** sur les 36 écrans) : ce n'est pas le constat du §4.10, qui visait des
horodatages en minuscules dans une phrase. À trancher si l'on veut un plancher unique.

**Vérifications.** `node _check_html.js` OK (mono-fichier bien formé) · `node test_ui_scenarios.js`
**110/110** · contrôle visuel avant/après (les points de pagination sont **identiques à l'œil** —
seul le confort de clic change ; l'horodatage gagne un pixel) · `test_scenarios.js` non rejoué, le
serveur n'a pas été touché.

**Preuves.** `graphify-out/revue-ui/S4-avant/` (baseline = état après S3) et `S4-apres/` — les
53 captures, `mesures.txt`, `mesures.json`, `captures.md`, `perimetre-cibles.txt` (les cibles
fautives relevées **avant** correction, par sélecteur et par taille), `comparaison.txt`, les deux
journaux de campagne et `contraste-pop.txt` (le contraste composé de la fenêtre flottante).
Outils : `_s4_cibles.js` (relevé des cibles) et `_s4_pop.js` (calculateur alpha).

**Ce qui reste.** Les lots **S5** (contenus), **S6** (comportements), **S7** (gabarits). Avec S4,
les points **§4.8** (pastilles de pagination) et **§4.10** (horodatages) sont soldés. Rien de tout
cela ne porte d'écart de contraste : le §3 reste clos.

## 15. Suivi — lot S5 appliqué, mesuré, prouvé (23/09/2026) — contenus

**Ce que ce lot change : des mots, pas des pixels.** Cinq familles, aucune règle de mise en page
touchée sauf une (le centrage de l'état vide de l'Accueil, qui ne déplace rien d'autre).

| Élément | Avant | Après |
|---|---|---|
| **Références internes « PRD §x.y »** — **15 emplacements visibles** | « données joueurs collectées (PRD §9) », « (PRD §12) » ×2, « (PRD §4.4) » ×2, « (PRD §4.1) », « (PRD §8.1) », « (PRD §2.4) », « (PRD §2.5) », « (PRD §2.7) », « (PRD §4) », « (PRD §4.3) », « (PRD §11) », « (PRD §14.2) » ×2 | **parenthèse retirée** (le lecteur n'est pas un développeur) ou **titre réduit au bénéfice joueur** : « Répartition du cashprice », « Règles du wallet », « Boutique — Skins » ; l'entraînement IA perd sa mention dans une note et **gagne l'information dans sa propre description** : « Accessible sans KYC. Difficulté plafonnée — aucun impact Elo ni wallet. » |
| **État vide de l'Accueil** (« Dernières parties ») | `<p class="muted">Aucune partie pour le moment.</p>` — un paragraphe gris dans un panneau d'≈ 440 px | l'état vide **exemplaire de Match** (icône œil, titre, phrase d'explication, bouton **« Trouver un adversaire »**) et **centrage vertical** dans la zone de défilement |
| **« Tournoi introuvable. »** (lien profond périmé) | un paragraphe isolé, **sans issue** | même gabarit d'état vide (icône d'alerte, titre, phrase « …Les tournois ouverts sont dans l'onglet Tournois. », bouton **« Revenir aux tournois »**) |
| **Compteur de contacts** (écran Match) | « 0 en ligne · **5** contact(s) » alors que **4 lignes** sont affichées | « 0 en ligne · **4 sur 5 contact(s)** » tant que la liste est repliée — le compteur dit ce qui est **affiché** ; il redevient « 5 contact(s) » une fois la liste dépliée |
| **Pastille wallet** (barre haute) | « **Ar** 150 000 **Ar** » — l'unité deux fois (icône + suffixe de `fmtAr`) | l'unité n'est portée que par **l'icône** ; le montant n'est plus qu'un nombre (`fmtNum`), donc plus de doublon à aucune taille d'écran |

**Ce qui reste dans le fichier, et pourquoi.** Après le lot, `index.html` contient encore **5 mentions**
de « PRD », relevées par `node _s5_prd.js` :

| Où | Nature | Décision |
|---|---|---|
| l. 7 — `<meta name="description">` | **invisible** (description pour les moteurs de recherche) | conservée : le lecteur ne la voit pas |
| l. 14 — commentaire CSS « D-aôna — Design System (PRD v1.1 §6.3) » | commentaire | conservée (maintenance) |
| l. 3639 — commentaire JS « Données de démonstration (PRD v1.1) » | commentaire | conservée (maintenance) |
| l. 6606 — commentaire JS « Barème du cashprice (PRD §4.3) » | commentaire | conservée (maintenance) |
| l. 3138 — note de pied de la scène « Bon retour » | **visible**, hors des 36 écrans d'application | conservée **volontairement** : elle annonce la version de la maquette, elle ne renvoie à aucune section interne |

Autrement dit : **3 commentaires + 1 mention invisible + 1 note assumée** — et **zéro** référence
interne dans le texte vu par un joueur, ce que la vérification ci-dessous établit écran par écran.


**Une vérification que la campagne ne pouvait pas faire : le clic.** La sonde de revue mesure,
photographie et détecte les erreurs JavaScript — elle **ne clique pas** sur les nouveautés. Un état
vide « réparé » dont le bouton ne mène nulle part resterait vert. Un outil jetable
(`node apps/api/_s5_verif.js`, port 8094, base copiée puis supprimée) rejoue donc les gestes
réels, sur les deux comptes de revue :

| Contrôle | Résultat |
|---|---|
| **V1** état vide de l'Accueil monté, titré, centré (`justify-content: center`) | OK — « Aucune partie pour le moment » + bouton « Trouver un adversaire » |
| **V1** le bouton mène au Match | OK — `#/match` |
| **V2** « Tournoi introuvable » présent, avec son bouton | OK — 1440 px **et** 390 px |
| **V2** « Revenir aux tournois » ouvre l'onglet Tournois | OK — `#/match`, vue affichée, `aria-selected="true"`, panneau rendu (4 368 o) |
| **V3** pastille wallet : un seul « Ar » | OK — icône « Ar » + montant « 150 000 » (compte rempli) / « 5 000 » (compte vierge) |
| **V4** aucun « PRD § » dans le **texte visible** — 14 écrans × 2 comptes | OK — 19 relevés, 0 occurrence |
| **V5** compteur de contacts tronqués | OK — « 0 en ligne · 4 sur 5 contact(s) » avec 4 lignes visibles |
| **V6** erreurs JavaScript | **0** |
| **Bilan** | **24/24 vérifications réussies** |

**Mesure** — même protocole qu'aux §11 à §14, campagne complète avant/après :

| Indicateur (36 écrans) | Avant | Après | Delta |
|---|---|---|---|
| Non-conformités AA | 0 | 0 | — (les textes neufs sont conformes) |
| Segments de texte mesurés | 410 | **416** | **+6** |
| Cibles tactiles < 24 px | 65 | 65 | — |
| Erreurs JavaScript · débordements · boutons anonymes | 0 · 0 · 0 | 0 · 0 · 0 | — |

Le **+6** est le lot lui-même, et il est **traçable capture par capture** (`node _s5_seg.js`) :
**+1 segment** sur les **2 captures de l'Accueil** (jour, nuit) et sur les **4 captures du Tournoi**
(jour, nuit, 390, 360). La sonde ne compte que les couples **distincts** (sélecteur, teinte, taille) :
l'état vide passe d'un paragraphe gris à un trio titre / phrase / bouton, dont elle retient le
segment nouveau. C'est le seul lot de la série dont le compteur **monte** — et il monte parce que
l'interface dit maintenant quelque chose au joueur. L'écran **mobile-390/home** ne bouge pas : sa
capture (première hauteur d'écran) ne montre pas l'état vide, d'où la **capture de contrôle
`verif-mobile-etat-vide.png`** ajoutée hors campagne.

**Notes honnêtes.**
1. Les textes neufs restent en `--muted` : la teinte du jour et celle de la nuit ayant été corrigées
   aux §11 et §13, ils **n'ajoutent aucun écart** — c'est précisément ce que le « 0 » ci-dessus
   établit.
2. Trois champs sans nom accessible (§4.9), le HUD de l'entraînement IA (§4.2), la récapitulation du
   dépôt (§4.3) et le chevron trompeur (§5) **ne sont pas dans ce lot** : ce sont des comportements
   et du balisage, traités par **S6**.
3. La note de pied de la scène « Bon retour » (« Maquette de démonstration — D-aôna PRD v1.2… ») est
   **conservée volontairement** : elle annonce la version de la maquette à un lecteur externe, elle
   ne renvoie à aucune section interne. À retirer le jour où la page sort du prototype.

**Vérifications.** `node _check_html.js` OK (mono-fichier bien formé) · `node test_ui_scenarios.js`
**110/110** · `node _s5_verif.js` **24/24** avec **0 erreur JavaScript** · contrôle visuel
avant/après (`desktop-jour__home`, `mobile-390__home`, `desktop-jour__tournament`,
`mobile-390__tournament`) · `test_scenarios.js` non rejoué, le serveur n'a pas été touché.

**Preuves.** `graphify-out/revue-ui/S5-avant/` (baseline = état après S4, **57 fichiers**) et
`S5-apres/` (**63 fichiers**) — les 53 captures, `mesures.txt`, `mesures.json`, `captures.md`,
`comparaison.txt`, les journaux de campagne, plus cinq pièces propres à ce lot :
`inventaire-prd.txt` (les 16 sites « PRD » relevés **avant** correction), `libelles-apres.txt`
(les libellés **après** correction, cités un par un), `mentions-prd-restantes.txt` (les 5 qui
subsistent, avec leur nature), `segments-par-ecran.txt` (l'origine du +6) et
`verification-fonctionnelle.txt` (les 24 contrôles).
Outils : `_s5_inv.js` (inventaire), `_s5_prd.js` (ce qui reste), `_s5_libelles.js` (libellés),
`_s5_seg.js` (d'où vient le delta de segments), `_s5_verif.js` (vérification fonctionnelle par clic
réel).

**Ce qui reste.** Les lots **S6** (comportements : HUD de l'entraînement IA, récapitulation du
dépôt, chevron trompeur, noms accessibles des 3 champs) et **S7** (gabarits : marge basse du
Classement, barre haute mobile sur deux lignes, pastilles étirées, séparation des surfaces en
nuit). Avec S5, les points **§4.1**, **§4.6**, **§4.7** et deux points du **§5** (pastille wallet,
compteur de contacts) sont soldés. Rien de tout cela ne porte d'écart de contraste : le §3 reste clos.

## 16. Suivi — lot S6 appliqué, mesuré, prouvé (23/09/2026) — comportements et noms accessibles

**Ce que ce lot change : des comportements et du balisage.** Aucune teinte, aucune taille, aucun
gabarit. La mesure le confirme : **416 segments de texte avant comme après**, 0 non-conformité de
part et d'autre.

| Élément | Avant | Après |
|---|---|---|
| **HUD « moi » du plateau** (§4.2) — entraînement contre l'IA | la carte du bas gardait les valeurs de la maquette : avatar **« TR »**, **« 1126 Elo »** | `fillHudMe(pseudo, elo)` est le **seul** point de remplissage, appelé par **les trois flux** (partie serveur, **entraînement IA**, spectateur) ; le balisage ne porte plus de valeurs de maquette (`—`) |
| **Récapitulation du dépôt** (§4.3) | « Montant 5 000 · Frais ~2 % **100** · Crédité **5 000** » — impossible de savoir si les frais sont prélevés, ajoutés ou offerts | la règle du serveur devient **lisible** : « Montant du dépôt **5 000** » + « Frais opérateur estimés (~2%) **100** » = « **Total à payer chez l'opérateur 5 100** », puis « Crédité sur votre wallet **5 000** », et une phrase qui explique (les frais vont à l'opérateur, D-aôna ne prélève aucune commission sur un dépôt) |
| **Récapitulatif figé sur la valeur d'ouverture** | l'écran annonçait « 5 000 Ar » alors que le dépôt réellement envoyé au serveur était celui de **la pastille choisie** | `refreshChips()` recalcule **les quatre lignes** à chaque changement de pastille **ou** d'opérateur |
| **Chevron « › » des lignes d'opérateur** (§5) | le chevron suggérait une **navigation** alors que la ligne **sélectionne** | une **coche** remplace le chevron, affichée sur la ligne active seulement — la présélection (MVola) se voit au lieu de se deviner |
| **Champs sans nom accessible** (§4.9) | le rapport en annonçait **3** ; le relevé du lot en a trouvé **8** | les **8** sont nommés (`label for` ou `aria-label`) |
| **Pastilles de montant** du dépôt | `div` cliquables | de vrais **boutons**, dans un groupe `role="group"` étiqueté par « Montant (Ariary) » |
| **État de sélection, pour les technologies d'assistance** | visible à l'œil seulement (bordure, coche) | `aria-pressed` sur les pastilles **et** les lignes d'opérateur, tenu à jour par `refreshChips()` |

**Le §4.9 était sous-estimé, et c'est ce lot qui l'a montré.** Le relevé conduit **avant** toute
modification (`node _s6_scope.js`) a passé **tous** les champs du fichier au crible, pas seulement
ceux que la revue avait remarqués : **20 champs** dans le balisage, **8 sans nom accessible**. Les
trois du rapport (`#wd-phone`, `#wd-amount`, `#avatar-input`) **plus** :

| Champ | Ce qu'un lecteur d'écran annonçait | Correctif |
|---|---|---|
| `#province-select` (Classement) | « liste déroulante » sans nom | `aria-label="Filtrer par province"` (+ `title`) |
| `#chat-field` (Messagerie) | « zone de texte » sans nom | `aria-label="Écrire à ⟨pseudo⟩"` — le nom dit **à qui** |
| champ de la **fenêtre de chat flottante** | idem | `aria-label="Écrire à ⟨pseudo⟩"` |
| `#sp-motif`, `#sp-msg` (modales de support) | « liste » / « zone de texte » sans nom | `<label for>` — les libellés visibles étaient déjà là, ils sont maintenant **reliés** |

**Un contrôle qui va plus loin que le relevé : l'audit des champs *montés*.** Un `for` peut nommer
un champ qui n'existe pas, et un champ peut être injecté par le rendu. La vérification ouvre donc
**les écrans et les trois modales** puis interroge le DOM réel : **116 champs montés, 116 nommés**
(et 50 sur le second passage), **0 sans nom**. C'est ce contrôle-là qui établit le point, pas le
relevé statique.

**Le comportement, pas seulement le balisage.** Le récapitulatif du dépôt est un **calcul** : il
fallait prouver qu'il dit vrai *et* qu'il suit les choix du joueur. La vérification clique donc :
deux pastilles différentes, deux opérateurs différents, et à la fin **un dépôt réel** — solde
150 000 → 155 000, soit **+5 000 Ar exactement**, la ligne « Crédité » ne ment pas.

| Contrôle (outil `_s6_verif.js`) | Résultat |
|---|---|
| **V1** champs sans nom, écran d'accueil | 0 |
| **V1 bis** **tous** les champs montés (écrans + 3 modales) | **116 nommés / 116** |
| **V2** HUD de l'entraînement IA | « ZzRevueUI » · « **1100 Elo** » · avatar « ZZ » — les valeurs du compte, plus la maquette |
| **V3** récapitulatif : montant + frais = total | 5 000 + 100 = **5 100** ; crédité **5 000** |
| **V3 bis** le récapitulatif **suit** la pastille | 50 000 + 1 000 = **51 000** ; crédité **50 000** |
| **V4** pastilles de montant | 6 boutons, `aria-pressed` cohérent (actif : 5 000) |
| **V5** lignes d'opérateur | 3 boutons, **une seule coche** (« mvola »), `aria-pressed="true"` |
| **V6** **dépôt réel par l'interface** | solde 150 000 → **155 000** : **+5 000 exactement** |
| **V7** modale de dépôt à 390 px | 5 000 + 100 = 5 100 · une seule coche |
| **Erreurs JavaScript** | **0** |
| **Bilan** | **11/11** |

**Mesure** — même protocole qu'aux §11 à §15, campagne complète avant/après :

| Indicateur (36 écrans) | Avant | Après | Delta |
|---|---|---|---|
| Non-conformités AA | 0 | 0 | — |
| Segments de texte mesurés | 416 | 416 | — |
| Cibles tactiles < 24 px | 65 | 65 | — |
| Erreurs JavaScript · débordements · boutons anonymes | 0 · 0 · 0 | 0 · 0 · 0 | — |

**Notes honnêtes.**
1. **La sonde mesure 36 écrans ; les 7 « états »** (dont la **modale de dépôt**, l'objet même du
   §4.3) **sont photographiés mais non mesurés** — c'est le cas depuis S1. Le « 0 » ci-dessus ne
   couvre donc pas la modale : ce sont les contrôles V3 à V7 qui portent le lot, et ils l'ont fait
   par **clic réel**, pas par mesure automatique.
2. **Un constat nouveau, hors périmètre, traité par le lot suivant** : le relevé a aussi listé **12
   éléments cliquables non focusables** — `span.avatar` (5) et `span.link-pseudo` (3) porteurs d'`onclick`,
   `div.panel` (2), `span.who-pseudo` (1), un `span` sans nom (1) — inaccessibles au **clavier**. Ce
   point **n'était pas dans la revue** ; il est consigné (`S6-avant/perimetre.txt`, section 5) et **soldé
   par le lot S7** (§17) : la sonde de géométrie en comptait **236 relevés** sur les 36 écrans, il en reste
   **0** après `rendreCliquablesFocusables()`.
3. L'avatar de la **barre haute** porte encore `>TR<` dans le balisage, mais il est **remplacé au
   premier rendu** par `updateTopbar()` → `avatarInnerHtml(S)` : il n'est jamais visible (les
   captures montrent « ZZ »). Contrairement au HUD, ce n'était donc pas un défaut — conservé tel quel.

**Vérifications.** `node _check_html.js` OK (mono-fichier bien formé) · `node test_ui_scenarios.js`
**110/110** (la conversion des pastilles de montant en boutons ne casse aucun parcours) ·
`node _s6_verif.js` **11/11** avec **0 erreur JavaScript** · contrôle visuel avant/après
(`desktop-jour__plateau-ia`, `etat__wallet-depot`) · `test_scenarios.js` non rejoué, le serveur n'a
pas été touché.

**Preuves.** `graphify-out/revue-ui/S6-avant/` (baseline = état après S5, **57 fichiers**) et
`S6-apres/` (**60 fichiers**) — les 53 captures, `mesures.txt`, `mesures.json`, `captures.md`,
`comparaison.txt`, le journal de campagne, plus `perimetre.txt` (les 20 champs, les 8 sans nom, les
valeurs de maquette, le récapitulatif, les 12 cliquables non focusables — relevé **avant**
correction) et `verification-fonctionnelle.txt` (les 11 contrôles).
Outils : `_s6_scope.js` (périmètre), `_s6_probe.js` (faisceau de contrôle), `_s6_verif.js`
(vérification fonctionnelle par clic réel).

**Ce qui reste.** Le lot **S7** (gabarits : marge basse du Classement et du bouton flottant, barre
haute mobile sur deux lignes, pastilles étirées, séparation des surfaces en nuit) et le constat
nouveau ci-dessus (12 cliquables non focusables) — **tous deux traités par le §17**, qui clôt la file.
Avec S6, les points **§4.2**, **§4.3**, **§4.9** et le point « chevron » du **§5** sont soldés. Rien de
tout cela ne porte d'écart de contraste : le §3 reste clos.


---

## 17. Suivi — lot S7 appliqué, mesuré, prouvé (23/09/2026) — gabarits et clavier

Dernier lot de la file S1→S7. Il ne restait que des **gabarits** : ceux du §4.4 et du §4.5, cinq points du
§5 — et, rattaché ici, le constat neuf trouvé par le lot S6 (les cliquables inatteignables au clavier).

### Ce qui a changé dans l'application

| Élément | Avant | Après |
|---|---|---|
| **Séparation des surfaces, thème nuit** (§5) | `--panel` `#0A0A0C` à **1,06:1** du noir, `--panel-2/--panel-3` à **1,04 – 1,06** : la hiérarchie reposait sur les seules bordures | échelle relevée d'un cran — `#0E0E12` / `#18181F` / `#1F1F28`, soit **1,09 / 1,19 / 1,28:1** ; les tuiles du héro de nuit reçoivent le voile clair du thème jour (`1,04 → 1,10:1`). Le noir OLED reste pur en fond et `--muted` garde **4,57:1** sur la surface la plus claire |
| **Accueil : six tuiles pour quatre valeurs** (§4.5) | « 0 VICTOIRES » **et** « 0% VICTOIRES » (même donnée, deux unités), « 0% WIN RATE » sans partie jouée | **trois tuiles pour trois valeurs** (Parties jouées · Victoires · Solde wallet) ; le taux de victoire reste sur le Profil, où il est détaillé ; le montant en Ariary se réduit avec la largeur (`clamp`) au lieu de déborder |
| **Pastilles étirées** (§5) | « Saison 2 — 2026 · classé ouvert » (héro) et « ID joueur unique · journal d'audit complet » (Profil) s'étiraient sur toute la largeur | `.home-hero > .pill { align-self: flex-start; }` et même traitement sur le Profil — la pastille se dimensionne sur son texte |
| **Barre haute mobile** (§5) | **107 px sur deux lignes** à 390 px et 360 px, regroupement accidentel | **50 px sur une ligne** : le nom de l'application cède la place au logo (il est déjà dans les titres d'écran), la pastille KYC se réduit à sa coche — intitulé complet conservé dans l'infobulle, le nom accessible et l'écran Profil — et les contrôles se resserrent ; la pastille wallet peut se tronquer |
| **Avatars du podium** (§5) | la table voisine affichait des avatars, le podium aucun | `.pod .pod-av` : même avatar 34 px que la table, sous la médaille (le pseudo reste le seul lien) |
| **Encre des horodatages de mes messages** | `--muted` sur la bulle de marque : **4,39:1** en nuit — un écart **apparu** avec le relèvement des surfaces | `.msg.me .at { color: var(--text) }` : **7,5:1** en jour, **5,8:1** en nuit |
| **Badge de rang bronze** | teinte décorative `#b0703c` → encre de nuit à **4,46:1** (même cause) | `#bc7a44` dans **les deux inventaires** (client `index.html` et serveur `data.js`) : l'encre repasse au-dessus du seuil |
| **Cliquables inatteignables au clavier** (constat du §16) | **236 relevés** sur les 36 écrans : `span.avatar`, `span.link-pseudo`, `div.panel`, `span.who-pseudo` porteurs d'`onclick` — souris obligatoire | `rendreCliquablesFocusables()` donne à chaque cible non native `role="button"`, `tabindex="0"` et un nom accessible (repris de l'infobulle ou du texte) ; `activerAuClavier()` active Entrée/Espace **sur le même `onclick`** ; un `MutationObserver` (une fois par image) couvre les rendus successifs et un anneau de focus rend la position visible |

**Rien de tout cela ne touche une teinte de texte ni une taille de police** : le §3 reste clos, et les deux
seuls écarts de contraste croisés pendant le lot venaient du relèvement des surfaces de nuit — ils ont été
corrigés dans le lot lui-même (bronze, horodatage de bulle).


### La preuve — ce que la sonde géométrique mesurait, et ce qu'elle mesurait mal

Le lot a exigé un **troisième outil** (après la sonde de contraste et la sonde d'interface) : `_s7_probe.js`
mesure la **géométrie** dans le navigateur — recouvrements par la barre d'onglets et le bouton de
messagerie, fin de course de chaque zone de défilement, hauteur et nombre de lignes de la barre haute,
largeur réelle des pastilles opposée à leur texte, et cliquables non focusables.

| Indicateur (36 écrans, 4 gabarits) | Avant | Après |
|---|---|---|
| **Cliquables non focusables** | **236 relevés** (2 à 31 par écran) | **0** |
| **Pastilles étirées** | 2 (héro Accueil, en-tête Profil) | **0** |
| **Barre haute mobile** | **107 px / 2 lignes** (390 px et 360 px) | **50 px / 1 ligne** |
| Recouvrements de contenu · fins de course coupées · cliquables sans nom | 0 · 0 · 0 | 0 · 0 · 0 |
| Erreurs JS | 0 | 0 |

Et le **« §4.4 » ne s'est pas reproduit** : la sonde scrolle chaque zone jusqu'en bas avant de mesurer — à
cette position, **aucun** contenu n'était recouvert par la barre d'onglets, ni avant ni après (la réserve de
96 px de `#screens` fait son office). La capture d'origine montrait simplement une 8e ligne sous la ligne de
flottaison, ce qui est le comportement normal d'une liste qui défile. Le contrôle dédié `_s7_fin.js` a en
revanche trouvé ce que la sonde ne voyait pas : **deux zones finissaient sans air** — 0 px sur l'écran Amis,
−1 px sur la colonne Boutique du Profil. Une réserve de **16 px** en bas de chaque colonne défilante
(`body.is-fill`) les corrige :

| Air sous le dernier contenu, liste défilée jusqu'en bas (40 zones) | Avant | Après |
|---|---|---|
| Zones à moins de 12 px d'air | 2 (0 px et −1 px) | **0** (minimum relevé : 16 px) |

### Mesure (même outil, même campagne, 36 écrans)

| Indicateur | Avant | Après |
|---|---|---|
| Non-conformités AA | 0 | **0** (417 segments) |
| Segments de texte mesurés | 416 | **417** (+1, tracé plus bas) |
| Cibles < 24 px · débordements · boutons anonymes · erreurs JS | 65 · 0 · 0 · 0 | **65 · 0 · 0 · 0** |

Le **+1** vient de l'Accueil (mobile et 360 : −1 par écran) et du Classement (+3 mobile, +2 bureau, où le
podium gagne trois avatars) — `graphify-out/revue-ui/S7-apres/segments-par-ecran.txt` en donne le détail
écran par écran, et le tableau `defauts-identifies-mi-lot.txt` conserve la trace des deux écarts de contraste
transitoires (bronze, horodatage) attrapés puis corrigés **pendant** le lot.


### Notes honnêtes

1. **Le §4.4 n'était pas un défaut** — du moins pas celui qui était décrit. La sonde scrolle avant de
   mesurer : à la fin de la course, rien n'est recouvert par la barre d'onglets. Ce que le contrôle dédié a
   trouvé est plus fin : **deux zones finissaient au ras** de leur conteneur (0 px et −1 px). Corrigé par
   16 px de réserve — mais il faut le dire ainsi, pas comme la réparation d'un blocage.
2. **Le relèvement des surfaces de nuit a créé deux écarts de contraste**, tous deux attrapés par la campagne
   du lot : l'encre du badge bronze (4,46:1) et l'horodatage des bulles de mes messages (4,39:1). C'est la
   démonstration que **modifier un fond met en danger des encres qu'on ne visait pas** — et que la mesure
   après coup n'est pas une formalité.
3. **Le clavier n'était pas qu'un problème de `tabindex`.** `rendreCliquablesFocusables()` s'appuie sur une
   **délégation** : la cible reçoit un rôle et un ordre de tabulation, mais l'action reste **le même
   `onclick`** — aucun gestionnaire n'a été dupliqué ni réécrit. Le balayage est borné (une fois par image,
   et il saute ce qui porte déjà le repère), pour ne pas transformer un rendu fréquent en coût.
4. **Le titre de la barre haute en mobile est masqué, pas l'information** : « D-aôna » reste dans le logo
   (le monogramme), dans le titre de chaque écran et dans l'onglet du navigateur ; la coche « ✓ » du badge
   KYC garde son intitulé complet en infobulle, en nom accessible, et sur l'écran Profil.

### Vérifications

- `node _check_html.js` → **OK** (mono-fichier bien formé, script en ligne compilé) ;
- `node test_ui_scenarios.js` → **110/110** (le premier passage a échoué sur le seul scénario SX, à cause de
  ressources **externes** injoignables — `ERR_INTERNET_DISCONNECTED` sur les polices Google ; le scénario
  SX rejoué seul passe **3/3**, réseau revenu : c'était un hoquet, pas une régression) ;
- `node test_scenarios.js` → **226/226** (le lot touche `data.js`, l'inventaire des badges côté serveur) ;
- sonde de géométrie **0** partout ; contrôle de fin de course **0** zone sans air ; **0 erreur JS** ;
- contrôle visuel : `desktop-jour__ranks` (podium avec avatars), `mobile-360__home` (trois tuiles, barre
  haute sur une ligne), `desktop-nuit__home` (surfaces détachées), `fin-mobile-390__ranks` (fin de course).

### Preuves

`graphify-out/revue-ui/S7-avant/` (baseline = état après S6, **57 fichiers**) et `S7-apres/`
(**79 fichiers**) : les 53 captures, `mesures.txt`, `mesures.json`, `captures.md`, `comparaison.txt`,
`segments-par-ecran.txt`, `campagne.txt`, `etat-final.txt`, `releve-geometrie.txt` (les deux passes de la
sonde, avant/après), `fin-de-course.txt` + 16 captures « défilé jusqu'en bas » (`fin-*.png`), et
`defauts-identifies-mi-lot.txt` (les 2 écarts transitoires).
Outils jetables : `_s7_probe.js` (géométrie), `_s7_fin.js` (fin de course), `_s5_seg.js` (segments par
écran), `_s2_scope.js` (état des non-conformités par encre), `_s1_compare.js` (bilan avant/après).

### Ce qui reste

**La file S1→S8 est terminée, et les deux arbitrages laissés ouverts sont tranchés (lot S8, §18)** :

- **le tirage au sort** — tranché en faveur de la **bande non modale** : le plateau reste visible **et
  jouable** pendant l'annonce (le test clique pendant l'annonce : une pièce se sélectionne). La
  vérification a révélé au passage un défaut de plus : en entraînement, l'annonce disait « Vous jouez en
  premier » **même quand la pièce désignait l'IA**, qui jouait alors son coup sans que rien ne l'ait dit
  — corrigé à la source (`toss.starter`) ;
- **les en-têtes du Classement** — **rien à corriger** : le « doublon » apparent est un **badge
  d'appartenance** (avec son nom) et une **médaille de podium** (🥇🥈🥉), deux informations distinctes ;
  et les quatre colonnes sont étiquetées, y compris pour les lecteurs d'écran (`aria-label`). Le constat
  initial était une erreur de lecture de la capture.

Les cibles tactiles sous 24 px (**65**) sont, pour l'essentiel, des **liens de texte en ligne** — exception
explicite de la WCAG 2.2 §2.5.8, non retenus comme défauts.

---

## 18. Suivi — arbitrages tranchés et lot S8 appliqué (24/09/2026) : le tirage au sort

### Les deux arbitrages laissés ouverts par la revue

Ils ne relevaient pas de la conformité mais d'un **choix d'interaction**. Tranchés ici.

- **Le tirage au sort — retenu, appliqué (lot S8).** La modale de résultat s'affichait en plein écran
  (voile flouté) **par-dessus le plateau**, au moment précis où le joueur doit regarder sa position.
  Preuve la plus objective de la gêne : l'outil de revue devait **explicitement la refermer** pour
  pouvoir photographier l'échiquier. Il touchait **chaque partie**, au démarrage — c'est le plus
  fréquent des deux points, et celui qui a un coût pour le joueur.
- **Les en-têtes du Classement — constat rectifié, rien à corriger.** Vérification faite au code :
  `badgeChip()` (badge d'appartenance, avec son nom : Remenabila, Malaso, Totakely…) et `medalFor()`
  (🥇🥈🥉 des rangs 1 à 3) affichent **deux informations différentes** — ce n'est pas un doublon ; et
  les quatre colonnes ont un libellé, y compris pour les lecteurs d'écran (« # » avec
  `aria-label="Position"`, « Joueur », « Elo », médaille avec `aria-label` et `title`). Le constat du
  §5 était une **erreur de lecture de la capture** : il est rectifié au §5 et ne demande aucune
  modification.

### Le changement dans l'application

| Élément | Avant | Après |
|---|---|---|
| **Annonce du résultat** | modale plein écran + voile flouté, **fermeture automatique à 2,5 s** (le plateau restait masqué pendant ce temps) | **bande non modale** au-dessus du plateau (`.toss-banner`) : pièce de 44 px + phrase complète, effacement **automatique à 7 s** ou sur clic — **aucun voile** |
| **Accessibilité de l'annonce** | titre dans une modale | `role="status"` + `aria-live="polite"` (lue sans voler le focus) et un bouton nommé « Masquer le résultat du tirage » |
| **Choix PILE / FACE** | modale | **inchangé** : c'est une décision du joueur, elle reste modale à juste titre |

### Un défaut découvert en vérifiant le tirage — et corrigé

Le test fonctionnel mesure autre chose que ce qu'on lui demande, et c'est heureux : le suivi temporel a
montré **42 pions au lieu de 44** à l'arrivée de mon tour, alors que l'annonce disait « **Vous** (Noir)
joue en premier ». Cause, trouvée au code : le moteur local posait `starter: 1` **en dur** dans le tirage
(`index.html`), là où le moteur du serveur calcule le vrai camp qui commence (`game.js` :
`this.starter = this.choices[1] === this.tossSide ? 1 : 2`). L'annonce lisant ce champ, elle disait
« Vous » **quelle que soit la face sortie** — pendant que l'IA jouait son coup. Corrigé à la source :
`toss.starter` porte désormais le camp qui commence réellement, comme côté serveur.

### La preuve — 12/12 contrôles, 0 erreur JavaScript

`_s8_verif.js` rejoue une partie d'entraînement et **clique pour de vrai** (base jetable, port 8093) :

| Contrôle | Résultat mesuré |
|---|---|
| V1 · aucune modale au tirage | `#modal-overlay` reste **fermé** (avant : voile plein écran sur le plateau) |
| V2 · l'annonce est complète | « Tirage au sort : FACE — IA — Antso (Blanc) joue en premier. » · 700×58 px (362 px à 390) · `role=status` · `aria-live=polite` |
| V3 · **le plateau est jouable pendant l'annonce** | 42 pions posés, la zone de jeu reçoit le clic (« cell » sous la pièce) → **1 pièce sélectionnée**, sans modale. C'est le cœur de l'arbitrage : avant, il fallait fermer la modale |
| V3 bis · la bande s'insère **au-dessus** | bande finit à 218 px, plateau de 356 à 762 px dans une fenêtre de 900 : rien n'est poussé hors de l'écran |
| V4 · bouton ✕ | bande masquée sur clic |
| V5 · **effacement automatique** | bande effacée seule après 7 s (vérifié aussi à 390 px) |
| V6 · **cohérence annonce ↔ plateau** (`Math.random` figé, déterministe) | pièce sur **ma** face → « **Vous** (Noir) joue en premier » · **44 pions intacts** · tour immédiat — pièce sur la **face de l'IA** → « **IA — Antso** (Blanc) joue en premier » · **42 pions** (elle a bien joué) · mon tour après 1,6 s |

Le tour ne s'active sur le plateau qu'après **1 à 1,5 s** (le temps que l'état de départ arrive). La bande,
elle, est déjà là : c'est exactement l'intérêt d'une annonce non bloquante — le joueur lit pendant que le
plateau se met en place, au lieu d'attendre derrière un voile.

### Mesure, fichiers, effets de bord

- La campagne de revue gagne **une capture par contexte** : `__plateau-tirage` (**bande visible + plateau
  entier**, la preuve visuelle de l'arbitrage) — **54 captures** au lieu de 53 ; le bloc qui devait
  « fermer la modale du tirage pour photographier le plateau » a été remplacé par « fermer la bande ».
- Indicateurs objectifs : 417 segments, **0 non-conformité AA**, 0 débordement, 0 bouton anonyme,
  **0 erreur JavaScript** — aucun écran en hausse.
- `test_ui_scenarios.js` : le scénario du tirage passe (« la modale PILE / FACE est proposée et le choix
  est accepté » — le **choix** reste modal) ; le reste de la campagne est inchangé.
- **Limite assumée** : la bande n'a pas été mesurée par la sonde de contraste sur les 36 écrans (elle
  n'est visible que quelques secondes au démarrage d'une partie). Ses couleurs sont celles du bandeau
  « À qui le tour ? » (`--panel-2` / `--text-strong`, mesurés conformes), le ✕ prend `--muted`
  (5,28:1 jour, ≈ 5,1:1 nuit) — les deux paires sont déjà couvertes par la sonde dans ces états.

### Addendum — arbitrage INVERSÉ le 03/10/2026 : le lancer redevient un voile plein écran, joué AVANT la partie

À la demande « l'animation de pile ou face se fait D'ABORD, et montre quel joueur a pile et quelle
personne a face », la bande non modale ci-dessus est **retirée** (option A : aucun bandeau
récapitulatif). Le résultat du tirage est désormais un **voile plein écran `#coin-toss`** : la pièce
vole **2 s en 3D** (les deux faces se succèdent réellement), retombe sur la face tirée, puis le verdict
nomme les **deux camps** (qui a PILE, qui a FACE, qui « commence »). Fermeture : « Commencer », Échap,
clic sur le voile, repli automatique **12 s** ; à la reprise d'une partie (`animate:false`), rien ne se
rejoue. Le choix PILE / FACE reste modal, comme avant.

- **Défaut trouvé par la vérification — corrigé à la source** : une rotation 3D **animée** aplatit le
  sous-arbre dans Chromium (`filter` / `backdrop-filter` sur un ancêtre font de même) : la pièce
  retombait sur le « 50 » **en miroir** sous un verdict FACE. L'arrivée ne dépend plus de la 3D :
  `.landed` coupe l'animation à `animationend` (+ repli 2 150 ms) et `display` montre le plan de la
  face tirée.
- **Preuves** : `_coin_verif.js` 12/12 (hit-test P9 : le plan rendu porte bien le fichier de la face
  tirée) ; `_s8_verif.js` réécrit pour l'arbitrage inversé — **14/14** : plateau **non** cliquable
  pendant le voile, cliquable après « Commencer », fermeture automatique 12 s, aucun rejeu après
  rechargement, cohérence déterministe du « commence ».

### Addendum — 03/10/2026 : le gagnant du tirage prend les PIONS CLAIRS (la couleur suit le camp)

À la demande « le gagnant du tirage prend la couleur claire (Blanc) et commence en premier », la
couleur cesse d'être un **point de vue** pour devenir une **règle lisible** : jusqu'ici chaque joueur
voyait toujours ses propres pions en clair (`.piece.me`), quel que fût le tirage — l'annonce « les
clairs commencent » n'était donc vérifiable nulle part à l'écran.

- **Ce qui change à l'écran** : le camp du joueur est décidé par le tirage (`campOf()`, lu par
  `renderPieces()`), le CSS peint `.piece.clair` / `.piece.sombre`, et le perdant **voit réellement ses
  pions en sombre**. Le gagnant commençait déjà — c'est la **couleur** qui manquait.
- **Le repère que la règle rend nécessaire** : une pastille `Clairs` / `Sombres` dans chacune des deux
  barres (`#hud-me-camp`, `#hud-opp-camp`, posée par `updateCamps()`), des jetons de `.turn-flag`
  (`--muted` sur `--panel-3` : 4,77:1 jour / 5,13:1 nuit — AA déjà mesuré), et le camp écrit sur chaque
  ligne du voile du tirage (« pions clairs » sur la ligne gagnante). Sans ces trois rappels, la règle
  retirerait au joueur le moyen de reconnaître ses pions : c'est le seul coût réel de l'arbitrage.
- **Vocabulaire de la boutique** : `PION_CAMPS.who` dit désormais **le camp** (« le camp clair — celui
  qui commence » / « le camp sombre »). Conséquence écrite noir sur blanc dans la page : l'apparence du
  camp clair peut habiller **l'adversaire** quand c'est lui qui gagne le tirage. Les libellés « Pions
  clairs / Pions sombres » et les groupes de couleurs ne bougent pas (l'étanchéité clair/sombre reste).
- **Preuves** : `_s8_verif.js` **22/22** — deux issues déterministes du tirage vérifiées sur le plateau
  lui-même (**22 pions clairs / 22 sombres**, jamais de mélange), pastilles de camp des deux barres,
  camp du gagnant dans l'annonce — capturées dans `graphify-out/revue-ui/S8-apres/couleurs-camp-*.png` ;
  `_coin_verif.js` **12/12** (P2bis) ; `test_scenarios.js` 247/247 ; `test_ui_scenarios.js` 115/115 ;
  `_revue_ui.js` : 60 captures, 0 texte sous AA, 0 débordement, la pastille n'ajoute aucune cible
  tactile (elle n'est pas interactive) ; `_check_html.js` et `_verif_jeux_mobile.js` OK.

### Addendum — 03/10/2026 : les SKINS appartiennent au joueur, pas à la couleur des pions

La règle des camps a rendu visible une confusion plus ancienne : le joueur voyait **son** skin sur les pions de
l'adversaire. La cause n'était pas le stockage — `pion_style` porte une ligne par compte **et** par camp, donc
chaque joueur avait bien ses deux apparences — mais le **rendu** : le plateau ne recevait que les **deux**
apparences du compte local (`applyPionStyles()` écrivait `data-pion-color` et `data-pion-color-dark`), et le CSS
peignait par **camp**, pour tout le monde. Dès que l'adversaire tenait un camp, il en héritait l'apparence ; avec
« le gagnant prend les clairs », le skin clair que je venais de composer partait droit sur **ses** pions.

- **Ce qui change dans le rendu** : le plateau porte **quatre** jeux de variables — (moi | adversaire) ×
  (clair | sombre). `mountPionStyles()` les génère depuis les catalogues (chaque jeu ne reçoit que les couleurs
  de **son** groupe : l'étanchéité clair/sombre vaut pour les deux propriétaires), et `.piece.opp` rebinde le jeu
  adverse sur les génériques. La recette de rendu reste **unique** — une couleur × un motif — donc l'aperçu de la
  boutique ne peut pas mentir sur le plateau. Les attributs `data-pion-color` / `-dark` gardent **exactement**
  leur ancien sens : aucune sonde existante n'est invalidée.
- **Ce qui change côté serveur** : `getState()` publie l'apparence des **deux** comptes
  (`player1/2.pionStyles`, posés par `createGameSession()` depuis `pion_style`). C'est la seule source possible
  pour l'adversaire — un client ne connaît pas le compte d'en face — et la seule **correcte** pour un spectateur,
  qui n'est ni l'un ni l'autre joueur. `game.js` reste pur : il ne lit pas la base.
- **Deux garde-fous qui évitent de déplacer le problème** : (1) tant qu'une partie sert ses apparences depuis
  l'état, un passage en boutique ne peut plus les écraser — sinon l'adversaire y perdait la sienne et le
  spectateur y gagnait celle du visiteur ; (2) en quittant la partie, le plateau revient à MON apparence de
  compte, sans quoi un spectateur gardait sur ses propres pions celle de P1 qu'il venait de regarder.
- **Ce qui est assumé** : un adversaire **sans compte** (IA d'entraînement) n'a aucune apparence et reçoit le
  **pion Vato**. En entraînement, on ne voit donc plus son propre skin « clairs » sur les pions de l'IA. C'est le
  prix de la règle demandée — et c'est plus honnête qu'un adversaire qui porterait mes couleurs.
- **Le vocabulaire de la boutique ne bouge pas** : deux camps, deux apparences, mêmes libellés. C'est le
  **sens** du réglage qui est désormais complet : ce que je règle n'habille que mes pions.
- **Preuves** : `_s8_verif.js` **31/31**, 0 erreur JS — **neuf contrôles V8** posent en base un skin clair
  **distinctif** (`rouge_clair` + tête de zébu) puis figent le tirage dans les deux sens : je gagne → mes pions
  clairs portent **mon** skin, ceux de l'IA (sombres) le pion Vato ; l'IA gagne → **ses** pions clairs portent le
  pion Vato, **sans ma couleur** (`rgb(239, 231, 216)` au lieu de `rgb(249, 124, 114)`) **ni mon motif**
  (masque `none`). **Preuve de discrimination** : en neutralisant le rebinding `.board .piece.opp.clair`, ces
  deux contrôles **échouent** et montrent le rouge et le zébu sur les pions de l'adversaire — la fuite décrite,
  reproduite puis supprimée. `test_scenarios.js` **251/251** (+4 : l'état du match, et celui du **spectateur**,
  porte les apparences des deux joueurs — différentes l'une de l'autre — et les deux joueurs reçoivent le même
  état). `test_ui_scenarios.js` **115/115**, `_coin_verif.js` **12/12**, `_check_html.js` OK,
  `_verif_jeux_mobile.js` OK, `_revue_ui.js` **60 captures, 0 texte sous AA, 0 débordement, 0 erreur JS**.
- **Note d'outillage** : le harnais S8 nomme désormais la **ressource** de chaque échec réseau (`requestfailed`)
  et la **classe par origine**. C'est ce qui a tranché un `ERR_CONNECTION_CLOSED` intermittent : il venait de
  `fonts.gstatic.com`, pas du serveur. Les fichiers servis par l'application restent des **erreurs** (un asset
  manquant est un vrai défaut) ; ceux d'un CDN externe — les polices Google, seule dépendance hors service —
  sont seulement **notés**, puisque la page y survit par repli de police. Le réseau ne doit pas décider du
  verdict d'un contrôle de code.

