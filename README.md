# D-aôna

Plateforme compétitive de jeux traditionnels malgaches en ligne — MVP : **Fanorona**
(plateau 9×5, captures par approche/retrait, déplacement libre, IA).

Le dépôt sépare **trois choses** qui n'ont pas le même rythme de vie :

| Dossier | Rôle | Déployé sur |
|---|---|---|
| `apps/web/` | Frontend (SPA HTML/CSS/JS) | **Vercel** |
| `apps/api/` | Backend : API REST + WebSocket, autorité du jeu | **Render / Railway** |
| `supabase/` | Base de données : schéma Postgres, index, RLS | **Supabase** |

> Le backend n'est **pas** sur Vercel : Vercel est *serverless* et ne peut pas
> héberger un WebSocket persistant avec de l'état en mémoire (parties, horloges,
> matchmaking). Voir [ARCHITECTURE.md](ARCHITECTURE.md).

Deux modes de déploiement coexistent et partagent le même frontend et la même
base — le client choisit tout seul en interrogeant `/api/config` :

| | Mode A (recommandé) | Mode B (tout-Vercel, déjà en place) |
|---|---|---|
| Backend | `apps/api` sur Render/Railway (WebSocket natif) | `api/index.js` (serverless + Supabase Realtime) |
| Base | `supabase/migrations/` | `supabase/schema.sql` |

Voir [RUNBOOK-DEPLOY §1.1](docs/RUNBOOK-DEPLOY.md).

---

## Démarrage local (mode hôte)

Le PC sert le frontend **et** l'API sur le même port — aucun réglage.

```bash
cd apps/api
npm install
node server.js          # http://localhost:8080
```

Base SQLite créée automatiquement dans `apps/api/d-aona.db`. Les migrations
versionnées s'appliquent au démarrage.

Raccourcis Windows : `apps/api/DEMARRER.bat` (mode hôte),
`apps/api/LIEN_REMOTE.bat` (tunnel public), `apps/api/HOTSPOT.bat`.

---

## Tests

```bash
cd apps/api
npm test
```

Sept suites : scénarios complets (340 vérifications), authentification,
matchmaking, variantes, structure, et les moteurs Telo et Dimy. Elles travaillent
sur une **copie jetable** de la base, jamais sur les données réelles.

```bash
cd apps/api && node test_ui_scenarios.js    # campagne navigateur (135 vérifications)
```

---

## Déploiement

| Étape | Où | Guide |
|---|---|---|
| Schéma de base | `npx supabase db push` | [RUNBOOK-DEPLOY](docs/RUNBOOK-DEPLOY.md) §3 |
| Backend | Render → Blueprint (`render.yaml`) | [RUNBOOK-DEPLOY](docs/RUNBOOK-DEPLOY.md) §3 |
| Frontend | Vercel → Root Directory `apps/web` | [RUNBOOK-DEPLOY](docs/RUNBOOK-DEPLOY.md) §3 |
| Ce qui reste à faire | — | [NEXT-STEPS](docs/NEXT-STEPS.md) |

La variable qui relie les deux mondes est `D_AONA_PUBLIC_API_URL` (frontend) ;
sans elle, `config.js` reste vide et le frontend cherche l'API sur son **propre**
domaine — c'est le piège n°1 d'un déploiement séparé.

---

## Documentation

| Document | Contenu |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | couches, frontières, contrats des jeux |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | dictionnaire des 31 tables, types, clés, RLS |
| [docs/API-CONTRACT.md](docs/API-CONTRACT.md) | 43 routes REST + 39 messages WebSocket, générés depuis le code |
| [docs/RUNBOOK-DEPLOY.md](docs/RUNBOOK-DEPLOY.md) | déployer, vérifier, revenir arrière |
| [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) | ce qui reste à construire, dans l'ordre |
| [CONTEXTE_PROJET.md](CONTEXTE_PROJET.md) | journal et contexte du projet |
| [PLAN-REFONTE.md](PLAN-REFONTE.md) | historique du découpage des lots |

---

## Outillage

```bash
node scripts/gen-db-model.js       # régénère supabase/migrations + docs/DATA-MODEL.md
node scripts/gen-api-contract.js   # régénère docs/API-CONTRACT.md
node scripts/gen-web-config.js     # écrit apps/web/config.js depuis l'environnement
node scripts/migrate-sqlite-to-pg.js        # simulation d'import vers Postgres
node scripts/verify-parity.js               # compare SQLite et Postgres (porte G6)
```

Les deux premiers sont **générés depuis la source réelle** (la base SQLite et
`apps/api/server.js`) : la documentation ne peut pas mentir sur ce qui existe.

---

## Règles à ne pas franchir

- Aucun secret dans le dépôt (`.env` est exclu ; `apps/api/.env.example` documente les variables).
- `apps/web/` ne parle qu'à l'API — jamais à Postgres, jamais à un secret.
- `supabase/` ne contient que du SQL — aucune logique métier.
- Les pièces d'identité (KYC) ne sont jamais servies par le serveur statique.
- Un lot n'est terminé que si `npm test` est vert **et** que le périmètre du
  `git diff` correspond à ce qui a été annoncé.
