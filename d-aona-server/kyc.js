/* =========================================================
   D-aôna — Vérification d'identité (KYC) : dossiers recto + verso
   ---------------------------------------------------------
   Ce que faisait le code précédent : la route `/api/kyc/verify` mettait
   `users.kyc = 1` sans recevoir la moindre image. La « vérification » était donc
   une simulation d'interface — une simple requête HTTP suffisait à se déclarer
   vérifié, puis à déposer, retirer et miser de l'argent réel.

   Règle retenue ici, la seule qui existe désormais : **revue manuelle**.
     1. Le joueur envoie DEUX photos de sa carte d'identité (recto ET verso).
     2. Le serveur vérifie le CONTENU binaire, calcule une empreinte SHA-256,
        refuse deux faces identiques, stocke les fichiers HORS de la racine
        web (private/kyc/) et ouvre un dossier « pending ».
     3. Un administrateur (permission `kyc.review`) approuve ou refuse, avec
        motif. Lui seul met `users.kyc = 1`.

   Choix de conception :
     · `users.kyc` reste LA colonne qui dit « vérifié » : ~30 routes métier la
       lisent déjà (`!user.kyc`), aucune n'est à modifier.
     · Les fichiers ne sont JAMAIS servis par le serveur statique : ils vivent
       dans `private/`, en dehors de `uploads/` et de la racine web, et seule la
       route d'administration (authentifiée + auditée) les lit, à partir du
       chemin ENREGISTRÉ EN BASE — jamais d'un chemin fourni par l'URL.
     · Le nom des fichiers est généré par le serveur (horodatage + empreinte) :
       un nom fourni par le client ne peut pas traverser un dossier.
     · Trois envois par 24 h et un seul dossier ouvert : la file de revue reste
       lisible et un refus ne peut pas être noyé sous des envois en série.
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { db } = require("./db");
const { imageMagicOk, detectImageExt, MIME_BY_EXT } = require("./image");
/* Le réglage `kyc_face_required` vit avec les réglages de la plateforme : c'est
   lui qui rendra le scan facial OBLIGATOIRE le jour où la capture côté joueur
   sera livrée. Tant qu'il est éteint, la validation reste possible sans visage
   (dossiers « legacy »), sinon plus aucun dossier ne pourrait être validé. */
const Settings = require("./admin/store.v2");

const KYC_DIR = path.resolve(__dirname, "private", "kyc");
const MAX_FACE_BYTES = 2 * 1024 * 1024;      // 2 Mo par face (le client réduit à ~300 Ko)
const MAX_PER_DAY = 3;
const FACE_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i;

/* ---------- Décodage d'une face ---------- */
/* Renvoie { ok:true, buf, ext } ou { ok:false, code, error, status }.
   Les codes sont des constantes lisibles côté client, pas des phrases à
   comparer : seule la phrase affichée peut changer sans casser un test. */
function decodeFace(raw, which) {
  const label = which === "verso" ? "verso" : (which === "visage" ? "visage" : "recto");
  const code = which === "verso" ? "VERSO_REQUIRED" : (which === "visage" ? "VISAGE_REQUIRED" : "RECTO_REQUIRED");
  if (typeof raw !== "string" || !raw) {
    return { ok: false, code, status: 400,
      error: which === "verso"
        ? "Le verso de la carte d'identité est obligatoire"
        : which === "visage"
          ? "Le scan facial (selfie) est obligatoire"
          : "Le recto de la carte d'identité est obligatoire" };
  }
  const m = raw.match(FACE_RE);
  if (!m) return { ok: false, code: "FORMAT_INVALIDE", status: 400, error: `Image ${label} : format base64 attendu` };
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_FACE_BYTES)
    return { ok: false, code: "IMAGE_TROP_LOURDE", status: 400, error: `Image ${label} trop lourde (max 2 Mo)` };
  /* Le contenu décide, pas l'extension déclarée — et l'extension retenue est
     celle RÉELLEMENT détectée (un PNG annoncé « .jpg » est stocké en .png). */
  if (!imageMagicOk(buf, ext) || detectImageExt(buf) === null)
    return { ok: false, code: "CONTENU_INVALIDE", status: 400,
      error: `Le contenu de l'image ${label} ne correspond pas à un format accepté` };
  return { ok: true, buf, ext: detectImageExt(buf) };
}

/* ---------- Chemins ---------- */
/* Un chemin de fichier ne doit jamais sortir du dossier privé, même si la base
   contenait une valeur inattendue (restauration, édition manuelle). */
