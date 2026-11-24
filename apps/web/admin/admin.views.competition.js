/* =========================================================
   D-aôna — Administration v2 : vues « compétition »
   ---------------------------------------------------------
   Jeux & règles (catalogue), Parties, Tournois, Classement & badges.
   ========================================================= */
import {
  api, esc, num, money, when, day, can, tag, metric, panel, table, tabs,
  toast, dialog, askReason, reload, S,
} from "./admin.core.js";

/* ---------- Jeux & règles ----------
   Le catalogue porte l'ÉTAT ÉDITORIAL ; le moteur vit en code. Un jeu sans
   moteur ne peut pas être activé — l'écran le dit et le serveur le refuse
   (409 MOTEUR_ABSENT). */
const games = {
  id: "games", label: "Jeux & règles", group: "Compétition", perm: "games.read",
  desc: "Variantes de Fanorona : publication, durée, classement, texte des règles.",
  load: () => api("/api/admin/games"),
  render(d) {
    const list = d.games || [];
    const stateTag = (s) => s === "active" ? tag("Publié", "ok")
      : s === "draft" ? tag("Brouillon", "warn") : tag("Retiré", "neutral");
    const rows = list.map((g) => [
      { html: `<strong>${esc(g.name)}</strong>
        <div class="a-muted" style="font-size:11px">${esc(g.slug)}${g.variant ? " · " + esc(g.variant) : ""}</div>` },
      { html: stateTag(g.status) },
      { html: `${num(g.duration)} min${g.ranked ? " · classé" : " · amical"}` },
      { html: g.engine ? tag("moteur présent", "ok") : tag("moteur absent", "bad") },
      { html: `v${num(g.version)}<div class="a-muted" style="font-size:11px">${esc(when(g.updatedAt, false))}</div>` },
      { html: `<div class="a-inline" style="justify-content:flex-end">
          ${can("games.edit") ? `<button class="a-btn small" data-edit="${esc(g.slug)}">Modifier</button>` : ""}
          ${can("games.edit") && g.status !== "active" && g.engine
            ? `<button class="a-btn small primary" data-state="${esc(g.slug)}" data-next="active">Publier</button>` : ""}
          ${can("games.edit") && g.status === "active"
            ? `<button class="a-btn small danger" data-state="${esc(g.slug)}" data-next="archived">Retirer</button>` : ""}
        </div>` },
    ]);

    return {
      html: `${panel("Catalogue", table({
        head: ["Jeu", "État", "Partie", "Moteur", "Version", ""], rows, empty: "Catalogue vide.",
      }), "", `<span>${list.length} jeu(x)</span>
        <span>Un jeu « moteur absent » vient du catalogue produit : son dossier de code n'existe pas encore.</span>`)}`,
      wire(root) {
        root.querySelectorAll("[data-state]").forEach((b) => {
          b.onclick = async () => {
            try {
              await api("/api/admin/games/" + b.dataset.state + "/status", "POST", { status: b.dataset.next });
              toast(b.dataset.next === "active" ? "Jeu publié." : "Jeu retiré.", "ok");
              reload();
            } catch (e) { toast(e.message, "bad"); }
          };
        });
        root.querySelectorAll("[data-edit]").forEach((b) => {
          b.onclick = () => editGame(list.find((g) => g.slug === b.dataset.edit));
        });
      },
    };
  },
};

