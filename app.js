(function () {
  "use strict";

  // ---- Configuration -------------------------------------------------

  const AS_OF_DATE = "2026-09-23"; // demo "today"; change this to move the demo forward/back
  const YTD_START_DATE = "2026-01-01";
  const ALL_PROPERTIES = "All Properties";

  // Live data source: Airtable ("Property Maintenance Tickets" base,
  // "Maintenance Tickets" table -- field names match the CSV schema below).
  //
  // The token here is meant to be public. Create it at
  // https://airtable.com/create/tokens scoped to ONLY this one base with
  // ONLY the "data.records:read" permission -- read-only, single-base
  // tokens are safe to ship in client-side code because the worst case is
  // someone else can also read this one table of sample data. Never use a
  // token with write access or access to other bases/workspaces here.
  const AIRTABLE_CONFIG = {
    baseId: "appIl5LOY1FMfCPUR",
    tableId: "tblk60sOTkEpyDmr1", // "Maintenance Tickets"
    token: "path6ceZDd1hmWcMV.76d0659562192e1310d4e8cab35369af880c9345fa6b4db664f7a8ca1fc3fedb"
  };

  // The ticket's `property` field is a linked record into this table, so the
  // names have to be looked up here (the API only returns record IDs).
  const AIRTABLE_PROPERTIES_TABLE_ID = "tbl7OhvkXrPXmCAuB"; // "Properties"

  // Embedded verbatim (kept in sync with demo_upload_sample.csv) so the
  // "Download demo CSV" button works via a generated Blob instead of a
  // direct file link -- browsers block the <a download> attribute for
  // file:// pages, which is how this file most often gets opened.
  const DEMO_CSV = `id,date_created,property,tenant,issue,category,priority,status,assigned_to,date_resolved,cost,cost_date,ai_summary
DEMO-1,2026-09-15,10 Harbor View,Jamie Ross,Bathroom light won't turn on,Electrical,Medium,New,,,,,Switch or bulb likely failed; awaiting assignment.
DEMO-2,2026-09-10,22 Lakeside Dr,Morgan Price,Kitchen faucet handle loose,Plumbing,Low,Scheduled,Sample Plumbing Co,,,,Handle needs tightening; plumber scheduled this week.
DEMO-3,2026-08-28,5 Forest Hill Rd,Casey Bloom,Furnace making rattling noise,HVAC,High,In Progress,Comfort Air Services,,140,2026-09-01,Rattling traced to loose panel; repair underway.
DEMO-4,2026-06-14,10 Harbor View,Drew Falk,Dryer not spinning,Appliance,Medium,Resolved,Metro Appliance Repair,2026-06-16,95,2026-06-16,Belt replaced; dryer tested and working.
DEMO-5,2026-09-20,22 Lakeside Dr,Riley Grant,Front gate lock jammed,Doors & Locks,Urgent,New,,,,,Tenant unable to lock gate; urgent locksmith needed.
DEMO-6,2026-04-02,5 Forest Hill Rd,Avery Shaw,Musty smell after rain,General,Low,Resolved,Cedar Maintenance Team,2026-04-05,0,2026-04-05,Minor damp spot aired out; no charge.
DEMO-7,2026-09-05,10 Harbor View,Logan Pierce,Kitchen sink drain clogged,Plumbing,High,Scheduled,Sample Plumbing Co,,,,Drain likely blocked; plumber scheduled this week.
DEMO-8,2026-09-18,10 Harbor View,Harper Voss,No AC airflow from vents,HVAC,Urgent,New,,,,,No airflow reported; dispatch HVAC tech same day.
DEMO-9,2026-03-10,10 Harbor View,Elliot Cruz,Closet door hinge squeaking,Doors & Locks,Low,Resolved,Ace Locksmiths,2026-03-12,20,2026-03-12,Hinge lubricated; squeak resolved.
DEMO-10,2026-09-02,10 Harbor View,Quinn Bailey,Hallway carpet fraying at edge,General,Medium,In Progress,Cedar Maintenance Team,,30,2026-09-03,Edge trim ordered; repair in progress.
DEMO-11,2026-09-19,10 Harbor View,Sage Whitfield,Breaker panel buzzing loudly,Electrical,Urgent,In Progress,Bright Spark Electric,,,,Possible loose connection; electrician on site.
DEMO-12,2026-07-01,10 Harbor View,Rowan Ellis,Freezer not sealing properly,Appliance,Low,Resolved,Metro Appliance Repair,2026-07-03,0,2026-07-03,Gasket realigned; no charge under warranty.
DEMO-13,2026-09-08,10 Harbor View,Blake Sutton,Toilet running continuously,Plumbing,Medium,Resolved,Sample Plumbing Co,2026-09-10,60,2026-09-10,Flapper valve replaced; issue resolved.
DEMO-14,2026-08-25,10 Harbor View,Marlowe Dean,Thermostat display blank,HVAC,High,Scheduled,Comfort Air Services,,,,Thermostat likely needs replacement; tech scheduled.
DEMO-15,2026-09-21,10 Harbor View,Tatum Reyes,Balcony door won't slide,Doors & Locks,Medium,New,,,,,Track may be obstructed; awaiting assignment.
DEMO-16,2026-01-15,10 Harbor View,Finley Ward,Mailroom light burned out,General,Low,Resolved,Cedar Maintenance Team,2026-01-17,15,2026-01-17,Bulb replaced; resolved same visit.
DEMO-17,2026-09-14,22 Lakeside Dr,Emerson Blake,AC unit leaking onto carpet,HVAC,High,In Progress,Comfort Air Services,,110,2026-09-16,Condensate pan cracked; replacement underway.
DEMO-18,2026-09-11,22 Lakeside Dr,Percy Nash,Living room outlet not working,Electrical,Medium,New,,,,,Outlet dead; awaiting electrician assignment.
DEMO-19,2026-09-06,22 Lakeside Dr,Wren Castillo,Dishwasher leaving residue on dishes,Appliance,Low,Scheduled,Metro Appliance Repair,,,,Likely spray arm clog; technician scheduled.
DEMO-20,2026-09-17,22 Lakeside Dr,Ellis Monroe,Strong gas odor near stove,General,Urgent,In Progress,Cedar Maintenance Team,,,,Utility company notified; maintenance investigating urgently.
DEMO-21,2026-05-02,22 Lakeside Dr,Sawyer Gable,Water heater leaking at base,Plumbing,High,Resolved,Sample Plumbing Co,2026-05-05,175,2026-05-05,Water heater valve replaced; leak stopped.
DEMO-22,2026-08-10,22 Lakeside Dr,Marin Hale,Screen door latch broken,Doors & Locks,Low,Resolved,Ace Locksmiths,2026-08-12,25,2026-08-12,Latch replaced; door secures properly.
DEMO-23,2026-09-22,22 Lakeside Dr,Devon Lark,Vent making rattling sound,HVAC,Medium,New,,,,,Rattling reported; awaiting inspection.
DEMO-24,2026-09-05,22 Lakeside Dr,Isla Brennan,Washer not spinning fully,Appliance,Medium,Resolved,Metro Appliance Repair,2026-09-07,0,2026-09-07,Reset cycle fixed issue; no charge.
DEMO-25,2026-08-30,22 Lakeside Dr,Cove Ashby,Flickering lights throughout unit,Electrical,High,Scheduled,Bright Spark Electric,,,,Possible wiring issue; electrician scheduled to diagnose.
DEMO-26,2026-02-18,22 Lakeside Dr,Briar Solis,Stairwell handrail loose,General,Low,Resolved,Cedar Maintenance Team,2026-02-20,10,2026-02-20,Handrail bracket tightened; resolved.
DEMO-27,2026-09-19,5 Forest Hill Rd,Jules Farrow,Pipe burst under bathroom sink,Plumbing,Urgent,New,,,,,Active leak reported; urgent plumber dispatch needed.
DEMO-28,2026-09-04,5 Forest Hill Rd,Ronan Pike,Ceiling fan switch not responding,Electrical,Medium,Scheduled,,,,,Switch likely faulty; electrician scheduled.
DEMO-29,2026-09-12,5 Forest Hill Rd,Wynn Halloway,Oven not reaching set temperature,Appliance,High,In Progress,Metro Appliance Repair,,85,2026-09-13,Heating element testing underway.
DEMO-30,2026-06-20,5 Forest Hill Rd,Story Eaton,Garage door remote not syncing,Doors & Locks,Low,Resolved,Ace Locksmiths,2026-06-22,18,2026-06-22,Remote reprogrammed; syncing correctly.
DEMO-31,2026-09-16,5 Forest Hill Rd,Arden Foss,Musty smell in basement,General,Medium,New,,,,,Possible moisture source; awaiting inspection.
DEMO-32,2026-09-01,5 Forest Hill Rd,Kai Renshaw,Furnace not producing heat,HVAC,Urgent,Resolved,Comfort Air Services,2026-09-02,200,2026-09-02,Ignitor replaced; heat restored same day.
DEMO-33,2026-03-05,5 Forest Hill Rd,Noor Kimball,Slow draining bathtub,Plumbing,Low,Resolved,Sample Plumbing Co,2026-03-07,40,2026-03-07,Drain cleared; flow restored.
DEMO-34,2026-09-10,5 Forest Hill Rd,Remy Ashworth,Half of unit lost power,Electrical,High,In Progress,Bright Spark Electric,,,,Tripped breaker suspected; electrician investigating.
DEMO-35,2026-08-20,5 Forest Hill Rd,Sloane Whitaker,Microwave turntable not rotating,Appliance,Medium,Scheduled,Metro Appliance Repair,,,,Motor likely worn; technician scheduled.
DEMO-36,2026-09-23,5 Forest Hill Rd,Indigo Marsh,Front door deadbolt won't engage,Doors & Locks,Urgent,New,,,,,Tenant unable to secure unit; urgent locksmith needed.
`;

  const CATEGORIES = ["Plumbing", "HVAC", "Electrical", "Appliance", "Doors & Locks", "General"];
  const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
  const STATUSES = ["New", "Scheduled", "In Progress", "Resolved"];
  const OPEN_STATUSES = ["New", "Scheduled", "In Progress"];
  const VENDOR_RESEARCH_STATUSES = ["New", "In Progress"]; // open tickets that get a Vendor Research button
  const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

  // Soft, cohesive "candy pastel" palette for the category donut: bright,
  // high-lightness, low-saturation. Each entry stays distinct at a glance.
  const CATEGORY_COLORS = {
    "Plumbing": "#A7C7E7",
    "HVAC": "#A8E0C7",
    "Electrical": "#FDE9A0",
    "Appliance": "#D3C3EF",
    "Doors & Locks": "#F5C3D0",
    "General": "#F8D3A9"
  };

  const CATEGORY_BORDER_COLORS = {
    "Plumbing": "#89B2DE",
    "HVAC": "#84C9AC",
    "Electrical": "#F0D373",
    "Appliance": "#B79FE0",
    "Doors & Locks": "#E79FB3",
    "General": "#EFB57E"
  };

  // Light, soft pastels for the status bar chart -- gray / blue / orange /
  // mint -- kept a shade paler or hue-shifted from the donut's closest
  // lookalike (Plumbing's blue, General's peach, HVAC's mint) so the two
  // charts don't repeat colors.
  const STATUS_COLORS = {
    "New": "#E1E4EA",
    "Scheduled": "#C7E4F7",
    "In Progress": "#FFC98F",
    "Resolved": "#C0EDD4"
  };

  const STATUS_BORDER_COLORS = {
    "New": "#AEB6C4",
    "Scheduled": "#8EC2E8",
    "In Progress": "#F0A652",
    "Resolved": "#8FCFA8"
  };

  const STATUS_BADGE_CLASS = {
    "New": "badge-new",
    "Scheduled": "badge-scheduled",
    "In Progress": "badge-inprogress",
    "Resolved": "badge-resolved"
  };

  const PRIORITY_BADGE_CLASS = {
    "Low": "badge-low",
    "Medium": "badge-medium",
    "High": "badge-high",
    "Urgent": "badge-urgent"
  };

  // ---- State -----------------------------------------------------------

  const state = {
    rows: [],
    property: ALL_PROPERTIES,
    tab: "open",
    lastFocusedEl: null,
    dataSource: null // "airtable" | "csv", set once loading finishes
  };

  let categoryChart = null;
  let statusChart = null;

  // ---- Date helpers ------------------------------------------------------

  function isIsoDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function toDateObj(s) {
    return new Date(s + "T00:00:00Z");
  }

  function daysBetween(a, b) {
    return Math.round((toDateObj(b) - toDateObj(a)) / 86400000);
  }

  function formatDate(s) {
    if (!isIsoDate(s)) return "-";
    return toDateObj(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  }

  function sameMonth(dateStr, refStr) {
    return dateStr.slice(0, 7) === refStr.slice(0, 7);
  }

  function formatCurrency(n) {
    return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  // ---- Load + parse + validate -------------------------------------------

  async function loadCsvText() {
    try {
      const res = await fetch("maintenance_requests.csv", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      if (!text || !text.trim()) throw new Error("empty response");
      return text;
    } catch (err) {
      // Loading a local CSV via fetch() requires the page to be served over
      // http(s); when opened directly as a file:// URL, browsers block it.
      // Fall back to the copy embedded in data.js (see generate-data.ps1).
      if (typeof MAINTENANCE_CSV === "string") return MAINTENANCE_CSV;
      throw err;
    }
  }

  const AIRTABLE_TOKEN_PLACEHOLDER = "PASTE_YOUR_READ_ONLY_AIRTABLE_TOKEN_HERE";

  function resolveAirtableProperty(value, propertyNames) {
    // `property` is a linked-record field, so the API returns an array of
    // record IDs (e.g. ["recZ81ppp49bEVd4H"]) rather than a name. Translate
    // the first one via the Properties table. A plain string (the old
    // single-select format) passes through; an ID we can't resolve becomes
    // "" so validation reports it instead of showing a raw record ID.
    const first = Array.isArray(value) ? value[0] : value;
    if (first === undefined || first === null) return "";
    if (propertyNames[first]) return propertyNames[first];
    return /^rec[A-Za-z0-9]{14}$/.test(first) ? "" : String(first);
  }

  function airtableFieldsToRawRow(fields, propertyNames) {
    // Airtable's REST API returns single/multi-line text and single-select
    // fields as plain strings, date fields as "YYYY-MM-DD", currency fields
    // as numbers, lookup fields as arrays, and omits any field that is
    // empty -- normalize all of that into the same all-string shape
    // validateRows() expects from CSV rows (missing/blank -> "").
    const str = (v) => (v === undefined || v === null ? "" : String(v));
    // Lookup of the linked property's address; kept on every row (not shown
    // in the UI) for the upcoming vendor-search integration.
    const fullAddress = [].concat(fields["Full Address"] ?? fields["Full Address Lookup"] ?? [])
      .filter(Boolean)
      .join("; ");
    return {
      id: str(fields.id),
      date_created: str(fields.date_created),
      property: resolveAirtableProperty(fields.property, propertyNames),
      full_address: fullAddress,
      tenant: str(fields.tenant),
      issue: str(fields.issue),
      category: str(fields.category),
      priority: str(fields.priority),
      status: str(fields.status),
      assigned_to: str(fields.assigned_to),
      date_resolved: str(fields.date_resolved),
      cost: str(fields.cost),
      cost_date: str(fields.cost_date),
      ai_summary: str(fields.ai_summary)
    };
  }

  async function loadRowsFromAirtable() {
    if (!AIRTABLE_CONFIG.token || AIRTABLE_CONFIG.token === AIRTABLE_TOKEN_PLACEHOLDER) {
      return null; // not configured -- caller falls back to the bundled CSV
    }

    const [ticketRecords, propertyRecords] = await Promise.all([
      fetchAllAirtableRecords(AIRTABLE_CONFIG.tableId),
      fetchAllAirtableRecords(AIRTABLE_PROPERTIES_TABLE_ID)
    ]);

    const propertyNames = {};
    propertyRecords.forEach((record) => {
      propertyNames[record.id] = (record.fields || {}).Property || "";
    });

    return ticketRecords.map((record) => airtableFieldsToRawRow(record.fields || {}, propertyNames));
  }

  async function fetchAllAirtableRecords(tableId) {
    const records = [];
    let offset = "";
    do {
      const url = new URL("https://api.airtable.com/v0/" + AIRTABLE_CONFIG.baseId + "/" + tableId);
      url.searchParams.set("pageSize", "100");
      if (offset) url.searchParams.set("offset", offset);

      const res = await fetch(url, {
        headers: { Authorization: "Bearer " + AIRTABLE_CONFIG.token }
      });
      if (!res.ok) throw new Error("Airtable request failed (" + tableId + "): HTTP " + res.status);
      const data = await res.json();
      records.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);
    return records;
  }

  function validateRows(rawRows) {
    const clean = [];
    const errors = [];
    const seenIds = new Set();

    rawRows.forEach((row, idx) => {
      const where = "row " + (idx + 2) + " (" + (row.id || "no id") + ")";

      if (!row.id || seenIds.has(row.id)) {
        errors.push(where + ": missing or duplicate id"); return;
      }
      if (!isIsoDate(row.date_created) || row.date_created > AS_OF_DATE) {
        errors.push(where + ": invalid date_created"); return;
      }
      if (!row.property) {
        errors.push(where + ": missing property"); return;
      }
      if (!CATEGORIES.includes(row.category)) {
        errors.push(where + ": invalid category '" + row.category + "'"); return;
      }
      if (!PRIORITIES.includes(row.priority)) {
        errors.push(where + ": invalid priority '" + row.priority + "'"); return;
      }
      if (!STATUSES.includes(row.status)) {
        errors.push(where + ": invalid status '" + row.status + "'"); return;
      }

      const hasResolvedDate = !!row.date_resolved;
      if (row.status === "Resolved") {
        if (!isIsoDate(row.date_resolved) || row.date_resolved < row.date_created || row.date_resolved > AS_OF_DATE) {
          errors.push(where + ": invalid date_resolved for a Resolved request"); return;
        }
      } else if (hasResolvedDate) {
        errors.push(where + ": date_resolved set on a non-Resolved request"); return;
      }

      const hasCost = row.cost !== "" && row.cost !== undefined && row.cost !== null;
      const hasCostDate = !!row.cost_date;
      if (hasCost !== hasCostDate) {
        errors.push(where + ": cost and cost_date must both be present or both blank"); return;
      }
      if (hasCost) {
        const costNum = Number(row.cost);
        if (Number.isNaN(costNum) || costNum < 0) {
          errors.push(where + ": invalid cost value"); return;
        }
        if (!isIsoDate(row.cost_date) || row.cost_date < row.date_created || row.cost_date > AS_OF_DATE) {
          errors.push(where + ": invalid cost_date"); return;
        }
        if (row.status === "Resolved" && row.cost_date > row.date_resolved) {
          errors.push(where + ": cost_date is after date_resolved"); return;
        }
      }

      seenIds.add(row.id);
      clean.push({
        id: row.id,
        date_created: row.date_created,
        property: row.property,
        tenant: row.tenant || "",
        issue: row.issue || "",
        category: row.category,
        priority: row.priority,
        status: row.status,
        assigned_to: row.assigned_to || "",
        date_resolved: row.date_resolved || "",
        cost: hasCost ? Number(row.cost) : null,
        cost_date: row.cost_date || "",
        ai_summary: row.ai_summary || "",
        full_address: row.full_address || ""
      });
    });

    return { clean, errors };
  }

  let statusBannerTimer = null;

  function showStatusBanner(message, variant) {
    const banner = document.getElementById("status-banner");
    if (statusBannerTimer) {
      clearTimeout(statusBannerTimer);
      statusBannerTimer = null;
    }
    banner.textContent = message;
    banner.className = "status-banner status-banner--" + variant;
    banner.hidden = false;
    if (variant === "info") {
      statusBannerTimer = setTimeout(() => { banner.hidden = true; }, 6000);
    }
  }

  function showValidationBanner(errors, sourceLabel) {
    console.error("Maintenance data validation errors (" + sourceLabel + "):\n" + errors.join("\n"));
    showStatusBanner(
      errors.length + " row(s) from " + sourceLabel + " failed validation and were excluded. See the browser console for details.",
      "error"
    );
  }

  function showFatalError(message) {
    const main = document.getElementById("main-content");
    main.innerHTML = "";
    const banner = document.createElement("div");
    banner.setAttribute("role", "alert");
    banner.style.cssText = "background:#fbe7e5;border:1px solid #e3b3ae;color:#8a2b23;border-radius:10px;padding:18px 20px;font-size:0.95rem;";
    banner.textContent = message;
    main.appendChild(banner);
  }

  // ---- Derived data --------------------------------------------------

  function filterByProperty(rows, property) {
    if (property === ALL_PROPERTIES) return rows;
    return rows.filter((r) => r.property === property);
  }

  function computeKpis(rows) {
    const openRows = rows.filter((r) => OPEN_STATUSES.includes(r.status));
    const urgentOpen = openRows.filter((r) => r.priority === "Urgent");
    const resolvedRows = rows.filter((r) => r.status === "Resolved");
    const resolvedThisMonth = resolvedRows.filter((r) => sameMonth(r.date_resolved, AS_OF_DATE));

    let avgResolutionText = "-";
    if (resolvedRows.length > 0) {
      const totalDays = resolvedRows.reduce((sum, r) => sum + daysBetween(r.date_created, r.date_resolved), 0);
      avgResolutionText = (totalDays / resolvedRows.length).toFixed(1) + " days";
    }

    return {
      open: openRows.length,
      urgentOpen: urgentOpen.length,
      resolvedThisMonth: resolvedThisMonth.length,
      avgResolutionText
    };
  }

  function countByOrdered(rows, field, order) {
    const counts = {};
    order.forEach((key) => { counts[key] = 0; });
    rows.forEach((r) => { counts[r[field]] = (counts[r[field]] || 0) + 1; });
    return order.map((key) => ({ key, count: counts[key] })).filter((entry) => entry.count > 0);
  }

  function computeYtdCosts(allRows) {
    const totals = {};
    allRows.forEach((r) => {
      if (r.cost === null) return;
      if (r.cost_date < YTD_START_DATE || r.cost_date > AS_OF_DATE) return;
      totals[r.property] = (totals[r.property] || 0) + r.cost;
    });
    return totals;
  }

  function sortOpenRows(rows) {
    return rows.slice().sort((a, b) => {
      const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (p !== 0) return p;
      const d = b.date_created.localeCompare(a.date_created);
      if (d !== 0) return d;
      return a.id.localeCompare(b.id);
    });
  }

  function sortResolvedRows(rows) {
    return rows.slice().sort((a, b) => {
      const d = b.date_resolved.localeCompare(a.date_resolved);
      if (d !== 0) return d;
      return a.id.localeCompare(b.id);
    });
  }

  // ---- Rendering: header / KPIs --------------------------------------

  function populatePropertySelect(rows) {
    const properties = Array.from(new Set(rows.map((r) => r.property))).sort();

    const select = document.getElementById("property-select");
    select.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = ALL_PROPERTIES;
    allOpt.textContent = ALL_PROPERTIES;
    select.appendChild(allOpt);
    properties.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });
    if (!properties.includes(state.property) && state.property !== ALL_PROPERTIES) {
      state.property = ALL_PROPERTIES;
    }
    select.value = state.property;
    // Assigning .onchange (rather than addEventListener) keeps this callable
    // every time the dataset changes (upload, new request) without stacking
    // duplicate handlers on the persistent <select> element.
    select.onchange = () => {
      state.property = select.value;
      renderAll();
    };

    const datalist = document.getElementById("property-datalist");
    datalist.innerHTML = "";
    properties.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      datalist.appendChild(opt);
    });
  }

  function renderKpis(rows) {
    const kpis = computeKpis(rows);
    document.getElementById("kpi-open").textContent = String(kpis.open);
    document.getElementById("kpi-urgent").textContent = String(kpis.urgentOpen);
    document.getElementById("kpi-resolved-month").textContent = String(kpis.resolvedThisMonth);
    document.getElementById("kpi-avg-resolution").textContent = kpis.avgResolutionText;
  }

  // ---- Rendering: charts ------------------------------------------------

  function renderLegend(listEl, entries, colorMap) {
    listEl.innerHTML = "";
    entries.forEach((entry) => {
      const li = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = colorMap[entry.key];
      li.appendChild(swatch);
      li.appendChild(document.createTextNode(entry.key + " — " + entry.count));
      listEl.appendChild(li);
    });
  }

  function renderCharts(rows) {
    const categoryEntries = countByOrdered(rows, "category", CATEGORIES);
    const statusEntries = countByOrdered(rows, "status", STATUSES);

    const catCanvas = document.getElementById("chart-category");
    const statusCanvas = document.getElementById("chart-status");

    if (categoryChart) categoryChart.destroy();
    if (statusChart) statusChart.destroy();

    categoryChart = new Chart(catCanvas, {
      type: "doughnut",
      data: {
        labels: categoryEntries.map((e) => e.key),
        datasets: [{
          data: categoryEntries.map((e) => e.count),
          backgroundColor: categoryEntries.map((e) => CATEGORY_COLORS[e.key]),
          borderColor: categoryEntries.map((e) => CATEGORY_BORDER_COLORS[e.key]),
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.label + ": " + ctx.parsed
            }
          }
        }
      }
    });

    statusChart = new Chart(statusCanvas, {
      type: "bar",
      data: {
        labels: statusEntries.map((e) => e.key),
        datasets: [{
          data: statusEntries.map((e) => e.count),
          backgroundColor: statusEntries.map((e) => STATUS_COLORS[e.key]),
          borderColor: statusEntries.map((e) => STATUS_BORDER_COLORS[e.key]),
          borderWidth: 1.5,
          borderRadius: 4,
          maxBarThickness: 56
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.label + ": " + ctx.parsed.y
            }
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          x: { grid: { display: false } }
        }
      }
    });

    const catSummary = categoryEntries.map((e) => e.key + " " + e.count).join(", ") || "no requests";
    catCanvas.setAttribute("aria-label", "Donut chart of requests by category: " + catSummary);
    const statusSummary = statusEntries.map((e) => e.key + " " + e.count).join(", ") || "no requests";
    statusCanvas.setAttribute("aria-label", "Bar chart of requests by status: " + statusSummary);

    renderLegend(document.getElementById("legend-category"), categoryEntries, CATEGORY_COLORS);
    renderLegend(document.getElementById("legend-status"), statusEntries, STATUS_COLORS);
  }

  // ---- Rendering: requests table / cards ------------------------------

  function badge(value, classMap) {
    const span = document.createElement("span");
    span.className = "badge " + classMap[value];
    span.textContent = value;
    return span;
  }

  function propertyLabel() {
    return state.property === ALL_PROPERTIES ? "any property" : state.property;
  }

  function renderRequestsSection(rowsForProperty) {
    const openRows = sortOpenRows(rowsForProperty.filter((r) => OPEN_STATUSES.includes(r.status)));
    const resolvedRows = sortResolvedRows(rowsForProperty.filter((r) => r.status === "Resolved"));

    document.getElementById("tab-open-count").textContent = "(" + openRows.length + ")";
    document.getElementById("tab-resolved-count").textContent = "(" + resolvedRows.length + ")";

    const openTab = document.getElementById("tab-open");
    const resolvedTab = document.getElementById("tab-resolved");
    const isOpen = state.tab === "open";
    openTab.classList.toggle("is-active", isOpen);
    resolvedTab.classList.toggle("is-active", !isOpen);
    openTab.setAttribute("aria-selected", String(isOpen));
    resolvedTab.setAttribute("aria-selected", String(!isOpen));

    const activeRows = isOpen ? openRows : resolvedRows;
    const showResolvedColumn = !isOpen;

    const head = document.getElementById("requests-table-head");
    head.innerHTML = "";
    const columns = ["Date", "Property", "Issue", "Category", "Priority", "Status", "Assigned To"];
    if (showResolvedColumn) columns.push("Date Resolved");
    columns.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c;
      head.appendChild(th);
    });

    const body = document.getElementById("requests-table-body");
    const cardsWrap = document.getElementById("requests-cards");
    const emptyEl = document.getElementById("requests-empty");
    body.innerHTML = "";
    cardsWrap.innerHTML = "";

    if (activeRows.length === 0) {
      emptyEl.hidden = false;
      emptyEl.textContent = isOpen
        ? "No open requests for " + propertyLabel() + "."
        : "No resolved requests for " + propertyLabel() + ".";
      return;
    }
    emptyEl.hidden = true;

    activeRows.forEach((row) => {
      // Table row (desktop)
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", "View details for " + row.id + ", " + row.issue);

      const cells = [
        formatDate(row.date_created),
        row.property,
        row.issue,
        row.category
      ];
      cells.forEach((text) => {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });

      const priorityTd = document.createElement("td");
      priorityTd.appendChild(badge(row.priority, PRIORITY_BADGE_CLASS));
      tr.appendChild(priorityTd);

      const statusTd = document.createElement("td");
      statusTd.appendChild(badge(row.status, STATUS_BADGE_CLASS));
      tr.appendChild(statusTd);

      const assignedTd = document.createElement("td");
      assignedTd.textContent = row.assigned_to || "-";
      tr.appendChild(assignedTd);

      if (showResolvedColumn) {
        const resolvedTd = document.createElement("td");
        resolvedTd.textContent = formatDate(row.date_resolved);
        tr.appendChild(resolvedTd);
      }

      tr.addEventListener("click", () => openDialog(row, tr));
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDialog(row, tr);
        }
      });
      body.appendChild(tr);

      // Card (mobile)
      const card = document.createElement("div");
      card.className = "request-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "View details for " + row.id + ", " + row.issue);

      const top = document.createElement("div");
      top.className = "rc-top";
      const issueSpan = document.createElement("span");
      issueSpan.className = "rc-issue";
      issueSpan.textContent = row.issue;
      top.appendChild(issueSpan);
      top.appendChild(badge(row.priority, PRIORITY_BADGE_CLASS));
      card.appendChild(top);

      const propertyDiv = document.createElement("div");
      propertyDiv.className = "rc-property";
      propertyDiv.textContent = row.property;
      card.appendChild(propertyDiv);

      const meta = document.createElement("div");
      meta.className = "rc-meta";
      meta.appendChild(badge(row.status, STATUS_BADGE_CLASS));
      const metaText = document.createElement("span");
      let metaStr = row.category + " · " + formatDate(row.date_created) + " · " + (row.assigned_to || "Unassigned");
      if (showResolvedColumn) metaStr += " · Resolved " + formatDate(row.date_resolved);
      metaText.textContent = metaStr;
      meta.appendChild(metaText);
      card.appendChild(meta);

      card.addEventListener("click", () => openDialog(row, card));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDialog(row, card);
        }
      });
      cardsWrap.appendChild(card);
    });
  }

  // ---- Rendering: YTD costs -------------------------------------------

  function renderCosts(allRows) {
    const totals = computeYtdCosts(allRows);
    const wrap = document.getElementById("costs-table-wrap");
    wrap.innerHTML = "";

    const table = document.createElement("table");
    table.className = "costs-table";
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Property</th><th class=\"cost-cell\">YTD Actual Cost</th></tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");

    if (state.property === ALL_PROPERTIES) {
      const properties = Array.from(new Set(allRows.map((r) => r.property)));
      const rows = properties
        .map((p) => ({ property: p, total: totals[p] || 0 }))
        .sort((a, b) => b.total - a.total || a.property.localeCompare(b.property));

      rows.forEach((r) => {
        const tr = document.createElement("tr");
        const nameTd = document.createElement("td");
        nameTd.textContent = r.property;
        const costTd = document.createElement("td");
        costTd.className = "cost-cell";
        costTd.textContent = formatCurrency(r.total);
        tr.appendChild(nameTd);
        tr.appendChild(costTd);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      const tfoot = document.createElement("tfoot");
      const portfolioTotal = rows.reduce((sum, r) => sum + r.total, 0);
      const footRow = document.createElement("tr");
      footRow.innerHTML = "<td>Portfolio Total</td><td class=\"cost-cell\">" + formatCurrency(portfolioTotal) + "</td>";
      tfoot.appendChild(footRow);
      table.appendChild(tfoot);
    } else {
      const total = totals[state.property] || 0;
      const tr = document.createElement("tr");
      const nameTd = document.createElement("td");
      nameTd.textContent = state.property;
      const costTd = document.createElement("td");
      costTd.className = "cost-cell";
      costTd.textContent = formatCurrency(total);
      tr.appendChild(nameTd);
      tr.appendChild(costTd);
      tbody.appendChild(tr);
      table.appendChild(tbody);
    }

    wrap.appendChild(table);
  }

  // ---- Dialog -----------------------------------------------------------

  function addDialogField(dl, label, value, extraClass) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    if (extraClass) dt.classList.add(extraClass);
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (extraClass) dd.classList.add(extraClass);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function openDialog(row, triggerEl) {
    state.lastFocusedEl = triggerEl;
    const overlay = document.getElementById("dialog-overlay");
    const titleEl = document.getElementById("dialog-title");
    const body = document.getElementById("dialog-body");

    titleEl.textContent = row.id + " · " + row.property;
    body.innerHTML = "";

    addDialogField(body, "Tenant", row.tenant || "-");
    addDialogField(body, "Original Issue", row.issue || "-");
    addDialogField(body, "Category", row.category);
    addDialogField(body, "Priority", row.priority);
    addDialogField(body, "Status", row.status);
    addDialogField(body, "Assigned To", row.assigned_to || "-");
    addDialogField(body, "Date Created", formatDate(row.date_created));
    if (row.date_resolved) {
      addDialogField(body, "Date Resolved", formatDate(row.date_resolved));
    }
    addDialogField(body, "Actual Cost", row.cost === null ? "Not recorded" : formatCurrency(row.cost));
    addDialogField(body, "AI Summary (sample content, not a live AI result)", row.ai_summary || "-", "ai-summary");
    updateDialogVendorButton(row);

    overlay.hidden = false;
    document.getElementById("dialog-close").focus();
    document.addEventListener("keydown", onDialogKeydown, true);
  }

  function closeDialog() {
    const overlay = document.getElementById("dialog-overlay");
    overlay.hidden = true;
    document.removeEventListener("keydown", onDialogKeydown, true);
    if (state.lastFocusedEl && typeof state.lastFocusedEl.focus === "function") {
      state.lastFocusedEl.focus();
    }
  }

  function trapFocus(dialogEl, e) {
    // Skip hidden controls (e.g. the Vendor Research button on Scheduled tickets).
    const focusable = Array.from(dialogEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => el.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onDialogKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDialog();
      return;
    }
    if (e.key === "Tab") trapFocus(document.getElementById("request-dialog"), e);
  }

  // ---- New Request form ---------------------------------------------

  function populateSelect(selectEl, values) {
    selectEl.innerHTML = "";
    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });
  }

  function getNextRequestId() {
    let max = 0;
    state.rows.forEach((r) => {
      const m = /^MR-(\d+)$/.exec(r.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "MR-" + (max + 1);
  }

  function updateNewRequestConditionalFields() {
    const status = document.getElementById("nr-status").value;
    const resolvedWrap = document.getElementById("nr-date-resolved-wrap");
    const resolvedInput = document.getElementById("nr-date-resolved");
    const isResolved = status === "Resolved";
    resolvedWrap.hidden = !isResolved;
    resolvedInput.required = isResolved;
    if (isResolved && !resolvedInput.value) resolvedInput.value = AS_OF_DATE;
    if (!isResolved) resolvedInput.value = "";

    const costInput = document.getElementById("nr-cost");
    const costDateWrap = document.getElementById("nr-cost-date-wrap");
    const costDateInput = document.getElementById("nr-cost-date");
    const hasCost = costInput.value !== "";
    costDateWrap.hidden = !hasCost;
    costDateInput.required = hasCost;
    if (hasCost && !costDateInput.value) {
      costDateInput.value = isResolved && resolvedInput.value ? resolvedInput.value : AS_OF_DATE;
    }
    if (!hasCost) costDateInput.value = "";
  }

  function resetNewRequestForm() {
    document.getElementById("nr-property").value = "";
    document.getElementById("nr-tenant").value = "";
    document.getElementById("nr-issue").value = "";
    document.getElementById("nr-category").value = CATEGORIES[0];
    document.getElementById("nr-priority").value = "Medium";
    document.getElementById("nr-status").value = "New";
    document.getElementById("nr-assigned").value = "";

    const dateCreated = document.getElementById("nr-date-created");
    dateCreated.value = AS_OF_DATE;
    dateCreated.max = AS_OF_DATE;

    const dateResolved = document.getElementById("nr-date-resolved");
    dateResolved.value = "";
    dateResolved.min = AS_OF_DATE;
    dateResolved.max = AS_OF_DATE;

    document.getElementById("nr-cost").value = "";
    const costDate = document.getElementById("nr-cost-date");
    costDate.value = "";
    costDate.min = AS_OF_DATE;
    costDate.max = AS_OF_DATE;

    document.getElementById("nr-ai-summary").value = "";

    const errorEl = document.getElementById("new-request-error");
    errorEl.hidden = true;
    errorEl.textContent = "";

    updateNewRequestConditionalFields();
  }

  function openNewRequestDialog(triggerEl) {
    resetNewRequestForm();
    state.lastFocusedEl = triggerEl;
    document.getElementById("new-request-overlay").hidden = false;
    document.getElementById("nr-property").focus();
    document.addEventListener("keydown", onNewRequestKeydown, true);
  }

  function closeNewRequestDialog() {
    document.getElementById("new-request-overlay").hidden = true;
    document.removeEventListener("keydown", onNewRequestKeydown, true);
    if (state.lastFocusedEl && typeof state.lastFocusedEl.focus === "function") {
      state.lastFocusedEl.focus();
    }
  }

  function onNewRequestKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeNewRequestDialog();
      return;
    }
    if (e.key === "Tab") trapFocus(document.getElementById("new-request-dialog"), e);
  }

  function handleNewRequestSubmit(e) {
    e.preventDefault();
    const status = document.getElementById("nr-status").value;
    const costValue = document.getElementById("nr-cost").value;

    const rawRow = {
      id: getNextRequestId(),
      date_created: document.getElementById("nr-date-created").value,
      property: document.getElementById("nr-property").value.trim(),
      tenant: document.getElementById("nr-tenant").value.trim(),
      issue: document.getElementById("nr-issue").value.trim(),
      category: document.getElementById("nr-category").value,
      priority: document.getElementById("nr-priority").value,
      status: status,
      assigned_to: document.getElementById("nr-assigned").value.trim(),
      date_resolved: status === "Resolved" ? document.getElementById("nr-date-resolved").value : "",
      cost: costValue !== "" ? costValue : "",
      cost_date: costValue !== "" ? document.getElementById("nr-cost-date").value : "",
      ai_summary: document.getElementById("nr-ai-summary").value.trim()
    };

    const errorEl = document.getElementById("new-request-error");

    if (!rawRow.property) {
      errorEl.textContent = "Property is required.";
      errorEl.hidden = false;
      return;
    }
    if (!rawRow.issue) {
      errorEl.textContent = "Issue is required.";
      errorEl.hidden = false;
      return;
    }
    if (state.rows.some((r) => r.id === rawRow.id)) {
      errorEl.textContent = "Could not generate a unique request ID. Please try again.";
      errorEl.hidden = false;
      return;
    }

    const { clean, errors } = validateRows([rawRow]);
    if (errors.length > 0) {
      errorEl.textContent = errors[0].replace(/^row \d+ \([^)]*\): /, "");
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    state.rows.push(clean[0]);
    populatePropertySelect(state.rows);
    renderAll();
    closeNewRequestDialog();
    showStatusBanner("Added " + clean[0].id + " for " + clean[0].property + ".", "info");
  }

  // ---- Top-level render / wiring ----------------------------------------

  function renderAll() {
    const rowsForProperty = filterByProperty(state.rows, state.property);
    renderKpis(rowsForProperty);
    renderWeather();
    renderCharts(rowsForProperty);
    renderRequestsSection(rowsForProperty);
    renderCosts(state.rows);
    renderVendorTickets(rowsForProperty);
  }

  function wireTabs() {
    const openTab = document.getElementById("tab-open");
    const resolvedTab = document.getElementById("tab-resolved");
    openTab.addEventListener("click", () => {
      state.tab = "open";
      renderRequestsSection(filterByProperty(state.rows, state.property));
    });
    resolvedTab.addEventListener("click", () => {
      state.tab = "resolved";
      renderRequestsSection(filterByProperty(state.rows, state.property));
    });
  }

  function wireDialog() {
    document.getElementById("dialog-close").addEventListener("click", closeDialog);
    document.getElementById("dialog-overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeDialog();
    });
  }

  function wireNewRequestDialog() {
    populateSelect(document.getElementById("nr-category"), CATEGORIES);
    populateSelect(document.getElementById("nr-priority"), PRIORITIES);
    populateSelect(document.getElementById("nr-status"), STATUSES);

    document.getElementById("new-request-btn").addEventListener("click", (e) => openNewRequestDialog(e.currentTarget));
    document.getElementById("new-request-close").addEventListener("click", closeNewRequestDialog);
    document.getElementById("new-request-cancel").addEventListener("click", closeNewRequestDialog);
    document.getElementById("new-request-overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeNewRequestDialog();
    });
    document.getElementById("new-request-form").addEventListener("submit", handleNewRequestSubmit);
    document.getElementById("nr-status").addEventListener("change", updateNewRequestConditionalFields);
    document.getElementById("nr-cost").addEventListener("input", updateNewRequestConditionalFields);
    document.getElementById("nr-date-created").addEventListener("change", (e) => {
      document.getElementById("nr-date-resolved").min = e.target.value;
      document.getElementById("nr-cost-date").min = e.target.value;
    });
  }

  // ---- CSV upload ------------------------------------------------------

  async function handleCsvUpload(file) {
    let text;
    try {
      text = await file.text();
    } catch (err) {
      showStatusBanner("Could not read " + file.name + ".", "error");
      return;
    }

    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const { clean, errors } = validateRows(parsed.data);

    if (clean.length === 0) {
      showStatusBanner("Could not load " + file.name + ": no valid rows found. Keeping the current data.", "error");
      if (errors.length > 0) console.error("Uploaded CSV validation errors:\n" + errors.join("\n"));
      return;
    }

    state.rows = clean;
    state.property = ALL_PROPERTIES;
    state.dataSource = "csv";
    updateDataSourceBadge();
    populatePropertySelect(state.rows);
    renderAll();

    if (errors.length > 0) {
      console.error("Uploaded CSV validation errors:\n" + errors.join("\n"));
      showStatusBanner(
        clean.length + " request(s) loaded from " + file.name + "; " + errors.length + " row(s) were skipped (see console).",
        "error"
      );
    } else {
      showStatusBanner(
        "Loaded " + clean.length + " request(s) from " + file.name + ". This replaces the sample data for this browser session only.",
        "info"
      );
    }
  }

  function wireCsvUpload() {
    const uploadBtn = document.getElementById("upload-csv-btn");
    const fileInput = document.getElementById("csv-upload-input");
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) handleCsvUpload(file);
    });
  }

  function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function wireDemoCsvDownload() {
    document.getElementById("demo-csv-link").addEventListener("click", () => {
      downloadTextFile("demo_upload_sample.csv", DEMO_CSV, "text/csv");
    });
  }

  // ---- Weather & Property Alerts -----------------------------------------
  // One card per property: the full address is located with the US Census
  // Geocoder, a 7-day forecast comes from Open-Meteo, and the card shows
  // today's weather, a 7-day strip, and rule-based maintenance alerts.
  // Neither service needs an API key.

  const WEATHER_REFRESH_MS = 15 * 60 * 1000;
  const GEOCODE_CACHE_KEY = "dashboardPractice.geocodes.v1";
  const weatherCache = new Map(); // full address -> { status, data, error, fetchedAt, refreshing }

  const WEATHER_CODES = {
    0: ["Clear sky", "clear"], 1: ["Mainly clear", "clear"], 2: ["Partly cloudy", "partly"], 3: ["Overcast", "cloudy"],
    45: ["Fog", "fog"], 48: ["Freezing fog", "fog"],
    51: ["Light drizzle", "drizzle"], 53: ["Drizzle", "drizzle"], 55: ["Heavy drizzle", "drizzle"],
    56: ["Freezing drizzle", "freezing-rain"], 57: ["Freezing drizzle", "freezing-rain"],
    61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "heavy-rain"],
    66: ["Freezing rain", "freezing-rain"], 67: ["Heavy freezing rain", "freezing-rain"],
    71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 77: ["Snow grains", "snow"],
    80: ["Light rain showers", "rain"], 81: ["Rain showers", "rain"], 82: ["Violent rain showers", "heavy-rain"],
    85: ["Snow showers", "snow"], 86: ["Heavy snow showers", "snow"],
    95: ["Thunderstorm", "thunder"], 96: ["Thunderstorm with hail", "thunder"], 99: ["Severe thunderstorm with hail", "thunder"]
  };

  function describeWeather(code, isDay) {
    const entry = WEATHER_CODES[code] || ["Unknown", "cloudy"];
    return { label: entry[0], kind: entry[1], night: isDay === 0 };
  }

  // -- Illustrations (static SVG strings; no user data is ever put in them) --

  const CLOUD_PATH = "M26 56 C12 56 4 47 4 37 C4 27 12 20 22 19 C25 8 35 1 47 1 C59 1 68 7 72 17 C85 17 96 26 96 38 C96 48 88 56 76 56 Z";
  const CLOUD_WHITE = ["#FFFFFF", "#B9C6DA"];
  const CLOUD_GRAY = ["#E4EAF2", "#A9B7CC"];
  const CLOUD_DARK = ["#CBD3E3", "#97A5BF"];
  const CLOUD_STORM = ["#CFC9E6", "#9A93C0"];

  function svgCloud(x, y, scale, colors) {
    return '<g transform="translate(' + x + " " + y + ") scale(" + scale + ')"><path d="' + CLOUD_PATH +
      '" fill="' + colors[0] + '" stroke="' + colors[1] + '" stroke-width="3" stroke-linejoin="round"/></g>';
  }

  function svgSun(cx, cy, r) {
    let rays = "";
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      rays += '<line x1="' + (cx + Math.cos(a) * (r + 6)).toFixed(1) + '" y1="' + (cy + Math.sin(a) * (r + 6)).toFixed(1) +
        '" x2="' + (cx + Math.cos(a) * (r + 14)).toFixed(1) + '" y2="' + (cy + Math.sin(a) * (r + 14)).toFixed(1) + '"/>';
    }
    return '<g stroke="#F5C75A" stroke-width="4" stroke-linecap="round">' + rays + "</g>" +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#FDE08A" stroke="#F0B94A" stroke-width="3"/>';
  }

  function svgMoon(cx, cy, r) {
    const d = r * 0.55;
    const h = Math.sqrt(r * r - (d / 2) * (d / 2));
    const tx = (cx + d / 2).toFixed(1);
    return '<path d="M' + tx + " " + (cy - h).toFixed(1) + " A" + r + " " + r + " 0 1 0 " + tx + " " + (cy + h).toFixed(1) +
      " A" + r + " " + r + " 0 0 1 " + tx + " " + (cy - h).toFixed(1) +
      ' Z" fill="#F6EFC8" stroke="#D9CC8E" stroke-width="3" stroke-linejoin="round"/>';
  }

  function svgDrops(xs, y, length, width) {
    return '<g stroke="#6FAEE0" stroke-width="' + width + '" stroke-linecap="round">' +
      xs.map((x) => '<path d="M' + x + " " + y + " l-" + (length * 0.28).toFixed(1) + " " + length + '"/>').join("") + "</g>";
  }

  function svgFlake(x, y) {
    return '<g transform="translate(' + x + " " + y + ')" stroke="#8FC1EA" stroke-width="3" stroke-linecap="round">' +
      '<path d="M-6 0H6M0 -6V6M-4.2 -4.2L4.2 4.2M-4.2 4.2L4.2 -4.2"/></g>';
  }

  function weatherIconSvg(kind, night) {
    let body = "";
    switch (kind) {
      case "clear":
        body = night
          ? svgMoon(58, 62, 32) + '<g fill="#F6EFC8"><circle cx="96" cy="26" r="3"/><circle cx="104" cy="52" r="2"/><circle cx="26" cy="22" r="2.5"/></g>'
          : svgSun(60, 60, 28);
        break;
      case "partly":
        body = (night ? svgMoon(42, 42, 24) : svgSun(42, 42, 22)) + svgCloud(14, 46, 0.95, CLOUD_WHITE);
        break;
      case "cloudy":
        body = svgCloud(40, 18, 0.7, CLOUD_GRAY) + svgCloud(8, 40, 1, CLOUD_WHITE);
        break;
      case "fog":
        body = svgCloud(16, 12, 0.9, CLOUD_WHITE) +
          '<g stroke="#B4C0D1" stroke-width="5" stroke-linecap="round"><path d="M22 80H98M32 92H88M22 104H98"/></g>';
        break;
      case "drizzle":
        body = svgCloud(10, 16, 1, CLOUD_GRAY) + svgDrops([36, 58, 80], 88, 10, 3.5);
        break;
      case "rain":
        body = svgCloud(10, 14, 1, CLOUD_GRAY) + svgDrops([34, 52, 70, 88], 82, 16, 4);
        break;
      case "heavy-rain":
        body = svgCloud(10, 8, 1, CLOUD_DARK) + svgDrops([26, 58, 90], 76, 14, 4.5) + svgDrops([42, 74], 94, 14, 4.5);
        break;
      case "freezing-rain":
        body = svgCloud(10, 14, 1, CLOUD_GRAY) + svgDrops([34, 72], 82, 16, 4) + svgFlake(54, 98) + svgFlake(92, 98);
        break;
      case "snow":
        body = svgCloud(10, 14, 1, CLOUD_WHITE) + svgFlake(34, 90) + svgFlake(62, 102) + svgFlake(88, 90);
        break;
      case "thunder":
        body = svgCloud(10, 6, 1, CLOUD_STORM) + svgDrops([28, 94], 76, 14, 4) +
          '<polygon points="64,58 46,90 60,90 52,116 84,80 68,80 78,58" fill="#FFD24D" stroke="#E0A92B" stroke-width="2.5" stroke-linejoin="round"/>';
        break;
      default:
        body = svgCloud(10, 30, 1, CLOUD_GRAY);
    }
    return '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">' + body + "</svg>";
  }

  const ALERT_ICON_PATHS = {
    freeze: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/>',
    rain: '<path d="M12 3C12 3 5 11 5 15a7 7 0 0 0 14 0C19 11 12 3 12 3Z"/>',
    snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
    heat: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
  };

  function alertIconSvg(type) {
    return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ALERT_ICON_PATHS[type] || "") + "</svg>";
  }

  // -- Maintenance alert rules (units: °F, inches, mph) --

  // Each alert: type, risk ("moderate" | "high"), title, a short metric for compact
  // display, and one line of advice.
  function alertsForDay(day) {
    const out = [];
    if (day.low <= 32) {
      const hard = day.low <= 20;
      out.push({
        type: "freeze", risk: hard ? "high" : "moderate", title: hard ? "Hard freeze" : "Freezing temps",
        metric: "Low " + Math.round(day.low) + "°F",
        advice: "Protect exposed pipes and outdoor spigots; confirm heat is working."
      });
    }
    if (day.rain >= 1) {
      out.push({
        type: "rain", risk: day.rain >= 2 ? "high" : "moderate", title: "Heavy rain",
        metric: day.rain.toFixed(1) + " in",
        advice: "Check gutters, drains, sump pumps, and basements."
      });
    }
    if (day.snow >= 1) {
      out.push({
        type: "snow", risk: day.snow >= 4 ? "high" : "moderate", title: "Snow",
        metric: day.snow.toFixed(1) + " in",
        advice: "Plan plowing and salting; check walkways and roof load."
      });
    }
    if (day.gust >= 40) {
      out.push({
        type: "wind", risk: day.gust >= 58 ? "high" : "moderate", title: "Strong winds",
        metric: "Gusts " + Math.round(day.gust) + " mph",
        advice: "Secure loose items; watch roofs, fences, and trees."
      });
    }
    if (day.high >= 90) {
      out.push({
        type: "heat", risk: day.high >= 100 ? "high" : "moderate", title: "Extreme heat",
        metric: "High " + Math.round(day.high) + "°F",
        advice: "Expect heavy AC demand; check cooling systems."
      });
    }
    return out;
  }

  function alertsByDay(days) {
    return days
      .map((day, index) => ({ index, date: day.date, alerts: alertsForDay(day) }))
      .filter((d) => d.alerts.length > 0);
  }

  // -- Location + forecast lookups --

  function readGeocodeCache() {
    try { return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}") || {}; } catch (err) { return {}; }
  }

  function writeGeocodeCache(address, value) {
    try {
      const cache = readGeocodeCache();
      cache[address] = value;
      localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
    } catch (err) { /* storage unavailable: just skip caching */ }
  }

  let jsonpCounter = 0;

  // The Census geocoder sends no CORS headers, so a normal fetch() from the
  // page is blocked; its JSONP mode works from anywhere.
  function jsonpRequest(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const callbackName = "__dashboardJsonp" + (++jsonpCounter);
      const script = document.createElement("script");
      const finish = () => {
        clearTimeout(timer);
        delete window[callbackName];
        script.remove();
      };
      const timer = setTimeout(() => { finish(); reject(new Error("The address lookup timed out")); }, timeoutMs || 15000);
      window[callbackName] = (data) => { finish(); resolve(data); };
      script.onerror = () => { finish(); reject(new Error("The address lookup failed")); };
      script.src = url + "&callback=" + callbackName;
      document.head.appendChild(script);
    });
  }

  async function geocodeAddress(address) {
    const cached = readGeocodeCache()[address];
    if (cached) return cached;

    let result = null;
    try {
      const data = await jsonpRequest(
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=jsonp&address=" + encodeURIComponent(address)
      );
      const match = data && data.result && data.result.addressMatches && data.result.addressMatches[0];
      if (match) result = { lat: match.coordinates.y, lon: match.coordinates.x, approximate: false };
    } catch (err) {
      // fall through to the ZIP-area fallback
    }

    if (result) {
      writeGeocodeCache(address, result);
      return result;
    }

    // No exact match: use the ZIP code's area (not cached, so the exact lookup is retried next time).
    const zip = (address.match(/\b(\d{5})(?:-\d{4})?\s*$/) || [])[1];
    if (zip) {
      const res = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=" + zip);
      if (res.ok) {
        const data = await res.json();
        const hit = (data.results || []).find((r) => r.country_code === "US");
        if (hit) return { lat: hit.latitude, lon: hit.longitude, approximate: true };
      }
    }
    throw new Error("Could not locate this address");
  }

  async function fetchForecast(lat, lon) {
    const params = new URLSearchParams({
      latitude: lat, longitude: lon, timezone: "auto", forecast_days: "7",
      temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
      current: "temperature_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,rain_sum,showers_sum,snowfall_sum,wind_gusts_10m_max"
    });
    const res = await fetch("https://api.open-meteo.com/v1/forecast?" + params.toString());
    if (!res.ok) throw new Error("The weather service returned an error (HTTP " + res.status + ")");
    const raw = await res.json();

    const num = (v, fallback) => (typeof v === "number" ? v : fallback);
    const d = raw.daily;
    return {
      current: {
        temp: raw.current.temperature_2m,
        isDay: raw.current.is_day,
        code: raw.current.weather_code,
        wind: raw.current.wind_speed_10m,
        windDir: raw.current.wind_direction_10m
      },
      days: d.time.map((date, i) => ({
        date,
        code: d.weather_code[i],
        high: d.temperature_2m_max[i],
        low: d.temperature_2m_min[i],
        rainChance: num(d.precipitation_probability_max[i], 0),
        rain: num(d.rain_sum[i], 0) + num(d.showers_sum[i], 0),
        snow: num(d.snowfall_sum[i], 0),
        gust: num(d.wind_gusts_10m_max[i], 0)
      }))
    };
  }

  async function loadWeather(address) {
    const geo = await geocodeAddress(address);
    const forecast = await fetchForecast(geo.lat, geo.lon);
    return { geo, current: forecast.current, days: forecast.days };
  }

  // Starts a fetch when there's no usable cache entry; the section re-renders when it finishes.
  function ensureWeather(address) {
    const entry = weatherCache.get(address);
    if (entry && (entry.status === "loading" || entry.status === "error")) return;
    if (entry && entry.status === "ok" && (entry.refreshing || Date.now() - entry.fetchedAt < WEATHER_REFRESH_MS)) return;

    if (entry) entry.refreshing = true;
    else weatherCache.set(address, { status: "loading" });

    loadWeather(address)
      .then((data) => {
        weatherCache.set(address, { status: "ok", data, fetchedAt: Date.now() });
      })
      .catch((err) => {
        // Keep showing older data if a background refresh fails.
        if (entry && entry.data) { entry.refreshing = false; entry.fetchedAt = Date.now(); }
        else weatherCache.set(address, { status: "error", error: err.message || "Weather is unavailable", fetchedAt: Date.now() });
      })
      .finally(renderWeather);
  }

  // -- Rendering --

  function makeEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  // -- Condition images --
  // Photographic-style skies drawn in the browser: fractal-noise clouds with
  // lighting, sun and moon glow, rain, snow, lightning, and stars. Nothing is
  // downloaded or stored in the repo, and one image per condition is cached.

  const sceneCache = new Map();

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smoothstep = (e0, e1, x) => {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  };
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function hash2(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function valueNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function fbm(x, y, octaves, seed) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }

  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // thr/soft control cloud coverage (lower thr = more cloud); colors are RGB.
  const DAY_SKY = { top: [26, 98, 190], bottom: [170, 214, 247] };
  const SCENE_DEFS = {
    "clear": Object.assign({ seed: 11, sun: { x: 0.82, y: 0.3, r: 0.05, glow: 0.8 }, haze: [214, 232, 250, 0.35],
      cloud: { thr: 0.67, soft: 0.14, scale: 3.4, light: [255, 255, 255], shadow: [188, 204, 226], opacity: 0.9, fadeBottom: true } }, DAY_SKY),
    "partly": Object.assign({ seed: 23, sun: { x: 0.82, y: 0.3, r: 0.05, glow: 0.8 }, haze: [214, 232, 250, 0.3],
      cloud: { thr: 0.43, soft: 0.2, scale: 2.6, light: [255, 255, 255], shadow: [172, 190, 216], opacity: 0.97, fadeBottom: true } }, DAY_SKY),
    "cloudy": { seed: 31, top: [118, 132, 150], bottom: [190, 200, 212], light: [0.3, -0.9],
      cloud: { thr: 0.3, soft: 0.28, scale: 3.2, light: [228, 233, 240], shadow: [102, 114, 132], opacity: 1 } },
    "fog": { seed: 41, top: [176, 184, 192], bottom: [222, 226, 229], haze: [226, 229, 232, 0.7], light: [0.3, -0.9],
      cloud: { thr: 0.42, soft: 0.3, scale: 2.2, light: [238, 240, 242], shadow: [190, 196, 202], opacity: 0.55 } },
    "drizzle": { seed: 51, top: [92, 104, 122], bottom: [160, 170, 184], haze: [180, 188, 198, 0.35], light: [0.3, -0.9],
      cloud: { thr: 0.26, soft: 0.28, scale: 3, light: [170, 178, 192], shadow: [78, 88, 106], opacity: 1 }, rain: { count: 90, tint: "218,228,240", shortDrops: true } },
    "rain": { seed: 61, top: [64, 76, 96], bottom: [128, 142, 160], haze: [150, 160, 174, 0.35], light: [0.3, -0.9],
      cloud: { thr: 0.22, soft: 0.3, scale: 3, light: [152, 162, 178], shadow: [56, 64, 82], opacity: 1 }, rain: { count: 190, tint: "220,232,246" } },
    "heavy-rain": { seed: 71, top: [42, 50, 68], bottom: [96, 108, 126], haze: [110, 120, 136, 0.45], light: [0.3, -0.9],
      cloud: { thr: 0.18, soft: 0.3, scale: 3, light: [120, 130, 148], shadow: [34, 40, 56], opacity: 1 }, rain: { count: 340, tint: "210,224,242" } },
    "freezing-rain": { seed: 81, top: [72, 88, 112], bottom: [150, 166, 188], haze: [176, 190, 208, 0.35], light: [0.3, -0.9],
      cloud: { thr: 0.22, soft: 0.3, scale: 3, light: [168, 182, 202], shadow: [66, 78, 100], opacity: 1 }, rain: { count: 150, tint: "214,232,252" }, sparkle: 60 },
    "snow": { seed: 91, top: [126, 142, 162], bottom: [208, 218, 230], haze: [226, 232, 240, 0.5], light: [0.3, -0.9],
      cloud: { thr: 0.28, soft: 0.3, scale: 3, light: [238, 242, 247], shadow: [138, 152, 170], opacity: 1 }, snow: { count: 190 } },
    "thunder": { seed: 101, top: [34, 36, 58], bottom: [92, 88, 116], haze: [104, 98, 128, 0.35], light: [0.3, -0.9],
      cloud: { thr: 0.2, soft: 0.3, scale: 2.8, light: [134, 126, 162], shadow: [24, 24, 42], opacity: 1 }, rain: { count: 200, tint: "200,208,240" }, lightning: true },
    "clear-night": { seed: 111, top: [6, 14, 42], bottom: [38, 60, 112], haze: [58, 84, 140, 0.25],
      moon: { x: 0.82, y: 0.3, r: 0.05, glow: 0.7 }, stars: 150 },
    "partly-night": { seed: 121, top: [6, 14, 42], bottom: [38, 60, 112], haze: [58, 84, 140, 0.2],
      moon: { x: 0.82, y: 0.3, r: 0.05, glow: 0.7 }, stars: 70,
      cloud: { thr: 0.46, soft: 0.24, scale: 3.4, light: [150, 170, 206], shadow: [22, 34, 64], opacity: 0.95, fadeBottom: true } }
  };

  function renderWeatherScene(def, night) {
    const W = 440, H = 220;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    const image = ctx.createImageData(W, H);
    const px = image.data;
    const aspect = W / H;
    const cl = def.cloud;
    const seed = def.seed;
    const lightSource = def.sun || def.moon;
    const light = def.light || (lightSource ? [0.55, -0.6] : [0.3, -0.9]);

    for (let y = 0; y < H; y++) {
      const ty = y / H;
      const sky = mixRgb(def.top, def.bottom, Math.pow(ty, 0.8));
      for (let x = 0; x < W; x++) {
        const tx = x / W;
        let r = sky[0], g = sky[1], b = sky[2];

        if (def.sun) {
          const dx = (tx - def.sun.x) * aspect, dy = ty - def.sun.y;
          const d2 = dx * dx + dy * dy;
          const glow = Math.exp(-d2 / 0.045) * def.sun.glow + Math.exp(-d2 / 0.5) * 0.18;
          r += 255 * glow; g += 238 * glow; b += 200 * glow;
          const core = 1 - smoothstep(def.sun.r * 0.8, def.sun.r, Math.sqrt(d2));
          r += (255 - r) * core; g += (252 - g) * core; b += (240 - b) * core;
        }
        if (def.moon) {
          const dx = (tx - def.moon.x) * aspect, dy = ty - def.moon.y;
          const d2 = dx * dx + dy * dy;
          const glow = Math.exp(-d2 / 0.02) * def.moon.glow;
          r += 170 * glow; g += 190 * glow; b += 235 * glow;
          const core = 1 - smoothstep(def.moon.r * 0.92, def.moon.r, Math.sqrt(d2));
          if (core > 0) {
            const tex = 0.84 + 0.16 * fbm(tx * 34, ty * 34, 3, 91);
            r += (240 * tex - r) * core; g += (238 * tex - g) * core; b += (226 * tex - b) * core;
          }
        }
        if (cl) {
          const nx = tx * cl.scale * aspect, ny = ty * cl.scale;
          const warp = fbm(nx * 0.55 + 11.3, ny * 0.55 + 4.1, 3, seed + 3);
          const qx = nx + warp * 1.3, qy = ny + warp * 1.3;
          const dens = fbm(qx, qy, 6, seed);
          const a0 = smoothstep(cl.thr, cl.thr + cl.soft, dens);
          if (a0 > 0.003) {
            const dens2 = fbm(qx + light[0] * 0.07, qy + light[1] * 0.07, 6, seed);
            const lit = clamp01(0.6 + (dens - dens2) * 9);
            const body = smoothstep(cl.thr, cl.thr + 0.3, dens);
            const col = mixRgb(cl.light, cl.shadow, (1 - lit) * (0.25 + 0.75 * body));
            const a = a0 * cl.opacity * (cl.fadeBottom ? 1 - 0.65 * smoothstep(0.78, 1, ty) : 1);
            r += (col[0] - r) * a; g += (col[1] - g) * a; b += (col[2] - b) * a;
          }
        }
        if (def.haze) {
          const hz = def.haze[3] * Math.pow(ty, 1.6);
          r += (def.haze[0] - r) * hz; g += (def.haze[1] - g) * hz; b += (def.haze[2] - b) * hz;
        }
        const i = (y * W + x) * 4;
        px[i] = r > 255 ? 255 : r < 0 ? 0 : r;
        px[i + 1] = g > 255 ? 255 : g < 0 ? 0 : g;
        px[i + 2] = b > 255 ? 255 : b < 0 ? 0 : b;
        px[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);

    const rand = seededRandom(seed * 7919);

    if (def.stars) {
      for (let i = 0; i < def.stars; i++) {
        const sx = rand() * W, sy = rand() * H * 0.78, br = Math.pow(rand(), 3);
        ctx.fillStyle = "rgba(255,255,255," + (0.25 + br * 0.75).toFixed(2) + ")";
        ctx.beginPath();
        ctx.arc(sx, sy, 0.5 + br * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (def.rain) {
      ctx.lineCap = "round";
      for (let i = 0; i < def.rain.count; i++) {
        const depth = rand();
        const len = (def.rain.shortDrops ? 4 : 7) + depth * (def.rain.shortDrops ? 9 : 22);
        const sx = rand() * (W + 40), sy = rand() * H;
        ctx.strokeStyle = "rgba(" + def.rain.tint + "," + (0.12 + depth * 0.42).toFixed(2) + ")";
        ctx.lineWidth = 0.6 + depth * 1.1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - len * 0.22, sy + len);
        ctx.stroke();
      }
    }
    if (def.snow) {
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < def.snow.count; i++) {
        const depth = rand();
        ctx.globalAlpha = 0.35 + depth * 0.55;
        ctx.shadowColor = "rgba(255,255,255,0.9)";
        ctx.shadowBlur = depth > 0.7 ? 4 : 0;
        ctx.beginPath();
        ctx.arc(rand() * W, rand() * H, 0.8 + depth * 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    if (def.sparkle) {
      ctx.fillStyle = "rgba(235,248,255,0.85)";
      for (let i = 0; i < def.sparkle; i++) {
        ctx.beginPath();
        ctx.arc(rand() * W, rand() * H, 0.7 + rand() * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (def.lightning) {
      let lx = W * (0.55 + rand() * 0.2), ly = 0;
      const pts = [[lx, ly]];
      while (ly < H * 0.78) {
        ly += 10 + rand() * 16;
        lx += (rand() - 0.5) * 26;
        pts.push([lx, ly]);
      }
      const stroke = (width, style, blur) => {
        ctx.lineWidth = width;
        ctx.strokeStyle = style;
        ctx.shadowColor = "rgba(190,175,255,0.9)";
        ctx.shadowBlur = blur;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.stroke();
      };
      stroke(5, "rgba(170,160,255,0.35)", 18);
      stroke(1.8, "rgba(255,255,255,0.95)", 8);
      ctx.shadowBlur = 0;
      const flash = ctx.createRadialGradient(pts[0][0], 0, 4, pts[0][0], H * 0.3, W * 0.5);
      flash.addColorStop(0, "rgba(210,200,255,0.28)");
      flash.addColorStop(1, "rgba(210,200,255,0)");
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, W, H);
    }
    if (night && !def.moon) {
      ctx.fillStyle = "rgba(8,14,34,0.42)";
      ctx.fillRect(0, 0, W, H);
    }
    return canvas.toDataURL("image/jpeg", 0.86);
  }

  function weatherSceneUrl(info) {
    const base = info.night && (info.kind === "clear" || info.kind === "partly") ? info.kind + "-night" : info.kind;
    const key = base + (info.night ? ":n" : ":d");
    if (!sceneCache.has(key)) {
      let url = "";
      try {
        url = renderWeatherScene(SCENE_DEFS[base] || SCENE_DEFS.cloudy, info.night);
      } catch (err) {
        url = ""; // the card still works with its plain gradient background
      }
      sceneCache.set(key, url);
    }
    return sceneCache.get(key);
  }

  // -- Card pieces --

  function dayLabel(date, index) {
    if (index === 0) return "Today";
    return toDateObj(date).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  }

  function shortDate(date) {
    return toDateObj(date).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) + " " + toDateObj(date).getUTCDate();
  }

  function weatherChip(label, value, extraNode) {
    const li = makeEl("li", "weather-chip");
    li.appendChild(makeEl("span", "weather-chip-label", label));
    if (extraNode) li.appendChild(extraNode);
    li.appendChild(makeEl("span", "weather-chip-value", value));
    return li;
  }

  // Current temperature and conditions overlaid on the condition image.
  function buildWeatherPhoto(data) {
    const cur = data.current;
    const info = describeWeather(cur.code, cur.isDay);

    const photo = makeEl("div", "weather-photo");
    const url = weatherSceneUrl(info);
    if (url) photo.style.backgroundImage = 'url("' + url + '")';

    const main = makeEl("div", "weather-photo-main");
    main.appendChild(makeEl("div", "weather-temp", Math.round(cur.temp) + "°"));
    main.appendChild(makeEl("div", "weather-condition", info.label));

    const arrow = makeEl("span", "weather-wind-arrow", "↑");
    arrow.setAttribute("aria-hidden", "true");
    arrow.style.transform = "rotate(" + (Math.round(cur.windDir) + 180) + "deg)";

    const chips = makeEl("ul", "weather-chips");
    chips.appendChild(weatherChip("Wind", Math.round(cur.wind) + " mph " + COMPASS[Math.round(cur.windDir / 22.5) % 16], arrow));
    chips.appendChild(weatherChip("Rain", Math.round(data.days[0].rainChance) + "%"));

    photo.append(main, chips);
    return photo;
  }

  function buildForecastStrip(data, alertDays) {
    const list = makeEl("ol", "weather-forecast");
    list.setAttribute("aria-label", "7-day forecast");
    data.days.forEach((day, i) => {
      // Today's icon follows the current conditions shown above, like a weather app.
      const info = describeWeather(i === 0 ? data.current.code : day.code, 1);
      const li = makeEl("li", "weather-day" + (i === 0 ? " is-today" : ""));
      li.title = info.label + ", " + Math.round(day.rainChance) + "% chance of rain";

      li.appendChild(makeEl("span", "weather-day-name", dayLabel(day.date, i)));
      const icon = makeEl("span", "weather-day-icon");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = weatherIconSvg(info.kind, false);
      li.appendChild(icon);
      li.appendChild(makeEl("span", "visually-hidden", info.label));
      li.appendChild(makeEl("span", "weather-day-high", Math.round(day.high) + "°"));
      li.appendChild(makeEl("span", "weather-day-low", Math.round(day.low) + "°"));

      const flagged = alertDays.find((a) => a.index === i);
      if (flagged) {
        const high = flagged.alerts.some((a) => a.risk === "high");
        const dot = makeEl("span", "weather-day-flag weather-day-flag--" + (high ? "high" : "moderate"));
        dot.title = flagged.alerts.map((a) => a.title).join(", ");
        li.appendChild(dot);
        li.appendChild(makeEl("span", "visually-hidden", "Maintenance alert: " + dot.title));
      }
      list.appendChild(li);
    });
    return list;
  }

  function alertIconNode(type) {
    const icon = makeEl("span", "alert-icon");
    icon.innerHTML = alertIconSvg(type);
    return icon;
  }

  // Today's alerts: a filled, high-contrast panel so they stand out immediately.
  function buildTodayAlerts(group) {
    const level = group.alerts.some((a) => a.risk === "high") ? "high" : "moderate";
    const panel = makeEl("div", "alert-today alert-today--" + level);
    const label = makeEl("div", "alert-today-label");
    label.appendChild(makeEl("span", "alert-today-pill", "Today"));
    label.appendChild(document.createTextNode(toDateObj(group.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })));
    panel.appendChild(label);

    group.alerts.forEach((a) => {
      const row = makeEl("div", "alert-today-item alert-today-item--" + a.risk);
      const text = makeEl("div", "alert-today-text");
      const head = makeEl("div", "alert-today-head");
      head.appendChild(makeEl("strong", "", a.title));
      head.appendChild(makeEl("span", "alert-metric", a.metric));
      head.appendChild(makeEl("span", "alert-risk-tag", a.risk === "high" ? "High risk" : "Moderate"));
      text.append(head, makeEl("div", "alert-advice", a.advice));
      row.append(alertIconNode(a.type), text);
      panel.appendChild(row);
    });
    return panel;
  }

  // Later days: one compact line per day.
  function buildUpcomingAlerts(groups) {
    const list = makeEl("ul", "alert-upcoming");
    groups.forEach((group) => {
      const li = makeEl("li", "alert-upcoming-day");
      li.appendChild(makeEl("span", "alert-upcoming-name", shortDate(group.date)));
      const chips = makeEl("span", "alert-chips");
      group.alerts.forEach((a) => {
        const chip = makeEl("span", "alert-chip alert-chip--" + a.risk);
        chip.title = a.advice + " (" + (a.risk === "high" ? "high" : "moderate") + " risk)";
        chip.append(alertIconNode(a.type), document.createTextNode(a.title + " · " + a.metric));
        chip.appendChild(makeEl("span", "visually-hidden", ". " + a.advice));
        chips.appendChild(chip);
      });
      li.appendChild(chips);
      list.appendChild(li);
    });
    return list;
  }

  function buildAlertsBlock(alertDays) {
    const block = makeEl("div", "weather-alerts");
    block.setAttribute("role", "group");
    block.setAttribute("aria-label", "Maintenance alerts for the next 7 days");

    if (alertDays.length === 0) {
      const none = makeEl("p", "weather-no-alerts");
      const icon = makeEl("span", "weather-no-alerts-icon");
      icon.innerHTML = alertIconSvg("ok");
      none.append(icon, document.createTextNode("No weather risks in the next 7 days"));
      block.appendChild(none);
      return block;
    }

    const today = alertDays.find((d) => d.index === 0);
    if (today) block.appendChild(buildTodayAlerts(today));
    const later = alertDays.filter((d) => d.index !== 0);
    if (later.length > 0) {
      block.appendChild(makeEl("div", "weather-alerts-title", today ? "Also coming up" : "Upcoming alerts"));
      block.appendChild(buildUpcomingAlerts(later));
    }
    return block;
  }

  // "10 Harbor View, Holtwood, PA 17532" under a card titled "10 Harbor View" shows just "Holtwood, PA 17532".
  function weatherPlaceLine(target) {
    const parts = (target.address || "").split(",");
    if (parts.length > 1 && parts[0].trim().toLowerCase() === target.name.trim().toLowerCase()) {
      return parts.slice(1).join(",").trim();
    }
    return target.address;
  }

  function buildWeatherCard(target, entry) {
    const card = makeEl("article", "weather-card");
    const head = makeEl("header", "weather-card-head");
    const title = makeEl("div", "weather-card-title");
    title.appendChild(makeEl("h3", "", target.name));
    let place = null;
    if (target.address) {
      place = makeEl("p", "weather-place", weatherPlaceLine(target));
      place.title = target.address;
      title.appendChild(place);
    }
    head.appendChild(title);
    card.appendChild(head);

    if (!target.address) {
      card.appendChild(makeEl("p", "weather-note", "No full address on file. It comes from the Airtable Properties table."));
      return card;
    }
    if (!entry || (entry.status === "loading" && !entry.data)) {
      card.appendChild(makeEl("p", "weather-note", "Loading weather…"));
      return card;
    }
    if (entry.status === "error") {
      card.appendChild(makeEl("p", "weather-note weather-note--error", "Weather is unavailable: " + entry.error + "."));
      const retry = makeEl("button", "btn btn-secondary", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => {
        weatherCache.delete(target.address);
        renderWeather();
      });
      card.appendChild(retry);
      return card;
    }

    const data = entry.data;
    const alertDays = alertsByDay(data.days);
    const todayAlerts = alertDays.find((d) => d.index === 0);

    if (data.geo.approximate && place) {
      const approx = makeEl("span", "weather-approx", " · approx. location");
      approx.title = "The exact address wasn't found, so this uses the ZIP code's area.";
      place.appendChild(approx);
    }
    if (todayAlerts) {
      const n = todayAlerts.alerts.length;
      const high = todayAlerts.alerts.some((a) => a.risk === "high");
      head.appendChild(makeEl("span", "weather-today-pill weather-today-pill--" + (high ? "high" : "moderate"),
        n + " alert" + (n === 1 ? "" : "s") + " today"));
      card.classList.add("weather-card--alert-" + (high ? "high" : "moderate"));
    }

    card.append(buildWeatherPhoto(data), buildForecastStrip(data, alertDays), buildAlertsBlock(alertDays));
    return card;
  }

  function weatherTargets() {
    const addressByProperty = new Map();
    state.rows.forEach((r) => {
      if (!addressByProperty.get(r.property)) addressByProperty.set(r.property, r.full_address || "");
    });
    let names = Array.from(addressByProperty.keys()).sort();
    if (state.property !== ALL_PROPERTIES) names = names.filter((n) => n === state.property);
    return names.map((name) => ({ name, address: addressByProperty.get(name) }));
  }

  function renderWeather() {
    const grid = document.getElementById("weather-grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (!state.rows.some((r) => r.full_address)) {
      grid.appendChild(makeEl("p", "weather-note weather-note--wide",
        "Weather needs each property's full address, which comes from the Airtable Properties table. It isn't available in the sample CSV data."));
      return;
    }

    weatherTargets().forEach((target) => {
      if (target.address) ensureWeather(target.address);
      grid.appendChild(buildWeatherCard(target, target.address ? weatherCache.get(target.address) : null));
    });
  }

  // ---- Vendor Research ---------------------------------------------------
  // Open tickets -> pick one -> "Find Vendors" asks the local server
  // (serve.ps1, which holds APIFY_TOKEN from .env) to run the Apify Google
  // Maps Scraper. The browser never sees the token.

  // First match wins, so the specific rules come before the generic ones.
  const VENDOR_TERM_RULES = [
    { re: /\bgas\b.*\b(odor|smell|leak)|\b(odor|smell)\b.*\bgas\b/, term: "gas leak repair" },
    { re: /water heater/, term: "water heater repair" },
    { re: /\bboiler\b/, term: "boiler repair" },
    { re: /\bfurnace\b/, term: "furnace repair" },
    { re: /\bheat(er|ing)?\b/, term: "heating repair" },
    { re: /thermostat/, term: "thermostat repair" },
    { re: /\bac\b|a\/c|air condition|cooling/, term: "air conditioning repair" },
    { re: /\bvents?\b|airflow|\bducts?\b/, term: "HVAC repair" },
    { re: /dishwasher/, term: "dishwasher repair" },
    { re: /washer|washing machine/, term: "washing machine repair" },
    { re: /dryer/, term: "dryer repair" },
    { re: /refrigerator|fridge|freezer/, term: "refrigerator repair" },
    { re: /microwave/, term: "microwave repair" },
    { re: /\boven\b|\bstove\b|cooktop|\brange\b/, term: "oven repair" },
    { re: /disposal/, term: "garbage disposal repair" },
    { re: /burst|flood/, term: "emergency plumber" },
    { re: /drain|clog|backed up/, term: "drain cleaning" },
    { re: /garage door/, term: "garage door repair" },
    { re: /\block(s|ed|ing)?\b|deadbolt|\bkey\b/, term: "locksmith" },
    { re: /window/, term: "window repair" },
    { re: /\bdoor\b|hinge|latch|weatherstrip/, term: "door repair" },
    { re: /carpet/, term: "carpet repair" },
    { re: /flooring|\bfloor\b/, term: "flooring repair" },
    { re: /\b(lights?|lighting|outlets?|breaker|wiring|switch)\b/, term: "electrician" },
    { re: /mold|musty|moisture|damp/, term: "mold remediation" }
  ];

  const VENDOR_TERM_BY_CATEGORY = {
    "Plumbing": "plumber",
    "HVAC": "HVAC repair",
    "Electrical": "electrician",
    "Appliance": "appliance repair",
    "Doors & Locks": "locksmith",
    "General": "handyman"
  };

  function deriveVendorSearchTerm(issue, category) {
    const text = String(issue || "").toLowerCase();
    const rule = VENDOR_TERM_RULES.find((r) => r.re.test(text));
    if (rule) return rule.term;
    return VENDOR_TERM_BY_CATEGORY[category] || "handyman";
  }

  let vendorTicketId = null;
  let vendorSearchSeq = 0; // bumped on every search/selection so stale responses are ignored
  let vendorServerState = "unknown"; // "ready" | "no-token" | "unavailable"

  function isVendorMode() {
    return document.getElementById("main-content").classList.contains("vendor-mode");
  }

  function selectedVendorTicket() {
    return state.rows.find((r) => r.id === vendorTicketId) || null;
  }

  function renderVendorTickets(rowsForProperty) {
    const list = document.getElementById("vendor-ticket-list");
    const empty = document.getElementById("vendor-tickets-empty");
    const openRows = sortOpenRows(rowsForProperty.filter((r) => OPEN_STATUSES.includes(r.status)));
    document.getElementById("vendor-ticket-count").textContent = "(" + openRows.length + ")";

    list.innerHTML = "";
    empty.hidden = openRows.length > 0;
    empty.textContent = "No open tickets for " + propertyLabel() + ".";

    const selectionLost = !!vendorTicketId && !openRows.some((r) => r.id === vendorTicketId);
    if (selectionLost) {
      vendorTicketId = null;
      vendorSearchSeq++;
    }

    openRows.forEach((row) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vendor-ticket";
      btn.dataset.ticketId = row.id;
      btn.setAttribute("aria-pressed", String(row.id === vendorTicketId));

      const top = document.createElement("span");
      top.className = "vendor-ticket-top";
      top.appendChild(document.createTextNode(row.id));
      top.appendChild(badge(row.priority, PRIORITY_BADGE_CLASS));
      const issue = document.createElement("span");
      issue.className = "vendor-ticket-issue";
      issue.textContent = row.issue;
      const meta = document.createElement("span");
      meta.className = "vendor-ticket-meta";
      meta.textContent = row.property + " · " + row.category + " · " + row.status;

      btn.append(top, issue, meta);
      li.appendChild(btn);
      list.appendChild(li);
    });

    if (selectionLost) renderVendorDetail();
  }

  function setVendorStatus(message, isError) {
    const el = document.getElementById("vendor-status");
    el.textContent = message;
    el.classList.toggle("is-error", !!isError);
  }

  function renderVendorDetail() {
    const ticket = selectedVendorTicket();
    document.getElementById("vendor-detail-empty").hidden = !!ticket;
    document.getElementById("vendor-detail-body").hidden = !ticket;
    document.getElementById("vendor-results").innerHTML = "";
    setVendorStatus("", false);
    if (!ticket) return;

    document.getElementById("vendor-fact-ticket").textContent = ticket.id + " · " + ticket.property + " · " + ticket.category;
    document.getElementById("vendor-fact-issue").textContent = ticket.issue || "-";
    document.getElementById("vendor-fact-address").textContent = ticket.full_address || "No address on file";
    updateFindVendorsButton();
  }

  function updateFindVendorsButton(searching) {
    const btn = document.getElementById("find-vendors-btn");
    const ticket = selectedVendorTicket();
    btn.disabled = !!searching || !ticket || !ticket.full_address || vendorServerState !== "ready";
    btn.textContent = searching ? "Searching…" : "Find Vendors";
    if (ticket && !ticket.full_address && !searching) {
      setVendorStatus("This ticket has no full address, so vendors can't be searched. The address comes from the Airtable Properties lookup.", true);
    }
  }

  async function checkVendorServer() {
    const note = document.getElementById("vendor-note");
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      vendorServerState = data && data.vendorSearch ? "ready" : data ? "no-token" : "unavailable";
    } catch (err) {
      vendorServerState = "unavailable";
    }

    note.hidden = vendorServerState === "ready";
    if (vendorServerState === "no-token") {
      note.textContent = "Vendor search is off: add APIFY_TOKEN to the local .env file and restart serve.ps1.";
    } else if (vendorServerState === "unavailable") {
      note.textContent = "Vendor search only works on the local server (powershell -ExecutionPolicy Bypass -File serve.ps1, with APIFY_TOKEN in .env). It isn't available on the public site or when the page is opened directly as a file.";
    }
    updateFindVendorsButton();
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value));
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch (err) {
      return null;
    }
  }

  function vendorLinkCell(value, label) {
    const url = safeHttpUrl(value);
    if (!url) return document.createTextNode("-");
    const a = document.createElement("a");
    a.href = url.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label || url.hostname.replace(/^www\./, "");
    return a;
  }

  function renderVendors(vendors) {
    const wrap = document.getElementById("vendor-results");
    wrap.innerHTML = "";
    vendors.forEach((v) => {
      const card = document.createElement("article");
      card.className = "vendor-card";

      const name = document.createElement("h4");
      name.textContent = v.name || "-";
      const category = document.createElement("p");
      category.className = "vendor-card-category";
      category.textContent = v.category || "-";

      const dl = document.createElement("dl");
      const add = (label, content) => {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.appendChild(typeof content === "string" ? document.createTextNode(content) : content);
        dl.append(dt, dd);
      };
      const hasRating = v.rating !== null && v.rating !== undefined && v.rating !== "";
      const hasReviews = v.reviews !== null && v.reviews !== undefined && v.reviews !== "";
      add("Rating", hasRating ? Number(v.rating).toFixed(1) + " / 5" : "-");
      add("Reviews", hasReviews ? Number(v.reviews).toLocaleString("en-US") : "-");
      add("Phone", v.phone || "-");
      add("Website", vendorLinkCell(v.website));
      add("Google Maps", vendorLinkCell(v.mapsUrl, "Open in Google Maps"));

      card.append(name, category, dl);
      wrap.appendChild(card);
    });
  }

  async function pollVendorRun(runId, seq) {
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (seq !== vendorSearchSeq) return null;
      const res = await fetch("/api/vendors/result?runId=" + encodeURIComponent(runId), { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The vendor search failed (HTTP " + res.status + ").");
      if (data.status !== "RUNNING") return data;
    }
    throw new Error("The vendor search took too long. Please try again.");
  }

  async function findVendors() {
    const ticket = selectedVendorTicket();
    if (!ticket || !ticket.full_address) return;

    const seq = ++vendorSearchSeq;
    const term = deriveVendorSearchTerm(ticket.issue, ticket.category);
    document.getElementById("vendor-results").innerHTML = "";
    updateFindVendorsButton(true);
    setVendorStatus("Searching Google Maps for “" + term + "” near " + ticket.full_address + "…", false);

    try {
      const startRes = await fetch("/api/vendors/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchTerm: term, location: ticket.full_address })
      });
      const started = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(started.error || "Could not start the vendor search (HTTP " + startRes.status + ").");

      const result = await pollVendorRun(started.runId, seq);
      if (!result || seq !== vendorSearchSeq) return;

      if (result.status !== "SUCCEEDED") {
        throw new Error(result.message || "The vendor search did not complete.");
      }
      if (result.vendors.length === 0) {
        setVendorStatus("No vendors found for “" + term + "” near " + ticket.full_address + ".", false);
      } else {
        renderVendors(result.vendors);
        setVendorStatus("Top " + result.vendors.length + " vendor" + (result.vendors.length === 1 ? "" : "s") + " for “" + term + "” near " + ticket.full_address + ".", false);
      }
    } catch (err) {
      if (seq === vendorSearchSeq) setVendorStatus(err.message || "The vendor search failed.", true);
    } finally {
      if (seq === vendorSearchSeq) updateFindVendorsButton(false);
    }
  }

  function setVendorMode(on) {
    document.getElementById("main-content").classList.toggle("vendor-mode", on);
    const btn = document.getElementById("vendor-view-btn");
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "← Back to Dashboard" : "Vendor Research";
    if (on) checkVendorServer();
  }

  function selectVendorTicket(id) {
    vendorTicketId = id;
    vendorSearchSeq++;
    document.querySelectorAll(".vendor-ticket").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.ticketId === id));
    });
    renderVendorDetail();
  }

  // Opens the Vendor Research screen with this ticket already selected
  // (keeps any results already showing if it was the selected ticket).
  function openVendorResearchFor(id) {
    if (vendorTicketId !== id) selectVendorTicket(id);
    setVendorMode(true);
    const selected = document.querySelector('.vendor-ticket[aria-pressed="true"]');
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
      selected.focus({ preventScroll: true });
    }
    document.getElementById("vendor-section").scrollIntoView({ block: "start" });
  }

  // The ticket details dialog shows a "Vendor Research" button for New and
  // In Progress tickets only; it closes the dialog and opens that ticket's
  // research screen.
  function updateDialogVendorButton(row) {
    const actions = document.getElementById("dialog-actions");
    const show = VENDOR_RESEARCH_STATUSES.includes(row.status);
    actions.hidden = !show;
    document.getElementById("dialog-vendor-btn").dataset.ticketId = show ? row.id : "";
  }

  function wireVendorResearch() {
    document.getElementById("dialog-vendor-btn").addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.ticketId;
      if (!id) return;
      closeDialog();
      openVendorResearchFor(id);
    });
    document.getElementById("vendor-view-btn").addEventListener("click", () => setVendorMode(!isVendorMode()));
    document.getElementById("find-vendors-btn").addEventListener("click", findVendors);
    document.getElementById("vendor-ticket-list").addEventListener("click", (e) => {
      const btn = e.target.closest(".vendor-ticket");
      if (btn) selectVendorTicket(btn.dataset.ticketId);
    });
  }

  function updateDataSourceBadge() {
    const badge = document.getElementById("data-source-badge");
    if (state.dataSource === "airtable") {
      badge.textContent = "Live: Airtable";
      badge.className = "data-source-badge data-source-badge--airtable";
      badge.hidden = false;
    } else if (state.dataSource === "csv") {
      badge.textContent = "Sample data (CSV)";
      badge.className = "data-source-badge data-source-badge--csv";
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  async function init() {
    wireTabs();
    wireDialog();
    wireNewRequestDialog();
    wireCsvUpload();
    wireDemoCsvDownload();
    wireVendorResearch();

    let clean = null;
    let errors = [];

    // Prefer live Airtable data when a token is configured (see
    // AIRTABLE_CONFIG near the top of this file); fall back to the bundled
    // CSV otherwise, or if the Airtable request fails for any reason.
    if (typeof loadRowsFromAirtable === "function") {
      try {
        const airtableRows = await loadRowsFromAirtable();
        if (airtableRows) {
          const result = validateRows(airtableRows);
          if (result.clean.length > 0) {
            clean = result.clean;
            errors = result.errors;
            state.dataSource = "airtable";
            if (errors.length > 0) showValidationBanner(errors, "Airtable");
          } else if (result.errors.length > 0) {
            console.error("All rows returned by Airtable failed validation:\n" + result.errors.join("\n"));
          }
        }
      } catch (err) {
        console.error("Could not load data from Airtable, falling back to the sample CSV:", err);
      }
    }

    if (!clean) {
      let csvText;
      try {
        csvText = await loadCsvText();
      } catch (err) {
        showFatalError("Could not load data from Airtable or maintenance_requests.csv. Serve this folder through a local web server, or run generate-data.ps1 and reload.");
        return;
      }

      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      const result = validateRows(parsed.data);
      if (result.clean.length === 0) {
        showFatalError("No valid rows found in maintenance_requests.csv.");
        return;
      }
      clean = result.clean;
      errors = result.errors;
      state.dataSource = "csv";
      if (errors.length > 0) showValidationBanner(errors, "maintenance_requests.csv");
    }

    state.rows = clean;
    updateDataSourceBadge();
    populatePropertySelect(clean);
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
