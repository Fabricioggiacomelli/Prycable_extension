# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Three Ar** is a Chrome extension (Manifest V3) that automates quote operations on [prycable.com.br](https://www.prycable.com.br). It does **not** drive the site's UI: every automation calls the site's own REST API from the page context, reusing the logged-in session (`@cable-Token` / `@cable-User` / `@cable-Customer` in `localStorage`). Any authenticated prycable tab works — the popup only checks that the active tab is on the domain.

Main automations (one tab each):
- **Adicionar Produtos** — bulk-adds products by `código,quantidade` pairs to a quote
- **Buscar Descrições** — scrapes product descriptions, minimum quantities, and multiples for export to Excel (TSV)
- **Oferta CRM** — prices products via `/api/product/valorize` with a discount and formats the CRM offer block
- **Buscar Preço** — same valorize call, but outputs only the unit price (`priceWithTaxes`) per line, in the input order, for pasting into Excel (`window.__prycable_prices`). Quantity is optional (`parsePriceLines`): a bare code is priced at the product's `minimumQuantity`; blank input lines are preserved as blank output lines to keep column alignment
- **Follow-up** — changes the status ("motivo") of quotes by number, one sequential `PUT /api/offer/{offerNumber}` each (the API has no bulk endpoint). Success is **204 No Content**; 4xx is not retried. Payload: `{ statusCode, statusName, observation, statusDate, newStatusObj }`, where `newStatusObj` is the motive object read live from `GET /services/dictionary/getOfferSearchAuxTables` › `tmotivo_web` rather than rebuilt locally. All 11 motives have `descriptionRequired: "X"` (observation required); `Y08 Em Negociação` also has `dayRequired` (`statusDate`, sent as ISO `YYYY-MM-DD` — format not captured from the site, unverified). Codes live in `FOLLOWUP_STATUSES`. Because this writes to the ERP, the Executar button requires a second confirming click (8s timeout)

## Loading the Extension

No build step required. Load directly in Chrome:
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder

After code changes, click the **refresh icon** on the extension card in `chrome://extensions/`.

## Architecture

### Execution Model

The extension uses a two-world injection pattern required by Manifest V3:

1. **Popup (`popup.js`)** — runs in the extension context; handles UI, parses user input, and orchestrates script injection via `chrome.scripting.executeScript`.
2. **Content bridge (`content-bridge.js`)** — injected into the page's ISOLATED world; listens for `window.postMessage` from the MAIN world and forwards them to the popup via `chrome.runtime.sendMessage`.
3. **Page scripts (`addScriptMain`, `descScriptMain`, `offerScriptMain`, `priceScriptMain`, `followupScriptMain`, `stopScriptMain`)** — serialized functions from `popup.js` injected into the **MAIN world** (`world: 'MAIN'`). MAIN world is required to read the session from the page's `localStorage` and to issue same-origin `fetch` calls with the site's cookies and Bearer token.
4. **Service worker (`background.js`)** — persists log/state only while the popup is **closed** (the popup persists its own). It checks for an open popup with `chrome.runtime.getContexts({ contextTypes: ['POPUP'] })` — `chrome.extension.getViews()` does not exist in an MV3 service worker.

Each injected script is self-contained by necessity: `chrome.scripting.executeScript({ func })` serializes **only** that function, so shared helpers (auth block, `pauseForUser`, product lookup) are duplicated across them on purpose. Extracting them would require injecting a file instead.

### Communication Flow

```
Page (MAIN world)
  │  window.postMessage({ source: 'PRYCABLE_AUTOMATION', type, ... })
  ▼
content-bridge.js (ISOLATED world)
  │  chrome.runtime.sendMessage(...)
  ▼
popup.js
  │  chrome.runtime.onMessage listener
  ▼
UI update (log, progress bar, state)
```

### Site API surface used

All calls are same-origin, sent with `credentials: 'include'` plus `Authorization: Bearer <@cable-Token>`:

| Call | Used by |
| --- | --- |
| `GET /api/product/?productCodeBegin=&productCodeEnd=…` | all product tabs (description, min/multiple qty) |
| `GET /services/dictionary/getOfferAuxTables` | Adicionar, Oferta CRM, Buscar Preço (payment/delivery defaults) |
| `POST /api/offer` | Adicionar (saves the quote draft) |
| `POST /api/product/valorize` | Oferta CRM, Buscar Preço (returns the array of priced items) |
| `GET /services/dictionary/getOfferSearchAuxTables` | Follow-up (`tmotivo_web` motive dictionary) |
| `PUT /api/offer/{offerNumber}` | Follow-up (status write; **204** = success) |

### Stop Mechanism

A global flag `window.__prycable_stop` is set to `true` by `stopScriptMain`. The running loops check this flag at each iteration. `window.__prycable_running` prevents concurrent executions.

### State Persistence

Every input is written to `chrome.storage.local` on `input`/`change` and restored on popup open: `addItems`, `descCodes`, `offerItems`, `priceItems`, `priceDiscount`, `fupOffers`, `fupStatus`, `fupObs`, `fupDate`. Results survive too (`lastTsv`, `lastOfferText`, `lastPricesText`), which is what re-enables the copy buttons after the popup is reopened. `logEntries` keeps the last 200 log lines; `pauseState` the pause reason.

On open, the popup re-reads the *page* for truth (`__prycable_running`/`__prycable_paused`/`__prycable_mode`) instead of trusting storage, because the popup is destroyed whenever it loses focus while a script keeps running.

### Pause / Retry

`addScriptMain`, `descScriptMain`, `offerScriptMain` and `priceScriptMain` call `pauseForUser()` when a product is missing or below the minimum quantity: it posts `PAUSED`, then polls `window.__prycable_paused`. The popup's **Continuar** re-reads the corresponding textarea line and writes `window.__prycable_retry_override`, so fixing the line in the popup and clicking Continuar retries with the corrected value. `followupScriptMain` never pauses.

### TSV Export

`descScriptMain` stores results in `window.__prycable_tsv`. The "Copiar para Excel" button reads from `lastTsv` in popup memory or falls back to fetching `window.__prycable_tsv` from the page via `executeScript`.