function editGame(g) {
  if (!g) return;
  dialog({
    title: "Modifier « " + g.name + " »",
    okLabel: "Enregistrer",
    bodyHtml: `<label class="a-field"><span>Nom affiché</span>
        <input name="name" value="${esc(g.name)}" required maxlength="80"></label>
      <label class="a-field"><span>Précision (variante)</span>
        <input name="variant" value="${esc(g.variant || "")}" maxlength="60"></label>
      <div class="a-grid cols-3">
        <label class="a-field"><span>Durée (min)</span>
          <input name="duration" type="number" min="1" max="600" value="${esc(g.duration)}"></label>
        <label class="a-field"><span>Elo minimum</span>
          <input name="minElo" type="number" min="0" max="4000" value="${esc(g.minElo)}"></label>
        <label class="a-field"><span>Classé</span>
          <span class="a-inline"><input type="checkbox" name="ranked" ${g.ranked ? "checked" : ""}>
            <span class="a-muted">compte pour l'Elo</span></span></label>
      </div>
      <label class="a-field"><span>Règles affichées au joueur</span>
        <textarea name="rules" rows="5" maxlength="4000">${esc(g.rules || "")}</textarea></label>`,
    onOk: async (f) => {
      await api("/api/admin/games/" + g.slug, "POST", {
        name: f.name, variant: f.variant, duration: Number(f.duration),
        minElo: Number(f.minElo), ranked: f.ranked, rules: f.rules,
      });
      toast("Jeu enregistré.", "ok"); reload();
      return true;
    },
  });
}

/* ---------- Parties ---------- */
const matches = {
  id: "matches", label: "Parties", group: "Compétition", perm: "matches.read",
  desc: "Suivi des parties en cours, validation ou correction des résultats.",
  load() {
    const status = S.tab.matches || "all";
    return api("/api/admin/matches?status=" + encodeURIComponent(status) + "&limit=200");
  },
  render(d) {
    const status = S.tab.matches || "all";
    const list = d.matches || [];
    const stateTag = (s) => s === "live" ? tag("En cours", "info")
      : s === "finished" ? tag("Terminée", "ok")
      : s === "disputed" ? tag("Contestée", "warn") : tag("Annulée", "bad");
    const rows = list.map((m) => [
      { html: `<strong>${esc(m.p1 || "?")}</strong> <span class="a-muted">vs</span> <strong>${esc(m.p2 || "?")}</strong>
        <div class="a-muted" style="font-size:11px">${esc(m.game || "variante inconnue")} · ${esc(m.mode || "")}
        ${m.wager ? " · mise " + esc(money(m.wager)) : ""}</div>` },
      { html: stateTag(m.status) },
      { html: m.winner ? `<strong>${esc(m.winner)}</strong>` : `<span class="a-muted">—</span>` },
      esc(when(m.createdAt)),
      { html: (m.status === "disputed" && can("matches.review"))
        ? `<div class="a-inline" style="justify-content:flex-end">
            <button class="a-btn small" data-result="${esc(m.id)}" data-dec="confirm">Confirmer</button>
            <button class="a-btn small danger" data-result="${esc(m.id)}" data-dec="void">Annuler</button></div>`
        : "" },
    ]);

    return {
      html: `${tabs([["all", "Toutes", list.length], ["live", "En cours"], ["finished", "Terminées"],
        ["disputed", "Contestées"], ["cancelled", "Annulées"]], status, "mstatus")}
      ${panel("Parties", table({
        /* « Début » et non « Jouée le » : la colonne porte l'instant où la partie
           a commencé, y compris pour une partie encore en cours. */
        head: ["Joueurs", "État", "Vainqueur", "Début", ""], rows,
        empty: "Aucune partie dans cet état.",
      }), "", `<span>${list.length} partie(s)</span>
        <span>${status === "live"
          ? "Une partie en cours n'a pas encore de vainqueur — la colonne reste à « — »."
          : "Trié du plus récent au plus ancien, sur la date de début."}</span>`)}`,
      wire(root) {
        root.querySelectorAll("[role=tab]").forEach((b) => {
          b.onclick = () => { S.tab.matches = b.dataset.mstatus; reload(); };
        });
        root.querySelectorAll("[data-result]").forEach((b) => {
          b.onclick = async () => {
            const dec = b.dataset.dec;
            const reason = await askReason({
              title: dec === "confirm" ? "Confirmer le résultat" : "Annuler la partie",
              okLabel: dec === "confirm" ? "Confirmer" : "Annuler la partie",
              danger: dec === "void",
              question: dec === "confirm"
                ? "Le résultat enregistré devient définitif. L'Elo n'est pas recalculé."
                : "La partie passe en « annulée ». L'Elo déjà versé n'est PAS repris automatiquement.",
            });
            if (!reason) return;
            try {
              await api("/api/admin/matches/" + b.dataset.result + "/result", "POST", { decision: dec, reason });
              toast("Partie mise à jour.", "ok"); reload();
            } catch (e) { toast(e.message, "bad"); }
          };
        });
      },
    };
  },
};

