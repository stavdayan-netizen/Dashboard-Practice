// Systems & Equipment view. For now it only runs in demo mode (index.html?demo=1):
// it reads the fictional records in demo/ and keeps every edit in this browser's
// localStorage, so nothing is sent anywhere and no real data is touched.
//
// Production later: replace loadAll(), persist() and resolveAttachmentUrl() with
// calls to the backend. The record shapes already match the planned Airtable tables.
(function () {
  "use strict";

  if (!new URLSearchParams(location.search).has("demo")) return;

  const STORE_KEY = "dashboardPractice.demoSystems.v1";
  const FILES = {
    equipment: "demo/equipment.json",
    history: "demo/equipment_history.json",
    utilities: "demo/utilities.json",
    shutoffs: "demo/shutoffs.json"
  };
  const MAX_ATTACHMENT_BYTES = 300 * 1024;
  const WARRANTY_SOON_DAYS = 90;
  const UTILITIES_CATEGORY = "Utilities & Shutoff Locations";

  const PRESENCE = ["Yes", "No", "Not Provided"];
  const OWNERSHIP = ["Landlord", "Tenant", "Other", "Unknown"];
  const ACCURACY = ["Exact", "Estimated", "Unknown"];
  const INFO_STATUS = ["Verified", "Estimated", "Unknown"];
  const VISIBILITY = ["Internal Only", "Tenant Accessible"];
  const PARTIES = ["Landlord", "Tenant", "HOA", "Other"];
  const BILLING = ["Direct Tenant Billing", "Owner Pays & Bills Tenant", "Included in Rent", "Included in Property Taxes", "Included in Another Utility", "Other"];
  const UTILITY_NAMES = ["Gas", "Electric", "Water", "Sewer", "Trash"];
  const SHUTOFF_KINDS = ["Water", "Gas", "Electrical panel / main breaker", "Other safety device"];
  const EVENT_TYPES = ["purchased", "installed", "inspection", "service", "repair", "warranty_claim", "replacement", "ticket", "note"];
  const ATTACH_KINDS = [["photos", "Photos"], ["receipts", "Receipts"], ["manuals", "Manuals"], ["warranty_docs", "Warranty documents"]];

  const yesNo = ["Yes", "No", "Not Provided"];
  const CONDITION = ["Good", "Fair", "Poor", "Unknown"];

  // Each category lists its preset types, the extra fields that only make sense for
  // it, and any shared fields that don't apply (so the form shows only what matters).
  const CATEGORIES = [
    {
      name: "Appliances", types: ["Refrigerator", "Range/Stove", "Garbage Disposal", "Dishwasher", "Microwave", "Range Hood", "Washing Machine", "Dryer"], hide: [],
      details: (type) => (type === "Range/Stove" || type === "Dryer"
        ? [{ key: "fuel", label: "Fuel", type: "select", options: ["Natural gas", "Electric", "Propane", "Other", "Unknown"] }]
        : [])
    },
    {
      name: "Heating & Cooling",
      typesByKind: {
        Heating: ["Gas Furnace", "Oil Furnace", "Electric Furnace", "Electric Baseboard", "Boiler", "Heat Pump", "No Heating", "Other", "Not Provided"],
        Cooling: ["Central Air", "Heat Pump", "Ductless Mini-Split", "Window Units", "No Cooling", "Other", "Not Provided"]
      },
      details: [
        { key: "system_kind", label: "System", type: "select", options: ["Heating", "Cooling"], required: true },
        { key: "fuel", label: "Fuel (heating)", type: "select", options: ["Natural gas", "Electric", "Oil", "Propane", "Other", "Unknown"] }
      ],
      hide: []
    },
    {
      name: "Water Heater", types: ["Water Heater"], hide: [],
      details: [
        { key: "heater_type", label: "Heater type", type: "select", options: ["Tank", "Tankless", "Heat Pump", "Other"] },
        { key: "fuel_type", label: "Fuel type", type: "select", options: ["Natural gas", "Electric", "Propane", "Oil", "Other", "Unknown"] },
        { key: "capacity_gallons", label: "Capacity (gallons)", type: "number" }
      ]
    },
    {
      name: "Roof & Gutters", types: ["Roof & Gutters"],
      hide: ["brand", "model", "serial_number", "manufacture_year", "purchase_date", "seller", "installation_date", "installation_company"],
      details: [
        { key: "material", label: "Material", type: "text" },
        { key: "condition", label: "Condition", type: "select", options: CONDITION },
        { key: "installation_year", label: "Installation year", type: "number" },
        { key: "installation_year_accuracy", label: "Year accuracy", type: "select", options: ACCURACY },
        { key: "roofing_company", label: "Roofing company", type: "text" },
        { key: "last_inspection", label: "Last inspection", type: "date" },
        { key: "drainage", label: "Drainage", type: "text" }
      ]
    },
    {
      name: "Garage & Garage Door", types: ["Garage", "Garage door", "Garage door opener"], hide: [],
      details: (type) => {
        if (type === "Garage") {
          return [
            { key: "attached_or_detached", label: "Attached or detached", type: "select", options: ["Attached", "Detached"] },
            { key: "number_of_spaces", label: "Number of spaces", type: "number" }
          ];
        }
        if (type === "Garage door") {
          return [
            { key: "door_type", label: "Door type", type: "text" },
            { key: "operation", label: "Operation", type: "select", options: ["Manual", "Automatic"] }
          ];
        }
        return [];
      }
    },
    {
      name: "Electrical Panel", types: ["Electrical Panel"], hide: ["purchase_date", "seller"],
      details: [
        { key: "protection_type", label: "Protection type", type: "select", options: ["Circuit breakers", "Fuses", "Other", "Unknown"] },
        { key: "main_amperage", label: "Main amperage", type: "number" },
        { key: "wiring_type", label: "Wiring type", type: "text" },
        { key: "circuit_labels", label: "Circuit labels", type: "text" }
      ]
    },
    {
      name: "Plumbing & Drains", types: ["Pipes", "Drains", "Sump pump"], hide: ["serial_number", "manufacture_year", "purchase_date", "seller"],
      details: [
        { key: "pipe_material", label: "Pipe material", type: "text" },
        { key: "drainage", label: "Drainage", type: "text" },
        { key: "sump_pump", label: "Sump pump", type: "select", options: yesNo },
        { key: "recurring_issues", label: "Recurring issues", type: "textarea" }
      ]
    },
    {
      name: "Doors, Windows & Locks", types: ["Entry door", "Interior door", "Sliding door", "Window", "Lock"], hide: ["serial_number", "manufacture_year"],
      details: [
        { key: "door_type", label: "Type", type: "text" },
        { key: "locks", label: "Locks", type: "text" }
      ]
    },
    {
      name: "Smoke & CO Detectors", types: ["Smoke detector", "CO detector", "Combination detector"], hide: ["purchase_date", "seller"],
      details: [
        { key: "detector_type", label: "Detector type", type: "select", options: ["Smoke", "CO", "Combination"] },
        { key: "last_replacement", label: "Last replacement", type: "date" }
      ]
    },
    {
      name: "Basement & Foundation", types: ["Basement", "Foundation"],
      hide: ["brand", "model", "serial_number", "manufacture_year", "purchase_date", "seller", "product_warranty"],
      details: [
        { key: "structural_condition", label: "Structural condition", type: "select", options: CONDITION },
        { key: "moisture", label: "Moisture", type: "select", options: ["None", "Occasional", "Frequent", "Unknown"] },
        { key: "drainage", label: "Drainage", type: "text" }
      ]
    },
    {
      name: "Exterior & Landscaping", types: ["Trees", "Fencing", "Stairs", "Landscaping"],
      hide: ["brand", "model", "serial_number", "manufacture_year", "purchase_date", "seller", "product_warranty"],
      details: [
        { key: "trees", label: "Trees", type: "text" },
        { key: "fencing", label: "Fencing", type: "text" },
        { key: "stairs", label: "Stairs", type: "text" },
        { key: "landscaping_responsibility", label: "Landscaping responsibility", type: "select", options: ["Landlord", "Tenant", "Shared", "Unknown"] }
      ]
    }
  ];

  // ---- Small helpers -----------------------------------------------------

  const $ = (id) => document.getElementById(id);

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  const isBlank = (v) => v === null || v === undefined || v === "";

  function todayIso() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function fmtDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  }

  function daysUntil(iso) {
    const t = todayIso();
    const a = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
    const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    return Math.round((b - a) / 86400000);
  }

  const money = (n) => Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

  function safeHttpUrl(u) {
    try {
      const url = new URL(String(u));
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch (err) { return ""; }
  }

  const uid = (prefix) => prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const catDef = (name) => CATEGORIES.find((c) => c.name === name);
  const label = (s) => String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

  function badge(text, kind) { return el("span", "sys-badge sys-badge--" + kind, text); }

  const STATUS_KIND = { Verified: "ok", Estimated: "warn", Unknown: "muted" };

  // ---- State -------------------------------------------------------------

  let data = null; // { version, equipment, history, utilities, shutoffs }
  let propertyInfo = { id: "recBuim4HdvIeouCI", name: "10 Harbor View" };
  let viewAs = "manager"; // "manager" or "tenant" (preview only)
  let active = false;
  let loading = null;
  const expanded = new Set();
  const armed = new Map(); // two-step confirm buttons: key -> timer
  let statusEl = null;
  let lazyObserver = null;
  const pendingImages = new WeakMap();

  // ---- Data --------------------------------------------------------------

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + " (HTTP " + res.status + ")");
    return res.json();
  }

  // The tickets (and their equipment links) belong to the dashboard; this file only reads them.
  const dash = () => window.DashboardDemo || null;
  const ticketById = (id) => (dash() ? dash().getRow(id) : null);

  function linkedTickets(equipmentId) {
    const d = dash();
    if (!d) return [];
    return d.getRows().filter((r) => ((r.demo && r.demo.equipment_ids) || []).indexOf(equipmentId) !== -1);
  }

  // Earlier saved data (version 1) kept a copy of each ticket-linked repair as a history
  // event. The ticket is the single source of truth now, so those copies are turned into
  // ticket links and dropped, manual events are kept, and equipment added to the demo since
  // is merged in.
  async function migrateV1(saved) {
    const d = dash();
    const manual = [];
    (saved.history || []).forEach((ev) => {
      if (!ev.ticket_id) { manual.push(ev); return; }
      const t = d ? d.getRow(ev.ticket_id) : null;
      const ids = t && t.demo ? (t.demo.equipment_ids || []) : null;
      if (t && ids.indexOf(ev.equipment_id) === -1) d.updateTicket(t.id, { demo: { equipment_ids: ids.concat(ev.equipment_id) } });
    });
    saved.history = manual;
    try {
      const seed = await fetchJson(FILES.equipment);
      (seed.records || []).forEach((rec) => {
        if (!saved.equipment.some((r) => r.id === rec.id)) saved.equipment.push(rec);
      });
    } catch (err) { console.warn("Could not merge new demo equipment:", err); }
    saved.version = 2;
    return saved;
  }

  async function loadAll() {
    const props = await fetchJson("demo/properties.json");
    if (props.records && props.records[0]) propertyInfo = { id: props.records[0].id, name: props.records[0].name };
    if (dash()) await dash().ready; // the tickets must be loaded before saved data is migrated

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (err) { saved = null; }
    if (saved && Array.isArray(saved.equipment) && (saved.version === 1 || saved.version === 2)) {
      data = saved.version === 1 ? await migrateV1(saved) : saved;
      if (saved.version === 2 && data === saved && !Array.isArray(data.history)) data.history = [];
      persist();
      return;
    }
    const [eq, hist, ut, sh] = await Promise.all([FILES.equipment, FILES.history, FILES.utilities, FILES.shutoffs].map(fetchJson));
    data = { version: 2, equipment: eq.records || [], history: (hist.records || []).filter((h) => !h.ticket_id), utilities: ut.records || [], shutoffs: sh.records || [] };
  }

  function ensureLoaded() {
    if (data) return Promise.resolve();
    if (!loading) loading = loadAll().finally(() => { loading = null; });
    return loading;
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      setStatus("Saved on screen only: this browser's storage is full or blocked, so the change will be lost on reload. Remove some attachments and try again.", true);
      return false;
    }
  }

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = "sys-preview-note" + (isError ? " sys-error" : "");
    statusEl.style.background = isError ? "var(--color-urgent-bg)" : "";
    statusEl.style.borderColor = isError ? "var(--color-urgent-border)" : "";
    statusEl.style.color = isError ? "var(--color-urgent)" : "";
    statusEl.hidden = !text;
  }

  // Attachments are kept as durable references (id, filename, mime) plus a file path
  // or, for files added in this demo, a small data URL. In production this becomes a
  // call that returns a fresh Airtable link, because those links expire after about 2 hours.
  async function resolveAttachmentUrl(att) {
    return att.dataUrl || att.path || "";
  }

  async function openAttachment(att) {
    let url = await resolveAttachmentUrl(att);
    if (!url) return;
    if (url.indexOf("data:") === 0) {
      const blob = await (await fetch(url)).blob(); // browsers block top-level data: URLs
      url = URL.createObjectURL(blob);
    }
    window.open(url, "_blank", "noopener");
  }

  // ---- Rendering ---------------------------------------------------------

  function currentProperty() {
    const sel = $("property-select");
    const v = sel ? sel.value : "";
    if (!v || v === "All Properties" || v === propertyInfo.name) return propertyInfo;
    return null;
  }

  const isManager = () => viewAs === "manager";
  const visibleTo = (rec) => isManager() || rec.visibility === "Tenant Accessible";

  function render() {
    const root = $("systems-section");
    clear(root);
    // A redraw disarms any half-confirmed delete/reset button.
    armed.forEach((timer) => clearTimeout(timer));
    armed.clear();
    if (lazyObserver) lazyObserver.disconnect();
    lazyObserver = "IntersectionObserver" in window ? new IntersectionObserver(onIntersect, { rootMargin: "200px" }) : null;

    const prop = currentProperty();
    const header = el("div", "sys-header");
    header.appendChild(el("h2", null, "Systems & Equipment" + (prop ? " — " + prop.name : "")));
    root.appendChild(header);

    if (!prop) {
      root.appendChild(el("p", "sys-empty", "The demo only has systems data for " + propertyInfo.name + ". Choose it in the Property filter."));
      return;
    }

    root.appendChild(el("p", "sys-sub", "Fictional demo data. Changes are saved in this browser only and never sent anywhere."));

    statusEl = el("p", "sys-preview-note");
    statusEl.setAttribute("role", "status");
    statusEl.hidden = true;
    root.appendChild(statusEl);

    root.appendChild(renderToolbar());
    if (!isManager()) {
      root.appendChild(el("p", "sys-preview-note", "Tenant preview: only records marked Tenant Accessible are shown, and shutoff instructions appear only when approved for tenants. This is a preview only; the real permission check will run on the server."));
    }
    CATEGORIES.forEach((cat) => root.appendChild(renderCategory(cat)));
    root.appendChild(renderUtilitiesCategory());
  }

  function renderToolbar() {
    const bar = el("div", "sys-toolbar");
    const seg = el("div", "sys-segment");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "View as");
    [["manager", "Manager view"], ["tenant", "Tenant preview"]].forEach(([key, text]) => {
      const b = el("button", null, text);
      b.type = "button";
      b.setAttribute("aria-pressed", String(viewAs === key));
      b.addEventListener("click", () => { viewAs = key; render(); });
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    bar.appendChild(el("span", "sys-spacer"));

    const exp = el("button", "btn btn-ghost sys-btn-sm", "Expand all");
    exp.type = "button";
    exp.addEventListener("click", () => { CATEGORIES.concat([{ name: UTILITIES_CATEGORY }]).forEach((c) => expanded.add(c.name)); render(); });
    const col = el("button", "btn btn-ghost sys-btn-sm", "Collapse all");
    col.type = "button";
    col.addEventListener("click", () => { expanded.clear(); render(); });
    bar.append(exp, col);

    if (isManager()) bar.appendChild(twoStepButton("reset", "Reset demo data", "Confirm reset", "btn btn-ghost sys-btn-sm", resetDemo));
    return bar;
  }

  // A button that needs a second click within 4 seconds (instead of a browser confirm box).
  function twoStepButton(key, text, confirmText, cls, action) {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", () => {
      if (armed.has(key)) {
        clearTimeout(armed.get(key));
        armed.delete(key);
        action();
        return;
      }
      b.textContent = confirmText;
      armed.set(key, setTimeout(() => { armed.delete(key); b.textContent = text; }, 4000));
    });
    return b;
  }

  async function resetDemo() {
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
    data = null;
    await ensureLoaded();
    render();
    setStatus("Demo data reset to the original fictional records.", false);
  }

  function categoryShell(name, count, metaChips, bodyBuilder) {
    const open = expanded.has(name);
    const wrap = el("section", "sys-cat");
    const id = "sys-cat-" + name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const head = el("button", "sys-cat-head");
    head.type = "button";
    head.id = id + "-head";
    head.setAttribute("aria-expanded", String(open));
    head.setAttribute("aria-controls", id);
    head.appendChild(el("span", "sys-chevron"));
    head.appendChild(el("span", "sys-cat-name", name));
    const meta = el("span", "sys-cat-meta");
    meta.appendChild(badge(count, "muted"));
    metaChips.forEach((c) => meta.appendChild(c));
    head.appendChild(meta);
    head.addEventListener("click", () => {
      if (expanded.has(name)) expanded.delete(name); else expanded.add(name);
      render();
      const again = $(id + "-head");
      if (again) again.focus();
    });
    wrap.appendChild(head);

    const body = el("div", "sys-cat-body");
    body.id = id;
    body.setAttribute("role", "region");
    body.setAttribute("aria-labelledby", id + "-head");
    body.hidden = !open;
    if (open) bodyBuilder(body);
    wrap.appendChild(body);
    return wrap;
  }

  function addButton(text, onClick) {
    const b = el("button", "btn btn-secondary sys-btn-sm", text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function renderCategory(cat) {
    const items = data.equipment.filter((r) => r.category === cat.name && visibleTo(r));
    const chips = [];
    const soon = items.filter((r) => warrantyAlert(r)).length;
    if (soon) chips.push(badge(soon + (soon === 1 ? " warranty alert" : " warranty alerts"), "alert"));
    const countText = items.length + (items.length === 1 ? " item" : " items");
    return categoryShell(cat.name, countText, chips, (body) => {
      if (isManager()) {
        const actions = el("div", "sys-cat-actions");
        actions.appendChild(addButton("Add " + (cat.name === "Appliances" ? "appliance" : "item"), () => openEquipmentForm(cat.name, null)));
        body.appendChild(actions);
      }
      if (!items.length) body.appendChild(el("p", "sys-empty", isManager() ? "Nothing recorded yet. Add an item above." : "Nothing shared with tenants in this category."));
      items.forEach((rec) => body.appendChild(equipmentCard(rec)));
    });
  }

  function warrantyState(w) {
    if (!w || (isBlank(w.expires) && isBlank(w.description))) return null;
    if (isBlank(w.expires)) return { text: w.description, kind: "muted", tag: "No expiry date" };
    const d = daysUntil(w.expires);
    const base = (w.description ? w.description + " · " : "");
    if (d < 0) return { text: base + "expired " + fmtDate(w.expires), kind: "muted", tag: "Expired" };
    if (d <= WARRANTY_SOON_DAYS) return { text: base + "expires " + fmtDate(w.expires) + " (" + d + (d === 1 ? " day" : " days") + ")", kind: "alert", tag: "Expiring soon" };
    return { text: base + "active until " + fmtDate(w.expires), kind: "ok", tag: "Active" };
  }

  function warrantyAlert(rec) {
    return ["product_warranty", "workmanship_warranty"].some((k) => { const s = warrantyState(rec[k]); return s && s.kind === "alert"; });
  }

  function fact(list, term, value) {
    if (isBlank(value)) return;
    list.push([term, value]);
  }

  function linkOrText(href, text, kind) {
    const url = kind === "mail" ? "mailto:" + href : safeHttpUrl(href);
    if (!url) return document.createTextNode(text);
    const a = el("a", null, text);
    a.href = url;
    if (kind !== "mail") { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    return a;
  }

  function equipmentCard(rec) {
    const manager = isManager();
    const cat = catDef(rec.category) || { details: [], hide: [] };
    const card = el("article", "sys-card");
    card.dataset.id = rec.id;

    const head = el("div", "sys-card-head");
    head.appendChild(el("h4", "sys-card-title", rec.type));
    const badges = el("div", "sys-card-badges");
    if (rec.presence === "No") badges.appendChild(badge("Not present", "muted"));
    else if (rec.presence === "Not Provided") badges.appendChild(badge("Presence unknown", "muted"));
    if (rec.ownership && rec.presence !== "No") badges.appendChild(badge("Owner: " + rec.ownership, "muted"));
    badges.appendChild(badge("Info: " + (rec.information_status || "Unknown"), STATUS_KIND[rec.information_status] || "muted"));
    if (manager) badges.appendChild(badge(rec.visibility === "Tenant Accessible" ? "Tenant Accessible" : "Internal Only", rec.visibility === "Tenant Accessible" ? "tenant" : "internal"));
    const w = ["product_warranty", "workmanship_warranty"].some((k) => { const s = warrantyState(rec[k]); return s && s.kind === "alert"; });
    if (w) badges.appendChild(badge("Warranty alert", "alert"));
    head.appendChild(badges);
    card.appendChild(head);

    if (rec.presence !== "No") {
      const facts = [];
      fact(facts, "Location", rec.location);
      const brandModel = [rec.brand, rec.model].filter((v) => !isBlank(v)).join(" ");
      fact(facts, "Brand / model", brandModel);
      fact(facts, "Serial number", rec.serial_number);
      if (!isBlank(rec.manufacture_year)) {
        const acc = rec.manufacture_year_accuracy && rec.manufacture_year_accuracy !== "Unknown" ? " (" + rec.manufacture_year_accuracy.toLowerCase() + ")" : "";
        fact(facts, "Manufactured", (rec.manufacture_year_accuracy === "Estimated" ? "about " : "") + rec.manufacture_year + acc);
      }
      if (rec.purchase_date || rec.seller) fact(facts, "Purchased", [fmtDate(rec.purchase_date), rec.seller ? "from " + rec.seller : ""].filter(Boolean).join(" "));
      if (rec.installation_date || rec.installation_company) fact(facts, "Installed", [fmtDate(rec.installation_date), rec.installation_company ? "by " + rec.installation_company : ""].filter(Boolean).join(" "));
      const ic = rec.installer_contact || {};
      if (!isBlank(ic.name) || !isBlank(ic.phone) || !isBlank(ic.email) || !isBlank(ic.website)) {
        const span = el("span");
        const parts = [];
        if (!isBlank(ic.name)) parts.push(document.createTextNode(ic.name));
        if (!isBlank(ic.phone)) parts.push(document.createTextNode(ic.phone));
        if (!isBlank(ic.email)) parts.push(linkOrText(ic.email, ic.email, "mail"));
        if (!isBlank(ic.website)) parts.push(linkOrText(ic.website, ic.website.replace(/^https?:\/\//, ""), "web"));
        parts.forEach((p, i) => { if (i) span.appendChild(document.createTextNode(" · ")); span.appendChild(p); });
        fact(facts, "Installer contact", span);
      }
      [["product_warranty", "Product warranty"], ["workmanship_warranty", "Workmanship warranty"]].forEach(([k, term]) => {
        const s = warrantyState(rec[k]);
        if (!s) return;
        const span = el("span");
        span.appendChild(document.createTextNode(s.text + " "));
        span.appendChild(badge(s.tag, s.kind));
        fact(facts, term, span);
      });
      const defs = typeof cat.details === "function" ? cat.details(rec.type) : cat.details;
      (defs || []).forEach((d) => {
        const v = (rec.details || {})[d.key];
        if (!isBlank(v)) fact(facts, d.label, d.type === "date" ? fmtDate(v) : String(v));
      });
      if (facts.length) {
        const dl = el("dl", "sys-facts");
        facts.forEach(([t, v]) => {
          dl.appendChild(el("dt", null, t));
          const dd = el("dd");
          dd.appendChild(typeof v === "string" || typeof v === "number" ? document.createTextNode(String(v)) : v);
          dl.appendChild(dd);
        });
        card.appendChild(dl);
      } else {
        card.appendChild(el("p", "sys-empty", "No details entered yet."));
      }
    }

    if (!isBlank(rec.notes)) card.appendChild(el("p", "sys-notes", rec.notes));

    const atts = attachmentGroups(rec.attachments, ATTACH_KINDS);
    if (atts) card.appendChild(atts);

    card.appendChild(historyBlock(rec));

    if (manager) {
      const actions = el("div", "sys-card-actions");
      const edit = el("button", "btn btn-secondary sys-btn-sm", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => openEquipmentForm(rec.category, rec));
      actions.appendChild(edit);
      actions.appendChild(twoStepButton("del-" + rec.id, "Delete", "Click again to delete", "btn btn-ghost sys-btn-sm", () => {
        // Tickets that pointed at this item lose the link; the tickets themselves are untouched.
        linkedTickets(rec.id).forEach((t) => dash().updateTicket(t.id, { demo: { equipment_ids: (t.demo.equipment_ids || []).filter((i) => i !== rec.id) } }));
        data.equipment = data.equipment.filter((r) => r.id !== rec.id);
        data.history = data.history.filter((h) => h.equipment_id !== rec.id);
        persist();
        render();
        setStatus("Deleted " + rec.type + ".", false);
      }));
      card.appendChild(actions);
    }
    return card;
  }

  // ---- Attachments -------------------------------------------------------

  function attachmentGroups(attachments, kinds) {
    const groups = kinds.filter(([key]) => attachments && attachments[key] && attachments[key].length);
    if (!groups.length) return null;
    const wrap = el("div", "sys-attach-group");
    groups.forEach(([key, text]) => {
      wrap.appendChild(el("div", "sys-attach-label", text));
      const grid = el("div", "sys-attach-grid");
      attachments[key].forEach((att) => grid.appendChild(attachmentNode(att)));
      wrap.appendChild(grid);
    });
    return wrap;
  }

  function attachmentNode(att) {
    const b = el("button", "sys-attach");
    b.type = "button";
    b.title = "Open " + att.filename;
    if ((att.mime || "").indexOf("image/") === 0) {
      const img = el("img", "sys-thumb");
      img.alt = att.filename;
      img.loading = "lazy";
      pendingImages.set(img, att);
      if (lazyObserver) lazyObserver.observe(img); else loadImage(img);
      b.appendChild(img);
    } else {
      b.appendChild(el("span", "sys-attach-file", (att.mime || "file").split("/").pop().toUpperCase()));
    }
    b.appendChild(el("span", "sys-attach-cap", att.filename));
    b.addEventListener("click", () => openAttachment(att));
    return b;
  }

  // Images get their address only when they scroll near the screen (lazy loading).
  function onIntersect(entries) {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      lazyObserver.unobserve(e.target);
      loadImage(e.target);
    });
  }

  async function loadImage(img) {
    const att = pendingImages.get(img);
    if (!att) return;
    try { img.src = await resolveAttachmentUrl(att); } catch (err) { img.alt = att.filename + " (could not load)"; }
  }

  // ---- History -----------------------------------------------------------

  // An equipment item's history is two kinds of entries:
  //  - tickets linked to it (the ticket is the single source of truth, so the date, summary,
  //    vendor, cost and status are read from the ticket and never copied), and
  //  - manual events with no ticket (purchases, installations, inspections), stored here.
  function historyEntries(rec) {
    const entries = linkedTickets(rec.id).map((t) => ({ kind: "ticket", date: t.date_resolved || t.date_created, ticket: t }));
    data.history.filter((h) => h.equipment_id === rec.id && !h.ticket_id).forEach((ev) => entries.push({ kind: "manual", date: ev.date, event: ev }));
    return entries.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }

  function ticketEntry(t) {
    const manager = isManager();
    const li = el("li", "sys-event");
    const dateCol = el("span", "sys-event-date");
    dateCol.appendChild(document.createTextNode(fmtDate(t.date_resolved || t.date_created)));
    dateCol.appendChild(el("span", "sys-event-datelabel", t.date_resolved ? (t.status === "Closed" ? "Closed" : "Resolved") : "Reported"));
    li.appendChild(dateCol);

    // Managers can open the ticket; the ticket detail view is an internal screen, so the tenant preview shows plain text.
    const body = manager ? el("button", "sys-event-btn") : el("div");
    if (manager) {
      body.type = "button";
      body.setAttribute("aria-label", "Open ticket " + t.id + ": " + t.issue);
      body.addEventListener("click", () => { if (dash()) dash().openTicket(t.id, body); });
    }
    body.appendChild(el("span", "sys-event-title", t.issue));
    body.appendChild(el("span", "sys-event-summary" + (t.ai_summary ? "" : " sys-empty"), t.ai_summary || "No repair summary recorded."));
    const meta = el("span", "sys-event-meta");
    meta.appendChild(dash() ? dash().statusBadge(t.status) : badge(t.status, "muted"));
    meta.appendChild(el("span", null, "Ticket " + t.id));
    if (manager) {
      meta.appendChild(el("span", t.assigned_to ? null : "sys-empty", t.assigned_to ? t.assigned_to : "No vendor recorded"));
      meta.appendChild(el("span", typeof t.cost === "number" ? null : "sys-empty", typeof t.cost === "number" ? money(t.cost) : "Cost not recorded"));
    }
    body.appendChild(meta);
    li.appendChild(body);
    return li;
  }

  function manualEntry(e) {
    const li = el("li", "sys-event");
    li.appendChild(el("span", "sys-event-date", fmtDate(e.date)));
    const body = el("div");
    body.appendChild(el("div", "sys-event-summary", e.description || "No description recorded."));
    const meta = el("div", "sys-event-meta");
    meta.appendChild(badge(label(e.type) + " (no ticket)", "muted"));
    if (isManager() && e.vendor) meta.appendChild(el("span", null, e.vendor));
    if (isManager() && typeof e.cost === "number") meta.appendChild(el("span", null, money(e.cost)));
    body.appendChild(meta);
    li.appendChild(body);
    return li;
  }

  function historyBlock(rec) {
    const entries = historyEntries(rec);
    const key = "hist:" + rec.id;
    const open = expanded.has(key);
    const wrap = el("div", "sys-history");
    wrap.dataset.historyFor = rec.id;
    const total = entries.reduce((s, e) => {
      const c = e.kind === "ticket" ? e.ticket.cost : e.event.cost;
      return s + (typeof c === "number" ? c : 0);
    }, 0);
    const toggle = el("button", "sys-link-btn", (open ? "Hide" : "Show") + " history (" + entries.length + ")" + (isManager() && total > 0 ? " · " + money(total) + " spent" : ""));
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.addEventListener("click", () => { if (open) expanded.delete(key); else expanded.add(key); render(); });
    wrap.appendChild(toggle);
    if (!open) return wrap;

    const list = el("ul", "sys-history-list");
    if (!entries.length) list.appendChild(el("li", "sys-empty", "No history yet. Link a ticket to this item, or add an event below."));
    entries.forEach((e) => list.appendChild(e.kind === "ticket" ? ticketEntry(e.ticket) : manualEntry(e.event)));
    wrap.appendChild(list);
    if (isManager()) wrap.appendChild(historyForm(rec));
    return wrap;
  }

  function historyForm(rec) {
    const box = el("form", "sys-event-form");
    box.noValidate = true;
    const grid = el("div", "form-grid");
    const f = makeForm();
    f.field(grid, "date", "Date", "date", { value: todayIso() });
    f.field(grid, "type", "Type", "select", { options: EVENT_TYPES.map((t) => [t, label(t)]), blank: false, value: "service" });
    f.field(grid, "description", "What happened", "text", { wide: true });
    f.field(grid, "vendor", "Vendor (optional)", "text");
    f.field(grid, "cost", "Cost (optional)", "number");
    box.appendChild(el("p", "sys-sub", "For events with no ticket, such as a purchase or an inspection. To record a repair, link its ticket to this item from the ticket instead."));
    box.appendChild(grid);
    const err = el("p", "form-error");
    err.hidden = true;
    box.appendChild(err);
    const actions = el("div", "form-actions");
    const save = el("button", "btn btn-secondary sys-btn-sm", "Add history event");
    save.type = "submit";
    actions.appendChild(save);
    box.appendChild(actions);
    box.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const date = f.get("date");
      const desc = f.get("description");
      const cost = f.get("cost");
      if (!date || !desc) { err.textContent = "Add a date and a short description."; err.hidden = false; return; }
      if (cost !== null && (isNaN(Number(cost)) || Number(cost) < 0)) { err.textContent = "Cost must be zero or more."; err.hidden = false; return; }
      data.history.push({ id: uid("ev"), equipment_id: rec.id, date, type: f.get("type"), description: desc, vendor: f.get("vendor"), cost: cost === null ? null : Number(cost) });
      persist();
      render();
      setStatus("History event added to " + rec.type + ".", false);
    });
    return box;
  }

  // ---- Utilities and shutoffs -------------------------------------------

  function renderUtilitiesCategory() {
    const utilities = data.utilities.filter(visibleTo);
    const shutoffs = data.shutoffs.filter(visibleTo);
    const countText = utilities.length + (utilities.length === 1 ? " utility" : " utilities") + " · " + shutoffs.length + (shutoffs.length === 1 ? " shutoff" : " shutoffs");
    return categoryShell(UTILITIES_CATEGORY, countText, [], (body) => {
      body.appendChild(el("h3", "sys-subhead", "Utilities"));
      UTILITY_NAMES.forEach((name) => {
        const rec = data.utilities.find((u) => u.utility === name);
        if (rec && !visibleTo(rec)) return;
        if (!rec && !isManager()) return;
        body.appendChild(utilityCard(name, rec));
      });
      body.appendChild(el("h3", "sys-subhead", "Shutoff locations"));
      if (isManager()) {
        const actions = el("div", "sys-cat-actions");
        actions.appendChild(addButton("Add shutoff", () => openShutoffForm(null)));
        body.appendChild(actions);
      }
      if (!shutoffs.length) body.appendChild(el("p", "sys-empty", isManager() ? "No shutoff locations recorded yet." : "No shutoff information is shared with tenants."));
      shutoffs.forEach((s) => body.appendChild(shutoffCard(s)));
    });
  }

  function listFacts(pairs) {
    const dl = el("dl", "sys-facts");
    pairs.forEach(([t, v]) => {
      if (isBlank(v)) return;
      dl.appendChild(el("dt", null, t));
      const dd = el("dd");
      dd.appendChild(typeof v === "string" ? document.createTextNode(v) : v);
      dl.appendChild(dd);
    });
    return dl;
  }

  function utilityCard(name, rec) {
    const card = el("article", "sys-card");
    const head = el("div", "sys-card-head");
    head.appendChild(el("h4", "sys-card-title", name));
    const badges = el("div", "sys-card-badges");
    if (rec) {
      badges.appendChild(badge("Info: " + (rec.information_status || "Unknown"), STATUS_KIND[rec.information_status] || "muted"));
      if (isManager()) badges.appendChild(badge(rec.visibility === "Tenant Accessible" ? "Tenant Accessible" : "Internal Only", rec.visibility === "Tenant Accessible" ? "tenant" : "internal"));
    }
    head.appendChild(badges);
    card.appendChild(head);
    if (!rec) {
      card.appendChild(el("p", "sys-empty", "Not entered yet."));
    } else {
      let billing = rec.billing_arrangement;
      if (billing && rec.included_with) billing += " (with " + rec.included_with + ")";
      const phone = rec.provider_phone;
      const dl = listFacts([
        ["Provider", rec.provider_name], ["Phone", phone], ["Emergency phone", rec.emergency_phone],
        ["Website", isBlank(rec.website) ? null : linkOrText(rec.website, rec.website.replace(/^https?:\/\//, ""), "web")],
        ["Account holder", rec.account_holder], ["Responsible payer", rec.responsible_payer], ["Billing", billing]
      ]);
      if (dl.children.length) card.appendChild(dl); else card.appendChild(el("p", "sys-empty", "No details entered yet."));
      if (!isBlank(rec.notes)) card.appendChild(el("p", "sys-notes", rec.notes));
    }
    if (isManager()) {
      const actions = el("div", "sys-card-actions");
      const b = el("button", "btn btn-secondary sys-btn-sm", rec ? "Edit" : "Add");
      b.type = "button";
      b.addEventListener("click", () => openUtilityForm(name, rec));
      actions.appendChild(b);
      card.appendChild(actions);
    }
    return card;
  }

  function shutoffCard(rec) {
    const card = el("article", "sys-card");
    card.dataset.id = rec.id;
    const head = el("div", "sys-card-head");
    head.appendChild(el("h4", "sys-card-title", rec.kind + " shutoff"));
    const badges = el("div", "sys-card-badges");
    badges.appendChild(badge("Info: " + (rec.information_status || "Unknown"), STATUS_KIND[rec.information_status] || "muted"));
    if (isManager()) badges.appendChild(badge(rec.visibility === "Tenant Accessible" ? "Tenant Accessible" : "Internal Only", rec.visibility === "Tenant Accessible" ? "tenant" : "internal"));
    head.appendChild(badges);
    card.appendChild(head);

    let instructions;
    if (rec.tenant_instructions_approved && !isBlank(rec.tenant_instructions)) {
      instructions = rec.tenant_instructions;
    } else if (isManager() && !isBlank(rec.tenant_instructions)) {
      const s = el("span", "sys-unapproved", "Not approved for tenants: ");
      const wrap = el("span");
      wrap.append(s, document.createTextNode(rec.tenant_instructions));
      instructions = wrap;
    } else {
      instructions = el("span", "sys-empty", "No approved tenant instructions on file.");
    }
    card.appendChild(listFacts([
      ["Exact location", isBlank(rec.exact_location) ? el("span", "sys-empty", "Location not on file.") : rec.exact_location],
      ["Description", rec.description],
      ["Tenant instructions", instructions]
    ]));
    const atts = attachmentGroups(rec.attachments, [["photos", "Photos"]]);
    if (atts) card.appendChild(atts);
    if (isManager()) {
      const actions = el("div", "sys-card-actions");
      const edit = el("button", "btn btn-secondary sys-btn-sm", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => openShutoffForm(rec));
      actions.appendChild(edit);
      actions.appendChild(twoStepButton("del-" + rec.id, "Delete", "Click again to delete", "btn btn-ghost sys-btn-sm", () => {
        data.shutoffs = data.shutoffs.filter((s) => s.id !== rec.id);
        persist();
        render();
        setStatus("Deleted the " + rec.kind + " shutoff record.", false);
      }));
      card.appendChild(actions);
    }
    return card;
  }

  // ---- Dialog ------------------------------------------------------------

  let lastFocus = null;

  function openDialog(title) {
    lastFocus = document.activeElement;
    $("systems-dialog-title").textContent = title;
    const body = $("systems-dialog-body");
    clear(body);
    $("systems-dialog-overlay").hidden = false;
    return body;
  }

  function closeDialog() {
    $("systems-dialog-overlay").hidden = true;
    clear($("systems-dialog-body"));
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }

  function onDialogKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); closeDialog(); return; }
    if (e.key !== "Tab") return;
    const nodes = Array.prototype.filter.call($("systems-dialog").querySelectorAll("button, input, select, textarea, a[href]"), (n) => !n.disabled && n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ---- Forms -------------------------------------------------------------

  function makeForm() {
    const ctl = {};
    function field(parent, key, text, kind, opts) {
      opts = opts || {};
      const wrap = el("label", "form-field" + (opts.wide ? " form-field-wide" : ""));
      wrap.appendChild(el("span", null, text));
      let input;
      if (kind === "select") {
        input = document.createElement("select");
        if (opts.blank !== false) input.appendChild(new Option("Not entered", ""));
        (opts.options || []).forEach((o) => {
          const [value, textLabel] = Array.isArray(o) ? o : [o, o];
          input.appendChild(new Option(textLabel, value));
        });
      } else if (kind === "textarea") {
        input = document.createElement("textarea");
        input.rows = 3;
      } else {
        input = document.createElement("input");
        input.type = kind;
        if (kind === "number") { input.step = "any"; input.min = "0"; input.inputMode = "decimal"; }
        if (kind === "text" || kind === "email" || kind === "url") input.autocomplete = "off";
      }
      if (!isBlank(opts.value)) input.value = String(opts.value);
      ctl[key] = input;
      wrap.appendChild(input);
      if (parent) parent.appendChild(wrap);
      return wrap;
    }
    const get = (key) => { const v = ctl[key] ? ctl[key].value.trim() : ""; return v === "" ? null : v; };
    return { ctl, field, get };
  }

  function group(parent, title) {
    const g = el("div", "sys-group");
    g.appendChild(el("h3", null, title));
    parent.appendChild(g);
    return g;
  }

  function grid(parent) {
    const g = el("div", "form-grid");
    parent.appendChild(g);
    return g;
  }

  function formError(form) {
    const p = el("p", "form-error");
    p.setAttribute("role", "alert");
    p.hidden = true;
    form.appendChild(p);
    return (text) => { p.textContent = text; p.hidden = !text; if (text) p.scrollIntoView({ block: "nearest" }); };
  }

  function formActions(form, cancelText, saveText) {
    const actions = el("div", "form-actions");
    const cancel = el("button", "btn btn-ghost", cancelText);
    cancel.type = "button";
    cancel.addEventListener("click", closeDialog);
    const save = el("button", "btn btn-primary", saveText);
    save.type = "submit";
    actions.append(cancel, save);
    form.appendChild(actions);
  }

  // Lets the user add and remove files for one record. Files added in this demo are
  // kept as small data URLs; the working copy is only saved when the form is saved.
  function attachmentEditor(parent, attachments, kinds, onChange) {
    const host = el("div");
    parent.appendChild(host);
    function draw() {
      clear(host);
      kinds.forEach(([key, text]) => {
        const wrap = el("div", "form-field form-field-wide");
        wrap.appendChild(el("span", null, text));
        const list = el("ul", "sys-editor-list");
        (attachments[key] || []).forEach((att, i) => {
          const li = el("li");
          li.appendChild(el("span", null, att.filename + (att.dataUrl ? " (added now)" : "")));
          const rm = el("button", "sys-link-btn", "Remove");
          rm.type = "button";
          rm.addEventListener("click", () => { attachments[key].splice(i, 1); draw(); });
          li.appendChild(rm);
          list.appendChild(li);
        });
        wrap.appendChild(list);
        const input = document.createElement("input");
        input.type = "file";
        input.accept = key === "photos" ? "image/*" : "image/*,application/pdf";
        input.setAttribute("aria-label", "Add to " + text);
        input.addEventListener("change", () => {
          const file = input.files && input.files[0];
          if (!file) return;
          if (file.size > MAX_ATTACHMENT_BYTES) { onChange("“" + file.name + "” is " + Math.round(file.size / 1024) + " KB. The demo keeps files up to " + Math.round(MAX_ATTACHMENT_BYTES / 1024) + " KB in this browser."); input.value = ""; return; }
          if (key === "photos" && file.type.indexOf("image/") !== 0) { onChange("Photos must be image files."); input.value = ""; return; }
          const reader = new FileReader();
          reader.onload = () => {
            (attachments[key] = attachments[key] || []).push({ id: uid("att"), filename: file.name, mime: file.type || "application/octet-stream", dataUrl: reader.result });
            onChange("");
            draw();
          };
          reader.onerror = () => onChange("Could not read that file.");
          reader.readAsDataURL(file);
        });
        wrap.appendChild(input);
        host.appendChild(wrap);
      });
    }
    draw();
  }

  function blankEquipment(cat) {
    return {
      id: null, category: cat.name, type: "", is_custom_type: false, presence: "Not Provided", ownership: null,
      brand: null, model: null, serial_number: null, manufacture_year: null, manufacture_year_accuracy: null,
      purchase_date: null, seller: null, installation_date: null, installation_company: null,
      installer_contact: { name: null, phone: null, email: null, website: null },
      product_warranty: { description: null, expires: null }, workmanship_warranty: { description: null, expires: null },
      location: null, attachments: { photos: [], receipts: [], manuals: [], warranty_docs: [] },
      notes: "", information_status: "Unknown", visibility: "Internal Only", details: {}
    };
  }

  function openEquipmentForm(catName, existing) {
    const cat = catDef(catName);
    const isNew = !existing;
    const base = existing ? clone(existing) : blankEquipment(cat);
    base.details = base.details || {};
    const att = clone(base.attachments || blankEquipment(cat).attachments);
    const body = openDialog((isNew ? "Add " : "Edit ") + cat.name + " item");
    const form = el("form");
    form.noValidate = true;
    body.appendChild(form);
    const f = makeForm();
    const show = (k) => cat.hide.indexOf(k) === -1;

    // Basics
    const g1 = group(form, "Basics");
    const gr1 = grid(g1);
    if (cat.typesByKind) {
      f.field(gr1, "kind", "System", "select", { options: ["Heating", "Cooling"], blank: false, value: base.details.system_kind || "Heating" });
    }
    const kindOf = () => (cat.typesByKind ? f.get("kind") || "Heating" : null);
    const presets = () => (cat.typesByKind ? cat.typesByKind[kindOf()] : cat.types);
    const typeWrap = f.field(gr1, "typeSel", "Type", "select", { blank: false });
    const customWrap = f.field(gr1, "customType", "Custom type name", "text");
    function fillTypes(selected) {
      const sel = f.ctl.typeSel;
      clear(sel);
      presets().forEach((t) => sel.appendChild(new Option(t, t)));
      sel.appendChild(new Option("Custom…", "__custom__"));
      if (selected && presets().indexOf(selected) !== -1) { sel.value = selected; f.ctl.customType.value = ""; }
      else if (selected) { sel.value = "__custom__"; f.ctl.customType.value = selected; }
      customWrap.hidden = sel.value !== "__custom__";
    }
    fillTypes(base.type);
    f.ctl.typeSel.addEventListener("change", () => { customWrap.hidden = f.ctl.typeSel.value !== "__custom__"; rebuildDetails(); });
    if (f.ctl.kind) f.ctl.kind.addEventListener("change", () => { fillTypes(null); rebuildDetails(); });
    const currentType = () => (f.ctl.typeSel.value === "__custom__" ? (f.get("customType") || "") : f.ctl.typeSel.value);
    f.field(gr1, "presence", "Present at the property?", "select", { options: PRESENCE, blank: false, value: base.presence || "Not Provided" });
    const ownerWrap = f.field(gr1, "ownership", "Ownership", "select", { options: OWNERSHIP, value: base.ownership });

    // Everything below is hidden when the item is not present.
    const rest = el("div");
    form.appendChild(rest);

    const g2 = group(rest, "Details");
    const detailsGrid = grid(g2);
    function rebuildDetails() {
      Object.keys(f.ctl).filter((k) => k.indexOf("d.") === 0).forEach((k) => { base.details[k.slice(2)] = f.get(k); delete f.ctl[k]; });
      clear(detailsGrid);
      const defs = (typeof cat.details === "function" ? cat.details(currentType()) : cat.details).filter((d) => d.key !== "system_kind");
      defs.forEach((d) => f.field(detailsGrid, "d." + d.key, d.label, d.type, { options: d.options, value: base.details[d.key], wide: d.type === "textarea" }));
      g2.hidden = defs.length === 0;
    }
    rebuildDetails();

    if (["brand", "model", "serial_number", "manufacture_year"].some(show)) {
      const g = group(rest, "Product");
      const gr = grid(g);
      if (show("brand")) f.field(gr, "brand", "Brand", "text", { value: base.brand });
      if (show("model")) f.field(gr, "model", "Model", "text", { value: base.model });
      if (show("serial_number")) f.field(gr, "serial_number", "Serial number", "text", { value: base.serial_number });
      if (show("manufacture_year")) {
        f.field(gr, "manufacture_year", "Manufacture year", "number", { value: base.manufacture_year });
        f.field(gr, "manufacture_year_accuracy", "Year accuracy", "select", { options: ACCURACY, value: base.manufacture_year_accuracy });
      }
    }
    if (show("purchase_date") || show("installation_date")) {
      const g = group(rest, "Purchase and installation");
      const gr = grid(g);
      if (show("purchase_date")) { f.field(gr, "purchase_date", "Purchase date", "date", { value: base.purchase_date }); f.field(gr, "seller", "Seller", "text", { value: base.seller }); }
      if (show("installation_date")) { f.field(gr, "installation_date", "Installation date", "date", { value: base.installation_date }); f.field(gr, "installation_company", "Installation company", "text", { value: base.installation_company }); }
      const ic = base.installer_contact || {};
      f.field(gr, "ic.name", "Installer contact name", "text", { value: ic.name });
      f.field(gr, "ic.phone", "Installer phone", "text", { value: ic.phone });
      f.field(gr, "ic.email", "Installer email", "email", { value: ic.email });
      f.field(gr, "ic.website", "Installer website", "url", { value: ic.website });
    }
    const warrantyKeys = ["product_warranty", "workmanship_warranty"].filter(show);
    if (warrantyKeys.length) {
      const g = group(rest, "Warranties");
      const gr = grid(g);
      warrantyKeys.forEach((k) => {
        const w = base[k] || {};
        const nm = k === "product_warranty" ? "Product" : "Workmanship";
        f.field(gr, k + ".description", nm + " warranty: what it covers", "text", { value: w.description });
        f.field(gr, k + ".expires", nm + " warranty: expires", "date", { value: w.expires });
      });
    }
    const gLoc = group(rest, "Location");
    f.field(grid(gLoc), "location", "Where is it?", "text", { value: base.location, wide: true });
    const gAtt = group(rest, "Photos and documents");
    let setErr = () => {};
    attachmentEditor(gAtt, att, ATTACH_KINDS, (m) => setErr(m));

    function togglePresence() {
      const no = f.ctl.presence.value === "No";
      rest.hidden = no;
      ownerWrap.hidden = no;
    }
    f.ctl.presence.addEventListener("change", togglePresence);

    const gEnd = group(form, "Notes, status and visibility");
    const grEnd = grid(gEnd);
    f.field(grEnd, "notes", "Notes", "textarea", { value: base.notes, wide: true });
    f.field(grEnd, "information_status", "Information status", "select", { options: INFO_STATUS, blank: false, value: base.information_status || "Unknown" });
    f.field(grEnd, "visibility", "Visibility", "select", { options: VISIBILITY, blank: false, value: base.visibility || "Internal Only" });
    togglePresence();

    setErr = formError(form);
    formActions(form, "Cancel", isNew ? "Add item" : "Save changes");

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const type = currentType().trim();
      if (!type) { setErr("Choose a type, or enter a name for a custom type."); return; }
      const year = f.get("manufacture_year");
      if (year !== null && (!/^\d{4}$/.test(year) || +year < 1900 || +year > new Date().getFullYear() + 1)) { setErr("Manufacture year must be a four-digit year, for example 2019."); return; }
      const email = f.get("ic.email");
      if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr("Installer email doesn't look right."); return; }
      const site = f.get("ic.website");
      if (site !== null && !safeHttpUrl(site)) { setErr("Installer website must start with http:// or https://"); return; }
      const defs = (typeof cat.details === "function" ? cat.details(type) : cat.details).filter((d) => d.key !== "system_kind");
      // Start from the stored details so keys this form has no field for are never lost.
      const details = existing ? clone(existing.details || {}) : {};
      for (const d of defs) {
        const v = f.get("d." + d.key);
        if (v !== null && d.type === "number" && (isNaN(Number(v)) || Number(v) < 0)) { setErr(d.label + " must be a number, zero or more."); return; }
        details[d.key] = v === null ? null : (d.type === "number" ? Number(v) : v);
      }
      if (cat.typesByKind) {
        details.system_kind = kindOf();
        details.system_type = presets().indexOf(type) === -1 ? "Other" : type;
      }
      const num = (k) => (f.get(k) === null ? null : Number(f.get(k)));
      const rec = existing ? clone(existing) : blankEquipment(cat);
      rec.type = type;
      rec.is_custom_type = presets().indexOf(type) === -1;
      rec.presence = f.get("presence");
      rec.ownership = rec.presence === "No" ? null : f.get("ownership");
      rec.details = details;
      ["brand", "model", "serial_number", "purchase_date", "seller", "installation_date", "installation_company", "location"].forEach((k) => { if (f.ctl[k]) rec[k] = f.get(k); });
      if (f.ctl.manufacture_year) { rec.manufacture_year = num("manufacture_year"); rec.manufacture_year_accuracy = f.get("manufacture_year_accuracy"); }
      if (f.ctl["ic.name"]) rec.installer_contact = { name: f.get("ic.name"), phone: f.get("ic.phone"), email: email, website: site };
      ["product_warranty", "workmanship_warranty"].forEach((k) => { if (f.ctl[k + ".expires"]) rec[k] = { description: f.get(k + ".description"), expires: f.get(k + ".expires") }; });
      rec.attachments = att;
      rec.notes = f.get("notes") || "";
      rec.information_status = f.get("information_status");
      rec.visibility = f.get("visibility");
      if (isNew) { rec.id = uid("eq-hv"); data.equipment.push(rec); }
      else { const i = data.equipment.findIndex((r) => r.id === rec.id); data.equipment[i] = rec; }
      const saved = persist();
      expanded.add(cat.name);
      closeDialog();
      render();
      if (saved) setStatus((isNew ? "Added " : "Saved ") + type + ".", false);
    });
    const first = form.querySelector("select, input, textarea");
    if (first) first.focus();
  }

  function openUtilityForm(name, existing) {
    const base = existing ? clone(existing) : { id: null, utility: name, provider_name: null, provider_phone: null, emergency_phone: null, website: null, account_holder: null, responsible_payer: null, billing_arrangement: null, included_with: null, notes: "", information_status: "Unknown", visibility: "Internal Only" };
    const body = openDialog((existing ? "Edit " : "Add ") + name + " utility");
    const form = el("form");
    form.noValidate = true;
    body.appendChild(form);
    const f = makeForm();
    const g = group(form, "Provider");
    const gr = grid(g);
    f.field(gr, "provider_name", "Provider name", "text", { value: base.provider_name, wide: true });
    f.field(gr, "provider_phone", "Phone", "text", { value: base.provider_phone });
    f.field(gr, "emergency_phone", "Emergency phone", "text", { value: base.emergency_phone });
    f.field(gr, "website", "Website", "url", { value: base.website, wide: true });
    const g2 = group(form, "Who holds and pays");
    const gr2 = grid(g2);
    f.field(gr2, "account_holder", "Account holder", "select", { options: PARTIES, value: base.account_holder });
    f.field(gr2, "responsible_payer", "Responsible payer", "select", { options: PARTIES, value: base.responsible_payer });
    f.field(gr2, "billing_arrangement", "Billing arrangement", "select", { options: BILLING, value: base.billing_arrangement, wide: true });
    const withWrap = f.field(gr2, "included_with", "Included with", "select", { options: UTILITY_NAMES.filter((u) => u !== name), value: base.included_with });
    const syncWith = () => { withWrap.hidden = f.ctl.billing_arrangement.value !== "Included in Another Utility"; };
    f.ctl.billing_arrangement.addEventListener("change", syncWith);
    syncWith();
    const g3 = group(form, "Notes, status and visibility");
    const gr3 = grid(g3);
    f.field(gr3, "notes", "Notes", "textarea", { value: base.notes, wide: true });
    f.field(gr3, "information_status", "Information status", "select", { options: INFO_STATUS, blank: false, value: base.information_status });
    f.field(gr3, "visibility", "Visibility", "select", { options: VISIBILITY, blank: false, value: base.visibility });
    const setErr = formError(form);
    formActions(form, "Cancel", existing ? "Save changes" : "Add utility");
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const site = f.get("website");
      if (site !== null && !safeHttpUrl(site)) { setErr("Website must start with http:// or https://"); return; }
      const rec = Object.assign(base, {
        provider_name: f.get("provider_name"), provider_phone: f.get("provider_phone"), emergency_phone: f.get("emergency_phone"), website: site,
        account_holder: f.get("account_holder"), responsible_payer: f.get("responsible_payer"), billing_arrangement: f.get("billing_arrangement"),
        included_with: f.get("billing_arrangement") === "Included in Another Utility" ? f.get("included_with") : null,
        notes: f.get("notes") || "", information_status: f.get("information_status"), visibility: f.get("visibility")
      });
      if (!existing) { rec.id = uid("ut-hv"); data.utilities.push(rec); }
      else { const i = data.utilities.findIndex((u) => u.id === rec.id); data.utilities[i] = rec; }
      const saved = persist();
      expanded.add(UTILITIES_CATEGORY);
      closeDialog();
      render();
      if (saved) setStatus("Saved the " + name + " utility.", false);
    });
    f.ctl.provider_name.focus();
  }

  function openShutoffForm(existing) {
    const base = existing ? clone(existing) : { id: null, kind: "Water", exact_location: null, description: null, tenant_instructions: null, tenant_instructions_approved: false, attachments: { photos: [] }, information_status: "Unknown", visibility: "Internal Only" };
    const att = clone(base.attachments || { photos: [] });
    const body = openDialog(existing ? "Edit shutoff" : "Add shutoff");
    const form = el("form");
    form.noValidate = true;
    body.appendChild(form);
    const f = makeForm();
    const g = group(form, "Shutoff");
    const gr = grid(g);
    f.field(gr, "kind", "Kind", "select", { options: SHUTOFF_KINDS, blank: false, value: base.kind });
    f.field(gr, "description", "Description", "text", { value: base.description });
    f.field(gr, "exact_location", "Exact location", "text", { value: base.exact_location, wide: true });
    const g2 = group(form, "Instructions for tenants");
    const gr2 = grid(g2);
    f.field(gr2, "tenant_instructions", "Instructions (only shown to tenants when approved)", "textarea", { value: base.tenant_instructions, wide: true });
    const approveWrap = el("label", "form-field form-field-wide sys-checkbox");
    const approve = document.createElement("input");
    approve.type = "checkbox";
    approve.checked = !!base.tenant_instructions_approved;
    approveWrap.append(approve, el("span", null, "These instructions are approved for tenants"));
    gr2.appendChild(approveWrap);
    const g3 = group(form, "Photos");
    let setErr = () => {};
    attachmentEditor(g3, att, [["photos", "Photos"]], (m) => setErr(m));
    const g4 = group(form, "Status and visibility");
    const gr4 = grid(g4);
    f.field(gr4, "information_status", "Information status", "select", { options: INFO_STATUS, blank: false, value: base.information_status });
    f.field(gr4, "visibility", "Visibility", "select", { options: VISIBILITY, blank: false, value: base.visibility });
    setErr = formError(form);
    formActions(form, "Cancel", existing ? "Save changes" : "Add shutoff");
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (approve.checked && !f.get("tenant_instructions")) { setErr("Add the instructions first, or untick the approval."); return; }
      const rec = Object.assign(base, {
        kind: f.get("kind"), description: f.get("description"), exact_location: f.get("exact_location"),
        tenant_instructions: f.get("tenant_instructions"), tenant_instructions_approved: approve.checked,
        attachments: att, information_status: f.get("information_status"), visibility: f.get("visibility")
      });
      if (!existing) { rec.id = uid("sh-hv"); data.shutoffs.push(rec); }
      else { const i = data.shutoffs.findIndex((s) => s.id === rec.id); data.shutoffs[i] = rec; }
      const saved = persist();
      expanded.add(UTILITIES_CATEGORY);
      closeDialog();
      render();
      if (saved) setStatus("Saved the " + rec.kind + " shutoff.", false);
    });
    f.ctl.kind.focus();
  }

  // ---- Entering and leaving the view -------------------------------------

  async function enter() {
    const vendorBtn = $("vendor-view-btn");
    if ($("main-content").classList.contains("vendor-mode") && vendorBtn) vendorBtn.click(); // leave Vendor Research first
    active = true;
    $("main-content").classList.add("systems-mode");
    const btn = $("systems-view-btn");
    btn.setAttribute("aria-pressed", "true");
    btn.textContent = "← Back to Dashboard";
    const root = $("systems-section");
    clear(root);
    root.appendChild(el("p", "sys-empty", "Loading…"));
    try {
      await ensureLoaded();
      render();
    } catch (err) {
      console.error("Could not load the demo systems data:", err);
      clear(root);
      root.appendChild(el("p", "sys-empty", "Could not load the demo files. Open the dashboard through a web server (serve.ps1) with ?demo=1."));
    }
  }

  function exit() {
    active = false;
    $("main-content").classList.remove("systems-mode");
    const btn = $("systems-view-btn");
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = "Systems & Equipment";
    if (!$("systems-dialog-overlay").hidden) closeDialog();
  }

  function init() {
    const btn = $("systems-view-btn");
    if (!btn) return;
    btn.hidden = false;
    btn.addEventListener("click", () => { if (active) exit(); else enter(); });
    // Opening Vendor Research from the header leaves this view first.
    const vendorBtn = $("vendor-view-btn");
    if (vendorBtn) vendorBtn.addEventListener("click", () => { if (active) exit(); }, true);
    const sel = $("property-select");
    if (sel) sel.addEventListener("change", () => { if (active && data) render(); });
    $("systems-dialog-close").addEventListener("click", closeDialog);
    $("systems-dialog-overlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeDialog(); });
    $("systems-dialog-overlay").addEventListener("keydown", onDialogKeydown);

    // Redraw when a ticket changes (status, cost or an equipment link), and load the
    // equipment early so the ticket search can match equipment names.
    if (dash()) {
      dash().onChange(() => { if (active && data) render(); });
      ensureLoaded().then(() => dash().refresh()).catch((err) => console.warn("Could not preload the demo equipment:", err));
    }
  }

  // ---- API for the ticket screens (tickets-demo.js, app.js) --------------

  const equipmentName = (rec) => rec.type + (rec.location ? " (" + rec.location + ")" : "");

  window.SystemsDemo = {
    ensureLoaded,
    getEquipment: () => (data ? data.equipment.map((r) => ({ id: r.id, type: r.type, category: r.category, location: r.location, presence: r.presence })) : []),
    equipmentName: (id) => { const r = data && data.equipment.find((x) => x.id === id); return r ? equipmentName(r) : ""; },
    equipmentLabels: (ids) => (data ? ids.map((id) => data.equipment.find((x) => x.id === id)).filter(Boolean).map((r) => [r.type, r.brand, r.model, r.location].filter(Boolean).join(" ")) : []),
    attachmentNode,
    // Jumps to an equipment item: opens the view, expands its category and history, and scrolls to it.
    openEquipment: async (id) => {
      await ensureLoaded();
      const rec = data.equipment.find((r) => r.id === id);
      if (!rec) return false;
      viewAs = "manager";
      if (!active) await enter();
      expanded.add(rec.category);
      expanded.add("hist:" + id);
      render();
      const card = document.querySelector('.sys-card[data-id="' + id + '"]');
      if (card) {
        card.tabIndex = -1;
        card.scrollIntoView({ block: "start" });
        card.focus({ preventScroll: true });
      }
      return true;
    }
  };

  document.addEventListener("DOMContentLoaded", init);
})();
