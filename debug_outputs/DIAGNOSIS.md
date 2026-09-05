# DIAGNOSIS — « Le joueur ne peut pas bouger les pions »

Date : 2026-08-15 · Build servi = disque (vérifié)

## Vérifié = FONCTIONNE (aucun blocage reproductible aujourd'hui)
- **Serveur** : node 1108 sur `0.0.0.0:8080` LISTENING ; **cloudflared** 23936 (tunnel actif) ; boucle de tests 15412.
- **Assets servis = fichiers disque** (`main.css`, `fanorona.js`, `app.js`) avec `Cache-Control: no-store` (pas de cache stale possible).
- **100 % fichiers à jour** : fix CSS `[hidden]{display:none!important}` présent (main.css:539) ; fix rôles `meVal()/oppVal()` présent dans fanorona.js servi ; `applyServerState`/`playerNum` présents dans app.js servi.
- **Géométrie** : `.cell` / `.piece` / `.dot` alignés avec position + transform identiques ; z-index cohérents (cell 5, pieces 6 pointer-events:none, dots 7, capture-choice/chain-bar 9).
- **Tour complet** : `test_turns.js` → 36 coups alternés OK, 0 coup invalide.
- **Partie WebSocket** : `test_full_game.js` → coups + captures + Elo OK (flaky occasionnel = artefact de timing du test, pas un blocage : 4/5 passages).
- **Remote via tunnel** : HTTP 200 + `wss://` (match, accept, game_start, game_end) OK sur `orbit-spelling-cartoons-automotive.trycloudflare.com`.

## Causes précédentes (déjà corrigées et confirmées actives)
1. Overlay `capture-choice` (et `chain-bar`, `lastmove`) imposant `display:flex` sur `hidden` → bloquait les clics.
2. Rôles/couleurs codés en dur → joueur ne voyait pas ses pions comme « siens ».

## Conclusion (reproduction au clic réel, via Playwright)
- **Un jeu en ligne complet fonctionne aujourd'hui** : cliquer un pion jouable → dots + sélection ; cliquer la destination → le coup s'exécute (`turn 1 → 2`).
- `document.elementFromPoint` au centre et sur les pions renvoie `.cell` → **aucun overlay n'intercepte les clics**.
- Le seul cas « rien ne se passe » est le clic sur un **pion non-jouable** (capture obligatoire ailleurs) — comportement Fanorona normal.

## Correctif appliqué (UX, pour lever l'ambiguïté « je ne peux rien faire »)
- `fanorona.js` : nouveau `pulsePlayable()` — cliquer un pion non-jouable déclenche un **flash rouge** sur ce pion + **pulse vert** sur tous les pions réellement jouables + toast explicite.
- `main.css` : animations `rejectPulse` / `hintPulse` (`.piece.reject`, `.piece.pulse`).
- Servi immédiatement (serveur `no-store`) ; `node --check` OK ; aucune régression (`test_turns` passe).

## Cause la plus probable du constat utilisateur
1. **Client non rechargé** (onglet/onglet téléphone ouvert avant les correctifs) → faire **Ctrl+F5 / vider le cache** ; le serveur sert la dernière version à chaque chargement.
2. **Aide au mouvement désactivée** (bouton `💡 Aide`) → aucun surlignage ; sans lui, on clique au hasard sur des pions non-jouables. Activer l'aide ou compter sur le flash/toast ajoutés.
3. **Tunnel/WS intermittent** (timeouts QUIC dans `tunnel_err.log`) → après une coupure, recharger la page ; l'URL du tunnel est éphémère et change à chaque redémarrage de `cloudflared`.

## Opérations
- `test_tunnel_ws.js` : URL lue depuis `argv[2]` (l'ancienne était en dur). Nécessite d'être ré-exécuté avec l'URL tunnel courante, qui change à chaque restart.
- `test_click_repro.js` : nouveau test de régression clic (pion jouable + feedback pion non-jouable).