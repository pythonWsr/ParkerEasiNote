/* ============================================================
   启动自检：检查运行所需文件是否齐全
   缺失时弹出「三角感叹号」提示，引导到官网重新下载
   ============================================================ */
(function(){
  var CFG = window.EN10_CONFIG || {};
  var missing = [];

  function hasCss(){
    try{
      for(var i = 0; i < document.styleSheets.length; i++){
        var ss = document.styleSheets[i];
        var rules = null;
        try{ rules = ss.cssRules; }catch(e){ rules = null; }
        if(rules && rules.length) return true;
        if(!rules && ss.href) return true;
      }
    }catch(e){}
    return false;
  }

  /* 网络可用时用 HEAD 精确判断；file:// 下 fetch 会被拦，改用元素探测 */
  function probe(url){
    if(location.protocol === 'file:') return Promise.resolve(null);
    /* 只有明确的 404 才算缺失；超时/被拦/权限问题一律当作「未知」，避免误报 */
    return fetch(url, { method:'HEAD', cache:'no-store' })
      .then(function(r){ return r.status === 404 ? false : null; })
      .catch(function(){ return null; });
  }
  function probeImage(src){
    return new Promise(function(res){
      var img = new Image();
      img.onload = function(){ res(true); };
      img.onerror = function(){ res(false); };
      img.src = src + '?v=' + Date.now();
    });
  }

  function syncCheck(){
    if(!window.EN10) missing.push('js/app.js');
    if(!window.EN10_CONFIG) missing.push('js/config.js');
    if(typeof window.JSZip === 'undefined') missing.push('vendor/jszip.min.js');
    if(typeof window.pdfjsLib === 'undefined') missing.push('vendor/pdf.min.js');
    if(typeof window.THREE === 'undefined') missing.push('vendor/three.min.js');
    if(!window.MathJax || typeof MathJax.tex2svg !== 'function') missing.push('vendor/mathjax-tex-svg.js');
    if(typeof window.EN10Subjects === 'undefined') missing.push('js/features/subject-core.js');
    if(typeof window.EN10Tiles === 'undefined') missing.push('js/features/tiles.js');
    if(typeof window.EN10TTS === 'undefined') missing.push('js/features/tts.js');
    if(typeof window.PPTExt === 'undefined') missing.push('js/features/ppt-ext.js');
    if(!hasCss()) missing.push('css/*.css');
  }

  function asyncCheck(){
    var jobs = [
      probeImage('assets/img/logo.png').then(function(ok){ if(ok === false) missing.push('assets/img/logo.png'); }),
      probe('data/hanzi.js').then(function(ok){ if(ok === false) missing.push('data/hanzi.js'); }),
      probe('data/poems.js').then(function(ok){ if(ok === false) missing.push('data/poems.js'); }),
      probe('vendor/faceapi/face-api.min.js').then(function(ok){ if(ok === false) missing.push('vendor/faceapi/face-api.min.js'); }),
      probe('vendor/faceapi/model/tiny_face_detector_model.bin').then(function(ok){ if(ok === false) missing.push('vendor/faceapi/model/*'); }),
      probe('vendor/pdf.worker.min.js').then(function(ok){ if(ok === false) missing.push('vendor/pdf.worker.min.js'); }),
      probe('assets/fonts/PatrickHand.ttf').then(function(ok){ if(ok === false) missing.push('assets/fonts/PatrickHand.ttf'); })
    ];
    return Promise.all(jobs);
  }

  function report(list){
    if(!list.length) return;
    var uniq = list.filter(function(v, i){ return list.indexOf(v) === i; });
    console.error('[ParkerEasiNote10] 文件缺失：', uniq.join(', '));
    var html =
      '<div class="integrity-body">' +
        '<div class="integrity-ic"><i class="fas fa-triangle-exclamation"></i></div>' +
        '<div class="integrity-title">文件不完整，部分功能无法使用</div>' +
        '<div class="integrity-sub">缺少：' + uniq.slice(0, 6).join('、') + (uniq.length > 6 ? ' 等' : '') + '</div>' +
        '<div class="integrity-hint">请至官网下载最新版本</div>' +
      '</div>';
    EN10.openModal({
      title:'',
      cls:'integrity-modal',
      content: html,
      actions:[
        { id:'reload', label:'重新加载', type:'cancel', callback:function(ov){ EN10.closeModal(ov); location.reload(); } },
        { id:'site', label:'前往官网', type:'confirm', callback:function(){
            if(CFG.website) window.open(CFG.website, '_blank');
        }}
      ]
    });
  }

  function run(){
    syncCheck();
    asyncCheck().then(function(){ report(missing); });
  }

  function boot(){
    /* 等首屏脚本都执行完再检查，避免误报 */
    setTimeout(run, 1500);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.EN10Integrity = { check: run };
})();
