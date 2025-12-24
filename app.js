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
    const rows = seg.rows || seg.raw_rows || [];
    let months = seg.months || [];
    if(!months.length && rows.length){
      const mset=new Set(rows.map(r=>String(r[0]||'').slice(0,7)).filter(Boolean));
      months=[...mset].sort();
    }
    segments[key] = {
      months,
      rows,
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
const TABLE_RANGE={};

const ROW_IDX={
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

function hasRawRows(segKey){
  return !!(DATA && DATA[segKey] && DATA[segKey].rows && DATA[segKey].rows.length);
}

function getRawRows(segKey){
  return hasRawRows(segKey) ? DATA[segKey].rows : [];
}

function fmtWan(x){const n=Number(x); if(!isFinite(n)) return ''; return (n/10000).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' 万';}
function fmtYi(x){const n=Number(x); if(!isFinite(n)) return ''; return (n/1e8).toFixed(3)+' 亿';}
function fmtNum(x){const n=Number(x); if(!isFinite(n)) return ''; return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtPct(x){const n=Number(x); if(!isFinite(n)) return ''; return n.toFixed(2)+'%';}
function parseNumber(s){if(s===null||s===undefined) return NaN; const t=String(s).replace(/,/g,'').replace(/%/g,'').trim(); const v=parseFloat(t); return isNaN(v)?NaN:v;}
function monthInRange(m,start,end){if(!start||!end) return true; return (m>=start && m<=end);}
function dateInRange(d,start,end){if(!start||!end) return true; return (d>=start && d<=end);}
function _toDateStart(s){return s? new Date(s+'T00:00:00'):null;}
function _toDateEnd(s){return s? new Date(s+'T23:59:59'):null;}
function getMonthWeight(month,startDate,endDate){
  if(!startDate || !endDate) return 1;
  const s=_toDateStart(startDate);
  const e=_toDateEnd(endDate);
  if(!s || !e) return 1;
  const ms=new Date(month+'-01T00:00:00');
  const me=new Date(month+'-01T23:59:59');
  me.setMonth(me.getMonth()+1);
  me.setDate(0);
  me.setHours(23,59,59,999);
  if(e < ms || s > me) return 0;
  const overlapStart=Math.max(s.getTime(), ms.getTime());
  const overlapEnd=Math.min(e.getTime(), me.getTime());
  if(overlapEnd < overlapStart) return 0;
  const overlapDays=Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
  const daysInMonth=me.getDate();
  return Math.max(0, Math.min(1, overlapDays / daysInMonth));
}
function getMonthWeights(startDate,endDate,months){
  const map=new Map();
  months.forEach(m=>{
    if(!map.has(m)) map.set(m, getMonthWeight(m,startDate,endDate));
  });
  return map;
}

function formatTooltipValue(name, value){
  if(value===null || value===undefined || value==='') return '';
  if(String(name).includes('率') || String(name).includes('%')) return fmtPct(value);
  return fmtNum(value);
}

function makeSegHTML(segKey){
  return `
    <div class="seg-title">
      <div>维度：${segKey==='total'?'全部':(segKey==='store'?'超群门店':'非超群门店')}（含品类 + 新增/流失）</div>
      <div class="timebox-wrap">
        <div class="timebox">
          <span class="chip">时间范围筛选</span>
          <label class="ctl">开始日：<input id="${segKey}_d_start" type="date" onchange="onSegTimeChange('${segKey}')"/></label>
          <label class="ctl">结束日：<input id="${segKey}_d_end" type="date" onchange="onSegTimeChange('${segKey}')"/></label>
          <button class="btn" onclick="resetSegTime('${segKey}')">重置时间</button>
        </div>
        <div class="time-hint">全局时间影响指标/图表等（列表除外）；按月数据按天比例估算。</div>
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
            <label class="ctl table-time">表内开始日：<input id="${segKey}_catton_d_start" type="date" onchange="onTableTimeChange('${segKey}','catton')"/></label>
            <label class="ctl table-time">表内结束日：<input id="${segKey}_catton_d_end" type="date" onchange="onTableTimeChange('${segKey}','catton')"/></label>
            <span class="table-hint">仅作用本表，不影响图表/指标</span>
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
        <div class="card"><div id="${segKey}_chart_prod_margin" class="plot"></div></div>
      </div>
      ${makeTableShell(segKey,'product')}
    </div>

    <div class="section" id="${segKey}_customer">
      <div class="grid2">
        <div class="card"><div id="${segKey}_chart_cust_top" class="plot"></div></div>
        <div class="card"><div id="${segKey}_chart_cust_margin" class="plot"></div></div>
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
        <label class="ctl table-time">表内开始日：<input id="${segKey}_category_d_start" type="date" onchange="onTableTimeChange('${segKey}','category')"/></label>
        <label class="ctl table-time">表内结束日：<input id="${segKey}_category_d_end" type="date" onchange="onTableTimeChange('${segKey}','category')"/></label>
        <span class="table-hint">仅作用本表，不影响图表/指标</span>
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
        <label class="ctl table-time">表内开始日：<input id="${segKey}_product_d_start" type="date" onchange="onTableTimeChange('${segKey}','product')"/></label>
        <label class="ctl table-time">表内结束日：<input id="${segKey}_product_d_end" type="date" onchange="onTableTimeChange('${segKey}','product')"/></label>
        <span class="table-hint">仅作用本表，不影响图表/指标</span>
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
        <label class="ctl table-time">表内开始日：<input id="${segKey}_customer_d_start" type="date" onchange="onTableTimeChange('${segKey}','customer')"/></label>
        <label class="ctl table-time">表内结束日：<input id="${segKey}_customer_d_end" type="date" onchange="onTableTimeChange('${segKey}','customer')"/></label>
        <span class="table-hint">仅作用本表，不影响图表/指标</span>
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
        <label class="ctl table-time">表内开始日：<input id="${segKey}_${type}_d_start" type="date" onchange="onTableTimeChange('${segKey}','${type}')"/></label>
        <label class="ctl table-time">表内结束日：<input id="${segKey}_${type}_d_end" type="date" onchange="onTableTimeChange('${segKey}','${type}')"/></label>
        <span class="table-hint">仅作用本表，不影响图表/指标</span>
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
        <label class="ctl table-time">表内开始日：<input id="${segKey}_abnormal_d_start" type="date" onchange="onTableTimeChange('${segKey}','abnormal')"/></label>
        <label class="ctl table-time">表内结束日：<input id="${segKey}_abnormal_d_end" type="date" onchange="onTableTimeChange('${segKey}','abnormal')"/></label>
        <span class="table-hint">仅作用本表，不影响图表/指标</span>
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
    initDateRange(segKey);
  });
  showSeg('total');
  const reloadBtn = document.getElementById('reload_btn');
  if(reloadBtn){
    reloadBtn.addEventListener('click', ()=>window.location.reload());
  }
}

function monthEndDate(month){
  if(!month) return '';
  const parts=month.split('-');
  if(parts.length<2) return '';
  const y=Number(parts[0]);
  const m=Number(parts[1]);
  if(!y || !m) return '';
  const d=new Date(y, m, 0).getDate();
  return month+'-'+String(d).padStart(2,'0');
}

function initDateRange(segKey){
  const s=document.getElementById(segKey+'_d_start');
  const e=document.getElementById(segKey+'_d_end');
  if(!s || !e) return;
  const def=getDefaultDateRange(segKey);
  if(!def.startDate || !def.endDate) return;
  s.min=def.startDate; s.max=def.endDate;
  e.min=def.startDate; e.max=def.endDate;
  s.value=def.startDate; e.value=def.endDate;
}

function getRange(segKey){
  const startDate=document.getElementById(segKey+'_d_start').value;
  const endDate=document.getElementById(segKey+'_d_end').value;
  const startMonth=startDate ? startDate.slice(0,7) : '';
  const endMonth=endDate ? endDate.slice(0,7) : '';
  return {startDate,endDate,startMonth,endMonth};
}

function getDefaultDateRange(segKey){
  if(hasRawRows(segKey)){
    const rows=getRawRows(segKey);
    if(rows.length){
      const dates=rows.map(r=>r[ROW_IDX.date]).filter(Boolean).sort();
      return {startDate:dates[0], endDate:dates[dates.length-1]};
    }
  }
  const months=DATA[segKey].months||[];
  if(!months.length) return {startDate:'',endDate:''};
  return {startDate:months[0]+'-01', endDate:monthEndDate(months[months.length-1])};
}

function getTableRange(segKey,type){
  const def=getDefaultDateRange(segKey);
  const st=(TABLE_RANGE[segKey]&&TABLE_RANGE[segKey][type])||{};
  const startDate=st.startDate||def.startDate;
  const endDate=st.endDate||def.endDate;
  return {startDate,endDate,startMonth:startDate.slice(0,7),endMonth:endDate.slice(0,7)};
}

function syncTableRangeInputs(segKey,type){
  const def=getDefaultDateRange(segKey);
  if(!def.startDate || !def.endDate) return;
  const range=getTableRange(segKey,type);
  const s=document.getElementById(segKey+'_'+type+'_d_start');
  const e=document.getElementById(segKey+'_'+type+'_d_end');
  if(!s || !e) return;
  s.min=def.startDate; s.max=def.endDate;
  e.min=def.startDate; e.max=def.endDate;
  s.value=range.startDate; e.value=range.endDate;
}

function setTableRange(segKey,type,startDate,endDate){
  if(!TABLE_RANGE[segKey]) TABLE_RANGE[segKey]={};
  TABLE_RANGE[segKey][type]={startDate,endDate};
}

function rerenderTable(segKey,type){
  if(type==='category') return renderCategory(segKey);
  if(type==='product') return renderProducts(segKey);
  if(type==='customer') return renderCustomers(segKey);
  if(type==='new' || type==='lost') return renderLifecycle(segKey);
  if(type==='abnormal') return renderAbnormal(segKey);
  if(type==='catton') return renderCatTon(segKey);
}

function onTableTimeChange(segKey,type){
  const sEl=document.getElementById(segKey+'_'+type+'_d_start');
  const eEl=document.getElementById(segKey+'_'+type+'_d_end');
  if(!sEl || !eEl) return;
  let s=sEl.value, e=eEl.value;
  if(s && e && s>e){ const t=s; s=e; e=t; sEl.value=s; eEl.value=e; }
  if(!s || !e) return;
  setTableRange(segKey,type,s,e);
  try{ rerenderTable(segKey,type); }catch(err){ console.error(err); }
}

function resetTableRange(segKey,type){
  const def=getDefaultDateRange(segKey);
  if(!def.startDate || !def.endDate) return;
  setTableRange(segKey,type,def.startDate,def.endDate);
  syncTableRangeInputs(segKey,type);
}

function resetSegTime(segKey){
  const def=getDefaultDateRange(segKey);
  if(!def.startDate || !def.endDate) return;
  document.getElementById(segKey+'_d_start').value=def.startDate;
  document.getElementById(segKey+'_d_end').value=def.endDate;
  try{ updateSeg(segKey); }catch(e){ console.error(e); }
}

function onSegTimeChange(segKey){
  const s=document.getElementById(segKey+'_d_start').value;
  const e=document.getElementById(segKey+'_d_end').value;
  if(s && e && s>e){
    document.getElementById(segKey+'_d_start').value=e;
    document.getElementById(segKey+'_d_end').value=s;
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
  const {startDate,endDate,startMonth,endMonth}=getRange(segKey);
  let sales=0,gp=0,fee=0,gpAdj=0;
  if(hasRawRows(segKey)){
    const rows=getRawRows(segKey);
    rows.forEach(r=>{
      const d=r[ROW_IDX.date];
      if(!dateInRange(d,startDate,endDate)) return;
      sales+=Number(r[ROW_IDX.sales])||0;
      gp+=Number(r[ROW_IDX.gp])||0;
      fee+=Number(r[ROW_IDX.fee])||0;
      gpAdj+=Number(r[ROW_IDX.gpAdj])||0;
    });
  }else{
    const rows=(DATA[segKey].monthly||[]).filter(r=>monthInRange(r[0],startMonth,endMonth));
    rows.forEach(r=>{
      const w=getMonthWeight(r[0],startDate,endDate);
      if(!w) return;
      sales+=r[1]*w; gp+=r[3]*w; fee+=r[4]*w; gpAdj+=r[5]*w;
    });
  }
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
  const {startDate,endDate,startMonth,endMonth}=getRange(segKey);
  const months=[];
  const cost=[],gp=[],fee=[],gpAdj=[],gm=[],gmAdj=[],active=[];
  if(hasRawRows(segKey)){
    const map=new Map();
    const activeMap=new Map();
    getRawRows(segKey).forEach(r=>{
      const d=r[ROW_IDX.date];
      if(!dateInRange(d,startDate,endDate)) return;
      if(!map.has(d)) map.set(d,{sales:0,cost:0,gp:0,fee:0,gpAdj:0});
      const o=map.get(d);
      o.sales+=Number(r[ROW_IDX.sales])||0;
      o.cost+=Number(r[ROW_IDX.cost])||0;
      o.gp+=Number(r[ROW_IDX.gp])||0;
      o.fee+=Number(r[ROW_IDX.fee])||0;
      o.gpAdj+=Number(r[ROW_IDX.gpAdj])||0;
      const cust=r[ROW_IDX.cust]||'';
      if(!activeMap.has(d)) activeMap.set(d,new Set());
      if(cust) activeMap.get(d).add(cust);
    });
    const dates=[...map.keys()].sort();
    dates.forEach(d=>{
      const o=map.get(d);
      months.push(d);
      cost.push(o.cost);
      gp.push(o.gp);
      fee.push(o.fee);
      gpAdj.push(o.gpAdj);
      gm.push(o.sales? o.gp/o.sales*100:null);
      gmAdj.push(o.sales? o.gpAdj/o.sales*100:null);
      active.push(activeMap.get(d)?activeMap.get(d).size:0);
    });
  }else{
    const rows=(DATA[segKey].monthly||[]).filter(r=>monthInRange(r[0],startMonth,endMonth));
    const weightMap=getMonthWeights(startDate,endDate,rows.map(r=>r[0]));
    rows.forEach(r=>{
      const m=r[0];
      const w=weightMap.get(m) || 0;
      if(!w) return;
      const sales=r[1]*w;
      const costW=r[2]*w;
      const gpW=r[3]*w;
      const feeW=r[4]*w;
      const gpAdjW=r[5]*w;
      months.push(m);
      cost.push(costW);
      gp.push(gpW);
      fee.push(feeW);
      gpAdj.push(gpAdjW);
      gm.push(sales? gpW/sales*100:null);
      gmAdj.push(sales? gpAdjW/sales*100:null);
      active.push((r[7]||0)*w);
    });
  }
  if(!months.length){
    ChartManager.setEmpty(segKey+'_chart_sales', '暂无数据');
    ChartManager.setEmpty(segKey+'_chart_fee', '暂无数据');
    return;
  }

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

  document.getElementById(segKey+'_insights').innerHTML = computeGrowthInsights(segKey,startDate,endDate);
  document.getElementById(segKey+'_structure').innerHTML = computeStructureHints(segKey,startDate,endDate);
}

function computeGrowthInsights(segKey,startDate,endDate){
  const monthsAll=DATA[segKey].months||[];
  const first=startDate? startDate.slice(0,7):(monthsAll[0]||'');
  const last=endDate? endDate.slice(0,7):(monthsAll[monthsAll.length-1]||'');
  function sumByRaw(keyFn){
    const map=new Map();
    getRawRows(segKey).forEach(r=>{
      const d=r[ROW_IDX.date];
      if(!dateInRange(d,startDate,endDate)) return;
      const m=String(d||'').slice(0,7);
      if(m!==first && m!==last) return;
      const k=keyFn(r);
      if(!map.has(k)) map.set(k,{first:0,last:0});
      const o=map.get(k);
      const v=Number(r[ROW_IDX.gpAdj])||0;
      if(m===first) o.first+=v;
      if(m===last) o.last+=v;
    });
    return map;
  }
  function sumByAgg(arr, keyFn, valIdx, monthIdx){
    const map=new Map();
    for(const r of arr){
      const m=r[monthIdx];
      if(m!==first && m!==last) continue;
      const k=keyFn(r);
      if(!map.has(k)) map.set(k,{first:0,last:0});
      const o=map.get(k);
      const w=getMonthWeight(m,startDate,endDate);
      if(m===first) o.first+=r[valIdx]*w;
      if(m===last) o.last+=r[valIdx]*w;
    }
    return map;
  }
  const catMap=hasRawRows(segKey)
    ? sumByRaw(r=>r[ROW_IDX.cat])
    : sumByAgg(DATA[segKey].cat_monthly, r=>r[1], 6, 0);
  const prodMap=hasRawRows(segKey)
    ? sumByRaw(r=>r[ROW_IDX.prod]+'｜'+r[ROW_IDX.cat])
    : sumByAgg(DATA[segKey].products, r=>r[0]+'｜'+r[1], 7, 2);
  const custMap=hasRawRows(segKey)
    ? sumByRaw(r=>r[ROW_IDX.cust]+'｜'+r[ROW_IDX.cls])
    : sumByAgg(DATA[segKey].customers, r=>r[0]+'｜'+r[1], 7, 2);

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

function computeStructureHints(segKey,startDate,endDate){
  const startMonth=startDate? startDate.slice(0,7):'';
  const endMonth=endDate? endDate.slice(0,7):'';
  const map=new Map();
  if(hasRawRows(segKey)){
    getRawRows(segKey).forEach(r=>{
      const d=r[ROW_IDX.date];
      if(!dateInRange(d,startDate,endDate)) return;
      const k=r[ROW_IDX.cat];
      if(!map.has(k)) map.set(k,{sales:0,gpAdj:0});
      const o=map.get(k);
      o.sales+=Number(r[ROW_IDX.sales])||0;
      o.gpAdj+=Number(r[ROW_IDX.gpAdj])||0;
    });
  }else{
    const cats=DATA[segKey].cat_monthly.filter(r=>monthInRange(r[0],startMonth,endMonth));
    for(const r of cats){
      const k=r[1];
      if(!map.has(k)) map.set(k,{sales:0,gpAdj:0});
      const o=map.get(k);
      const w=getMonthWeight(r[0],startDate,endDate);
      if(!w) continue;
      o.sales+=r[2]*w; o.gpAdj+=r[6]*w;
    }
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
  const global=getRange(segKey);
  if(hasRawRows(segKey)){
    const rows=getRawRows(segKey).filter(r=>dateInRange(r[ROW_IDX.date],global.startDate,global.endDate));
    const monthSet=new Set();
    const catSet=new Set();
    const byMonth=new Map();
    rows.forEach(r=>{
      const m=String(r[ROW_IDX.date]||'').slice(0,7);
      const c=r[ROW_IDX.cat];
      if(!m || !c) return;
      monthSet.add(m); catSet.add(c);
      if(!byMonth.has(m)) byMonth.set(m,new Map());
      const cm=byMonth.get(m);
      if(!cm.has(c)) cm.set(c,{sales:0,gpAdj:0});
      const o=cm.get(c);
      o.sales+=Number(r[ROW_IDX.sales])||0;
      o.gpAdj+=Number(r[ROW_IDX.gpAdj])||0;
    });
    const months=[...monthSet].sort();
    const cats=[...catSet].sort();
    if(!months.length){
      ChartManager.setEmpty(segKey+'_chart_cat_sales', '暂无数据');
      ChartManager.setEmpty(segKey+'_chart_cat_gp', '暂无数据');
      ChartManager.setEmpty(segKey+'_chart_cat_rank', '暂无数据');
    }else{
      const by={};
      cats.forEach(c=>by[c]={sales:[],gpAdj:[]});
      months.forEach(m=>{
        const cm=byMonth.get(m)||new Map();
        cats.forEach(c=>{
          const v=cm.get(c);
          by[c].sales.push(v?v.sales:0);
          by[c].gpAdj.push(v?v.gpAdj:0);
        });
      });

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

    syncTableRangeInputs(segKey,'category');
    const tableRange=getTableRange(segKey,'category');
    const tableRows=getRawRows(segKey).filter(r=>dateInRange(r[ROW_IDX.date],tableRange.startDate,tableRange.endDate));
    const tbody=document.querySelector('#'+segKey+'_category_table tbody');
    if(tbody){
      tbody.innerHTML='';
      const map2=new Map();
      const orders=new Map();
      for(const r of tableRows){
        const k=r[ROW_IDX.cat];
        if(!k) continue;
        if(!map2.has(k)) map2.set(k,{sales:0,cost:0,gp:0,fee:0,gpAdj:0,qty:0});
        const o=map2.get(k);
        o.sales+=Number(r[ROW_IDX.sales])||0;
        o.cost+=Number(r[ROW_IDX.cost])||0;
        o.gp+=Number(r[ROW_IDX.gp])||0;
        o.fee+=Number(r[ROW_IDX.fee])||0;
        o.gpAdj+=Number(r[ROW_IDX.gpAdj])||0;
        o.qty+=Number(r[ROW_IDX.qty])||0;
        if(!orders.has(k)) orders.set(k,new Set());
        const ord=r[ROW_IDX.order];
        if(ord) orders.get(k).add(ord);
      }
      const list=[...map2.entries()].map(([k,v])=>({
        k,
        ...v,
        orders:(orders.get(k)?orders.get(k).size:0),
        gm:v.sales? v.gp/v.sales*100:null,
        gm2:v.sales? v.gpAdj/v.sales*100:null
      }));
      list.sort((a,b)=>b.gpAdj-a.gpAdj);
      for(const o of list){
        const tr=document.createElement('tr');
        const cells=[o.k,fmtNum(o.sales),fmtNum(o.gp),fmtPct(o.gm),fmtNum(o.fee),fmtNum(o.gpAdj),fmtPct(o.gm2),fmtNum(o.qty),fmtNum(o.orders)];
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
    return;
  }

  const rows=DATA[segKey].cat_monthly.filter(r=>monthInRange(r[0],global.startMonth,global.endMonth));
  const monthsAll=[...new Set(rows.map(r=>r[0]))].sort();
  const weightMap=getMonthWeights(global.startDate,global.endDate,monthsAll);
  const months=monthsAll.filter(m=>(weightMap.get(m)||0)>0);
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
      const w=weightMap.get(r[0])||0;
      if(!w) continue;
      const idx=mi.get(r[0]);
      if(idx===undefined) continue;
      by[r[1]].sales[idx]+=r[2]*w;
      by[r[1]].gpAdj[idx]+=r[6]*w;
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

  syncTableRangeInputs(segKey,'category');
  const tableRange=getTableRange(segKey,'category');
  const tableRows=DATA[segKey].cat_monthly.filter(r=>monthInRange(r[0],tableRange.startMonth,tableRange.endMonth));
  const tableWeight=getMonthWeights(tableRange.startDate,tableRange.endDate,[...new Set(tableRows.map(r=>r[0]))]);

  const tbody=document.querySelector('#'+segKey+'_category_table tbody');
  if(tbody){
    tbody.innerHTML='';
    const map2=new Map();
    for(const r of tableRows){
      const w=tableWeight.get(r[0])||0;
      if(!w) continue;
      const k=r[1];
      if(!map2.has(k)) map2.set(k,{sales:0,cost:0,gp:0,fee:0,gpAdj:0,qty:0,orders:0});
      const o=map2.get(k);
      o.sales+=r[2]*w; o.cost+=r[3]*w; o.gp+=r[4]*w; o.fee+=r[5]*w; o.gpAdj+=r[6]*w; o.qty+=r[7]*w; o.orders+=r[8]*w;
    }
    const list=[...map2.entries()].map(([k,v])=>({k,...v,gm:v.sales? v.gp/v.sales*100:null,gm2:v.sales? v.gpAdj/v.sales*100:null}));
    list.sort((a,b)=>b.gpAdj-a.gpAdj);
    for(const o of list){
      const tr=document.createElement('tr');
      const cells=[o.k,fmtNum(o.sales),fmtNum(o.gp),fmtPct(o.gm),fmtNum(o.fee),fmtNum(o.gpAdj),fmtPct(o.gm2),fmtNum(o.qty),fmtNum(o.orders)];
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
  return _toDateStart(s);
}

const CATTON_STATE = {};

function renderMarginDistribution(chartId, rows, title){
  const buckets=['≤0%','0-5%','5-10%','10-20%','20-30%','>30%'];
  const counts=new Array(buckets.length).fill(0);
  const sales=new Array(buckets.length).fill(0);
  rows.forEach(o=>{
    if(o.gm2===null || o.gm2===undefined || !isFinite(o.gm2)) return;
    const v=o.gm2;
    let idx=0;
    if(v<=0) idx=0;
    else if(v<=5) idx=1;
    else if(v<=10) idx=2;
    else if(v<=20) idx=3;
    else if(v<=30) idx=4;
    else idx=5;
    counts[idx]+=1;
    sales[idx]+=o.sales||0;
  });
  const totalSales=sales.reduce((a,b)=>a+b,0);
  const totalCount=counts.reduce((a,b)=>a+b,0);
  if(!totalCount){
    ChartManager.setEmpty(chartId, '暂无数据');
    return;
  }
  const shares=sales.map(v=>totalSales? +(v/totalSales*100).toFixed(2):0);
  ChartManager.setOption(chartId,{
    title:{text:title,left:16,top:10,textStyle:{fontSize:12,fontWeight:800,color:'#1b1a17'}},
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
    grid:{left:50,right:60,top:50,bottom:40},
    xAxis:{type:'category',data:buckets},
    yAxis:[
      {type:'value',name:'数量'},
      {type:'value',name:'销售占比',position:'right',axisLabel:{formatter:'{value}%'}}
    ],
    series:[
      {name:'数量',type:'bar',data:counts,barMaxWidth:36,itemStyle:{color:'#148a78'}},
      {name:'销售占比',type:'line',yAxisIndex:1,data:shares,smooth:true,itemStyle:{color:'#f05a3e'}}
    ]
  });
}

function renderCatTon(segKey){
  const grainEl=document.getElementById(segKey+'_catton_grain');
  if(!grainEl) return;
  const grain=grainEl.value||'month';
  const global=getRange(segKey);
  syncTableRangeInputs(segKey,'catton');
  const tableRange=getTableRange(segKey,'catton');
  const noteEl=document.getElementById(segKey+'_catton_note');
  if(noteEl){
    noteEl.innerText = `口径：数量按规格折吨（油按 ${CAT_TON_META.oil_density}kg/L；袋装无规格默认${CAT_TON_META.fallback_bag_kg}kg；仍有 ${CAT_TON_META.missing_weight_lines} 行无法解析未计入吨数）`;
  }

  const cats=['大米','食用油','面粉','杂粮'];
  function getPeriodWeight(rangeStart,rangeEnd,periodStart,periodEnd){
    if(!rangeStart || !rangeEnd) return 1;
    const s=_toDateStart(rangeStart);
    const e=_toDateEnd(rangeEnd);
    const ps=_toDateStart(periodStart);
    const pe=_toDateEnd(periodEnd);
    if(!s || !e || !ps || !pe) return 1;
    if(e < ps || s > pe) return 0;
    const overlapStart=Math.max(s.getTime(), ps.getTime());
    const overlapEnd=Math.min(e.getTime(), pe.getTime());
    if(overlapEnd < overlapStart) return 0;
    const overlapDays=Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
    const totalDays=Math.floor((pe.getTime() - ps.getTime()) / 86400000) + 1;
    return Math.max(0, Math.min(1, overlapDays / totalDays));
  }

  function buildNorm(range){
    let rowsRaw=[];
    if(grain==='week'){
      rowsRaw=(CAT_TON[segKey]&&CAT_TON[segKey].weekly)?CAT_TON[segKey].weekly:[];
      const startDateObj=range.startDate ? _toDate(range.startDate) : _monthStartDate(range.startMonth);
      const endDateObj=range.endDate ? _toDateEnd(range.endDate) : _monthEndDate(range.endMonth);
      rowsRaw=rowsRaw.filter(r=>{
        const ws=_toDate(r[0]);
        const we=_toDate(r[1]);
        return we>=startDateObj && ws<=endDateObj;
      }).map(r=>{
        const w=getPeriodWeight(range.startDate,range.endDate,r[0],r[1]);
        if(!w) return null;
        return {periodKey:r[0], period:r[2], cat:r[3], tons:r[4]*w, profit:r[5]*w, ppt:r[6], orders:r[7]*w, _t:r[0]};
      }).filter(Boolean);
    }else{
      rowsRaw=(CAT_TON[segKey]&&CAT_TON[segKey].monthly)?CAT_TON[segKey].monthly:[];
      rowsRaw=rowsRaw.filter(r=>monthInRange(r[0],range.startMonth,range.endMonth));
      const weightMap=getMonthWeights(range.startDate,range.endDate,[...new Set(rowsRaw.map(r=>r[0]))]);
      rowsRaw=rowsRaw.map(r=>{
        const w=weightMap.get(r[0])||0;
        if(!w) return null;
        return {periodKey:r[0], period:r[0], cat:r[1], tons:r[2]*w, profit:r[3]*w, ppt:r[4], orders:r[5]*w, _t:r[0]+'-01'};
      }).filter(Boolean);
    }
    return rowsRaw.filter(o=>cats.includes(o.cat));
  }

  const normChart=buildNorm(global);
  const normTable=buildNorm(tableRange);

  const periods=[...new Set(normChart.map(o=>o.period))];
  periods.sort((a,b)=>{
    const oa=normChart.find(x=>x.period===a);
    const ob=normChart.find(x=>x.period===b);
    return String(oa?oa._t:'').localeCompare(String(ob?ob._t:''));
  });

  if(!periods.length){
    ChartManager.setEmpty(segKey+'_chart_cat_ton', '暂无数据');
    ChartManager.setEmpty(segKey+'_chart_cat_ppt', '暂无数据');
  }else{
    const by={}; cats.forEach(c=>by[c]={tons:[],ppt:[]});
    for(const p of periods){
      for(const c of cats){
        const hit=normChart.find(o=>o.period===p && o.cat===c);
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
  CATTON_STATE[segKey].rows=normTable;
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
      fmtNum(o.orders)
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
  resetTableRange(segKey,'catton');
  try{ renderCatTon(segKey); }catch(e){ console.error(e); }
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

function buildProductRows(segKey, range){
  if(hasRawRows(segKey)){
    const map=new Map();
    const orderMap=new Map();
    getRawRows(segKey).forEach(r=>{
      const d=r[ROW_IDX.date];
      if(!dateInRange(d,range.startDate,range.endDate)) return;
      const prod=r[ROW_IDX.prod];
      const cat=r[ROW_IDX.cat];
      const key=prod+'||'+cat;
      if(!map.has(key)) map.set(key,{prod,cat,sales:0,cost:0,gp:0,fee:0,gpAdj:0,qty:0,orders:0,lines:0});
      const o=map.get(key);
      o.sales+=Number(r[ROW_IDX.sales])||0;
      o.cost+=Number(r[ROW_IDX.cost])||0;
      o.gp+=Number(r[ROW_IDX.gp])||0;
      o.fee+=Number(r[ROW_IDX.fee])||0;
      o.gpAdj+=Number(r[ROW_IDX.gpAdj])||0;
      o.qty+=Number(r[ROW_IDX.qty])||0;
      o.lines+=1;
      if(!orderMap.has(key)) orderMap.set(key,new Set());
      const ord=r[ROW_IDX.order];
      if(ord) orderMap.get(key).add(ord);
    });
    const rows=[...map.entries()].map(([key,o])=>{
      o.orders=orderMap.get(key)?orderMap.get(key).size:0;
      o.gm=o.sales? o.gp/o.sales*100:null;
      o.gm2=o.sales? o.gpAdj/o.sales*100:null;
      return o;
    });
    rows.sort((a,b)=>b.gpAdj-a.gpAdj);
    return rows;
  }
  const arr=DATA[segKey].products.filter(r=>monthInRange(r[2],range.startMonth,range.endMonth));
  const weightMap=getMonthWeights(range.startDate,range.endDate,[...new Set(arr.map(r=>r[2]))]);
  const map=new Map();
  for(const r of arr){
    const w=weightMap.get(r[2])||0;
    if(!w) continue;
    const key=r[0]+'||'+r[1];
    if(!map.has(key)) map.set(key,{prod:r[0],cat:r[1],sales:0,cost:0,gp:0,fee:0,gpAdj:0,qty:0,orders:0,lines:0});
    const o=map.get(key);
    o.sales+=r[3]*w; o.cost+=r[4]*w; o.gp+=r[5]*w; o.fee+=r[6]*w; o.gpAdj+=r[7]*w; o.qty+=r[8]*w; o.orders+=r[9]*w; o.lines+=r[10]*w;
  }
  const rows=[...map.values()];
  rows.forEach(o=>{o.gm=o.sales? o.gp/o.sales*100:null; o.gm2=o.sales? o.gpAdj/o.sales*100:null;});
  rows.sort((a,b)=>b.gpAdj-a.gpAdj);
  return rows;
}

function buildCustomerRows(segKey, range){
  if(hasRawRows(segKey)){
    const map=new Map();
    const orderMap=new Map();
    getRawRows(segKey).forEach(r=>{
      const d=r[ROW_IDX.date];
      if(!dateInRange(d,range.startDate,range.endDate)) return;
      const cust=r[ROW_IDX.cust];
      const cls=r[ROW_IDX.cls];
      const key=cust+'||'+cls;
      if(!map.has(key)) map.set(key,{cust,cls,sales:0,gp:0,fee:0,gpAdj:0,orders:0,lines:0});
      const o=map.get(key);
      o.sales+=Number(r[ROW_IDX.sales])||0;
      o.gp+=Number(r[ROW_IDX.gp])||0;
      o.fee+=Number(r[ROW_IDX.fee])||0;
      o.gpAdj+=Number(r[ROW_IDX.gpAdj])||0;
      o.lines+=1;
      if(!orderMap.has(key)) orderMap.set(key,new Set());
      const ord=r[ROW_IDX.order];
      if(ord) orderMap.get(key).add(ord);
    });
    const rows=[...map.entries()].map(([key,o])=>{
      o.orders=orderMap.get(key)?orderMap.get(key).size:0;
      o.gm=o.sales? o.gp/o.sales*100:null;
      o.gm2=o.sales? o.gpAdj/o.sales*100:null;
      return o;
    });
    rows.sort((a,b)=>b.gpAdj-a.gpAdj);
    return rows;
  }
  const arr=DATA[segKey].customers.filter(r=>monthInRange(r[2],range.startMonth,range.endMonth));
  const weightMap=getMonthWeights(range.startDate,range.endDate,[...new Set(arr.map(r=>r[2]))]);
  const map=new Map();
  for(const r of arr){
    const w=weightMap.get(r[2])||0;
    if(!w) continue;
    const key=r[0]+'||'+r[1];
    if(!map.has(key)) map.set(key,{cust:r[0],cls:r[1],sales:0,gp:0,fee:0,gpAdj:0,orders:0,lines:0});
    const o=map.get(key);
    o.sales+=r[3]*w; o.gp+=r[5]*w; o.fee+=r[6]*w; o.gpAdj+=r[7]*w; o.orders+=r[9]*w; o.lines+=r[10]*w;
  }
  const rows=[...map.values()];
  rows.forEach(o=>{o.gm=o.sales? o.gp/o.sales*100:null; o.gm2=o.sales? o.gpAdj/o.sales*100:null;});
  rows.sort((a,b)=>b.gpAdj-a.gpAdj);
  return rows;
}

function renderProducts(segKey){
  const global=getRange(segKey);
  const rows=buildProductRows(segKey, global);
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
  renderMarginDistribution(segKey+'_chart_prod_margin', rows, '毛利率分布（扣费）');

  syncTableRangeInputs(segKey,'product');
  const tableRange=getTableRange(segKey,'product');
  const tableRows=buildProductRows(segKey, tableRange);

  const catSel=document.getElementById(segKey+'_product_cat');
  if(catSel){
    const prev=catSel.value||'';
    const cats=[...new Set(tableRows.map(o=>o.cat))].sort();
    catSel.innerHTML='<option value="">全部</option>'+cats.map(c=>`<option value="${c}">${c}</option>`).join('');
    if(prev && cats.includes(prev)) catSel.value=prev;
  }

  const tbody=document.querySelector('#'+segKey+'_product_table tbody');
  tbody.innerHTML='';
  for(const o of tableRows){
    const tr=document.createElement('tr');
    const cells=[o.prod,o.cat,fmtNum(o.sales),fmtNum(o.gp),fmtPct(o.gm),fmtNum(o.fee),fmtNum(o.gpAdj),fmtPct(o.gm2),fmtNum(o.qty),fmtNum(o.orders),fmtNum(o.lines)];
    cells.forEach((c,i)=>{const td=document.createElement('td');
      if(i===9){td.appendChild(createOrderLink(segKey,'product',`产品｜${o.prod}｜${o.cat}`,{prod:o.prod,cat:o.cat},c));}
      else{td.textContent=c;}
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  document.getElementById(segKey+'_product_count').innerText=String(tableRows.length);
  filterTable(segKey,'product');
}

function renderCustomers(segKey){
  const global=getRange(segKey);
  const rows=buildCustomerRows(segKey, global);
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
  renderMarginDistribution(segKey+'_chart_cust_margin', rows, '毛利率分布（扣费）');

  syncTableRangeInputs(segKey,'customer');
  const tableRange=getTableRange(segKey,'customer');
  const tableRows=buildCustomerRows(segKey, tableRange);

  const clsSel=document.getElementById(segKey+'_customer_class');
  if(clsSel){
    const prev=clsSel.value||'';
    const cls=[...new Set(tableRows.map(o=>o.cls).filter(v=>v))].sort();
    clsSel.innerHTML='<option value="">全部</option>'+cls.map(c=>`<option value="${c}">${c}</option>`).join('');
    if(prev && cls.includes(prev)) clsSel.value=prev;
  }

  const tbody=document.querySelector('#'+segKey+'_customer_table tbody');
  tbody.innerHTML='';
  for(const o of tableRows){
    const tr=document.createElement('tr');
    const cells=[o.cust,o.cls,fmtNum(o.sales),fmtNum(o.gp),fmtPct(o.gm),fmtNum(o.fee),fmtNum(o.gpAdj),fmtPct(o.gm2),fmtNum(o.orders),fmtNum(o.lines)];
    cells.forEach((c,i)=>{const td=document.createElement('td');
      if(i===8){td.appendChild(createOrderLink(segKey,'customer',`客户｜${o.cust}｜${o.cls}`,{cust:o.cust,cls:o.cls},c));}
      else{td.textContent=c;}
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  document.getElementById(segKey+'_customer_count').innerText=String(tableRows.length);
  filterTable(segKey,'customer');
}

function buildLifecycleData(segKey, range){
  if(hasRawRows(segKey)){
    const rows=getRawRows(segKey).filter(r=>dateInRange(r[ROW_IDX.date],range.startDate,range.endDate));
    const monthSet=new Set(rows.map(r=>String(r[ROW_IDX.date]||'').slice(0,7)).filter(Boolean));
    const months=[...monthSet].sort();
    const byMonth=new Map(months.map(m=>[m,new Map()]));
    const orderMap=new Map();
    rows.forEach(r=>{
      const m=String(r[ROW_IDX.date]||'').slice(0,7);
      if(!byMonth.has(m)) return;
      const key=(r[ROW_IDX.cust]||'')+'||'+(r[ROW_IDX.cls]||'');
      const cur=byMonth.get(m);
      if(!cur.has(key)) cur.set(key,{cust:r[ROW_IDX.cust],cls:r[ROW_IDX.cls],sales:0,gpAdj:0,orders:0,lines:0});
      const o=cur.get(key);
      o.sales+=Number(r[ROW_IDX.sales])||0;
      o.gpAdj+=Number(r[ROW_IDX.gpAdj])||0;
      o.lines+=1;
      const ord=r[ROW_IDX.order];
      const okey=m+'||'+key;
      if(!orderMap.has(okey)) orderMap.set(okey,new Set());
      if(ord) orderMap.get(okey).add(ord);
    });

    const newArr=[], lostArr=[];
    for(let i=0;i<months.length;i++){
      const m=months[i];
      const cur=byMonth.get(m)||new Map();
      const prev=(i>0)? (byMonth.get(months[i-1])||new Map()) : new Map();
      const next=(i<months.length-1)? (byMonth.get(months[i+1])||new Map()) : new Map();
      for(const [key,r] of cur.entries()){
        const sales=r.sales||0;
        const gpAdj=r.gpAdj||0;
        const gm2=sales? (gpAdj/sales*100):null;
        const ordSet=orderMap.get(m+'||'+key);
        const row=[m,r.cust,r.cls,sales,gpAdj,gm2,ordSet?ordSet.size:0,r.lines||0];
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

    return {months,newArr,lostArr,newBy,lostBy};
  }

  const months=(DATA[segKey].months||[]).filter(m=>monthInRange(m,range.startMonth,range.endMonth));
  const weightMap=getMonthWeights(range.startDate,range.endDate,months);
  const cuRows=DATA[segKey].customers.filter(r=>monthInRange(r[2],range.startMonth,range.endMonth));
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
    const w=weightMap.get(m)||0;
    const cur=byMonth.get(m)||new Map();
    const prev=(i>0)? (byMonth.get(months[i-1])||new Map()) : new Map();
    const next=(i<months.length-1)? (byMonth.get(months[i+1])||new Map()) : new Map();

    for(const [key,r] of cur.entries()){
      const sales=(r[3]||0)*w;
      const gpAdj=(r[7]||0)*w;
      const gm2=sales? (gpAdj/sales*100):null;
      const row=[m,r[0],r[1],sales,gpAdj,gm2,(r[9]||0)*w,(r[10]||0)*w];
      if(!prev.has(key)) newArr.push(row);
      if(!next.has(key)) lostArr.push(row);
    }
  }
  newArr.sort((a,b)=>a[0].localeCompare(b[0]) || (b[3]-a[3]));
  lostArr.sort((a,b)=>a[0].localeCompare(b[0]) || (b[3]-a[3]));

  const initMap=()=>new Map(months.map(m=>[m,{cnt:0,sales:0,gp:0}]));
  const newBy=initMap(), lostBy=initMap();
  newArr.forEach(r=>{const o=newBy.get(r[0]); if(o){o.cnt+=weightMap.get(r[0])||0;o.sales+=r[3];o.gp+=r[4];}});
  lostArr.forEach(r=>{const o=lostBy.get(r[0]); if(o){o.cnt+=weightMap.get(r[0])||0;o.sales+=r[3];o.gp+=r[4];}});

  return {months,newArr,lostArr,newBy,lostBy};
}

function renderLifecycle(segKey){
  const global=getRange(segKey);
  const globalData=buildLifecycleData(segKey, global);
  const months=globalData.months;
  if(months.length){
    ChartManager.setOption(segKey+'_chart_newlost_cnt',{
      tooltip:{trigger:'axis'},
      legend:{top:10},
      grid:{left:50,right:20,top:50,bottom:40},
      xAxis:{type:'category',data:months},
      yAxis:{type:'value',name:'客户数'},
      series:[
        {name:'新增客户数',type:'line',data:months.map(m=>globalData.newBy.get(m).cnt),smooth:true},
        {name:'流失客户数',type:'line',data:months.map(m=>globalData.lostBy.get(m).cnt),smooth:true}
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
        {name:'新增客户销售额',type:'bar',data:months.map(m=>globalData.newBy.get(m).sales)},
        {name:'流失客户销售额',type:'bar',data:months.map(m=>globalData.lostBy.get(m).sales)},
        {name:'新增毛利_扣费',type:'line',yAxisIndex:1,data:months.map(m=>globalData.newBy.get(m).gp),smooth:true},
        {name:'流失毛利_扣费',type:'line',yAxisIndex:1,data:months.map(m=>globalData.lostBy.get(m).gp),smooth:true}
      ]
    });
  }else{
    ChartManager.setEmpty(segKey+'_chart_newlost_cnt', '暂无数据');
    ChartManager.setEmpty(segKey+'_chart_newlost_val', '暂无数据');
  }

  syncTableRangeInputs(segKey,'new');
  syncTableRangeInputs(segKey,'lost');
  const newData=buildLifecycleData(segKey, getTableRange(segKey,'new'));
  const lostData=buildLifecycleData(segKey, getTableRange(segKey,'lost'));
  fillLifecycleTables(segKey,newData,lostData);
}

function fillLifecycleTables(segKey,newData,lostData){
  const cls=[...new Set([...newData.newArr,...lostData.lostArr].map(r=>r[2]).filter(v=>v))].sort();

  function fillSel(id, arr){
    const el=document.getElementById(id); if(!el) return;
    const prev=el.value||'';
    el.innerHTML='<option value="">全部</option>'+arr.map(v=>`<option value="${v}">${v}</option>`).join('');
    if(prev && arr.includes(prev)) el.value=prev;
  }
  fillSel(segKey+'_new_month', newData.months);
  fillSel(segKey+'_lost_month', lostData.months);
  fillSel(segKey+'_new_class', cls);
  fillSel(segKey+'_lost_class', cls);

  function fillTable(type, arr){
    const tbody=document.querySelector('#'+segKey+'_'+type+'_table tbody');
    tbody.innerHTML='';
    arr.forEach(r=>{
      const tr=document.createElement('tr');
      const cells=[r[0],r[1],r[2],fmtNum(r[3]),fmtNum(r[4]),(r[5]==null?'':fmtPct(r[5])),fmtNum(r[6]),fmtNum(r[7])];
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
  fillTable('new',newData.newArr);
  fillTable('lost',lostData.lostArr);
}

function renderAbnormal(segKey){
  ensureAbnormalOrders(segKey);
  const global=getRange(segKey);
  const arrGlobal=DATA[segKey].abnormal_orders.filter(r=>{
    const d=r[0];
    if(global.startDate && global.endDate) return dateInRange(d,global.startDate,global.endDate);
    return monthInRange(d.slice(0,7),global.startMonth,global.endMonth);
  });
  syncTableRangeInputs(segKey,'abnormal');
  const tableRange=getTableRange(segKey,'abnormal');
  const arr=DATA[segKey].abnormal_orders.filter(r=>{
    const d=r[0];
    if(tableRange.startDate && tableRange.endDate) return dateInRange(d,tableRange.startDate,tableRange.endDate);
    return monthInRange(d.slice(0,7),tableRange.startMonth,tableRange.endMonth);
  });
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
  renderAbnReasonChart(segKey, arrGlobal);
}

function renderAbnReasonChart(segKey, rows){
  const map=new Map();
  (rows||[]).forEach(r=>{
    const txt=String(r[8]||'');
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

function ensureAbnormalOrders(segKey){
  if((DATA[segKey].abnormal_orders||[]).length || !hasRawRows(segKey)) return;
  const orders=new Map();
  const priceMap=new Map();
  getRawRows(segKey).forEach(r=>{
    const date=r[ROW_IDX.date];
    const orderNo=r[ROW_IDX.order];
    if(!date || !orderNo) return;
    const key=date+'||'+orderNo;
    if(!orders.has(key)){
      orders.set(key,{
        date,
        orderNo,
        cust:r[ROW_IDX.cust]||'',
        cls:r[ROW_IDX.cls]||'',
        sales:0,
        gpAdj:0,
        lines:0,
        qtyBad:false,
        costBad:false,
        priceDiff:false
      });
    }
    const o=orders.get(key);
    o.sales+=Number(r[ROW_IDX.sales])||0;
    o.gpAdj+=Number(r[ROW_IDX.gpAdj])||0;
    o.lines+=1;
    const qty=Number(r[ROW_IDX.qty]);
    const cost=Number(r[ROW_IDX.cost]);
    if(!isFinite(qty) || qty<=0) o.qtyBad=true;
    if(!isFinite(cost) || cost<=0) o.costBad=true;

    const pkey=date+'||'+(r[ROW_IDX.cust]||'')+'||'+(r[ROW_IDX.prod]||'');
    if(!priceMap.has(pkey)) priceMap.set(pkey,{prices:new Set(), orders:new Set()});
    const pm=priceMap.get(pkey);
    const price=Number(r[ROW_IDX.unitPrice]);
    if(isFinite(price) && price>0) pm.prices.add(price);
    pm.orders.add(key);
  });

  priceMap.forEach(pm=>{
    if(pm.prices.size>1){
      pm.orders.forEach(key=>{
        const o=orders.get(key);
        if(o) o.priceDiff=true;
      });
    }
  });

  const res=[];
  orders.forEach(o=>{
    const reasons=[];
    const gm2=o.sales? (o.gpAdj/o.sales*100):null;
    if(o.gpAdj<0) reasons.push('倒挂/亏损');
    if(gm2!==null && gm2<0.2) reasons.push('低毛利(<0.2%)');
    if(o.qtyBad) reasons.push('数量异常');
    if(o.costBad) reasons.push('成本异常');
    if(o.priceDiff) reasons.push('同日同客同品不同价');
    if(!reasons.length) return;
    res.push([o.date,o.orderNo,o.cust,o.cls,o.sales,o.gpAdj,gm2,o.lines,reasons.join('｜'),Math.abs(o.gpAdj||0)]);
  });
  DATA[segKey].abnormal_orders=res;
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
    return;
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
  resetTableRange(segKey,type);
  try{ rerenderTable(segKey,type); }catch(e){ console.error(e); }
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
