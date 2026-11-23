/* =========================================================================
   S11 — MESSAGERIE : dock flottant, envoi et réception en temps réel
   ========================================================================= */
async function s11_chat(browser) {
  const A = await ensure(browser, "A");
  const C = await ensure(browser, "C");

  await step("le tiroir de messagerie s'ouvre et liste les joueurs connus", async () => {
    await goScreen(A.page, "home");
    await dismissModals(A.page);
    await A.page.click("#chat-fab");
    await sleep(1200);
    const txt = await textOf(A.page, "#chat-tray");
    if (!txt) return "le tiroir de messagerie ne s'ouvre pas (aucun contenu)";
    return new RegExp(C.pseudo, "i").test(txt) ? true : "aucun joueur connu listé : « " + txt.slice(0, 90) + " »";
  });

  await step("un message envoyé depuis la Messagerie apparaît dans la conversation", async () => {
    await goScreen(A.page, "chat");
    const ouvert = await openConversation(A.page, C.pseudo);
    if (ouvert !== true) return ouvert;
    await sleep(700);
    const txt = "Message de test " + Math.floor(Math.random() * 9000 + 1000);
    await A.page.fill("#chat-field", txt);
    await A.page.click("#chat-send");
    await sleep(1800);
    const msgs = (await textOf(A.page, "#chat-msgs")) || "";
    return msgs.includes(txt) ? true : "le message envoyé n'apparaît pas dans la conversation";
  });

  await step("le message arrive chez le destinataire en temps réel", async () => {
    const txt = await A.page.evaluate(() => {
      const m = document.querySelectorAll("#chat-msgs .msg");
      return m.length ? m[m.length - 1].innerText.trim() : null;
    });
    if (!txt) return "impossible de relire le message envoyé";
    /* Réception en temps réel : le destinataire ouvre la conversation avec
       l'expéditeur et doit y voir le message. Le conteneur des messages est
       marqué `data-pop-msgs` (famille `data-pop-*` des fenêtres de discussion) :
       on vise cette marque-là, pas `data-pop`, qui est celle de la fenêtre. */
    const fenetre = await uiOpenChatPopup(C.page, A.pseudo);
    if (fenetre !== true) return fenetre;
    const vu = await until(C.page, ([p, t]) => {
      const el = document.querySelector(`.cp-msgs[data-pop-msgs="${p}"]`);
      return !!el && el.innerText.includes(t);
    }, [A.pseudo, txt], 14000);
    return vu ? true : "le message n'est pas arrivé chez le destinataire";
  });

  /* ---------- Retour terrain n° 8 : fermeture des fenêtres de conversation ----------
     Trois exigences mesurées ici : la croix ferme VRAIMENT (l'ancien bouton
     « réduire » ne faisait que replier la fenêtre), le clic À L'EXTÉRIEUR ferme
     aussi, et le brouillon non envoyé revient à la réouverture — c'est l'option
     retenue (conserver) plutôt qu'une confirmation qui interromprait la frappe. */
  await step("la croix ferme la fenêtre de conversation et le brouillon est conservé", async () => {
    const fenetre = await uiOpenChatPopup(A.page, C.pseudo);
    if (fenetre !== true) return fenetre;
    const champ = `[data-pop-field="${C.pseudo}"]`;
    await A.page.fill(champ, "brouillon conservé");
    const reduire = await A.page.evaluate((p) =>
      !!document.querySelector(`.chat-pop[data-pop="${p}"] [data-pop-min]`), C.pseudo);
    if (reduire) return "le bouton « réduire » est toujours dans la fenêtre";
    await A.page.click(`[data-pop-close="${C.pseudo}"]`);
    await sleep(600);
    const restee = await A.page.evaluate((p) =>
      !!document.querySelector(`.chat-pop[data-pop="${p}"]`), C.pseudo);
    if (restee) return "la croix ne ferme pas la fenêtre de conversation";
    const reouvert = await uiOpenChatPopup(A.page, C.pseudo);
    if (reouvert !== true) return reouvert;
    await sleep(400);
    const valeur = await A.page.inputValue(champ).catch(() => "");
    if (valeur !== "brouillon conservé") return "le brouillon est perdu à la fermeture : « " + valeur + " »";
    /* On referme : la fenêtre est en `fixed` au-dessus de la liste des amis, et la
       laisser ouverte empêcherait le geste de l'étape suivante. */
    await A.page.click(`[data-pop-close="${C.pseudo}"]`).catch(() => {});
    await sleep(500);
    return true;
  });

  await step("un clic À L'EXTÉRIEUR de la fenêtre la referme et garde le brouillon", async () => {
    /* Un point NEUTRE de la page : hors de toute fenêtre et sans action propre,
       sinon le clic extérieur naviguerait au passage et fausserait la mesure. */
    const pointNeutre = () => A.page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      for (const [x, y] of [[24, vh - 24], [vw / 2, 8], [24, 8], [vw - 8, vh - 8]]) {
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        if (el.closest("button, a, input, select, textarea, [role=button]")) continue;
        return { x, y };
      }
      return null;
    });
    /* Mise à zéro : on referme ce qui aurait pu rester ouvert avant de mesurer. */
    const nettoyage = await pointNeutre();
    if (nettoyage) await A.page.mouse.click(nettoyage.x, nettoyage.y);
    await sleep(400);
    const fenetre = await uiOpenChatPopup(A.page, C.pseudo);
    if (fenetre !== true) return fenetre;
    const champ = `[data-pop-field="${C.pseudo}"]`;
    await A.page.fill(champ, "clic extérieur");
    const pt = await pointNeutre();
    if (!pt) return "aucun point neutre trouvé pour le clic extérieur";
    await A.page.mouse.click(pt.x, pt.y);
    await sleep(600);
    const restee = await A.page.evaluate((p) =>
      !!document.querySelector(`.chat-pop[data-pop="${p}"]`), C.pseudo);
    if (restee) return "la fenêtre reste ouverte après un clic à l'extérieur";
    /* Un clic DANS la fenêtre ne doit PAS la fermer : sans cela, écrire un message
       refermerait la conversation. */
    const reouvert = await uiOpenChatPopup(A.page, C.pseudo);
    if (reouvert !== true) return reouvert;
    await sleep(400);
    const valeur = await A.page.inputValue(champ).catch(() => "");
    if (valeur !== "clic extérieur") return "le brouillon du clic extérieur est perdu : « " + valeur + " »";
    await A.page.click(`[data-pop-field="${C.pseudo}"]`);
    await sleep(400);
    const dedans = await A.page.evaluate((p) =>
      !!document.querySelector(`.chat-pop[data-pop="${p}"]`), C.pseudo);
    if (!dedans) return "un clic DANS la fenêtre la referme : on ne peut plus écrire";
    await A.page.click(`[data-pop-close="${C.pseudo}"]`).catch(() => {});   // remise en état
    await sleep(400);
    return true;
  });
}

