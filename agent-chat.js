// AI Maintenance Assistant chat for the tenant portal. DEMO ONLY: it exists only on a local server opened with ?demo=1.
// It talks to the same-origin /api/agent/tenant/* routes of serve.ps1. It never sees the API key, tool results, costs or
// anything the server does not return to a tenant. All text from the server is shown with textContent (never as HTML).
// The conversation id and its one-time token live in sessionStorage (this tab only), never in a URL or in persistent storage.
(function () {
  "use strict";

  if (!/[?&]demo=1(&|$)/.test(location.search)) return;

  const SESSION_KEY = "dashboardPractice.agentChat.v1";
  const RX_CONV = /^conv-\d{14}-[0-9a-f]{8}$/;
  const RX_RUN = /^run-\d{14}-[0-9a-f]{8}$/;
  const RX_TOKEN = /^[A-Za-z0-9_-]{32}$/;
  const RX_TICKET = /^(DEMO|HV)-\d{1,3}$/;
  const DEMO_PROPERTY = "10 Harbor View";
  const FINISHED = ["resolved", "closed"];
  const TEXT_MAX = 2000;
  const FETCH_TIMEOUT_MS = 15000;
  const POLL_MS = 1500;
  const POLL_LIMIT_MS = 150000;
  const POLL_NETWORK_RETRIES = 4;

  let tickets = [];          // [{ id, issue, status }]
  let session = null;        // { conversation_id, token, ticket_id, pending_run_id }
  let epoch = 0;             // bumped whenever the conversation changes, so an old poll stops
  let busy = false;
  let liveReady = true;
  const ui = {};

  // ---- storage (sessionStorage only; every call is guarded) -------------

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !RX_CONV.test(s.conversation_id) || !RX_TOKEN.test(s.token) || !RX_TICKET.test(s.ticket_id)) { clearSession(); return null; }
      if (s.pending_run_id && !RX_RUN.test(s.pending_run_id)) s.pending_run_id = null;
      return { conversation_id: s.conversation_id, token: s.token, ticket_id: s.ticket_id, pending_run_id: s.pending_run_id || null };
    } catch (err) { return null; }
  }

  function saveSession() {
    try { if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (err) { /* private mode: the chat still works until reload */ }
  }

  function clearSession() {
    session = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
  }

  // ---- network ----------------------------------------------------------

  // Resolves to { status, data } (status 0 = could not reach the server). Never throws.
  async function api(method, path, body, token, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || FETCH_TIMEOUT_MS);
    try {
      const headers = {};
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers["X-Conversation-Token"] = token;
      const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, cache: "no-store" });
      let data = null;
      try { data = await res.json(); } catch (err) { data = null; }
      return { status: res.status, data };
    } catch (err) {
      return { status: 0, data: null };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- demo tickets (static demo/tickets.csv, 10 Harbor View, not finished) ----

  function parseCsv(text) {
    const rows = []; let row = []; let cell = ""; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function loadTickets() {
    try {
      const res = await fetch("demo/tickets.csv", { cache: "no-store" });
      if (!res.ok) return [];
      const rows = parseCsv(await res.text());
      const head = rows.shift() || [];
      const col = (name) => head.indexOf(name);
      const iId = col("id"), iProp = col("property"), iIssue = col("issue"), iStatus = col("status");
      if (iId < 0 || iProp < 0 || iIssue < 0 || iStatus < 0) return [];
      return rows
        .filter((r) => r[iProp] === DEMO_PROPERTY && RX_TICKET.test(r[iId]) && FINISHED.indexOf(String(r[iStatus]).toLowerCase()) < 0)
        .map((r) => ({ id: r[iId], issue: r[iIssue], status: r[iStatus] }));
    } catch (err) { return []; }
  }

  // ---- UI ---------------------------------------------------------------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buildUi() {
    const section = el("section", "card chat");
    section.id = "agent-chat";
    section.setAttribute("aria-label", "AI Maintenance Assistant (demo)");

    const title = el("h2", "chat-title", "Ask the AI Maintenance Assistant ");
    title.appendChild(el("span", "chat-badge", "Demo"));
    section.appendChild(title);
    section.appendChild(el("p", "hint", "Demo only, with fictional data for 10 Harbor View. In an emergency such as gas, smoke, fire or an electrical shock, leave the area and call 911."));

    ui.notice = el("div", "message chat-notice");
    ui.notice.setAttribute("role", "status");
    ui.notice.setAttribute("aria-live", "polite");
    ui.notice.hidden = true;
    section.appendChild(ui.notice);

    // start panel
    ui.start = el("div", "chat-start");
    const lab = el("label", null, "Which request is this about?");
    lab.setAttribute("for", "chat-ticket");
    ui.ticket = el("select");
    ui.ticket.id = "chat-ticket";
    ui.startBtn = el("button", "btn btn-primary", "Start conversation");
    ui.startBtn.type = "button";
    ui.start.appendChild(lab);
    ui.start.appendChild(ui.ticket);
    ui.start.appendChild(ui.startBtn);
    section.appendChild(ui.start);

    // chat room
    ui.room = el("div", "chat-room");
    ui.room.hidden = true;
    const head = el("div", "chat-head");
    ui.roomTitle = el("span", "chat-head-title");
    ui.newBtn = el("button", "btn btn-ghost chat-new", "Start a new conversation");
    ui.newBtn.type = "button";
    head.appendChild(ui.roomTitle);
    head.appendChild(ui.newBtn);
    ui.log = el("div", "chat-log");
    ui.log.setAttribute("role", "log");
    ui.log.setAttribute("aria-live", "polite");
    ui.log.tabIndex = 0;
    ui.form = el("form", "chat-form");
    ui.form.noValidate = true;
    ui.input = el("textarea");
    ui.input.rows = 3;
    ui.input.maxLength = TEXT_MAX;
    ui.input.placeholder = "Describe the problem or answer the assistant’s question.";
    ui.input.setAttribute("aria-label", "Your message");
    ui.count = el("p", "hint hint-right", "0 / " + TEXT_MAX);
    ui.count.setAttribute("aria-hidden", "true");
    ui.send = el("button", "btn btn-primary", "Send");
    ui.send.type = "submit";
    ui.form.appendChild(ui.input);
    ui.form.appendChild(ui.count);
    ui.form.appendChild(ui.send);
    ui.room.appendChild(head);
    ui.room.appendChild(ui.log);
    ui.room.appendChild(ui.form);
    section.appendChild(ui.room);

    const portal = document.querySelector("main.portal") || document.body;
    const settings = document.getElementById("settings");
    if (settings && settings.parentNode === portal) portal.insertBefore(section, settings); else portal.appendChild(section);
    ui.section = section;

    ui.startBtn.addEventListener("click", startConversation);
    ui.newBtn.addEventListener("click", newConversation);
    ui.form.addEventListener("submit", (ev) => { ev.preventDefault(); sendMessage(); });
    ui.input.addEventListener("input", () => { ui.count.textContent = ui.input.value.length + " / " + TEXT_MAX; });
    ui.input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); sendMessage(); }
    });
  }

  function notice(text, kind) {
    ui.notice.className = "message chat-notice" + (kind ? " message--" + kind : "");
    ui.notice.textContent = text || "";
    ui.notice.hidden = !text;
  }

  function fillTickets() {
    ui.ticket.textContent = "";
    if (tickets.length === 0) {
      const o = el("option", null, "No open requests available in the demo");
      o.value = "";
      ui.ticket.appendChild(o);
      ui.ticket.disabled = true; ui.startBtn.disabled = true;
      return;
    }
    const first = el("option", null, "Choose a request…");
    first.value = "";
    ui.ticket.appendChild(first);
    tickets.forEach((t) => {
      const o = el("option", null, t.id + " – " + t.issue + " (" + t.status + ")");
      o.value = t.id;
      ui.ticket.appendChild(o);
    });
    ui.ticket.disabled = false;
    ui.startBtn.disabled = !liveReady;
  }

  function showStart() {
    epoch++;
    ui.room.hidden = true;
    ui.start.hidden = false;
    fillTickets();
    setBusy(false);
  }

  function showRoom() {
    ui.start.hidden = true;
    ui.room.hidden = false;
    ui.roomTitle.textContent = "Request " + session.ticket_id;
    setBusy(false);
  }

  function setBusy(on) {
    busy = on;
    const off = on || !liveReady;
    ui.input.disabled = off;
    ui.send.disabled = off;
    ui.send.textContent = on ? "Working…" : "Send";
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function showEmptyHint() {
    // a neutral hint written by this page, not an assistant message
    ui.empty = el("p", "chat-empty", "Type your message below to start. The assistant replies in a few seconds.");
    ui.log.appendChild(ui.empty);
  }

  function addMessage(role, text, ts) {
    if (ui.empty && ui.empty.parentNode) ui.empty.parentNode.removeChild(ui.empty);
    ui.empty = null;
    const wrap = el("div", "chat-msg chat-msg--" + (role === "tenant" ? "tenant" : "assistant"));
    const who = el("div", "chat-who", role === "tenant" ? "You" : "AI Maintenance Assistant");
    const t = timeLabel(ts);
    if (t) who.appendChild(el("span", "chat-time", " · " + t));
    const body = el("div", "chat-text", String(text));
    wrap.appendChild(who);
    wrap.appendChild(body);
    ui.log.appendChild(wrap);
    ui.log.scrollTop = ui.log.scrollHeight;
    return wrap;
  }

  function showTyping() {
    removeTyping();
    ui.typing = el("div", "chat-msg chat-msg--assistant chat-typing", "Working on a reply…");
    ui.typing.setAttribute("aria-label", "The assistant is preparing a reply");
    ui.log.appendChild(ui.typing);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function removeTyping() {
    if (ui.typing && ui.typing.parentNode) ui.typing.parentNode.removeChild(ui.typing);
    ui.typing = null;
  }

  // ---- session lifecycle ------------------------------------------------

  function expired() {
    // The server no longer accepts this conversation or token (reset, data cleaned, or never valid): forget it safely.
    clearSession();
    ui.log.textContent = "";
    showStart();
    notice("Your earlier conversation is no longer available (it may have expired or been reset). You can start a new one.", "warning");
  }

  async function startConversation() {
    const id = ui.ticket.value;
    if (!RX_TICKET.test(id)) { notice("Choose the request this is about first.", "warning"); return; }
    ui.startBtn.disabled = true;
    notice("Starting…");
    const r = await api("POST", "/api/agent/tenant/start", { ticket_id: id });
    ui.startBtn.disabled = !liveReady;
    if (r.status === 200 && r.data && RX_CONV.test(r.data.conversation_id) && RX_TOKEN.test(r.data.tenant_token)) {
      epoch++;
      session = { conversation_id: r.data.conversation_id, token: r.data.tenant_token, ticket_id: id, pending_run_id: null };
      saveSession();
      ui.log.textContent = "";
      notice("");
      showRoom();
      showEmptyHint();
      ui.input.focus();
    } else if (r.status === 404) {
      notice("The demo assistant does not know that request. Please choose another one.", "warning");
    } else if (r.status === 429) {
      notice("Too many conversations were started just now. Please wait a minute and try again.", "warning");
    } else if (r.status === 0) {
      notice("Could not reach the demo assistant. Check that the local server is running, then try again.", "error");
    } else {
      notice("The conversation could not be started. Please try again.", "error");
    }
  }

  function newConversation() {
    clearSession();
    ui.log.textContent = "";
    notice("");
    showStart();
  }

  async function restore() {
    session = loadSession();
    if (!session) { showStart(); return; }
    notice("Restoring your conversation…");
    const r = await api("GET", "/api/agent/tenant/conversation?id=" + encodeURIComponent(session.conversation_id), undefined, session.token);
    if (r.status === 200 && r.data && Array.isArray(r.data.messages)) {
      notice("");
      showRoom();
      ui.log.textContent = "";
      r.data.messages.forEach((m) => addMessage(m.role, m.text, m.ts));
      if (r.data.messages.length === 0) showEmptyHint();
      if (session.pending_run_id) {
        setBusy(true); showTyping();
        pollRun(session.pending_run_id, epoch);
      }
    } else if (r.status === 403 || r.status === 404) {
      expired();
    } else {
      // the server could not be reached or failed: keep the saved conversation and let the person retry
      ui.start.hidden = true; ui.room.hidden = true;
      notice("Could not reach the demo assistant to restore your conversation. Your conversation is kept in this tab.", "error");
      const retry = el("button", "btn btn-secondary", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => { retry.remove(); restore(); });
      ui.notice.appendChild(document.createTextNode(" "));
      ui.notice.appendChild(retry);
    }
  }

  // ---- sending and polling ----------------------------------------------

  async function sendMessage() {
    if (busy || !session || !liveReady) return;
    const text = ui.input.value.replace(/\s+$/, "");
    if (text.trim().length === 0) return;
    if (text.length > TEXT_MAX) { notice("Please keep the message under " + TEXT_MAX + " characters.", "warning"); return; }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) { notice("That message has characters the assistant cannot accept.", "warning"); return; }
    notice("");
    const mine = epoch;
    setBusy(true);
    const r = await api("POST", "/api/agent/tenant/message", { conversation_id: session.conversation_id, text }, session.token);
    if (mine !== epoch) return;
    if (r.status === 200 && r.data && RX_RUN.test(r.data.run_id)) {
      addMessage("tenant", text, new Date().toISOString());
      ui.input.value = "";
      ui.count.textContent = "0 / " + TEXT_MAX;
      session.pending_run_id = r.data.run_id;
      saveSession();
      showTyping();
      pollRun(r.data.run_id, mine);
      return;
    }
    setBusy(false);
    if (r.status === 403 || r.status === 404) expired();
    else if (r.status === 409) notice("The previous reply is still being prepared. Please wait a few seconds and try again.", "warning");
    else if (r.status === 400) notice("That message could not be sent. Please check it and try again.", "warning");
    else if (r.status === 0) notice("Could not reach the demo assistant. Your message was not sent; try again.", "error");
    else notice("The message could not be sent. Please try again.", "error");
  }

  function pollRun(runId, mine) {
    const started = Date.now();
    let failures = 0;
    const tick = async () => {
      if (mine !== epoch || !session) return;
      const r = await api("GET", "/api/agent/tenant/result?conversation_id=" + encodeURIComponent(session.conversation_id) + "&run_id=" + encodeURIComponent(runId), undefined, session.token);
      if (mine !== epoch || !session) return;
      if (r.status === 200 && r.data && r.data.status === "running") {
        failures = 0;
        if (Date.now() - started > POLL_LIMIT_MS) { finishRun(null, "This is taking longer than expected. Your message is saved; wait a moment and send again if needed.", true); return; }
        setTimeout(tick, POLL_MS); return;
      }
      if (r.status === 200 && r.data && r.data.status === "done" && typeof r.data.reply === "string") { finishRun(r.data.reply); return; }
      if (r.status === 200 && r.data && r.data.status === "failed") { finishRun(null, String(r.data.message || "A reply could not be prepared. Please try again.")); return; }
      if (r.status === 403) { expired(); return; }
      if (r.status === 404) { await refreshTranscript(); return; }
      failures++;
      if (failures > POLL_NETWORK_RETRIES) { finishRun(null, "Lost the connection to the demo assistant. Reload the page to check for the reply.", true); return; }
      setTimeout(tick, POLL_MS * 2);
    };
    setTimeout(tick, 600);
  }

  function finishRun(reply, problem, keepPending) {
    removeTyping();
    if (reply !== null) addMessage("assistant", reply, new Date().toISOString());
    if (problem) notice(problem, "warning");
    if (session && !keepPending) { session.pending_run_id = null; saveSession(); }
    setBusy(false);
    if (reply !== null) ui.input.focus();
  }

  async function refreshTranscript() {
    // the run record is gone (for example the store was cleaned): show what the server really has
    removeTyping();
    if (!session) return;
    const r = await api("GET", "/api/agent/tenant/conversation?id=" + encodeURIComponent(session.conversation_id), undefined, session.token);
    if (r.status === 200 && r.data && Array.isArray(r.data.messages)) {
      ui.log.textContent = "";
      r.data.messages.forEach((m) => addMessage(m.role, m.text, m.ts));
      session.pending_run_id = null; saveSession();
      setBusy(false);
    } else if (r.status === 403 || r.status === 404) expired();
    else finishRun(null, "Could not check for the reply. Reload the page to try again.", true);
  }

  // ---- start ------------------------------------------------------------

  async function init() {
    const st = await api("GET", "/api/agent/status", undefined, undefined, 3000);
    if (st.status !== 200 || !st.data) return; // not the local demo server: show nothing and make no further requests
    liveReady = st.data.LiveReady === true && st.data.PromptHashesOk !== false;
    buildUi();
    tickets = await loadTickets();
    if (!liveReady) notice("The AI assistant is switched off in this demo, so it cannot answer right now.", "warning");
    await restore();
    if (!liveReady) { ui.startBtn.disabled = true; setBusy(false); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
