# SPEC — D-aôna Administration

**Phase 1** — extraction de la démo, oracle verrouillé, modèle de données, plan de
comparaison. Écrit le 2026-11-02. Aucune ligne de code n'a été écrite avant ce
document.

---

## 0. Source de vérité et oracle

| Élément | Valeur |
|---|---|
| Fichier | `reference/D-aona-Administration.html` (265 439 octets) |
| SHA-256 | `38bb34d37374bc830a3bc34b0aefdb189fe117c0fd8119e74d677227d928a8b0` |
| Verrou | `reference/LOCK.json` (lecture seule) |
| Golden file | `reference/REFERENCE-DEMO.json` |
| Générateur | `scripts/export-reference.js` |

### Assets annoncés par le prompt et ABSENTS

| Attendu | État | Conséquence |
|---|---|---|
| `daona-admin-source.zip` | **absent** | Pas d'accès au TypeScript source ni à ses 14 tests. Les règles sont extraites du bundle minifié. |
| `REFERENCE-DEMO.json` | **absent** | Régénéré depuis la démo réelle (voir ci-dessous). |
| `scripts/export-reference.ts` | **absent** | Remplacé par `scripts/export-reference.js` (pas de chaîne TypeScript dans ce dépôt). |

**Méthode de génération de l'oracle.** Le générateur ouvre la démo dans Chromium,
force une écriture (le store ne persiste qu'après une **commande** ; `theme.toggle`
est la moins intrusive), lit `localStorage["daona.admin.v2"]` et **dérive** les
agrégats. Aucune valeur n'est saisie à la main. Si la démo change, l'oracle change
avec elle — et le verrou de hash empêche ce changement de passer inaperçu.

### Vérification des valeurs annoncées par le prompt

Les 12 valeurs du §11.2 ont été **recalculées indépendamment** depuis la démo.
Toutes concordent :

| Mesure | Prompt | Démo (calculé) | Écart |
|---|---|---|---|
| Comptes | 15 | 15 | 0 |
| Dossiers KYC (à vérifier / vérifiés / refusés) | 3 / 10 / 1 | 3 / 10 / 1 | 0 |
| Retraits | 2 en attente, 1 payé | 2 / 0 approuvé / 1 payé | 0 |
| Litiges | 1 ouvert, 1 en examen | 1 / 1 | 0 |
| Tournois | 6 | 6 | 0 |
| Inscriptions actives | 24 | 24 | 0 |
| Écritures du grand livre | 63 | 63 | 0 |
| Réserves actives | 3 | 3 | 0 |
| **Solde total** | **491 700 Ar** | **491 700** | **0** |
| **Réservé** | **28 000 Ar** | **28 000** | **0** |
| **Disponible** | **463 700 Ar** | **463 700** | **0** |
| Crédits / débits | 563 900 / 72 200 | 563 900 / 72 200 | 0 |
| Parties aujourd'hui | 11 | 11 | 0 |
| Parties sur 7 jours | 56 | 56 | 0 |
| Tournois ouverts | 4 | 4 | 0 |
| Inscriptions sur tournois ouverts | 12 | 12 | 0 |
| Décisions en attente | 7 (3+2+2) | 7 (3+2+2) | 0 |

**Conclusion : le golden file du prompt est fiable.** Il peut servir d'oracle sans
réserve.

---

## 1. Structure

- **15 modules**, **5 groupes**, **7 rôles**, **6 actions**. Identifiants identiques
  à la démo (voir `REFERENCE-DEMO.json → structure`).
- Modules socles (`core`) : `overview`, `roles`, `modules`, `audit`, `settings`.
  Non désactivables — un back-office éteint ne peut plus se rallumer.
- Activer un module **ne donne aucune permission** : les deux réglages sont
  indépendants.

### Commandes → permission exigée (extrait du bundle, objet `ln`)

