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

    try {

    // ── Auth ────────────────────────────────────────────────────────────────
    const token    = localStorage.getItem('@cable-Token');
    const customer = JSON.parse(localStorage.getItem('@cable-Customer') || '{}');
    const user     = JSON.parse(localStorage.getItem('@cable-User')     || '{}');

    if (!token || !user.sapCode || !user.name || !customer.sapCode) {
      log('❌ Sessão não encontrada. Faça login no site primeiro.', 'error');
      done({});
      return;
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const clientInfo = {
      sapCode:              customer.sapCode,
      cnpj:                 customer.cnpj,
      subsidiary:           customer.subsidiary || '',
      companyName:          customer.companyName,
      address:              customer.address,
      city:                 customer.city,
      state:                customer.state,
      phone:                customer.phone,
      salesOrganization:    customer.salesOrganization,
      distributionChannel:  customer.distributionChannel,
      areaVenda:            customer.areaVenda
    };

    async function pauseForUser(code, reason) {
      window.__prycable_paused = true;
      window.__prycable_skip = false;
      window.__prycable_continue = false;
      window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'PAUSED', code, reason }, '*');
      while (window.__prycable_paused && !window.__prycable_stop) { await sleep(300); }
      if (window.__prycable_stop)    return 'stop';
      if (window.__prycable_skip)    { window.__prycable_skip = false;    return 'skip'; }
      if (window.__prycable_continue){ window.__prycable_continue = false; return 'retry'; }
      return 'stop';
    }

    // ── 1. Dados auxiliares do cliente ──────────────────────────────────────
    log('Buscando dados auxiliares...', 'info');
    const auxResp = await fetch(
      '/services/dictionary/getOfferAuxTables?' + new URLSearchParams({
        sapCode:              customer.sapCode,
        salesOrganization:    customer.salesOrganization,
        distributionChannel:  customer.distributionChannel
      }),
      { credentials: 'include', headers }
    ).catch(() => null);

    if (!auxResp?.ok) {
      log('❌ Falha ao buscar dados auxiliares. Verifique a sessão.', 'error');
      done({});
      return;
    }
    const aux = await auxResp.json();

    // ── 2. Buscar e validar cada produto ────────────────────────────────────
    window.__prycable_mode = 'add';
    const products    = [];
    const notFoundList = [];
    const skippedList  = [];

    for (let i = 0; i < items.length; i++) {
      window.__prycable_current_index = i;
      if (window.__prycable_stop) { log('Execução interrompida pelo usuário.', 'warning'); break; }

      const { code, qty } = items[i];
      log(`[${i + 1}/${items.length}] Buscando ${code}...`, 'info');
      prog(i, items.length);

      let productData = null;
      let notFound = false;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const resp = await fetch('/api/product/?' + new URLSearchParams({
            profile: 'representative',
            userSapCode: user.sapCode,
            origin: 'offer',
            pageSize: '1',
            currentPage: '1',
            productCodeBegin: items[i].code,
            productCodeEnd:   items[i].code
          }), { credentials: 'include', headers });

          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const body = await resp.json();

          if (!body.t_intpro?.length) { notFound = true; break; }

          const p = body.t_intpro[0];

          // Verifica quantidade mínima
          if (p.minimumQuantity && items[i].qty < p.minimumQuantity) {
            log(`⚠️ ${items[i].code}: qtd ${items[i].qty} abaixo do mínimo (MÍN: ${p.minimumQuantity})`, 'warning');
            const decision = await pauseForUser(items[i].code, `Qtd ${items[i].qty} abaixo do mínimo (MÍN: ${p.minimumQuantity}) — corrija e clique Continuar`);
            if (decision === 'retry') {
              if (window.__prycable_retry_override) { items[i] = window.__prycable_retry_override; window.__prycable_retry_override = null; }
              attempt = 0; continue;
            }
            if (decision === 'skip') { skippedList.push(items[i].code); }
            else                      { window.__prycable_stop = true; }
            productData = null; notFound = false;
            break;
          }

          productData = {
            productCode:       p.productCode,
            productDescription:p.productDescription,
            unitOfMeasure:     p.unitOfMeasure,
            packaging:         p.packaging,
            minimumQuantity:   p.minimumQuantity,
            multipleQuantity:  p.multipleQuantity,
            netWeight:         p.netWeight,
            quantityRequested: items[i].qty,
            itemNumber:        products.length + 1
          };
          break;
        } catch (e) {
          if (attempt < 3) { await sleep(500); }
          else { log(`❌ Erro ao buscar ${items[i].code}: ${e.message}`, 'error'); }
        }
      }

      if (window.__prycable_stop) break;

      if (notFound) {
        const decision = await pauseForUser(items[i].code, `Produto ${items[i].code} não encontrado`);
        if (decision === 'retry') {
          if (window.__prycable_retry_override) { items[i] = window.__prycable_retry_override; window.__prycable_retry_override = null; }
          i--; continue;
        }
        if (decision === 'stop') break;
        notFoundList.push(items[i].code);
      } else if (productData) {
        log(`✅ ${items[i].code} | ${productData.productDescription} | MÍN: ${productData.minimumQuantity}`, 'success');
        products.push(productData);
      }
    }

    if (window.__prycable_stop || products.length === 0) {
      log('Nenhum produto válido para adicionar.', 'warning');
      done({ success: 0, notFound: notFoundList });
      return;
    }

    // ── 3. Salvar rascunho da cotação ────────────────────────────────────────
    log('Salvando rascunho da cotação...', 'info');
    const offerResp = await fetch('/api/offer', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({
        type:                        'CABLE',
        profile:                     'representative',
        user:                        user.login,
        vendor:                      user.sapCode,
        webUserName:                 user.name.substring(0, 35),
        clientOfferNumber:           '',
        objective:                   'YO',
        paymentCondition:            aux.conpagto_cli,
        merchandiseDestination:      aux.destmerc_cli,
        deliveryCondition:           aux.inco1_cli,
        deliveryConditionDescription:aux.inco1_cli2,
        minDeliveryDate:             aux.dtmin_entreg,
        creationDate:                new Date().toDateString(),
        clientEPC:                   null,
        isRevision:                  false,
        revisedOfferNumber:          null,
        client:                      clientInfo,
        products: products.map((p, idx) => ({ ...p, itemNumber: idx + 1 }))
      })
    }).catch(() => null);

    if (!offerResp?.ok) {
      log('❌ Falha ao salvar rascunho da cotação.', 'error');
      done({ success: 0 });
      return;
    }
    const offer = await offerResp.json();
    const offerNum = offer.offerNumber ?? offer.number ?? offer.id ?? '—';

    prog(items.length, items.length);
    log('────────────────────────────', 'info');
    log(`✅ Oferta salva como rascunho (${offerNum})`, 'success');
    log(`✅ ${products.length} produto(s) adicionados`, 'success');
    if (notFoundList.length) log(`⚠️ Não encontrados (${notFoundList.length}): ${notFoundList.join(', ')}`, 'warning');
    if (skippedList.length)  log(`⚠️ Pulados — qtd abaixo do mínimo (${skippedList.length}): ${skippedList.join(', ')}`, 'warning');
    log('Abra o site, localize a cotação e adicione os descontos antes de enviar.', 'info');

    done({ success: products.length, notFound: notFoundList, skipped: skippedList, offer });

    } catch (e) {
      log(`❌ Erro inesperado: ${e.message}`, 'error');
      done({ success: 0 });
    } finally {
      window.__prycable_running = false;
    }
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

    try {

    // Lê contexto de autenticação do localStorage da página
    const token    = localStorage.getItem('@cable-Token');
    const user     = JSON.parse(localStorage.getItem('@cable-User')     || '{}');

    if (!token || !user.sapCode) {
      log('❌ Sessão não encontrada. Faça login no site primeiro.', 'error');
      done({});
      return;
    }

    async function buscarProduto(codigo) {
      const url = '/api/product/?' + new URLSearchParams({
        profile: 'representative',
        userSapCode: user.sapCode,
        origin: 'offer',
        pageSize: '30',
        currentPage: '1',
        productCodeBegin: codigo,
        productCodeEnd: codigo
      });
      const resp = await fetch(url, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    }

    async function pauseForUser(code, reason) {
      window.__prycable_paused = true;
      window.__prycable_skip = false;
      window.__prycable_continue = false;
      window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'PAUSED', code, reason }, '*');
      while (window.__prycable_paused && !window.__prycable_stop) {
        await sleep(300);
      }
      if (window.__prycable_stop) return 'stop';
      if (window.__prycable_skip)    { window.__prycable_skip = false;    return 'skip'; }
      if (window.__prycable_continue){ window.__prycable_continue = false; return 'retry'; }
      return 'stop';
    }

    const results = [];
    window.__prycable_mode = 'desc';

    for (let i = 0; i < codes.length; i++) {
      window.__prycable_current_index = i;
      if (window.__prycable_stop) { log('Execução interrompida pelo usuário.', 'warning'); break; }

      const code = codes[i];

      // Linha vazia → linha em branco no Excel, sem buscar na API
      if (!code) {
        prog(i + 1, codes.length);
        results.push({ code: '', desc: '', min: '', mul: '' });
        continue;
      }

      // N/C passa direto sem buscar na API
      if (code.trim().toUpperCase() === 'N/C') {
        log(`[${i + 1}/${codes.length}] N/C — pulando`, 'info');
        prog(i + 1, codes.length);
        results.push({ code: 'N/C', desc: 'N/C', min: '-', mul: '-' });
        continue;
      }

      log(`[${i + 1}/${codes.length}] Buscando ${code}...`, 'info');
      prog(i, codes.length);

      const MAX_ATTEMPTS = 3;
      let data = null;
      let notFound = false;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const resp = await buscarProduto(codes[i]);

          if (!resp.t_intpro || resp.t_intpro.length === 0) {
            notFound = true;
            break;
          }

          const p = resp.t_intpro[0];
          data = {
            code:  codes[i],
            desc:  p.productDescription   || '?',
            min:   String(p.minimumQuantity  ?? '?'),
            mul:   String(p.multipleQuantity ?? '?')
          };
          break;
        } catch (e) {
          if (attempt < MAX_ATTEMPTS) { await sleep(600); }
          else { log(`❌ Erro na requisição (${codes[i]}): ${e.message}`, 'error'); }
        }
      }

      if (notFound) {
        const decision = await pauseForUser(codes[i], `Produto ${codes[i]} não encontrado`);
        if (decision === 'retry') {
          if (window.__prycable_retry_override) { codes[i] = window.__prycable_retry_override; window.__prycable_retry_override = null; }
          i--; continue;
        }
        if (decision === 'stop') break;
        results.push({ code: codes[i], desc: 'NÃO ENCONTRADO', min: '-', mul: '-' });
      } else if (!data) {
        const decision = await pauseForUser(codes[i], `Falha ao obter dados de ${codes[i]}`);
        if (decision === 'retry') {
          if (window.__prycable_retry_override) { codes[i] = window.__prycable_retry_override; window.__prycable_retry_override = null; }
          i--; continue;
        }
        if (decision === 'stop') break;
        results.push({ code: codes[i], desc: 'ERRO', min: '-', mul: '-' });
      } else {
        log(`✅ ${data.code} | ${data.desc} | MÍN: ${data.min} | Múl: ${data.mul}`, 'success');
        results.push(data);
      }
    }

    prog(codes.length, codes.length);

    const tsv = [
      'Código\tDescrição\tQtd Mínima\tQtd Múltipla',
      ...results.map(r => {
        let desc = r.desc;
        if (!desc || !desc.trim()) desc = ' ';
        else if (desc.trim().toUpperCase() === 'N/C') desc = 'não cotamos';
        return `${r.code}\t${desc}\t${r.min}\t${r.mul}`;
      })
    ].join('\n');

    log('────────────────────────────', 'info');
    log(`Concluído: ${results.length} produto(s) processado(s)`, 'success');
    log('Clique em "Copiar para Excel" para exportar os dados.', 'info');

    window.__prycable_tsv = tsv;
    done({ results, tsv });

    } catch (e) {
      log(`❌ Erro inesperado: ${e.message}`, 'error');
      done({ success: 0 });
    } finally {
      window.__prycable_running = false;
    }
  })();
}

