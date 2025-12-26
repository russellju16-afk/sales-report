(function(){
  'use strict';

  const STORAGE_KEY = 'sales-report-state-v3';
  const VERSION = 3;
  const listeners = new Set();

  const DEFAULT_STATE = {
    v: VERSION,
    route: 'report',
    segment: 'total',
    date_range: { start: '', end: '' },
    filters: {
      customer: '',
      vendor: '',
      supplier: '',
      sku_key: '',
      category: '',
      memo_contains: '',
      cf_class: '',
      cf_subclass: '',
      match_status: '',
      anomaly_type: '',
      margin_method: 'WAC',
      scenario: 'BASE',
      view: ''
    },
    ui: {
      drawer_open: false,
      drawer_tab: 'table',
      pinned_evidence_ids: [],
      table_sort: {},
      table_page: {},
      page_size: 50,
      explorer_tabs: {},
      explorer_subtabs: {},
      explorer_controls: {},
      explorer_header_filters: {}
    }
  };

  function clone(obj){
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function safeJsonParse(raw){
    if(!raw) return null;
    try{ return JSON.parse(raw); }catch(e){ return null; }
  }

  function debounce(fn, wait){
    let t = null;
    return function(){
      const ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(()=>fn.apply(ctx, args), wait);
    };
  }

  function parseHash(){
    const raw = window.location.hash || '';
    const trimmed = raw.replace(/^#/, '');
    if(!trimmed) return { route: '', params: new URLSearchParams() };
    const parts = trimmed.split('?');
    const path = parts[0] || '';
    const route = path.replace(/^\/+/, '');
    const params = new URLSearchParams(parts[1] || '');
    return { route, params };
  }

  function readStateFromUrl(){
    const hash = parseHash();
    const qs = new URLSearchParams(window.location.search || '');
    const raw = hash.params.get('state') || qs.get('state');
    if(!raw) return null;
    return safeJsonParse(raw);
  }

  function readStateFromStorage(){
    try{
      const raw = window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : '';
      return safeJsonParse(raw);
    }catch(e){
      return null;
    }
  }

  function ensureFilters(filters){
    return Object.assign({}, DEFAULT_STATE.filters, filters || {});
  }

  function ensureUi(ui){
    return Object.assign({}, DEFAULT_STATE.ui, ui || {});
  }

  function mergeDefaults(state){
    const base = clone(DEFAULT_STATE);
    const next = Object.assign(base, state || {});
    next.v = VERSION;
    next.filters = ensureFilters(next.filters);
    next.ui = ensureUi(next.ui);
    next.segment = next.segment || next.seg || base.segment;
    next.seg = next.segment;
    if(!next.date_range) next.date_range = { start: '', end: '' };
    next.tabs = next.tabs || next.ui.explorer_tabs || {};
    next.subtabs = next.subtabs || next.ui.explorer_subtabs || {};
    next.controls = next.controls || next.ui.explorer_controls || {};
    next.headerFilters = next.headerFilters || next.ui.explorer_header_filters || {};
    return next;
  }

  function convertLegacyState(legacy, routeHint){
    const seg = legacy.seg || legacy.segment || 'total';
    const controls = legacy.controls || {};
    const startKey = seg + '_d_start';
    const endKey = seg + '_d_end';
    const date_range = {
      start: controls[startKey] || '',
      end: controls[endKey] || ''
    };
    const next = {
      v: VERSION,
      route: routeHint || 'explorer',
      segment: seg,
      date_range,
      filters: Object.assign({}, legacy.filters || {}),
      ui: {
        drawer_open: false,
        drawer_tab: 'table',
        pinned_evidence_ids: [],
        table_sort: {},
        table_page: {},
        page_size: 50,
        explorer_tabs: legacy.tabs || {},
        explorer_subtabs: legacy.subtabs || {},
        explorer_controls: controls || {},
        explorer_header_filters: legacy.headerFilters || {}
      }
    };
    return mergeDefaults(next);
  }

  function normalizeState(state, routeHint){
    if(!state || typeof state !== 'object'){
      const base = mergeDefaults({});
      if(routeHint) base.route = routeHint;
      return base;
    }
    if(state.v === VERSION){
      const merged = mergeDefaults(state);
      if(routeHint && !state.route) merged.route = routeHint;
      return merged;
    }
    return convertLegacyState(state, routeHint);
  }

  function serializeState(state){
    const out = {
      v: VERSION,
      route: state.route || 'report',
      segment: state.segment || 'total',
      seg: state.segment || 'total',
      date_range: state.date_range || { start: '', end: '' },
      filters: state.filters || {},
      ui: state.ui || {},
      tabs: state.tabs || state.ui.explorer_tabs || {},
      subtabs: state.subtabs || state.ui.explorer_subtabs || {},
      controls: state.controls || state.ui.explorer_controls || {},
      headerFilters: state.headerFilters || state.ui.explorer_header_filters || {}
    };
    return out;
  }

  function writeStateToUrl(state){
    if(!window.history || !window.history.replaceState) return;
    const route = state.route || 'report';
    const params = new URLSearchParams();
    params.set('state', JSON.stringify(serializeState(state)));
    const hash = '#/' + route + '?' + params.toString();
    const next = window.location.pathname + window.location.search + hash;
    window.history.replaceState(null, '', next);
  }

  function writeStateToStorage(state){
    try{
      if(!window.localStorage) return;
      if(state){
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
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
    const nodes = document.querySelectorAll('.controls input[id], .controls select[id], .controls textarea[id], .timebox input[id], .timebox select[id]');
    nodes.forEach((el)=>{
      if(!el.id) return;
      if(el.closest('#order_modal')) return;
      if(el.type === 'checkbox'){
        out[el.id] = !!el.checked;
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
    document.querySelectorAll('table').forEach((table)=>{
      if(!table.id) return;
      const fr = table.tHead && table.tHead.querySelector('tr.filter-row');
      if(!fr) return;
      seen.add(table.id);
      const vals = Array.from(fr.querySelectorAll('input,select')).map((el)=>el.value || '');
      const any = vals.some((v)=>String(v).trim() !== '');
      if(any) out[table.id] = vals;
    });
    return out;
  }

  function applyLegacyStateToUI(state, opts){
    const cur = state || {};
    const phase = (opts && opts.phase) || 'pre';

    if(cur.seg && typeof cur.seg === 'string'){
      window.currentSeg = cur.seg;
    }
    if(cur.tabs && window.tabState){
      Object.keys(cur.tabs).forEach((k)=>{ window.tabState[k] = cur.tabs[k]; });
    }
    if(cur.controls && typeof cur.controls === 'object'){
      Object.keys(cur.controls).forEach((id)=>{
        const el = document.getElementById(id);
        if(el) setControlValue(el, cur.controls[id]);
      });
    }

    if(phase === 'pre' && cur.controls && typeof window.setTableRange === 'function'){
      const ranges = {};
      Object.keys(cur.controls).forEach((id)=>{
        const m = id.match(/^(total|store|nonstore)_(category|product|customer|new|lost|abnormal|catton)_d_(start|end)$/);
        if(!m) return;
        const seg = m[1];
        const type = m[2];
        const edge = m[3];
        if(!ranges[seg]) ranges[seg] = {};
        if(!ranges[seg][type]) ranges[seg][type] = {};
        ranges[seg][type][edge] = cur.controls[id];
      });
      Object.keys(ranges).forEach((seg)=>{
        Object.keys(ranges[seg]).forEach((type)=>{
          const r = ranges[seg][type];
          if(r.start && r.end){
            try{ window.setTableRange(seg, type, r.start, r.end); }catch(e){}
          }
        });
      });
    }

    if(phase === 'post' && cur.headerFilters && typeof cur.headerFilters === 'object'){
      Object.keys(cur.headerFilters).forEach((tableId)=>{
        const table = document.getElementById(tableId);
        if(!table) return;
        const fr = table.tHead && table.tHead.querySelector('tr.filter-row');
        if(!fr) return;
        const ctrls = Array.from(fr.querySelectorAll('input,select'));
        const vals = cur.headerFilters[tableId] || [];
        vals.forEach((v, i)=>{
          if(ctrls[i]) ctrls[i].value = v;
        });
        if(typeof window.applyHeaderFiltersForTable === 'function'){
          window.applyHeaderFiltersForTable(table);
        }
      });
    }
  }

  const StateManager = {
    state: null,
    _lastSerialized: '',
    readState: function(){
      const hash = parseHash();
      const fromUrl = readStateFromUrl();
      if(fromUrl){
        const normalized = normalizeState(fromUrl, hash.route || (fromUrl && fromUrl.route));
        this.state = normalized;
        return normalized;
      }
      const fromStorage = readStateFromStorage();
      if(fromStorage){
        const normalized = normalizeState(fromStorage, hash.route || (fromStorage && fromStorage.route));
        this.state = normalized;
        return normalized;
      }
      const fallback = normalizeState({}, hash.route || 'report');
      this.state = fallback;
      return fallback;
    },
    setState: function(next){
      const normalized = normalizeState(next || {}, (next && next.route));
      this.state = normalized;
      const serialized = JSON.stringify(serializeState(normalized));
      if(serialized !== this._lastSerialized){
        this._lastSerialized = serialized;
        writeStateToUrl(normalized);
        writeStateToStorage(normalized);
        listeners.forEach((cb)=>{ try{ cb(normalized); }catch(e){} });
      }
    },
    update: function(patch){
      const cur = this.state || normalizeState({});
      const merged = Object.assign({}, cur, patch || {});
      if(patch && patch.filters){
        merged.filters = Object.assign({}, cur.filters || {}, patch.filters || {});
      }
      if(patch && patch.ui){
        merged.ui = Object.assign({}, cur.ui || {}, patch.ui || {});
      }
      if(merged.segment && !merged.seg) merged.seg = merged.segment;
      this.setState(merged);
    },
    setRoute: function(route){
      const cur = this.state || normalizeState({});
      this.update({ route: route || cur.route || 'report' });
    },
    onChange: function(cb){
      if(typeof cb === 'function') listeners.add(cb);
      return function(){ listeners.delete(cb); };
    },
    applyStateToUI: function(state, opts){
      applyLegacyStateToUI(state, opts);
    },
    collectStateFromUI: function(){
      const cur = this.state || normalizeState({});
      const controls = collectControls();
      const headerFilters = collectHeaderFilters();
      const tabs = window.tabState ? Object.assign({}, window.tabState) : (cur.tabs || {});
      const seg = window.currentSeg || cur.segment || cur.seg || 'total';
      return Object.assign({}, cur, {
        segment: seg,
        seg: seg,
        tabs: tabs,
        controls: controls,
        headerFilters: headerFilters,
        ui: Object.assign({}, cur.ui || {}, {
          explorer_tabs: tabs,
          explorer_controls: controls,
          explorer_header_filters: headerFilters
        })
      });
    },
    persistState: function(){
      const next = this.collectStateFromUI();
      this.setState(next);
    },
    queuePersist: debounce(function(){
      StateManager.persistState();
    }, 200)
  };

  window.StateManager = StateManager;
})();
