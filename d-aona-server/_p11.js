/* =========================================================================
   S9 — TOURNOIS : liste, détail (bracket), inscription et débit de la mise
   ========================================================================= */
async function s9_tournament(browser) {
  const A = await ensure(browser, "A");
  let tid = null;

  await step("l'écran Matchs liste les tournois disponibles", async () => {
    await goScreen(A.page, "match");
    const n = await A.page.locator("#match-root .tn-card").count();
    return n >= 1 ? true : "aucune carte de tournoi affichée";
  });

  await step("le détail d'un tournoi s'ouvre (écran Tournois : mise, places, bracket)", async () => {
    const b = A.page.locator('#match-root button[onclick*="openTournament"]').first();
    if (!(await b.count())) return "aucun bouton « Détail & bracket »";
    await b.click();
    const opened = await until(A.page, () => /^tournament/.test((location.hash || "").replace("#/", "")), 10000);
    if (!opened) return "l'écran de détail ne s'ouvre pas (route actuelle : " + (await routeOf(A.page)) + ")";
    await sleep(1300);
    const txt = (await textOf(A.page, "#tournament-root")) || "";
    if (txt.length < 40) return "écran de détail vide (contenu " + txt.length + " caractères)";
    if (!/bracket|mise|place|joueur|inscri|tournoi/i.test(txt)) return "contenu du détail inattendu : « " + txt.slice(0, 80) + " »";
    await goScreen(A.page, "match");
    return true;
  });

  await step("un tournoi déjà commencé ou terminé n'offre plus d'inscription", async () => {
    const bad = await A.page.evaluate(() => {
      const out = [];
      document.querySelectorAll("#match-root .tn-card").forEach((c) => {
        const pill = ((c.querySelector(".pill.amber") || {}).textContent || "").trim();
        const join = c.querySelector("button[onclick*='joinTournament']");
        if (/Terminé|En cours/.test(pill) && join) out.push(pill + " : " + (c.querySelector("h3") || {}).textContent);
      });
      return out;
    });
    if (bad.length) return "des inscriptions restent proposées — " + bad.join(" ; ");
    return true;
  });

  await step("inscription au tournoi ouvert : la mise est débitée du wallet", async () => {
    const btn = A.page.locator(`#match-root button[onclick*="joinTournament('${TID_UI}')"]`).first();
    if (!(await btn.count())) return "le tournoi ouvert de la campagne n'est pas proposé à l'inscription";
    tid = TID_UI;
    const d = await apiFromPage(A.page, "/api/tournaments");
    const list = (d.json && (d.json.tournaments || d.json)) || [];
    const t = Array.isArray(list) ? list.find((x) => Number(x.id) === tid) : null;
    const entry = t ? Number(t.entry || 0) : 0;
    const s0 = await stateOf(A.page);
    /* Le serveur crédite 1 000 Ar de bonus de bienvenue à la PREMIÈRE
       inscription payante (server.js) : le solde net ne baisse alors que de
       (mise - 1 000 Ar). */
    const expectBonus = (!s0.bonusUsed && entry > 0) ? 1000 : 0;
    const before = s0.balance;
    await btn.click();
    await sleep(3200);
    const after = (await stateOf(A.page)).balance;
    if (entry && after !== before - entry + expectBonus) {
      const txt = (await toasts(A.page)).join(" | ");
      const tx = await apiFromPage(A.page, "/api/transactions");
      const list = (tx.json && (tx.json.transactions || tx.json)) || [];
      const last = list.slice(0, 3).map((x) => `${x.dir} ${x.amount} ${x.label}`).join(" ; ");
      return `solde ${before} -> ${after} (attendu ${before - entry + expectBonus} = mise ${entry} - bonus ${expectBonus})` +
        (txt ? " — message : " + txt : "") + (last ? " — écritures : " + last : " — aucune écriture");
    }
    const my = await apiFromPage(A.page, "/api/tournaments/my");
    const mine = JSON.stringify(my.json || {});
    return tid !== null && mine.includes(String(tid)) ? true : "l'inscription n'est pas enregistrée : " + mine.slice(0, 130);
  });

  await step("l'inscription est confirmée à l'écran", async () => {
    await goScreen(A.page, "match");
    const shown = await until(A.page, () => /inscrit/i.test(document.getElementById("match-root").innerText), 10000);
    return shown ? true : "aucune mention « inscrit » affichée après l'inscription";
  });
}

/* =========================================================================
   S10 — NOTIFICATIONS : badge, liste, lecture unitaire, tout lire
   ========================================================================= */
async function s10_notifications(browser) {
  const A = await ensure(browser, "A");

  await step("la cloche de la barre du haut porte le compteur de non-lues", async () => {
    await A.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2400);
    const c = (await A.page.getAttribute("#btn-notif", "data-count")) || "";
    if (!c) return "aucun compteur affiché alors qu'une inscription au tournoi a eu lieu";
    return Number(c) >= 1 ? true : "compteur inattendu : " + c;
  });

  await step("l'écran Notifications s'ouvre depuis la cloche et liste les événements", async () => {
    await A.page.click("#btn-notif");
    await sleep(1500);
    if (!(await visible(A.page, "#notifications-root"))) return "l'écran Notifications ne s'ouvre pas depuis la cloche";
    const n = await A.page.locator("#notifications-root .feed-item").count();
    if (n < 1) return "aucune notification listée";
    const txt = await textOf(A.page, "#notifications-root");
    return /inscri/i.test(txt || "") ? true : "la notification d'inscription est absente : « " + (txt || "").slice(0, 90) + " »";
  });

  await step("marquer une notification comme lue décrémente le compteur", async () => {
    const before = Number((await A.page.getAttribute("#btn-notif", "data-count")) || 0);
    const btn = A.page.locator('#notifications-root button[onclick*="readNotification"]').first();
    if (!(await btn.count())) return "aucun bouton « Marquer lu » sur les notifications non lues";
    await btn.click();
    await sleep(2000);
    const after = Number((await A.page.getAttribute("#btn-notif", "data-count")) || 0);
    return after === before - 1 ? true : `compteur ${before} -> ${after} (attendu ${before - 1})`;
  });

  await step("« Tout marquer lu » vide le compteur", async () => {
    const btn = A.page.locator("#notifications-root button", { hasText: "Tout marquer lu" });
    if (!(await btn.count())) return "bouton « Tout marquer lu » absent";
    await btn.first().click();
    await sleep(2000);
    const c = (await A.page.getAttribute("#btn-notif", "data-count")) || "";
    if (c !== "") return "le compteur n'est pas vidé : " + c;
    const txt = await textOf(A.page, "#notifications-root");
    return /0 non lue/i.test(txt || "") ? true : "l'en-tête n'annonce pas 0 non lue : « " + (txt || "").slice(0, 60) + " »";
  });
}