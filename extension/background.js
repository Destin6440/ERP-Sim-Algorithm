function isSailERP(url) {
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
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === "sailerp-captured") {
    if (!sender.tab?.url?.startsWith("https://jenga.ucc.uwm.edu/")) return;
    (async () => {
      await chrome.storage.local.set({ latest: message.report });
      const { destination } = await chrome.storage.local.get("destination");
      if (destination === undefined) {
        respond({ ok: true });
        return;
      }
      const tab = await chrome.tabs.get(destination);
      if (isSailERP(tab.url))
        await chrome.tabs.sendMessage(destination, {
          type: "sailerp-deliver",
          report: message.report,
        });
      respond({ ok: true });
    })().catch(() => respond({ ok: false }));
    return true;
  }
});
