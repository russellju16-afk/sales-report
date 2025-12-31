(function(){
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
      backgroundColor: 'rgba(255, 255, 255, 0.9)',
      borderWidth: 1,
      borderColor: '#e2e8f0',
      textStyle: { color: '#0f172a' },
      padding: [12, 16],
      extraCssText: 'box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); backdrop-filter: blur(4px);'
    }
  };

  if (typeof echarts !== 'undefined') {
    echarts.registerTheme('modern', modernTheme);
  }

  function getChart(id){
    const el = document.getElementById(id);
    if(!el || typeof echarts === 'undefined') return null;
    if(charts.has(id)) return charts.get(id);
    const existing = echarts.getInstanceByDom(el);
    if(existing){
      charts.set(id, existing);
      return existing;
    }
    const chart = echarts.init(el, 'modern', { renderer: 'canvas' });
    charts.set(id, chart);
    return chart;
  }

  function setOption(id, option){
    const chart = getChart(id);
    if(!chart) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
  }

  function setEmpty(id, message){
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

  function resizeAll(){
    charts.forEach((chart)=>{
      try{ chart.resize(); }catch(e){}
    });
  }

  window.ChartManager = { getChart, setOption, setEmpty, resizeAll };
  window.addEventListener('resize', resizeAll);
})();
