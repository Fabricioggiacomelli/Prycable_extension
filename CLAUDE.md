# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Three Ar** is a Chrome extension (Manifest V3) that automates product operations on [prycable.com.br](https://www.prycable.com.br). It targets the `/mob/cotacao/produtos` page and interacts with its React-based UI via DOM manipulation.

Two main automations:
- **Adicionar Produtos** — bulk-adds products by `código,quantidade` pairs to a quote
- **Buscar Descrições** — scrapes product descriptions, minimum quantities, and multiples for export to Excel (TSV)

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
3. **Page scripts (`addScriptMain`, `descScriptMain`, `stopScriptMain`)** — serialized functions from `popup.js` injected into the **MAIN world** (`world: 'MAIN'`) so they can access React internals (`__reactProps*` keys on DOM nodes).

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

### React Input Interaction

The target site uses React controlled inputs. Triggering search or setting quantity requires:
1. Finding the `__reactProps*` key on the input element
2. Using `HTMLInputElement.prototype.value` setter (native setter, bypassing React's override)
3. Firing the React `onChange` handler directly

### Stop Mechanism

A global flag `window.__prycable_stop` is set to `true` by `stopScriptMain`. The running loops check this flag at each iteration. `window.__prycable_running` prevents concurrent executions.

### State Persistence

Textarea contents (`addItems`, `descCodes`) are saved to `chrome.storage.local` on every `input` event and restored on popup open.

### TSV Export

`descScriptMain` stores results in `window.__prycable_tsv`. The "Copiar para Excel" button reads from `lastTsv` in popup memory or falls back to fetching `window.__prycable_tsv` from the page via `executeScript`.
