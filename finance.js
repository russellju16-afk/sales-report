(function(){
  let FINANCE_EVENTS_BOUND = false;

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

  function formatPeriod(meta){
    const start = meta && meta.period_start ? String(meta.period_start) : '';
    const end = meta && meta.period_end ? String(meta.period_end) : '';
    if(start && end) return start + ' 至 ' + end;
    return start || end || '—';
  }

  function getSegAr(finance, segKey){
    const ar = finance && finance.ar ? finance.ar : {};
    const segments = ar.segments || {};
    return segments[segKey] || segments.total || {};
  }

  function getAp(finance){
    return finance && finance.ap ? finance.ap : {};
  }

  function getCashGap(finance){
    return finance && finance.cash_gap ? finance.cash_gap : {};
  }

  function renderKpiCards(containerId, items){
    const el = document.getElementById(containerId);
    if(!el) return;
    el.innerHTML = items.map(item=>
      `<div class="card finance-kpi"><div class="kpi-name">${item.label}</div><div class="kpi-val">${item.value}</div></div>`
    ).join('');
  }

  function getMonthNumber(val){
    if(!val) return null;
    const parts = String(val).split('-');
    const mm = parts.length >= 2 ? parts[1] : parts[0];
    const n = parseInt(mm, 10);
    return isFinite(n) ? n : null;
  }

  function calcAugDecCashGap(cashGap){
    const months = Array.isArray(cashGap && cashGap.months) ? cashGap.months : [];
    const net = Array.isArray(cashGap && cashGap.net_cash_gap) ? cashGap.net_cash_gap : [];
    let sum = 0;
    let has = false;
    months.forEach((m, i)=>{
      const mo = getMonthNumber(m);
      if(mo === null || mo < 8 || mo > 12) return;
      const v = toNumber(net[i]);
      if(v === null) return;
      sum += v;
      has = true;
    });
    if(has) return sum;

    const cum = Array.isArray(cashGap && cashGap.cum_net_cash_gap) ? cashGap.cum_net_cash_gap : [];
    let lastAugDec = null;
    let lastBefore = null;
    months.forEach((m, i)=>{
      const mo = getMonthNumber(m);
      if(mo === null) return;
      const v = toNumber(cum[i]);
      if(v === null) return;
      if(mo >= 8 && mo <= 12) lastAugDec = v;
      if(mo < 8) lastBefore = v;
    });
    if(lastAugDec !== null){
      return (lastBefore !== null) ? (lastAugDec - lastBefore) : lastAugDec;
    }
    return null;
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

  function renderCashGapChart(segKey, cashGap, currency){
    if(!window.ChartManager) return;
    const id = segKey + '_finance_cash_gap_chart';
    const months = Array.isArray(cashGap && cashGap.months) ? cashGap.months : [];
    const toggle = document.getElementById(segKey + '_finance_cash_gap_cum');
    const showCum = !!(toggle && toggle.checked);
    const dataArr = showCum ? (cashGap && cashGap.cum_net_cash_gap) : (cashGap && cashGap.net_cash_gap);
    const seriesData = alignSeries(months, dataArr);
    if(!months.length || !hasSeriesData(seriesData)){
      ChartManager.setEmpty(id, '暂无数据');
      return;
    }

    const name = showCum ? '累计净现金差' : '净现金差';
    const series = showCum
      ? [{ name, type:'line', data: seriesData, smooth:true }]
      : [{ name, type:'bar', data: seriesData, barMaxWidth:36 }];

    ChartManager.setOption(id, {
      tooltip:{
        trigger:'axis',
        axisPointer:{type: showCum ? 'line' : 'shadow'},
        formatter:(params)=>{
          const p = params && params[0] ? params[0] : null;
          if(!p) return '';
          return `${p.name}<br/>${p.marker}${p.seriesName}：${fmtNumSafe(p.data)}`;
        }
      },
      grid:{left:50,right:20,top:50,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name: currency ? `金额（${currency}）` : '金额（元）'},
      series: series
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
    renderTable(segKey + '_finance_ar_table', rows, [
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
    renderTable(segKey + '_finance_ap_table', rows, [
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
      const toggle = e.target && e.target.matches ? e.target.matches('.finance-cash-toggle') : false;
      if(!toggle) return;
      const segKey = e.target.dataset.seg || 'total';
      const finance = window.FINANCE_DATA || {};
      const cashGap = getCashGap(finance);
      const currency = finance && finance.meta && finance.meta.currency ? finance.meta.currency : '';
      renderCashGapChart(segKey, cashGap, currency);
    });
  }

  window.renderFinance = function(segKey){
    bindFinanceEventsOnce();
    const finance = window.FINANCE_DATA || null;
    const emptyEl = document.getElementById(segKey + '_finance_empty');
    const contentEl = document.getElementById(segKey + '_finance_content');
    const hasFinance = !!finance;

    if(emptyEl) emptyEl.classList.toggle('show', !hasFinance);
    if(contentEl) contentEl.style.display = hasFinance ? '' : 'none';
    if(!hasFinance) return;

    const meta = finance.meta || {};
    const currency = meta.currency ? String(meta.currency) : '';
    setText(segKey + '_finance_period', formatPeriod(meta));
    setText(segKey + '_finance_currency', currency || '—');

    const arSeg = getSegAr(finance, segKey);
    const ap = getAp(finance);
    const cashGap = getCashGap(finance);
    const arKpi = arSeg && arSeg.kpi ? arSeg.kpi : {};
    const apKpi = ap && ap.kpi ? ap.kpi : {};

    renderKpiCards(segKey + '_finance_kpis', [
      { label:'期末应收净额', value: fmtWanSafe(arKpi.ending_net_ar) },
      { label:'期末销售应收余额', value: fmtWanSafe(arKpi.ending_sales_ar) },
      { label:'期末应付净额', value: fmtWanSafe(apKpi.ending_net_ap) },
      { label:'8-12 月累计净现金差', value: fmtWanSafe(calcAugDecCashGap(cashGap)) }
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

    renderCashGapChart(segKey, cashGap, currency);
    renderTopCustomers(segKey, arSeg);
    renderTopSuppliers(segKey, ap);
  };
})();
