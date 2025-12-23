var DATA = window.DATA || null;
var ORDER_MAP = window.ORDER_MAP || {};
var ORDER_MAP_CATTON = window.ORDER_MAP_CATTON || {};
var CAT_TON = window.CAT_TON || {};
var CAT_TON_META = window.CAT_TON_META || {oil_density:0.92, fallback_bag_kg:1, missing_weight_lines:0};

const DATA_META = { generatedAt: null };

function getDataUrl(){
  const base = window.DATA_URL || './data/latest.json';
  const joiner = base.includes('?') ? '&' : '?';
  return base + joiner + 'v=' + Date.now();
}

async function loadData(){
  const url = getDataUrl();
  const resp = await fetch(url, { cache: 'no-store' });
  if(!resp.ok) throw new Error('数据文件加载失败: HTTP ' + resp.status);
  return resp.json();
}

function normalizeData(raw){
  const root = raw && raw.data ? raw.data : (raw || {});
  const segments = {};
  ['total','store','nonstore'].forEach((key)=>{
    const seg = root[key] || {};
    segments[key] = {
      months: seg.months || [],
      monthly: seg.monthly || [],
      cat_monthly: seg.cat_monthly || [],
      products: seg.products || [],
      customers: seg.customers || [],
      new_customers: seg.new_customers || [],
      lost_customers: seg.lost_customers || [],
      abnormal_orders: seg.abnormal_orders || []
    };
  });
  return {
    segments,
    orderMap: root.order_map || root.orderMap || raw.order_map || raw.orderMap || {},
    orderMapCatTon: root.order_map_catton || root.orderMapCatTon || raw.order_map_catton || raw.orderMapCatTon || {},
    catTon: root.cat_ton || root.catTon || raw.cat_ton || raw.catTon || {},
    catTonMeta: root.cat_ton_meta || root.catTonMeta || raw.cat_ton_meta || raw.catTonMeta || {},
    generatedAt: raw && raw.generatedAt ? raw.generatedAt : (root.generatedAt || null)
  };
}

