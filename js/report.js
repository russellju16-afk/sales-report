(function(){
  'use strict';

  const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

  const ROW_IDX = {
    date:0,
    order:1,
    cust:2,
    cls:3,
    name:4,
    spec:5,
    prod:6,
    cat:7,
    qty:8,
    sales:9,
    cost:10,
    fee:11,
    gp:12,
    gpAdj:13,
    unitPrice:14
  };

  const THRESHOLDS = {
    dso_yellow:120,
    dso_red:180,
    dpo_low:60,
    dpo_high:180,
    ccc_high:120,
    ar_top1_red:0.4,
    ar_top10_yellow:0.8,
    ap_top1_red:0.4,
    no_invoice_ratio_red:0.1,
    other_ratio_yellow:0.2,
    other_ratio_red:0.4,
    dio_high:90,
    inventory_jump_ratio:0.2,
    sales_mom_drop_yellow:0.1,
    sales_mom_drop_red:0.2,
    gp_mom_drop_yellow:0.1,
    gp_mom_drop_red:0.2,
    gm_drop_pct_yellow:1.5,
    gm_drop_pct_red:3,
    forecast_top_n:20,
    forecast_ar_weights:{ amount:0.4, aging:0.3, concentration:0.2, sensitivity:0.1 },
    forecast_ar_collect_ratio:{
      '90+':0.2,
      '61-90':0.35,
      '31-60':0.5,
      '1-30':0.7,
      '未到期':0.6
    },
    forecast_ar_bucket_days:{
      '90+':3,
      '61-90':7,
      '31-60':14,
      '1-30':14,
      '未到期':14
    },
    forecast_ap_deferral_ratio:0.5,
    forecast_ap_deferral_days_top:7,
    forecast_ap_deferral_days_normal:14,
    forecast_po_reducible_ratio:0.3,
    forecast_po_reducible_ratio_s3:0.5,
    forecast_gap_threshold:500000,
    forecast_action_coverage_threshold:0.8,
    forecast_s1_gap_increase_ratio:0.3,
    forecast_scenario_impact:{
      ar:{ base:1, s1:0.7, s2:0.85, s3:0.75 },
      ap:{ base:1, s1:1, s2:1, s3:1 },
      po:{ base:1, s1:1, s2:1.05, s3:1.1 }
    }
  };

  const ACTION_DAYS = {
    quick:7,
    mid:14,
    long:30
  };
  const TUNER_STORAGE_KEY = 'forecast-tuner-params-v1';
  const TUNER_SCHEMA_VERSION = 1;
  const DEFAULT_TUNER_PARAMS = {
    version:TUNER_SCHEMA_VERSION,
    ar:{
      collect_ratio_not_due:0.25,
      collect_ratio_1_30:0.45,
      collect_ratio_31_60:0.3,
      collect_ratio_61_90:0.2,
      collect_ratio_90_plus:0.1,
      delay_share_7d:0.15,
      delay_share_14d:0.05,
      delay_apply_to_bucket:'overdue_only'
    },
    ap:{
      deferral_ratio:0.3,
      deferral_days_top_vendor:7,
      deferral_days_other:12,
      top_vendor_threshold_ratio:0.25
    },
    po:{
      reducible_ratio_base:0.15,
      reducible_ratio_S3:0.25,
      apply_scope:'all'
    },
    threshold:{
      gap_amount_warn_wan:120,
      min_balance_warn_wan:60
    }
  };
  const SEG_LABELS = {
    total:'全部',
    store:'门店',
    nonstore:'非门店'
  };

  function toNumber(val){
    if(val === null || val === undefined || val === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function fmtText(val){
    if(val === null || val === undefined) return '—';
    const s = String(val).trim();
    return s ? s : '—';
  }

  function fmtWan(val){
    const n = toNumber(val);
    if(n === null) return '—';
    const out = n / 10000;
    return out.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' 万';
  }

  function fmtYi(val){
    const n = toNumber(val);
    if(n === null) return '—';
    return (n / 1e8).toFixed(3) + ' 亿';
  }

  function fmtPct(val){
    const n = toNumber(val);
    if(n === null) return '—';
    return n.toFixed(2) + '%';
  }

  function fmtRatio(val){
    const n = toNumber(val);
    if(n === null) return '—';
    return (n * 100).toFixed(2) + '%';
  }

  function fmtDays(val){
    const n = toNumber(val);
    if(n === null) return '—';
    const v = Math.round(n * 10) / 10;
    const digits = v % 1 ? 1 : 0;
    return v.toLocaleString('en-US', { minimumFractionDigits:digits, maximumFractionDigits:1 });
  }

  function fmtSignedWan(val){
    const n = toNumber(val);
    if(n === null) return '—';
    const sign = n > 0 ? '+' : '';
    return sign + (n / 10000).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' 万';
  }

  function parseJsonWithNaN(text){
    if(text.indexOf('NaN') === -1) return JSON.parse(text);
    let out = '';
    let inStr = false;
    let escape = false;
    for(let i=0;i<text.length;i++){
      const ch = text[i];
      if(inStr){
        out += ch;
        if(escape){
          escape = false;
        }else if(ch === '\\'){
          escape = true;
        }else if(ch === '"'){
          inStr = false;
        }
        continue;
      }
      if(ch === '"'){
        inStr = true;
        out += ch;
        continue;
      }
      if(ch === 'N' && text.slice(i, i + 3) === 'NaN'){
        out += 'null';
        i += 2;
        continue;
      }
      out += ch;
    }
    return JSON.parse(out);
  }

  function getDataUrl(){
    const base = './data/latest.json';
    const joiner = base.includes('?') ? '&' : '?';
    return base + joiner + 'v=' + Date.now();
  }

  function getFinanceUrl(){
    const base = './data/finance_latest.json';
    const joiner = base.includes('?') ? '&' : '?';
    return base + joiner + 'v=' + Date.now();
  }

  function getForecastUrl(){
    const base = './data/forecast_latest.json';
    const joiner = base.includes('?') ? '&' : '?';
    return base + joiner + 'v=' + Date.now();
  }

  function getForecastUrl(){
    const base = './data/forecast_latest.json';
    const joiner = base.includes('?') ? '&' : '?';
    return base + joiner + 'v=' + Date.now();
  }

  function setLoadingState(show, msg){
    const el = document.getElementById('loading_state');
    if(!el) return;
    el.classList.toggle('hidden', !show);
    if(msg){
      const msgEl = el.querySelector('.state-msg');
      if(msgEl) msgEl.textContent = msg;
    }
  }

  function setErrorState(show, msg){
    const el = document.getElementById('error_state');
    if(!el) return;
    el.classList.toggle('hidden', !show);
    const msgEl = document.getElementById('error_message');
    if(msgEl) msgEl.textContent = msg || '请检查网络或数据文件路径。';
  }

  function setDebugPanelVisible(show){
    const panel = document.getElementById('debug_panel');
    if(!panel) return;
    panel.classList.toggle('hidden', !show);
  }

  function updateDebugPanel(info){
    if(!DEBUG) return;
    setDebugPanelVisible(true);
    const loadEl = document.getElementById('debug_load_time');
    const dataEl = document.getElementById('debug_data_status');
    const finEl = document.getElementById('debug_finance_status');
    const forecastEl = document.getElementById('debug_forecast_status');
    const listEl = document.getElementById('debug_missing_list');
    if(loadEl) loadEl.textContent = `加载耗时：${info && info.loadMs ? info.loadMs.toFixed(0) : '—'} 毫秒`;
    if(dataEl) dataEl.textContent = `经营数据：${info && info.dataOk ? '成功' : '失败'}`;
    if(finEl) finEl.textContent = `财务数据：${info && info.financeOk ? '成功' : '失败'}`;
    if(forecastEl) forecastEl.textContent = `预测数据：${info && info.forecastOk ? '成功' : '失败'}`;
    if(listEl){
      listEl.innerHTML = '';
      const items = (info && info.missingFields) ? info.missingFields : [];
      if(!items.length){
        const li = document.createElement('li');
        li.textContent = '未发现关键字段缺失';
        listEl.appendChild(li);
      }else{
        items.forEach(item=>{
          const li = document.createElement('li');
          li.textContent = item;
          listEl.appendChild(li);
        });
      }
    }
  }

  function getPath(obj, path){
    const parts = String(path).split('.');
    let cur = obj;
    for(let i=0;i<parts.length;i++){
      if(!cur || typeof cur !== 'object' || !(parts[i] in cur)) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function setPath(obj, path, value){
    const parts = String(path).split('.');
    let cur = obj;
    for(let i=0;i<parts.length;i++){
      const key = parts[i];
      if(i === parts.length - 1){
        cur[key] = value;
        return;
      }
      if(!cur[key] || typeof cur[key] !== 'object'){
        cur[key] = {};
      }
      cur = cur[key];
    }
  }

  function deepClone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  function clampNumber(val, min, max, fallback){
    const n = toNumber(val);
    if(n === null) return fallback;
    if(min !== null && n < min) return min;
    if(max !== null && n > max) return max;
    return n;
  }

  function debounce(fn, wait){
    let t = null;
    return function(){
      const ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(()=>fn.apply(ctx, args), wait);
    };
  }

  function base64UrlEncode(text){
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    let binary = '';
    bytes.forEach(b=>{ binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlDecode(text){
    const base = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base + '==='.slice((base.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++){
      bytes[i] = binary.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  }

  function collectMissingFields(dataRaw, financeRaw, forecastRaw){
    const missing = [];
    const checks = [
      ['经营数据:data.total.rows', 'data.total.rows'],
      ['经营数据:data.total.months', 'data.total.months'],
      ['财务数据:meta.period_end', 'meta.period_end'],
      ['财务数据:meta.currency', 'meta.currency'],
      ['财务数据:bank.kpi.period_net_cash', 'bank.kpi.period_net_cash'],
      ['财务数据:bank.trend.cash_in', 'bank.trend.cash_in'],
      ['财务数据:bank.trend.cash_out', 'bank.trend.cash_out'],
      ['财务数据:bank.by_type', 'bank.by_type'],
      ['财务数据:ar.segments.total.kpi.ending_net_ar', 'ar.segments.total.kpi.ending_net_ar'],
      ['财务数据:ar.segments.total.trend.cash_receipts', 'ar.segments.total.trend.cash_receipts'],
      ['财务数据:ap.kpi.ending_net_ap', 'ap.kpi.ending_net_ap'],
      ['财务数据:ap.trend.cash_payments', 'ap.trend.cash_payments'],
      ['财务数据:inventory.kpi.inventory_end', 'inventory.kpi.inventory_end'],
      ['财务数据:po.top_suppliers', 'po.top_suppliers'],
      ['预测数据:forecast.recommendations.summary_kpi.base_gap_amount', 'forecast.recommendations.summary_kpi.base_gap_amount'],
      ['预测数据:forecast.recommendations.ar_collection', 'forecast.recommendations.ar_collection'],
      ['预测数据:forecast.recommendations.ap_deferral', 'forecast.recommendations.ap_deferral'],
      ['预测数据:forecast.recommendations.po_reduction', 'forecast.recommendations.po_reduction'],
      ['预测数据:forecast.ar_plan_rows', 'forecast.ar_plan_rows'],
      ['预测数据:forecast.ap_plan_rows', 'forecast.ap_plan_rows'],
      ['预测数据:forecast.po_plan_rows', 'forecast.po_plan_rows']
    ];
    const dataRoot = dataRaw && dataRaw.data ? dataRaw.data : (dataRaw || {});
    const financeRoot = financeRaw && financeRaw.data ? financeRaw.data : (financeRaw || {});
    const forecastRoot = forecastRaw && forecastRaw.data ? forecastRaw.data : (forecastRaw || {});
    checks.forEach(([label, path])=>{
      let source = financeRoot;
      let rel = path;
      if(path.startsWith('data.')){
        source = dataRoot;
        rel = path.replace(/^data\./, '');
      }else if(path.startsWith('forecast.')){
        source = forecastRoot;
        rel = path.replace(/^forecast\./, '');
      }else{
        rel = path.replace(/^data\./, '');
      }
      const val = getPath(source, rel);
      if(val === undefined || val === null || (Array.isArray(val) && !val.length)){
        missing.push(label);
      }
    });
    return missing;
  }

  function normalizeData(raw){
    const root = raw && raw.data ? raw.data : (raw || {});
    const segments = {};
    ['total','store','nonstore'].forEach((key)=>{
      const seg = root[key] || {};
      const rows = seg.rows || seg.raw_rows || [];
      let months = seg.months || [];
      if(!months.length && rows.length){
        const mset = new Set(rows.map(r=>String(r[0]||'').slice(0,7)).filter(Boolean));
        months = [...mset].sort();
      }
      segments[key] = { rows, months };
    });
    return {
      segments,
      generatedAt: raw && raw.generatedAt ? raw.generatedAt : (root.generatedAt || null),
      bp: raw.bp || root.bp || {}
    };
  }

  function normalizeFinanceData(raw){
    const root = raw && raw.data ? raw.data : (raw || {});
    const meta = (root.meta && typeof root.meta === 'object') ? root.meta : {};
    if(!meta.generated_at){
      meta.generated_at = root.generated_at || root.generatedAt || root.as_of || root.asOf || '';
    }
    return {
      meta: meta,
      ar: root.ar || {},
      ap: root.ap || {},
      po: root.po || {},
      inventory: root.inventory || {},
      bank: root.bank || {},
      wc: root.wc || {}
    };
  }

  function normalizeForecastData(raw){
    const root = raw && raw.data ? raw.data : (raw || {});
    const meta = (root.meta && typeof root.meta === 'object') ? root.meta : {};
    if(!meta.generated_at){
      meta.generated_at = root.generated_at || root.generatedAt || root.as_of || root.asOf || '';
    }
    return {
      meta: meta,
      forecast: root.forecast || {}
    };
  }

  function deriveDateRange(rows){
    const dates = rows.map(r=>r && r[ROW_IDX.date]).filter(Boolean).sort();
    if(!dates.length) return { start:'—', end:'—', text:'—' };
    return { start:dates[0], end:dates[dates.length - 1], text: dates[0] + ' 至 ' + dates[dates.length - 1] };
  }

  function parseDate(str){
    if(!str) return null;
    const parts = String(str).split('-').map(v=>Number(v));
    if(parts.length < 3 || parts.some(v=>!Number.isFinite(v))) return null;
    return new Date(parts[0], parts[1]-1, parts[2]);
  }

  function formatDate(d){
    if(!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function addDays(baseDateStr, days){
    const base = parseDate(baseDateStr);
    if(!base) return '';
    const next = new Date(base.getTime());
    next.setDate(next.getDate() + days);
    return formatDate(next);
  }

  function sumRows(rows, idx){
    return rows.reduce((sum, r)=>sum + (Number(r && r[idx]) || 0), 0);
  }

  function uniqueCount(rows, idx){
    const set = new Set();
    rows.forEach(r=>{
      const key = r && r[idx] ? String(r[idx]).trim() : '';
      if(key) set.add(key);
    });
    return set.size;
  }

  function groupBy(rows, idx){
    const map = new Map();
    rows.forEach(r=>{
      if(!r) return;
      const keyRaw = r[idx];
      const key = keyRaw === null || keyRaw === undefined ? '' : String(keyRaw).trim();
      if(!key) return;
      if(!map.has(key)) map.set(key, { key, sales:0, gp:0, gpAdj:0 });
      const obj = map.get(key);
      obj.sales += Number(r[ROW_IDX.sales]) || 0;
      obj.gp += Number(r[ROW_IDX.gp]) || 0;
      obj.gpAdj += Number(r[ROW_IDX.gpAdj]) || 0;
    });
    const arr = [...map.values()];
    arr.forEach(o=>{
      o.gm = o.sales ? o.gp / o.sales * 100 : null;
      o.gmAdj = o.sales ? o.gpAdj / o.sales * 100 : null;
    });
    arr.sort((a,b)=>(b.sales||0)-(a.sales||0));
    return arr;
  }

  function buildMonthly(rows){
    const map = new Map();
    rows.forEach(r=>{
      const d = r && r[ROW_IDX.date] ? String(r[ROW_IDX.date]) : '';
      if(!d) return;
      const m = d.slice(0,7);
      if(!map.has(m)) map.set(m, { month:m, sales:0, gpAdj:0, gp:0 });
      const obj = map.get(m);
      obj.sales += Number(r[ROW_IDX.sales]) || 0;
      obj.gpAdj += Number(r[ROW_IDX.gpAdj]) || 0;
      obj.gp += Number(r[ROW_IDX.gp]) || 0;
    });
    const months = [...map.keys()].sort();
    return {
      months,
      sales: months.map(m=>map.get(m).sales),
      gpAdj: months.map(m=>map.get(m).gpAdj),
      gp: months.map(m=>map.get(m).gp)
    };
  }

  function buildMonthlyUniqueCounts(rows, idx, months){
    const map = new Map();
    (rows || []).forEach(r=>{
      if(!r) return;
      const d = r[ROW_IDX.date];
      if(!d) return;
      const m = String(d).slice(0,7);
      if(!map.has(m)) map.set(m, new Set());
      const key = r[idx];
      if(key !== null && key !== undefined && String(key).trim() !== ''){
        map.get(m).add(String(key).trim());
      }
    });
    return (months || []).map(m=> (map.get(m) ? map.get(m).size : 0));
  }

  function buildKpiCard(item, onDetail){
    const card = document.createElement('div');
    card.className = 'card';
    const clickable = !!(onDetail && item && item.detail);
    if(clickable){
      card.classList.add('kpi-card-clickable');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `查看${item.label}详情`);
      card.addEventListener('click', ()=>onDetail(item));
      card.addEventListener('keydown', (event)=>{
        if(event.key === 'Enter' || event.key === ' '){
          event.preventDefault();
          onDetail(item);
        }
      });
    }
    const head = document.createElement('div');
    head.className = 'kpi-head';
    const name = document.createElement('div');
    name.className = 'kpi-name';
    name.textContent = item.label;
    head.appendChild(name);
    if(clickable){
      const hint = document.createElement('span');
      hint.className = 'kpi-detail-hint';
      hint.textContent = '查看详情';
      head.appendChild(hint);
    }
    const val = document.createElement('div');
    val.className = 'kpi-val';
    val.textContent = item.value;
    if(item.sub){
      const span = document.createElement('span');
      span.className = 'kpi-sub';
      span.textContent = item.sub;
      val.appendChild(span);
    }
    card.appendChild(head);
    card.appendChild(val);
    if(item.spark){
      const sparkEl = document.createElement('div');
      sparkEl.className = 'kpi-spark';
      sparkEl.id = item.spark.id;
      card.appendChild(sparkEl);
    }
    if(item.evidenceLink){
      const linkWrap = document.createElement('div');
      linkWrap.className = 'conclusion-link';
      linkWrap.appendChild(item.evidenceLink);
      card.appendChild(linkWrap);
    }
    return card;
  }

  function buildKpiEvidence(item, seg){
    const label = item && item.label ? item.label : '';
    const base = { seg: seg || 'total' };
    if(label.indexOf('现金') !== -1 || label.indexOf('流入') !== -1 || label.indexOf('流出') !== -1){
      return Object.assign({ tab:'finance', tableId: (seg || 'total') + '_finance_bank_txn_table' }, base);
    }
    if(label.indexOf('应收') !== -1){
      return Object.assign({ tab:'finance', tableId: (seg || 'total') + '_finance_ar_table' }, base);
    }
    if(label.indexOf('应付') !== -1){
      return Object.assign({ tab:'finance', tableId: (seg || 'total') + '_finance_ap_table' }, base);
    }
    if(label.indexOf('库存') !== -1){
      return Object.assign({ tab:'finance', tableId: (seg || 'total') + '_finance_bank_type_table' }, base);
    }
    return Object.assign({ tab:'category', tableId: (seg || 'total') + '_category_table' }, base);
  }

  function renderKpis(containerId, items, onDetail){
    const el = document.getElementById(containerId);
    if(!el) return;
    const frag = document.createDocumentFragment();
    const sparks = [];
    (items || []).forEach(item=>{
      if(item && item.spark) sparks.push(item.spark);
      frag.appendChild(buildKpiCard(item, onDetail));
    });
    el.replaceChildren(frag);
    sparks.forEach(cfg=>{
      renderSparkline(cfg.id, cfg.data || [], cfg.color, cfg.areaColor);
    });
  }

  let KPI_DETAIL_BOUND = false;
  function bindKpiDetailModal(){
    if(KPI_DETAIL_BOUND) return;
    KPI_DETAIL_BOUND = true;
    const modal = document.getElementById('kpi_detail_modal');
    const closeBtn = document.getElementById('kpi_detail_close');
    if(closeBtn){
      closeBtn.addEventListener('click', closeKpiDetail);
    }
    if(modal){
      modal.addEventListener('click', (event)=>{
        if(event.target === modal) closeKpiDetail();
      });
    }
    document.addEventListener('keydown', (event)=>{
      if(event.key === 'Escape'){
        const m = document.getElementById('kpi_detail_modal');
        if(m && m.classList.contains('show')) closeKpiDetail();
      }
    });
  }

  function closeKpiDetail(){
    const modal = document.getElementById('kpi_detail_modal');
    if(modal){
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function openKpiDetail(item){
    if(!item || !item.detail) return;
    const modal = document.getElementById('kpi_detail_modal');
    const titleEl = document.getElementById('kpi_detail_title');
    const metaEl = document.getElementById('kpi_detail_meta');
    const summaryEl = document.getElementById('kpi_detail_summary');
    const tableEl = document.getElementById('kpi_detail_table');
    const tableWrap = document.getElementById('kpi_detail_table_wrap');
    const emptyEl = document.getElementById('kpi_detail_empty');
    if(!modal || !titleEl || !summaryEl || !tableEl || !emptyEl || !tableWrap) return;

    titleEl.textContent = item.label || '指标详情';
    metaEl.textContent = item.value ? `当前值：${item.value}` : '';

    const summaryRows = [
      { label:'当前值', value:item.value || '—' }
    ];
    if(item.sub) summaryRows.push({ label:'辅助值', value:item.sub });
    if(Array.isArray(item.detail.rows)){
      item.detail.rows.forEach(row=>{
        if(row && row.label){
          summaryRows.push({ label: row.label, value: row.value || '—' });
        }
      });
    }

    summaryEl.innerHTML = '';
    summaryRows.forEach(row=>{
      const div = document.createElement('div');
      div.className = 'kpi-detail-row';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = row.label;
      const value = document.createElement('span');
      value.className = 'value';
      value.textContent = row.value;
      div.appendChild(label);
      div.appendChild(value);
      summaryEl.appendChild(div);
    });

    const series = item.detail.series;
    if(series && Array.isArray(series.months) && series.months.length){
      const thead = tableEl.tHead ? tableEl.tHead.rows[0] : null;
      if(thead && thead.cells.length > 1){
        thead.cells[1].textContent = series.label || '数值';
      }
      const tbody = tableEl.tBodies[0];
      tbody.innerHTML = '';
      series.months.forEach((month, idx)=>{
        const tr = document.createElement('tr');
        const tdMonth = document.createElement('td');
        tdMonth.textContent = month || '—';
        const tdVal = document.createElement('td');
        const raw = Array.isArray(series.values) ? series.values[idx] : null;
        const fmt = typeof series.formatter === 'function' ? series.formatter : fmtText;
        tdVal.textContent = fmt(raw);
        tr.appendChild(tdMonth);
        tr.appendChild(tdVal);
        tbody.appendChild(tr);
      });
      tableWrap.classList.remove('hidden');
      tableEl.classList.remove('hidden');
      emptyEl.classList.add('hidden');
    }else{
      tableEl.classList.add('hidden');
      tableWrap.classList.add('hidden');
      emptyEl.classList.remove('hidden');
    }

    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }

  function renderMiniKpis(containerId, items){
    const el = document.getElementById(containerId);
    if(!el) return;
    const frag = document.createDocumentFragment();
    (items || []).forEach(item=>{
      const box = document.createElement('div');
      box.className = 'report-mini-kpi';
      const name = document.createElement('div');
      name.className = 'report-mini-kpi-name';
      name.textContent = item.label;
      const val = document.createElement('div');
      val.className = 'report-mini-kpi-val';
      val.textContent = item.value;
      box.appendChild(name);
      box.appendChild(val);
      if(item.sub){
        const sub = document.createElement('div');
        sub.className = 'report-mini-kpi-sub';
        sub.textContent = item.sub;
        box.appendChild(sub);
      }
      frag.appendChild(box);
    });
    el.replaceChildren(frag);
  }

  function renderTable(tableId, rows, columns, formatters){
    const table = document.getElementById(tableId);
    if(!table || !table.tBodies || !table.tBodies[0]) return;
    const tbody = table.tBodies[0];
    tbody.innerHTML = '';
    if(!Array.isArray(rows) || rows.length === 0){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns.length;
      td.className = 'finance-empty-row';
      td.textContent = '暂无数据';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach(row=>{
      const tr = document.createElement('tr');
      columns.forEach((col, idx)=>{
        const td = document.createElement('td');
        const val = row && row[col.key] !== undefined ? row[col.key] : null;
        const fmt = formatters && typeof formatters[idx] === 'function' ? formatters[idx] : null;
        const out = fmt ? fmt(val, row) : fmtText(val);
        if(out instanceof Node){
          td.appendChild(out);
        }else{
          td.textContent = out;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function padFilterValues(values, size){
    const arr = Array.isArray(values) ? values.slice() : [];
    while(arr.length < size) arr.push('');
    return arr;
  }

  function buildDrilldownLink(opts){
    const seg = opts && opts.seg ? opts.seg : 'total';
    const tab = opts && opts.tab ? opts.tab : 'overview';
    const state = {
      v: 3,
      route: 'explorer',
      segment: seg,
      date_range: { start: '', end: '' },
      filters: opts && opts.filters ? Object.assign({}, opts.filters) : {},
      ui: {
        explorer_tabs: {},
        explorer_subtabs: {},
        explorer_header_filters: {},
        explorer_anchor: opts && opts.anchor ? opts.anchor : ''
      }
    };
    state.ui.explorer_tabs[seg] = tab;
    if(opts && opts.subtab){
      state.ui.explorer_subtabs[seg] = opts.subtab;
    }
    if(opts && opts.tableId && opts.filterFirstColValue !== undefined && opts.filterFirstColValue !== null && String(opts.filterFirstColValue).trim() !== ''){
      state.ui.explorer_header_filters[opts.tableId] = padFilterValues([String(opts.filterFirstColValue)], 6);
    }
    const url = './index.html#/explorer?state=' + encodeURIComponent(JSON.stringify(state));
    return url;
  }

  function buildEvidenceLink(opts, label){
    const a = document.createElement('a');
    const payload = Object.assign({}, opts || {});
    payload.title = label || '查看证据';
    a.href = buildDrilldownLink(opts || {});
    a.textContent = label || '查看证据';
    a.className = 'report-link evidence-link';
    a.dataset.evidence = JSON.stringify(payload);
    return a;
  }

  function guessBpAnchor(item){
    const text = [
      item && item.domain ? item.domain : '',
      item && item.title ? item.title : '',
      item && item.signal ? item.signal : '',
      item && item.evidence ? item.evidence : ''
    ].join(' ');
    if(text.indexOf('现金') !== -1 || text.indexOf('银行') !== -1) return 'bp_cashflow';
    if(text.indexOf('库存') !== -1) return 'bp_inventory';
    if(text.indexOf('应收') !== -1) return 'bp_ar';
    if(text.indexOf('应付') !== -1) return 'bp_ap';
    return 'bp_overview';
  }

  function buildBpJump(anchor){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm';
    btn.textContent = '定位BP';
    btn.dataset.bpTarget = anchor || 'bp_overview';
    return btn;
  }

  function fmtScore(val){
    const n = toNumber(val);
    if(n === null) return '—';
    return Math.round(n).toString();
  }

  function fmtRatioSafe(val){
    const n = toNumber(val);
    if(n === null) return '—';
    return (n * 100).toFixed(2) + '%';
  }

  function fmtRiskValue(val){
    const n = toNumber(val);
    if(n === null) return '—';
    if(Math.abs(n) > 1) return n.toFixed(2);
    return (n * 100).toFixed(2) + '%';
  }

  function renderRiskScores(risk){
    const totalEl = document.getElementById('risk_score_total');
    if(totalEl) totalEl.textContent = fmtScore(risk && risk.risk_score_total);
    const scoreMap = {
      unknown:'risk_score_unknown',
      internal:'risk_score_internal',
      concentration:'risk_score_concentration',
      volatility:'risk_score_volatility',
      recon:'risk_score_recon',
      financing:'risk_score_financing'
    };
    const scores = risk && risk.risk_scores ? risk.risk_scores : {};
    Object.keys(scoreMap).forEach(key=>{
      const el = document.getElementById(scoreMap[key]);
      if(el) el.textContent = fmtScore(scores[key]);
    });
  }

  function renderRiskChart(risk){
    const chartEl = document.getElementById('risk_chart');
    if(!chartEl || !window.echarts) return;
    const scores = risk && risk.risk_scores ? risk.risk_scores : {};
    const labels = ['未知项','内部往来','集中度','波动','对账差异','筹资'];
    const values = [
      toNumber(scores.unknown),
      toNumber(scores.internal),
      toNumber(scores.concentration),
      toNumber(scores.volatility),
      toNumber(scores.recon),
      toNumber(scores.financing)
    ];
    const chart = echarts.init(chartEl);
    chart.setOption({
      grid:{left:36,right:16,top:28,bottom:24},
      xAxis:{type:'value',max:100,axisLabel:{formatter:'{value}'}},
      yAxis:{type:'category',data:labels},
      series:[{type:'bar',data:values,barWidth:14,itemStyle:{color:'#148a78'}}]
    });
  }

  function renderRiskBreakdown(rows){
    const tbody = document.getElementById('risk_breakdown_body');
    if(!tbody) return;
    tbody.innerHTML = '';
    const data = Array.isArray(rows) ? rows : [];
    if(!data.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = '暂无评分明细';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    data.forEach(row=>{
      const tr = document.createElement('tr');
      const cols = [
        fmtText(row.risk_item),
        fmtText(row.formula),
        fmtText(row.threshold),
        fmtRiskValue(row.current_value),
        fmtText(row.penalty)
      ];
      cols.forEach(text=>{
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      const linkTd = document.createElement('td');
      if(row.evidence_state_link){
        linkTd.appendChild(buildEvidenceLink(row.evidence_state_link, '查看证据'));
      }else{
        linkTd.textContent = '—';
      }
      tr.appendChild(linkTd);
      tbody.appendChild(tr);
    });
  }

  function renderAnomaliesTable(anomalies, periodEnd){
    const list = Array.isArray(anomalies) ? anomalies.slice() : [];
    const typeSelect = document.getElementById('risk_anomaly_type');
    const sevSelect = document.getElementById('risk_anomaly_severity');
    const classSelect = document.getElementById('risk_anomaly_class');
    const memoInput = document.getElementById('risk_anomaly_search');
    const pagination = document.getElementById('risk_anomaly_pagination');
    const tbody = document.getElementById('risk_anomaly_body');
    const emptyEl = document.getElementById('risk_anomaly_empty');
    if(!tbody) return;

    function uniqueVals(arr, key){
      const set = new Set();
      arr.forEach(r=>{ if(r && r[key]) set.add(String(r[key])); });
      return [...set];
    }

    function setupSelect(select, values){
      if(!select) return;
      select.innerHTML = '<option value="">全部</option>' + values.map(v=>`<option value="${v}">${v}</option>`).join('');
    }

    setupSelect(typeSelect, uniqueVals(list, 'anomaly_type'));
    setupSelect(sevSelect, uniqueVals(list, 'severity'));
    setupSelect(classSelect, uniqueVals(list, 'cf_class'));

    let page = 1;
    const pageSize = 50;

    function applyFilters(){
      const typeVal = typeSelect ? typeSelect.value : '';
      const sevVal = sevSelect ? sevSelect.value : '';
      const classVal = classSelect ? classSelect.value : '';
      const memoVal = memoInput ? memoInput.value.trim().toLowerCase() : '';
      let filtered = list.filter(item=>{
        if(typeVal && item.anomaly_type !== typeVal) return false;
        if(sevVal && item.severity !== sevVal) return false;
        if(classVal && item.cf_class !== classVal) return false;
        if(memoVal){
          const text = `${item.counterparty || ''} ${item.memo || ''}`.toLowerCase();
          if(!text.includes(memoVal)) return false;
        }
        return true;
      });
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if(page > totalPages) page = totalPages;
      const start = (page - 1) * pageSize;
      const pageRows = filtered.slice(start, start + pageSize);

      tbody.innerHTML = '';
      if(!pageRows.length){
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 9;
        td.textContent = '暂无异常';
        tr.appendChild(td);
        tbody.appendChild(tr);
        if(emptyEl) emptyEl.textContent = list.length ? '筛选结果为空' : '未发现异常（如需产生异常请补齐银行明细）。';
      }else if(emptyEl){
        emptyEl.textContent = '';
      }

      pageRows.forEach(item=>{
        const tr = document.createElement('tr');
        const cells = [
          item.anomaly_type,
          item.severity,
          item.date,
          item.counterparty || '—',
          item.memo || '—',
          item.amount !== null && item.amount !== undefined ? fmtWan(item.amount) : '—',
          item.reason || '—',
          item.suggested_action || '—'
        ];
        cells.forEach(text=>{
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        });
        const linkTd = document.createElement('td');
        if(item.evidence_state_link){
          linkTd.appendChild(buildEvidenceLink(item.evidence_state_link, '查看证据'));
        }else{
          linkTd.textContent = '—';
        }
        tr.appendChild(linkTd);
        tr.addEventListener('click', (e)=>{
          if(e.target && e.target.tagName === 'A') return;
          openAnomalyModal(item);
        });
        tbody.appendChild(tr);
      });

      if(pagination){
        pagination.textContent = `第 ${page}/${totalPages} 页，共 ${filtered.length} 条`;
      }
      return filtered;
    }

    const handle = ()=>{ page = 1; applyFilters(); };
    if(typeSelect) typeSelect.onchange = handle;
    if(sevSelect) sevSelect.onchange = handle;
    if(classSelect) classSelect.onchange = handle;
    if(memoInput) memoInput.oninput = handle;

    const prevBtn = document.getElementById('risk_anomaly_prev');
    const nextBtn = document.getElementById('risk_anomaly_next');
    if(prevBtn) prevBtn.onclick = ()=>{ page = Math.max(1, page - 1); applyFilters(); };
    if(nextBtn) nextBtn.onclick = ()=>{ page += 1; applyFilters(); };

    const filtered = applyFilters();
    const exportBtn = document.getElementById('export_anomalies_btn');
    if(exportBtn){
      exportBtn.onclick = ()=>{
        const rows = filtered.map(r=>({
          '类型':r.anomaly_type,
          '严重度':r.severity,
          '日期':r.date,
          '对方':r.counterparty,
          '摘要':r.memo,
          '金额':r.amount,
          '原因':r.reason,
          '建议动作':r.suggested_action,
          '证据链接':r.evidence_state_link ? buildDrilldownLink(r.evidence_state_link) : ''
        }));
        const suffix = safeDateLabel(periodEnd) ? ('_' + safeDateLabel(periodEnd)) : '';
        const csv = buildCsv(rows, ['类型','严重度','日期','对方','摘要','金额','原因','建议动作','证据链接']);
        downloadCsv('异常清单' + suffix + '.csv', csv);
      };
    }
  }

  function openAnomalyModal(item){
    const modal = document.getElementById('anomaly_modal');
    if(!modal) return;
    const title = document.getElementById('anomaly_modal_title');
    const meta = document.getElementById('anomaly_modal_meta');
    const body = document.getElementById('anomaly_modal_body');
    if(title) title.textContent = item.anomaly_type || '异常明细';
    if(meta) meta.textContent = `${item.severity || '—'}｜${item.date || '—'}`;
    if(body){
      body.innerHTML = '';
      const rows = [
        ['对方', item.counterparty || '—'],
        ['金额', item.amount !== null && item.amount !== undefined ? fmtWan(item.amount) : '—'],
        ['摘要', item.memo || '—'],
        ['原因', item.reason || '—'],
        ['建议动作', item.suggested_action || '—']
      ];
      rows.forEach(([label, value])=>{
        const div = document.createElement('div');
        div.className = 'kpi-detail-row';
        const l = document.createElement('div');
        l.className = 'label';
        l.textContent = label;
        const v = document.createElement('div');
        v.className = 'value';
        v.textContent = value;
        div.appendChild(l);
        div.appendChild(v);
        body.appendChild(div);
      });
    }
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeAnomalyModal(){
    const modal = document.getElementById('anomaly_modal');
    if(!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }

  window.closeAnomalyModal = closeAnomalyModal;

  function renderRiskCenter(bank, periodEnd, forecastRisk){
    const risk = bank && bank.risk ? bank.risk : {};
    renderRiskScores(risk);
    renderRiskChart(risk);
    renderForecastRiskScores(forecastRisk);
    const baseRows = risk.risk_breakdown_rows || [];
    const extraRows = forecastRisk && forecastRisk.breakdown_rows ? forecastRisk.breakdown_rows : [];
    const mergedRows = baseRows.concat(extraRows);
    renderRiskBreakdown(mergedRows);
    renderAnomaliesTable(risk.anomalies || [], periodEnd);

    const exportBtn = document.getElementById('export_risk_breakdown_btn');
    if(exportBtn){
      exportBtn.onclick = ()=>{
        const rows = mergedRows.map(r=>({
          '风险项':r.risk_item,
          '公式':r.formula,
          '阈值':r.threshold,
          '当前值':r.current_value,
          '扣分':r.penalty,
          '证据链接':r.evidence_state_link ? buildDrilldownLink(r.evidence_state_link) : ''
        }));
        const suffix = safeDateLabel(periodEnd) ? ('_' + safeDateLabel(periodEnd)) : '';
        const csv = buildCsv(rows, ['风险项','公式','阈值','当前值','扣分','证据链接']);
        downloadCsv('风险扣分明细' + suffix + '.csv', csv);
      };
    }
  }

  function renderForecastRiskOverlay(baseRows, forecastRisk, periodEnd){
    if(!forecastRisk) return;
    renderForecastRiskScores(forecastRisk);
    const mergedRows = (baseRows || []).concat(forecastRisk.breakdown_rows || []);
    renderRiskBreakdown(mergedRows);
    const exportBtn = document.getElementById('export_risk_breakdown_btn');
    if(exportBtn){
      exportBtn.onclick = ()=>{
        const rows = mergedRows.map(r=>({
          '风险项':r.risk_item,
          '公式':r.formula,
          '阈值':r.threshold,
          '当前值':r.current_value,
          '扣分':r.penalty,
          '证据链接':r.evidence_state_link ? buildDrilldownLink(r.evidence_state_link) : ''
        }));
        const suffix = safeDateLabel(periodEnd) ? ('_' + safeDateLabel(periodEnd)) : '';
        const csv = buildCsv(rows, ['风险项','公式','阈值','当前值','扣分','证据链接']);
        downloadCsv('风险扣分明细' + suffix + '.csv', csv);
      };
    }
  }

  function formatActionSource(source){
    const raw = String(source || '').trim();
    if(!raw) return '—';
    if(raw.indexOf('forecast:') === 0){
      const key = raw.replace('forecast:', '');
      const map = {
        AR_collection:'预测-应收回款',
        AP_deferral:'预测-应付延付',
        PO_reduction:'预测-采购减采',
        emergency_pack:'预测-缺口应急包',
        coverage_boost:'预测-覆盖率提升',
        coverage:'预测-覆盖不足'
      };
      return map[key] || '预测';
    }
    return raw;
  }

  function formatAction(action){
    if(!action) return '—';
    return `负责人：${action.owner}；动作：${action.task}；截止日期：${action.ddl}；预期影响：${action.impact}`;
  }

  function buildOtherSuggestion(amount, net, type){
    const amt = toNumber(amount);
    const netAmt = toNumber(net);
    const ratio = (amt !== null && netAmt) ? amt / netAmt : null;
    if(amt === null) return '补齐原因分类与台账';
    if(ratio !== null && ratio > 0.3) return '占比偏高，列为专项清理对象';
    if(amt > 1000000){
      return type === 'ap' ? '余额较大，优先对账并安排支付/冲抵' : '余额较大，优先对账并制定回收/冲抵计划';
    }
    return '余额较小，纳入月度跟踪';
  }

  function addConclusion(list, actions, data){
    list.push(data);
    actions.push({
      source: data.source || '结论',
      domain: data.domain || '综合',
      signal: data.title || '',
      owner: data.action ? data.action.owner : '',
      task: data.action ? data.action.task : '',
      ddl: data.action ? data.action.ddl : '',
      impact: data.action ? data.action.impact : '',
      link: data.link || null
    });
  }

  function renderConclusions(containerId, list){
    const el = document.getElementById(containerId);
    if(!el) return;
    const frag = document.createDocumentFragment();
    if(!list.length){
      const empty = document.createElement('div');
      empty.className = 'report-empty';
      empty.textContent = '暂无结论';
      frag.appendChild(empty);
      el.replaceChildren(frag);
      return;
    }
    list.forEach(item=>{
      const card = document.createElement('div');
      card.className = 'report-conclusion';
      const title = document.createElement('div');
      title.className = 'conclusion-title';
      title.textContent = item.title;
      const evidence = document.createElement('div');
      evidence.className = 'conclusion-evidence';
      evidence.textContent = '证据：' + item.evidence;
      const action = document.createElement('div');
      action.className = 'conclusion-action';
      action.textContent = '动作：' + formatAction(item.action);
      card.appendChild(title);
      card.appendChild(evidence);
      card.appendChild(action);
      const linkWrap = document.createElement('div');
      linkWrap.className = 'conclusion-link';
      if(item.link){
        linkWrap.appendChild(item.link);
      }
      linkWrap.appendChild(buildBpJump(item.bp_anchor || guessBpAnchor(item)));
      card.appendChild(linkWrap);
      frag.appendChild(card);
    });
    el.replaceChildren(frag);
  }

  function renderWarningTable(warnings){
    const tbody = document.getElementById('warning_table_body');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!warnings.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'finance-empty-row';
      td.textContent = '暂无预警';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    warnings.forEach(w=>{
      const tr = document.createElement('tr');

      const tdLevel = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'level level-' + (w.levelClass || 'green');
      badge.textContent = w.level;
      tdLevel.appendChild(badge);
      tr.appendChild(tdLevel);

      const tdDomain = document.createElement('td');
      tdDomain.textContent = w.domain;
      tr.appendChild(tdDomain);

      const tdSignal = document.createElement('td');
      tdSignal.textContent = w.signal;
      tr.appendChild(tdSignal);

      const tdEvidence = document.createElement('td');
      tdEvidence.textContent = w.evidence;
      tr.appendChild(tdEvidence);

      const tdAction = document.createElement('td');
      tdAction.textContent = formatAction(w.action);
      tr.appendChild(tdAction);

      const tdLink = document.createElement('td');
      if(w.link) tdLink.appendChild(w.link);
      tr.appendChild(tdLink);

      const tdDiag = document.createElement('td');
      const details = document.createElement('details');
      details.className = 'report-detail';
      const summary = document.createElement('summary');
      summary.textContent = '诊断树';
      const diag = document.createElement('div');
      diag.className = 'diag-tree';
      (w.diagnosis || []).forEach(line=>{
        const div = document.createElement('div');
        div.textContent = line;
        diag.appendChild(div);
      });
      details.appendChild(summary);
      details.appendChild(diag);
      tdDiag.appendChild(details);
      tr.appendChild(tdDiag);

      tbody.appendChild(tr);
    });
  }

  function renderActionTable(actions){
    const tbody = document.getElementById('action_table_body');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!actions.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'finance-empty-row';
      td.textContent = '暂无动作';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    actions.forEach(a=>{
      const tr = document.createElement('tr');
      const fields = [
        formatActionSource(a.source),
        a.domain || '—',
        a.signal || '—',
        a.owner || '—',
        a.task || '—',
        a.ddl || '—',
        a.impact || '—'
      ];
      fields.forEach(val=>{
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      });
      const tdLink = document.createElement('td');
      if(a.link) tdLink.appendChild(a.link.cloneNode(true));
      tdLink.appendChild(buildBpJump(guessBpAnchor(a)));
      tr.appendChild(tdLink);
      tbody.appendChild(tr);
    });
  }

  function escapeCsv(val){
    if(val === null || val === undefined) return '';
    const s = String(val);
    if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  }

  function buildCsv(rows, columns){
    const head = columns.map(c=>escapeCsv(c)).join(',');
    const body = rows.map(r=>columns.map(c=>escapeCsv(r[c] || '')).join(',')).join('\n');
    return head + '\n' + body;
  }

  function downloadCsv(filename, csv){
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadJson(filename, obj){
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function safeDateLabel(val){
    const m = String(val || '').match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : '';
  }

  function copyText(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve)=>{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try{ document.execCommand('copy'); }catch(e){}
      document.body.removeChild(ta);
      resolve();
    });
  }

  function showToast(msg){
    const el = document.getElementById('toast');
    if(!el) return;
    el.textContent = msg || '';
    el.classList.add('show');
    setTimeout(()=>{ el.classList.remove('show'); }, 1200);
  }

  function waitForEcharts(timeoutMs){
    if(window.echarts) return Promise.resolve(true);
    const start = Date.now();
    return new Promise((resolve)=>{
      const tick = ()=>{
        if(window.echarts) return resolve(true);
        if(Date.now() - start > (timeoutMs || 1200)) return resolve(false);
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  function renderLineBarChart(el, months, series){
    const target = document.getElementById(el);
    if(!target) return;
    if(!window.echarts){
      target.textContent = '图表加载失败';
      return;
    }
    if(!months || !months.length){
      target.textContent = '暂无数据';
      return;
    }
    const chart = window.echarts.init(target);
    chart.setOption({
      tooltip:{trigger:'axis'},
      legend:{bottom:0},
      grid:{left:40,right:20,top:20,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:[
        {type:'value',axisLabel:{formatter:(v)=>v/10000+'万'}},
        {type:'value',axisLabel:{formatter:(v)=>v/10000+'万'}}
      ],
      series:series
    });
  }

  function renderLineChart(el, months, series){
    const target = document.getElementById(el);
    if(!target) return;
    if(!window.echarts){
      target.textContent = '图表加载失败';
      return;
    }
    if(!months || !months.length){
      target.textContent = '暂无数据';
      return;
    }
    const chart = window.echarts.init(target);
    chart.setOption({
      tooltip:{trigger:'axis'},
      legend:{bottom:0},
      grid:{left:40,right:20,top:20,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value'},
      series:series
    });
  }

  function renderSparkline(el, data, color, areaColor){
    const target = typeof el === 'string' ? document.getElementById(el) : el;
    if(!target) return;
    if(!window.echarts){
      target.textContent = '—';
      return;
    }
    if(!Array.isArray(data) || !data.length){
      target.textContent = '—';
      return;
    }
    const lineColor = color || '#148a78';
    const fillColor = areaColor || (lineColor === '#f05a3e' ? 'rgba(240,90,62,0.18)' : 'rgba(20,138,120,0.18)');
    const chart = window.echarts.init(target);
    chart.setOption({
      grid:{left:0,right:0,top:4,bottom:0},
      xAxis:{type:'category',data:data.map((_,i)=>i),show:false},
      yAxis:{type:'value',show:false},
      series:[{
        type:'line',
        data:data,
        smooth:true,
        symbol:'none',
        lineStyle:{color:lineColor,width:1.5},
        areaStyle:{color:fillColor}
      }]
    });
  }

  function renderDeltaBridgeChart(el, categories, momAmount, momRate, yoyAmount, yoyRate){
    const target = document.getElementById(el);
    if(!target) return;
    if(!window.echarts){
      target.textContent = '图表加载失败';
      return;
    }
    const allVals = []
      .concat(momAmount || [])
      .concat(momRate || [])
      .concat(yoyAmount || [])
      .concat(yoyRate || []);
    const hasData = allVals.some(v=>v !== null && v !== undefined);
    if(!hasData){
      target.textContent = '暂无数据';
      return;
    }
    const hasYoY = Array.isArray(yoyAmount) && yoyAmount.some(v=>v !== null && v !== undefined);
    const series = [
      {
        name:'环比Δ(金额)',
        type:'bar',
        data:momAmount,
        barMaxWidth:20,
        itemStyle:{ color:(p)=> (p.value >= 0 ? '#148a78' : '#f05a3e') }
      },
      {
        name:'环比Δ(毛利率)',
        type:'bar',
        data:momRate,
        yAxisIndex:1,
        barMaxWidth:20,
        itemStyle:{ color:(p)=> (p.value >= 0 ? '#148a78' : '#f05a3e') }
      }
    ];
    if(hasYoY){
      series.push({
        name:'同比Δ(金额)',
        type:'bar',
        data:yoyAmount,
        barMaxWidth:20,
        itemStyle:{ color:(p)=> (p.value >= 0 ? '#148a78' : '#f05a3e') }
      });
      series.push({
        name:'同比Δ(毛利率)',
        type:'bar',
        data:yoyRate,
        yAxisIndex:1,
        barMaxWidth:20,
        itemStyle:{ color:(p)=> (p.value >= 0 ? '#148a78' : '#f05a3e') }
      });
    }
    const chart = window.echarts.init(target);
    chart.setOption({
      tooltip:{trigger:'axis', axisPointer:{type:'shadow'}},
      legend:{bottom:0},
      grid:{left:40,right:40,top:20,bottom:40},
      xAxis:{type:'category',data:categories},
      yAxis:[
        {type:'value',axisLabel:{formatter:(v)=>v/10000+'万'}},
        {type:'value',axisLabel:{formatter:(v)=>v.toFixed(1)+'%'}}
      ],
      series:series
    });
  }

  function renderSegmentMatrix(rows){
    renderTable('segment_matrix_table', rows, [
      { key:'seg' },
      { key:'sales' },
      { key:'gp' },
      { key:'gm' },
      { key:'netCash' },
      { key:'netAr' },
      { key:'netAp' },
      { key:'inventory' },
      { key:'dso' },
      { key:'dpo' },
      { key:'dio' },
      { key:'ccc' },
      { key:'top1' }
    ], [
      (v)=>SEG_LABELS[v] || fmtText(v),
      (v)=>fmtWan(v),
      (v)=>fmtWan(v),
      (v)=>fmtPct(v),
      (v)=>fmtWan(v),
      (v)=>fmtWan(v),
      (v)=>fmtWan(v),
      (v)=>fmtWan(v),
      (v)=>fmtDays(v),
      (v)=>fmtDays(v),
      (v)=>fmtDays(v),
      (v)=>fmtDays(v),
      (v)=>fmtPct(v)
    ]);
  }

  function renderWarningFilters(warnings){
    const levelSelect = document.getElementById('warning_filter_level');
    const domainSelect = document.getElementById('warning_filter_domain');
    const resetBtn = document.getElementById('warning_filter_reset');
    if(!levelSelect || !domainSelect) return;
    domainSelect.innerHTML = '<option value="all">全部</option>';
    const domains = [...new Set(warnings.map(w=>w.domain).filter(Boolean))];
    domains.forEach(d=>{
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      domainSelect.appendChild(opt);
    });
    const apply = ()=>{
      const levelVal = levelSelect.value;
      const domainVal = domainSelect.value;
      const filtered = warnings.filter(w=>{
        const levelOk = levelVal === 'all' || w.levelClass === levelVal;
        const domainOk = domainVal === 'all' || w.domain === domainVal;
        return levelOk && domainOk;
      });
      renderWarningTable(filtered);
    };
    levelSelect.onchange = apply;
    domainSelect.onchange = apply;
    if(resetBtn){
      resetBtn.onclick = ()=>{
        levelSelect.value = 'all';
        domainSelect.value = 'all';
        apply();
      };
    }
    apply();
  }

  function getActionSourceGroup(action){
    const source = action && action.source ? String(action.source) : '';
    const domain = action && action.domain ? String(action.domain) : '';
    if(source.indexOf('forecast:') === 0) return 'forecast';
    if(source.indexOf('预警') !== -1 || domain.indexOf('风险') !== -1 || source.indexOf('风险') !== -1) return 'risk';
    if(domain.indexOf('现金') !== -1 || domain.indexOf('资金') !== -1 || source.indexOf('现金') !== -1) return 'cashflow';
    if(domain.indexOf('毛利') !== -1 || domain.indexOf('收入') !== -1 || source.indexOf('毛利') !== -1) return 'margin';
    return 'other';
  }

  function renderActionFilters(actions){
    const sourceSelect = document.getElementById('action_filter_source');
    const resetBtn = document.getElementById('action_filter_reset');
    if(!sourceSelect) return ()=>{};
    actions.forEach(a=>{ a.source_group = getActionSourceGroup(a); });
    const sourceLabels = {
      all:'全部',
      risk:'风险',
      cashflow:'现金流',
      forecast:'预测',
      margin:'毛利',
      other:'其他'
    };
    const apply = ()=>{
      const sourceVal = sourceSelect.value || 'all';
      const filtered = actions.filter(a=>sourceVal === 'all' || a.source_group === sourceVal);
      renderActionTable(filtered);
      const actionStats = document.getElementById('action_stats');
      if(actionStats){
        const sourceLabel = sourceLabels[sourceVal] || sourceVal;
        actionStats.textContent = `动作共 ${filtered.length}/${actions.length} 项（筛选：${sourceLabel}）。`;
      }
    };
    sourceSelect.onchange = apply;
    if(resetBtn){
      resetBtn.onclick = ()=>{
        sourceSelect.value = 'all';
        apply();
      };
    }
    apply();
    return apply;
  }

  function getScenarioImpact(action, key){
    if(!action) return null;
    if(key === 's1') return toNumber(action.expected_cash_impact_s1);
    if(key === 's2') return toNumber(action.expected_cash_impact_s2);
    if(key === 's3') return toNumber(action.expected_cash_impact_s3);
    return toNumber(action.expected_cash_impact_base);
  }

  function renderForecastActionPack(forecastData, forecastResult, forecastActions){
    const scenarioSelect = document.getElementById('forecast_action_scenario');
    const gapEl = document.getElementById('forecast_action_gap');
    const coverEl = document.getElementById('forecast_action_cover');
    const topEl = document.getElementById('forecast_action_top');
    if(!scenarioSelect || !gapEl || !coverEl || !topEl) return;
    const scenarios = forecastData && forecastData.forecast && forecastData.forecast.scenarios ? forecastData.forecast.scenarios : {};
    const gapMap = {
      base: toNumber(forecastResult.base_gap_amount !== null ? forecastResult.base_gap_amount : (scenarios.base && scenarios.base.gap_amount)),
      s1: toNumber(forecastResult.s1_gap_amount !== null ? forecastResult.s1_gap_amount : (scenarios.s1 && scenarios.s1.gap_amount))
    };
    const actions = (forecastActions || []).filter(a=>String(a.source || '').indexOf('forecast:') === 0);
    function apply(key){
      const gap = gapMap[key] !== undefined ? gapMap[key] : null;
      const impacts = actions.map(a=>getScenarioImpact(a, key)).filter(v=>v !== null);
      const totalImpact = impacts.reduce((sum, v)=>sum + v, 0);
      const topImpact = impacts.sort((a,b)=>b-a).slice(0, 5).reduce((sum, v)=>sum + v, 0);
      const cover = gap ? totalImpact / gap : null;
      gapEl.textContent = fmtWan(gap);
      coverEl.textContent = cover === null ? '—' : fmtRatio(cover);
      topEl.textContent = fmtWan(topImpact);
    }
    scenarioSelect.onchange = ()=>apply(scenarioSelect.value || 'base');
    apply(scenarioSelect.value || 'base');
  }

  function bindTrafficPanel(warnings){
    const redBtn = document.getElementById('traffic_red');
    const yellowBtn = document.getElementById('traffic_yellow');
    const greenBtn = document.getElementById('traffic_green');
    const redCount = document.getElementById('traffic_red_count');
    const yellowCount = document.getElementById('traffic_yellow_count');
    const greenCount = document.getElementById('traffic_green_count');
    if(redCount) redCount.textContent = warnings.filter(w=>w.level === '红').length;
    if(yellowCount) yellowCount.textContent = warnings.filter(w=>w.level === '黄').length;
    if(greenCount) greenCount.textContent = warnings.filter(w=>w.level === '绿').length;
    const jump = ()=>{
      const sec = document.getElementById('sec-10');
      if(sec) sec.scrollIntoView({ behavior:'smooth', block:'start' });
    };
    if(redBtn) redBtn.onclick = jump;
    if(yellowBtn) yellowBtn.onclick = jump;
    if(greenBtn) greenBtn.onclick = jump;
  }

  function bucketSeverity(bucket){
    const key = String(bucket || '').trim();
    if(key === '90+') return 5;
    if(key === '61-90') return 4;
    if(key === '31-60') return 3;
    if(key === '1-30') return 2;
    if(key === '未到期') return 1;
    return 1;
  }

  function getCollectRatio(bucket, thresholds){
    const key = String(bucket || '').trim();
    if(thresholds && thresholds.forecast_ar_collect_ratio && thresholds.forecast_ar_collect_ratio[key] !== undefined){
      return thresholds.forecast_ar_collect_ratio[key];
    }
    return 0.5;
  }

  function getBucketDays(bucket, thresholds){
    const key = String(bucket || '').trim();
    if(thresholds && thresholds.forecast_ar_bucket_days && thresholds.forecast_ar_bucket_days[key] !== undefined){
      return thresholds.forecast_ar_bucket_days[key];
    }
    return 14;
  }

  function computeScenarioImpacts(baseImpact, type, thresholds){
    const t = thresholds && thresholds.forecast_scenario_impact ? thresholds.forecast_scenario_impact : {};
    const map = t[type] || { base:1, s1:1, s2:1, s3:1 };
    return {
      base: baseImpact * (map.base || 1),
      s1: baseImpact * (map.s1 || 1),
      s2: baseImpact * (map.s2 || 1),
      s3: baseImpact * (map.s3 || 1)
    };
  }

  function buildRecMap(list, keyFn){
    const map = new Map();
    (Array.isArray(list) ? list : []).forEach(item=>{
      const key = keyFn(item);
      if(key) map.set(key, item);
    });
    return map;
  }

  function generateForecastActions(forecastData, finance, thresholds){
    const forecastRoot = forecastData && forecastData.forecast ? forecastData.forecast : {};
    const rec = forecastRoot.recommendations || {};
    const summary = rec.summary_kpi || {};
    const scenarios = forecastRoot.scenarios || {};

    const baseGap = toNumber(summary.base_gap_amount !== undefined ? summary.base_gap_amount : (scenarios.base && scenarios.base.gap_amount));
    const baseMinBalance = toNumber(summary.base_min_balance !== undefined ? summary.base_min_balance : (scenarios.base && scenarios.base.min_balance));
    const s1Gap = toNumber(scenarios.s1 && scenarios.s1.gap_amount);
    const s1Sensitive = baseGap !== null && s1Gap !== null
      ? ((s1Gap - baseGap) / Math.max(1, baseGap) > thresholds.forecast_s1_gap_increase_ratio)
      : false;

    const baseDate = (finance && finance.meta && finance.meta.period_end) ? finance.meta.period_end : formatDate(new Date());

    const arRecMap = buildRecMap(rec.ar_collection, item=>`${item.customer || ''}__${item.aging_bucket || ''}`);
    const apRecMap = buildRecMap(rec.ap_deferral, item=>String(item.vendor || ''));
    const poRecMap = buildRecMap(rec.po_reduction, item=>String(item.supplier || ''));

    let arRows = Array.isArray(forecastRoot.ar_plan_rows) ? forecastRoot.ar_plan_rows : [];
    if(!arRows.length && Array.isArray(rec.ar_collection)){
      arRows = rec.ar_collection.map(r=>({
        customer: r.customer,
        aging_bucket: r.aging_bucket,
        open_amount: r.amount_open,
        planned_date: r.suggested_collect_date,
        confidence: r.expected_collect_ratio,
        source_id: (r.source_ids && r.source_ids[0]) || ''
      }));
    }

    let apRows = Array.isArray(forecastRoot.ap_plan_rows) ? forecastRoot.ap_plan_rows : [];
    if(!apRows.length && Array.isArray(rec.ap_deferral)){
      apRows = rec.ap_deferral.map(r=>({
        vendor: r.vendor,
        amount_due: r.amount_due_30d,
        due_date: r.suggested_pay_date,
        planned_date: r.suggested_pay_date,
        confidence: r.deferral_days ? (r.deferral_days >= 14 ? 0.6 : 0.5) : null,
        source_id: (r.source_ids && r.source_ids[0]) || ''
      }));
    }

    let poRows = Array.isArray(forecastRoot.po_plan_rows) ? forecastRoot.po_plan_rows : [];
    if(!poRows.length && Array.isArray(rec.po_reduction)){
      poRows = rec.po_reduction.map(r=>({
        supplier: r.supplier,
        po_amount_open: r.po_amount_open,
        eta_date: r.eta_date,
        planned_pay_date: r.eta_date,
        confidence: r.reducible_ratio,
        source_id: (r.source_ids && r.source_ids[0]) || '',
        sku_or_category: r.evidence_keys ? r.evidence_keys.sku_or_category : ''
      }));
    }

    const arTotal = arRows.reduce((sum, r)=>sum + (toNumber(r.open_amount) || 0), 0);
    const arByCustomer = {};
    arRows.forEach(r=>{
      const key = r.customer || '未知客户';
      arByCustomer[key] = (arByCustomer[key] || 0) + (toNumber(r.open_amount) || 0);
    });

    const arActions = arRows.map(r=>{
      const customer = fmtText(r.customer);
      const bucket = fmtText(r.aging_bucket);
      const amountOpen = toNumber(r.open_amount);
      const recKey = `${customer}__${bucket}`;
      const recItem = arRecMap.get(recKey) || {};
      const collectRatio = recItem.expected_collect_ratio !== undefined ? recItem.expected_collect_ratio : getCollectRatio(bucket, thresholds);
      const expectedCashIn = amountOpen !== null ? amountOpen * collectRatio : null;
      const bucketDays = getBucketDays(bucket, thresholds);
      const ddlDate = addDays(baseDate, bucketDays);
      const suggestedDate = r.planned_date || recItem.suggested_collect_date || ddlDate;
      const amountShare = (amountOpen !== null && arTotal) ? amountOpen / arTotal : 0;
      const agingScore = bucketSeverity(bucket) / 5;
      const concentration = arTotal ? (arByCustomer[customer] || 0) / arTotal : 0;
      const weights = thresholds.forecast_ar_weights || { amount:0.4, aging:0.3, concentration:0.2, sensitivity:0.1 };
      let score = weights.amount * amountShare + weights.aging * agingScore + weights.concentration * concentration + weights.sensitivity * (s1Sensitive ? 1 : 0);
      if(s1Sensitive) score *= 1.1;
      const reasonParts = [];
      if(recItem.reason) reasonParts.push(recItem.reason);
      if(s1Sensitive) reasonParts.push('对情景1敏感');
      const impacts = expectedCashIn !== null ? computeScenarioImpacts(expectedCashIn, 'ar', thresholds) : { base:null, s1:null, s2:null, s3:null };
      return {
        source:'forecast:AR_collection',
        domain:'预测',
        signal:`AR催收：${customer}，账龄${bucket}，未收${fmtWan(amountOpen)}`,
        owner:'',
        task:`催收客户【${customer}】，目标回款【${fmtWan(expectedCashIn)}】（账龄${bucket}），截止日期 ${ddlDate}`,
        ddl: ddlDate,
        impact:`预计现金影响 ${fmtWan(expectedCashIn)}`,
        expected_cash_impact_base: impacts.base,
        expected_cash_impact_s1: impacts.s1,
        expected_cash_impact_s2: impacts.s2,
        expected_cash_impact_s3: impacts.s3,
        reason: reasonParts.join('；'),
        evidence_metric:`未收${fmtWan(amountOpen)}，预计回款${fmtWan(expectedCashIn)}`,
        link: buildEvidenceLink({
          seg:'total',
          tab:'forecast',
          filters:{ view:'forecast_ar', customer: customer },
          anchor:'total_forecast_ar_table'
        }, '查看证据'),
        priority_score: score,
        suggested_date: suggestedDate
      };
    }).sort((a,b)=>b.priority_score - a.priority_score);

    const apRowsFiltered = apRows.filter(r=>{
      const due = parseDate(r.due_date);
      if(!due) return true;
      const base = parseDate(baseDate);
      if(!base) return true;
      const diff = Math.round((due.getTime() - base.getTime()) / 86400000);
      return diff <= 30;
    });
    const apTotal = apRowsFiltered.reduce((sum, r)=>sum + (toNumber(r.amount_due) || 0), 0);
    const apActions = apRowsFiltered.map(r=>{
      const vendor = fmtText(r.vendor);
      const amountDue = toNumber(r.amount_due);
      const share = (amountDue !== null && apTotal) ? amountDue / apTotal : 0;
      const isTop = share >= 0.2;
      const deferralDays = isTop ? thresholds.forecast_ap_deferral_days_top : thresholds.forecast_ap_deferral_days_normal;
      const expectedCashSaved = amountDue !== null ? amountDue * thresholds.forecast_ap_deferral_ratio : null;
      const ddlDate = addDays(baseDate, 7);
      const impacts = expectedCashSaved !== null ? computeScenarioImpacts(expectedCashSaved, 'ap', thresholds) : { base:null, s1:null, s2:null, s3:null };
      return {
        source:'forecast:AP_deferral',
        domain:'预测',
        signal:`AP延付：${vendor}，30天内到期${fmtWan(amountDue)}`,
        owner:'',
        task:`与供应商【${vendor}】协商延付【${deferralDays}天】，释放现金【${fmtWan(expectedCashSaved)}】，截止日期 ${ddlDate}`,
        ddl: ddlDate,
        impact:`预计现金影响 ${fmtWan(expectedCashSaved)}`,
        expected_cash_impact_base: impacts.base,
        expected_cash_impact_s1: impacts.s1,
        expected_cash_impact_s2: impacts.s2,
        expected_cash_impact_s3: impacts.s3,
        evidence_metric:`30天内到期${fmtWan(amountDue)}`,
        link: buildEvidenceLink({
          seg:'total',
          tab:'forecast',
          filters:{ view:'forecast_ap', vendor: vendor },
          anchor:'total_forecast_ap_table'
        }, '查看证据'),
        priority_score: share
      };
    }).sort((a,b)=>b.priority_score - a.priority_score);

    const s3Trigger = baseGap !== null && scenarios.s3 && toNumber(scenarios.s3.gap_amount) !== null
      ? toNumber(scenarios.s3.gap_amount) > baseGap * 1.1
      : false;
    const poActions = poRows.map(r=>{
      const supplier = fmtText(r.supplier);
      const amountOpen = toNumber(r.po_amount_open);
      const recItem = poRecMap.get(supplier) || {};
      const reducibleRatio = s3Trigger ? thresholds.forecast_po_reducible_ratio_s3 : thresholds.forecast_po_reducible_ratio;
      const actionLabel = recItem.suggested_action || (reducibleRatio >= 0.5 ? 'pause' : 'reduce');
      const terms = String(r.payment_terms || '').toLowerCase();
      const termsCoef = terms.includes('delivery') || terms.includes('receipt') ? 1 : 0.9;
      const expectedCashSaved = amountOpen !== null ? amountOpen * reducibleRatio * termsCoef : null;
      const ddlDate = addDays(baseDate, 14);
      const impacts = expectedCashSaved !== null ? computeScenarioImpacts(expectedCashSaved, 'po', thresholds) : { base:null, s1:null, s2:null, s3:null };
      return {
        source:'forecast:PO_reduction',
        domain:'预测',
        signal:`PO减采：${supplier}，未到货${fmtWan(amountOpen)}`,
        owner:'',
        task:`对供应商【${supplier}】未到货PO【金额${fmtWan(amountOpen)}】执行【${actionLabel}】（比例${Math.round(reducibleRatio * 100)}%），预计节省现金【${fmtWan(expectedCashSaved)}】，截止日期 ${ddlDate}`,
        ddl: ddlDate,
        impact:`预计现金影响 ${fmtWan(expectedCashSaved)}`,
        expected_cash_impact_base: impacts.base,
        expected_cash_impact_s1: impacts.s1,
        expected_cash_impact_s2: impacts.s2,
        expected_cash_impact_s3: impacts.s3,
        evidence_metric:`未到货${fmtWan(amountOpen)}`,
        link: buildEvidenceLink({
          seg:'total',
          tab:'forecast',
          filters:{ view:'forecast_po', supplier: supplier },
          anchor:'total_forecast_po_table'
        }, '查看证据'),
        priority_score: amountOpen || 0
      };
    }).sort((a,b)=>b.priority_score - a.priority_score);

    const topN = thresholds.forecast_top_n || 20;
    const actions = [
      ...arActions.slice(0, topN),
      ...apActions.slice(0, topN),
      ...poActions.slice(0, topN)
    ];

    const impactBaseTotal = actions.reduce((sum, a)=>sum + (toNumber(a.expected_cash_impact_base) || 0), 0);
    const coverageRatio = baseGap ? impactBaseTotal / baseGap : null;

    if((baseMinBalance !== null && baseMinBalance < 0) || (baseGap !== null && baseGap > thresholds.forecast_gap_threshold)){
      const topAr = arActions.slice(0, 5);
      const topAp = apActions.slice(0, 5);
      const topPo = poActions.slice(0, 5);
      const emergencyImpact = [...topAr, ...topAp, ...topPo].reduce((sum, a)=>sum + (toNumber(a.expected_cash_impact_base) || 0), 0);
      const impacts = computeScenarioImpacts(emergencyImpact, 'ar', thresholds);
      actions.push({
        source:'forecast:emergency_pack',
        domain:'预测',
        signal:'缺口应急包（前5应收/应付/采购）',
        owner:'',
        task:`汇总前5应收/应付/采购动作，预计释放现金${fmtWan(emergencyImpact)}，截止日期 ${addDays(baseDate, 3)}`,
        ddl:addDays(baseDate, 3),
        impact:`预计现金影响 ${fmtWan(emergencyImpact)}`,
        expected_cash_impact_base: impacts.base,
        expected_cash_impact_s1: impacts.s1,
        expected_cash_impact_s2: impacts.s2,
        expected_cash_impact_s3: impacts.s3,
        evidence_metric:`前5动作合计${fmtWan(emergencyImpact)}`,
        link: buildEvidenceLink({
          seg:'total',
          tab:'forecast',
          filters:{ view:'forecast_base' },
          anchor:'total_forecast_summary'
        }, '查看证据')
      });
    }

    if(coverageRatio !== null && coverageRatio < thresholds.forecast_action_coverage_threshold){
      const target = baseGap ? baseGap * thresholds.forecast_action_coverage_threshold : null;
      const gapDelta = target && impactBaseTotal ? Math.max(0, target - impactBaseTotal) : null;
      const impacts = gapDelta !== null ? computeScenarioImpacts(gapDelta, 'ar', thresholds) : { base:null, s1:null, s2:null, s3:null };
      actions.push({
        source:'forecast:coverage_boost',
        domain:'预测',
        signal:'行动覆盖度不足',
        owner:'',
        task:`提升应收回款比例/采购减采比例，追加释放现金${fmtWan(gapDelta)}，截止日期 ${addDays(baseDate, 5)}`,
        ddl:addDays(baseDate, 5),
        impact:`预计现金影响 ${fmtWan(gapDelta)}`,
        expected_cash_impact_base: impacts.base,
        expected_cash_impact_s1: impacts.s1,
        expected_cash_impact_s2: impacts.s2,
        expected_cash_impact_s3: impacts.s3,
        evidence_metric:`覆盖度${coverageRatio === null ? '—' : (coverageRatio * 100).toFixed(1) + '%'}`,
        link: buildEvidenceLink({
          seg:'total',
          tab:'forecast',
          filters:{ view:'forecast_components' },
          anchor:'total_forecast_components'
        }, '查看证据')
      });
    }

    return {
      actions,
      base_gap_amount: baseGap,
      base_min_balance: baseMinBalance,
      s1_gap_amount: s1Gap,
      coverage_ratio: coverageRatio,
      impact_base_total: impactBaseTotal
    };
  }

  function normalizeTunerParams(raw){
    const base = deepClone(DEFAULT_TUNER_PARAMS);
    const limits = {
      'ar.collect_ratio_not_due':{min:0,max:1},
      'ar.collect_ratio_1_30':{min:0,max:1},
      'ar.collect_ratio_31_60':{min:0,max:1},
      'ar.collect_ratio_61_90':{min:0,max:1},
      'ar.collect_ratio_90_plus':{min:0,max:1},
      'ar.delay_share_7d':{min:0,max:1},
      'ar.delay_share_14d':{min:0,max:1},
      'ap.deferral_ratio':{min:0,max:1},
      'ap.deferral_days_top_vendor':{min:0,max:14},
      'ap.deferral_days_other':{min:0,max:21},
      'ap.top_vendor_threshold_ratio':{min:0,max:1},
      'po.reducible_ratio_base':{min:0,max:1},
      'po.reducible_ratio_S3':{min:0,max:1},
      'threshold.gap_amount_warn_wan':{min:0,max:500},
      'threshold.min_balance_warn_wan':{min:0,max:500}
    };
    const enums = {
      'ar.delay_apply_to_bucket':['all','overdue_only','31plus'],
      'po.apply_scope':['all','top_suppliers','low_turnover_sku_if_available']
    };
    if(raw && typeof raw === 'object'){
      Object.keys(limits).forEach(path=>{
        const lim = limits[path];
        const val = getPath(raw, path);
        if(val !== undefined){
          const fallback = getPath(base, path);
          setPath(base, path, clampNumber(val, lim.min, lim.max, fallback));
        }
      });
      Object.keys(enums).forEach(path=>{
        const val = getPath(raw, path);
        if(val && enums[path].indexOf(val) !== -1){
          setPath(base, path, val);
        }
      });
    }
    const share7 = base.ar.delay_share_7d;
    const share14 = base.ar.delay_share_14d;
    const total = share7 + share14;
    if(total > 1){
      const scale = 1 / total;
      base.ar.delay_share_7d = Number((share7 * scale).toFixed(2));
      base.ar.delay_share_14d = Number((share14 * scale).toFixed(2));
    }
    base.version = TUNER_SCHEMA_VERSION;
    return base;
  }

  function readTunerParamsFromUrl(){
    try{
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('tuner');
      if(!raw) return null;
      const text = base64UrlDecode(raw);
      return normalizeTunerParams(JSON.parse(text));
    }catch(err){
      return null;
    }
  }

  function readTunerParamsFromStorage(){
    try{
      if(!window.localStorage) return null;
      const raw = window.localStorage.getItem(TUNER_STORAGE_KEY);
      if(!raw) return null;
      return normalizeTunerParams(JSON.parse(raw));
    }catch(err){
      return null;
    }
  }

  function writeTunerParamsToStorage(params){
    try{
      if(!window.localStorage) return;
      window.localStorage.setItem(TUNER_STORAGE_KEY, JSON.stringify(params));
    }catch(err){}
  }

  function buildTunerShareLink(params){
    const base = window.location.href.split('?')[0].split('#')[0];
    const qs = new URLSearchParams(window.location.search);
    qs.set('tuner', base64UrlEncode(JSON.stringify(params)));
    return base + '?' + qs.toString();
  }

  function getRowDate(row){
    return row.planned_date || row.due_date || row.date || row.expected_date || row.plan_date || '';
  }

  function getRowAmount(row){
    return Number(row.amount_open || row.amount || row.balance || row.amount_due || row.payable_amount || row.value) || 0;
  }

  function getVendorName(row){
    return row.vendor || row.supplier || row.vendor_name || row.supplier_name || row.counterparty || '未知供应商';
  }

  function getCustomerName(row){
    return row.customer || row.customer_name || row.client || row.counterparty || '未知客户';
  }

  function getArBucket(row){
    const raw = String(row.aging_bucket || row.bucket || row.aging || row.aging_days || '').toLowerCase();
    if(raw.includes('not') || raw.includes('未')) return 'not_due';
    if(raw.includes('1') && raw.includes('30')) return '1_30';
    if(raw.includes('31') && raw.includes('60')) return '31_60';
    if(raw.includes('61') && raw.includes('90')) return '61_90';
    if(raw.includes('90')) return '90_plus';
    const days = Number(row.aging_days);
    if(Number.isFinite(days)){
      if(days <= 0) return 'not_due';
      if(days <= 30) return '1_30';
      if(days <= 60) return '31_60';
      if(days <= 90) return '61_90';
      return '90_plus';
    }
    return '1_30';
  }

  function bucketCollectRatio(params, bucket){
    const ar = params.ar;
    if(bucket === 'not_due') return ar.collect_ratio_not_due;
    if(bucket === '1_30') return ar.collect_ratio_1_30;
    if(bucket === '31_60') return ar.collect_ratio_31_60;
    if(bucket === '61_90') return ar.collect_ratio_61_90;
    return ar.collect_ratio_90_plus;
  }

  function shouldDelayBucket(params, bucket){
    const mode = params.ar.delay_apply_to_bucket;
    if(mode === 'all') return true;
    if(mode === '31plus') return bucket === '31_60' || bucket === '61_90' || bucket === '90_plus';
    return bucket !== 'not_due';
  }

  function buildDateList(startDate, days){
    const list = [];
    for(let i=0;i<days;i++){
      list.push(addDays(startDate, i));
    }
    return list.filter(Boolean);
  }

  function accumulateByDate(map, date, amount){
    if(!date) return;
    if(!map[date]) map[date] = 0;
    map[date] += amount;
  }

  function getOpeningBalance(forecast){
    const meta = forecast && forecast.meta ? forecast.meta : {};
    const base = forecast && forecast.base ? forecast.base : {};
    const candidates = [
      meta.opening_balance,
      meta.starting_balance,
      meta.start_balance,
      base.opening_balance,
      base.starting_balance,
      base.start_balance
    ];
    for(let i=0;i<candidates.length;i++){
      const n = toNumber(candidates[i]);
      if(n !== null) return { value:n, inferred:false };
    }
    const baseDaily = base.daily || [];
    if(baseDaily.length){
      const first = baseDaily[0];
      const ending = toNumber(first.ending_balance);
      if(ending !== null){
        let net = toNumber(first.net);
        if(net === null){
          const cin = toNumber(first.in);
          const cout = toNumber(first.out);
          if(cin !== null && cout !== null) net = cin - cout;
        }
        if(net === null) net = 0;
        return { value: ending - net, inferred:true };
      }
    }
    return { value:0, inferred:true };
  }

  function getForecastBaseDate(forecast){
    const meta = forecast && forecast.meta ? forecast.meta : {};
    const base = forecast && forecast.base ? forecast.base : {};
    if(meta.base_date) return meta.base_date;
    if(base.base_date) return base.base_date;
    const baseDaily = base.daily || [];
    if(baseDaily.length && baseDaily[0].date) return baseDaily[0].date;
    return formatDate(new Date());
  }

  function calcArInflow(planRows, params, opts){
    const extraDelayDays = opts && opts.extraDelayDays ? opts.extraDelayDays : 0;
    const map = {};
    const impacts = [];
    planRows.forEach(row=>{
      const date = getRowDate(row);
      if(!date) return;
      const bucket = getArBucket(row);
      const ratio = bucketCollectRatio(params, bucket);
      const amount = getRowAmount(row);
      const collected = amount * ratio;
      const shiftedBase = extraDelayDays ? addDays(date, extraDelayDays) : date;
      let immediate = collected;
      let delayed7 = 0;
      let delayed14 = 0;
      if(shouldDelayBucket(params, bucket)){
        delayed7 = collected * params.ar.delay_share_7d;
        delayed14 = collected * params.ar.delay_share_14d;
        immediate = collected - delayed7 - delayed14;
      }
      accumulateByDate(map, shiftedBase, immediate);
      if(delayed7) accumulateByDate(map, addDays(shiftedBase, 7), delayed7);
      if(delayed14) accumulateByDate(map, addDays(shiftedBase, 14), delayed14);
      impacts.push({
        row: row,
        bucket: bucket,
        date: shiftedBase,
        amount: collected
      });
    });
    return { map, impacts };
  }

  function calcApOutflow(planRows, params){
    const totals = {};
    let totalAmt = 0;
    planRows.forEach(row=>{
      const amt = getRowAmount(row);
      const vendor = getVendorName(row);
      totals[vendor] = (totals[vendor] || 0) + amt;
      totalAmt += amt;
    });
    const topVendors = {};
    Object.keys(totals).forEach(vendor=>{
      const share = totalAmt ? totals[vendor] / totalAmt : 0;
      if(share >= params.ap.top_vendor_threshold_ratio){
        topVendors[vendor] = true;
      }
    });
    const map = {};
    const impacts = [];
    planRows.forEach(row=>{
      const date = getRowDate(row);
      if(!date) return;
      const amt = getRowAmount(row);
      const vendor = getVendorName(row);
      const isTop = !!topVendors[vendor];
      const deferralDays = isTop ? params.ap.deferral_days_top_vendor : params.ap.deferral_days_other;
      const deferralAmt = amt * params.ap.deferral_ratio;
      const keepAmt = amt - deferralAmt;
      accumulateByDate(map, date, keepAmt);
      if(deferralAmt){
        accumulateByDate(map, addDays(date, deferralDays), deferralAmt);
      }
      impacts.push({
        row: row,
        vendor: vendor,
        date: date,
        deferred_date: addDays(date, deferralDays),
        amount: deferralAmt
      });
    });
    return { map, impacts, topVendors };
  }

  function detectLowTurnoverRows(planRows){
    return planRows.filter(row=>{
      const label = String(row.turnover_class || row.turnover_bucket || row.turnover_label || '').toLowerCase();
      if(label.includes('low') || label.includes('slow')) return true;
      const days = toNumber(row.turnover_days || row.dio_days);
      if(days !== null && days > 120) return true;
      return !!row.low_turnover;
    });
  }

  function calcPoOutflow(planRows, params, scenarioKey){
    const suppliers = {};
    planRows.forEach(row=>{
      const supplier = getVendorName(row);
      suppliers[supplier] = (suppliers[supplier] || 0) + getRowAmount(row);
    });
    const supplierList = Object.keys(suppliers).map(key=>({ key, total: suppliers[key] }));
    supplierList.sort((a,b)=>b.total - a.total);
    const topCount = Math.max(1, Math.ceil(supplierList.length * 0.2));
    const topSuppliers = {};
    supplierList.slice(0, topCount).forEach(item=>{ topSuppliers[item.key] = true; });

    const lowTurnoverRows = detectLowTurnoverRows(planRows);
    const lowTurnoverSet = new Set(lowTurnoverRows.map(r=>r.sku || r.product || r.item || r.sku_code || r.id || r.name || ''));
    const hasLowTurnover = lowTurnoverRows.length > 0;

    const ratio = scenarioKey === 'S3' ? params.po.reducible_ratio_S3 : params.po.reducible_ratio_base;
    const map = {};
    const impacts = [];
    planRows.forEach(row=>{
      const date = getRowDate(row);
      if(!date) return;
      const supplier = getVendorName(row);
      let inScope = true;
      if(params.po.apply_scope === 'top_suppliers'){
        inScope = !!topSuppliers[supplier];
      }else if(params.po.apply_scope === 'low_turnover_sku_if_available'){
        if(hasLowTurnover){
          const key = row.sku || row.product || row.item || row.sku_code || row.id || row.name || '';
          inScope = lowTurnoverSet.has(key);
        }else{
          inScope = true;
        }
      }
      const amt = getRowAmount(row);
      const reduced = inScope ? (amt * ratio) : 0;
      const outAmt = amt - reduced;
      accumulateByDate(map, date, outAmt);
      impacts.push({
        row: row,
        supplier: supplier,
        date: date,
        reduced_amount: reduced,
        in_scope: inScope
      });
    });
    return { map, impacts, topSuppliers, hasLowTurnover };
  }

  function computeDailyRecalc(forecast, params, opts){
    const baseDate = getForecastBaseDate(forecast);
    const dateList = buildDateList(baseDate, 30);
    const components = forecast && forecast.components ? forecast.components : forecast;
    const arRows = Array.isArray(components && components.ar_plan_rows) ? components.ar_plan_rows : [];
    const apRows = Array.isArray(components && components.ap_plan_rows) ? components.ap_plan_rows : [];
    const poRows = Array.isArray(components && components.po_plan_rows) ? components.po_plan_rows : [];

    const arCalc = calcArInflow(arRows, params, opts);
    const apCalc = calcApOutflow(apRows, params);
    const poCalc = calcPoOutflow(poRows, params, opts && opts.scenarioKey);
    const balanceInfo = getOpeningBalance(forecast);
    let running = balanceInfo.value;
    const daily = dateList.map(date=>{
      const inConfirmed = arCalc.map[date] || 0;
      const outConfirmed = apCalc.map[date] || 0;
      const outEstimated = poCalc.map[date] || 0;
      const net = inConfirmed - outConfirmed - outEstimated;
      running += net;
      return {
        date: date,
        in: inConfirmed,
        out: outConfirmed + outEstimated,
        net: net,
        ending_balance: running,
        in_confirmed: inConfirmed,
        out_confirmed: outConfirmed,
        out_estimated: outEstimated
      };
    });
    return {
      daily_recalc: daily,
      base_date: baseDate,
      opening_balance: balanceInfo.value,
      balance_inferred: balanceInfo.inferred,
      impacts: {
        ar: arCalc,
        ap: apCalc,
        po: poCalc
      }
    };
  }

  function getGapMetrics(daily){
    let minBalance = null;
    let minDate = '';
    daily.forEach(row=>{
      const bal = toNumber(row.ending_balance);
      if(bal === null) return;
      if(minBalance === null || bal < minBalance){
        minBalance = bal;
        minDate = row.date;
      }
    });
    if(minBalance === null) minBalance = 0;
    const maxGap = Math.max(0, -minBalance);
    return { min_balance: minBalance, max_gap: maxGap, gap_day: maxGap > 0 ? minDate : '' };
  }

  function computeForecastCoverage(daily){
    let confirmed = 0;
    let estimated = 0;
    daily.forEach(row=>{
      confirmed += Number(row.out_confirmed) || 0;
      estimated += Number(row.out_estimated) || 0;
    });
    const ratio = confirmed + estimated ? confirmed / (confirmed + estimated) : 1;
    return { confirmed, estimated, ratio };
  }

  function recomputeForecastWithTuner(forecastRaw, tunerParams){
    if(!forecastRaw) return null;
    const params = normalizeTunerParams(tunerParams || {});
    const base = computeDailyRecalc(forecastRaw, params, { scenarioKey:'Base' });
    const scenarios = {};
    const rawScenarios = forecastRaw && forecastRaw.scenarios ? forecastRaw.scenarios : {};
    const scenarioKeys = Object.keys(rawScenarios);
    if(!scenarioKeys.includes('S1')) scenarioKeys.unshift('S1');
    scenarioKeys.forEach(key=>{
      const opts = { scenarioKey:key, extraDelayDays: key === 'S1' ? 7 : 0 };
      scenarios[key] = computeDailyRecalc(forecastRaw, params, opts);
    });
    const baseGap = getGapMetrics(base.daily_recalc);
    const s1Gap = scenarios.S1 ? getGapMetrics(scenarios.S1.daily_recalc) : null;
    const coverage = computeForecastCoverage(base.daily_recalc);
    const gapWan = baseGap.max_gap / 10000;
    const minBalWan = baseGap.min_balance / 10000;
    const gapThreshold = params.threshold.gap_amount_warn_wan;
    const minBalanceThreshold = params.threshold.min_balance_warn_wan;
    const gapRisk = Math.min(100, Math.max(0, gapThreshold ? (gapWan / gapThreshold) * 100 : 0));
    const minBalRisk = (minBalWan < minBalanceThreshold) ? Math.min(100, ((minBalanceThreshold - minBalWan) / Math.max(1, minBalanceThreshold)) * 100) : 0;
    const liquidityRisk = Math.min(100, Math.round(gapRisk * 0.7 + minBalRisk * 0.6));
    const coverageRisk = Math.min(100, Math.max(0, Math.round((1 - coverage.ratio) * 100)));
    let sensitivityRisk = 0;
    if(s1Gap){
      const baseGapVal = baseGap.max_gap || 1;
      const delta = (s1Gap.max_gap - baseGap.max_gap) / baseGapVal;
      sensitivityRisk = Math.min(100, Math.max(0, Math.round(delta * 100)));
    }
    const breakdownRows = [
      {
        risk_item:'流动性缺口风险',
        formula:'max_gap 与 min_balance 阈值扣分',
        threshold:`缺口>=${gapThreshold}万 / 余额<=${minBalanceThreshold}万`,
        current_value: gapWan > 0 ? gapWan : minBalWan,
        penalty: liquidityRisk,
        evidence_state_link:{ seg:'total', tab:'finance', tableId:'total_finance_bank_txn_table', anchor:'total_finance_bank_txn_table' }
      },
      {
        risk_item:'预测覆盖度风险',
        formula:'confirmed / (confirmed + estimated)',
        threshold:'>= 80%',
        current_value: coverage.ratio,
        penalty: coverageRisk,
        evidence_state_link:{ seg:'total', tab:'finance', tableId:'total_finance_ap_table', anchor:'total_finance_ap_table' }
      },
      {
        risk_item:'情景敏感度风险',
        formula:'情景1最大缺口相对基准',
        threshold:'<= 20%',
        current_value: s1Gap ? ((s1Gap.max_gap - baseGap.max_gap) / Math.max(1, baseGap.max_gap)) : 0,
        penalty: sensitivityRisk,
        evidence_state_link:{ seg:'total', tab:'finance', tableId:'total_finance_ar_table', anchor:'total_finance_ar_table' }
      }
    ];

    return {
      base: base,
      scenarios: scenarios,
      recommendations_recalc: {
        ar_collection: base.impacts.ar.impacts || [],
        ap_deferral: base.impacts.ap.impacts || [],
        po_reduction: base.impacts.po.impacts || [],
        summary_kpi: {
          gap_amount: baseGap.max_gap,
          min_balance: baseGap.min_balance,
          gap_day: baseGap.gap_day
        }
      },
      risk_recalc: {
        liquidity_gap_risk: liquidityRisk,
        forecast_coverage_risk: coverageRisk,
        scenario_sensitivity_risk: sensitivityRisk,
        breakdown_rows: breakdownRows
      }
    };
  }

  function buildForecastActions(computed, params, baseDate){
    const base = computed.base;
    const gap = getGapMetrics(base.daily_recalc);
    const gapDay = gap.gap_day;
    const actions = [];
    const arImpacts = base.impacts.ar.impacts || [];
    const apImpacts = base.impacts.ap.impacts || [];
    const poImpacts = base.impacts.po.impacts || [];

    function arScore(item){
      const mult = item.bucket === '90_plus' ? 1.6 : (item.bucket === '61_90' ? 1.4 : (item.bucket === '31_60' ? 1.2 : 1));
      return item.amount * mult;
    }

    const arRows = arImpacts.map(item=>{
      const dateOk = gapDay ? item.date <= gapDay : true;
      return {
        type:'ar',
        name:getCustomerName(item.row),
        amount:item.amount,
        impact: dateOk ? item.amount : 0,
        score: item.row.priority_score || arScore(item)
      };
    }).sort((a,b)=>b.score - a.score).slice(0, 20);

    arRows.forEach(row=>{
      actions.push({
        source:'forecast:AR_collection',
        domain:'预测',
        signal:`回款策略：${row.name}`,
        owner:'应收负责人',
        task:'推进回款节奏并锁定对账窗口',
        ddl:addDays(baseDate, ACTION_DAYS.quick),
        impact:`预计现金影响 ${fmtWan(row.impact)}`,
        expected_cash_impact: row.impact,
        link: buildEvidenceLink({
          seg:'total',
          tab:'forecast',
          filters:{ view:'forecast_ar', customer: row.name },
          anchor:'total_forecast_ar_table'
        }, '查看证据')
      });
    });

    const apRows = apImpacts.map(item=>{
      const hitGap = gapDay && item.date <= gapDay && item.deferred_date > gapDay;
      const impact = hitGap ? item.amount : 0;
      return {
        type:'ap',
        name:getVendorName(item.row),
        amount:item.amount,
        impact:impact,
        score:item.row.priority_score || item.amount
      };
    }).sort((a,b)=>b.score - a.score).slice(0, 20);

    apRows.forEach(row=>{
      actions.push({
        source:'forecast:AP_deferral',
        domain:'预测',
        signal:`延付策略：${row.name}`,
        owner:'采购负责人',
        task:'协商付款节奏并控制关键供应商关系',
        ddl:addDays(baseDate, ACTION_DAYS.mid),
        impact:`预计现金影响 ${fmtWan(row.impact)}`,
        expected_cash_impact: row.impact,
        link: buildEvidenceLink({
          seg:'total',
          tab:'forecast',
          filters:{ view:'forecast_ap', vendor: row.name },
          anchor:'total_forecast_ap_table'
        }, '查看证据')
      });
    });

    const poRows = poImpacts.map(item=>{
      const impact = gapDay && item.date <= gapDay ? item.reduced_amount : 0;
      return {
        type:'po',
        name:getVendorName(item.row),
        amount:item.reduced_amount,
        impact:impact,
        score:item.row.priority_score || item.reduced_amount
      };
    }).sort((a,b)=>b.score - a.score).slice(0, 20);

    poRows.forEach(row=>{
      if(!row.amount) return;
      actions.push({
        source:'forecast:PO_reduction',
        domain:'预测',
        signal:`减采策略：${row.name}`,
        owner:'供应链负责人',
        task:'调整补货节奏并压降低周转货号',
        ddl:addDays(baseDate, ACTION_DAYS.mid),
        impact:`预计现金影响 ${fmtWan(row.impact)}`,
        expected_cash_impact: row.impact,
        link: buildEvidenceLink({
          seg:'total',
          tab:'forecast',
          filters:{ view:'forecast_po', supplier: row.name },
          anchor:'total_forecast_po_table'
        }, '查看证据')
      });
    });

    const gapAmount = gap.max_gap;
    const totalImpact = actions.reduce((sum,a)=>sum + (Number(a.expected_cash_impact) || 0), 0);
    const coverageRatio = gapAmount ? totalImpact / gapAmount : 1;
    if(gapAmount > 0 && coverageRatio < 0.8){
      actions.push({
        source:'forecast:coverage',
        domain:'预测策略',
        signal:'行动覆盖度不足',
        owner:'财务负责人',
        task:'提高策略强度或补充融资/减支方案',
        ddl:addDays(baseDate, ACTION_DAYS.quick),
        impact:`覆盖率 ${(coverageRatio * 100).toFixed(1)}%，缺口${fmtWan(gapAmount)}`,
        expected_cash_impact: gapAmount * (0.8 - coverageRatio),
        link: buildEvidenceLink({ seg:'total', tab:'overview' }, '查看证据')
      });
    }

    actions.sort((a,b)=>(Number(b.expected_cash_impact)||0) - (Number(a.expected_cash_impact)||0));
    return { actions, coverage_ratio: coverageRatio, total_impact: totalImpact, gap_amount: gapAmount };
  }

  function renderForecastChart(chart, daily, scenarios){
    if(!chart || !daily) return;
    const dates = daily.map(d=>d.date);
    const baseSeries = daily.map(d=>d.ending_balance);
    const scenarioName = (key)=>{
      if(!key) return '';
      if(key === 'Base') return '基准';
      if(key === 'S1') return '情景1';
      if(key === 'S2') return '情景2';
      if(key === 'S3') return '情景3';
      return key;
    };
    const series = [
      { name:'基准', type:'line', data: baseSeries, smooth:true, lineStyle:{ width:2 } }
    ];
    if(scenarios){
      Object.keys(scenarios).forEach(key=>{
        if(key === 'Base') return;
        const arr = scenarios[key].daily_recalc || [];
        series.push({ name:scenarioName(key), type:'line', data: arr.map(d=>d.ending_balance), smooth:true, lineStyle:{ width:2, type:'dashed' } });
      });
    }
    chart.setOption({
      grid:{left:40,right:18,top:28,bottom:28},
      tooltip:{trigger:'axis'},
      legend:{data:series.map(s=>s.name),top:0},
      xAxis:{type:'category',data:dates},
      yAxis:{type:'value'},
      series:series
    }, { notMerge:false, lazyUpdate:true });
  }

  function renderForecastGapKpis(containerId, baseGap, coverageRatio){
    const items = [
      { label:'基准最低余额', value: fmtWan(baseGap.min_balance) },
      { label:'基准缺口', value: fmtWan(baseGap.max_gap) },
      { label:'缺口日', value: baseGap.gap_day || '—' },
      { label:'行动覆盖率', value: coverageRatio !== null ? fmtRatio(coverageRatio) : '—' }
    ];
    renderMiniKpis(containerId, items);
  }

  function renderForecastSummaries(baseGap, s1Gap, coverage){
    const baseEl = document.getElementById('tuner_base_summary');
    if(baseEl){
      baseEl.textContent = `基准：最低余额 ${fmtWan(baseGap.min_balance)} / 缺口 ${fmtWan(baseGap.max_gap)} / 缺口日 ${baseGap.gap_day || '—'}`;
    }
    const s1El = document.getElementById('tuner_s1_summary');
    if(s1El && s1Gap){
      s1El.textContent = `情景1：最低余额 ${fmtWan(s1Gap.min_balance)} / 缺口 ${fmtWan(s1Gap.max_gap)} / 缺口日 ${s1Gap.gap_day || '—'}`;
    }
    const coverEl = document.getElementById('tuner_action_coverage');
    if(coverEl){
      coverEl.textContent = `动作覆盖率：${fmtRatio(coverage.coverage_ratio)}（覆盖现金 ${fmtWan(coverage.total_impact)} / 缺口 ${fmtWan(coverage.gap_amount)}）`;
    }
  }

  function renderForecastCards(baseGap, s1Gap, sensitivity){
    const baseCard = document.getElementById('forecast_base_card');
    if(baseCard){
      baseCard.innerHTML = '';
      baseCard.appendChild(buildMiniCard('基准缺口', fmtWan(baseGap.max_gap), `最低余额 ${fmtWan(baseGap.min_balance)}｜${baseGap.gap_day || '—'}`));
    }
    const s1Card = document.getElementById('forecast_s1_card');
    if(s1Card && s1Gap){
      s1Card.innerHTML = '';
      s1Card.appendChild(buildMiniCard('情景1缺口', fmtWan(s1Gap.max_gap), `最低余额 ${fmtWan(s1Gap.min_balance)}｜${s1Gap.gap_day || '—'}`));
    }
    const sensCard = document.getElementById('forecast_sensitivity_card');
    if(sensCard){
      const delta = s1Gap ? (s1Gap.max_gap - baseGap.max_gap) : 0;
      sensCard.innerHTML = '';
      sensCard.appendChild(buildMiniCard('情景敏感度', fmtWan(delta), '情景1对比基准缺口变化'));
    }
    const sensNote = document.getElementById('forecast_sensitivity_note');
    if(sensNote && s1Gap){
      sensNote.textContent = `情景1回款延迟导致缺口变化 ${fmtSignedWan(s1Gap.max_gap - baseGap.max_gap)}。`;
    }
  }

  function renderForecastRiskScores(risk){
    const gapEl = document.getElementById('risk_score_gap');
    if(gapEl) gapEl.textContent = fmtScore(risk ? risk.liquidity_gap_risk : null);
    const covEl = document.getElementById('risk_score_coverage');
    if(covEl) covEl.textContent = fmtScore(risk ? risk.forecast_coverage_risk : null);
    const senEl = document.getElementById('risk_score_sensitivity');
    if(senEl) senEl.textContent = fmtScore(risk ? risk.scenario_sensitivity_risk : null);
  }

  function initForecastTuner(forecastRaw, finance, actions, baseDate){
    const tunerPanel = document.getElementById('tuner_apply_btn');
    if(!tunerPanel) return;
    const forecast = forecastRaw || null;
    const baseActions = actions.slice();
    const baseRiskRows = (finance && finance.bank && finance.bank.risk && finance.bank.risk.risk_breakdown_rows)
      ? finance.bank.risk.risk_breakdown_rows.slice() : [];
    const chartEl = document.getElementById('forecast_balance_chart');
    const chart = (chartEl && window.echarts) ? echarts.init(chartEl) : null;
    const state = {
      forecast: forecast,
      finance: finance,
      actions: actions,
      baseActions: baseActions,
      baseRiskRows: baseRiskRows,
      chart: chart,
      params: null
    };

    if(!forecast){
      const hintEl = document.getElementById('forecast_balance_hint');
      if(hintEl) hintEl.textContent = '缺少预测数据，无法计算预测策略。';
      const noteEl = document.getElementById('tuner_balance_note');
      if(noteEl) noteEl.textContent = '余额口径：未加载预测数据';
      return;
    }

    function syncControls(path, value){
      const nodes = document.querySelectorAll(`.tuner-input[data-tuner-path="${path}"]`);
      nodes.forEach(node=>{
        if(node.tagName === 'SELECT'){
          node.value = value;
        }else{
          node.value = value;
        }
      });
    }

    function applyParamsToControls(params){
      document.querySelectorAll('.tuner-input').forEach(node=>{
        const path = node.getAttribute('data-tuner-path');
        if(!path) return;
        const val = getPath(params, path);
        if(val === undefined || val === null) return;
        node.value = val;
      });
    }

    function updateForecast(){
      if(!state.forecast) return;
      state.params = normalizeTunerParams(state.params || {});
      applyParamsToControls(state.params);
      writeTunerParamsToStorage(state.params);
      const computed = recomputeForecastWithTuner(state.forecast, state.params);
      if(!computed) return;
      const baseGap = getGapMetrics(computed.base.daily_recalc);
      const s1Gap = computed.scenarios && computed.scenarios.S1 ? getGapMetrics(computed.scenarios.S1.daily_recalc) : null;
      const coverage = buildForecastActions(computed, state.params, baseDate);
      if(computed.risk_recalc){
        const penalty = coverage.coverage_ratio < 0.8 ? Math.round((0.8 - coverage.coverage_ratio) * 100) : 0;
        const row = {
          risk_item:'行动覆盖率',
          formula:'Σ预期现金影响 / 缺口金额',
          threshold:'>= 80%',
          current_value: coverage.coverage_ratio,
          penalty: penalty,
          evidence_state_link:{ seg:'total', tab:'overview' }
        };
        computed.risk_recalc.breakdown_rows = (computed.risk_recalc.breakdown_rows || []).slice();
        computed.risk_recalc.breakdown_rows.push(row);
      }
      const hintEl = document.getElementById('forecast_balance_hint');
      if(hintEl){
        const inferred = computed.base.balance_inferred ? '余额口径为反推' : '余额口径为期初余额';
        hintEl.textContent = `${inferred}｜起始日 ${computed.base.base_date}`;
      }
      const balanceNote = document.getElementById('tuner_balance_note');
      if(balanceNote){
        balanceNote.textContent = computed.base.balance_inferred ? '余额口径：反推（基于首日余额）' : '余额口径：期初余额';
      }
      renderForecastGapKpis('forecast_gap_kpis', baseGap, coverage.coverage_ratio);
      renderForecastSummaries(baseGap, s1Gap || baseGap, coverage);
      renderForecastCards(baseGap, s1Gap || baseGap, computed.risk_recalc);
      renderForecastChart(state.chart, computed.base.daily_recalc, computed.scenarios || {});
      renderForecastRiskScores(computed.risk_recalc);

      state.actions.length = 0;
      coverage.actions.forEach(a=>state.actions.push(a));
      state.baseActions.forEach(a=>state.actions.push(a));
      renderActionTable(state.actions);
      renderForecastRiskOverlay(state.baseRiskRows, computed.risk_recalc, baseDate);
    }

    const debouncedUpdate = debounce(updateForecast, 160);
    const inputs = document.querySelectorAll('.tuner-input');
    inputs.forEach(node=>{
      node.addEventListener('input', ()=>{
        const path = node.getAttribute('data-tuner-path');
        if(!path) return;
        if(!state.params) state.params = deepClone(DEFAULT_TUNER_PARAMS);
        const val = node.tagName === 'SELECT' ? node.value : node.value;
        setPath(state.params, path, val);
        syncControls(path, val);
        debouncedUpdate();
      });
      node.addEventListener('change', ()=>{
        debouncedUpdate();
      });
    });

    const applyBtn = document.getElementById('tuner_apply_btn');
    if(applyBtn) applyBtn.onclick = ()=>updateForecast();

    const resetBtn = document.getElementById('tuner_reset_btn');
    if(resetBtn) resetBtn.onclick = ()=>{
      state.params = deepClone(DEFAULT_TUNER_PARAMS);
      applyParamsToControls(state.params);
      updateForecast();
    };

    const copyBtn = document.getElementById('tuner_copy_btn');
    if(copyBtn) copyBtn.onclick = ()=>{
      copyText(JSON.stringify(state.params || DEFAULT_TUNER_PARAMS, null, 2)).then(()=>showToast('已复制参数数据'));
    };

    const exportBtn = document.getElementById('tuner_export_btn');
    if(exportBtn) exportBtn.onclick = ()=>{
      downloadJson('预测参数.json', state.params || DEFAULT_TUNER_PARAMS);
    };

    const importInput = document.getElementById('tuner_import_input');
    if(importInput){
      importInput.addEventListener('change', (e)=>{
        const file = e.target.files && e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = ()=>{
          try{
            const raw = JSON.parse(reader.result);
            if(raw.version && raw.version !== TUNER_SCHEMA_VERSION){
              showToast('参数版本不匹配');
              importInput.value = '';
              return;
            }
            state.params = normalizeTunerParams(raw);
            applyParamsToControls(state.params);
            updateForecast();
            showToast('已导入参数');
            importInput.value = '';
          }catch(err){
            showToast('导入失败：参数文件格式错误');
            importInput.value = '';
          }
        };
        reader.readAsText(file);
      });
    }

    const shareBtn = document.getElementById('tuner_share_btn');
    if(shareBtn) shareBtn.onclick = ()=>{
      const link = buildTunerShareLink(state.params || DEFAULT_TUNER_PARAMS);
      copyText(link).then(()=>showToast('分享链接已复制'));
    };

    const fromUrl = readTunerParamsFromUrl();
    const fromStorage = readTunerParamsFromStorage();
    state.params = fromUrl || fromStorage || deepClone(DEFAULT_TUNER_PARAMS);
    applyParamsToControls(state.params);
    updateForecast();
  }

  function renderReport(dataRaw, financeRaw, forecastRaw){
    const data = normalizeData(dataRaw);
    const finance = normalizeFinanceData(financeRaw);
    const forecast = normalizeForecastData(forecastRaw || {});
    const seg = data.segments.total || { rows:[], months:[] };
    const rows = seg.rows || [];

    const range = deriveDateRange(rows);
    const financeMeta = finance.meta || {};
    const periodStart = financeMeta.period_start || range.start;
    const periodEnd = financeMeta.period_end || range.end;
    const periodText = (periodStart && periodEnd) ? (periodStart + ' 至 ' + periodEnd) : range.text;
    const salesVer = data.generatedAt || '—';
    const finVer = financeMeta.generated_at || '—';
    const currency = financeMeta.currency || '—';

    const metaPeriod = document.getElementById('meta_period');
    if(metaPeriod) metaPeriod.textContent = periodText || '—';
    const metaGen = document.getElementById('meta_generated');
    if(metaGen) metaGen.textContent = finVer || salesVer || '—';
    const metaCur = document.getElementById('meta_currency');
    if(metaCur) metaCur.textContent = currency || '—';
    const metaRange = document.getElementById('meta_range');
    if(metaRange) metaRange.textContent = periodText || range.text;
    const metaSales = document.getElementById('meta_sales_version');
    if(metaSales) metaSales.textContent = salesVer || '—';
    const metaFin = document.getElementById('meta_finance_version');
    if(metaFin) metaFin.textContent = finVer || '—';
    const metaCur2 = document.getElementById('meta_currency_2');
    if(metaCur2) metaCur2.textContent = currency || '—';

    const notes = Array.isArray(financeMeta.notes) ? financeMeta.notes : [];
    const noteList = document.getElementById('meta_notes_list');
    if(noteList){
      noteList.innerHTML = '';
      if(notes.length){
        notes.forEach(line=>{
          const li = document.createElement('li');
          li.textContent = line;
          noteList.appendChild(li);
        });
      }else{
        const li = document.createElement('li');
        li.textContent = '暂无备注。';
        noteList.appendChild(li);
      }
    }

    const totalSales = sumRows(rows, ROW_IDX.sales);
    const totalGp = sumRows(rows, ROW_IDX.gp);
    const totalGpAdj = sumRows(rows, ROW_IDX.gpAdj);
    const totalFee = sumRows(rows, ROW_IDX.fee);
    const gm = totalSales ? totalGp / totalSales * 100 : null;
    const gmAdj = totalSales ? totalGpAdj / totalSales * 100 : null;
    const totalOrders = uniqueCount(rows, ROW_IDX.order);
    const totalCustomers = uniqueCount(rows, ROW_IDX.cust);
    const totalCategories = uniqueCount(rows, ROW_IDX.cat);

    const monthly = buildMonthly(rows);
    const lastMonthIdx = monthly.months.length - 1;
    const lastSales = lastMonthIdx >= 0 ? monthly.sales[lastMonthIdx] : null;
    const prevSales = lastMonthIdx > 0 ? monthly.sales[lastMonthIdx - 1] : null;
    const lastGp = lastMonthIdx >= 0 ? monthly.gp[lastMonthIdx] : null;
    const prevGp = lastMonthIdx > 0 ? monthly.gp[lastMonthIdx - 1] : null;
    const lastGpAdj = lastMonthIdx >= 0 ? monthly.gpAdj[lastMonthIdx] : null;
    const prevGpAdj = lastMonthIdx > 0 ? monthly.gpAdj[lastMonthIdx - 1] : null;
    const lastGmAdj = lastSales ? (lastGpAdj / lastSales * 100) : null;
    const prevGmAdj = prevSales ? (prevGpAdj / prevSales * 100) : null;

    const lastMonth = lastMonthIdx >= 0 ? monthly.months[lastMonthIdx] : '';
    let yoySales = null;
    let yoyGp = null;
    let yoyGpAdj = null;
    let yoyGmAdj = null;
    let yoyGm = null;
    if(lastMonth){
      const yoyMonth = String(Number(lastMonth.slice(0,4)) - 1) + lastMonth.slice(4);
      const yoyIdx = monthly.months.indexOf(yoyMonth);
      if(yoyIdx >= 0){
        yoySales = monthly.sales[yoyIdx];
        yoyGp = monthly.gp[yoyIdx];
        yoyGpAdj = monthly.gpAdj[yoyIdx];
        yoyGm = yoySales ? (yoyGp / yoySales * 100) : null;
        yoyGmAdj = yoySales ? (yoyGpAdj / yoySales * 100) : null;
      }
    }

    const monthlyOrderCounts = buildMonthlyUniqueCounts(rows, ROW_IDX.order, monthly.months);
    const monthlyCustomerCounts = buildMonthlyUniqueCounts(rows, ROW_IDX.cust, monthly.months);
    const monthlyCategoryCounts = buildMonthlyUniqueCounts(rows, ROW_IDX.cat, monthly.months);

    const negativeLines = rows.filter(r=>Number(r && r[ROW_IDX.gpAdj]) < 0).length;

    const topCats = groupBy(rows, ROW_IDX.cat).slice(0, 6);
    const topCusts = groupBy(rows, ROW_IDX.cust).slice(0, 6);
    const topProds = groupBy(rows, ROW_IDX.prod).slice(0, 6);

    const wcKpi = finance.wc && finance.wc.kpi ? finance.wc.kpi : {};
    const arSegments = (finance.ar && finance.ar.segments) ? finance.ar.segments : {};
    const arSeg = arSegments.total ? arSegments.total : (finance.ar || {});
    const arKpi = arSeg.kpi || {};
    const apKpi = finance.ap && finance.ap.kpi ? finance.ap.kpi : {};
    const bankKpi = finance.bank && finance.bank.kpi ? finance.bank.kpi : {};
    const bankTrend = finance.bank && finance.bank.trend ? finance.bank.trend : {};
    const bankType = Array.isArray(finance.bank && finance.bank.by_type) ? finance.bank.by_type : [];
    const bankRecon = finance.bank && finance.bank.recon ? finance.bank.recon : {};
    const invKpi = finance.inventory && finance.inventory.kpi ? finance.inventory.kpi : {};
    const invTrend = finance.inventory && finance.inventory.trend ? finance.inventory.trend : {};
    const poKpi = finance.po && finance.po.kpi ? finance.po.kpi : {};
    const poTopSup = Array.isArray(finance.po && finance.po.top_suppliers) ? finance.po.top_suppliers : [];
    const poPrice = Array.isArray(finance.po && finance.po.price_trends) ? finance.po.price_trends : [];

    let otherAr = Array.isArray(arSeg.top_other_ar_customers) ? arSeg.top_other_ar_customers : [];
    if(!otherAr.length){
      otherAr = (arSeg.top_customers || []).filter(r=>Number(r.ending_other_ar) > 0).map(r=>({
        customer:r.customer,
        ending_other_ar:r.ending_other_ar,
        ending_net_ar:r.ending_net_ar
      }));
    }
    otherAr = otherAr.map(r=>Object.assign({}, r, {
      suggestion: buildOtherSuggestion(r.ending_other_ar, r.ending_net_ar, 'ar')
    }));
    let otherAp = Array.isArray(finance.ap && finance.ap.top_other_ap_suppliers) ? finance.ap.top_other_ap_suppliers : [];
    if(!otherAp.length){
      otherAp = (finance.ap && finance.ap.top_suppliers ? finance.ap.top_suppliers : []).filter(r=>Number(r.ending_other_ap) > 0).map(r=>({
        supplier:r.supplier,
        ending_other_ap:r.ending_other_ap,
        ending_net_ap:r.ending_net_ap
      }));
    }
    otherAp = otherAp.map(r=>Object.assign({}, r, {
      suggestion: buildOtherSuggestion(r.ending_other_ap, r.ending_net_ap, 'ap')
    }));

    const otherArTotal = otherAr.reduce((sum, r)=>sum + (Number(r.ending_other_ar) || 0), 0);
    const otherApTotal = otherAp.reduce((sum, r)=>sum + (Number(r.ending_other_ap) || 0), 0);
    const otherArRatio = arKpi.ending_net_ar ? otherArTotal / arKpi.ending_net_ar : null;
    const otherApRatio = apKpi.ending_net_ap ? otherApTotal / apKpi.ending_net_ap : null;

    const gmSeries = monthly.sales.map((v,i)=> v ? monthly.gp[i] / v * 100 : null);
    const gmAdjSeries = monthly.sales.map((v,i)=> v ? monthly.gpAdj[i] / v * 100 : null);

    const arMonths = (arSeg.trend && arSeg.trend.months) || [];
    const apMonths = (finance.ap && finance.ap.trend && finance.ap.trend.months) || [];
    const invMonths = invTrend.months || [];
    const bankMonths = bankTrend.months || [];

    const execKpiItems = [
      { label:'销售额（含税）', value: fmtWan(totalSales), sub: fmtYi(totalSales), spark:{ id:'kpi_spark_sales', data:monthly.sales, color:'#f05a3e' }, detail:{ series:{ label:'月度销售额', months: monthly.months, values: monthly.sales, formatter: fmtWan } } },
      { label:'毛利', value: fmtWan(totalGp), spark:{ id:'kpi_spark_gp', data:monthly.gp, color:'#148a78' }, detail:{ series:{ label:'月度毛利', months: monthly.months, values: monthly.gp, formatter: fmtWan } } },
      { label:'综合毛利率', value: fmtPct(gm), spark:{ id:'kpi_spark_gm', data:gmSeries, color:'#148a78' }, detail:{ series:{ label:'月度综合毛利率', months: monthly.months, values: gmSeries, formatter: fmtPct } } },
      { label:'毛利-销售费', value: fmtWan(totalGpAdj), spark:{ id:'kpi_spark_gpadj', data:monthly.gpAdj, color:'#f05a3e' }, detail:{ series:{ label:'月度毛利-销售费', months: monthly.months, values: monthly.gpAdj, formatter: fmtWan } } },
      { label:'毛利率（扣费）', value: fmtPct(gmAdj), spark:{ id:'kpi_spark_gmadj', data:gmAdjSeries, color:'#f05a3e' }, detail:{ series:{ label:'月度毛利率（扣费）', months: monthly.months, values: gmAdjSeries, formatter: fmtPct } } },
      { label:'订单数', value: totalOrders.toLocaleString('en-US'), spark:{ id:'kpi_spark_orders', data:monthlyOrderCounts }, detail:{ series:{ label:'月度订单数', months: monthly.months, values: monthlyOrderCounts, formatter:(v)=>toNumber(v) === null ? '—' : Number(v).toLocaleString('en-US') } } },
      { label:'客户数', value: totalCustomers.toLocaleString('en-US'), spark:{ id:'kpi_spark_customers', data:monthlyCustomerCounts }, detail:{ series:{ label:'月度客户数', months: monthly.months, values: monthlyCustomerCounts, formatter:(v)=>toNumber(v) === null ? '—' : Number(v).toLocaleString('en-US') } } },
      { label:'品类数', value: totalCategories.toLocaleString('en-US'), spark:{ id:'kpi_spark_cats', data:monthlyCategoryCounts }, detail:{ series:{ label:'月度品类数', months: monthly.months, values: monthlyCategoryCounts, formatter:(v)=>toNumber(v) === null ? '—' : Number(v).toLocaleString('en-US') } } },
      { label:'期间净现金流', value: fmtWan(bankKpi.period_net_cash), spark:{ id:'kpi_spark_netcash', data:bankTrend.net_cash || [] }, detail:{ series:{ label:'月度净现金流', months: bankMonths, values: bankTrend.net_cash || [], formatter: fmtWan } } },
      { label:'期间流入', value: fmtWan(bankKpi.period_cash_in), spark:{ id:'kpi_spark_cashin', data:bankTrend.cash_in || [] }, detail:{ series:{ label:'月度现金流入', months: bankMonths, values: bankTrend.cash_in || [], formatter: fmtWan } } },
      { label:'期间流出', value: fmtWan(bankKpi.period_cash_out), spark:{ id:'kpi_spark_cashout', data:bankTrend.cash_out || [] }, detail:{ series:{ label:'月度现金流出', months: bankMonths, values: bankTrend.cash_out || [], formatter: fmtWan } } },
      { label:'应收周转天数(天)', value: fmtDays(wcKpi.dso_days_est || arKpi.dso_days_est), spark:{ id:'kpi_spark_dso', data:(arSeg.trend && arSeg.trend.cash_receipts) || [] }, detail:{ rows:[{ label:'贸易应收余额', value: fmtWan(arKpi.ending_sales_ar) }, { label:'期末净应收', value: fmtWan(arKpi.ending_net_ar) }, { label:'期间开票', value: fmtWan(arKpi.period_sales_invoiced) }, { label:'期间回款', value: fmtWan(arKpi.period_cash_receipts) }], series:{ label:'月度回款', months: arMonths, values:(arSeg.trend && arSeg.trend.cash_receipts) || [], formatter: fmtWan } } },
      { label:'应付周转天数(天)', value: fmtDays(wcKpi.dpo_days_est || apKpi.dpo_days_est), spark:{ id:'kpi_spark_dpo', data:(finance.ap && finance.ap.trend && finance.ap.trend.cash_payments) || [] }, detail:{ rows:[{ label:'采购应付余额', value: fmtWan(apKpi.ending_purchase_ap) }, { label:'期末净应付', value: fmtWan(apKpi.ending_net_ap) }, { label:'期间采购发票', value: fmtWan(apKpi.period_purchases_invoiced) }, { label:'期间现金付款', value: fmtWan(apKpi.period_cash_payments) }], series:{ label:'月度付款', months: apMonths, values:(finance.ap && finance.ap.trend && finance.ap.trend.cash_payments) || [], formatter: fmtWan } } },
      { label:'存货周转天数(天)', value: fmtDays(wcKpi.dio_days_est || invKpi.dio_days_est), spark:{ id:'kpi_spark_dio', data:invTrend.ending_inventory || [] }, detail:{ rows:[{ label:'期初库存', value: fmtWan(invKpi.inventory_start) }, { label:'期末库存', value: fmtWan(invKpi.inventory_end) }, { label:'日均库存', value: fmtWan(invKpi.inventory_avg) }, { label:'期间销售成本', value: fmtWan(invKpi.period_cogs) }], series:{ label:'月度期末库存', months: invMonths, values: invTrend.ending_inventory || [], formatter: fmtWan } } },
      { label:'现金转换周期(天)', value: fmtDays(wcKpi.ccc_days_est), spark:{ id:'kpi_spark_ccc', data:bankTrend.net_cash || [] }, detail:{ rows:[{ label:'应收周转天数', value: fmtDays(wcKpi.dso_days_est || arKpi.dso_days_est) }, { label:'应付周转天数', value: fmtDays(wcKpi.dpo_days_est || apKpi.dpo_days_est) }, { label:'存货周转天数', value: fmtDays(wcKpi.dio_days_est || invKpi.dio_days_est) }], series:{ label:'月度净现金流', months: bankMonths, values: bankTrend.net_cash || [], formatter: fmtWan } } },
      { label:'贸易应收余额', value: fmtWan(arKpi.ending_sales_ar), spark:{ id:'kpi_spark_ar', data:(arSeg.trend && arSeg.trend.sales_invoiced) || [] }, detail:{ rows:[{ label:'期末净应收', value: fmtWan(arKpi.ending_net_ar) }, { label:'其他应收余额', value: fmtWan(arKpi.ending_other_ar) }, { label:'预收余额', value: fmtWan(arKpi.ending_pre_receipt) }, { label:'无票挂账', value: fmtWan(arKpi.no_sales_invoice_balance) }], series:{ label:'月度开票', months: arMonths, values:(arSeg.trend && arSeg.trend.sales_invoiced) || [], formatter: fmtWan } } },
      { label:'期末净应收', value: fmtWan(arKpi.ending_net_ar), spark:{ id:'kpi_spark_netar', data:(arSeg.trend && arSeg.trend.sales_invoiced) || [] }, detail:{ rows:[{ label:'贸易应收余额', value: fmtWan(arKpi.ending_sales_ar) }, { label:'其他应收余额', value: fmtWan(arKpi.ending_other_ar) }, { label:'预收余额', value: fmtWan(arKpi.ending_pre_receipt) }], series:{ label:'月度开票', months: arMonths, values:(arSeg.trend && arSeg.trend.sales_invoiced) || [], formatter: fmtWan } } },
      { label:'贸易应付余额', value: fmtWan(apKpi.ending_purchase_ap), spark:{ id:'kpi_spark_ap', data:(finance.ap && finance.ap.trend && finance.ap.trend.purchases_invoiced) || [] }, detail:{ rows:[{ label:'期末净应付', value: fmtWan(apKpi.ending_net_ap) }, { label:'其他应付余额', value: fmtWan(apKpi.ending_other_ap) }, { label:'预付余额', value: fmtWan(apKpi.ending_prepay) }], series:{ label:'月度采购发票', months: apMonths, values:(finance.ap && finance.ap.trend && finance.ap.trend.purchases_invoiced) || [], formatter: fmtWan } } },
      { label:'期末净应付', value: fmtWan(apKpi.ending_net_ap), spark:{ id:'kpi_spark_netap', data:(finance.ap && finance.ap.trend && finance.ap.trend.purchases_invoiced) || [] }, detail:{ rows:[{ label:'采购应付余额', value: fmtWan(apKpi.ending_purchase_ap) }, { label:'其他应付余额', value: fmtWan(apKpi.ending_other_ap) }, { label:'预付余额', value: fmtWan(apKpi.ending_prepay) }], series:{ label:'月度采购发票', months: apMonths, values:(finance.ap && finance.ap.trend && finance.ap.trend.purchases_invoiced) || [], formatter: fmtWan } } },
      { label:'期末库存', value: fmtWan(invKpi.inventory_end), spark:{ id:'kpi_spark_inv', data:invTrend.ending_inventory || [] }, detail:{ rows:[{ label:'期初库存', value: fmtWan(invKpi.inventory_start) }, { label:'日均库存', value: fmtWan(invKpi.inventory_avg) }, { label:'期间入库', value: fmtWan(invKpi.period_purchases_in) }, { label:'期间销售成本', value: fmtWan(invKpi.period_cogs) }], series:{ label:'月度期末库存', months: invMonths, values: invTrend.ending_inventory || [], formatter: fmtWan } } }
    ];
    execKpiItems.forEach(item=>{
      item.evidenceLink = buildEvidenceLink(buildKpiEvidence(item, 'total'), '查看证据');
    });
    bindKpiDetailModal();
    renderKpis('exec_kpis', execKpiItems, openKpiDetail);

    renderMiniKpis('cash_kpis', [
      { label:'期间流入', value: fmtWan(bankKpi.period_cash_in) },
      { label:'期间流出', value: fmtWan(bankKpi.period_cash_out) },
      { label:'净现金流', value: fmtWan(bankKpi.period_net_cash) },
      { label:'期末累计净现金流', value: fmtWan(bankKpi.period_cum_net_cash_end) }
    ]);

    renderMiniKpis('ar_kpis', [
      { label:'贸易应收余额', value: fmtWan(arKpi.ending_sales_ar) },
      { label:'期末净应收', value: fmtWan(arKpi.ending_net_ar) },
      { label:'应收周转天数(天)', value: fmtDays(arKpi.dso_days_est) },
      { label:'第一名占比', value: fmtRatio(arKpi.top1_ratio) },
      { label:'前十名占比', value: fmtRatio(arKpi.top10_ratio) }
    ]);

    renderMiniKpis('ap_kpis', [
      { label:'采购应付余额', value: fmtWan(apKpi.ending_purchase_ap) },
      { label:'期末应付净额', value: fmtWan(apKpi.ending_net_ap) },
      { label:'应付周转天数(天)', value: fmtDays(apKpi.dpo_days_est || wcKpi.dpo_days_est) },
      { label:'第一名占比', value: fmtRatio(apKpi.top1_ratio) },
      { label:'前十名占比', value: fmtRatio(apKpi.top10_ratio) }
    ]);

    renderMiniKpis('inventory_kpis', [
      { label:'期初库存', value: fmtWan(invKpi.inventory_start) },
      { label:'期末库存', value: fmtWan(invKpi.inventory_end) },
      { label:'库存均值', value: fmtWan(invKpi.inventory_avg) },
      { label:'存货周转天数(天)', value: fmtDays(invKpi.dio_days_est) }
    ]);

    renderMiniKpis('po_kpis', [
      { label:'期间入库金额', value: fmtWan(poKpi.period_inbound_amount) },
      { label:'第一名供应商占比', value: fmtRatio(poKpi.top1_supplier_ratio) },
      { label:'第二名供应商占比', value: fmtRatio(poKpi.top2_supplier_ratio) }
    ]);

    const segmentRows = ['total','store','nonstore'].map(segKey=>{
      const segData = data.segments && data.segments[segKey] ? data.segments[segKey] : { rows:[] };
      const segRows = segData.rows || [];
      const hasRows = !!segRows.length;
      const segSales = hasRows ? sumRows(segRows, ROW_IDX.sales) : null;
      const segGp = hasRows ? sumRows(segRows, ROW_IDX.gp) : null;
      const segGm = segSales ? segGp / segSales * 100 : null;
      const segTop1 = groupBy(segRows, ROW_IDX.cust)[0];
      const segTop1Ratio = segSales && segTop1 ? segTop1.sales / segSales * 100 : null;
      const segAr = arSegments && arSegments[segKey] ? arSegments[segKey] : {};
      const segArKpi = segAr.kpi || {};
      return {
        seg: segKey,
        sales: segSales,
        gp: segGp,
        gm: segGm,
        netCash: segKey === 'total' ? bankKpi.period_net_cash : null,
        netAr: segArKpi.ending_net_ar,
        netAp: segKey === 'total' ? apKpi.ending_net_ap : null,
        inventory: segKey === 'total' ? invKpi.inventory_end : null,
        dso: segArKpi.dso_days_est,
        dpo: segKey === 'total' ? (apKpi.dpo_days_est || wcKpi.dpo_days_est) : null,
        dio: segKey === 'total' ? (invKpi.dio_days_est || wcKpi.dio_days_est) : null,
        ccc: segKey === 'total' ? wcKpi.ccc_days_est : null,
        top1: segTop1Ratio
      };
    });
    renderSegmentMatrix(segmentRows);

    renderTable('sales_top_categories_table', topCats, [
      { key:'key' },
      { key:'sales' },
      { key:'share' },
      { key:'gm' },
      { key:'gmAdj' }
    ], [
      (v, row)=>buildEvidenceLink({
        seg:'total',
        tab:'category',
        tableId:'total_category_table',
        filterFirstColValue: row.key,
        anchor:'total_category_table'
      }, fmtText(v)),
      (v)=>fmtWan(v),
      (v, row)=>{
        const ratio = totalSales ? (row.sales / totalSales * 100) : null;
        return fmtPct(ratio);
      },
      (v)=>fmtPct(v),
      (v)=>fmtPct(v)
    ]);

    renderTable('sales_top_customers_table', topCusts, [
      { key:'key' },
      { key:'sales' },
      { key:'share' },
      { key:'gm' },
      { key:'gmAdj' }
    ], [
      (v, row)=>buildEvidenceLink({
        seg:'total',
        tab:'customer',
        tableId:'total_customer_table',
        filterFirstColValue: row.key,
        anchor:'total_customer_table'
      }, fmtText(v)),
      (v)=>fmtWan(v),
      (v, row)=>{
        const ratio = totalSales ? (row.sales / totalSales * 100) : null;
        return fmtPct(ratio);
      },
      (v)=>fmtPct(v),
      (v)=>fmtPct(v)
    ]);

    renderTable('sales_top_products_table', topProds, [
      { key:'key' },
      { key:'sales' },
      { key:'share' },
      { key:'gm' },
      { key:'gmAdj' }
    ], [
      (v, row)=>buildEvidenceLink({
        seg:'total',
        tab:'product',
        tableId:'total_product_table',
        filterFirstColValue: row.key,
        anchor:'total_product_table'
      }, fmtText(v)),
      (v)=>fmtWan(v),
      (v, row)=>{
        const ratio = totalSales ? (row.sales / totalSales * 100) : null;
        return fmtPct(ratio);
      },
      (v)=>fmtPct(v),
      (v)=>fmtPct(v)
    ]);

    renderTable('bank_type_table', bankType, [
      { key:'type' },
      { key:'cash_in' },
      { key:'cash_out' },
      { key:'count' }
    ], [
      (v)=>fmtText(v),
      (v)=>fmtWan(v),
      (v)=>fmtWan(v),
      (v)=>fmtText(v)
    ]);

    renderTable('ar_top_customers_table', (arSeg.top_customers || []).slice(0, 10), [
      { key:'customer' },
      { key:'ending_sales_ar' },
      { key:'ending_net_ar' },
      { key:'share' }
    ], [
      (v, row)=>buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ar_table',
        filterFirstColValue: row.customer,
        anchor:'total_finance_ar_table'
      }, fmtText(v)),
      (v)=>fmtWan(v),
      (v)=>fmtWan(v),
      (v, row)=>{
        const ratio = arKpi.ending_sales_ar ? (Number(row.ending_sales_ar) / arKpi.ending_sales_ar * 100) : null;
        return fmtPct(ratio);
      }
    ]);

    renderTable('other_ar_table', otherAr, [
      { key:'customer' },
      { key:'ending_other_ar' },
      { key:'ending_net_ar' },
      { key:'suggestion' }
    ], [
      (v, row)=>buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ar_other_table',
        filterFirstColValue: row.customer,
        anchor:'total_finance_ar_other_table'
      }, fmtText(v)),
      (v)=>fmtWan(v),
      (v)=>fmtWan(v),
      (v)=>fmtText(v)
    ]);

    renderTable('ap_top_suppliers_table', (finance.ap && finance.ap.top_suppliers ? finance.ap.top_suppliers : []).slice(0, 10), [
      { key:'supplier' },
      { key:'ending_purchase_ap' },
      { key:'ending_net_ap' },
      { key:'share' }
    ], [
      (v, row)=>buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ap_table',
        filterFirstColValue: row.supplier,
        anchor:'total_finance_ap_table'
      }, fmtText(v)),
      (v)=>fmtWan(v),
      (v)=>fmtWan(v),
      (v, row)=>{
        const ratio = apKpi.ending_purchase_ap ? (Number(row.ending_purchase_ap) / apKpi.ending_purchase_ap * 100) : null;
        return fmtPct(ratio);
      }
    ]);

    renderTable('other_ap_table', otherAp, [
      { key:'supplier' },
      { key:'ending_other_ap' },
      { key:'ending_net_ap' },
      { key:'suggestion' }
    ], [
      (v, row)=>buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ap_other_table',
        filterFirstColValue: row.supplier,
        anchor:'total_finance_ap_other_table'
      }, fmtText(v)),
      (v)=>fmtWan(v),
      (v)=>fmtWan(v),
      (v)=>fmtText(v)
    ]);

    renderTable('po_top_suppliers_table', poTopSup.slice(0, 10), [
      { key:'supplier' },
      { key:'amount' },
      { key:'share' }
    ], [
      (v, row)=>buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_po_sup_table',
        filterFirstColValue: row.supplier,
        anchor:'total_finance_po_sup_table'
      }, fmtText(v)),
      (v)=>fmtWan(v),
      (v, row)=>{
        const ratio = poKpi.period_inbound_amount ? (Number(row.amount) / poKpi.period_inbound_amount * 100) : null;
        return fmtPct(ratio);
      }
    ]);

    const inventoryFocus = document.getElementById('inventory_focus');
    if(inventoryFocus){
      const invChange = (toNumber(invKpi.inventory_end) || 0) - (toNumber(invKpi.inventory_start) || 0);
      const msg = `期末库存${fmtWan(invKpi.inventory_end)}，较期初${fmtSignedWan(invChange)}；存货周转天数 ${fmtDays(invKpi.dio_days_est)} 天。`;
      inventoryFocus.textContent = msg;
    }

    const arReceiptsTotal = (arSeg.trend && Array.isArray(arSeg.trend.cash_receipts))
      ? arSeg.trend.cash_receipts.reduce((sum,v)=>sum + (Number(v) || 0), 0) : null;
    const apPaymentsTotal = (finance.ap && finance.ap.trend && Array.isArray(finance.ap.trend.cash_payments))
      ? finance.ap.trend.cash_payments.reduce((sum,v)=>sum + (Number(v) || 0), 0) : null;
    const bankCashInTotal = Array.isArray(bankTrend.cash_in) ? bankTrend.cash_in.reduce((sum,v)=>sum + (Number(v) || 0), 0) : null;
    const bankCashOutTotal = Array.isArray(bankTrend.cash_out) ? bankTrend.cash_out.reduce((sum,v)=>sum + (Number(v) || 0), 0) : null;
    const reconReceiptsDiff = (arReceiptsTotal !== null && bankCashInTotal !== null) ? (arReceiptsTotal - bankCashInTotal) : null;
    const reconPaymentsDiff = (apPaymentsTotal !== null && bankCashOutTotal !== null) ? (apPaymentsTotal - bankCashOutTotal) : null;

    const reconReceipts = document.getElementById('bank_recon_receipts');
    if(reconReceipts){
      reconReceipts.innerHTML = '';
      reconReceipts.appendChild(buildMiniCard('应收回款与银行流入差异', fmtWan(reconReceiptsDiff), '对比口径：应收回款对比银行流入'));
    }
    const reconPayments = document.getElementById('bank_recon_payments');
    if(reconPayments){
      reconPayments.innerHTML = '';
      reconPayments.appendChild(buildMiniCard('应付付款与银行流出差异', fmtWan(reconPaymentsDiff), '对比口径：应付付款对比银行流出'));
    }

    const reconExplain = document.getElementById('bank_recon_explain');
    if(reconExplain){
      reconExplain.innerHTML = '';
      if(!bankType.length){
        reconExplain.textContent = '缺少银行类型汇总数据，无法给出差异解释候选。';
      }else{
        const nonOps = bankType.filter(r=>{
          const name = String(r.type || '').trim();
          if(!name) return false;
          return !/销售|采购|回款|付款|客户|供应商|营业|主营/.test(name);
        });
        const base = nonOps.length ? nonOps : bankType.slice();
        base.sort((a,b)=>((Number(b.cash_in)||0)+(Number(b.cash_out)||0)) - ((Number(a.cash_in)||0)+(Number(a.cash_out)||0)));
        const top = base.slice(0,3);
        const ul = document.createElement('ul');
        ul.className = 'report-list';
        top.forEach(item=>{
          const net = (Number(item.cash_in)||0) - (Number(item.cash_out)||0);
          const li = document.createElement('li');
          li.textContent = `${fmtText(item.type)}：净额 ${fmtSignedWan(net)}，建议动作：分类 → 对账 → 科目调整`;
          ul.appendChild(li);
        });
        reconExplain.appendChild(ul);
      }
    }

    renderLineBarChart('sales_trend_chart', monthly.months, [
      { name:'销售额', type:'bar', data: monthly.sales, barMaxWidth:30 },
      { name:'毛利-销售费', type:'line', data: monthly.gpAdj, smooth:true, yAxisIndex:1 }
    ]);

    const momSalesDelta = (lastSales !== null && prevSales !== null) ? (lastSales - prevSales) : null;
    const momGpDelta = (lastGp !== null && prevGp !== null) ? (lastGp - prevGp) : null;
    const momGmDelta = (lastSales && prevSales && lastGp !== null && prevGp !== null)
      ? (lastGp / lastSales * 100 - prevGp / prevSales * 100) : null;
    const yoySalesDelta = (lastSales !== null && yoySales !== null) ? (lastSales - yoySales) : null;
    const yoyGpDelta = (lastGp !== null && yoyGp !== null) ? (lastGp - yoyGp) : null;
    const yoyGmDelta = (lastSales && yoySales && lastGp !== null && yoyGp !== null)
      ? (lastGp / lastSales * 100 - yoyGp / yoySales * 100) : null;

    const momText = document.getElementById('sales_mom_text');
    if(momText){
      const momParts = [
        `环比Δ销售 ${fmtSignedWan(momSalesDelta)}`,
        `Δ毛利 ${fmtSignedWan(momGpDelta)}`,
        `Δ毛利率 ${momGmDelta === null ? '—' : (momGmDelta > 0 ? '+' : '') + momGmDelta.toFixed(2) + 'pct' }`
      ];
      const yoyParts = (yoySalesDelta !== null || yoyGpDelta !== null || yoyGmDelta !== null) ? [
        `同比Δ销售 ${fmtSignedWan(yoySalesDelta)}`,
        `Δ毛利 ${fmtSignedWan(yoyGpDelta)}`,
        `Δ毛利率 ${yoyGmDelta === null ? '—' : (yoyGmDelta > 0 ? '+' : '') + yoyGmDelta.toFixed(2) + 'pct' }`
      ] : [];
      const out = momParts.slice();
      if(yoyParts.length) out.push('同比：' + yoyParts.join('，'));
      momText.textContent = out.join('，');
    }

    renderDeltaBridgeChart(
      'sales_mom_bridge',
      ['销售额','毛利','毛利率'],
      [momSalesDelta, momGpDelta, null],
      [null, null, momGmDelta],
      [yoySalesDelta, yoyGpDelta, null],
      [null, null, yoyGmDelta]
    );

    renderLineChart('cash_trend_chart', bankTrend.months || [], [
      { name:'现金流入', type:'bar', data: bankTrend.cash_in || [], barMaxWidth:26 },
      { name:'现金流出', type:'bar', data: bankTrend.cash_out || [], barMaxWidth:26 },
      { name:'净现金流', type:'line', data: bankTrend.net_cash || [], smooth:true }
    ]);

    renderLineChart('ar_trend_chart', (arSeg.trend && arSeg.trend.months) || [], [
      { name:'开票', type:'bar', data: (arSeg.trend && arSeg.trend.sales_invoiced) || [], barMaxWidth:26 },
      { name:'回款', type:'line', data: (arSeg.trend && arSeg.trend.cash_receipts) || [], smooth:true }
    ]);

    renderLineChart('ap_trend_chart', (finance.ap && finance.ap.trend && finance.ap.trend.months) || [], [
      { name:'采购发票', type:'bar', data: (finance.ap && finance.ap.trend && finance.ap.trend.purchases_invoiced) || [], barMaxWidth:26 },
      { name:'现金付款', type:'line', data: (finance.ap && finance.ap.trend && finance.ap.trend.cash_payments) || [], smooth:true }
    ]);

    renderLineChart('inventory_trend_chart', invTrend.months || [], [
      { name:'入库', type:'bar', data: invTrend.purchases_in || [], barMaxWidth:26 },
      { name:'销售成本', type:'bar', data: invTrend.cogs || [], barMaxWidth:26 },
      { name:'期末库存', type:'line', data: invTrend.ending_inventory || [], smooth:true }
    ]);

    let priceTarget = poPrice[0];
    if(poPrice.length){
      priceTarget = poPrice.reduce((a,b)=> (Number(b.amount)||0) > (Number(a.amount)||0) ? b : a);
    }
    const priceTitle = document.getElementById('po_price_title');
    if(priceTitle){
      const name = priceTarget ? (priceTarget.product || priceTarget.sku || '货号') : '货号';
      priceTitle.textContent = '关键货号价格走势：' + name;
    }
    renderLineChart('po_price_chart', (priceTarget && priceTarget.months) || [], [
      { name:'均价', type:'line', data: (priceTarget && priceTarget.avg_unit_cost) || [], smooth:true }
    ]);

    const baseDate = periodEnd || range.end || formatDate(new Date());
    const forecastResult = generateForecastActions(forecast, finance, THRESHOLDS);
    const forecastActions = forecastResult.actions || [];
    const conclusions = {
      sec0: [],
      exec: [],
      sec2: [],
      sec3: [],
      sec4: [],
      sec5: [],
      sec6: [],
      sec7: [],
      sec8: [],
      sec9: [],
      sec10: [],
      sec11: []
    };

    const actions = [];

    otherAr.forEach(row=>{
      actions.push({
        source:'专项清理',
        domain:'其他应收',
        signal:`${fmtText(row.customer)} 余额${fmtWan(row.ending_other_ar)}`,
        owner:'财务负责人',
        task: row.suggestion || '专项对账与清理',
        ddl:addDays(baseDate, ACTION_DAYS.long),
        impact:'降低其他应收余额',
        link: buildEvidenceLink({
          seg:'total',
          tab:'finance',
          tableId:'total_finance_ar_other_table',
          filterFirstColValue: row.customer,
          anchor:'total_finance_ar_other_table'
        }, '查看证据')
      });
    });

    otherAp.forEach(row=>{
      actions.push({
        source:'专项清理',
        domain:'其他应付',
        signal:`${fmtText(row.supplier)} 余额${fmtWan(row.ending_other_ap)}`,
        owner:'财务负责人',
        task: row.suggestion || '专项对账与清理',
        ddl:addDays(baseDate, ACTION_DAYS.long),
        impact:'降低其他应付余额',
        link: buildEvidenceLink({
          seg:'total',
          tab:'finance',
          tableId:'total_finance_ap_other_table',
          filterFirstColValue: row.supplier,
          anchor:'total_finance_ap_other_table'
        }, '查看证据')
      });
    });

    addConclusion(conclusions.sec0, actions, {
      source:'口径',
      domain:'对账',
      title:'口径与对账基线已明确，需锁定版本防止口径漂移。',
      evidence:`销售版本${salesVer}，财务版本${finVer}，期间${periodText}`,
      action:{ owner:'财务负责人', task:'固化口径说明并发布版本号，确保后续分析口径一致', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'避免多口径导致结论失真' },
      link: buildEvidenceLink({ seg:'total', tab:'overview' }, '查看证据')
    });

    const topCust = topCusts[0];
    const topCat = topCats[0];
    const cashNegative = toNumber(bankKpi.period_net_cash) !== null && toNumber(bankKpi.period_net_cash) < 0;
    const gmAdjNote = gmAdj !== null && gmAdj < 8 ? '扣费毛利率偏低' : '扣费毛利率在可控区间';

    addConclusion(conclusions.exec, actions, {
      source:'经营摘要',
      domain:'收入与毛利',
      title:'盈利能力需盯紧“扣费毛利率”与销售费用结构。',
      evidence:`销售额${fmtWan(totalSales)}，毛利率${fmtPct(gm)}，扣费毛利率${fmtPct(gmAdj)}；${gmAdjNote}`,
      action:{ owner:'销售负责人', task:'复盘低毛利品类/客户价格与费用，调整折扣与费用政策', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'提升扣费毛利率 0.5-1pct' },
      link: buildEvidenceLink({ seg:'total', tab:'overview' }, '查看证据')
    });

    if(topCust){
      addConclusion(conclusions.exec, actions, {
        source:'经营摘要',
        domain:'客户结构',
        title:'客户集中度偏高需建立备份增长通道。',
        evidence:`客户第一名 ${fmtText(topCust.key)} 销售额${fmtWan(topCust.sales)}（占比${fmtPct(totalSales ? topCust.sales/totalSales*100 : null)}）`,
        action:{ owner:'大客户经理', task:'推进第一名客户回款与续约，同时拓展前五名以外客户替代', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'降低集中度风险、提升可持续增长' },
        link: buildEvidenceLink({
          seg:'total',
          tab:'customer',
          tableId:'total_customer_table',
          filterFirstColValue: topCust.key,
          anchor:'total_customer_table'
        }, '查看证据')
      });
    }

    addConclusion(conclusions.exec, actions, {
      source:'经营摘要',
      domain:'现金流',
      title: cashNegative ? '净现金流为负需优先修复收付节奏。' : '现金流总体可控但需持续监控收付节奏。',
      evidence:`期间净现金流${fmtWan(bankKpi.period_net_cash)}，流入${fmtWan(bankKpi.period_cash_in)} / 流出${fmtWan(bankKpi.period_cash_out)}`,
      action:{ owner:'资金经理', task: cashNegative ? '压缩非核心支出并安排重点客户回款' : '优化收付节奏，减少波动', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'稳定现金头寸，降低融资压力' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据')
    });

    addConclusion(conclusions.exec, actions, {
      source:'经营摘要',
      domain:'周转',
      title:'应收周转天数/现金转换周期仍需关注回款与库存协同。',
      evidence:`应收周转天数 ${fmtDays(wcKpi.dso_days_est)} 天，现金转换周期 ${fmtDays(wcKpi.ccc_days_est)} 天，库存${fmtWan(invKpi.inventory_end)}`,
      action:{ owner:'财务业务伙伴', task:'制定回款与库存去化双周计划，跟踪关键客户/品类', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'压缩现金转换周期 5-10 天' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据')
    });

    addConclusion(conclusions.exec, actions, {
      source:'经营摘要',
      domain:'收入结构',
      title:'结构贡献与异常订单需同步治理。',
      evidence:`品类第一名 ${fmtText(topCat && topCat.key)} 毛利_扣费${fmtWan(topCat && topCat.gpAdj)}；异常订单行数${negativeLines}`,
      action:{ owner:'品类负责人', task:'对低毛利/负毛利订单做价格与费用复盘，必要时调整策略', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'减少异常订单，提升结构性毛利' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'abnormal',
        tableId:'total_abnormal_table',
        anchor:'total_abnormal_table'
      }, '查看证据')
    });

    const sec2Conc = [];
    addConclusion(sec2Conc, actions, {
      source:'收入与毛利',
      domain:'趋势',
      title:'销售趋势与扣费毛利需要同步监控波动。',
      evidence:`最新月份销售额${fmtWan(lastSales)}，上月${fmtWan(prevSales)}；扣费毛利率${fmtPct(gmAdj)}`,
      action:{ owner:'销售分析', task:'拆解月度波动来源（客户/品类/产品），输出异常订单清单', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'降低波动并提升预测准确性' },
      link: buildEvidenceLink({ seg:'total', tab:'overview' }, '查看证据')
    });
    conclusions.sec2 = sec2Conc;

    const sec3Conc = [];
    addConclusion(sec3Conc, actions, {
      source:'现金流',
      domain:'对账',
      title:'银行对账差异需闭环到明细层。',
      evidence:`收款差异${fmtWan(reconReceiptsDiff)}，付款差异${fmtWan(reconPaymentsDiff)}`,
      action:{ owner:'出纳', task:'逐笔核对收付明细与账簿，输出差异原因与调整计划', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'降低对账差异，提升现金流可信度' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_bank_type_table',
        anchor:'total_finance_bank_type_table'
      }, '查看证据')
    });
    conclusions.sec3 = sec3Conc;

    const sec4Conc = [];
    addConclusion(sec4Conc, actions, {
      source:'应收',
      domain:'应收',
      title:'应收集中度偏高需加快回款与额度控制。',
      evidence:`第一名占比${fmtRatio(arKpi.top1_ratio)}，前十名占比${fmtRatio(arKpi.top10_ratio)}；贸易应收${fmtWan(arKpi.ending_sales_ar)}`,
      action:{ owner:'收款负责人', task:'锁定头部客户回款计划并设置额度上限', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'降低集中度与逾期风险' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ar_table',
        filterFirstColValue:(arSeg.top_customers && arSeg.top_customers[0] && arSeg.top_customers[0].customer) || '',
        anchor:'total_finance_ar_table'
      }, '查看证据')
    });
    conclusions.sec4 = sec4Conc;

    const sec5Conc = [];
    addConclusion(sec5Conc, actions, {
      source:'其他应收',
      domain:'专项',
      title:'其他应收需专项清理并纳入周度跟踪。',
      evidence:`其他应收合计${fmtWan(otherArTotal)}（占净应收${fmtRatio(otherArRatio)}）`,
      action:{ owner:'财务负责人', task:'逐客户核对其他应收形成原因，制定清理与冲销计划', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'回收存量资金，降低坏账风险' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ar_other_table',
        filterFirstColValue: otherAr[0] && otherAr[0].customer,
        anchor:'total_finance_ar_other_table'
      }, '查看证据')
    });
    conclusions.sec5 = sec5Conc;

    const sec6Conc = [];
    addConclusion(sec6Conc, actions, {
      source:'应付',
      domain:'应付',
      title:'应付周转天数偏高需关注供应商风险与谈判策略。',
      evidence:`应付周转天数 ${fmtDays(apKpi.dpo_days_est || wcKpi.dpo_days_est)} 天，第一名占比${fmtRatio(apKpi.top1_ratio)}`,
      action:{ owner:'采购负责人', task:'与核心供应商沟通付款节奏并建立备选供应', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'降低供应风险并优化现金压力' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ap_table',
        filterFirstColValue:(finance.ap && finance.ap.top_suppliers && finance.ap.top_suppliers[0] && finance.ap.top_suppliers[0].supplier) || '',
        anchor:'total_finance_ap_table'
      }, '查看证据')
    });
    conclusions.sec6 = sec6Conc;

    const sec7Conc = [];
    addConclusion(sec7Conc, actions, {
      source:'其他应付',
      domain:'专项',
      title:'其他应付占比偏高需专项核对与清理。',
      evidence:`其他应付合计${fmtWan(otherApTotal)}（占净应付${fmtRatio(otherApRatio)}）`,
      action:{ owner:'财务负责人', task:'按供应商逐项核对挂账原因，制定清理路线', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'降低账龄与合规风险' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ap_other_table',
        filterFirstColValue: otherAp[0] && otherAp[0].supplier,
        anchor:'total_finance_ap_other_table'
      }, '查看证据')
    });
    conclusions.sec7 = sec7Conc;

    const sec8Conc = [];
    addConclusion(sec8Conc, actions, {
      source:'库存',
      domain:'周转',
      title:'库存与销量匹配度需优化，防止资金占用。',
      evidence:`期末库存${fmtWan(invKpi.inventory_end)}，期初${fmtWan(invKpi.inventory_start)}，存货周转天数 ${fmtDays(invKpi.dio_days_est)} 天`,
      action:{ owner:'供应链负责人', task:'制定滞销货号去化计划并调整补货节奏', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'降低库存占用与过期损耗' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据')
    });
    conclusions.sec8 = sec8Conc;

    const sec9Conc = [];
    addConclusion(sec9Conc, actions, {
      source:'采购',
      domain:'成本',
      title:'采购集中度与价格波动需同步控制。',
      evidence:`期间入库金额${fmtWan(poKpi.period_inbound_amount)}，第一名供应商占比${fmtRatio(poKpi.top1_supplier_ratio)}`,
      action:{ owner:'采购负责人', task:'评估头部供应商价格与交付表现，推进框架协议与替代方案', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'稳定成本与供应安全' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_po_sup_table',
        filterFirstColValue: poTopSup[0] && poTopSup[0].supplier,
        anchor:'total_finance_po_sup_table'
      }, '查看证据')
    });
    conclusions.sec9 = sec9Conc;

    const warnings = [];

    const salesMomRatio = (lastSales && prevSales) ? (lastSales - prevSales) / prevSales : null;
    let salesMomLevel = '绿';
    let salesMomClass = 'green';
    if(salesMomRatio !== null && salesMomRatio < -THRESHOLDS.sales_mom_drop_red){
      salesMomLevel = '红';
      salesMomClass = 'red';
    }else if(salesMomRatio !== null && salesMomRatio < -THRESHOLDS.sales_mom_drop_yellow){
      salesMomLevel = '黄';
      salesMomClass = 'yellow';
    }
    warnings.push(buildWarning({
      level: salesMomLevel,
      levelClass: salesMomClass,
      domain:'收入',
      signal:'收入环比下滑',
      evidence:`最新月销售${fmtWan(lastSales)}，上月${fmtWan(prevSales)}（环比${salesMomRatio === null ? '—' : (salesMomRatio * 100).toFixed(1) + '%'}）`,
      action:{ owner:'销售负责人', task:'拆解客户/品类/产品的收入下滑原因并制定恢复计划', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'修复收入下滑风险' },
      link: buildEvidenceLink({ seg:'total', tab:'overview' }, '查看证据'),
      diagnosis:['异常：收入环比下降','定位：拆分客户/品类/产品贡献','归因：量/价/结构或集中度变化','动作：调整价格策略并推进关键客户恢复']
    }));

    const gmAdjDelta = (lastGmAdj !== null && prevGmAdj !== null) ? (lastGmAdj - prevGmAdj) : null;
    const gpMomRatio = (lastGp && prevGp) ? (lastGp - prevGp) / prevGp : null;
    let gmLevel = '绿';
    let gmClass = 'green';
    if(gmAdjDelta !== null && gmAdjDelta < -THRESHOLDS.gm_drop_pct_red){
      gmLevel = '红';
      gmClass = 'red';
    }else if(gmAdjDelta !== null && gmAdjDelta < -THRESHOLDS.gm_drop_pct_yellow){
      gmLevel = '黄';
      gmClass = 'yellow';
    }else if(gmAdjDelta === null && gpMomRatio !== null && gpMomRatio < -THRESHOLDS.gp_mom_drop_red){
      gmLevel = '红';
      gmClass = 'red';
    }else if(gmAdjDelta === null && gpMomRatio !== null && gpMomRatio < -THRESHOLDS.gp_mom_drop_yellow){
      gmLevel = '黄';
      gmClass = 'yellow';
    }
    warnings.push(buildWarning({
      level: gmLevel,
      levelClass: gmClass,
      domain:'毛利',
      signal:'毛利率下滑',
      evidence:`扣费毛利率${fmtPct(gmAdj)}（环比${gmAdjDelta === null ? '—' : (gmAdjDelta > 0 ? '+' : '') + gmAdjDelta.toFixed(2) + 'pct'}），毛利额环比${gpMomRatio === null ? '—' : (gpMomRatio * 100).toFixed(1) + '%'}`,
      action:{ owner:'销售负责人', task:'复盘低毛利客户/品类的价格与费用策略并调整', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'稳定毛利率' },
      link: buildEvidenceLink({ seg:'total', tab:'overview' }, '查看证据'),
      diagnosis:['异常：毛利率下降','定位：低毛利客户/品类/货号','归因：售价下滑/成本上升/扣费异常','动作：调整折扣与成本策略并跟踪改善']
    }));

    const netCash = toNumber(bankKpi.period_net_cash);
    warnings.push(buildWarning({
      level: netCash !== null && netCash < 0 ? '红' : '绿',
      levelClass: netCash !== null && netCash < 0 ? 'red' : 'green',
      domain:'现金流',
      signal:'期间净现金流为负',
      evidence:`期间净现金流${fmtWan(bankKpi.period_net_cash)}`,
      action:{ owner:'资金经理', task:'压缩非关键支出并加速重点客户回款', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'修复现金流缺口' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据'),
      diagnosis:['异常：期间净现金流为负','定位：回款慢/付款快/库存占用/其他收支','归因：收付节奏或结构性变化','动作：优先回款、调整付款节奏并控制非经营支出']
    }));

    const dsoVal = toNumber(wcKpi.dso_days_est || arKpi.dso_days_est);
    warnings.push(buildWarning({
      level: dsoVal !== null && dsoVal > THRESHOLDS.dso_red ? '红' : (dsoVal !== null && dsoVal > THRESHOLDS.dso_yellow ? '黄' : '绿'),
      levelClass: dsoVal !== null && dsoVal > THRESHOLDS.dso_red ? 'red' : (dsoVal !== null && dsoVal > THRESHOLDS.dso_yellow ? 'yellow' : 'green'),
      domain:'应收',
      signal:`应收周转天数超阈值（${THRESHOLDS.dso_yellow}/${THRESHOLDS.dso_red}天）`,
      evidence:`应收周转天数 ${fmtDays(dsoVal)} 天`,
      action:{ owner:'收款负责人', task:'制定回款优先级与赊销控制策略', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'缩短回款周期' },
      link: buildEvidenceLink({ seg:'total', tab:'finance', tableId:'total_finance_ar_table', anchor:'total_finance_ar_table' }, '查看证据'),
      diagnosis:['异常：应收周转天数超阈值','定位：头部客户账期与逾期账龄','归因：回款停滞/账期过长','动作：收款计划+授信调整并跟踪']
    }));

    const dpoVal = toNumber(wcKpi.dpo_days_est || apKpi.dpo_days_est);
    let dpoLevel = '绿';
    let dpoClass = 'green';
    let dpoSignal = '应付周转天数正常';
    if(dpoVal !== null && dpoVal < THRESHOLDS.dpo_low){
      dpoLevel = '黄';
      dpoClass = 'yellow';
      dpoSignal = '应付周转天数过低导致现金压力';
    }else if(dpoVal !== null && dpoVal > THRESHOLDS.dpo_high){
      dpoLevel = '红';
      dpoClass = 'red';
      dpoSignal = '应付周转天数过高导致供应风险';
    }
    warnings.push(buildWarning({
      level: dpoLevel,
      levelClass: dpoClass,
      domain:'应付',
      signal: dpoSignal,
      evidence:`应付周转天数 ${fmtDays(dpoVal)} 天`,
      action:{ owner:'采购负责人', task:'调整付款节奏并维护关键供应商信任', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'平衡现金压力与供应稳定' },
      link: buildEvidenceLink({ seg:'total', tab:'finance', tableId:'total_finance_ap_table', anchor:'total_finance_ap_table' }, '查看证据'),
      diagnosis:['异常：应付周转天数偏离阈值','定位：付款周期与供应商集中','归因：提前付款或供应风险','动作：分级付款策略并维护关键供应商']
    }));

    const cccVal = toNumber(wcKpi.ccc_days_est);
    warnings.push(buildWarning({
      level: cccVal !== null && cccVal > THRESHOLDS.ccc_high ? '红' : (cccVal !== null && cccVal > THRESHOLDS.ccc_high * 0.7 ? '黄' : '绿'),
      levelClass: cccVal !== null && cccVal > THRESHOLDS.ccc_high ? 'red' : (cccVal !== null && cccVal > THRESHOLDS.ccc_high * 0.7 ? 'yellow' : 'green'),
      domain:'周转',
      signal:'现金转换周期上行/超阈值',
      evidence:`现金转换周期 ${fmtDays(cccVal)} 天`,
      action:{ owner:'财务业务伙伴', task:'协同销售与供应链压缩应收/存货周转天数', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'降低营运资金占用' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据'),
      diagnosis:['异常：现金转换周期上升','定位：应收/存货/应付周转贡献','归因：回款慢/库存占用/付款节奏','动作：协同销售与供应链压缩周转']
    }));

    warnings.push(buildWarning({
      level: arKpi.top1_ratio !== null && arKpi.top1_ratio > THRESHOLDS.ar_top1_red ? '红' : (arKpi.top10_ratio !== null && arKpi.top10_ratio > THRESHOLDS.ar_top10_yellow ? '黄' : '绿'),
      levelClass: arKpi.top1_ratio !== null && arKpi.top1_ratio > THRESHOLDS.ar_top1_red ? 'red' : (arKpi.top10_ratio !== null && arKpi.top10_ratio > THRESHOLDS.ar_top10_yellow ? 'yellow' : 'green'),
      domain:'应收',
      signal:'应收集中度过高',
      evidence:`第一名 ${fmtRatio(arKpi.top1_ratio)} / 前十名 ${fmtRatio(arKpi.top10_ratio)}`,
      action:{ owner:'销售负责人', task:'分散客户结构并强化大客户回款条款', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'降低集中度风险' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ar_table',
        filterFirstColValue:(arSeg.top_customers && arSeg.top_customers[0] && arSeg.top_customers[0].customer) || '',
        anchor:'total_finance_ar_table'
      }, '查看证据'),
      diagnosis:['异常：应收集中度过高','定位：第一名/前十名客户贡献','归因：客户结构过度集中','动作：拓展新客户并优化大客户条款']
    }));

    warnings.push(buildWarning({
      level: apKpi.top1_ratio !== null && apKpi.top1_ratio > THRESHOLDS.ap_top1_red ? '红' : '绿',
      levelClass: apKpi.top1_ratio !== null && apKpi.top1_ratio > THRESHOLDS.ap_top1_red ? 'red' : 'green',
      domain:'应付',
      signal:'应付第一名过高（供应风险）',
      evidence:`第一名占比${fmtRatio(apKpi.top1_ratio)}`,
      action:{ owner:'采购负责人', task:'推进供应商备份与分单策略', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'降低单一供应商风险' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ap_table',
        filterFirstColValue:(finance.ap && finance.ap.top_suppliers && finance.ap.top_suppliers[0] && finance.ap.top_suppliers[0].supplier) || '',
        anchor:'total_finance_ap_table'
      }, '查看证据'),
      diagnosis:['异常：应付第一名过高','定位：关键供应商依赖度','归因：供应商备份不足','动作：分单与引入替代供应商']
    }));

    const noInvoice = toNumber(arKpi.no_sales_invoice_balance);
    const noInvoiceRatio = (noInvoice !== null && arKpi.ending_sales_ar) ? noInvoice / arKpi.ending_sales_ar : null;
    warnings.push(buildWarning({
      level: noInvoiceRatio !== null && noInvoiceRatio > THRESHOLDS.no_invoice_ratio_red ? '红' : '绿',
      levelClass: noInvoiceRatio !== null && noInvoiceRatio > THRESHOLDS.no_invoice_ratio_red ? 'red' : 'green',
      domain:'应收',
      signal:'无销售发票挂账占比异常',
      evidence:`挂账${fmtWan(noInvoice)}（占比${fmtRatio(noInvoiceRatio)}）`,
      action:{ owner:'开票负责人', task:'核对未开票清单并推进补票/冲销', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'降低应收合规风险' },
      link: buildEvidenceLink({ seg:'total', tab:'finance', tableId:'total_finance_ar_table', anchor:'total_finance_ar_table' }, '查看证据'),
      diagnosis:['异常：无票挂账占比高','定位：未开票订单与客户','归因：开票延迟/流程缺失','动作：补票/冲销并优化流程']
    }));

    warnings.push(buildWarning({
      level: otherArRatio !== null && otherArRatio > THRESHOLDS.other_ratio_red ? '红' : (otherArRatio !== null && otherArRatio > THRESHOLDS.other_ratio_yellow ? '黄' : '绿'),
      levelClass: otherArRatio !== null && otherArRatio > THRESHOLDS.other_ratio_red ? 'red' : (otherArRatio !== null && otherArRatio > THRESHOLDS.other_ratio_yellow ? 'yellow' : 'green'),
      domain:'其他应收',
      signal:'其他应收占比过高',
      evidence:`其他应收${fmtWan(otherArTotal)}（占净应收${fmtRatio(otherArRatio)}）`,
      action:{ owner:'财务负责人', task:'专项核对其他应收形成原因并落实清理', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'回收存量资金' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ar_other_table',
        filterFirstColValue: otherAr[0] && otherAr[0].customer,
        anchor:'total_finance_ar_other_table'
      }, '查看证据'),
      diagnosis:['异常：其他应收占比偏高','定位：按客户拆解余额','归因：押金/往来/返利/代垫等挂账','动作：专项清理并设定责任人']
    }));

    warnings.push(buildWarning({
      level: otherApRatio !== null && otherApRatio > THRESHOLDS.other_ratio_red ? '红' : (otherApRatio !== null && otherApRatio > THRESHOLDS.other_ratio_yellow ? '黄' : '绿'),
      levelClass: otherApRatio !== null && otherApRatio > THRESHOLDS.other_ratio_red ? 'red' : (otherApRatio !== null && otherApRatio > THRESHOLDS.other_ratio_yellow ? 'yellow' : 'green'),
      domain:'其他应付',
      signal:'其他应付占比过高',
      evidence:`其他应付${fmtWan(otherApTotal)}（占净应付${fmtRatio(otherApRatio)}）`,
      action:{ owner:'财务负责人', task:'专项核对其他应付形成原因并推进清理', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'降低账龄与合规风险' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ap_other_table',
        filterFirstColValue: otherAp[0] && otherAp[0].supplier,
        anchor:'total_finance_ap_other_table'
      }, '查看证据'),
      diagnosis:['异常：其他应付占比偏高','定位：按供应商拆解余额','归因：押金/往来/返利等挂账','动作：专项核对并制定清理路径']
    }));

    const dioVal = toNumber(invKpi.dio_days_est);
    const invJump = (toNumber(invKpi.inventory_start) && toNumber(invKpi.inventory_end)) ? (invKpi.inventory_end - invKpi.inventory_start) / invKpi.inventory_start : null;
    const invWarn = (dioVal !== null && dioVal > THRESHOLDS.dio_high) || (invJump !== null && invJump > THRESHOLDS.inventory_jump_ratio && lastSales !== null && prevSales !== null && lastSales < prevSales);
    warnings.push(buildWarning({
      level: invWarn ? '黄' : '绿',
      levelClass: invWarn ? 'yellow' : 'green',
      domain:'库存',
      signal:'库存激增/去化变慢',
      evidence:`期末库存${fmtWan(invKpi.inventory_end)}，存货周转天数 ${fmtDays(dioVal)} 天`,
      action:{ owner:'供应链负责人', task:'限制补货并推进滞销货号去化', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'降低库存占用' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据'),
      diagnosis:['异常：库存激增/去化变慢','定位：滞销货号与库存结构','归因：销量下降/采购节奏失衡','动作：限采与促销去化计划']
    }));

    const receiptDays = toNumber(arKpi.days_since_last_receipt);
    const paymentDays = toNumber(apKpi.days_since_last_payment);
    warnings.push(buildWarning({
      level: receiptDays === null ? '黄' : (receiptDays > 90 ? '红' : '绿'),
      levelClass: receiptDays === null ? 'yellow' : (receiptDays > 90 ? 'red' : 'green'),
      domain:'回款停滞',
      signal:'回款停滞天数过高',
      evidence: receiptDays === null ? '缺少 days_since_last_receipt 字段' : `距上次回款${fmtDays(receiptDays)}天`,
      action:{ owner:'收款负责人', task:'补齐回款停滞天数字段并跟进超90天客户', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'降低回款停滞风险' },
      link: buildEvidenceLink({ seg:'total', tab:'finance', tableId:'total_finance_ar_table', anchor:'total_finance_ar_table' }, '查看证据'),
      diagnosis:['异常：回款停滞天数过高','定位：停滞客户与账龄分布','归因：回款延迟/合同条款约束','动作：专项回款计划并升级催收']
    }));

    warnings.push(buildWarning({
      level: paymentDays === null ? '黄' : (paymentDays > 90 ? '红' : '绿'),
      levelClass: paymentDays === null ? 'yellow' : (paymentDays > 90 ? 'red' : 'green'),
      domain:'付款停滞',
      signal:'付款停滞天数过高',
      evidence: paymentDays === null ? '缺少 days_since_last_payment 字段' : `距上次付款${fmtDays(paymentDays)}天`,
      action:{ owner:'采购负责人', task:'补齐付款停滞天数字段并跟进超90天供应商', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'降低供应商纠纷风险' },
      link: buildEvidenceLink({ seg:'total', tab:'finance', tableId:'total_finance_ap_table', anchor:'total_finance_ap_table' }, '查看证据'),
      diagnosis:['异常：付款停滞天数过高','定位：停滞供应商与账龄','归因：付款排期失衡/供应风险','动作：制定付款排期并沟通供应商']
    }));

    renderWarningFilters(warnings);
    bindTrafficPanel(warnings);

    const warnRules = document.getElementById('warning_rules');
    if(warnRules){
      warnRules.innerHTML = '';
      const rules = [
        `收入环比下滑 > ${THRESHOLDS.sales_mom_drop_yellow * 100}% 黄 / > ${THRESHOLDS.sales_mom_drop_red * 100}% 红`,
        `扣费毛利率环比下降 > ${THRESHOLDS.gm_drop_pct_yellow}pct 黄 / > ${THRESHOLDS.gm_drop_pct_red}pct 红`,
        `净现金流 < 0 触发红色预警`,
        `应收周转天数 > ${THRESHOLDS.dso_yellow} 天黄 / > ${THRESHOLDS.dso_red} 天红`,
        `应付周转天数 < ${THRESHOLDS.dpo_low} 天现金压力 / > ${THRESHOLDS.dpo_high} 天供应风险`,
        `现金转换周期 > ${THRESHOLDS.ccc_high} 天进入红色预警`,
        `应收第一名 > ${THRESHOLDS.ar_top1_red * 100}% 红 / 前十名 > ${THRESHOLDS.ar_top10_yellow * 100}% 黄`,
        `应付第一名 > ${THRESHOLDS.ap_top1_red * 100}% 红`,
        `无销售发票挂账 > ${THRESHOLDS.no_invoice_ratio_red * 100}% 红`,
        `其他应收/应付占比 > ${THRESHOLDS.other_ratio_yellow * 100}% 黄 / > ${THRESHOLDS.other_ratio_red * 100}% 红`,
        `存货周转天数 > ${THRESHOLDS.dio_high} 天或库存激增且销量下降触发黄`
      ];
      rules.forEach(rule=>{
        const li = document.createElement('li');
        li.textContent = rule;
        warnRules.appendChild(li);
      });
    }

    const thresholdList = document.getElementById('threshold_list');
    if(thresholdList){
      thresholdList.innerHTML = '';
      const items = [
        `收入环比下滑阈值：黄 ${THRESHOLDS.sales_mom_drop_yellow * 100}% / 红 ${THRESHOLDS.sales_mom_drop_red * 100}%`,
        `扣费毛利率下滑阈值：黄 ${THRESHOLDS.gm_drop_pct_yellow}pct / 红 ${THRESHOLDS.gm_drop_pct_red}pct`,
        `应收周转天数阈值：黄 ${THRESHOLDS.dso_yellow} 天 / 红 ${THRESHOLDS.dso_red} 天`,
        `应付周转天数阈值：低 ${THRESHOLDS.dpo_low} 天 / 高 ${THRESHOLDS.dpo_high} 天`,
        `现金转换周期阈值：${THRESHOLDS.ccc_high} 天`,
        `应收第一名阈值：${THRESHOLDS.ar_top1_red * 100}%`,
        `应收前十名阈值：${THRESHOLDS.ar_top10_yellow * 100}%`,
        `应付第一名阈值：${THRESHOLDS.ap_top1_red * 100}%`,
        `无票挂账阈值：${THRESHOLDS.no_invoice_ratio_red * 100}%`,
        `其他往来阈值：黄 ${THRESHOLDS.other_ratio_yellow * 100}% / 红 ${THRESHOLDS.other_ratio_red * 100}%`,
        `库存阈值：存货周转天数 ${THRESHOLDS.dio_high} 天 / 库存激增 ${THRESHOLDS.inventory_jump_ratio * 100}%`
      ];
      items.forEach(text=>{
        const li = document.createElement('li');
        li.textContent = text;
        thresholdList.appendChild(li);
      });
    }

    const warnStats = document.getElementById('warning_stats');
    if(warnStats){
      const reds = warnings.filter(w=>w.level === '红').length;
      const yellows = warnings.filter(w=>w.level === '黄').length;
      const greens = warnings.filter(w=>w.level === '绿').length;
      warnStats.textContent = `共 ${warnings.length} 条预警（红 ${reds} / 黄 ${yellows} / 绿 ${greens}）`;
    }

    conclusions.sec10.push({
      source:'预警中心',
      domain:'预警',
      title:'预警已自动生成，需逐条闭环行动。',
      evidence:`预警合计${warnings.length}条，红${warnings.filter(w=>w.level==='红').length}条`,
      action:{ owner:'运营PMO', task:'按预警等级建立责任人清单并每周复盘', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'确保风险快速闭环' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据')
    });

    warnings.forEach(w=>{
      actions.push({
        source:'预警',
        domain:w.domain,
        signal:w.signal,
        owner:w.action.owner,
        task:w.action.task,
        ddl:w.action.ddl,
        impact:w.action.impact,
        link:w.link
      });
    });

    forecastActions.forEach(a=>{
      actions.push(a);
    });

    const applyActionFilters = renderActionFilters(actions);

    conclusions.sec11.push({
      source:'动作清单',
      domain:'执行',
      title:'动作清单需设定负责人并按截止日期跟踪。',
      evidence:`动作共${actions.length}项，建议按周复盘。`,
      action:{ owner:'运营PMO', task:'建立动作追踪看板并每周更新进展', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'确保动作落地' },
      link: buildEvidenceLink({ seg:'total', tab:'overview' }, '查看证据')
    });

    renderConclusions('sec0_conclusions', conclusions.sec0);
    renderConclusions('exec_conclusions', conclusions.exec);
    renderConclusions('sec2_conclusions', conclusions.sec2);
    renderConclusions('sec3_conclusions', conclusions.sec3);
    renderConclusions('sec4_conclusions', conclusions.sec4);
    renderConclusions('sec5_conclusions', conclusions.sec5);
    renderConclusions('sec6_conclusions', conclusions.sec6);
    renderConclusions('sec7_conclusions', conclusions.sec7);
    renderConclusions('sec8_conclusions', conclusions.sec8);
    renderConclusions('sec9_conclusions', conclusions.sec9);
    renderConclusions('sec10_conclusions', conclusions.sec10);
    renderConclusions('sec11_conclusions', conclusions.sec11);

    const forecastSummary = forecast && forecast.forecast && forecast.forecast.recommendations ? forecast.forecast.recommendations.summary_kpi || {} : {};
    const baseGap = toNumber(forecastResult.base_gap_amount);
    const baseMinBalance = toNumber(forecastResult.base_min_balance);
    const gapValue = baseGap !== null ? baseGap : (baseMinBalance !== null ? Math.abs(baseMinBalance) : null);
    const gapPenalty = gapValue === null ? 0 : (gapValue > THRESHOLDS.forecast_gap_threshold * 2 ? 20 : (gapValue > THRESHOLDS.forecast_gap_threshold ? 10 : 0));
    const coverConfirmed = toNumber(forecastSummary.cover_ratio_confirmed);
    const coverPenalty = coverConfirmed === null ? 0 : (coverConfirmed < 0.4 ? 20 : (coverConfirmed < 0.6 ? 10 : 0));
    const scenarioMap = forecast && forecast.forecast && forecast.forecast.scenarios ? forecast.forecast.scenarios : {};
    const scenarioGaps = ['base','s1','s2','s3'].map(k=>toNumber(scenarioMap[k] && scenarioMap[k].gap_amount)).filter(v=>v !== null);
    const maxGap = scenarioGaps.length ? Math.max.apply(null, scenarioGaps) : null;
    const sensitivityVal = (maxGap !== null && baseGap !== null) ? (maxGap - baseGap) : null;
    const sensitivityRatio = (sensitivityVal !== null && baseGap) ? sensitivityVal / baseGap : null;
    const sensitivityPenalty = sensitivityRatio === null ? 0 : (sensitivityRatio > 0.6 ? 20 : (sensitivityRatio > 0.3 ? 10 : 0));
    const forecastRisk = {
      liquidity_gap_risk: gapPenalty,
      forecast_coverage_risk: coverPenalty,
      scenario_sensitivity_risk: sensitivityPenalty,
      breakdown_rows: [
        {
          risk_item:'现金缺口风险',
          formula:'base_gap_amount',
          threshold:`${fmtWan(THRESHOLDS.forecast_gap_threshold)}/${fmtWan(THRESHOLDS.forecast_gap_threshold * 2)}`,
          current_value: gapValue,
          penalty: gapPenalty,
          evidence_state_link:{ seg:'total', tab:'forecast', filters:{ view:'forecast_base', focus:'gap' }, anchor:'total_forecast_summary' }
        },
        {
          risk_item:'预测覆盖率风险',
          formula:'confirmed_cover_ratio',
          threshold:'60%/40%',
          current_value: coverConfirmed,
          penalty: coverPenalty,
          evidence_state_link:{ seg:'total', tab:'forecast', filters:{ view:'forecast_components' }, anchor:'total_forecast_components' }
        },
        {
          risk_item:'情景敏感性风险',
          formula:'max_gap - base_gap',
          threshold:'30%/60%',
          current_value: sensitivityVal,
          penalty: sensitivityPenalty,
          evidence_state_link:{ seg:'total', tab:'forecast', filters:{ view:'forecast_scenarios' }, anchor:'total_forecast_summary' }
        }
      ]
    };
    renderRiskCenter(finance.bank || {}, periodEnd, forecastRisk);
    const riskCoverageEl = document.getElementById('risk_action_coverage');
    if(riskCoverageEl){
      const coverageRatio = forecastResult.coverage_ratio;
      const label = coverageRatio === null ? '—' : (coverageRatio * 100).toFixed(1) + '%';
      const note = coverageRatio !== null && coverageRatio < THRESHOLDS.forecast_action_coverage_threshold ? '（行动不足以覆盖缺口）' : '';
      riskCoverageEl.textContent = `行动覆盖度：${label}${note}`;
    }

    if(!applyActionFilters) renderActionTable(actions);

    renderForecastActionPack(forecast, forecastResult, forecastActions);

    const forecastJump = document.getElementById('forecast_action_jump');
    if(forecastJump){
      forecastJump.onclick = (e)=>{
        e.preventDefault();
        const sourceSelect = document.getElementById('action_filter_source');
        if(sourceSelect){
          sourceSelect.value = 'forecast';
          if(typeof applyActionFilters === 'function') applyActionFilters();
        }
        const target = document.getElementById('sec-11');
        if(target) target.scrollIntoView({ behavior:'smooth', block:'start' });
      };
    }

    initForecastTuner(forecastRaw, finance, actions, baseDate);

    const snapshot = {
      period_start: periodStart || '',
      period_end: periodEnd || '',
      kpis: execKpiItems.map(k=>({ label:k.label, value:k.value, sub:k.sub || '' })),
      conclusions: Object.keys(conclusions).flatMap(section=>{
        return conclusions[section].map(item=>({
          section: section,
          source: item.source || '',
          domain: item.domain || '',
          title: item.title || '',
          evidence: item.evidence || '',
          action: item.action || {},
          link: item.link ? item.link.href : ''
        }));
      }),
      warnings: warnings.map(w=>({
        level: w.level,
        domain: w.domain,
        signal: w.signal,
        evidence: w.evidence,
        action: w.action,
        link: w.link ? w.link.href : ''
      })),
      actions: actions.map(a=>({
        source: a.source || '',
        domain: a.domain || '',
        signal: a.signal || '',
        owner: a.owner || '',
        task: a.task || '',
        ddl: a.ddl || '',
        impact: a.impact || '',
        expected_cash_impact_base: a.expected_cash_impact_base || null,
        expected_cash_impact_s1: a.expected_cash_impact_s1 || null,
        expected_cash_impact_s2: a.expected_cash_impact_s2 || null,
        expected_cash_impact_s3: a.expected_cash_impact_s3 || null,
        link: a.link ? a.link.href : ''
      }))
    };

    window.__REPORT_SNAPSHOT__ = snapshot;
    window.__REPORT_ACTIONS__ = actions;
    window.__REPORT_WARNINGS__ = warnings;

    bindExports(actions, warnings, periodEnd, snapshot);
  }

  function buildMiniCard(title, value, note){
    const wrap = document.createElement('div');
    wrap.className = 'report-mini-card-inner';
    const t = document.createElement('div');
    t.className = 'report-mini-title';
    t.textContent = title;
    const v = document.createElement('div');
    v.className = 'report-mini-val';
    v.textContent = value;
    const n = document.createElement('div');
    n.className = 'report-mini-note';
    n.textContent = note;
    wrap.appendChild(t);
    wrap.appendChild(v);
    wrap.appendChild(n);
    return wrap;
  }

  function buildWarning(obj){
    return obj;
  }

  function bindExports(actions, warnings, periodEnd, snapshot){
    const periodLabel = safeDateLabel(periodEnd);
    const suffix = periodLabel ? ('_' + periodLabel) : '';
    const exportActionsBtn = document.getElementById('export_actions_btn');
    const buildActionRows = (list)=>list.map(a=>({
      '来源':formatActionSource(a.source),
      '领域':a.domain,
      '结论/信号':a.signal,
      '负责人':a.owner,
      '动作':a.task,
      '截止日期':a.ddl,
      '预期影响':a.impact,
      '基准预期现金影响':a.expected_cash_impact_base,
      '情景1预期现金影响':a.expected_cash_impact_s1,
      '情景2预期现金影响':a.expected_cash_impact_s2,
      '情景3预期现金影响':a.expected_cash_impact_s3,
      '证据链接':a.link ? a.link.href : ''
    }));
    const actionColumns = ['来源','领域','结论/信号','负责人','动作','截止日期','预期影响','基准预期现金影响','情景1预期现金影响','情景2预期现金影响','情景3预期现金影响','证据链接'];
    if(exportActionsBtn){
      exportActionsBtn.addEventListener('click', ()=>{
        const rows = buildActionRows(actions);
        const csv = buildCsv(rows, actionColumns);
        downloadCsv('动作清单' + suffix + '.csv', csv);
      });
    }

    const exportActionsAllBtn = document.getElementById('export_actions_all_btn');
    if(exportActionsAllBtn){
      exportActionsAllBtn.addEventListener('click', ()=>{
        const rows = buildActionRows(actions);
        const csv = buildCsv(rows, actionColumns);
        downloadCsv('动作清单' + suffix + '.csv', csv);
      });
    }

    const exportActionsForecastBtn = document.getElementById('export_actions_forecast_btn');
    if(exportActionsForecastBtn){
      exportActionsForecastBtn.addEventListener('click', ()=>{
        const allowed = new Set(['forecast:AR_collection','forecast:AP_deferral','forecast:PO_reduction']);
        const rows = buildActionRows(actions.filter(a=>allowed.has(String(a.source || ''))));
        const csv = buildCsv(rows, actionColumns);
        downloadCsv('预测动作清单' + suffix + '.csv', csv);
      });
    }

    const exportWarningsBtn = document.getElementById('export_warnings_btn');
    if(exportWarningsBtn){
      exportWarningsBtn.addEventListener('click', ()=>{
        const rows = warnings.map(w=>({
          '等级':w.level,
          '领域':w.domain,
          '信号':w.signal,
          '证据':w.evidence,
          '负责人':w.action.owner,
          '动作':w.action.task,
          '截止日期':w.action.ddl,
          '预期影响':w.action.impact,
          '证据链接':w.link ? w.link.href : ''
        }));
        const csv = buildCsv(rows, ['等级','领域','信号','证据','负责人','动作','截止日期','预期影响','证据链接']);
        downloadCsv('预警清单' + suffix + '.csv', csv);
      });
    }

    const exportSnapshotBtn = document.getElementById('export_snapshot_btn');
    if(exportSnapshotBtn){
      exportSnapshotBtn.addEventListener('click', ()=>{
        downloadJson('报告摘要.json', snapshot || {});
      });
    }

    const copyActionsBtn = document.getElementById('copy_actions_btn');
    if(copyActionsBtn){
      copyActionsBtn.addEventListener('click', ()=>{
        const lines = actions.map(a=>[
          formatActionSource(a.source), a.domain, a.signal, a.owner, a.task, a.ddl, a.impact, a.link ? a.link.href : ''
        ].join('\t'));
        const text = ['来源','领域','结论/信号','负责人','动作','截止日期','预期影响','证据链接'].join('\t') + '\n' + lines.join('\n');
        copyText(text).then(()=>showToast('已复制动作清单'));
      });
    }

    const copyWarningsBtn = document.getElementById('copy_warnings_btn');
    if(copyWarningsBtn){
      copyWarningsBtn.addEventListener('click', ()=>{
        const lines = warnings.map(w=>[
          w.level, w.domain, w.signal, w.evidence, formatAction(w.action), w.link ? w.link.href : ''
        ].join('\t'));
        const text = ['等级','领域','信号','证据','动作','证据链接'].join('\t') + '\n' + lines.join('\n');
        copyText(text).then(()=>showToast('已复制预警清单'));
      });
    }

    const printBtn = document.getElementById('print_btn');
    if(printBtn){
      printBtn.addEventListener('click', ()=>window.print());
    }
  }

  async function loadAll(){
    const startAt = (window.performance && performance.now) ? performance.now() : Date.now();
    setErrorState(false, '');
    setLoadingState(true, '正在拉取经营数据 / 财务数据 / 预测数据');
    try{
      const loader = window.DataLoader;
      const dataPromise = loader
        ? loader.fetchJsonCached('sales', getDataUrl(), parseJsonWithNaN)
        : fetch(getDataUrl(), { cache:'no-store' }).then(r=>r.text()).then(parseJsonWithNaN);
      const financePromise = loader
        ? loader.fetchJsonCached('finance', getFinanceUrl(), parseJsonWithNaN)
        : fetch(getFinanceUrl(), { cache:'no-store' }).then(r=>r.text()).then(parseJsonWithNaN);
      const forecastPromise = loader
        ? loader.fetchJsonCached('forecast', getForecastUrl(), parseJsonWithNaN)
        : fetch(getForecastUrl(), { cache:'no-store' }).then(r=>r.text()).then(parseJsonWithNaN);

      const results = await Promise.allSettled([dataPromise, financePromise, forecastPromise]);
      if(results[0].status !== 'fulfilled') throw new Error('销售数据文件加载失败');
      if(results[1].status !== 'fulfilled') throw new Error('财务数据文件加载失败');

      const data = results[0].value;
      const finance = results[1].value;
      const forecast = results[2].status === 'fulfilled' ? results[2].value : null;

      await waitForEcharts(1200);
      renderReport(data, finance, forecast);
      setLoadingState(false, '');
      updateDebugPanel({
        loadMs: ((window.performance && performance.now) ? performance.now() : Date.now()) - startAt,
        dataOk: true,
        financeOk: true,
        forecastOk: !!forecast,
        missingFields: collectMissingFields(data, finance, forecast || {})
      });
    }catch(err){
      setLoadingState(false, '');
      setErrorState(true, err && err.message ? err.message : '数据加载失败');
      updateDebugPanel({
        loadMs: ((window.performance && performance.now) ? performance.now() : Date.now()) - startAt,
        dataOk: false,
        financeOk: false,
        forecastOk: false,
        missingFields: []
      });
    }
  }

  const reloadBtn = document.getElementById('reload_btn');
  if(reloadBtn){
    reloadBtn.addEventListener('click', loadAll);
  }

  loadAll();
})();
