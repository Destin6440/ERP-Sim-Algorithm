export const policies = { step: 2, target: 3, buffer: 1, phase: 2 };
export function number(v) {
  return (typeof v === "string" && v.trim() === "") ||
    v === null ||
    v === undefined
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;
}
export function signature(p) {
  return JSON.stringify([p.price, p.cost, p.basis, p.ads, p.mixed]);
}
export function metric(row, days) {
  const p = row.settings,
    sold = number(row.sold),
    stock = number(row.stock),
    d = number(days);
  const rate = d > 0 && sold !== null ? sold / d : null;
  const revenue =
    number(row.revenue) ??
    (sold !== null && number(p.price) !== null ? sold * p.price : null);
  const cogs =
    number(row.cogs) ??
    (sold !== null && number(p.cost) !== null ? sold * p.cost : null);
  return {
    rate,
    stock,
    revenue,
    cogs,
    margin:
      d > 0 && revenue !== null && cogs !== null && number(p.ads) !== null
        ? (revenue - cogs - p.ads * d) / d
        : null,
    approx: !!p.mixed && number(row.revenue) === null,
  };
}
export function plan(product, history, target, remaining, buffer = 1) {
  const rows = history.flatMap((o) =>
    o.rows.filter((r) => r.code === product.code).map((r) => ({ r, o })),
  );
  const last = rows.at(-1);
  if (!last)
    return {
      rate: null,
      coverage: null,
      gap: null,
      reason: "Save an observation first.",
    };
  const lastMismatch = rows.findLastIndex(
    ({ r }) => signature(r.settings) !== signature(product),
  );
  const clean = rows
    .slice(lastMismatch + 1)
    .filter(
      ({ r, o }) =>
        r.availability === "continuous" &&
        !o.contaminated &&
        signature(r.settings) === signature(product),
    );
  const eligible = clean.filter(({ r, o }) => metric(r, o.days).rate !== null);
  const units = eligible.reduce((a, { r }) => a + r.sold, 0),
    days = eligible.reduce((a, { o }) => a + o.days, 0);
  const rate = days > 0 ? units / days : null,
    stock = number(last.r.stock);
  const horizon = remaining === null ? target : Math.min(target, remaining);
  const incoming = last.r.incoming || [];
  const within = incoming
    .filter((b) => b.days <= horizon)
    .reduce((a, b) => a + b.qty, 0);
  const coverage =
    stock === 0
      ? 0
      : stock === null
        ? null
        : metric(last.r, last.o.days).rate === 0
          ? "No recent sales"
          : rate === null
            ? null
            : rate === 0
              ? "No recent sales"
              : stock / rate;
  let short = false,
    available = stock;
  if (rate > 0 && stock !== null) {
    let time = 0;
    for (const b of [...incoming]
      .filter((b) => b.days <= horizon)
      .sort((a, b) => a.days - b.days)) {
      if (available < rate * (b.days - time)) short = true;
      available -= rate * (b.days - time);
      available += b.qty;
      time = b.days;
    }
    if (available < rate * (horizon - time)) short = true;
  }
  return {
    rate,
    coverage,
    horizon,
    gap:
      rate === null || stock === null
        ? null
        : Math.max(0, Math.ceil(rate * horizon - stock - within)),
    short,
    stale: eligible.at(-1)?.o.id !== last.o.id,
    cleanCount: eligible.length,
    provisional: !last.r.incomingKnown,
    latest: last,
    wait: incoming.length ? Math.min(...incoming.map((b) => b.days)) : null,
    buffer,
  };
}
export function priceTest(oldPrice, cost, rate, newPrice) {
  if ([oldPrice, cost, rate, newPrice].some((x) => number(x) === null))
    return { required: null, reason: "Missing baseline." };
  if (oldPrice - cost <= 0)
    return { required: null, reason: "Baseline unit margin is nonpositive." };
  if (newPrice - cost <= 0)
    return { required: null, reason: "Test unit margin is nonpositive." };
  return {
    required: (rate * (oldPrice - cost)) / (newPrice - cost),
    reason: "Unchanged cost and advertising; no sales prediction.",
  };
}
export function actions(products, history, policy, remaining) {
  let out = [];
  for (const p of products) {
    if (remaining === 0) {
      out.push({
        priority: 0,
        code: p.code,
        text: "Close the game: 0 simulated days remain. Stop new replenishment and future advertising; reconcile final reports.",
      });
      continue;
    }
    const a = plan(p, history, policy.target, remaining, policy.buffer),
      l = a.latest;
    if (!l) {
      out.push({
        priority: 5,
        code: p.code,
        text: "Withhold decisions: no saved observation.",
      });
      continue;
    }
    const m = metric(l.r, l.o.days),
      unit = p.price - p.cost;
    if (l.r.stock === 0 || l.r.availability === "stockout")
      out.push({
        priority: 0,
        code: p.code,
        text: `Restore supply${l.r.stock === 0 ? " and pause advertising while unavailable" : ""}. Observed ${fmt(m.rate)} units/day is a lower bound during a stockout.`,
      });
    else if (unit <= 0)
      out.push({
        priority: 1,
        code: p.code,
        text: `Review price and cost before expansion: unit margin ${fmt(unit)}.`,
      });
    else if (
      a.rate === null ||
      a.stale ||
      l.r.availability !== "continuous" ||
      l.o.contaminated
    )
      out.push({
        priority: 4,
        code: p.code,
        text: `Withhold price decisions: ${a.stale ? "planning estimate stale; " : ""}need current continuous availability under unchanged settings. Observed ${fmt(m.rate)}/day.`,
      });
    else if (m.margin !== null && m.margin <= 0)
      out.push({
        priority: 1,
        code: p.code,
        text: `Review advertising and contribution before expansion: ${fmt(m.margin)} margin after ads/day, ${fmt(unit)} unit margin.`,
      });
    else if (p.mixed)
      out.push({
        priority: 4,
        code: p.code,
        text: "Mixed channels: collect channel-specific observations before price recommendations.",
      });
    else if (
      a.wait !== null &&
      typeof a.coverage === "number" &&
      a.coverage < a.wait + policy.buffer
    )
      out.push({
        priority: 2,
        code: p.code,
        text: `Run a ${policy.step}% price-increase test: ${fmt(a.coverage)} days coverage < ${fmt(a.wait + policy.buffer)} days wait + buffer. Confirm application before another test.`,
        price: Math.max(
          p.cost + 0.01,
          Math.round(p.price * (1 + policy.step / 100) * 100) / 100,
        ),
      });
    else if (a.short)
      out.push({
        priority: 2,
        code: p.code,
        text: `Confirm replenishment: ${fmt(a.coverage)} days coverage against a ${fmt(a.horizon)}-day horizon; draft ${fmt(a.gap)} units. ${a.wait === null ? "Arrival timing is unknown; withhold a timing-based price test." : "Known arrivals still leave a shortage."}`,
      });
    else if (
      a.cleanCount >= 2 &&
      typeof a.coverage === "number" &&
      a.coverage > 2 * a.horizon
    )
      out.push({
        priority: 3,
        code: p.code,
        text: `Run a ${policy.step}% price-decrease test: ${fmt(a.coverage)} days coverage across ${a.cleanCount} clean observations.`,
        price: Math.max(
          Math.ceil((p.cost + 0.01) * 100) / 100,
          Math.round(p.price * (1 - policy.step / 100) * 100) / 100,
        ),
      });
    else
      out.push({
        priority: 4,
        code: p.code,
        text: `Hold settings: ${fmt(m.margin)} margin/day; ${typeof a.coverage === "number" ? fmt(a.coverage) + " days coverage" : (a.coverage ?? "coverage unavailable")}.`,
      });
  }
  return out.sort((a, b) => a.priority - b.priority).slice(0, 5);
}
export function fmt(n) {
  return n === null || n === undefined
    ? "—"
    : typeof n === "number"
      ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : n;
}
export function company(observation) {
  return observation.rows.length === observation.productCodes.length &&
    observation.productCodes.every((c) =>
      observation.rows.some(
        (r) => r.code === c && metric(r, observation.days).margin !== null,
      ),
    )
    ? observation.rows.reduce(
        (a, r) => a + metric(r, observation.days).margin,
        0,
      )
    : null;
}
export function experiment(base, after, code, minDays, buffer = 1) {
  const b = base.rows.find((r) => r.code === code),
    a = after.rows.find((r) => r.code === code);
  if (!b || !a) return { label: "Inconclusive", reason: "Missing product." };
  const bm = metric(b, base.days),
    am = metric(a, after.days),
    unit = b.settings.price - b.settings.cost,
    extra = a.settings.ads - b.settings.ads;
  const same =
    JSON.stringify([
      b.settings.price,
      b.settings.cost,
      b.settings.basis,
      b.settings.mixed,
    ]) ===
    JSON.stringify([
      a.settings.price,
      a.settings.cost,
      a.settings.basis,
      a.settings.mixed,
    ]);
  const sufficient = [
    [b, bm, base],
    [a, am, after],
  ].every(
    ([r, m, o]) =>
      o.days >= minDays &&
      r.availability === "continuous" &&
      !o.contaminated &&
      m.margin > 0 &&
      m.rate > 0 &&
      r.stock / m.rate >= minDays + buffer &&
      !m.approx,
  );
  const valid =
    same && sufficient && extra > 0 && bm.margin !== null && am.margin !== null;
  const companyUnchanged = base.rows.every((r) => {
    const other = after.rows.find((a) => a.code === r.code);
    return (
      other &&
      JSON.stringify([
        r.settings.price,
        r.settings.cost,
        r.settings.basis,
        r.settings.mixed,
        r.code === code ? null : r.settings.ads,
      ]) ===
        JSON.stringify([
          other.settings.price,
          other.settings.cost,
          other.settings.basis,
          other.settings.mixed,
          other.code === code ? null : other.settings.ads,
        ])
    );
  });
  const sameSet =
    JSON.stringify([...base.productCodes].sort()) ===
    JSON.stringify([...after.productCodes].sort());
  const bc = company(base),
    ac = company(after);
  return {
    label:
      !valid || am.margin === bm.margin
        ? "Inconclusive"
        : am.margin > bm.margin
          ? "Observed improvement"
          : "Observed deterioration",
    reason: valid
      ? "Before/after association does not prove causality."
      : "Insufficient days, stock, positive margins, availability, actual revenue, or unchanged settings; comparison contaminated or incomplete.",
    extra,
    delta:
      bm.margin === null || am.margin === null ? null : am.margin - bm.margin,
    needed: unit > 0 ? extra / unit : null,
    companyDelta:
      valid && companyUnchanged && sameSet && bc !== null && ac !== null
        ? ac - bc
        : null,
  };
}
export function parseTable(text) {
  const delimiter = text.split("\n")[0].includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [],
    cell = "",
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (!quote && (c === delimiter || c === "\n")) {
      row.push(cell.trim());
      cell = "";
      if (c === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (c !== "\r") cell += c;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return { headers: rows[0] || [], rows: rows.slice(1) };
}
export function importRows(existing, table, map) {
  const out = structuredClone(existing);
  for (const cells of table.rows) {
    const code = cells[map.code];
    const r = out.find((x) => x.code === code);
    if (!r) continue;
    for (const key of ["sold", "stock", "revenue", "cogs"])
      if (map[key] !== "" && map[key] !== undefined) {
        const v = number(cells[map[key]]);
        if (v !== null && v >= 0) r[key] = v;
      }
  }
  return out;
}
export function applySettings(state, code, patch, boundary) {
  if (state.dirty)
    throw Error("Close the observation before changing settings.");
  if (!boundary.trim()) throw Error("An explicit next boundary is required.");
  const next = structuredClone(state);
  const p = next.products.find((p) => p.code === code);
  Object.assign(p, patch);
  next.changes.push({ code, patch, boundary, at: new Date().toISOString() });
  return next;
}
export function poolObservations(observations, baseline, code, budget) {
  if (!observations.length) return null;
  const first = observations[0];
  const sameSet = (a, b) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const changed = (r) => {
    const b = baseline.rows.find((a) => a.code === r.code);
    return (
      !b ||
      JSON.stringify([
        r.settings.price,
        r.settings.cost,
        r.settings.basis,
        r.settings.mixed,
        r.code === code ? null : r.settings.ads,
      ]) !==
        JSON.stringify([
          b.settings.price,
          b.settings.cost,
          b.settings.basis,
          b.settings.mixed,
          b.code === code ? null : b.settings.ads,
        ]) ||
      (r.code === code && r.settings.ads !== budget)
    );
  };
  return {
    id: observations.at(-1).id,
    days: observations.reduce((s, o) => s + o.days, 0),
    productCodes: [...first.productCodes],
    contaminated: observations.some(
      (o) =>
        o.contaminated ||
        !sameSet(o.productCodes, first.productCodes) ||
        o.rows.some((r) => metric(r, o.days).approx || changed(r)),
    ),
    rows: first.rows.map((r) => {
      const all = observations.map((o) =>
        o.rows.find((a) => a.code === r.code),
      );
      const sum = (key) =>
        all.every((a, i) => a && metric(a, observations[i].days)[key] !== null)
          ? all.reduce((s, a, i) => s + metric(a, observations[i].days)[key], 0)
          : null;
      return {
        ...structuredClone(r),
        sold: all.every((a) => a && number(a.sold) !== null)
          ? all.reduce((s, a) => s + a.sold, 0)
          : null,
        revenue: sum("revenue"),
        cogs: sum("cogs"),
        stock: all.at(-1)?.stock ?? null,
        availability: all.every(
          (a) =>
            a &&
            a.availability === "continuous" &&
            signature(a.settings) === signature(r.settings),
        )
          ? "continuous"
          : "unsure",
      };
    }),
  };
}
