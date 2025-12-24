(function(){
  function toNumber(val){
    const n = Number(val);
    return isFinite(n) ? n : null;
  }

  function fmtNumber(val){
    const n = toNumber(val);
    if(n === null) return '—';
    if(typeof fmtNum === 'function') return fmtNum(n);
    return n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function fmtDays(val){
    const n = toNumber(val);
    if(n === null) return '—';
    const v = Math.round(n * 10) / 10;
    const digits = v % 1 ? 1 : 0;
    return v.toLocaleString('en-US', {minimumFractionDigits:digits, maximumFractionDigits:1});
  }

  function fmtRate(val){
    const n = toNumber(val);
    if(n === null) return '—';
    const pct = n > 1 ? n : n * 100;
    if(typeof fmtPct === 'function') return fmtPct(pct);
    return pct.toFixed(2) + '%';
  }

  function fmtValue(val, kind){
    if(kind === 'pct') return fmtRate(val);
    if(kind === 'days') return fmtDays(val);
    return fmtNumber(val);
  }

  function setText(id, text){
    const el = document.getElementById(id);
    if(el) el.textContent = text;
  }

  function renderKpis(containerId, items){
    const el = document.getElementById(containerId);
    if(!el) return;
    el.innerHTML = items.map(item=>
      `<div class="card finance-kpi"><div class="kpi-name">${item.label}</div><div class="kpi-val">${item.value}</div></div>`
    ).join('');
  }

  function alignSeries(months, arr){
    if(!Array.isArray(months)) return [];
    const src = Array.isArray(arr) ? arr : [];
    return months.map((_, i)=> (i < src.length ? src[i] : null));
  }

  function renderTrendChart(id, months, series, yName){
    if(!window.ChartManager) return;
    if(!months || !months.length){
      ChartManager.setEmpty(id, '暂无数据');
      return;
    }
    ChartManager.setOption(id, {
      tooltip:{
        trigger:'axis',
        formatter:(params)=>{
          const lines=[params[0]?.axisValue || ''];
          params.forEach(p=>{
            lines.push(`${p.marker}${p.seriesName}：${fmtNumber(p.data)}`);
          });
          return lines.join('<br/>');
        }
      },
      legend:{top:10,type:'scroll'},
      grid:{left:50,right:20,top:60,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name:yName || '金额（元）'},
      series: series
    });
  }

  function renderBarChart(id, categories, values, yName){
    if(!window.ChartManager) return;
    if(!categories || !categories.length){
      ChartManager.setEmpty(id, '暂无数据');
      return;
    }
    const data = alignSeries(categories, values);
    ChartManager.setOption(id, {
      tooltip:{
        trigger:'axis',
        axisPointer:{type:'shadow'},
        formatter:(params)=>{
          const p = params && params[0] ? params[0] : null;
          if(!p) return '';
          return `${p.name}<br/>${p.marker}${p.seriesName}：${fmtNumber(p.data)}`;
        }
      },
      grid:{left:50,right:20,top:50,bottom:40},
      xAxis:{type:'category',data:categories},
      yAxis:{type:'value',name:yName || '金额（元）'},
      series:[{name:'金额',type:'bar',data:data,barMaxWidth:36}]
    });
  }

  function renderTopTable(tableId, rows, columns, formatters){
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
        const val = row && row[col.key] !== undefined ? row[col.key] : '';
        const fmt = formatters && typeof formatters[idx] === 'function' ? formatters[idx] : null;
        td.textContent = fmt ? fmt(val, row) : (val === null || val === undefined ? '' : String(val));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function renderAr(segKey, ar){
    const data = ar || {};
    const kpi = data.kpi || {};
    setText(segKey+'_finance_ar_asof', data.as_of || '—');
    renderKpis(segKey+'_finance_ar_kpis', [
      { label:'应收余额', value: fmtValue(kpi.ar, 'money') },
      { label:'逾期金额', value: fmtValue(kpi.overdue, 'money') },
      { label:'严重逾期', value: fmtValue(kpi.severe_overdue, 'money') },
      { label:'DSO(天)', value: fmtValue(kpi.dso, 'days') }
    ]);

    const months = data.trend && Array.isArray(data.trend.months) ? data.trend.months : [];
    renderTrendChart(segKey+'_finance_ar_trend', months, [
      { name:'应收余额', type:'bar', data: alignSeries(months, data.trend && data.trend.ar) },
      { name:'逾期金额', type:'line', data: alignSeries(months, data.trend && data.trend.overdue), smooth:true }
    ], '金额（元）');

    const buckets = data.aging && Array.isArray(data.aging.buckets) ? data.aging.buckets : [];
    const amounts = data.aging && Array.isArray(data.aging.amount) ? data.aging.amount : [];
    renderBarChart(segKey+'_finance_ar_aging', buckets, amounts, '金额（元）');

    renderTopTable(segKey+'_finance_ar_top_table', data.top_overdue || [], [
      { key:'customer' },
      { key:'overdue' },
      { key:'ar' },
      { key:'max_days' }
    ], [
      null,
      (v)=>fmtValue(v,'money'),
      (v)=>fmtValue(v,'money'),
      (v)=>fmtValue(v,'days')
    ]);
  }

  function renderAp(segKey, ap){
    const data = ap || {};
    const kpi = data.kpi || {};
    setText(segKey+'_finance_ap_asof', data.as_of || '—');
    renderKpis(segKey+'_finance_ap_kpis', [
      { label:'应付余额', value: fmtValue(kpi.ap, 'money') },
      { label:'30天内到期', value: fmtValue(kpi.due_30, 'money') },
      { label:'逾期金额', value: fmtValue(kpi.overdue, 'money') },
      { label:'DPO(天)', value: fmtValue(kpi.dpo, 'days') }
    ]);

    const months = data.trend && Array.isArray(data.trend.months) ? data.trend.months : [];
    renderTrendChart(segKey+'_finance_ap_trend', months, [
      { name:'应付余额', type:'bar', data: alignSeries(months, data.trend && data.trend.ap) },
      { name:'30天内到期', type:'line', data: alignSeries(months, data.trend && data.trend.due_30), smooth:true }
    ], '金额（元）');

    const buckets = data.aging && Array.isArray(data.aging.buckets) ? data.aging.buckets : [];
    const amounts = data.aging && Array.isArray(data.aging.amount) ? data.aging.amount : [];
    renderBarChart(segKey+'_finance_ap_aging', buckets, amounts, '金额（元）');

    renderTopTable(segKey+'_finance_ap_top_table', data.top_due || [], [
      { key:'supplier' },
      { key:'due' },
      { key:'ap' },
      { key:'max_days' }
    ], [
      null,
      (v)=>fmtValue(v,'money'),
      (v)=>fmtValue(v,'money'),
      (v)=>fmtValue(v,'days')
    ]);
  }

  function buildPoOverdueBuckets(list){
    const buckets = ['未逾期','1-7天','8-30天','30天+'];
    const amounts = [0,0,0,0];
    (list || []).forEach(item=>{
      const days = toNumber(item && item.overdue_days);
      const amt = toNumber(item && item.amount) || 0;
      let idx = 0;
      if(days === null){
        idx = 0;
      }else if(days <= 0){
        idx = 0;
      }else if(days <= 7){
        idx = 1;
      }else if(days <= 30){
        idx = 2;
      }else{
        idx = 3;
      }
      amounts[idx] += amt;
    });
    return { buckets, amounts };
  }

  function renderPo(segKey, po){
    const data = po || {};
    const kpi = data.kpi || {};
    setText(segKey+'_finance_po_asof', data.as_of || '—');
    renderKpis(segKey+'_finance_po_kpis', [
      { label:'未清金额', value: fmtValue(kpi.open_amount, 'money') },
      { label:'逾期金额', value: fmtValue(kpi.overdue_amount, 'money') },
      { label:'平均交期(天)', value: fmtValue(kpi.avg_lead_days, 'days') },
      { label:'准时率', value: fmtValue(kpi.ontime_rate, 'pct') }
    ]);

    const months = data.trend && Array.isArray(data.trend.months) ? data.trend.months : [];
    renderTrendChart(segKey+'_finance_po_trend', months, [
      { name:'未清金额', type:'bar', data: alignSeries(months, data.trend && data.trend.open_amount) },
      { name:'已收货金额', type:'line', data: alignSeries(months, data.trend && data.trend.received_amount), smooth:true }
    ], '金额（元）');

    const list = Array.isArray(data.open_list) ? data.open_list : [];
    if(list.length){
      const overdue = buildPoOverdueBuckets(list);
      renderBarChart(segKey+'_finance_po_open', overdue.buckets, overdue.amounts, '金额（元）');
    }else if(window.ChartManager){
      ChartManager.setEmpty(segKey+'_finance_po_open', '暂无数据');
    }

    renderTopTable(segKey+'_finance_po_open_table', list, [
      { key:'po_no' },
      { key:'supplier' },
      { key:'order_date' },
      { key:'eta' },
      { key:'overdue_days' },
      { key:'amount' },
      { key:'status' }
    ], [
      null,
      null,
      null,
      null,
      (v)=>fmtValue(v,'days'),
      (v)=>fmtValue(v,'money'),
      null
    ]);
  }

  function renderWc(segKey, finance){
    const wc = finance && finance.wc ? finance.wc : {};
    renderKpis(segKey+'_finance_wc_kpis', [
      { label:'NWC', value: fmtValue(wc.nwc, 'money') },
      { label:'CCC(天)', value: fmtValue(wc.ccc, 'days') },
      { label:'DSO(天)', value: fmtValue(wc.dso, 'days') },
      { label:'DPO(天)', value: fmtValue(wc.dpo, 'days') },
      { label:'DIO(天)', value: fmtValue(wc.dio, 'days') }
    ]);

    const insightEl = document.getElementById(segKey+'_finance_wc_insight');
    if(!insightEl) return;
    const insights = (finance && Array.isArray(finance.insights))
      ? finance.insights
      : ((wc && Array.isArray(wc.insights)) ? wc.insights : []);

    let text = '';
    if(insights && insights.length){
      text = insights.join('；');
    }else if(wc && (wc.ccc !== undefined || wc.dso !== undefined || wc.dpo !== undefined || wc.dio !== undefined)){
      text = `当前 CCC ${fmtValue(wc.ccc,'days')} 天（DSO ${fmtValue(wc.dso,'days')} / DIO ${fmtValue(wc.dio,'days')} / DPO ${fmtValue(wc.dpo,'days')}）`;
    }else{
      text = '暂无洞察';
    }
    insightEl.textContent = text;
  }

  window.renderFinance = function(segKey, financeObj){
    const finance = financeObj || (window.DATA && window.DATA[segKey] && window.DATA[segKey].finance) || null;
    const emptyEl = document.getElementById(segKey+'_finance_empty');
    const contentEl = document.getElementById(segKey+'_finance_content');
    const hasFinance = !!(finance && (finance.ar || finance.ap || finance.po || finance.wc || finance.insights));

    if(emptyEl) emptyEl.classList.toggle('show', !hasFinance);
    if(contentEl) contentEl.style.display = hasFinance ? '' : 'none';
    if(!hasFinance) return;

    renderAr(segKey, finance.ar);
    renderAp(segKey, finance.ap);
    renderPo(segKey, finance.po);
    renderWc(segKey, finance);

    if(typeof installAllHeaderFilters === 'function'){
      try{ installAllHeaderFilters(segKey); }catch(e){}
    }
  };
})();
