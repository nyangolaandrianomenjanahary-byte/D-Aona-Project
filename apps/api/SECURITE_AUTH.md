# 🔐 D-aôna — Sécurité de l'authentification

> Document de référence de la refonte d'authentification. À lire avant toute
> mise en service avec de l'argent réel.
> Voir aussi : `CONTEXTE_PROJET.md` (contexte général), `.env.example`
> (variables d'environnement), `migrations/` (schéma versionné).

---

## 1. Le défaut corrigé

### Avant

```js
// POST /api/auth — pseudo SEUL, aucun secret
const u = User.createOrUpdate(pseudo);   // crée OU OUVRE le compte existant
const token = genToken();
tokens.set(token, u.id);                 // session en mémoire vive
```

| Faille | Portée |
|---|---|
| **Aucune authentification** | Connaître un pseudo suffisait à prendre la main sur le compte : solde, chat privé, défis, skins. La colonne `users.password_hash` existait mais n'était **jamais** lue ni écrite (0 valeur sur 96 comptes). |
| **Sessions non révocables** | Les jetons vivaient dans une `Map` en mémoire : perdus au redémarrage, jamais expirants, impossibles à révoquer. |
| **Aucune limite de débit** | Rien ne freinait les tentatives répétées. |
| **Promesse non tenue** | L'interface affichait déjà un champ mot de passe et une jauge de robustesse… que le backend ignorait totalement. |

### Après

| Mécanisme | Mise en œuvre |
|---|---|
| **Mot de passe** | **Argon2id** (`@node-rs/argon2`), paramètres OWASP : `m=19456 KiB, t=2, p=1`. Empreinte au format PHC en base : `$argon2id$v=19$m=19456,t=2,p=1$…` |
| **Politique** | Identique à celle déjà imposée par l'interface : 12 caractères, minuscule + majuscule, chiffre, caractère spécial. Impossible à contourner en appelant l'API directement. |
| **Sessions** | Jeton **opaque** de 32 octets (`base64url`). Seule son empreinte **SHA-256** est stockée (`sessions.token_hash`) : une fuite de la base ne permet pas de rejouer une session. Expiration 30 jours, révocation individuelle. |
| **Déconnexion** | Révoque la session **côté serveur** (`POST /api/auth/logout`). L'ancien code se contentait d'effacer le jeton local : la session restait valide en base, donc rejouable. |
| **Verrouillage** | 5 échecs → 1 min ; puis doublement à chaque échec, plafonné à 60 min. Remis à zéro par une connexion réussie. |
| **Limitation de débit** | 12 tentatives par IP et par fenêtre de 5 min (réglable, voir `.env.example`). |
| **Anti-énumération** | Pseudo inconnu, compte sans mot de passe et mauvais mot de passe renvoient **le même message et le même code**. Un pseudo inconnu déclenche une vérification Argon2 factice : le temps de réponse reste comparable, donc pas de fuite par chronométrage. |
| **Journal d'audit** | Table `auth_audit_log` en **ajout seul**, verrouillée par des déclencheurs SQL : toute `UPDATE`/`DELETE` est refusée par la base, y compris depuis l'application. |
| **WebSocket** | Le handshake d'authentification valide la session **en base** (expiration et révocation prises en compte). |

### Routes

| Route | Rôle | Limitation de débit |
|---|---|---|
| `POST /api/auth/login` | Connexion (compte existant) | Oui |
| `POST /api/auth` | Alias historique de `login` — **exige un mot de passe** | Oui |
| `POST /api/auth/register` | Création de compte | Oui |
| `GET /api/auth/available` | Le pseudo est-il libre ? (réponse : `valid` / `available`) | Oui |
| `POST /api/auth/logout` | Révoquer la session courante | — |
| `POST /api/auth/password` | Changer de mot de passe (session requise) | Oui |
---

## 2. Décisions prises sans confirmation préalable

Ces points n'étaient pas tranchés dans la demande. Ils sont déclarés ici
conformément à la règle « toute décision non confirmée doit être signalée ».

1. **Reste sur SQLite (`node:sqlite`), pas de migration PostgreSQL.**
   Le stack annoncé était PostgreSQL, mais le projet tourne réellement sur
   SQLite embarquée et son architecture repose sur « ce PC fait office de
   serveur, sans internet nécessaire » (`DEMARRER.bat`). Migrer aurait imposé
   un serveur de base à côté de l'application et cassé le mode hôte.
   Le choix du moteur reste ouvert : il conditionne tout le schéma.

2. ~~**Fenêtre de réclamation des comptes hérités.**~~ **RETIRÉE.**
   Elle existait pour les 96 comptes sans mot de passe créés avant la refonte
   (`POST /api/auth/claim`, activée par défaut). Elle constituait le dernier
   point faible connu : le premier arrivé pouvait réclamer un compte hérité en
   connaissant seulement son pseudo.
   La base ayant été **vidée** (et le seed ne la repeuplant plus, voir
   `D_AONA_SEED`), plus aucun compte hérité n'existe : le parcours, sa route et
   sa variable d'environnement ont été supprimés. Si des comptes hérités
   devaient réapparaître (restauration d'une ancienne sauvegarde), il faudrait
   les migrer — pas rouvrir une route de réclamation.

3. **`D_AONA_TRUST_PROXY` désactivé par défaut.**
   Derrière le tunnel Cloudflare, l'IP réelle n'est pas celle du socket. Mais
   faire confiance aveuglément à `X-Forwarded-For` permettrait à un client
   d'annoncer une fausse IP et de contourner la limitation de débit. Le choix
   est donc explicite et documenté.

4. **Changement de mot de passe = révocation de toutes les sessions.**
   Y compris la session courante : l'utilisateur doit se reconnecter. C'est le
   comportement le plus sûr après un soupçon de compromission.

5. **Plafond de lecture du corps de requête à 64 Ko** (4 Mo pour l'upload
   d'avatar). Corrige un déni de service mémoire trivial : l'ancien code
   concaténait un flux non borné dans une chaîne.
---

## 3. Risques résiduels (non traités à ce stade)

Aucun n'est un secret : ce sont des chantiers identifiés et classés.

| # | Risque | Détail |
|---|---|---|
| 1 | **Aucun TLS interne** | `http.createServer`. Sur un hotspot/WiFi local, le jeton circule en clair. En accès distant, Cloudflare termine le TLS — mais le dernier segment reste en clair. |
| 2 | **CORS ouvert (`*`)** | N'importe quelle origine peut appeler l'API si elle détient un jeton. À restreindre à l'origine de l'application. |
| 3 | **KYC auto-validable** | `POST /api/kyc/verify` pose simplement `kyc = 1`, sans pièce ni contrôle humain, et débloque mises et retraits. |
| 4 | **Bonus de bienvenue répétable** | 5 000 Ar accordés à **chaque** dépôt tant que `kyc` est faux. |
| 5 | **Aucune contrainte de solde** | Un solde négatif existe en base (−4 000 Ar). `Wallet.spend()` ne vérifie rien. |
| 6 | **Bug comptable du bonus** | `spend()` réduit `bonus_lock` et `balance` du même montant : le « disponible » (`balance − bonus_lock`) ne diminue pas quand on consomme le bonus. |
| 7 | **Pas de ledger** | `transactions` n'a ni solde avant/après, ni statut de réconciliation : le solde n'est pas reconstituable de façon fiable depuis l'historique. |
| 8 | **Solde dans `users`** | Empêche une séparation stricte des privilèges et des politiques RLS. |
| 9 | **Paiements simulés** | Aucun prestataire mobile money branché : `/api/deposit` crédite sans appel externe. |
| 10 | **Pas de rôles** | Aucune notion d'administrateur/modérateur en base ; pas de back-office. |
| 11 | **Mot de passe oublié** | Aucun canal de récupération (ni email ni SMS vérifié) : l'exploitant passe par `reset_password.js`. |
| 12 | **Photos personnelles dans l'historique Git** | 12 avatars étaient versionnés. Ils sont désormais **retirés du suivi** (`git rm --cached`, fichiers conservés sur disque) et `uploads/` est ignoré. Ils restent présents dans l'historique : aucun remote n'étant configuré, rien n'a fuité — mais une publication ultérieure les exposerait. |
---

## 4. Opérations

### Sauvegarder (à faire AVANT toute manipulation risquée)

```powershell
cd d-aona-server
node backup_db.js
```

Produit `backups/<horodatage>/` contenant :

- `d-aona.db` — snapshot **cohérent à chaud** (`VACUUM INTO`), donc pris sans
  arrêter le serveur ;
- `uploads/` — les photos de profil ;
- `MANIFEST.txt` — empreintes SHA-256, `PRAGMA integrity_check` de la source
  **et** de la sauvegarde, comparaison du nombre de lignes table par table.

La commande se termine par `✅ SAUVEGARDE VÉRIFIÉE ET CONFORME` ou signale un
écart. **Une sauvegarde jamais restaurée n'est pas une sauvegarde fiable** : le
manifeste existe précisément pour lever ce doute.

### Restaurer

```powershell
# 1. Arrêter le serveur (le fichier ne doit pas être ouvert)
# 2. Mettre l'actuel de côté — JAMAIS le supprimer directement
Move-Item d-aona-server\d-aona.db d-aona-server\d-aona.db.avant-restauration
# 3. Copier la sauvegarde voulue
Copy-Item d-aona-server\backups\<horodatage>\d-aona.db d-aona-server\d-aona.db
# 4. Vérifier la cohérence des migrations
node migrate.js --status
```

### Migrations versionnées

Le schéma n'est plus modifié à la main.

```powershell
node migrate.js --status   # état : appliquées / en attente
node migrate.js            # applique ce qui manque
```

- Fichiers `d-aona-server/migrations/NNN_nom.sql`, appliqués dans l'ordre
  numérique, **chacun dans sa transaction** : un échec laisse la base
  inchangée et interrompt le démarrage du serveur plutôt que de le laisser
  tourner sur un schéma incohérent.
- L'empreinte SHA-256 de chaque migration appliquée est conservée :
  **réécrire une migration déjà passée est refusé**, il faut en créer une
  nouvelle.
- État courant : `001_auth_credentials`, `002_sessions`, `003_auth_audit`.

### Outils en ligne de commande

```powershell
node test_auth.js                                         # 34 vérifications, instances jetables (port 8099)
node reset_password.js Tsiry_RN "NouveauMotDePasse!2026"  # réinitialisation (aucun email/SMS disponible)
node migrate.js --status                                  # état des migrations
```

### Remettre à zéro la base en développement

Procédure **volontairement non scriptée** : le reset dépend du schéma cible,
qui reste à décider (§2, point 1). Tant que ce choix n'est pas fait, la règle :

1. `node backup_db.js` → vérifier le manifeste ;
2. arrêter le serveur ;
3. mettre `d-aona.db` de côté (jamais de suppression directe) ;
4. `node migrate.js` → base neuve, schéma créé par les migrations ;
5. relancer le serveur.

Aucune commande destructive (`DROP`, `TRUNCATE`, suppression massive) ne doit
être lancée sans sauvegarde vérifiée **et** confirmation explicite.

---

## 5. Ce qui reste à faire

Dans l'ordre recommandé :

1. ~~**Fermer la fenêtre de réclamation** (`D_AONA_ALLOW_LEGACY_CLAIM=0`) une
   fois les comptes légitimes migrés.~~ **Fait** : parcours et route supprimés.
2. **Rôles et back-office** : introduire `users.role`, porter `ADMIN_DEMO`
   sur de vraies données.
3. **Décider du moteur de base** (SQLite durci ou PostgreSQL) — cela
   conditionne `wallets`, `ledger`, `kyc_records`, `payment_provider_links`,
   `elo_history` et un `audit_log` généralisé.
4. **Wallet et ledger** : sortir le solde de `users`, contraindre les soldes
   (`CHECK` + transaction atomique), ledger append-only avec solde avant/après,
   solde recalculable depuis l'historique.
5. **KYC réel** : pièce stockée hors base (stockage objet chiffré), statut de
   vérification, suppression du drapeau auto-validable.
6. **TLS et CORS restreint** avant toute exposition publique.
7. **Sauvegardes automatiques** planifiées, chiffrées, avec un **test de
   restauration** documenté.