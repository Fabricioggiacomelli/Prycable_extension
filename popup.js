// ═══════════════════════════════════════════════
// SCRIPTS INJETADOS NA PÁGINA (MAIN world)
// Essas funções são serializadas e enviadas ao contexto da página
// ═══════════════════════════════════════════════

function addScriptMain(items) {
  if (window.__prycable_running) {
    window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'LOG', text: 'Já existe um script em execução! Aguarde ou recarregue a página.', level: 'error' }, '*');
    return;
  }

  (async () => {
    const log = (text, level) => window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'LOG', text, level }, '*');
    const prog = (cur, tot) => window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'PROGRESS', current: cur, total: tot }, '*');
    const done = (data) => window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'DONE', data }, '*');

    window.__prycable_stop = false;
    window.__prycable_running = true;

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function waitFor(selector, timeout = 5000) {
      return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const obs = new MutationObserver(() => {
          const el = document.querySelector(selector);
          if (el) { obs.disconnect(); resolve(el); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); reject(new Error('timeout: ' + selector)); }, timeout);
      });
    }

    if (!window.location.href.includes('/cotacao/produtos')) {
      log('Navegando para a página de produtos...', 'info');
      window.location.href = 'https://www.prycable.com.br/mob/cotacao/produtos';
      await sleep(3000);
    }

    await waitFor('input#simplesearch', 8000).catch(() => null);
    await sleep(500);

    function triggerSearch(code) {
      const input = document.querySelector('input#simplesearch');
      if (!input) return false;
      const rk = Object.keys(input).find(k => k.startsWith('__reactProps'));
      if (!rk) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input[rk].onChange({ target: input });
      setter.call(input, code);
      input[rk].onChange({ target: input });
      return true;
    }

    function setQty(qty) {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const input = dialog.querySelector('input.MuiInputBase-input');
      if (!input) return false;
      const rk = Object.keys(input).find(k => k.startsWith('__reactProps'));
      if (!rk) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(qty));
      input[rk].onChange({ target: input });
      return true;
    }

    const success = [], notFound = [], errors = [];

    for (let i = 0; i < items.length; i++) {
      if (window.__prycable_stop) {
        log('Execução interrompida pelo usuário.', 'warning');
        break;
      }

      const { code, qty } = items[i];
      log(`[${i + 1}/${items.length}] Processando ${code} | qtd: ${qty}`, 'info');
      prog(i, items.length);

      if (!triggerSearch(code)) {
        log(`❌ Campo de busca não encontrado`, 'error');
        errors.push(code);
        continue;
      }

      const listItem = await waitFor('.MuiBox-root.css-1n5hnmz', 6000).catch(() => null);
      if (!listItem) {
        log(`⚠️ Produto ${code} não encontrado`, 'warning');
        notFound.push(code);
        continue;
      }

      listItem.click();

      const dialog = await waitFor('[role="dialog"] input.MuiInputBase-input', 5000).catch(() => null);
      if (!dialog) {
        log(`❌ Modal não abriu para ${code}`, 'error');
        errors.push(code);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(500);
        continue;
      }

      await sleep(100);

      if (!setQty(qty)) {
        log(`❌ Erro ao definir quantidade para ${code}`, 'error');
        errors.push(code);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(500);
        continue;
      }

      await sleep(300);

      const btns = document.querySelectorAll('[role="dialog"] button');
      const addBtn = Array.from(btns).find(b => b.innerText.includes('incluir outro'));
      if (!addBtn) {
        log(`❌ Botão "incluir outro" não encontrado para ${code}`, 'error');
        errors.push(code);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(500);
        continue;
      }

      addBtn.click();
      log(`✅ ${code} (${qty}) adicionado`, 'success');
      success.push(`${code} (${qty})`);
      await sleep(800);
    }

    prog(items.length, items.length);
    log('────────────────────────────', 'info');
    log(`✅ Adicionados com sucesso: ${success.length} de ${items.length}`, 'success');
    if (notFound.length) log(`⚠️  Não encontrados (${notFound.length}): ${notFound.join(', ')}`, 'warning');
    if (errors.length) log(`❌ Erros (${errors.length}): ${errors.join(', ')}`, 'error');

    window.__prycable_running = false;
    done({ success: success.length, notFound, errors });
  })();
}

