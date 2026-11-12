import {
  policies,
  number,
  metric,
  plan,
  actions,
  fmt,
  priceTest,
  experiment,
  parseTable,
  importRows,
  applySettings,
  poolObservations,
} from "./core.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let key = "sailerp-v1",
  state,
  undo = null,
  draft = [],
  table,
  reportSources = [];
const empty = () => ({
  version: 1,
  products: [],
  observations: [],
  changes: [],
  policy: { ...policies },
  remaining: null,
  experiment: null,
  dirty: false,
});
function load() {
  try {
    state = JSON.parse(localStorage.getItem(key)) || empty();
  } catch {
    state = empty();
  }
  state.dirty = false;
  resetDraft();
  render();
}
function persist() {
  try {
    localStorage.setItem(key, JSON.stringify({ ...state, dirty: false }));
  } catch {
    message("Storage unavailable or full. Export a backup now.");
  }
}
function checkpoint() {
  undo = {
    state: structuredClone(state),
    draft: structuredClone(draft),
    reportSources: [...reportSources],
    days: $("#days").value,
    contaminated: $("#contaminated").checked,
  };
}
function message(s) {
  $("#message").textContent = s;
  if ($("#import").open) $("#import-message").textContent = s;
}
function resetDraft() {
  reportSources = [];
  draft = state.products.map((p) => ({
    code: p.code,
    sold: null,
    stock: null,
    revenue: null,
    cogs: null,
    availability: "unsure",
    incoming: [],
    incomingKnown: false,
  }));
  state.dirty = false;
}
function field(label, name, value, type = "number", extra = "") {
  return `<label>${label}<input data-field="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="0" step="any"' : ""} ${extra}></label>`;
}
function render() {
  $("#mode").textContent = key.includes("demo")
    ? "DEMONSTRATION · separate data"
    : "Local workspace";
  $("#demo").textContent = key.includes("demo")
    ? "Return to my workspace"
    : "Open separate demonstration";
  $("#grid").innerHTML =
    draft
      .map(
        (r) =>
          `<tr data-code="${esc(r.code)}"><td><strong>${esc(state.products.find((p) => p.code === r.code).name)}</strong><small>${esc(r.code)}</small></td><td><input aria-label="${esc(r.code)} units sold" data-entry="sold" type="number" min="0" step="any" value="${r.sold ?? ""}"></td><td><input aria-label="${esc(r.code)} current stock" data-entry="stock" type="number" min="0" step="any" value="${r.stock ?? ""}"></td><td><select aria-label="${esc(r.code)} availability" data-entry="availability">${["unsure", "continuous", "stockout"].map((v) => `<option value="${v}" ${r.availability === v ? "selected" : ""}>${{ unsure: "Unsure", continuous: "Continuously stocked", stockout: "Had a stockout" }[v]}</option>`).join("")}</select></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="4">Add your products below, or open the separate demonstration.</td></tr>';
  $("#optional").innerHTML = draft
    .map(
      (r) =>
        `<div class="optional-row" data-code="${esc(r.code)}"><b>${esc(r.code)}</b>${field("Actual period revenue", "revenue", r.revenue)}${field("Total period COGS", "cogs", r.cogs)}<label>Incoming batches (qty:days, …)<input data-field="batches" placeholder="5000:2, 3000:4" value="${r.incoming.map((b) => b.qty + ":" + b.days).join(", ")}"></label><label class="check"><input data-field="incomingKnown" type="checkbox" ${r.incomingKnown ? "checked" : ""}>All incoming confirmed (including none)</label></div>`,
    )
    .join("");
  $("#remaining").value = state.remaining ?? "";
  $("#products").innerHTML = state.products
    .map(
      (p) =>
        `<div class="product" data-code="${esc(p.code)}"><b>${esc(p.code)}</b>${field("Product name", "name", p.name, "text")}${field("Price / unit", "price", p.price)}${field("Cost / unit", "cost", p.cost)}<label>Cost basis<select data-field="basis"><option value="variable" ${p.basis === "variable" ? "selected" : ""}>Variable cost</option><option value="standard" ${p.basis === "standard" ? "selected" : ""}>Accounting / standard</option></select></label>${field("Total ads / day", "ads", p.ads)}<label class="check"><input data-field="mixed" type="checkbox" ${p.mixed ? "checked" : ""}>Mixed-channel prices</label>${field("Next boundary", "boundary", "", "text", 'placeholder="Round 2 · day 4 start"')}<button data-apply>Applied in SAP</button></div>`,
    )
    .join("");
  $("#policies").innerHTML = Object.entries({
    step: "Price step (%)",
    target: "Target coverage (days)",
    buffer: "Supply buffer (days)",
    phase: "Minimum phase (days)",
  })
    .map(
      ([k, v]) =>
        `<label>${v}<input data-policy="${k}" type="number" min="${k === "buffer" ? 0 : 0.01}" step="any" value="${state.policy[k]}"></label>`,
    )
    .join("");
  $("#price-product").innerHTML = state.products
    .map((p) => `<option value="${esc(p.code)}">${esc(p.code)}</option>`)
    .join("");
  renderDecisions();
  renderExperiment();
  $("#history").innerHTML =
    [...state.observations]
      .reverse()
      .map(
        (o) =>
          `<p><b>${esc(o.id)}</b> · ${o.days} simulated days · ${o.rows.length} products ${o.contaminated ? "· MID-PERIOD CHANGE" : ""}<br>${o.rows.map((r) => `${esc(r.code)}: ${fmt(r.sold)} sold / ${fmt(r.stock)} stock; price ${esc(fmt(r.settings.price))}, cost ${esc(fmt(r.settings.cost))}, ads ${esc(fmt(r.settings.ads))}/day`).join("<br>")}</p>`,
      )
      .join("") || "<p>No saved observations.</p>";
}
function renderDecisions() {
  $("#actions").innerHTML =
    actions(state.products, state.observations, state.policy, state.remaining)
      .map(
        (a, i) =>
          `<div class="action"><b>${i + 1}. ${esc(a.code)}</b><span>${a.price !== undefined ? `Set the test price to ${fmt(a.price)} at the next simulation boundary. ` : ""}${esc(a.text)}${a.price !== undefined ? ` Check required sales in the calculator. Record “Applied in SAP” after entering the change yourself; collect a new observation before another change.` : ""}</span></div>`,
      )
      .join("") ||
    '<p class="empty">Your next actions appear after you add products and save an observation.</p>';
  $("#metrics").innerHTML = state.products
    .map((p) => {
      const a = plan(
          p,
          state.observations,
          state.policy.target,
          state.remaining,
        ),
        m = a.latest ? metric(a.latest.r, a.latest.o.days) : {};
      return `<tr><td><b>${esc(p.code)}</b>${p.basis === "standard" ? "<small>Accounting margin proxy</small>" : ""}${m.approx ? "<small>Approximate money: mixed channels</small>" : ""}</td><td>${fmt(m.rate)}${a.latest?.r.availability === "stockout" ? "<small>Demand lower bound</small>" : ""}</td><td>${fmt(m.margin)}</td><td>${fmt(a.rate)}${a.stale ? '<small class="badge">Stale estimate</small>' : ""}</td><td>${fmt(a.coverage)}${typeof a.coverage === "number" ? " days" : ""}</td><td>${fmt(a.gap)}${a.provisional ? "<small>Provisional: incoming unknown</small>" : ""}${a.short ? '<small class="badge">Shortage before arrival or horizon</small>' : ""}</td></tr>`;
    })
    .join("");
}
$("#grid").addEventListener("input", (e) => {
  const name = e.target.dataset.entry;
  if (!name) return;
  draft.find((r) => r.code === e.target.closest("tr").dataset.code)[name] =
    name === "availability" ? e.target.value : number(e.target.value);
  state.dirty = true;
});
$("#grid").addEventListener("keydown", (e) => {
  if (e.target.tagName === "SELECT") return;
  if (e.key !== "Enter" && !["ArrowDown", "ArrowUp"].includes(e.key)) return;
  const inputs = [...$("#grid").querySelectorAll("input,select")],
    i = inputs.indexOf(e.target),
    next = e.key === "Enter" ? i + 1 : i + (e.key === "ArrowDown" ? 3 : -3);
  if (inputs[next]) {
    e.preventDefault();
    inputs[next].focus();
  }
});
$("#optional").addEventListener("input", (e) => {
  const r = draft.find(
      (r) => r.code === e.target.closest("[data-code]")?.dataset.code,
    ),
    f = e.target.dataset.field;
  if (!r || !f) return;
  state.dirty = true;
  if (f === "batches") {
    try {
      r.incoming = e.target.value.trim()
        ? e.target.value.split(",").map((s) => {
            const [qty, days] = s.split(":").map(number);
            if (qty === null || days === null || qty < 0 || days < 0)
              throw Error();
            return { qty, days };
          })
        : [];
      e.target.setCustomValidity("");
    } catch {
      e.target.setCustomValidity("Use quantity:days, e.g. 5000:2");
    }
  } else
    r[f] =
      e.target.type === "checkbox" ? e.target.checked : number(e.target.value);
});
$("#bulk").onchange = (e) => {
  if (!e.target.value) return;
  draft.forEach((r) => (r.availability = e.target.value));
  state.dirty = true;
  const dirty = state.dirty;
  render();
  state.dirty = dirty;
};
$("#save").onclick = () => {
  const days = number($("#days").value);
  if (!(days > 0) || !draft.length)
    return message("Add products and enter a positive period length.");
  if (
    ![...$("#entry").querySelectorAll("input")].every((i) => i.reportValidity())
  )
    return;
  if (draft.some((r) => r.sold === null || r.stock === null))
    return message(
      "Enter units sold and current stock for every product. Zero is valid.",
    );
  checkpoint();
  state.observations.push({
    id: new Date().toISOString(),
    days,
    productCodes: state.products.map((p) => p.code),
    contaminated: $("#contaminated").checked,
    reportSources: [...reportSources],
    rows: draft.map((r) => ({
      ...structuredClone(r),
      settings: structuredClone(state.products.find((p) => p.code === r.code)),
    })),
  });
  resetDraft();
  $("#contaminated").checked = false;
  persist();
  render();
  message("Observation saved. New sales and stock cells are blank.");
};
$("#remaining").onchange = (e) => {
  const n = number(e.target.value);
  if (n !== null && n < 0) return;
  checkpoint();
  state.remaining = n;
  persist();
  renderDecisions();
};
$("#policies").onchange = (e) => {
  if (!e.target.dataset.policy || !e.target.reportValidity()) return;
  checkpoint();
  state.policy[e.target.dataset.policy] = number(e.target.value);
  persist();
  renderDecisions();
};
$("#add").onclick = () => {
  if (state.dirty)
    return message("Save the open observation before adding a product.");
  const code = prompt("Unique product code (e.g. F01)");
  if (!code?.trim()) return;
  if (state.products.some((p) => p.code === code.trim()))
    return message("That code already exists.");
  checkpoint();
  state.products.push({
    code: code.trim(),
    name: code.trim(),
    price: 0,
    cost: 0,
    basis: "variable",
    ads: 0,
    mixed: false,
  });
  resetDraft();
  persist();
  render();
  message("Set actual product settings and confirm the next boundary.");
};
$("#products").onclick = (e) => {
  if (!e.target.hasAttribute("data-apply")) return;
  const row = e.target.closest("[data-code]"),
    patch = {};
  for (const input of row.querySelectorAll("[data-field]")) {
    if (!input.reportValidity()) return;
    patch[input.dataset.field] =
      input.type === "checkbox"
        ? input.checked
        : input.type === "number"
          ? number(input.value)
          : input.value;
  }
  const boundary = patch.boundary;
  delete patch.boundary;
  if (["price", "cost", "ads"].some((k) => patch[k] === null))
    return message("Price, unit cost and daily ads are required.");
  try {
    const next = applySettings(state, row.dataset.code, patch, boundary);
    checkpoint();
    state = next;
    persist();
    render();
    message(
      "Applied settings recorded for " +
        boundary +
        ". Start the new observation at that boundary; historical settings are unchanged.",
    );
  } catch (err) {
    message(err.message);
  }
};
$("#undo").onclick = () => {
  if (!undo) return message("No update to undo in this session.");
  state = undo.state;
  draft = undo.draft;
  reportSources = undo.reportSources;
  $("#days").value = undo.days;
  $("#contaminated").checked = undo.contaminated;
  undo = null;
  persist();
  render();
  message("Last update undone.");
};
$("#calculate").onclick = () => {
  const p = state.products.find((p) => p.code === $("#price-product").value);
  if (!p) return;
  const a = plan(p, state.observations, state.policy.target, state.remaining),
    test = number($("#test-price").value);
  if (test !== null && test < p.cost + 0.01)
    return ($("#price-result").textContent = "Use at least unit cost + 0.01.");
  const result = priceTest(p.price, p.cost, a.rate, test);
  $("#price-result").textContent =
    `Required sales/day: ${fmt(result.required)}. ${result.reason}${a.stale ? " Baseline is stale." : ""}`;
};
function renderExperiment() {
  const x = state.experiment;
  if (!x) {
    $("#experiment").innerHTML =
      `<div class="controls"><label>Product<select id="ad-product">${state.products.map((p) => `<option>${esc(p.code)}</option>`).join("")}</select></label><label>Proposed daily advertising<input id="ad-budget" type="number" min="0" step="any"></label><label>Next application boundary<input id="ad-boundary" placeholder="Day 6 start"></label><button id="ad-start">Record baseline & applied in SAP</button></div>`;
    $("#ad-start").onclick = () => {
      if (state.dirty)
        return message("Close the observation before changing advertising.");
      const code = $("#ad-product").value,
        p = state.products.find((p) => p.code === code),
        base = state.observations.at(-1),
        budget = number($("#ad-budget").value),
        boundary = $("#ad-boundary").value;
      if (!base || !p || budget === null || budget <= p.ads || !boundary.trim())
        return message(
          "Save a baseline; enter an increased daily budget and next boundary.",
        );
      const r = base.rows.find((r) => r.code === code),
        m = r && metric(r, base.days);
      if (
        !r ||
        r.availability !== "continuous" ||
        base.contaminated ||
        base.days < state.policy.phase ||
        !(m.margin > 0) ||
        !(m.rate > 0) ||
        r.stock / m.rate < state.policy.phase + state.policy.buffer ||
        JSON.stringify(r.settings) !== JSON.stringify(p) ||
        m.approx
      )
        return message(
          "Baseline needs current unchanged settings, continuous stock, positive margin, minimum days and coverage of phase + buffer.",
        );
      checkpoint();
      state.experiment = {
        code,
        budget,
        boundary,
        baseline: structuredClone(base),
        startedAfter: base.id,
      };
      state = applySettings(state, code, { ads: budget }, boundary);
      persist();
      render();
      message(
        "Advertising application recorded. Collect a complete new phase from the named boundary.",
      );
    };
    return;
  }
  const after = state.observations.filter((o) => o.id > x.startedAfter);
  const pooled = poolObservations(after, x.baseline, x.code, x.budget);
  const result = pooled
    ? experiment(
        x.baseline,
        pooled,
        x.code,
        state.policy.phase,
        state.policy.buffer,
      )
    : null;
  $("#experiment").innerHTML =
    `<p><b>${esc(x.code)}</b> · ${fmt(x.budget)}/day · applied at ${esc(x.boundary)}</p>${result ? `<h3>${result.label}</h3><p>Additional ads/day: ${fmt(result.extra)} · Observed margin change/day: ${fmt(result.delta)} · Extra units/day needed: ${fmt(result.needed)}<br>Company margin change/day: ${fmt(result.companyDelta)} ${result.companyDelta === null ? "(complete matching product sets required)" : ""}</p><p>${result.reason}</p>` : "<p>Awaiting a new observation.</p>"}<button id="ad-end">Close experiment (keep actual budget)</button>`;
  $("#ad-end").onclick = () => {
    checkpoint();
    state.experiment = null;
    persist();
    renderExperiment();
  };
}
$("#paste-open").onclick = () => {
  $("#new-report-period").checked = false;
  $("#import-message").textContent = "";
  $("#import").showModal();
};
$("#import-close").onclick = () => $("#import").close();
$("#preview").onclick = () => {
  table = parseTable($("#paste").value);
  const names = {
    code: "Product code (Material)",
    sold: "Period units sold (Qty)",
    stock: "Current inventory (Stock)",
    revenue: "Period revenue (Value)",
    cogs: "TOTAL COGS (Cost)",
  };
  $("#mapping").innerHTML =
    Object.entries(names)
      .map(
        ([k, v]) =>
          `<label>${v}<select data-map="${k}"><option value="">Do not import</option>${table.headers.map((h, i) => `<option value="${i}" ${{ code: "material", sold: "qty", stock: "stock", revenue: "value", cogs: "cost" }[k] === h.toLowerCase() ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`,
      )
      .join("") +
    `<table><thead><tr>${table.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${table.rows
      .slice(0, 5)
      .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
      .join(
        "",
      )}</tbody></table><p>${table.rows.length} rows. Description is descriptive only. Unknown product codes are skipped. Cost imports as TOTAL COGS.</p>`;
};
$("#import-confirm").onclick = () => {
  if (!table) return message("Preview and map the report first.");
  const days = number($("#import-days").value),
    map = Object.fromEntries(
      [...$("#mapping").querySelectorAll("select")].map((i) => [
        i.dataset.map,
        i.value,
      ]),
    );
  if (!(days > 0) || map.code === "")
    return message(
      "Confirm a positive report period and map Material to product code.",
    );
  if (state.dirty && days !== number($("#days").value))
    return message(
      "Report period differs from the open observation. Close it first.",
    );
  const source = JSON.stringify({ table, map, days });
  if (
    state.observations.some((o) => o.reportSources?.includes(source)) &&
    !$("#new-report-period").checked
  )
    return message(
      "This exact report is already saved. Repeated imports into an open observation replace cells. For a genuinely different simulation period, explicitly confirm that below; to correct the latest saved observation, undo it first.",
    );
  if (!reportSources.includes(source)) reportSources.push(source);
  const matches = table.rows.filter((r) =>
    draft.some((d) => d.code === r[map.code]),
  ).length;
  draft = importRows(draft, table, map);
  $("#days").value = days;
  state.dirty = true;
  render();
  $("#import").close();
  message(
    `${matches} matching report rows replaced mapped cells. Verify totals, availability and period before saving.`,
  );
};
$("#backup").onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = key + ".json";
  a.click();
  URL.revokeObjectURL(url);
};
function validate(s) {
  const numeric = (v, nullable = false) =>
    (nullable && v === null) ||
    (typeof v === "number" && Number.isFinite(v) && v >= 0);
  const product = (p) =>
    p &&
    typeof p.code === "string" &&
    p.code.length > 0 &&
    typeof p.name === "string" &&
    ["variable", "standard"].includes(p.basis) &&
    ["price", "cost", "ads"].every((k) => numeric(p[k])) &&
    typeof p.mixed === "boolean";
  const observation = (o) =>
    o &&
    typeof o.id === "string" &&
    numeric(o.days) &&
    o.days > 0 &&
    typeof o.contaminated === "boolean" &&
    Array.isArray(o.productCodes) &&
    o.productCodes.every((c) => typeof c === "string") &&
    new Set(o.productCodes).size === o.productCodes.length &&
    Array.isArray(o.rows) &&
    new Set(o.rows.map((r) => r.code)).size === o.rows.length &&
    o.rows.every(
      (r) =>
        product(r.settings) &&
        r.settings.code === r.code &&
        o.productCodes.includes(r.code) &&
        ["continuous", "stockout", "unsure"].includes(r.availability) &&
        ["sold", "stock"].every((k) => numeric(r[k])) &&
        ["revenue", "cogs"].every((k) => numeric(r[k], true)) &&
        typeof r.incomingKnown === "boolean" &&
        Array.isArray(r.incoming) &&
        r.incoming.every((b) => numeric(b.qty) && numeric(b.days)),
    );
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.products) ||
    !s.products.every(product) ||
    new Set(s.products.map((p) => p.code)).size !== s.products.length ||
    !Array.isArray(s.observations) ||
    !s.observations.every(observation) ||
    !Array.isArray(s.changes) ||
    !s.policy ||
    !numeric(s.remaining, true)
  )
    throw Error("Invalid or unsupported backup.");
  for (const k of Object.keys(policies))
    if (!numeric(s.policy[k]) || s.policy[k] < (k === "buffer" ? 0 : 0.01))
      throw Error("Invalid policies.");
  if (
    s.experiment !== null &&
    (!s.experiment ||
      !s.products.some((p) => p.code === s.experiment.code) ||
      !numeric(s.experiment.budget) ||
      typeof s.experiment.boundary !== "string" ||
      typeof s.experiment.startedAfter !== "string" ||
      !observation(s.experiment.baseline))
  )
    throw Error("Invalid experiment.");
  return s;
}
$("#restore").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    const incoming = validate(JSON.parse(await file.text()));
    checkpoint();
    state = incoming;
    resetDraft();
    persist();
    render();
    message("Backup restored. Undo is available.");
  } catch (err) {
    message("Restore rejected: " + err.message);
  }
};
$("#demo").onclick = async () => {
  if (
    state.dirty &&
    !confirm("Discard unsaved observation cells and switch workspaces?")
  )
    return;
  key = key.includes("demo") ? "sailerp-v1" : "sailerp-demo-v1";
  if (key.includes("demo") && !localStorage.getItem(key)) {
    const sample = await fetch("samples/demo.json").then((r) => r.json());
    localStorage.setItem(key, JSON.stringify(sample));
  }
  undo = null;
  load();
  message(
    key.includes("demo")
      ? "Synthetic demonstration. Your own workspace is separate."
      : "Returned to your workspace.",
  );
};
load();
