// AI conversations for the property manager, inside the ticket details of the demo dashboard (?demo=1). DEMO ONLY.
// Read-only: it lists the conversations the assistant had about the open ticket, with timestamps, which messages came from the
// model or from the fixed fail-safe, what the assistant did behind the scenes (tools used, safety replacements), and how many
// proposals it drafted. Approving or rejecting proposals is a later stage; nothing here can change a ticket.
//
// It uses the local manager routes of serve.ps1. There is NO sign-in in the demo: those routes work only because the server
// listens on localhost. Real use needs proper authentication and authorization (see agent/STAGE6_PLAN.md).
// Server text is shown with textContent only. Costs, token counts, prompts, tool results and keys are never displayed.
(function () {
  "use strict";

  if (!/[?&]demo(=|&|$)/.test(location.search)) return;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;

  const RX_TICKET = /^(DEMO|HV)-\d{1,3}$/;
  const POLL_MS = 10000;
  const FETCH_TIMEOUT_MS = 8000;
  const PORTAL_POLL_MS = 20000;
  let available = null; // null = not checked yet, true / false once the demo server answered or not

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  async function getJson(path) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(path, { signal: ctl.signal, cache: "no-store" });
      let data = null;
      try { data = await res.json(); } catch (err) { data = null; }
      return { status: res.status, data };
    } catch (err) {
      return { status: 0, data: null };
    } finally {
      clearTimeout(timer);
    }
  }

  function stamp(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // What the assistant did behind the scenes, from the trace. Only names and outcomes: no inputs, no results, no costs.
  function summarizeTrace(trace) {
    const tools = {};
    const notes = [];
    (Array.isArray(trace) ? trace : []).forEach((t) => {
      if (!t) return;
      if (typeof t.tool === "string") {
        const key = t.tool + (t.ok ? "" : " (refused" + (t.error_code ? ": " + t.error_code : "") + ")");
        tools[key] = (tools[key] || 0) + 1;
      } else if (t.event === "failsafe_reply") {
        const kinds = Array.isArray(t.kinds) && t.kinds.length ? " for " + t.kinds.join(", ") : "";
        const guards = Array.isArray(t.guards) && t.guards.length ? " (guard: " + t.guards.join(", ") + ")" : "";
        notes.push("Fixed safety or fail-safe message used" + kinds + ": " + (t.reason || "model path failed") + guards);
      } else if (t.event === "emergency_proposal_fallback") {
        notes.push("The server drafted the emergency proposal because the assistant had not (emergency check" + (Array.isArray(t.kinds) && t.kinds.length ? ": " + t.kinds.join(", ") : "") + ")");
      } else if (t.event === "model_call_failed") {
        notes.push("A model call failed: " + (t.code || "unknown") + " (" + (t.attempts || 1) + " attempt(s))");
      } else if (t.event === "turn_error" || t.event === "reply_check_error") {
        notes.push("Internal error recorded (" + t.event + ")");
      }
    });
    const toolList = Object.keys(tools).map((k) => k + (tools[k] > 1 ? " x" + tools[k] : ""));
    return { toolList, notes };
  }

  function sourceBadge(source) {
    if (source === "failsafe") return el("span", "agent-badge agent-badge--failsafe", "fixed safety message");
    return null;
  }

  function renderConversation(conv, open) {
    const det = el("details", "agent-conv");
    if (open) det.open = true;
    const messages = Array.isArray(conv.messages) ? conv.messages : [];
    const proposals = Array.isArray(conv.proposals) ? conv.proposals : [];
    const sum = el("summary");
    sum.appendChild(el("span", "agent-conv-title", "Started " + stamp(conv.created_at)));
    sum.appendChild(el("span", "agent-conv-meta", " · " + messages.length + " message" + (messages.length === 1 ? "" : "s")
      + (conv.origin === "submitted_ticket" ? " · began with the submitted request" : "")));
    det.appendChild(sum);

    const log = el("div", "agent-log");
    log.tabIndex = 0;
    messages.forEach((m) => {
      const isTenant = m.role === "tenant";
      const box = el("div", "agent-msg " + (isTenant ? "agent-msg--tenant" : "agent-msg--assistant"));
      const who = el("div", "agent-msg-who");
      who.appendChild(el("span", null, isTenant ? "Tenant" : "Assistant"));
      const badge = isTenant ? null : sourceBadge(m.source);
      if (badge) { who.appendChild(document.createTextNode(" ")); who.appendChild(badge); }
      who.appendChild(el("span", "agent-time", " · " + stamp(m.ts)));
      box.appendChild(who);
      box.appendChild(el("div", "agent-msg-text", String(m.text)));
      log.appendChild(box);
    });
    if (!messages.length) log.appendChild(el("p", "agent-empty", "No messages yet."));
    det.appendChild(log);

    const t = summarizeTrace(conv.trace);
    const facts = el("div", "agent-facts");
    facts.appendChild(el("div", null, "Tools the assistant used: " + (t.toolList.length ? t.toolList.join(", ") : "none")));
    t.notes.forEach((n) => facts.appendChild(el("div", "agent-note", n)));
    const pending = proposals.filter((p) => p.status === "pending").length;
    facts.appendChild(el("div", null, "Drafted change proposals: " + proposals.length + (proposals.length ? " (" + pending + " pending; approvals come in the next stage)" : "")));
    if (conv.model) facts.appendChild(el("div", "agent-muted", "Model: " + conv.model));
    det.appendChild(facts);

    // newest message in view once the conversation is opened
    det.addEventListener("toggle", () => { if (det.open) log.scrollTop = log.scrollHeight; });
    if (open) setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
    return det;
  }

  function decorate(row, body) {
    if (!row || !RX_TICKET.test(row.id) || !body) return;
    const section = el("div", "agent-convs");
    section.setAttribute("aria-label", "AI conversations");
    const head = el("div", "agent-convs-head");
    head.appendChild(el("h3", "agent-convs-title", "AI conversations"));
    const refresh = el("button", "btn btn-ghost agent-refresh", "Refresh");
    refresh.type = "button";
    head.appendChild(refresh);
    section.appendChild(head);
    if (row.demo && row.demo.portal_submitted) section.appendChild(el("p", "agent-muted", "This ticket was submitted through the demo tenant portal."));
    const content = el("div", "agent-convs-body");
    section.appendChild(content);
    body.appendChild(section);

    let lastKey = null;
    const load = async (manual) => {
      if (!document.body.contains(section)) return false;
      const r = await getJson("/api/agent/manager/conversations?ticket_id=" + encodeURIComponent(row.id));
      if (!document.body.contains(section)) return false;
      if (r.status === 200 && r.data && Array.isArray(r.data.conversations)) {
        const convs = r.data.conversations.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        const key = JSON.stringify(convs.map((c) => [c.id, (c.messages || []).length, (c.trace || []).length, (c.proposals || []).length]));
        if (key === lastKey && !manual) return true; // nothing new: keep what the manager is reading (open sections, scroll position)
        lastKey = key;
        const openIds = new Set(Array.from(content.querySelectorAll("details[open]")).map((d) => d.dataset.id));
        content.textContent = "";
        if (!convs.length) content.appendChild(el("p", "agent-empty", "No AI conversation has been started for this ticket."));
        convs.slice().reverse().forEach((c, i) => {
          const node = renderConversation(c, openIds.has(c.id) || (i === 0 && openIds.size === 0));
          node.dataset.id = c.id;
          content.appendChild(node);
        });
      } else if (r.status === 404) {
        lastKey = null; content.textContent = "";
        content.appendChild(el("p", "agent-empty", "The assistant has no record of this ticket (it exists only in this browser), so there are no conversations."));
      } else {
        lastKey = null; content.textContent = "";
        content.appendChild(el("p", "agent-empty", r.status === 0 ? "The local demo server is not reachable, so the conversations cannot be loaded. Start it and press Refresh." : "The conversations could not be loaded. Press Refresh to try again."));
      }
      return true;
    };
    refresh.addEventListener("click", () => load(true));
    load(true).then(() => {
      const timer = setInterval(async () => {
        if (!document.body.contains(section) || document.getElementById("dialog-overlay") && document.getElementById("dialog-overlay").hidden) { clearInterval(timer); return; }
        if (document.hidden) return;
        await load(false);
      }, POLL_MS);
    });
  }

  // Requests submitted through the tenant portal after the dashboard was opened show up in the ticket list.
  async function checkServer() {
    const r = await getJson("/api/agent/status");
    available = r.status === 200;
    return available;
  }

  async function startPortalPolling() {
    if (!(await checkServer())) return;
    if (!window.DashboardDemo || !window.DashboardDemo.refreshPortalTickets) return;
    setInterval(() => { if (!document.hidden) window.DashboardDemo.refreshPortalTickets().catch(() => {}); }, PORTAL_POLL_MS);
  }

  window.AgentManagerDemo = { decorate };
  if (window.DashboardDemo && window.DashboardDemo.ready) window.DashboardDemo.ready.then(startPortalPolling, () => {});
  else startPortalPolling();
})();
