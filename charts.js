(function () {
  const charts = new Map();

  const modernTheme = {
    color: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'],
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    title: { textStyle: { fontWeight: 700, fontSize: 16, color: '#0f172a' } },
    legend: { textStyle: { color: '#64748b' }, itemGap: 24 },
    grid: { containLabel: true, borderColor: '#f1f5f9' },
    categoryAxis: {
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
      axisLabel: { color: '#64748b', margin: 12 },
      splitLine: { show: false }
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#64748b', margin: 12 },
      splitLine: { lineStyle: { color: '#f1f5f9' } }
    },
    line: { smooth: true, symbolSize: 8, lineStyle: { width: 3 } },
    bar: { itemStyle: { borderRadius: [4, 4, 0, 0] } },
    tooltip: {
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderWidth: 0,
      textStyle: { color: '#0f172a', fontSize: 13 },
      padding: [12, 16],
      extraCssText: 'box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); backdrop-filter: blur(8px); border-radius: 8px;',
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: '#cbd5e1',
          width: 1,
          type: 'dashed'
        }
      },
      formatter: function (params) {
        if (!Array.isArray(params)) return '';
        let html = `<div style="font-weight:600;margin-bottom:8px;color:#0f172a;">${params[0].axisValue}</div>`;
        params.forEach(item => {
          let val = item.value;
          if (typeof val === 'number') {
            val = val.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
          }
          const marker = item.marker ? item.marker : `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${item.color};"></span>`;
          html += `<div style="display:flex;justify-content:space-between;gap:20px;align-items:center;font-size:12px;margin-bottom:4px;">
            <div style="display:flex;align-items:center;">${marker} <span style="color:#64748b;">${item.seriesName}</span></div>
            <div style="font-weight:600;font-family:monospace;">${val}</div>
          </div>`;
        });
        return html;
      }
    }
  };

  if (typeof echarts !== 'undefined') {
    echarts.registerTheme('modern', modernTheme);
  }

  function getChart(id) {
    const el = document.getElementById(id);
    if (!el || typeof echarts === 'undefined') return null;
    if (charts.has(id)) return charts.get(id);
    const existing = echarts.getInstanceByDom(el);
    if (existing) {
      charts.set(id, existing);
      return existing;
    }
    const chart = echarts.init(el, 'modern', { renderer: 'canvas' });
    charts.set(id, chart);
    return chart;
  }

  function setOption(id, option) {
    const chart = getChart(id);
    if (!chart) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
  }

  function setEmpty(id, message) {
    setOption(id, {
      title: {
        text: message || '暂无数据',
        left: 'center',
        top: 'middle',
        textStyle: { color: '#888', fontSize: 14, fontWeight: 700 }
      },
      xAxis: { type: 'category', show: false, data: [] },
      yAxis: { type: 'value', show: false },
      series: []
    });
  }

  function resizeAll() {
    charts.forEach((chart) => {
      try { chart.resize(); } catch (e) { }
    });
  }

  window.ChartManager = { getChart, setOption, setEmpty, resizeAll };
  window.addEventListener('resize', resizeAll);
})();
