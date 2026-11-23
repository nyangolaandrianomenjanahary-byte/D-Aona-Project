/* =========================================================
   D-aôna — Administration v2 : vues « finances »
   ---------------------------------------------------------
   Portefeuilles & flux, Demandes de retrait, Campagnes.

   La vue « Demandes de retrait » est le seul endroit où de l'argent sort
   réellement du système : deux gestes distincts, deux traces distinctes.
   `review` approuve ou refuse (motif obligatoire) ; `pay` paie et exige la
   référence du transfert. Aucun des deux ne se fait en un clic.
   ========================================================= */
import {
  api, esc, num, money, when, day, can, tag, metric, panel, table, tabs,
  toast, dialog, askReason, reload, S,
} from "./admin.core.js";

/* ---------- Portefeuilles & flux ---------- */
const finance = {
  id: "finance", label: "Portefeuilles & flux", group: "Finances", perm: "finance.read",
  desc: "Soldes, fonds réservés, grand livre en ariary et export CSV.",
  async load() {
    const [over, ledger] = await Promise.all([api("/api/admin/finance"), api("/api/admin/accounting")]);
    return { over, ledger };
  },
  render(d) {
    const o = d.over || {};
    const l = d.ledger || {};
    /* `accounting` renvoie des totaux par activité ; on affiche ce qu'il donne
       sans le réinventer. */
    const rows = Object.entries(l.byActivity || l.activity || {}).map(([k, v]) => [esc(k), { html: money(v), num: true }]);
    return {
      html: `<div class="a-grid cols-4">
          ${metric("Solde total dû", money(o.balance), `${num(o.players)} comptes`)}
          ${metric("Bonus verrouillé", money(o.bonus), "non retirable")}
          ${metric("Engagé", money(o.engaged), "demandes en cours")}
          ${metric("Payé", money(o.paid), `refusé ${money(o.refused)}`)}
        </div>
        ${panel("Flux du grand livre", `<div class="a-grid cols-2">
          ${metric("Entrées", money(o.inflow && o.inflow.total), `${num(o.inflow && o.inflow.count)} mouvement(s)`)}
          ${metric("Sorties", money(o.outflow && o.outflow.total), `${num(o.outflow && o.outflow.count)} mouvement(s)`)}
        </div>`, can("finance.export")
          ? `<a class="a-btn" href="/api/admin/accounting?format=csv" download>Exporter le CSV</a>` : "",
          `<span>Les montants sont en ariary, lus à l'instant.</span>`)}
        ${rows.length ? panel("Répartition par activité", table({ head: ["Activité", { label: "Montant", num: true }], rows })) : ""}`,
    };
  },
};

/* ---------- Demandes de retrait ---------- */
const withdrawals = {
  id: "withdrawals", label: "Demandes de retrait", group: "Finances", perm: "withdrawals.read",
  desc: "Instruire une demande, la refuser motivée, la payer avec sa référence.",
  load() {
    const status = S.tab.withdrawals || "all";
    return api("/api/admin/withdrawals?status=" + encodeURIComponent(status) + "&limit=200");
  },
  render(d) {
    const status = S.tab.withdrawals || "all";
    const list = d.withdrawals || [];
    const t = d.totals || {};
    const stateTag = (s) => s === "pending" ? tag("À instruire", "warn")
      : s === "approved" ? tag("Approuvée", "info")
      : s === "paid" ? tag("Payée", "ok") : tag("Refusée", "bad");

    const rows = list.map((w) => [
      { html: `<strong>${esc(w.pseudo || ("compte " + w.userId))}</strong>
        <div class="a-muted" style="font-size:11px">demande #${esc(w.id)}</div>` },
      { html: `<strong>${esc(money(w.amount))}</strong>` },
      { html: `${esc(w.method)}${w.phone ? `<div class="a-muted" style="font-size:11px">${esc(w.phone)}</div>` : ""}` },
      { html: stateTag(w.status) },
      esc(when(w.createdAt)),
      { html: w.status === "paid"
        ? `<span class="a-muted">${esc(w.reference || "")}</span>`
        : w.status === "rejected" ? `<span class="a-muted a-trunc" title="${esc(w.reason || "")}">${esc(w.reason || "")}</span>` : "" },
      { html: `<div class="a-inline" style="justify-content:flex-end">
          ${w.status === "pending" && can("withdrawals.review")
            ? `<button class="a-btn small" data-review="${w.id}" data-dec="approve">Approuver</button>
               <button class="a-btn small danger" data-review="${w.id}" data-dec="reject">Refuser</button>` : ""}
          ${w.status === "approved" && can("withdrawals.review")
            ? `<button class="a-btn small primary" data-pay="${w.id}" data-amount="${w.amount}"
                data-method="${esc(w.method)}">Payer</button>` : ""}
        </div>` },
    ]);

    return {
      html: `<div class="a-grid cols-4">
          ${metric("À instruire", num(list.filter((w) => w.status === "pending").length), "demandes en attente")}
          ${metric("Engagé", money(t.engaged), "réservé aux joueurs")}
          ${metric("Payé", money(t.paid), "historique")}
          ${metric("Refusé", money(t.refused), "motifs conservés")}
        </div>
        ${tabs([["all", "Toutes", list.length], ["pending", "À instruire"], ["approved", "Approuvées"],
          ["paid", "Payées"], ["rejected", "Refusées"]], status, "wstatus")}
        ${panel("Demandes", table({
          head: ["Joueur", "Montant", "Moyen", "État", "Déposée le", "Référence / motif", ""],
          rows, empty: "Aucune demande de retrait.",
        }), "", `<span>${list.length} demande(s)</span>
          <span>Le plafond est de ${esc(money(d.dailyCap))} par jour et par joueur ; minimum ${esc(money(d.minAmount))}.</span>`)}`,
      wire(root) {
        root.querySelectorAll("[role=tab]").forEach((b) => {
          b.onclick = () => { S.tab.withdrawals = b.dataset.wstatus; reload(); };
        });
        root.querySelectorAll("[data-review]").forEach((b) => {
          b.onclick = async () => {
            const approve = b.dataset.dec === "approve";
            if (approve) {
              try {
                await api("/api/admin/withdrawals/" + b.dataset.review + "/review", "POST", { decision: "approve" });
                toast("Demande approuvée : elle peut être payée.", "ok"); reload();
              } catch (e) { toast(e.message, "bad"); }
              return;
            }
            const reason = await askReason({
              title: "Refuser cette demande", okLabel: "Refuser",
              question: "Le motif est transmis au joueur et conservé : il doit expliquer le refus.",
            });
            if (!reason) return;
            try {
              await api("/api/admin/withdrawals/" + b.dataset.review + "/review", "POST", { decision: "reject", reason });
              toast("Demande refusée.", "ok"); reload();
            } catch (e) { toast(e.message, "bad"); }
          };
        });
        root.querySelectorAll("[data-pay]").forEach((b) => {
          b.onclick = () => {
            dialog({
              title: "Payer la demande #" + b.dataset.pay,
              okLabel: "Marquer comme payée",
              bodyHtml: `<p class="a-muted" style="margin-bottom:12px">
                  ${esc(money(b.dataset.amount))} par ${esc(b.dataset.method)}.
                  Le portefeuille sera débité à l'enregistrement.</p>
                <label class="a-field"><span>Référence du transfert (obligatoire)</span>
                  <input name="reference" required maxlength="80" placeholder="ex. MVola 1234567890"></label>`,
              onOk: async (f) => {
                await api("/api/admin/withdrawals/" + b.dataset.pay + "/pay", "POST", { reference: f.reference });
                toast("Retrait payé et joueur notifié.", "ok"); reload();
                return true;
              },
            });
          };
        });
      },
    };
  },
};