function showDataStatus(ok, msg){
  const el = document.getElementById('data_status');
  if(!el) return;
  el.classList.toggle('err', !ok);
  el.textContent = msg;
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

async function bootstrap(){
  try{
    setErrorState(false, '');
    setLoadingState(true, '正在拉取 ./data/latest.json');
    showDataStatus(true, '数据加载中…');
    const raw = await loadData();
    const normalized = normalizeData(raw);

    DATA = normalized.segments;
    ORDER_MAP = normalized.orderMap || {};
    ORDER_MAP_CATTON = normalized.orderMapCatTon || {};
    CAT_TON = normalized.catTon || {};
    CAT_TON_META = Object.assign({oil_density:0.92, fallback_bag_kg:1, missing_weight_lines:0}, normalized.catTonMeta || {});
    DATA_META.generatedAt = normalized.generatedAt;

    const ts = DATA_META.generatedAt ? ('数据更新时间：' + DATA_META.generatedAt) : '数据已加载';
    showDataStatus(true, ts);
    init();
    setLoadingState(false, '');
  }catch(e){
    console.error(e);
    setLoadingState(false, '');
    setErrorState(true, e && e.message ? e.message : '数据加载失败');
    showDataStatus(false, '数据加载失败，请刷新重试（F5）');
  }
}

let currentSeg='total';
const tabState={};
const sortState={};

function fmtWan(x){const n=Number(x); if(!isFinite(n)) return ''; return (n/10000).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' 万';}
function fmtYi(x){const n=Number(x); if(!isFinite(n)) return ''; return (n/1e8).toFixed(3)+' 亿';}
function fmtNum(x){const n=Number(x); if(!isFinite(n)) return ''; return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtPct(x){const n=Number(x); if(!isFinite(n)) return ''; return n.toFixed(2)+'%';}
function parseNumber(s){if(s===null||s===undefined) return NaN; const t=String(s).replace(/,/g,'').replace(/%/g,'').trim(); const v=parseFloat(t); return isNaN(v)?NaN:v;}
function monthInRange(m,start,end){if(!start||!end) return true; return (m>=start && m<=end);}

function formatTooltipValue(name, value){
  if(value===null || value===undefined || value==='') return '';
  if(String(name).includes('率') || String(name).includes('%')) return fmtPct(value);
  return fmtNum(value);
}

function makeSegHTML(segKey){
  return `
    <div class="seg-title">
      <div>维度：${segKey==='total'?'全部':(segKey==='store'?'超群门店':'非超群门店')}（含品类 + 新增/流失）</div>
      <div class="timebox">
        <span class="chip">时间范围筛选</span>
        <label class="ctl">开始月：<select id="${segKey}_m_start" onchange="onSegTimeChange('${segKey}')"></select></label>
        <label class="ctl">结束月：<select id="${segKey}_m_end" onchange="onSegTimeChange('${segKey}')"></select></label>
        <button class="btn" onclick="resetSegTime('${segKey}')">重置时间</button>
      </div>
    </div>

    <div id="${segKey}_kpis"></div>

    <div class="tabs">
      <button class="tabbtn active" data-seg="${segKey}" data-tab="overview" onclick="showTab('${segKey}','overview')">总览</button>
      <button class="tabbtn" data-seg="${segKey}" data-tab="category" onclick="showTab('${segKey}','category')">品类</button>
      <button class="tabbtn" data-seg="${segKey}" data-tab="product" onclick="showTab('${segKey}','product')">产品</button>
      <button class="tabbtn" data-seg="${segKey}" data-tab="customer" onclick="showTab('${segKey}','customer')">客户</button>
      <button class="tabbtn" data-seg="${segKey}" data-tab="lifecycle" onclick="showTab('${segKey}','lifecycle')">新增/流失客户</button>
      <button class="tabbtn" data-seg="${segKey}" data-tab="abnormal" onclick="showTab('${segKey}','abnormal')">异常订单</button>
    </div>

    <div class="section active" id="${segKey}_overview">
      <div class="grid2">
        <div class="card"><div id="${segKey}_chart_sales" class="plot"></div></div>
        <div class="card"><div id="${segKey}_chart_fee" class="plot"></div></div>
      </div>
      <div class="insight-grid">
        <div class="insight">
          <h3>增长点提示（按当前时间范围）</h3>
          <div class="small" id="${segKey}_insights"></div>
        </div>
        <div class="insight">
          <h3>结构提示（品类维度）</h3>
          <div class="small" id="${segKey}_structure"></div>
        </div>
      </div>
      <div class="hint">口径：毛利=销售额-成本；毛利_扣销售费=毛利-表内关联销售费用（不做净利润）。</div>
    </div>

    <div class="section" id="${segKey}_category">
      <div class="grid2">
        <div class="card"><div id="${segKey}_chart_cat_sales" class="plot"></div></div>
        <div class="card"><div id="${segKey}_chart_cat_gp" class="plot"></div></div>
      </div>
      <div class="grid2" style="margin-top:12px;">
        <div class="card"><div id="${segKey}_chart_cat_rank" class="plot-sm"></div></div>
        <div class="note">
          <b>品类口径</b>
          <ul>
            <li>大米 / 食用油 / 面粉 / 杂粮 / 其他（根据商品名称+规格关键字自动归类）</li>
            <li>如需更精细拆分（例如“豆制品/调味品/餐饮小料”），告诉我关键词规则即可</li>
          </ul>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <div class="controls" style="justify-content:space-between;margin-bottom:6px;">
          <div style="font-weight:900;">大米 / 食用油 / 面粉 / 杂粮：吨数 & 每吨利润（周 / 月）</div>
          <div class="controls" style="margin:0;">
            <label class="ctl">粒度：
              <select id="${segKey}_catton_grain" onchange="renderCatTon('${segKey}')">
                <option value="month">按月</option>
                <option value="week">按周</option>
              </select>
            </label>
            <span class="small" id="${segKey}_catton_note"></span>
          </div>
        </div>

        <div class="grid2">
          <div class="card" style="box-shadow:none;border:1px solid #eee;padding:10px;">
            <div id="${segKey}_chart_cat_ton" class="plot-sm"></div>
          </div>
          <div class="card" style="box-shadow:none;border:1px solid #eee;padding:10px;">
            <div id="${segKey}_chart_cat_ppt" class="plot-sm"></div>
          </div>
        </div>

        <div class="table-wrap" style="margin-top:12px;box-shadow:none;border:1px solid #eee;">
          <div class="controls">
            <input class="search" id="${segKey}_catton_search" placeholder="搜索周期/品类..." oninput="filterCatTonTable('${segKey}')"/>
            <button class="btn" onclick="resetCatTonTable('${segKey}')">重置</button>
            <button class="btn" onclick="exportCatTonCSV('${segKey}')">导出CSV(当前过滤)</button>
            <span class="count">显示：<b id="${segKey}_catton_count">0</b></span>
          </div>
          <div class="table-scroll" style="max-height:360px;">
            <table id="${segKey}_catton_table">
              <thead><tr>
                <th onclick="sortCatTon('${segKey}',0)">周期</th>
                <th onclick="sortCatTon('${segKey}',1)">品类</th>
                <th onclick="sortCatTon('${segKey}',2)">销量(吨)</th>
                <th onclick="sortCatTon('${segKey}',3)">毛利_扣销售费(元)</th>
                <th onclick="sortCatTon('${segKey}',4)">每吨利润(元/吨)</th>
                <th onclick="sortCatTon('${segKey}',5)">订单数</th>
              </tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>

      ${makeTableShell(segKey,'category')}
    </div>

    <div class="section" id="${segKey}_product">
      <div class="grid2">
        <div class="card"><div id="${segKey}_chart_prod_top" class="plot"></div></div>
        <div class="card"><div id="${segKey}_chart_prod_scatter" class="plot"></div></div>
      </div>
      ${makeTableShell(segKey,'product')}
    </div>

    <div class="section" id="${segKey}_customer">
      <div class="grid2">
        <div class="card"><div id="${segKey}_chart_cust_top" class="plot"></div></div>
        <div class="card"><div id="${segKey}_chart_cust_scatter" class="plot"></div></div>
      </div>
      ${makeTableShell(segKey,'customer')}
    </div>

    <div class="section" id="${segKey}_lifecycle">
      <div class="grid2">
        <div class="card"><div id="${segKey}_chart_newlost_cnt" class="plot"></div></div>
        <div class="card"><div id="${segKey}_chart_newlost_val" class="plot"></div></div>
      </div>
      
      <div class="note" style="margin-top:12px;">
        <b>口径说明（已重梳理）</b>
        <ul>
          <li><b>新增客户</b>：本月有下单，且上月无下单（相对上月新增）。</li>
          <li><b>流失客户</b>：本月有下单，且下月无下单（相对下月流失，归属到最后下单月）。</li>
          <li>时间范围筛选后，会在筛选范围内重新计算；边界月因为缺少上/下月，会按“无上/下月”处理。</li>
        </ul>
      </div>
      <div class="grid2" style="margin-top:12px;">
        <div class="card">${makeTableShell(segKey,'new')}</div>
        <div class="card">${makeTableShell(segKey,'lost')}</div>
      </div>
    </div>

    <div class="section" id="${segKey}_abnormal">
      <div class="grid2">
        <div class="card"><div id="${segKey}_chart_abn_reason" class="plot"></div></div>
        <div class="note">
          <b>异常筛选标准（严格）</b>
          <ul>
            <li>倒挂/亏损：毛利（扣销售费）&lt; 0</li>
            <li>数量异常：数量缺失或 ≤ 0</li>
            <li>成本异常：成本缺失或 ≤ 0</li>
            <li>单价偏低：同品近14天中位价下浮 ≥ 20%</li>
            <li>同日同客同品不同价</li>
            <li>低毛利：毛利率（扣销售费）&lt; 0.2%</li>
          </ul>
        </div>
      </div>
      ${makeTableShell(segKey,'abnormal')}
    </div>
  `;
}

function makeTableShell(segKey,type){
  if(type==='category'){
    return `
    <div class="table-wrap" style="margin-top:12px;">
      <div class="controls">
        <input class="search" id="${segKey}_category_search" placeholder="搜索品类..." oninput="filterTable('${segKey}','category')"/>
        <button class="btn" onclick="resetTable('${segKey}','category')">重置</button>
        <button class="btn" onclick="exportTableCSV('${segKey}','category')">导出CSV(当前过滤)</button>
        <span class="count">显示：<b id="${segKey}_category_count">0</b></span>
      </div>
      <div class="table-scroll" style="max-height:360px;">
        <table id="${segKey}_category_table">
          <thead><tr>
            <th onclick="sortTable('${segKey}','category',0)">品类</th>
            <th onclick="sortTable('${segKey}','category',1)">销售额</th>
            <th onclick="sortTable('${segKey}','category',2)">毛利</th>
            <th onclick="sortTable('${segKey}','category',3)">毛利率%</th>
            <th onclick="sortTable('${segKey}','category',4)">销售费用</th>
            <th onclick="sortTable('${segKey}','category',5)">毛利_扣销售费</th>
            <th onclick="sortTable('${segKey}','category',6)">毛利率(扣销售费)%</th>
            <th onclick="sortTable('${segKey}','category',7)">数量</th>
            <th onclick="sortTable('${segKey}','category',8)">订单数</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;
  }
  if(type==='product'){
    return `
    <div class="table-wrap">
      <div class="controls">
        <input class="search" id="${segKey}_product_search" placeholder="搜索产品（名称/规格）..." oninput="filterTable('${segKey}','product')"/>
        <label class="ctl">品类：
          <select id="${segKey}_product_cat" onchange="filterTable('${segKey}','product')"><option value="">全部</option></select>
        </label>
        <label class="ctl">销售额≥(元)：<input id="${segKey}_product_min_sales" type="number" placeholder="例如 50000" oninput="filterTable('${segKey}','product')"/></label>
        <label class="ctl">毛利率≥(%): <input id="${segKey}_product_min_gm" type="number" step="0.01" placeholder="例如 5" oninput="filterTable('${segKey}','product')"/></label>
        <button class="btn" onclick="resetTable('${segKey}','product')">重置</button>
        <button class="btn" onclick="exportTableCSV('${segKey}','product')">导出CSV(当前过滤)</button>
        <span class="count">显示：<b id="${segKey}_product_count">0</b></span>
      </div>
      <div class="table-scroll">
        <table id="${segKey}_product_table">
          <thead><tr>
            <th onclick="sortTable('${segKey}','product',0)">产品</th>
            <th onclick="sortTable('${segKey}','product',1)">品类</th>
            <th onclick="sortTable('${segKey}','product',2)">销售额</th>
            <th onclick="sortTable('${segKey}','product',3)">毛利</th>
            <th onclick="sortTable('${segKey}','product',4)">毛利率%</th>
            <th onclick="sortTable('${segKey}','product',5)">销售费用</th>
            <th onclick="sortTable('${segKey}','product',6)">毛利_扣销售费</th>
            <th onclick="sortTable('${segKey}','product',7)">毛利率(扣销售费)%</th>
            <th onclick="sortTable('${segKey}','product',8)">数量</th>
            <th onclick="sortTable('${segKey}','product',9)">订单数</th>
            <th onclick="sortTable('${segKey}','product',10)">单据行数</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="hint">Top榜默认按“毛利_扣销售费”排序。</div>
    </div>`;
  }
  if(type==='customer'){
    return `
    <div class="table-wrap">
      <div class="controls">
        <input class="search" id="${segKey}_customer_search" placeholder="搜索客户（名称/分类）..." oninput="filterTable('${segKey}','customer')"/>
        <label class="ctl">客户分类：
          <select id="${segKey}_customer_class" onchange="filterTable('${segKey}','customer')"><option value="">全部</option></select>
        </label>
        <label class="ctl">销售额≥(元)：<input id="${segKey}_customer_min_sales" type="number" placeholder="例如 50000" oninput="filterTable('${segKey}','customer')"/></label>
        <label class="ctl">毛利率≥(%): <input id="${segKey}_customer_min_gm" type="number" step="0.01" placeholder="例如 5" oninput="filterTable('${segKey}','customer')"/></label>
        <button class="btn" onclick="resetTable('${segKey}','customer')">重置</button>
        <button class="btn" onclick="exportTableCSV('${segKey}','customer')">导出CSV(当前过滤)</button>
        <span class="count">显示：<b id="${segKey}_customer_count">0</b></span>
      </div>
      <div class="table-scroll">
        <table id="${segKey}_customer_table">
          <thead><tr>
            <th onclick="sortTable('${segKey}','customer',0)">客户名称</th>
            <th onclick="sortTable('${segKey}','customer',1)">客户分类</th>
            <th onclick="sortTable('${segKey}','customer',2)">销售额</th>
            <th onclick="sortTable('${segKey}','customer',3)">毛利</th>
            <th onclick="sortTable('${segKey}','customer',4)">毛利率%</th>
            <th onclick="sortTable('${segKey}','customer',5)">销售费用</th>
            <th onclick="sortTable('${segKey}','customer',6)">毛利_扣销售费</th>
            <th onclick="sortTable('${segKey}','customer',7)">毛利率(扣销售费)%</th>
            <th onclick="sortTable('${segKey}','customer',8)">订单数</th>
            <th onclick="sortTable('${segKey}','customer',9)">单据行数</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;
  }
  if(type==='new' || type==='lost'){
    const t = (type==='new')?'新增客户（本月有单且上月无单）':'流失客户（本月有单且下月无单）';
    return `
    <div>
      <div style="font-weight:900;margin-bottom:8px;">${t}</div>
      <div class="controls">
        <label class="ctl">月份：<select id="${segKey}_${type}_month" onchange="filterTable('${segKey}','${type}')"><option value="">全部</option></select></label>
        <label class="ctl">客户分类：<select id="${segKey}_${type}_class" onchange="filterTable('${segKey}','${type}')"><option value="">全部</option></select></label>
        <input class="search" id="${segKey}_${type}_search" placeholder="搜索客户..." oninput="filterTable('${segKey}','${type}')"/>
        <button class="btn" onclick="resetTable('${segKey}','${type}')">重置</button>
        <button class="btn" onclick="exportTableCSV('${segKey}','${type}')">导出CSV(当前过滤)</button>
        <span class="count">显示：<b id="${segKey}_${type}_count">0</b></span>
      </div>
      <div class="table-scroll" style="max-height:420px;">
        <table id="${segKey}_${type}_table">
          <thead><tr>
            <th onclick="sortTable('${segKey}','${type}',0)">月份</th>
            <th onclick="sortTable('${segKey}','${type}',1)">客户名称</th>
            <th onclick="sortTable('${segKey}','${type}',2)">客户分类</th>
            <th onclick="sortTable('${segKey}','${type}',3)">销售额</th>
            <th onclick="sortTable('${segKey}','${type}',4)">毛利_扣销售费</th>
            <th onclick="sortTable('${segKey}','${type}',5)">毛利率(扣费)%</th>
            <th onclick="sortTable('${segKey}','${type}',6)">订单数</th>
            <th onclick="sortTable('${segKey}','${type}',7)">单据行数</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;
  }
  if(type==='abnormal'){
    return `
    <div class="table-wrap">
      <div class="controls">
        <input class="search" id="${segKey}_abnormal_search" placeholder="搜索异常订单（单号/客户/原因）..." oninput="filterTable('${segKey}','abnormal')"/>
        <label class="ctl">客户分类：<select id="${segKey}_abnormal_class" onchange="filterTable('${segKey}','abnormal')"><option value="">全部</option></select></label>
        <label class="ctl">销售额≥(元)：<input id="${segKey}_abnormal_min_sales" type="number" placeholder="例如 50000" oninput="filterTable('${segKey}','abnormal')"/></label>
        <label class="ctl">原因包含：<input id="${segKey}_abnormal_reason" placeholder="例如 倒挂/亏损" oninput="filterTable('${segKey}','abnormal')"/></label>
        <label class="ctl">异常原因：<select id="${segKey}_abnormal_reason_sel" onchange="filterTable('${segKey}','abnormal')"><option value="">全部</option></select></label>
        <button class="btn" onclick="resetTable('${segKey}','abnormal')">重置</button>
        <button class="btn" onclick="exportTableCSV('${segKey}','abnormal')">导出CSV(当前过滤)</button>
        <span class="count">显示：<b id="${segKey}_abnormal_count">0</b></span>
      </div>
      <div class="table-scroll">
        <table id="${segKey}_abnormal_table">
          <thead><tr>
            <th onclick="sortTable('${segKey}','abnormal',0)">单据日期</th>
            <th onclick="sortTable('${segKey}','abnormal',1)">单据编号</th>
            <th onclick="sortTable('${segKey}','abnormal',2)">客户名称</th>
            <th onclick="sortTable('${segKey}','abnormal',3)">客户分类</th>
            <th onclick="sortTable('${segKey}','abnormal',4)">销售额</th>
            <th onclick="sortTable('${segKey}','abnormal',5)">毛利_扣销售费</th>
            <th onclick="sortTable('${segKey}','abnormal',6)">毛利率(扣费)%</th>
            <th onclick="sortTable('${segKey}','abnormal',7)">异常行数</th>
            <th onclick="sortTable('${segKey}','abnormal',8)">异常原因</th>
            <th onclick="sortTable('${segKey}','abnormal',9)">严重度</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;
  }
  return '';
}

function init(){
  ['total','store','nonstore'].forEach(segKey=>{
    const segEl = document.getElementById('seg_'+segKey);
    if(segEl) segEl.innerHTML = makeSegHTML(segKey);
    initMonthSelect(segKey);
  });
  showSeg('total');
  const reloadBtn = document.getElementById('reload_btn');
  if(reloadBtn){
    reloadBtn.addEventListener('click', ()=>window.location.reload());
  }
}

function initMonthSelect(segKey){
  const months=DATA[segKey].months||[];
  const s=document.getElementById(segKey+'_m_start');
  const e=document.getElementById(segKey+'_m_end');
  if(!s || !e) return;
  s.innerHTML=''; e.innerHTML='';
  for(const m of months){
    const o1=document.createElement('option'); o1.value=m; o1.text=m; s.appendChild(o1);
    const o2=document.createElement('option'); o2.value=m; o2.text=m; e.appendChild(o2);
  }
  s.value=months[0]||'';
  e.value=months[months.length-1]||'';
}

function getRange(segKey){
  const start=document.getElementById(segKey+'_m_start').value;
  const end=document.getElementById(segKey+'_m_end').value;
  return {start,end};
}

function resetSegTime(segKey){
  const months=DATA[segKey].months||[];
  if(!months.length) return;
  document.getElementById(segKey+'_m_start').value=months[0];
  document.getElementById(segKey+'_m_end').value=months[months.length-1];
  try{ updateSeg(segKey); }catch(e){ console.error(e); }
}

function onSegTimeChange(segKey){
  const s=document.getElementById(segKey+'_m_start').value;
  const e=document.getElementById(segKey+'_m_end').value;
  if(s && e && s>e){
    document.getElementById(segKey+'_m_start').value=e;
    document.getElementById(segKey+'_m_end').value=s;
  }
  try{ updateSeg(segKey); }catch(e){ console.error(e); }
}

function showSeg(segKey){
  currentSeg=segKey;
  document.querySelectorAll('.seg').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.segbtn').forEach(x=>x.classList.remove('active'));
  document.getElementById('seg_'+segKey).classList.add('active');
  const btns=[...document.querySelectorAll('.segbtn')];
  if(segKey==='total') btns[0].classList.add('active');
  if(segKey==='store') btns[1].classList.add('active');
  if(segKey==='nonstore') btns[2].classList.add('active');
  showTab(segKey, tabState[segKey] || 'overview');
  try{ updateSeg(segKey); }catch(e){ console.error(e); }
}

function showTab(segKey, tabKey){
  tabState[segKey]=tabKey;
  const seg=document.getElementById('seg_'+segKey);
  seg.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));
  seg.querySelectorAll('.tabbtn').forEach(x=>x.classList.remove('active'));
  document.getElementById(segKey+'_'+tabKey).classList.add('active');
  [...seg.querySelectorAll('.tabbtn')].find(b=>b.dataset.tab===tabKey).classList.add('active');
  if(window.ChartManager){
    setTimeout(()=>ChartManager.resizeAll(), 40);
  }
}