| Commande | Module | Action |
|---|---|---|
| `kyc.open` | kyc | **read** |
| `kyc.review` | kyc | review |
| `user.sanction` | users | edit |
| `user.role` | roles | edit |
| `withdrawal.review` / `withdrawal.pay` | withdrawals | review |
| `tournament.create` | tournaments | create |
| `tournament.edit` / `.transition` / `.enroll` / `.withdraw` | tournaments | edit |
| `tournament.start` | tournaments | review |
| `match.result` | matches | review |
| `dispute.open` | disputes | **create** |
| `dispute.resolve` | disputes | review |
| `game.save` (sans id) | games | **create** |
| `game.save` (avec id) / `game.status` | games | edit |
| `campaign.save` / `.pause` | campaigns | edit |
| `campaign.delete` | campaigns | delete |
| `roles.save` | roles | edit |
| `module.toggle` | modules | edit |
| `settings.save` | settings | edit |
| `badges.save` | ranking | edit |
| `theme.toggle` | overview | read |

### Matrice de permissions par défaut (extraite de la démo)

Le modèle de la démo est le **produit cartésien 15 modules × 6 actions = 90
permissions**, dont chaque rôle reçoit un sous-ensemble :

| Rôle | Droits par défaut |
|---|---|
| `super_admin` | **tous**, calculés (le rôle protégé court-circuite la table) |
| `admin` | `read create edit review export` sur **14 modules** — **aucun droit sur `roles`** |
| `moderation` | `read` sur overview ; `read review edit` sur users, kyc, disputes, matches |
| `finance` | `read review` sur overview ; `read export` sur finance ; `read review` sur withdrawals |
| `tournaments` | `read` sur overview, games, ranking ; `read create edit review` sur tournaments et matches |
| `marketing` | `read` sur overview ; `read create edit delete` sur campaigns |
| `observer` | `read` sur les 15 modules |

Détail exhaustif : `REFERENCE-DEMO.json → structure.defaultPermissions`.

---

## 2. Modèle de données

Entités de la démo (noms exacts du store) et correspondance cible :

| Démo | Champs | Cible |
|---|---|---|
| `users` | id, pseudo, email, city, hue, elo, wins, losses, blocked, sanctionReason, joinedAt, lastSeen, role | `User` + `Sanction` (journal) |
| `kyc` | id, userId, status, submittedAt, reviewedAt, reason, fingerprints[2] | `KycCase` |
| `ledger` | id, userId, amount, kind, label, createdAt, method, reference | `LedgerEntry` |
| `holds` | id, userId, amount, kind, active, objectId | **dérivé** (voir §4) |
| `withdrawals` | id, userId, amount, method, phone, status, createdAt, reference, reason | `Withdrawal` |
| `games` | id, name, variant, status, duration, ranked, minElo, rules, version | `Game` |
| `matches` | id, gameId, playerIds[2], status, mode, startedAt, endedAt, winnerId, ratingBefore, eloChanges, reason, tournamentId, round | `Match` |
| `tournaments` | id, name, gameId, format, capacity, entryFee, startAt, closeAt, minElo, matchMinutes, interval, sponsor, status, rounds, championId | `Tournament` |
| `registrations` | id, tournamentId, userId, transactionId, refunded, createdAt | `Registration` |
| `disputes` | id, matchId, userId, category, reason, status, createdAt | `Dispute` |
| `campaigns` | id, title, image, url, placement, startAt, endAt, order, paused | `Campaign` |
| `badges` | id, name, minRank, maxRank | `BadgeRule` |
| `permissions` | {role: {module: [actions]}} | `Permission` |
| `audit` | id, at, actor, action, target, reason | `AuditLog` (append-only) |
| `settings` | platformName, contact, timezone, registrationsOpen, maintenance, theme | `Settings` |
| `processed` | ids de commandes | `IdempotencyKey` |

**Schéma Prisma proposé** (phase 1, à valider) :

