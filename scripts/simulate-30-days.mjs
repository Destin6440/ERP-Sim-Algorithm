// Synthetic inputs, not a forecast or production schedule. Run from repository root.
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { actions, metric, policies } from "../src/core.js";
const original = {
  code: "F01",
  name: "Original Muesli",
  price: 4,
  cost: 3,
  basis: "variable",
  ads: 500,
  mixed: false,
};
const history = [],
  receipts = new Map([
    [5, 21000],
    [6, 27000],
    [9, 27000],
    [12, 27000],
    [15, 27000],
    [18, 27000],
    [21, 27000],
    [24, 27000],
    [27, 18000],
  ]),
  lines = [];
let stock = 20000,
  total = 0;
for (let day = 1; day <= 30; day++) {
  const settings = { ...original, price: day < 3 ? 4 : 4.08 },
    sold = day === 1 ? 10000 : day === 3 ? 1000 : 9000;
  const received = day === 3 ? 15000 : receipts.get(day) || 0;
  // Day 3's shipment arrives after selling out; later receipts arrive before sales.
  if (day !== 3) stock += received;
  assert.ok(stock >= sold);
  stock -= sold;
  if (day === 3) stock += received;
  const next =
    day < 3
      ? { qty: 15000, days: 3 - day }
      : day < 5
        ? null
        : [...receipts].find(([d]) => d > day);
  const incoming = Array.isArray(next)
    ? [{ qty: next[1], days: next[0] - day }]
    : next
      ? [next]
      : [];
  const observation = {
    id: `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    days: 1,
    productCodes: ["F01"],
    contaminated: false,
    rows: [
      {
        code: "F01",
        settings,
        sold,
        stock,
        availability: day === 3 ? "stockout" : "continuous",
        revenue: null,
        cogs: null,
        incoming,
        incomingKnown: true,
      },
    ],
  };
  history.push(observation);
  const result = metric(observation.rows[0], 1),
    action = actions([settings], history, policies, 30 - day)[0];
  total += result.margin;
  if (day >= 5 && day < 30) assert.match(action.text, /Hold settings/);
  if (day === 30) assert.match(action.text, /Close the game/);
  lines.push({
    day,
    received,
    sold,
    stock,
    margin: Math.round(result.margin),
    action: action.text,
  });
}
const state = {
  version: 1,
  products: [{ ...original, price: 4.08 }],
  observations: history,
  changes: [
    {
      code: "F01",
      patch: { price: 4.08 },
      boundary: "Day 3 start",
      at: history[2].id,
    },
  ],
  policy: { ...policies },
  remaining: 0,
  experiment: null,
  dirty: false,
};
writeFileSync(
  "samples/day30-simulation.json",
  JSON.stringify(state, null, 2) + "\n",
);
writeFileSync(
  "samples/day30-simulation.csv",
  "Day,Received,Sold,Closing stock,Margin after ads\n" +
    lines
      .map((r) => [r.day, r.received, r.sold, r.stock, r.margin].join(","))
      .join("\n") +
    "\n",
);
assert.equal(stock, 0);
assert.equal(Math.round(total), 267520);
console.log(
  JSON.stringify(
    {
      days: lines,
      totalUnits: lines.reduce((s, r) => s + r.sold, 0),
      totalMargin: Math.round(total),
      endingStock: stock,
    },
    null,
    2,
  ),
);
