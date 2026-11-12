// Synthetic SAP-shaped DOM fixtures with simulated Chrome extension transport.
// Managed cloud Chromium blocks installing unpacked extensions. This does not test
// native extension installation or access the live SAP service.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext(),
  errors = [];
context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
try {
  const source = await context.newPage();
  await source.route("https://jenga.ucc.uwm.edu/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: readFileSync("tests/fixtures/sap-summary.html", "utf8"),
    }),
  );
  await source.goto("https://jenga.ucc.uwm.edu/er");
  const cdp = await context.newCDPSession(source),
    { frameTree } = await cdp.send("Page.getFrameTree"),
    { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "SailERP read-only fixture",
    });
  const isolated = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", {
      contextId: executionContextId,
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await isolated(readFileSync("extension/capture.js", "utf8"));
  let capture = await isolated("globalThis.SailERPReadOnly.snapshot()");
  assert.equal(capture.rows.length, 2);
  assert.equal(capture.headers[5], "Quantity");
  assert.equal(capture.partial, false);
  assert.equal(
    await source.evaluate(() => typeof globalThis.SailERPReadOnly),
    "undefined",
  );
  const app = await context.newPage();
  await app.addInitScript(() => {
    window.chrome = {
      runtime: {
        id: "sailerp-fixture",
        onMessage: {
          addListener: (fn) => (window.fixtureExtensionListener = fn),
        },
      },
    };
  });
  await app.goto(process.env.SAILERP_URL || "http://127.0.0.1:8001");
  await app.addScriptTag({ path: "extension/bridge.js" });
  const deliver = (report) =>
    app.evaluate(
      (report) =>
        window.fixtureExtensionListener(
          { type: "sailerp-deliver", report },
          { id: "sailerp-fixture" },
          () => {},
        ),
      report,
    );
  await app.locator("#capture-file").setInputFiles({
    name: "capture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(capture)),
  });
  await app.waitForFunction(() =>
    document
      .querySelector("#capture-status")
      .textContent.includes("Report ready"),
  );
  assert.equal(await app.locator("#grid input").count(), 0);
  // Actual settings are explicitly entered, not inferred from sales totals.
  for (const [code, name] of [
    ["JJ-F01", "Nut"],
    ["JJ-F02", "Blueberry"],
  ]) {
    app.once("dialog", (d) => d.accept(code));
    await app.locator("#add").click();
    const row = app.locator(`.product[data-code="${code}"]`);
    for (const [field, value] of Object.entries({
      name,
      price: "4",
      cost: "3",
      ads: "500",
      boundary: "Round 1 Day 1 start",
    }))
      await row.locator(`[data-field=${field}]`).fill(value);
    await row.getByRole("button").click();
  }
  await deliver(capture);
  await app.locator("#capture-review").click();
  await app.locator("#capture-days").fill("1");
  await app.locator("#capture-prepare").click();
  assert.match(
    await app.locator("#capture-preview-message").innerText(),
    /Confirm report completeness/,
  );
  await app.locator("#capture-complete").check();
  await app.locator("#capture-prepare").click();
  assert.equal(await app.locator("#import").isVisible(), true);
  assert.match(await app.locator("#import-message").innerText(), /TOTAL COGS/);
  await app.locator("#import-confirm").click();
  assert.equal(
    await app.locator("#grid [data-entry=sold]").first().inputValue(),
    "10000",
  );
  assert.equal(
    await app.locator("#grid [data-entry=stock]").first().inputValue(),
    "",
  );
  assert.equal(
    await app.locator("#grid select").first().inputValue(),
    "unsure",
  );
  assert.equal(
    await app.locator("#products [data-field=cost]").first().inputValue(),
    "3",
  );
  assert.equal(
    (await app.evaluate(() => JSON.parse(localStorage.getItem("sailerp-v1"))))
      .observations.length,
    0,
  );
  // Run the actual watcher with a simulated Chrome runtime message boundary.
  let watched = null,
    lastDelivery = Promise.resolve();
  await cdp.send("Runtime.addBinding", {
    name: "sailerpFixtureSend",
    executionContextId,
  });
  cdp.on("Runtime.bindingCalled", (event) => {
    if (event.name !== "sailerpFixtureSend") return;
    const msg = JSON.parse(event.payload);
    watched = msg.report;
    lastDelivery = deliver(watched);
  });
  await isolated(
    "globalThis.chrome={runtime:{sendMessage:msg=>{sailerpFixtureSend(JSON.stringify(msg));return Promise.resolve();}}}",
  );
  await isolated(readFileSync("extension/watch.js", "utf8"));
  await source
    .locator("tbody tr")
    .first()
    .locator("td")
    .nth(5)
    .evaluate((el) => (el.textContent = "12,000"));
  for (let attempt = 0; attempt < 12; attempt++) {
    if (watched?.rows[0][5] === "12,000") break;
    await new Promise((r) => setTimeout(r, 250));
    if (attempt === 11) throw Error("Watcher did not stage changed data.");
  }
  await lastDelivery;
  assert.equal(
    await app.locator("#grid [data-entry=sold]").first().inputValue(),
    "10000",
  );
  await app.locator("#capture-review").click();
  assert.match(await app.locator("#capture-table").innerText(), /12,000/);
  await app.locator("#capture-cancel").click();
  await isolated(readFileSync("extension/watch.js", "utf8"));
  assert.equal(await isolated("!!globalThis.sailerpWatchTimer"), false);
  await source
    .locator("[role=grid]")
    .evaluate((el) => el.setAttribute("aria-rowcount", "100"));
  const incomplete = await isolated("globalThis.SailERPReadOnly.snapshot()");
  assert.equal(incomplete.partial, true);
  await deliver(incomplete);
  await app.locator("#capture-review").click();
  assert.equal(await app.locator("#capture-prepare").isDisabled(), true);
  await app.locator("#capture-cancel").click();
  await source
    .locator("tbody")
    .evaluate((el) => (el.innerHTML = '<tr><td colspan="8">No data</td></tr>'));
  assert.match(
    (await isolated("globalThis.SailERPReadOnly.snapshot()")).error,
    /No readable/,
  );
  // SAP UI5 analytical tables can be treegrids, use separate header/body
  // tables, TD column labels, and TH row headers. All are rendered data.
  await source
    .locator("body")
    .evaluate(
      (el) =>
        (el.innerHTML = `<h2>Sales Report : Round 1 Day 6</h2><div class="sapUiTable" role="treegrid"><div><table><tr><td>Round</td><td>Day</td><td>Material</td><td>Description</td><td>Quantity</td><td>Net Value</td><td>Cost</td></tr></table></div><div><table><tr><th scope="row" role="rowheader">01</th><td>04</td><td>JJ-F04</td><td>Raisin</td><td>6,769</td><td>25,654.51</td><td>20,307</td></tr><tr><th scope="row" role="rowheader">01</th><td>02</td><td>JJ-F11</td><td>Nut</td><td>5,601</td><td>25,820.61</td><td>16,803</td></tr></table></div></div>`),
    );
  const tree = await isolated("globalThis.SailERPReadOnly.snapshot()");
  assert.equal(tree.rows.length, 2);
  assert.equal(tree.headers[2], "Material");
  assert.equal(tree.rows[0][2], "JJ-F04");
  assert.equal(tree.rows[0][4], "6,769");
  assert.equal(tree.partial, false);
  // Empty-layout diagnostics contain structure/header labels, not sales rows.
  await source
    .locator("body")
    .evaluate(
      (el) =>
        (el.innerHTML = '<h2>Sales Report</h2><div role="treegrid"></div>'),
    );
  const diagnostic = await isolated("globalThis.SailERPReadOnly.snapshot()");
  assert.equal(diagnostic.diagnostics.treegrids, 1);
  assert.ok(diagnostic.error);
  await app.locator("#paste-open").click();
  await app
    .locator("#paste")
    .fill("Material\tQuantity\tNet Value\tCost\nJJ-F01\t12000\t48000\t36000");
  await app.locator("#preview").click();
  assert.equal(await app.locator("[data-map=sold]").inputValue(), "1");
  assert.equal(await app.locator("[data-map=revenue]").inputValue(), "2");
  assert.equal(await app.locator("[data-map=cogs]").inputValue(), "3");
  await app.locator("#import-close").click();
  assert.deepEqual(errors, []);
  console.log(
    "Report fixture browser checks passed: isolated-world extraction, simulated extension bridge, period/completeness confirmation, total COGS, missing stock, unchanged settings, watcher isolation/stop, partial capture blocking and empty reports. Native extension installation and live SAP remain unverified.",
  );
} finally {
  await context.close();
  await browser.close();
}
