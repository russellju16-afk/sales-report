(function(){
  'use strict';

  function openDetail(title, pairs){
    const panel = document.getElementById('explorer_detail_panel');
    const titleEl = document.getElementById('detail_title');
    const body = document.getElementById('detail_body');
    if(!panel || !body) return;
    if(titleEl) titleEl.textContent = title || '明细详情';
    body.innerHTML = '';
    if(!pairs || !pairs.length){
      body.textContent = '暂无明细';
    }else{
      pairs.forEach(([k,v])=>{
        const row = document.createElement('div');
        row.textContent = k + '：' + v;
        body.appendChild(row);
      });
    }
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden','false');
  }

  function handleRowClick(e){
    const row = e.target.closest('tr');
    if(!row || !row.closest('#route_explorer')) return;
    if(row.closest('thead') || row.classList.contains('filter-row')) return;
    const table = row.closest('table');
    if(!table || !table.tHead) return;
    const headers = Array.from(table.tHead.querySelectorAll('th')).map((th)=>th.textContent.trim());
    const cells = Array.from(row.children).map((td)=>td.textContent.trim());
    if(!headers.length || !cells.length) return;
    const pairs = headers.map((h, i)=>[h || ('字段' + (i+1)), cells[i] || '—']);
    openDetail('明细详情', pairs);
  }

  document.addEventListener('click', handleRowClick);
})();
