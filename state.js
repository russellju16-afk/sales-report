(function(){
  const STORAGE_KEY = 'sales-report-state-v1';
  const StateManager = {
    state: null,
    _lastSerialized: ''
  };

  function safeJsonParse(raw){
    if(!raw) return null;
    try{ return JSON.parse(raw); }catch(e){ return null; }
  }

  function isObject(val){
    return !!val && typeof val === 'object';
  }

  function readStateFromUrl(){
    try{
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('state');
      if(!raw) return null;
      return safeJsonParse(raw);
    }catch(e){
      return null;
    }
  }

  function readStateFromStorage(){
    try{
      const raw = window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : '';
      return safeJsonParse(raw);
    }catch(e){
      return null;
    }
  }

  function writeStateToUrl(state){
    if(!window.history || !window.history.replaceState) return;
    const params = new URLSearchParams(window.location.search);
    if(state){
      params.set('state', JSON.stringify(state));
    }else{
      params.delete('state');
    }
    const qs = params.toString();
    const next = window.location.pathname + (qs ? ('?'+qs) : '') + window.location.hash;
    window.history.replaceState(null, '', next);
  }

  function writeStateToStorage(state){
    try{
      if(!window.localStorage) return;
      if(state){
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }else{
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }catch(e){}
  }

  function setControlValue(el, value){
    if(!el) return;
    if(el.type === 'checkbox'){
      el.checked = !!value;
      return;
    }
    if(value === undefined || value === null) return;
    el.value = String(value);
    if(el.type === 'date'){
      const min = el.min || '';
      const max = el.max || '';
      if(min && el.value < min) el.value = min;
      if(max && el.value > max) el.value = max;
    }
  }

  function collectControls(){
    const out = {};
    const nodes = document.querySelectorAll(
      '.controls input[id], .controls select[id], .controls textarea[id], .timebox input[id], .timebox select[id]'
    );
    nodes.forEach(el=>{
      if(!el.id) return;
      if(el.closest('#order_modal')) return;
      if(el.type === 'checkbox'){
        if(el.checked) out[el.id] = true;
        return;
      }
      if(el.type === 'date'){
        if(el.value) out[el.id] = el.value;
        return;
      }
      const v = (el.value == null ? '' : String(el.value));
      if(v !== '') out[el.id] = v;
    });
    return out;
  }

  function collectHeaderFilters(){
    const out = {};
    const seen = new Set();
    document.querySelectorAll('table').forEach(table=>{
      if(!table.id) return;
      const fr = table.tHead && table.tHead.querySelector('tr.filter-row');
      if(!fr) return;
      seen.add(table.id);
      const vals = [...fr.querySelectorAll('input,select')].map(el=>el.value || '');
      const any = vals.some(v=>String(v).trim() !== '');
      if(any) out[table.id] = vals;
    });
    const prev = StateManager.state && StateManager.state.headerFilters;
    if(prev){
      Object.keys(prev).forEach(id=>{
        if(!seen.has(id)) out[id] = prev[id];
      });
    }
    return out;
  }

  function buildStateSnapshot(){
    const state = {
      seg: window.currentSeg || 'total',
      tabs: window.tabState ? Object.assign({}, window.tabState) : {},
      controls: collectControls(),
      headerFilters: collectHeaderFilters()
    };
    return state;
  }

  function debounce(fn, wait){
    let t = null;
    return function(){
      const ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(()=>fn.apply(ctx, args), wait);
    };
  }

  StateManager.readStateFromUrl = readStateFromUrl;
  StateManager.readStateFromStorage = readStateFromStorage;
  StateManager.readState = function(){
    const fromUrl = readStateFromUrl();
    if(isObject(fromUrl)){
      this.state = fromUrl;
      return fromUrl;
    }
    const fromStorage = readStateFromStorage();
    if(isObject(fromStorage)){
      this.state = fromStorage;
      return fromStorage;
    }
    return null;
  };
  StateManager.setState = function(state){
    this.state = state || null;
  };
  StateManager.getHeaderFilters = function(tableId){
    const s = this.state || {};
    return (s.headerFilters && s.headerFilters[tableId]) ? s.headerFilters[tableId] : null;
  };
  StateManager.applyStateToUI = function(state, opts){
    const cur = state || this.state;
    if(!isObject(cur)) return;
    const phase = (opts && opts.phase) || 'pre';

    if(cur.seg && typeof cur.seg === 'string'){
      window.currentSeg = cur.seg;
    }
    if(isObject(cur.tabs) && window.tabState){
      Object.keys(cur.tabs).forEach(k=>{ window.tabState[k] = cur.tabs[k]; });
    }
    if(isObject(cur.controls)){
      Object.keys(cur.controls).forEach(id=>{
        const el = document.getElementById(id);
        if(el) setControlValue(el, cur.controls[id]);
      });
    }

    if(phase === 'pre' && isObject(cur.controls) && typeof window.setTableRange === 'function'){
      const ranges = {};
      Object.keys(cur.controls).forEach(id=>{
        const m = id.match(/^(total|store|nonstore)_(category|product|customer|new|lost|abnormal|catton)_d_(start|end)$/);
        if(!m) return;
        const seg = m[1];
        const type = m[2];
        const edge = m[3];
        if(!ranges[seg]) ranges[seg] = {};
        if(!ranges[seg][type]) ranges[seg][type] = {};
        ranges[seg][type][edge] = cur.controls[id];
      });
      Object.keys(ranges).forEach(seg=>{
        Object.keys(ranges[seg]).forEach(type=>{
          const r = ranges[seg][type];
          if(r.start && r.end){
            try{ window.setTableRange(seg, type, r.start, r.end); }catch(e){}
          }
        });
      });
    }

    if(phase === 'post' && isObject(cur.headerFilters)){
      Object.keys(cur.headerFilters).forEach(tableId=>{
        const table = document.getElementById(tableId);
        if(!table) return;
        const fr = table.tHead && table.tHead.querySelector('tr.filter-row');
        if(!fr) return;
        const ctrls = [...fr.querySelectorAll('input,select')];
        const vals = cur.headerFilters[tableId] || [];
        vals.forEach((v, i)=>{
          if(ctrls[i]) ctrls[i].value = v;
        });
        if(typeof window.applyHeaderFiltersForTable === 'function'){
          window.applyHeaderFiltersForTable(table);
        }
      });
    }
  };
  StateManager.collectStateFromUI = function(){
    return buildStateSnapshot();
  };
  StateManager.persistState = function(){
    const next = buildStateSnapshot();
    const serialized = JSON.stringify(next || {});
    if(serialized === this._lastSerialized) return;
    this._lastSerialized = serialized;
    this.state = next;
    writeStateToUrl(next);
    writeStateToStorage(next);
  };
  StateManager.queuePersist = debounce(function(){
    StateManager.persistState();
  }, 200);

  window.StateManager = StateManager;
})();