function offerScriptMain(items, discount) {
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

    try {

    // ── Auth ────────────────────────────────────────────────────────────────
    const token    = localStorage.getItem('@cable-Token');
    const customer = JSON.parse(localStorage.getItem('@cable-Customer') || '{}');
    const user     = JSON.parse(localStorage.getItem('@cable-User')     || '{}');

    if (!token || !user.sapCode || !user.name || !customer.sapCode) {
      log('❌ Sessão não encontrada. Faça login no site primeiro.', 'error');
      done({});
      return;
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    async function pauseForUser(code, reason) {
      window.__prycable_paused = true;
      window.__prycable_skip = false;
      window.__prycable_continue = false;
      window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'PAUSED', code, reason }, '*');
      while (window.__prycable_paused && !window.__prycable_stop) { await sleep(300); }
      if (window.__prycable_stop)    return 'stop';
      if (window.__prycable_skip)    { window.__prycable_skip = false;    return 'skip'; }
      if (window.__prycable_continue){ window.__prycable_continue = false; return 'retry'; }
      return 'stop';
    }

    // ── 1. Dados auxiliares do cliente ──────────────────────────────────────
    log('Buscando dados auxiliares...', 'info');
    const auxResp = await fetch(
      '/services/dictionary/getOfferAuxTables?' + new URLSearchParams({
        sapCode:              customer.sapCode,
        salesOrganization:    customer.salesOrganization,
        distributionChannel:  customer.distributionChannel
      }),
      { credentials: 'include', headers }
    ).catch(() => null);

    if (!auxResp?.ok) {
      log('❌ Falha ao buscar dados auxiliares. Verifique a sessão.', 'error');
      done({});
      return;
    }
    const aux = await auxResp.json();

    // ── 2. Buscar e validar cada produto ────────────────────────────────────
    window.__prycable_mode = 'offer';
    const products     = [];
    const notFoundList = [];
    const skippedList  = [];

    for (let i = 0; i < items.length; i++) {
      window.__prycable_current_index = i;
      if (window.__prycable_stop) { log('Execução interrompida pelo usuário.', 'warning'); break; }

      log(`[${i + 1}/${items.length}] Buscando ${items[i].code}...`, 'info');
      prog(i, items.length);

      let productData = null;
      let notFound = false;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const resp = await fetch('/api/product/?' + new URLSearchParams({
            profile: 'representative',
            userSapCode: user.sapCode,
            origin: 'offer',
            pageSize: '1',
            currentPage: '1',
            productCodeBegin: items[i].code,
            productCodeEnd:   items[i].code
          }), { credentials: 'include', headers });

          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const body = await resp.json();

          if (!body.t_intpro?.length) { notFound = true; break; }

          const p = body.t_intpro[0];

          if (p.minimumQuantity && items[i].qty < p.minimumQuantity) {
            log(`⚠️ ${items[i].code}: qtd ${items[i].qty} abaixo do mínimo (MÍN: ${p.minimumQuantity})`, 'warning');
            const decision = await pauseForUser(items[i].code, `Qtd ${items[i].qty} abaixo do mínimo (MÍN: ${p.minimumQuantity}) — corrija e clique Continuar`);
            if (decision === 'retry') {
              if (window.__prycable_retry_override) { items[i] = window.__prycable_retry_override; window.__prycable_retry_override = null; }
              attempt = 0; continue;
            }
            if (decision === 'skip') { skippedList.push(items[i].code); }
            else                      { window.__prycable_stop = true; }
            productData = null; notFound = false;
            break;
          }

          productData = {
            productCode:        p.productCode,
            productDescription: p.productDescription,
            unitOfMeasure:      p.unitOfMeasure,
            packaging:          p.packaging,
            quantityRequested:  items[i].qty,
            itemNumber:         products.length + 1
          };
          break;
        } catch (e) {
          if (attempt < 3) { await sleep(500); }
          else { log(`❌ Erro ao buscar ${items[i].code}: ${e.message}`, 'error'); }
        }
      }

      if (window.__prycable_stop) break;

      if (notFound) {
        const decision = await pauseForUser(items[i].code, `Produto ${items[i].code} não encontrado`);
        if (decision === 'retry') {
          if (window.__prycable_retry_override) { items[i] = window.__prycable_retry_override; window.__prycable_retry_override = null; }
          i--; continue;
        }
        if (decision === 'stop') break;
        notFoundList.push(items[i].code);
      } else if (productData) {
        log(`✅ ${items[i].code} | ${productData.productDescription}`, 'success');
        products.push(productData);
      }
    }

    if (window.__prycable_stop || products.length === 0) {
      log('Nenhum produto válido encontrado.', 'warning');
      done({ success: 0, notFound: notFoundList });
      return;
    }

    // ── 3. Valorizar via /api/product/valorize ─────────────────────────────────
    log(`Valorizando ${products.length} produto(s) com ${discount}% de desconto...`, 'info');

    const clientForValorize = {
      ...customer,
      vendor:      user.sapCode,
      vendorName:  user.name
    };

    const valorizeResp = await fetch('/api/product/valorize', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({
        client:                 clientForValorize,
        paymentCondition:       aux.conpagto_cli,
        merchandiseDestination: aux.destmerc_cli,
        salesGroup:             aux.salesGroup ?? aux.salesgrp ?? customer.salesGroup ?? '',
        products: products.map((p, idx) => ({
          itemNumber:          idx + 1,
          productCode:         p.productCode,
          productDescription:  p.productDescription,
          packaging:           p.packaging,
          unitOfMeasure:       p.unitOfMeasure,
          quantityRequested:   p.quantityRequested,
          discount:            discount,
          clientDiscount:      null,
          productDiscount:     null,
          commercialDiscount:  null,
          id:                  null
        }))
      })
    }).catch(() => null);

    if (!valorizeResp?.ok) {
      log(`❌ Falha ao valorizar (HTTP ${valorizeResp?.status ?? 'sem resposta'}).`, 'error');
      done({ success: 0 });
      return;
    }

    const pricedItems = await valorizeResp.json(); // API retorna array direto

    if (!Array.isArray(pricedItems) || !pricedItems.length) {
      log('❌ Resposta de valorização inválida ou vazia.', 'error');
      done({ success: 0 });
      return;
    }

    // ── 4. Formatar saída no padrão CRM ────────────────────────────────────────
    function fmtQty(n) {
      return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    }
    function fmtMoney(n) {
      return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    const lines = pricedItems.map((p, idx) => {
      const qty        = p.quantityRequested ?? 0;
      const unit       = p.unitOfMeasure ?? '';
      const packaging  = p.packaging ?? unit;
      const unitPrice  = p.priceWithTaxes ?? 0;
      const taxValue   = (p.icmsValue ?? 0) + (p.piscofinsValue ?? 0);
      const totalValue = (p.fullPriceWithTaxes ?? 0) * qty;
      const icms       = p.icms ?? 0;
      const ipi        = p.ipi ?? 0;

      return [
        `${idx + 1}  ${p.productCode}  ${p.productDescription}`,
        packaging,
        `Quantidade: ${fmtQty(qty)} ${unit}`,
        `Preço unit. (c/ PIS/ COFINS e ICMS): R$ ${fmtMoney(unitPrice)}`,
        `Valor (ICMS + PIS + Cofins): R$ ${fmtMoney(taxValue)} | Valor (PIS/COFINS, ICMS, IPI e ICMS-ST): R$ ${fmtMoney(totalValue)}`,
        `ICMS: ${icms}% IPI: ${ipi}%`
      ].join('\n');
    }).join('\n\n');

    prog(items.length, items.length);
    log('────────────────────────────', 'info');
    log(`✅ ${pricedItems.length} produto(s) valorizados com ${discount}% de desconto`, 'success');
    if (notFoundList.length) log(`⚠️ Não encontrados: ${notFoundList.join(', ')}`, 'warning');
    if (skippedList.length)  log(`⚠️ Pulados: ${skippedList.join(', ')}`, 'warning');
    log('Clique em "Copiar para CRM" para copiar.', 'info');

    window.__prycable_offer_text = lines;
    done({ offerText: lines, success: pricedItems.length });

    } catch (e) {
      log(`❌ Erro inesperado: ${e.message}`, 'error');
      done({ success: 0 });
    } finally {
      window.__prycable_running = false;
    }
  })();
}

