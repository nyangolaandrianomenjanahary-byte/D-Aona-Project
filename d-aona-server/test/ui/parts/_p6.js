/* =========================================================================
   S3 — ENTRAÎNEMENT CONTRE L'IA : assistant, plateau, tirage au sort, coups
   ========================================================================= */
async function wizard(page, { mode = "ai", fmt = "blitz" }) {
  /* UN CHOIX VAUT « SUIVANT » : depuis le lot « onglet Jeux », la flèche « Suivant »
     n'existe plus et le CTA (lancement) n'apparaît qu'à l'étape 4. On clique donc la
     tuile du jeu, puis le mode, puis le format — le geste réel d'un joueur. */
  await goScreen(page, "play");
  const game = page.locator("#play-root .pg-opt[data-game]");
  if (!(await game.count())) return "aucune tuile de jeu à l'étape 1 de l'assistant";
  await game.first().click();          /* étape 1 → 2 */
  await sleep(400);
  const opt = page.locator(`#play-root .pg-opt[data-mode="${mode}"]`);
  if (!(await opt.count())) return `aucune option de mode « ${mode} » à l'étape 2`;
  await opt.first().click();           /* étape 2 → 3 (sauf « défi », voir ci-dessous) */
  await sleep(400);
  if (mode === "defi") {
    /* « Défi » réclame un adversaire ET une mise : il se contente d'afficher son
       formulaire. C'est la MISE qui valide et fait avancer. */
    const w = page.locator("#play-root [data-wager]");
    if (!(await w.count())) return "aucune mise proposée pour le mode défi";
    await w.first().click();           /* étape 2 → 3 */
    await sleep(400);
  }
  const f = page.locator(`#play-root .pg-fmt[data-fmt="${fmt}"]`);
  if (!(await f.count())) return `aucun format « ${fmt} » à l'étape 3`;
  const cls = (await f.first().getAttribute("class")) || "";
  if (/off/.test(cls)) return `format « ${fmt} » indisponible pour ce mode`;
  await f.first().click();             /* étape 3 → 4 */
  await sleep(450);
  return true;
}

async function s3_ai(browser) {
  const A = await ensure(browser, "A");

  await step("assistant de jeu : 4 étapes franchies au clic (mode Entraînement IA)", async () => {
    const r = await wizard(A.page, { mode: "ai", fmt: "blitz" });
    if (r !== true) return r;
    const label = await textOf(A.page, "#pg-cta");
    if (!/entraînement/i.test(label || "")) return "libellé final du bouton inattendu : " + label;
    return true;
  });

  await step("lancement : le plateau s'ouvre avec 45 cases et 22 pions de chaque côté", async () => {
    await A.page.click("#pg-cta");
    await sleep(1300);
    if (!(await visible(A.page, "#fanorona-board"))) return "le plateau n'est pas affiché";
    const c = await pieceCounts(A.page);
    if (c.cells !== 45) return `grille incomplète : ${c.cells} cases cliquables (45 attendues)`;
    if (c.me !== 22 || c.opp !== 22) return `pions posés : ${c.me} contre ${c.opp} (22 / 22 attendus)`;
    return true;
  });

  await step("tirage au sort : la modale PILE / FACE est proposée et le choix est accepté", async () => {
    const m = await modalText(A.page);
    if (!/pile|face/i.test(m)) return "aucune modale de tirage au sort : « " + m.slice(0, 70) + " »";
    const enabled = await A.page.evaluate(() => {
      const b = ["choose-pile", "choose-face"]
        .map((id) => document.getElementById(id))
        .filter((e) => e && !e.disabled && e.offsetParent !== null);
      return b.length ? b[0].id : null;
    });
    if (!enabled) return "les deux faces sont indisponibles (tirage bloqué)";
    await A.page.click("#" + enabled);
    const closed = await modalClosed(A.page, 10000);
    return closed ? true : "la modale de tirage ne se referme pas (résultat du tirage affiché durablement)";
  });

  await step("un coup joué au clic est accepté par le plateau", async () => {
    const myTurn = await until(A.page, () => {
      const g = window.Fanorona.state();
      return !!g && !g.over && g.turn === g.playerNum;
    }, 15000);
    if (!myTurn) return "le joueur n'obtient jamais la main après le tirage";
    if (await modalOpen(A.page)) {
      const m = await modalText(A.page);
      return "une fenêtre recouvre le plateau au moment de jouer : « " + m.slice(0, 70) + " »";
    }
    const before = (await boardState(A.page)).log;
    const mv = await playMove(A.page);
    if (!mv) return "aucun coup légal cliquable trouvé";
    if (!mv.retenu) {
      return `le clic n'a pas été retenu par le plateau (coup ${mv.from} → ${mv.to}` +
        (mv.avis ? " ; interface : " + mv.avis : "") + ")";
    }
    const after = (await boardState(A.page)).log;
    return after > before ? true : "le coup joué n'est pas inscrit au journal des coups";
  });

  await step("l'IA répond automatiquement à son tour", async () => {
    const replied = await until(A.page, () =>
      document.querySelectorAll("#move-log li").length >= 2, 15000);
    if (!replied) return "aucune réponse de l'IA inscrite au journal des coups";
    return (await textOf(A.page, "#turn-banner-name")) !== null ? true : "bandeau de tour illisible";
  });

  await step("abandon : confirmation puis écran de résultat affiché", async () => {
    await A.page.click("#btn-resign");
    await sleep(500);
    if (!(await visible(A.page, "#resign-ok"))) return "la confirmation d'abandon ne s'affiche pas";
    await A.page.click("#resign-ok");
    await sleep(1300);
    const m = await modalText(A.page);
    if (!/abandon|résultat|Défaite|Victoire|partie/i.test(m)) return "aucun résultat après abandon : « " + m.slice(0, 70) + " »";
    return true;
  });

  await step("après la partie : aucune partie fantôme encore active", async () => {
    await A.page.keyboard.press("Escape");
    await sleep(400);
    await goScreen(A.page, "home");
    const g = await boardState(A.page);
    if (g && !g.over) return "une partie est encore active alors qu'elle est terminée";
    return true;
  });
}