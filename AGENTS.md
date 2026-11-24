## Skills et agents : ECC + ponytail + graphify (état au 2026-10-24)

**ECC** (« Everything Claude Code », `affaan-m/ECC` v2.2.3, profil `developer`) est
installé **globalement, hors Git**, dans `%USERPROFILE%\.agents` : 153 skills, 122 rules,
71 agents, 97 workflows ; état d'installation dans `ecc-install-state.json`. Dépôt
source : `D:\Project\ECC`. Mode d'emploi complet : règle Cline globale
`%USERPROFILE%\Documents\Cline\Rules\ecc.md`.

- **ponytail** → style de code par défaut : solution minimale qui marche, YAGNI, plus
  petit diff utile.
- **graphify** → interrogation du graphe de connaissances (section ci-dessous).
- **ECC** → méthodes spécialisées (TDD, revue, sécurité, langages, e2e, docs,
  orchestration). Charger un skill ECC **seulement s'il sert la tâche** ; ne pas
  empiler plusieurs skills pour un même besoin.

Conventions d'invocation en Cline :

- `/nom` → si `%USERPROFILE%\.agents\workflows\nom.md` existe, lire ce fichier et
  l'appliquer ; `$ARGUMENTS` = texte fourni par l'utilisateur.
- Délégation → lire `%USERPROFILE%\.agents\agents\<nom>.md` et l'utiliser comme
  `systemPrompt` de `spawn_agent`.
- Rules ECC → chargement à la demande : `common-*.md` d'abord, puis `<langage>-*.md`.

Hooks : seul **`PreToolUse`** est actif — pont `%USERPROFILE%\Documents\Cline\Hooks\PreToolUse.js`,
lu aussi bien par le **CLI** que par l'**extension VS Code** (même dossier, même contrat) :
`--no-verify` / `core.hooksPath` assainis ou bloqués, force-push sur branche partagée
bloqué. MCP actifs (CLI) : `memory`, `filesystem`, `playwright`. Détail : règle `ecc.md`.
Copies projet : `.agents/skills` et `.claude/skills` (ponytail + graphify uniquement).
Les 5 skills `ponytail-*` retirés
le 2026-10-24 restent dans `_removed_skills_20261024/` ; leurs rôles sont couverts par
les skills ECC (`code-review`, `refactor-clean`, `quality-gate`…).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## agent UI/UX (local)

`.claude/agents/ui-ux-designer.md` — **critique UI/UX** : hiérarchie visuelle, contraste, accessibilité, choix typographiques, anti-patterns. Outils en LECTURE SEULE (`Read`, `Grep`, `Glob`, `WebFetch`) : il analyse et argumente, il ne modifie pas le code.
- L'invoquer pour une revue d'écran AVANT de figer une maquette : lui donner la capture (`%TEMP%\daona_shots\*.png`) ou les fichiers concernés (`apps/web/index.html`).
- Ses recommandations restent des PROPOSITIONS : les confronter aux règles du projet (jetons de couleur existants, contrastes AA déjà mesurés, thèmes jour/nuit, mono-fichier `index.html`), puis consigner ce qui est retenu dans `CONTEXTE_PROJET.md`.
- Installation locale volontairement HORS Git (`.gitignore` : `.claude/`) : aucun impact sur l'application déployée.

