(function(){
  'use strict';

  function $(sel){ return document.querySelector(sel); }

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

  function setActiveRoute(route){
    document.body.dataset.route = route;
    document.querySelectorAll('.route-btn, .toc-route').forEach((btn)=>{
      btn.classList.toggle('active', btn.dataset.route === route);
    });
    document.querySelectorAll('.toc-group').forEach((group)=>{
      const match = group.dataset.route === route;
      group.style.display = match ? 'flex' : 'none';
    });
  }

  function scrollToAnchor(anchor){
    if(!anchor) return;
    const id = anchor.replace(/^#/, '');
    const el = document.getElementById(id);
    if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateQuickJump(route){
    const select = document.getElementById('quick_jump');
    if(!select) return;
    const options = [{ value: '', label: '快速跳转…' }];
    document.querySelectorAll('.report-section[data-route="'+route+'"] h2').forEach((h2)=>{
      const sec = h2.closest('.report-section');
      if(sec && sec.id){
        options.push({ value: sec.id, label: h2.textContent.trim() });
      }
    });
    select.innerHTML = '';
    options.forEach((opt)=>{
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    });
  }

  function clearSearchHits(){
    document.querySelectorAll('.search-hit').forEach((el)=>{
      el.classList.remove('search-hit');
    });
  }

  function performSearch(query){
    clearSearchHits();
    const q = String(query || '').trim().toLowerCase();
    if(!q) return;
    const nodes = Array.from(document.querySelectorAll('.conclusion-title, .report-card-title, .section-head h2, .bp-content h2, .bp-content h3'));
    const hits = nodes.filter((n)=>n.textContent.toLowerCase().includes(q));
    if(!hits.length) return;
    hits.forEach((n)=>n.classList.add('search-hit'));
    hits[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const Router = {
    current: 'report',
    go: function(route, anchor){
      const target = route || 'report';
      this.current = target;
      if(window.StateManager){
        StateManager.setRoute(target);
      }
      setActiveRoute(target);
      updateQuickJump(target);
      if(anchor) scrollToAnchor(anchor);
    },
    init: function(){
      const state = window.StateManager ? StateManager.readState() : null;
      const hash = parseHash();
      const route = (state && state.route) || hash.route || 'report';
      this.current = route;
      setActiveRoute(route);
      updateQuickJump(route);

      document.addEventListener('click', (e)=>{
        const btn = e.target.closest('.route-btn, .toc-route');
        if(btn && btn.dataset.route){
          e.preventDefault();
          Router.go(btn.dataset.route);
          return;
        }
        const link = e.target.closest('[data-route][data-anchor]');
        if(link){
          e.preventDefault();
          Router.go(link.dataset.route, link.dataset.anchor);
        }
      });

      const select = document.getElementById('quick_jump');
      if(select){
        select.addEventListener('change', ()=>{
          const val = select.value;
          if(val) scrollToAnchor(val);
        });
      }

      const searchBtn = document.getElementById('search_btn');
      const searchInput = document.getElementById('global_search');
      if(searchBtn && searchInput){
        searchBtn.addEventListener('click', ()=>performSearch(searchInput.value));
        searchInput.addEventListener('keydown', (e)=>{
          if(e.key === 'Enter') performSearch(searchInput.value);
        });
      }

      window.addEventListener('hashchange', ()=>{
        const hashNext = parseHash();
        const routeNext = hashNext.route || 'report';
        Router.go(routeNext);
      });
    }
  };

  window.Router = Router;

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>Router.init());
  }else{
    Router.init();
  }
})();
