# SailERP read-only report capture (Chrome / Edge)

This optional Manifest V3 extension reads rendered report-table text in your existing logged-in SAP tab on `https://jenga.ucc.uwm.edu`. It does not log in, read cookies, make API requests, click SAP buttons, change filters, refresh SAP, navigate reports, enter decisions or submit transactions. No credentials, keys, backend or external dependencies are required. Screenshots supplied the header examples; live SAP DOM extraction still needs verification in your browser.

## Install

1. Update your checkout with `git pull` from the SailERP folder.
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Enable **Developer mode**, choose **Load unpacked**, and select `SailERP/extension`.
4. Refresh any SailERP tab that was open before installing. Keep SailERP open at your local server (for example `http://localhost:8000`) or its GitHub Pages repository path if you publish it.
5. Log into SAP normally, open the desired report, and open the extension popup from the browser toolbar. Pin it if useful.

## Capture and import

1. Click **Capture visible report**. Check the rendered row count and headers. The helper attempts regular HTML and ARIA/UI5-style tables, including accessible same-origin frames. It does not extract hidden, unloaded or off-screen virtual rows. Equal detail rows are retained; duplicated table candidates are not added together.
2. Select your SailERP tab in **SailERP destination**, then click **Send to SailERP preview**. Alternatively download the capture JSON and load it under SailERP **Inputs → Read SAP reports**.
3. In SailERP, click **Review captured report**. Choose the report's number format, filter one round/day if necessary, and explicitly enter the observation duration. The heading's “Round 1 Day 1” alone does not prove all report rows cover one day.
4. Verify completeness against SAP totals, filters, pagination and scrollable tables. Confirm that sales Quantity represents **actual units sold during the period**, not open orders or cumulative totals. Confirm that sales Cost is **total period COGS**, not unit cost. If this report does not establish those meanings, use another report or manual entry.
5. Click **Prepare import preview**, review the existing column mapping and period, then replace mapped cells. Captures never save observations or change actual settings automatically.
6. Import current inventory separately by material code. Confirm availability yourself; a sales report does not establish continuous stock. Save only after all required inputs are complete.

Unknown material codes must first be added to Products & actual settings with actual price, unit cost and advertising values. Capturing a report does not invent product settings. Summary and detailed sales tables are alternatives: do not import both as different periods. Mapped cells replace previous draft cells; repeated imports do not add to them. Previously saved exact reports require explicit different-period confirmation before reuse.

## Watching (optional)

**Start watching this report** checks rendered data every two seconds while that tab stays on the same page. Once you have captured and sent a report to an explicitly selected destination tab, later changes are delivered to that tab's **staged preview only**. They never overwrite an open entry grid, import preview, product settings or saved observation. Watcher snapshots replace the latest staged capture. The currently open review retains its original snapshot until you cancel and review again. The browser may throttle checks in background tabs; this is not a real-time API feed.

Open the extension on the source tab and choose **Stop watching this report** to stop. Navigation/reload also stops it. Watching requires a readable report in the top frame; use one-shot Capture for accessible framed reports. It does not navigate sales/inventory pages for you. Keep the required SAP report open and use SAP's own refresh controls yourself.

## Supported interpretation

- Sales: `Material`, `Description`, `Quantity`/`Qty`, `Net Value`/`Value`, and `Cost`. Detail rows are summed by material only within a single selected period. Blank numeric fields remain missing, including when one constituent row is blank. No prices, unit costs or advertising budgets are taken from sales totals.
- Inventory: `Material` plus `Stock`/`Current Stock`/`Unrestricted Stock`/`Unrestricted-use Stock`. One total available finished-product stock row per material is required. Duplicate materials are rejected instead of silently summing possibly overlapping locations/totals. The live inventory report headers have not been supplied; use an export if they do not match.
- **Price Market Report** is not your own current selling price or your own sales. **Production Report** does not by itself establish available finished stock or confirmed future batches. Both are deliberately withheld from observation import.
- **No data** is not imported as zero. Actual numeric zeros in populated rows are valid.
- Number format is explicit. Grouped `1,234.56`, `1.234,56` and space-grouped numbers are supported under the selected decimal convention. Currency symbols and negative corrections require manual review.
- Declared row counts larger than captured rows block import. Unknown counts still require your completeness confirmation. Virtualization, merged headers, totals, hidden filters, cross-origin frames and changed SAP layouts can prevent reliable extraction. Use a complete CSV/TSV export then; there is no native XLSX parser.

## Privacy and permissions

Host permissions cover the supplied SAP host, localhost/127.0.0.1, and destin6440.github.io. The content bridge and destination checks restrict GitHub Pages delivery to this repository's path. `scripting` reads rendered report text after your action; `storage` retains the latest capture and chosen destination locally in the extension. The bridge sends data only to the selected SailERP tab. No remote server receives report data. **Clear stored capture** removes the retained capture and destination; stop watching separately to prevent new captures. SailERP's **Clear staged capture** clears only its preview. Uninstalling the extension removes its local storage.

The local URL patterns cover development ports; only root/index pages are offered as destinations. A local root page that is not SailERP will not display a preview. Restrict host patterns further if your local deployment needs it. Do not use report capture as proof of a production schedule or price elasticity.

## Development verification

`npm test` covers report interpretation. With the local server running, `node scripts/report-browser-check.mjs` runs synthetic report fixtures using the optional Playwright installation described in the root README. Set `PLAYWRIGHT_MODULE` and `SAILERP_URL` as documented there. The reader runs in an isolated browser world; Chrome message transport is simulated because the managed cloud browser blocks installing new extensions. Tests cover staged delivery, explicit completeness/period confirmation, watcher isolation, stopping, partial reports and missing data. Native installation and real authenticated SAP extraction remain unverified.
