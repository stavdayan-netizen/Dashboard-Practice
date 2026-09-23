(function () {
  "use strict";

  // ---- Configuration -------------------------------------------------

  const AS_OF_DATE = "2026-09-23"; // demo "today"; change this to move the demo forward/back
  const YTD_START_DATE = "2026-01-01";
  const ALL_PROPERTIES = "All Properties";

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
`;

  const CATEGORIES = ["Plumbing", "HVAC", "Electrical", "Appliance", "Doors & Locks", "General"];
  const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
  const STATUSES = ["New", "Scheduled", "In Progress", "Resolved"];
  const OPEN_STATUSES = ["New", "Scheduled", "In Progress"];
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
    lastFocusedEl: null
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
        ai_summary: row.ai_summary || ""
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

  function showValidationBanner(errors) {
    console.error("Maintenance CSV validation errors:\n" + errors.join("\n"));
    showStatusBanner(
      errors.length + " row(s) in maintenance_requests.csv failed validation and were excluded. See the browser console for details.",
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
    const focusable = dialogEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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
    renderCharts(rowsForProperty);
    renderRequestsSection(rowsForProperty);
    renderCosts(state.rows);
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

  async function init() {
    wireTabs();
    wireDialog();
    wireNewRequestDialog();
    wireCsvUpload();
    wireDemoCsvDownload();

    let csvText;
    try {
      csvText = await loadCsvText();
    } catch (err) {
      showFatalError("Could not load maintenance_requests.csv. Serve this folder through a local web server, or run generate-data.ps1 and reload.");
      return;
    }

    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const { clean, errors } = validateRows(parsed.data);

    if (clean.length === 0) {
      showFatalError("No valid rows found in maintenance_requests.csv.");
      return;
    }

    state.rows = clean;
    if (errors.length > 0) showValidationBanner(errors);

    populatePropertySelect(clean);
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
