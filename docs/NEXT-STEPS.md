# Prochaines étapes — rendre D-aôna pleinement opérationnel en ligne

> Ce document est la **liste ordonnée** de ce qui reste à faire. Il est écrit
> pour être exécuté, pas lu : chaque étape dit quoi faire, avec quelle commande,
> et **comment savoir que c'est réussi**.
>
> Mise à jour : 2026-11-24.

---

## 0. Ce qui est fait (vérifié)

| Élément | État | Preuve |
|---|---|---|
| Séparation frontend / backend / base | **fait** | `apps/web`, `apps/api`, `supabase/` |
| Modèle de données défini | **fait** | [DATA-MODEL.md](DATA-MODEL.md) — 31 tables, 278 colonnes, 45 clés étrangères |
| Schéma Postgres généré et **validé** | **fait** | `supabase/migrations/0001_initial.sql` — 107 instructions exécutées sans erreur |
| RLS refus-par-défaut | **fait** | `supabase/migrations/0002_rls.sql` |
| Contrat d'API inventorié | **fait** | [API-CONTRACT.md](API-CONTRACT.md) — 43 routes, 39 messages WS |
| Origine du backend configurable | **fait** | `apps/web/config.js` + `scripts/gen-web-config.js` |
| WebSocket multi-origine | **fait** | `D_AONA_ALLOWED_ORIGINS` — testé (1008 sur origine inconnue) |
| Sonde de disponibilité | **fait** | `GET /healthz` |
| Configs de déploiement | **fait** | `apps/web/vercel.json`, `render.yaml`, CI GitHub Actions |
| Non-régression | **fait** | 7 suites vertes (340/340 scénarios) + campagne UI 135/135 |

---

## 1. Mettre le site en ligne **aujourd'hui** (≈ 2 h)

Cette étape donne une URL publique qui fonctionne, **avec la base SQLite
actuelle**. Elle ne règle pas la persistance long terme (voir §2).

> **Le dépôt contient déjà un second chemin** (mode B, tout-Vercel) : `api/index.js`
> + `supabase/schema.sql` + `vercel.json` à la racine. Il est conservé et
> fonctionne — voir [RUNBOOK-DEPLOY §1.1](RUNBOOK-DEPLOY.md). Si vous restez sur
> ce mode, sautez l'étape 1.3 (Render) et appliquez `supabase/schema.sql` au lieu
> des migrations. Le mode A reste recommandé : sans WebSocket natif, chaque coup
> devient un aller-retour HTTP complet.

### 1.1 Supabase — créer le projet

1. <https://supabase.com/dashboard> → **New project**.
2. Région : `eu-central-1` (Francfort) — la plus proche de Madagascar disponible.
3. Noter : `Project ref`, le **mot de passe de la base**, l'URL du projet.
4. Récupérer la chaîne de connexion : *Project Settings → Database →
   Connection string → URI*. Deux variantes :
   - **pooler, port 6543** → pour le serveur (`prepare: false`) ;
   - **directe, port 5432** → pour les migrations et l'import.
5. Récupérer *Project Settings → API* : `URL`, `anon key` (publique),
   `service_role key` (**secrète**).

### 1.2 Pousser le schéma

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push          # applique 0001_initial.sql puis 0002_rls.sql
```

**Réussi si** : dans le tableau de bord, *Table Editor* montre **31 tables**, et
*Authentication → Policies* montre que la RLS est active sur toutes.

> Sans Docker, `supabase start` (pile locale) n'est pas disponible — ce n'est pas
> nécessaire : `db push` écrit directement dans le projet distant.

### 1.3 Backend — Render

1. <https://dashboard.render.com> → **New → Blueprint** → ce dépôt
   (`render.yaml` est détecté).
2. Renseigner les variables `sync: false` :
   - `D_AONA_ALLOWED_ORIGINS` = l'URL Vercel (étape 1.4) — **peut être complétée après**
   - `D_AONA_PUBLIC_API_URL` = `https://d-aona-api.onrender.com`
3. **Disque persistant** (indispensable pour ne pas perdre la base) :
   *Add Disk* → mount path `/var/data` → puis variable
   `D_AONA_DB_PATH=/var/data/d-aona.db`.
4. Déployer. **Réussi si** `https://d-aona-api.onrender.com/healthz` répond
   `{"ok":true,...}`.