function descScriptMain(codes) {
  if (window.__prycable_running) {
    window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'LOG', text: 'Já existe um script em execução! Aguarde ou recarregue a página.', level: 'error' }, '*');
    return;
  }

  (async () => {
    const log = (text, level) => window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'LOG', text, level }, '*');
    const prog = (cur, tot) => window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'PROGRESS', current: cur, total: tot }, '*');
    const done = (data) => window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'DONE', data }, '*');

    window.__prycable_stop = false;
    window.__prycable_running = true;

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const results = [];

    function waitFor(selector, timeout = 6000) {
      return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const obs = new MutationObserver(() => {
          const el = document.querySelector(selector);
          if (el) { obs.disconnect(); resolve(el); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); reject(new Error('timeout: ' + selector)); }, timeout);
      });
    }

    if (!window.location.href.includes('/cotacao/produtos')) {
      log('Navegando para a página de produtos...', 'info');
      window.location.href = 'https://www.prycable.com.br/mob/cotacao/produtos';
      await sleep(3000);
    }

    await waitFor('input#simplesearch', 8000).catch(() => null);
    await sleep(500);

    function triggerSearch(code) {
      const input = document.querySelector('input#simplesearch');
      if (!input) return false;
      const rk = Object.keys(input).find(k => k.startsWith('__reactProps'));
      if (!rk) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input[rk].onChange({ target: input });
      setter.call(input, code);
      input[rk].onChange({ target: input });
      return true;
    }

    function extractModal() {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return null;
      const text = dialog.innerText;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      const codeMatch = text.match(/(\d{7,8})/);
      const code = codeMatch ? codeMatch[1] : '?';
      const codeIdx = lines.findIndex(l => l === code);
      const desc = (codeIdx !== -1 && lines[codeIdx + 1]) ? lines[codeIdx + 1] : '?';
      const minMatch = text.match(/MÍN\.?:?\s*(\d[\d.,]*)/i);
      const mulMatch = text.match(/Múltiplo\s*(\d[\d.,]*)/i) || text.match(/Multiplo\s*(\d[\d.,]*)/i);
      return {
        code,
        desc,
        min: minMatch ? minMatch[1] : '?',
        mul: mulMatch ? mulMatch[1] : '?'
      };
    }

    for (let i = 0; i < codes.length; i++) {
      if (window.__prycable_stop) {
        log('Execução interrompida pelo usuário.', 'warning');
        break;
      }

      const code = codes[i];
      log(`[${i + 1}/${codes.length}] Buscando ${code}...`, 'info');
      prog(i, codes.length);

      if (!triggerSearch(code)) {
        log(`❌ Campo de busca não encontrado`, 'error');
        results.push({ code, desc: 'ERRO BUSCA', min: '-', mul: '-' });
        continue;
      }

      const listItem = await waitFor('.MuiBox-root.css-1n5hnmz', 6000).catch(() => null);
      if (!listItem) {
        log(`⚠️ Produto ${code} não encontrado`, 'warning');
        results.push({ code, desc: 'NÃO ENCONTRADO', min: '-', mul: '-' });
        continue;
      }

      listItem.click();

      const modalInput = await waitFor('[role="dialog"] input.MuiInputBase-input', 5000).catch(() => null);
      if (!modalInput) {
        log(`❌ Modal não abriu para ${code}`, 'error');
        results.push({ code, desc: 'ERRO MODAL', min: '-', mul: '-' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(500);
        continue;
      }

      await sleep(100);

      const data = extractModal();
      if (!data || data.code === '?') {
        log(`❌ Falha ao extrair dados de ${code}`, 'error');
        results.push({ code, desc: 'ERRO EXTRAÇÃO', min: '-', mul: '-' });
      } else {
        log(`✅ ${data.code} | ${data.desc} | MÍN: ${data.min} | Múl: ${data.mul}`, 'success');
        results.push(data);
      }

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(600);
    }

    prog(codes.length, codes.length);

    const tsv = [
      'Código\tDescrição\tQtd Mínima\tQtd Múltipla',
      ...results.map(r => `${r.code}\t${r.desc}\t${r.min}\t${r.mul}`)
    ].join('\n');

    log('────────────────────────────', 'info');
    log(`Concluído: ${results.length} produto(s) processado(s)`, 'success');
    log('Clique em "Copiar para Excel" para exportar os dados.', 'info');

    window.__prycable_running = false;
    window.__prycable_tsv = tsv;
    done({ results, tsv });
  })();
}

