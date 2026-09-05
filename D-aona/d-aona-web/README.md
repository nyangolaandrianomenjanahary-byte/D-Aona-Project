# D-aôna — Maquette web complète (PRD v1.1 · Août 2026)

Maquette interactive de la **version web** de D-aôna, la plateforme compétitive de
jeux traditionnels malgaches (Fanorona, Katro…), strictement alignée sur le
document `D-aona_PRD_v1_1.pdf`.

## Lancer la maquette

Ouvrez simplement **`index.html`** dans un navigateur (double-clic), ou servez le
dossier :

```bash
cd d-aona-web && python3 -m http.server 8080
# → http://localhost:8080
```

Aucune dépendance, aucun build — HTML/CSS/JS vanilla. Cliquez sur
**« Entrer dans l'arène 🎮 »** pour explorer la démo (les données sont simulées
et persistées en `localStorage`).

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
├── index.html               Structure de l'app (SPA, 8 écrans)
├── assets/
│   ├── css/main.css         Design system PRD (#0A0A0F / #0F0F1A / #1D9E75 / #E59E27)
│   ├── js/data.js           Données de démo (rangs, joueurs, tournois, skins…)
│   ├── js/fanorona.js       Moteur Fanorona authentique + IA + rendu plateau
│   ├── js/app.js            Router, wallet, tournois, classement, KYC, chat…
│   └── bg/                  Fond du plateau (assemblé à partir d'assets générés IA)
└── setup/                   Assets sources (8 coins/bords) + script d'assemblage
```

Le cadre du plateau (`assets/bg/fanorona.png` + `@2x`) est assemblé
programmatiquement à partir de 8 assets pixel-art générés (4 coins, 4 bords) :
intérieur exactement `#0F0F1A`, bruit discret, aucun raccord visible.

## Vérifications effectuées

- ✅ Syntaxe JS (`node --check`) sur les 3 fichiers
- ✅ Tests fonctionnels automatisés (jsdom) : auth, navigation, KYC, dépôt,
  inscription tournoi (+ bonus), **partie Fanorona complète jusqu'au résultat**,
  classement, skins, chat, retrait — 35/35
- ✅ Tests de flux avancés : simulation de tournoi + équilibre du modèle de
  cashprice, matchmaking + Elo après abandon, défis avec mise, remboursement —
  18/18
- ✅ Captures d'écran réelles (Chromium headless) desktop 1360px & mobile 390px

## Limites (maquette)

- Aucune donnée réelle / aucun backend (Supabase, MVola… simulés).
- L'« adversaire en ligne » et les autres joueurs sont simulés côté navigateur.
- Les paiements sont des simulations à but démonstratif.
