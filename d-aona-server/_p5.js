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

  /* =========================================================================
     Retour terrain n° 4 — carrousel publicitaire de l'Accueil
     =========================================================================
     Ce qui est vérifié ici est l'exigence telle qu'elle est écrite : le contenu
     vient d'une liste CONFIGURABLE (on relit le fichier servi et on le compare au
     DOM), il défile tout seul, il se met en pause au survol, les points y mènent,
     le glissement horizontal change de bannière, et chaque bannière ouvre son lien
     dans un NOUVEL onglet. Les FLÈCHES sont vérifiées à part : visibles seulement au
     survol, et mesurées au pixel pour rester hors du texte des visuels. */
  await step("l'Accueil porte le carrousel publicitaire configuré (n° 4)", async () => {
    await goScreen(A.page, "home");
    await sleep(1400);
    const conf = await (await fetch(BASE + "/assets/ad/pubs.json")).json();
    const attendues = await A.page.evaluate((pubs) => window.App.pubsActives(pubs).map((p) => p.image), conf.pubs || []);
    const vu = await A.page.evaluate(() => {
      const car = document.getElementById("ad-car");
      if (!car) return null;
      const slides = [...car.querySelectorAll("[data-car-slide]")];
      return {
        n: slides.length,
        src: slides.map((s) => (s.querySelector("img") || {}).getAttribute("src")),
        cible: slides.map((s) => s.getAttribute("target")),
        rel: slides.map((s) => s.getAttribute("rel") || ""),
        tags: car.querySelectorAll(".ad-car__tag").length,
        points: car.querySelectorAll("[data-car-go]").length,
      };
    });
    if (!vu) return "aucun carrousel sur l'Accueil alors que la configuration est active";
    if (vu.n !== attendues.length)
      return `le carrousel montre ${vu.n} bannière(s) pour ${attendues.length} active(s) dans la configuration`;
    if (vu.n < 1) return "carrousel vide";
    if (vu.tags !== vu.n) return "la mention « Publicité » ne suit pas chaque bannière";
    if (vu.cible.some((c) => c !== "_blank")) return "une bannière ne s'ouvre pas dans un nouvel onglet";
    if (vu.rel.some((r) => !/noopener/.test(r))) return "un lien de bannière s'ouvre sans noopener";
    if (JSON.stringify(vu.src) !== JSON.stringify(attendues))
      return "les images affichées ne sont pas celles de la configuration : " + JSON.stringify([vu.src, attendues]);
    if (vu.n > 1 && vu.points !== vu.n) return "les points ne correspondent pas au nombre de bannières";
    /* La règle de DATES est prouvée sur des cas fabriqués : une bannière terminée et
       une bannière pas encore commencée ne doivent pas être retenues. */
    const regle = await A.page.evaluate(() => window.App.pubsActives([
      { id: "passee", image: "a.png", fin: "2000-01-01" },
      { id: "future", image: "b.png", debut: "2999-01-01" },
      { id: "active", image: "c.png", debut: "2000-01-01", fin: "2999-12-31" },
      { id: "sans-date", image: "d.png" },
    ]).map((p) => p.id));
    return JSON.stringify(regle) === JSON.stringify(["active", "sans-date"]) ? true
      : "la règle de dates est fausse : " + JSON.stringify(regle);
  });

  await step("le carrousel défile seul, se met en pause au survol, et répond aux points et au glissement (n° 4)", async () => {
    const lire = () => A.page.evaluate(() => {
      const car = document.getElementById("ad-car");
      if (!car) return { on: -1 };
      return { on: [...car.querySelectorAll("[data-car-go]")].findIndex((x) => x.classList.contains("on")) };
    });
    const n = await A.page.evaluate(() => document.querySelectorAll("#ad-car [data-car-slide]").length);
    if (n < 2) return "une seule bannière : les gestes du carrousel ne sont pas mesurables";
    await A.page.mouse.move(6, 6);                     // curseur HORS du carrousel
    const a = await lire();
    await sleep(7400);
    const b = await lire();
    if (b.on === a.on) return `le carrousel ne défile pas tout seul (index ${a.on} inchangé)`;
    /* Pause au survol : 7 s de survol, index immobile. Le point visé est VÉRIFIÉ
       (elementFromPoint) : si le carrousel est hors de l'écran ou partiellement
       sous la barre haute, la souris n'entre PAS dans la bannière — la mesure ne
       dirait rien de la pause. On le constate, puis on survole le bon point. */
    const cible = await A.page.evaluate(() => {
      const c = document.getElementById("ad-car");
      if (!c) return null;
      c.scrollIntoView({ block: "center", behavior: "instant" });
      const r = c.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const el = document.elementFromPoint(x, y);
      return { x, y, dedans: !!el && c.contains(el), dessus: el ? (el.className || el.tagName) + "" : null };
    });
    if (!cible) return "carrousel introuvable";
    if (!cible.dedans) return `le point de survol (${cible.x}, ${cible.y}) tombe sur « ${cible.dessus} », pas sur la bannière`;
    await A.page.mouse.move(cible.x, cible.y);
    const c1 = await lire();
    await sleep(7400);
    const c2 = await lire();
    if (c1.on !== c2.on) return `le carrousel avance malgré le survol (${c1.on} -> ${c2.on})`;
    /* Point cliquable : retour à la première bannière. */
    await A.page.mouse.move(6, 6);
    await A.page.click('#ad-car [data-car-go="0"]');
    await sleep(700);
    if ((await lire()).on !== 0) return "le premier point n'affiche pas la première bannière";
    /* Glissement horizontal : le geste tactile du mobile, rejoué par les mêmes
       événements pointeur (donc mesurable à la souris aussi). Il part de la rangée
       des POINTS, jamais d'une diapositive, pour ne pas suivre un lien en même
       temps que le geste. */
    const b2 = await A.page.locator("#ad-car").boundingBox();
    const y = b2.y + b2.height - 6;
    await A.page.mouse.move(b2.x + b2.width * 0.72, y);
    await A.page.mouse.down();
    await A.page.mouse.move(b2.x + b2.width * 0.18, y, { steps: 10 });
    await A.page.mouse.up();
    await sleep(700);
    const e = await lire();
    return e.on === 1 ? true : "le glissement ne change pas de bannière (index " + e.on + ")";
  });

  /* Les flèches ne doivent pas recouvrir le TEXTE des bannières — et ce n'est pas
     une intention, c'est MESURÉ : chaque bannière réellement servie est relue dans
     un canevas (même origine) et on cherche, dans sa colonne de gauche, le premier
     pixel de texte sombre sur fond clair. La flèche gauche, relevée au survol, doit
     rester à gauche de ce pixel. Changer de visuel dans `pubs.json` rejoue la
     mesure : une bannière écrite jusque dans ses bords ferait échouer ce contrôle. */
  await step("les flèches du carrousel restent hors du texte des bannières (n° 4)", async () => {
    await goScreen(A.page, "home");
    await sleep(1200);
    /* Discrétion : aucune flèche affichée sans survol. */
    await A.page.mouse.move(6, 6);
    await sleep(250);
    const repos = await A.page.evaluate(() => {
      const f = document.querySelector("#ad-car .ad-car__arrow");
      return f ? getComputedStyle(f).visibility : "absente";
    });
    if (repos === "absente") return "le carrousel de l'Accueil n'a pas de flèches";
    if (repos !== "hidden") return "une flèche reste affichée hors survol (occupation permanente)";
    await A.page.hover("#ad-car");
    await sleep(900);
    const m = await A.page.evaluate(async () => {
      const car = document.getElementById("ad-car");
      const aGauche = car.querySelector(".ad-car__arrow.prev"), aDroite = car.querySelector(".ad-car__arrow.next");
      if (!aGauche || !aDroite) return { erreur: "flèches manquantes" };
      const affichees = [aGauche, aDroite].map((f) => getComputedStyle(f).visibility);
      const imgs = [...car.querySelectorAll("[data-car-slide] img")];
      const carBox = car.getBoundingClientRect();
      /* Cadre de référence : la diapositive VISIBLE (les autres sont translatées
         par la piste, leur rectangle n'est plus comparable aux flèches). */
      const vis = imgs.find((i) => Math.abs(i.getBoundingClientRect().left - carBox.left) < 3);
      if (!vis) return { erreur: "aucune diapositive alignée sur le carrousel (transition en cours ?)" };
      const rv = vis.getBoundingClientRect();
      const rg = aGauche.getBoundingClientRect(), rd = aDroite.getBoundingClientRect();
      const charger = (src) => new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error(src));
        i.src = src;
      });
      const bilans = [];
      for (const img of imgs) {
        const src = img.currentSrc || img.src;
        const r = img.getBoundingClientRect();
        const dw = Math.round(r.width), dh = Math.round(r.height);
        let bmp;
        try { bmp = await charger(src); } catch (e) { bilans.push({ nom: src.split("/").pop(), note: "fichier illisible" }); continue; }
        if (!dw || !dh || !bmp.naturalWidth || !bmp.naturalHeight) {
          bilans.push({ nom: src.split("/").pop(), note: "géométrie non mesurable" });
          continue;
        }
        /* `object-fit: cover` : correspondance affichage → image (échelle
           maximale, recadrage centré, `object-position: 50% 45%`). */
        const ech = Math.max(dw / bmp.naturalWidth, dh / bmp.naturalHeight);
        const ox = (dw - bmp.naturalWidth * ech) / 2, oy = (dh - bmp.naturalHeight * ech) * 0.45;
        const c = document.createElement("canvas");
        c.width = dw; c.height = dh;
        const cx = c.getContext("2d", { willReadFrequently: true });
        cx.drawImage(bmp, ox, oy, bmp.naturalWidth * ech, bmp.naturalHeight * ech);
        const dat = cx.getImageData(0, 0, dw, dh).data;
        const lum = (x, y) => { const i = (y * dw + x) * 4; return (dat[i] * 299 + dat[i + 1] * 587 + dat[i + 2] * 114) / 1000; };
        /* Premier pixel de TEXTE de la colonne de gauche (bande 25–85 % de la
           hauteur) : sombre, sur un fond CLAIR à 12 px de là — un aplat sombre
           (bandeau bleu d'un visuel) ne compte pas comme du texte. */
        let min = null;
        for (let y = Math.round(0.25 * dh); y < Math.round(0.85 * dh); y++) {
          for (let x = 0; x < Math.min(200, dw - 14); x++) {
            if (lum(x, y) < 120 && lum(x + 12, y) > 190) { if (min === null || x < min) min = x; break; }
          }
        }
        bilans.push({ nom: src.split("/").pop(), min });
      }
      return {
        affichees,
        gauche: Math.round((rg.right - rv.left) * 10) / 10,
        droite: Math.round((rv.right - rd.left) * 10) / 10,
        largeur: Math.round(rv.width),
        bilans,
      };
    });
    if (m.erreur) return m.erreur;
    if (m.affichees.some((v) => v !== "visible")) return "les flèches restent masquées au survol";
    if (m.gauche < 3 || m.droite < 3)
      return `une flèche colle au bord de l'image (gauche ${m.gauche} px, droite ${m.droite} px)`;
    if (m.gauche > m.largeur / 4 || m.droite > m.largeur / 4) return "une flèche s'avance trop dans l'image";
    const mesures = m.bilans.filter((b) => typeof b.min === "number");
    if (!mesures.length) return "aucune bannière mesurable : " + JSON.stringify(m.bilans);
    console.log("         mesure : flèches à " + m.gauche + " px du bord gauche (image " + m.largeur
      + " px) · texte : " + mesures.map((b) => b.nom + " dès " + b.min + " px").join(" · ")
      + (m.bilans.length > mesures.length ? " · non mesurables : " + m.bilans.filter((b) => b.note).map((b) => b.nom + " (" + b.note + ")").join(", ") : ""));
    for (const b of mesures) {
      if (m.gauche > b.min - 2)
        return `la flèche gauche (${m.gauche} px) recouvre le texte de « ${b.nom} » (texte dès ${b.min} px)`;
    }
    return true;
  });

  /* =========================================================================
     Retour terrain n° 5 — bloc de saison à la place de la carte de tournoi
     ========================================================================= */
  await step("l'Accueil affiche la carte de SAISON (pseudo, Elo, 3 indicateurs) à la place de la carte tournoi (n° 5)", async () => {
    await goScreen(A.page, "home");
    await sleep(1000);
    const d = await A.page.evaluate(() => {
      const c = document.getElementById("season-card");
      if (!c) return null;
      const s = window.App.state();
      return {
        fil: (c.querySelector(".season-crumb") || {}).innerText || "",
        boutons: c.querySelectorAll(".season-crumb button").length,
        pseudo: (c.querySelector(".dash-info h2") || {}).innerText || "",
        elo: (c.querySelector(".dash-meta") || {}).innerText || "",
        tuiles: [...c.querySelectorAll(".dash-stat")].map((t) => t.innerText.replace(/\n/g, " ")),
        carteTournoi: !!document.getElementById("home-root").querySelector(".t-card"),
        etat: { pseudo: s.pseudo, elo: s.elo, balance: s.balance },
      };
    });
    if (!d) return "aucune carte de saison sur l'Accueil";
    if (d.carteTournoi) return "l'ancienne carte de tournoi est encore affichée à la place";
    for (const mot of ["wallet", "tournois", "jeux", "classement"]) {
      if (!new RegExp(mot, "i").test(d.fil)) return "fil d'Ariane incomplet : « " + d.fil.replace(/\n/g, " ") + " »";
    }
    if (d.boutons !== 4) return "le fil d'Ariane ne porte pas ses 4 accès cliquables (" + d.boutons + ")";
    if (d.pseudo !== d.etat.pseudo) return "le pseudo affiché n'est pas celui du joueur connecté : « " + d.pseudo + " »";
    if (!d.elo.includes(String(d.etat.elo))) return "l'Elo affiché ne suit pas les données réelles : « " + d.elo + " »";
    /* Mise en forme française : séparateur de milliers (espace fine) et unité « Ar ». */
    const solde = d.tuiles.find((t) => /solde/i.test(t)) || "";
    const nu = (s) => String(s).replace(/[\s\u00a0\u202f]/g, "");
    if (!/Ar/.test(solde)) return "le solde n'affiche pas l'unité « Ar » : « " + solde + " »";
    if (!nu(solde).includes(nu(d.etat.balance)))
      return `le solde affiché (« ${solde} ») ne correspond pas au wallet réel (${d.etat.balance})`;
    if (!d.tuiles.some((t) => /parties jou/i.test(t))) return "l'indicateur « Parties jouées » manque";
    return d.tuiles.some((t) => /victoires/i.test(t)) ? true : "l'indicateur « Victoires » manque";
  });

  await step("chaque mot du fil d'Ariane mène à sa section (n° 5)", async () => {
    for (const [mot, route] of [["wallet", "wallet"], ["classement", "ranks"], ["jeux", "play"]]) {
      await goScreen(A.page, "home");
      await sleep(800);
      await A.page.click(`#season-card [data-crumb="${mot}"]`);
      await sleep(1000);
      const vu = await routeOf(A.page);
      if (vu !== route) return `« ${mot} » ouvre « ${vu} » au lieu de « ${route} »`;
    }
    /* « tournois » ouvre l'écran Match sur son onglet Tournois. */
    await goScreen(A.page, "home");
    await sleep(800);
    await A.page.click('#season-card [data-crumb="tournois"]');
    await sleep(1400);
    const m = await A.page.evaluate(() => {
      const actif = [...document.querySelectorAll("#mt-tiles .mt-tile")].find((t) => t.getAttribute("aria-selected") === "true");
      return { route: (location.hash || "").replace("#/", "").split("?")[0], onglet: actif ? actif.dataset.mtab : "" };
    });
    if (m.route !== "match") return "« tournois » n'ouvre pas l'écran Match (« " + m.route + " »)";
    return m.onglet === "tournois" ? true : "« tournois » n'ouvre pas l'onglet Tournois (« " + m.onglet + " »)";
  });
}