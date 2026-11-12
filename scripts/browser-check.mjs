// Optional development check. The application itself has no dependencies.
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.SAILERP_URL || "http://localhost:8000");
  await page
    .getByRole("button", { name: "Open separate demonstration" })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#mode").textContent.includes("DEMONSTRATION"),
  );
  assert.equal(await page.locator("#grid tr").count(), 3);
  await page.locator("#grid input").first().focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.entry),
    "stock",
  );
  const availability = page.locator("#grid select").first();
  await availability.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await availability.inputValue(), "continuous");
  await availability.selectOption("unsure");

  assert.match(await page.locator("#actions").innerText(), /Restore supply/);
  assert.match(await page.locator("#metrics").innerText(), /Shortage/);
  await page.screenshot({
    path: process.env.SAILERP_SCREENSHOT || "/tmp/sailerp-desktop.png",
    fullPage: true,
  });
  // An application cannot change settings with an open observation.
  await page.locator("#grid input").first().fill("100");
  const product = page.locator("#products .product").first();
  await product.locator("[data-field=price]").fill("4.5");
  await product.locator("[data-field=boundary]").fill("day 5 start");
  await product.getByRole("button").click();
  assert.match(
    await page.locator("#message").innerText(),
    /Close the observation/,
  );
  // Import two report types by material. Repeating a sales import replaces.
  async function report(text, days) {
    await page.locator("#paste-open").click();
    await page.locator("#paste").fill(text);
    await page.locator("#preview").click();
    await page.locator("#import-days").fill(days);
    await page.locator("#import-confirm").click();
    if (await page.locator("#import").isVisible()) {
      assert.match(await page.locator("#message").innerText(), /already saved/);
      await page.locator("#new-report-period").check();
      await page.locator("#import-confirm").click();
    }
  }
  const sales =
    "Material\tQty\tValue\tCost\nF01\t20000\t80000\t60000\nF02\t18000\t75600\t54000\nF03\t0\t0\t0";
  // Current open observation defaults to one day; explicitly make it a two-day report period.
  await page.locator("#days").fill("2");
  await report(sales, "2");
  await report(sales, "2");
  await report("Material,Stock\nF01,50000\nF02,90000\nF03,0", "2");
  assert.equal(
    await page.locator("#grid [data-entry=sold]").first().inputValue(),
    "20000",
  );
  assert.equal(
    await page.locator("#grid [data-entry=stock]").first().inputValue(),
    "50000",
  );
  await page.locator("#bulk").selectOption("continuous");
  await page.locator("#save").click();
  assert.equal(
    await page.locator("#grid [data-entry=sold]").first().inputValue(),
    "",
  );
  assert.match(await page.locator("#message").innerText(), /Observation saved/);
  assert.equal(await page.locator("#history p").count(), 3);
  await page.locator("#undo").click();
  assert.equal(
    await page.locator("#grid [data-entry=sold]").first().inputValue(),
    "20000",
  );
  assert.equal(await page.locator("#history p").count(), 2);
  await page.locator("#save").click();
  assert.equal(await page.locator("#history p").count(), 3);
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sailerp-demo-v1")),
  );
  assert.equal(before.observations.at(-1).rows[0].settings.price, 4);
  // Explicit application, immutable history, no auto compounding from stale history.
  const settings = page.locator("#products .product").first();
  await settings.locator("[data-field=price]").fill("4.2");
  await settings.locator("[data-field=boundary]").fill("day 7 start");
  await settings.getByRole("button").click();
  let saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sailerp-demo-v1")),
  );
  assert.equal(saved.products[0].price, 4.2);
  assert.equal(saved.observations.at(-1).rows[0].settings.price, 4);
  assert.match(await page.locator("#metrics").innerText(), /Stale estimate/);
  await page.locator("#undo").click();
  saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sailerp-demo-v1")),
  );
  assert.equal(saved.products[0].price, 4);
  // Advertising test baseline, application boundary and two-day evaluation.
  await page.locator("#ad-product").selectOption("F02");
  await page.locator("#ad-budget").fill("800");
  await page.locator("#ad-boundary").fill("day 7 start");
  await page.locator("#ad-start").click();
  assert.match(
    await page.locator("#experiment").innerText(),
    /Awaiting a new observation/,
  );
  await report(
    "Material,Qty,Value,Cost\nF01,20000,80000,60000\nF02,20000,84000,60000\nF03,0,0,0",
    "2",
  );
  await report("Material,Stock\nF01,50000\nF02,90000\nF03,0", "2");
  await page.locator("#bulk").selectOption("continuous");
  await page.locator("#save").click();
  assert.match(
    await page.locator("#experiment").innerText(),
    /Observed improvement/,
  );
  assert.match(await page.locator("#experiment").innerText(), /1,000/);
  await page.reload();
  await page.locator("#demo").click();
  await page.waitForFunction(
    () => document.querySelectorAll("#grid input").length === 6,
  );
  assert.equal(
    await page.locator("#grid [data-entry=stock]").first().inputValue(),
    "",
  );
  // Restore rejects malformed backups and preserves existing workspace.
  await page.locator("#restore").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":999}'),
  });
  await page.waitForFunction(() =>
    document.querySelector("#message").textContent.includes("Restore rejected"),
  );
  assert.match(await page.locator("#message").innerText(), /Restore rejected/);
  const backup = await page.evaluate(() =>
    localStorage.getItem("sailerp-demo-v1"),
  );
  await page.locator("#demo").click();
  assert.equal(await page.locator("#grid input").count(), 0); // demo isolation
  await page.locator("#restore").setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  await page.waitForFunction(() =>
    document.querySelector("#message").textContent.includes("Backup restored"),
  );
  assert.match(await page.locator("#message").innerText(), /Backup restored/);
  assert.equal(await page.locator("#grid tr").count(), 3);
  await page.locator("#undo").click();
  assert.equal(await page.locator("#grid input").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#demo").click();
  await page.screenshot({ path: "/tmp/sailerp-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: demo isolation, grid, imports, save, history, explicit settings, undo, experiment, persistence, restore rejection, mobile layout; no JS errors.",
  );
} finally {
  await browser.close();
}
