# Runbook de déploiement — D-aôna

> Procédure d'exploitation : déployer, vérifier, revenir en arrière.
> Pour la liste de ce qui reste à construire, voir [NEXT-STEPS.md](NEXT-STEPS.md).

---

## 1. Topologie

    ┌──────────────┐   REST + WebSocket    ┌──────────────┐   pg    ┌────────────┐
    │   Vercel     │ ────────────────────▶ │ Render /     │ ──────▶ │  Supabase  │
    │  apps/web    │ ◀──────────────────── │ Railway      │ ◀────── │  Postgres  │
    │  (statique)  │                       │  apps/api    │         │  + Storage │
    └──────────────┘                       └──────────────┘         └────────────┘

### 1.1 Deux modes cohabitent dans ce dépôt

| | **Mode A — recommandé** | **Mode B — tout-Vercel (déjà présent)** |
|---|---|---|
| Frontend | Vercel, *Root Directory* `apps/web` | Vercel, racine du dépôt (`npm run vercel-build` → `public/`) |
| Backend | Render/Railway, `apps/api/server.js` (processus Node) | `api/index.js` (fonctions serverless) |
| Temps réel | WebSocket `ws` natif | Supabase Realtime Broadcast + repli par interrogation |
| Fichiers | disque, puis Supabase Storage | `user_avatars` et `kyc_cases.*_data` (base64 en base) |
| Schéma de base | `supabase/migrations/` (`supabase db push`) | `supabase/schema.sql` (exécuté au démarrage) |
| Limite de durée | aucune | 30 s par fonction (`maxDuration`) |
| Avantage | vrais WebSockets, aucune latence ajoutée | un seul hébergeur |

Le frontend **détecte le mode tout seul** : il interroge `/api/config` et bascule
sur `serverless: true` ou sur le WebSocket classique. Aucune configuration côté
navigateur.

> Le mode B est conservé parce qu'il fonctionne déjà. Le mode A est recommandé
> parce qu'il n'impose pas de transformer une partie en direct en succession
> d'appels HTTP. Les deux partagent le même frontend et la même base ; seul
> l'hébergement du backend change.