function priceScriptMain(items, discount) {
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

    try {

    // ── Auth ────────────────────────────────────────────────────────────────
    const token    = localStorage.getItem('@cable-Token');
    const customer = JSON.parse(localStorage.getItem('@cable-Customer') || '{}');
    const user     = JSON.parse(localStorage.getItem('@cable-User')     || '{}');

    if (!token || !user.sapCode || !user.name || !customer.sapCode) {
      log('❌ Sessão não encontrada. Faça login no site primeiro.', 'error');
      done({});
      return;
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    async function pauseForUser(code, reason) {
      window.__prycable_paused = true;
      window.__prycable_skip = false;
      window.__prycable_continue = false;
      window.postMessage({ source: 'PRYCABLE_AUTOMATION', type: 'PAUSED', code, reason }, '*');
      while (window.__prycable_paused && !window.__prycable_stop) { await sleep(300); }
      if (window.__prycable_stop)    return 'stop';
      if (window.__prycable_skip)    { window.__prycable_skip = false;    return 'skip'; }
      if (window.__prycable_continue){ window.__prycable_continue = false; return 'retry'; }
      return 'stop';
    }

    // ── 1. Dados auxiliares do cliente ──────────────────────────────────────
    log('Buscando dados auxiliares...', 'info');
    const auxResp = await fetch(
      '/services/dictionary/getOfferAuxTables?' + new URLSearchParams({
        sapCode:              customer.sapCode,
        salesOrganization:    customer.salesOrganization,
        distributionChannel:  customer.distributionChannel
      }),
      { credentials: 'include', headers }
    ).catch(() => null);

    if (!auxResp?.ok) {
      log('❌ Falha ao buscar dados auxiliares. Verifique a sessão.', 'error');
      done({});
      return;
    }
    const aux = await auxResp.json();

    // ── 2. Buscar e validar cada produto ────────────────────────────────────
    window.__prycable_mode = 'price';
    const products     = [];   // cada item guarda inputIndex para remontar a ordem original
    const notFoundList = [];
    const skippedList  = [];

    for (let i = 0; i < items.length; i++) {
      window.__prycable_current_index = i;
      if (window.__prycable_stop) { log('Execução interrompida pelo usuário.', 'warning'); break; }

      // Linha vazia → linha em branco na saída, sem consultar a API
      if (!items[i].code) { prog(i + 1, items.length); continue; }

      log(`[${i + 1}/${items.length}] Buscando ${items[i].code}...`, 'info');
      prog(i, items.length);

      let productData = null;
      let notFound = false;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const resp = await fetch('/api/product/?' + new URLSearchParams({
            profile: 'representative',
            userSapCode: user.sapCode,
            origin: 'offer',
            pageSize: '1',
            currentPage: '1',
            productCodeBegin: items[i].code,
            productCodeEnd:   items[i].code
          }), { credentials: 'include', headers });

          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const body = await resp.json();

          if (!body.t_intpro?.length) { notFound = true; break; }

          const p = body.t_intpro[0];

          // Quantidade é opcional: sem ela, valoriza na quantidade mínima do produto
          const autoQty = items[i].qty === null || items[i].qty === undefined;

          if (!autoQty && p.minimumQuantity && items[i].qty < p.minimumQuantity) {
            log(`⚠️ ${items[i].code}: qtd ${items[i].qty} abaixo do mínimo (MÍN: ${p.minimumQuantity})`, 'warning');
            const decision = await pauseForUser(items[i].code, `Qtd ${items[i].qty} abaixo do mínimo (MÍN: ${p.minimumQuantity}) — corrija e clique Continuar`);
            if (decision === 'retry') {
              if (window.__prycable_retry_override) { items[i] = window.__prycable_retry_override; window.__prycable_retry_override = null; }
              attempt = 0; continue;
            }
            if (decision === 'skip') { skippedList.push(items[i].code); }
            else                      { window.__prycable_stop = true; }
            productData = null; notFound = false;
            break;
          }

          const qtyUsed = autoQty
            ? (Number(p.minimumQuantity) || Number(p.multipleQuantity) || 1)
            : items[i].qty;

          productData = {
            inputIndex:         i,
            autoQty,
            productCode:        p.productCode,
            productDescription: p.productDescription,
            unitOfMeasure:      p.unitOfMeasure,
            packaging:          p.packaging,
            quantityRequested:  qtyUsed
          };
          break;
        } catch (e) {
          if (attempt < 3) { await sleep(500); }
          else { log(`❌ Erro ao buscar ${items[i].code}: ${e.message}`, 'error'); }
        }
      }

      if (window.__prycable_stop) break;

      if (notFound) {
        const decision = await pauseForUser(items[i].code, `Produto ${items[i].code} não encontrado`);
        if (decision === 'retry') {
          if (window.__prycable_retry_override) { items[i] = window.__prycable_retry_override; window.__prycable_retry_override = null; }
          i--; continue;
        }
        if (decision === 'stop') break;
        notFoundList.push(items[i].code);
      } else if (productData) {
        const qtyNote = productData.autoQty ? ' (qtd mínima)' : '';
        log(`✅ ${items[i].code} | ${productData.productDescription} | qtd ${productData.quantityRequested}${qtyNote}`, 'success');
        products.push(productData);
      }
    }

    if (window.__prycable_stop || products.length === 0) {
      log('Nenhum produto válido para valorizar.', 'warning');
      done({ success: 0, notFound: notFoundList });
      return;
    }

    // ── 3. Valorizar via /api/product/valorize ──────────────────────────────
    log(`Valorizando ${products.length} produto(s) com ${discount}% de desconto...`, 'info');

    const clientForValorize = {
      ...customer,
      vendor:      user.sapCode,
      vendorName:  user.name
    };

    const valorizeResp = await fetch('/api/product/valorize', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({
        client:                 clientForValorize,
        paymentCondition:       aux.conpagto_cli,
        merchandiseDestination: aux.destmerc_cli,
        salesGroup:             aux.salesGroup ?? aux.salesgrp ?? customer.salesGroup ?? '',
        products: products.map((p, idx) => ({
          itemNumber:          idx + 1,
          productCode:         p.productCode,
          productDescription:  p.productDescription,
          packaging:           p.packaging,
          unitOfMeasure:       p.unitOfMeasure,
          quantityRequested:   p.quantityRequested,
          discount:            discount,
          clientDiscount:      null,
          productDiscount:     null,
          commercialDiscount:  null,
          id:                  null
        }))
      })
    }).catch(() => null);

    if (!valorizeResp?.ok) {
      log(`❌ Falha ao valorizar (HTTP ${valorizeResp?.status ?? 'sem resposta'}).`, 'error');
      done({ success: 0 });
      return;
    }

    const pricedItems = await valorizeResp.json(); // API retorna array direto

    if (!Array.isArray(pricedItems) || !pricedItems.length) {
      log('❌ Resposta de valorização inválida ou vazia.', 'error');
      done({ success: 0 });
      return;
    }

    // ── 4. Remontar preços na ordem da lista original ───────────────────────
    // Número decimal em pt-BR sem separador de milhar → cola direto no Excel
    const fmtPrice = n => Number(n).toFixed(2).replace('.', ',');

    // itemNumber enviado = índice em products + 1; cai para a posição do array se ausente
    const byItemNumber = new Map();
    pricedItems.forEach((p, idx) => {
      const key = p.itemNumber ?? (idx + 1);
      if (!byItemNumber.has(key)) byItemNumber.set(key, p);
    });

    const rows = items.map(it => ({ code: it.code, qty: it.qty, price: null }));
    let priced = 0;

    products.forEach((p, idx) => {
      const found = byItemNumber.get(idx + 1) ?? pricedItems[idx];
      if (!found) return;
      const unitPrice = found.priceWithTaxes ?? 0;
      rows[p.inputIndex].price = unitPrice;
      rows[p.inputIndex].qty   = p.quantityRequested;
      rows[p.inputIndex].desc  = p.productDescription;
      priced++;
    });

    rows.forEach((r, idx) => {
      if (!r.code) return; // linha em branco da lista original
      if (r.price === null) log(`⚠️ [${idx + 1}] ${r.code}: sem preço`, 'warning');
      else log(`💰 [${idx + 1}] ${r.code} | qtd ${r.qty} | R$ ${fmtPrice(r.price)}`, 'success');
    });

    // Linha vazia mantém o alinhamento das linhas da lista original ao colar
    const pricesText = rows.map(r => r.price === null ? '' : fmtPrice(r.price)).join('\n');

    prog(items.length, items.length);
    log('────────────────────────────', 'info');
    log(`✅ ${priced} preço(s) obtidos com ${discount}% de desconto`, 'success');
    if (notFoundList.length) log(`⚠️ Não encontrados: ${notFoundList.join(', ')}`, 'warning');
    if (skippedList.length)  log(`⚠️ Pulados: ${skippedList.join(', ')}`, 'warning');
    log('Clique em "Copiar preços" para copiar os valores na ordem da lista.', 'info');

    window.__prycable_prices = pricesText;
    done({ pricesText, success: priced });

    } catch (e) {
      log(`❌ Erro inesperado: ${e.message}`, 'error');
      done({ success: 0 });
    } finally {
      window.__prycable_running = false;
    }
  })();
}