/* ---------- Tournois ---------- */
const tournaments = {
  id: "tournaments", label: "Tournois", group: "Compétition", perm: "tournaments.read",
  desc: "Créer un tournoi, suivre ses inscriptions, l'annuler avec remboursement.",
  load: () => api("/api/admin/tournaments"),
  render(d) {
    const list = d.tournaments || [];
    const stateTag = (s) => s === "inscriptions" ? tag("Inscriptions", "info")
      : s === "en_cours" ? tag("En cours", "warn")
      : s === "termine" ? tag("Terminé", "ok") : tag(s || "—", "neutral");
    const rows = list.map((t) => [
      { html: `<strong>${esc(t.name)}</strong>
        <div class="a-muted" style="font-size:11px">${esc(t.format || "")} · entrée ${esc(money(t.entry))}
        ${t.sponsor ? " · " + esc(t.sponsor) : ""}</div>` },
      { html: stateTag(t.status) },
      { html: `${num(t.registered)} / ${num(t.maxPlayers)}` },
      esc(when(t.startsAt)),
      { html: (t.status === "inscriptions" && can("tournaments.delete"))
        ? `<button class="a-btn small danger" data-cancel="${t.id}">Annuler</button>` : "" },
    ]);

    return {
      html: `${panel("Tournois", table({
        head: ["Tournoi", "État", "Inscrits", "Début", ""], rows, empty: "Aucun tournoi.",
      }), can("tournaments.create") ? `<button class="a-btn primary" data-new>Créer un tournoi</button>` : "",
        `<span>${list.length} tournoi(s)</span>
         <span>Annuler un tournoi rembourse les droits d'entrée déjà prélevés.</span>`)}`,
      wire(root) {
        const newBtn = root.querySelector("[data-new]");
        if (newBtn) newBtn.onclick = () => createTournament();
        root.querySelectorAll("[data-cancel]").forEach((b) => {
          b.onclick = async () => {
            const reason = await askReason({
              title: "Annuler ce tournoi", okLabel: "Annuler le tournoi",
              question: "Les inscrits sont remboursés et informés. L'action est journalisée.",
            });
            if (!reason) return;
            try {
              await api("/api/admin/tournaments/" + b.dataset.cancel, "POST", { action: "cancel", reason });
              toast("Tournoi annulé.", "ok"); reload();
            } catch (e) { toast(e.message, "bad"); }
          };
        });
      },
    };
  },
};

