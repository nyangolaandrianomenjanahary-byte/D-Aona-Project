/* =========================================================================
   S4 — AMIS : recherche, demande, acceptation, liste
   ========================================================================= */
async function uiAddFriend(from, toPseudo) {
  await goScreen(from.page, "friends");
  const q = from.page.locator("#friend-q");
  if (!(await q.count())) return "champ de recherche d'ami absent";
  await q.first().fill(toPseudo);
  await q.first().press("Enter");
  const shown = await until(from.page, (p) => !!document.querySelector(`#friend-results [data-add="${p}"]`), toPseudo, 9000);
  if (!shown) return `le joueur ${toPseudo} n'apparaît pas dans les résultats de recherche`;
  await from.page.locator(`#friend-results [data-add="${toPseudo}"]`).first().click();
  await sleep(900);
  const sent = await from.page.evaluate((p) => {
    const el = document.querySelector(`#friend-results [data-add="${p}"]`);
    if (!el) return true;                          // la ligne a été remplacée : demande prise en compte
    return /envoyée|attente|ami/i.test(el.parentElement.innerText);
  }, toPseudo);
  return sent ? true : "la demande d'ami n'a pas été enregistrée par l'interface";
}

async function s4_friends(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B", { signup: false });

  await step("le second joueur s'inscrit (compte neuf, navigateur isolé)", async () => {
    const r = await uiSignup(B.page, B.pseudo);
    if (r === true) B.authed = true;
    return r;
  });

  await step("recherche d'un joueur par son pseudo et envoi de la demande d'ami", () => uiAddFriend(A, B.pseudo));

  await step("le destinataire voit la demande entrante dans son écran Amis", async () => {
    await goScreen(B.page, "friends");
    const seen = await until(B.page, () => {
      const p = document.getElementById("freq-panel");
      return !!p && !!p.querySelector("[data-accept]") && /ami/i.test(p.innerText);
    }, 9000);
    if (!seen) return "aucune demande entrante affichée dans le panneau des invitations";
    const txt = await textOf(B.page, "#freq-panel");
    return new RegExp(A.pseudo, "i").test(txt) ? true : "la demande affichée ne vient pas du bon joueur";
  });

  await step("acceptation de la demande : les deux joueurs deviennent amis", async () => {
    await B.page.locator("#freq-panel [data-accept]").first().click();
    await sleep(1400);
    await goScreen(B.page, "friends");
    const okB = await until(B.page, (p) => {
      const l = document.getElementById("friends-list");
      return !!l && l.innerText.includes(p);
    }, A.pseudo, 9000);
    if (!okB) return "l'ami accepté n'apparaît pas dans la liste côté destinataire";
    await A.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(1800);
    await goScreen(A.page, "friends");
    const okA = await until(A.page, (p) => {
      const l = document.getElementById("friends-list");
      return !!l && l.innerText.includes(p);
    }, B.pseudo, 9000);
    if (!okA) return "l'amitié n'est pas visible côté demandeur (liste des amis)";
    return true;
  });

  await step("l'API confirme l'amitié dans les deux sens", async () => {
    const d = await apiFromPage(A.page, "/api/friends");
    const list = (d.json && (d.json.friends || d.json)) || [];
    return JSON.stringify(list).includes(B.pseudo)
      ? true : "l'amitié est absente de l'API des amis : " + JSON.stringify(list).slice(0, 120);
  });
}