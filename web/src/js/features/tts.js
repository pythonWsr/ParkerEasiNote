/* ============================================================
   本地朗读引擎（离线）
   - 只用系统内置语音（Windows SAPI / macOS / Linux speech-dispatcher），不发任何网络请求
   - 解决三类常见问题：voices 异步加载导致第一次点击没声、长句被截断、连续朗读互相打断
   - 没有可用语音包时给出明确提示，而不是静默失败
   ============================================================ */
(function(){
  var voices = [], ready = false, inited = false;
  var queue = [], playing = false;
  var keepTimer = 0;
  var current = null;
  var warned = false;

  function hasApi(){
    return typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  }

  function loadVoices(){
    if(!hasApi()) return [];
    var list = [];
    try{ list = window.speechSynthesis.getVoices() || []; }catch(e){ list = []; }
    if(list.length){ voices = list; ready = true; }
    return list;
  }

  function init(cb){
    if(!hasApi()){ cb && cb(); return; }
    if(inited && ready){ cb && cb(); return; }
    inited = true;
    loadVoices();
    if(window.speechSynthesis.onvoiceschanged !== undefined){
      window.speechSynthesis.onvoiceschanged = function(){ loadVoices(); };
    }
    /* 不同浏览器首次 getVoices 常常是空数组，轮询几轮兜底 */
    var tries = 0;
    (function poll(){
      if(ready || tries++ > 20){ ready = true; cb && cb(); return; }
      if(loadVoices().length){ cb && cb(); return; }
      setTimeout(poll, 120);
    })();
  }

  function langOf(v){ return String((v && v.lang) || '').toLowerCase().replace('_', '-'); }
  function score(v, want){
    var lang = langOf(v), s = 0;
    var w = String(want || 'zh-CN').toLowerCase();
    if(lang === w) s += 100;
    else if(lang.indexOf(w.split('-')[0]) === 0) s += 60;
    else if(lang.indexOf('zh') === 0 && w.indexOf('zh') === 0) s += 40;
    if(v.localService) s += 30;                 /* 本地语音包优先，断网也能读 */
    if(/natural|neural|premium|enhanced/i.test(v.name || '')) s += 6;
    if(/google/i.test(v.name || '')) s -= 8;     /* Chrome 的 Google 语音在部分系统是联网合成 */
    return s;
  }

  function pickVoice(lang){
    if(!voices.length) loadVoices();
    var best = null, bestScore = -1e9;
    for(var i=0;i<voices.length;i++){
      var s = score(voices[i], lang);
      if(s > bestScore){ bestScore = s; best = voices[i]; }
    }
    if(best && bestScore > 0) return best;
    return null;
  }

  function splitText(text){
    var raw = String(text == null ? '' : text).replace(/\r/g, '');
    var parts = [], buf = '';
    for(var i=0;i<raw.length;i++){
      var ch = raw[i];
      buf += ch;
      if(/[。！？；!?;\n]/.test(ch) || buf.length >= 60){
        if(buf.trim()) parts.push(buf.trim());
        buf = '';
      }
    }
    if(buf.trim()) parts.push(buf.trim());
    return parts;
  }

  function stopKeepAlive(){
    if(keepTimer){ clearInterval(keepTimer); keepTimer = 0; }
  }
  function startKeepAlive(){
    stopKeepAlive();
    /* Chrome 长文本会在 15s 左右自动暂停，定时 resume 可绕过 */
    keepTimer = setInterval(function(){
      try{
        if(!playing){ stopKeepAlive(); return; }
        if(window.speechSynthesis.paused) window.speechSynthesis.resume();
      }catch(e){}
    }, 8000);
  }

  function next(){
    if(!queue.length){ playing = false; current = null; stopKeepAlive(); return; }
    var job = queue.shift();
    var u = new SpeechSynthesisUtterance(job.text);
    u.lang = job.lang;
    if(job.voice) u.voice = job.voice;
    u.rate = job.rate;
    u.pitch = job.pitch == null ? 1 : job.pitch;
    u.volume = 1;
    u.onend = function(){ next(); };
    u.onerror = function(ev){
      /* interrupted / canceled 是主动打断，不当作错误继续跑队列 */
      if(ev && (ev.error === 'interrupted' || ev.error === 'canceled')){ playing = false; stopKeepAlive(); return; }
      next();
    };
    playing = true;
    current = u;
    try{ window.speechSynthesis.speak(u); }catch(e){ playing = false; }
  }

  function speak(text, lang, rate){
    if(!hasApi()) return false;
    var t = String(text == null ? '' : text).trim();
    if(!t) return false;
    stop();
    init(function(){
      var wantLang = lang || 'zh-CN';
      var voice = pickVoice(wantLang);
      if(!voice){
        if(!warned){
          warned = true;
          if(window.EN10 && EN10.toast) EN10.toast('本机未安装中文语音包，请在系统设置里添加「中文语音」后重试', 'fa-volume-xmark');
        }
        return;
      }
      var chunks = splitText(t);
      var r = Math.max(0.5, Math.min(2, rate || 1));
      chunks.forEach(function(c){ queue.push({ text:c, lang: langOf(voice) || wantLang, voice:voice, rate:r }); });
      startKeepAlive();
      next();
    });
    return true;
  }

  function stop(){
    queue = [];
    playing = false;
    current = null;
    stopKeepAlive();
    try{ if(hasApi()) window.speechSynthesis.cancel(); }catch(e){}
  }

  function pause(){
    try{ if(hasApi() && window.speechSynthesis.speaking) window.speechSynthesis.pause(); }catch(e){}
  }
  function resume(){
    try{ if(hasApi() && window.speechSynthesis.paused) window.speechSynthesis.resume(); }catch(e){}
  }

  function listVoices(lang){
    if(!voices.length) loadVoices();
    return voices.filter(function(v){
      if(!lang) return true;
      return langOf(v).indexOf(String(lang).split('-')[0].toLowerCase()) === 0;
    });
  }

  /* 预热点：浏览器要求首次朗读由用户手势触发，进入学科工具时先“空读”一次完成解锁 */
  function warmup(){
    if(!hasApi() || warmup.done) return;
    warmup.done = true;
    try{
      var u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.lang = 'zh-CN';
      window.speechSynthesis.speak(u);
    }catch(e){}
  }

  window.EN10TTS = {
    speak: speak,
    stop: stop,
    pause: pause,
    resume: resume,
    warmup: warmup,
    init: init,
    voices: listVoices,
    isSpeaking: function(){ return playing; }
  };
})();
