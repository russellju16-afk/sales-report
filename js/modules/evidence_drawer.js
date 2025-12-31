(function () {
  'use strict';

  const drawer = document.getElementById('evidence_drawer');
  const tabsEl = document.getElementById('drawer_tabs');
  const bodyEl = document.getElementById('drawer_body');
  const emptyEl = document.getElementById('drawer_empty');
  const subtitleEl = document.getElementById('drawer_subtitle');
  const pinBtn = document.getElementById('drawer_pin_btn');
  const closeBtn = document.getElementById('drawer_close_btn');
  const toggleBtn = document.getElementById('drawer_toggle_btn');

  const ROW_IDX = {
    date: 0, order: 1, cust: 2, cls: 3, name: 4, spec: 5, prod: 6, cat: 7,
    qty: 8, sales: 9, cost: 10, fee: 11, gp: 12, gpAdj: 13, unitPrice: 14
  };

  let stack = [];
  let activeId = '';
  let pinned = false;

  function makeId(evidence) {
    if (evidence.id) return evidence.id;
    const seed = JSON.stringify({
      seg: evidence.seg || '',
      tab: evidence.tab || '',
      tableId: evidence.tableId || '',
      anchor: evidence.anchor || '',
      filters: evidence.filters || {}
    });
    return 'ev_' + btoa(unescape(encodeURIComponent(seed))).slice(0, 10);
  }

  function setDrawerOpen(open) {
    if (!drawer) return;
    drawer.classList.toggle('closed', !open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (window.StateManager) {
      StateManager.update({ ui: { drawer_open: open } });
    }
  }

  function ensureEvidenceState(evidence) {
    const seg = evidence.seg || 'total';
    if (typeof window.showSeg === 'function') {
      try { window.showSeg(seg); } catch (e) { }
    }
    if (evidence.tab && typeof window.showTab === 'function') {
      try { window.showTab(seg, evidence.tab); } catch (e) { }
    }
    if (window.StateManager) {
      const patch = { segment: seg, seg: seg };
      if (evidence.filters && typeof evidence.filters === 'object') {
        patch.filters = evidence.filters;
      }
      if (evidence.anchor) {
        patch.ui = { explorer_anchor: evidence.anchor };
      }
      StateManager.update(patch);
    }

    if (evidence.tableId && evidence.filterFirstColValue !== undefined && evidence.filterFirstColValue !== null) {
      const vals = [String(evidence.filterFirstColValue)];
      const table = document.getElementById(evidence.tableId);
      if (table && table.tHead) {
        const fr = table.tHead.querySelector('tr.filter-row');
        if (fr) {
          const ctrls = Array.from(fr.querySelectorAll('input,select'));
          vals.forEach((v, i) => { if (ctrls[i]) ctrls[i].value = v; });
          if (typeof window.applyHeaderFiltersForTable === 'function') {
            window.applyHeaderFiltersForTable(table);
          }
        }
      }
    }
  }

  function renderTableView(evidence) {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap dense-table';
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll report-table-scroll';
    const table = document.createElement('table');
    table.className = 'drawer-table';
    const source = evidence.tableId ? document.getElementById(evidence.tableId) : null;
    if (!source || !source.tHead || !source.tBodies) {
      const empty = document.createElement('div');
      empty.className = 'report-empty';
      empty.textContent = '未找到对应明细表，请在 Explorer 内查看。';
      bodyEl.appendChild(empty);
      return;
    }

    const clonedHead = source.tHead.cloneNode(true);
    const clonedBody = document.createElement('tbody');
    const rows = Array.from(source.tBodies[0].rows || []);
    const limit = 40;
    rows.slice(0, limit).forEach((row) => {
      clonedBody.appendChild(row.cloneNode(true));
    });
    table.appendChild(clonedHead);
    table.appendChild(clonedBody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);

    const tools = document.createElement('div');
    tools.className = 'report-action-toolbar';
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = '导出当前证据 CSV';
    btn.addEventListener('click', () => exportTableCsv(table, evidence.title || 'evidence'));
    tools.appendChild(btn);
    bodyEl.appendChild(tools);
    bodyEl.appendChild(wrap);
  }

  function renderRowsView(evidence) {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';

    if (!window.ReportData || !window.ReportData.segments) {
      bodyEl.innerHTML = '<div class="report-empty">数据未加载或无权限访问原始数据</div>';
      return;
    }

    const segKey = evidence.seg || 'total';
    const segData = window.ReportData.segments[segKey];
    if (!segData || !segData.rows || !segData.rows.length) {
      bodyEl.innerHTML = '<div class="report-empty">该分部无明细数据</div>';
      return;
    }

    // Filter logic (optional, filtering by evidence context)
    let rows = segData.rows;
    if (evidence.filterFirstColValue) {
      // This is a rough filter approximation
      const filterVal = String(evidence.filterFirstColValue);
      rows = rows.filter(r => {
        return String(r[ROW_IDX.cust]).includes(filterVal) ||
          String(r[ROW_IDX.prod]).includes(filterVal) ||
          String(r[ROW_IDX.cat]).includes(filterVal);
      });
    }

    const count = rows.length;
    const limit = 200;
    const showRows = rows.slice(0, limit);

    const tools = document.createElement('div');
    tools.className = 'report-action-toolbar';
    tools.style.justifyContent = 'space-between';
    const info = document.createElement('div');
    info.className = 'ctl';
    info.textContent = `共 ${count} 条记录${count > limit ? `（仅显示前 ${limit} 条）` : ''}`;

    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = '导出全部 CSV';
    btn.addEventListener('click', () => {
      // CSV Export logic for rows
      const headers = ['日期', '订单号', '客户', '渠道', '业务员', '规格', '产品', '品类', '数量', '销售额', '成本', '费用', '毛利', '扣费毛利'];
      const csvContent = [headers.join(',')].concat(rows.map(r => {
        return r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',');
      })).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `details_${segKey}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    tools.appendChild(info);
    tools.appendChild(btn);
    bodyEl.appendChild(tools);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap dense-table';
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll report-table-scroll';
    const table = document.createElement('table');
    table.className = 'drawer-table';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    ['日期', '订单', '客户', '产品', '品类', '销售额', '毛利', '扣费毛利'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    showRows.forEach(r => {
      const tr = document.createElement('tr');
      // Mapping keys to table columns
      // Date, Order, Cust, Prod, Cat, Sales, GP, GPAdj
      const cells = [
        r[ROW_IDX.date],
        r[ROW_IDX.order],
        r[ROW_IDX.cust],
        r[ROW_IDX.prod],
        r[ROW_IDX.cat],
        (Number(r[ROW_IDX.sales]) || 0).toFixed(2),
        (Number(r[ROW_IDX.gp]) || 0).toFixed(2),
        (Number(r[ROW_IDX.gpAdj]) || 0).toFixed(2)
      ];
      cells.forEach(c => {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    bodyEl.appendChild(wrap);
  }

  function renderChartView() {
    if (!bodyEl) return;
    const empty = document.createElement('div');
    empty.className = 'report-empty';
    empty.textContent = '暂无图表证据';
    bodyEl.replaceChildren(empty);
  }

  function renderEvidence(evidence) {
    if (!evidence) return;
    if (subtitleEl) {
      subtitleEl.textContent = evidence.title || '证据视图';
    }
    const tab = (window.StateManager && StateManager.state && StateManager.state.ui && StateManager.state.ui.drawer_tab) ? StateManager.state.ui.drawer_tab : 'table';
    if (tab === 'detail') renderRowsView(evidence);
    else if (tab === 'chart') renderChartView(evidence);
    else renderTableView(evidence);
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    stack.forEach((ev) => {
      const btn = document.createElement('button');
      btn.className = 'drawer-tab' + (ev.id === activeId ? ' active' : '');
      btn.textContent = ev.title || '证据';
      btn.addEventListener('click', () => {
        activeId = ev.id;
        if (window.StateManager) {
          StateManager.update({ ui: { drawer_tab: StateManager.state.ui.drawer_tab || 'table' } });
        }
        renderTabs();
        renderEvidence(ev);
      });
      tabsEl.appendChild(btn);
    });
    if (emptyEl) {
      emptyEl.style.display = stack.length ? 'none' : 'block';
    }
  }

  function exportTableCsv(table, name) {
    if (!table) return;
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) => {
      return Array.from(tr.querySelectorAll('th,td')).map((cell) => cell.textContent.trim());
    });
    if (!rows.length) return;
    const csv = rows.map((row) => row.map((cell) => '"' + cell.replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name || 'evidence') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openEvidence(evidence) {
    if (!evidence) return;
    const id = makeId(evidence);
    evidence.id = id;

    if (!pinned) {
      stack = [];
    }
    const existing = stack.find((ev) => ev.id === id);
    if (!existing) {
      stack.push(evidence);
    }
    activeId = id;
    setDrawerOpen(true);
    ensureEvidenceState(evidence);
    renderTabs();
    renderEvidence(evidence);
  }

  function getActiveEvidence() {
    return stack.find((ev) => ev.id === activeId) || stack[0] || null;
  }

  function togglePinned() {
    pinned = !pinned;
    if (pinBtn) pinBtn.textContent = pinned ? '已固定' : '固定';
    if (window.StateManager) {
      StateManager.update({ ui: { pinned_evidence_ids: pinned ? stack.map((s) => s.id) : [] } });
    }
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest && e.target.closest('[data-evidence]');
    if (link) {
      e.preventDefault();
      let payload = {};
      try { payload = JSON.parse(link.dataset.evidence || '{}'); } catch (err) { payload = {}; }
      if (!payload.title) {
        payload.title = link.dataset.evidenceTitle || link.textContent.trim() || '证据';
      }
      openEvidence(payload);
      return;
    }

    // Auto close if clicking outside and not pinned
    if (!pinned && drawer && !drawer.classList.contains('closed')) {
      if (!drawer.contains(e.target) && !e.target.closest('#drawer_toggle_btn')) {
        setDrawerOpen(false);
      }
    }
  });

  if (pinBtn) pinBtn.addEventListener('click', togglePinned);
  if (closeBtn) closeBtn.addEventListener('click', () => setDrawerOpen(false));
  if (toggleBtn) toggleBtn.addEventListener('click', () => setDrawerOpen(drawer && drawer.getAttribute('aria-hidden') === 'true'));

  const tabButtons = document.createElement('div');
  tabButtons.className = 'drawer-tabs';

  function installViewTabs() {
    if (!drawer || !drawer.querySelector) return;
    const holder = document.createElement('div');
    holder.className = 'drawer-tabs';
    const activeKey = (window.StateManager && StateManager.state && StateManager.state.ui && StateManager.state.ui.drawer_tab) ? StateManager.state.ui.drawer_tab : 'table';
    ['table', 'chart', 'detail'].forEach((key) => {
      const btn = document.createElement('button');
      btn.className = 'drawer-tab' + (key === activeKey ? ' active' : '');
      btn.textContent = key === 'table' ? '表' : (key === 'chart' ? '图' : '明细');
      btn.addEventListener('click', () => {
        if (window.StateManager) {
          StateManager.update({ ui: { drawer_tab: key } });
        }
        const active = getActiveEvidence();
        renderEvidence(active);
        Array.from(holder.children).forEach((c) => c.classList.toggle('active', c === btn));
      });
      holder.appendChild(btn);
    });
    const body = document.getElementById('drawer_body');
    if (body && body.parentNode) {
      body.parentNode.insertBefore(holder, body);
    }
  }

  function restoreFromState() {
    if (!window.StateManager || !StateManager.state) return;
    const ui = StateManager.state.ui || {};
    pinned = Array.isArray(ui.pinned_evidence_ids) && ui.pinned_evidence_ids.length > 0;
    if (pinBtn) pinBtn.textContent = pinned ? '已固定' : '固定';
    setDrawerOpen(!!ui.drawer_open);
  }

  installViewTabs();
  restoreFromState();

  window.EvidenceDrawer = {
    open: openEvidence,
    getActive: getActiveEvidence,
    exportActive: function () {
      const active = getActiveEvidence();
      if (!active) return;
      const source = active.tableId ? document.getElementById(active.tableId) : null;
      if (source) exportTableCsv(source, active.title || 'evidence');
    }
  };
})();
