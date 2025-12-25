(function(){
  'use strict';

  function getSeg(){
    return (window.currentSeg || 'total');
  }

  function setInputValue(id, value){
    const el = document.getElementById(id);
    if(el) el.value = value || '';
  }

  function applySegDate(seg, start, end){
    if(!seg) return;
    const sId = seg + '_d_start';
    const eId = seg + '_d_end';
    if(start) setInputValue(sId, start);
    if(end) setInputValue(eId, end);
    if(typeof window.onSegTimeChange === 'function'){
      try{ window.onSegTimeChange(seg); }catch(e){}
    }
  }

  function applySearchFilters(seg, filters){
    if(!seg || !filters) return;
    if(filters.customer !== undefined){
      setInputValue(seg + '_customer_search', filters.customer);
      if(typeof window.filterTable === 'function'){
        try{ window.filterTable(seg, 'customer'); }catch(e){}
      }
    }
    if(filters.category !== undefined){
      setInputValue(seg + '_category_search', filters.category);
      if(typeof window.filterTable === 'function'){
        try{ window.filterTable(seg, 'category'); }catch(e){}
      }
    }
    if(filters.sku_key !== undefined){
      setInputValue(seg + '_product_search', filters.sku_key);
      if(typeof window.filterTable === 'function'){
        try{ window.filterTable(seg, 'product'); }catch(e){}
      }
    }
    if(filters.vendor !== undefined){
      setInputValue(seg + '_forecast_ap_search', filters.vendor);
      if(typeof window.renderForecast === 'function'){
        try{ window.renderForecast(seg); }catch(e){}
      }
    }
    if(filters.supplier !== undefined){
      setInputValue(seg + '_forecast_po_search', filters.supplier);
      if(typeof window.renderForecast === 'function'){
        try{ window.renderForecast(seg); }catch(e){}
      }
    }
    if(filters.customer !== undefined){
      setInputValue(seg + '_forecast_ar_search', filters.customer);
      if(typeof window.renderForecast === 'function'){
        try{ window.renderForecast(seg); }catch(e){}
      }
    }
  }

  function syncFromState(state){
    if(!state) return;
    const seg = state.segment || state.seg || 'total';
    const segSelect = document.getElementById('explorer_segment');
    if(segSelect) segSelect.value = seg;
    if(state.date_range){
      setInputValue('explorer_date_start', state.date_range.start || '');
      setInputValue('explorer_date_end', state.date_range.end || '');
    }
    const filters = state.filters || {};
    setInputValue('explorer_filter_customer', filters.customer || '');
    setInputValue('explorer_filter_vendor', filters.vendor || '');
    setInputValue('explorer_filter_sku', filters.sku_key || '');
    setInputValue('explorer_filter_category', filters.category || '');
    setInputValue('explorer_filter_margin', filters.margin_method || 'WAC');
    setInputValue('explorer_filter_scenario', filters.scenario || 'BASE');
    applySearchFilters(seg, filters);
    if(state.date_range && state.date_range.start && state.date_range.end){
      applySegDate(seg, state.date_range.start, state.date_range.end);
    }
    const anchor = state.ui && state.ui.explorer_anchor ? state.ui.explorer_anchor : '';
    if(anchor){
      const el = document.getElementById(anchor);
      if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function updateStateFilters(patch){
    if(!window.StateManager) return;
    StateManager.update({ filters: patch || {} });
  }

  function bindEvents(){
    const segSelect = document.getElementById('explorer_segment');
    const dateStart = document.getElementById('explorer_date_start');
    const dateEnd = document.getElementById('explorer_date_end');
    const resetBtn = document.getElementById('explorer_reset_btn');
    const copyBtn = document.getElementById('explorer_copy_link_btn');

    if(segSelect){
      segSelect.addEventListener('change', ()=>{
        const seg = segSelect.value || 'total';
        if(typeof window.showSeg === 'function'){
          try{ window.showSeg(seg); }catch(e){}
        }
        updateStateFilters({});
        if(window.StateManager){
          StateManager.update({ segment: seg, seg: seg });
        }
      });
    }

    function onDateChange(){
      const seg = getSeg();
      const start = dateStart ? dateStart.value : '';
      const end = dateEnd ? dateEnd.value : '';
      applySegDate(seg, start, end);
      if(window.StateManager){
        StateManager.update({ date_range: { start: start, end: end } });
      }
    }

    if(dateStart) dateStart.addEventListener('change', onDateChange);
    if(dateEnd) dateEnd.addEventListener('change', onDateChange);

    const customer = document.getElementById('explorer_filter_customer');
    const vendor = document.getElementById('explorer_filter_vendor');
    const sku = document.getElementById('explorer_filter_sku');
    const category = document.getElementById('explorer_filter_category');
    const margin = document.getElementById('explorer_filter_margin');
    const scenario = document.getElementById('explorer_filter_scenario');

    if(customer) customer.addEventListener('input', ()=>{
      const seg = getSeg();
      updateStateFilters({ customer: customer.value || '' });
      applySearchFilters(seg, { customer: customer.value || '' });
    });
    if(vendor) vendor.addEventListener('input', ()=>{
      const seg = getSeg();
      updateStateFilters({ vendor: vendor.value || '' });
      applySearchFilters(seg, { vendor: vendor.value || '' });
    });
    if(sku) sku.addEventListener('input', ()=>{
      const seg = getSeg();
      updateStateFilters({ sku_key: sku.value || '' });
      applySearchFilters(seg, { sku_key: sku.value || '' });
    });
    if(category) category.addEventListener('input', ()=>{
      const seg = getSeg();
      updateStateFilters({ category: category.value || '' });
      applySearchFilters(seg, { category: category.value || '' });
    });
    if(margin) margin.addEventListener('change', ()=>{
      updateStateFilters({ margin_method: margin.value || 'WAC' });
    });
    if(scenario) scenario.addEventListener('change', ()=>{
      updateStateFilters({ scenario: scenario.value || 'BASE' });
    });

    if(resetBtn){
      resetBtn.addEventListener('click', ()=>{
        if(customer) customer.value = '';
        if(vendor) vendor.value = '';
        if(sku) sku.value = '';
        if(category) category.value = '';
        if(margin) margin.value = 'WAC';
        if(scenario) scenario.value = 'BASE';
        const seg = getSeg();
        applySearchFilters(seg, { customer: '', vendor: '', sku_key: '', category: '' });
        updateStateFilters({ customer: '', vendor: '', sku_key: '', category: '', margin_method: 'WAC', scenario: 'BASE' });
      });
    }

    if(copyBtn){
      copyBtn.addEventListener('click', ()=>{
        const link = window.location.href;
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(link).then(()=>{ if(window.showToast) showToast('已复制链接'); });
        }
      });
    }

    const closeBtn = document.getElementById('detail_close_btn');
    if(closeBtn){
      closeBtn.addEventListener('click', ()=>{
        const panel = document.getElementById('explorer_detail_panel');
        if(panel){
          panel.classList.add('hidden');
          panel.setAttribute('aria-hidden','true');
        }
      });
    }
  }

  function init(){
    if(window.StateManager){
      StateManager.onChange((state)=>syncFromState(state));
      syncFromState(StateManager.state || StateManager.readState());
    }
    bindEvents();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
