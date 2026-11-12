// Read-only report interpretation. No SAP transactions or network requests.
export function reportNumber(value, decimal = "dot") {
  const text = String(value ?? "")
    .trim()
    .replace(/[\u00a0\u202f]/g, " ");
  if (!text) return null;
  const pattern =
    decimal === "comma"
      ? /^-?(?:\d+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?: \d{3})+)(?:,\d+)?$/
      : /^-?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,3}(?: \d{3})+)(?:\.\d+)?$/;
  if (!pattern.test(text))
    throw Error(`Unrecognized number: ${text}. Check the decimal format.`);
  const normalized = text
    .replace(/ /g, "")
    .replace(decimal === "comma" ? /\./g : /,/g, "")
    .replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0)
    throw Error("Negative or invalid report values need manual review.");
  return n;
}
export function validateCapture(c) {
  if (
    !c ||
    c.version !== 1 ||
    c.type !== "sailerp-report" ||
    typeof c.title !== "string" ||
    c.title.length > 500 ||
    !Array.isArray(c.headers) ||
    !c.headers.length ||
    c.headers.length > 100 ||
    c.headers.some((h) => typeof h !== "string" || h.length > 500) ||
    !Array.isArray(c.rows) ||
    c.rows.length > 10000 ||
    c.rows.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== c.headers.length ||
        r.some((v) => typeof v !== "string" || v.length > 2000),
    )
  )
    throw Error("Invalid or oversized report capture.");
  return c;
}
const header = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
export function prepareCapture(
  input,
  { decimal = "dot", round = "", day = "" } = {},
) {
  const capture = validateCapture(input),
    h = capture.headers.map(header),
    idx = (...aliases) => h.findIndex((v) => aliases.includes(v));
  if (/price market|production/i.test(capture.title))
    throw Error(
      "This report is reference information. It cannot establish your sales, current stock or confirmed incoming batches. Capture a sales or inventory report.",
    );
  const material = idx("material", "materialcode", "productcode"),
    description = idx("description", "materialdescription"),
    qty = idx("quantity", "qty"),
    revenue = idx("netvalue", "value", "revenue"),
    cost = idx("cost", "totalcogs", "cogs"),
    stock = idx(
      "stock",
      "currentstock",
      "unrestrictedstock",
      "unrestrictedusestock",
    ),
    ri = idx("round"),
    di = idx("day");
  if (material < 0) throw Error("No Material/product-code column was found.");
  const inventory = stock >= 0;
  if (!inventory && (!/sales/i.test(capture.title) || qty < 0))
    throw Error(
      "Capture a sales report with Quantity, or an inventory report with Stock.",
    );
  let carriedRound = "",
    carriedDay = "";
  const rows = capture.rows
    .map((cells) => {
      if (ri >= 0 && cells[ri]?.trim()) carriedRound = cells[ri].trim();
      if (di >= 0 && cells[di]?.trim()) carriedDay = cells[di].trim();
      return { cells, round: carriedRound, day: carriedDay };
    })
    .filter(
      (r) =>
        r.cells[material]?.trim() &&
        !/^(total|grand total|no data)$/i.test(r.cells[material].trim()),
    );
  const same = (a, b) =>
    a === b || (/^\d+$/.test(a) && /^\d+$/.test(b) && Number(a) === Number(b));
  const filtered = rows.filter(
    (r) => (!round || same(r.round, round)) && (!day || same(r.day, day)),
  );
  if (!filtered.length)
    throw Error(
      "No data rows match. An empty report is missing data, not zero sales.",
    );
  if (new Set(filtered.map((r) => r.round + "|" + r.day)).size > 1)
    throw Error(
      "This capture spans multiple round/day periods. Filter one round and day before importing; do not mix cumulative and daily sales.",
    );
  const groups = new Map(),
    fields = inventory
      ? [["stock", stock]]
      : [
          ["sold", qty],
          ["revenue", revenue],
          ["cogs", cost],
        ].filter(([, i]) => i >= 0);
  for (const { cells } of filtered) {
    const code = cells[material].trim();
    let g = groups.get(code);
    if (!g) {
      g = {
        code,
        name: description >= 0 ? cells[description] : "",
        count: 0,
        values: {},
        missing: new Set(),
      };
      groups.set(code, g);
    }
    g.count++;
    for (const [key, i] of fields) {
      const n = reportNumber(cells[i], decimal);
      if (n === null) g.missing.add(key);
      else g.values[key] = (g.values[key] ?? 0) + n;
    }
  }
  // Inventory rows can overlap totals, locations or stock categories. Never silently sum duplicates.
  if (inventory && [...groups.values()].some((g) => g.count > 1))
    throw Error(
      "Repeated inventory materials require manual review. Export one confirmed total Stock row per material.",
    );
  const headers = [
    "Material",
    "Description",
    ...fields.map(
      ([key]) =>
        ({ sold: "Qty", stock: "Stock", revenue: "Value", cogs: "Cost" })[key],
    ),
  ];
  const resultRows = [...groups.values()].map((g) => [
    g.code,
    g.name || "",
    ...fields.map(([key]) =>
      g.missing.has(key) ? "" : String(g.values[key] ?? ""),
    ),
  ]);
  const quoted = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  return {
    headers,
    rows: resultRows,
    text: [headers, ...resultRows]
      .map((r) => r.map(quoted).join("\t"))
      .join("\n"),
    kind: inventory ? "inventory" : "sales",
    warnings: [
      !inventory &&
        "Quantity, Net Value and Cost are summed by material within the confirmed period. Cost means TOTAL COGS; prices and unit costs remain unchanged.",
      capture.partial &&
        "The source reports more rows than were captured. Use a complete export instead.",
      !capture.partial &&
        "Only rendered rows were captured. Compare against SAP totals, filters and pagination before confirming.",
      ...([...groups.values()].some((g) => g.missing.size)
        ? ["Some numeric cells are missing; they remain blank."]
        : []),
    ].filter(Boolean),
  };
}
