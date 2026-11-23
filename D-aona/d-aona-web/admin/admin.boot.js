/* =========================================================
   D-aôna — Administration v2 : point d'entrée
   ---------------------------------------------------------
   Seul fichier que l'application hôte connaît. Il assemble les quatre familles
   de vues et délègue tout au noyau. `index.html` n'a donc qu'un `import()`
   paresseux et un appel à `mount()` — c'est ce qui permet de sortir le
   back-office du mono-fichier sans toucher au reste.

   `window.Admin` reste exposé : les tests d'interface et la console s'en
   servent (`Admin.go("roles")`), et c'est la seule surface publique.
   ========================================================= */
import { registerViews, boot, go, reload, S, can } from "./admin.core.js";
import system from "./admin.views.system.js";
import moderation from "./admin.views.moderation.js";
import competition from "./admin.views.competition.js";
import finance from "./admin.views.finance.js";

/* Les feuilles voyagent AVEC le module, pas avec `index.html` : c'est ce qui
   garantit que le back-office reste scopé (`#admin-root`) et que l'accueil ne
   paie pas le prix de ses règles. Un module ES ne peut pas importer du CSS
   nativement : on pose donc les `<link>` une seule fois.

   DEUX feuilles, dans cet ordre :
     1. `admin.css`      — la v2 (classes `a-*`), pour les écrans pas encore portés ;
     2. `admin.demo.css` — la feuille de la MAQUETTE, scopée sous #admin-root,
                           générée par `scripts/extract-demo-css.js`.
   Les jeux de classes ne se croisent pas (`a-panel` contre `panel`) : la
   migration vers la fidélité visuelle peut donc se faire écran par écran, sans
   jamais casser l'application. */
function ensureCss() {
  const sheets = [["admin-css", "./admin.css"], ["admin-demo-css", "./admin.demo.css"]];
  for (const [id, href] of sheets) {
    if (document.getElementById(id)) continue;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = new URL(href, import.meta.url).href;
    document.head.appendChild(link);
  }
}
ensureCss();

/* L'ordre de fusion n'a pas d'importance (les identifiants sont uniques) mais
   l'ordre d'AFFICHAGE vient du serveur : c'est lui qui décide quels modules
   existent et dans quel groupe. Une vue sans module correspondant ne sera
   jamais atteinte — c'est voulu. */
const VIEWS = { ...system, ...moderation, ...competition, ...finance };
registerViews(VIEWS);

export function mount(view) {
  if (view) S.view = view;
  return boot();
}

export { go, reload, can, S };

/* Surface publique minimale. `App.adminShow()` de l'ancienne interface pointe
   ici : les appels existants continuent de fonctionner sans modification. */
window.Admin = { mount, go, reload, can, state: S, views: VIEWS };
