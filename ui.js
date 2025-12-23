var DATA = window.DATA || null;
var ORDER_MAP = window.ORDER_MAP || {};
var ORDER_MAP_CATTON = window.ORDER_MAP_CATTON || {};
var CAT_TON = window.CAT_TON || {};
var CAT_TON_META = window.CAT_TON_META || {};

function _uniqSorted(arrs){
  const s=new Set();
  (arrs||[]).forEach(a=>{(a||[]).forEach(x=>s.add(x));});
  return [...s].sort();
}

function _monthsInCurrentRange(segKey){
  const range = (typeof getRange === 'function') ? getRange(segKey) : {start:'',end:''};
  const months=(DATA && DATA[segKey] && DATA[segKey].months) ? DATA[segKey].months : [];
  if(typeof monthInRange !== 'function') return months.slice();
  return months.filter(m=>monthInRange(m, range.start, range.end));
}

function getOrderList(segKey,type,info){
  try{
    if(type==='catton'){
      const grain=(info&&info.grain)||'month';
      const cat=(info&&info.cat)||'';
      const period=(info&&info.period)||'';
      const segMap2 = (ORDER_MAP_CATTON||{})[segKey] || {};
      if(grain==='week'){
        return (segMap2.week && segMap2.week[`${period}||${cat}`] ? segMap2.week[`${period}||${cat}`] : []).slice();
      }
      return (segMap2.month && segMap2.month[`${period}||${cat}`] ? segMap2.month[`${period}||${cat}`] : []).slice();
    }

    const segMap = (ORDER_MAP||{})[segKey];
    if(!segMap) return [];
    const months=_monthsInCurrentRange(segKey);
    if(type==='category'){
      const cat=(info&&info.cat)||'';
      return _uniqSorted(months.map(m=>segMap.cat_month[`${m}||${cat}`]));
    }
    if(type==='product'){
      const prod=(info&&info.prod)||'';
      const cat=(info&&info.cat)||'';
      return _uniqSorted(months.map(m=>segMap.prod_month[`${m}||${prod}||${cat}`]));
    }
    if(type==='customer'){
      const cust=(info&&info.cust)||'';
      const cls=(info&&info.cls)||'';
      return _uniqSorted(months.map(m=>segMap.cust_month[`${m}||${cust}||${cls}`]));
    }
    if(type==='new' || type==='lost'){
      const month=(info&&info.month)||'';
      const cust=(info&&info.cust)||'';
      const cls=(info&&info.cls)||'';
      return (segMap.cust_month[`${month}||${cust}||${cls}`]||[]).slice();
    }
  }catch(e){}
  return [];
}

function createOrderLink(segKey,type,title,info,text){
  const a=document.createElement('a');
  a.href='javascript:void(0)';
  a.className='order-link';
  a.dataset.seg=segKey;
  a.dataset.type=type;
  a.dataset.title=title||'订单明细';
  a.dataset.info=JSON.stringify(info||{});
  a.textContent=text;
  return a;
}

let _orderModalCache=[];
let _orderModalView=[];
let _orderModalTitle='订单明细';

function _escapeHTML(s){
  return String(s).replace(/[&<>"']/g,(m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

let _toastTimer=null;
function _flashToast(msg){
  const el=document.getElementById('toast');
  if(!el) return;
  el.textContent=msg||'';
  el.classList.add('show');
  if(_toastTimer) clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>{ el.classList.remove('show'); }, 1200);
}

function _applyOrderModalFilter(){
  const input=document.getElementById('order_modal_search');
  const q=(input && input.value ? input.value.trim().toLowerCase() : '');
  _orderModalView = q ? _orderModalCache.filter(x=>String(x).toLowerCase().includes(q)) : _orderModalCache.slice();
}

function _renderOrderModal(){
  const ttlTxt=document.getElementById('order_modal_title_text');
  const meta=document.getElementById('order_modal_meta');
  const count=document.getElementById('order_modal_count');
  const list=document.getElementById('order_modal_list');
  if(ttlTxt) ttlTxt.textContent=_orderModalTitle||'订单明细';
  const total=_orderModalCache.length, cur=_orderModalView.length;
  if(meta) meta.textContent = total? `（${cur}/${total}）` : '（0）';
  if(count) count.textContent = total? `当前显示：${cur} 条` : '';
  if(!list) return;

  if(!_orderModalView.length){
    list.innerHTML = '<div class="order-empty">（无订单明细）</div>';
    return;
  }

  const frag=document.createDocumentFragment();
  list.innerHTML='';
  _orderModalView.forEach(o=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='order-pill';
    btn.dataset.order=String(o);
    btn.innerHTML = `<span class="order-no">${_escapeHTML(o)}</span><span class="mini">⧉</span>`;
    frag.appendChild(btn);
  });
  list.appendChild(frag);
}

function _ensureOrderModalHandlers(){
  if(window.__orderModalBound) return;
  window.__orderModalBound=true;

  const input=document.getElementById('order_modal_search');
  if(input){
    input.addEventListener('input', ()=>{
      _applyOrderModalFilter();
      _renderOrderModal();
    });
  }

  document.addEventListener('click', (e)=>{
    const btn = e.target && e.target.closest ? e.target.closest('.order-pill') : null;
    if(!btn) return;
    const ord = btn.dataset.order || '';
    if(!ord) return;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(ord).then(()=>_flashToast(`已复制：${ord}`)).catch(()=>{});
      return;
    }
    const ta=document.createElement('textarea');
    ta.value=ord; document.body.appendChild(ta);
    ta.select();
    try{document.execCommand('copy'); _flashToast(`已复制：${ord}`);}catch(err){}
    document.body.removeChild(ta);
  });

  document.addEventListener('keydown', (e)=>{
    if(e.key!=='Escape') return;
    const modal=document.getElementById('order_modal');
    if(modal && modal.classList.contains('show')) closeOrderModal();
  });
}

