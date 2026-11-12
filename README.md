# SailERP

A fast, local browser decision desk for the ERPsim manufacturing game. Vanilla HTML, CSS and JavaScript; no backend, accounts, API keys, build step or runtime dependencies. All transactions remain manual in SAP.

## Run locally

Use Python 3 to serve this directory:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000` in your own browser. Use an HTTP server rather than opening `index.html` directly (ES modules and sample loading require HTTP). Node 24 is used for tests:

```sh
npm test
```

There is nothing to install for the application or calculation tests. CI runs the same tests on pushes and pull requests.

## GitHub Pages

Commit these files to your intended repository. In GitHub **Settings → Pages**, select **Deploy from a branch**, your branch, and **/(root)**. The app uses relative URLs and works under a repository subpath. No repository destination or remote has been created by the app. Publishing is a separate action you control.

## Inputs and Outputs

**Inputs** is the single area for period observations, product settings, incoming batches, report totals, days remaining, policies, price-test inputs, advertising experiment controls, and backup/restore. **Outputs** contains direct actions, calculation tables, price-test results, advertising comparisons, and saved observation history. The top navigation jumps between the two areas. Saving an observation takes you to Outputs; the Inputs link brings you back to enter the next period. Existing saved browser data is preserved.

## A quick round

1. Add products with unique material codes. Set actual unit selling price, unit cost, cost basis and total advertising per simulated day across regions. Confirm **Applied in SAP** with the next boundary (for example, “Round 1, day 3 start”). This records your confirmation, not a SAP operation.
2. Cover a complete simulation period under those settings. Enter shared simulated days, units sold during that period and current stock. Tab, Enter and up/down arrows navigate the grid. Set availability individually or in bulk; default is **Unsure**.
3. Expand optional inputs for actual period revenue, **total** COGS, incoming finished products and game days remaining. Incoming syntax is `quantity:days`, comma separated. Check the confirmation box even if the confirmed list is empty. Blank incoming with no confirmation means unknown orders.
4. Save the observation. All required sales and stock cells clear. History retains a deep copy of the actual settings. Recommendations never apply automatically. Close each observation before changing settings. Mark a mid-period change as contaminated; it is excluded from clean planning and advertising conclusions.
5. Read up to five prioritized direct actions with short numerical explanations, then enter your decisions in SAP yourself. Action cards use instructions such as “Set the test price to …” and “Run a … price test”; missing-data limits remain explicit. The price calculator reports required sales, not predicted sales. After an application, gather a fresh observation before considering another change.

New products start with zero placeholder settings; replace these with real settings before collecting a meaningful baseline. No current job aid was supplied. Use your instructor's current ERPsim job aid for actual timing, costs, transaction procedures, capacity and game rules.

## Reports and fast entry

Open **Paste report** for CSV/TSV. Preview and map columns explicitly; confirm the simulated period. `Material` maps to code, `Qty` to units sold, `Value` to period revenue, `Cost` to **total period COGS**, and `Stock` to current inventory. `Description` is display information, not a key. Codes must match existing products exactly; unknown codes are skipped and the matching row count is reported. Numeric cells must be plain, ungrouped numbers in the selected currency (decimal point; no currency symbols). CSV quoting supports commas in descriptions. Native XLSX is intentionally unsupported: export CSV/TSV first.

Import sales and inventory tables separately into the same open observation to join by material code. Mapped cells **replace** values; importing a report again does not add quantities. Unmapped cells remain intact; blank numeric report cells do not replace existing values. Verify the preview and grid, especially if reports contain duplicate codes (last valid mapped value wins). A saved observation closes a period. Exact previously saved reports are blocked unless you explicitly confirm they belong to a genuinely different simulation period. To correct the latest saved observation, undo it first, then import its replacement. Undo the last update if necessary. Sales and stock never carry into the next grid automatically.

`samples/sales.tsv` and `samples/inventory.csv` are synthetic two-day reports. **Open separate demonstration** loads `samples/demo.json` into a separate localStorage namespace. It never replaces the live workspace. Return to your workspace with the same button.

## Formulas and interpretation

- Observed units/day = period units sold / simulated days.
- Margin after ads/day = (period revenue − period COGS − daily advertising × days) / days. Actual per-product revenue and total COGS override their respective price × units and unit-cost × units estimates independently. Standard/accounting cost produces an **accounting margin proxy**. Fixed costs, financing and other expenses are excluded: this is **not net profit**.
- Planning demand is total units / total days across eligible continuously stocked observations since the last mismatching observation, under matching actual price, cost, cost basis, advertising and channel settings. Unknown availability is excluded. Stockouts establish only a lower bound on demand, never weak demand. A planning estimate is marked stale when the latest observation is not eligible under current settings.
- Coverage = current stock / planning units per day. Zero stock is zero coverage, including when demand is unknown. Positive stock with zero estimated sales shows **No recent sales**. Missing estimates remain missing.
- Horizon = target days capped by known remaining game days. Draft gap = max(0, ceil(planning daily demand × horizon − current stock − confirmed incoming arriving within horizon)). Arrivals outside the horizon are excluded. A chronological stock balance checks whether supply runs out before an arrival or horizon. Batches are not stock available today. Without capacity, raw materials and order status, this is a **draft quantity**, never a feasible production schedule. Unconfirmed incoming makes it provisional.
- Price test required daily sales = old daily sales × (old price − unit cost) / (test price − unit cost), assuming unchanged costs and advertising. Nonpositive baseline or test unit margins return no required-sales number. Suggested decreases cannot fall below cost + 0.01. There is no elasticity model, predicted demand or profit-per-factory-hour claim.
- Suggested starting policies: 2% price step, 3-day target, 1-day buffer and 2 simulated days per experiment phase. They are editable defaults, not mathematical optima. Supply price tests require a known replenishment wait; excessive-inventory decreases require at least two clean observations. Mixed-channel monetary estimates are marked approximate when actual revenue is absent; channel-specific price recommendations are withheld.

## Advertising experiments

Only one experiment can run at a time. Save a clean baseline with positive margin, at least the minimum phase length, continuous availability, and known current stock covering the minimum phase plus buffer. Enter an increased proposed daily budget and explicit next application boundary; the button records your **Applied in SAP** confirmation and snapshots the baseline. Prices and cost settings must match the baseline. Collect new complete periods starting at that boundary. Multiple post-boundary observations are normalized over their total days; contaminated settings or availability make the comparison inconclusive. Closing the experiment keeps the actual applied budget; it does not roll SAP or product settings back.

The comparison reports additional ads/day, observed product margin change/day and extra ads/day / positive unit margin as break-even extra units/day. It compares company margin only when both periods contain the same complete product set. Outcomes are **Observed improvement**, **Observed deterioration**, or **Inconclusive**. Equal margins, inadequate stock or days, nonpositive margins, unknown/stockout availability and changed price/cost settings cannot establish a result. Before/after results do not prove causality because competitors and demand can change. Aggregate product data cannot reveal the best advertising region.

## Persistence, privacy and recovery

Data remains in this browser's localStorage, scoped to the site origin; no analytics or external requests are used by the app. Export JSON regularly. Restore replaces the current workspace after structural validation; **Undo last update** is available within the current session. Undo covers saved observations, settings, policy changes, experiments and restores. Undoing a save also restores its entry grid so you can correct and save it again. Open grid cells are ephemeral; reloading discards them. Stored history is immutable through the app (a user can of course edit their own JSON). LocalStorage is not encrypted, shared, or durable across browser clearing. Do not store secrets. Different ports/origins and the demonstration have separate data.

## Verification and limitations

Calculation and state-transition tests live in `tests/core.test.js`; core functions in `src/core.js` are independent of DOM code in `src/app.js`. Tests cover numerical examples, unequal periods, blanks/zeros, stockouts, nonpositive margins, late arrivals, total COGS, incomplete company comparisons, contaminated ads, repeated imports, immutable history and advisory-only recommendations. No simulator, SAP integration or strategy guarantee is included.

Research context (not a claim of calibrated parameters):

- [ERPsim overview](https://erpsim.hec.ca/en/erpsim)
- [2020–2021 manufacturing participant guide](https://studylib.net/doc/27923638/2020-2021-manufacturing-participantsguide)
- [Research reference, DOI 10.1287/msom.2015.0520](https://doi.org/10.1287/msom.2015.0520)

Game settings vary. The current instructor job aid takes priority over old guides and all suggested policies here.

### Optional browser regression check

With the local server running and Chromium installed, install the **development-only** browser driver outside the checkout and run:

```sh
npm install --prefix /tmp/sailerp-browser --cache /tmp/sailerp-npm-cache --no-audit --no-fund playwright
PLAYWRIGHT_MODULE=/tmp/sailerp-browser/node_modules/playwright/index.mjs node scripts/browser-check.mjs
```

Set `CHROMIUM_PATH` if Chromium is not `/usr/bin/chromium`, or `SAILERP_URL` for a different server. This isolated browser check exercises synthetic data, imports, persistence, history, settings application, undo, advertising comparisons, backup validation and a narrow mobile viewport; screenshots are written to `/tmp/sailerp-desktop.png` and `/tmp/sailerp-mobile.png`. It does not change your normal browser data. No browser driver is loaded by the application.

### Synthetic 30-day walkthrough

Run `node scripts/simulate-30-days.mjs` to reproduce the conversation's single-product example. This writes `samples/day30-simulation.csv` and a restorable `samples/day30-simulation.json` backup. Restoring it replaces the selected workspace; use the separate demonstration workspace to inspect it safely.

The example retains Days 1–4, then assumes 9,000 sales/day, price 4.08, variable cost 3.00, and advertising 500/day through Day 30. All later receipts occur before sales. Receipts are synthetic confirmed inputs, with capacity, materials and lead times assumed feasible: 21,000 on Day 5; 27,000 on Days 6, 9, 12, 15, 18, 21 and 24; and 18,000 on Day 27. Game length is explicitly assumed to be 30 simulated days. The script checks stock conservation, margin totals and the generated actions. These assumed sales are not forecasts; the receipts do not establish a feasible production schedule or an optimal ordering policy.

At zero remaining game days, action cards close the game and stop new replenishment and future advertising, instead of replenishing an end-of-game zero stock balance.
