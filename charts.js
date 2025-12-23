(function(){
  const charts = new Map();

  function getChart(id){
    const el = document.getElementById(id);
    if(!el || typeof echarts === 'undefined') return null;
    if(charts.has(id)) return charts.get(id);
    const existing = echarts.getInstanceByDom(el);
    if(existing){
      charts.set(id, existing);
      return existing;
    }
    const chart = echarts.init(el, null, { renderer: 'canvas' });
    charts.set(id, chart);
    return chart;
  }

  function setOption(id, option){
    const chart = getChart(id);
    if(!chart) return;
    chart.setOption(option, true);
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
