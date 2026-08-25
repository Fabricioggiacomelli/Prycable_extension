// Service worker — persiste log e estado quando o popup está FECHADO.
// Com o popup aberto, ele mesmo já grava tudo (logEntriesCache em popup.js),
// então aqui a gravação é ignorada para não duplicar entradas.

const MAX_LOG_ENTRIES = 200;

// chrome.extension.getViews() não existe em service worker (MV3) — a checagem
// de popup aberto tem que passar por chrome.runtime.getContexts().
// Na dúvida assume aberto: perder uma linha de log é melhor que duplicar todas.
async function isPopupOpen() {
  if (!chrome.runtime.getContexts) return true;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['POPUP'] });
    return contexts.length > 0;
  } catch {
    return true;
  }
}

function appendLogEntry(msg) {
  chrome.storage.local.get(['logEntries'], (data) => {
    const t = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = { text: `[${t}] ${msg.text}`, level: msg.level || '' };
    const entries = (data.logEntries || []).concat(entry);
    if (entries.length > MAX_LOG_ENTRIES) entries.splice(0, entries.length - MAX_LOG_ENTRIES);
    chrome.storage.local.set({ logEntries: entries });
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source !== 'PRYCABLE_AUTOMATION') return;

  // O trabalho assíncrono fica dentro de uma IIFE: devolver a Promise aqui
  // sinalizaria ao remetente que haverá sendResponse.
  (async () => {
    if (await isPopupOpen()) return;

    if (msg.type === 'LOG') {
      appendLogEntry(msg);
    }

    if (msg.type === 'PAUSED') {
      chrome.storage.local.set({ pauseState: { code: msg.code, reason: msg.reason } });
    }

    if (msg.type === 'DONE') {
      chrome.storage.local.remove('pauseState');
      if (msg.data?.tsv)        chrome.storage.local.set({ lastTsv: msg.data.tsv });
      if (msg.data?.offerText)  chrome.storage.local.set({ lastOfferText: msg.data.offerText });
      if (msg.data?.pricesText) chrome.storage.local.set({ lastPricesText: msg.data.pricesText });
    }
  })();
});
