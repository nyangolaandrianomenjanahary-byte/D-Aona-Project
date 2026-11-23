# Contrat d'API — Administration v2

Document figé au **2026-11-02** (lots A0 → A10 de `PLAN-REFONTE.md`).

Il existe pour une raison précise : la maquette HTML de l'administration
n'appelait **aucune** route (0 occurrence de `/api/`, données en
`localStorage`). Chaque écran a donc dû être relié à un serveur qui, lui, ne
connaissait que neuf modules et un vocabulaire différent. Ce fichier est la
traduction, commande par commande.

---

## 1. Les trois barrières

Toute route sous `/api/admin/` traverse, dans cet ordre :

1. **SESSION** — jeton `Authorization: Bearer …` valide, sinon `401 NON_AUTHENTIFIE`.
2. **MODULE** — l'interrupteur global du module doit être allumé, sinon
   `403 MODULE_DESACTIVE` (y compris pour un super administrateur : sans cela
   l'interrupteur ne servirait à rien).
3. **DROIT** — permission `module.action` détenue par l'un des rôles, sinon
   `403 ACCES_REFUSE`.

Un refus sur une **action** est journalisé (`acces.refuse`) ; un refus de
**lecture** ne l'est pas (un observateur qui recharge sa page noierait le
journal).

Le client **masque** ce qu'il ne peut pas faire. Il ne protège rien : le
serveur refuse de toute façon.

---

## 2. Modules, actions, rôles

**15 modules** — `overview`, `users`, `kyc`, `disputes`, `games`, `matches`,
`tournaments`, `ranking`, `finance`, `withdrawals`, `campaigns`, `roles`,
`modules`, `audit`, `settings`.

**6 actions** — `read`, `create`, `edit`, `review`, `export`, `delete`.
34 permissions au total (`module.action`).

**5 modules socles** (`overview`, `roles`, `modules`, `audit`, `settings`) :
l'interrupteur refuse de les éteindre (`409 MODULE_SOCLE`). Un back-office
entièrement éteint ne peut plus se rallumer.

**7 rôles** — `super_admin` (protégé, droits calculés), `admin`, `moderation`,
`finance`, `marketing`, `tournaments`, `observer`.

---

## 3. Lectures

