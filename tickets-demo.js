// Extra ticket details for demo mode (index.html?demo=1): emergency flag, AI handling
// status, internal notes, linked equipment, attachments, an editable Vendor Brief with a
// Copy button, and an edit form. It adds to the existing ticket dialog in app.js and keeps
// every change in this browser only. Nothing is sent anywhere; there is no AI in here yet.
(function () {
  "use strict";

  if (!new URLSearchParams(location.search).has("demo")) return;

  const dash = () => window.DashboardDemo;
  const sys = () => window.SystemsDemo;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function addRow(dl, term, valueNode, wide) {
    const dt = el("dt", wide ? "ticket-wide-label" : null, term);
    const dd = el("dd", wide ? "ticket-wide" : null);
    dd.appendChild(typeof valueNode === "string" ? document.createTextNode(valueNode) : valueNode);
    dl.append(dt, dd);
    return dd;
  }

  function emergencyBadge() { return el("span", "badge badge-emergency", "Emergency"); }

  // ---- Receipts and invoices (manager only) -------------------------------

  const store = () => window.ReceiptStore;

  function linkButton(text, label, onClick) {
    const b = el("button", "sys-link-btn", text);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }

  // One receipt line: file name, size and the buttons the caller supplies.
  function receiptLine(name, size, buttons, note) {
    const li = el("li", "receipt-line");
    li.appendChild(el("span", "receipt-name", name));
    li.appendChild(el("span", "receipt-size", store().formatSize(size || 0) + (note ? " · " + note : "")));
    const actions = el("span", "receipt-actions");
    buttons.forEach((b) => actions.appendChild(b));
    li.appendChild(actions);
    return li;
  }

  // View and Download for a saved receipt. Errors (for example a file that is no longer in this browser) show in statusEl.
  function savedReceiptButtons(ref, statusEl) {
    const guard = (promise) => promise.then(() => { statusEl.textContent = ""; }, (err) => { statusEl.textContent = err.message; });
    return [
      linkButton("View", "View " + ref.filename, () => guard(store().view(ref))),
      linkButton("Download", "Download " + ref.filename, () => guard(store().download(ref)))
    ];
  }

  function receiptsView(row) {
    const refs = (row.demo && row.demo.receipts) || [];
    const wrap = el("div");
    wrap.appendChild(el("div", "receipt-privacy", "Receipts and invoices are manager only. They are hidden from the tenant preview."));
    if (!refs.length) {
      wrap.appendChild(el("span", "sys-empty", "No receipts or invoices uploaded."));
      return wrap;
    }
    const status = el("p", "ticket-brief-status");
    status.setAttribute("role", "status");
    const list = el("ul", "receipt-list");
    refs.forEach((ref) => list.appendChild(receiptLine(ref.filename, ref.size, savedReceiptButtons(ref, status))));
    wrap.append(list, status);
    return wrap;
  }

  // ---- Copy to clipboard -------------------------------------------------

  async function copyText(textarea, statusEl) {
    const text = textarea.value;
    if (!text.trim()) { statusEl.textContent = "Nothing to copy yet."; return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        statusEl.textContent = "Copied to clipboard.";
        return;
      }
    } catch (err) { /* fall through to the older method */ }
    textarea.focus();
    textarea.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    statusEl.textContent = ok ? "Copied to clipboard." : "Couldn't copy automatically. The text is selected: press Ctrl+C (Cmd+C on a Mac).";
  }

  // ---- Detail view additions ---------------------------------------------

  function equipmentLinks(row) {
    const ids = (row.demo && row.demo.equipment_ids) || [];
    const wrap = el("div", "ticket-equipment");
    const known = ids.map((id) => ({ id, name: sys() ? sys().equipmentName(id) : "" })).filter((e) => e.name);
    if (!known.length) {
      wrap.appendChild(el("span", "sys-empty", "No equipment linked."));
      return wrap;
    }
    known.forEach((e) => {
      const b = el("button", "btn btn-secondary ticket-chip", e.name);
      b.type = "button";
      b.title = "Open this item and its history in Systems & Equipment";
      b.addEventListener("click", () => {
        dash().closeTicket();
        sys().openEquipment(e.id);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function attachmentsView(row) {
    const atts = (row.demo && row.demo.attachments) || [];
    if (!atts.length) return el("span", "sys-empty", "No attachments.");
    const grid = el("div", "sys-attach-grid");
    atts.forEach((a) => grid.appendChild(sys().attachmentNode(a)));
    return grid;
  }

  function vendorBriefBlock(dl, row) {
    const dd = addRow(dl, "Vendor Brief (editable; ready for a future AI-generated summary)", el("div"), true);
    const box = dd.firstChild;
    const ta = el("textarea", "ticket-brief");
    ta.rows = 6;
    ta.value = (row.demo && row.demo.vendor_brief) || "";
    ta.placeholder = "No brief yet. Write one here, or paste an AI-generated summary later.";
    ta.setAttribute("aria-label", "Vendor Brief");
    const actions = el("div", "ticket-brief-actions");
    const save = el("button", "btn btn-secondary", "Save brief");
    save.type = "button";
    const copy = el("button", "btn btn-ghost", "Copy brief");
    copy.type = "button";
    const status = el("span", "ticket-brief-status");
    status.setAttribute("role", "status");
    save.addEventListener("click", () => {
      const result = dash().updateTicket(row.id, { demo: { vendor_brief: ta.value } });
      status.textContent = result.ok ? (result.saved === false ? "Saved on screen only (browser storage is blocked or full)." : "Brief saved.") : result.error;
    });
    copy.addEventListener("click", () => copyText(ta, status));
    actions.append(save, copy, status);
    box.append(ta, actions);
  }

  function decorate(row, body, titleEl) {
    const demo = row.demo || {};
    document.getElementById("request-dialog").classList.add("dialog-wide"); // room for the longer demo details
    body.classList.add("demo-ticket"); // lets the demo layout stack labels above values on a phone
    if (demo.emergency_flag) titleEl.appendChild(emergencyBadge());

    addRow(body, "Emergency flag", demo.emergency_flag ? "Yes" : "No");
    addRow(body, "AI handling", demo.ai_handling_status || "Not Started");
    addRow(body, "Internal notes", demo.notes ? demo.notes : "-");
    addRow(body, "Repair date", demo.repair_date ? dash().formatDate(demo.repair_date) : "Not recorded");
    addRow(body, "Repair summary", demo.repair_summary ? demo.repair_summary : "Not recorded");
    addRow(body, "Receipts", receiptsView(row));
    addRow(body, "Linked equipment", equipmentLinks(row));
    addRow(body, "Attachments", attachmentsView(row));
    vendorBriefBlock(body, row);

    const actions = el("div", "ticket-edit-row");
    const edit = el("button", "btn btn-primary", "Edit ticket");
    edit.type = "button";
    edit.addEventListener("click", () => openEditForm(row, body, titleEl));
    actions.appendChild(edit);
    body.appendChild(actions);
  }

  // ---- Edit form ----------------------------------------------------------

  function openEditForm(row, body, titleEl) {
    const lists = dash().lists;
    const demo = row.demo || {};
    clear(body);
    titleEl.textContent = "Edit " + row.id + " · " + row.property;

    const form = el("form", "ticket-form");
    form.noValidate = true;
    const grid = el("div", "form-grid");
    const ctl = {};

    function field(key, text, kind, opts) {
      opts = opts || {};
      const wrap = el("label", "form-field" + (opts.wide ? " form-field-wide" : ""));
      wrap.appendChild(el("span", null, text));
      let input;
      if (kind === "select") {
        input = document.createElement("select");
        opts.options.forEach((o) => input.appendChild(new Option(o, o)));
      } else if (kind === "textarea") {
        input = document.createElement("textarea");
        input.rows = opts.rows || 3;
      } else {
        input = document.createElement("input");
        input.type = kind;
        if (kind === "number") { input.min = "0"; input.step = "0.01"; input.inputMode = "decimal"; }
        if (kind === "text") input.autocomplete = "off";
      }
      if (opts.value !== undefined && opts.value !== null) input.value = opts.value;
      ctl[key] = input;
      wrap.appendChild(input);
      grid.appendChild(wrap);
      return wrap;
    }

    field("category", "Category", "select", { options: lists.categories, value: row.category });
    field("priority", "Priority", "select", { options: lists.priorities, value: row.priority });
    field("status", "Status", "select", { options: lists.statuses, value: row.status });
    field("ai", "AI handling status (internal)", "select", { options: lists.aiStatuses, value: demo.ai_handling_status || "Not Started" });
    field("assigned", "Assigned to (servicing company)", "text", { value: row.assigned_to || "" });

    const emergencyWrap = el("label", "form-field sys-checkbox ticket-check");
    const emergency = document.createElement("input");
    emergency.type = "checkbox";
    emergency.checked = !!demo.emergency_flag;
    emergencyWrap.append(emergency, el("span", null, "Emergency flag (separate from priority)"));
    grid.appendChild(emergencyWrap);

    const resolvedWrap = field("resolved", "Date resolved", "date", { value: row.date_resolved || "" });
    field("cost", "Actual cost (optional)", "number", { value: row.cost === null ? "" : row.cost });
    const costDateWrap = field("costDate", "Cost date", "date", { value: row.cost_date || "" });

    // Repair details: the servicing company is "Assigned to" and the cost is the ticket's cost
    // above; the repair date, summary and receipts are stored on this ticket too.
    const repairHeading = el("div", "ticket-section-title form-field-wide", "Repair details and receipts");
    grid.appendChild(repairHeading);
    field("repairDate", "Repair date", "date", { value: demo.repair_date || "" });
    field("repairSummary", "Repair summary", "textarea", { value: demo.repair_summary || "", wide: true, rows: 3 });

    // Receipts are staged here and only written (or deleted) when the form is saved.
    const staged = { kept: (demo.receipts || []).map((r) => Object.assign({}, r)), adds: [], removed: [] };
    const rcptWrap = el("div", "form-field form-field-wide receipt-editor");
    rcptWrap.appendChild(el("span", null, "Receipts and invoices (PDF or images, manager only)"));
    const rcptList = el("ul", "receipt-list");
    const rcptStatus = el("p", "ticket-brief-status");
    rcptStatus.setAttribute("role", "status");
    const rcptInput = document.createElement("input");
    rcptInput.type = "file";
    rcptInput.multiple = true;
    rcptInput.accept = store().ACCEPT;
    rcptInput.setAttribute("aria-label", "Add receipts or invoices");
    const rcptHelp = el("span", "receipt-help", "Up to " + store().MAX_PER_TICKET + " files, " + (store().MAX_BYTES / 1048576) + " MB each. Saved in this browser only (demo).");
    rcptWrap.append(rcptList, rcptInput, rcptHelp, rcptStatus);
    grid.appendChild(rcptWrap);
    store().available().then((ok) => {
      if (!ok) { rcptInput.disabled = true; rcptStatus.textContent = "This browser can't store files right now (for example a private window), so receipts can't be added."; }
    });

    function drawReceipts() {
      clear(rcptList);
      if (!staged.kept.length && !staged.adds.length) rcptList.appendChild(el("li", "sys-empty", "No receipts or invoices yet."));
      staged.kept.forEach((ref, i) => {
        const buttons = savedReceiptButtons(ref, rcptStatus);
        buttons.push(linkButton("Remove", "Remove " + ref.filename, () => { staged.removed.push(staged.kept.splice(i, 1)[0]); drawReceipts(); }));
        rcptList.appendChild(receiptLine(ref.filename, ref.size, buttons));
      });
      staged.adds.forEach((file, i) => {
        const buttons = [
          linkButton("View", "View " + file.name, () => store().viewFile(file)),
          linkButton("Download", "Download " + file.name, () => store().downloadFile(file)),
          linkButton("Remove", "Remove " + file.name, () => { staged.adds.splice(i, 1); drawReceipts(); })
        ];
        rcptList.appendChild(receiptLine(file.name, file.size, buttons, "added, saved when you save the ticket"));
      });
    }
    rcptInput.addEventListener("change", () => {
      const problems = [];
      Array.prototype.forEach.call(rcptInput.files, (file) => {
        const bad = store().checkFile(file);
        if (bad) { problems.push(bad); return; }
        if (staged.kept.length + staged.adds.length >= store().MAX_PER_TICKET) { problems.push("A ticket can hold up to " + store().MAX_PER_TICKET + " receipts."); return; }
        staged.adds.push(file);
      });
      rcptInput.value = "";
      rcptStatus.textContent = problems.join(" ");
      drawReceipts();
    });
    drawReceipts();

    field("notes", "Internal notes", "textarea", { value: demo.notes || "", wide: true });

    // Equipment this ticket is about. History on each item is built from these links.
    const equipWrap = el("fieldset", "form-field form-field-wide ticket-equipment-picker");
    equipWrap.appendChild(el("legend", null, "Linked equipment (shows in that item's history)"));
    const linked = new Set(demo.equipment_ids || []);
    const checks = [];
    const items = sys() ? sys().getEquipment() : [];
    const byCat = {};
    items.forEach((e) => { (byCat[e.category] = byCat[e.category] || []).push(e); });
    Object.keys(byCat).forEach((cat) => {
      equipWrap.appendChild(el("div", "ticket-equipment-cat", cat));
      byCat[cat].forEach((e) => {
        const label = el("label", "ticket-equipment-option");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.value = e.id;
        box.checked = linked.has(e.id);
        checks.push(box);
        label.append(box, document.createTextNode(" " + sys().equipmentName(e.id)));
        equipWrap.appendChild(label);
      });
    });
    if (!items.length) equipWrap.appendChild(el("span", "sys-empty", "Equipment is still loading. Close this form and try again."));
    grid.appendChild(equipWrap);

    field("brief", "Vendor Brief", "textarea", { value: demo.vendor_brief || "", wide: true, rows: 5 });
    form.appendChild(grid);

    const error = el("p", "form-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    form.appendChild(error);

    const actions = el("div", "form-actions");
    const cancel = el("button", "btn btn-ghost", "Cancel");
    cancel.type = "button";
    const save = el("button", "btn btn-primary", "Save changes");
    save.type = "submit";
    actions.append(cancel, save);
    form.appendChild(actions);
    body.appendChild(form);

    function showAgain() { dash().openTicket(row.id); }
    cancel.addEventListener("click", showAgain);

    function syncConditional() {
      const closed = lists.closedStatuses.indexOf(ctl.status.value) !== -1;
      resolvedWrap.hidden = !closed;
      if (closed && !ctl.resolved.value) ctl.resolved.value = dash().asOfDate();
      if (!closed) ctl.resolved.value = "";
      const hasCost = ctl.cost.value !== "";
      costDateWrap.hidden = !hasCost;
      if (hasCost && !ctl.costDate.value) ctl.costDate.value = ctl.resolved.value || dash().asOfDate();
      if (!hasCost) ctl.costDate.value = "";
    }
    ctl.status.addEventListener("change", syncConditional);
    ctl.cost.addEventListener("input", syncConditional);
    syncConditional();

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      error.hidden = true;
      save.disabled = true;
      const costValue = ctl.cost.value.trim();
      const fail = (text) => { error.textContent = text; error.hidden = false; save.disabled = false; };

      // 1) store the newly added files; if one fails, undo the ones already stored
      const added = [];
      try {
        for (const file of staged.adds) added.push(await store().save(file));
      } catch (err) {
        await Promise.all(added.map((r) => store().remove(r).catch(() => {})));
        fail("Couldn't save the receipts: " + err.message);
        return;
      }

      // 2) save the ticket (same validation as every other source); if it is refused, undo the stored files
      const result = dash().updateTicket(row.id, {
        fields: {
          category: ctl.category.value, priority: ctl.priority.value, status: ctl.status.value,
          assigned_to: ctl.assigned.value.trim(), date_resolved: ctl.resolved.value,
          cost: costValue === "" ? null : Number(costValue), cost_date: costValue === "" ? "" : ctl.costDate.value
        },
        demo: {
          emergency_flag: emergency.checked, ai_handling_status: ctl.ai.value, notes: ctl.notes.value.trim(),
          repair_date: ctl.repairDate.value, repair_summary: ctl.repairSummary.value.trim(),
          receipts: staged.kept.concat(added),
          equipment_ids: checks.filter((c) => c.checked).map((c) => c.value), vendor_brief: ctl.brief.value
        }
      });
      if (!result.ok) {
        await Promise.all(added.map((r) => store().remove(r).catch(() => {})));
        fail(result.error);
        return;
      }

      // 3) the ticket no longer points at the removed receipts, so their files can go
      await Promise.all(staged.removed.map((r) => store().remove(r).catch(() => {})));
      showAgain();
    });
    ctl.category.focus();
  }

  // "Reset demo ticket edits" also deletes the receipt files stored in this browser.
  if (dash() && dash().onReset) dash().onReset(() => (store() ? store().clearAll() : null));

  window.TicketsDemo = { decorate };
})();
