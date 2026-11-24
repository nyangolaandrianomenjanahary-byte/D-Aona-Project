/* =========================================================================
   S12 — ÉCRAN MATCH : héro, tuiles de statistiques, deux colonnes, défis réels
   =========================================================================
   L'écran Match est une vue de CONSULTATION : suivre (En direct), défier
   (Défis), s'inscrire (Tournois). Il n'a pas d'onglet « À jouer » — mettre sa
   partie en file reste le travail de l'écran Jeux.
   Les trois entrées sont des TUILES DE STATISTIQUES (libellé, compteur vivant,
   sous-libellé) et chaque onglet se déploie en DEUX COLONNES : la liste à
   gauche, le contexte à droite. Ce scénario confronte ce que l'écran AFFICHE à
   ce que le serveur SAIT : compteurs des tuiles vs listes réelles, jauge de défi
   vs dates ISO du serveur, remboursement vs solde. Aucune donnée décorative
   n'est tolérée.
   ========================================================================= */
async function s12_match(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B");

  /* Clic tolérant : un élément absent renvoie false au lieu de faire échouer la
     campagne entière (une régression d'interface doit produire un ÉCHEC lisible,
     pas interrompre les scénarios suivants). */
  const mtClick = async (page, sel, ms = 5000) => {
    try { await page.click(sel, { timeout: ms }); return true; } catch (e) { return false; }
  };

  /* Les trois tuiles du héro : libellé, compteur, sous-libellé, état actif. */
  const mtTiles = (page) => page.evaluate(() => [...document.querySelectorAll("#mt-tiles .mt-tile")].map((t) => ({
    mtab: t.dataset.mtab,
    label: ((t.querySelector(".l") || {}).innerText || "").trim(),
    n: ((t.querySelector(".v") || {}).innerText || "").trim(),
    sub: ((t.querySelector(".s") || {}).innerText || "").trim(),
    on: t.getAttribute("aria-selected") === "true",
    h: Math.round(t.getBoundingClientRect().height),
  })));

  /* Nombre de colonnes réellement rendues par une grille (1 = empilé). */
  const mtCols = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return -1;
    const tpl = getComputedStyle(el).gridTemplateColumns;
    return tpl && tpl !== "none" ? tpl.split(" ").filter(Boolean).length : 0;
  }, sel);

  /* Vérifie le KYC comme le fait un administrateur : dépôt des DEUX faces puis
     approbation par le compte d'administration, et la page recharge son état
     (S.kyc est lu au démarrage). Un défi AVEC MISE est refusé sans KYC — on ne
     court-circuite pas la règle, on la respecte. */
  const mtVerify = async (p) => {
    if ((await stateOf(p.page)).kyc) return true;
    const r = await verifyKycViaApi(p.page, browser);
    if (!r || r.status !== "verified") return false;
    await p.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2800);
    return (await stateOf(p.page)).kyc === true;
  };

  /* Ouvre l'assistant de défi depuis la colonne « Joueurs en ligne » et le mène
     jusqu'au RÉCAPITULATIF : jeu → plateau → format. L'étape 02 (Mode) est
     RETIRÉE de ce parcours (le mode est déjà « défi »), c'est le récapitulatif
     qui porte l'adversaire et la mise. Renvoie true, ou le message d'échec. */
  const mtOuvrirDefi = async (p, pseudo) => {
    await goMatchTab(p.page, "defis");
    const sel = '#mt-online-root [data-mtdefy="' + pseudo + '"]';
    if (!(await until(p.page, (s) => !!document.querySelector(s), sel, 9000))) {
      return "adversaire « " + pseudo + " » absent de la colonne Joueurs en ligne";
    }
    await mtClick(p.page, sel);
    const gameSel = "#play-root .pg-opt[data-game]";
    if (!(await until(p.page, (s) => !!document.querySelector(s), gameSel, 9000))) {
      return "l'assistant ne s'ouvre pas sur le choix du jeu";
    }
    await mtClick(p.page, gameSel);
    await sleep(500);
    const varSel = "#play-root .pg-opt[data-variant]";
    if (!(await until(p.page, (s) => !!document.querySelector(s), varSel, 9000))) {
      return "les plateaux ne s'ouvrent pas après le choix du jeu";
    }
    await mtClick(p.page, varSel);
    await sleep(650);
    const fmtSel = "#play-root .pg-fmt:not(.off)";
    if (!(await until(p.page, (s) => !!document.querySelector(s), fmtSel, 9000))) {
      return "aucun format proposé après le choix du plateau";
    }
    await mtClick(p.page, fmtSel);
    await sleep(650);
    if (!(await until(p.page, (s) => !!document.querySelector(s), "#play-root [data-wager]", 9000))) {
      return "l'assistant de mise en jeu ne s'ouvre pas sur le récapitulatif du défi";
    }
    return true;
  };

  /* Envoi d'un défi par le geste réel : l'adversaire est choisi dans la colonne
     « Joueurs en ligne », puis l'assistant de l'écran Jeux est mené jusqu'au
     récapitulatif (voir `mtOuvrirDefi`) où la mise et l'envoi se règlent. */
  const mtSendChallenge = async (p, pseudo) => {
    const ouvert = await mtOuvrirDefi(p, pseudo);
    if (ouvert !== true) return ouvert;
    const wagerSel = "#play-root [data-wager]";
    await mtClick(p.page, wagerSel);
    await sleep(500);
    if (!(await until(p.page, () => !!document.getElementById("pg-cta"), 9000))) {
      return "l'étape de lancement du défi ne s'ouvre pas";
    }
    await mtClick(p.page, "#pg-cta");
    await sleep(1400);
    const m = (await modalText(p.page)) || "";
    await dismissModals(p.page);
    return /défi envoyé/i.test(m) ? true : "aucune confirmation d'envoi : « " + m.slice(0, 60) + " »";
  };

  /* Lecture de la jauge de la carte de défi : pourcentage RENDU, pourcentage
     ATTENDU calculé sur les dates ISO du serveur, et libellé. */
  const mtGauge = (page) => page.evaluate(() => {
    const el = document.querySelector("#defi-recu-root .mt-gauge");
    if (!el) return null;
    const fill = el.querySelector(".mt-gauge__fill");
    const track = fill && fill.parentElement;
    const exp = Date.parse(el.dataset.exp || "");
    const ret = Date.parse(el.dataset.ret || "");
    if (!fill || !track || !exp || !ret) return null;
    const now = Date.now();
    return {
      pct: Math.round((parseFloat(getComputedStyle(fill).width) / parseFloat(getComputedStyle(track).width)) * 1000) / 10,
      attendu: Math.round(((exp - now) / (exp - ret)) * 1000) / 10,
      label: ((el.querySelector("[data-exp-label]") || {}).textContent || "").trim(),
      minutes: Math.round((exp - ret) / 60000),
    };
  });
  /* Solde de départ de la campagne : depuis la règle PRD, un compte neuf ne
     porte que le bonus de 1 000 Ar (verrouillé). Les scénarios de défi misent
     plusieurs fois 500 Ar : on réalimente les DEUX joueurs UNE fois, au début,
     pour que les refus mesurés plus loin soient ceux du scénario (plafond,
     solde volontairement insuffisant) et non un manque d'argent hérité. */
  for (const P of [A, B]) {
    await apiFromPage(P.page, "/api/deposit", "POST", { amount: 8000, operator: "MVola" });
    await P.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2400);
  }

  await step("l'écran Match est un héro avec trois tuiles de statistiques, aucun « À jouer »", async () => {
    await goScreen(A.page, "match");
    const info = await A.page.evaluate(() => {
      const hero = document.querySelector(".mt-hero");
      return {
        hero: !!hero,
        titre: hero ? ((hero.querySelector("h1") || {}).innerText || "").trim() : "",
        chip: hero ? ((hero.querySelector(".mt-chip") || {}).innerText || "").trim() : "",
        pulse: hero ? !!hero.querySelector(".mt-pulse") : false,
        tiles: document.querySelectorAll("#mt-tiles .mt-tile").length,
        ecran: (document.getElementById("screen-match") || {}).innerText || "",
        racine: !!document.getElementById("match-root"),
      };
    });
    const out = [];
    if (!info.hero) out.push("héro .mt-hero absent");
    if (!/^match$/i.test(info.titre)) out.push("titre du héro inattendu : « " + info.titre + " »");
    if (!/temps réel/i.test(info.chip)) out.push("pastille « TEMPS RÉEL » absente");
    if (!info.pulse) out.push("point animé de la pastille absent");
    if (!info.racine) out.push("racine #match-root absente");
    if (info.tiles !== 3) out.push(info.tiles + " tuile(s) au lieu de 3");
    if (/à jouer/i.test(info.ecran)) out.push("un onglet « À jouer » est encore présent");
    if (out.length) return out.join(" ; ");
    const tiles = await mtTiles(A.page);
    const manquants = ["En direct", "Défis", "Tournois"].filter((v) => !tiles.some((t) => t.label.startsWith(v)));
    if (manquants.length) return "tuile(s) manquante(s) : " + manquants.join(", ");
    const vides = tiles.filter((t) => !t.sub || !t.n).map((t) => t.label);
    return vides.length ? "tuile(s) sans compteur ou sans sous-libellé : " + vides.join(", ") : true;
  });

  await step("une seule tuile active, et le panneau annonce l'onglet affiché", async () => {
    const live = await mtTiles(A.page);
    const actives = live.filter((t) => t.on);
    if (actives.length !== 1) return actives.length + " tuile(s) active(s)";
    if (!actives[0].mtab) return "tuile active sans data-mtab";
    const ok = await goMatchTab(A.page, "tournois");
    const apres = await mtTiles(A.page);
    const on = apres.filter((t) => t.on);
    if (!ok || on.length !== 1 || on[0].mtab !== "tournois") return "l'onglet Tournois n'est pas celui qui est actif après le clic";
    const lab = await A.page.evaluate(() => (document.getElementById("match-root") || {}).getAttribute("aria-labelledby"));
    return lab === "mt-tab-tournois" ? true : "le panneau n'annonce pas son onglet (aria-labelledby = " + lab + ")";
  });

  await step("le héro porte un statut rapide et les deux actions principales", async () => {
    await goScreen(A.page, "match");
    const info = await A.page.evaluate(() => ({
      statut: (document.getElementById("mt-status") || {}).innerText || "",
      find: (document.getElementById("mt-find") || {}).innerText || "",
      invite: (document.getElementById("mt-invite") || {}).innerText || "",
    }));
    const out = [];
    if (!info.statut.trim()) out.push("pastille de statut vide");
    if (!/adversaire/i.test(info.find)) out.push("action « trouver un adversaire » absente");
    if (!/inviter/i.test(info.invite)) out.push("action « inviter un ami » absente");
    return out.length ? out.join(" ; ") : true;
  });

  await step("« Trouver un adversaire » ouvre la mise en file de l'écran Jeux", async () => {
    if (!(await mtClick(A.page, "#mt-find"))) return "action « trouver un adversaire » introuvable dans le héro";
    const ok = await until(A.page, () => /^play/.test((location.hash || "").replace("#/", "")) &&
      !!document.getElementById("pg-cta"), 8000);
    if (!ok) return "l'écran Jeux ne s'ouvre pas (route : " + (await routeOf(A.page)) + ")";
    const txt = (await textOf(A.page, "#play-root")) || "";
    await goScreen(A.page, "match");
    /* L'étape 4 est le récapitulatif de lancement : « 04 / 04 — prêt à jouer ». */
    return /04\s*\/\s*04/.test(txt) ? true : "l'assistant ne s'ouvre pas sur le lancement : « " + txt.slice(0, 60) + " »";
  });

  await step("« Inviter un ami » propose un lien à copier et la recherche de joueur", async () => {
    if (!(await mtClick(A.page, "#mt-invite"))) return "action « inviter un ami » introuvable dans le héro";
    await sleep(600);
    const m = (await modalText(A.page)) || "";
    if (!/inviter un ami/i.test(m)) return "aucune fenêtre d'invitation : « " + m.slice(0, 60) + " »";
    const has = await A.page.evaluate(() => ({
      copy: !!document.getElementById("invite-copy"),
      search: !!document.getElementById("invite-search"),
      lien: /https?:\/\//.test(document.getElementById("modal").innerText || ""),
    }));
    await dismissModals(A.page);
    if (!has.copy || !has.search) return "actions d'invitation incomplètes";
    return has.lien ? true : "le lien à partager n'est pas affiché";
  });
  await step("la tuile « En direct » annonce le nombre réel de parties affichées", async () => {
    await goMatchTab(A.page, "live");
    const ok = await until(A.page, () => {
      const r = document.getElementById("live-games-root");
      return !!r && !/Recherche des parties/.test(r.innerText);
    }, 9000);
    if (!ok) return "le fil des parties ne se charge pas";
    const info = await A.page.evaluate(() => {
      const r = document.getElementById("live-games-root");
      const v = document.querySelector('#mt-tiles .mt-tile[data-mtab="live"] .v');
      return {
        n: v ? v.innerText.trim() : "",
        rows: r.querySelectorAll(".mt-row").length,
        vide: !!r.querySelector(".mt-state"),
      };
    });
    if (info.n === "—") return "la tuile « En direct » reste sur un tiret après le chargement";
    if (!info.vide && info.rows > 0 && info.n !== String(info.rows)) return "tuile « " + info.n + " » mais " + info.rows + " partie(s) affichée(s)";
    if (info.vide && info.n !== "0") return "fil vide mais tuile « " + info.n + " »";
    return true;
  });

  await step("élargir la portée interroge le SERVEUR, la liste suit", async () => {
    const req = A.page.waitForRequest((r) => r.url().includes("/api/games/live") && r.url().includes("scope=all"), { timeout: 9000 })
      .catch(() => null);                      /* jamais de rejet non capté */
    if (!(await mtClick(A.page, '#match-root [data-lscope="all"]'))) return "bouton d'élargissement (.mt-more) absent de l'onglet En direct";
    if (!(await req)) return "aucune requête ?scope=all envoyée au serveur";
    const ok = await until(A.page, () => {
      const r = document.getElementById("live-games-root");
      return !!r && !/Recherche des parties/.test(r.innerText);
    }, 9000);
    if (!ok) return "le fil reste bloqué sur le chargement après changement de portée";
    const libelle = await A.page.evaluate(() => {
      const b = document.querySelector('#match-root [data-lscope="contacts"]');
      return b ? b.innerText.trim() : "";
    });
    if (!/contacts/i.test(libelle)) return "aucun moyen de revenir aux parties des contacts";
    await mtClick(A.page, '#match-root [data-lscope="contacts"]');
    await sleep(800);
    return true;
  });

  await step("une partie en direct montre les pions restants, ou un état vide actionnable", async () => {
    const info = await A.page.evaluate(() => {
      const r = document.getElementById("live-games-root");
      if (!r) return { err: "fil absent de l'onglet En direct" };
      const lignes = [...r.querySelectorAll(".mt-row")];
      return {
        rows: lignes.length,
        watch: r.querySelectorAll('button[onclick*="spectate"]').length,
        scores: lignes.filter((l) => {
          const s = l.querySelector(".mt-score");
          return s && /^\d+\s*–\s*\d+$/.test(s.innerText.trim());
        }).length,
        live: lignes.filter((l) => (l.querySelector(".mt-badge") || {}).innerText && /live/i.test(l.querySelector(".mt-badge").innerText)).length,
        empty: !!r.querySelector(".mt-state"),
        actions: r.querySelectorAll(".mt-state button").length,
      };
    });
    if (info.err) return info.err;
    if (info.rows > 0) {
      if (info.watch !== info.rows) return info.rows + " ligne(s) mais " + info.watch + " bouton(s) « Regarder »";
      if (info.live !== info.rows) return "certaines lignes n'ont pas l'étiquette LIVE";
      if (info.scores !== info.rows) return "certaines lignes n'affichent pas les pions restants (score)";
      return true;
    }
    return info.empty && info.actions > 0 ? true : "ni partie à regarder ni état vide avec action (lignes " + info.rows + ")";
  });

  await step("la colonne des contacts donne l'état de présence, action désactivée si indisponible", async () => {
    const info = await A.page.evaluate(() => {
      const root = document.getElementById("mt-contacts-root");
      if (!root) return { err: "colonne des contacts absente de l'onglet En direct" };
      const lignes = [...root.querySelectorAll(".mt-contact")];
      return {
        root: true,
        n: lignes.length,
        dots: lignes.filter((l) => !!l.querySelector(".mt-sdot")).length,
        etats: lignes.map((l) => {
          const st = l.querySelector(".st");
          const b = l.querySelector("button");
          return { txt: st ? st.innerText.trim() : "", off: b ? !!b.disabled : null, act: b ? b.innerText.trim() : "" };
        }),
        empty: !!root.querySelector(".mt-state"),
        actions: root.querySelectorAll(".mt-state button").length,
        titre: (document.getElementById("mt-contacts-n") || {}).innerText || "",
      };
    });
    if (info.err) return info.err;
    if (!info.n) return info.empty && info.actions > 0 ? true : "ni contact ni état vide actionnable";
    if (info.dots !== info.n) return "certaines lignes n'ont pas de pastille d'état";
    const incoherent = info.etats.filter((e) => /en partie|hors ligne/i.test(e.txt) && e.off !== true);
    if (incoherent.length) return "contact indisponible avec une action active : « " + incoherent[0].txt + " » / « " + incoherent[0].act + " »";
    const enLigne = info.etats.filter((e) => /en ligne/i.test(e.txt) && !/en partie/i.test(e.txt));
    const active = enLigne.filter((e) => e.off === false);
    if (enLigne.length && active.length !== enLigne.length) return "contact en ligne mais bouton inactif : « " + enLigne[0].act + " »";
    return true;
  });
  await step("les onglets se déploient en deux colonnes (liste à gauche, contexte à droite)", async () => {
    const out = [];
    if ((await mtCols(A.page, "#match-root .mt-split")) !== 2) out.push("onglet En direct : " + (await mtCols(A.page, "#match-root .mt-split")) + " colonne(s)");
    await goMatchTab(A.page, "defis");
    if ((await mtCols(A.page, "#match-root .mt-split")) !== 2) out.push("onglet Défis : pas deux colonnes");
    await goMatchTab(A.page, "tournois");
    if ((await mtCols(A.page, "#match-root .mt-split")) !== 2) out.push("onglet Tournois : pas deux colonnes");
    return out.length ? out.join(" ; ") : true;
  });

  await step("l'onglet Défis sépare les défis reçus, les envoyés et les joueurs en ligne", async () => {
    await goMatchTab(A.page, "defis");
    const txt = (await textOf(A.page, "#match-root")) || "";
    const out = [];
    if (!/défis reçus/i.test(txt)) out.push("section « Défis reçus » absente");
    if (!/défis envoyés/i.test(txt)) out.push("section « Défis envoyés » absente");
    if (!/joueurs en ligne/i.test(txt)) out.push("colonne « Joueurs en ligne » absente");
    if (!/(aucun défi|accepter)/i.test(txt)) out.push("ni défi reçu ni état vide explicite");
    /* Les défis ENVOYÉS viennent d'un appel REST : le bloc doit sortir de l'état
       « chargement », sinon l'onglet reste à moitié vide. */
    const charged = await until(A.page, () => {
      const s = document.getElementById("defis-sent");
      return !!s && !/chargement/i.test(s.innerText);
    }, 10000);
    if (!charged) out.push("les défis envoyés ne se chargent pas");
    return out.length ? out.join(" ; ") : true;
  });

  await step("un défi reçu affiche une jauge calée sur les dates du serveur", async () => {
    if (!(await mtVerify(A))) return "impossible de vérifier le KYC du destinataire";
    if (!(await mtVerify(B))) return "impossible de vérifier le KYC de l'expéditeur";
    await goMatchTab(A.page, "defis");
    const envoi = await mtSendChallenge(B, A.pseudo);
    if (envoi !== true) return envoi;
    /* Le défi arrive par WebSocket : la carte doit apparaître sans rechargement. */
    const vu = await until(A.page, () => !!document.querySelector("#defi-recu-root .mt-defi"), 9000);
    if (!vu) return "la carte du défi reçu n'apparaît pas côté destinataire";
    const card = await A.page.evaluate(() => {
      const c = document.querySelector("#defi-recu-root .mt-defi");
      return {
        qui: (c.querySelector(".n") || {}).innerText || "",
        chips: [...c.querySelectorAll(".mt-defi__spec .pill")].map((p) => p.innerText.trim()),
        actions: [...c.querySelectorAll(".mt-defi__acts button")].map((b) => b.innerText.trim()),
        jauge: !!c.querySelector(".mt-gauge"),
      };
    });
    const out = [];
    if (!card.qui.includes(B.pseudo)) out.push("la carte n'identifie pas l'expéditeur (« " + card.qui.trim() + " »)");
    if (!card.chips.some((c) => /mise/i.test(c) && /500/.test(c))) out.push("mise réelle absente des informations du défi");
    if (!card.actions.some((a) => /accepter/i.test(a)) || !card.actions.some((a) => /refuser/i.test(a))) out.push("actions Accepter / Refuser incomplètes");
    if (!card.jauge) out.push("aucune jauge de temps de réponse");
    if (out.length) return out.join(" ; ");
    const g = await mtGauge(A.page);
    if (!g) return "jauge illisible (dates d'expiration absentes du DOM)";
    if (g.minutes !== 15) return "fenêtre de réponse inattendue : " + g.minutes + " min au lieu de 15";
    if (!/^reste \d+ \/ 15 min$/.test(g.label)) return "libellé de jauge inattendu : « " + g.label + " »";
    if (Math.abs(g.pct - g.attendu) > 2) return "jauge " + g.pct + " % alors que les dates du serveur donnent " + g.attendu + " %";
    return g.pct < 100 && g.pct > 0 ? true : "jauge à " + g.pct + " % (ni entamée ni pleine)";
  });

  /* ---- Mise personnalisée (retour terrain n° 7) : le bouton ouvre un champ en
     Ariary, la validation nomme ce qui ne va pas, et le montant retenu vaut pour
     les DEUX joueurs — pot recalculé, et le défi part réellement avec ce montant. */
  await step("« Montant personnalisé » : chaque saisie invalide est refusée avec un message clair", async () => {
    const ouvert = await mtOuvrirDefi(A, B.pseudo);
    if (ouvert !== true) return ouvert;
    if (!(await until(A.page, () => !!document.querySelector("#play-root [data-wager-perso]"), 9000)))
      return "le bouton « Montant personnalisé » n'est pas proposé dans « Mise du défi »";
    await mtClick(A.page, "#play-root [data-wager-perso]");
    if (!(await until(A.page, () => !!document.getElementById("wager-perso"), 6000)))
      return "le clic n'ouvre pas le champ de saisie";
    const solde = Number((((await apiFromPage(A.page, "/api/user", "GET")).json || {}).user || {}).balance || 0);
    const essais = [
      ["abc", /chiffres seulement/i, "une saisie non numérique est acceptée"],
      ["0", /minimale/i, "un montant nul est accepté"],
      ["200", /minimale/i, "un montant sous le minimum est accepté"],
      ["9999999", /maximale/i, "un montant au-dessus du maximum est accepté"],
      [String(solde + 1000), /solde insuffisant/i, "un montant au-dessus du solde est accepté"],
    ];
    for (const [valeur, attendu, reproche] of essais) {
      await A.page.fill("#wager-perso", valeur);
      await A.page.click("#wager-perso-ok");
      await sleep(500);
      const msg = await A.page.evaluate(() => {
        const e = document.getElementById("wager-perso-err");
        return e ? e.innerText.trim() : "";
      });
      if (!attendu.test(msg)) return `${reproche} (saisie « ${valeur} » → « ${msg} »)`;
      /* L'assistant ne doit PAS avancer tant que la mise n'est pas valide. */
      if (!(await A.page.evaluate(() => !!document.getElementById("wager-perso"))))
        return `l'assistant avance avec une mise invalide (« ${valeur} »)`;
    }
    /* « Annuler » ramène aux montants prédéfinis. */
    await A.page.click("#wager-perso-non");
    await sleep(500);
    const retour = await A.page.evaluate(() => {
      const on = document.querySelector("#play-root .pg-chip.on");
      return { champ: !!document.getElementById("wager-perso"), chip: on ? on.innerText.trim() : "" };
    });
    if (retour.champ) return "« Annuler » laisse le champ personnalisé ouvert";
    await goMatchTab(A.page, "defis");   // on rend l'écran à l'étape suivante
    return /500|1 000|2 000/.test(retour.chip) ? true
      : "« Annuler » ne revient pas sur une mise proposée (« " + retour.chip + " »)";
  });

  await step("le montant personnalisé s'applique aux DEUX joueurs et le pot est recalculé", async () => {
    const MONTANT = 1500;
    /* Les deux joueurs ont été réalimentés au début du scénario (règle PRD :
       un compte neuf n'a que 1 000 Ar de bonus verrouillé). */
    /* On rouvre l'assistant depuis la colonne des joueurs en ligne : l'étape
       précédente a pu laisser l'écran ailleurs (elle se termine sur l'onglet
       Défis), et un clic dans une vue masquée ne mesurerait rien. */
    const ouvert = await mtOuvrirDefi(A, B.pseudo);
    if (ouvert !== true) return ouvert;
    if (!(await until(A.page, () => !!document.querySelector("#play-root [data-wager-perso]"), 9000)))
      return "l'assistant ne s'ouvre pas sur la mise du défi";
    await A.page.click("#play-root [data-wager-perso]");
    await sleep(400);
    await A.page.fill("#wager-perso", String(MONTANT));
    await A.page.click("#wager-perso-ok");
    /* Dans le parcours direct, la mise se règle SUR LE RÉCAPITULATIF (l'étape
       Mode est retirée) : valider le montant y ramène, le format étant déjà
       choisi. */
    if (!(await until(A.page, () => !!document.querySelector("#play-root .pg-recap"), 8000)))
      return "le récapitulatif du défi ne s'affiche pas après la mise personnalisée";
    if (!(await until(A.page, () => !!document.getElementById("pg-cta"), 8000)))
      return "l'étape de lancement ne s'ouvre pas";
    const recap = await A.page.evaluate(() => (document.querySelector(".pg-recap") || {}).innerText || "");
    /* Les montants sont écrits avec une ESPACE FINE insécable (mise en forme
       française des chiffres) : on compare sans aucun blanc, des deux côtés. */
    const sansBlancs = (s) => String(s).replace(/[\s\u00a0\u202f]/g, "");
    if (!sansBlancs(recap).includes(String(MONTANT)))
      return "le récapitulatif n'affiche pas la mise personnalisée : « " + recap.replace(/\n/g, " · ") + " »";
    if (!sansBlancs(recap).includes(String(MONTANT * 2)))
      return "le pot total n'est pas recalculé (attendu " + MONTANT * 2 + " Ar)";
    await mtClick(A.page, "#pg-cta");
    await sleep(1500);
    const m = (await modalText(A.page)) || "";
    await dismissModals(A.page);
    if (!/défi envoyé/i.test(m)) return "le défi personnalisé n'est pas confirmé : « " + m.slice(0, 60) + " »";
    /* Chez le destinataire (B) : la carte du défi porte le MÊME montant — c'est la
       règle affichée (« chaque joueur dépose le même montant »). */
    await goMatchTab(B.page, "defis");
    const vu = await until(B.page, (n) => {
      const root = document.getElementById("defi-recu-root");
      if (!root) return false;
      return root.innerText.replace(/[\s\u00a0\u202f]/g, "").includes(n);
    }, String(MONTANT), 12000);
    /* On REFUSE ce défi de test : il a rempli son rôle (montant vérifié chez les
       deux joueurs) et le laisser en attente ferait échouer l'étape suivante, qui
       compte les cartes reçues. Le refus rembourse l'envoyeur — c'est le chemin
       normal, celui d'un vrai joueur qui ne veut pas de ce défi. Le clic vise la
       carte qui porte le montant, pas « la première » : avec deux cartes en
       attente, « la première » ne serait pas forcément la bonne. */
    const refus = await B.page.evaluate((n) => {
      const carte = [...document.querySelectorAll("#defi-recu-root .mt-defi")]
        .find((c) => c.innerText.replace(/[\s\u00a0\u202f]/g, "").includes(n));
      const b = carte && carte.querySelector(".mt-defi__acts button.danger");
      if (!b) return false;
      b.click();
      return true;
    }, String(MONTANT));
    await sleep(1200);
    await goMatchTab(A.page, "defis");     // on rend l'écran à l'étape suivante
    if (!vu) {
      const txt = await textOf(B.page, "#defi-recu-root");
      return "la carte du défi reçu n'annonce pas la mise personnalisée (" + MONTANT + " Ar) : « " + (txt || "").slice(0, 120) + " »";
    }
    return refus ? true : "le défi personnalisé ne peut pas être refusé par le destinataire";
  });

  await step("la jauge se vide avec le temps réel, et le refus libère la carte", async () => {
    const g1 = await mtGauge(A.page);
    if (!g1) return "jauge absente avant la mesure";
    await sleep(3000);
    const g2 = await mtGauge(A.page);
    if (!g2) return "jauge disparue pendant la mesure";
    if (g2.pct > g1.pct) return "la jauge remonte : " + g1.pct + " % -> " + g2.pct + " %";
    if (Math.abs(g2.pct - g2.attendu) > 2) return "après 3 s, jauge " + g2.pct + " % pour " + g2.attendu + " % attendus";
    /* Le remboursement se vérifie D'ABORD en base (le serveur fait foi), puis à
       l'écran : un solde juste mais non affiché resterait un défaut pour le
       joueur. */
    const bSolde = (await apiFromPage(B.page, "/api/user", "GET")).json.user.balance;
    if (!(await mtClick(A.page, "#defi-recu-root .mt-defi__acts button.danger"))) return "bouton « Refuser » introuvable";
    const parti = await until(A.page, () => !document.querySelector("#defi-recu-root .mt-defi"), 9000);
    if (!parti) return "la carte du défi reste affichée après le refus";
    const etat = await A.page.evaluate(() => !!document.querySelector("#defi-recu-root .mt-state"));
    if (!etat) return "aucun état vide après le refus";
    const rembourse = await until(B.page, async (attendu) => {
      const token = localStorage.getItem("daona_token");
      const r = await fetch("/api/user", { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      return !!d.user && d.user.balance === attendu;
    }, bSolde + 500, 9000);
    if (!rembourse) return "la mise du défi refusé n'est pas revenue (solde serveur " + bSolde + ")";
    const affiche = await until(B.page, (a) => window.App.state().balance === a, bSolde + 500, 6000);
    return affiche ? true : "le solde affiché ne suit pas le remboursement";
  });
  await step("l'onglet Tournois filtre par statut et n'affiche que ce statut", async () => {
    await goMatchTab(A.page, "tournois");
    const out = [];
    for (const [f, attendu] of [["ouvert", "Ouvert"], ["encours", "En cours"], ["termine", "Terminé"]]) {
      if (!(await mtClick(A.page, '#match-root [data-tfilter="' + f + '"]'))) {
        out.push("filtre de statut « " + attendu + " » absent");
        continue;
      }
      await sleep(550);
      const bad = await A.page.evaluate((lab) => {
        const r = document.getElementById("match-root");
        const on = r.querySelector(".mt-seg.on");
        const res = [];
        if (!on || !(on.innerText || "").trim().startsWith(lab)) res.push("filtre actif inattendu : " + (on ? on.innerText.trim() : "aucun"));
        r.querySelectorAll(".tn-card").forEach((c) => {
          const pill = ((c.querySelector(".tn-head .pill") || {}).innerText || "").trim();
          if (pill !== lab) res.push("carte « " + pill + " » dans le filtre " + lab);
        });
        return res;
      }, attendu);
      if (bad.length) out.push(bad.slice(0, 2).join(", "));
    }
    await mtClick(A.page, '#match-root [data-tfilter="ouvert"]');
    await sleep(450);
    return out.length ? out.join(" ; ") : true;
  });

  await step("les tournois annoncent les prochains départs avec un vrai décompte", async () => {
    const info = await A.page.evaluate(() => {
      const root = document.getElementById("match-root");
      const bloc = [...root.querySelectorAll(".panel")]
        .find((p) => /prochains départs/i.test((p.querySelector(".panel-title") || {}).innerText || ""));
      if (!bloc) return { err: "bloc « Prochains départs » absent" };
      return {
        n: bloc.querySelectorAll(".mt-contact").length,
        cd: [...bloc.querySelectorAll(".countdown")].map((c) => c.innerText.trim()),
        vide: /aucun départ/i.test(bloc.innerText),
      };
    });
    if (info.err) return info.err;
    if (!info.n) return info.vide ? true : "aucun départ annoncé et aucun message d'état vide";
    const mauvais = info.cd.filter((t) => !/maintenant|\d/.test(t));
    return mauvais.length ? "décompte illisible : « " + mauvais[0] + " »" : true;
  });

  await step("les règles du format sont rappelées et détaillables", async () => {
    const txt = (await textOf(A.page, ".mt-rules")) || "";
    const out = [];
    if (!/rembours/i.test(txt)) out.push("mise remboursée non annoncée");
    if (!/50/.test(txt) || !/25/.test(txt)) out.push("répartition des gains absente");
    if (out.length) return out.join(" ; ");
    if (!(await mtClick(A.page, "#mt-prize"))) return "bouton du barème absent du bloc de règles";
    await sleep(600);
    const m = (await modalText(A.page)) || "";
    await dismissModals(A.page);
    return /50%/.test(m) && /25%/.test(m) ? true : "barème incomplet : « " + m.slice(0, 70) + " »";
  });
  await step("un défi envoyé se suit, s'annule, et la mise revient immédiatement", async () => {
    const avant = (await apiFromPage(A.page, "/api/user", "GET")).json.user.balance;
    const envoi = await mtSendChallenge(A, B.pseudo);
    if (envoi !== true) return envoi;
    await goMatchTab(A.page, "defis");
    if (!(await until(A.page, () => !!document.querySelector("#defis-sent [data-mtcancel]"), 10000)))
      return "le défi envoyé n'apparaît pas en attente avec son bouton d'annulation";
    const ligne = await A.page.evaluate(() => {
      const b = document.querySelector("#defis-sent [data-mtcancel]");
      const r = b.closest(".defi-row");
      return { txt: r ? r.innerText : "", id: b.dataset.mtcancel };
    });
    if (!ligne.txt.includes(B.pseudo)) return "la ligne annulable ne vise pas le bon joueur";
    const debite = (await apiFromPage(A.page, "/api/user", "GET")).json.user.balance;
    if (debite !== avant - 500) return "mise non débitée à l'envoi (" + avant + " -> " + debite + ")";
    if (!(await until(A.page, (a) => window.App.state().balance === a, debite, 7000)))
      return "le solde affiché ne suit pas la mise engagée (poussée wallet_update manquante)";
    /* Le destinataire voit la carte tant que le défi est en attente… */
    await goMatchTab(B.page, "defis");
    if (!(await until(B.page, () => !!document.querySelector("#defi-recu-root .mt-defi"), 9000)))
      return "le destinataire ne voit pas le défi en attente";
    /* … puis elle disparaît par un simple message du serveur (aucun rechargement). */
    if (!(await mtClick(A.page, "#defis-sent [data-mtcancel]"))) return "clic sur « Annuler » sans effet";
    if (!(await until(A.page, (a) => window.App.state().balance === a, avant, 9000)))
      return "la mise annulée n'est pas rendue à l'écran (" + (await stateOf(A.page)).balance + " au lieu de " + avant + ")";
    const rendu = (await apiFromPage(A.page, "/api/user", "GET")).json.user.balance;
    if (rendu !== avant) return "remboursement non persisté (" + rendu + " au lieu de " + avant + ")";
    if (!(await until(A.page, () => /annulé/i.test((document.getElementById("defis-sent") || {}).innerText || ""), 9000)))
      return "la ligne reste en attente après annulation";
    if (!(await until(B.page, () => !document.querySelector("#defi-recu-root .mt-defi"), 9000)))
      return "le défi annulé reste affiché chez le destinataire";
    const reste = await apiFromPage(B.page, "/api/challenges", "GET");
    const encore = ((reste.json || {}).received || []).some((c) => c.id === ligne.id);
    return encore ? "le défi annulé est toujours en attente côté serveur" : true;
  });

  await step("mobile 360 px : tuiles tapables, colonnes empilées, aucun débordement", async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, is_mobile: true, has_touch: true });
    const page = await ctx.newPage();
    try {
      const token = await A.page.evaluate(() => localStorage.getItem("daona_token"));
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await page.evaluate((t) => localStorage.setItem("daona_token", t), token);
      await page.reload({ waitUntil: "domcontentloaded" });
      await sleep(2600);
      await goMatchTab(page, "live");
      const info = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll("#mt-tiles .mt-tile")];
        const w = (id) => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().width) : 0; };
        const split = document.querySelector("#match-root .mt-split");
        const tpl = split ? getComputedStyle(split).gridTemplateColumns : "";
        return {
          n: tiles.length,
          hauteurs: tiles.map((t) => Math.round(t.getBoundingClientRect().height)),
          cols: tpl && tpl !== "none" ? tpl.split(" ").filter(Boolean).length : 0,
          debord: document.documentElement.scrollWidth - window.innerWidth,
          find: w("mt-find"),
          invite: w("mt-invite"),
        };
      });
      if (info.n !== 3) return "tuiles perdues en mobile : " + info.n;
      if (info.hauteurs.some((h) => h < 40)) return "cibles tactiles trop basses : " + info.hauteurs.join(" px, ") + " px";
      if (info.cols !== 1) return "les deux colonnes ne se replient pas en mobile (" + info.cols + " colonne(s))";
      if (info.debord > 1) return "débordement horizontal de " + info.debord + " px";
      if (info.find < 100 || info.invite < 100) return "actions trop étroites au doigt (" + info.find + " / " + info.invite + " px)";
      return true;
    } finally { await ctx.close(); }
  });
}