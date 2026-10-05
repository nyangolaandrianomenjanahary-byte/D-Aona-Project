# 🎮 D-aôna — Guide Lien Remote (jouer avec d'autres personnes)

Ce PC est l'**hôte** : il héberge le serveur de jeu (HTTP + WebSocket + base SQLite).

---

## 🚀 Démarrage rapide

Double-cliquez sur :

```
d-aona-server\LIEN_REMOTE.bat
```

Ce script fait tout automatiquement :
1. ✅ Configure le pare-feu (port 8080)
2. ✅ Démarre le serveur de jeu
3. ✅ Ouvre un tunnel public Internet (Cloudflare)
4. ✅ Affiche tous les liens à partager

---

## 🔗 Les 3 liens à partager

### 1️⃣ Même réseau WiFi que le PC
```
http://10.11.15.125:8080
```
Pour les personnes connectées au **même WiFi** que cet ordinateur.

### 2️⃣ Hotspot WiFi hébergé par ce PC (recommandé, sans Internet)
Le hotspot est **déjà actif** :

| | |
|---|---|
| **Nom du réseau (SSID)** | `D-aona-Game` |
| **Mot de passe** | `fanorona2026` |

Les amis se connectent au WiFi **D-aona-Game**, puis ouvrent :
```
http://192.168.137.1:8080
```

> Pour réactiver le hotspot plus tard : `d-aona-server\HOTSPOT.bat`
> (ou Paramètres → Réseau et Internet → Point d'accès mobile → Activer)

### 3️⃣ Internet (depuis n'importe où dans le monde)
```
https://omissions-screenshots-imagination-milan.trycloudflare.com
```
Fonctionne même si vos amis ne sont **pas** sur votre réseau.
⚠️ Cette URL change à chaque redémarrage du tunnel — `LIEN_REMOTE.bat` affiche la nouvelle.

> ⚙️ **Important quand le serveur est exposé par ce tunnel** — démarrez-le avec le
> drapeau proxy :
> ```
> set D_AONA_TRUST_PROXY=1 && node server.js
> ```
> Sans ce drapeau, toutes les connexions arrivant par le tunnel présentent la même
> adresse au serveur (`127.0.0.1`) : elles partagent donc **un seul quota
> d'authentification** (12 tentatives / 5 min par défaut) — au-delà, tout le monde
> reçoit « Trop de tentatives depuis ce réseau ». Avec le drapeau, chaque joueur est
> compté séparément (IP réelle lue dans l'en-tête Cloudflare `CF-Connecting-IP`).
> ⚠️ À ne pas activer pour un usage **réseau local seul** : un client pourrait y
> annoncer une fausse IP et contourner la limitation (cf. `.env.example`).

---

## 📱 Bluetooth (alternative au WiFi)

Le Bluetooth PAN est possible mais le **hotspot WiFi est bien plus simple** :

1. Sur le PC : Paramètres → Bluetooth et appareils → jumeler le téléphone
2. Sur le téléphone : activer le « partage de connexion par Bluetooth » **ou** rejoindre le PAN du PC
3. Le PC obtient une IP PAN (souvent `192.168.44.x`) — le serveur écoute dessus aussi (0.0.0.0)

> ℹ️ Le serveur écoute sur **toutes les interfaces** (`0.0.0.0`), donc n'importe quel réseau local (WiFi, hotspot, Bluetooth PAN, Ethernet) fonctionne dès lors que le port 8080 est ouvert (déjà fait).

---

## 🗄️ Base de données du jeu

Fichier : `d-aona-server\d-aona.db` (SQLite, embarquée — rien à installer)

| Table | Rôle | État |
|---|---|---|
| `users` | comptes, Elo, soldes | ✅ |
| `games` | historique des parties + coups | ✅ |
| `tournaments` | tournois (4 seedés) | ✅ |
| `tournament_registrations` | inscriptions | ✅ |
| `transactions` | dépôts/retraits/bonus | ✅ |
| `chat_messages` | messagerie | ✅ |
| `user_skins` / `equipped_skins` | boutique de skins | ✅ |
| `challenges` | défis entre joueurs | ✅ |
| `game_sessions` | sessions temps réel | ✅ |

Vérifier la base à tout moment :
```
node d-aona-server\check_db.js
```

---

## 🔍 Vérification rapide

| Action | Commande |
|---|---|
| Vérifier l'état de la base | `node d-aona-server\check_db.js` |
| Diagnostic réseau | `node d-aona-server\diag.js` |

---

## 🛑 Tout arrêter

Dans la fenêtre `LIEN_REMOTE.bat` : appuyez sur une touche.
Ou : fermez les fenêtres « D-aona Server » / « D-aona Tunnel ».

---

## ❓ Dépannage

| Problème | Solution |
|---|---|
| Les amis ne voient pas la page (même WiFi) | Vérifiez que `LIEN_REMOTE.bat` est lancé ; refaites `CONFIGURER.bat` en admin |
| Le hotspot n'apparaît pas | Lancez `HOTSPOT.bat` en admin, ou activez-le dans Paramètres |
| L'URL Internet ne marche plus | L'URL trycloudflare change à chaque démarrage → relancez `LIEN_REMOTE.bat` et partagez la nouvelle |
| « Port déjà utilisé » | `taskkill /F /IM node.exe` puis relancez |