**Variables du mode B** (à saisir dans Vercel) : `DATABASE_URL` (ou
`POSTGRES_URL` / `SUPABASE_DB_URL`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`
(publique), `SUPABASE_SERVICE_ROLE_KEY` (**secrète**).

**Pourquoi le backend du mode A n'est pas sur Vercel** : Vercel est *serverless*. Il n'y a
ni WebSocket persistant, ni état en mémoire (parties, horloges, matchmaking),
ni timer long. Le backend doit rester un processus vivant.

---

## 2. Matrice des variables

### apps/web (Vercel — *Settings → Environment Variables*)

| Variable | Production | Local | Rôle |
|---|---|---|---|
| `D_AONA_PUBLIC_API_URL` | `https://d-aona-api.onrender.com` | *(vide)* | adresse de l'API, sans `/` final |
| `D_AONA_PUBLIC_WS_URL` | `wss://d-aona-api.onrender.com` | *(vide)* | déduite de l'API si absente |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | — | lot L7 |
| `VITE_SUPABASE_ANON_KEY` | clé `anon` | — | lot L7 — **publique par conception** |

> Aucune de ces valeurs n'est un secret. Ce qui est secret ne doit **jamais**
> avoir le préfixe `VITE_` ni `PUBLIC` : tout ce qui porte ces préfixes finit
> dans le paquet téléchargé par le navigateur.

### apps/api (Render/Railway)

| Variable | Obligatoire | Valeur type |
|---|---|---|
| `NODE_VERSION` | oui | `24` (`node:sqlite` exige ≥ 22.5) |
| `NODE_ENV` | oui | `production` |
| `D_AONA_TRUST_PROXY` | **oui sur un hébergeur** | `1` |
| `D_AONA_ALLOWED_ORIGINS` | **oui** dès que le frontend est ailleurs | `https://d-aona.vercel.app` |
| `D_AONA_PUBLIC_API_URL` | recommandé | `https://d-aona-api.onrender.com` |
| `D_AONA_DB_PATH` | si base SQLite | `/var/data/d-aona.db` |
| `DATABASE_URL` | lot L5 | chaîne pooler (port 6543) |
| `D_AONA_DB` | lot L5 | `postgres` |
| `SUPABASE_SERVICE_ROLE_KEY` | lot L6/L7 | **secrète** |

---

## 3. Déployer

### 3.1 Première mise en service

```bash
# 1. Schéma de base (une seule fois)
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push

# 2. Backend : Render → New → Blueprint (render.yaml détecté)
#    + Add Disk  mount=/var/data  + D_AONA_DB_PATH=/var/data/d-aona.db

# 3. Frontend : Vercel → Root Directory = apps/web
#    + D_AONA_PUBLIC_API_URL

# 4. Après le premier déploiement Vercel : déclarer son URL côté backend
#    D_AONA_ALLOWED_ORIGINS=https://<projet>.vercel.app  → redeploy
```

### 3.2 Mises à jour courantes

| Ce qui change | Où | Commande |
|---|---|---|
| Code frontend | `apps/web/` | `git push` → Vercel reconstruit |
| Code backend | `apps/api/` | `git push` → Render reconstruit |
| Schéma de base | `supabase/migrations/` | `npx supabase db push` |
| Modèle de données | `scripts/db-model-map.js` | `node scripts/gen-db-model.js` puis commit |

> **Ordre à respecter** quand une modification touche les deux côtés : la base
> d'abord (migration additive), puis le backend, puis le frontend. Un frontend
> neuf contre un backend ancien casse ; l'inverse est toléré.

---

## 4. Vérifier (après chaque déploiement)

| # | Contrôle | Commande / action | Attendu |
|---|---|---|---|
| 1 | Sonde | `curl https://<api>/healthz` | `{"ok":true,"up":…}` |
| 2 | En-têtes | `curl -I https://<vercel>/` | CSP présente, `X-Content-Type-Options: nosniff` |
| 3 | CORS | console navigateur | aucune erreur CORS |
| 4 | WebSocket | badge de connexion | connecté (pas de fermeture 1008) |
| 5 | Inscription | formulaire | compte créé, Elo 1100 |
| 6 | Partie IA | jouer 3 coups | plateau synchronisé |
| 7 | Partie en ligne | 2 navigateurs | coups et Elo consignés |
| 8 | Reprise | F5 en pleine partie | « Reprendre » propose la partie |
| 9 | Parité base | `node scripts/verify-parity.js` (lot L5) | 0 écart |
| 10 | Cohérence des deux schémas | `node scripts/verify-db-schema.js` | schémas cohérents |

---

## 5. Pannes connues et diagnostic

| Symptôme | Cause probable | Correctif |
|---|---|---|
| Le site charge, mais **toutes** les requêtes échouent | `config.js` vide en production | renseigner `D_AONA_PUBLIC_API_URL` sur Vercel, redéployer |
| Le HTTP fonctionne, **le jeu en ligne non** (fermeture **1008**) | origine Vercel absente de `D_AONA_ALLOWED_ORIGINS` | ajouter l'origine exacte (`https://…`, sans `/`), redéployer |
| CSP bloque `fetch`/`ws` | même cause que ci-dessus (la CSP est construite à partir de la liste) | idem |
| `429 Trop de tentatives` pour **tout le monde** | `D_AONA_TRUST_PROXY` absent : tous les joueurs ont l'IP du proxy | mettre `1`, redéployer |
| `Cannot find module 'node:sqlite'` | Node < 22.5 | `NODE_VERSION=24` |
| Données perdues après redéploiement | base SQLite sur disque éphémère | disque persistant + `D_AONA_DB_PATH`, ou lot L5 |
| Photos perdues après redéploiement | `uploads/` sur disque éphémère | lot L6 (Storage) |
| Première visite très lente (~50 s) | plan Render *free* endormi | plan Starter |
| WebSocket coupée au bout de quelques minutes | plan free / proxy inactif | plan Starter ; le client se reconnecte seul (chien de garde 15 s) |
| Supabase répond `prepared statement already exists` | requêtes préparées nommées avec le pooler | `prepare: false` |
| Supabase injoignable après une semaine | projet *free* mis en pause | réveiller dans le tableau de bord, ou plan Pro |

---

## 6. Retour arrière

| Situation | Procédure |
|---|---|
| Le frontend est cassé | Vercel → *Deployments* → déploiement précédent → **Promote to Production** (instantané) |
| Le backend est cassé | Render → *Events* → **Rollback** sur le déploiement précédent |
| Une migration est en cause | les migrations sont **additives** : ne jamais supprimer une colonne dans la même livraison que le code qui la lit. Sinon, restaurer une sauvegarde Supabase (*Database → Backups*) |
| Tout est cassé | remettre `D_AONA_DB=sqlite` + le disque persistant, redéployer : le service repart sur la base fichier |

---

## 7. Sauvegardes

| Donnée | Où | Fréquence |
|---|---|---|
| Base | Supabase — *Database → Backups* (quotidien sur plan Pro) | automatique |
| Base (manuelle) | `node apps/api/backup_db.js` (SQLite, manifeste SHA-256) | avant chaque import |
| Fichiers | buckets Storage | inclus dans le plan Supabase |
| Dépôt | GitHub | continu |

> Une sauvegarde non **restaurée au moins une fois** n'est pas une sauvegarde.
> Tester la restauration sur un projet Supabase jetable avant l'ouverture.

---

## 8. Ce qu'il ne faut jamais faire

- Committer un `.env`, une clé `service_role` ou un `.db` — le `.gitignore` les
  exclut, ne pas le contourner.
- Exposer `SUPABASE_SERVICE_ROLE_KEY` au frontend : elle contourne toute la RLS.
- Servir `apps/api/private/` (pièces d'identité) par le serveur statique.
- Changer `D_AONA_ALLOWED_ORIGINS` en `*` : le contrôle d'origine deviendrait
  décoratif.
- Lancer `npm test` contre la base réelle : les suites créent des comptes. Elles
  travaillent sur une copie jetable (`snapshotDb()`), ne pas retirer ce garde-fou.