function followupScriptMain(offers, status) {
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

    try {

    // ── Auth ────────────────────────────────────────────────────────────────
    const token = localStorage.getItem('@cable-Token');
    const user  = JSON.parse(localStorage.getItem('@cable-User') || '{}');

    if (!token || !user.sapCode) {
      log('❌ Sessão não encontrada. Faça login no site primeiro.', 'error');
      done({});
      return;
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    window.__prycable_mode = 'fup';

    // ── 1. Dicionário de motivos ────────────────────────────────────────────
    // newStatusObj precisa ser o objeto exato que a API devolve para o motivo,
    // por isso é lido do dicionário em vez de montado aqui.
    log('Buscando dicionário de motivos...', 'info');
    const dictResp = await fetch('/services/dictionary/getOfferSearchAuxTables', {
      credentials: 'include', headers
    }).catch(() => null);

    if (!dictResp?.ok) {
      log(`❌ Falha ao ler os motivos (HTTP ${dictResp?.status ?? 'sem resposta'}).`, 'error');
      done({});
      return;
    }

    const dict   = await dictResp.json();
    const motive = (dict.tmotivo_web || []).find(m => m.id === status.code);

    if (!motive) {
      log(`❌ Motivo ${status.code} não existe no dicionário do site.`, 'error');
      done({});
      return;
    }

    // Mesmas validações que o front do site faz antes de liberar o Salvar
    if (motive.descriptionRequired === 'X' && !status.observation) {
      log(`❌ "${motive.name}" exige observação.`, 'error');
      done({});
      return;
    }
    if (motive.dayRequired === 'X' && !status.statusDate) {
      log(`❌ "${motive.name}" exige data de prazo.`, 'error');
      done({});
      return;
    }

    const body = JSON.stringify({
      statusCode:   motive.id,
      statusName:   motive.name,
      observation:  status.observation,
      statusDate:   status.statusDate || null,
      newStatusObj: motive
    });

    // ── 2. Um PUT por cotação — a API não tem endpoint em lote ──────────────
    const okList   = [];
    const failList = [];

    for (let i = 0; i < offers.length; i++) {
      window.__prycable_current_index = i;
      if (window.__prycable_stop) { log('Execução interrompida pelo usuário.', 'warning'); break; }

      const offer = offers[i];
      log(`[${i + 1}/${offers.length}] ${offer} → ${motive.name}...`, 'info');
      prog(i, offers.length);

      let saved   = false;
      let lastErr = '';

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const resp = await fetch(`/api/offer/${encodeURIComponent(offer)}`, {
            method: 'PUT', credentials: 'include', headers, body
          });

          if (resp.ok) { saved = true; break; }   // sucesso = 204 sem corpo

          const detail = (await resp.text().catch(() => '')).slice(0, 160);
          lastErr = `HTTP ${resp.status}${detail ? ' — ' + detail : ''}`;

          // 4xx = cotação ou payload inválido; repetir não muda o resultado
          if (resp.status >= 400 && resp.status < 500) break;
        } catch (e) {
          lastErr = e.message;
        }
        if (attempt < 3) await sleep(600);
      }

      if (saved) {
        okList.push(offer);
        log(`✅ ${offer} → ${motive.name}`, 'success');
      } else {
        failList.push(`${offer} (${lastErr})`);
        log(`❌ ${offer}: ${lastErr}`, 'error');
      }
    }

    prog(offers.length, offers.length);
    log('────────────────────────────', 'info');
    log(`✅ ${okList.length} cotação(ões) gravadas como "${motive.name}"`, 'success');
    if (failList.length) log(`❌ Falharam (${failList.length}): ${failList.join(' | ')}`, 'error');
    log('Recarregue a tela de follow-up no site para ver os novos status.', 'info');

    done({ success: okList.length, failed: failList });

    } catch (e) {
      log(`❌ Erro inesperado: ${e.message}`, 'error');
      done({ success: 0 });
    } finally {
      window.__prycable_running = false;
    }
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
let lastOfferText = null;
let lastPricesText = null;
let logEntriesCache = [];