function showOrderModal(title, orders){
  const modal=document.getElementById('order_modal');
  if(!modal) return;
  _orderModalTitle = title || '订单明细';
  _orderModalCache = (orders||[]).slice();
  const input=document.getElementById('order_modal_search');
  if(input) input.value='';
  _applyOrderModalFilter();
  _renderOrderModal();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  _ensureOrderModalHandlers();
  if(input) setTimeout(()=>{ try{input.focus();}catch(e){} }, 60);
}

function closeOrderModal(){
  const modal=document.getElementById('order_modal');
  if(modal){
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
  }
}

function clearOrderModalSearch(){
  const input=document.getElementById('order_modal_search');
  if(input){
    input.value='';
    _applyOrderModalFilter();
    _renderOrderModal();
    try{input.focus();}catch(e){}
  }
}

function copyOrderModal(copyAll){
  const arr = copyAll ? _orderModalCache : _orderModalView;
  const txt = arr && arr.length ? arr.join('\n') : '';
  if(!txt) return;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(()=>_flashToast(copyAll?'已复制全部':'已复制当前筛选')).catch(()=>{});
    return;
  }
  const ta=document.createElement('textarea');
  ta.value=txt; document.body.appendChild(ta);
  ta.select();
  try{document.execCommand('copy'); _flashToast(copyAll?'已复制全部':'已复制当前筛选');}catch(e){}
  document.body.removeChild(ta);
}

document.addEventListener('click', (e)=>{
  const a = e.target.closest && e.target.closest('a.order-link');
  if(!a) return;
  e.preventDefault();
  const segKey=a.dataset.seg;
  const type=a.dataset.type;
  const title=a.dataset.title;
  let info={};
  try{ info=JSON.parse(a.dataset.info||'{}'); }catch(err){ info={}; }
  const orders=getOrderList(segKey,type,info);
  showOrderModal(title, orders);
});

// ===== 表头筛选（所有列表） =====
function getTableId(segKey,type){
  return {
    category: segKey+'_category_table',
    product: segKey+'_product_table',
    customer: segKey+'_customer_table',
    new: segKey+'_new_table',
    lost: segKey+'_lost_table',
    abnormal: segKey+'_abnormal_table'
  }[type] || null;
}

function syncBaseDisplay(table){
  const tb = table && table.tBodies && table.tBodies[0];
  if(!tb) return;
  [...tb.rows].forEach(tr=>{
    tr.dataset.baseDisplay = (tr.style.display==='none'?'none':'');
  });
}

function installAllHeaderFilters(segKey){
  const seg = document.getElementById('seg_'+segKey);
  if(!seg) return;
  seg.querySelectorAll('table').forEach(t=>installHeaderFiltersForTable(t));
}

