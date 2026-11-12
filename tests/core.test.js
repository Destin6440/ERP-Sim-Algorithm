import test from "node:test";
import assert from "node:assert/strict";
import {
  metric,
  plan,
  priceTest,
  actions,
  experiment,
  company,
  parseTable,
  importRows,
  applySettings,
  number,
  policies,
  poolObservations,
} from "../src/core.js";
const p = {
  code: "F01",
  name: "Cereal",
  price: 4,
  cost: 3,
  ads: 0,
  basis: "variable",
  mixed: false,
};
const row = (patch = {}) => ({
  code: "F01",
  sold: 10000,
  stock: 100000,
  availability: "continuous",
  settings: { ...p },
  incoming: [],
  incomingKnown: true,
  revenue: null,
  cogs: null,
  ...patch,
});
const obs = (patch = {}) => ({
  id: "1",
  days: 1,
  productCodes: ["F01"],
  contaminated: false,
  rows: [row()],
  ...patch,
});
test("contribution examples and required sales for price test", () => {
  assert.equal(metric(row(), 1).margin, 10000);
  assert.equal(
    metric(row({ sold: 9000, settings: { ...p, price: 4.2 } }), 1).margin,
    10800,
  );
  assert.ok(
    Math.abs(priceTest(4, 3, 10000, 4.2).required - 8333.333333) < 0.001,
  );
});
test("unequal periods normalize revenue, COGS, sales and advertising", () => {
  assert.equal(
    metric(row({ sold: 20000, settings: { ...p, ads: 100 } }), 2).margin,
    metric(row({ settings: { ...p, ads: 100 } }), 1).margin,
  );
  assert.equal(metric(row({ sold: 20000 }), 2).rate, 10000);
});
test("blank differs from zero; unavailable estimates never fabricate numbers", () => {
  assert.equal(number(""), null);
  assert.equal(number("0"), 0);
  assert.equal(metric(row({ sold: null }), 1).margin, null);
  assert.equal(metric(row({ sold: 0 }), 1).margin, 0);
  assert.equal(
    plan(p, [obs({ rows: [row({ availability: "unsure" })] })], 3, null).rate,
    null,
  );
  assert.equal(
    plan(
      p,
      [obs({ rows: [row({ stock: 0, availability: "unsure" })] })],
      3,
      null,
    ).coverage,
    0,
  );
  assert.equal(
    plan(p, [obs({ rows: [row({ sold: 0 })] })], 3, null).coverage,
    "No recent sales",
  );
});
test("stockout cannot establish weak demand; clean estimates become stale", () => {
  const a = plan(
    p,
    [
      obs(),
      obs({ id: "2", rows: [row({ sold: 100, availability: "stockout" })] }),
    ],
    3,
    null,
  );
  assert.equal(a.rate, 10000);
  assert.equal(a.stale, true);
  assert.match(
    actions(
      [p],
      [obs({ rows: [row({ availability: "stockout" })] })],
      policies,
      null,
    )[0].text,
    /Restore supply/,
  );
});
test("negative margins and price denominator handled explicitly", () => {
  assert.equal(priceTest(2, 3, 100, 4).required, null);
  assert.equal(priceTest(4, 3, 100, 3).required, null);
  assert.match(
    actions(
      [{ ...p, price: 2 }],
      [obs({ rows: [row({ settings: { ...p, price: 2 } })] })],
      policies,
      null,
    )[0].text,
    /Review price/,
  );
});
test("late incoming excluded and bridge shortage flagged; horizon capped", () => {
  const a = plan(
    p,
    [
      obs({
        rows: [
          row({
            stock: 10000,
            incoming: [
              { qty: 20000, days: 2 },
              { qty: 99999, days: 4 },
            ],
          }),
        ],
      }),
    ],
    3,
    null,
  );
  assert.equal(a.gap, 0);
  assert.equal(a.short, true);
  assert.equal(plan(p, [obs({ rows: [row({ stock: 0 })] })], 3, 1).gap, 10000);
});
test("report Cost maps to TOTAL COGS, not unit cost; repeated imports replace", () => {
  const t = parseTable("Material\tQty\tValue\tCost\nF01\t10000\t40000\t30000");
  const map = { code: "0", sold: "1", revenue: "2", cogs: "3" };
  const once = importRows([row()], t, map),
    twice = importRows(once, t, map);
  assert.deepEqual(once, twice);
  assert.equal(metric(twice[0], 1).margin, 10000);
  assert.equal(twice[0].settings.cost, 3);
  const inventory = parseTable("Material,Stock\nF01,500");
  assert.equal(
    importRows(twice, inventory, { code: "0", stock: "1" })[0].sold,
    10000,
  );
  assert.equal(
    importRows(twice, inventory, { code: "0", stock: "1" })[0].stock,
    500,
  );
});
test("CSV quoting preserved", () => {
  assert.deepEqual(
    parseTable('Material,Description\nF01,"Berry, cereal"').rows,
    [["F01", "Berry, cereal"]],
  );
});
test("ad comparison normalizes periods and requires clean positive stocked phases", () => {
  const b = obs({
      days: 2,
      rows: [row({ sold: 20000, settings: { ...p, ads: 100 } })],
    }),
    a = obs({
      id: "2",
      days: 3,
      rows: [row({ sold: 33000, settings: { ...p, ads: 500 } })],
    });
  const result = experiment(b, a, "F01", 2);
  assert.equal(result.label, "Observed improvement");
  assert.equal(result.extra, 400);
  assert.equal(result.needed, 400);
  assert.equal(result.delta, 600);
  assert.equal(
    experiment(b, { ...a, contaminated: true }, "F01", 2).label,
    "Inconclusive",
  );
  assert.equal(
    experiment(b, { ...a, days: 1 }, "F01", 2).label,
    "Inconclusive",
  );
  assert.equal(
    experiment(b, { ...a, rows: [row({ availability: "unsure" })] }, "F01", 2)
      .label,
    "Inconclusive",
  );
});
test("incomplete company comparison is withheld", () => {
  assert.equal(company(obs({ productCodes: ["F01", "F02"] })), null);
  const b = obs({
      days: 2,
      rows: [row({ sold: 20000, settings: { ...p, ads: 100 } })],
    }),
    a = obs({
      days: 2,
      productCodes: ["F01", "F02"],
      rows: [row({ sold: 20000, settings: { ...p, ads: 200 } })],
    });
  assert.equal(experiment(b, a, "F01", 2).companyDelta, null);
});
test("recommendations do not mutate settings; applications preserve history and need closed boundary", () => {
  const s = {
    products: [{ ...p }],
    observations: [obs()],
    changes: [],
    dirty: false,
  };
  const before = structuredClone(s);
  actions(s.products, s.observations, policies, null);
  assert.deepEqual(s, before);
  const next = applySettings(s, "F01", { price: 4.2 }, "day 3");
  assert.equal(next.products[0].price, 4.2);
  assert.equal(next.observations[0].rows[0].settings.price, 4);
  assert.equal(s.products[0].price, 4);
  assert.throws(() =>
    applySettings({ ...s, dirty: true }, "F01", { price: 5 }, "day 3"),
  );
  assert.throws(() => applySettings(s, "F01", { price: 5 }, ""));
  assert.equal(plan(next.products[0], next.observations, 3, null).rate, null);
});
test("recommendations cap at five and price decreases retain cost plus cent", () => {
  const products = Array.from({ length: 8 }, (_, i) => ({
    ...p,
    code: String(i),
    price: 3.01,
  }));
  const history = [1, 2].map((i) =>
    obs({
      id: String(i),
      productCodes: products.map((p) => p.code),
      rows: products.map((p) => row({ code: p.code, settings: p })),
    }),
  );
  const a = actions(products, history, policies, null);
  assert.equal(a.length, 5);
  assert.ok(a.every((x) => x.price >= 3.01));
});
test("a changed-setting interval prevents recycling older demand when settings return", () => {
  const history = [
    obs(),
    obs({ id: "2", rows: [row({ settings: { ...p, price: 5 } })] }),
    obs({ id: "3", rows: [row({ sold: 2000 })] }),
  ];
  assert.equal(plan(p, history, 3, null).rate, 2000);
});
test("mixed channels retain approximate estimates but suppress price decisions", () => {
  const mixed = { ...p, mixed: true };
  const o = obs({ rows: [row({ settings: mixed })] });
  assert.equal(metric(o.rows[0], 1).approx, true);
  assert.equal(metric({ ...o.rows[0], revenue: 40000 }, 1).approx, false);
  assert.match(
    actions([mixed], [o, o], policies, null)[0].text,
    /Mixed channels/,
  );
});
test("actual revenue and total COGS override estimates independently", () => {
  assert.equal(metric(row({ revenue: 50000 }), 1).margin, 20000);
  assert.equal(metric(row({ cogs: 20000 }), 1).margin, 20000);
  assert.equal(number("   "), null);
});
test("ad tests reject price changes, inadequate stock and losses", () => {
  const b = obs({
    days: 2,
    rows: [row({ sold: 20000, settings: { ...p, ads: 100 } })],
  });
  for (const patch of [
    { settings: { ...p, ads: 200, price: 4.2 } },
    { settings: { ...p, ads: 200 }, stock: 10 },
    { settings: { ...p, ads: 20000 } },
  ]) {
    assert.equal(
      experiment(
        b,
        obs({ days: 2, rows: [row({ sold: 20000, ...patch })] }),
        "F01",
        2,
      ).label,
      "Inconclusive",
    );
  }
});
test("company comparison withheld when another product changes settings", () => {
  const second = { ...p, code: "F02" };
  const b = obs({
    days: 2,
    productCodes: ["F01", "F02"],
    rows: [
      row({ sold: 20000, settings: { ...p, ads: 100 } }),
      row({ code: "F02", settings: second }),
    ],
  });
  const a = obs({
    days: 2,
    productCodes: ["F01", "F02"],
    rows: [
      row({ sold: 22000, settings: { ...p, ads: 200 } }),
      row({ code: "F02", settings: { ...second, price: 5 } }),
    ],
  });
  assert.equal(experiment(b, a, "F01", 2).companyDelta, null);
});

