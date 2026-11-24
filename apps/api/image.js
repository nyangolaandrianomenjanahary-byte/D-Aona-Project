/* =========================================================
   D-aôna — Signature binaire des images
   ---------------------------------------------------------
   Le type DÉCLARÉ (extension d'un dataURL, en-tête Content-Type) doit
   correspondre au CONTENU réel : sans ce contrôle, un fichier HTML renommé
   « .png » serait stocké puis servi depuis la même origine. Les formats
   acceptés sont déjà sans SVG ; ce module ferme le dernier écart
   (contenu ≠ déclaration).

   Extrait de server.js pour être partagé par les deux routes qui reçoivent des
   images (photo de profil et pièces d'identité) : deux copies de cette
   vérification finiraient par diverger, et c'est la plus faible qui déciderait.
   ========================================================= */
"use strict";

const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function imageMagicOk(buf, ext) {
  if (!buf || buf.length < 12) return false;
  if (ext === "png") return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  if (ext === "jpg") return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
  if (ext === "gif") { const h = buf.slice(0, 6).toString("ascii"); return h === "GIF87a" || h === "GIF89a"; }
  if (ext === "webp") return buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";
  return false;
}

/* Extension réelle déduite des premiers octets (null si inconnue). */
function detectImageExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "png";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "jpg";
  const head = buf.slice(0, 6).toString("ascii");
  if (head === "GIF87a" || head === "GIF89a") return "gif";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

module.exports = { imageMagicOk, detectImageExt, MIME_BY_EXT };
