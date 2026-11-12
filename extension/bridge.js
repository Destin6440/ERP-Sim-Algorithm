// Only extension messages enter the page bridge. This does not read SAP credentials.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.type !== "sailerp-deliver")
    return;
  if (
    !document.querySelector("#capture-status") ||
    !document.querySelector("#inputs")
  ) {
    respond({
      ok: false,
      error: "Refresh the updated SailERP page before sending.",
    });
    return;
  }
  window.postMessage(
    { type: "sailerp-report-preview", report: message.report },
    location.origin,
  );
  respond({ ok: true });
});
