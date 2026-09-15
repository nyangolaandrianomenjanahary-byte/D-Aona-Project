/* =========================================================================
   JOUEURS (chaque joueur = un navigateur isolé : cookies, session, WebSocket)
   ========================================================================= */
const players = {};
const PREFIX = "ZzUi" + String(Math.floor(Math.random() * 900 + 100));
/* Récupère (ou crée) un joueur. Par défaut, le compte est inscrit à la volée :
   chaque scénario peut ainsi être lancé seul (node test_ui_scenarios.js S3). */
async function ensure(browser, label, { signup = true } = {}) {
  let p = players[label];
  if (!p) {
    p = await newPlayer(browser, label);
    p.pseudo = PREFIX + label + Math.floor(Math.random() * 90 + 10);
    players[label] = p;
  }
  if (signup && !p.authed) {
    const r = await uiSignup(p.page, p.pseudo);
    if (r === true) p.authed = true;
  }
  return p;
}

/* =========================================================================
   S1 — AUTHENTIFICATION (inscription, déconnexion, reconnexion)
   ========================================================================= */
async function s1_auth(browser) {
  const A = await ensure(browser, "A", { signup: false });

  await step("inscription d'un compte neuf par le formulaire (2 étapes)", async () => {
    const r = await uiSignup(A.page, A.pseudo);
    if (r === true) A.authed = true;
    return r;
  });

  await step("session ouverte : écran d'authentification masqué + solde de bienvenue 5 000 Ar", async () => {
    if (await visible(A.page, "#auth")) return "l'écran de connexion reste affiché après inscription";
    const s = await stateOf(A.page);
    if (s.pseudo !== A.pseudo) return "pseudo en session inattendu : " + s.pseudo;
    const bal = (await textOf(A.page, "#tb-balance")) || "";
    if (!/5\s?000/.test(bal.replace(/[\u202f\u00a0]/g, " "))) return "solde affiché inattendu : " + bal;
    return true;
  });

  await step("déconnexion par le bouton « Déconnexion » de l'écran Profil", async () => {
    await goScreen(A.page, "profile");
    const btn = A.page.locator("#profile-root button.danger", { hasText: "Déconnexion" });
    if (!(await btn.count())) return "bouton « Déconnexion » introuvable dans le profil";
    await btn.first().click();
    await sleep(900);
    return (await visible(A.page, "#auth")) ? true : "l'écran de connexion n'est pas revenu";
  });

  await step("connexion refusée avec un mauvais mot de passe", async () => {
    const ok = await uiLogin(A.page, A.pseudo, "MauvaisMotDePasse!9");
    if (ok) return "la connexion a réussi avec un mot de passe erroné";
    return (await visible(A.page, "#auth")) ? true : "état incohérent : ni connecté ni sur l'écran de connexion";
  });

  await step("reconnexion réussie avec le bon mot de passe", async () => {
    const ok = await uiLogin(A.page, A.pseudo);
    if (!ok) return "connexion impossible avec le bon mot de passe";
    const s = await stateOf(A.page);
    return s.pseudo === A.pseudo ? true : "pseudo en session inattendu : " + s.pseudo;
  });
}