| Route | Permission | Charge utile |
|---|---|---|
| `GET /api/admin/me` | *aucune* (porteur d'un rôle) | `{ roles, permissions, rights, modules, catalogue, all, superAdmin }` |
| `GET /api/admin/overview` | `overview.read` | compteurs, activité 7 jours, `liveWagers`, `gamesTodaySplit`, file de décision |
| `GET /api/admin/users?q=&limit=` | `users.read` | `{ users: […] }` avec `last_game_at`, `created_at`, `blocked`, `sanction_reason` |
| `GET /api/admin/users/:id` | `users.read` | fiche de consultation (voir ci-dessous) |
| `GET /api/admin/kyc?status=&limit=` | `kyc.read` | `{ cases, counts, faceRequired }` |
| `GET /api/admin/kyc/:id/doc/:face` | `kyc.review` | **image binaire** (`recto`, `verso`, `visage`) — jamais un `<img src>` |
| `GET /api/admin/disputes?status=&limit=` | `disputes.read` | `{ disputes }` |
| `GET /api/admin/games` | `games.read` | `{ games }` avec `engine: true/false` |
| `GET /api/admin/matches?status=&limit=` | `matches.read` | `{ matches }` (en cours + archivées) |
| `GET /api/admin/tournaments` | `tournaments.read` | `{ tournaments }` |
| `GET /api/admin/ranking` | `ranking.read` | stats + tête de tableau + badges |
| `GET /api/admin/finance` | `finance.read` | soldes, engagé, payé, flux |
| `GET /api/admin/accounting?format=csv` | `finance.export` | CSV (BOM UTF-8, `;`) |
| `GET /api/admin/withdrawals?status=&limit=` | `withdrawals.read` | `{ withdrawals, methods, dailyCap, minAmount, totals }` |
| `GET /api/admin/ads` | `campaigns.read` | `{ ads }` |
| `GET /api/admin/roles` | `roles.read` | `{ roles, modules }` |
| `GET /api/admin/assignments` | `roles.read` | `{ assignments }` |
| `GET /api/admin/modules` | `modules.read` | `{ modules }` avec `group`, `core` |
| `GET /api/admin/audit?limit=` | `audit.read` | `{ entries }` |
| `GET /api/admin/settings` | `settings.read` | `{ settings }` typés |

### Pièces d'identité

La route `doc/:face` exige l'en-tête `Authorization` : un `<img src="…">` ne
peut donc pas la lire. Le client récupère la pièce en **blob**, en fait une URL
d'objet, et la **révoque** au changement d'écran. Une carte d'identité ne doit
pas rester en mémoire après avoir quitté le dossier.

Trois faces sont servies : `recto`, `verso` et `visage` (scan facial, migration
025). Le **nom du fichier ne vient jamais de l'URL** : il est relu en base puis
contrôlé (aucune traversée de dossier possible). Chaque lecture est journalisée
(`kyc.doc`).

### Fiche d'un joueur — `GET /api/admin/users/:id`

Ouvre le dossier de consultation du bouton « Examiner ». Droit `users.read`,
mais **l'acte est journalisé** (`users.examine` : qui, quand, quel joueur) :
c'est la contrepartie d'un droit de regard sur des données personnelles.

```
{ id, pseudo, phone, email, province, avatar, elo, wins, losses,
  balance, bonus_lock, created_at, last_seen, last_game_at,
  kyc_status, blocked, sanction_reason, roles,
  kyc_case: { id, status, reason, submitted_at, reviewed_at,
              faces: { recto, verso },        // présence seulement
              face:  { present, captured_at }, // scan facial (migration 025)
              retention_until } }
```

`last_game_at` = la plus récente des sessions touchées et des parties créées
(deux sources : une partie terminée garde sa ligne d'historique même quand sa
session a disparu). Aucune image ne transite ici : les pièces restent derrière
`kyc.review`.

---

## 4. Commandes

Toutes en `POST` (ou `DELETE` quand c'est une suppression réelle). Aucune ne
décide « d'après l'interface ».

| Commande (maquette) | Route | Permission |
|---|---|---|
| `kyc.open` | `POST /api/admin/kyc/:id/approve` \| `/reject` | `kyc.review` |
| `dispute.open` | `POST /api/admin/disputes` | `disputes.review` |
| `dispute.resolve` | `POST /api/admin/disputes/:id/resolve` | `disputes.review` |
| `game.save` | `POST /api/admin/games/:slug` | `games.create` / `games.edit` |
| `game.status` | `POST /api/admin/games/:slug/status` | `games.edit` |
| `match.result` | `POST /api/admin/matches/:id/result` | `matches.review` |
| `tournament.create` | `POST /api/admin/tournaments` | `tournaments.create` |
| `tournament.edit` | `POST /api/admin/tournaments/:id` | `tournaments.edit` |
| `tournament.withdraw` | `POST /api/admin/tournaments/:id` `{action:"cancel"}` | `tournaments.delete` |
| `badges.save` | `POST /api/admin/badges` | `ranking.edit` |
| `withdrawal.review` | `POST /api/admin/withdrawals/:id/review` | `withdrawals.review` |
| `withdrawal.pay` | `POST /api/admin/withdrawals/:id/pay` | `withdrawals.review` |
| `campaign.save` | `POST /api/admin/ads` · `/:id` | `campaigns.create` / `edit` |
| `campaign.delete` | `DELETE /api/admin/ads/:id` | `campaigns.delete` |
| `roles.save` | `POST /api/admin/roles/:id` | `roles.edit` |
| `user.role` | `POST /api/admin/assignments` | `roles.edit` |
| `user.sanction` | `POST /api/admin/users/:id` `{action:"block"\|"unblock"\|"warn", reason}` | `users.edit` |
| `module.toggle` | `POST /api/admin/modules/:id` | `modules.edit` |
| `settings.save` | `POST /api/admin/settings` | `settings.edit` |
| `theme.toggle` | **aucune route** — préférence client | — |

### Mouvements d'argent

`withdrawal.review` **n'a pas** de valeur par défaut : `{decision:"approve"}`
ou `{decision:"reject", reason}`. Un refus sans motif est `400 MOTIF_MANQUANT`.
`withdrawal.pay` exige `{reference}` : c'est la preuve du transfert. Un
paiement débite le portefeuille avec `Wallet.spendWithdrawable()`, qui ne
touche **jamais** le bonus verrouillé.

---

## 5. Temps réel

Le serveur diffuse `{ type: "admin_update", module }` aux **seules** sessions
porteuses d'un rôle. Le message ne transporte **aucune donnée** : c'est un
signal, le client recharge la vue courante (regroupé à 350 ms) et les droits
sont revérifiés à ce moment-là.

---

## 6. Codes d'erreur utiles au client

| Code | Statut | Sens |
|---|---|---|
| `NON_AUTHENTIFIE` | 401 | jeton absent ou expiré |
| `ACCES_REFUSE` | 403 | rôle insuffisant |
| `MODULE_DESACTIVE` | 403 | interrupteur global fermé |
| `MODULE_SOCLE` | 409 | module non désactivable |
| `MOTIF_MANQUANT` | 400 | refus/suspension sans motif |
| `REFERENCE_MANQUANTE` | 400 | paiement sans référence |
| `ETAT_INVALIDE` | 409 | transition impossible (déjà instruite, etc.) |
| `DEMANDE_EN_COURS` | 409 | une demande de retrait est déjà ouverte |
| `PLAFOND_QUOTIDIEN` | 400 | > 500 000 Ar/jour |
| `MOTEUR_ABSENT` | 409 | jeu sans dossier de code : activation refusée |
| `INTERVALLE_INVALIDE` | 400 | badge dont le rang max précède le min |
| `PIECES_INCOMPLETES` | 409 | validation KYC sans toutes les pièces exigées |
| `JOUEUR_INCONNU` | 404 | fiche demandée pour un compte inexistant |

---

## 7. Ce qui n'est pas fait, volontairement

- **`liveWagers` est la SOMME DES POTS** : `wager` est la mise par camp (le
gagnant touche `wager × 2 × 0,9`), donc le total engagé vaut `2 × wager`. Seules
les sessions `playing` comptent, et `byGame` somme exactement `total` (même
filtre). Les entraînements (`ai`), amicaux et tournois ne sont pas des mises :
ils sont comptés à part (`gamesTodaySplit.autres`) et nommés en note de bas de
panneau, jamais dans le total.
- **Le scan facial n'est pas capturé côté joueur.** La migration 025 et le
back-office sont prêts (stockage, affichage, rétention 12 mois, refus
`PIECES_INCOMPLETES`), mais l'application joueur n'envoie pas encore de
`visage`. Le réglage `kyc_face_required` (Paramètres, éteint par défaut) rendra
la pièce **obligatoire** le jour où la capture existera : aucune ligne de code
à retoucher. Tant qu'il est éteint, un dossier « legacy » (recto + verso)
reste validable et l'écran l'annonce.
- **Une correction de résultat ne recalcule pas l'Elo.** `match.result`
  confirme ou annule une partie ; reprendre la chaîne des parties est une
  décision séparée, et l'écran le dit.
- **`settings.maintenance` est exposé et appliqué aux inscriptions**
  (`registrations_open`), mais ne coupe pas encore l'accès joueur.
- **Les chemins historiques `ads`, `accounting`, `elo`, `badges` restent
  servis** : renommer une URL est un changement de contrat qui mérite son
  propre lot, et l'ancienne interface s'en servait encore pendant la refonte.
