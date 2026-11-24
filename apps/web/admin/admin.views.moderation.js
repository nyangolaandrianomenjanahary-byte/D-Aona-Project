/* =========================================================
   D-aôna — Administration v2 : vues « modération »
   ---------------------------------------------------------
   Joueurs, vérification d'identité, litiges.

   POINT SENSIBLE — les pièces d'identité. `/api/admin/kyc/:id/doc/:face` est
   protégée par l'en-tête `Authorization` : un `<img src="…">` ne peut donc PAS
   la lire (le navigateur n'envoie pas d'en-tête personnalisé). La vue récupère
   la pièce en BLOB, en fait une URL d'objet, et la RÉVOQUE au changement
   d'écran — sans quoi une carte d'identité resterait en mémoire après avoir
   quitté le dossier.
   ========================================================= */
import {
  api, esc, num, money, when, day, can, tag, metric, panel, table, tabs,
  toast, dialog, askReason, reload, S,
} from "./admin.core.js";

/* Toutes les URL d'objet vivantes : révoquées par `unmount()` à chaque rendu. */
let objectUrls = [];
export function revokeDocs() {
  for (const u of objectUrls) { try { URL.revokeObjectURL(u); } catch (e) {} }
  objectUrls = [];
}

/* Télécharge une pièce protégée et renvoie une URL d'objet. Le SEAU (`bucket`)
   décide quand elle sera révoquée : les pièces de la file KYC à chaque rendu de
   la vue, celles de la fiche « Examiner » à la fermeture de la fiche. Une carte
   d'identité ne doit pas rester en mémoire après son usage. */
