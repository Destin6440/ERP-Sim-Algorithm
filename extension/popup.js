const $ = (id) => document.getElementById(id);
let latest,
  source,
  diagnostic = null;
const status = (s) => ($("status").textContent = s);
function destination(url) {
  try {
    const u = new URL(url);
    return (
      (["localhost", "127.0.0.1"].includes(u.hostname) &&
        u.protocol === "http:" &&
        ["/", "/index.html"].includes(u.pathname)) ||
      (u.origin === "https://destin6440.github.io" &&
        /^\/ERP-Sim-Algorithm\/(index\.html)?$/.test(u.pathname))
    );
  } catch {
    return false;
  }
}
function show() {
  $("preview").textContent = latest
    ? `${latest.title} · ${latest.capturedAt || "capture time unknown"} · ${latest.rows.length} rendered rows · ${latest.headers.join(", ")}${latest.partial ? " · INCOMPLETE: export all rows instead." : ""}`
    : "No capture yet.";
  $("send").disabled = !latest;
  $("download").disabled = !latest;
}
async function sap() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://jenga.ucc.uwm.edu/"))
    throw Error("Open the ERPsim report tab on jenga.ucc.uwm.edu first.");
  return tab;
}
$("capture").onclick = async () => {
  latest = null;
  diagnostic = null;
  $("diagnostics").disabled = true;
  show();
  try {
    await chrome.storage.local.remove("latest");
    source = await sap();
    await chrome.scripting.executeScript({
      target: { tabId: source.id, allFrames: true },
      files: ["capture.js"],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: source.id, allFrames: true },
      func: () => globalThis.SailERPReadOnly?.snapshot(),
    });
    const reports = results
      .map((r) => r.result)
      .filter((r) => r && !r.error)
      .sort((a, b) => b.rows.length - a.rows.length);
    if (!reports.length) {
      const frames = results.map((r) => r.result?.diagnostics).filter(Boolean);
      diagnostic = {
        version: 1,
        sourceHost: "jenga.ucc.uwm.edu",
        frames: results.map((r) => ({
          frameId: r.frameId,
          title: r.result?.title,
          diagnostics: r.result?.diagnostics,
        })),
      };
      $("diagnostics").disabled = false;
      const count = (key) => frames.reduce((sum, d) => sum + (d[key] || 0), 0);
      throw Error(
        `Capture could not read this layout. Diagnostics: ${results.length} accessible frames; ${count("tables")} tables; ${count("treegrids")} tree grids; ${count("grids")} grids; ${count("ui5Tables")} UI5 tables. Click Download table diagnostics and share that file. It contains table structure and header names, without sales rows or credentials. CSV/TSV export remains available.`,
      );
    }
    latest = reports[0];
    if (!/report/i.test(latest.title)) {
      const parentTitle = results
        .map((r) => r.result?.title)
        .find((t) => t && /report/i.test(t));
      if (parentTitle) latest.title = parentTitle;
    }
    await chrome.storage.local.set({ latest });
    show();
    status(
      "Captured. Check row counts, then send to the selected SailERP tab.",
    );
  } catch (e) {
    status(e.message);
  }
};
$("watch").onclick = async () => {
  try {
    source = await sap();
    await chrome.scripting.executeScript({
      target: { tabId: source.id },
      files: ["capture.js"],
    });
    const [readable] = await chrome.scripting.executeScript({
      target: { tabId: source.id },
      func: () =>
        globalThis.sailerpWatchTimer ||
        !globalThis.SailERPReadOnly.snapshot().error,
    });
    if (!readable.result)
      throw Error(
        "Watching needs a populated top-frame table. Use Capture visible report for accessible framed tables.",
      );
    await chrome.scripting.executeScript({
      target: { tabId: source.id },
      files: ["watch.js"],
    });
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: source.id },
      func: () => !!globalThis.sailerpWatchTimer,
    });
    $("watch").textContent = r.result
      ? "Stop watching this report"
      : "Start watching this report";
    status(
      r.result
        ? "Watching rendered rows in this tab. Capture and send once to choose the destination. No SAP refreshes are performed."
        : "Watching stopped.",
    );
  } catch (e) {
    status(e.message);
  }
};
$("send").onclick = async () => {
  try {
    if (!latest) throw Error("Capture a report first.");
    const id = Number($("destination").value);
    if (!$("destination").value)
      throw Error("Open SailERP in another tab and reopen this helper.");
    const tab = await chrome.tabs.get(id);
    if (!destination(tab.url))
      throw Error("Destination is no longer a SailERP page.");
    const response = await chrome.tabs.sendMessage(id, {
      type: "sailerp-deliver",
      report: latest,
    });
    if (!response?.ok) throw Error("Delivery failed.");
    await chrome.storage.local.set({ destination: id });
    status(
      "Sent to the SailERP preview. Review and confirm there; no observation was saved.",
    );
  } catch (e) {
    status(
      e.message + " If SailERP was open before installing, refresh its tab.",
    );
  }
};
$("download").onclick = () => {
  if (!latest) return;
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(latest, null, 2)], { type: "application/json" }),
    );
  a.href = url;
  a.download = "sailerp-report-capture.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("clear").onclick = async () => {
  await chrome.storage.local.remove(["latest", "destination"]);
  latest = null;
  show();
  status(
    "Stored capture and destination cleared. Stop watching separately if enabled.",
  );
};
(async () => {
  try {
    ({ latest } = await chrome.storage.local.get("latest"));
    show();
    const tabs = (await chrome.tabs.query({})).filter((t) =>
      destination(t.url),
    );
    for (const tab of tabs) {
      const option = document.createElement("option");
      option.value = tab.id;
      option.textContent = `${tab.title || "SailERP"} — ${tab.url}`;
      $("destination").append(option);
    }
    if (!tabs.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Open SailERP in another tab";
      $("destination").append(option);
    }
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.url?.startsWith("https://jenga.ucc.uwm.edu/")) {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => !!globalThis.sailerpWatchTimer,
      });
      $("watch").textContent = r.result
        ? "Stop watching this report"
        : "Start watching this report";
    }
  } catch (e) {
    status(e.message);
  }
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.latest) return;
  latest = changes.latest.newValue;
  show();
});

$("diagnostics").onclick = () => {
  if (!diagnostic) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(diagnostic, null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "sailerp-table-diagnostics.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
