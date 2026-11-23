/* =========================================================
   D-aôna — Administration v2 : vues « système »
   ---------------------------------------------------------
   Vue d'ensemble, rôles & permissions, modules, journal, paramètres.
   Chaque vue est un objet `{ id, label, group, desc, perm, load, render }` :
   `load()` interroge le serveur, `render(data)` renvoie { html, wire }.
   Aucune vue ne calcule une décision d'accès — elle MASQUE, le serveur refuse.
   ========================================================= */
import {
  api, esc, num, money, when, day, can, isSuper, modules, tag, metric, panel,
  table, tabs, toast, dialog, askReason, go, reload, S,
} from "./admin.core.js";
/* Trousse de la MAQUETTE : mêmes classes, mêmes icônes, même balisage. */
import * as U from "./admin.uikit.js";

/* ---------- Vue d'ensemble ----------
   PORTÉE SUR LE BALISAGE DE LA MAQUETTE : `.page-head`, `.metrics/.metric`,
   `.overview-grid` + `.overview-main` + `.overview-rail`, `.queue-list`,
   `.chart`. Seule la SOURCE des données change (API au lieu de localStorage). */
const overview = {
  id: "overview", label: "Vue d'ensemble", group: "Pilotage", perm: "overview.read",
  desc: "L'essentiel de votre communauté, sans détour.",
  async load() {
    const [o, t, a] = await Promise.all([
      api("/api/admin/overview"),
      can("tournaments.read") ? api("/api/admin/tournaments") : Promise.resolve({ tournaments: [] }),
      can("audit.read") ? api("/api/admin/audit?limit=3") : Promise.resolve({ entries: [] }),
    ]);
    return { ...o, list: t.tournaments || [], recent: a.entries || [] };
  },
  render(d) {
    const queue = d.queue.filter((q) => can(q.perm));
    const decisions = queue.reduce((s, q) => s + q.count, 0);
    const maxGames = Math.max(1, ...d.activity.map((x) => x.games));
    const total = d.activity.reduce((s, x) => s + x.games, 0);

    /* Mises en cours : le serveur publie le total engagé (`wager × 2`), la mise
       par camp et la ventilation par jeu. L'écran ne calcule rien — il lit, et
       la somme de la ventilation est égale au total par construction (même
       filtre `status='playing'`). */
    const lw = d.liveWagers || { total: 0, perSide: 0, sessions: 0, byGame: [] };
    /* Décompte du jour : le serveur donne les deux types séparément (UTC+3), et
       le total affiché EST leur somme. Les entraînements et amicaux sont publiés
       à part : ils ne comptent pas dans le total, mais on les nomme. */
    const split = d.gamesTodaySplit || { defi: 0, online: 0, autres: 0 };
    const wagerBreaks = (lw.byGame || []).map((g) =>
      `${g.game ? esc(g.game) : "variante inconnue"} ${money(g.pot)}`).join(" · ");
    const wagerFoot = (lw.sessions > 0)
      ? `<div class="panel-foot"><span class="chart-summary">
           <strong>${money(lw.total)}</strong> engagés · ${money(lw.perSide)} par camp</span>
         <span>${wagerBreaks}</span></div>`
      : `<div class="panel-foot"><span class="chart-summary"><strong>0 Ar</strong>
           engagés — aucune partie en cours</span><span>Défi et matchmaking seulement :
           entraînements et amicaux sont sans mise.</span></div>`;

    const chart = `<div class="chart" aria-label="Nombre de parties par jour">`
      + d.activity.map((x) => `<div class="chart-col" style="--v:${(x.games / maxGames).toFixed(3)}"><i></i><b>${esc(x.day.slice(8))}</b></div>`).join("")
      + `</div>`;

    const queueList = `<div class="queue-list">`
      + queue.map((q) => `<a class="queue-row" href="#/admin" data-goto="${esc(q.id)}">
          ${U.icon(q.id === "kyc" ? "shield" : q.id === "withdrawals" ? "out" : "flag", 19)}
          <div><strong>${esc(q.label)}</strong><small>${q.count ? "à traiter" : "rien en attente"}</small></div>
          <span class="queue-count">${num(q.count)}</span>${U.icon("chevron", 14)}</a>`).join("")
      + `</div>`;

    const next = (d.list || []).filter((t) => t.status === "inscriptions")
      .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))[0];
    const nextBlock = next
      ? `<div class="next-tournament">${U.fanorona()}<h3>${esc(next.name)}</h3>
          <div class="meta">${U.icon("calendar", 14)}${esc(U.fmtDate(next.startsAt, true))}</div>
          <div class="capacity-line"><span>${num(next.registered)} inscrits</span><span>${num(next.maxPlayers)} places</span></div></div>`
      : U.notice("info", "Aucun tournoi ouvert aux inscriptions.");

    const recent = (d.recent || []).map((e) => `<div class="activity-row">
        <div><strong class="small">${esc(e.action)}</strong><small class="muted">${esc(e.actor_pseudo || "système")}</small></div>
        <span class="small muted">${esc(U.fmtShort(e.at))}</span></div>`).join("");
    const recentBlock = `<div class="activity-list">${recent}
        <a class="text-link" href="#/admin" data-goto="audit">Tout le journal ${U.icon("arrow", 14)}</a></div>`;

    const state = (s) => (s === "en_cours" ? U.status("En cours", "warning")
      : s === "termine" ? U.status("Terminé", "positive")
      : s === "annule" ? U.status("Annulé", "neutral") : U.status("Inscriptions ouvertes", "info"));
    const tourRows = (d.list || []).slice(0, 4).map((t) => [
      esc(t.name), esc(U.fmtDate(t.startsAt)), { html: num(t.registered), num: true }, { html: state(t.status) },
      { html: `<button type="button" class="btn ghost small-btn" data-goto="tournaments">${U.icon("arrow", 16)}</button>` },
    ]);

    const html = U.pageHead("Pilotage", "Vue d'ensemble",
        `${decisions} décisions en attente. ${this.desc}`,
        U.button("Créer un tournoi", "primary", "", "", "plus"))
      + `<div class="overview-grid">
          <div class="overview-main">
            ${U.metrics([
              U.metric("Joueurs inscrits", num(d.players.total), `${num(d.kyc.verified)} identités vérifiées`),
              U.metric("Parties aujourd'hui", num(d.gamesToday), `défi ${num(split.defi)} · matchmaking ${num(split.online)}`),
              U.metric("Tournois ouverts", num(d.tournaments.open), `${num(d.openRegistrations)} inscriptions actives`),
              U.metric("Solde des joueurs", money(d.withdrawalsMoney.balance), `${money(d.withdrawalsMoney.engaged)} réservés`),
              U.metric("Mises en jeu", money(lw.total), `${num(lw.sessions)} partie(s)`),
            ])}
            ${wagerFoot}
            ${U.panel("Activité des parties", chart, {
              desc: "Parties enregistrées sur les sept derniers jours · heure de Madagascar (UTC+3).",
              foot: `<span class="chart-summary"><strong>${num(total)} parties</strong> sur la période</span><span>Annulations exclues · ${num(split.autres)} entraînement(s) ou amical(aux) hors décompte du jour</span>`,
            })}
            ${U.panel("Tournois à la une",
              U.table("Tournois à la une", ["Tournoi", "Début", { label: "Inscrits", num: true }, "État", "Action"], tourRows),
              { bare: true })}
          </div>
          <aside class="overview-rail">
            ${U.panel("À traiter", queueList, { bare: true, actions: `<span class="status neutral">${num(decisions)} décisions</span>` })}
            ${U.panel("Prochain départ", nextBlock, { bare: true })}
            ${U.panel("Dernières décisions", recentBlock, { bare: true })}
          </aside>
        </div>`;

    return {
      html,
      wire(root) {
        root.querySelectorAll("[data-goto]").forEach((a) => {
          a.onclick = (e) => { e.preventDefault(); go(a.dataset.goto); };
        });
      },
    };
  },
};
/* ---------- Rôles & permissions ----------
   La grille est celle du CATALOGUE SERVEUR : modules et actions viennent de
   `/api/admin/me`, jamais d'une liste recopiée ici. Ajouter un module au
   serveur le fait apparaître sans toucher à cette vue. */
