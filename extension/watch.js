(() => {
  if (globalThis.sailerpWatchTimer) {
    clearInterval(globalThis.sailerpWatchTimer);
    globalThis.sailerpWatchTimer = null;
    return;
  }
  let previous = "";
  globalThis.sailerpWatchTimer = setInterval(() => {
    const report = globalThis.SailERPReadOnly.snapshot();
    if (report.error) return;
    const fingerprint = JSON.stringify([
      report.title,
      report.headers,
      report.rows,
      report.partial,
    ]);
    if (fingerprint === previous) return;
    previous = fingerprint;
    chrome.runtime
      .sendMessage({ type: "sailerp-captured", report })
      .catch(() => {});
  }, 2000);
})();
