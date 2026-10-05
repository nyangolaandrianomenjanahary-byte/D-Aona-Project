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
- L'invoquer pour une revue d'écran AVANT de figer une maquette : lui donner la capture (`%TEMP%\daona_shots\*.png`) ou les fichiers concernés (`D-aona/d-aona-web/index.html`).
- Ses recommandations restent des PROPOSITIONS : les confronter aux règles du projet (jetons de couleur existants, contrastes AA déjà mesurés, thèmes jour/nuit, mono-fichier `index.html`), puis consigner ce qui est retenu dans `CONTEXTE_PROJET.md`.
- Installation locale volontairement HORS Git (`.gitignore` : `.claude/`) : aucun impact sur l'application déployée.