const roles = {
  id: "roles", label: "Rôles & permissions", group: "Configuration", perm: "roles.read", core: true,
  desc: "Une permission explicite par module et par action, plus les attributions.",
  async load() {
    const [r, a, me] = await Promise.all([
      api("/api/admin/roles"),
      api("/api/admin/assignments"),
      api("/api/admin/me"),
    ]);
    return { roles: r.roles || [], modules: r.modules || [], assignments: a.assignments || [], catalogue: me.catalogue || {} };
  },
  render(d) {
    const current = S.tab.roles || (d.roles[0] && d.roles[0].id);
    const role = d.roles.find((r) => r.id === current) || d.roles[0];
    if (!role) return { html: `<div class="a-empty">Aucun rôle au catalogue.</div>` };

    /* Un rôle protégé n'a rien à modifier : ses droits sont calculés. On
       affiche quand même la grille, en lecture seule — un administrateur doit
       pouvoir vérifier ce que « Super administrateur » accorde. */
    const readonly = !!role.protected || !can("roles.edit");
    const grid = d.modules.map((m) => {
      const granted = (role.rights && role.rights[m.id]) || {};
      return `<tr>
        <td><strong>${esc(m.label)}</strong><div class="a-muted" style="font-size:11px">${esc(m.id)}</div></td>
        <td><div class="a-perm">${(m.actions || []).map((a) => `
          <label><input type="checkbox" data-grant data-module="${esc(m.id)}" data-action="${esc(a)}"
            ${granted[a] ? "checked" : ""} ${readonly ? "disabled" : ""}>${esc(a)}</label>`).join("")}</div></td>
      </tr>`;
    }).join("");

    const assignments = table({
      head: ["Joueur", "Rôle", "Depuis", ""],
      rows: d.assignments.map((a) => [
        esc(a.pseudo), esc(a.role_id), esc(when(a.granted_at)),
        (!can("roles.edit") ? "" : { html: `<button class="a-btn small danger" data-ungrant="${esc(a.user_id)}" data-user-pseudo="${esc(a.pseudo)}" data-role-id="${esc(a.role_id)}">Retirer</button>` }),
      ]),
      empty: "Aucune attribution : personne ne détient de rôle.",
    });

    const html = `
      ${tabs(d.roles.map((r) => [r.id, r.label, r.members]), role.id, "role")}
      ${panel(role.label, `
        ${role.description ? `<p class="a-muted" style="margin-bottom:12px">${esc(role.description)}</p>` : ""}
        ${role.protected ? `<div class="a-notice warn" style="margin-bottom:12px">Rôle protégé : ses droits sont
          calculés (tous les modules, toutes les actions) et ne peuvent pas être réduits. C'est ce qui garantit
          qu'un back-office ne peut pas se retrouver sans personne pour le réparer.</div>` : ""}
        <div class="a-table-wrap"><table class="a-table">
          <thead><tr><th>Module</th><th>Droits</th></tr></thead><tbody>${grid}</tbody></table></div>`,
        readonly ? "" : `<button class="a-btn primary" data-save>Enregistrer les droits</button>`,
        `${role.members || 0} titulaire(s)`)}
      ${panel("Attributions", `
        ${can("roles.edit") ? `<div class="a-inline" style="margin-bottom:12px">
          <button class="a-btn" data-grant-new>Attribuer un rôle</button></div>` : ""}
        ${assignments}`)}`;

    return {
      html,
      wire(root) {
        root.querySelectorAll("[data-role]").forEach(() => {});
        root.querySelectorAll("[role=tab]").forEach((b) => {
          b.onclick = () => { S.tab.roles = b.dataset.role; reload(); };
        });
        root.querySelectorAll("[data-ungrant]").forEach((b) => {
          b.onclick = async () => {
            const reason = await askReason({
              title: "Retirer un rôle", okLabel: "Retirer",
              question: `Retirer « ${b.dataset.roleId} » à ${b.dataset.userPseudo} ? L'accès est fermé immédiatement.`,
            });
            if (!reason) return;
            try {
              /* L'attribution se fait par PSEUDO côté serveur : c'est le seul
                 identifiant qu'un administrateur connaît réellement. */
              await api("/api/admin/assignments", "POST",
                { pseudo: b.dataset.userPseudo, role: b.dataset.roleId, action: "revoke", reason });
              toast("Rôle retiré.", "ok"); reload();
            } catch (e) { toast(e.message, "bad"); }
          };
        });
        const newBtn = root.querySelector("[data-grant-new]");
        if (newBtn) newBtn.onclick = () => {
          dialog({
            title: "Attribuer un rôle",
            bodyHtml: `<label class="a-field"><span>Pseudo du joueur</span>
                <input name="pseudo" required maxlength="20" autocomplete="off"></label>
              <label class="a-field"><span>Rôle</span>
                <select name="role">${d.roles.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join("")}</select></label>`,
            okLabel: "Attribuer",
            onOk: async (f) => {
              await api("/api/admin/assignments", "POST", { pseudo: f.pseudo, role: f.role });
              toast("Rôle attribué.", "ok"); reload();
              return true;
            },
          });
        };
        const save = root.querySelector("[data-save]");
        if (save) save.onclick = async () => {
          const changes = [...root.querySelectorAll("input[data-grant]")].map((i) => ({
            module: i.dataset.module, action: i.dataset.action, allowed: i.checked,
          }));
          try {
            await api("/api/admin/roles/" + role.id, "POST", { changes });
            toast("Droits enregistrés.", "ok"); reload();
          } catch (e) { toast(e.message, "bad"); }
        };
      },
    };
  },
};

