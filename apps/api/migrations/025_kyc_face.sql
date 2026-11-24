-- =========================================================
-- 025 — KYC : le scan facial (selfie / liveness) et la rétention
-- =========================================================
-- État au moment d'écrire : la CAPTURE se fait dans l'application JOUEUR, qui
-- n'est pas encore livrée. Le back-office, lui, doit déjà pouvoir :
--   · recevoir et stocker la pièce si un client l'envoie ;
--   · l'afficher, la journaliser, et refuser une validation incomplète ;
--   · connaître la durée de conservation attachée au dossier.
-- D'où des colonnes NULLABLES : un dossier d'avant cette migration n'a pas de
-- visage, et on ne l'invente pas. L'écran affiche « non fourni » et la fiche
-- explique ce qui reste à faire côté joueur.
--
-- `face_consent_at` : instant du consentement explicite recueilli AVANT la
-- capture. Le serveur y inscrit l'heure de réception de la pièce (il ne peut pas
-- vérifier l'horloge du client) — c'est une borne de traçabilité, pas une preuve.
--
-- `retention_until` : date au-delà de laquelle le dossier doit être purgé.
-- Calculée à la décision (12 mois), jamais à l'envoi : un dossier en attente
-- n'a pas encore de terme.
ALTER TABLE kyc_cases ADD COLUMN face_path        TEXT;
ALTER TABLE kyc_cases ADD COLUMN face_mime        TEXT;
ALTER TABLE kyc_cases ADD COLUMN face_bytes       INTEGER;
ALTER TABLE kyc_cases ADD COLUMN face_sha         TEXT;
ALTER TABLE kyc_cases ADD COLUMN face_captured_at TEXT;
ALTER TABLE kyc_cases ADD COLUMN face_consent_at  TEXT;
ALTER TABLE kyc_cases ADD COLUMN retention_until  TEXT;