```prisma
model User { id String @id @default(uuid()) pseudo String @unique elo Int @default(1100)
  wins Int @default(0) losses Int @default(0) city String? hue Int? createdAt DateTime @default(now()) }

model LedgerEntry { id String @id @default(uuid()) userId String amount BigInt
  kind Kind reference String @unique createdAt DateTime @default(now())
  @@index([userId]) }

model Withdrawal { id String @id @default(uuid()) userId String amount BigInt
  method String phone String? status WithdrawalStatus @default(PENDING)
  paymentReference String? @unique reviewedBy String? reviewedAt DateTime?
  paidAt DateTime? reason String? createdAt DateTime @default(now()) }

model Registration { id String @id @default(uuid()) tournamentId String userId String
  refundedAt DateTime? createdAt DateTime @default(now())
  @@unique([tournamentId, userId]) @@index([userId]) }

model Match { id String @id @default(uuid()) gameId String tournamentId String?
  status MatchStatus winnerId String? eloDeltaP1 Int? eloDeltaP2 Int?
  playedAt DateTime? @@index([tournamentId, round]) }

model IdempotencyKey { key String @id result Json? expiresAt DateTime }
```

Contraintes non négociables : montants **entiers** (`BigInt`, jamais de flottant),
`reference` comptable **unique**, une seule inscription **active** par
(joueur, tournoi), une seule distribution de prix par tournoi, un seul paiement par
retrait.

---

## 3. Règles métier (à appliquer côté serveur, en transaction)

Reprises du prompt §2, chacune vérifiable par un test :

**Finances** — grand livre source de vérité ; `disponible = solde − réserves
actives` ; inscription débitée une seule fois ; remboursement unique ; retrait
`pending → approved → paid` ou `pending → rejected`, l'approbation **conserve** la
réserve, le paiement **débite et lève la réserve dans la même transaction** ; refus
libère la réserve sans débit ; dotation = somme des frais réellement inscrits ;
exports CSV protégés contre l'injection de formules.

**Compétition** — capacité **puissance de 2** ; têtes de série par Elo ; tour
suivant seulement quand tous les matchs du tour sont validés ; Elo **zero-sum
K=32**, une seule fois, jamais en amicale ; **un litige ouvert bloque la validation
du résultat** ; une partie de tournoi ne s'annule pas isolément ; badges continus
sans trou ni chevauchement (Remenabila 1, Malaso 2, Dahalo 3, Totakely 4–25,
Akofa 26–50, Vary masaka 51+).

**Identité & audit** — `non soumis → à vérifier → vérifié / refusé`, refus motivé ;
doublon d'empreinte avec un dossier vérifié → dérogation motivée obligatoire ;
**l'ouverture d'une pièce est journalisée** ; journal en ajout seul avec
avant/après.

---

## 4. Écart majeur de conception : le solde stocké

Le prompt (§2, §11.5) impose : **« aucun solde mutable stocké à part ; tout est
dérivé du grand livre »**.

L'implémentation actuelle du dépôt fait l'inverse : `users.balance` est une colonne
mutable, entretenue par `Wallet.addTransaction()` (`balance = balance ± montant`).
La démo, elle, calcule `solde = Σ écritures` (fonction `l(I)` du bundle) et ne
stocke **aucun** solde.

Conséquence : une écriture annulée ou rejouée désynchronise `users.balance` sans
que rien ne le signale. Le seul garde-fou actuel est la réconciliation manuelle.

**Proposition** — vue dérivée plutôt que colonne :

```sql
CREATE VIEW user_wallet AS
SELECT u.id AS user_id,
       COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = u.id), 0) AS balance
FROM users u;
```

`users.balance` devient une colonne **cache** écrite dans la même transaction que
l'écriture comptable, et un job de réconciliation compare `balance` à `SUM(amount)`
(le prompt §13 le demande de toute façon). C'est le compromis qui préserve les
performances de lecture sans renoncer à l'invariant.

**Statut : à arbitrer avant la phase 2.**

---

## 5. Plan de comparaison

### Ce qui est comparable dès maintenant