/* ---------- Modules ---------- */
const MODULE_ICON = {
  overview: "grid", users: "users", kyc: "shield", disputes: "flag", games: "board",
  matches: "swords", tournaments: "trophy", ranking: "chart", finance: "wallet",
  withdrawals: "out", campaigns: "megaphone", roles: "key", modules: "layers",
  audit: "history", settings: "settings",
};

const modulesView = {
  id: "modules", label: "Modules", group: "Configuration", perm: "modules.read", core: true,
  desc: "Activation des espaces, sans suppression de données.",
  load: () => api("/api/admin/modules"),
  render(d) {
    const mods = d.modules || [];
    const active = mods.filter((m) => m.enabled).length;
    const rows = mods.map((m) => `<div class="module-row">
        ${U.icon(MODULE_ICON[m.id] || "grid", 20)}
        <div class="grow">
          <div class="row wrap"><h3>${esc(m.label)}</h3>
            ${m.core ? U.status("Essentiel", "neutral")
              : (m.enabled ? U.status("Activé", "positive") : U.status("Fermé", "warning"))}</div>
          <p>${esc(m.desc || "")}</p>
        </div>
        ${m.core ? "" : (can("modules.edit")
          ? `<input class="switch" type="checkbox" role="switch" data-toggle="${esc(m.id)}" ${m.enabled ? "checked" : ""} aria-label="Activer ${esc(m.label)}">`
          : "")}
      </div>`).join("");
    const html = U.pageHead("Configuration", "Modules",
        `${active} espaces activés · aucune suppression de données lors d'une désactivation`)
      + U.notice("info", "Les modules essentiels restent accessibles pour éviter tout verrouillage. Les autres peuvent être fermés sans perdre leurs données ni leurs droits.")
      + U.panel("", rows, { bare: true });
    return {
      html,
      wire(root) {
        root.querySelectorAll("[data-toggle]").forEach((cb) => {
          cb.onchange = async () => {
            try {
              await api("/api/admin/modules/" + cb.dataset.toggle, "POST", { enabled: cb.checked });
              toast(cb.checked ? "Module activé." : "Module désactivé.", "ok");
              reload();
            } catch (e) { toast(e.message, "bad"); cb.checked = !cb.checked; }
          };
        });
      },
    };
  },
};
/* ---------- Journal ---------- */
const audit = {
  id: "audit", label: "Journal d'audit", group: "Configuration", perm: "audit.read", core: true,
  desc: "Traçabilité des décisions et des changements, en ajout seul.",
  load: () => api("/api/admin/audit?limit=200"),
  render(d) {
    const entries = d.entries || [];
    const rows = entries.map((e) => {
      const det = e.detail && (e.detail.reason || e.detail.motif) ? (e.detail.reason || e.detail.motif) : "—";
      return [
        { html: `<span class="small">${esc(U.fmtShort(e.at))}</span>` },
        esc(e.actor_pseudo || "système"),
        { html: `<span class="small">${esc(e.action)}</span>` },
        { html: `<span class="small muted">${esc(e.target || "—")}</span>` },
        { html: `<span class="small">${esc(det)}</span>` },
        { html: `<button type="button" class="btn ghost small-btn" data-detail="${esc(e.id)}" aria-label="Voir le détail">${U.icon("eye", 16)}</button>` },
      ];
    });
    const html = U.pageHead("Configuration", "Journal d'audit",
        `${num(entries.length)} décisions et changements · du plus récent au plus ancien`,
        U.button("Exporter le journal", "primary", "", "", "file"))
      + U.notice("info", "Journal en ajout seul côté serveur : aucune route ne le modifie ni ne l'efface.")
      + U.panel("", `<div class="toolbar"><div class="toolbar-meta"><span class="muted small">${num(entries.length)} entrée(s)</span></div></div>`
        + U.table("Journal d'audit", ["Date", "Auteur", "Action", "Cible", "Décision", "Détail"], rows),
        { bare: true });
    return {
      html,
      wire(root) {
        root.querySelectorAll("[data-detail]").forEach((btn) => {
          btn.onclick = () => {
            const e = entries.find((x) => String(x.id) === btn.dataset.detail);
            if (!e) return;
            dialog({
              title: "Entrée " + e.id, okLabel: "Fermer",
              bodyHtml: `<p class="a-field"><span>Action</span><code>${esc(e.action)}</code></p>
                <p class="a-field"><span>Cible</span>${esc(e.target || "—")}</p>
                <p class="a-field"><span>Auteur</span>${esc(e.actor_pseudo || "système")} · ${esc(U.fmtShort(e.at))}</p>
                <pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(e.detail || {}, null, 2))}</pre>`,
              onOk: () => true,
            });
          };
        });
      },
    };
  },
};
/* ---------- Paramètres ---------- */
const settings = {
  id: "settings", label: "Paramètres", group: "Configuration", perm: "settings.read", core: true,
  desc: "Identité de la plateforme, inscriptions et mode maintenance.",
  load: () => api("/api/admin/settings"),
  render(d) {
    const fields = Object.values(d.settings || {}).map((f) => f.type === "bool"
      ? `<label class="a-field"><span>${esc(f.label)}</span>
          <span class="a-inline"><input type="checkbox" name="${esc(f.key)}" ${f.value ? "checked" : ""}
            ${can("settings.edit") ? "" : "disabled"}> <span class="a-muted">${
            f.key === "maintenance" ? "coupe l'accès joueur" : "autorise les nouvelles inscriptions"}</span></span></label>`
      : `<label class="a-field"><span>${esc(f.label)}</span>
          <input name="${esc(f.key)}" value="${esc(f.value)}" ${can("settings.edit") ? "" : "disabled"}></label>`).join("");

    return {
      html: `${panel("Plateforme", `<div class="a-grid cols-2">${fields}</div>`,
        can("settings.edit") ? `<button class="a-btn primary" data-save>Enregistrer</button>` : "",
        `<span>Lu à chaque requête concernée : aucun redémarrage nécessaire.</span>`)}`,
      wire(root) {
        const save = root.querySelector("[data-save]");
        if (!save) return;
        save.onclick = async () => {
          const body = {};
          root.querySelectorAll("[name]").forEach((i) => {
            body[i.name] = i.type === "checkbox" ? i.checked : i.value;
          });
          try {
            await api("/api/admin/settings", "POST", body);
            toast("Paramètres enregistrés.", "ok"); reload();
          } catch (e) { toast(e.message, "bad"); }
        };
      },
    };
  },
};

export default { overview, roles, modules: modulesView, audit, settings };
