// Tenant Maintenance Portal: a small form that sends a maintenance request to a
// Make custom webhook, which creates the ticket in Airtable. See README.md.
(function () {
  "use strict";

  // The webhook URL is a secret, so it lives only in this browser's localStorage.
  const WEBHOOK_KEY = "dashboardPractice.tenantWebhook.v1";
  const SUBMIT_TIMEOUT_MS = 15000;

  const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
  const ISSUE_MAX = 1000;
  const ISSUE_MIN = 5;

  // The Airtable Tickets table requires one of these categories (the dashboard
  // rejects a ticket without one). The form doesn't ask, so a simple keyword
  // guess picks it; the manager can change it in Airtable.
  const CATEGORY_RULES = [
    { category: "Appliance", re: /dishwasher|washer|washing machine|dryer|refrigerator|fridge|freezer|microwave|\boven\b|\bstove\b|cooktop|\brange\b|disposal/ },
    { category: "Doors & Locks", re: /\bdoors?\b|\block(s|ed|ing)?\b|deadbolt|\bkeys?\b|hinge|latch|doorknob|garage door/ },
    { category: "Electrical", re: /electric|outlet|power|breaker|fuse|wiring|spark|\blights?\b|light bulb|switch|smoke (alarm|detector)/ },
    { category: "HVAC", re: /\bheat(er|ing)?\b|furnace|boiler|thermostat|\bac\b|a\/c|air condition|cooling|\bvents?\b|\bducts?\b|airflow/ },
    { category: "Plumbing", re: /leak|faucet|\bsink\b|toilet|drain|clog|pipe|plumb|shower|bathtub|\btub\b|sewer|flood|burst|water/ }
  ];

  const $ = (id) => document.getElementById(id);
  const form = $("request-form");
  const propertySelect = $("property");
  const issueInput = $("issue");
  const submitBtn = $("submit-btn");
  const messageBox = $("form-message");
  const settings = $("settings");
  const adminToggle = $("admin-toggle");
  const webhookInput = $("webhook-url");

  let properties = []; // [{ id: "rec...", name: "10 Harbor View" }]
  let pendingId = newTicketId(); // reused if a send fails, so a retry can't create a second ticket
  let sending = false;

  // ---- Helpers ---------------------------------------------------------

  function safeGet(key) {
    try { return localStorage.getItem(key) || ""; } catch (err) { return ""; }
  }

  function safeSet(key, value) {
    try {
      if (value) localStorage.setItem(key, value); else localStorage.removeItem(key);
      return true;
    } catch (err) {
      return false;
    }
  }

  function localDate() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function newTicketId() {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
    return "TP-" + localDate().replace(/-/g, "") + "-" + rand;
  }

  function inferCategory(text) {
    const lower = String(text || "").toLowerCase();
    const rule = CATEGORY_RULES.find((r) => r.re.test(lower));
    return rule ? rule.category : "General";
  }

  function parseWebhookUrl(raw) {
    const text = String(raw || "").trim();
    if (!text) return { error: "Paste your Make webhook URL first." };
    let url;
    try { url = new URL(text); } catch (err) { return { error: "That doesn't look like a web address." }; }
    if (url.protocol !== "https:") return { error: "The webhook URL must start with https://" };
    return { url: url.href, host: url.host };
  }

  function showMessage(kind, title, body) {
    messageBox.className = "message message--" + kind;
    messageBox.textContent = "";
    const strong = document.createElement("strong");
    strong.textContent = title;
    messageBox.appendChild(strong);
    if (body) messageBox.appendChild(document.createTextNode(body));
    messageBox.setAttribute("role", kind === "error" ? "alert" : "status");
    messageBox.hidden = false;
    messageBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function hideMessage() {
    messageBox.hidden = true;
    messageBox.textContent = "";
  }

  // Tenants see plain wording. Technical detail is added only while the admin
  // settings panel is open (and is always written to the console).
  function adminDetail(text) {
    return settings.hidden ? "" : " [Admin: " + text + "]";
  }

  function setAdminOpen(open) {
    settings.hidden = !open;
    adminToggle.setAttribute("aria-expanded", String(open));
    adminToggle.textContent = open ? "Hide admin settings" : "Admin settings";
  }

  function setFieldError(inputId, text) {
    const err = $(inputId + "-error");
    const field = $(inputId).closest(".field");
    err.textContent = text || "";
    err.hidden = !text;
    field.classList.toggle("has-error", !!text);
    $(inputId).setAttribute("aria-invalid", text ? "true" : "false");
    if (text) $(inputId).setAttribute("aria-describedby", inputId + "-error");
    else $(inputId).removeAttribute("aria-describedby");
  }

  // ---- Properties (read from the existing Airtable Properties table) ---

  // The dashboard already holds the read-only Airtable settings in app.js. Reading
  // them from there keeps the token in one place instead of copying it here.
  async function loadAirtableSettings() {
    const res = await fetch("app.js", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not read the dashboard settings (HTTP " + res.status + ").");
    const src = await res.text();
    const baseId = (src.match(/baseId:\s*"(app[A-Za-z0-9]+)"/) || [])[1];
    const token = (src.match(/token:\s*"([^"]+)"/) || [])[1];
    const tableId = (src.match(/AIRTABLE_PROPERTIES_TABLE_ID\s*=\s*"(tbl[A-Za-z0-9]+)"/) || [])[1];
    if (!baseId || !tableId || !token || /^PASTE_/.test(token)) {
      throw new Error("The Airtable connection isn't configured in app.js.");
    }
    return { baseId, tableId, token };
  }

  async function fetchProperties() {
    const cfg = await loadAirtableSettings();
    const list = [];
    let offset = "";
    do {
      const url = new URL("https://api.airtable.com/v0/" + cfg.baseId + "/" + cfg.tableId);
      url.searchParams.set("pageSize", "100");
      url.searchParams.append("fields[]", "Property");
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url, { headers: { Authorization: "Bearer " + cfg.token } });
      if (!res.ok) throw new Error("Airtable returned HTTP " + res.status + ".");
      const data = await res.json();
      (data.records || []).forEach((rec) => {
        const name = ((rec.fields || {}).Property || "").trim();
        if (name) list.push({ id: rec.id, name });
      });
      offset = data.offset || "";
    } while (offset);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderProperties() {
    const previous = propertySelect.value;
    propertySelect.textContent = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Select a property";
    propertySelect.appendChild(first);
    properties.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      propertySelect.appendChild(opt);
    });
    if (properties.some((p) => p.id === previous)) propertySelect.value = previous;
    propertySelect.disabled = false;
  }

  function showPropertyLoadError(message) {
    propertySelect.textContent = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Properties unavailable";
    propertySelect.appendChild(opt);
    propertySelect.disabled = true;

    const hint = $("property-hint");
    hint.textContent = "";
    hint.appendChild(document.createTextNode(message + " "));
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn-secondary";
    retry.textContent = "Try again";
    retry.addEventListener("click", loadProperties);
    hint.appendChild(retry);
    hint.hidden = false;
  }

  let propertyErrorReason = ""; // why the last property load failed (shown while the admin panel is open)

  function renderPropertyError() {
    if (!propertyErrorReason) return;
    showPropertyLoadError("Couldn't load the property list. Check your connection." + adminDetail(propertyErrorReason));
  }

  async function loadProperties() {
    const hint = $("property-hint");
    hint.hidden = true;
    propertyErrorReason = "";
    propertySelect.disabled = true;
    propertySelect.textContent = "";
    const loading = document.createElement("option");
    loading.textContent = "Loading properties…";
    propertySelect.appendChild(loading);
    try {
      properties = await fetchProperties();
      if (properties.length === 0) {
        showPropertyLoadError("No properties were found.");
        return;
      }
      renderProperties();
    } catch (err) {
      console.error("Could not load properties:", err);
      propertyErrorReason = location.protocol === "file:"
        ? "this page was opened as a file, so it can't read app.js. Open it from the GitHub Pages address or a local server instead."
        : (err && err.message) || "unknown error";
      renderPropertyError();
    }
  }

  // ---- Submit ----------------------------------------------------------

  function validate() {
    let firstBad = null;
    const issue = issueInput.value.trim();

    if (!propertySelect.value) {
      setFieldError("property", "Please choose your property.");
      firstBad = firstBad || propertySelect;
    } else {
      setFieldError("property", "");
    }

    if (issue.length < ISSUE_MIN) {
      setFieldError("issue", "Please describe the problem (a few words at least).");
      firstBad = firstBad || issueInput;
    } else {
      setFieldError("issue", "");
    }

    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  function buildFields() {
    const issue = issueInput.value.trim().slice(0, ISSUE_MAX);
    const checked = form.querySelector('input[name="priority"]:checked');
    const priority = checked && PRIORITIES.includes(checked.value) ? checked.value : "Medium";
    const property = properties.find((p) => p.id === propertySelect.value);
    // Keys are the Airtable Tickets field names. `property` is the linked
    // record's ID; `property_name` is only there to make Make's data readable.
    return {
      id: pendingId,
      date_created: localDate(),
      property: property.id,
      property_name: property.name,
      issue: issue,
      category: inferCategory(issue),
      priority: priority,
      status: "New"
    };
  }

  // Sent as a plain form post (application/x-www-form-urlencoded). That is a
  // "simple" browser request, so there is no CORS preflight for the webhook to
  // answer, and Make turns the fields into mappable items on its own.
  async function sendToWebhook(url, fields) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams(fields),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, status: 0, aborted: err && err.name === "AbortError" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (sending) return;
    hideMessage();
    if (!validate()) return;

    const parsed = parseWebhookUrl(safeGet(WEBHOOK_KEY));
    if (parsed.error) {
      console.warn("Tenant portal: no webhook URL saved on this device.");
      showMessage("error", "This form isn't ready yet. ",
        "Please contact your property manager." + adminDetail("no webhook URL is saved on this device. Paste it below and press Save."));
      return;
    }

    sending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    const fields = buildFields();
    const result = await sendToWebhook(parsed.url, fields);

    sending = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit request";

    if (result.ok) {
      showMessage("success", "Request sent. ", "Your reference is " + fields.id + ". The property manager will see it shortly.");
      form.reset();
      renderProperties();
      setFieldError("property", "");
      setFieldError("issue", "");
      updateIssueCount();
      pendingId = newTicketId();
    } else if (result.status > 0) {
      console.error("Tenant portal: the webhook answered with HTTP " + result.status + ".");
      showMessage("error", "We couldn't send your request. ",
        "Please try again in a moment, or contact your property manager." +
        adminDetail("the webhook answered HTTP " + result.status + ". Check the URL below and that the Make scenario is running."));
    } else if (result.aborted) {
      console.error("Tenant portal: no answer from the webhook within " + (SUBMIT_TIMEOUT_MS / 1000) + " seconds.");
      showMessage("error", "No answer from the server. ",
        "Please try again in a moment." + adminDetail("the webhook took longer than " + (SUBMIT_TIMEOUT_MS / 1000) + " seconds to answer."));
    } else {
      // The browser gives no detail here: it could be a network problem, or the
      // request got through and only the reply was blocked (no CORS header).
      console.warn("Tenant portal: delivery of " + fields.id + " could not be confirmed.");
      showMessage("warning", "We couldn't confirm that your request arrived. ",
        "Check your connection. Before sending it again, contact your property manager and quote reference " + fields.id + "." +
        adminDetail("it may have been delivered. Look for " + fields.id + " in Airtable. Make's Webhook response should send an Access-Control-Allow-Origin header so the page can confirm each send."));
    }
  }

  // ---- Settings --------------------------------------------------------

  function updateWebhookStatus(text, isError) {
    const el = $("webhook-status");
    el.textContent = text;
    el.style.color = isError ? "var(--color-urgent)" : "";
  }

  function describeSaved() {
    const parsed = parseWebhookUrl(safeGet(WEBHOOK_KEY));
    updateWebhookStatus(parsed.url ? "Webhook saved on this device (" + parsed.host + ")." : "No webhook saved on this device yet.", false);
  }

  function wireSettings() {
    const saved = safeGet(WEBHOOK_KEY);
    webhookInput.value = saved;
    describeSaved();
    adminToggle.addEventListener("click", () => {
      const open = settings.hidden;
      setAdminOpen(open);
      renderPropertyError(); // adds or removes the technical reason under the property list
      if (open) webhookInput.focus();
    });

    $("webhook-save").addEventListener("click", () => {
      const parsed = parseWebhookUrl(webhookInput.value);
      if (parsed.error) {
        updateWebhookStatus(parsed.error, true);
        webhookInput.focus();
        return;
      }
      if (!safeSet(WEBHOOK_KEY, parsed.url)) {
        updateWebhookStatus("This browser blocked saving. Turn off private browsing and try again.", true);
        return;
      }
      webhookInput.value = parsed.url;
      describeSaved();
      hideMessage();
    });

    $("webhook-clear").addEventListener("click", () => {
      safeSet(WEBHOOK_KEY, "");
      webhookInput.value = "";
      describeSaved();
    });
  }

  function updateIssueCount() {
    $("issue-count").textContent = issueInput.value.length + " / " + ISSUE_MAX;
  }

  // ---- Start -----------------------------------------------------------

  function init() {
    form.addEventListener("submit", handleSubmit);
    issueInput.addEventListener("input", updateIssueCount);
    propertySelect.addEventListener("change", () => { if (propertySelect.value) setFieldError("property", ""); });
    issueInput.addEventListener("input", () => { if (issueInput.value.trim().length >= ISSUE_MIN) setFieldError("issue", ""); });
    wireSettings();
    loadProperties();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
