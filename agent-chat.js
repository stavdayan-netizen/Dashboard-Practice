// Maintenance Support chat for the tenant portal. DEMO ONLY: it exists only on a local server opened with ?demo=1.
// Flow: the tenant fills in the request form as usual; in the demo the request is saved as a new DEMO ticket on this machine
// (never sent to Make or Airtable), the form is replaced by this chat, and the assistant opens the conversation about that ticket.
// It talks only to the same-origin /api/agent/* routes of serve.ps1. It never sees the API key, tool results, costs or anything
// the server does not return to a tenant. All text from the server is shown with textContent (never as HTML).
// The conversation id and its one-time token live in sessionStorage (this tab only), never in a URL or in persistent storage.
(function () {
  "use strict";

  if (!/[?&]demo=1(&|$)/.test(location.search)) return;

  const SESSION_KEY = "dashboardPractice.agentChat.v1";
  const RX_CONV = /^conv-\d{14}-[0-9a-f]{8}$/;
  const RX_RUN = /^run-\d{14}-[0-9a-f]{8}$/;
  const RX_TOKEN = /^[A-Za-z0-9_-]{32}$/;
  const RX_TICKET = /^(DEMO|HV)-\d{1,3}$/;
  const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
  const ISSUE_MIN = 5;
  const ISSUE_MAX = 1000;
  const TEXT_MAX = 2000;
  const FETCH_TIMEOUT_MS = 15000;
  const POLL_MS = 1500;
  const POLL_LIMIT_MS = 150000;
  const POLL_NETWORK_RETRIES = 4;
  const SERVER_DOWN = "Could not reach the local demo server. If it was stopped, start it again and reload this page.";

  const $ = (id) => document.getElementById(id);
  const form = $("request-form");
  const formMessage = $("form-message");

  let mode = "unknown";   // unknown (checking) | local (demo server answered) | none (no demo server: the page works as before)
  let liveReady = true;
  let session = null;     // { conversation_id, token, ticket_id, pending_run_id, issue }
  let epoch = 0;          // bumped whenever the conversation changes, so an old poll stops
  let busy = false;
  const ui = {};

  // ---- storage (sessionStorage only; every call is guarded) -------------

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !RX_TICKET.test(s.ticket_id)) { clearSession(); return null; }
      const hasConv = RX_CONV.test(s.conversation_id) && RX_TOKEN.test(s.token);
      return {
        conversation_id: hasConv ? s.conversation_id : null,
        token: hasConv ? s.token : null,
        ticket_id: s.ticket_id,
        pending_run_id: (hasConv && RX_RUN.test(s.pending_run_id)) ? s.pending_run_id : null,
        issue: typeof s.issue === "string" ? s.issue.slice(0, ISSUE_MAX) : ""
      };
    } catch (err) { return null; }
  }

  function saveSession() {
    try { if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (err) { /* the chat still works until reload */ }
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

  // ---- small DOM helpers ------------------------------------------------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function showFormMessage(text, kind) {
    if (!formMessage) return;
    formMessage.className = "message" + (kind ? " message--" + kind : "");
    formMessage.textContent = text || "";
    formMessage.hidden = !text;
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ---- chat UI (built only when it is first needed; hidden until then) ----

  function buildChat() {
    if (ui.section) return;
    const section = el("section", "card chat");
    section.id = "agent-chat";
    section.setAttribute("aria-label", "Maintenance Support");

    const head = el("div", "chat-head");
    const title = el("h2", "chat-title", "Maintenance Support");
    title.appendChild(el("span", "chat-badge", "Demo"));
    ui.newBtn = el("button", "btn btn-ghost chat-new", "Submit another request");
    ui.newBtn.type = "button";
    head.appendChild(title);
    head.appendChild(ui.newBtn);
    section.appendChild(head);

    ui.ticketLine = el("p", "chat-ticket");
    section.appendChild(ui.ticketLine);
    section.appendChild(el("p", "hint chat-emergency", "In an emergency such as gas, smoke, fire or an electrical shock, leave the area and call 911."));

    ui.notice = el("div", "message chat-notice");
    ui.notice.setAttribute("role", "status");
    ui.notice.setAttribute("aria-live", "polite");
    ui.notice.hidden = true;
    section.appendChild(ui.notice);

    ui.log = el("div", "chat-log");
    ui.log.setAttribute("role", "log");
    ui.log.setAttribute("aria-live", "polite");
    ui.log.tabIndex = 0;
    section.appendChild(ui.log);

    ui.form = el("form", "chat-form");
    ui.form.noValidate = true;
    ui.input = el("textarea");
    ui.input.rows = 3;
    ui.input.maxLength = TEXT_MAX;
    ui.input.placeholder = "Type your reply here.";
    ui.input.setAttribute("aria-label", "Your message");
    ui.count = el("p", "hint hint-right", "0 / " + TEXT_MAX);
    ui.count.setAttribute("aria-hidden", "true");
    ui.send = el("button", "btn btn-primary", "Send");
    ui.send.type = "submit";
    ui.form.appendChild(ui.input);
    ui.form.appendChild(ui.count);
    ui.form.appendChild(ui.send);
    section.appendChild(ui.form);

    section.hidden = true;
    const portal = document.querySelector("main.portal") || document.body;
    const settings = $("settings");
    if (settings && settings.parentNode === portal) portal.insertBefore(section, settings); else portal.appendChild(section);
    ui.section = section;

    ui.newBtn.addEventListener("click", submitAnother);
    ui.form.addEventListener("submit", (ev) => { ev.preventDefault(); sendMessage(); });
    ui.input.addEventListener("input", () => { ui.count.textContent = ui.input.value.length + " / " + TEXT_MAX; });
    ui.input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); sendMessage(); }
    });
  }

  function showChat() {
    buildChat();
    form.classList.add("demo-hidden");
    ui.section.hidden = false;
    ui.ticketLine.textContent = "Request " + session.ticket_id + " was submitted.";
    setBusy(busy);
  }

  function showFormAgain() {
    epoch++;
    if (ui.section) ui.section.hidden = true;
    form.classList.remove("demo-hidden");
    setBusy(false);
  }

  function notice(text, kind) {
    if (!ui.notice) return;
    ui.notice.className = "message chat-notice" + (kind ? " message--" + kind : "");
    ui.notice.textContent = text || "";
    ui.notice.hidden = !text;
  }

  function noticeWithActions(text, kind, actions) {
    notice(text, kind);
    actions.forEach((a) => {
      const b = el("button", "btn btn-secondary chat-action", a.label);
      b.type = "button";
      b.addEventListener("click", () => { b.disabled = true; a.run(); });
      ui.notice.appendChild(document.createTextNode(" "));
      ui.notice.appendChild(b);
    });
  }

  function setBusy(on) {
    busy = on;
    if (!ui.input) return;
    const off = on || !liveReady;
    ui.input.disabled = off;
    ui.send.disabled = off;
    ui.send.textContent = on ? "Working…" : "Send";
  }

  function addMessage(role, text, ts) {
    const wrap = el("div", "chat-msg chat-msg--" + (role === "tenant" ? "tenant" : "assistant"));
    const who = el("div", "chat-who", role === "tenant" ? "You" : "Maintenance Support");
    const t = timeLabel(ts);
    if (t) who.appendChild(el("span", "chat-time", " · " + t));
    wrap.appendChild(who);
    wrap.appendChild(el("div", "chat-text", String(text)));
    ui.log.appendChild(wrap);
    ui.log.scrollTop = ui.log.scrollHeight;
    return wrap;
  }

  function renderTranscript(messages) {
    ui.log.textContent = "";
    messages.forEach((m) => addMessage(m.role, m.text, m.ts));
  }

  function showTyping() {
    removeTyping();
    ui.typing = el("div", "chat-msg chat-msg--assistant chat-typing", "Working on a reply…");
    ui.typing.setAttribute("aria-label", "A reply is being prepared");
    ui.log.appendChild(ui.typing);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function removeTyping() {
    if (ui.typing && ui.typing.parentNode) ui.typing.parentNode.removeChild(ui.typing);
    ui.typing = null;
  }

  // ---- submitting the request -------------------------------------------

  function setSubmitting(on) {
    const btn = $("submit-btn");
    if (btn) { btn.disabled = on; btn.textContent = on ? "Submitting…" : "Submit request"; }
  }

  async function submitRequest() {
    const issueEl = $("issue");
    const issueErr = $("issue-error");
    const issue = (issueEl ? issueEl.value : "").trim();
    if (issueErr) { issueErr.hidden = true; issueErr.textContent = ""; }
    if (issue.length < ISSUE_MIN || issue.length > ISSUE_MAX || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(issue)) {
      if (issueErr) { issueErr.textContent = "Please describe the problem in " + ISSUE_MIN + " to " + ISSUE_MAX + " characters."; issueErr.hidden = false; }
      if (issueEl) issueEl.focus();
      return;
    }
    const checked = form.querySelector('input[name="priority"]:checked');
    const priority = checked && PRIORITIES.indexOf(checked.value) >= 0 ? checked.value : "Medium";
    showFormMessage("");
    setSubmitting(true);
    const r = await api("POST", "/api/agent/tenant/submit", { issue, priority });
    setSubmitting(false);
    const d = r.data;
    if (r.status === 200 && d && RX_TICKET.test(d.ticket_id)) {
      const hasConv = RX_CONV.test(d.conversation_id) && RX_TOKEN.test(d.tenant_token);
      epoch++;
      session = { conversation_id: hasConv ? d.conversation_id : null, token: hasConv ? d.tenant_token : null, ticket_id: d.ticket_id, pending_run_id: RX_RUN.test(d.run_id) ? d.run_id : null, issue };
      saveSession();
      if (issueEl) { issueEl.value = ""; issueEl.dispatchEvent(new Event("input")); }
      showFormMessage("");
      buildChat();
      ui.log.textContent = "";
      notice("");
      showChat();
      addMessage("tenant", issue, new Date().toISOString());
      if (session.pending_run_id) { setBusy(true); showTyping(); pollRun(session.pending_run_id, epoch); }
      else chatNotStarted(d.chat_error);
      return;
    }
    if (r.status === 400) showFormMessage("Your request could not be submitted. Please check it and try again.", "error");
    else if (r.status === 429) showFormMessage("Too many requests were submitted just now. Please wait a minute and try again.", "warning");
    else if (r.status === 0) showFormMessage("Your request was not submitted. " + SERVER_DOWN, "error");
    else showFormMessage("Your request was not submitted. Please try again.", "error");
  }

  // The ticket exists, but the assistant did not start: say so plainly and offer a way forward.
  function chatNotStarted(reason) {
    setBusy(false);
    if (reason === "assistant_off") {
      notice("Your request is saved. The AI assistant is switched off in this demo, so there will be no automatic reply.", "warning");
      return;
    }
    noticeWithActions("Your request is saved, but the assistant could not start.", "warning", [{ label: "Try the assistant again", run: retryAssistant }]);
  }

  async function retryAssistant() {
    if (!session) return;
    notice("");
    setBusy(true);
    const mine = epoch;
    let r;
    if (session.conversation_id) {
      r = await api("POST", "/api/agent/tenant/resume", { conversation_id: session.conversation_id }, session.token);
    } else {
      // no conversation was created: open one for the saved ticket and send the request text as the first message
      const s = await api("POST", "/api/agent/tenant/start", { ticket_id: session.ticket_id });
      if (!(s.status === 200 && s.data && RX_CONV.test(s.data.conversation_id) && RX_TOKEN.test(s.data.tenant_token))) { retryFailed(s.status); return; }
      session.conversation_id = s.data.conversation_id; session.token = s.data.tenant_token; saveSession();
      r = await api("POST", "/api/agent/tenant/message", { conversation_id: session.conversation_id, text: session.issue || "Please help with my request." }, session.token);
    }
    if (mine !== epoch) return;
    if (r.status === 200 && r.data && RX_RUN.test(r.data.run_id)) {
      session.pending_run_id = r.data.run_id; saveSession();
      showTyping(); pollRun(r.data.run_id, mine);
      return;
    }
    retryFailed(r.status);
  }

  function retryFailed(status) {
    setBusy(false);
    if (status === 403 || status === 404) { expired(); return; }
    if (status === 409) { noticeWithActions("A reply is already being prepared. Please wait a few seconds and try again.", "warning", [{ label: "Try again", run: retryAssistant }]); return; }
    noticeWithActions(status === 0 ? SERVER_DOWN : "The assistant still could not start. Your request is saved.", "error", [{ label: "Try again", run: retryAssistant }]);
  }

  function submitAnother() {
    clearSession();
    if (ui.log) ui.log.textContent = "";
    notice("");
    showFormMessage("");
    showFormAgain();
    const issueEl = $("issue");
    if (issueEl) issueEl.focus();
  }

  function expired() {
    // The server no longer accepts this conversation or token (reset, data cleaned, or never valid): forget it safely.
    clearSession();
    if (ui.log) ui.log.textContent = "";
    showFormAgain();
    showFormMessage("Your earlier conversation is no longer available (it may have expired or been reset). You can submit a new request.", "warning");
  }

  // ---- restoring after a reload -----------------------------------------

  async function restore() {
    session = loadSession();
    if (!session) return;
    if (!session.conversation_id) {
      // the ticket was submitted but no conversation exists yet: show the chat with the recovery option
      buildChat(); showChat(); ui.log.textContent = "";
      if (session.issue) addMessage("tenant", session.issue, new Date().toISOString());
      chatNotStarted("conversation_not_started");
      return;
    }
    showFormMessage("Restoring your conversation…");
    const r = await api("GET", "/api/agent/tenant/conversation?id=" + encodeURIComponent(session.conversation_id), undefined, session.token);
    showFormMessage("");
    if (r.status === 200 && r.data && Array.isArray(r.data.messages)) {
      buildChat(); showChat();
      renderTranscript(r.data.messages);
      notice("");
      const msgs = r.data.messages;
      const lastIsTenant = msgs.length > 0 && msgs[msgs.length - 1].role === "tenant";
      if (session.pending_run_id) { setBusy(true); showTyping(); pollRun(session.pending_run_id, epoch); }
      else if (lastIsTenant) { chatNotStarted("reply_not_started"); }
    } else if (r.status === 403 || r.status === 404) {
      expired();
    } else {
      buildChat(); showChat();
      ui.log.textContent = "";
      noticeWithActions(SERVER_DOWN + " Your conversation is kept in this tab.", "error", [{ label: "Try again", run: () => { notice(""); restore(); } }]);
    }
  }

  // ---- sending and polling ----------------------------------------------

  async function sendMessage() {
    if (busy || !session || !session.conversation_id || !liveReady) return;
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
    else if (r.status === 0) notice("Your message was not sent. " + SERVER_DOWN, "error");
    else notice("The message could not be sent. Please try again.", "error");
  }

  function pollRun(runId, mine) {
    const started = Date.now();
    let failures = 0;
    let forbidden = 0;
    const tick = async () => {
      if (mine !== epoch || !session) return;
      const r = await api("GET", "/api/agent/tenant/result?conversation_id=" + encodeURIComponent(session.conversation_id) + "&run_id=" + encodeURIComponent(runId), undefined, session.token);
      if (mine !== epoch || !session) return;
      if (r.status === 200 && r.data && r.data.status === "running") {
        failures = 0; forbidden = 0;
        if (Date.now() - started > POLL_LIMIT_MS) { finishRun(null, "This is taking longer than expected. Your request is saved; you can try again in a moment.", true); return; }
        setTimeout(tick, POLL_MS); return;
      }
      if (r.status === 200 && r.data && r.data.status === "done" && typeof r.data.reply === "string") { finishRun(r.data.reply); return; }
      if (r.status === 200 && r.data && r.data.status === "failed") { runFailed(); return; }
      if (r.status === 403) {
        // While a reply is being written the server can briefly fail to find the conversation; only a refusal that
        // repeats means the session really is gone.
        forbidden++;
        if (forbidden >= 3) { expired(); return; }
        setTimeout(tick, 700); return;
      }
      forbidden = 0;
      if (r.status === 404) { await refreshTranscript(); return; }
      failures++;
      if (failures > POLL_NETWORK_RETRIES) { finishRun(null, "Lost the connection to the demo server. Reload the page to check for the reply.", true); return; }
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

  function runFailed() {
    removeTyping();
    if (session) { session.pending_run_id = null; saveSession(); }
    setBusy(false);
    noticeWithActions("A reply could not be prepared. Your request is saved.", "warning", [{ label: "Try again", run: retryAssistant }]);
  }

  async function refreshTranscript() {
    // the run record is gone (for example the store was cleaned): show what the server really has
    removeTyping();
    if (!session) return;
    const r = await api("GET", "/api/agent/tenant/conversation?id=" + encodeURIComponent(session.conversation_id), undefined, session.token);
    if (r.status === 200 && r.data && Array.isArray(r.data.messages)) {
      renderTranscript(r.data.messages);
      session.pending_run_id = null; saveSession();
      setBusy(false);
      const m = r.data.messages;
      if (m.length > 0 && m[m.length - 1].role === "tenant") chatNotStarted("reply_not_started");
    } else if (r.status === 403 || r.status === 404) expired();
    else finishRun(null, "Could not check for the reply. Reload the page to try again.", true);
  }

  // ---- start ------------------------------------------------------------

  // In demo mode a submitted request must never reach Make or Airtable. This runs before the portal's own submit handler.
  // While the demo server has not answered yet the submit is held; if there is no demo server the portal behaves as before.
  window.addEventListener("submit", (ev) => {
    if (ev.target !== form || mode === "none") return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (mode === "unknown") { showFormMessage("Checking the demo assistant. Please try again in a moment.", "warning"); return; }
    submitRequest();
  }, true);

  async function init() {
    const st = await api("GET", "/api/agent/status", undefined, undefined, 3000);
    if (st.status !== 200 || !st.data) { mode = "none"; return; } // not the local demo server: show nothing, change nothing
    mode = "local";
    liveReady = st.data.LiveReady === true && st.data.PromptHashesOk !== false;
    // demo property is fixed: hide the property picker and say where the request goes
    const prop = $("property");
    const field = prop && prop.closest(".field");
    if (field) {
      field.classList.add("demo-hidden");
      const text = "Demo: your request is saved only on this computer and the assistant helps with it. Property: 10 Harbor View."
        + (liveReady ? "" : " The AI assistant is switched off in this demo, so your request will be saved without an automatic reply.");
      field.parentNode.insertBefore(el("p", "hint demo-note", text), field);
    }
    await restore();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