const EXEC_BUTTON_IDS = ['btn-add', 'btn-desc', 'btn-offer', 'btn-price', 'btn-fup'];

// Motivos do modal "Status cotação" — códigos confirmados via
// GET /services/dictionary/getOfferSearchAuxTables › tmotivo_web.
// Todos exigem observação (descriptionRequired: "X"); só o Y08 exige também prazo.
const FOLLOWUP_STATUSES = [
  { code: 'Y08', label: 'Em Negociação',                          needsDay: true  },
  { code: 'Y09', label: 'Oferta para Levantamento de preços',      needsDay: false },
  { code: 'Y24', label: 'Oferta Perdida por Preço',                needsDay: false },
  { code: 'Y25', label: 'Oferta Perdida por Prazo',                needsDay: false },
  { code: 'Y26', label: 'Oferta Ganha Total',                      needsDay: false },
  { code: 'Y27', label: 'Oferta Ganha Parcial',                    needsDay: false },
  { code: 'Y30', label: 'Oferta Perdida por Quantidade Mínima',    needsDay: false },
  { code: 'Y34', label: 'Oferta Cancelada pelo Cliente',           needsDay: false },
  { code: 'Y37', label: 'Oferta Substituída',                      needsDay: false },
  { code: 'Y45', label: 'Oferta Perdida por restrição comercial',  needsDay: false },
  { code: 'Y46', label: 'Oferta perdida-atraso no envio ao client', needsDay: false }
];

function execButtons() {
  return EXEC_BUTTON_IDS.map(id => document.getElementById(id));
}

function showPauseBar(reason) {
  document.getElementById('pause-msg').textContent = `⚠️ ${reason}`;
  document.getElementById('pause-bar').style.display = 'flex';
  document.getElementById('stop-bar').style.display = 'none';
  isRunning = true;
  execButtons().forEach(btn => {
    btn.disabled = true;
    btn.classList.remove('loading');
  });
}

const MAX_LOG_ENTRIES = 200;

function renderLogEntry(container, { text, level }) {
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (level ? ' ' + level : '');
  const span = document.createElement('span');
  span.textContent = text;
  entry.appendChild(span);
  container.appendChild(entry);
}

function addLog(text, level = '') {
  const t = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = { text: `[${t}] ${text}`, level };

  const log = document.getElementById('log');
  renderLogEntry(log, entry);
  log.scrollTop = log.scrollHeight;

  // Persiste usando cache em memória para evitar race condition entre leituras concorrentes
  logEntriesCache.push(entry);
  if (logEntriesCache.length > MAX_LOG_ENTRIES) logEntriesCache.splice(0, logEntriesCache.length - MAX_LOG_ENTRIES);
  chrome.storage.local.set({ logEntries: logEntriesCache });
}

function setProgress(current, total) {
  const bar = document.getElementById('progress-bar');
  bar.style.width = total > 0 ? `${Math.round((current / total) * 100)}%` : '0%';
}

const MODE_BUTTON_ID = { add: 'btn-add', desc: 'btn-desc', offer: 'btn-offer', price: 'btn-price', fup: 'btn-fup' };

