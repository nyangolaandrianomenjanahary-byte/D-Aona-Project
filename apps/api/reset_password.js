/* =========================================================
   D-aôna — Réinitialisation d'un mot de passe (outil d'exploitation)
   ---------------------------------------------------------
   Utile quand un joueur a perdu son mot de passe : l'application ne
   dispose ni d'email ni de SMS vérifié, donc aucune récupération
   automatique n'est possible pour l'instant. L'exploitant agit depuis la
   console, sur le PC hôte — c'est le seul canal de confiance existant.

   Le nouveau mot de passe est passé en argument : il n'est jamais écrit
   dans un fichier ni journalisé, mais l'opération est tracée dans
   auth_audit_log (sans le secret).

   Usage :
     node reset_password.js <pseudo> "<nouveauMotDePasse>"
   ========================================================= */
"use strict";

const { User } = require("./db");
const Auth = require("./auth");

(async () => {
  const args = process.argv.slice(2);
  const pseudo = args[0];
  const pwd = args[1];

  if (!pseudo || !pwd) {
    console.log('Usage : node reset_password.js <pseudo> "<nouveauMotDePasse>"');
    process.exit(1);
  }

  const user = User.getByPseudo(Auth.normalizePseudo(pseudo));
  if (!user) {
    console.log("Aucun compte ne porte le pseudo « " + pseudo + " ».");
    process.exit(1);
  }

  const check = Auth.validatePassword(pwd);
  if (!check.ok) {
    console.log("Mot de passe refusé : " + check.error + " → manque : " + check.missing.join(", "));
    process.exit(1);
  }

  await Auth.setPasswordHash(user.id, pwd);
  // Toutes les sessions tombent : un mot de passe réinitialisé ne doit pas
  // laisser survivre une session ouverte avec l'ancien secret.
  const revoked = Auth.revokeAllSessions(user.id, "reset_par_exploitant");
  Auth.audit({
    event: "password_change",
    userId: user.id,
    pseudo: user.pseudo,
    detail: "reinitialisation par l'exploitant (console)",
  });

  console.log("✅ Mot de passe redéfini pour « " + user.pseudo + " » (id " + user.id + ").");
  console.log("   " + revoked + " session(s) révoquée(s) — le joueur doit se reconnecter.");
})();