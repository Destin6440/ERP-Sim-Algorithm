import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
function background(url = "http://localhost:8000/") {
  let listener;
  const sent = [],
    stored = { destination: 12 };
  const chrome = {
    runtime: {
      id: "fixture-extension",
      onMessage: { addListener: (fn) => (listener = fn) },
    },
    storage: {
      local: {
        set: async (value) => Object.assign(stored, value),
        get: async (key) => ({ [key]: stored[key] }),
      },
    },
    tabs: {
      get: async (id) => ({ id, url }),
      sendMessage: async (id, message) => sent.push({ id, message }),
    },
  };
  vm.runInNewContext(
    readFileSync(
      new URL("../extension/background.js", import.meta.url),
      "utf8",
    ),
    { chrome, URL },
  );
  return { listener, sent, stored };
}
const sender = {
  id: "fixture-extension",
  tab: { url: "https://jenga.ucc.uwm.edu/er" },
};
test("extension transport retains reports and delivers only to the selected SailERP tab", async () => {
  const b = background(),
    report = { type: "sailerp-report", rows: [["F01", "0"]] };
  const response = await new Promise((resolve) => {
    assert.equal(
      b.listener({ type: "sailerp-captured", report }, sender, resolve),
      true,
    );
  });
  assert.equal(response.ok, true);
  assert.deepEqual(b.stored.latest, report);
  assert.equal(b.sent.length, 1);
  assert.equal(b.sent[0].id, 12);
  assert.equal(b.sent[0].message.report, report);
});
test("extension transport rejects foreign senders and avoids unrelated destination pages", async () => {
  for (const untrusted of [
    { ...sender, id: "other" },
    { ...sender, tab: { url: "https://other.example/" } },
  ]) {
    const b = background();
    assert.equal(
      b.listener({ type: "sailerp-captured", report: {} }, untrusted, () => {}),
      undefined,
    );
    assert.equal(b.stored.latest, undefined);
    assert.equal(b.sent.length, 0);
  }
  for (const url of [
    "https://unrelated.example/",
    "http://localhost:8000/other-app/",
    "https://destin6440.github.io/other-repository/",
  ]) {
    const b = background(url);
    await new Promise((resolve) =>
      b.listener({ type: "sailerp-captured", report: {} }, sender, resolve),
    );
    assert.equal(b.sent.length, 0);
  }
});
test("extension transport stages without a destination and does not open new tabs", async () => {
  const b = background();
  delete b.stored.destination;
  await new Promise((resolve) =>
    b.listener(
      { type: "sailerp-captured", report: { rows: [] } },
      sender,
      resolve,
    ),
  );
  assert.equal(b.sent.length, 0);
  assert.ok(b.stored.latest);
});
