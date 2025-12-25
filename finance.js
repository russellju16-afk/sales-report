(function(){
  let FINANCE_EVENTS_BOUND = false;
  let BP_RESOLVE_KEY = '';
  let BP_RESOLVE_PROMISE = null;

  function toNumber(val){
    if(val === null || val === undefined || val === '') return null;
    const n = Number(val);
    return isFinite(n) ? n : null;
  }

  function fmtWanSafe(val){
    const n = toNumber(val);
    if(n === null) return '—';
    if(typeof fmtWan === 'function'){
      const out = fmtWan(n);
      return out ? out : '—';
    }
    return (n / 10000).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' 万';
  }

  function fmtNumSafe(val){
    const n = toNumber(val);
    if(n === null) return '—';
    if(typeof fmtNum === 'function'){
      const out = fmtNum(n);
      return out ? out : '—';
    }
    return n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function fmtPctSafe(val){
    const n = toNumber(val);
    if(n === null) return '—';
    const pct = n > 1 ? n : n * 100;
    if(typeof fmtPct === 'function'){
      const out = fmtPct(pct);
      return out ? out : '—';
    }
    return pct.toFixed(2) + '%';
  }

  function fmtDays(val){
    const n = toNumber(val);
    if(n === null) return '—';
    const v = Math.round(n * 10) / 10;
    const digits = v % 1 ? 1 : 0;
    return v.toLocaleString('en-US', {minimumFractionDigits:digits, maximumFractionDigits:1});
  }

  function fmtText(val){
    if(val === null || val === undefined) return '—';
    const s = String(val).trim();
    return s ? s : '—';
  }

  function fmtDate(val){
    if(val === null || val === undefined) return '—';
    const s = String(val).trim();
    return s ? s : '—';
  }

  function setText(id, text){
    const el = document.getElementById(id);
    if(el) el.textContent = text;
  }

  function renderMiniCard(id, title, card){
    const el = document.getElementById(id);
    if(!el) return;
    const frag = document.createDocumentFragment();
    const titleEl = document.createElement('div');
    titleEl.className = 'finance-mini-title';
    titleEl.textContent = title;
    const valueEl = document.createElement('div');
    valueEl.className = 'finance-mini-val ' + (card && card.level ? card.level : '');
    valueEl.textContent = card && card.value ? card.value : '—';
    const noteEl = document.createElement('div');
    noteEl.className = 'finance-mini-note';
    noteEl.textContent = card && card.note ? card.note : '';
    frag.appendChild(titleEl);
    frag.appendChild(valueEl);
    frag.appendChild(noteEl);
    el.replaceChildren(frag);
  }

  function formatPeriod(meta){
    const start = meta && meta.period_start ? String(meta.period_start) : '';
    const end = meta && meta.period_end ? String(meta.period_end) : '';
    if(start && end) return start + ' 至 ' + end;
    return start || end || '—';
  }

  function getFinanceVersion(finance){
    const meta = finance && finance.meta ? finance.meta : {};
    return meta.generated_at || meta.generatedAt || finance.generated_at || finance.generatedAt || finance.as_of || finance.asOf || '—';
  }

  function getSegAr(finance, segKey){
    const ar = finance && finance.ar ? finance.ar : {};
    const segments = ar.segments || {};
    return segments[segKey] || segments.total || {};
  }

  function getSegAp(finance, segKey){
    const ap = finance && finance.ap ? finance.ap : {};
    const segments = ap.segments || {};
    return segments[segKey] || segments.total || ap;
  }

  function getAp(finance){
    return finance && finance.ap ? finance.ap : {};
  }

  function getPo(finance){
    return finance && finance.po ? finance.po : {};
  }

  function getInventory(finance){
    return finance && finance.inventory ? finance.inventory : {};
  }

  function getBank(finance){
    return finance && finance.bank ? finance.bank : {};
  }

  function getWc(finance){
    return finance && finance.wc ? finance.wc : {};
  }

  function getBp(finance){
    return finance && finance.bp ? finance.bp : {};
  }

  function renderKpiCards(containerId, items){
    const el = document.getElementById(containerId);
    if(!el) return;
    const frag = document.createDocumentFragment();
    (items || []).forEach(item=>{
      const card = document.createElement('div');
      card.className = 'card finance-kpi';
      const name = document.createElement('div');
      name.className = 'kpi-name';
      name.textContent = item.label;
      const value = document.createElement('div');
      value.className = 'kpi-val';
      value.textContent = item.value;
      card.appendChild(name);
      card.appendChild(value);
      frag.appendChild(card);
    });
    el.replaceChildren(frag);
  }

  function alignSeries(months, arr){
    if(!Array.isArray(months)) return [];
    const src = Array.isArray(arr) ? arr : [];
    return months.map((_, i)=>{
      const v = i < src.length ? src[i] : null;
      return toNumber(v);
    });
  }

  function hasSeriesData(series){
    return Array.isArray(series) && series.some(v=>v !== null && v !== undefined);
  }

  function renderDualChart(id, months, series, yName){
    if(!window.ChartManager) return;
    const usable = (series || []).filter(s=>hasSeriesData(s.data));
    if(!Array.isArray(months) || months.length === 0 || usable.length === 0){
      ChartManager.setEmpty(id, '暂无数据');
      return;
    }
    ChartManager.setOption(id, {
      tooltip:{
        trigger:'axis',
        formatter:(params)=>{
          const title = params && params[0] ? (params[0].axisValue || '') : '';
          const lines = [title];
          (params || []).forEach(p=>{
            if(p.data === null || p.data === undefined) return;
            lines.push(`${p.marker}${p.seriesName}：${fmtNumSafe(p.data)}`);
          });
          return lines.join('<br/>');
        }
      },
      legend:{top:10,type:'scroll'},
      grid:{left:50,right:20,top:60,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name:yName || '金额（元）'},
      series: usable
    });
  }

  function renderBankChart(segKey, bank, currency){
    if(!window.ChartManager) return;
    const trend = bank && bank.trend ? bank.trend : {};
    const months = Array.isArray(trend.months) ? trend.months : [];
    const cashIn = alignSeries(months, trend.cash_in);
    const cashOut = alignSeries(months, trend.cash_out);
    const net = alignSeries(months, trend.net_cash);
    const cum = alignSeries(months, trend.cum_net_cash);

    const toggle = document.getElementById(segKey + '_finance_bank_cum');
    const showCum = !!(toggle && toggle.checked);
    const lineData = showCum ? cum : net;
    const lineName = showCum ? '累计净现金流' : '净现金流';

    const series = [];
    if(hasSeriesData(cashIn)) series.push({ name:'现金流入', type:'bar', data: cashIn, barMaxWidth:36 });
    if(hasSeriesData(cashOut)) series.push({ name:'现金流出', type:'bar', data: cashOut, barMaxWidth:36 });
    if(hasSeriesData(lineData)) series.push({ name: lineName, type:'line', data: lineData, smooth:true });

    if(!months.length || series.length === 0){
      ChartManager.setEmpty(segKey + '_finance_bank_chart', '暂无数据');
      return;
    }

    ChartManager.setOption(segKey + '_finance_bank_chart', {
      tooltip:{
        trigger:'axis',
        formatter:(params)=>{
          const title = params && params[0] ? (params[0].axisValue || '') : '';
          const lines = [title];
          (params || []).forEach(p=>{
            if(p.data === null || p.data === undefined) return;
            lines.push(`${p.marker}${p.seriesName}：${fmtNumSafe(p.data)}`);
          });
          return lines.join('<br/>');
        }
      },
      legend:{top:10,type:'scroll'},
      grid:{left:50,right:20,top:60,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name: currency ? `金额（${currency}）` : '金额（元）'},
      series: series
    });
  }

  function renderInventoryChart(segKey, inventory, currency){
    if(!window.ChartManager) return;
    const trend = inventory && inventory.trend ? inventory.trend : {};
    const months = Array.isArray(trend.months) ? trend.months : [];
    const purchases = alignSeries(months, trend.purchases_in);
    const cogs = alignSeries(months, trend.cogs);
    const ending = alignSeries(months, trend.ending_inventory);

    const series = [];
    if(hasSeriesData(purchases)) series.push({ name:'入库', type:'bar', data: purchases, barMaxWidth:36 });
    if(hasSeriesData(cogs)) series.push({ name:'销售成本', type:'bar', data: cogs, barMaxWidth:36 });
    if(hasSeriesData(ending)) series.push({ name:'期末库存', type:'line', data: ending, smooth:true });

    if(!months.length || series.length === 0){
      ChartManager.setEmpty(segKey + '_finance_inventory_chart', '暂无数据');
      return;
    }

    ChartManager.setOption(segKey + '_finance_inventory_chart', {
      tooltip:{
        trigger:'axis',
        formatter:(params)=>{
          const title = params && params[0] ? (params[0].axisValue || '') : '';
          const lines = [title];
          (params || []).forEach(p=>{
            if(p.data === null || p.data === undefined) return;
            lines.push(`${p.marker}${p.seriesName}：${fmtNumSafe(p.data)}`);
          });
          return lines.join('<br/>');
        }
      },
      legend:{top:10,type:'scroll'},
      grid:{left:50,right:20,top:60,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name: currency ? `金额（${currency}）` : '金额（元）'},
      series: series
    });
  }

  function renderPoInboundChart(segKey, po, currency){
    if(!window.ChartManager) return;
    const trend = po && po.trend ? po.trend : {};
    const months = Array.isArray(trend.months) ? trend.months : [];
    const inbound = alignSeries(months, trend.inbound_amount);
    if(!months.length || !hasSeriesData(inbound)){
      ChartManager.setEmpty(segKey + '_finance_po_inbound_chart', '暂无数据');
      return;
    }

    ChartManager.setOption(segKey + '_finance_po_inbound_chart', {
      tooltip:{
        trigger:'axis',
        axisPointer:{type:'shadow'},
        formatter:(params)=>{
          const p = params && params[0] ? params[0] : null;
          if(!p) return '';
          return `${p.name}<br/>${p.marker}${p.seriesName}：${fmtNumSafe(p.data)}`;
        }
      },
      grid:{left:50,right:20,top:50,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name: currency ? `金额（${currency}）` : '金额（元）'},
      series:[{name:'入库金额',type:'bar',data:inbound,barMaxWidth:36}]
    });
  }

  function renderPoPriceChart(segKey, priceItem, currency){
    if(!window.ChartManager) return;
    const months = Array.isArray(priceItem && priceItem.months) ? priceItem.months : [];
    const avgCost = alignSeries(months, priceItem && priceItem.avg_unit_cost);
    if(!months.length || !hasSeriesData(avgCost)){
      ChartManager.setEmpty(segKey + '_finance_po_price_chart', '暂无数据');
      return;
    }

    const name = priceItem && (priceItem.product || priceItem.sku) ? (priceItem.product || priceItem.sku) : '均价';
    ChartManager.setOption(segKey + '_finance_po_price_chart', {
      tooltip:{
        trigger:'axis',
        formatter:(params)=>{
          const p = params && params[0] ? params[0] : null;
          if(!p) return '';
          return `${p.name}<br/>${p.marker}${p.seriesName}：${fmtNumSafe(p.data)}`;
        }
      },
      grid:{left:50,right:20,top:50,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name: currency ? `均价（${currency}）` : '均价（元）'},
      series:[{name:name,type:'line',data:avgCost,smooth:true}]
    });
  }

  function renderTable(tableId, rows, columns, formatters){
    const table = document.getElementById(tableId);
    if(!table || !table.tBodies || !table.tBodies[0]) return;
    const tbody = table.tBodies[0];
    tbody.innerHTML = '';

    if(!Array.isArray(rows) || rows.length === 0){
      const tr = document.createElement('tr');
      tr.dataset.empty = '1';
      const td = document.createElement('td');
      td.colSpan = columns.length;
      td.className = 'finance-empty-row';
      td.textContent = '暂无数据';
      tr.appendChild(td);
      tbody.appendChild(tr);
      setTableCount(tableId, 0);
      if(typeof installHeaderFiltersForTable === 'function'){
        installHeaderFiltersForTable(table);
      }
      return;
    }

    rows.forEach(row=>{
      const tr = document.createElement('tr');
      columns.forEach((col, idx)=>{
        const td = document.createElement('td');
        const val = row && row[col.key] !== undefined ? row[col.key] : null;
        const fmt = formatters && typeof formatters[idx] === 'function' ? formatters[idx] : null;
        td.textContent = fmt ? fmt(val, row) : fmtText(val);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    setTableCount(tableId, rows.length);
    if(typeof installHeaderFiltersForTable === 'function'){
      installHeaderFiltersForTable(table);
    }
    applySortFromState(table);
  }

  function setTableCount(tableId, count){
    const countEl = document.getElementById(tableId.replace('_table', '_count'));
    if(countEl) countEl.textContent = String(count || 0);
  }

  function renderTopCustomers(segKey, arSeg){
    const rows = Array.isArray(arSeg && arSeg.top_customers) ? arSeg.top_customers : [];
    const mapped = rows.map(row=>({
      customer: row && row.customer ? row.customer : '',
      ending_balance: row && row.ending_balance !== undefined ? row.ending_balance : (row && row.ending_net_ar !== undefined ? row.ending_net_ar : row && row.ending_sales_ar),
      change: row && row.change !== undefined ? row.change : null,
      last_receipt: row && row.last_receipt !== undefined ? row.last_receipt : null,
      days_since_last_receipt: row && row.days_since_last_receipt !== undefined ? row.days_since_last_receipt : null
    }));
    renderTable(segKey + '_finance_ar_table', mapped, [
      { key:'customer' },
      { key:'ending_balance' },
      { key:'change' },
      { key:'last_receipt' },
      { key:'days_since_last_receipt' }
    ], [
      (v)=>fmtText(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtDate(v),
      (v)=>fmtDays(v)
    ]);
  }

  function renderTopSuppliers(segKey, ap){
    const rows = Array.isArray(ap && ap.top_suppliers) ? ap.top_suppliers : [];
    const mapped = rows.map(row=>({
      supplier: row && row.supplier ? row.supplier : '',
      purchase_ap_balance: row && row.purchase_ap_balance !== undefined ? row.purchase_ap_balance : row && row.ending_purchase_ap,
      other_ap_balance: row && row.other_ap_balance !== undefined ? row.other_ap_balance : row && row.ending_other_ap,
      prepay_balance: row && row.prepay_balance !== undefined ? row.prepay_balance : row && row.ending_prepay,
      ending_balance: row && row.ending_balance !== undefined ? row.ending_balance : row && row.ending_net_ap,
      last_payment: row && row.last_payment !== undefined ? row.last_payment : null
    }));
    renderTable(segKey + '_finance_ap_table', mapped, [
      { key:'supplier' },
      { key:'purchase_ap_balance' },
      { key:'other_ap_balance' },
      { key:'prepay_balance' },
      { key:'ending_balance' },
      { key:'last_payment' }
    ], [
      (v)=>fmtText(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtDate(v)
    ]);
  }

  function renderTopOtherAr(segKey, arSeg){
    const rows = Array.isArray(arSeg && arSeg.top_other_ar_customers) ? arSeg.top_other_ar_customers : [];
    renderTable(segKey + '_finance_ar_other_table', rows, [
      { key:'customer' },
      { key:'ending_other_ar' },
      { key:'ending_net_ar' }
    ], [
      (v)=>fmtText(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtWanSafe(v)
    ]);
  }

  function renderTopOtherAp(segKey, ap){
    const rows = Array.isArray(ap && ap.top_other_ap_suppliers) ? ap.top_other_ap_suppliers : [];
    renderTable(segKey + '_finance_ap_other_table', rows, [
      { key:'supplier' },
      { key:'ending_other_ap' },
      { key:'ending_net_ap' }
    ], [
      (v)=>fmtText(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtWanSafe(v)
    ]);
  }

  function renderBankByType(segKey, bank){
    const rows = Array.isArray(bank && bank.by_type) ? bank.by_type : [];
    renderTable(segKey + '_finance_bank_type_table', rows, [
      { key:'type' },
      { key:'cash_in' },
      { key:'cash_out' },
      { key:'count' }
    ], [
      (v)=>fmtText(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtWanSafe(v),
      (v)=>fmtText(v)
    ]);
  }

  function renderPoTopSuppliers(segKey, po){
    const rows = Array.isArray(po && po.top_suppliers) ? po.top_suppliers : [];
    renderTable(segKey + '_finance_po_sup_table', rows, [
      { key:'supplier' },
      { key:'amount' }
    ], [
      (v)=>fmtText(v),
      (v)=>fmtWanSafe(v)
    ]);
  }

  function renderPoPriceTable(segKey, list){
    const rows = (list || []).map(item=>{
      const months = Array.isArray(item && item.months) ? item.months : [];
      const costs = Array.isArray(item && item.avg_unit_cost) ? item.avg_unit_cost : [];
      const lastCost = costs.length ? costs[costs.length - 1] : null;
      return {
        sku: item && item.sku ? item.sku : '',
        product: item && item.product ? item.product : '',
        month_count: months.length || 0,
        last_cost: lastCost,
        amount: item && item.amount !== undefined ? item.amount : null
      };
    });

    renderTable(segKey + '_finance_po_price_table', rows, [
      { key:'sku' },
      { key:'product' },
      { key:'month_count' },
      { key:'last_cost' },
      { key:'amount' }
    ], [
      (v)=>fmtText(v),
      (v)=>fmtText(v),
      (v)=>fmtText(v),
      (v)=>fmtNumSafe(v),
      (v)=>fmtWanSafe(v)
    ]);
  }

  function getSortInput(table){
    if(!table || !table.id) return null;
    const id = table.id.replace('_table', '_sort');
    return document.getElementById(id);
  }

  function parseSortValue(raw){
    if(!raw) return null;
    const m = String(raw).match(/^(\d+):(asc|desc)$/);
    if(!m) return null;
    return { col: Number(m[1]), asc: m[2] === 'asc' };
  }

  function setSortValue(input, col, asc){
    if(!input) return;
    input.value = String(col) + ':' + (asc ? 'asc' : 'desc');
  }

  function parseNumberSafe(val){
    if(typeof parseNumber === 'function') return parseNumber(val);
    if(val === null || val === undefined) return NaN;
    const t = String(val).replace(/,/g,'').replace(/%/g,'').trim();
    const v = parseFloat(t);
    return isNaN(v) ? NaN : v;
  }

  function sortTableRows(table, col, asc){
    if(!table || !table.tBodies || !table.tBodies[0]) return;
    const tbody = table.tBodies[0];
    const rows = [...tbody.querySelectorAll('tr')].filter(r=>!r.dataset.empty);
    if(rows.length === 0) return;

    rows.sort((a,b)=>{
      const av = a.cells[col] ? a.cells[col].innerText : '';
      const bv = b.cells[col] ? b.cells[col].innerText : '';
      const an = parseNumberSafe(av);
      const bn = parseNumberSafe(bv);
      if(!isNaN(an) && !isNaN(bn)) return asc ? (an - bn) : (bn - an);
      return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    rows.forEach(r=>tbody.appendChild(r));
    if(typeof updateSortIndicator === 'function'){
      updateSortIndicator(table, col, asc);
    }
    if(typeof applyHeaderFiltersForTable === 'function'){
      applyHeaderFiltersForTable(table);
    }
  }

  function applySortFromState(table){
    const input = getSortInput(table);
    const spec = input ? parseSortValue(input.value) : null;
    if(!spec) return;
    sortTableRows(table, spec.col, spec.asc);
  }

  function buildPriceTrendList(po){
    const list = Array.isArray(po && po.price_trends) ? po.price_trends : [];
    return list.map((item, idx)=>{
      const amt = toNumber(item && item.amount) || 0;
      return { idx, amount: amt, item: item || {} };
    }).sort((a,b)=>b.amount - a.amount);
  }

  function getSavedControlValue(id){
    const st = window.StateManager && window.StateManager.state ? window.StateManager.state : null;
    if(st && st.controls && st.controls[id] !== undefined && st.controls[id] !== null){
      return String(st.controls[id]);
    }
    return '';
  }

  function syncPriceSelect(select, sortedList){
    if(!select) return { item: null };
    const savedVal = getSavedControlValue(select.id);
    const curVal = select.value || savedVal || '';
    const topList = sortedList.slice(0, 5);
    const idxSet = new Set(topList.map(x=>String(x.idx)));
    const extra = curVal && !idxSet.has(curVal) ? sortedList.find(x=>String(x.idx) === curVal) : null;
    const finalList = extra ? [extra].concat(topList) : topList;

    const frag = document.createDocumentFragment();
    finalList.forEach(x=>{
      const sku = x.item && x.item.sku ? String(x.item.sku) : '';
      const name = x.item && x.item.product ? String(x.item.product) : '';
      const label = sku && name ? `${sku}｜${name}` : (sku || name || `货号 ${x.idx + 1}`);
      const opt = document.createElement('option');
      opt.value = String(x.idx);
      opt.textContent = label;
      frag.appendChild(opt);
    });
    select.replaceChildren(frag);

    if(select.options.length === 0){
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '暂无货号';
      select.appendChild(opt);
      select.value = '';
      return { item: null };
    }

    let nextVal = select.value || '';
    if(curVal && idxSet.has(curVal)){
      nextVal = curVal;
    }else if(extra){
      nextVal = String(extra.idx);
    }else if(!nextVal){
      nextVal = String(finalList[0].idx);
    }
    const changed = nextVal !== select.value;
    select.value = nextVal;
    if(changed && window.StateManager) window.StateManager.queuePersist();

    const chosen = sortedList.find(x=>String(x.idx) === String(select.value));
    return { item: chosen ? chosen.item : null };
  }

  function buildReconCard(diffVal, label){
    const n = toNumber(diffVal);
    if(n === null) return { value:'—', note:'暂无对账差异数据', level:'muted' };
    if(n === 0) return { value: fmtWanSafe(n), note: label + '对账正常', level:'ok' };
    if(n > 0) return { value: fmtWanSafe(n), note: label + '差异偏正，建议核对', level:'warn' };
    return { value: fmtWanSafe(n), note: label + '差异偏负，建议核对', level:'warn' };
  }

  async function canFetch(url){
    try{
      const resp = await fetch(url, { method:'HEAD', cache:'no-store' });
      if(resp.ok) return true;
    }catch(e){}
    try{
      const resp = await fetch(url, { method:'GET', cache:'no-store' });
      return resp.ok;
    }catch(e){
      return false;
    }
  }

  async function resolveBpLink(bp){
    const primary = bp && bp.latest_path ? String(bp.latest_path).trim() : '';
    const fallback = './reports/bp_latest.html';
    const candidates = [];
    if(primary) candidates.push(primary);
    candidates.push(fallback);

    for(const url of candidates){
      const ok = await canFetch(url);
      if(ok) return url;
    }
    return '';
  }

  function applyBpButton(btn, url, title){
    if(!btn) return;
    if(title) btn.title = title;
    if(url){
      btn.href = url;
      btn.textContent = '打开预算报告';
      btn.classList.remove('disabled');
      btn.setAttribute('aria-disabled','false');
    }else{
      btn.removeAttribute('href');
      btn.textContent = '未发布';
      btn.classList.add('disabled');
      btn.setAttribute('aria-disabled','true');
    }
  }

  function updateBpButton(segKey, bp){
    const btn = document.getElementById(segKey + '_finance_bp_btn');
    if(!btn) return;
    const key = bp && bp.latest_path ? String(bp.latest_path).trim() : '';
    const title = bp && bp.title ? String(bp.title) : '';

    if(BP_RESOLVE_KEY !== key){
      BP_RESOLVE_KEY = key;
      BP_RESOLVE_PROMISE = resolveBpLink(bp);
    }

    if(!BP_RESOLVE_PROMISE){
      applyBpButton(btn, '', title);
      return;
    }

    applyBpButton(btn, '', title);
    BP_RESOLVE_PROMISE.then(url=>{
      applyBpButton(btn, url, title);
    });
  }

  function bindFinanceEventsOnce(){
    if(FINANCE_EVENTS_BOUND) return;
    FINANCE_EVENTS_BOUND = true;

    document.addEventListener('click', (e)=>{
      const clearBtn = e.target && e.target.closest ? e.target.closest('[data-finance-action="clear-filters"]') : null;
      if(clearBtn){
        const tableId = clearBtn.dataset.table || '';
        const table = tableId ? document.getElementById(tableId) : null;
        if(table && typeof clearHeaderFiltersForTable === 'function'){
          clearHeaderFiltersForTable(table);
        }
        return;
      }

      const retryBtn = e.target && e.target.closest ? e.target.closest('[data-finance-action="retry-finance"]') : null;
      if(retryBtn){
        if(typeof reloadFinanceData === 'function') reloadFinanceData();
        return;
      }

      const bpBtn = e.target && e.target.closest ? e.target.closest('[data-finance-action="open-bp"]') : null;
      if(bpBtn && bpBtn.getAttribute('aria-disabled') === 'true'){
        e.preventDefault();
        return;
      }

      const th = e.target && e.target.closest ? e.target.closest('th') : null;
      if(!th) return;
      const tr = th.parentElement;
      if(tr && tr.classList.contains('filter-row')) return;
      const table = th.closest ? th.closest('table[data-finance-table]') : null;
      if(!table) return;

      const col = th.cellIndex;
      const input = getSortInput(table);
      const prev = input ? parseSortValue(input.value) : null;
      const asc = prev && prev.col === col ? !prev.asc : true;
      setSortValue(input, col, asc);
      sortTableRows(table, col, asc);
      if(window.StateManager) window.StateManager.queuePersist();
    });

    document.addEventListener('change', (e)=>{
      const target = e.target;
      if(!target) return;

      if(target.matches && target.matches('.finance-toggle')){
        const segKey = target.dataset.seg || 'total';
        const finance = window.FINANCE_DATA || {};
        const bank = getBank(finance);
        const currency = finance && finance.meta && finance.meta.currency ? finance.meta.currency : '';
        renderBankChart(segKey, bank, currency);
        if(window.StateManager) window.StateManager.queuePersist();
        return;
      }

      if(target.dataset && target.dataset.financeAction === 'po-price-sku'){
        const segKey = target.dataset.seg || 'total';
        const finance = window.FINANCE_DATA || {};
        const po = getPo(finance);
        const list = buildPriceTrendList(po);
        const selected = list.find(x=>String(x.idx) === String(target.value));
        const currency = finance && finance.meta && finance.meta.currency ? finance.meta.currency : '';
        renderPoPriceChart(segKey, selected ? selected.item : null, currency);
        if(window.StateManager) window.StateManager.queuePersist();
      }
    });
  }

  function renderNotes(segKey, meta){
    const notesEl = document.getElementById(segKey + '_finance_notes');
    if(!notesEl) return;
    const notes = meta && Array.isArray(meta.notes) ? meta.notes.filter(Boolean) : [];
    if(notes.length){
      notesEl.classList.add('show');
      notesEl.textContent = notes.join('；');
    }else{
      notesEl.classList.remove('show');
      notesEl.textContent = '';
    }
  }

  window.renderFinance = function(segKey){
    bindFinanceEventsOnce();
    const finance = window.FINANCE_DATA || null;
    const err = window.FINANCE_ERROR || null;
    const loading = window.FINANCE_LOADING || false;

    const emptyEl = document.getElementById(segKey + '_finance_empty');
    const contentEl = document.getElementById(segKey + '_finance_content');
    const errEl = document.getElementById(segKey + '_finance_error');
    const errMsg = document.getElementById(segKey + '_finance_error_msg');

    if(errEl){
      const showErr = !!err && !loading;
      errEl.classList.toggle('hidden', !showErr);
      if(errMsg) errMsg.textContent = err && err.message ? err.message : '财务数据加载失败';
    }

    const hasFinance = !!finance && !err;
    if(emptyEl) emptyEl.classList.toggle('show', !hasFinance && !err);
    if(contentEl) contentEl.style.display = hasFinance ? '' : 'none';
    if(!hasFinance) return;

    const meta = finance.meta || {};
    const currency = meta.currency ? String(meta.currency) : '';
    setText(segKey + '_finance_period', formatPeriod(meta));
    setText(segKey + '_finance_currency', currency || '—');
    setText(segKey + '_finance_version', getFinanceVersion(finance));
    renderNotes(segKey, meta);

    const arSeg = getSegAr(finance, segKey);
    const ap = getAp(finance);
    const apSeg = getSegAp(finance, segKey);
    const po = getPo(finance);
    const inventory = getInventory(finance);
    const bank = getBank(finance);
    const wc = getWc(finance);
    const bp = getBp(finance);

    updateBpButton(segKey, bp);

    const arKpi = arSeg && arSeg.kpi ? arSeg.kpi : {};
    const apKpi = ap && ap.kpi ? ap.kpi : {};
    const bankKpi = bank && bank.kpi ? bank.kpi : {};

    renderKpiCards(segKey + '_finance_kpis', [
      { label:'期末应收净额', value: fmtWanSafe(arKpi.ending_net_ar) },
      { label:'期末销售应收余额', value: fmtWanSafe(arKpi.ending_sales_ar) },
      { label:'期末应付净额', value: fmtWanSafe(apKpi.ending_net_ap) },
      { label:'期间净现金流', value: fmtWanSafe(bankKpi.period_net_cash) }
    ]);

    const arTrend = arSeg && arSeg.trend ? arSeg.trend : {};
    const apTrend = ap && ap.trend ? ap.trend : {};
    const arMonths = Array.isArray(arTrend.months) ? arTrend.months : [];
    const apMonths = Array.isArray(apTrend.months) ? apTrend.months : [];

    renderDualChart(segKey + '_finance_ar_chart', arMonths, [
      { name:'开票', type:'bar', data: alignSeries(arMonths, arTrend.sales_invoiced) },
      { name:'回款', type:'line', data: alignSeries(arMonths, arTrend.cash_receipts), smooth:true }
    ], currency ? `金额（${currency}）` : '金额（元）');

    renderDualChart(segKey + '_finance_ap_chart', apMonths, [
      { name:'采购发票', type:'bar', data: alignSeries(apMonths, apTrend.purchases_invoiced) },
      { name:'现金付款', type:'line', data: alignSeries(apMonths, apTrend.cash_payments), smooth:true }
    ], currency ? `金额（${currency}）` : '金额（元）');

    renderTopCustomers(segKey, arSeg);
    renderTopOtherAr(segKey, arSeg);
    renderTopSuppliers(segKey, apSeg);
    renderTopOtherAp(segKey, apSeg);

    renderKpiCards(segKey + '_finance_bank_kpis', [
      { label:'期间现金流入', value: fmtWanSafe(bankKpi.period_cash_in) },
      { label:'期间现金流出', value: fmtWanSafe(bankKpi.period_cash_out) },
      { label:'期间净现金流', value: fmtWanSafe(bankKpi.period_net_cash) }
    ]);
    renderBankChart(segKey, bank, currency);
    renderBankByType(segKey, bank);

    const recon = bank && bank.recon ? bank.recon : {};
    const recReceipts = buildReconCard(recon.diff_receipts, '收款');
    const recPayments = buildReconCard(recon.diff_payments, '付款');
    renderMiniCard(segKey + '_finance_bank_recon_receipts', '收款对账差异', recReceipts);
    renderMiniCard(segKey + '_finance_bank_recon_payments', '付款对账差异', recPayments);

    const invKpi = inventory && inventory.kpi ? inventory.kpi : {};
    renderKpiCards(segKey + '_finance_inventory_kpis', [
      { label:'期末库存', value: fmtWanSafe(invKpi.inventory_end) },
      { label:'日均库存', value: fmtWanSafe(invKpi.inventory_avg) },
      { label:'存货周转天数(天)', value: fmtDays(invKpi.dio_days_est) },
      { label:'期间销售成本', value: fmtWanSafe(invKpi.period_cogs) }
    ]);
    renderInventoryChart(segKey, inventory, currency);

    const wcKpi = wc && wc.kpi ? wc.kpi : {};
    renderKpiCards(segKey + '_finance_wc_kpis', [
      { label:'应收周转天数(天)', value: fmtDays(wcKpi.dso_days_est) },
      { label:'应付周转天数(天)', value: fmtDays(wcKpi.dpo_days_est) },
      { label:'存货周转天数(天)', value: fmtDays(wcKpi.dio_days_est) },
      { label:'现金转换周期(天)', value: fmtDays(wcKpi.ccc_days_est) },
      { label:'贸易营运资本', value: fmtWanSafe(wcKpi.trade_working_capital) }
    ]);

    const wcWarnEl = document.getElementById(segKey + '_finance_wc_warn');
    const otherAp = toNumber(apKpi.ending_other_ap);
    const purchaseAp = toNumber(apKpi.ending_purchase_ap);
    const warn = otherAp !== null && purchaseAp !== null && purchaseAp > 0 && otherAp > purchaseAp * 2;
    if(wcWarnEl){
      if(warn){
        wcWarnEl.textContent = '可能受其他应付影响，需往来重分类';
        wcWarnEl.classList.add('show');
      }else{
        wcWarnEl.textContent = '';
        wcWarnEl.classList.remove('show');
      }
    }

    const poKpi = po && po.kpi ? po.kpi : {};
    renderKpiCards(segKey + '_finance_po_kpis', [
      { label:'期间入库金额', value: fmtWanSafe(poKpi.period_inbound_amount) },
      { label:'第一名供应商占比', value: fmtPctSafe(poKpi.top1_supplier_ratio) },
      { label:'第二名供应商占比', value: fmtPctSafe(poKpi.top2_supplier_ratio) }
    ]);

    renderPoInboundChart(segKey, po, currency);

    const priceSelect = document.getElementById(segKey + '_finance_po_price_sku');
    const priceList = buildPriceTrendList(po);
    const selected = syncPriceSelect(priceSelect, priceList);
    renderPoPriceChart(segKey, selected.item, currency);

    renderPoTopSuppliers(segKey, po);
    renderPoPriceTable(segKey, priceList.map(x=>x.item));
  };
})();