function updateSeg(segKey){
  renderKPIs(segKey);
  renderOverview(segKey);
  renderCategory(segKey);
  renderCatTon(segKey);
  renderProducts(segKey);
  renderCustomers(segKey);
  renderLifecycle(segKey);
  renderAbnormal(segKey);

  try{ installAllHeaderFilters(segKey); }catch(e){ console.error(e); }
  if(window.ChartManager){
    setTimeout(()=>ChartManager.resizeAll(), 40);
  }
}

function renderKPIs(segKey){
  const {start,end}=getRange(segKey);
  const rows=(DATA[segKey].monthly||[]).filter(r=>monthInRange(r[0],start,end));
  const sales=rows.reduce((a,r)=>a+r[1],0);
  const gp=rows.reduce((a,r)=>a+r[3],0);
  const fee=rows.reduce((a,r)=>a+r[4],0);
  const gpAdj=rows.reduce((a,r)=>a+r[5],0);
  const gm=sales? gp/sales*100 : NaN;
  const gmAdj=sales? gpAdj/sales*100 : NaN;
  document.getElementById(segKey+'_kpis').innerHTML = `
    <div class="kpis">
      <div class="card"><div class="kpi-name">销售额（含税）</div><div class="kpi-val">${fmtWan(sales)} <span class="kpi-sub">(${fmtYi(sales)})</span></div></div>
      <div class="card"><div class="kpi-name">毛利</div><div class="kpi-val">${fmtWan(gp)}</div></div>
      <div class="card"><div class="kpi-name">综合毛利率</div><div class="kpi-val">${fmtPct(gm)}</div></div>
      <div class="card"><div class="kpi-name">销售费用（表内关联）</div><div class="kpi-val">${fmtWan(fee)}</div></div>
      <div class="card"><div class="kpi-name">毛利-销售费</div><div class="kpi-val">${fmtWan(gpAdj)}（${fmtPct(gmAdj)}）</div></div>
    </div>`;
}