function setRunningState(running, label, mode) {
  isRunning = running;
  const dot     = document.getElementById('status-dot');
  const text    = document.getElementById('status-text');
  const chip    = document.getElementById('status-chip');
  const stopBar = document.getElementById('stop-bar');

  if (running) {
    dot.className = 'status-dot running';
    chip.classList.add('running');
    text.textContent = label || 'Executando...';
    stopBar.style.display = 'flex';
    const activeId = MODE_BUTTON_ID[mode];
    if (activeId) document.getElementById(activeId).classList.add('loading');
  } else {
    dot.className = 'status-dot done';
    chip.classList.remove('running');
    text.textContent = 'Pronto';
    stopBar.style.display = 'none';
    execButtons().forEach(btn => btn.classList.remove('loading'));
  }

  execButtons().forEach(btn => { btn.disabled = running; });
}

// Aba Buscar Preço — quantidade é opcional: "código" usa a qtd mínima do produto,
// "código,quantidade" (ou separado por ; ou TAB) força a quantidade informada.
// Linhas vazias são preservadas para manter o alinhamento ao colar a coluna de volta.
function parsePriceLines(raw) {
  return raw.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return { code: '', qty: null };

    // Remove prefixo numérico opcional: "23. ", "23) ", "23- ", "23: ", "23 ".
    // Limitado a 3 dígitos para não confundir com "código<TAB>quantidade",
    // já que o código do produto tem mais dígitos que a numeração da lista.
    const clean = trimmed.replace(/^\d{1,3}[\.\)\-\:\s]+/, '').trim();
    const parts = clean.split(/[,;\t]/).map(p => p.trim());
    const code  = parts[0];

    if (!code) return { code: '', qty: null };
    if (parts.length < 2 || !parts[1]) return { code, qty: null };

    const qty = parseInt(parts[1], 10);
    if (isNaN(qty)) return { code, qty: null, badQty: true, raw: trimmed };
    return { code, qty };
  });
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════