function installHeaderFiltersForTable(table){
  if(!table || !table.tHead || !table.tHead.rows || table.tHead.rows.length===0) return;
  const thead = table.tHead;
  const headerRow = thead.rows[0];
  if(!headerRow) return;

  const oldRow = thead.querySelector('tr.filter-row');
  const oldVals = [];
  if(oldRow){
    [...oldRow.cells].forEach(th=>{
      const ctl = th.querySelector('input,select');
      oldVals.push(ctl ? ctl.value : '');
    });
    oldRow.remove();
  }

  const tb = table.tBodies && table.tBodies[0];
  if(tb){
    [...tb.rows].forEach(tr=>{
      if(tr.dataset.baseDisplay===undefined){
        tr.dataset.baseDisplay = (tr.style.display==='none'?'none':'');
      }
    });
  }

  const filterRow = document.createElement('tr');
  filterRow.className = 'filter-row';

  const colCount = headerRow.cells.length;
  for(let ci=0; ci<colCount; ci++){
    const hcell = headerRow.cells[ci];
    const th = document.createElement('th');
    th.className = 'filter-cell';

    const samples = getColumnSamples(table, ci, 60);
    const uniq = uniqueNonEmpty(samples);
    const headerText = (hcell.innerText || '').trim();
    const numeric = isMostlyNumeric(samples) || /%|额|毛利|成本|费用|吨|利润|数量|单价|均价|价格/.test(headerText);

    let ctl;
    if(!numeric && uniq.length>0 && uniq.length<=15){
      ctl = document.createElement('select');
      const opts = ['<option value="">全部</option>']
        .concat(uniq.sort().map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`));
      ctl.innerHTML = opts.join('');
      ctl.value = oldVals[ci] || '';
      ctl.addEventListener('change', ()=>applyHeaderFiltersForTable(table));
    }else{
      ctl = document.createElement('input');
      ctl.type = 'text';
      ctl.placeholder = '筛选';
      ctl.value = oldVals[ci] || '';
      ctl.addEventListener('input', debounce(()=>applyHeaderFiltersForTable(table), 120));
    }
    ctl.addEventListener('click', (e)=>e.stopPropagation());
    th.appendChild(ctl);
    filterRow.appendChild(th);
  }

  thead.appendChild(filterRow);
  applyHeaderFiltersForTable(table);
}

function applyHeaderFiltersForTable(table){
  if(!table || !table.tHead || !table.tBodies || !table.tBodies[0]) return;
  const fr = table.tHead.querySelector('tr.filter-row');
  if(!fr) return;
  const ctrls = [...fr.querySelectorAll('input,select')];
  const rows = [...table.tBodies[0].rows];

  rows.forEach(tr=>{
    const base = (tr.dataset.baseDisplay==='none') ? 'none' : '';
    tr.style.display = base;
    if(base==='none') return;

    let ok = true;
    for(let i=0; i<ctrls.length; i++){
      const ctl = ctrls[i];
      const v = (ctl.value || '').trim();
      if(!v) continue;

      const cellText = (tr.cells[i]?.innerText || '').trim();
      if(ctl.tagName === 'SELECT'){
        if(cellText !== v){ ok=false; break; }
      }else{
        if(!cellText.toLowerCase().includes(v.toLowerCase())){ ok=false; break; }
      }
    }
    if(!ok) tr.style.display = 'none';
  });

  try{
    const id = table.id || '';
    const m = id.match(/^(total|store|nonstore)_(\w+)_table$/);
    if(m){
      const segKey=m[1], type=m[2];
      const countEl=document.getElementById(segKey+'_'+type+'_count');
      if(countEl){
        const visible = rows.filter(r=>r.style.display!=='none').length;
        countEl.innerText = String(visible);
      }
    }
  }catch(e){}
}

function getColumnSamples(table, colIdx, maxN){
  const out=[];
  const tb = table.tBodies && table.tBodies[0];
  if(!tb) return out;
  for(const tr of [...tb.rows]){
    const t = (tr.cells[colIdx]?.innerText || '').trim();
    if(t) out.push(t);
    if(out.length>=maxN) break;
  }
  return out;
}
function uniqueNonEmpty(arr){
  const set=new Set();
  (arr||[]).forEach(x=>{ if(x!=='' && x!=null) set.add(String(x)); });
  return [...set];
}
function isMostlyNumeric(arr){
  if(!arr || arr.length===0) return false;
  let n=0, c=0;
  for(const s of arr){
    const t = String(s).replace(/[,¥￥%]/g,'').trim();
    if(t==='') continue;
    c+=1;
    if(!isNaN(Number(t))) n+=1;
  }
  if(c===0) return false;
  return n >= Math.max(3, Math.floor(c*0.7));
}
function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function debounce(fn, wait){
  let t=null;
  return function(){
    const ctx=this, args=arguments;
    clearTimeout(t);
    t=setTimeout(()=>fn.apply(ctx,args), wait);
  };
}
// ===== 表头筛选 END =====
