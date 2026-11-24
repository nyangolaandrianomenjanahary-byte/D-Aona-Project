// Remet à zéro le TOURNOI TEST #5 (vidé, ouvert) pour relancer un test.
// Usage : node reset_test_tournament.js   (serveur arrêté, sinon relancer après)
const { db, Tournament } = require("./db");
db.exec("BEGIN");
db.prepare("DELETE FROM tournament_matches WHERE tournament_id = 5").run();
db.prepare("DELETE FROM tournament_registrations WHERE tournament_id = 5").run();
db.prepare("DELETE FROM notifications WHERE payload_json LIKE '%\"tournamentId\":5%'").run();
db.prepare("UPDATE tournaments SET status='inscriptions', results_json=NULL WHERE id = 5").run();
db.exec("COMMIT");
const t = db.prepare("SELECT status, starts_at FROM tournaments WHERE id=5").get();
console.log("Tournoi Test #5 remis en inscriptions.", t);