function initLineNumbers(textareaId, numsId) {
  const ta = document.getElementById(textareaId);
  const nums = document.getElementById(numsId);

  function update() {
    const count = ta.value.split('\n').length;
    nums.innerHTML = Array.from({ length: count }, (_, i) =>
      `<div>${i + 1}</div>`
    ).join('');
    nums.scrollTop = ta.scrollTop;
  }

  ta.addEventListener('input', update);
  ta.addEventListener('scroll', () => { nums.scrollTop = ta.scrollTop; });
  update();
  return update;
}

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

  // Popular o select de motivos da aba Follow-up (fonte única: FOLLOWUP_STATUSES)
  const fupSelect = document.getElementById('fup-status');
  FOLLOWUP_STATUSES.forEach(({ code, label }) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    fupSelect.appendChild(opt);
  });

  // O campo de prazo só existe para motivos com dayRequired
  function updateFupDateRow() {
    const chosen = FOLLOWUP_STATUSES.find(st => st.code === fupSelect.value);
    document.getElementById('fup-date-row').style.display = chosen?.needsDay ? 'flex' : 'none';
  }

  // Restaurar listas, últimos resultados, log e estado de pausa
  chrome.storage.local.get(['addItems', 'descCodes', 'offerItems', 'priceItems', 'priceDiscount', 'fupOffers', 'fupStatus', 'fupObs', 'fupDate', 'lastTsv', 'lastOfferText', 'lastPricesText', 'logEntries', 'pauseState'], async (data) => {
    document.getElementById('add-items').value  = data.addItems  ?? defaultAddItems;
    document.getElementById('desc-codes').value = data.descCodes ?? defaultDescCodes;
    document.getElementById('offer-items').value = data.offerItems ?? '';
    document.getElementById('price-items').value = data.priceItems ?? '';
    if (data.priceDiscount !== undefined) document.getElementById('price-discount').value = data.priceDiscount;
    document.getElementById('fup-offers').value = data.fupOffers ?? '';
    document.getElementById('fup-obs').value    = data.fupObs ?? '';
    document.getElementById('fup-date').value   = data.fupDate ?? '';
    if (data.fupStatus && FOLLOWUP_STATUSES.some(st => st.code === data.fupStatus)) {
      fupSelect.value = data.fupStatus;
    }
    updateFupDateRow();
    updateAddNums();
    updateDescNums();
    updateOfferNums();
    updatePriceNums();
    updateFupNums();

    if (data.lastTsv) {
      lastTsv = data.lastTsv;
      document.getElementById('btn-desc-copy').disabled = false;
    }

    if (data.lastOfferText) {
      lastOfferText = data.lastOfferText;
      document.getElementById('btn-offer-copy').disabled = false;
    }

    if (data.lastPricesText) {
      lastPricesText = data.lastPricesText;
      document.getElementById('btn-price-copy').disabled = false;
    }

    if (data.logEntries && data.logEntries.length > 0) {
      logEntriesCache = data.logEntries;
      const log = document.getElementById('log');
      data.logEntries.forEach(e => renderLogEntry(log, e));
      log.scrollTop = log.scrollHeight;
    }

    // Sempre verifica o estado real da página ao abrir o popup
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isPrycable = tab?.url?.includes('prycable.com.br');

    if (!isPrycable) {
      chrome.storage.local.remove('pauseState');
    } else {
      // Lê cliente atual do localStorage da página
      const clientResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const c = JSON.parse(localStorage.getItem('@cable-Customer') || '{}');
          return c.companyName ? { name: c.companyName, cnpj: c.cnpj || '' } : null;
        },
        world: 'MAIN'
      }).catch(() => []);

      const clientData = clientResult?.[0]?.result;
      if (clientData) {
        document.getElementById('client-name').textContent = clientData.name;
        document.getElementById('client-cnpj').textContent = clientData.cnpj;
        document.getElementById('client-bar').style.display = 'flex';
      }

      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          running: !!window.__prycable_running,
          paused:  !!window.__prycable_paused,
          mode:    window.__prycable_mode || ''
        }),
        world: 'MAIN'
      }).catch(() => []);

      const pageState = result?.[0]?.result;
      if (pageState?.paused && data.pauseState) {
        showPauseBar(data.pauseState.reason);
      } else if (pageState?.running) {
        const label = pageState.mode === 'add'   ? 'Adicionando produtos...' :
                      pageState.mode === 'desc'  ? 'Buscando descrições...' :
                      pageState.mode === 'price' ? 'Buscando preços...' :
                      pageState.mode === 'fup'   ? 'Atualizando status...' :
                                                   'Gerando oferta CRM...';
        setRunningState(true, label, pageState.mode);
      } else {
        chrome.storage.local.remove('pauseState');
      }
    }
  });

  // Inicializar números de linha (retorna função update para chamar após restaurar storage)
  const updateAddNums   = initLineNumbers('add-items',   'add-line-nums');
  const updateDescNums  = initLineNumbers('desc-codes',  'desc-line-nums');
  const updateOfferNums = initLineNumbers('offer-items', 'offer-line-nums');
  const updatePriceNums = initLineNumbers('price-items', 'price-line-nums');
  const updateFupNums   = initLineNumbers('fup-offers',  'fup-line-nums');

  // Salvar automaticamente ao editar
  document.getElementById('add-items').addEventListener('input', (e) => {
    chrome.storage.local.set({ addItems: e.target.value });
  });
  document.getElementById('desc-codes').addEventListener('input', (e) => {
    chrome.storage.local.set({ descCodes: e.target.value });
  });
  document.getElementById('offer-items').addEventListener('input', (e) => {
    chrome.storage.local.set({ offerItems: e.target.value });
  });
  document.getElementById('price-items').addEventListener('input', (e) => {
    chrome.storage.local.set({ priceItems: e.target.value });
  });
  document.getElementById('price-discount').addEventListener('input', (e) => {
    chrome.storage.local.set({ priceDiscount: e.target.value });
  });
  document.getElementById('fup-offers').addEventListener('input', (e) => {
    chrome.storage.local.set({ fupOffers: e.target.value });
  });
  document.getElementById('fup-status').addEventListener('change', (e) => {
    chrome.storage.local.set({ fupStatus: e.target.value });
    updateFupDateRow();
  });
  document.getElementById('fup-obs').addEventListener('input', (e) => {
    chrome.storage.local.set({ fupObs: e.target.value });
  });
  document.getElementById('fup-date').addEventListener('input', (e) => {
    chrome.storage.local.set({ fupDate: e.target.value });
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
    logEntriesCache = [];
    document.getElementById('log').innerHTML = '';
    chrome.storage.local.remove('logEntries');
    setProgress(0, 1);
  });

  // Limpar lista de adicionar
  document.getElementById('btn-add-clear').addEventListener('click', () => {
    document.getElementById('add-items').value = '';
    chrome.storage.local.set({ addItems: '' });
    updateAddNums();
  });

  // Limpar lista da oferta CRM
  document.getElementById('btn-offer-clear').addEventListener('click', () => {
    document.getElementById('offer-items').value = '';
    chrome.storage.local.set({ offerItems: '' });
    updateOfferNums();
  });

  // Limpar lista de busca de preço
  document.getElementById('btn-price-clear').addEventListener('click', () => {
    document.getElementById('price-items').value = '';
    chrome.storage.local.set({ priceItems: '' });
    updatePriceNums();
  });

  // Limpar lista de cotações do follow-up
  document.getElementById('btn-fup-clear').addEventListener('click', () => {
    document.getElementById('fup-offers').value = '';
    chrome.storage.local.set({ fupOffers: '' });
    updateFupNums();
  });

  // Receber mensagens do content-bridge
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.source !== 'PRYCABLE_AUTOMATION') return;

    if (msg.type === 'LOG') {
      addLog(msg.text, msg.level);
    } else if (msg.type === 'PROGRESS') {
      setProgress(msg.current, msg.total);
    } else if (msg.type === 'PAUSED') {
      chrome.storage.local.set({ pauseState: { code: msg.code, reason: msg.reason } });
      showPauseBar(msg.reason);
      addLog(`⏸️ Pausado: ${msg.reason}`, 'warning');
    } else if (msg.type === 'DONE') {
      chrome.storage.local.remove('pauseState');
      setRunningState(false);
      document.getElementById('pause-bar').style.display = 'none';
      if (msg.data && msg.data.tsv) {
        lastTsv = msg.data.tsv;
        chrome.storage.local.set({ lastTsv: msg.data.tsv });
        document.getElementById('btn-desc-copy').disabled = false;
      }
      if (msg.data && msg.data.offerText) {
        lastOfferText = msg.data.offerText;
        chrome.storage.local.set({ lastOfferText: msg.data.offerText });
        document.getElementById('btn-offer-copy').disabled = false;
      }
      if (msg.data && msg.data.pricesText) {
        lastPricesText = msg.data.pricesText;
        chrome.storage.local.set({ lastPricesText: msg.data.pricesText });
        document.getElementById('btn-price-copy').disabled = false;
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

  // ── BOTÃO: Continuar (retenta o produto atual, com item possivelmente atualizado) ──
  document.getElementById('btn-continue').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Lê o modo e índice atual do script na página
    const stateResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ index: window.__prycable_current_index, mode: window.__prycable_mode }),
      world: 'MAIN'
    }).catch(() => []);

    const pageState = stateResult?.[0]?.result;
    let overrideItem = null;

    if (pageState && pageState.index !== undefined) {
      if (pageState.mode === 'price') {
        // Índices incluem linhas vazias, então não filtra — usa o mesmo parser do Executar
        const parsed = parsePriceLines(document.getElementById('price-items').value.trim());
        const item = parsed[pageState.index];
        if (item && item.code && !item.badQty) overrideItem = { code: item.code, qty: item.qty };
      } else if (pageState.mode === 'add' || pageState.mode === 'offer') {
        const taId = pageState.mode === 'offer' ? 'offer-items' : 'add-items';
        const lines = document.getElementById(taId).value.trim().split('\n').map(l => l.trim()).filter(l => l);
        const line = lines[pageState.index];
        if (line) {
          const clean = line.replace(/^\d+[\.\)\-\:\s]+/, '').trim();
          const parts = clean.split(',');
          if (parts.length >= 2) {
            const code = parts[0].trim();
            const qty = parseInt(parts[1].trim(), 10);
            if (code && !isNaN(qty)) overrideItem = { code, qty };
          }
        }
      } else if (pageState.mode === 'desc') {
        const lines = document.getElementById('desc-codes').value.trim().split('\n').map(l => l.trim()).filter(l => l);
        const line = lines[pageState.index];
        if (line) overrideItem = line.replace(/^\d+[\.\)\-\:\s]+/, '').trim();
      }
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (item) => {
        window.__prycable_paused = false;
        window.__prycable_continue = true;
        if (item !== null) window.__prycable_retry_override = item;
      },
      args: [overrideItem],
      world: 'MAIN'
    }).catch(() => {});

    chrome.storage.local.remove('pauseState');
    document.getElementById('pause-bar').style.display = 'none';
    document.getElementById('stop-bar').style.display = 'flex';
    addLog('Continuando...', 'info');
  });

  // ── BOTÃO: Pular este produto (quando pausado) ──
  document.getElementById('btn-skip').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__prycable_paused = false; window.__prycable_skip = true; },
      world: 'MAIN'
    }).catch(() => {});
    chrome.storage.local.remove('pauseState');
    document.getElementById('pause-bar').style.display = 'none';
    document.getElementById('stop-bar').style.display = 'flex';
    addLog('Produto pulado. Continuando...', 'warning');
  });

  // ── BOTÃO: Parar tudo (quando pausado) ──
  document.getElementById('btn-pause-stop').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__prycable_stop = true; window.__prycable_paused = false; },
      world: 'MAIN'
    }).catch(() => {});
    chrome.storage.local.remove('pauseState');
    document.getElementById('pause-bar').style.display = 'none';
    addLog('Execução interrompida pelo usuário.', 'warning');
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
      // Remove prefixo numérico opcional: "23. ", "23) ", "23- ", "23: ", "23 "
      const clean = trimmed.replace(/^\d+[\.\)\-\:\s]+/, '').trim();
      const parts = clean.split(',');
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
    setRunningState(true, `Adicionando ${items.length} produto(s)...`, 'add');
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

    const codes = raw.split('\n').map(l => l.trim()); // mantém linhas vazias como separadores
    if (codes.every(l => !l)) {
      addLog('Nenhum código válido encontrado.', 'error');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    lastTsv = null;
    chrome.storage.local.remove('lastTsv');
    document.getElementById('btn-desc-copy').disabled = true;
    setProgress(0, codes.length);
    setRunningState(true, `Buscando ${codes.length} produto(s)...`, 'desc');
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

  // ── BOTÃO: Executar Oferta CRM ──
  document.getElementById('btn-offer').addEventListener('click', async () => {
    if (isRunning) return;

    const raw      = document.getElementById('offer-items').value.trim();
    const discount = parseFloat(document.getElementById('offer-discount').value);

    if (!raw) {
      addLog('Lista vazia. Preencha os produtos antes de executar.', 'error');
      return;
    }
    if (isNaN(discount) || discount < 0 || discount > 100) {
      addLog('Desconto inválido. Informe um valor entre 0 e 100.', 'error');
      return;
    }

    const items = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const clean = trimmed.replace(/^\d+[\.\)\-\:\s]+/, '').trim();
      const parts = clean.split(',');
      if (parts.length < 2) {
        addLog(`Linha inválida: "${trimmed}" — use o formato: código,quantidade`, 'error');
        return;
      }
      const code = parts[0].trim();
      const qty  = parseInt(parts[1].trim(), 10);
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

    lastOfferText = null;
    chrome.storage.local.remove('lastOfferText');
    document.getElementById('btn-offer-copy').disabled = true;
    setProgress(0, items.length);
    setRunningState(true, `Gerando oferta de ${items.length} produto(s)...`, 'offer');
    addLog(`Iniciando oferta CRM: ${items.length} produto(s) com ${discount}% de desconto...`, 'info');

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-bridge.js']
    }).catch(() => {});

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: offerScriptMain,
      args: [items, discount],
      world: 'MAIN'
    }).catch((e) => {
      addLog(`Erro ao iniciar: ${e.message}`, 'error');
      setRunningState(false);
    });
  });

  // ── BOTÃO: Executar Buscar Preço ──
  document.getElementById('btn-price').addEventListener('click', async () => {
    if (isRunning) return;

    const raw      = document.getElementById('price-items').value.trim();
    const discount = parseFloat(document.getElementById('price-discount').value);

    if (!raw) {
      addLog('Lista vazia. Preencha os produtos antes de executar.', 'error');
      return;
    }
    if (isNaN(discount) || discount < 0 || discount > 100) {
      addLog('Desconto inválido. Informe um valor entre 0 e 100.', 'error');
      return;
    }

    const items = parsePriceLines(raw);

    const badLine = items.find(it => it.badQty);
    if (badLine) {
      addLog(`Quantidade inválida: "${badLine.raw}" — use "código" ou "código,quantidade"`, 'error');
      return;
    }

    const codeCount = items.filter(it => it.code).length;
    if (codeCount === 0) {
      addLog('Nenhum código válido encontrado na lista.', 'error');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    lastPricesText = null;
    chrome.storage.local.remove('lastPricesText');
    document.getElementById('btn-price-copy').disabled = true;
    setProgress(0, items.length);
    setRunningState(true, `Buscando preço de ${codeCount} produto(s)...`, 'price');
    addLog(`Iniciando busca de preços: ${codeCount} produto(s) com ${discount}% de desconto...`, 'info');

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-bridge.js']
    }).catch(() => {});

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: priceScriptMain,
      args: [items, discount],
      world: 'MAIN'
    }).catch((e) => {
      addLog(`Erro ao iniciar: ${e.message}`, 'error');
      setRunningState(false);
    });
  });

  // ── BOTÃO: Executar Follow-up ──
  // Gravação real no ERP (PUT /api/offer/{numero}): pede dois cliques,
  // o segundo confirma o lote.
  let fupConfirmTimer = null;

  function resetFupConfirm() {
    clearTimeout(fupConfirmTimer);
    fupConfirmTimer = null;
    document.getElementById('btn-fup').classList.remove('confirm');
    document.getElementById('fup-btn-label').textContent = 'Executar';
  }

  document.getElementById('btn-fup').addEventListener('click', async () => {
    if (isRunning) return;

    const raw    = document.getElementById('fup-offers').value.trim();
    const code   = document.getElementById('fup-status').value;
    const obs    = document.getElementById('fup-obs').value.trim();
    const date   = document.getElementById('fup-date').value;
    const chosen = FOLLOWUP_STATUSES.find(st => st.code === code);

    if (!chosen) {
      addLog('Selecione o status (motivo) antes de executar.', 'error');
      return;
    }
    if (!raw) {
      addLog('Nenhuma cotação informada. Escreva os números antes de executar.', 'error');
      return;
    }
    if (!obs) {
      addLog(`"${chosen.label}" exige observação — preencha o campo.`, 'error');
      return;
    }
    if (chosen.needsDay && !date) {
      addLog(`"${chosen.label}" exige a data de prazo.`, 'error');
      return;
    }

    // Uma cotação por linha; aceita prefixo de numeração e ignora linhas vazias
    const offers = raw.split('\n')
      .map(l => l.trim().replace(/^\d{1,3}[\.\)\-\:\s]+/, '').trim())
      .filter(l => l);

    if (offers.length === 0) {
      addLog('Nenhuma cotação válida encontrada na lista.', 'error');
      return;
    }

    // 1º clique: confirma antes de gravar
    if (!fupConfirmTimer) {
      document.getElementById('btn-fup').classList.add('confirm');
      document.getElementById('fup-btn-label').textContent = `Confirmar ${offers.length}`;
      addLog(`⚠️ Vai gravar "${chosen.label}" em ${offers.length} cotação(ões): ${offers.join(', ')}. Clique novamente para confirmar.`, 'warning');
      fupConfirmTimer = setTimeout(resetFupConfirm, 8000);
      return;
    }
    resetFupConfirm();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    setProgress(0, offers.length);
    setRunningState(true, `Atualizando ${offers.length} cotação(ões)...`, 'fup');
    addLog(`Follow-up: ${offers.length} cotação(ões) → ${chosen.code} "${chosen.label}"`, 'info');
    if (chosen.needsDay) {
      addLog(`Prazo enviado como "${date}" (ISO) — esse formato não foi capturado do site, confira a primeira cotação.`, 'warning');
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-bridge.js']
    }).catch(() => {});

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: followupScriptMain,
      args: [offers, {
        code:        chosen.code,
        observation: obs,
        statusDate:  chosen.needsDay ? date : null
      }],
      world: 'MAIN'
    }).catch((e) => {
      addLog(`Erro ao iniciar: ${e.message}`, 'error');
      setRunningState(false);
    });
  });

  // ── BOTÃO: Copiar preços ──
  document.getElementById('btn-price-copy').addEventListener('click', async () => {
    let text = lastPricesText;

    if (!text) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__prycable_prices || null,
        world: 'MAIN'
      }).catch(() => []);
      text = result[0]?.result ?? null;
    }

    if (!text) {
      addLog('Nenhum preço disponível. Execute a busca de preços primeiro.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      addLog('Preços copiados na ordem da lista! Cole com Ctrl+V.', 'success');
    } catch {
      addLog('❌ Falha ao copiar. Mantenha o popup em foco e tente novamente.', 'error');
    }
  });

  // ── BOTÃO: Copiar para CRM ──
  document.getElementById('btn-offer-copy').addEventListener('click', async () => {
    let text = lastOfferText;

    if (!text) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__prycable_offer_text || null,
        world: 'MAIN'
      }).catch(() => []);
      text = result[0]?.result ?? null;
    }

    if (!text) {
      addLog('Nenhum dado disponível. Execute a geração de oferta primeiro.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      addLog('Oferta copiada! Cole no CRM com Ctrl+V.', 'success');
    } catch {
      addLog('❌ Falha ao copiar. Mantenha o popup em foco e tente novamente.', 'error');
    }
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

    try {
      await navigator.clipboard.writeText(tsv);
      addLog('Dados copiados! Abra o Excel e pressione Ctrl+V.', 'success');
    } catch {
      addLog('❌ Falha ao copiar. Mantenha o popup em foco e tente novamente.', 'error');
    }
  });

});