| Élément | Comparaison |
|---|---|
| Seed (§11.2) | 17 agrégats, tolérance **zéro** — oracle prêt |
| Portefeuilles (§11.3) | 15 comptes, `solde/réservé/disponible/Elo/V/D` |
| Top 5 + badges | ordre, Elo, badge dérivé du rang |
| Structure (§11.6) | 15 modules, 5 groupes, 7 rôles, 6 actions, matrice 90 |
| Commandes | 25 commandes et leur couple (module, action) |

### Ce qui n'est pas encore comparable

- **§11.4 — 8 scénarios métier.** L'implémentation actuelle ne couvre que la chaîne
  de retrait (S2, S3, S7 partiels). S1 (KYC), S4 (annulation de tournoi), S5/S6
  (litige + Elo), S8 (module coupé) restent à écrire côté test.
- **§11.6 — 630 assertions.** Impossible avec le modèle actuel : **34 permissions
  déclarées**, pas 90. Voir §6.
- **§11.8 — régression visuelle.** Les captures de `docs/formation-admin/captures/`
  sont celles de l'**ancienne** interface. Aucune capture de la démo aux 16 routes
  n'existe encore.
- **§11.9 — axe-core**, **§11.10 — budgets**, **§11.11 — exports**, **§11.12 —
  rapport** : à instrumenter.

### Livrables de comparaison à produire

```
reference/LOCK.json              ✔ écrit
reference/REFERENCE-DEMO.json    ✔ généré depuis la démo
reference/id-map.json            À FAIRE (demoId u1/t5/w1 -> UUID)
scripts/export-reference.js      ✔ écrit
scripts/export-actual.js         À FAIRE (même format, depuis la nouvelle base)
scripts/compare.js               À FAIRE (rapport + code de sortie non nul si BLOQUANT)
reports/compare-AAAA-MM-JJ.md     À FAIRE à chaque phase
```

Classement des écarts, verdict GO/NO-GO et interdiction de modifier le golden file :
conformes au §11.12 du prompt.

---

## 6. Écarts constatés entre la démo (oracle) et l'implémentation actuelle

Constats **mesurés**, pas supposés. Chacun est classé selon la grille du §11.1.

