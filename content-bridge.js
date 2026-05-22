// Ponte entre o script da página (MAIN world) e o popup da extensão
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.source === 'PRYCABLE_AUTOMATION') {
    chrome.runtime.sendMessage(event.data).catch(() => {});
  }
});