test("pooled advertising phases preserve mixed actual and estimated reports and reject intermediate changes", () => {
  const b = obs({
    days: 2,
    rows: [row({ sold: 20000, settings: { ...p, ads: 100 } })],
  });
  const first = obs({
      id: "2",
      days: 1,
      rows: [
        row({ revenue: 41000, cogs: 30000, settings: { ...p, ads: 200 } }),
      ],
    }),
    second = obs({
      id: "3",
      days: 1,
      rows: [row({ settings: { ...p, ads: 200 } })],
    });
  const pooled = poolObservations([first, second], b, "F01", 200);
  assert.equal(pooled.days, 2);
  assert.equal(pooled.rows[0].revenue, 81000);
  assert.equal(metric(pooled.rows[0], 2).margin, 10300);
  assert.equal(experiment(b, pooled, "F01", 2).label, "Observed improvement");
  assert.equal(
    poolObservations(
      [
        first,
        { ...second, rows: [row({ settings: { ...p, ads: 200, price: 5 } })] },
      ],
      b,
      "F01",
      200,
    ).contaminated,
    true,
  );
});
test("unhealthy margins or unbridged supply never produce a hold recommendation", () => {
  const losing = obs({ rows: [row({ settings: { ...p, ads: 11000 } })] });
  assert.match(
    actions([{ ...p, ads: 11000 }], [losing], policies, null)[0].text,
    /Review advertising/,
  );
  const short = obs({ rows: [row({ stock: 10000, incomingKnown: false })] });
  assert.match(
    actions([p], [short], policies, null)[0].text,
    /Confirm replenishment/,
  );
});
test("game end suppresses supply restoration and price tests even with zero stock", () => {
  const history = [obs(), obs({ id: "2", rows: [row({ stock: 0 })] })];
  const a = actions([p], history, policies, 0);
  assert.match(a[0].text, /Close the game/);
  assert.equal(a[0].price, undefined);
  assert.doesNotMatch(a[0].text, /Restore supply|price.*test/);
  assert.equal(plan(p, history, 3, 0).gap, 0);
});
test("blank mapped import cells clear old data; unmapped cells survive and invalid values reject", () => {
  const previous = [row({ revenue: 40000, cogs: 30000 })];
  const t = parseTable("Material,Qty,Value,Cost\nF01,12000,,36000");
  const result = importRows(previous, t, {
    code: "0",
    sold: "1",
    revenue: "2",
    cogs: "3",
  });
  assert.equal(result[0].revenue, null);
  assert.equal(result[0].sold, 12000);
  assert.equal(result[0].stock, 100000);
  assert.equal(previous[0].revenue, 40000);
  assert.throws(
    () =>
      importRows(previous, parseTable("Material,Qty\nF01,n/a"), {
        code: "0",
        sold: "1",
      }),
    /Invalid sold/,
  );
});
