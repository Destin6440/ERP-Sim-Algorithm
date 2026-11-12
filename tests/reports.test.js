import test from "node:test";
import assert from "node:assert/strict";
import {
  reportNumber,
  prepareCapture,
  validateCapture,
} from "../src/reports.js";
const capture = (patch = {}) => ({
  version: 1,
  type: "sailerp-report",
  title: "Summary Sales Order Report : Round 1 Day 1",
  headers: [
    "Round",
    "Day",
    "Material",
    "Description",
    "Orders",
    "Quantity",
    "Net Value",
    "Cost",
  ],
  rows: [
    [
      "01",
      "01",
      "JJ-F01",
      "500g Nut Muesli",
      "2",
      "10,000",
      "40,000.00",
      "30,000.00",
    ],
    ["", "", "JJ-F02", "500g Blueberry Muesli", "0", "0", "0.00", "0.00"],
  ],
  partial: false,
  ...patch,
});
test("SAP headers map Quantity, Net Value and Cost to units, revenue and TOTAL COGS; zeros retained", () => {
  const out = prepareCapture(capture());
  assert.deepEqual(out.headers, [
    "Material",
    "Description",
    "Qty",
    "Value",
    "Cost",
  ]);
  assert.deepEqual(out.rows[0], [
    "JJ-F01",
    "500g Nut Muesli",
    "10000",
    "40000",
    "30000",
  ]);
  assert.deepEqual(out.rows[1].slice(2), ["0", "0", "0"]);
  assert.match(out.warnings.join(" "), /TOTAL COGS/);
});
test("report numbers use explicit decimal conventions and reject ambiguous invalid formats", () => {
  assert.equal(reportNumber("1,234.56"), 1234.56);
  assert.equal(reportNumber("1.234,56", "comma"), 1234.56);
  assert.equal(reportNumber("1 234,56", "comma"), 1234.56);
  assert.equal(reportNumber(""), null);
  assert.equal(reportNumber("0.00"), 0);
  assert.throws(() => reportNumber("1.234,56"));
  assert.throws(() => reportNumber("€10"));
  assert.throws(() => reportNumber("-1"));
});
test("detail rows aggregate once by material; equal legitimate detail rows are not deduplicated", () => {
  const r = ["1", "1", "JJ-F01", "Nut", "1", "10", "40", "30"];
  const out = prepareCapture(capture({ title: "Sales Report", rows: [r, r] }));
  assert.deepEqual(out.rows[0].slice(2), ["20", "80", "60"]);
});
test("multiple periods require a round/day filter, with grouped blank period cells carried forward", () => {
  const c = capture();
  c.rows.push(["01", "02", "JJ-F01", "Nut", "1", "20", "80", "60"]);
  assert.throws(() => prepareCapture(c), /multiple round\/day/);
  const out = prepareCapture(c, { round: "1", day: "1" });
  assert.equal(out.rows.length, 2);
  assert.equal(prepareCapture(c, { round: "1", day: "2" }).rows[0][2], "20");
  assert.throws(() => prepareCapture(c, { day: "9" }), /No data rows/);
});
test("blank constituent values remain missing instead of partial monetary totals", () => {
  const c = capture({
    rows: [
      ["1", "1", "JJ-F01", "Nut", "1", "10", "40", "30"],
      ["", "", "JJ-F01", "Nut", "1", "5", "", "15"],
    ],
  });
  assert.deepEqual(prepareCapture(c).rows[0].slice(2), ["15", "", "45"]);
});
test("empty, price market and production reports do not establish sales or incoming", () => {
  assert.throws(() => prepareCapture(capture({ rows: [] })), /empty report/i);
  for (const title of ["Price Market Report", "Production Report"])
    assert.throws(
      () => prepareCapture(capture({ title })),
      /reference information/,
    );
});
test("one inventory total per material required; duplicate stocks cannot be silently summed", () => {
  const c = capture({
    title: "Inventory Report",
    headers: ["Material", "Stock"],
    rows: [["JJ-F01", "15000"]],
  });
  assert.equal(prepareCapture(c).rows[0][2], "15000");
  c.rows.push(["JJ-F01", "100"]);
  assert.throws(() => prepareCapture(c), /Repeated inventory/);
});
test("Unit Cost is never interpreted as total COGS", () => {
  const c = capture({
    title: "Sales Report",
    headers: ["Material", "Quantity", "Unit Cost"],
    rows: [["JJ-F01", "100", "3"]],
  });
  assert.deepEqual(prepareCapture(c).headers, [
    "Material",
    "Description",
    "Qty",
  ]);
});
test("captures enforce structural and size limits; partial capture warns", () => {
  assert.throws(() => validateCapture({ version: 1 }));
  assert.throws(() => validateCapture(capture({ rows: [[42]] })));
  assert.throws(() => validateCapture(capture({ title: "a".repeat(501) })));
  assert.match(
    prepareCapture(capture({ partial: true })).warnings.join(" "),
    /more rows/,
  );
});
test("misaligned table columns reject instead of assigning shifted quantities", () => {
  assert.throws(
    () =>
      prepareCapture(capture({ rows: [["1", "1", "JJ-F01", "Nut", "10"]] })),
    /Invalid/,
  );
});
