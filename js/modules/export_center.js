(function(){
  'use strict';

  function buildCsv(rows, headers){
    const out = [];
    if(headers && headers.length) out.push(headers.join(','));
    rows.forEach((row)=>{
      const line = headers.map((h)=>{
        const val = row[h] == null ? '' : String(row[h]);
        return '"' + val.replace(/"/g, '""') + '"';
      }).join(',');
      out.push(line);
    });
    return out.join('\n');
  }

  function downloadCsv(name, csv){
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadJson(name, data){
    const blob = new Blob([JSON.stringify(data || {}, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportSummary(){
    const snapshot = window.__REPORT_SNAPSHOT__ || {};
    const rows = [];
    (snapshot.kpis || []).forEach((k)=>{
      rows.push({ label: k.label, value: k.value, note: k.sub || '' });
    });
    (snapshot.conclusions || []).forEach((c)=>{
      rows.push({ label: c.title || c.signal || '', value: c.evidence || '', note: c.section || '' });
    });
    const csv = buildCsv(rows, ['label','value','note']);
    downloadCsv('summary.csv', csv);
  }

  function exportDetails(){
    if(window.EvidenceDrawer && EvidenceDrawer.getActive()){
      EvidenceDrawer.exportActive();
      return;
    }
    const warnings = window.__REPORT_WARNINGS__ || [];
    const rows = warnings.map((w)=>({
      level: w.level,
      domain: w.domain,
      signal: w.signal,
      evidence: w.evidence
    }));
    const csv = buildCsv(rows, ['level','domain','signal','evidence']);
    downloadCsv('details.csv', csv);
  }

  function exportActions(){
    const actions = window.__REPORT_ACTIONS__ || [];
    const rows = actions.map((a)=>({
      source: a.source,
      domain: a.domain,
      signal: a.signal,
      owner: a.owner,
      task: a.task,
      ddl: a.ddl,
      impact: a.impact
    }));
    const csv = buildCsv(rows, ['source','domain','signal','owner','task','ddl','impact']);
    downloadCsv('actions.csv', csv);
  }

  function bind(){
    const panel = document.getElementById('export_center');
    const openBtn = document.getElementById('export_center_btn');
    const closeBtn = document.getElementById('export_close_btn');

    if(openBtn && panel){
      openBtn.addEventListener('click', ()=>{
        panel.classList.remove('hidden');
        panel.setAttribute('aria-hidden','false');
      });
    }
    if(closeBtn && panel){
      closeBtn.addEventListener('click', ()=>{
        panel.classList.add('hidden');
        panel.setAttribute('aria-hidden','true');
      });
    }

    if(panel){
      panel.addEventListener('click', (e)=>{
        if(e.target === panel){
          panel.classList.add('hidden');
          panel.setAttribute('aria-hidden','true');
        }
      });
    }

    document.querySelectorAll('[data-export]').forEach((btn)=>{
      btn.addEventListener('click', ()=>{
        const key = btn.dataset.export;
        if(key === 'summary_csv') exportSummary();
        if(key === 'detail_csv') exportDetails();
        if(key === 'actions_csv') exportActions();
        if(key === 'snapshot_json') downloadJson('snapshot.json', window.__REPORT_SNAPSHOT__ || {});
      });
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bind);
  }else{
    bind();
  }
})();
