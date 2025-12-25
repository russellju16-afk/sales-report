(function(){
  'use strict';

  function slugify(text){
    return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function clearMarks(root){
    const marks = root.querySelectorAll('mark');
    marks.forEach((m)=>{
      const parent = m.parentNode;
      if(!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }

  function highlight(root, query){
    clearMarks(root);
    const q = String(query || '').trim();
    if(!q) return 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let count = 0;
    const nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node)=>{
      const text = node.nodeValue;
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      if(idx === -1) return;
      const span = document.createElement('span');
      const before = document.createTextNode(text.slice(0, idx));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(idx, idx + q.length);
      const after = document.createTextNode(text.slice(idx + q.length));
      span.appendChild(before);
      span.appendChild(mark);
      span.appendChild(after);
      node.parentNode.replaceChild(span, node);
      count += 1;
    });
    return count;
  }

  function buildToc(root, tocEl, globalEl){
    if(!root || !tocEl) return;
    const headers = Array.from(root.querySelectorAll('h2, h3'));
    tocEl.innerHTML = '';
    if(globalEl) globalEl.innerHTML = '';
    headers.forEach((h, idx)=>{
      if(!h.id){
        const id = 'bp_' + (slugify(h.textContent) || ('sec_' + idx));
        h.id = id;
      }
      const link = document.createElement('a');
      link.href = '#' + h.id;
      link.textContent = h.textContent;
      link.addEventListener('click', (e)=>{
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      tocEl.appendChild(link);
      if(globalEl){
        const glink = link.cloneNode(true);
        glink.addEventListener('click', (e)=>{
          e.preventDefault();
          if(window.Router) Router.go('bp', h.id);
          h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        globalEl.appendChild(glink);
      }
    });
  }

  function renderCharts(data){
    if(!window.echarts) return;
    const cashEl = document.getElementById('chart_cash');
    const invEl = document.getElementById('chart_inv');
    if(cashEl && data && data.cash){
      const chart = echarts.init(cashEl);
      chart.setOption({
        tooltip: { trigger: 'axis' },
        legend: {},
        xAxis: { type: 'category', data: data.cash.months || [] },
        yAxis: { type: 'value' },
        series: [
          { name: '现金流入', type: 'bar', data: data.cash.cash_in || [] },
          { name: '现金流出', type: 'bar', data: data.cash.cash_out || [] },
          { name: '净现金流', type: 'line', data: data.cash.net_cash || [] },
          { name: '累计净现金流', type: 'line', data: data.cash.cum_net_cash || [] }
        ]
      }, { lazyUpdate: true });
    }
    if(invEl && data && data.inv){
      const chart = echarts.init(invEl);
      chart.setOption({
        tooltip: { trigger: 'axis' },
        legend: {},
        xAxis: { type: 'category', data: data.inv.months || [] },
        yAxis: { type: 'value' },
        series: [
          { name: '采购入库成本', type: 'bar', data: data.inv.purchases_in || [] },
          { name: '销售成本', type: 'bar', data: data.inv.cogs || [] },
          { name: '月末库存', type: 'line', data: data.inv.ending_inventory || [] }
        ]
      }, { lazyUpdate: true });
    }
  }

  function init(){
    const root = document.getElementById('bp_root');
    const toc = document.getElementById('bp_toc');
    const globalToc = document.getElementById('bp_toc_global');
    const searchInput = document.getElementById('bp_search');
    const searchBtn = document.getElementById('bp_search_btn');
    const clearBtn = document.getElementById('bp_clear_btn');
    const printBtn = document.getElementById('bp_print_btn');
    const printTopBtn = document.getElementById('print_bp_btn');

    const loader = window.DataLoader;
    const loadFragment = loader ? loader.fetchTextCached('bp_fragment', './reports/bp_fragment.html') : fetch('./reports/bp_fragment.html').then((r)=>r.text());
    const loadData = loader ? loader.fetchJsonCached('bp_data', './data/bp_latest.json', JSON.parse) : fetch('./data/bp_latest.json').then((r)=>r.json());

    Promise.allSettled([loadFragment, loadData]).then((results)=>{
      if(root && results[0].status === 'fulfilled'){
        root.innerHTML = results[0].value;
        const titleEl = document.getElementById('bp_title');
        const h1 = root.querySelector('h1');
        if(titleEl && h1) titleEl.textContent = h1.textContent;
        buildToc(root, toc, globalToc);
      }
      if(results[1].status === 'fulfilled'){
        renderCharts(results[1].value || {});
      }
    });

    if(searchBtn && searchInput && root){
      searchBtn.addEventListener('click', ()=>{
        const count = highlight(root, searchInput.value);
        if(count){
          const mark = root.querySelector('mark');
          if(mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      searchInput.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter') searchBtn.click();
      });
    }

    if(clearBtn && root){
      clearBtn.addEventListener('click', ()=>{
        if(searchInput) searchInput.value = '';
        clearMarks(root);
      });
    }

    function printBp(){
      document.body.classList.add('print-bp');
      setTimeout(()=>{
        window.print();
        document.body.classList.remove('print-bp');
      }, 50);
    }

    if(printBtn) printBtn.addEventListener('click', printBp);
    if(printTopBtn) printTopBtn.addEventListener('click', printBp);

    document.addEventListener('click', (e)=>{
      const btn = e.target.closest && e.target.closest('[data-bp-target]');
      if(!btn) return;
      const target = btn.dataset.bpTarget;
      if(window.Router) Router.go('bp', target);
      const el = document.getElementById(target);
      if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
