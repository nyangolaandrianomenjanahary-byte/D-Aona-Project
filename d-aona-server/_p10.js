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
   S8 — BOUTIQUE DE SKINS : COULEUR × MOTIF, DEUX CAMPS (#/skins)
   -------------------------------------------------------------------------
   Deux axes INDÉPENDANTS (16 couleurs × 9 motifs : aucune combinaison n'existe en
   base ni en CSS) et DEUX CAMPS ÉTANCHES : les couleurs claires n'habillent que
   les pions du joueur, les sombres que ceux de l'adversaire. Ce scénario vérifie
   l'onglet par camp, le miroir des catalogues (couleurs, motifs, camps),
   l'indépendance des deux choix ET des deux camps, l'enregistrement séparé par
   camp, la persistance, le refus serveur d'une couleur du mauvais groupe et le
   nettoyage du Profil.
   ========================================================================= */
async function s8_skins(browser) {
  const A = await ensure(browser, "A");

  await step("le profil n'affiche plus ni boutique ni inventaire", async () => {
    await goScreen(A.page, "profile");
    const p = await A.page.evaluate(() => {
      const cta = document.getElementById("pf3-skin-cta");
      return {
        shop: !!document.getElementById("profile-shop"),
        cards: document.querySelectorAll("#profile-root .skin-card").length,
        inv: document.querySelectorAll("#profile-root [data-inv]").length,
        scope: document.querySelectorAll("#profile-root [data-skinscope]").length,
        cta: cta ? cta.getAttribute("href") : null,
      };
    });
    if (p.shop) return "le panneau « Boutique — Skins » est encore dans le profil";
    if (p.cards) return "des cartes de skin sont encore affichées dans le profil : " + p.cards;
    if (p.inv) return "l'inventaire est encore affiché dans le profil : " + p.inv + " ligne(s)";
    if (p.scope) return "les filtres de la boutique sont encore dans le profil";
    if (p.cta !== "#/skins") return "la carte CTA ne mène pas à la boutique : href=" + p.cta;
    return true;
  });

  await step("la carte CTA du profil ouvre la page « Boutique de skins »", async () => {
    await goScreen(A.page, "profile");
    await A.page.locator("#pf3-skin-cta").first().click();
    await sleep(1400);
    const r = await routeOf(A.page);
    if (r !== "skins") return "route atteinte : " + r;
    const txt = await textOf(A.page, "#skins-root");
    const flat = String(txt).replace(/\s+/g, " ");
    if (!/Aperçu du pion/i.test(flat)) return "section « Aperçu du pion » absente";
    if (!/Couleur/i.test(flat)) return "section « Couleur » absente";
    if (!/Motif/i.test(flat)) return "section « Motif » absente";
    if (!/Personnalisation actuelle/i.test(flat)) return "section « Personnalisation actuelle » absente";
    if (!/Appliquer ce skin/i.test(flat)) return "bouton « Appliquer ce skin » absent";
    /* Les DEUX camps sont présentés, et l'onglet dit À QUI l'apparence s'applique. */
    const onglets = await A.page.evaluate(() => [...document.querySelectorAll("#skins-root [data-pion-camp]")]
      .map((b) => ({ camp: b.dataset.pionCamp, txt: b.innerText.replace(/\s+/g, " ").trim(), sel: b.getAttribute("aria-selected") })));
    if (onglets.length !== 2) return "onglets de camp : " + JSON.stringify(onglets);
    if (!onglets.every((o) => /pions/i.test(o.txt))) return "un onglet ne nomme pas son camp : " + JSON.stringify(onglets);
    if (!onglets.some((o) => o.sel === "true")) return "aucun onglet sélectionné au départ";
    return onglets.find((o) => o.camp === "light").sel === "true"
      ? true : "la boutique n'ouvre pas sur les pions du joueur : " + JSON.stringify(onglets);
  });

  await step("chaque onglet ne propose que les 8 couleurs de son groupe (+ 9 motifs)", async () => {
    await goScreen(A.page, "skins");
    const lire = () => A.page.evaluate(() => ({
      camp: (document.querySelector("#skins-root [data-pion-camp][aria-selected='true']") || {}).dataset?.pionCamp,
      colors: [...document.querySelectorAll("#skins-root [data-pick-color]")].map((b) => b.dataset.pickColor),
      patterns: [...document.querySelectorAll("#skins-root [data-pick-pattern]")].map((b) => b.dataset.pickPattern),
      group: (document.querySelector("#skins-root .pion-sub") || {}).innerText?.trim(),
      labels: [...document.querySelectorAll("#skins-root .pion-color .pion-lbl")].map((e) => e.innerText.trim()),
      /* Le jeu de variables employé par chaque pastille : clair = `data-pion-color`,
         sombre = `data-pion-color-dark`. Un camp ne doit voir QUE le sien. */
      vars: [...document.querySelectorAll("#skins-root .pion-color")].map((b) =>
        b.hasAttribute("data-pion-color-dark") ? "dark" : (b.hasAttribute("data-pion-color") ? "light" : "aucun")),
    }));
    for (const camp of ["light", "dark"]) {
      if (camp === "dark") {
        await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
        await sleep(600);
      }
      const d = await lire();
      if (d.camp !== camp) return `onglet attendu ${camp}, obtenu ${d.camp}`;
      if (d.colors.length !== 8) return `${camp} : couleurs affichées ${d.colors.length} (8 attendues)`;
      if (new Set(d.colors).size !== 8) return `${camp} : couleurs en double ${JSON.stringify(d.colors)}`;
      if (d.patterns.length !== 9) return `${camp} : motifs affichés ${d.patterns.length} (9 attendus)`;
      const attendu = camp === "dark" ? "sombre" : "clair";
      if (!new RegExp(attendu, "i").test(d.group || "")) return `${camp} : groupe annoncé « ${d.group} » (${attendu} attendu)`;
      const bad = d.labels.filter((l) => !l || l.length < 3);
      if (bad.length) return `${camp} : libellés de couleur manquants ${JSON.stringify(bad)}`;
      const mixte = d.vars.filter((v) => v !== (camp === "dark" ? "dark" : "light"));
      if (mixte.length) return `${camp} : des pastilles empruntent le jeu de variables de l'autre camp (${JSON.stringify(mixte)})`;
    }
    /* Le CAMP affiché est aussi écrit en clair, pour que le bouton d'enregistrement
       ne laisse aucun doute sur ce qu'il modifie. */
    const t = String(await textOf(A.page, "#skins-root")).replace(/\s+/g, " ");
    return /Pions sombres/.test(t) ? true : "l'onglet actif ne nomme pas son camp : " + t.slice(0, 160);
  });

  await step("couleurs, motifs ET camps du client correspondent à ceux du serveur", async () => {
    const api = (await apiFromPage(A.page, "/api/skins", "GET")).json;
    if (!api || !api.colors || !api.patterns) return "GET /api/skins n'expose pas colors/patterns";
    if (!api.camps) return "GET /api/skins n'expose pas camps";
    const dom = await A.page.evaluate(() => ({
      colors: PION_COLORS.map((c) => [c.id, c.name, c.group]),
      patterns: PION_PATTERNS.map((p) => [p.id, p.name]),
      camps: PION_CAMPS.map((c) => [c.id, c.label, c.group]),
    }));
    const srvC = api.colors.map((c) => [c.id, c.name, c.group]);
    const srvP = api.patterns.map((p) => [p.id, p.name]);
    const srvK = api.camps.map((c) => [c.id, c.label, c.group]);
    const same = (a, b) => a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
    if (!same(srvC, dom.colors)) return "couleurs divergentes : " + JSON.stringify({ serveur: srvC.slice(0, 4), client: dom.colors.slice(0, 4) });
    if (!same(srvP, dom.patterns)) return "motifs divergents : " + JSON.stringify({ serveur: srvP, client: dom.patterns });
    if (!same(srvK, dom.camps)) return "camps divergents : " + JSON.stringify({ serveur: srvK, client: dom.camps });
    /* Les couleurs de chaque camp sont celles de son groupe, côté serveur comme
       côté client : c'est la définition même de l'étanchéité. */
    for (const k of api.camps) {
      const srvGroup = api.colors.filter((c) => c.group === k.group).map((c) => c.id).sort();
      const cliGroup = await A.page.evaluate((camp) => pionColorsOfCamp(camp).map((c) => c.id).sort(), k.id);
      if (JSON.stringify(srvGroup) !== JSON.stringify(cliGroup))
        return `${k.id} : couleurs du camp divergentes ${JSON.stringify({ serveur: srvGroup, client: cliGroup })}`;
      if (srvGroup.length !== 8) return `${k.id} : ${srvGroup.length} couleurs (8 attendues)`;
    }
    return true;
  });

  await step("changer la COULEUR garde le motif, changer le MOTIF garde la couleur (camp clair)", async () => {
    await goScreen(A.page, "skins");
    await A.page.locator('#skins-root [data-pion-camp="light"]').first().click();
    await sleep(400);
    /* 1) Un motif : « Lémurien ». */
    await A.page.locator('#skins-root [data-pick-pattern="lemurien"]').first().click();
    await sleep(500);
    const apresMotif = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      const on = (sel) => { const e = document.querySelector(sel); return e ? e.dataset : null; };
      return {
        color: v.dataset.pionColor, motif: v.dataset.pionMotif,
        selColor: on("#skins-root [data-pick-color].on"), selPattern: on("#skins-root [data-pick-pattern].on"),
        sum: (document.getElementById("pion-sum-pattern") || {}).innerText,
      };
    });
    if (apresMotif.motif !== "lemurien") return "le motif choisi n'atteint pas l'aperçu : " + JSON.stringify(apresMotif);
    if (!apresMotif.selPattern || apresMotif.selPattern.pickPattern !== "lemurien") return "la carte « Lémurien » n'est pas marquée sélectionnée";
    if (!/Lémurien/i.test(apresMotif.sum || "")) return "le résumé n'annonce pas le motif : " + apresMotif.sum;

    /* 2) Puis une couleur CLAIRE : le motif doit RESTER actif. */
    const avant = apresMotif.color;
    await A.page.locator('#skins-root [data-pick-color="bleu_clair"]').first().click();
    await sleep(500);
    const apresCouleur = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      const on = (sel) => { const e = document.querySelector(sel); return e ? e.dataset.pickColor || e.dataset.pickPattern : null; };
      return {
        color: v.dataset.pionColor, motif: v.dataset.pionMotif,
        selColor: on("#skins-root [data-pick-color].on"), selPattern: on("#skins-root [data-pick-pattern].on"),
        sum: (document.getElementById("pion-sum-color") || {}).innerText,
      };
    });
    if (apresCouleur.color !== "bleu_clair") return "l'aperçu n'a pas pris la nouvelle couleur : " + JSON.stringify(apresCouleur);
    if (apresCouleur.color === avant) return "la couleur n'a pas changé (test invalide)";
    if (apresCouleur.motif !== "lemurien") return "le motif a été PERDU en changeant la couleur : " + JSON.stringify(apresCouleur);
    if (apresCouleur.selPattern !== "lemurien") return "la carte du motif a perdu sa sélection : " + JSON.stringify(apresCouleur);
    return /Bleu clair/i.test(apresCouleur.sum || "") ? true : "le résumé n'annonce pas la couleur : " + apresCouleur.sum;
  });

  await step("les deux camps sont indépendants : changer l'un ne touche pas l'autre", async () => {
    /* Le camp SOMBRE reçoit une apparence à lui, puis on revient au camp clair :
       son brouillon (bleu clair + lémurien, non enregistré) doit être intact. */
    await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
    await sleep(500);
    await A.page.locator('#skins-root [data-pick-color="grenat"]').first().click();
    await sleep(350);
    await A.page.locator('#skins-root [data-pick-pattern="crocodile"]').first().click();
    await sleep(350);
    const sombre = await A.page.evaluate(() => ({
      color: document.querySelector("#skins-root [data-pion-preview]").dataset.pionColorDark,
      motif: document.querySelector("#skins-root [data-pion-preview]").dataset.pionMotifDark,
      sumC: (document.getElementById("pion-sum-color") || {}).innerText,
      sumP: (document.getElementById("pion-sum-pattern") || {}).innerText,
    }));
    if (sombre.color !== "grenat" || sombre.motif !== "crocodile") return "le camp sombre n'a pas pris son apparence : " + JSON.stringify(sombre);
    if (!/Grenat/i.test(sombre.sumC || "") || !/Crocodile/i.test(sombre.sumP || "")) return "résumé du camp sombre incomplet : " + JSON.stringify(sombre);

    await A.page.locator('#skins-root [data-pion-camp="light"]').first().click();
    await sleep(500);
    const clair = await A.page.evaluate(() => ({
      color: document.querySelector("#skins-root [data-pion-preview]").dataset.pionColor,
      motif: document.querySelector("#skins-root [data-pion-preview]").dataset.pionMotif,
      sombreSurApercu: !!document.querySelector("#skins-root [data-pion-preview]").dataset.pionColorDark,
    }));
    if (clair.color !== "bleu_clair" || clair.motif !== "lemurien")
      return "le brouillon du camp clair a été perdu en passant par le camp sombre : " + JSON.stringify(clair);
    if (clair.sombreSurApercu) return "l'aperçu du camp clair porte encore les attributs du camp sombre";
    /* Le plateau, lui, n'a pas bougé : rien n'a été ENREGISTRÉ. */
    const board = await A.page.evaluate(() => {
      const b = document.getElementById("fanorona-board");
      return { light: b.dataset.pionColor, lightM: b.dataset.pionMotif, dark: b.dataset.pionColorDark, darkM: b.dataset.pionMotifDark };
    });
    return board.light === "blanc" && board.dark === "noir"
      ? true : "un brouillon non enregistré a atteint le plateau : " + JSON.stringify(board);
  });

  await step("aperçu, vignettes de motif et plateau partagent le même rendu (les deux camps)", async () => {
    /* Les quatre motifs illustrés sont des IMAGES servies par `assets/pions/` —
       avec DEUX dessins : le lot initial pour les pions CLAIRS (`<id>.png`), le
       lot `Assets-noirs-contraste-initial` pour les SOMBRES (`<id>-sombre.png`).
       Les cinq autres motifs restent des silhouettes SVG. */
    const MOTIFS_IMAGE = ["zebu", "ravinala", "lemurien", "crocodile"];
    for (const camp of ["light", "dark"]) {
      await A.page.locator(`#skins-root [data-pion-camp="${camp}"]`).first().click();
      await sleep(450);
      const d = await A.page.evaluate(() => {
        const bg = (el) => (el ? getComputedStyle(el).backgroundImage : null);
        const coucheMotif = (el) => {
          if (!el) return null;
          const s = getComputedStyle(el, "::before");
          /* Le masque généré est une couche COMPOSITE : le navigateur la numérote,
             mais l'URL du SVG y figure toujours. Les motifs IMAGE (les quatre
             illustrations de `assets/pions/`) ne passent pas par le masque : ils
             arrivent par `backgroundImage`, et le masque doit valoir `none`. */
          return { mask: (s.webkitMaskImage || s.maskImage || "") + "", ink: s.backgroundColor, img: s.backgroundImage + "" };
        };
        const dark = (document.querySelector("#skins-root [data-pion-camp][aria-selected='true']") || {}).dataset?.pionCamp === "dark";
        const big = document.querySelector("#skins-root [data-pion-preview]");
        const mini = document.querySelector('#skins-root [data-pick-pattern="lemurien"] .pion-view');
        const board = document.getElementById("fanorona-board");
        return {
          dark, bigBg: bg(big), miniBg: bg(mini), bigLayer: coucheMotif(big),
          bigMotif: dark ? big.dataset.pionMotifDark : big.dataset.pionMotif,
          miniMotif: mini && (dark ? mini.dataset.pionMotifDark : mini.dataset.pionMotif),
          board: !!board,
          boardColor: board && (dark ? board.dataset.pionColorDark : board.dataset.pionColor),
          boardMotif: board && (dark ? board.dataset.pionMotifDark : board.dataset.pionMotif),
          styles: document.querySelectorAll("#pion-styles").length,
        };
      });
      if (d.styles !== 1) return "la feuille #pion-styles n'est pas générée (ou en double)";
      if (!/radial-gradient/.test(d.bigBg || "")) return `${camp} : l'aperçu n'a pas de dégradé : ` + d.bigBg;
      /* La vignette de motif montre le MOTIF COURANT teinté de la couleur choisie :
         on ne compare donc les fonds que si le motif de l'aperçu est le même. Le
         camp sombre a « Crocodile » en brouillon, d'où la comparaison sur la
         vignette de CE motif quand il est sélectionné. */
      if (!d.dark && d.bigBg !== d.miniBg)
        return `aperçu et vignette ne partagent pas la couleur : ` + JSON.stringify([d.bigBg, d.miniBg]);
      /* DEUX familles de motifs, deux peintures — et jamais les deux à la fois :
         — IMAGE (le lot de `assets/pions/`) : le fichier est peint par
           `background-image`, et le masque reste `none` (sinon il rognerait
           l'illustration sur le contour de la silhouette) ;
         — SILHOUETTE : le masque SVG est posé et aucune image ne se superpose. */
      const couche = d.bigLayer || {};
      if (MOTIFS_IMAGE.includes(d.bigMotif)) {
        /* Le FICHIER attendu suit le camp de l'onglet actif : `-sombre` au camp
           sombre (dont le motif en brouillon est « crocodile »). */
        const attendu = "assets/pions/" + d.bigMotif + (d.dark ? "-sombre" : "") + "\\.png";
        if (!new RegExp(attendu).test(couche.img || ""))
          return `${camp} : le motif image n'est pas peint (attendu ${attendu}) : ` + String(couche.img).slice(0, 140);
        if (!/^none$/i.test(String(couche.mask).trim()))
          return `${camp} : un masque rognerait l'image du motif : ` + String(couche.mask).slice(0, 120);
      } else if (d.bigMotif !== "aucun") {
        if (!/data:image\/svg\+xml/.test(decodeURIComponent(couche.mask || "")))
          return `${camp} : le motif n'est pas un masque SVG : ` + String(couche.mask).slice(0, 120);
        if (!/^none$/i.test(String(couche.img).trim()))
          return `${camp} : une image se superpose à la silhouette : ` + String(couche.img).slice(0, 120);
      }
      if (!d.board) return "plateau absent du DOM (#fanorona-board)";
      /* Le plateau porte le style ENREGISTRÉ (pas le brouillon, qui n'est pas encore
         appliqué) : c'est `S.pion.styles` que la page a lu au chargement. */
      const saved = await A.page.evaluate((c) => (window.App.state().pion.styles || {})[c] || {}, camp);
      if (d.boardColor !== saved.color || d.boardMotif !== saved.pattern)
        return `${camp} : le plateau ne porte pas le style enregistré : ` + JSON.stringify([d.boardColor, d.boardMotif, saved]);
    }
    return true;
  });

  await step("« Appliquer ce skin » enregistre la couleur et le motif SÉPARÉMENT, pour le camp affiché", async () => {
    /* Le camp sombre porte un brouillon (grenat + crocodile) non enregistré ; le
       camp clair aussi (bleu clair + lémurien) — seul le camp AFFICHÉ part. */
    await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
    await sleep(450);
    const btn = A.page.locator("#pion-apply");
    if (await btn.isDisabled()) return "le bouton est inactif alors que le choix a changé";
    await btn.click();
    await sleep(2000);
    const s = await stateOf(A.page);
    const st = (s.pion && s.pion.styles && s.pion.styles.dark) || null;
    if (!st) return "état du pion absent dans l'interface : " + JSON.stringify(s.pion);
    if (st.color !== "grenat" || st.pattern !== "crocodile") return "apparence enregistrée inattendue : " + JSON.stringify(st);
    const api = (await apiFromPage(A.page, "/api/skins", "GET")).json;
    if (!api.pionStyles || api.pionStyles.dark.color !== "grenat" || api.pionStyles.dark.pattern !== "crocodile")
      return "le serveur ne renvoie pas l'apparence sombre en deux champs : " + JSON.stringify(api && api.pionStyles);
    if (api.pionStyles.light.color !== "blanc" || api.pionStyles.light.pattern !== "aucun")
      return "enregistrer le camp sombre a modifié le camp clair : " + JSON.stringify(api.pionStyles.light);
    return (await btn.isDisabled()) ? true : "le bouton reste actif alors que tout est appliqué";
  });

  await step("les DEUX apparences survivent à un rechargement (le brouillon, lui, ne part pas)", async () => {
    await A.page.reload();
    await sleep(3000);
    await goScreen(A.page, "skins");
    await sleep(1200);
    /* La boutique se rouvre sur les pions du joueur. Le camp clair n'a JAMAIS été
       enregistré (son brouillon valait bleu clair + lémurien) : l'aperçu doit être
       revenu au style ENREGISTRÉ (blanc, aucun motif) — un brouillon n'est pas une
       apparence, et un rechargement ne peut pas l'inventer. */
    const clair = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      const board = document.getElementById("fanorona-board");
      return {
        camp: (document.querySelector("#skins-root [data-pion-camp][aria-selected='true']") || {}).dataset?.pionCamp,
        color: v && v.dataset.pionColor, motif: v && v.dataset.pionMotif,
        sumC: (document.getElementById("pion-sum-color") || {}).innerText,
        sumP: (document.getElementById("pion-sum-pattern") || {}).innerText,
        boardColor: board && board.dataset.pionColor, boardMotif: board && board.dataset.pionMotif,
        boardDark: board && board.dataset.pionColorDark, boardDarkMotif: board && board.dataset.pionMotifDark,
        disabled: (document.getElementById("pion-apply") || {}).disabled,
      };
    });
    if (clair.camp !== "light") return "onglet ouvert par défaut : " + clair.camp;
    if (clair.color !== "blanc" || clair.motif !== "aucun")
      return "le brouillon du camp clair a survécu au rechargement : " + JSON.stringify(clair);
    if (!/Blanc/i.test(clair.sumC || "")) return "résumé du camp clair non restauré : " + JSON.stringify(clair);
    if (clair.boardColor !== "blanc" || clair.boardDark !== "grenat" || clair.boardDarkMotif !== "crocodile")
      return "le plateau ne reprend pas les DEUX apparences enregistrées : " + JSON.stringify(clair);
    if (!clair.disabled) return "le bouton devrait être inactif (aucun changement en attente)";
    /* Camp sombre : son apparence ENREGISTRÉE (grenat + crocodile) est là, elle. */
    await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
    await sleep(600);
    const sombre = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      return {
        color: v && v.dataset.pionColorDark, motif: v && v.dataset.pionMotifDark,
        sumC: (document.getElementById("pion-sum-color") || {}).innerText,
        sumP: (document.getElementById("pion-sum-pattern") || {}).innerText,
      };
    });
    if (sombre.color !== "grenat" || sombre.motif !== "crocodile")
      return "aperçu du camp sombre non restauré : " + JSON.stringify(sombre);
    return /Grenat/i.test(sombre.sumC || "") && /Crocodile/i.test(sombre.sumP || "")
      ? true : "résumé du camp sombre non restauré : " + JSON.stringify(sombre);
  });

  await step("couleur, motif, camp : cinq refus (400) sans rien écrire", async () => {
    const couleur = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "light", color: "rose_fluo", pattern: "lemurien" });
    if (couleur.status !== 400) return "couleur inconnue : code " + couleur.status + " (400 attendu)";
    const motif = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "light", color: "blanc", pattern: "dragon_de_komodo" });
    if (motif.status !== 400) return "motif inconnu : code " + motif.status + " (400 attendu)";
    /* ÉTANCHÉITÉ, depuis un appel DIRECT (sans passer par l'interface) : une couleur
       sombre ne va pas aux pions clairs, une couleur claire ne va pas aux sombres. */
    const croise1 = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "light", color: "noir", pattern: "aucun" });
    if (croise1.status !== 400) return "couleur sombre pour les pions clairs : code " + croise1.status + " (400 attendu)";
    const croise2 = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "dark", color: "blanc", pattern: "aucun" });
    if (croise2.status !== 400) return "couleur claire pour les pions sombres : code " + croise2.status + " (400 attendu)";
    const campInconnu = await apiFromPage(A.page, "/api/pion/style", "POST", { camp: "gauche", color: "blanc", pattern: "aucun" });
    if (campInconnu.status !== 400) return "camp inconnu : code " + campInconnu.status + " (400 attendu)";
    /* Aucun de ces refus n'a modifié l'état enregistré des deux camps. */
    const api = (await apiFromPage(A.page, "/api/skins", "GET")).json;
    return api.pionStyles && api.pionStyles.light.color === "blanc" && api.pionStyles.light.pattern === "aucun"
      && api.pionStyles.dark.color === "grenat" && api.pionStyles.dark.pattern === "crocodile"
      ? true : "un refus a tout de même modifié l'état : " + JSON.stringify(api && api.pionStyles);
  });

  await step("la couleur seule suffit : « Aucun motif » enregistre un pion sombre uni", async () => {
    await goScreen(A.page, "skins");
    await A.page.locator('#skins-root [data-pion-camp="dark"]').first().click();
    await sleep(500);
    await A.page.locator('#skins-root [data-pick-color="noir"]').first().click();
    await sleep(400);
    await A.page.locator('#skins-root [data-pick-pattern="aucun"]').first().click();
    await sleep(400);
    await A.page.locator("#pion-apply").click();
    await sleep(1800);
    const api = (await apiFromPage(A.page, "/api/skins", "GET")).json;
    if (!api.pionStyles || api.pionStyles.dark.color !== "noir" || api.pionStyles.dark.pattern !== "aucun")
      return "couleur seule non enregistrée : " + JSON.stringify(api && api.pionStyles);
    if (api.pionStyles.light.color !== "blanc")
      return "enregistrer le camp sombre a modifié le camp clair : " + JSON.stringify(api.pionStyles.light);
    /* Le masque, l'encre ET l'image doivent être neutralisés : un pseudo-élément
       non masqué peindrait un disque d'encre plein sur le pion, et une image
       oubliée y collerait une illustration fantôme. */
    const mask = await A.page.evaluate(() => {
      const v = document.querySelector("#skins-root [data-pion-preview]");
      const s = getComputedStyle(v, "::before");
      return { mask: (s.webkitMaskImage || s.maskImage || ""), fond: s.backgroundColor, img: s.backgroundImage + "" };
    });
    if (!/^none$/i.test(mask.mask) && mask.mask !== "") return "un motif subsiste avec « Aucun motif » : " + mask.mask.slice(0, 90);
    if (!/^none$/i.test(mask.img.trim())) return "une image de motif subsiste avec « Aucun motif » : " + mask.img.slice(0, 90);
    return /rgba\(0, 0, 0, 0\)|transparent/.test(mask.fond) ? true
      : "« Aucun motif » peint quand même un disque d'encre : " + mask.fond;
  });

  await step("aucun skin du catalogue ne peint un camp de pions (un seul mécanisme par camp)", async () => {
    await goScreen(A.page, "skins");
    const d = await A.page.evaluate(() => {
      const board = document.getElementById("fanorona-board");
      const st = document.getElementById("skin-styles");
      const css = st ? st.textContent : "";
      const rules = css.split("\n").filter((l) => l.includes(".piece."));
      return {
        classes: board ? [...board.classList].filter((c) => c.startsWith("skin-")) : null,
        feuille: !!st,
        meRules: rules.filter((l) => /\.piece\.me\b/.test(l)).length,
        oppRules: rules.filter((l) => /\.piece\.opp\b/.test(l)).length,
        pionStyles: document.querySelectorAll("#pion-styles").length,
        boardLight: board && [board.dataset.pionColor, board.dataset.pionMotif],
        boardDark: board && [board.dataset.pionColorDark, board.dataset.pionMotifDark],
      };
    });
    if (d.pionStyles !== 1) return "feuille des styles de pion absente ou en double : " + d.pionStyles;
    if (d.feuille || d.meRules || d.oppRules)
      return "une feuille de skins de pions subsiste : " + JSON.stringify({ feuille: d.feuille, me: d.meRules, opp: d.oppRules });
    if (d.classes === null) return "plateau absent du DOM (#fanorona-board)";
    if (d.classes.some((c) => c.startsWith("skin-pions")))
      return "un skin de pions est encore appliqué au plateau : " + JSON.stringify(d.classes);
    return d.boardLight[0] && d.boardDark[0]
      ? true : "le plateau ne porte pas les DEUX apparences : " + JSON.stringify([d.boardLight, d.boardDark]);
  });

  await step("la page tient à 360 px sans débordement horizontal", async () => {
    await A.page.setViewportSize({ width: 360, height: 760 });
    await goScreen(A.page, "skins");
    await sleep(1100);
    const d = await A.page.evaluate(() => {
      const root = document.getElementById("skins-root");
      const trop = [...root.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > 361);
      const boutons = [...root.querySelectorAll(".pion-color, .pion-motif, .pion-tab, #pion-apply")]
        .map((b) => Math.round(b.getBoundingClientRect().height));
      return {
        scrollW: document.documentElement.scrollWidth,
        over: trop.slice(0, 3).map((e) => (e.className || e.tagName) + "@" + Math.round(e.getBoundingClientRect().right)),
        petit: boutons.filter((h) => h < 44).length,
      };
    });
    await A.page.setViewportSize({ width: 1280, height: 900 });
    if (d.scrollW > 361) return "la page déborde : scrollWidth=" + d.scrollW + " · " + JSON.stringify(d.over);
    return d.petit ? d.petit + " cible(s) tactile(s) sous 44 px" : true;
  });
}

