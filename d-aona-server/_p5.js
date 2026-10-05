/* =========================================================================
   S2 — NAVIGATION : chaque écran s'ouvre, s'affiche et se remplit
   ========================================================================= */
const ROUTES = [
  ["home", "Accueil"], ["play", "Jeux"], ["match", "Matchs"], ["ranks", "Classement"],
  ["wallet", "Wallet"], ["profile", "Profil"], ["skins", "Boutique de skins"],
  ["friends", "Amis"], ["chat", "Messagerie"],
  ["notifications", "Notifications"], ["tournament", "Tournois"],
];
async function s2_nav(browser) {
  const A = await ensure(browser, "A");

  for (const [route, label] of ROUTES) {
    await step(`écran « ${label} » (#/${route}) s'ouvre et affiche du contenu`, async () => {
      if (!(await goScreen(A.page, route))) return "l'écran ne devient pas actif";
      const info = await A.page.evaluate((r) => {
        const root = document.getElementById(r + "-root");
        if (!root) return { err: "racine #" + r + "-root absente" };
        return { html: root.innerHTML.length };
      }, route);
      if (info.err) return info.err;
      if (info.html < 40) return "écran rendu vide (contenu " + info.html + " caractères)";
      return true;
    });
  }

  await step("la barre d'onglets reste accessible sur l'accueil", async () => {
    await goScreen(A.page, "home");
    return (await visible(A.page, "#mainTabbar")) ? true : "barre d'onglets invisible sur l'accueil";
  });
}