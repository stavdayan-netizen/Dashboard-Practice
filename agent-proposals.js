// Change proposals from the AI assistant, for the property manager, in the demo dashboard (?demo=1). DEMO ONLY.
// It lists what the assistant proposed for each ticket (compared with the ticket's current values), why, the history, and a warning when
// the proposal claims instructions that the tenant reply did not contain. The manager can approve or reject a pending proposal (this changes
// NOTHING on the ticket) and, as a separate explicit step, apply an approved proposal to the demo ticket in this browser: the manager sees
// exactly what will change (and any ticket edit made since the proposal was written) before confirming. Nothing is ever applied automatically.
//
// It uses the local manager routes of serve.ps1. There is NO sign-in in the demo: that route works only because the server listens on
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

  async function postJson(path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal, cache: "no-store" });
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

  // ---- what applying a proposal would change in the demo ticket ---------------

  const RX_EQUIP = /^eq-hv-[a-z0-9]+(-[a-z0-9]+)*$/;
  const sameValue = (a, b) => (Array.isArray(a) || Array.isArray(b))
    ? JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort())
    : String(a) === String(b);

  function currentTyped(row, key) {
    const demo = row.demo || {};
    switch (key) {
      case "category": return row.category;
      case "status": return row.status;
      case "summary": return row.ai_summary || "";
      case "notes": return demo.notes || "";
      case "emergency_flag": return !!demo.emergency_flag;
      case "ai_handling_status": return demo.ai_handling_status || "Not Started";
      case "equipment_ids": return (demo.equipment_ids || []).slice();
      default: return undefined;
    }
  }

  const showTyped = (v) => (Array.isArray(v) ? (v.join(", ") || "none") : typeof v === "boolean" ? (v ? "Yes" : "No") : (String(v) || "-"));

  // The priority is never touched (the assistant cannot propose it). Notes are added to the existing notes, never replaced. Resolved is
  // applied only when the tenant confirmed it. Returns the list of changes and the patch for DashboardDemo.updateTicket.
  function computeChanges(p, row) {
    const f = p.proposed_fields || {};
    const based = p.based_on || {};
    const lists = window.DashboardDemo.lists;
    const changes = [];
    const patch = { fields: {}, demo: {} };
    const add = (key, label, after, already, apply, extra) => {
      const now = currentTyped(row, key);
      const b = based[key];
      const conflict = !already && b !== undefined && !sameValue(b, now);
      changes.push(Object.assign({ key, label, now: showTyped(now), after: showTyped(after), already, conflict }, extra || {}));
      if (!already && apply) apply();
    };
    if (typeof f.category === "string" && lists.categories.indexOf(f.category) >= 0) {
      add("category", "Category", f.category, row.category === f.category, () => { patch.fields.category = f.category; });
    }
    if (f.emergency_flag !== undefined || f.ai_urgency === "Emergency") {
      const want = f.ai_urgency === "Emergency" ? true : f.emergency_flag === true;
      add("emergency_flag", "Emergency flag", want, !!(row.demo || {}).emergency_flag === want, () => { patch.demo.emergency_flag = want; });
    }
    if (typeof f.ai_handling_status === "string" && lists.aiStatuses.indexOf(f.ai_handling_status) >= 0) {
      add("ai_handling_status", "AI handling status", f.ai_handling_status, currentTyped(row, "ai_handling_status") === f.ai_handling_status, () => { patch.demo.ai_handling_status = f.ai_handling_status; });
    }
    if (typeof f.notes === "string" && f.notes.trim()) {
      const existing = currentTyped(row, "notes");
      const merged = existing ? existing + "\n\n" + f.notes : f.notes;
      add("notes", "Notes (added to the existing notes)", f.notes, existing.indexOf(f.notes) >= 0, () => { patch.demo.notes = merged; }, { addOnly: true });
    }
    if (Array.isArray(f.equipment_ids)) {
      const have = currentTyped(row, "equipment_ids");
      const ids = f.equipment_ids.filter((x) => typeof x === "string" && RX_EQUIP.test(x));
      const union = have.concat(ids.filter((x) => have.indexOf(x) < 0));
      add("equipment_ids", "Linked equipment (added to the existing links)", ids, ids.every((x) => have.indexOf(x) >= 0), () => { patch.demo.equipment_ids = union; }, { addOnly: true });
    }
    if (typeof f.summary === "string" && f.summary.trim()) {
      add("summary", "AI summary (also shown as the short issue label in the ticket table)", f.summary, (row.ai_summary || "") === f.summary, () => { patch.fields.ai_summary = f.summary; patch.demo.summary_approved = true; });
    }
    if (f.status === "Resolved") {
      const closed = lists.closedStatuses.indexOf(row.status) >= 0;
      if (p.tenant_confirmed_resolution !== true) {
        changes.push({ key: "status", label: "Status", now: row.status, after: "Resolved", already: false, conflict: false, blocked: "Not applied: the tenant did not confirm that it is fixed." });
      } else {
        add("status", "Status", "Resolved", closed, () => { patch.fields.status = "Resolved"; patch.fields.date_resolved = window.DashboardDemo.asOfDate(); });
      }
    }
    return { changes, patch };
  }

  // ---- approve, reject, apply -------------------------------------------------

  function say(box, text, kind) {
    box.textContent = text;
    box.className = "agent-pp-msg" + (kind ? " agent-pp-msg--" + kind : "");
    box.hidden = !text;
  }

  async function decide(p, decision, note, msgBox, buttons) {
    buttons.forEach((b) => { b.disabled = true; });
    const body = { proposal_id: p.id, decision };
    if (note) body.note = note;
    const r = await postJson("/api/agent/manager/proposals/decide", body);
    if (r.status === 200) { await refreshAll(); return; }
    if (r.status === 409) { await refreshAll(); notice("This proposal was already decided. Its current state is shown below.", "warn"); return; }
    if (r.status === 400) {
      buttons.forEach((b) => { b.disabled = false; });
      say(msgBox, "The note could not be saved. Keep it under 500 characters and try again.", "warn");
      return;
    }
    // No confirmation from the server (it did not answer, or it failed): the decision may or may not have been saved, so never
    // claim either. Look at the real state; if the server cannot be reached, say so and leave the buttons for a retry.
    const fresh = await getJson("/api/agent/manager/proposals" + (filter ? "?status=" + encodeURIComponent(filter) : ""));
    if (fresh.status === 200) {
      await refreshAll();
      notice("The server did not confirm the decision. The list below shows the proposal's current state; decide again only if it is still pending.", "warn");
    } else {
      buttons.forEach((b) => { b.disabled = false; });
      say(msgBox, "The local demo server did not answer, so the decision may not have been saved. Start it and press Refresh to check before deciding again.", "error");
    }
  }

  function notice(text, kind) {
    ui.notice.textContent = text;
    ui.notice.className = "agent-pp-msg" + (kind ? " agent-pp-msg--" + kind : "");
    ui.notice.hidden = !text;
  }

  async function refreshAll() {
    lastKey = "";
    await poll();
    await renderPanel(true);
  }

  function applyView(p, row, host, initial) {
    host.textContent = "";
    const { changes, patch } = computeChanges(p, row);
    const work = changes.filter((c) => !c.already && !c.blocked);
    const conflicts = work.filter((c) => c.conflict);
    host.appendChild(el("p", "agent-pp-strong", work.length ? "These changes will be made to the ticket in this browser:" : "Nothing is left to change on the ticket; the proposal can just be marked as applied."));
    changes.forEach((c) => {
      const line = el("div", "agent-pp-change" + (c.conflict ? " agent-pp-change--warn" : ""));
      line.appendChild(el("strong", null, c.label + ": "));
      if (c.blocked) line.appendChild(document.createTextNode(c.blocked));
      else if (c.already) line.appendChild(document.createTextNode("already in place, nothing to do (" + c.after + ")"));
      else line.appendChild(document.createTextNode((c.addOnly ? "add " : "") + c.after + (c.addOnly ? "" : "   (now: " + c.now + ")")));
      if (c.conflict) line.appendChild(el("div", null, "This was changed after the assistant wrote the proposal. Check it before applying."));
      host.appendChild(line);
    });
    host.appendChild(el("p", "agent-pp-muted", "The priority is never changed. The ticket is changed only in this browser (demo)."));
    const msg = el("div", "agent-pp-msg"); msg.hidden = true;
    const go = el("button", "btn btn-primary", !work.length ? "Mark as applied" : conflicts.length ? "Apply anyway" : "Apply to the ticket");
    go.type = "button";
    const cancel = el("button", "btn btn-ghost", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => { host.textContent = ""; host.hidden = true; });
    go.addEventListener("click", async () => {
      go.disabled = true; cancel.disabled = true;
      if (work.length) {
        const res = window.DashboardDemo.updateTicket(p.ticket_id, patch);
        if (!res.ok) { say(msg, "The ticket was not changed: " + res.error, "error"); go.disabled = false; cancel.disabled = false; return; }
      }
      const r = await postJson("/api/agent/manager/proposals/applied", { proposal_id: p.id });
      if (r.status === 200) { await refreshAll(); return; }
      if (r.status === 409) { await refreshAll(); notice("The server no longer has this proposal as approved (it may already be marked as applied). Its current state is shown below.", "warn"); return; }
      // The server did not confirm. The ticket may already have been changed in this browser: show the view again, worked out from the
      // ticket as it is now, so the changes are not made twice and only the marking is left to do.
      applyView(p, row, host, { text: work.length ? "The ticket was changed in this browser, but the server did not confirm that the proposal is applied. Press the button to try again; the ticket will not be changed twice." : "The server did not confirm that the proposal is applied. Try again.", kind: "error" });
    });
    const bar = el("div", "agent-pp-actions");
    bar.appendChild(go); bar.appendChild(cancel);
    host.appendChild(bar);
    host.appendChild(msg);
    if (initial) say(msg, initial.text, initial.kind);
    host.hidden = false;
  }

  function actionsFor(p, row) {
    const box = el("div", "agent-pp-decide");
    const msg = el("div", "agent-pp-msg"); msg.hidden = true;
    if (p.status === "pending") {
      const note = el("input", "agent-pp-note");
      note.type = "text"; note.maxLength = 500; note.placeholder = "Note (optional)";
      note.setAttribute("aria-label", "Note for this decision");
      const approve = el("button", "btn btn-primary", "Approve");
      approve.type = "button";
      const reject = el("button", "btn btn-secondary", "Reject");
      reject.type = "button";
      const bar = el("div", "agent-pp-actions");
      bar.appendChild(approve); bar.appendChild(reject);
      box.appendChild(note); box.appendChild(bar);
      box.appendChild(el("p", "agent-pp-muted", "Approving or rejecting does not change the ticket."));
      approve.addEventListener("click", () => decide(p, "approve", note.value.trim(), msg, [approve, reject]));
      reject.addEventListener("click", () => decide(p, "reject", note.value.trim(), msg, [approve, reject]));
    } else if (p.status === "approved") {
      if (!row) {
        box.appendChild(el("p", "agent-pp-muted", "Approved. To apply it, the ticket must be in this dashboard (it is not in this browser's ticket list)."));
      } else {
        const host = el("div", "agent-pp-apply"); host.hidden = true;
        const open = el("button", "btn btn-primary", "Review and apply to the ticket\u2026");
        open.type = "button";
        open.addEventListener("click", () => applyView(p, row, host));
        box.appendChild(el("p", "agent-pp-muted", "Approved. Nothing has been changed on the ticket yet."));
        box.appendChild(open); box.appendChild(host);
      }
    }
    box.appendChild(msg);
    return box;
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
    if (p.origin === "server_emergency_fallback") head.appendChild(el("span", "agent-pp-badge agent-pp-badge--server", "Drafted by the server (emergency check)"));
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
    wrap.appendChild(actionsFor(p, row));
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
    box.appendChild(el("p", "agent-pp-muted", "These are suggestions from the assistant. Approving or rejecting does not change a ticket; applying an approved proposal is a separate step that shows you every change first."));
    const bar = el("div", "agent-pp-bar");
    ui.filter = el("select");
    ui.filter.setAttribute("aria-label", "Show proposals");
    [["pending", "Pending"], ["", "All (history)"]].forEach((o) => ui.filter.appendChild(new Option(o[1], o[0])));
    ui.refresh = el("button", "btn btn-ghost", "Refresh");
    ui.refresh.type = "button";
    bar.appendChild(ui.filter);
    bar.appendChild(ui.refresh);
    box.appendChild(bar);
    ui.notice = el("div", "agent-pp-msg");
    ui.notice.setAttribute("role", "status");
    ui.notice.hidden = true;
    box.appendChild(ui.notice);
    ui.list = el("div", "agent-pp-list");
    box.appendChild(ui.list);
    ui.overlay.appendChild(box);
    document.body.appendChild(ui.overlay);

    ui.btn.addEventListener("click", openPanel);
    ui.close.addEventListener("click", closePanel);
    ui.overlay.addEventListener("click", (ev) => { if (ev.target === ui.overlay) closePanel(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && panelOpen) { ev.stopPropagation(); closePanel(); } }, true);
    ui.filter.addEventListener("change", () => { filter = ui.filter.value; notice(""); renderPanel(true); });
    ui.refresh.addEventListener("click", () => { notice(""); renderPanel(true); });
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
    if (!(r.status === 200 && r.data && Array.isArray(r.data.proposals))) {
      // never show an old count as if it were current
      ui.count.textContent = "?"; ui.count.hidden = false;
      ui.btn.title = "The local demo server is not reachable; the pending count may be out of date.";
      return;
    }
    ui.btn.removeAttribute("title");
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