async function fetchDoc(caseId, face, bucket) {
  const token = localStorage.getItem("daona_token") || "";
  const res = await fetch(`/api/admin/kyc/${caseId}/doc/${face}`,
    { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
  if (!res.ok) throw new Error("Pièce illisible (" + res.status + ")");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  (bucket || objectUrls).push(url);
  return url;
}

/* ---------- Joueurs ---------- */
/* Tri client-side : quatre colonnes seulement (le nom et les trois dates),
   comme convenu — on ne trie pas les quinze écrans. Le serveur renvoie la
   liste ; changer l'ordre ne redemande rien. Les dates vides trient comme
   « jamais », ce qui les place en fin de liste croissante. */
const USER_SORTS = {
  pseudo: (u) => String(u.pseudo || "").toLowerCase(),
  created: (u) => String(u.created_at || ""),
  seen: (u) => String(u.last_seen || ""),
  game: (u) => String(u.last_game_at || ""),
};

const users = {
  id: "users", label: "Joueurs", group: "Communauté", perm: "users.read",
  desc: "Comptes, portefeuille, identité et sanctions.",
  load() {
    const q = S.tab.usersQ || "";
    return api("/api/admin/users?limit=200" + (q ? "&q=" + encodeURIComponent(q) : ""));
  },
  render(d) {
    const list = d.users || [];
    const sort = S.tab.usersSort || { key: "pseudo", dir: 1 };
    const sortKey = USER_SORTS[sort.key] ? sort.key : "pseudo";
    const sorted = list.slice().sort((a, b) => {
      const va = USER_SORTS[sortKey](a), vb = USER_SORTS[sortKey](b);
      if (va === vb) return String(a.pseudo).localeCompare(String(b.pseudo));
      return (va < vb ? -1 : 1) * sort.dir;
    });
    const rows = sorted.map((u) => [
      { label: "Joueur", html: `<strong>${esc(u.pseudo)}</strong>
        ${u.blocked ? tag("Suspendu", "bad") : ""}
        ${u.roles && u.roles.length ? tag(u.roles.join(", "), "info") : ""}
        <div class="a-muted" style="font-size:11px">${esc(u.province || "")} · ${esc(num(u.elo))} Elo</div>` },
      { label: "Portefeuille", html: `${money(u.balance)}<div class="a-muted" style="font-size:11px">bonus ${money(u.bonus_lock)}</div>` },
      { label: "Identité", html: tag(u.kyc_status === "verified" ? "Vérifié" : u.kyc_status === "pending" ? "En attente" :
          u.kyc_status === "rejected" ? "Refusé" : "Aucun",
          u.kyc_status === "verified" ? "ok" : u.kyc_status === "pending" ? "warn" : "neutral") },
      /* « Date de création » remplace l'ancien « Vu » : celui-ci affichait
         `last_seen`, donc la colonne changeait à chaque connexion alors qu'un
         libellé « Vu » laissait croire à la création du compte. */
      { label: "Date de création", html: esc(when(u.created_at)) },
      { label: "Dernière activité", html: esc(when(u.last_seen)) },
      { label: "Dernière visite dans le jeu", html: esc(when(u.last_game_at)) },
      { label: "Actions", html: `<div class="a-inline" style="justify-content:flex-end">
          <button class="a-btn small" data-examine="${u.id}" data-pseudo="${esc(u.pseudo)}">Examiner</button>
          ${can("users.edit") ? (u.blocked
            ? `<button class="a-btn small" data-act="unblock" data-id="${u.id}" data-pseudo="${esc(u.pseudo)}">Réactiver</button>`
            : `<button class="a-btn small danger" data-act="block" data-id="${u.id}" data-pseudo="${esc(u.pseudo)}">Suspendre</button>`) : ""}
          ${can("users.edit") && u.kyc_status === "verified"
            ? `<button class="a-btn small" data-act="revoke-kyc" data-id="${u.id}" data-pseudo="${esc(u.pseudo)}">Retirer KYC</button>` : ""}
        </div>` },
    ]);

    return {
      html: `${panel("Comptes", `
        <div class="a-search" style="margin-bottom:12px">
          <input type="search" placeholder="Rechercher un pseudo…" value="${esc(S.tab.usersQ || "")}"
            data-q maxlength="20" aria-label="Rechercher un joueur">
          <button class="a-btn" data-search>Rechercher</button>
        </div>
        ${table({
          head: [{ label: "Joueur", sort: "pseudo" }, "Portefeuille", "Identité",
            { label: "Date de création", sort: "created" },
            { label: "Dernière activité", sort: "seen" },
            { label: "Dernière visite dans le jeu", sort: "game" }, ""],
          rows, sort: { key: sortKey, dir: sort.dir },
          empty: "Aucun compte.",
        })}`,
        "", `<span>${list.length} compte(s) affiché(s)</span>
          <span>« — » signifie « jamais connecté » (ou aucune visite de jeu).</span>`) }`,
      wire(root) {
        const q = root.querySelector("[data-q]");
        const run = () => { S.tab.usersQ = q.value.trim(); reload(); };
        root.querySelector("[data-search]").onclick = run;
        q.onkeydown = (e) => { if (e.key === "Enter") run(); };
        /* En-têtes triables : un second clic inverse le sens. Une date part en
           décroissant (le plus récent d'abord) ; le nom part en croissant. */
        root.querySelectorAll("[data-sort]").forEach((b) => {
          b.onclick = () => {
            const k = b.dataset.sort;
            const cur = S.tab.usersSort || { key: "pseudo", dir: 1 };
            S.tab.usersSort = { key: k, dir: cur.key === k ? -cur.dir : (k === "pseudo" ? 1 : -1) };
            reload();
          };
        });
        root.querySelectorAll("[data-examine]").forEach((b) => {
          b.onclick = () => examine(parseInt(b.dataset.examine, 10));
        });
        root.querySelectorAll("[data-act]").forEach((b) => {
          b.onclick = async () => {
            const act = b.dataset.act;
            const labels = {
              block: ["Suspendre ce compte", "Suspendre"],
              unblock: ["Réactiver ce compte", "Réactiver"],
              "revoke-kyc": ["Retirer la vérification d'identité", "Retirer"],
            };
            const [title, okLabel] = labels[act];
            const reason = await askReason({
              title, okLabel, danger: act !== "unblock",
              question: act === "block"
                ? `« ${b.dataset.pseudo} » sera déconnecté immédiatement et ne pourra plus se reconnecter.`
                : `« ${b.dataset.pseudo} » : l'action est journalisée avec son motif.`,
            });
            if (!reason) return;
            try {
              const r = await api("/api/admin/users/" + b.dataset.id, "POST", { action: act, reason });
              toast(act === "block" && r.revokedSessions
                ? `Compte suspendu · ${r.revokedSessions} session(s) fermée(s).`
                : "Fait.", "ok");
              reload();
            } catch (e) { toast(e.message, "bad"); }
          };
        });
      },
    };
  },
};

/* ---------- « Examiner » un joueur ----------
   Une fiche de CONSULTATION, pas de décision : suspendre, réactiver et retirer
   la vérification gardent leurs boutons. Trois points sensibles :
     · l'accès est contrôlé par le SERVEUR (`users.read`) et chaque ouverture est
       JOURNALISÉE (`users.examine` : qui, quand, quel joueur) ;
     · les pièces d'identité ne viennent pas de cette fiche : elles sont demandées
       à `/api/admin/kyc/:id/doc/:face`, qui exige `kyc.review`, interdit la mise
       en cache et journalise chaque lecture. Sans ce droit, la fiche dit
       seulement si les faces existent ;
     · les images sont des URL d'objet, RÉVOQUÉES à la fermeture de la fiche —
       une carte d'identité ne reste pas en mémoire après consultation. */
let examineUrls = [];

function revokeExamine() {
  for (const u of examineUrls) { try { URL.revokeObjectURL(u); } catch (e) {} }
  examineUrls = [];
}

function zoomDoc(url, label) {
  dialog({
    title: "Pièce — " + label, okLabel: "Fermer",
    bodyHtml: `<img class="a-zoomable" src="${url}" alt="${esc(label)}">`,
    onOk: () => true,
  });
}

const KYC_LABEL = { verified: "Vérifié", pending: "En attente", rejected: "Refusé", none: "Aucun dossier" };
const KYC_TAG = { verified: "ok", pending: "warn", rejected: "bad", none: "neutral" };

async function examine(userId) {
  let d = null;
  try { d = await api("/api/admin/users/" + userId); }
  catch (e) { toast(e.message, "bad"); return; }
  const val = (v) => (v == null || v === "" ? `<span class="a-muted">—</span>` : esc(v));
  const champ = (k, v) => `<div class="a-field"><span>${esc(k)}</span><div>${v}</div></div>`;
  const c = d.kyc_case;
  const faces = c ? c.faces : { recto: false, verso: false };
  const peutVoir = can("kyc.review");

  /* Sans le droit de lire les pièces, la fiche reste utile : elle dit ce qui
     existe, sans jamais afficher l'image. */
  const faceCellule = (nom, present) => (present
    ? (peutVoir ? `<div class="a-muted">Chargement…</div>`
      : `<div class="a-muted">${nom} présent · image réservée au droit <code>kyc.review</code></div>`)
    : `<div class="a-muted">${nom} absent</div>`);

  /* Les documents sont TOUJOURS montrés — y compris quand il n'y a pas de
     dossier : « aucun dossier » et « visage non fourni » sont des informations,
     pas des cases à masquer. L'opérateur doit pouvoir constater l'absence. */
  const docs = `${c ? "" : `<div class=\"a-muted\" style=\"margin-bottom:8px\">Aucun dossier d'identité déposé.</div>`}
    <div class="a-grid cols-2" data-docs>
      <div data-face="recto">${c ? faceCellule("Recto", faces.recto) : `<div class=\"a-muted\">Recto absent</div>`}</div>
      <div data-face="verso">${c ? faceCellule("Verso", faces.verso) : `<div class=\"a-muted\">Verso absent</div>`}</div>
    </div>
    <div class="a-muted" style="margin-top:8px;font-size:12px">
      Visage (selfie / liveness) : ${c && c.face && c.face.present ? "fourni" :
        "non fourni — la capture se fait dans l'application joueur (étape KYC 4.3)."}
    </div>`;

  const el = dialog({
    title: "Examiner " + d.pseudo,
    okLabel: "Fermer",
    bodyHtml: `<div class="a-grid cols-2">
        ${champ("Pseudo", `<strong>${esc(d.pseudo)}</strong>`)}
        ${champ("Compte n°", esc(d.id))}
        ${champ("Téléphone", val(d.phone))}
        ${champ("E-mail", val(d.email))}
        ${champ("Province", val(d.province))}
        ${champ("Classement", `${esc(num(d.elo))} Elo · ${esc(num(d.wins))} V / ${esc(num(d.losses))} D`)}
        ${champ("Portefeuille", `${money(d.balance)}<div class="a-muted" style="font-size:11px">bonus verrouillé ${money(d.bonus_lock)}</div>`)}
        ${champ("État du compte", d.blocked
          ? tag("Suspendu", "bad") + (d.sanction_reason ? `<div class="a-muted" style="font-size:11px">${esc(d.sanction_reason)}</div>` : "")
          : tag("Actif", "ok"))}
        ${champ("Date de création", esc(when(d.created_at)))}
        ${champ("Dernière activité", esc(when(d.last_seen)))}
        ${champ("Dernière visite dans le jeu", esc(when(d.last_game_at)))}
        ${champ("Identité", tag(KYC_LABEL[d.kyc_status] || "Aucun", KYC_TAG[d.kyc_status] || "neutral")
          + (c && c.reason ? `<div class="a-muted" style="font-size:11px">motif : ${esc(c.reason)}</div>` : ""))}
      </div>
      <hr style="border:0;border-top:1px solid var(--a-rule);margin:14px 0">
      ${docs}`,
    onOk: () => true,
  });

  /* Les pièces arrivent APRÈS l'ouverture : la fiche s'affiche tout de suite,
     et sans droit `kyc.review` aucune requête d'image n'est même tentée. */
  if (c && peutVoir) {
    (async () => {
      for (const face of ["recto", "verso"]) {
        if (!faces[face]) continue;
        const cell = el.querySelector('[data-face="' + face + '"]');
        if (!cell) return;
        try {
          const url = await fetchDoc(c.id, face, examineUrls);
          if (!el.isConnected) return;      // fiche fermée entre-temps
          cell.innerHTML = `<button type="button" class="a-doc" data-zoom="${face}"`
            + ` aria-label="Agrandir la pièce ${face}">`
            + `<img src="${url}" alt="CIN ${face} de ${esc(d.pseudo)}"></button>`;
          cell.querySelector("[data-zoom]").onclick = () => zoomDoc(url, face + " — " + d.pseudo);
        } catch (e) {
          cell.innerHTML = `<div class="a-muted">${esc(e.message)}</div>`;
        }
      }
    })();
  }
  /* Révocation À LA FERMETURE — et seulement si le zoom n'est pas encore
     ouvert, sinon l'image agrandie se viderait sous les yeux de l'utilisateur. */
  el.addEventListener("close", () => setTimeout(() => {
    if (!document.querySelector("dialog.a-dialog")) revokeExamine();
  }, 0));
}

/* ---------- Vérification d'identité ---------- */
const kyc = {
  id: "kyc", label: "Vérification d'identité", group: "Communauté", perm: "kyc.read",
  desc: "Dossiers recto/verso à examiner et décisions motivées.",
  load() {
    const status = S.tab.kyc || "pending";
    return api("/api/admin/kyc?status=" + encodeURIComponent(status) + "&limit=100");
  },
  render(d) {
    revokeDocs();
    const status = S.tab.kyc || "pending";
    const counts = d.counts || {};
    const list = d.cases || [];
    const rows = list.map((c) => [
      { html: `<strong>${esc(c.pseudo || ("compte " + c.user_id))}</strong>
        ${c.status === "verified" && !c.has_face ? tag("legacy", "neutral") : ""}` },
      /* Les trois pièces d'un coup d'œil : c'est ce qui décide d'une validation. */
      { html: [["Recto", c.bytes_recto], ["Verso", c.bytes_verso], ["Visage", c.has_face]]
          .map(([k, ok]) => `<span class="a-muted" style="font-size:11px">${k} ${ok ? "✓" : "—"}</span>`).join(" · ") },
      esc(when(c.submitted_at)),
      esc(when(c.reviewed_at)),
      { html: c.reason ? `<span class="a-trunc" title="${esc(c.reason)}">${esc(c.reason)}</span>` : "" },
      { html: `<div class="a-inline" style="justify-content:flex-end">
          <button class="a-btn small" data-open="${c.id}">Examiner</button></div>` },
    ]);

    return {
      html: `${tabs([
        ["pending", "À vérifier", counts.pending],
        ["verified", "Vérifiés", counts.verified],
        ["rejected", "Refusés", counts.rejected],
      ], status, "kycstatus")}
      ${panel("Dossiers", table({
        head: ["Joueur", "Pièces", "Déposé", "Revu", "Motif", ""], rows,
        empty: status === "pending" ? "Aucun dossier en attente : la file est vide." : "Aucun dossier dans cet état.",
      }), "", `<span>${list.length} dossier(s)</span>
        <span>Scan facial ${d.faceRequired ? "EXIGÉ" : "facultatif (capture joueur non livrée)"} · pièces jamais mises en cache.</span>`)}`,
      wire(root) {
        root.querySelectorAll("[role=tab]").forEach((b) => {
          b.onclick = () => { S.tab.kyc = b.dataset.kycstatus; reload(); };
        });
        root.querySelectorAll("[data-open]").forEach((b) => {
          b.onclick = () => openCase(list.find((c) => String(c.id) === b.dataset.open), d.faceRequired);
        });
      },
    };
  },
};

/* Aperçu d'un dossier : les TROIS pièces (recto, verso, visage) chargées en
   blob, décision motivée. `faceRequired` vient du serveur : c'est la politique
   en vigueur, pas une préférence locale. */
function openCase(c, faceRequired = false) {
  if (!c) return;
  const canReview = can("kyc.review");
  const pieces = { recto: !!c.bytes_recto, verso: !!c.bytes_verso, visage: !!c.has_face };
  /* Ce qui BLOQUE une validation, si elle était demandée maintenant. Le serveur
     applique exactement la même règle (`PIECES_INCOMPLETES`) : l'écran l'annonce
     avant le clic, le serveur la refuse de toute façon. */
  const bloquantes = ["recto", "verso"].filter((f) => !pieces[f])
    .concat(faceRequired && !pieces.visage ? ["visage"] : []);
  const avis = bloquantes.length
    ? `<div class="a-notice bad" style="margin-top:10px">Validation impossible : pièce(s) manquante(s)
        — ${esc(bloquantes.join(", "))}.</div>`
    : (faceRequired ? ""
      : `<div class="a-notice info" style="margin-top:10px">Scan facial
          ${pieces.visage ? "fourni" : "non fourni (capture côté joueur non livrée)"} —
          il n'est pas exigé tant que le réglage « Exiger le scan facial » est éteint.</div>`);

  const el = dialog({
    title: "Dossier de " + (c.pseudo || ("compte " + c.user_id)),
    okLabel: canReview ? "Approuver" : "Fermer",
    /* Décision sur une identité : le clic à côté ne doit pas clore le dossier
       (on le rouvrirait pour rien, et le geste « approuver » est irréversible). */
    critical: canReview,
    bodyHtml: `<div class="a-grid cols-3" data-docs>
        <div class="a-muted">Chargement…</div>
        <div class="a-muted">Chargement…</div>
        <div class="a-muted">${pieces.visage ? "Chargement…" : "Visage absent"}</div>
      </div>
      ${avis}
      ${canReview ? `<label class="a-field" style="margin-top:12px"><span>Motif (obligatoire pour un refus)</span>
        <textarea name="reason" rows="3" maxlength="500"
          placeholder="Ce que le joueur lira…"></textarea></label>` : ""}`,
    onOk: async (f) => {
      if (!canReview) return true;
      const reason = String(f.reason || "").trim();
      if (reason.length < 5) throw new Error("Un motif de 5 caractères minimum est obligatoire.");
      await api("/api/admin/kyc/" + c.id + "/approve", "POST", { reason });
      toast("Dossier approuvé.", "ok"); reload();
      return true;
    },
  });

  /* Une pièce manquante désactive le bouton d'approbation (le serveur refuserait
     de toute façon : on ne laisse pas cliquer pour rien). */
  if (canReview && bloquantes.length) {
    const ok = el.querySelector("[data-ok]");
    if (ok) { ok.disabled = true; ok.title = "Pièce(s) manquante(s) : " + bloquantes.join(", "); }
  }

  const host = el.querySelector("[data-docs]");
  /* L'ouverture est JOURNALISÉE côté serveur (action `kyc.open`). On l'annonce
     AVANT de télécharger quoi que ce soit : le journal doit dire « qui a
     regardé quel dossier » même si l'image ne se charge pas. L'échec de cette
     annonce n'empêche pas l'examen — il est seulement silencieux. */
  api("/api/admin/kyc/" + c.id + "/open", "POST", {}).catch(() => {});
  (async () => {
    const faces = [["recto", "Recto"], ["verso", "Verso"], ["visage", "Visage (selfie)"]];
    const cells = [];
    for (const [face, label] of faces) {
      if (!pieces[face]) {
        cells.push(`<figure style="margin:0"><div class="a-doc" style="cursor:default">
            <div class="a-muted" style="padding:40px 8px;text-align:center;font-size:12px">Pièce absente</div>
          </div><figcaption class="a-muted" style="font-size:11px;margin-top:4px">${esc(label)}</figcaption></figure>`);
        continue;
      }
      try {
        const url = await fetchDoc(c.id, face);
        cells.push(`<figure style="margin:0">
          <img src="${esc(url)}" alt="${esc(label)} de la pièce d'identité"
            style="width:100%;border-radius:8px;border:1px solid var(--a-border);display:block">
          <figcaption class="a-muted" style="font-size:11px;margin-top:4px">${esc(label)}</figcaption></figure>`);
      } catch (e) {
        cells.push(`<div class="a-notice bad">${esc(label)} : ${esc(e.message)}</div>`);
      }
    }
    host.innerHTML = cells.join("");
  })();

  if (canReview) {
    const foot = el.querySelector(".a-dialog-foot");
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "a-btn danger";
    reject.textContent = "Refuser";
    reject.onclick = async () => {
      const reason = await askReason({
        title: "Refuser ce dossier", okLabel: "Refuser",
        question: "Le motif est transmis tel quel au joueur : il doit lui dire quoi corriger.",
      });
      if (!reason) return;
      try {
        await api("/api/admin/kyc/" + c.id + "/reject", "POST", { reason });
        toast("Dossier refusé.", "ok");
        el.close(); el.remove(); reload();
      } catch (e) { toast(e.message, "bad"); }
    };
    foot.insertBefore(reject, foot.firstChild);
  }
}

/* ---------- Litiges ---------- */
const disputes = {
  id: "disputes", label: "Fair-play & litiges", group: "Communauté", perm: "disputes.read",
  desc: "Signalements, contrôle des résultats et suites données.",
  load() {
    const status = S.tab.disputes || "all";
    return api("/api/admin/disputes?status=" + encodeURIComponent(status) + "&limit=200");
  },
  render(d) {
    const status = S.tab.disputes || "all";
    const list = d.disputes || [];
    const stateTag = (s) => s === "open" ? tag("À examiner", "warn")
      : s === "investigating" ? tag("En examen", "info")
      : s === "resolved" ? tag("Résolu", "ok") : tag("Rejeté", "neutral");

    const rows = list.map((x) => [
      { html: `<strong>${esc(x.category)}</strong>
        <div class="a-muted" style="font-size:11px">partie #${esc(x.matchId)}${x.pseudo ? " · " + esc(x.pseudo) : ""}</div>` },
      { html: `<span class="a-trunc" title="${esc(x.reason)}">${esc(x.reason)}</span>` },
      { html: stateTag(x.status) },
      esc(when(x.createdAt)),
      { html: (x.status === "resolved" || x.status === "rejected")
        ? `<span class="a-muted">${esc(x.resolution || "")}</span>`
        : (can("disputes.review") ? `<button class="a-btn small" data-resolve="${x.id}" data-match="${esc(x.matchId)}">Traiter</button>` : "") },
    ]);

    return {
      html: `${tabs([
        ["all", "Tous", list.length], ["open", "À examiner"], ["investigating", "En examen"], ["resolved", "Résolus"],
      ], status, "dstatus")}
      ${panel("Litiges", table({
        head: ["Motif", "Exposé", "État", "Ouvert le", ""], rows,
        empty: "Aucun litige. Un résultat contesté arrive ici depuis une partie.",
      }), "", `<span>${list.length} litige(s)</span>`) }`,
      wire(root) {
        root.querySelectorAll("[role=tab]").forEach((b) => {
          b.onclick = () => { S.tab.disputes = b.dataset.dstatus; reload(); };
        });
        root.querySelectorAll("[data-resolve]").forEach((b) => {
          b.onclick = () => resolveDialog(b.dataset.resolve, b.dataset.match);
        });
      },
    };
  },
};

function resolveDialog(id, matchId) {
  dialog({
    title: "Traiter le litige #" + id,
    okLabel: "Enregistrer",
    bodyHtml: `<label class="a-field"><span>Décision</span>
        <select name="status">
          <option value="investigating">Mettre en examen</option>
          <option value="resolved">Résoudre</option>
          <option value="rejected">Rejeter le signalement</option>
        </select></label>
      <label class="a-field"><span>Suite donnée au résultat</span>
        <select name="outcome">
          <option value="none">Aucune — le résultat est confirmé</option>
          <option value="corrected">Résultat corrigé (à faire sur la partie)</option>
          <option value="void">Partie annulée</option>
        </select></label>
      <label class="a-field"><span>Motivation (obligatoire pour clore)</span>
        <textarea name="resolution" rows="3" maxlength="1000"></textarea></label>
      <p class="a-muted" style="font-size:12px">Annuler une partie ne recalcule pas l'Elo : une correction
        rétroactive du classement est une décision séparée, prise sur la partie concernée.</p>`,
    onOk: async (f) => {
      await api("/api/admin/disputes/" + id + "/resolve", "POST", {
        status: f.status, outcome: f.outcome, resolution: f.resolution,
      });
      toast("Litige mis à jour.", "ok"); reload();
      return true;
    },
  });
  void matchId;
}

export default { users, kyc, disputes };
export { revokeDocs as revoke };