function stopScriptMain() {
  window.__prycable_stop = true;
}

// ═══════════════════════════════════════════════
// ESTADO DO POPUP
// ═══════════════════════════════════════════════

let isRunning = false;
let lastTsv = null;

function addLog(text, level = '') {
  const log = document.getElementById('log');
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (level ? ' ' + level : '');
  const t = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const span = document.createElement('span');
  span.textContent = `[${t}] ${text}`;
  entry.appendChild(span);
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function setProgress(current, total) {
  const bar = document.getElementById('progress-bar');
  bar.style.width = total > 0 ? `${Math.round((current / total) * 100)}%` : '0%';
}

function setRunningState(running, label) {
  isRunning = running;
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const chip = document.getElementById('status-chip');
  const stopBar = document.getElementById('stop-bar');
  const btnAdd = document.getElementById('btn-add');
  const btnDesc = document.getElementById('btn-desc');

  if (running) {
    dot.className = 'status-dot running';
    chip.classList.add('running');
    text.textContent = label || 'Executando...';
    stopBar.style.display = 'flex';
  } else {
    dot.className = 'status-dot done';
    chip.classList.remove('running');
    text.textContent = 'Pronto';
    stopBar.style.display = 'none';
  }

  btnAdd.disabled = running;
  btnDesc.disabled = running;
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  // Preencher com listas padrão dos scripts originais
  const defaultAddItems = [
    '26669814,600','26669817,800','26669050,150','26669051,280',
    '23884402,2010','26669053,1850','29712850,550','29711169,2600',
    '26669813,3500','26669822,1000','26669803,100','26564271,300',
    '23883405,1250','23883402,9000','26669823,1090','26669049,250',
    '26669013,100','23881402,4000','23883406,450','26669806,500',
    '26669807,3300','26669809,330','26669810,130','26669572,530',
    '26669573,400','23881405,100','26669566,620','23881406,300',
    '23882402,520','26669028,1900','26669820,1000','26669821,1000',
    '26669061,1000','23880405,1500','23884405,190','26669805,2000',
    '26669015,500','26669816,100','26669815,820','23879405,1350',
    '23884406,180','23879402,640','26669069,640'
  ].join('\n');

  const defaultDescCodes = [
    '23884402','29712819','26564256','26564253','23877405',
    '26669816','26669883','26669817','26669049','26669051',
    '26669053','26669807','23923802','23924802','23922802',
    '23885009','26056007','26056002','26056003','26056005'
  ].join('\n');

  // Restaurar listas salvas (ou usar padrão)
  chrome.storage.local.get(['addItems', 'descCodes'], (data) => {
    document.getElementById('add-items').value = data.addItems ?? defaultAddItems;
    document.getElementById('desc-codes').value = data.descCodes ?? defaultDescCodes;
  });

  // Salvar automaticamente ao editar
  document.getElementById('add-items').addEventListener('input', (e) => {
    chrome.storage.local.set({ addItems: e.target.value });
  });
  document.getElementById('desc-codes').addEventListener('input', (e) => {
    chrome.storage.local.set({ descCodes: e.target.value });
  });

  // Troca de abas
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p => p.hidden = true);
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(`tab-${tab}`);
      panel.hidden = false;
    });
  });

  // Limpar log
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('log').innerHTML = '';
    setProgress(0, 1);
  });

  // Limpar lista de adicionar
  document.getElementById('btn-add-clear').addEventListener('click', () => {
    document.getElementById('add-items').value = '';
    chrome.storage.local.set({ addItems: '' });
  });

  // Receber mensagens do content-bridge
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.source !== 'PRYCABLE_AUTOMATION') return;

    if (msg.type === 'LOG') {
      addLog(msg.text, msg.level);
    } else if (msg.type === 'PROGRESS') {
      setProgress(msg.current, msg.total);
    } else if (msg.type === 'DONE') {
      setRunningState(false);
      if (msg.data && msg.data.tsv) {
        lastTsv = msg.data.tsv;
        document.getElementById('btn-desc-copy').disabled = false;
      }
    }
  });

  // ── BOTÃO: Parar ──
  document.getElementById('btn-stop').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: stopScriptMain,
      world: 'MAIN'
    }).catch(() => {});
    addLog('Sinal de parada enviado...', 'warning');
    setRunningState(false);
  });

  // ── BOTÃO: Executar Adicionar ──
  document.getElementById('btn-add').addEventListener('click', async () => {
    if (isRunning) return;

    const raw = document.getElementById('add-items').value.trim();
    if (!raw) {
      addLog('Lista vazia. Preencha os produtos antes de executar.', 'error');
      return;
    }

    const items = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(',');
      if (parts.length < 2) {
        addLog(`Linha inválida: "${trimmed}" — use o formato: código,quantidade`, 'error');
        return;
      }
      const code = parts[0].trim();
      const qty = parseInt(parts[1].trim(), 10);
      if (!code || isNaN(qty)) {
        addLog(`Dados inválidos: "${trimmed}"`, 'error');
        return;
      }
      items.push({ code, qty });
    }

    if (items.length === 0) {
      addLog('Nenhum item válido encontrado na lista.', 'error');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    setProgress(0, items.length);
    setRunningState(true, `Adicionando ${items.length} produto(s)...`);
    addLog(`Iniciando adição de ${items.length} produto(s)...`, 'info');

    // Injetar a ponte de mensagens
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-bridge.js']
    }).catch(() => {});

    // Executar o script no contexto da página
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: addScriptMain,
      args: [items],
      world: 'MAIN'
    }).catch((e) => {
      addLog(`Erro ao iniciar: ${e.message}`, 'error');
      setRunningState(false);
    });
  });

  // ── BOTÃO: Executar Descrições ──
  document.getElementById('btn-desc').addEventListener('click', async () => {
    if (isRunning) return;

    const raw = document.getElementById('desc-codes').value.trim();
    if (!raw) {
      addLog('Lista vazia. Preencha os códigos antes de executar.', 'error');
      return;
    }

    const codes = raw.split('\n').map(l => l.trim()).filter(l => l);
    if (codes.length === 0) {
      addLog('Nenhum código válido encontrado.', 'error');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    lastTsv = null;
    document.getElementById('btn-desc-copy').disabled = true;
    setProgress(0, codes.length);
    setRunningState(true, `Buscando ${codes.length} produto(s)...`);
    addLog(`Iniciando busca de ${codes.length} produto(s)...`, 'info');

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-bridge.js']
    }).catch(() => {});

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: descScriptMain,
      args: [codes],
      world: 'MAIN'
    }).catch((e) => {
      addLog(`Erro ao iniciar: ${e.message}`, 'error');
      setRunningState(false);
    });
  });

  // ── BOTÃO: Copiar para Excel ──
  document.getElementById('btn-desc-copy').addEventListener('click', async () => {
    let tsv = lastTsv;

    // Tentar recuperar da página se não tiver em memória
    if (!tsv) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__prycable_tsv || null,
        world: 'MAIN'
      }).catch(() => []);
      tsv = result[0]?.result ?? null;
    }

    if (!tsv) {
      addLog('Nenhum dado disponível. Execute a busca primeiro.', 'error');
      return;
    }

    await navigator.clipboard.writeText(tsv);
    addLog('Dados copiados! Abra o Excel e pressione Ctrl+V.', 'success');
  });

});
