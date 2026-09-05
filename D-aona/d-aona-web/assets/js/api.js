/* =========================================================
   D-aôna — Client API & WebSocket (connexion au backend)
   ========================================================= */
"use strict";

const API = (() => {
  const base = location.origin;
  let token = localStorage.getItem("daona_token") || null;
  let ws = null;
  let wsReady = false;
  let wsQueue = [];
  const handlers = {};   // type -> [fn]

  /* ---------- REST ---------- */
  async function request(path, method = "GET", body = null) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (token) opts.headers["Authorization"] = "Bearer " + token;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(base + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || ("Erreur " + res.status));
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  /* ---------- WebSocket ---------- */
  function connect(force = false) {
    if (!force && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    wsReady = false;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws");
    ws.onopen = () => {
      wsReady = true;
      // 1. Envoyer l'authentification d'abord
      if (token) {
        try { ws.send(JSON.stringify({ type: "auth", token })); } catch (e) {}
      }
      // 2. Vider la file d'attente (le serveur traite auth en premier)
      const pending = wsQueue;
      wsQueue = [];
      pending.forEach((m) => { try { ws.send(JSON.stringify(m)); } catch (e) {} });
      emit("open");
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        emit(msg.type, msg);
      } catch (e) { /* ignore */ }
    };
    ws.onclose = () => {
      wsReady = false;
      ws = null;
      emit("close");
      setTimeout(() => { if (!ws) connect(); }, 3000);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function send(msg) {
    if (!wsReady) { wsQueue.push(msg); connect(); return; }
    try { ws.send(JSON.stringify(msg)); } catch (e) {}
  }

  function on(type, fn) {
    (handlers[type] = handlers[type] || []).push(fn);
  }
  function off(type, fn) {
    handlers[type] = (handlers[type] || []).filter((f) => f !== fn);
  }
  function emit(type, msg) {
    (handlers[type] || []).forEach((fn) => { try { fn(msg); } catch (e) { console.error(e); } });
  }

  /* ---------- Helpers auth ---------- */
  function setToken(t) {
    const changed = token !== t;
    token = t;
    if (t) localStorage.setItem("daona_token", t);
    else localStorage.removeItem("daona_token");
    if (changed && t) connect(true);   // nouvelle auth → reconnexion forcée
  }
  function getToken() { return token; }

  return {
    request, connect, send, on, off, setToken, getToken,
    isConnected: () => wsReady,
  };
})();

window.API = API;