function insideKycDir(abs) {
  const rel = path.relative(KYC_DIR, abs);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function facePath(relPath) {
  const abs = path.resolve(__dirname, relPath);
  return insideKycDir(abs) ? abs : null;
}

function removeFile(relPath) {
  const abs = facePath(relPath);
  if (!abs) return;
  try { fs.unlinkSync(abs); } catch (e) { /* déjà absent : rien à faire */ }
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* ---------- État courant d'un joueur ---------- */
/* Quatre états, dans cet ordre de priorité :
     pending  — un dossier attend la revue (il prime sur tout le reste) ;
     verified — `users.kyc = 1` (revue approuvée, ou compte d'avant la v2) ;
     rejected — dernier dossier refusé, motif conservé ;
     none     — rien n'a jamais été envoyé. */
function statusOf(userId) {
  if (!userId) return { status: "none", reason: null, submitted_at: null };
  const u = db.prepare("SELECT kyc FROM users WHERE id = ?").get(userId);
  const last = db.prepare(
    "SELECT status, reason, submitted_at, reviewed_at FROM kyc_cases WHERE user_id = ? ORDER BY id DESC LIMIT 1"
  ).get(userId);
  if (last && last.status === "pending")
    return { status: "pending", reason: null, submitted_at: last.submitted_at };
  if (u && u.kyc)
    return { status: "verified", reason: null, submitted_at: last ? last.submitted_at : null };
  if (last && last.status === "rejected")
    return { status: "rejected", reason: last.reason || null, submitted_at: last.submitted_at, reviewed_at: last.reviewed_at };
  return { status: "none", reason: null, submitted_at: null };
}

function countSubmissionsSince(userId, hours = 24) {
  return db.prepare(
    "SELECT COUNT(*) AS c FROM kyc_cases WHERE user_id = ? AND submitted_at >= datetime('now', ?)"
  ).get(userId, `-${hours} hours`).c;
}

/* ---------- Envoi d'un dossier ---------- */
/* Écrit les deux faces sur disque puis ouvre le dossier. L'ordre compte :
   on vérifie TOUT (les deux faces, leur différence, le quota) avant de toucher
   au disque, sinon un refus laisserait des fichiers orphelins. */
function submit(userId, payload = {}) {
  const user = db.prepare("SELECT id, kyc FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, code: "JOUEUR_INCONNU", status: 404, error: "Joueur introuvable" };
  if (user.kyc) return { ok: false, code: "DEJA_VERIFIE", status: 409, error: "Votre identité est déjà vérifiée" };

  const recto = decodeFace(payload.recto, "recto");
  if (!recto.ok) return recto;
  const verso = decodeFace(payload.verso, "verso");
  if (!verso.ok) return verso;
  /* ---------- Scan facial : FACULTATIF à l'envoi ----------
     La capture se fait dans l'application joueur, qui n'est pas livrée : le
     serveur accepte donc la pièce SI elle est fournie, et ne la réclame pas.
     C'est le réglage `kyc_face_required` qui décide de l'EXIGER à la validation
     (voir `review`). Un envoi sans visage reste donc valide côté soumission —
     et l'écran d'examen dit exactement ce qui manque. */
  const visage = payload.visage ? decodeFace(payload.visage, "visage") : null;
  if (visage && !visage.ok) return visage;
  /* La règle est celle du RÉGLAGE au moment de l'envoi, et elle est FIGÉE dans
     le dossier (migration 029). Sans cela, activer l'exigence rendrait
     invalides des dossiers déposés avant elle. */
  const faceRequired = Settings.setting("kyc_face_required") === true;
  if (faceRequired && !visage)
    return { ok: false, code: "VISAGE_REQUIRED", status: 400,
      error: "Le selfie (visage) est obligatoire pour vérifier votre identité" };

  const rectoSha = sha256(recto.buf);
  const versoSha = sha256(verso.buf);
  const visageSha = visage ? sha256(visage.buf) : null;
  /* Deux faces identiques = la même photo envoyée deux fois : le verso n'a pas
     été photographié. C'est le contournement le plus évident du dispositif. */
  if (rectoSha === versoSha)
    return { ok: false, code: "MEME_IMAGE", status: 400,
      error: "Les deux faces sont identiques — photographiez le recto ET le verso" };
  /* Le selfie ne peut pas être une photo de la carte : deux pièces identiques
     signalent un envoi bâclé, et l'examen perdrait son sens. */
  if (visageSha && (visageSha === rectoSha || visageSha === versoSha))
    return { ok: false, code: "MEME_IMAGE", status: 400,
      error: "Le scan facial ne peut pas être une photo de la carte d'identité" };

  const recent = countSubmissionsSince(userId, 24);
  if (recent >= MAX_PER_DAY)
    return { ok: false, code: "TROP_DE_SOUMISSIONS", status: 429,
      error: `Trop d'envois (${MAX_PER_DAY} par 24 h). Réessayez demain.` };

  const dir = path.join(KYC_DIR, String(userId));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  /* Nom généré : horodatage + 8 caractères d'empreinte. Rien de ce que le
     client envoie n'entre dans le nom du fichier. */
  const rectoName = `${stamp}-recto-${rectoSha.slice(0, 8)}.${recto.ext}`;
  const versoName = `${stamp}-verso-${versoSha.slice(0, 8)}.${verso.ext}`;
  const rectoRel = path.join("private", "kyc", String(userId), rectoName).replace(/\\/g, "/");
  const versoRel = path.join("private", "kyc", String(userId), versoName).replace(/\\/g, "/");
  let visageRel = null;
  if (visage) {
    const visageName = `${stamp}-visage-${visageSha.slice(0, 8)}.${visage.ext}`;
    visageRel = path.join("private", "kyc", String(userId), visageName).replace(/\\/g, "/");
  }

  /* Une nouvelle demande REMPLACE la précédente : un seul dossier OUVERT par
     joueur (index partiel unique). L'ancien dossier n'est pas effacé de la table
     mais marqué « remplacé » : c'est ce qui permet de COMPTER les envois sur
     24 h (quota anti-noyage) — une ligne supprimée ne se compte plus. Ses
     fichiers, eux, sont effacés : conserver les CIN de demandes abandonnées n'a
     aucune raison d'être. */
  const previous = db.prepare("SELECT * FROM kyc_cases WHERE user_id = ? AND status = 'pending'").get(userId);
  if (previous) {
    db.prepare(
      "UPDATE kyc_cases SET status = 'rejected', reviewed_at = datetime('now'), reason = ? WHERE id = ?"
    ).run("Remplacé par un nouvel envoi du joueur", previous.id);
    removeFile(previous.recto_path);
    removeFile(previous.verso_path);
  }

  fs.writeFileSync(facePath(rectoRel), recto.buf);
  fs.writeFileSync(facePath(versoRel), verso.buf);
  if (visageRel) fs.writeFileSync(facePath(visageRel), visage.buf);

  const nowIso = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO kyc_cases (user_id, status, recto_path, verso_path, recto_sha, verso_sha,
                            mime_recto, mime_verso, bytes_recto, bytes_verso,
                            face_path, face_mime, face_bytes, face_sha, face_captured_at, face_consent_at,
                            face_required)
     VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, rectoRel, versoRel, rectoSha, versoSha,
    MIME_BY_EXT[recto.ext], MIME_BY_EXT[verso.ext], recto.buf.length, verso.buf.length,
    visageRel, visage ? MIME_BY_EXT[visage.ext] : null, visage ? visage.buf.length : null,
    visageSha, visage ? nowIso : null, visage ? nowIso : null,
    faceRequired ? 1 : 0);

  return {
    ok: true, status: "pending", caseId: info.lastInsertRowid,
    submitted_at: nowIso,
    /* Empreintes et tailles remontées pour le journal : jamais les images. */
    recto: { sha256: rectoSha, bytes: recto.buf.length, mime: MIME_BY_EXT[recto.ext] },
    verso: { sha256: versoSha, bytes: verso.buf.length, mime: MIME_BY_EXT[verso.ext] },
    visage: visage ? { sha256: visageSha, bytes: visage.buf.length, mime: MIME_BY_EXT[visage.ext] } : null,
  };
}


/* ---------- File de revue (administration) ---------- */
const STATUSES = ["pending", "verified", "rejected"];

function listForReview(status = "pending", limit = 100) {
  const st = STATUSES.includes(status) ? status : "pending";
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const rows = db.prepare(
    `SELECT c.id, c.user_id, c.status, c.reason, c.submitted_at, c.reviewed_at, c.reviewer_id,
            c.bytes_recto, c.bytes_verso, c.recto_sha, c.verso_sha,
            c.face_path, c.face_bytes, c.face_captured_at, c.retention_until,
            u.pseudo, u.elo, u.avatar, u.province
     FROM kyc_cases c JOIN users u ON u.id = c.user_id
     WHERE c.status = ?
     ORDER BY c.submitted_at ASC, c.id ASC
     LIMIT ?`
  ).all(st, n);
  return rows.map((r) => ({
    id: r.id, user_id: r.user_id, pseudo: r.pseudo, elo: r.elo, avatar: r.avatar || null,
    province: r.province || null, status: r.status, reason: r.reason || null,
    submitted_at: r.submitted_at, reviewed_at: r.reviewed_at, reviewer_id: r.reviewer_id,
    bytes_recto: r.bytes_recto, bytes_verso: r.bytes_verso,
    /* Le scan facial est signalé par sa PRÉSENCE, jamais par son contenu : la
       file de revue n'a pas à transporter une image. */
    has_face: !!r.face_path, face_bytes: r.face_bytes || null,
    face_captured_at: r.face_captured_at || null,
    retention_until: r.retention_until || null,
    /* Empreintes tronquées : elles servent au support à reconnaître un doublon,
       pas à reconstituer une image. */
    recto_sha8: String(r.recto_sha || "").slice(0, 8), verso_sha8: String(r.verso_sha || "").slice(0, 8),
  }));
}

function get(caseId) {
  return db.prepare("SELECT * FROM kyc_cases WHERE id = ?").get(caseId) || null;
}

/* Décision d'un administrateur. `approve` met `users.kyc = 1` et c'est le SEUL
   endroit du code qui le fasse ; `reject` conserve le motif pour que le joueur
   sache quoi reprendre, et efface les images (elles ont servi). */
function review(caseId, { approve, reason = null, reviewerId = null } = {}) {
  const c = get(caseId);
  if (!c) return { ok: false, code: "DOSSIER_INCONNU", status: 404, error: "Dossier introuvable" };
  if (c.status !== "pending")
    return { ok: false, code: "DEJA_TRAITE", status: 409, error: "Ce dossier a déjà été traité" };
  /* Un administrateur ne valide pas sa propre identité : sans cette barrière,
     la permission `kyc.review` vaudrait auto-vérification pour son titulaire. */
  if (reviewerId && c.user_id === reviewerId)
    return { ok: false, code: "SELF_APPROVAL", status: 403,
      error: "Vous ne pouvez pas traiter votre propre dossier d'identité" };

  if (approve) {
    /* « Validé » exige TOUTES les pièces. Recto et verso depuis toujours ; le
       VISAGE seulement si l'exploitant l'exige (`kyc_face_required`). Pourquoi
       ce réglage : la capture du selfie se fait dans l'application joueur, qui
       n'est pas livrée — exiger le visage aujourd'hui bloquerait TOUTE
       validation. Le jour où la capture arrive, il suffit d'allumer le réglage
       dans Paramètres : aucune ligne de code à retoucher. */
    const manquantes = [];
    if (!c.recto_path) manquantes.push("recto");
    if (!c.verso_path) manquantes.push("verso");
    /* Le selfie est exigé si le DOSSIER l'exigeait à l'envoi — pas selon le
       réglage courant : activer l'exigence aujourd'hui ne peut pas invalider
       un dossier déposé hier (migration 029). */
    if (c.face_required && !c.face_path) manquantes.push("visage");
    if (manquantes.length)
      return { ok: false, code: "PIECES_INCOMPLETES", status: 409,
        error: `Validation impossible : pièce(s) manquante(s) — ${manquantes.join(", ")}` };
    /* `retention_until` : 12 mois après la décision. Une durée de conservation
       qui ne serait écrite nulle part n'existerait pas. */
    db.prepare(
      `UPDATE kyc_cases SET status = 'verified', reviewed_at = datetime('now'), reviewer_id = ?,
              reason = NULL, retention_until = datetime('now', '+12 months') WHERE id = ?`
    ).run(reviewerId, caseId);
    db.prepare("UPDATE users SET kyc = 1 WHERE id = ?").run(c.user_id);
    return { ok: true, status: "verified", userId: c.user_id };
  }

  const why = String(reason || "").trim().slice(0, 300);
  if (why.length < 3)
    return { ok: false, code: "MOTIF_REQUIS", status: 400, error: "Indiquez un motif de refus (3 caractères minimum)" };
  db.prepare(
    "UPDATE kyc_cases SET status = 'rejected', reviewed_at = datetime('now'), reviewer_id = ?, reason = ? WHERE id = ?"
  ).run(reviewerId, why, caseId);
  /* Défense en profondeur : `users.kyc` ne doit pas rester à 1 si un dossier
     encore ouvert est refusé (compte déverrouillé par erreur). */
  db.prepare("UPDATE users SET kyc = 0 WHERE id = ?").run(c.user_id);
  removeFile(c.recto_path);
  removeFile(c.verso_path);
  removeFile(c.face_path);
  return { ok: true, status: "rejected", userId: c.user_id, reason: why };
}

/* Lecture d'une pièce par un administrateur : le chemin vient de la BASE, il est
   re-résolu puis contrôlé (aucune traversée possible par l'URL). */
function openDoc(caseId, face) {
  const c = get(caseId);
  if (!c) return null;
  const rel = face === "verso" ? c.verso_path
    : face === "recto" ? c.recto_path
    : face === "visage" ? c.face_path
    : null;
  if (!rel) return null;
  const abs = facePath(rel);
  if (!abs || !fs.existsSync(abs)) return null;
  const mime = face === "verso" ? c.mime_verso : (face === "visage" ? c.face_mime : c.mime_recto);
  return { buf: fs.readFileSync(abs), mime, name: path.basename(abs) };
}

module.exports = {
  KYC_DIR, MAX_FACE_BYTES, MAX_PER_DAY, STATUSES,
  statusOf, submit, review, listForReview, get, openDoc, countSubmissionsSince,
};
