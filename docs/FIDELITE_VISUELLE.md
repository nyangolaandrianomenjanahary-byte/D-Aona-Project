# Chantier de fidélité visuelle — état et méthode

**Objectif** (§11.8 du cahier des charges) : **≤ 0,5 %** de pixels différents entre
la maquette de référence et le back-office livré, sur 15 écrans × 3 tailles ×
2 thèmes = **90 captures**.

**Mesure** : `npm run visual` (filtrable `--size=1440|768|390`, `--theme=light|night`).
Rapport : `reports/visual-AAAA-MM-JJ.md`. Captures : `%TEMP%\daona_visual`.

---

## 1. Trajectoire mesurée

| Étape | Écart moyen | Ce qui a changé |
|---|---|---|
| Mesure initiale | **36,5 %** | back-office v2 (`a-*`) contre maquette |
| Protocole corrigé | 25,8 %* | même rectangle de comparaison des deux côtés |
| Coquille de la maquette | 15,2 %* | barre latérale, en-tête, pied, `.canvas` |
| Ancrage de la barre latérale | 13,5 %* | `.sidebar` en `absolute` au lieu de `fixed` |
| Portage audit + modules | **13,0 %*** | deux écrans reconstruits |
| **Matrice complète, 90 captures** | **25,9 %** | 3 écrans portés sur 15 |

\* mesure sur 1440 × light seulement. Les 25,9 % portent sur les 90 captures.

### Résultats par écran après cette passe (1440 × light)

| Écran | Avant | Après | Delta |
|---|---|---|---|
| modules | 18,0 % | **11,8 %** | **−6,2** |
| audit | 13,6 % | **11,4 %** | **−2,2** |
| overview | 14,8 % | 15,5 % | +0,7 (reconstruction imparfaite) |

Les deux écrans reconstruits sur le relevé gagnent nettement. La vue d'ensemble
régresse légèrement : ma reconstruction de la répartition `overview-main` /
`overview-rail` ne respecte pas encore les hauteurs relevées (main 786×932, rail
330×932). C'est le prochain point à corriger avant de porter les autres.

**Le seuil de 0,5 % n'est pas atteint.** Il ne peut l'être qu'en portant le
**contenu des 15 vues** — la coquille, elle, est désormais identique.

---

## 2. Ce qui est en place

| Brique | Fichier | État |
|---|---|---|
| Feuille de la maquette, **scopée** sous `#admin-root` | `admin/admin.demo.css` (généré) | 360 règles, 54,5 Ko, **aucune fuite** |
| Extracteur + scoper CSS | `scripts/extract-demo-css.js` | reproductible, vérifie l'absence de fuite |
| Trousse visuelle (icônes, avatar, statut, panneau, métrique, tableau, onglets) | `admin/admin.uikit.js` | 39 icônes **extraites**, classes de la maquette |
| Coquille (barre latérale, en-tête, `.canvas`, pied) | `admin/admin.core.js` | balisage de la maquette |
| Vue d'ensemble | `admin/admin.views.system.js` | premier portage (structure à corriger, voir §3) |
| Neutralisation de la grille v2 | `admin/admin.css` (`.demo-shell`) | `position:relative` + `.sidebar{absolute}` |

**Les deux feuilles coexistent** (`admin.css` pour les 14 écrans pas encore portés,
`admin.demo.css` pour les écrans portés). Les jeux de classes ne se croisent pas :
la migration peut donc se faire **écran par écran sans jamais casser l'application**
(S14 reste à 11/11).

---

## 3. La méthode, éprouvée

Le bundle de la maquette est minifié, mais **sa structure se lit dans le DOM**. Pour
chaque écran, la recette est :

1. charger la maquette sur la route (`file://…#/<id>`) ;
2. **dumper l'arbre** de `#view-content` avec classes et boîtes ;
3. reconstruire ce balisage à l'identique, en branchant les données de l'API ;
4. mesurer (`npm run visual --size=1440 --theme=light`) et répéter.

### Structure de référence — Vue d'ensemble (relevée, pas devinée)

```
page-head                                   1140×64
  DIV
    H1                                       « Vue d'ensemble »
    P                                        « 7 décisions en attente. L'essentiel… »
  page-actions
    btn.primary                              16×16 (icône) + libellé
overview-grid                               1140×932
  overview-main                             786×932
    metrics                                 786×121   → 4 × .metric 196×119
    panel                                   786×274   → panel-head + chart 758×188
    panel-foot                              786×43    → chart-summary + « Annulations exclues »
    panel                                   786×387   → panel-head + table-wrap 784×324
  overview-rail                             330×932
    panel                                   330×283   → panel-head + queue-list
    panel                                   330×306   → panel-head + next-tournament
    panel                                   330×303   → panel-head + activity-list
```

Trois enseignements qui valent pour **les 15 écrans** :

- les **métriques vivent DANS** `overview-main`, pas au-dessus de la grille ;
- `.panel-foot` est un **frère** du panneau, pas un enfant ;
- les blocs de droite sont des `.panel` de hauteur libre, empilés dans
  `overview-rail` (330 px).

Mon premier portage de la vue d'ensemble plaçait les métriques hors grille et le
pied à l'intérieur : d'où les 14,8 % qui restent sur cet écran.

---

## 4. Reste à faire, écran par écran

| # | Écran | État | Remarque |
|---|---|---|---|
| 1 | overview | porté, **à corriger** | 15,5 % — répartition main/rail à ajuster |
| 2 | users | à porter | onglets + tableau |
| 3 | kyc | à porter | file + aperçu des pièces |
| 4 | disputes | à porter | onglets + table |
| 5 | games | à porter | cartes de jeu |
| 6 | matches | à porter | onglets + table |
| 7 | tournaments | à porter | table + `next-tournament` |
| 8 | ranking | à porter | barres + table + badges |
| 9 | finance | à porter | métriques + grand livre |
| 10 | withdrawals | à porter | onglets + table + actions |
| 11 | campaigns | à porter | table + vignettes |
| 12 | roles | à porter | `role-layout` + `permission-table` |
| 13 | modules | **PORTÉ** | 11,8 % |
| 14 | audit | **PORTÉ** | 11,4 % |
| 15 | settings | à porter | `settings-panel` |

**Ordre conseillé** : overview (corriger), puis audit et modules (structures
simples), puis users/withdrawals/campaigns (même famille « table + onglets »), puis
kyc/disputes/matches/tournaments, puis ranking/finance/roles/settings (les plus
riches).

**Estimation** : 15 relevés d'arbre + 15 reconstructions + 90 mesures. C'est un
chantier de plusieurs passes, à mener écran par écran, avec une mesure après
chacun.

---

## 5. Ce que le chantier ne change pas

La fidélité visuelle est **purement front**. Elle ne touche ni l'API, ni le modèle de
données, ni les règles métier :

- 230 comparaisons de données : **GO**
- 861 assertions de permissions : **GO**
- 8 scénarios métier : **8/8**
- 14 invariants + fuzz 500 : **14/14**
- 336 tests serveur, 135 vérifications d'interface : **verts**

`npm run verify` reste la porte de sortie fonctionnelle ; `npm run visual` mesure
la seule fidélité graphique et **ne fait pas échouer** la chaîne tant que l'écart
est documenté.
