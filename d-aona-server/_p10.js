/* =========================================================================
   S7 — WALLET : KYC obligatoire, dépôt, retrait, historique
   ========================================================================= */
async function s7_wallet(browser) {
  const A = await ensure(browser, "A");
  let before = 0;

  await step("le bouton de la barre du haut ouvre le wallet", async () => {
    await goScreen(A.page, "home");
    await dismissModals(A.page);
    const b = A.page.locator("#tb-wallet");
    if (!(await b.count())) return "bouton wallet absent de la barre du haut";
    await b.first().click();
    await sleep(1000);
    return (await visible(A.page, "#wallet-root")) ? true : "l'écran wallet ne s'ouvre pas depuis la barre du haut";
  });

  await step("le dépôt exige d'abord la vérification d'identité (KYC)", async () => {
    const s = await stateOf(A.page);
    if (s.kyc) return "test invalide : ce compte est déjà vérifié";
    await A.page.locator("#wallet-root button", { hasText: "Déposer" }).first().click();
    await sleep(1100);
    const m = await modalText(A.page);
    if (!/vérification d'identité|KYC/i.test(m)) return "aucune demande de KYC avant dépôt : « " + m.slice(0, 70) + " »";
    return (await visible(A.page, "#kyc-upload")) ? true : "bouton de vérification de la CIN absent";
  });

  await step("la vérification d'identité simulée ouvre l'accès au dépôt", async () => {
    await A.page.click("#kyc-upload");
    await sleep(3200);
    const m = await modalText(A.page);
    if (!/déposer/i.test(m)) return "le formulaire de dépôt n'apparaît pas après vérification : « " + m.slice(0, 70) + " »";
    return true;
  });

  await step("le choix du montant met à jour le récapitulatif", async () => {
    const chip = A.page.locator('#modal .amt-chip[data-amt="10000"]');
    if (!(await chip.count())) return "aucun montant proposé dans le formulaire de dépôt";
    await chip.first().click();
    await sleep(450);
    const shown = (await textOf(A.page, "#dep-amt")) || "";
    return /10\s?000/.test(shown.replace(/[\u202f\u00a0]/g, " ")) ? true : "récapitulatif non mis à jour : " + shown;
  });

  await step("le dépôt crédite réellement le wallet et la barre du haut", async () => {
    before = (await stateOf(A.page)).balance;
    await A.page.click("#dep-ok");
    await sleep(3200);
    const s = await stateOf(A.page);
    if (s.balance !== before + 10000) return `solde ${before} -> ${s.balance} (attendu ${before + 10000})`;
    const top = (await textOf(A.page, "#tb-balance")) || "";
    const fmt = new Intl.NumberFormat("fr-FR").format(s.balance).replace(/[\u202f\u00a0]/g, " ");
    return top.replace(/[\u202f\u00a0]/g, " ").includes(fmt)
      ? true : "la barre du haut n'affiche pas le nouveau solde : " + top;
  });

  await step("le retrait est débloqué et débite le solde", async () => {
    await A.page.locator("#wallet-root button", { hasText: "Retirer" }).first().click();
    await sleep(1100);
    if (!(await visible(A.page, "#wd-amount"))) {
      const m = await modalText(A.page);
      return "le formulaire de retrait ne s'ouvre pas : « " + m.slice(0, 70) + " »";
    }
    await A.page.fill("#wd-amount", "2000");
    await sleep(250);
    await A.page.click("#wd-ok");
    await sleep(3200);
    const s = await stateOf(A.page);
    if (s.balance === before + 10000 - 2000) return true;
    const t = (await toasts(A.page)).join(" | ");
    return `solde ${before + 10000} -> ${s.balance} (attendu ${before + 8000})${t ? " — message : " + t : ""}`;
  });

  await step("l'historique des transactions contient le dépôt", async () => {
    const d = await apiFromPage(A.page, "/api/transactions");
    const list = (d.json && (d.json.transactions || d.json)) || [];
    const found = Array.isArray(list) && list.some((t) => /d[ée]p[oô]t|deposit/i.test(JSON.stringify(t)));
    return found ? true : "aucun dépôt dans l'historique : " + JSON.stringify(list).slice(0, 140);
  });
}

/* =========================================================================
   S8 — BOUTIQUE DE SKINS : achat, débit du wallet, équipement
   ========================================================================= */
async function s8_skins(browser) {
  const A = await ensure(browser, "A");

  await step("la boutique de skins est affichée sur le profil", async () => {
    await goScreen(A.page, "profile");
    const n = await A.page.locator("#profile-root .skin-card").count();
    return n >= 6 ? true : "boutique incomplète : " + n + " skins affichés (6 attendus)";
  });

  await step("l'achat d'un skin débite le wallet et l'enregistre comme possédé", async () => {
    const before = (await stateOf(A.page)).balance;
    const btn = A.page.locator('#profile-root button[onclick*="buySkin"]').first();
    if (!(await btn.count())) return "aucun bouton « Acheter » dans la boutique";
    const id = ((await btn.getAttribute("onclick")) || "").match(/buySkin\('([^']+)'\)/);
    if (!id) return "bouton d'achat sans identifiant de skin";
    await btn.first().click();
    await sleep(3200);
    const s = await stateOf(A.page);
    const owned = (s.skins && s.skins.owned) || [];
    if (!owned.includes(id[1])) return `le skin ${id[1]} n'est pas enregistré comme possédé : ${JSON.stringify(owned)}`;
    if (s.balance >= before) return `le wallet n'a pas été débité (${before} -> ${s.balance})`;
    return true;
  });

  await step("le skin acheté peut être équipé", async () => {
    const btn = A.page.locator('#profile-root button[onclick*="equipSkin"]').first();
    if (!(await btn.count())) return "aucun bouton « Équiper » après l'achat";
    const id = ((await btn.getAttribute("onclick")) || "").match(/equipSkin\('([^']+)'\)/);
    if (!id) return "bouton d'équipement sans identifiant de skin";
    await btn.first().click();
    await sleep(2200);
    const s = await stateOf(A.page);
    const eq = JSON.stringify((s.skins && s.skins.equipped) || {});
    return eq.includes(id[1]) ? true : "le skin n'est pas marqué équipé : " + eq;
  });
}