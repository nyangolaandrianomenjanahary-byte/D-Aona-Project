/* =========================================================
   029 — KYC : le selfie devient une pièce du DOSSIER, pas un réglage global
   ---------------------------------------------------------
   `platform_settings.kyc_face_required` dit la règle du moment. Appliquée
   telle quelle à la VALIDATION, elle rendrait invalides les dossiers déposés
   AVANT son activation — un dossier complet serait refusé pour une pièce qui
   n'était pas exigée quand il a été envoyé.

   On FIGE donc la règle dans le dossier, à l'envoi (`Kyc.submit`), et
   `Kyc.review` lit CETTE colonne. Activer le réglage ne concerne ainsi que
   les nouveaux dossiers, exactement ce qui est demandé : les nouveaux comptes
   fournissent le visage, les anciens restent validables sur leurs deux faces.
   ========================================================= */

ALTER TABLE kyc_cases ADD COLUMN face_required INTEGER NOT NULL DEFAULT 0;