> ⚠️ Plan **free** : le service s'endort après 15 min sans trafic → les
> WebSockets sont coupés et la première visite prend ~50 s. Prendre **Starter**
> pour un usage réel.

> ⚠️ Les **photos de profil et les pièces KYC ne survivront pas** à un
> redéploiement tant que l'étape §6 n'est pas faite (elles sont sur le disque
> éphémère du conteneur, hors `/var/data`).

### 1.4 Frontend — Vercel

1. <https://vercel.com/new> → importer ce dépôt.
2. **Root Directory** = `apps/web`. Framework = *Other*.
3. Variables d'environnement (Production + Preview) :
   - `D_AONA_PUBLIC_API_URL` = `https://d-aona-api.onrender.com`
   - `D_AONA_PUBLIC_WS_URL` = `wss://d-aona-api.onrender.com` (facultative, déduite)
4. Déployer.
5. **Retourner sur Render** : ajouter l'URL Vercel à `D_AONA_ALLOWED_ORIGINS`
   (ex. `https://d-aona-project.vercel.app`) → redéployer.

**Réussi si** : l'URL Vercel affiche l'écran d'accueil, l'inscription fonctionne,
et le badge de connexion temps réel passe au vert (WebSocket acceptée).

### 1.5 Vérifier bout en bout

| # | Contrôle | Attendu |
|---|---|---|
| 1 | `GET /healthz` | `{"ok":true}` |
| 2 | Console navigateur (Vercel) | aucune erreur CORS, aucune erreur CSP |
| 3 | Inscription puis connexion | compte créé, Elo 1100 |
| 4 | Partie contre l'IA | le plateau joue, le résultat s'affiche |
| 5 | Deux navigateurs, partie en ligne | coups synchronisés, Elo consigné |
| 6 | Envoi d'une photo de profil | visible immédiatement |
| 7 | Rafraîchir pendant une partie | « Reprendre » propose la partie |

---

## 2. Le vrai chantier : passer la base sur Supabase (≈ 5 j)

Aujourd'hui le backend lit **SQLite en synchrone** (`node:sqlite`, 452 appels
`db.prepare()`). Postgres est **asynchrone** : c'est le seul chantier lourd qui
reste, et c'est lui qui empêche la base d'être réellement sur Supabase.

| Lot | Contenu | Critère de réussite |
|---|---|---|
| **L4a** | Convertir `db/stores.js` (98 appels) en asynchrone, sur SQLite | les 7 suites restent vertes |
| **L4b** | Convertir `server.js` (25), `admin/*` (102), `auth.js` (18), `kyc.js` (13) | idem |
| **L4c** | Convertir les appels dans les tests et sondes | idem |
| **L4d** | Ajouter `db/postgres/` derrière la même interface (`D_AONA_DB=postgres`) | conformité verte sur les deux moteurs |
| **L5a** | Importer les données : `node scripts/migrate-sqlite-to-pg.js --apply` | — |
| **L5b** | Vérifier la parité : `node scripts/verify-parity.js` | **0 écart** (porte G6) |
| **L5c** | Basculer `D_AONA_DB=postgres` en production | partie en ligne + classement persistants après redéploiement |

Points de vigilance déjà identifiés :

- Le **pooler** Supabase (port 6543) n'accepte pas les requêtes préparées
  nommées → `pg` en mode simple (`prepare: false`).
- Les `INTEGER 0/1` deviennent des `boolean` : le code doit envoyer `true`/`false`,
  pas `1`/`0` (le mapping est dans `scripts/db-model-map.js`).
- `datetime('now')` devient `now()` : ne jamais insérer de date depuis Node,
  laisser la base horodater.
- Les transactions écrites depuis SQLite restent séquentielles : Postgres permet
  de vraies transactions — utile pour le portefeuille (débit/crédit atomiques).

---

## 3. Fichiers : avatars et pièces KYC sur Supabase Storage (≈ 1,5 j)

Aujourd'hui `apps/api/uploads/` (260 fichiers, 2,9 Mo) et `apps/api/private/`
(KYC) sont sur le disque local — perdus à chaque redéploiement.

1. Créer deux buckets : `avatars` (public en lecture) et `kyc` (**privé**).
2. Ajouter `apps/api/storage/` : une interface `put/get/sign`, deux
   implémentations (disque local en dev, Supabase Storage en prod).