/* ---------- Campagnes (bannières) ---------- */
const campaigns = {
  id: "campaigns", label: "Campagnes", group: "Finances", perm: "campaigns.read",
  desc: "Bannières de l'accueil et des profils : dates, ordre, emplacement.",
  load: () => api("/api/admin/ads"),
  render(d) {
    const list = d.ads || [];
    const today = new Date().toISOString().slice(0, 10);
    const rows = list.map((a) => {
      const active = a.actif && (!a.debut || a.debut <= today) && (!a.fin || a.fin >= today);
      return [
        { html: `<strong>${esc(a.titre)}</strong>
          <div class="a-muted" style="font-size:11px">${esc(a.slug)}</div>` },
        { html: esc(a.position === "both" ? "Accueil + profils" : a.position === "profil" ? "Profils" : "Accueil") },
        { html: `${esc(a.debut || "—")} → ${esc(a.fin || "—")}` },
        { html: num(a.ordre) },
        { html: a.actif ? (active ? tag("Diffusée", "ok") : tag("Hors période", "warn")) : tag("En pause", "neutral") },
        { html: `<div class="a-inline" style="justify-content:flex-end">
            ${can("campaigns.edit") ? `<button class="a-btn small" data-edit="${a.id}">Modifier</button>
              <button class="a-btn small" data-pause="${a.id}" data-next="${a.actif ? "0" : "1"}">${a.actif ? "Mettre en pause" : "Reprendre"}</button>` : ""}
            ${can("campaigns.delete") ? `<button class="a-btn small danger" data-del="${a.id}" data-name="${esc(a.titre)}">Supprimer</button>` : ""}
          </div>` },
      ];
    });

    return {
      html: `${panel("Bannières", table({
        head: ["Titre", "Emplacement", "Période", { label: "Ordre", num: true }, "État", ""],
        rows, empty: "Aucune bannière.",
      }), can("campaigns.create") ? `<button class="a-btn primary" data-new>Nouvelle bannière</button>` : "",
        `<span>${list.length} bannière(s)</span><span>Une bannière n'est diffusée que si elle est active ET dans sa période.</span>`)}`,
      wire(root) {
        const n = root.querySelector("[data-new]");
        if (n) n.onclick = () => campaignDialog(null);
        root.querySelectorAll("[data-edit]").forEach((b) => {
          b.onclick = () => campaignDialog(list.find((a) => String(a.id) === b.dataset.edit));
        });
        root.querySelectorAll("[data-pause]").forEach((b) => {
          b.onclick = async () => {
            try {
              await api("/api/admin/ads/" + b.dataset.pause, "POST", { actif: b.dataset.next === "1" });
              toast("Bannière mise à jour.", "ok"); reload();
            } catch (e) { toast(e.message, "bad"); }
          };
        });
        root.querySelectorAll("[data-del]").forEach((b) => {
          b.onclick = async () => {
            const reason = await askReason({
              title: "Supprimer la bannière", okLabel: "Supprimer",
              question: `« ${b.dataset.name} » sera retirée du carrousel. La suppression est définitive.`,
            });
            if (!reason) return;
            try {
              await api("/api/admin/ads/" + b.dataset.del, "DELETE");
              toast("Bannière supprimée.", "ok"); reload();
            } catch (e) { toast(e.message, "bad"); }
          };
        });
      },
    };
  },
};

