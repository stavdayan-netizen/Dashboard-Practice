// Change proposals from the AI assistant, for the property manager, in the demo dashboard (?demo=1). DEMO ONLY.
// READ ONLY: this lists what the assistant proposed for each ticket (compared with the ticket's current values), why, the history, and
// a warning when the proposal claims instructions that the tenant reply did not contain. It cannot approve, reject or apply anything;
// that comes in the next stage. Nothing here changes a ticket.
//
// It uses the local manager route of serve.ps1. There is NO sign-in in the demo: that route works only because the server listens on
// localhost. Real use needs proper authentication and authorization (see agent/STAGE6_PLAN.md).
// Server text is shown with textContent only. Costs, token counts, prompts, tool results and keys are never displayed.
(function () {
  "use strict";

  if (!/[?&]demo(=|&|$)/.test(location.search)) return;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;

  const RX_TICKET = /^(DEMO|HV)-\d{1,3}$/;
  const POLL_MS = 15000;
  const FETCH_TIMEOUT_MS = 8000;

  let pending = [];                 // pending proposals from the last poll
  let seenEmergency = new Set();    // emergency proposal ids the manager has been told about (this page load only)
  let bannerDismissedFor = "";      // the set of emergency ids the manager dismissed the banner for
  let panelOpen = false;
  let filter = "pending";
  let lastKey = "";
  const ui = {};

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

  const stamp = (ts) => {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const isEmergency = (p) => !!p && !!p.proposed_fields && (p.proposed_fields.ai_urgency === "Emergency" || p.proposed_fields.emergency_flag === true);

  function sortProposals(list) {
    return list.slice().sort((a, b) => {
      const ea = isEmergency(a) ? 0 : 1, eb = isEmergency(b) ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return String(b.created_at).localeCompare(String(a.created_at));
    });
  }

  // ---- how a proposal compares with the ticket as it is now ----------------

  const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : String(v));

  function currentValue(row, field) {
    if (!row) return "(this ticket is not in the dashboard)";
    const demo = row.demo || {};
    switch (field) {
      case "ai_urgency": return "(not stored on the ticket)";
      case "emergency_flag": return demo.emergency_flag ? "Yes" : "No";
      case "ai_handling_status": return demo.ai_handling_status || "Not Started";
      case "category": return row.category || "-";
      case "status": return row.status || "-";
      case "summary": return row.ai_summary || "-";
      case "notes": return demo.notes || "-";
      case "equipment_ids": return (demo.equipment_ids || []).join(", ") || "none";
      default: return "-";
    }
  }

  function proposedText(field, value) {
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "boolean") return yesNo(value);
    return String(value);
  }

  const FIELD_LABELS = [
    ["ai_urgency", "Urgency (the assistant's assessment)"], ["emergency_flag", "Emergency flag"], ["ai_handling_status", "AI handling status"],
    ["category", "Category"], ["status", "Status"], ["summary", "AI summary"], ["notes", "Notes to add"], ["equipment_ids", "Linked equipment"]
  ];

  function fieldTable(p, row) {
    const table = el("table", "agent-pp-table");
    const head = el("tr");
    ["Field", "Now", "Proposed"].forEach((h) => head.appendChild(el("th", null, h)));
    table.appendChild(head);
    FIELD_LABELS.forEach((f) => {
      if (!p.proposed_fields || p.proposed_fields[f[0]] === undefined) return;
      const tr = el("tr");
      tr.appendChild(el("td", "agent-pp-field", f[1]));
      const now = currentValue(row, f[0]);
      const proposed = proposedText(f[0], p.proposed_fields[f[0]]);
      tr.appendChild(el("td", "agent-pp-now", now));
      const td = el("td", "agent-pp-new", proposed);
      if (row && f[0] !== "ai_urgency" && f[0] !== "notes" && now === proposed) td.appendChild(el("span", "agent-pp-same", " (no change)"));
      tr.appendChild(td);
      table.appendChild(tr);
    });
    return table;
  }

  // ---- one proposal card ---------------------------------------------------

  function replyCheckBlock(p) {
    const rc = p.reply_check;
    if (!rc) return el("p", "agent-pp-muted", "No reply check was recorded for this proposal.");
    const missing = Array.isArray(rc.claimed_but_not_delivered) ? rc.claimed_but_not_delivered : [];
    const delivered = Array.isArray(rc.delivered_in_reply) ? rc.delivered_in_reply : [];
    const box = el("div", "agent-pp-check" + (missing.length ? " agent-pp-check--warn" : ""));
    if (missing.length) {
      box.appendChild(el("strong", null, "Check before relying on this proposal"));
      box.appendChild(el("div", null, "The proposal text says the tenant was given these instructions, but the reply the tenant actually received did not contain them: " + missing.join(", ").replace(/_/g, " ") + "."));
    } else {
      box.appendChild(el("div", null, "Reply check: nothing in the proposal text goes beyond what the tenant reply said."));
    }
    // the list of basic safety instructions only matters for an emergency, or when the proposal made a claim about them
    if (delivered.length || missing.length || isEmergency(p)) {
      box.appendChild(el("div", "agent-pp-muted", "The tenant reply (" + (rc.reply_source === "failsafe" ? "the fixed safety message" : "the assistant's message") + ") contained: " + (delivered.length ? delivered.join(", ").replace(/_/g, " ") : "none of the basic safety instructions") + "."));
    }
    return box;
  }

  function card(p) {
    const row = RX_TICKET.test(p.ticket_id) && window.DashboardDemo ? window.DashboardDemo.getRow(p.ticket_id) : null;
    const wrap = el("article", "agent-pp-card" + (isEmergency(p) ? " agent-pp-card--emergency" : ""));
    const head = el("div", "agent-pp-card-head");
    if (isEmergency(p)) head.appendChild(el("span", "agent-pp-badge agent-pp-badge--emergency", "Emergency"));
    head.appendChild(el("span", "agent-pp-badge", p.status));
    const open = el("button", "btn btn-ghost agent-pp-ticket", p.ticket_id + (row ? " – " + String(row.issue).slice(0, 70) : ""));
    open.type = "button";
    open.title = "Open the ticket and its AI conversation";
    open.addEventListener("click", () => { closePanel(); if (window.DashboardDemo) window.DashboardDemo.openTicket(p.ticket_id); });
    head.appendChild(open);
    head.appendChild(el("span", "agent-pp-muted", stamp(p.created_at)));
    wrap.appendChild(head);

    wrap.appendChild(replyCheckBlock(p));
    wrap.appendChild(fieldTable(p, row));
    if (p.proposed_fields && p.proposed_fields.status === "Resolved") {
      wrap.appendChild(el("p", "agent-pp-muted", "Tenant confirmed it is fixed: " + yesNo(p.tenant_confirmed_resolution === true)));
    }
    wrap.appendChild(el("p", "agent-pp-reason", "Why: " + String(p.reason)));
    const earlier = Array.isArray(p.earlier_reasons) ? p.earlier_reasons : [];
    if (earlier.length) {
      const d = el("details", "agent-pp-details");
      d.appendChild(el("summary", null, "Earlier reasons (" + earlier.length + ")"));
      earlier.forEach((r) => d.appendChild(el("div", null, String(r))));
      wrap.appendChild(d);
    }
    const hist = Array.isArray(p.history) ? p.history : [];
    if (hist.length) {
      const d = el("details", "agent-pp-details");
      d.appendChild(el("summary", null, "History (" + hist.length + ")"));
      hist.forEach((h) => {
        let line = stamp(h.ts) + " · " + h.event + " by " + h.by;
        if (Array.isArray(h.added_fields) && h.added_fields.length) line += " (added: " + h.added_fields.join(", ") + ")";
        if (Array.isArray(h.claimed_but_not_delivered) && h.claimed_but_not_delivered.length) line += " (not delivered: " + h.claimed_but_not_delivered.join(", ") + ")";
        d.appendChild(el("div", null, line));
      });
      wrap.appendChild(d);
    }
    if (p.decision_note) wrap.appendChild(el("p", "agent-pp-muted", "Manager note: " + String(p.decision_note)));
    return wrap;
  }

  // ---- panel, button, banner ----------------------------------------------

  function buildUi() {
    const actions = document.querySelector(".header-actions");
    const anchor = document.getElementById("new-request-btn");
    ui.btn = el("button", "btn btn-secondary agent-pp-btn", "Proposals");
    ui.btn.type = "button";
    ui.btn.setAttribute("aria-haspopup", "dialog");
    ui.count = el("span", "agent-pp-count");
    ui.count.hidden = true;
    ui.btn.appendChild(ui.count);
    if (actions && anchor) actions.insertBefore(ui.btn, anchor); else if (actions) actions.appendChild(ui.btn); else return false;

    ui.banner = el("div", "agent-pp-banner");
    ui.banner.setAttribute("role", "alert");
    ui.banner.hidden = true;
    const main = document.getElementById("main-content");
    if (main) main.insertBefore(ui.banner, main.firstChild);

    ui.overlay = el("div", "agent-pp-overlay");
    ui.overlay.hidden = true;
    const box = el("div", "agent-pp-box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "agent-pp-title");
    const head = el("div", "agent-pp-head");
    const title = el("h2", "agent-pp-title", "Change proposals from the assistant");
    title.id = "agent-pp-title";
    ui.close = el("button", "dialog-close", "×");
    ui.close.type = "button";
    ui.close.setAttribute("aria-label", "Close");
    head.appendChild(title);
    head.appendChild(ui.close);
    box.appendChild(head);
    box.appendChild(el("p", "agent-pp-muted", "Read only. These are suggestions from the assistant; nothing changes on a ticket. Approving, rejecting and applying come in the next stage."));
    const bar = el("div", "agent-pp-bar");
    ui.filter = el("select");
    ui.filter.setAttribute("aria-label", "Show proposals");
    [["pending", "Pending"], ["", "All (history)"]].forEach((o) => ui.filter.appendChild(new Option(o[1], o[0])));
    ui.refresh = el("button", "btn btn-ghost", "Refresh");
    ui.refresh.type = "button";
    bar.appendChild(ui.filter);
    bar.appendChild(ui.refresh);
    box.appendChild(bar);
    ui.list = el("div", "agent-pp-list");
    box.appendChild(ui.list);
    ui.overlay.appendChild(box);
    document.body.appendChild(ui.overlay);

    ui.btn.addEventListener("click", openPanel);
    ui.close.addEventListener("click", closePanel);
    ui.overlay.addEventListener("click", (ev) => { if (ev.target === ui.overlay) closePanel(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && panelOpen) { ev.stopPropagation(); closePanel(); } }, true);
    ui.filter.addEventListener("change", () => { filter = ui.filter.value; renderPanel(true); });
    ui.refresh.addEventListener("click", () => renderPanel(true));
    return true;
  }

  async function openPanel() {
    panelOpen = true;
    ui.overlay.hidden = false;
    ui.close.focus();
    // tickets submitted since the dashboard loaded must be in the table, so each proposal can be compared with its ticket
    try { if (window.DashboardDemo && window.DashboardDemo.refreshPortalTickets) await window.DashboardDemo.refreshPortalTickets(); } catch (err) { /* the comparison then says the ticket is not in the dashboard */ }
    renderPanel(true);
  }

  function closePanel() {
    panelOpen = false;
    ui.overlay.hidden = true;
    ui.btn.focus();
  }

  async function renderPanel(force) {
    if (!panelOpen) return;
    const r = await getJson("/api/agent/manager/proposals" + (filter ? "?status=" + encodeURIComponent(filter) : ""));
    if (!panelOpen) return;
    if (!(r.status === 200 && r.data && Array.isArray(r.data.proposals))) {
      ui.list.textContent = "";
      ui.list.appendChild(el("p", "agent-pp-empty", r.status === 0 ? "The local demo server is not reachable. Start it and press Refresh." : "The proposals could not be loaded. Press Refresh to try again."));
      lastKey = "";
      return;
    }
    const items = sortProposals(r.data.proposals);
    const key = filter + JSON.stringify(items.map((p) => [p.id, p.status, (p.history || []).length]));
    if (key === lastKey && !force) return;
    lastKey = key;
    ui.list.textContent = "";
    if (!items.length) ui.list.appendChild(el("p", "agent-pp-empty", filter ? "No pending proposals." : "No proposals yet."));
    items.forEach((p) => ui.list.appendChild(card(p)));
  }

  function showBanner(emergencies) {
    const ids = emergencies.map((p) => p.ticket_id);
    const key = ids.join(",");
    if (!ids.length || key === bannerDismissedFor) { ui.banner.hidden = true; return; }
    ui.banner.textContent = "";
    ui.banner.appendChild(el("strong", null, ids.length === 1 ? "An emergency proposal is waiting for review: " : "Emergency proposals are waiting for review: "));
    ui.banner.appendChild(document.createTextNode(ids.join(", ") + " "));
    const review = el("button", "btn btn-secondary", "Review");
    review.type = "button";
    review.addEventListener("click", () => { bannerDismissedFor = key; ui.banner.hidden = true; openPanel(); });
    const dismiss = el("button", "btn btn-ghost", "Dismiss");
    dismiss.type = "button";
    dismiss.addEventListener("click", () => { bannerDismissedFor = key; ui.banner.hidden = true; });
    ui.banner.appendChild(review);
    ui.banner.appendChild(dismiss);
    ui.banner.hidden = false;
  }

  async function poll() {
    const r = await getJson("/api/agent/manager/proposals?status=pending");
    if (!(r.status === 200 && r.data && Array.isArray(r.data.proposals))) return;
    pending = r.data.proposals;
    const n = pending.length;
    const emergencies = pending.filter(isEmergency);
    ui.count.textContent = String(n);
    ui.count.hidden = n === 0;
    ui.count.classList.toggle("agent-pp-count--emergency", emergencies.length > 0);
    ui.btn.setAttribute("aria-label", "Proposals" + (n ? ", " + n + " pending" + (emergencies.length ? ", " + emergencies.length + " emergency" : "") : ""));
    emergencies.forEach((p) => seenEmergency.add(p.id));
    showBanner(emergencies);
    if (panelOpen) renderPanel(false);
  }

  async function start() {
    const st = await getJson("/api/agent/status");
    if (st.status !== 200) return;
    if (!buildUi()) return;
    await poll();
    setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  }

  if (window.DashboardDemo && window.DashboardDemo.ready) window.DashboardDemo.ready.then(start, () => {});
  else start();
})();
