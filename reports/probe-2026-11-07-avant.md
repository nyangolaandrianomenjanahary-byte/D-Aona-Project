# Sonde back-office — relevé AVANT (2026-11-07)

Mesure d'entrée du chantier de correction. **79 points** mesurés, **56 OK**, **23 KO**.

Outil : `d-aona-server/tools/_ui_admin_probe.js` (gitignoré, sonde jetable).

## Comment la mesure est fabriquée

Base **jetable** (`_probe.db`, supprimée en fin de course) :

1. `seed_oracle.js --force` — 7 jours de parties, dossiers KYC, retraits, litiges ;
2. compte d'ancrage `ProbeAdmin` promu `super_admin` ;
3. **deux vraies parties en cours, créées par les flux réels (WebSocket)** :
   matchmaking (`find_match` → `accept_match`, mise 0) et **défi à 2 000 Ar par camp**
   (`send_challenge` → `accept_challenge`), soit un **pot attendu de 4 000 Ar**.

Des `INSERT` à la main n'auraient pas reproduit le défaut central (une ligne `games`
**et** une ligne `game_sessions` par partie) : seule la création réelle le fait.

Chaque chiffre affiché est comparé à un **oracle SQL indépendant** (connexion
`node:sqlite` en lecture seule), et chaque constat d'écran est mesuré dans le DOM
(géométrie réelle, pas une capture d'œil).

## Écarts constatés (23)

| Point | Constat mesuré | Attendu |
|---|---|---|
| `1.1:overview:1440` | `coupé=true`, bas de page à **1 265 px** pour un cadre de 900 px | bas atteignable |
| `1.1:users:1440` | `coupé=true`, bas à **1 400 px** | bas atteignable |
| `1.1:matches:1440` | `coupé=true`, bas à **3 610 px** | bas atteignable |
| `1.1:ranking:1440` | `coupé=true`, bas à **1 205 px** | bas atteignable |
| `1.1:roles:1440` | `coupé=true` | bas atteignable |
| `1.1:modules:1440` | `coupé=true` | bas atteignable |
| `1.2a` | dialogue non critique : **reste ouvert** au clic extérieur | fermé |
| `2.1` | `overview.liveWagers` : **champ absent** | 4 000 Ar |
| `2.2` | ventilation par jeu : **absente** | somme = 4 000 Ar |
| `2.3` | nombre de sessions en cours : **absent** | 2 |
| `3.1a` | « Parties aujourd'hui » **non séparé** Défi / Matchmaking | défi 1 · matchmaking 1 |
| `3.1b` | total affiché sans décomposition | = défi + matchmaking |
| `3.2` | **7 colonnes, 0 stylée, hauteurs distinctes = [17]** : sept boîtes inline identiques, aucun histogramme | barres stylées, ≥ 3 hauteurs |
| `3.3a` | « parties en cours » = **6** (lignes `games.status='live'` du seed) au lieu des **2 sessions réelles** | 2 |
| `3.3b` | **2** parties « terminées » **sans vainqueur** en base | 0 |
| `3.3c` | **2** lignes `games` en attente (`reason='en_cours'`, sans vainqueur) | 0 |
| `3.3d` | onglet « En cours » (`status=live`) : **60 lignes, 49 vainqueurs** — le filtre renvoie TOUT | 2 lignes, 0 vainqueur |
| `3.3e` | « Terminées » : **2** lignes sans vainqueur | 0 |
| `3.3f` | en-tête **« Jouée le »** | « Début » |
| `4.1` | boutons de ligne : Rechercher, **Suspendre, Retirer KYC**, Réactiver — pas d'« Examiner » | Examiner |
| `4.2a` | colonne **« Vu »** | « Date de création » |
| `4.2b` | pas de « Dernière activité » ni « Dernière visite dans le jeu » | les deux |
| `3.3g` | la colonne vainqueur de l'onglet « En cours » affiche des pseudos | « — » partout |

## Points déjà au vert (à ne pas casser)

- **Erreurs console : 30/30 mesures à zéro** (15 vues × 2 gabarits).
- **Mobile : 15/15 vues défilent** (390×844) — le défaut de défilement est
  strictement desktop (`body.is-fill`, ≥ 1081 px).
- `1.2b` / `1.2c` : une confirmation sensible **survit** au clic extérieur et
  Échap la ferme — comportement correct à conserver (il est aujourd'hui accidentel :
  rien ne se ferme).

## Causes racines établies

1. **Défilement desktop** — `FILL_ROUTES` contient `admin` : `body.is-fill` pose
   `height:100dvh; overflow:hidden` et `#screens{overflow:hidden}`, mais seul le
   groupe `#friends-root` / `#notifications-root` / `#tournament-root` reçoit
   `overflow-y:auto`. `#admin-root` n'a aucun conteneur défilant → contenu coupé.
2. **`games.status` jamais alimenté** — `GameRecord.create()` n'écrit pas `status`,
   la colonne prend son défaut `'finished'` (migration 018). D'où : parties en cours
   comptées « terminées sans vainqueur », `liveGames` faux, doublons.
3. **Filtre « En cours »** — `matchesList({status:'live'})` tombe dans la branche
   générique (condition `status !== "live"`) et renvoie **toutes** les parties.
4. **Graphique « Activité des parties »** — le balisage `chart-col` a été inventé
   au portage ; la maquette dessine un SVG dans `#activity-chart` et
   `admin.demo.css` ne contient aucune règle `chart-col` : sept `<i>` inline vides.
5. **Dialogue admin** — `<dialog>` natif + `showModal()` : le clic sur le fond ne
   ferme rien (aucun écouteur) et aucun verrou « action sensible » n'existe.
6. **Champs absents côté serveur** — `liveWagers`, `gamesTodaySplit`, et
   `users.phone/email` + `game_sessions.updated_at` (dérivable) manquent à l'API.

## Rejouer la mesure

```
cd d-aona-server
node tools/_ui_admin_probe.js                    # mesure, code 0
node tools/_ui_admin_probe.js --strict           # code 1 si un point échoue
node tools/_ui_admin_probe.js --size=1440 --views=matches
```

Rapport complet (79 lignes, y compris les 30 contrôles console) :
`%TEMP%\daona_probe\rapport.md`.
