// Ponte entre o script da página (MAIN world) e o popup da extensão
// Guard para não registrar o listener mais de uma vez por injeção
if (!window.__prycable_bridge) {
  window.__prycable_bridge = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.source === 'PRYCABLE_AUTOMATION') {
      chrome.runtime.sendMessage(event.data).catch(() => {});
    }
  });
}
