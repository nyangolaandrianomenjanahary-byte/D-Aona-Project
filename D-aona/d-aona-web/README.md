# D-aôna — Application web (PRD v1.2 · 2026)

Frontend **mono-fichier** de D-aôna, la plateforme compétitive de jeux
traditionnels malgaches (Fanorona, Katro…). HTML/CSS/JS vanilla embarqué dans
`index.html` — aucune dépendance, aucun build.

## Lancer l'application

Le frontend est servi par le backend (`d-aona-server/server.js`) :

```bash
cd d-aona-server && node server.js
# → http://localhost:8080  (ou http://<ip-locale>:8080 pour les autres appareils)
```

Le client communique avec le serveur via l'API REST (`/api/*`) et le WebSocket
(`/ws`) : auth, matchmaking, parties temps réel, amis, chat, wallet, tournois.

## Ce que couvre la maquette (cartographie PRD)

| Écran / flux | PRD |
|---|---|
| Auth (téléphone/email/Google, note OTP & compte unique) | §2.2, §7.1 |
| Accueil : wallet, tournoi à la une + countdown, jeux, top 5, activité | §7.1 |
| Jeux : Fanorona MVP (+ Katro « arrive bientôt »), modes Classé / Défi / Entraînement IA | §2.3, §2.5 |
| Formats Blitz 10 min · Rapide 60 min · Pro 2 h (Pro bloqué en matchmaking) | §2.4 |
| **Plateau Fanorona 9×5 jouable** : captures par approche/retrait, capture obligatoire, prises en chaîne, IA comportementale (plafond de difficulté), pendules, journal des coups, abandon = forfait | §2.5, §19 (anti-triche), Glossaire |
| Matchmaking simulé ±200 Elo, élargissement progressif, 60 s max | §2.5 Mode 1 |
| Défi entre amis : mise optionnelle, lien partageable (WhatsApp/Messenger/SMS), expiration 15 min, commission 10% | §2.5 Mode 3, §8.1 |
| Entraînement IA : accessible sans KYC, aucun impact Elo/wallet | §2.5 Mode 4, §4.4 |
| Lien spectateur & lien d'invitation (parrainage +1 000 Ar) | §2.6, §16.3 |
| Système Elo (K=32), 7 rangs Bronze → Grand Maître, règles de saison | §3 |
| Classement national / régional / par jeu / saisonnier | §9 |
| Tournois : mise remboursable top 3, répartition 50/25/0 + commission 25%, bracket auto, **simulation complète** avec distribution et contrôle d'équilibre du pool | §2.5 Mode 2, §4.3 |
| Wallet : dépôt/retrait MVola · Orange Money · Airtel Money (~2% opérateur), 0% commission interne, retrait min 1 000 / max 500 000 Ar/j, bonus de bienvenue 1 000 Ar non retirable, historique horodaté | §4 |
| KYC par photo CIN obligatoire avant toute transaction réelle (flux simulé) | §4.4 |
| Skins achetables (pions, plateau, trace lumineuse, animation de victoire) | §2.7, §8.1 |
| Chat textuel restreint aux contacts connus | §12 |
| Back-office admin (KPIs, file KYC, tickets service client, suivi dev) | §10, §11, §13 |
| Toasts sonores visuels : grain discret, animations, responsive mobile | §6.3 Design System |

## Arborescence

```
d-aona-web/
├── index.html               Application complète (SPA : design system, moteur
│                            Fanorona, client API/WebSocket, toutes les vues)
└── assets/board/            Image du plateau de Fanorona
```

Le design system est embarqué dans `index.html` : **thème Jour (défaut) et
thème Nuit OLED**, tokens motion/relief, écran « Bon retour » adaptatif
desktop/mobile, barre d'onglets lumineuse.

## Limites

- Les paiements (MVola, Orange Money…) restent des simulations à but démonstratif.
- Le back-office admin affiche des données de démo.