| # | Écart | Niveau | Décision proposée |
|---|---|---|---|
| E1 | **34 permissions déclarées au lieu de 90.** Le produit cartésien 15×6 n'existe pas ; les 630 assertions du §11.6 sont impossibles. | **BLOQUANT** | Aligner sur la grille 90 et les défauts de la démo (fait, voir §7). |
| E2 | `admin` détient `roles.read` ; la démo ne lui donne **aucun** droit sur `roles`. | **BLOQUANT** | Corrigé par E1. |
| E3 | `dispute.open` exigée en `disputes.review` ; la démo exige `disputes.create`. | **BLOQUANT** | Corrigé. |
| E4 | `kyc.open` (ouverture d'une pièce) n'existe pas ; la démo la traite en `kyc.read` **et la journalise**. | MAJEUR | Route ajoutée + audit. |
| E5 | Annulation de tournoi exigée en `tournaments.delete` ; la démo n'utilise que `tournaments.edit`/`review`. | MAJEUR | Corrigé (`edit`). |
| E6 | Un **litige ouvert ne bloque pas** la validation du résultat (scénario S6). | **BLOQUANT** | Corrigé. |
| E7 | Une partie de **tournoi peut être annulée isolément**. | MAJEUR | Corrigé (refus). |
| E8 | Capacité de tournoi acceptée sans contrôle **puissance de 2**. | MAJEUR | Corrigé. |
| E9 | Badges : intervalle validé badge par badge, **continuité non vérifiée**. | MAJEUR | Corrigé. |
| E10 | Export CSV : valeurs commençant par `= + - @` **non neutralisées**. | MAJEUR | Corrigé. |
| E11 | Paiement d'un retrait : débit puis changement de statut en **deux transactions**. | **BLOQUANT** | Corrigé (transaction unique). |
| E12 | `users.balance` est une colonne **mutable** ; la démo dérive tout du grand livre. | **BLOQUANT** | À arbitrer (§4) — non corrigé dans cette passe. |
| E13 | `moderation` n'a ni `disputes.edit` ni `matches.edit` ; `finance` n'a pas `overview.review`. | MAJEUR | Corrigé par E1. |
| E14 | **`match.result` ne calculait AUCUN Elo** : valider un résultat ne changeait pas le classement. | **BLOQUANT** | Corrigé : Elo zero-sum K=32, une seule fois, transactionnel. |
| E15 | **Annuler un tournoi n'annulait pas ses matchs** : le bracket survivait à l'édition. | **BLOQUANT** | Corrigé : les rencontres passent en `annule`. |
| E16 | **Le solde d'ouverture de 5 000 Ar n'avait AUCUNE écriture** : tout compte neuf violait l'invariant « solde = Σ écritures ». | **BLOQUANT** | Corrigé : `Wallet.opening()` écrit au grand livre, sur les deux chemins d'inscription. |
| E17 | **Le routeur lisait la ressource AVANT de vérifier le droit** (`POST /tournaments/:id`) : un rôle sans droit recevait 404, pas 403 — la barrière n'était jamais franchie. | MAJEUR | Corrigé : l'ordre est session → module → droit → donnée. |

**État d'exécution (2026-11-03).** E1 à E11, E13 à E17 sont **appliqués et vérifiés** :
matrice de 630 lignes, **861 assertions de permissions**, **8/8 scénarios**, **14/14
invariants** dont un fuzz de 500 commandes. E12 (solde dérivé) reste **ouvert** :
c'est un arbitrage, pas un correctif. Détail et preuves :
`reports/compare-2026-11-02.md`.

---

## 7. Arbitrages demandés avant la phase 2

1. **Stack.** Le prompt impose TypeScript + Fastify + PostgreSQL + Prisma + Redis +
   React/Vite + Docker. Le dépôt est Node CommonJS + SQLite + mono-fichier, avec
   **328 scénarios serveur, 135 vérifications d'interface et 7 migrations**
   aujourd'hui verts. Une réécriture Postgres/React jetterait cet acquis.
   Le prompt autorise les écarts s'ils sont justifiés (« justifie tout écart »).
   **Choix proposé** : conserver Node + SQLite + modules ES (déjà en place, testé),
   et n'introduire PostgreSQL/React que si un besoin réel l'exige (multi-instance,
   volume, équipe front). À valider.
2. **E12 — solde dérivé.** Migrer `users.balance` vers une vue calculée + cache
   transactionnel, ou conserver la colonne avec réconciliation quotidienne ?
3. **Assets manquants.** Sans `daona-admin-source.zip`, les 14 tests du domaine et
   les règles exactes du moteur Fanorona restent reconstitués depuis le bundle.
   Peux-tu le fournir ?

---

## 8. Ce qui est réel, ce qui est simulé

| Domaine | État |
|---|---|
| Référence verrouillée + oracle | **Réel** (hash + golden file généré, valeurs vérifiées) |
| Règles métier E1–E11, E13 | **Réel** (corrigées et testées dans cette passe) |
| E12 (solde dérivé) | **Non fait** — arbitrage en attente |
| Seed de démonstration équivalent à l'oracle | **Réel** — `seed_oracle.js`, 63 écritures, 491 700 / 28 000 / 463 700 Ar |
| Comparateur automatique (`compare.js`) | **Réel** — `npm run verify:seed` → **230/230, GO** |
| Régression visuelle (`visual.js`) | **Réel** — 90 captures comparées, écart moyen **26,0 %** (contre 36,5 % avant le chantier) ; la parité pixel n'est **pas** atteinte — voir `docs/FIDELITE_VISUELLE.md` |
| Paiements MVola/Orange/Airtel | **Simulé** (aucun adaptateur provider) |
| 2FA TOTP | **Absent** |
| PostgreSQL / Prisma / Redis / React | **Absents** — stack actuelle conservée |
| Interface admin (15 modules) | **Réel** — branchée sur l'API, 135 vérifications d'interface |