function campaignDialog(a) {
  const isNew = !a;
  dialog({
    title: isNew ? "Nouvelle bannière" : "Modifier la bannière",
    okLabel: isNew ? "Créer" : "Enregistrer",
    bodyHtml: `<label class="a-field"><span>Titre</span>
        <input name="titre" required maxlength="200" value="${esc(a ? a.titre : "")}"></label>
      <label class="a-field"><span>Image (chemin dans les assets)</span>
        <input name="image" required maxlength="300" value="${esc(a ? a.image : "")}"
          placeholder="assets/ad/ma-banniere.svg"></label>
      <label class="a-field"><span>Lien au clic</span>
        <input name="lien" maxlength="500" value="${esc(a ? a.lien || "" : "")}"></label>
      <div class="a-grid cols-3">
        <label class="a-field"><span>Début</span>
          <input name="debut" type="date" value="${esc(a ? a.debut || "" : "")}"></label>
        <label class="a-field"><span>Fin</span>
          <input name="fin" type="date" value="${esc(a ? a.fin || "" : "")}"></label>
        <label class="a-field"><span>Ordre</span>
          <input name="ordre" type="number" min="0" max="999" value="${esc(a ? a.ordre : 0)}"></label>
      </div>
      <label class="a-field"><span>Emplacement</span>
        <select name="position">
          <option value="accueil" ${a && a.position === "accueil" ? "selected" : ""}>Accueil</option>
          <option value="profil" ${a && a.position === "profil" ? "selected" : ""}>Profils</option>
          <option value="both" ${a && a.position === "both" ? "selected" : ""}>Accueil + profils</option>
        </select></label>`,
    onOk: async (f) => {
      const body = {
        titre: f.titre, image: f.image, lien: f.lien || null,
        debut: f.debut || null, fin: f.fin || null,
        position: f.position, ordre: Number(f.ordre),
      };
      if (isNew) await api("/api/admin/ads", "POST", body);
      else await api("/api/admin/ads/" + a.id, "POST", body);
      toast("Bannière enregistrée.", "ok"); reload();
      return true;
    },
  });
}

export default { finance, withdrawals, campaigns };