3. Remplacer les écritures dans `server.js` (`/api/user/avatar`) et `kyc.js`.
4. Les chemins stockés (`users.avatar`, `kyc_cases.recto_path`…) deviennent des
   clés d'objet ; la route d'administration signe une URL à la demande.
5. Importer les 260 fichiers existants (script ponctuel, une seule fois).

**Réussi si** : après un redéploiement Render, les photos sont toujours là.

---

## 4. Authentification Supabase (≈ 2,5 j)

Objectif : sortir les mots de passe d'Argon2 maison et les sessions opaques.

1. Écran de connexion → `supabase.auth.signInWithPassword`.
2. Le frontend envoie `Authorization: Bearer <access_token>` ; le WebSocket
   envoie le même jeton dans le message `auth`.
3. Le backend vérifie la signature via le **JWKS** public
   (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`) — aucun secret à
   stocker, aucune rotation manuelle.
4. **Pont de migration transparent** : au premier login d'un compte existant,
   Argon2 valide le mot de passe, on crée le compte Supabase, on lie
   `users.auth_uid`, puis on laisse Supabase délivrer la session. Aucun joueur
   n'a à réinitialiser son mot de passe.
5. Ajouter `users.auth_uid uuid unique` (migration) et conserver `users.id` en
   `bigint` : **toutes** les clés étrangères existantes restent valides.

> **Décision produit requise** : Supabase Auth exige un e-mail. Les 23 comptes
> actuels en ont-ils tous un ? Sinon, prévoir un e-mail de migration
> (`<id>@migre.d-aona.mg`) et une relance pour le mettre à jour.

---

## 5. Frontend : découpage + Vite (≈ 4 j)

`apps/web/index.html` fait **16 284 lignes / 973 Ko**. Le découpage est
mécanique mais volumineux, d'où sa place **après** la mise en ligne.

1. Extraire par blocs : `src/styles/`, `src/core/`, `src/net/`, `src/state/`,
   `src/ui/`, `src/screens/`.
2. `vite.config.js` avec `base: "/"`, sortie `dist/`.
3. Vercel : `framework: vite`, `buildCommand: npm run build`, `outputDirectory: dist`.
4. **Porte de sortie** : diff pixel nul sur les 6 écrans × 3 gabarits × 2 thèmes,
   comparé aux captures de référence.

Bénéfices attendus : ~-60 % de poids transféré, cache par module, plus de
« reload complet » à chaque correction.

---

## 6. Dettes de données découvertes (à traiter avant l'ouverture publique)

| # | Constat mesuré | Impact | Action |
|---|---|---|---|
| 1 | **66 transactions orphelines** (246 000 Ar) pointent vers des comptes supprimés | le grand livre ne s'équilibre pas ; la contrainte `transactions.user_id → users.id` ne peut pas être activée | purger ou reclasser en « compte système », puis activer la contrainte |
| 2 | **8 tournois sur 8** ont `game="Fanorona"` au lieu d'un identifiant de plateau (`fanoron-tsivy`) | impossible de rattacher un tournoi à un plateau par jointure | migration de données : normaliser la colonne, puis ajouter la contrainte |
| 3 | `users.withdrawn_today` n'est entretenue par personne | champ toujours à 0 | supprimer la colonne (le calcul se fait déjà sur l'historique) |
| 4 | `users.password_hash` **et** `auth_credentials.password_hash` coexistent | deux vérités pour un même secret | supprimer `users.password_hash` après le lot L7 |
| 5 | `users.region` (ancienne) coexiste avec `users.province` | colonne morte | supprimer après vérification |

---

## 7. Ce que je ferais ensuite, dans l'ordre

1. **L4 — portage asynchrone** (5 j) : le seul vrai verrou vers une base Supabase.
2. **L6 — Storage** (1,5 j) : ne plus perdre les photos.
3. **L7 — Auth Supabase** (2,5 j) : supprimer le mot de passe maison.
4. **L3 — découpage du backend** (2 j) : `server.js` de 2 055 à < 150 lignes.
5. **L5 + L8** — bascule base et frontend Vite (5 j).
6. **§6** — nettoyages de données (0,5 j).

Total restant : **≈ 17 jours-homme**. Les étapes 1 à 5 ci-dessus étant
indépendantes, l'ordre peut changer ; L4 doit précéder L5c.
