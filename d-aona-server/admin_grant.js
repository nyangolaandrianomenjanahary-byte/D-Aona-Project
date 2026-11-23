/* =========================================================
   D-aôna — Attribution du premier rôle d'administration (script hôte)
   ---------------------------------------------------------
   Problème d'amorçage : les routes d'administration exigent un rôle, et donner
   un rôle est une route d'administration. Sans porte de service, la seule façon
   de créer le premier super administrateur serait d'écrire directement en base
   avec un outil externe — non tracé et dépendant de la machine.

   D'où ce script : il tourne SUR LA MACHINE DU SERVEUR (accès au fichier de
   base), pas par le réseau. Il n'existe volontairement AUCUN lien d'invitation
   public : un lien de ce type, s'il fuit, offre les pleins pouvoirs.

   Usage :
     node admin_grant.js list                       → qui détient quel rôle
     node admin_grant.js bootstrap                  → super administrateur aux 2 comptes désignés
     node admin_grant.js grant  <pseudo|email> [role] → attribue (super_admin par défaut)
     node admin_grant.js revoke <pseudo|email> [role] → retire
     node admin_grant.js self-kyc <pseudo|email>    → vérifie SON identité (exploitant seul)

   L'identifiant peut être un PSEUDO ou une ADRESSE E-MAIL : l'adresse est le
   critère d'attribution demandé, et deux pseudos peuvent se ressembler
   (« Ifehizoro » et « Ifehizoro7 »).

   Chaque commande écrit dans admin_audit avec l'acteur « script:hôte », pour que
   la trace existe aussi quand l'action ne vient pas de l'interface.
   ========================================================= */
"use strict";

const { db, User } = require("./db");
const Store = require("./admin/store");
const Kyc = require("./kyc");

const ACTOR = "script:hôte";

/* Comptes désignés par la demande de mise en production. Le script n'INVENTE
   jamais un compte : une adresse absente est signalée, jamais créée — ouvrir un
   compte « au nom de » quelqu'un donnerait accès à une identité qui ne lui
   appartient pas encore. */
const BOOTSTRAP_EMAILS = [
  "nyangolaandrianomenjanahary@gmail.com",
  "ifehizoro774@gmail.com",
];

/* « Adresse vérifiée » : le schéma ne stocke aucun drapeau `email_verified`
   (le projet ne vérifie pas les adresses). Le seul critère d'identité réellement
   disponible est le KYC. `bootstrap` l'exige donc, et `--force` permet à
   l'exploitant de passer outre en connaissance de cause. */
const FORCE = process.argv.includes("--force");

/* Un identifiant contenant « @ » est une ADRESSE ; sinon c'est un pseudo. */
function resolve(ident) {
  const s = String(ident || "").trim();
  if (!s) return null;
  return s.includes("@") ? User.getByEmail(s) : User.getByPseudo(s);
}

function usage() {
  console.log("Usage :");
  console.log("  node admin_grant.js list");
  console.log("  node admin_grant.js bootstrap                 [--force]");
  console.log("  node admin_grant.js grant  <pseudo|email> [role=super_admin]");
  console.log("  node admin_grant.js revoke <pseudo|email> [role]");
  console.log("  node admin_grant.js self-kyc <pseudo|email>");
  console.log("Rôles : " + db.prepare("SELECT id FROM admin_roles ORDER BY id").all().map((r) => r.id).join(", "));
}

const [cmd, ident, roleArg] = process.argv.slice(2);
Store.ensureSeed();

if (!cmd || cmd === "--help" || cmd === "-h") { usage(); process.exit(0); }

if (cmd === "list") {
  const rows = Store.listAssignments();
  if (!rows.length) console.log("Aucun rôle attribué.");
  for (const r of rows) console.log(`  ${r.role_id.padEnd(18)} ${r.pseudo}  (depuis ${r.granted_at})`);
  process.exit(0);
}

