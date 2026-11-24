/* =========================================================================
   S5 — PARTIE CLASSÉE EN LIGNE (matchmaking et tirage au sort)
   ========================================================================= */
const waitVisible = (page, sel, ms = 25000) => until(page, (s) => {
  const e = document.querySelector(s);
  return !!e && e.offsetParent !== null;
}, sel, ms);

async function s5_online(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B");
  const C = await ensure(browser, "C", { signup: false });

  await step("le troisième joueur s'inscrit et devient ami avec le premier (pour le spectacle)", async () => {
    const r = await uiSignup(C.page, C.pseudo);
    if (r !== true) return r;
    C.authed = true;
    const add = await uiAddFriend(C, A.pseudo);
    if (add !== true) return add;
    await goScreen(A.page, "friends");
    const seen = await until(A.page, () => {
      const p = document.getElementById("freq-panel");
      return !!p && !!p.querySelector("[data-accept]");
    }, 9000);
    if (!seen) return "la demande d'ami n'est pas arrivée chez le premier joueur";
    await A.page.locator("#freq-panel [data-accept]").first().click();
    await sleep(1400);
    return true;
  });

  await step("les deux joueurs lancent la recherche d'adversaire classée", async () => {
    for (const P of [A, B]) {
      const r = await wizard(P.page, { mode: "online", fmt: "blitz" });
      if (r !== true) return `assistant indisponible pour ${P.pseudo} : ${r}`;
      await P.page.click("#pg-cta");
    }
    await sleep(1400);
    const m = await modalText(A.page);
    if (!/recherche|adversaire/i.test(m)) return "aucun retour d'interface pendant la recherche : « " + m.slice(0, 70) + " »";
    return true;
  });

  await step("le serveur apparie les deux joueurs et propose la même partie des deux côtés", async () => {
    const okA = await waitVisible(A.page, "#mm-accept", 30000);
    const okB = await waitVisible(B.page, "#mm-accept", 30000);
    if (!okA || !okB) return `proposition de match absente (joueur 1 : ${okA}, joueur 2 : ${okB})`;
    const tA = await modalText(A.page);
    const tB = await modalText(B.page);
    if (!tA.includes(B.pseudo)) return `adversaire annoncé faux chez le premier joueur : « ${tA.slice(0, 60)} »`;
    if (!tB.includes(A.pseudo)) return `adversaire annoncé faux chez le second joueur : « ${tB.slice(0, 60)} »`;
    return true;
  });

  await step("les deux joueurs acceptent le match", async () => {
    await A.page.click("#mm-accept");
    await B.page.click("#mm-accept");
    const okA = await waitVisible(A.page, "#choose-pile", 25000);
    const okB = await waitVisible(B.page, "#choose-pile", 25000);
    if (!okA || !okB) return `modale de tirage au sort absente (joueur 1 : ${okA}, joueur 2 : ${okB})`;
    return true;
  });

  await step("tirage au sort : chaque joueur choisit une face différente", async () => {
    const pick = async (page, preferred) => {
      const id = await page.evaluate((pref) => {
        const other = pref === "choose-pile" ? "choose-face" : "choose-pile";
        const ids = pref ? [pref, other] : ["choose-pile", "choose-face"];
        for (const i of ids) {
          const e = document.getElementById(i);
          if (e && !e.disabled && e.offsetParent !== null) return i;
        }
        return null;
      }, preferred);
      if (!id) return null;
      await page.click("#" + id);
      await sleep(800);
      return id;
    };
    const a = await pick(A.page, "choose-pile");
    if (!a) return "le premier joueur ne peut choisir aucune face";
    const b = await pick(B.page, a === "choose-pile" ? "choose-face" : "choose-pile");
    if (!b) return "le second joueur ne peut choisir la face restante";
    if (a === b) return "les deux joueurs ont pu choisir la même face";
    return true;
  });

  await step("le plateau en ligne est prêt : 22 pions par camp et numéros distincts", async () => {
    const ready = (page) => until(page, () => {
      const g = window.Fanorona.state();
      return !!g && !g.over && !g.spectator && document.querySelectorAll(".piece.me").length > 0;
    }, 25000);
    if (!(await ready(A.page))) return "le plateau ne s'ouvre pas chez le premier joueur";
    if (!(await ready(B.page))) return "le plateau ne s'ouvre pas chez le second joueur";
    const ca = await pieceCounts(A.page), cb = await pieceCounts(B.page);
    for (const [n, c] of [["joueur 1", ca], ["joueur 2", cb]]) {
      if (c.me !== 22 || c.opp !== 22) return `${n} : ${c.me} pions contre ${c.opp} (22 / 22 attendus)`;
    }
    const sa = await boardState(A.page), sb = await boardState(B.page);
    if (sa.playerNum === sb.playerNum) return `les deux joueurs ont le même numéro (${sa.playerNum})`;
    if (sa.mode !== "online") return "le mode de la partie n'est pas « online » : " + sa.mode;
    return true;
  });
}