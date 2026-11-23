# Audit complet — `app.aitmpl.com`

**Date** : 19 novembre 2026
**Périmètre** : application web `https://app.aitmpl.com/` (catalogue de composants Claude Code + jobs + certifications)
**Axes** : logique d'interface · fonctionnalités · UX · UI · accessibilité · performance
**Méthode** : exploration réelle via Chrome (CDP), 29 captures, mesures DOM/CSS/ARIA/Performance API, tests d'interaction desktop (1920×1080, 1366×768) et mobile (390×844), thèmes clair et sombre
**Statut du testeur** : visiteur non connecté (compte non disponible → parcours authentifié non couvert)

---

## 1. Résumé exécutif

Le produit est **bon sur le fond** : catalogue volumineux (2 021 composants), fiche composant très complète (fichiers, scan de sécurité, compatibilité, commande d'install prête à copier), design system clair/sombre cohérent sur la majorité des pages, et une identité visuelle forte (mono + terracotta + ASCII). Les métriques de chargement sont correctes (TTFB 0,34 s, CLS 0,001).

En revanche, **la couche d'interaction est en dessous du niveau du contenu** : les deux systèmes de recherche ne donnent pas les mêmes résultats (le ⌘K ne trouve pas un composant nommé « Frontend Design »), les contrôles de filtre et de tri se désynchronisent de l'état réel, la pagination perd l'utilisateur, et trois pages majeures (jobs, certifications, trending) sont vides pour un robot ou sans JavaScript. L'accessibilité clavier et lecteur d'écran est incomplète sur les composants les plus utilisés (palette de recherche, tiroir Stack, boutons invisibles focusables).

### Notes par axe (sur 10)

| Axe | Note | Justification courte |
|---|---|---|
| Logique d'interface | **4,5** | 4 désynchronisations d'état vérifiées, shell incohérent entre pages, onglets non historisés |
| Fonctionnalités | **5,5** | Recherche globale peu fiable, parité mobile incomplète, 902 liens `href="#"` |
| UX | **5,5** | Excellent contenu de fiche, mais jargon, densité, hero envahissant, valeur utile en 3ᵉ position |
| UI / design system | **6,5** | Base solide et dark mode réussi ; dérives de palette, tailles de texte, composants dupliqués |
| Accessibilité (WCAG 2.2 AA) | **4,0** | Contraste accent, focus invisible, modales non sémantiques, 0 région live |
| Performance | **7,0** | Bon TTFB/CLS, mais DOM monstrueux sur /jobs et HTML très lourd sur /plugins |

### Les 10 priorités (par impact utilisateur ÷ effort)

| # | Problème | Sévérité | Où |
|---|---|---|---|
| 1 | La recherche ⌘K ne retourne pas le composant attendu (« frontend design » → *No results found*) et classe des résultats hors sujet pour « react » | **S1** | toutes pages |
| 2 | Sur mobile, la recherche inline est masquée : la seule recherche restante est celle, cassée, du ⌘K | **S1** | `/skills`, `/agents`, … |
| 3 | Filtre catégorie en double (select + chips) désynchronisé, et seul 8 des 30 catégories sont proposées en chips | **S2** | listes |
| 4 | Le tri ne « prend » pas : la liste devient alphabétique mais le select revient à « Most Popular » | **S2** | listes |
| 5 | Pagination : pas de retour en haut, pas de numéro de page (39 pages), pas d'URL | **S2** | listes |
| 6 | 24 boutons `opacity: 0` (« Sign in to save ») sont focusables au clavier | **S2** | listes |
| 7 | Palette ⌘K et tiroir « Stack Builder » sans rôle dialog / focus trap / focus restore | **S2** | toutes pages |
| 8 | Contraste de l'accent en texte : 3,25:1 (AA exige 4,5:1) | **S2** | fiches, liens |
| 9 | `/jobs`, `/certifications`, `/trending` : aucun contenu ni `h1` dans le HTML servi (rendu client) + 902 liens `href="#"` | **S2** | 3 pages |
| 10 | Hero ASCII + compteurs : ~400 px avant le catalogue (2 rangées de cartes visibles en 1366×768) | **S2** | accueil |

---

## 2. Cartographie du produit

**Nature** : catalogue de composants pour Claude Code (skills, agents, commands, settings, hooks, MCPs, mods, plugins) + deux verticales monétisables (job board, certifications) + espaces « My Components » / « Stack » derrière authentification Clerk.

**Comptes affichés dans la navigation** : Skills 933 · Agents 423 · Commands 288 · Settings 86 · Hooks 64 · MCPs 139 · Mods 51 · Plugins 37 → **2 021 composants** (la page d'accueil annonce « 2 000+ »).

**Stack technique observée** : Astro (islands hydratés : 7 à 19 par page), Tailwind avec tokens CSS custom (`--color-surface-*`, `--color-text-*`, `--color-accent`), Clerk pour l'auth (`accounts.aitmpl.com`), script de tracking publicitaire maison (`/api/spot`, placements `featured` / `sponsored` + impressions via IntersectionObserver), Google Analytics.

**Modèle de revenus visible dans l'UI** : rail droit « JOBS » + « CERTIFICATIONS » sur l'accueil (contenus sponsorisés trackés), pages `/jobs` (902 offres agrégées de 6 sources) et `/certifications` (23 certifications + 63 cours), contenus verrouillés derrière la création de compte.

**Pages auditées** : `/`, `/skills`, `/agents`, `/commands`, `/settings`, `/hooks`, `/mcps`, `/mods`, `/plugins`, `/trending`, `/jobs`, `/certifications`, `/supporters`, `/my-components`, `/about`, `/privacy`, `/security`, `/developers/catalog-api`, `/component/skills/creative-design/frontend-design`, 404.

---

## 3. Logique d'interface

### LI-01 · Filtre catégorie : deux contrôles, deux états — **S2**
La même intention (filtrer par catégorie) est exposée par un `<select>` « All categories » (30 options) **et** par une rangée de chips dans le panneau « Filters » (8 chips seulement). Les deux ne partagent pas leur état :

- clic sur la chip `creative-design` → résultat filtré à 34 composants, chip orange, **mais le select affiche toujours « All categories »** ;
- sélection de `database` dans le select → résultat filtré à 15 composants, **mais la chip `database` reste grise**.

De plus, seules les 8 premières catégories alphabétiques sont proposées en chips : `development` (la plus fournie) est inaccessible par ce chemin. Preuves : `shots/03-filters-panel.png`, `shots/04-filtered-creative-design.png`.

**Reco** : une seule source de vérité. Supprimer le select OU les chips ; si les chips restent, les alimenter depuis l'état et ajouter « +22 catégories ».

### LI-02 · Tri désynchronisé — **S2**
Sur `/skills`, après changement de tri : la liste passe bien en ordre alphabétique (`Emerging Techniques…`, `Evaluation Bigcode…`) et la pagination affiche « 2 / 39 », **mais le select réaffiche « Most Popular »**. L'utilisateur ne peut plus savoir comment la liste est triée. Preuve : `shots/11-sort-desync.png`.

### LI-03 · Pagination qui perd le contexte — **S2**
- Le clic sur « Next » ne remonte pas le conteneur de scroll (`scrollTop` reste à 1 344 px) : on atterrit sur le bas de la page 2, face à la pagination, sans voir les nouveaux résultats.
- Aucun numéro de page : sur `/skills` il y a **39 pages** ; atteindre la page 30 demande 29 clics.
- Aucun état dans l'URL : impossible de partager « page 3, tri alphabétique, catégorie development », et le bouton Retour ne restaure rien.

Preuves : `shots/05-list-bottom.png`, `shots/10-pagination-page2.png`.

### LI-04 · État de recherche / filtres / tri hors URL — **S2**
`location.search` reste vide après n'importe quelle recherche ou filtre. Conséquences : pas de lien partageable, pas de restauration au retour, pas d'indexation des pages filtrées.

### LI-05 · Préférences d'affichage non persistées — **S3**
La bascule Grille/Liste revient en Grille à chaque rechargement (aucune clé de stockage). Le choix de thème, lui, est bien persisté (`claude-theme`), ce qui rend l'incohérence visible.

### LI-06 · Shell de navigation incohérent entre pages — **S2**
| Élément | Accueil, listes, trending, jobs, certifications | Fiche composant | `/my-components` |
|---|---|---|---|
| Header global (recherche, GitHub, thème) | oui | **non** (le `<header>` est le fil d'Ariane de la fiche) | **non** |
| Rail droit sponsorisé (260 px) | accueil uniquement | non | non |
| Sidebar | oui | oui **+ entrées Docs / GitHub en plus** | oui |
| Motif de hero | ASCII + compteurs | fil d'Ariane + H1 | aucun en-tête de page |

Trois familles de pages, trois squelettes. L'utilisateur perd le repère « où est la recherche ? ». Preuves : `shots/07-detail-header-check.png`, `shots/22-my-components.png`.

### LI-07 · Onglets de fiche non historisés — **S3**
Les onglets Overview / Files / Security scan / Compatibility ont bien `role="tab"` + `aria-selected`, mais l'implémentation utilise `history.replaceState` : le bouton Retour ne revient pas à l'onglet précédent, et l'URL n'est pas empilée. Aucun `role="tabpanel"`, aucun `aria-controls`, pas de navigation par flèches, pas de roving `tabindex`.

### LI-08 · Panneau de filtres sticky qui recouvre la grille — **S2**
La barre de recherche + le panneau « Filters » ouvert forment un bloc `position: sticky; top: 56px` **de 196 px de haut** qui reste affiché pendant le défilement et masque le haut des cartes. Il ne se referme jamais automatiquement. Sur un écran de 768 px de haut, il occupe 25 % de la surface utile. Preuve : `shots/05-list-bottom.png`.

### LI-09 · Action de masse sans confirmation — **S2**
« + Add Page to Stack » ajoute **les 24 composants de la page** en un clic, sans confirmation ni récapitulatif : le bouton devient « − Remove Page from Stack », toutes les cartes reçoivent un badge ✓ et un widget flottant « Stack 24 » apparaît. Aucune possibilité d'annuler autrement qu'en recliquant. Preuve : `shots/24-add-page-stack.png`.

### LI-10 · Widget flottant qui masque du contenu — **S3**
Le bouton « Stack N » (`position: fixed`, bas droite) recouvre le rail « CERTIFICATIONS » à 1366 px (`shots/27-home-1366.png`) et la liste des fichiers de la fiche en mobile (`shots/29-mobile-detail.png`). Il n'existe pas de marge de sécurité prise en compte pour lui.

### LI-11 · Bouton « Filters » sans état ARIA et avec un état visuel ambigu — **S3**
Le bouton n'a ni `aria-expanded`, ni `aria-pressed`, ni `aria-controls`. Son remplissage orange signale « filtres actifs ou panneau ouvert » sans que l'on puisse distinguer les deux cas.

### LI-12 · Actions secondaires invisibles au repos — **S2**
Chaque carte porte deux boutons (« Sign in to save », « Add to stack ») en `opacity: 0`, révélés au survol. Ils restent **focusables** (voir A11Y-01) et ne sont jamais découvrables sur mobile (pas de survol).

---

## 4. Fonctionnalités

### FX-01 · La recherche globale ⌘K ne remplit pas son contrat — **S1**
Tests réels effectués dans la palette (`Ctrl/⌘ + K`) :

| Requête | Résultat attendu | Résultat obtenu |
|---|---|---|
| `frontend design` | la skill « Frontend Design » (n°1 de l'accueil) | **« No results found »** |
| `react` | React Best Practices, Senior Frontend… | Shopify Expert, Web3 Integration Specialist, Communication Excellence Coach, Frontend Developer, Fullstack Developer, Mobile App Developer, Mobile Developer |
| `python` | composants Python | Model Evaluator, Apify Integration Expert, Arm Migration, Neo4j Docker Client Generator, Technical Writer, Agent Installer |
| `zzzqqqxyz` | aucun | « No results found » (correct) |

La recherche *inline* des pages de liste, elle, trouve correctement « React Best Practices ». **Deux moteurs de recherche, deux niveaux de qualité** : c'est le premier point de friction du produit. Preuve : `shots/13-command-k-results.png`.

### FX-02 · Palette ⌘K : ergonomie et sémantique incomplètes — **S2**
- Pas de rôle `dialog` / `aria-modal` / `listbox` / `option`, pas de `aria-activedescendant` : un lecteur d'écran n'annonce ni l'ouverture, ni les résultats, ni la sélection.
- Aucun compteur de résultats, aucune possibilité de « voir tous les résultats » dans un contexte filtré.
- À la fermeture (`Esc`), **le focus retourne sur `<body>`** et non sur le bouton déclencheur : le parcours clavier repart du début du document.
- Le fond reste défilable (pas de verrou de scroll).

### FX-03 · `/jobs` : 902 cartes, 902 liens `href="#"` — **S2**
Toutes les offres sont rendues dans la page initiale sous forme de `<a href="#">`. Il n'existe donc : ni URL par offre, ni partage, ni ouverture dans un nouvel onglet, ni indexation. Le clic ouvre une modale Clerk de connexion. Preuve : `shots/18-jobs.png`, `shots/19-job-click.png`.

### FX-04 · Parité mobile incomplète — **S2**
| Fonction | Desktop | Mobile 390 px |
|---|---|---|
| Recherche inline du catalogue | oui | **masquée** (`display:none`) |
| Tri (Populaire / A-Z) | oui | **masqué** |
| Vue liste dense | oui | non |
| Widget Stack | oui | oui (mais recouvre) |
| Drawer de navigation | — | oui, correct |

Combiné à FX-01, cela signifie qu'un utilisateur mobile **ne peut pas chercher efficacement un composant connu**.

### FX-05 · Trois pages majeures rendues côté client — **S2**
Le HTML servi pour `/trending`, `/jobs` et `/certifications` (54 Ko chacun) **ne contient ni `h1`, ni le contenu de la page** (aucun « Trending Components », aucun « TOP COUNTRIES », aucun « Showing 902 of 902 »). Un crawler ou un client sans JS ne voit qu'une coquille. À comparer avec `/skills` et la fiche composant, correctement SSR (h1 présent dans le HTML initial).

### FX-06 · Aucun retour d'action pour l'utilisateur — **S2**
- **Copie** de la commande d'install : seule l'icône change (2 s), aucun libellé, aucune annonce — et **zéro région `aria-live` sur tout le site** (mesuré : 0).
- « Save », « Add to stack », « Clear search », application de filtres : aucun toast, aucune confirmation, aucune erreur en cas d'échec (clipboard refusé par exemple).

### FX-07 · Verrouillage d'auth sans apport de valeur préalable — **S2**
`/jobs` et `/certifications` affichent des cartes complètes (titre, société, extrait de 300 caractères, tags) mais chaque action mène à la modale Clerk. La modale s'ouvre au clic sur la carte elle-même, sans indiquer qu'un compte est requis avant le clic (l'icône cadenas est petite et sans libellé).

### FX-08 · Titres SEO et métadonnées contradictoires — **S3**
`/agents` : titre « **600+ AI Agents** for Claude Code » alors que la navigation et le H1 affichent **423**. `/mcps` : « 55+ MCP Integrations » pour **139**. La page d'accueil titre « 2,000+ Agents, Commands, Skills & MCP Integrations » (mélange de types) alors que le total des 8 types est 2 021.

---

## 5. UX

### UX-01 · Le catalogue commence trop bas — **S2**
Sur l'accueil, l'ASCII art (490 × 59 px, `font-size: 8,88px`), les trois compteurs animés et la barre d'outils consomment ~400 px avant la première carte. En 1366×768 il ne reste que **deux rangées de cartes** visibles (`shots/27-home-1366.png`). Pour un produit dont l'usage dominant est « je cherche un composant et je copie une commande », c'est un coût d'entrée élevé.

### UX-02 · La valeur principale est au second plan — **S2**
L'action n°1 (copier `npx claude-code-templates@latest --skill …`) apparaît :
- sur la fiche : dans le rail droit (desktop), donc en lecture secondaire ;
- sur mobile : après le titre + description + métriques, soit ~500 px de scroll (`shots/29-mobile-detail.png`).

Elle mériterait une barre d'action collante en haut de fiche.

### UX-03 · Jargon non expliqué — **S2**
`Stack`, `Add Page to Stack`, `Stack Builder`, `My Components`, `Mods`, `component PRs`, `MCPs`, `hooks`, `Anti-Refusal`, `NVIDIA SkillSpector`, `13 of 100` (score de sécurité sans échelle ni légende). Rien dans l'interface ne définit « stack » ou « mod » ; seul un bloc SEO en bas de page explique ce qu'est le catalogue.

### UX-04 · Badge de confiance omniprésent — **S2**
« Scanned by NVIDIA SkillSpector » est présent sur **100 % des cartes** (24 occurrences par page). En mobile, il occupe environ un tiers de la hauteur de la carte (`shots/14-mobile-skills.png`) pour une information identique partout. Un badge répété à l'infini perd sa fonction de signal et devient du bruit.

### UX-05 · Charge cognitive des barres de filtres — **S2**
- Listes : recherche + select catégorie + bouton Filters + slider « MIN DOWNLOADS » + tri + bascule de vue + badge ⌘K = **7 contrôles**.
- `/jobs` : 3 pills de localisation + 2 selects + tri + recherche + 12 tags + « +24 more » = **9 contrôles** avant la première offre.
Aucun indicateur « filtres actifs » global, aucun bouton « tout effacer » visible hors panneau.

### UX-06 · Densité et lisibilité des cartes — **S3**
Desktop : titre mono 14 px, description 12 px sur 2 lignes, tag 13 px, compteur 11 px, badge 10 px. C'est cohérent avec l'esthétique « terminal » mais **12 px pour une description informative** est en dessous des minimums confortables pour un public qui lit pour décider d'installer du code.

### UX-07 · État vide : bon contenu, CTA hors écran — **S3**
L'état « No results for "zzzqqq" » est propre (icône, titre reprenant la requête, explication, bouton « Clear search ») mais, à 863 px de hauteur, le bouton se trouve à **y = 925**, donc sous la ligne de flottaison (`shots/02-search-empty.png`).

### UX-08 · Microcopy à retravailler — **S3**
- « Create your free account to save your stacks and see jobs and courses. Already have one? **Same buttons.** »
- « 1 observation · Nov 19, 2026 · Read the report » (sans dire ce qu'est une observation)
- « Writes 2 files to .claude/skills/frontend-design/ » (utile mais relégué en gris)
- « Anti-Refusal » (terme interne NVIDIA exposé tel quel)

### UX-09 · Mesure de sécurité illisible — **S3**
L'onglet « Security scan » affiche un anneau « **13** of 100 ». Sans échelle ni libellé, 13/100 se lit comme une mauvaise note alors que le texte précise que ce n'est pas une vulnérabilité. L'information utile (une observation sur la ligne 69 du fichier) est en dessous. Preuve : `shots/26-detail-files-tab.png`.

### UX-10 · Fiche composant : troncature sans issue — **S3**
La description « About » est coupée (`…`) en mobile après 3 lignes, sans « lire la suite ». Les métriques se replient mal : « Source ↗ » se retrouve orphelin sur une deuxième ligne.

### Points positifs UX à conserver
- Fiche composant : fil d'Ariane, onglets, liste de fichiers avec lignes/octets, commit et PR source, viewer Code/Preview, sommaire « ON THIS PAGE », rail Install/About/Licence/Compatibilité → **c'est la meilleure page du produit**.
- État vide de recherche et état vide « My Components » : clairs et bien écrits.
- Drawer mobile avec backdrop, verrou de scroll et états actifs.
- Mode sombre soigné (noir chaud `#0b0b0a`, accent conservé, texte `#faf9f5`).

---

## 6. UI / design system

### Base solide
Tokens sémantiques en place, deux thèmes complets, échelle de surfaces (`surface-0` → `surface-4`), 2 polices (Geist / Geist Mono), rayons et ombres cohérents, focus visible global (outline 1 px accent, `:focus-visible` confirmé au clavier).

### UI-01 · L'accent est utilisé comme couleur de texte — **S2 (a11y)**
`--color-accent: #d57455`. Sur fond blanc : **3,25:1**. Mesuré sur des éléments réels : « View source on GitHub » (13,5 px) et « Read the report » (13 px) → échec WCAG 1.4.3 (4,5:1 exigé). En mode sombre, le même accent atteint 6,06:1 : le problème est **spécifique au thème clair**.

### UI-02 · Contrôles natifs restés aux couleurs par défaut — **S3**
- L'input de recherche a un `box-shadow` bleu (`oklab(0.567 0.014 -0.158 / 0.2)`), hérité du `--color-primary` bleu, alors que l'accent est terracotta.
- Le slider « MIN DOWNLOADS » a `accent-color: rgb(94,106,210)` : **bleu**.
Résultat : deux familles de couleurs d'interaction sur la même barre d'outils.

### UI-03 · Palette hors tokens — **S2**
`/trending` introduit 6 couleurs Tailwind brutes pour ses cartes KPI : `#3b82f6` (bleu), `#8b5cf6` (violet), `#059669` (émeraude), `#f59e0b` (ambre), rose et cyan. Elles n'existent nulle part ailleurs. « Clear All » utilise un rouge ad hoc non tokenisé (aucun token `danger` / `warning` / `info` dans le système).

### UI-04 · Trois familles de cartes et de héros — **S2**
| Page | Hero | Cartes |
|---|---|---|
| Accueil | ASCII art + 3 compteurs | bordure fine, icône jaune, badges |
| Listes | icône dans un carré arrondi + H1 + sous-titre | identiques à l'accueil |
| Trending | titre + 6 cartes KPI pastel | tableau de rang en divs avec médailles or/argent/bronze |
| Jobs | titre + emoji 🐴 | 4 cartes KPI **neutres** (pas pastel) |
| Certifications | titre + description + onglets | cartes avec logo éditeur |

`/trending` et `/jobs` affichent des KPI dans deux styles différents. Aucune règle ne permet de savoir laquelle s'applique.

### UI-05 · Modales : quatre traitements différents — **S2**
| Modale | Traitement |
|---|---|
| Certification (accueil) | carte blanche, tokens de l'app, `role=dialog` correct, bien intégrée |
| Palette ⌘K | simple champ posé sur un backdrop flouté, sans conteneur visuel |
| Stack Builder | tiroir latéral, gros bouton pill orange, style propre |
| Connexion (Clerk) | carte blanche générique, bouton noir, logo Clerk — **et blanche même en thème sombre** (`shots/20-dark-signin.png`, contraste 255/11 = « flash ») |

### UI-06 · Typographie : mono sur du contenu de lecture — **S3**
Titres de cartes en mono bold 14 px, catégories en mono 11 px, badges en mono 10 px, compteurs en mono. Sur la fiche, la description est en sans-serif (bien) mais les métadonnées repassent en mono. Le mono est un choix d'identité assumé ; son extension aux libellés informatifs dégrade la lecture.

### UI-07 · Tailles et alignements incohérents — **S4**
Input de recherche 41,5 px de haut, select catégorie 42 px, bouton Filters 37,5 px, bouton de tri 38 px : la barre d'outils n'est pas alignée sur une grille commune.

### UI-08 · Détails de finition — **S3/S4**
- Emoji dans les titres de page (🐴 sur `/jobs`, 🐴 dans `<title>` de toutes les pages).
- Logos tiers de trois natures (simpleicons, favicon Neon, SVG maison).
- Scrollbar native visible sous la barre d'onglets en mobile (`shots/29-mobile-detail.png`).
- Pastille « 37 collections » flottante à droite du hero `/plugins`, sans fonction.
- Barre d'onglets mobile tronquée (« Compatibilit… ») et libellé différent du desktop (« Security » vs « Security scan »).

---

## 7. Accessibilité (WCAG 2.2 AA)

| ID | Constat | Critère | Sév. | Preuve |
|---|---|---|---|---|
| A11Y-01 | 24 boutons « Sign in to save » en `opacity: 0` sont atteignables au clavier (`focus()` renvoie `true`, rect 28×28) | 2.4.7 Focus visible, 2.4.3 Ordre | S2 | mesures `/skills` |
| A11Y-02 | Palette ⌘K : pas de `role=dialog`/`aria-modal`, pas de `combobox`/`listbox`/`option`, focus rendu au `<body>` à la fermeture | 4.1.2, 2.4.3 | S2 | DOM mesuré |
| A11Y-03 | Tiroir « Stack Builder » : pas de rôle modal, pas de nom accessible, focus non déplacé à l'ouverture | 4.1.2, 2.4.3 | S2 | DOM mesuré |
| A11Y-04 | Contraste accent sur blanc = **3,25:1** (< 4,5) sur des liens de 13 px | 1.4.3 | S2 | calcul sur styles réels |
| A11Y-05 | **0** région `aria-live` / `role=status` sur l'ensemble des pages testées ; aucune confirmation annoncée (copie, save, filtres) | 4.1.3 | S3 | mesure |
| A11Y-06 | Champs sans nom accessible : recherche inline (placeholder seul), 2 `<select>` (catégorie, tri), slider « MIN DOWNLOADS » (ni label, ni `aria-valuetext`) | 3.3.2, 4.1.2 | S2 | DOM mesuré |
| A11Y-07 | Tableau de classement `/trending` construit en `div` : 0 `role=table/row/cell` | 1.3.1 | S3 | DOM mesuré |
| A11Y-08 | Pills de catégorie `/trending` sans `aria-pressed`/`aria-selected` ; onglets sans `tablist`/`tabpanel` | 4.1.2 | S3 | DOM mesuré |
| A11Y-09 | Aucun lien d'évitement (« skip to content ») alors que `<main id="main-content">` existe | 2.4.1 | S3 | DOM mesuré |
| A11Y-10 | `/trending`, `/jobs`, `/certifications` : pas de `h1` dans le HTML servi | 1.3.1, 2.4.2 | S3 | fetch HTML |
| A11Y-11 | Cibles tactiles à 32 px (nav mobile, boutons « Add to stack », fermeture du drawer) | 2.5.8 (min. 24 px) — conforme mais sous les 44 px recommandés | S4 | mesures 390 px |

**Ce qui est déjà bon** : `lang="en"`, un seul `h1` sur les pages SSR, hiérarchie `h2/h3` correcte, `alt` présents sur toutes les images, ASCII art en `aria-hidden="true"`, `role="tab"` + `aria-selected` sur la fiche, `role="dialog"` + `aria-modal` + `aria-labelledby` sur la modale certification, `aria-label` sur Précédent/Suivant, focus visible global, `prefers-reduced-motion` géré (1 règle).

---

## 8. Performance et technique

| Mesure | `/` (1ʳᵉ visite) | `/skills` (cache froid) | `/jobs` | `/plugins` | Fiche composant |
|---|---|---|---|---|---|
| TTFB | **839 ms** | 337 ms | 346 ms | 346 ms | ~340 ms |
| DOMContentLoaded | 3 543 ms | 1 002 ms | 455 ms | 723 ms | — |
| Load | **6 216 ms** | 1 796 ms | **7 542 ms** | 944 ms | — |
| LCP | — | 2 756 ms | — | — | — |
| CLS | — | 0,001 | — | — | — |
| Fichiers JS | 36 | 34 | — | — | — |
| Poids ressources | 948 Ko | 782 Ko | — | 250 Ko (compressé) | — |
| **Nœuds DOM** | 2 475 | 1 043 | **25 447** | 876 | ~2 000 |
| HTML | 65 Ko | 62 Ko | 54 Ko | **1 351 Ko** | 171 Ko |
| Islands Astro | 10 | 7 | 19 | 6 | **39** |

**Constats**
- **PERF-01 (S2)** `/jobs` rend 902 cartes, 2 392 SVG et 166 images → **25 447 nœuds DOM** (seuil d'alerte usuel : 1 500, seuil critique : 3 000) et un `load` à 7,5 s. Risque direct de jank au scroll sur mobile.
- **PERF-02 (S3)** `/plugins` sert **1,35 Mo de HTML** (250 Ko compressés) pour une page de liens.
- **PERF-03 (S3)** 19 islands hydratés par page de contenu, 39 sur la fiche : coût JS répété sur du contenu essentiellement statique.
- **PERF-04 (S3)** LCP 2,76 s sur `/skills` à froid : correct mais au-delà du « bon » (< 2,5 s).
- **Positif** : TTFB bas, CLS quasi nul (pas de saut de mise en page), aucun message d'erreur console détecté sur `/`, `/skills`, `/plugins`, `/trending`.

---

## 9. Registre priorisé complet

| ID | Sév. | Problème | Impact | Effort estimé |
|---|---|---|---|---|
| FX-01 | S1 | Recherche ⌘K non pertinente / ne trouve pas un composant connu | Bloque la tâche principale | M |
| FX-04 | S1 | Recherche + tri absents en mobile | Bloque la tâche principale en mobile | S |
| LI-01 | S2 | Filtre catégorie double et désynchronisé, 8/30 catégories | Fausses conclusions sur le catalogue | S |
| LI-02 | S2 | Tri désynchronisé | Perte de confiance | S |
| LI-03 | S2 | Pagination : scroll, numéros, URL | Navigation pénible (39 pages) | M |
| LI-04 | S2 | Aucun état dans l'URL | Pas de partage / retour | M |
| LI-06 | S2 | Shell de navigation incohérent | Désorientation | M |
| LI-08 | S2 | Panneau filtres sticky qui recouvre | Gêne la lecture | S |
| LI-09 | S2 | Ajout en masse sans confirmation | Erreur irreversible perçue | S |
| LI-12 | S2 | Actions secondaires invisibles au repos | Découvrabilité | S |
| FX-02 | S2 | Palette ⌘K non sémantique, focus non restauré | A11y | S |
| FX-03 | S2 | 902 liens `href="#"` sur /jobs | Pas de partage/SEO | M |
| FX-05 | S2 | 3 pages rendues client | SEO / non-JS | M |
| FX-06 | S2 | Aucun feedback ni aria-live | Incertitude après action | S |
| FX-07 | S2 | Auth gate sans valeur préalable | Conversion | M |
| UX-01 | S2 | Hero trop haut | Accès au catalogue | S |
| UX-02 | S2 | Valeur principale au second plan | Conversion install | S |
| UX-03 | S2 | Jargon non défini | Compréhension | S |
| UX-04 | S2 | Badge répété 24× | Bruit visuel | S |
| UX-05 | S2 | 7 à 9 contrôles de filtre | Charge cognitive | M |
| UI-01 | S2 | Contraste accent 3,25:1 | A11y | XS |
| UI-03 | S2 | Palette hors tokens | Cohérence | S |
| UI-04 | S2 | 3 familles de cartes/héros | Cohérence | M |
| UI-05 | S2 | 4 traitements de modale + Clerk blanc en dark | Cohérence, confort | S |
| A11Y-01 | S2 | Boutons invisibles focusables | A11y | XS |
| A11Y-02 | S2 | Palette ⌘K non sémantique, focus non restauré | A11y | S |
| A11Y-03 | S2 | Tiroir Stack non modal | A11y | S |
| A11Y-04 | S2 | Contraste accent 3,25:1 sur texte | A11y | XS |
| A11Y-06 | S2 | Champs sans label | A11y | XS |
| PERF-01 | S2 | 25k nœuds DOM sur /jobs | Perf mobile | M |
| LI-05 | S3 | Vue grille/liste non persistée | Confort | XS |
| LI-07 | S3 | Onglets non historisés | Confort | S |
| LI-10 | S3 | Widget flottant qui recouvre | Confort | XS |
| LI-11 | S3 | État du bouton Filters non exposé | A11y | XS |
| FX-08 | S3 | Titres SEO contradictoires | Crédibilité | XS |
| UX-06 | S3 | 12 px pour du texte informatif | Lisibilité | S |
| UX-07 | S3 | CTA « Clear search » hors écran | Récupération | XS |
| UX-08 | S3 | Microcopy | Perception | XS |
| UX-09 | S3 | Score 13/100 sans échelle | Compréhension | XS |
| UX-10 | S3 | Description tronquée sans « lire la suite » | Information | XS |
| UI-02 | S3 | Bleu natif sur input/slider | Cohérence | XS |
| UI-06 | S3 | Mono sur texte informatif | Lisibilité | M |
| UI-08 | S3 | Emoji, scrollbar, libellés d'onglets | Finition | XS |
| A11Y-05 | S3 | Pas d'aria-live | A11y | XS |
| A11Y-07 | S3 | Tableau en divs | A11y | S |
| A11Y-08 | S3 | Pills sans état ARIA | A11y | XS |
| A11Y-09 | S3 | Pas de skip link | A11y | XS |
| A11Y-10 | S3 | h1 absent du HTML servi (3 pages) | A11y / SEO | XS |
| PERF-02 | S3 | 1,35 Mo de HTML sur /plugins | Perf | M |
| PERF-03 | S3 | 19–39 islands | Perf | M |
| PERF-04 | S3 | LCP 2,76 s | Perf | S |
| UI-07 | S4 | Alignements de la barre d'outils | Finition | XS |
| A11Y-11 | S4 | Cibles tactiles 32 px | Ergonomie tactile | S |

---

## 10. Plan d'action recommandé

### Sprint 1 — « Rendre la recherche et les filtres fiables » (1 semaine)
1. **FX-01** : unifier la recherche. Une seule API, un seul index, un seul ranking. Critère d'acceptation : `frontend design` → « Frontend Design » en premier résultat ; `react` → composants dont le titre ou le contenu contient *react*, triés par pertinence ; affichage du nombre de résultats + lien « voir les N résultats ».
2. **FX-04** : réintroduire la recherche et le tri en mobile (ou faire du ⌘K l'accès universel une fois corrigé).
3. **LI-01 / LI-02** : un seul état de filtre/tri, une seule source de vérité, 30 catégories accessibles.
4. **LI-04** : mettre recherche, catégorie, tri et page dans l'URL (`?q=&cat=&sort=&page=`), l'état de l'URL étant la source de vérité.

### Sprint 2 — « Navigation et feedback »
5. **LI-03** : `scrollTo(0)` au changement de page + pagination avec numéros (et non « Previous/Next » sur 39 pages).
6. **FX-06** : toasts + `aria-live="polite"` pour copie, save, filtres, ajout de stack.
7. **LI-09** : confirmation explicite pour « Add Page to Stack » (ou action unitaire + « tout ajouter »).
8. **LI-08** : replier le panneau filtres au scroll ; réduire la barre sticky.
9. **FX-02 / A11Y-03** : `role="dialog"`, `aria-modal`, focus trap, focus restore, `Esc`, verrou de scroll pour la palette et le tiroir Stack.

### Sprint 3 — « Cohérence et accessibilité »
10. **UI-01** : assombrir l'accent pour le texte (`#b65b3c` ≈ 4,6:1) ou réserver l'accent aux fonds et grands textes.
11. **A11Y-01** : ne jamais rendre focusables des éléments `opacity: 0` (`pointer-events`/`visibility` + focus-within).
12. **A11Y-06** : labels associés aux 3 champs et au slider.
13. **UI-03 / UI-04 / UI-05** : un fichier de tokens unique (ajouter `danger`, `warning`, `info`), un seul composant carte, un seul composant modale, thème Clerk synchronisé avec le thème de l'app.
14. **A11Y-05/07/08/09** : régions live, sémantique de tableau, états ARIA des pills, skip link.

### Chantier de fond — « Shell unique »
15. **LI-06** : un seul layout (header + sidebar + rail) partagé par toutes les pages ; le rail sponsorisé devient un composant optionnel, pas une variation de squelette.
16. **FX-05** : rendre `/jobs`, `/certifications`, `/trending` en SSR avec `h1` et données initiales.
17. **FX-03 + PERF-01** : URL par offre + pagination serveur (ou virtualisation) sur `/jobs`.

---

## 11. Annexe — inventaire des preuves

| Fichier | Contenu |
|---|---|
| `shots/01-home-desktop.png` | Accueil 1920 : hero ASCII, compteurs, rail sponsorisé |
| `shots/02-search-empty.png` | État vide de la recherche inline |
| `shots/03-filters-panel.png` | Panneau filtres : 8 chips, slider, Clear All |
| `shots/04-filtered-creative-design.png` | Filtre actif : 34 composants, select resté sur « All categories » |
| `shots/05-list-bottom.png` | Bas de liste : sticky 196 px qui recouvre, pagination, footer |
| `shots/06-detail-top.png` | Fiche composant : onglets, fichiers, install, TOC |
| `shots/07-detail-header-check.png` | Fiche après scroll : header global absent |
| `shots/08-skills-list.png` | `/skills` en grille |
| `shots/09-list-view.png` | `/skills` en vue liste dense |
| `shots/10-pagination-page2.png` | Page 2 : scroll non remonté |
| `shots/11-sort-desync.png` | Tri alphabétique + select « Most Popular » |
| `shots/12-command-k.png` | Palette ⌘K vide |
| `shots/13-command-k-results.png` | Résultats non pertinents pour « react » |
| `shots/14-mobile-skills.png` | `/skills` 390 px |
| `shots/15-mobile-drawer.png` | Drawer de navigation mobile |
| `shots/16-dark-skills.png` | Mode sombre |
| `shots/17-trending.png` | `/trending` : KPI pastel, tableau en divs |
| `shots/18-jobs.png` | `/jobs` : 902 offres, gate de connexion |
| `shots/19-job-click.png` | Modale Clerk au clic sur une offre |
| `shots/20-dark-signin.png` | Modale Clerk blanche en thème sombre |
| `shots/21-certifications.png` | `/certifications` |
| `shots/22-my-components.png` | `/my-components` sans header global |
| `shots/23-plugins.png` | `/plugins` : 3ᵉ style de recherche |
| `shots/24-add-page-stack.png` | Ajout de 24 composants en un clic |
| `shots/25-stack-panel.png` | Tiroir « Stack Builder » |
| `shots/26-detail-files-tab.png` | Onglet « Security scan » : score 13/100 |
| `shots/27-home-1366.png` | Accueil 1366×768 : 2 rangées, widget qui recouvre |
| `shots/28-certification-modal.png` | Modale certification (la mieux réalisée) |
| `shots/29-mobile-detail.png` | Fiche composant 390 px |

### Limites de l'audit
- **Parcours authentifié non testé** (aucun compte) : My Components, sauvegarde de stacks, collections, déblocage jobs/certifications, éventuel onboarding post-connexion.
- **API non auditée** (`/api/spot`, `/openapi.json`, `/llms.txt` listés mais non consommés).
- **Non testé** : Safari/Firefox, lecteurs d'écran réels (NVDA/VoiceOver), navigation 100 % clavier exhaustive, tests de charge, réseau dégradé.
- **Mesures de performance** issues d'une session unique (réseau local, cache vidé avant les mesures froides) : les valeurs absolues sont indicatives, les rapports entre pages (25 k nœuds sur `/jobs`, 1,35 Mo de HTML sur `/plugins`) sont, eux, structurels.
- Contenus éditoriaux (pertinence des 902 offres, exactitude des 23 certifications) non évalués.
