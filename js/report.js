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
    gm_drop_pct_red:3
  };

  const ACTION_DAYS = {
    quick:7,
    mid:14,
    long:30
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
    const listEl = document.getElementById('debug_missing_list');
    if(loadEl) loadEl.textContent = `加载耗时：${info && info.loadMs ? info.loadMs.toFixed(0) : '—'} ms`;
    if(dataEl) dataEl.textContent = `latest.json：${info && info.dataOk ? '成功' : '失败'}`;
    if(finEl) finEl.textContent = `finance_latest.json：${info && info.financeOk ? '成功' : '失败'}`;
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

  function collectMissingFields(dataRaw, financeRaw){
    const missing = [];
    const checks = [
      ['latest.json:data.total.rows', 'data.total.rows'],
      ['latest.json:data.total.months', 'data.total.months'],
      ['finance_latest.json:meta.period_end', 'meta.period_end'],
      ['finance_latest.json:meta.currency', 'meta.currency'],
      ['finance_latest.json:bank.kpi.period_net_cash', 'bank.kpi.period_net_cash'],
      ['finance_latest.json:bank.trend.cash_in', 'bank.trend.cash_in'],
      ['finance_latest.json:bank.trend.cash_out', 'bank.trend.cash_out'],
      ['finance_latest.json:bank.by_type', 'bank.by_type'],
      ['finance_latest.json:ar.segments.total.kpi.ending_net_ar', 'ar.segments.total.kpi.ending_net_ar'],
      ['finance_latest.json:ar.segments.total.trend.cash_receipts', 'ar.segments.total.trend.cash_receipts'],
      ['finance_latest.json:ap.kpi.ending_net_ap', 'ap.kpi.ending_net_ap'],
      ['finance_latest.json:ap.trend.cash_payments', 'ap.trend.cash_payments'],
      ['finance_latest.json:inventory.kpi.inventory_end', 'inventory.kpi.inventory_end'],
      ['finance_latest.json:po.top_suppliers', 'po.top_suppliers']
    ];
    const dataRoot = dataRaw && dataRaw.data ? dataRaw.data : (dataRaw || {});
    const financeRoot = financeRaw && financeRaw.data ? financeRaw.data : (financeRaw || {});
    checks.forEach(([label, path])=>{
      const source = path.startsWith('data.') ? dataRoot : financeRoot;
      const rel = path.replace(/^data\./, '');
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

  function buildKpiCard(label, value, sub, spark){
    const card = document.createElement('div');
    card.className = 'card';
    const name = document.createElement('div');
    name.className = 'kpi-name';
    name.textContent = label;
    const val = document.createElement('div');
    val.className = 'kpi-val';
    val.textContent = value;
    if(sub){
      const span = document.createElement('span');
      span.className = 'kpi-sub';
      span.textContent = sub;
      val.appendChild(span);
    }
    card.appendChild(name);
    card.appendChild(val);
    if(spark){
      const sparkEl = document.createElement('div');
      sparkEl.className = 'kpi-spark';
      sparkEl.id = spark.id;
      card.appendChild(sparkEl);
    }
    return card;
  }

  function renderKpis(containerId, items){
    const el = document.getElementById(containerId);
    if(!el) return;
    const frag = document.createDocumentFragment();
    const sparks = [];
    (items || []).forEach(item=>{
      if(item && item.spark) sparks.push(item.spark);
      frag.appendChild(buildKpiCard(item.label, item.value, item.sub, item.spark));
    });
    el.replaceChildren(frag);
    sparks.forEach(cfg=>{
      renderSparkline(cfg.id, cfg.data || [], cfg.color, cfg.areaColor);
    });
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
    const state = { seg:seg, tabs:{} };
    state.tabs[seg] = tab;
    if(opts && opts.tableId && opts.filterFirstColValue !== undefined && opts.filterFirstColValue !== null && String(opts.filterFirstColValue).trim() !== ''){
      state.headerFilters = {};
      state.headerFilters[opts.tableId] = padFilterValues([String(opts.filterFirstColValue)], 6);
    }
    let url = './dashboard.html?state=' + encodeURIComponent(JSON.stringify(state));
    if(opts && opts.anchor){
      const anchor = String(opts.anchor).startsWith('#') ? String(opts.anchor) : ('#' + opts.anchor);
      url += anchor;
    }
    return url;
  }

  function buildEvidenceLink(opts, label){
    const a = document.createElement('a');
    a.href = buildDrilldownLink(opts || {});
    a.textContent = label || '查看证据';
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'report-link';
    return a;
  }

  function formatAction(action){
    if(!action) return '—';
    return `负责人：${action.owner}；动作：${action.task}；DDL：${action.ddl}；预期影响：${action.impact}`;
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
      if(item.link){
        const linkWrap = document.createElement('div');
        linkWrap.className = 'conclusion-link';
        linkWrap.appendChild(item.link);
        card.appendChild(linkWrap);
      }
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
        a.source || '—',
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
    const m = String(val || '').match(/\\d{4}-\\d{2}-\\d{2}/);
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
      (v)=>fmtText(v),
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

  function renderReport(dataRaw, financeRaw){
    const data = normalizeData(dataRaw);
    const finance = normalizeFinanceData(financeRaw);
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

    const execKpiItems = [
      { label:'销售额（含税）', value: fmtWan(totalSales), sub: fmtYi(totalSales), spark:{ id:'kpi_spark_sales', data:monthly.sales, color:'#f05a3e' } },
      { label:'毛利', value: fmtWan(totalGp), spark:{ id:'kpi_spark_gp', data:monthly.gp, color:'#148a78' } },
      { label:'综合毛利率', value: fmtPct(gm), spark:{ id:'kpi_spark_gm', data:gmSeries, color:'#148a78' } },
      { label:'毛利-销售费', value: fmtWan(totalGpAdj), spark:{ id:'kpi_spark_gpadj', data:monthly.gpAdj, color:'#f05a3e' } },
      { label:'毛利率（扣费）', value: fmtPct(gmAdj), spark:{ id:'kpi_spark_gmadj', data:gmAdjSeries, color:'#f05a3e' } },
      { label:'订单数', value: totalOrders.toLocaleString('en-US'), spark:{ id:'kpi_spark_orders', data:monthlyOrderCounts } },
      { label:'客户数', value: totalCustomers.toLocaleString('en-US'), spark:{ id:'kpi_spark_customers', data:monthlyCustomerCounts } },
      { label:'品类数', value: totalCategories.toLocaleString('en-US'), spark:{ id:'kpi_spark_cats', data:monthlyCategoryCounts } },
      { label:'期间净现金流', value: fmtWan(bankKpi.period_net_cash), spark:{ id:'kpi_spark_netcash', data:bankTrend.net_cash || [] } },
      { label:'期间流入', value: fmtWan(bankKpi.period_cash_in), spark:{ id:'kpi_spark_cashin', data:bankTrend.cash_in || [] } },
      { label:'期间流出', value: fmtWan(bankKpi.period_cash_out), spark:{ id:'kpi_spark_cashout', data:bankTrend.cash_out || [] } },
      { label:'DSO(天)', value: fmtDays(wcKpi.dso_days_est || arKpi.dso_days_est), spark:{ id:'kpi_spark_dso', data:(arSeg.trend && arSeg.trend.cash_receipts) || [] } },
      { label:'DPO(天)', value: fmtDays(wcKpi.dpo_days_est || apKpi.dpo_days_est), spark:{ id:'kpi_spark_dpo', data:(finance.ap && finance.ap.trend && finance.ap.trend.cash_payments) || [] } },
      { label:'DIO(天)', value: fmtDays(wcKpi.dio_days_est || invKpi.dio_days_est), spark:{ id:'kpi_spark_dio', data:invTrend.ending_inventory || [] } },
      { label:'CCC(天)', value: fmtDays(wcKpi.ccc_days_est), spark:{ id:'kpi_spark_ccc', data:bankTrend.net_cash || [] } },
      { label:'贸易应收余额', value: fmtWan(arKpi.ending_sales_ar), spark:{ id:'kpi_spark_ar', data:(arSeg.trend && arSeg.trend.sales_invoiced) || [] } },
      { label:'期末净应收', value: fmtWan(arKpi.ending_net_ar), spark:{ id:'kpi_spark_netar', data:(arSeg.trend && arSeg.trend.sales_invoiced) || [] } },
      { label:'贸易应付余额', value: fmtWan(apKpi.ending_purchase_ap), spark:{ id:'kpi_spark_ap', data:(finance.ap && finance.ap.trend && finance.ap.trend.purchases_invoiced) || [] } },
      { label:'期末净应付', value: fmtWan(apKpi.ending_net_ap), spark:{ id:'kpi_spark_netap', data:(finance.ap && finance.ap.trend && finance.ap.trend.purchases_invoiced) || [] } },
      { label:'期末库存', value: fmtWan(invKpi.inventory_end), spark:{ id:'kpi_spark_inv', data:invTrend.ending_inventory || [] } }
    ];
    renderKpis('exec_kpis', execKpiItems);

    renderMiniKpis('cash_kpis', [
      { label:'期间流入', value: fmtWan(bankKpi.period_cash_in) },
      { label:'期间流出', value: fmtWan(bankKpi.period_cash_out) },
      { label:'净现金流', value: fmtWan(bankKpi.period_net_cash) },
      { label:'期末累计净现金流', value: fmtWan(bankKpi.period_cum_net_cash_end) }
    ]);

    renderMiniKpis('ar_kpis', [
      { label:'贸易应收余额', value: fmtWan(arKpi.ending_sales_ar) },
      { label:'期末净应收', value: fmtWan(arKpi.ending_net_ar) },
      { label:'DSO(天)', value: fmtDays(arKpi.dso_days_est) },
      { label:'Top1占比', value: fmtRatio(arKpi.top1_ratio) },
      { label:'Top10占比', value: fmtRatio(arKpi.top10_ratio) }
    ]);

    renderMiniKpis('ap_kpis', [
      { label:'采购应付余额', value: fmtWan(apKpi.ending_purchase_ap) },
      { label:'期末应付净额', value: fmtWan(apKpi.ending_net_ap) },
      { label:'DPO(天)', value: fmtDays(apKpi.dpo_days_est || wcKpi.dpo_days_est) },
      { label:'Top1占比', value: fmtRatio(apKpi.top1_ratio) },
      { label:'Top10占比', value: fmtRatio(apKpi.top10_ratio) }
    ]);

    renderMiniKpis('inventory_kpis', [
      { label:'期初库存', value: fmtWan(invKpi.inventory_start) },
      { label:'期末库存', value: fmtWan(invKpi.inventory_end) },
      { label:'库存均值', value: fmtWan(invKpi.inventory_avg) },
      { label:'DIO(天)', value: fmtDays(invKpi.dio_days_est) }
    ]);

    renderMiniKpis('po_kpis', [
      { label:'期间入库金额', value: fmtWan(poKpi.period_inbound_amount) },
      { label:'Top1供应商占比', value: fmtRatio(poKpi.top1_supplier_ratio) },
      { label:'Top2供应商占比', value: fmtRatio(poKpi.top2_supplier_ratio) }
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
      const msg = `期末库存${fmtWan(invKpi.inventory_end)}，较期初${fmtSignedWan(invChange)}；DIO ${fmtDays(invKpi.dio_days_est)} 天。`;
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
      reconReceipts.appendChild(buildMiniCard('AR 回款 vs 银行流入差异', fmtWan(reconReceiptsDiff), '对比口径：ar.trend.cash_receipts vs bank.trend.cash_in'));
    }
    const reconPayments = document.getElementById('bank_recon_payments');
    if(reconPayments){
      reconPayments.innerHTML = '';
      reconPayments.appendChild(buildMiniCard('AP 付款 vs 银行流出差异', fmtWan(reconPaymentsDiff), '对比口径：ap.trend.cash_payments vs bank.trend.cash_out'));
    }

    const reconExplain = document.getElementById('bank_recon_explain');
    if(reconExplain){
      reconExplain.innerHTML = '';
      if(!bankType.length){
        reconExplain.textContent = '缺少 bank.by_type 数据，无法给出差异解释候选。';
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
      { name:'COGS', type:'bar', data: invTrend.cogs || [], barMaxWidth:26 },
      { name:'期末库存', type:'line', data: invTrend.ending_inventory || [], smooth:true }
    ]);

    let priceTarget = poPrice[0];
    if(poPrice.length){
      priceTarget = poPrice.reduce((a,b)=> (Number(b.amount)||0) > (Number(a.amount)||0) ? b : a);
    }
    const priceTitle = document.getElementById('po_price_title');
    if(priceTitle){
      const name = priceTarget ? (priceTarget.product || priceTarget.sku || 'SKU') : 'SKU';
      priceTitle.textContent = '关键 SKU 价格走势：' + name;
    }
    renderLineChart('po_price_chart', (priceTarget && priceTarget.months) || [], [
      { name:'均价', type:'line', data: (priceTarget && priceTarget.avg_unit_cost) || [], smooth:true }
    ]);

    const baseDate = periodEnd || range.end || formatDate(new Date());
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
      source:'Executive Summary',
      domain:'收入与毛利',
      title:'盈利能力需盯紧“扣费毛利率”与销售费用结构。',
      evidence:`销售额${fmtWan(totalSales)}，毛利率${fmtPct(gm)}，扣费毛利率${fmtPct(gmAdj)}；${gmAdjNote}`,
      action:{ owner:'销售负责人', task:'复盘低毛利品类/客户价格与费用，调整折扣与费用政策', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'提升扣费毛利率 0.5-1pct' },
      link: buildEvidenceLink({ seg:'total', tab:'overview' }, '查看证据')
    });

    if(topCust){
      addConclusion(conclusions.exec, actions, {
        source:'Executive Summary',
        domain:'客户结构',
        title:'客户集中度偏高需建立备份增长通道。',
        evidence:`客户Top1 ${fmtText(topCust.key)} 销售额${fmtWan(topCust.sales)}（占比${fmtPct(totalSales ? topCust.sales/totalSales*100 : null)}）`,
        action:{ owner:'大客户经理', task:'推进Top1客户回款与续约，同时拓展Top5外客户替代', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'降低集中度风险、提升可持续增长' },
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
      source:'Executive Summary',
      domain:'现金流',
      title: cashNegative ? '净现金流为负需优先修复收付节奏。' : '现金流总体可控但需持续监控收付节奏。',
      evidence:`期间净现金流${fmtWan(bankKpi.period_net_cash)}，流入${fmtWan(bankKpi.period_cash_in)} / 流出${fmtWan(bankKpi.period_cash_out)}`,
      action:{ owner:'资金经理', task: cashNegative ? '压缩非核心支出并安排重点客户回款' : '优化收付节奏，减少波动', ddl:addDays(baseDate, ACTION_DAYS.quick), impact:'稳定现金头寸，降低融资压力' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据')
    });

    addConclusion(conclusions.exec, actions, {
      source:'Executive Summary',
      domain:'周转',
      title:'DSO/CCC 仍需关注回款与库存协同。',
      evidence:`DSO ${fmtDays(wcKpi.dso_days_est)} 天，CCC ${fmtDays(wcKpi.ccc_days_est)} 天，库存${fmtWan(invKpi.inventory_end)}`,
      action:{ owner:'财务BP', task:'制定回款与库存去化双周计划，跟踪关键客户/品类', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'压缩 CCC 5-10 天' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据')
    });

    addConclusion(conclusions.exec, actions, {
      source:'Executive Summary',
      domain:'收入结构',
      title:'结构贡献与异常订单需同步治理。',
      evidence:`品类Top1 ${fmtText(topCat && topCat.key)} 毛利_扣费${fmtWan(topCat && topCat.gpAdj)}；异常订单行数${negativeLines}`,
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
      domain:'AR',
      title:'应收集中度偏高需加快回款与额度控制。',
      evidence:`Top1占比${fmtRatio(arKpi.top1_ratio)}，Top10占比${fmtRatio(arKpi.top10_ratio)}；贸易应收${fmtWan(arKpi.ending_sales_ar)}`,
      action:{ owner:'收款负责人', task:'锁定Top客户回款计划并设置额度上限', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'降低集中度与逾期风险' },
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
      domain:'AP',
      title:'DPO偏高需关注供应商风险与谈判策略。',
      evidence:`DPO ${fmtDays(apKpi.dpo_days_est || wcKpi.dpo_days_est)} 天，Top1占比${fmtRatio(apKpi.top1_ratio)}`,
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
      evidence:`期末库存${fmtWan(invKpi.inventory_end)}，期初${fmtWan(invKpi.inventory_start)}，DIO ${fmtDays(invKpi.dio_days_est)} 天`,
      action:{ owner:'供应链负责人', task:'制定滞销 SKU 去化计划并调整补货节奏', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'降低库存占用与过期损耗' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据')
    });
    conclusions.sec8 = sec8Conc;

    const sec9Conc = [];
    addConclusion(sec9Conc, actions, {
      source:'采购',
      domain:'成本',
      title:'采购集中度与价格波动需同步控制。',
      evidence:`期间入库金额${fmtWan(poKpi.period_inbound_amount)}，Top1供应商占比${fmtRatio(poKpi.top1_supplier_ratio)}`,
      action:{ owner:'采购负责人', task:'评估Top供应商价格与交付表现，推进框架协议与替代方案', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'稳定成本与供应安全' },
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
      diagnosis:['异常：毛利率下降','定位：低毛利客户/品类/SKU','归因：售价下滑/成本上升/扣费异常','动作：调整折扣与成本策略并跟踪改善']
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
      signal:`DSO 超阈值（${THRESHOLDS.dso_yellow}/${THRESHOLDS.dso_red}天）`,
      evidence:`DSO ${fmtDays(dsoVal)} 天`,
      action:{ owner:'收款负责人', task:'制定回款优先级与赊销控制策略', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'缩短回款周期' },
      link: buildEvidenceLink({ seg:'total', tab:'finance', tableId:'total_finance_ar_table', anchor:'total_finance_ar_table' }, '查看证据'),
      diagnosis:['异常：DSO 超阈值','定位：Top客户账期与逾期账龄','归因：回款停滞/账期过长','动作：收款计划+授信调整并跟踪']
    }));

    const dpoVal = toNumber(wcKpi.dpo_days_est || apKpi.dpo_days_est);
    let dpoLevel = '绿';
    let dpoClass = 'green';
    let dpoSignal = 'DPO 正常';
    if(dpoVal !== null && dpoVal < THRESHOLDS.dpo_low){
      dpoLevel = '黄';
      dpoClass = 'yellow';
      dpoSignal = 'DPO 过低导致现金压力';
    }else if(dpoVal !== null && dpoVal > THRESHOLDS.dpo_high){
      dpoLevel = '红';
      dpoClass = 'red';
      dpoSignal = 'DPO 过高导致供应风险';
    }
    warnings.push(buildWarning({
      level: dpoLevel,
      levelClass: dpoClass,
      domain:'应付',
      signal: dpoSignal,
      evidence:`DPO ${fmtDays(dpoVal)} 天`,
      action:{ owner:'采购负责人', task:'调整付款节奏并维护关键供应商信任', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'平衡现金压力与供应稳定' },
      link: buildEvidenceLink({ seg:'total', tab:'finance', tableId:'total_finance_ap_table', anchor:'total_finance_ap_table' }, '查看证据'),
      diagnosis:['异常：DPO 偏离阈值','定位：付款周期与供应商集中','归因：提前付款或供应风险','动作：分级付款策略并维护关键供应商']
    }));

    const cccVal = toNumber(wcKpi.ccc_days_est);
    warnings.push(buildWarning({
      level: cccVal !== null && cccVal > THRESHOLDS.ccc_high ? '红' : (cccVal !== null && cccVal > THRESHOLDS.ccc_high * 0.7 ? '黄' : '绿'),
      levelClass: cccVal !== null && cccVal > THRESHOLDS.ccc_high ? 'red' : (cccVal !== null && cccVal > THRESHOLDS.ccc_high * 0.7 ? 'yellow' : 'green'),
      domain:'周转',
      signal:'CCC 上行/超阈值',
      evidence:`CCC ${fmtDays(cccVal)} 天`,
      action:{ owner:'财务BP', task:'协同销售与供应链压缩 DSO/DIO', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'降低营运资金占用' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据'),
      diagnosis:['异常：CCC 上升','定位：DSO/DIO/DPO 贡献','归因：回款慢/库存占用/付款节奏','动作：协同销售与供应链压缩周转']
    }));

    warnings.push(buildWarning({
      level: arKpi.top1_ratio !== null && arKpi.top1_ratio > THRESHOLDS.ar_top1_red ? '红' : (arKpi.top10_ratio !== null && arKpi.top10_ratio > THRESHOLDS.ar_top10_yellow ? '黄' : '绿'),
      levelClass: arKpi.top1_ratio !== null && arKpi.top1_ratio > THRESHOLDS.ar_top1_red ? 'red' : (arKpi.top10_ratio !== null && arKpi.top10_ratio > THRESHOLDS.ar_top10_yellow ? 'yellow' : 'green'),
      domain:'应收',
      signal:'AR 集中度过高',
      evidence:`Top1 ${fmtRatio(arKpi.top1_ratio)} / Top10 ${fmtRatio(arKpi.top10_ratio)}`,
      action:{ owner:'销售负责人', task:'分散客户结构并强化大客户回款条款', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'降低集中度风险' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ar_table',
        filterFirstColValue:(arSeg.top_customers && arSeg.top_customers[0] && arSeg.top_customers[0].customer) || '',
        anchor:'total_finance_ar_table'
      }, '查看证据'),
      diagnosis:['异常：应收集中度过高','定位：Top1/Top10 客户贡献','归因：客户结构过度集中','动作：拓展新客户并优化大客户条款']
    }));

    warnings.push(buildWarning({
      level: apKpi.top1_ratio !== null && apKpi.top1_ratio > THRESHOLDS.ap_top1_red ? '红' : '绿',
      levelClass: apKpi.top1_ratio !== null && apKpi.top1_ratio > THRESHOLDS.ap_top1_red ? 'red' : 'green',
      domain:'应付',
      signal:'AP Top1 过高（供应风险）',
      evidence:`Top1占比${fmtRatio(apKpi.top1_ratio)}`,
      action:{ owner:'采购负责人', task:'推进供应商备份与分单策略', ddl:addDays(baseDate, ACTION_DAYS.long), impact:'降低单一供应商风险' },
      link: buildEvidenceLink({
        seg:'total',
        tab:'finance',
        tableId:'total_finance_ap_table',
        filterFirstColValue:(finance.ap && finance.ap.top_suppliers && finance.ap.top_suppliers[0] && finance.ap.top_suppliers[0].supplier) || '',
        anchor:'total_finance_ap_table'
      }, '查看证据'),
      diagnosis:['异常：AP Top1 过高','定位：关键供应商依赖度','归因：供应商备份不足','动作：分单与引入替代供应商']
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
      evidence:`期末库存${fmtWan(invKpi.inventory_end)}，DIO ${fmtDays(dioVal)} 天`,
      action:{ owner:'供应链负责人', task:'限制补货并推进滞销SKU去化', ddl:addDays(baseDate, ACTION_DAYS.mid), impact:'降低库存占用' },
      link: buildEvidenceLink({ seg:'total', tab:'finance' }, '查看证据'),
      diagnosis:['异常：库存激增/去化变慢','定位：滞销SKU与库存结构','归因：销量下降/采购节奏失衡','动作：限采与促销去化计划']
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
        `DSO > ${THRESHOLDS.dso_yellow} 天黄 / > ${THRESHOLDS.dso_red} 天红`,
        `DPO < ${THRESHOLDS.dpo_low} 天现金压力 / > ${THRESHOLDS.dpo_high} 天供应风险`,
        `CCC > ${THRESHOLDS.ccc_high} 天进入红色预警`,
        `AR Top1 > ${THRESHOLDS.ar_top1_red * 100}% 红 / Top10 > ${THRESHOLDS.ar_top10_yellow * 100}% 黄`,
        `AP Top1 > ${THRESHOLDS.ap_top1_red * 100}% 红`,
        `无销售发票挂账 > ${THRESHOLDS.no_invoice_ratio_red * 100}% 红`,
        `其他应收/应付占比 > ${THRESHOLDS.other_ratio_yellow * 100}% 黄 / > ${THRESHOLDS.other_ratio_red * 100}% 红`,
        `DIO > ${THRESHOLDS.dio_high} 天或库存激增且销量下降触发黄`
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
        `DSO 阈值：黄 ${THRESHOLDS.dso_yellow} 天 / 红 ${THRESHOLDS.dso_red} 天`,
        `DPO 阈值：低 ${THRESHOLDS.dpo_low} 天 / 高 ${THRESHOLDS.dpo_high} 天`,
        `CCC 阈值：${THRESHOLDS.ccc_high} 天`,
        `AR Top1 阈值：${THRESHOLDS.ar_top1_red * 100}%`,
        `AR Top10 阈值：${THRESHOLDS.ar_top10_yellow * 100}%`,
        `AP Top1 阈值：${THRESHOLDS.ap_top1_red * 100}%`,
        `无票挂账阈值：${THRESHOLDS.no_invoice_ratio_red * 100}%`,
        `其他往来阈值：黄 ${THRESHOLDS.other_ratio_yellow * 100}% / 红 ${THRESHOLDS.other_ratio_red * 100}%`,
        `库存阈值：DIO ${THRESHOLDS.dio_high} 天 / 库存激增 ${THRESHOLDS.inventory_jump_ratio * 100}%`
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

    const actionStats = document.getElementById('action_stats');
    if(actionStats){
      actionStats.textContent = `动作共 ${actions.length} 项，来自结论与预警自动汇总。`;
    }

    conclusions.sec11.push({
      source:'动作清单',
      domain:'执行',
      title:'动作清单需设定负责人并按DDL跟踪。',
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

    renderActionTable(actions);

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
        link: a.link ? a.link.href : ''
      }))
    };

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
    if(exportActionsBtn){
      exportActionsBtn.addEventListener('click', ()=>{
        const rows = actions.map(a=>({
          source:a.source,
          domain:a.domain,
          signal:a.signal,
          owner:a.owner,
          task:a.task,
          ddl:a.ddl,
          impact:a.impact,
          link:a.link ? a.link.href : ''
        }));
        const csv = buildCsv(rows, ['source','domain','signal','owner','task','ddl','impact','link']);
        downloadCsv('actions' + suffix + '.csv', csv);
      });
    }

    const exportWarningsBtn = document.getElementById('export_warnings_btn');
    if(exportWarningsBtn){
      exportWarningsBtn.addEventListener('click', ()=>{
        const rows = warnings.map(w=>({
          level:w.level,
          domain:w.domain,
          signal:w.signal,
          evidence:w.evidence,
          owner:w.action.owner,
          task:w.action.task,
          ddl:w.action.ddl,
          impact:w.action.impact,
          link:w.link ? w.link.href : ''
        }));
        const csv = buildCsv(rows, ['level','domain','signal','evidence','owner','task','ddl','impact','link']);
        downloadCsv('warnings' + suffix + '.csv', csv);
      });
    }

    const exportSnapshotBtn = document.getElementById('export_snapshot_btn');
    if(exportSnapshotBtn){
      exportSnapshotBtn.addEventListener('click', ()=>{
        downloadJson('report_snapshot.json', snapshot || {});
      });
    }

    const copyActionsBtn = document.getElementById('copy_actions_btn');
    if(copyActionsBtn){
      copyActionsBtn.addEventListener('click', ()=>{
        const lines = actions.map(a=>[
          a.source, a.domain, a.signal, a.owner, a.task, a.ddl, a.impact, a.link ? a.link.href : ''
        ].join('\t'));
        const text = ['来源','领域','结论/信号','负责人','动作','DDL','预期影响','证据链接'].join('\t') + '\n' + lines.join('\n');
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
    setLoadingState(true, '正在拉取 ./data/latest.json 与 ./data/finance_latest.json');
    try{
      const [dataResp, financeResp] = await Promise.all([
        fetch(getDataUrl(), { cache:'no-store' }),
        fetch(getFinanceUrl(), { cache:'no-store' })
      ]);

      if(!dataResp.ok) throw new Error('销售数据文件加载失败: HTTP ' + dataResp.status);
      if(!financeResp.ok) throw new Error('财务数据文件加载失败: HTTP ' + financeResp.status);

      const dataText = await dataResp.text();
      const financeText = await financeResp.text();
      const data = parseJsonWithNaN(dataText);
      const finance = parseJsonWithNaN(financeText);

      await waitForEcharts(1200);
      renderReport(data, finance);
      setLoadingState(false, '');
      updateDebugPanel({
        loadMs: ((window.performance && performance.now) ? performance.now() : Date.now()) - startAt,
        dataOk: true,
        financeOk: true,
        missingFields: collectMissingFields(data, finance)
      });
    }catch(err){
      setLoadingState(false, '');
      setErrorState(true, err && err.message ? err.message : '数据加载失败');
      updateDebugPanel({
        loadMs: ((window.performance && performance.now) ? performance.now() : Date.now()) - startAt,
        dataOk: false,
        financeOk: false,
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