/* =========================================================================
   PILOTE DE LA CAMPAGNE
   ========================================================================= */
const SCENARIOS = [
  ["S1", "Authentification : inscription, session, déconnexion, reconnexion", () => s1_auth(BROWSER)],
  ["S2", "Navigation : chaque écran s'ouvre et se remplit", () => s2_nav(BROWSER)],
  ["S3", "Entraînement contre l'IA : assistant, plateau, tirage au sort, coups", () => s3_ai(BROWSER)],
  ["S4", "Amis : recherche, demande, acceptation, liste", () => s4_friends(BROWSER)],
  ["S5", "Partie classée en ligne : matchmaking et tirage au sort", () => s5_online(BROWSER)],
  ["S6", "Partie en ligne : coups diffusés, spectateur, abandon", () => s6_online_play(BROWSER)],
  ["S7", "Wallet : KYC, dépôt, retrait, historique", () => s7_wallet(BROWSER)],
  ["S8", "Boutique de skins : couleur × motif, page dédiée, choix indépendants", () => s8_skins(BROWSER)],
  ["S9", "Tournois : liste, détail, inscription", () => s9_tournament(BROWSER)],
  ["S10", "Notifications : badge, liste, lecture, tout lire", () => s10_notifications(BROWSER)],
  ["S11", "Messagerie : dock, envoi et réception temps réel", () => s11_chat(BROWSER)],
  ["S12", "Écran Match : héro, tuiles de statistiques, deux colonnes, défis réels et annulation", () => s12_match(BROWSER)],
  ["S13", "Données : classement vivant, badge Amis, photo de profil, noms cliquables, Elo gagné/perdu", () => s13_datafix(BROWSER)],
  ["S14", "Administration : bouton du profil, cartes de modules, écrans réels, interrupteur", () => s14_admin(BROWSER)],
];
let BROWSER = null;

