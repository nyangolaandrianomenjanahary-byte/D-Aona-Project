/* Fanoron-Telo - point d entree du jeu : regles pures + session. */
"use strict";
module.exports = { ...require("./engine"), ...require("./session") };
