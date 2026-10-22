"use strict";
const assert = require("node:assert");
const mm = require("../live/matchmaking");

/* Deux jeux, meme format : aucune paire ne doit se former. */
mm.enqueue("fanorona", "blitz", { userId: 1, mode: "online", elo: 1000 });
mm.enqueue("katro", "blitz", { userId: 2, mode: "online", elo: 1000 });
assert.strictEqual(mm.drainPairs().length, 0, "deux jeux differents se sont apparies");

/* Un second joueur du MEME jeu : la paire se forme, dans le bon format. */
mm.enqueue("fanorona", "blitz", { userId: 3, mode: "online", elo: 900 });
const pairs = mm.drainPairs();
assert.strictEqual(pairs.length, 1, "la paire fanorona/blitz n a pas ete formee");
assert.strictEqual(pairs[0].key, "fanorona/blitz");
assert.strictEqual(mm.formatOf(pairs[0].key), "blitz");
assert.deepStrictEqual(pairs[0].pair.map((e) => e.userId).sort(), [1, 3]);

/* Le joueur katro reste seul dans sa file : il n a pas ete consomme. */
assert.strictEqual(mm.takeOpponent("katro", "blitz", 2), null);

/* Sortie de file par annulation / deconnexion. */
mm.enqueue("fanorona", "rapide", { userId: 9, mode: "online" });
mm.removeUser(9);
assert.strictEqual(mm.takeOpponent("fanorona", "rapide", 42), null);

console.log("PREUVE OK : files etanches par jeu/format, paires correctes, purges effectives");