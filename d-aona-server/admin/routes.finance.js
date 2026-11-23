/* =========================================================
   D-aôna — Administration : routes « Finances » et « Demandes de retrait »
   ---------------------------------------------------------
   Ce fichier isole les routes des deux modules financiers, ajoutés par la
   refonte v2. Il suit le MÊME contrat que le routeur historique (trois
   barrières : session -> module -> droit) et ne compose que des appels à
   `store.finance.js` : aucune requête SQL ici, comme ailleurs.

   Contrat d'appel : `module.exports = async (o) => boolean`
     o.guard(perm)   -> true si le droit est acquis ; sinon la réponse 401/403
                        a DÉJÀ été écrite (refus journalisé sur une action)
     o.body()        -> corps JSON, ou null si trop volumineux
     o.respond / o.refuse / o.audit / o.broadcast
   Renvoie `true` quand la réponse est écrite, `false` si la route n'est pas
   la sienne — le routeur essaie alors le module suivant.
   ========================================================= */
"use strict";

const Finance = require("./store.finance");

function intParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

module.exports = async function financeRoutes(o) {
  const { method, parts, url } = o;
  const head = parts[0] || "";

  /* ---------- GET /api/admin/finance ---------- */
  if (head === "finance") {
    if (method !== "GET" || parts.length !== 1) return false;
    if (!o.guard("finance.read")) return true;
    return o.respond(o.res, Finance.overview()), true;
  }

  if (head !== "withdrawals") return false;

  /* ---------- GET /api/admin/withdrawals?status=&limit= ---------- */
  if (method === "GET" && parts.length === 1) {
    if (!o.guard("withdrawals.read")) return true;
    return o.respond(o.res, {
      withdrawals: Finance.list({
        status: url.searchParams.get("status") || "all",
        limit: url.searchParams.get("limit"),
      }),
      methods: Finance.METHODS,
      dailyCap: Finance.DAILY_CAP,
      minAmount: Finance.MIN_AMOUNT,
      totals: Finance.overview(),
    }), true;
  }

  /* ---------- POST /api/admin/withdrawals/:id/review ---------- */
  if (method === "POST" && parts.length === 3 && parts[2] === "review") {
    if (!o.guard("withdrawals.review")) return true;
    const id = intParam(parts[1]);
    const b = await o.body();
    if (!b) return o.respond(o.res, { error: "Requête trop volumineuse" }, 413), true;
    const r = Finance.review(id, b, o.actor);
    if (!r.ok) return o.refuse(o.res, r), true;
    o.audit({
      action: b.decision === "approve" ? "withdrawals.approve" : "withdrawals.reject",
      target: `withdrawal:${id}`,
      detail: { amount: r.request.amount, pseudo: r.request.pseudo, reason: b.reason || null },
    });
    o.broadcast("withdrawals");
    return o.respond(o.res, r), true;
  }

  /* ---------- POST /api/admin/withdrawals/:id/pay ---------- */
  if (method === "POST" && parts.length === 3 && parts[2] === "pay") {
    if (!o.guard("withdrawals.review")) return true;
    const id = intParam(parts[1]);
    const b = await o.body();
    if (!b) return o.respond(o.res, { error: "Requête trop volumineuse" }, 413), true;
    const r = Finance.pay(id, b, o.actor);
    if (!r.ok) return o.refuse(o.res, r), true;
    o.audit({
      action: "withdrawals.pay",
      target: `withdrawal:${id}`,
      detail: { amount: r.request.amount, pseudo: r.request.pseudo, reference: r.request.reference },
    });
    o.broadcast("withdrawals");
    /* Le joueur doit voir sa demande passer à « payé » sans recharger. */
    o.notifyWallet(r.request.userId);
    return o.respond(o.res, r), true;
  }

  return false;
};
