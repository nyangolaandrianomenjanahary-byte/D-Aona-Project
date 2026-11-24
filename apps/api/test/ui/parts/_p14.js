/* =========================================================================
   S13 — DONNÉES : classement vivant, badge Amis, photo de profil, noms
   cliquables et Elo gagné/perdu
   =========================================================================
   Ces cinq points partagent une même cause : une donnée qui existait côté
   serveur mais n'arrivait pas — ou arrivait mal — jusqu'à l'écran. Le scénario
   confronte donc ce que l'interface AFFICHE à ce que l'API RÉPOND, sur des
   données réelles (aucune valeur décorative n'est tolérée), et vérifie que la
   page reste juste APRÈS un rechargement (le local ne peut pas faire foi).
   ========================================================================= */
async function s13_datafix(browser) {
  const A = await ensure(browser, "A");
  const B = await ensure(browser, "B");
  const E = await ensure(browser, "E");          // joueur neuf : aucune relation avec A
  const dataOf = (page) => page.evaluate(() => {
    const el = document.getElementById("btn-friends");
    return {
      badge: el ? el.getAttribute("data-count") : null,
      title: el ? el.title : "",
      tbAv: (() => { const i = document.querySelector("#tb-avatar img"); return i ? i.getAttribute("src") : null; })(),
      dashAv: (() => { const i = document.querySelector(".dash-avatar img"); return i ? i.getAttribute("src") : null; })(),
    };
  });

  /* ---- 0. Mise en état : la page doit être SAINE et le canal temps réel
     authentifié AVANT toute mesure. Un scénario précédent peut avoir rechargé la
     page (vérification KYC) : ce qu'on mesure ici, c'est l'apparition d'un joueur
     après sa création, pas la vitesse de reconnexion d'une page. */
  await step("après un rechargement, le canal temps réel se réauthentifie tout seul", async () => {
    await A.page.reload({ waitUntil: "domcontentloaded" });
    if (!(await until(A.page, () => window.API.isConnected(), 15000)))
      return "la socket n'est pas ouverte après un rechargement de page";
    const rep = await A.page.evaluate(async () => {
      const seen = [];
      const fn = (m) => seen.push(m.message || m.type);
      window.API.on("error", fn);
      window.API.send({ type: "spectate", sessionId: "sonde-inexistante" });
      await new Promise((r) => setTimeout(r, 900));
      window.API.off("error", fn);
      return seen;
    });
    /* Le serveur ne répond « Match introuvable » qu'à une socket dont le message
       `auth` a abouti : c'est la preuve d'authentification (un « Non authentifié »
       signalerait une page connectée mais muette). */
    return rep.some((m) => /Match introuvable/i.test(m)) ? true
      : `la socket n'est pas authentifiée après rechargement (réponses : ${JSON.stringify(rep)})`;
  });

  /* ---- 1. Le classement accueille un joueur créé APRÈS ma connexion ---- */
  let newPseudo = null, newId = null;
  await step("un joueur créé après ma connexion apparaît au classement, sans rechargement", async () => {
    await goScreen(A.page, "ranks");
    await sleep(900);
    /* Le classement se remet dans son état NEUTRE avant la mesure : une recherche
       ou un filtre de province laissé par un scénario précédent masquerait la
       ligne sans que le produit soit en cause. */
    await A.page.evaluate(() => {
      const s = document.getElementById("rank-search");
      if (s && s.value) { s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); }
      const nat = document.querySelector('#ranks-root .chip[data-scope="national"]');
      if (nat && !nat.classList.contains("on")) nat.click();
    });
    await sleep(700);
    /* Instrumentation de diagnostic : compte les poussées reçues par CETTE page.
       Sans cela, on ne peut pas distinguer « le serveur n'a rien diffusé » de
       « la page n'a pas suivi la diffusion ». */
    await A.page.evaluate(() => {
      window.__lbPushes = 0;
      window.API.on("leaderboard_update", () => { window.__lbPushes++; });
    });
    newPseudo = "ZzUiNew" + Math.floor(Math.random() * 900 + 100);
    const reg = await apiFromPage(A.page, "/api/auth/register", "POST",
      { pseudo: newPseudo, password: PWD, province: "Antananarivo" });
    if (reg.status !== 200) return `inscription du joueur de contrôle refusée (${reg.status}) : ${JSON.stringify(reg.json)}`;
    newId = reg.json.user.id;
    /* Aucun rechargement : c'est la poussée serveur (leaderboard_update) qui doit
       provoquer l'apparition. On cherche le joueur dans le classement affiché. */
    const seen = await until(A.page, (p) => {
      const rows = [...document.querySelectorAll("#ranks-root .rank-row .who-pseudo")];
      return rows.some((r) => r.innerText.trim() === p);
    }, newPseudo, 12000);
    if (seen) return true;
    /* Diagnostic : on rapporte l'état RÉEL plutôt qu'une supposition — la poussée
       est-elle arrivée, la liste l'a-t-elle reçue, un filtre la masque-t-il ? */
    const diag = await A.page.evaluate((p) => {
      const s = window.App.state();
      return {
        route: (location.hash || "").replace("#/", ""),
        liste: (s.leaderboard || []).length,
        dansListe: !!(s.leaderboard || []).some((x) => x.pseudo === p),
        lignes: document.querySelectorAll("#ranks-root .rank-row").length,
        recherche: (document.getElementById("rank-search") || {}).value || "",
        portee: ((document.querySelector("#ranks-root .chip.on") || {}).textContent || "").trim(),
        poussees: window.__lbPushes,
        socket: window.API.isConnected(),
      };
    }, newPseudo);
    const srv = (await apiFromPage(A.page, "/api/leaderboard", "GET")).json.leaderboard || [];
    /* Test d'authentification de la socket : le serveur ne répond « Non
       authentifié » qu'à une socket dont le message `auth` n'a pas abouti. */
    const sock = await A.page.evaluate(async () => {
      const seen = [];
      const fn = (m) => seen.push(m.message || m.type);
      window.API.on("error", fn);
      window.API.send({ type: "spectate", sessionId: "sonde-inexistante" });
      await new Promise((r) => setTimeout(r, 900));
      window.API.off("error", fn);
      return seen;
    });
    return `« ${newPseudo} » n'apparaît pas au classement sans recharger la page — client ${JSON.stringify(diag)} · ` +
      `serveur ${srv.length} joueur(s), présent côté serveur : ${srv.some((x) => x.pseudo === newPseudo)} · ` +
      `réponses socket : ${JSON.stringify(sock)}`;
  });

  await step("sa ligne porte le pseudo, l'Elo et le rang réels, et reste sans photo inventée", async () => {
    const html = await A.page.evaluate((p) => {
      const row = [...document.querySelectorAll("#ranks-root .rank-row")]
        .find((r) => ((r.querySelector(".who-pseudo") || {}).innerText || "").trim() === p);
      if (!row) return null;
      return {
        elo: (row.querySelector(".elo") || {}).innerText || "",
        rank: (row.querySelector(".rk-num") || {}).innerText || "",
        photo: !!row.querySelector(".who-line img"),
        link: !!row.querySelector(".who-pseudo[onclick]"),
        onclick: (row.querySelector(".who-pseudo") || {}).getAttribute("onclick") || "",
      };
    }, newPseudo);
    if (!html) return `ligne introuvable pour ${newPseudo}`;
    const src = (await apiFromPage(A.page, "/api/leaderboard", "GET")).json.leaderboard.find((p) => p.id === newId);
    if (!src) return "le joueur est absent de la réponse /api/leaderboard";
    /* La cellule Elo porte la VALEUR puis son unité empilée (« 1100 » / « Elo »)
       depuis la maquette « proposition 2 » : on compare donc les NOMBRES, et le
       rang se lit sur deux chiffres (« 03 ») — c'est le format affiché. */
    if (parseInt(html.elo.replace(/\s|\u202F/g, ""), 10) !== src.elo)
      return `Elo affiché « ${html.elo} » contre ${src.elo} côté API`;
    if (html.rank.trim() !== String(src.rank).padStart(2, "0"))
      return `rang affiché « ${html.rank} » contre ${src.rank} côté API`;
    if (html.photo) return "une photo est affichée alors qu'aucune n'a été déposée";
    if (!html.link) return "le pseudo du classement n'ouvre pas de profil";
    if (!html.onclick.includes("openProfileById(" + newId + ")"))
      return `le lien n'utilise pas l'identifiant du joueur : « ${html.onclick} »`;
    return true;
  });

  await step("le lien du classement ouvre le profil du joueur visé (par identifiant)", async () => {
    await A.page.evaluate((p) => {
      const row = [...document.querySelectorAll("#ranks-root .rank-row")]
        .find((r) => ((r.querySelector(".who-pseudo") || {}).innerText || "").trim() === p);
      (row.querySelector(".who-pseudo") || {}).click();
    }, newPseudo);
    await sleep(1600);
    const hash = await A.page.evaluate(() => location.hash);
    if (!hash.includes("profile?id=" + newId)) return `route inattendue : « ${hash} »`;
    const shown = await until(A.page, (p) => {
      const r = document.getElementById("profile-root");
      return !!r && r.innerText.includes(p);
    }, newPseudo, 9000);
    return shown ? true : "le profil ouvert n'affiche pas le joueur visé";
  });
  /* ---- 2. Badge de l'icône Amis : allumé, éteint, et PERSISTANT ---- */
  await step("une demande d'ami allume le badge du destinataire (poussée serveur)", async () => {
    await goScreen(E.page, "home");
    const before = await dataOf(E.page);
    if (before.badge) return `le badge est déjà allumé avant toute demande (« ${before.badge} »)`;
    const r = await apiFromPage(A.page, "/api/friends/request", "POST", { pseudo: E.pseudo });
    if (r.status !== 200) return `demande d'ami refusée (${r.status}) : ${JSON.stringify(r.json)}`;
    const lit = await until(E.page, () => {
      const el = document.getElementById("btn-friends");
      return !!el && Number(el.getAttribute("data-count") || 0) >= 1;
    }, 12000);
    if (!lit) return "le badge ne s'allume pas chez le destinataire";
    const after = await dataOf(E.page);
    return /demande/i.test(after.title) ? true : `l'infobulle n'explique pas le badge (« ${after.title} »)`;
  });

  await step("ouvrir le PANNEAU Amis éteint le badge, et la demande reste listée", async () => {
    await E.page.click("#btn-friends");
    await sleep(1500);
    const seen = await until(E.page, () => {
      const el = document.getElementById("btn-friends");
      return !!el && !el.getAttribute("data-count");
    }, 9000);
    if (!seen) return "le badge reste allumé après ouverture du panneau Amis";
    /* Retour terrain n° 1 : les demandes se traitent DANS le panneau (boutons
       Accepter / Refuser), sans quitter la page — l'écran Amis reste accessible
       par « Voir tout ». */
    const dansPanneau = await until(E.page, () => {
      const p = document.getElementById("friends-panel");
      return !!p && !p.hidden && !!p.querySelector("[data-pp-decline]");
    }, 9000);
    if (dansPanneau) return true;
    /* Repli : on accepte aussi la vérification par l'écran complet, si la mesure
       a lieu après une navigation vers « Voir tout ». */
    return (await until(E.page, () => {
      const p = document.getElementById("freq-panel");
      return !!p && !!p.querySelector("[data-decline]");
    }, 3000)) ? true : "la demande reçue n'est plus visible (ni dans le panneau, ni dans l'écran Amis)";
  });

  await step("APRÈS RECHARGEMENT le badge reste éteint (le repère est côté serveur)", async () => {
    await E.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(3000);
    const d = await dataOf(E.page);
    if (d.badge) return `le badge s'est rallumé après rechargement (« ${d.badge} »)`;
    const f = await apiFromPage(E.page, "/api/friends", "GET");
    if (f.json.newIncoming !== 0) return `l'API annonce ${f.json.newIncoming} demande(s) nouvelle(s) alors qu'elles ont été vues`;
    return (f.json.incoming || []).length === 1 ? true : "la demande en attente a disparu côté serveur";
  });

  await step("une relance après refus rallume le badge (nouvel identifiant)", async () => {
    await goScreen(E.page, "friends");
    await sleep(900);
    await E.page.locator("#freq-panel [data-decline]").first().click();
    await sleep(1400);
    /* On QUITTE l'écran Amis avant la relance : une demande qui arrive pendant
       qu'on regarde la liste est vue, donc elle n'a pas à allumer quoi que ce
       soit. Le badge se juge depuis un autre écran — là où il sert. */
    await goScreen(E.page, "home");
    await sleep(800);
    const r = await apiFromPage(A.page, "/api/friends/request", "POST", { pseudo: E.pseudo });
    if (r.status !== 200) return `relance refusée (${r.status}) : ${JSON.stringify(r.json)}`;
    const lit = await until(E.page, () => {
      const el = document.getElementById("btn-friends");
      return !!el && Number(el.getAttribute("data-count") || 0) >= 1;
    }, 12000);
    return lit ? true : "la relance n'allume pas le badge (demande comptée comme déjà vue)";
  });
  /* ---- 3. Photo de profil : une seule source, partout ---- */
  const Aid = (await apiFromPage(A.page, "/api/user", "GET")).json.user.id;
  await step("déposer une photo l'affiche AUSSITÔT dans la carte profil et le header", async () => {
    await goScreen(A.page, "profile");
    await sleep(900);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
    await A.page.setInputFiles("#avatar-input", { name: "photo.png", mimeType: "image/png", buffer: png });
    /* La photo passe par le RECADREUR (zone déplaçable + zoom, aperçu rond) :
       le test le traverse comme le joueur, en validant le cadrage. */
    if (!(await until(A.page, () => !!document.getElementById("av-crop-ok"), 15000)))
      return "le recadreur de photo ne s'ouvre pas";
    await A.page.click("#av-crop-ok");
    if (!(await until(A.page, () => !!document.querySelector("#profile-avatar img"), 15000)))
      return "la photo déposée n'apparaît pas dans la carte profil";
    const src = await A.page.evaluate(() => document.querySelector("#profile-avatar img").getAttribute("src"));
    const me = await apiFromPage(A.page, "/api/user", "GET");
    if (src !== me.json.user.avatar) return `photo du profil « ${src} » contre « ${me.json.user.avatar} » côté API`;
    const tb = (await dataOf(A.page)).tbAv;
    if (tb !== src) return `le header affiche « ${tb} » et la carte « ${src} » (sources divergentes)`;
    return true;
  });

  await step("l'accueil affiche la MÊME photo (aucune reconnexion nécessaire)", async () => {
    await goScreen(A.page, "home");
    await sleep(1300);
    const d = await dataOf(A.page);
    if (!d.dashAv) return "le cercle de l'accueil reste sur les initiales malgré la photo";
    if (d.dashAv !== d.tbAv) return `accueil « ${d.dashAv} » contre header « ${d.tbAv} »`;
    return true;
  });

  await step("un AUTRE joueur voit la même photo au classement et sur le profil public", async () => {
    await goScreen(B.page, "ranks");
    await sleep(1500);
    await B.page.evaluate((p) => {
      const el = document.getElementById("rank-search");
      el.value = p; el.dispatchEvent(new Event("input", { bubbles: true }));
    }, A.pseudo);
    const found = await until(B.page, (p) => {
      const row = [...document.querySelectorAll("#ranks-root .rank-row")]
        .find((r) => ((r.querySelector(".who-pseudo") || {}).innerText || "").trim() === p);
      return !!row && !!row.querySelector(".who-line img");
    }, A.pseudo, 10000);
    if (!found) return "le classement d'un autre joueur n'affiche pas la photo";
    const shown = await B.page.evaluate((p) => {
      const row = [...document.querySelectorAll("#ranks-root .rank-row")]
        .find((r) => ((r.querySelector(".who-pseudo") || {}).innerText || "").trim() === p);
      return (row.querySelector(".who-line img") || {}).getAttribute("src");
    }, A.pseudo);
    const pub = (await apiFromPage(B.page, "/api/users/" + Aid, "GET")).json.user.avatar;
    if (shown !== pub) return `le classement montre « ${shown} » contre « ${pub} » sur le profil public`;
    await B.page.evaluate((id) => window.App.openProfileById(id), Aid);
    await sleep(1700);
    const ppSrc = await B.page.evaluate(() => {
      const i = document.querySelector("#profile-root .big-avatar img");
      return i ? i.getAttribute("src") : null;
    });
    if (ppSrc !== pub) return `le profil public affiche « ${ppSrc} » contre « ${pub} » côté API`;
    return true;
  });
  /* ---- 4. Elo gagné/perdu : une partie classée, deux lectures ---- */
  let bid = null;
  await step("partie classée : les deux joueurs sont mis en file et acceptent", async () => {
    bid = (await apiFromPage(B.page, "/api/user", "GET")).json.user.id;
    /* L'assistant de partie MÉMORISE son étape : un scénario qui l'a utilisé (défi)
       le laisse à l'étape 4, et « Continuer » y lancerait une partie au lieu
       d'avancer. Passer par un autre écran le fait repartir de l'étape 1 — c'est
       le comportement de l'application, pas un contournement de test. */
    for (const P of [A, B]) {
      await dismissModals(P.page);
      /* L'assistant de partie REPREND l'étape laissée (S12 l'a mené à l'étape 4 du
         défi) : on revient à l'étape 1 par la pastille de navigation, le geste réel
         d'un joueur qui veut une nouvelle partie. Un simple changement d'écran ne
         suffit pas — l'étape est conservée volontairement par l'application. */
      await goScreen(P.page, "play");
      const dot = P.page.locator('#play-root .pg-dot[data-goto="1"]');
      if (await dot.count()) { await dot.first().click(); await sleep(450); }
    }
    for (const P of [A, B]) {
      const r = await wizard(P.page, { mode: "online", fmt: "blitz" });
      if (r !== true) {
        const diag = await P.page.evaluate(() => {
          const pr = document.getElementById("play-root");
          return {
            etape: (pr ? pr.innerText : "").slice(0, 120).replace(/\s+/g, " "),
            cta: (document.getElementById("pg-cta") || {}).innerText || "",
          };
        });
        return `assistant indisponible pour ${P.pseudo} : ${r} — écran « ${diag.etape} » (bouton « ${diag.cta} »)`;
      }
      await P.page.click("#pg-cta");
    }
    await sleep(1400);
    const okA = await waitVisible(A.page, "#mm-accept", 30000);
    const okB = await waitVisible(B.page, "#mm-accept", 30000);
    if (!okA || !okB) return `proposition de match absente (${okA} / ${okB})`;
    await A.page.click("#mm-accept");
    await B.page.click("#mm-accept");
    const pileA = await waitVisible(A.page, "#choose-pile", 25000);
    const pileB = await waitVisible(B.page, "#choose-pile", 25000);
    return pileA && pileB ? true : "tirage au sort non proposé après acceptation";
  });

  await step("abandon immédiat : la partie se termine et l'Elo est consigné", async () => {
    const pick = async (page, preferred) => {
      const id = await page.evaluate((pref) => {
        const other = pref === "choose-pile" ? "choose-face" : "choose-pile";
        for (const i of [pref, other]) {
          const e = document.getElementById(i);
          if (e && !e.disabled && e.offsetParent !== null) return i;
        }
        return null;
      }, preferred);
      if (!id) return null;
      await page.click("#" + id);
      await sleep(800);
      return id;
    };
    const a = await pick(A.page, "choose-pile");
    if (!a) return "le premier joueur ne peut choisir aucune face";
    const b = await pick(B.page, a === "choose-pile" ? "choose-face" : "choose-pile");
    if (!b) return "le second joueur ne peut choisir la face restante";
    const ready = (page) => until(page, () => {
      const g = window.Fanorona.state();
      return !!g && !g.over && !g.spectator && document.querySelectorAll(".piece.me").length > 0;
    }, 25000);
    if (!(await ready(A.page))) return "le plateau ne s'ouvre pas chez le premier joueur";
    if (!(await ready(B.page))) return "le plateau ne s'ouvre pas chez le second joueur";
    await A.page.click("#btn-resign");
    await sleep(700);
    if (!(await visible(A.page, "#resign-ok"))) return "confirmation d'abandon non affichée";
    await A.page.click("#resign-ok");
    await sleep(3200);
    return true;
  });
  await step("le perdant lit un delta NÉGATIF avec son Elo avant → après (accueil)", async () => {
    await goScreen(A.page, "home");
    /* L'actualisation est asynchrone (la partie vient de se terminer) : on ATTEND
       la ligne, au lieu de lire une seule fois au risque de juger un état périmé. */
    await until(A.page, (p) => {
      const el = [...document.querySelectorAll("#home-root .feed-item")].find((f) => f.innerText.includes(p));
      return !!el && /Elo/.test(el.innerText);
    }, B.pseudo, 15000);
    const row = await A.page.evaluate((p) => {
      const el = [...document.querySelectorAll("#home-root .feed-item")]
        .find((f) => f.innerText.includes(p));
      return el ? el.innerText.replace(/\s+/g, " ") : null;
    }, B.pseudo);
    if (!row) return `aucune ligne de partie contre ${B.pseudo} à l'accueil`;
    if (/undefined|NaN|null/.test(row)) return `valeur invalide affichée : « ${row} »`;
    if (!/Défaite/i.test(row)) return `la ligne n'annonce pas la défaite : « ${row} »`;
    if (!/-\d+ Elo/.test(row)) return `aucun Elo perdu lisible : « ${row} »`;
    if (!/\d{3,4}\s*→\s*\d{3,4}/.test(row)) return `l'Elo avant → après est absent : « ${row} »`;
    return true;
  });

  await step("le nom cliquable ouvre le profil du vainqueur, qui lit un delta POSITIF", async () => {
    const linked = await A.page.evaluate((p) => {
      const el = [...document.querySelectorAll("#home-root .feed-item")]
        .find((f) => f.innerText.includes(p));
      const link = el && el.querySelector(".link-pseudo");
      if (!link) return false;
      link.click();
      return true;
    }, B.pseudo);
    if (!linked) return `le nom de ${B.pseudo} n'est pas un lien dans « Dernières parties »`;
    await sleep(1900);
    const hash = await A.page.evaluate(() => location.hash);
    if (!hash.includes("profile?id=" + bid)) return `le lien n'ouvre pas le profil visé : « ${hash} »`;
    const txt = await A.page.evaluate(() => document.getElementById("profile-root").innerText.replace(/\s+/g, " "));
    const bad = /(undefined|NaN)/.exec(txt);
    if (bad) return `valeur invalide sur le profil public : « ${txt.slice(Math.max(0, bad.index - 60), bad.index + 60)} »`;
    if (!/Victoire/i.test(txt)) return "le profil du vainqueur n'affiche pas sa victoire";
    if (!/\+\d+ Elo/.test(txt)) return "le vainqueur n'affiche pas un gain d'Elo positif";
    if (!/\d{3,4}\s*→\s*\d{3,4}/.test(txt)) return "l'Elo avant → après manque sur le profil du vainqueur";
    return true;
  });

  await step("les valeurs affichées correspondent à l'historique du SERVEUR (deux camps)", async () => {
    const hA = (await apiFromPage(A.page, "/api/games/history", "GET")).json.games
      .find((g) => g.winner_id !== null && g.elo1_before !== null);
    if (!hA) return "aucune partie classée avec instantané d'Elo dans l'historique";
    const sA = hA.player1_id === Aid ? 1 : 2;
    const beforeA = sA === 1 ? hA.elo1_before : hA.elo2_before;
    const afterA = sA === 1 ? hA.elo1_after : hA.elo2_after;
    const deltaA = sA === 1 ? hA.delta1 : hA.delta2;
    if (afterA !== beforeA + deltaA) return `incohérence serveur : ${beforeA} + ${deltaA} ≠ ${afterA}`;
    if (deltaA >= 0) return `le perdant devrait avoir un delta négatif (${deltaA})`;
    const hB = (await apiFromPage(B.page, "/api/games/history", "GET")).json.games.find((g) => g.id === hA.id);
    if (!hB) return "la partie n'apparaît pas dans l'historique du vainqueur";
    const sB = hB.player1_id === bid ? 1 : 2;
    const deltaB = sB === 1 ? hB.delta1 : hB.delta2;
    if (deltaB <= 0) return `le vainqueur devrait avoir un delta positif (${deltaB})`;
    const txt = await A.page.evaluate(() => document.getElementById("profile-root").innerText);
    const shown = /\+\s?(\d+) Elo/.exec(txt);
    return shown && Number(shown[1]) === deltaB ? true
      : `le profil annonce « ${shown ? shown[1] : "aucun"} Elo » et le serveur ${deltaB} Elo`;
  });

  /* ---- 5. Aucune valeur technique visible sur les écrans principaux ---- */
  await step("aucun « undefined », « NaN » ni « [object Object] » sur les écrans visités", async () => {
    const routes = ["home", "play", "match", "ranks", "tournament", "wallet", "skins", "profile", "friends", "settings"];
    const bad = [];
    for (const r of routes) {
      await goScreen(A.page, r);
      await sleep(800);
      const hit = await A.page.evaluate(() => {
        const txt = document.body.innerText || "";
        const m = /(undefined|NaN|\[object Object\])/.exec(txt);
        return m ? txt.slice(Math.max(0, m.index - 70), m.index + 70).replace(/\s+/g, " ") : null;
      });
      if (hit) bad.push(`${r} : « ${hit} »`);
    }
    return bad.length ? bad.slice(0, 3).join(" | ") : true;
  });
}

