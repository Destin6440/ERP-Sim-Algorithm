// Reads rendered text in Chrome's isolated world. No SAP writes or network calls.
(() => {
  const visible = (el) =>
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden";
  const text = (el) =>
    (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  const isMaterial = (value) => /^(material|product code)$/i.test(value);
  const roots = () => {
    const found = [document];
    for (let i = 0; i < found.length; i++)
      for (const el of found[i].querySelectorAll("*"))
        if (el.shadowRoot) found.push(el.shadowRoot);
    return found;
  };
  const headerText = (el) =>
    text(el.querySelector("label,.sapMLabel,.sapUiLbl") || el);
  const cells = (row) =>
    [...row.children].filter((el) =>
      el.matches(
        'td,th,[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]',
      ),
    );
  function snapshot() {
    const scopes = roots(),
      candidates = [],
      titleCandidates = [];
    const diagnostics = {
      tables: 0,
      grids: 0,
      treegrids: 0,
      ui5Tables: 0,
      frames: document.querySelectorAll("iframe,frame").length,
      openShadowRoots: scopes.length - 1,
      headerSamples: [],
    };
    for (const scope of scopes) {
      diagnostics.tables += scope.querySelectorAll("table").length;
      diagnostics.grids += scope.querySelectorAll('[role="grid"]').length;
      diagnostics.treegrids +=
        scope.querySelectorAll('[role="treegrid"]').length;
      diagnostics.ui5Tables += scope.querySelectorAll(".sapUiTable").length;
      titleCandidates.push(
        ...[
          ...scope.querySelectorAll(
            'h1,h2,h3,[role="heading"],.sapMTitle,.sapMText',
          ),
        ]
          .filter(visible)
          .map(text),
      );
      for (const table of scope.querySelectorAll(
        '[role="grid"],[role="treegrid"],[role="table"],.sapUiTable,.sapUiTableCnt,.sapMTable,table',
      )) {
        if (!visible(table)) continue;
        const sourceRows = [
          ...table.querySelectorAll('[role="row"],tr,.sapUiTableTr'),
        ].filter(visible);
        const explicitHeaders = [
          ...table.querySelectorAll(
            '[role="columnheader"],thead th,th:not([scope="row"]):not([role="rowheader"])',
          ),
        ].filter(visible);
        let headers = explicitHeaders.map(headerText),
          headerRow = null;
        // UI5 can place column headers in TDs in a separate table. Keep the shared
        // grid/treegrid/UI5 ancestor so those headers stay paired with body rows.
        for (const row of sourceRows) {
          const values = cells(row).map(headerText);
          if (
            values.some(isMaterial) &&
            values.some((v) =>
              /^(quantity|qty|stock|description|net value|value|cost)$/i.test(
                v,
              ),
            )
          ) {
            headers = values;
            headerRow = row;
            break;
          }
        }
        if (!headers.length && sourceRows[0])
          headers = cells(sourceRows[0]).map(headerText);
        if (diagnostics.headerSamples.length < 12)
          diagnostics.headerSamples.push(headers.slice(0, 20));
        if (!headers.some(isMaterial)) continue;
        const rows = [];
        let misaligned = false;
        for (const row of sourceRows) {
          if (
            row === headerRow ||
            row.querySelector('[role="columnheader"]') ||
            row.closest("thead")
          )
            continue;
          const rowCells = cells(row);
          if (!rowCells.length) continue;
          // TH scope=row/role=rowheader is a data cell, not a column header.
          const values = rowCells.map(text);
          if (
            values.every((v) => !v) ||
            values.join("|") === headers.join("|") ||
            values.some((v) => /^no data$/i.test(v))
          )
            continue;
          if (values.length !== headers.length) {
            misaligned = true;
            continue;
          }
          rows.push(values);
        }
        const declared = Number(table.getAttribute("aria-rowcount")) || null;
        const rowCount = declared > 0 ? declared : null;
        candidates.push({
          headers,
          rows,
          rowCount,
          partial:
            misaligned || (rowCount !== null && rowCount > rows.length + 1),
        });
      }
    }
    const title = (
      titleCandidates.find((t) => /report\s*:.*round.*day/i.test(t)) ||
      titleCandidates.find((t) =>
        /sales.*report|inventory.*report|stock.*report|production.*report|price market.*report/i.test(
          t,
        ),
      ) ||
      document.title
    ).slice(0, 500);
    candidates.sort(
      (a, b) =>
        b.rows.length - a.rows.length ||
        Number(a.partial) - Number(b.partial) ||
        b.headers.length - a.headers.length,
    );
    const table = candidates[0];
    if (!table?.rows.length)
      return { error: "No readable report rows found.", title, diagnostics };
    return {
      version: 1,
      type: "sailerp-report",
      title,
      sourceHost: location.hostname,
      capturedAt: new Date().toISOString(),
      ...table,
    };
  }
  globalThis.SailERPReadOnly = { snapshot };
})();