function createTournament() {
  const in3h = new Date(Date.now() + 3 * 3600000);
  const local = new Date(in3h.getTime() - in3h.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  dialog({
    title: "Créer un tournoi", okLabel: "Créer",
    bodyHtml: `<label class="a-field"><span>Nom</span>
        <input name="name" required maxlength="120"></label>
      <div class="a-grid cols-2">
        <label class="a-field"><span>Format</span>
          <select name="format"><option value="blitz">Blitz</option><option value="rapide" selected>Rapide</option>
            <option value="pro">Pro</option></select></label>
        <label class="a-field"><span>Droits d'entrée (Ar)</span>
          <input name="entry" type="number" min="0" max="1000000" value="2000"></label>
        <label class="a-field"><span>Places</span>
          <input name="maxPlayers" type="number" min="2" max="64" value="8"></label>
        <label class="a-field"><span>Début</span>
          <input name="startsAt" type="datetime-local" value="${esc(local)}" required></label>
      </div>`,
    onOk: async (f) => {
      await api("/api/admin/tournaments", "POST", {
        name: f.name, format: f.format, entry: Number(f.entry),
        maxPlayers: Number(f.maxPlayers),
        /* Le serveur attend une date : le champ local n'a pas de fuseau, on
           l'envoie donc converti en ISO. */
        startsAt: new Date(f.startsAt).toISOString(),
      });
      toast("Tournoi créé.", "ok"); reload();
      return true;
    },
  });
}

/* ---------- Classement & badges ---------- */
const ranking = {
  id: "ranking", label: "Classement & badges", group: "Compétition", perm: "ranking.read",
  desc: "Distribution des classements et bornes de rang des badges.",
  load: () => api("/api/admin/ranking"),
  render(d) {
    const top = table({
      head: ["Rang", "Joueur", "Elo", "V/D", "Badge"],
      rows: (d.top || []).map((r) => [
        { html: `<strong>${num(r.rank)}</strong>`, num: true },
        esc(r.pseudo),
        { html: num(r.elo), num: true },
        { html: `${num(r.wins)} / ${num(r.losses)}`, num: true },
        { html: r.badge ? `${esc(r.badgeIcon || "")} ${esc(r.badge)}` : "—" },
      ]),
      empty: "Aucun joueur classé.",
    });

    const badges = (d.badges || []).map((b) => `<tr>
      <td><strong>${esc(b.icon || "")} ${esc(b.name)}</strong></td>
      <td class="num">${num(b.minRank)}</td>
      <td class="num">${b.maxRank == null ? "et au-delà" : num(b.maxRank)}</td>
      <td class="num">${num(b.members)}</td>
    </tr>`).join("");

    return {
      html: `<div class="a-grid cols-4">
          ${metric("Joueurs classés", num(d.players), "tous comptes")}
          ${metric("Elo moyen", num(d.average), "médiane " + num(d.median))}
          ${metric("Elo minimum", num(d.min), "plus bas")}
          ${metric("Elo maximum", num(d.max), "tête de tableau")}
        </div>
        ${panel("Tête de classement", top)}
        ${panel("Badges", `<div class="a-table-wrap"><table class="a-table">
            <thead><tr><th>Badge</th><th class="num">Du rang</th><th class="num">Au rang</th><th class="num">Titulaires</th></tr></thead>
            <tbody>${badges || `<tr><td colspan="4">Aucun badge.</td></tr>`}</tbody></table></div>`,
          can("ranking.edit") ? `<button class="a-btn" data-badges>Modifier les bornes</button>` : "",
          `<span>Le badge découle du rang : il ne s'attribue pas à la main.</span>`)}`,
      wire(root) {
        const b = root.querySelector("[data-badges]");
        if (b) b.onclick = () => editBadges(d.badges || []);
      },
    };
  },
};

function editBadges(list) {
  /* Une ligne par badge : nom, borne basse, borne haute (vide = sans limite).
     La validation d'intervalle est faite des deux côtés — ici pour éviter
     l'aller-retour, côté serveur parce que c'est lui qui décide. */
  const rows = list.map((b, i) => `<tr>
    <td><input name="name${i}" value="${esc(b.name)}" maxlength="40" aria-label="Nom du badge ${i + 1}"></td>
    <td><input name="min${i}" type="number" min="1" value="${esc(b.minRank)}" aria-label="Rang minimum ${i + 1}"></td>
    <td><input name="max${i}" type="number" min="1" value="${b.maxRank == null ? "" : esc(b.maxRank)}"
      aria-label="Rang maximum ${i + 1}" placeholder="∞"></td>
  </tr>`).join("");
  dialog({
    title: "Bornes des badges", okLabel: "Enregistrer",
    bodyHtml: `<div class="a-table-wrap"><table class="a-table">
        <thead><tr><th>Badge</th><th>Du rang</th><th>Au rang</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="a-muted" style="margin-top:10px;font-size:12px">Laisser « Au rang » vide signifie
        « et au-delà ». Un rang maximum inférieur au minimum est refusé.</p>`,
    onOk: async (f) => {
      const badges = list.map((b, i) => ({
        name: f["name" + i], minRank: Number(f["min" + i]),
        maxRank: String(f["max" + i]).trim() === "" ? null : Number(f["max" + i]),
        icon: b.icon, color: b.color, ink: b.ink,
      }));
      await api("/api/admin/badges", "POST", { badges });
      toast("Barème enregistré.", "ok"); reload();
      return true;
    },
  });
}

export default { games, matches, tournaments, ranking };
