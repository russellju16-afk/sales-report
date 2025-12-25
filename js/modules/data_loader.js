(function(){
  'use strict';

  const cache = new Map();

  function fetchTextCached(key, url){
    if(cache.has(key)) return cache.get(key);
    const promise = fetch(url, { cache: 'no-store' }).then((resp)=>{
      if(!resp.ok) throw new Error('加载失败: ' + url + ' (' + resp.status + ')');
      return resp.text();
    });
    cache.set(key, promise);
    return promise;
  }

  function fetchJsonCached(key, url, parser){
    const parse = typeof parser === 'function' ? parser : JSON.parse;
    if(cache.has(key)) return cache.get(key);
    const promise = fetchTextCached(key, url).then((text)=>parse(text));
    cache.set(key, promise);
    return promise;
  }

  function clear(key){
    if(typeof key === 'string'){
      cache.delete(key);
      return;
    }
    cache.clear();
  }

  window.DataLoader = {
    fetchTextCached,
    fetchJsonCached,
    clear
  };
})();