/* =========================================================================
   S14 — ADMINISTRATION : bouton du profil, cartes de modules, écrans réels
   =========================================================================
   Le back-office est un espace à droits. Ce scénario vérifie d'abord qu'un
   joueur ORDINAIRE ne le voit pas et n'en reçoit aucune gêne, puis qu'un super
   administrateur — rôle attribué par `admin_grant.js` sur la COPIE de la base —
   ouvre les écrans et y lit des données RÉELLES. Chaque étape compare ce que
   l'écran AFFICHE à ce que l'API RÉPOND : aucun droit n'est supposé.
   ========================================================================= */
async function s14_admin(browser) {
  const A = await ensure(browser, "A");
  const AD = await ensureAdmin(browser);

  await step("un joueur sans rôle ne voit aucun bouton « Administration »", async () => {
    await goScreen(A.page, "profile");
    await sleep(700);
    const has = await A.page.locator('#profile-root button:has-text("Administration")').count();
    return has ? "le bouton d'administration est proposé à un joueur sans rôle" : true;
  });

  await step("la route #/admin refuse proprement et SANS message d'erreur", async () => {
    await goScreen(A.page, "admin");
    await sleep(900);
    const txt = await A.page.evaluate(() => ((document.getElementById("admin-root") || {}).innerText || ""));
    if (!/acc[eè]s refus/i.test(txt)) return "la route #/admin n'annonce pas le refus : « " + txt.slice(0, 90) + " »";
    /* Le 403 de /api/admin/me est attendu : il ne doit pas produire de toast. */
    const t = (await toasts(A.page)).join(" | ");
    if (/refus|erreur|403/i.test(t)) return "un refus silencieux a produit un message visible : " + t;
    /* La v2 ne peint AUCUN écran pour un compte sans rôle : ni barre latérale,
       ni module. Seul le message de refus est attendu. */
    const nav = await A.page.locator("#admin-root [data-voir]").count();
    return nav === 0 ? true : "des modules sont proposés malgré le refus (" + nav + ")";
  });

  await step("après attribution du rôle, le profil propose « Administration »", async () => {
    /* Le rôle a été écrit en base APRÈS l'ouverture de la session : la page
       recharge ses droits, comme au démarrage de l'application. */
    await AD.page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2600);
    const me = await apiFromPage(AD.page, "/api/admin/me");
    if (me.status !== 200) return "/api/admin/me répond " + me.status + " au super administrateur";
    await goScreen(AD.page, "profile");
    await sleep(900);
    const btn = AD.page.locator('#profile-root button:has-text("Administration")').first();
    if (!(await btn.count())) return "aucun bouton « Administration » dans le profil malgré le rôle";
    await btn.click();
    const ok = await until(AD.page, () => (location.hash || "").includes("admin"), 8000);
    await sleep(1200);
    return ok ? true : "le clic sur « Administration » n'ouvre pas la route admin";
  });

  await step("la barre latérale liste EXACTEMENT les modules du catalogue serveur", async () => {
    await goScreen(AD.page, "admin");
    await sleep(1800);
    const api = await apiFromPage(AD.page, "/api/admin/modules");
    const mods = (api.json && api.json.modules) || [];
    if (!mods.length) return "le catalogue serveur est vide";
    /* Les entrées de navigation sont construites À PARTIR du catalogue : une
       vue ne peut pas exister sans son module, ni l'inverse. */
    const shown = await AD.page.evaluate(() => [...document.querySelectorAll("#admin-root [data-voir]")]
      .map((b) => ({ id: b.dataset.voir })));
    if (shown.length !== mods.length)
      return shown.length + " entrée(s) affichée(s) pour " + mods.length + " module(s)";
    const missing = mods.filter((m) => !shown.some((s) => s.id === m.id));
    if (missing.length) return "modules absents de la barre : " + missing.map((m) => m.id).join(", ");
    return true;
  });

  await step("écran Campagnes : les bannières affichées sont celles servies par l'API", async () => {
    await AD.page.evaluate(() => window.Admin.go("campaigns"));
    await sleep(1600);
    const api = await apiFromPage(AD.page, "/api/admin/ads");
    const ads = (api.json && api.json.ads) || [];
    const shown = await AD.page.evaluate(() => ({
      n: document.querySelectorAll("#admin-root tbody tr").length,
      txt: ((document.getElementById("admin-root") || {}).innerText || ""),
    }));
    if (ads.length && !shown.n) return ads.length + " bannière(s) côté serveur, aucune ligne à l'écran";
    if (!ads.length && !/aucune banni/i.test(shown.txt)) return "aucune bannière au serveur et aucun message explicite";
    return /\bundefined\b/.test(shown.txt) ? "l'écran Campagnes contient « undefined »" : true;
  });

  await step("écran Rôles : un contrôle par droit, rôle protégé en lecture seule", async () => {
    await AD.page.evaluate(() => window.Admin.go("roles"));
    await sleep(1800);
    const api = await apiFromPage(AD.page, "/api/admin/roles");
    const mods = (api.json && api.json.modules) || [];
    const expected = mods.reduce((s, m) => s + (m.actions || []).length, 0);
    /* Le premier onglet est le rôle protégé (super_admin) : tout doit y être
       désactivé, et aucun bouton « Enregistrer » ne doit être proposé. */
    await AD.page.locator("#admin-root [role=tab][data-role]").first().click();
    await sleep(1500);
    const got = await AD.page.locator("#admin-root input[data-grant]").count();
    if (got !== expected) return got + " contrôle(s) pour " + expected + " droit(s) du catalogue";
    const ro = await AD.page.evaluate(() => {
      const boxes = [...document.querySelectorAll("#admin-root input[data-grant]")];
      return { n: boxes.length, disabled: boxes.filter((b) => b.disabled).length,
        save: !!document.querySelector("#admin-root [data-save]") };
    });
    if (ro.disabled !== ro.n) return ro.disabled + " contrôle(s) désactivé(s) sur " + ro.n + " pour le rôle protégé";
    return ro.save ? "le rôle protégé propose tout de même « Enregistrer »" : true;
  });

  await step("écran Journal : les décisions sont listées, jamais « undefined »", async () => {
    await AD.page.evaluate(() => window.Admin.go("audit"));
    await sleep(1600);
    const txt = await AD.page.evaluate(() => ((document.getElementById("admin-root") || {}).innerText || ""));
    if (/undefined|NaN/.test(txt)) return "le journal affiche une valeur technique : « " + txt.slice(0, 90) + " »";
    const rows = await AD.page.locator("#admin-root tbody tr").count();
    /* L'attribution du rôle a été journalisée par admin_grant.js : le journal
       ne peut pas être vide. */
    return rows > 0 ? true : "journal vide alors que l'attribution du rôle a été auditée";
  });

  await step("interrupteur de module : couper ferme l'accès, rallumer le rouvre", async () => {
    /* Le 403 de /api/admin/badges pendant la coupure est le RÉSULTAT attendu :
       le navigateur le journalise comme une ressource en échec, on l'annonce
       donc au harnais le temps de la vérification. */
    allowFailure("/api/admin/badges");
    try {
      const off = await apiFromPage(AD.page, "/api/admin/modules/ranking", "POST", { enabled: false });
      if (off.status !== 200) return "la désactivation répond " + off.status;
      const closed = await apiFromPage(AD.page, "/api/admin/badges");
      const on = await apiFromPage(AD.page, "/api/admin/modules/ranking", "POST", { enabled: true });
      if (on.status !== 200) return "la réactivation répond " + on.status;
      const reopened = await apiFromPage(AD.page, "/api/admin/badges");
      if (closed.status !== 403) return "module éteint mais /api/admin/badges répond " + closed.status;
      return reopened.status === 200 ? true : "module rallumé mais /api/admin/badges répond " + reopened.status;
    } finally {
      await sleep(400);
      dropFailure("/api/admin/badges");
    }
  });
}