function renderOverview(segKey){
  const {start,end}=getRange(segKey);
  const rows=(DATA[segKey].monthly||[]).filter(r=>monthInRange(r[0],start,end));
  const months=rows.map(r=>r[0]);
  if(!months.length){
    ChartManager.setEmpty(segKey+'_chart_sales', '暂无数据');
    ChartManager.setEmpty(segKey+'_chart_fee', '暂无数据');
    return;
  }
  const cost=rows.map(r=>r[2]);
  const gp=rows.map(r=>r[3]);
  const fee=rows.map(r=>r[4]);
  const gpAdj=rows.map(r=>r[5]);
  const gm=rows.map(r=>r[1]? r[3]/r[1]*100:null);
  const gmAdj=rows.map(r=>r[1]? r[5]/r[1]*100:null);
  const active=rows.map(r=>r[7]);

  ChartManager.setOption(segKey+'_chart_sales',{
    tooltip:{
      trigger:'axis',
      formatter:(params)=>{
        const lines=[params[0]?.axisValue || ''];
        params.forEach(p=>{
          lines.push(`${p.marker}${p.seriesName}：${formatTooltipValue(p.seriesName,p.data)}`);
        });
        return lines.join('<br/>');
      }
    },
    legend:{top:10,type:'scroll'},
    grid:{left:50,right:90,top:60,bottom:40},
    xAxis:{type:'category',data:months},
    yAxis:[
      {type:'value',name:'金额（元）'},
      {type:'value',name:'毛利率(%)',position:'right',axisLabel:{formatter:'{value}%'}},
      {type:'value',name:'活跃客户数',position:'right',offset:55}
    ],
    series:[
      {name:'成本',type:'bar',stack:'amount',data:cost},
      {name:'毛利',type:'bar',stack:'amount',data:gp},
      {name:'毛利率(%)',type:'line',yAxisIndex:1,data:gm,smooth:true},
      {name:'活跃客户数',type:'line',yAxisIndex:2,data:active,smooth:true}
    ]
  });

  ChartManager.setOption(segKey+'_chart_fee',{
    tooltip:{
      trigger:'axis',
      formatter:(params)=>{
        const lines=[params[0]?.axisValue || ''];
        params.forEach(p=>{
          lines.push(`${p.marker}${p.seriesName}：${formatTooltipValue(p.seriesName,p.data)}`);
        });
        return lines.join('<br/>');
      }
    },
    legend:{top:10,type:'scroll'},
    grid:{left:50,right:70,top:60,bottom:40},
    xAxis:{type:'category',data:months},
    yAxis:[
      {type:'value',name:'金额（元）'},
      {type:'value',name:'毛利率(%)',position:'right',axisLabel:{formatter:'{value}%'}}
    ],
    series:[
      {name:'销售费用',type:'bar',data:fee},
      {name:'毛利-销售费',type:'line',data:gpAdj,smooth:true},
      {name:'毛利率(扣销售费)%',type:'line',yAxisIndex:1,data:gmAdj,smooth:true}
    ]
  });

  document.getElementById(segKey+'_insights').innerHTML = computeGrowthInsights(segKey,start,end);
  document.getElementById(segKey+'_structure').innerHTML = computeStructureHints(segKey,start,end);
}

function computeGrowthInsights(segKey,start,end){
  const first=start, last=end;
  function sumBy(arr, keyFn, valIdx, monthIdx){
    const map=new Map();
    for(const r of arr){
      const m=r[monthIdx];
      if(m!==first && m!==last) continue;
      const k=keyFn(r);
      if(!map.has(k)) map.set(k,{first:0,last:0});
      const o=map.get(k);
      if(m===first) o.first+=r[valIdx];
      if(m===last) o.last+=r[valIdx];
    }
    return map;
  }
  const catMap=sumBy(DATA[segKey].cat_monthly, r=>r[1], 6, 0);
  const prodMap=sumBy(DATA[segKey].products, r=>r[0]+'｜'+r[1], 7, 2);
  const custMap=sumBy(DATA[segKey].customers, r=>r[0]+'｜'+r[1], 7, 2);

  function topDelta(map,n){
    const arr=[...map.entries()].map(([k,v])=>({k,d:v.last-v.first}));
    arr.sort((a,b)=>b.d-a.d);
    return arr.slice(0,n);
  }
  const a=topDelta(catMap,3).map(x=>`${x.k}（+${fmtWan(x.d)}）`).join('；') || '—';
  const b=topDelta(prodMap,3).map(x=>`${x.k}（+${fmtWan(x.d)}）`).join('；') || '—';
  const c=topDelta(custMap,3).map(x=>`${x.k}（+${fmtWan(x.d)}）`).join('；') || '—';
  return `
    <div>1) <b>品类毛利增量Top</b>（${first}→${last}）：${a}</div>
    <div>2) <b>产品毛利增量Top</b>（${first}→${last}）：${b}</div>
    <div>3) <b>客户毛利增量Top</b>（${first}→${last}）：${c}</div>
    <div class="hint">提示：增量用于定位“可能的抓手”，再去对应页面下钻看是否可复制/可提价/可扩量。</div>
  `;
}

function computeStructureHints(segKey,start,end){
  const cats=DATA[segKey].cat_monthly.filter(r=>monthInRange(r[0],start,end));
  const map=new Map();
  for(const r of cats){
    const k=r[1];
    if(!map.has(k)) map.set(k,{sales:0,gpAdj:0});
    const o=map.get(k);
    o.sales+=r[2]; o.gpAdj+=r[6];
  }
  const arr=[...map.entries()].map(([k,v])=>({k,sales:v.sales,gpAdj:v.gpAdj,gm:v.sales? v.gpAdj/v.sales*100:null}));
  arr.sort((a,b)=>b.gpAdj-a.gpAdj);
  const top=arr.slice(0,3).map(x=>`${x.k}：毛利_扣费${fmtWan(x.gpAdj)}（毛利率${fmtPct(x.gm)}）`).join('<br/>') || '—';
  const totalSales=arr.reduce((a,x)=>a+x.sales,0);
  const cand=arr.filter(x=>x.sales>totalSales*0.05).sort((a,b)=>(a.gm||0)-(b.gm||0))[0];
  const low = cand? `高销售低毛利关注：<b>${cand.k}</b>（销售${fmtYi(cand.sales)}，毛利率${fmtPct(cand.gm)}）`:'';
  return `<div><b>毛利贡献Top品类</b><br/>${top}</div><div style="margin-top:8px;">${low}</div>`;
}

