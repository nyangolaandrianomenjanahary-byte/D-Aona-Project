/* =========================================================================
   S9 — TOURNOIS : liste, détail (bracket), inscription et débit de la mise
   ========================================================================= */
async function s9_tournament(browser) {
  const A = await ensure(browser, "A");
  let tid = null;

  await step("l'écran Matchs liste les tournois disponibles", async () => {
    await goMatchTab(A.page, "tournois");
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
    await goMatchTab(A.page, "tournois");
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
    /* L'entrée de tournoi est une transaction réelle : le serveur la refuse
       sans KYC, et l'application ouvre alors la fenêtre « Vérification
       d'identité » — qui recouvre le bouton et fait échouer le clic SUIVANT.
       Lancé seul, ce scénario partait d'un compte neuf (kyc = 0) et échouait
       donc pour une raison étrangère au tournoi (S7, exécuté avant dans la
       campagne complète, est ce qui vérifiait le KYC). On le vérifie ici :
       le scénario devient réellement autonome, comme annoncé plus haut. */
    if (!(await stateOf(A.page)).kyc) {
      const r = await apiFromPage(A.page, "/api/kyc/verify", "POST", {});
      if (!r.json || r.json.kyc !== true) return "impossible de vérifier le KYC du compte de test";
      await A.page.reload({ waitUntil: "domcontentloaded" });
      await sleep(2500);
      if (!(await stateOf(A.page)).kyc) return "le KYC vérifié n'est pas relu par l'application";
      /* Le rechargement repart sur l'onglet « En direct » : on revient sur les
         tournois, sinon le bouton cherché n'existe pas dans la page. */
      await goMatchTab(A.page, "tournois");
    }
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
    await goMatchTab(A.page, "tournois");
    const shown = await until(A.page, () => /inscrit/i.test(document.getElementById("match-root").innerText), 10000);
    return shown ? true : "aucune mention « inscrit » affichée après l'inscription";
  });

  await step("le tournoi rejoint « Je participe » dès l'inscription confirmée", async () => {
    await goMatchTab(A.page, "tournois");
    const seg = A.page.locator('#match-root [data-tfilter="participe"]');
    if (!(await seg.count())) return "le filtre « Je participe » n'existe pas dans l'onglet Tournois";
    await seg.first().click();
    await sleep(600);
    const info = await A.page.evaluate(() => {
      const root = document.getElementById("match-root");
      const on = root.querySelector(".mt-seg.on");
      const cards = [...root.querySelectorAll(".tn-card")];
      return {
        actif: on ? on.innerText.trim().split("\n")[0] : "",
        n: cards.length,
        noms: cards.map((c) => ((c.querySelector("h3") || {}).textContent || "").trim()),
        inscrit: cards.some((c) => /inscrit/i.test(c.innerText)),
      };
    });
    if (!/participe/i.test(info.actif)) return "le filtre actif n'est pas « Je participe » : « " + info.actif + " »";
    if (info.n < 1) return "« Je participe » est vide alors que l'inscription vient d'être confirmée";
    if (!info.inscrit) return "la carte ne porte pas la mention d'inscription : " + JSON.stringify(info.noms);
    return true;
  });

  await step("inscription retirée côté serveur : le tournoi sort de « Je participe » sans geste", async () => {
    /* La ligne d'inscription est supprimée dans la COPIE jetable — c'est ce que
       feront l'annulation et le retrait d'inscription — puis un second joueur
       s'inscrit : le serveur diffuse `tournament_update` et le panneau se
       redessine seul. Aucun clic, aucun rechargement dans la section. */
    const me = await stateOf(A.page);
    const db = new DatabaseSync(path.join(tmpDir, "d-aona.db"));
    const del = db.prepare("DELETE FROM tournament_registrations WHERE tournament_id = ? AND user_id = ?").run(TID_UI, me.id);
    db.close();
    if (del.changes !== 1) return "aucune inscription à retirer pour l'utilisateur " + me.id;
    const B = await ensure(browser, "B");
    let bs = await stateOf(B.page);
    if (!bs.kyc) { await apiFromPage(B.page, "/api/kyc/verify", "POST", {}); bs = await stateOf(B.page); }
    if (bs.balance < 1000) await apiFromPage(B.page, "/api/deposit", "POST", { amount: 1000, operator: "MVola" });
    const joinB = await apiFromPage(B.page, "/api/tournaments/join", "POST", { tournamentId: TID_UI });
    if (joinB.status !== 200) return "impossible de déclencher la diffusion serveur : " + JSON.stringify(joinB.json);
    const sorti = await until(A.page, () => {
      const root = document.getElementById("match-root");
      return root.querySelectorAll(".tn-card").length === 0 && /aucune participation/i.test(root.innerText || "");
    }, 10000);
    if (sorti) return true;
    const txt = ((await textOf(A.page, "#match-root")) || "").replace(/\s+/g, " ");
    return "la carte reste dans « Je participe » : « " + txt.slice(0, 140) + " »";
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