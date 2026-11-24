/* =========================================================
   030 — Profil : identité déclarée (nom, prénom, naissance) et bio
   ---------------------------------------------------------
   Le Profil n'avait AUCUN champ d'identité : pseudo, province, téléphone à
   l'inscription, et c'est tout. Le PRD demande cinq champs obligatoires, dont
   trois nouveaux.

   `users.phone` existe déjà (inscription) : il n'est pas dupliqué ici.
   Les colonnes sont NULLABLES : les comptes existants n'ont rien à remplir
   pour continuer à jouer — l'interface affiche un rappel « Profil à
   compléter », elle ne bloque rien (décision produit).
   ========================================================= */

ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name  TEXT;
ALTER TABLE users ADD COLUMN birth_date TEXT;
ALTER TABLE users ADD COLUMN bio        TEXT;