function renderCategory(segKey){
  const {start,end}=getRange(segKey);
  const rows=DATA[segKey].cat_monthly.filter(r=>monthInRange(r[0],start,end));
  const months=[...new Set(rows.map(r=>r[0]))].sort();
  const cats=[...new Set(rows.map(r=>r[1]))].sort();
  if(!months.length){
    ChartManager.setEmpty(segKey+'_chart_cat_sales', '暂无数据');
    ChartManager.setEmpty(segKey+'_chart_cat_gp', '暂无数据');
    ChartManager.setEmpty(segKey+'_chart_cat_rank', '暂无数据');
  }else{
    const mi=new Map(months.map((m,i)=>[m,i]));
    const by={};
    cats.forEach(c=>by[c]={sales:Array(months.length).fill(0), gpAdj:Array(months.length).fill(0)});
    for(const r of rows){
      const idx=mi.get(r[0]);
      by[r[1]].sales[idx]+=r[2];
      by[r[1]].gpAdj[idx]+=r[6];
    }

    ChartManager.setOption(segKey+'_chart_cat_sales',{
      tooltip:{trigger:'axis'},
      legend:{top:10,type:'scroll'},
      grid:{left:50,right:20,top:60,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name:'销售额（元）'},
      series: cats.map(c=>({name:c,type:'bar',stack:'sales',data:by[c].sales}))
    });

    ChartManager.setOption(segKey+'_chart_cat_gp',{
      tooltip:{trigger:'axis'},
      legend:{top:10,type:'scroll'},
      grid:{left:50,right:20,top:60,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name:'毛利_扣销售费（元）'},
      series: cats.map(c=>({name:c,type:'bar',stack:'gp',data:by[c].gpAdj}))
    });

    const agg=cats.map(c=>({cat:c,sales:by[c].sales.reduce((a,b)=>a+b,0),gpAdj:by[c].gpAdj.reduce((a,b)=>a+b,0)}));
    agg.forEach(x=>x.gm=x.sales? x.gpAdj/x.sales*100:null);
    agg.sort((a,b)=>b.gpAdj-a.gpAdj);
    const top=agg.slice(0,10);
    ChartManager.setOption(segKey+'_chart_cat_rank',{
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
      grid:{left:140,right:20,top:40,bottom:40},
      xAxis:{type:'value',name:'毛利（元）'},
      yAxis:{type:'category',data:top.map(x=>x.cat),inverse:true},
      series:[{name:'毛利_扣销售费',type:'bar',data:top.map(x=>x.gpAdj)}]
    });
  }

  const tbody=document.querySelector('#'+segKey+'_category_table tbody');
  if(tbody){
    tbody.innerHTML='';
    const map2=new Map();
    for(const r of rows){
      const k=r[1];
      if(!map2.has(k)) map2.set(k,{sales:0,cost:0,gp:0,fee:0,gpAdj:0,qty:0,orders:0});
      const o=map2.get(k);
      o.sales+=r[2]; o.cost+=r[3]; o.gp+=r[4]; o.fee+=r[5]; o.gpAdj+=r[6]; o.qty+=r[7]; o.orders+=r[8];
    }
    const list=[...map2.entries()].map(([k,v])=>({k,...v,gm:v.sales? v.gp/v.sales*100:null,gm2:v.sales? v.gpAdj/v.sales*100:null}));
    list.sort((a,b)=>b.gpAdj-a.gpAdj);
    for(const o of list){
      const tr=document.createElement('tr');
      const cells=[o.k,fmtNum(o.sales),fmtNum(o.gp),fmtPct(o.gm),fmtNum(o.fee),fmtNum(o.gpAdj),fmtPct(o.gm2),fmtNum(o.qty),String(o.orders)];
      cells.forEach((c,i)=>{const td=document.createElement('td');
        if(i===8){td.appendChild(createOrderLink(segKey,'category',`品类｜${o.k}`,{cat:o.k},c));}
        else{td.textContent=c;}
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    document.getElementById(segKey+'_category_count').innerText=String(list.length);
    filterTable(segKey,'category');
  }
}

function _monthStartDate(m){
  return new Date(m+'-01T00:00:00');
}
function _monthEndDate(m){
  const d=new Date(m+'-01T00:00:00');
  d.setMonth(d.getMonth()+1);
  d.setDate(0);
  d.setHours(23,59,59,999);
  return d;
}
function _toDate(s){
  return new Date(s+'T00:00:00');
}

const CATTON_STATE = {};

function renderCatTon(segKey){
  const grainEl=document.getElementById(segKey+'_catton_grain');
  if(!grainEl) return;
  const grain=grainEl.value||'month';
  const {start,end}=getRange(segKey);
  const noteEl=document.getElementById(segKey+'_catton_note');
  if(noteEl){
    noteEl.innerText = `口径：数量按规格折吨（油按 ${CAT_TON_META.oil_density}kg/L；袋装无规格默认${CAT_TON_META.fallback_bag_kg}kg；仍有 ${CAT_TON_META.missing_weight_lines} 行无法解析未计入吨数）`;
  }

  const cats=['大米','食用油','面粉','杂粮'];
  let rowsRaw=[];
  if(grain==='week'){
    rowsRaw=(CAT_TON[segKey]&&CAT_TON[segKey].weekly)?CAT_TON[segKey].weekly:[];
    const startDate=_monthStartDate(start);
    const endDate=_monthEndDate(end);
    rowsRaw=rowsRaw.filter(r=>{
      const ws=_toDate(r[0]);
      const we=_toDate(r[1]);
      return we>=startDate && ws<=endDate;
    });
  }else{
    rowsRaw=(CAT_TON[segKey]&&CAT_TON[segKey].monthly)?CAT_TON[segKey].monthly:[];
    rowsRaw=rowsRaw.filter(r=>monthInRange(r[0],start,end));
  }

  const norm = rowsRaw.map(r=>{
    if(grain==='week'){
      return {periodKey:r[0], period:r[2], cat:r[3], tons:r[4], profit:r[5], ppt:r[6], orders:r[7], _t:r[0]};
    }
    return {periodKey:r[0], period:r[0], cat:r[1], tons:r[2], profit:r[3], ppt:r[4], orders:r[5], _t:r[0]+'-01'};
  }).filter(o=>cats.includes(o.cat));

  const periods=[...new Set(norm.map(o=>o.period))];
  periods.sort((a,b)=>{
    const oa=norm.find(x=>x.period===a);
    const ob=norm.find(x=>x.period===b);
    return String(oa?oa._t:'').localeCompare(String(ob?ob._t:''));
  });

  if(!periods.length){
    ChartManager.setEmpty(segKey+'_chart_cat_ton', '暂无数据');
    ChartManager.setEmpty(segKey+'_chart_cat_ppt', '暂无数据');
  }else{
    const by={}; cats.forEach(c=>by[c]={tons:[],ppt:[]});
    for(const p of periods){
      for(const c of cats){
        const hit=norm.find(o=>o.period===p && o.cat===c);
        by[c].tons.push(hit?hit.tons:0);
        by[c].ppt.push(hit && isFinite(hit.ppt)?hit.ppt:null);
      }
    }

    ChartManager.setOption(segKey+'_chart_cat_ton',{
      tooltip:{trigger:'axis'},
      legend:{top:10,type:'scroll'},
      grid:{left:60,right:20,top:60,bottom:70},
      xAxis:{type:'category',data:periods,axisLabel:{rotate:30}},
      yAxis:{type:'value',name:'吨'},
      series: cats.map(c=>({name:c,type:'bar',stack:'tons',data:by[c].tons}))
    });

    ChartManager.setOption(segKey+'_chart_cat_ppt',{
      tooltip:{trigger:'axis'},
      legend:{top:10,type:'scroll'},
      grid:{left:70,right:20,top:60,bottom:70},
      xAxis:{type:'category',data:periods,axisLabel:{rotate:30}},
      yAxis:{type:'value',name:'元/吨'},
      series: cats.map(c=>({name:c,type:'line',data:by[c].ppt,connectNulls:true,smooth:true}))
    });
  }

  CATTON_STATE[segKey]=CATTON_STATE[segKey]||{sortCol:0,sortAsc:true,rows:[],view:[]};
  CATTON_STATE[segKey].rows=norm;
  CATTON_STATE[segKey].sortCol=0; CATTON_STATE[segKey].sortAsc=true;
  applyCatTonView(segKey);
}

function applyCatTonView(segKey){
  const st=CATTON_STATE[segKey];
  if(!st) return;
  const q=(document.getElementById(segKey+'_catton_search').value||'').trim().toLowerCase();
  let arr=st.rows.slice();
  if(q){
    arr=arr.filter(o=>{
      return (String(o.period).toLowerCase().includes(q) || String(o.cat).toLowerCase().includes(q));
    });
  }
  const col=st.sortCol||0;
  const asc=!!st.sortAsc;
  const keyFn = (o)=>{
    if(col===0) return o._t;
    if(col===1) return o.cat;
    if(col===2) return Number(o.tons)||0;
    if(col===3) return Number(o.profit)||0;
    if(col===4) return (isFinite(o.ppt)?Number(o.ppt): -1e30);
    if(col===5) return Number(o.orders)||0;
    return o._t;
  };
  arr.sort((a,b)=>{
    const ka=keyFn(a), kb=keyFn(b);
    let cmp=0;
    if(typeof ka==='string' || typeof kb==='string') cmp=String(ka).localeCompare(String(kb));
    else cmp=(ka-kb);
    return asc?cmp:-cmp;
  });
  st.view=arr;
  renderCatTonTable(segKey);
}

function renderCatTonTable(segKey){
  const st=CATTON_STATE[segKey];
  const tbody=document.querySelector('#'+segKey+'_catton_table tbody');
  if(!tbody||!st) return;
  tbody.innerHTML='';
  for(const o of st.view){
    const tr=document.createElement('tr');
    const cells=[
      o.period,
      o.cat,
      (Number(o.tons)||0).toFixed(3),
      fmtNum(o.profit),
      (isFinite(o.ppt)?Number(o.ppt).toFixed(2):''),
      String(o.orders)
    ];
    cells.forEach((c,i)=>{
      const td=document.createElement('td');
      if(i===5){
        td.appendChild(createOrderLink(segKey,'catton',`品类｜${o.cat}｜${o.period}`,{grain:(document.getElementById(segKey+'_catton_grain').value||'month'),cat:o.cat,period:o.periodKey},c));
      }else{
        td.textContent=c;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  const cnt=document.getElementById(segKey+'_catton_count');
  if(cnt) cnt.innerText=String(st.view.length);
}

function sortCatTon(segKey,col){
  CATTON_STATE[segKey]=CATTON_STATE[segKey]||{sortCol:0,sortAsc:true,rows:[],view:[]};
  const st=CATTON_STATE[segKey];
  if(st.sortCol===col) st.sortAsc=!st.sortAsc;
  else{ st.sortCol=col; st.sortAsc=true; }
  applyCatTonView(segKey);
}

function filterCatTonTable(segKey){ applyCatTonView(segKey); }

function resetCatTonTable(segKey){
  const s=document.getElementById(segKey+'_catton_search');
  if(s) s.value='';
  CATTON_STATE[segKey]=CATTON_STATE[segKey]||{sortCol:0,sortAsc:true,rows:[],view:[]};
  CATTON_STATE[segKey].sortCol=0; CATTON_STATE[segKey].sortAsc=true;
  applyCatTonView(segKey);
}

function exportCatTonCSV(segKey){
  const table=document.getElementById(segKey+'_catton_table');
  if(!table) return;
  const rows=[...table.querySelectorAll('tr')].filter(tr=>tr.style.display!=='none');
  const csv=rows.map(tr=>[...tr.children].map(td=>'"'+td.innerText.replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=segKey+'_catton_export.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function renderProducts(segKey){
  const {start,end}=getRange(segKey);
  const arr=DATA[segKey].products.filter(r=>monthInRange(r[2],start,end));
  const map=new Map();
  for(const r of arr){
    const key=r[0]+'||'+r[1];
    if(!map.has(key)) map.set(key,{prod:r[0],cat:r[1],sales:0,cost:0,gp:0,fee:0,gpAdj:0,qty:0,orders:0,lines:0});
    const o=map.get(key);
    o.sales+=r[3]; o.cost+=r[4]; o.gp+=r[5]; o.fee+=r[6]; o.gpAdj+=r[7]; o.qty+=r[8]; o.orders+=r[9]; o.lines+=r[10];
  }
  const rows=[...map.values()];
  rows.forEach(o=>{o.gm=o.sales? o.gp/o.sales*100:null; o.gm2=o.sales? o.gpAdj/o.sales*100:null;});
  rows.sort((a,b)=>b.gpAdj-a.gpAdj);
  const top=rows.slice(0,20);
  if(top.length){
    ChartManager.setOption(segKey+'_chart_prod_top',{
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
      grid:{left:220,right:20,top:40,bottom:40},
      xAxis:{type:'value',name:'毛利（元）'},
      yAxis:{type:'category',data:top.map(o=>o.prod+' | '+o.cat),inverse:true},
      series:[{name:'毛利_扣销售费',type:'bar',data:top.map(o=>o.gpAdj)}]
    });
  }else{
    ChartManager.setEmpty(segKey+'_chart_prod_top', '暂无数据');
  }
  const scatter=rows.filter(o=>o.sales>0);
  if(scatter.length){
    const scatterData=scatter.map(o=>({
      value:[o.sales,o.gm2,o.gpAdj],
      name:o.prod+' | '+o.cat
    }));
    ChartManager.setOption(segKey+'_chart_prod_scatter',{
      tooltip:{
        formatter:(p)=>{
          const v=p.data.value;
          return `${p.data.name}<br/>销售额=${fmtNum(v[0])}<br/>毛利率(扣费)=${fmtPct(v[1])}`;
        }
      },
      grid:{left:60,right:20,top:40,bottom:50},
      xAxis:{type:'value',name:'销售额（元）'},
      yAxis:{type:'value',name:'毛利率(%)'},
      series:[{
        name:'产品结构',
        type:'scatter',
        data:scatterData,
        symbolSize:(d)=>{
          const v=Math.max(0, d[2] || 0);
          return Math.max(6, Math.min(30, Math.sqrt(v)/20));
        }
      }]
    });
  }else{
    ChartManager.setEmpty(segKey+'_chart_prod_scatter', '暂无数据');
  }

  const catSel=document.getElementById(segKey+'_product_cat');
  if(catSel && catSel.options.length<=1){
    const cats=[...new Set(rows.map(o=>o.cat))].sort();
    catSel.innerHTML='<option value="">全部</option>'+cats.map(c=>`<option value="${c}">${c}</option>`).join('');
  }

  const tbody=document.querySelector('#'+segKey+'_product_table tbody');
  tbody.innerHTML='';
  for(const o of rows){
    const tr=document.createElement('tr');
    const cells=[o.prod,o.cat,fmtNum(o.sales),fmtNum(o.gp),fmtPct(o.gm),fmtNum(o.fee),fmtNum(o.gpAdj),fmtPct(o.gm2),fmtNum(o.qty),String(o.orders),String(o.lines)];
    cells.forEach((c,i)=>{const td=document.createElement('td');
      if(i===9){td.appendChild(createOrderLink(segKey,'product',`产品｜${o.prod}｜${o.cat}`,{prod:o.prod,cat:o.cat},c));}
      else{td.textContent=c;}
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  document.getElementById(segKey+'_product_count').innerText=String(rows.length);
  filterTable(segKey,'product');
}

function renderCustomers(segKey){
  const {start,end}=getRange(segKey);
  const arr=DATA[segKey].customers.filter(r=>monthInRange(r[2],start,end));
  const map=new Map();
  for(const r of arr){
    const key=r[0]+'||'+r[1];
    if(!map.has(key)) map.set(key,{cust:r[0],cls:r[1],sales:0,gp:0,fee:0,gpAdj:0,orders:0,lines:0});
    const o=map.get(key);
    o.sales+=r[3]; o.gp+=r[5]; o.fee+=r[6]; o.gpAdj+=r[7]; o.orders+=r[9]; o.lines+=r[10];
  }
  const rows=[...map.values()];
  rows.forEach(o=>{o.gm=o.sales? o.gp/o.sales*100:null; o.gm2=o.sales? o.gpAdj/o.sales*100:null;});
  rows.sort((a,b)=>b.gpAdj-a.gpAdj);
  const top=rows.slice(0,20);
  if(top.length){
    ChartManager.setOption(segKey+'_chart_cust_top',{
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
      grid:{left:220,right:20,top:40,bottom:40},
      xAxis:{type:'value',name:'毛利（元）'},
      yAxis:{type:'category',data:top.map(o=>o.cust+'｜'+o.cls),inverse:true},
      series:[{name:'毛利_扣销售费',type:'bar',data:top.map(o=>o.gpAdj)}]
    });
  }else{
    ChartManager.setEmpty(segKey+'_chart_cust_top', '暂无数据');
  }
  const scatter=rows.filter(o=>o.sales>0);
  if(scatter.length){
    const scatterData=scatter.map(o=>({
      value:[o.sales,o.gm2,o.gpAdj],
      name:o.cust+'｜'+o.cls
    }));
    ChartManager.setOption(segKey+'_chart_cust_scatter',{
      tooltip:{
        formatter:(p)=>{
          const v=p.data.value;
          return `${p.data.name}<br/>销售额=${fmtNum(v[0])}<br/>毛利率(扣费)=${fmtPct(v[1])}`;
        }
      },
      grid:{left:60,right:20,top:40,bottom:50},
      xAxis:{type:'value',name:'销售额（元）'},
      yAxis:{type:'value',name:'毛利率(%)'},
      series:[{
        name:'客户结构',
        type:'scatter',
        data:scatterData,
        symbolSize:(d)=>{
          const v=Math.max(0, d[2] || 0);
          return Math.max(6, Math.min(30, Math.sqrt(v)/20));
        }
      }]
    });
  }else{
    ChartManager.setEmpty(segKey+'_chart_cust_scatter', '暂无数据');
  }

  const clsSel=document.getElementById(segKey+'_customer_class');
  if(clsSel && clsSel.options.length<=1){
    const cls=[...new Set(rows.map(o=>o.cls).filter(v=>v))].sort();
    clsSel.innerHTML='<option value="">全部</option>'+cls.map(c=>`<option value="${c}">${c}</option>`).join('');
  }

  const tbody=document.querySelector('#'+segKey+'_customer_table tbody');
  tbody.innerHTML='';
  for(const o of rows){
    const tr=document.createElement('tr');
    const cells=[o.cust,o.cls,fmtNum(o.sales),fmtNum(o.gp),fmtPct(o.gm),fmtNum(o.fee),fmtNum(o.gpAdj),fmtPct(o.gm2),String(o.orders),String(o.lines)];
    cells.forEach((c,i)=>{const td=document.createElement('td');
      if(i===8){td.appendChild(createOrderLink(segKey,'customer',`客户｜${o.cust}｜${o.cls}`,{cust:o.cust,cls:o.cls},c));}
      else{td.textContent=c;}
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  document.getElementById(segKey+'_customer_count').innerText=String(rows.length);
  filterTable(segKey,'customer');
}

function renderLifecycle(segKey){
  const {start,end}=getRange(segKey);
  const months=(DATA[segKey].months||[]).filter(m=>monthInRange(m,start,end));

  const cuRows=DATA[segKey].customers.filter(r=>monthInRange(r[2],start,end));
  const byMonth=new Map(months.map(m=>[m,new Map()]));
  for(const r of cuRows){
    const m=r[2];
    if(!byMonth.has(m)) continue;
    const key=r[0]+'||'+r[1];
    byMonth.get(m).set(key,r);
  }

  const newArr=[], lostArr=[];
  for(let i=0;i<months.length;i++){
    const m=months[i];
    const cur=byMonth.get(m)||new Map();
    const prev=(i>0)? (byMonth.get(months[i-1])||new Map()) : new Map();
    const next=(i<months.length-1)? (byMonth.get(months[i+1])||new Map()) : new Map();

    for(const [key,r] of cur.entries()){
      const sales=r[3]||0;
      const gpAdj=r[7]||0;
      const gm2=sales? (gpAdj/sales*100):null;
      const row=[m,r[0],r[1],sales,gpAdj,gm2,r[9]||0,r[10]||0];
      if(!prev.has(key)) newArr.push(row);
      if(!next.has(key)) lostArr.push(row);
    }
  }
  newArr.sort((a,b)=>a[0].localeCompare(b[0]) || (b[3]-a[3]));
  lostArr.sort((a,b)=>a[0].localeCompare(b[0]) || (b[3]-a[3]));

  const initMap=()=>new Map(months.map(m=>[m,{cnt:0,sales:0,gp:0}]));
  const newBy=initMap(), lostBy=initMap();
  newArr.forEach(r=>{const o=newBy.get(r[0]); if(o){o.cnt+=1;o.sales+=r[3];o.gp+=r[4];}});
  lostArr.forEach(r=>{const o=lostBy.get(r[0]); if(o){o.cnt+=1;o.sales+=r[3];o.gp+=r[4];}});

  if(months.length){
    ChartManager.setOption(segKey+'_chart_newlost_cnt',{
      tooltip:{trigger:'axis'},
      legend:{top:10},
      grid:{left:50,right:20,top:50,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name:'客户数'},
      series:[
        {name:'新增客户数',type:'line',data:months.map(m=>newBy.get(m).cnt),smooth:true},
        {name:'流失客户数',type:'line',data:months.map(m=>lostBy.get(m).cnt),smooth:true}
      ]
    });

    ChartManager.setOption(segKey+'_chart_newlost_val',{
      tooltip:{trigger:'axis'},
      legend:{top:10},
      grid:{left:50,right:70,top:50,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:[
        {type:'value',name:'销售额（元）'},
        {type:'value',name:'毛利_扣销售费（元）',position:'right'}
      ],
      series:[
        {name:'新增客户销售额',type:'bar',data:months.map(m=>newBy.get(m).sales)},
        {name:'流失客户销售额',type:'bar',data:months.map(m=>lostBy.get(m).sales)},
        {name:'新增毛利_扣费',type:'line',yAxisIndex:1,data:months.map(m=>newBy.get(m).gp),smooth:true},
        {name:'流失毛利_扣费',type:'line',yAxisIndex:1,data:months.map(m=>lostBy.get(m).gp),smooth:true}
      ]
    });
  }else{
    ChartManager.setEmpty(segKey+'_chart_newlost_cnt', '暂无数据');
    ChartManager.setEmpty(segKey+'_chart_newlost_val', '暂无数据');
  }

  fillLifecycleTables(segKey,newArr,lostArr,months);
}

function fillLifecycleTables(segKey,newArr,lostArr,months){
  const cls=[...new Set([...newArr,...lostArr].map(r=>r[2]).filter(v=>v))].sort();

  function fillSel(id, arr){
    const el=document.getElementById(id); if(!el) return;
    const prev=el.value||'';
    el.innerHTML='<option value="">全部</option>'+arr.map(v=>`<option value="${v}">${v}</option>`).join('');
    if(prev && arr.includes(prev)) el.value=prev;
  }
  fillSel(segKey+'_new_month', months);
  fillSel(segKey+'_lost_month', months);
  fillSel(segKey+'_new_class', cls);
  fillSel(segKey+'_lost_class', cls);

  function fillTable(type, arr){
    const tbody=document.querySelector('#'+segKey+'_'+type+'_table tbody');
    tbody.innerHTML='';
    arr.forEach(r=>{
      const tr=document.createElement('tr');
      const cells=[r[0],r[1],r[2],fmtNum(r[3]),fmtNum(r[4]),(r[5]==null?'':fmtPct(r[5])),String(r[6]),String(r[7])];
      cells.forEach((c,i)=>{
        const td=document.createElement('td');
        if(i===6){
          td.appendChild(createOrderLink(segKey,type,`${type==='new'?'新增':'流失'}｜${r[0]}｜${r[1]}`,{month:r[0],cust:r[1],cls:r[2]},c));
        }else{
          td.textContent=c;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    document.getElementById(segKey+'_'+type+'_count').innerText=String(arr.length);
    filterTable(segKey,type);
  }
  fillTable('new',newArr);
  fillTable('lost',lostArr);
}

function renderAbnormal(segKey){
  const {start,end}=getRange(segKey);
  const arr=DATA[segKey].abnormal_orders.filter(r=>monthInRange(r[0].slice(0,7),start,end));
  const clsSel=document.getElementById(segKey+'_abnormal_class');
  if(clsSel){
    const prev=clsSel.value||'';
    const cls=[...new Set(arr.map(r=>r[3]).filter(v=>v))].sort();
    clsSel.innerHTML='<option value="">全部</option>'+cls.map(c=>`<option value="${c}">${c}</option>`).join('');
    if(prev && cls.includes(prev)) clsSel.value=prev;
  }
  const reasonSel=document.getElementById(segKey+'_abnormal_reason_sel');
  if(reasonSel){
    const prev=reasonSel.value||'';
    const reasons=[...new Set(arr.flatMap(r=>String(r[8]||'').split('｜').map(x=>x.trim()).filter(Boolean)))].sort();
    reasonSel.innerHTML='<option value="">全部</option>'+reasons.map(x=>`<option value="${x}">${x}</option>`).join('');
    if(prev && reasons.includes(prev)) reasonSel.value=prev;
  }
  const tbody=document.querySelector('#'+segKey+'_abnormal_table tbody');
  tbody.innerHTML='';
  arr.forEach(r=>{
    const tr=document.createElement('tr');
    const cells=[r[0],r[1],r[2],r[3],fmtNum(r[4]),fmtNum(r[5]),(r[6]==null?'':fmtPct(r[6])),String(r[7]),r[8],String(r[9])];
    cells.forEach(c=>{const td=document.createElement('td'); td.textContent=c; tr.appendChild(td);});
    tbody.appendChild(tr);
  });
  document.getElementById(segKey+'_abnormal_count').innerText=String(arr.length);
  filterTable(segKey,'abnormal');
  renderAbnReasonChart(segKey);
}

function renderAbnReasonChart(segKey){
  const table=document.getElementById(segKey+'_abnormal_table');
  const rows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.style.display!=='none');
  const map=new Map();
  rows.forEach(tr=>{
    const txt=tr.children[8]?.innerText||'';
    txt.split('｜').map(x=>x.trim()).filter(Boolean).forEach(p=>map.set(p,(map.get(p)||0)+1));
  });
  const arr=[...map.entries()].map(([k,v])=>({k,v})).sort((a,b)=>a.v-b.v);
  if(!arr.length){
    ChartManager.setEmpty(segKey+'_chart_abn_reason', '暂无数据');
    return;
  }
  ChartManager.setOption(segKey+'_chart_abn_reason',{
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
    grid:{left:180,right:20,top:40,bottom:40},
    xAxis:{type:'value',name:'订单数'},
    yAxis:{type:'category',data:arr.map(x=>x.k),inverse:true},
    series:[{name:'订单数',type:'bar',data:arr.map(x=>x.v)}]
  });
}

function filterTable(segKey,type){
  let table=null;
  if(type==='category'){
    const q=(document.getElementById(segKey+'_category_search').value||'').toLowerCase();
    table=document.getElementById(segKey+'_category_table');
    let v=0;
    [...table.querySelectorAll('tbody tr')].forEach(tr=>{const ok=tr.innerText.toLowerCase().includes(q); tr.style.display=ok?'':'none'; if(ok) v++;});
    document.getElementById(segKey+'_category_count').innerText=String(v);
  }else if(type==='product'){
    const q=(document.getElementById(segKey+'_product_search').value||'').toLowerCase();
    const cat=(document.getElementById(segKey+'_product_cat').value||'').trim();
    const minSales=parseNumber(document.getElementById(segKey+'_product_min_sales').value);
    const minGm=parseNumber(document.getElementById(segKey+'_product_min_gm').value);
    table=document.getElementById(segKey+'_product_table');
    let v=0;
    [...table.querySelectorAll('tbody tr')].forEach(tr=>{
      let ok=tr.innerText.toLowerCase().includes(q);
      if(ok && cat) ok = (tr.children[1].innerText.trim()===cat);
      if(ok && !isNaN(minSales)) ok = parseNumber(tr.children[2].innerText)>=minSales;
      if(ok && !isNaN(minGm)) ok = parseNumber(tr.children[4].innerText)>=minGm;
      tr.style.display=ok?'':'none'; if(ok) v++;
    });
    document.getElementById(segKey+'_product_count').innerText=String(v);
  }else if(type==='customer'){
    const q=(document.getElementById(segKey+'_customer_search').value||'').toLowerCase();
    const cls=(document.getElementById(segKey+'_customer_class').value||'').trim();
    const minSales=parseNumber(document.getElementById(segKey+'_customer_min_sales').value);
    const minGm=parseNumber(document.getElementById(segKey+'_customer_min_gm').value);
    table=document.getElementById(segKey+'_customer_table');
    let v=0;
    [...table.querySelectorAll('tbody tr')].forEach(tr=>{
      let ok=tr.innerText.toLowerCase().includes(q);
      if(ok && cls) ok = (tr.children[1].innerText.trim()===cls);
      if(ok && !isNaN(minSales)) ok = parseNumber(tr.children[2].innerText)>=minSales;
      if(ok && !isNaN(minGm)) ok = parseNumber(tr.children[4].innerText)>=minGm;
      tr.style.display=ok?'':'none'; if(ok) v++;
    });
    document.getElementById(segKey+'_customer_count').innerText=String(v);
  }else if(type==='new' || type==='lost'){
    const m=(document.getElementById(segKey+'_'+type+'_month').value||'').trim();
    const cls=(document.getElementById(segKey+'_'+type+'_class').value||'').trim();
    const q=(document.getElementById(segKey+'_'+type+'_search').value||'').toLowerCase();
    table=document.getElementById(segKey+'_'+type+'_table');
    let v=0;
    [...table.querySelectorAll('tbody tr')].forEach(tr=>{
      let ok=tr.innerText.toLowerCase().includes(q);
      if(ok && m) ok = (tr.children[0].innerText.trim()===m);
      if(ok && cls) ok = (tr.children[2].innerText.trim()===cls);
      tr.style.display=ok?'':'none'; if(ok) v++;
    });
    document.getElementById(segKey+'_'+type+'_count').innerText=String(v);
  }else if(type==='abnormal'){
    const q=(document.getElementById(segKey+'_abnormal_search').value||'').toLowerCase();
    const cls=(document.getElementById(segKey+'_abnormal_class').value||'').trim();
    const minSales=parseNumber(document.getElementById(segKey+'_abnormal_min_sales').value);
    const reason=(document.getElementById(segKey+'_abnormal_reason').value||'').trim();
    const reasonSel=(document.getElementById(segKey+'_abnormal_reason_sel').value||'').trim();
    table=document.getElementById(segKey+'_abnormal_table');
    let v=0;
    [...table.querySelectorAll('tbody tr')].forEach(tr=>{
      let ok=tr.innerText.toLowerCase().includes(q);
      if(ok && cls) ok = (tr.children[3].innerText.trim()===cls);
      if(ok && !isNaN(minSales)) ok = parseNumber(tr.children[4].innerText)>=minSales;
      if(ok && reasonSel) ok = tr.children[8].innerText.includes(reasonSel);
      if(ok && reason) ok = tr.children[8].innerText.includes(reason);
      tr.style.display=ok?'':'none'; if(ok) v++;
    });
    document.getElementById(segKey+'_abnormal_count').innerText=String(v);
  }

  try{
    const tableId = getTableId(segKey,type);
    if(tableId){
      table = table || document.getElementById(tableId);
    }
    if(table){
      syncBaseDisplay(table);
      applyHeaderFiltersForTable(table);
    }
  }catch(e){}

  if(type==='abnormal'){
    renderAbnReasonChart(segKey);
  }
}

function resetTable(segKey,type){
  const ids={
    category:[segKey+'_category_search'],
    product:[segKey+'_product_search',segKey+'_product_cat',segKey+'_product_min_sales',segKey+'_product_min_gm'],
    customer:[segKey+'_customer_search',segKey+'_customer_class',segKey+'_customer_min_sales',segKey+'_customer_min_gm'],
    new:[segKey+'_new_month',segKey+'_new_class',segKey+'_new_search'],
    lost:[segKey+'_lost_month',segKey+'_lost_class',segKey+'_lost_search'],
    abnormal:[segKey+'_abnormal_search',segKey+'_abnormal_class',segKey+'_abnormal_min_sales',segKey+'_abnormal_reason',segKey+'_abnormal_reason_sel']
  }[type]||[];
  ids.forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
  filterTable(segKey,type);
}

function sortTable(segKey,type,colIdx){
  const key=segKey+'_'+type;
  const prev=sortState[key]||{col:-1,asc:true};
  const asc=(prev.col===colIdx)?!prev.asc:true;
  sortState[key]={col:colIdx,asc:asc};
  const tableId={
    category: segKey+'_category_table',
    product: segKey+'_product_table',
    customer: segKey+'_customer_table',
    new: segKey+'_new_table',
    lost: segKey+'_lost_table',
    abnormal: segKey+'_abnormal_table'
  }[type];
  const table=document.getElementById(tableId);
  const tbody=table.querySelector('tbody');
  const rows=[...tbody.querySelectorAll('tr')];
  rows.sort((a,b)=>{
    const av=a.children[colIdx]?.innerText||'';
    const bv=b.children[colIdx]?.innerText||'';
    const an=parseNumber(av), bn=parseNumber(bv);
    if(!isNaN(an) && !isNaN(bn)) return asc? (an-bn):(bn-an);
    return asc? av.localeCompare(bv): bv.localeCompare(av);
  });
  rows.forEach(r=>tbody.appendChild(r));
  filterTable(segKey,type);
}

function exportTableCSV(segKey,type){
  const tableId={
    category: segKey+'_category_table',
    product: segKey+'_product_table',
    customer: segKey+'_customer_table',
    new: segKey+'_new_table',
    lost: segKey+'_lost_table',
    abnormal: segKey+'_abnormal_table'
  }[type];
  const table=document.getElementById(tableId);
  const rows=[...table.querySelectorAll('tr')].filter(tr=>tr.style.display!=='none');
  const csv=rows.map(tr=>[...tr.children].map(td=>'"'+td.innerText.replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=segKey+'_'+type+'_export.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

bootstrap();