(async () => {
  console.log("D-aôna — CAMPAGNE DE TESTS D'INTERFACE (navigateur réel)");
  console.log("======================================================");
  const db = snapshotDb();
  prepareFixture(db);
  const child = startServer(db);
  try {
    await waitServer();
    console.log("Serveur de test prêt sur " + BASE + " — base jetable : " + db);
    BROWSER = await launchBrowser();

    /* Plusieurs scénarios d'un coup : node test_ui_scenarios.js S5,S6 */
    const WANTED = ONLY.split(",").map((s) => s.trim()).filter(Boolean);
    for (const [id, title, fn] of SCENARIOS) {
      if (WANTED.length && !WANTED.includes(id)) continue;
      scen(id, title);
      try {
        await fn();
      } catch (e) {
        const note = String((e && e.message) || e).split("\n")[0].slice(0, 180);
        results.push({ id, label: "exception de scénario", ok: false, ms: 0, note });
        console.log("  ECHEC  exception de scénario   <-- " + note);
      }
      await sleep(250);
    }

    scen("SX", "Hygiène : version servie et absence d'erreur JavaScript");
    await step("le serveur sert bien la version courante de l'interface (correctifs présents)", async () => {
      const html = await (await fetch(BASE + "/")).text();
      const missing = [];
      if (!/v === meVal\(\) \? "me"/.test(html)) missing.push("couleur des pions selon le joueur");
      if (!/setTxt\("dep-amt"/.test(html)) missing.push("récapitulatif du dépôt");
      if (!/Inscriptions closes/.test(html)) missing.push("tournoi fermé non inscriptible");
      if (!/if \(!API\.getToken\(\)\) return;/.test(html)) missing.push("pas de requête sans session");
      /* Correctifs de DONNÉES : une fabrique d'avatar, une lecture d'historique, et
         la règle CSS qui rend un nom cliquable reconnaissable. Leur disparition du
         fichier servi signalerait un retour en arrière silencieux. */
      if (!/function avatarInnerHtml/.test(html)) missing.push("fabrique d'avatar unique");
      if (!/function mapGameRows/.test(html)) missing.push("lecture unique de l'historique");
      if (!/\.link-pseudo \{/.test(html)) missing.push("styles des noms cliquables");
      /* Retours terrain n° 6 et n° 8 : le verrou de zoom mobile et la fermeture des
         fenêtres de conversation (par la croix ou par un clic à l'extérieur). */
      if (!/maximum-scale=1\.0, user-scalable=no/.test(html)) missing.push("verrou de zoom mobile");
      if (!/closeChatPopupsOutside/.test(html)) missing.push("fermeture du chat par clic extérieur");
      if (!/function closeChatPopup\(/.test(html)) missing.push("fermeture d'une conversation");
      if (/data-pop-min/.test(html)) missing.push("bouton « réduire » toujours présent");
      /* Retour terrain n° 1 : les notifications et les amis s'ouvrent en panneau
         ancré (les deux conteneurs + la fermeture au clic extérieur). */
      if (!/id="notif-panel"/.test(html) || !/id="friends-panel"/.test(html)) missing.push("panneaux ancrés absents");
      if (!/closePanelsOutside/.test(html)) missing.push("fermeture des panneaux par clic extérieur");
      if (!/function renderNotifPanel\(/.test(html) || !/function renderFriendsPanel\(/.test(html)) missing.push("rendu des panneaux ancrés");
      return missing.length === 0 ? true : "correctifs absents du fichier servi : " + missing.join(", ");
    });
    await step("le mot de passe erroné est bien refusé par le serveur (401 attendu, hors erreurs applicatives)",
      () => (WANTED.length && !WANTED.includes("S1")) ? true
        : authNoise.length > 0 ? true
        : "aucun 401 enregistré : le test négatif d'authentification n'a pas atteint le serveur");
    const uniqErr = [...new Set(jsErrors)];
    await step("aucune erreur JavaScript ni console.error dans les navigateurs de test",
      () => uniqErr.length === 0 ? true : uniqErr.slice(0, 3).join(" | ").slice(0, 320));
  } catch (e) {
    console.log("\nERREUR FATALE DE CAMPAGNE : " + ((e && e.message) || e));
  } finally {
    if (BROWSER) await BROWSER.close().catch(() => {});
    await stopServer(child);
    cleanup();
  }

  /* ---------------- RAPPORT ---------------- */
  const total = results.length;
  const ko = results.filter((r) => !r.ok);
  console.log("\n======================================================");
  console.log(`RÉSULTAT : ${total - ko.length}/${total} vérifications réussies`);
  if (ko.length) {
    console.log("\nÉCHECS DÉTAILLÉS :");
    for (const r of ko) console.log(`  [${r.id}] ${r.label}\n        -> ${r.note}`);
    const byId = {};
    for (const r of ko) byId[r.id] = (byId[r.id] || 0) + 1;
    console.log("\nRÉCAPITULATIF : " + Object.entries(byId).map(([k, v]) => `${k} (${v})`).join(" · "));
  }
  console.log(ko.length ? "\nDes éléments d'interface sont en défaut (voir ci-dessus)." : "\nTous les parcours d'interface passent.");
  process.exit(ko.length ? 1 : 0);
})();