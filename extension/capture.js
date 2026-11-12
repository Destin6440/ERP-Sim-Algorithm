// Runs in Chrome's isolated content-script world. It only reads rendered text.
(() => {
  const visible = (el) =>
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden";
  const text = (el) =>
    (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  function snapshot() {
    const candidates = [];
    for (const table of document.querySelectorAll(
      '[role="grid"], [role="table"], table',
    )) {
      if (!visible(table)) continue;
      const headerEls = [
        ...table.querySelectorAll('[role="columnheader"], th'),
      ].filter(visible);
      let headers = headerEls.map(text);
      const sourceRows = [...table.querySelectorAll('[role="row"], tr')].filter(
        visible,
      );
      if (!headers.length) {
        const first = sourceRows[0];
        headers = first ? [...first.children].map(text) : [];
      }
      if (!headers.some((h) => /^(material|product code)$/i.test(h))) continue;
      const rows = [];
      const seen = new Set();
      for (const row of sourceRows) {
        if (row.querySelector('[role="columnheader"], th')) continue;
        const cells = [
          ...row.querySelectorAll(
            ':scope > td, :scope > [role="gridcell"], :scope > [role="cell"]',
          ),
        ].map(text);
        if (
          !cells.length ||
          cells.every((v) => !v) ||
          cells.join("|") === headers.join("|") ||
          cells.some((v) => /^no data$/i.test(v))
        )
          continue;
        // The same DOM row can match both role and tag selectors; never deduplicate equal *data* rows.
        if (seen.has(row)) continue;
        seen.add(row);
        rows.push(cells);
      }
      const rowCount = Number(table.getAttribute("aria-rowcount")) || null;
      candidates.push({
        headers,
        rows,
        rowCount,
        partial: rowCount !== null && rowCount > rows.length + 1,
      });
    }
    candidates.sort(
      (a, b) =>
        b.rows.length - a.rows.length || b.headers.length - a.headers.length,
    );
    const table = candidates[0];
    if (!table || !table.rows.length)
      return {
        error:
          "No rendered report rows found. “No data” is not zero sales. Open a populated report or use an export.",
      };
    const titleCandidates = [
      ...document.querySelectorAll(
        'h1,h2,h3,[role="heading"],.sapMTitle,.sapMText',
      ),
    ]
      .filter(visible)
      .map(text);
    const title =
      titleCandidates.find((t) => /report\s*:.*round.*day/i.test(t)) ||
      titleCandidates.find((t) =>
        /sales.*report|inventory.*report|stock.*report|production.*report|price market.*report/i.test(
          t,
        ),
      ) ||
      document.title;
    return {
      version: 1,
      type: "sailerp-report",
      title: title.slice(0, 500),
      sourceHost: location.hostname,
      capturedAt: new Date().toISOString(),
      ...table,
    };
  }
  globalThis.SailERPReadOnly = { snapshot };
})();