if (cmd === "bootstrap") {
  let granted = 0, skipped = 0;
  for (const email of BOOTSTRAP_EMAILS) {
    const u = User.getByEmail(email);
    if (!u) {
      console.log(`✗ ${email} — aucun compte à cette adresse.`);
      console.log("  L'intéressé doit d'abord créer son compte par l'inscription normale, puis relancer.");
      skipped++;
      continue;
    }
    if (!u.kyc && !FORCE) {
      console.log(`✗ ${u.pseudo} <${email}> — identité non vérifiée (KYC).`);
      console.log("  Vérifiez d'abord son dossier (ou relancez avec --force pour passer outre).");
      skipped++;
      continue;
    }
    const before = Store.rolesOf(u.id);
    Store.grantRole(u.id, "super_admin", null);
    if (!before.includes("super_admin")) {
      Store.audit({ actorPseudo: ACTOR, action: "roles.grant", target: `user:${u.id}`,
        detail: { pseudo: u.pseudo, email, role: "super_admin", source: "bootstrap" } });
      console.log(`✅ ${u.pseudo} <${email}> — super administrateur (id ${u.id}).`);
      granted++;
    } else {
      console.log(`= ${u.pseudo} <${email}> — déjà super administrateur (aucun doublon).`);
    }
  }
  console.log(`\n${granted} attribution(s), ${skipped} ignorée(s).`);
  process.exit(granted || !skipped ? 0 : 1);
}

const user = resolve(ident);
if (!user) {
  console.error(ident ? `Joueur introuvable : « ${ident} »` : "Identifiant manquant (pseudo ou adresse e-mail).");
  usage();
  process.exit(1);
}

if (cmd === "grant") {
  const role = roleArg || "super_admin";
  const exists = db.prepare("SELECT id FROM admin_roles WHERE id = ?").get(role);
  if (!exists) { console.error(`Rôle inconnu : « ${role} »`); process.exit(1); }
  Store.grantRole(user.id, role, null);
  Store.audit({ actorPseudo: ACTOR, action: "roles.grant", target: `user:${user.id}`,
    detail: { pseudo: user.pseudo, role, source: "script" } });
  console.log(`✅ ${user.pseudo} (id ${user.id}) détient désormais : ${Store.rolesOf(user.id).join(", ")}`);
  process.exit(0);
}

if (cmd === "revoke") {
  const role = roleArg || "super_admin";
  if (role === "super_admin" && Store.countRole("super_admin") <= 1) {
    console.error("Refusé : c'est le dernier super administrateur. Personne ne pourrait plus réparer les droits.");
    process.exit(1);
  }
  Store.revokeRole(user.id, role);
  Store.audit({ actorPseudo: ACTOR, action: "roles.revoke", target: `user:${user.id}`,
    detail: { pseudo: user.pseudo, role, source: "script" } });
  console.log(`✅ ${user.pseudo} ne détient plus : ${role}. Reste : ${Store.rolesOf(user.id).join(", ") || "aucun"}`);
  process.exit(0);
}

if (cmd === "self-kyc") {
  /* Cas de l'exploitant qui est aussi le seul joueur : la règle « on ne valide
     pas son propre dossier » rend l'auto-vérification impossible par l'API.
     Cette commande, exécutée sur la machine, l'autorise — et le motif inscrit au
     journal est distinct (« revue : exploitation locale »), pour qu'un audit
     distingue une décision collégiale d'un déverrouillage de dépannage. */
  const st = Kyc.statusOf(user.id);
  if (st.status === "verified") { console.log("Déjà vérifié."); process.exit(0); }
  const open = db.prepare("SELECT * FROM kyc_cases WHERE user_id = ? AND status = 'pending'").get(user.id);
  if (open) {
    db.prepare("UPDATE kyc_cases SET status = 'verified', reviewed_at = datetime('now'), reason = ? WHERE id = ?")
      .run("revue : exploitation locale (script hôte)", open.id);
  }
  db.prepare("UPDATE users SET kyc = 1 WHERE id = ?").run(user.id);
  Store.audit({ actorPseudo: ACTOR, action: "kyc.approve", target: `user:${user.id}`,
    detail: { pseudo: user.pseudo, source: "script", motif: "revue : exploitation locale", caseId: open ? open.id : null } });
  console.log(`✅ ${user.pseudo} est vérifié (dossier ${open ? "#" + open.id : "absent — compte sans pièces"}).`);
  process.exit(0);
}

console.error(`Commande inconnue : « ${cmd} »`);
usage();
process.exit(1);
