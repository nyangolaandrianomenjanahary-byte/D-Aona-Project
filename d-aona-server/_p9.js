/* =========================================================================
   S6 — SUITE DE LA PARTIE EN LIGNE : coups diffusés, spectateur, abandon
   ========================================================================= */
async function s6_online_play(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B");
  const C = await ensure(browser, "C");
  let mover = null, other = null;

  await step("le joueur qui a la main joue un coup au clic", async () => {
    const sa = await boardState(A.page), sb = await boardState(B.page);
    if (!sa || !sb) return "aucun plateau lisible";
    mover = sa.turn === sa.playerNum ? A : B;
    other = mover === A ? B : A;
    const before = await boardState(other.page);
    const mv = await playMove(mover.page);
    if (!mv) return "aucun coup légal cliquable côté joueur ayant la main";
    if (!mv.retenu) {
      return `le clic n'a pas été retenu par le plateau (coup ${mv.from} → ${mv.to}` +
        (mv.avis ? " ; interface : " + mv.avis : "") + ")";
    }
    await sleep(1500);
    const after = await boardState(other.page);
    const vu = after.log > before.log || after.moves > before.moves;
    return vu ? true
      : `le coup n'est pas parvenu à l'adversaire (journal ${before.log} → ${after.log}, ` +
        `coups officiels ${before.moves} → ${after.moves})`;
  });

  await step("le plateau de l'adversaire reflète exactement la même partie", async () => {
    const sa = await boardState(A.page), sb = await boardState(B.page);
    if (sa.moves !== sb.moves) return `coups désynchronisés : ${sa.moves} contre ${sb.moves}`;
    if (sa.log !== sb.log) return `journaux de coups désynchronisés : ${sa.log} contre ${sb.log}`;
    const ca = await pieceCounts(A.page), cb = await pieceCounts(B.page);
    if (ca.me !== cb.opp || ca.opp !== cb.me) {
      return `pions désynchronisés : ${ca.me}/${ca.opp} contre ${cb.me}/${cb.opp}`;
    }
    return (await visible(A.page, "#lastmove")) ? true : "la trace du dernier coup n'est pas affichée";
  });

  await step("le troisième joueur voit la partie en direct dans Matchs", async () => {
    await goMatchTab(C.page, "live");
    const listed = await until(C.page, () => {
      const r = document.getElementById("live-games-root");
      return !!r && /Regarder/.test(r.innerText);
    }, 15000);
    return listed ? true : "la partie en cours n'apparaît pas dans les matchs en direct";
  });

  await step("il peut regarder la partie : plateau en lecture seule affiché", async () => {
    await C.page.locator('#live-games-root button[onclick*="spectate"]').first().click();
    await sleep(1800);
    if (!(await visible(C.page, "#fanorona-board"))) return "le plateau du spectateur ne s'affiche pas";
    const st = await boardState(C.page);
    if (!st) return "aucun état de partie pour le spectateur";
    if (!st.spectator) return "le mode spectateur n'est pas activé sur le plateau";
    const c = await pieceCounts(C.page);
    return c.me + c.opp >= 1 ? true : "aucun pion affiché pour le spectateur";
  });

  await step("un spectateur ne peut pas jouer : un clic ne change pas le plateau", async () => {
    const before = await boardState(C.page);
    const cells = await C.page.evaluate(() => {
      const g = window.Fanorona.state();
      const out = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) if (g.grid[r][c]) out.push([r, c]);
      return out.slice(0, 4);
    });
    if (cells.length >= 2) {
      await C.page.click(`#cells .cell[data-r="${cells[0][0]}"][data-c="${cells[0][1]}"]`).catch(() => {});
      await sleep(250);
      await C.page.click(`#cells .cell[data-r="${cells[1][0]}"][data-c="${cells[1][1]}"]`).catch(() => {});
      await sleep(900);
    }
    const after = await boardState(C.page);
    if (after.moves !== before.moves || after.log !== before.log) {
      return "le spectateur a pu jouer un coup : lecture seule non respectée";
    }
    const meme = JSON.stringify(after.grid) === JSON.stringify(before.grid);
    return meme ? true : "le plateau du spectateur a changé après ses clics";
  });

  await step("abandon : la fin de partie est annoncée aux deux joueurs", async () => {
    await mover.page.click("#btn-resign");
    await sleep(600);
    if (!(await visible(mover.page, "#resign-ok"))) return "confirmation d'abandon non affichée";
    await mover.page.click("#resign-ok");
    await sleep(2800);
    const tMover = await modalText(mover.page);
    const tOther = await modalText(other.page);
    if (!/abandon|Défaite|Victoire|partie/i.test(tMover)) return "aucun résultat chez celui qui abandonne : « " + tMover.slice(0, 70) + " »";
    if (!/abandon|Défaite|Victoire|partie/i.test(tOther)) return "aucun résultat chez l'adversaire : « " + tOther.slice(0, 70) + " »";
    if (!/abandon/i.test(tOther + tMover)) return "le motif d'abandon n'est pas indiqué";
    return true;
  });

  await step("l'écran de résultat peut être refermé et le plateau libéré", async () => {
    const a = await dismissModals(mover.page);
    const b = await dismissModals(other.page);
    if (!a || !b) return `la fenêtre de résultat reste bloquée (joueur 1 : ${a}, joueur 2 : ${b})`;
    await goScreen(A.page, "home");
    return (await visible(A.page, "#home-root")) ? true : "l'accueil n'est pas accessible après la partie";
  });

  await step("la partie est archivée et l'Elo est enregistré", async () => {
    const d = await apiFromPage(other.page, "/api/user");
    const s = d.json && d.json.user ? d.json.user : d.json;
    if (!s || typeof s.elo !== "number") return "profil Elo illisible après la partie";
    const h = await apiFromPage(other.page, "/api/games/history");
    const list = (h.json && (h.json.games || h.json)) || [];
    return Array.isArray(list) && list.length >= 1 ? true : "l'historique des parties est vide après la partie";
  });
}