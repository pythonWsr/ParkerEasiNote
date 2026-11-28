/* ============================================================
   钢琴：88 键 · 录音 · 回放 · 导出 WAV
   · 音域 A0–C8（MIDI 21–108），横向滚动查看，可一键跳到低/中/高音区
   · 采样读 assets/piano/<音名>.mp3，升号(Cs4)与降号(Db4)两种命名都认
   · 没有采样文件时用 Web Audio 合成，离线、file:// 下也能出声
   · 录音只记「音高 + 起始时间 + 时值 + 力度」，回放与导出的都是同一份时间轴
   ============================================================ */
(function(){
  var S = window.EN10Subjects;
  if(!S) return;

  /* 内部统一用升号命名；采样文件可能是降号（Db4），sampleNames() 会给出两个候选 */
  var NAMES = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B'];
  var FLAT  = { 1:'Db', 3:'Eb', 6:'Gb', 8:'Ab', 10:'Bb' };
  var WHITE = [0,2,4,5,7,9,11];
  var START = 21, END = 108;              /* A0 – C8，标准 88 键 */

  var KEYMAP = {
    'a':60,'w':61,'s':62,'e':63,'d':64,'f':65,'t':66,'g':67,'y':68,'h':69,'u':70,'j':71,
    'k':72,'o':73,'l':74,'p':75,';':76,"'":77
  };

  var ac = null, master = null;
  var buffers = {}, bufOrder = [], sampleLoading = {}, sampleMissing = {};
  var sampleExt = 'mp3', samplesProbed = false, samplesAvailable = false;
  /* 采样用升号还是降号命名：探测一次记下来，之后不再为每个黑键先撞一次 404 */
  var naming = '';
  /* 这批采样录得偏轻（峰值约 0.06），播放时补一个增益；探测到 C4 后按峰值精确算 */
  var sampleGain = 4;
  var BUF_LIMIT = 40;                     /* 同时缓存的采样数（约 12 MB），超了淘汰最久没用的 */
  var volume = 0.8, transpose = 0;
  var live = {};
  var rec = { on:false, t0:0, events:[], playing:false, playNodes:[], timer:0 };
  var ui = {};

  function noteName(midi){
    var i = ((midi % 12) + 12) % 12;
    var oct = Math.floor(midi / 12) - 1;
    return NAMES[i] + oct;
  }
  /* 采样文件名候选：按已探明的命名风格把正确的放前面，另一种兜底 */
  function sampleNames(midi){
    var i = ((midi % 12) + 12) % 12;
    var oct = Math.floor(midi / 12) - 1;
    var sharp = NAMES[i] + oct;
    var flat = FLAT[i] ? (FLAT[i] + oct) : '';
    if(!flat) return [sharp];
    return naming === 'flat' ? [flat, sharp] : [sharp, flat];
  }
  function freqOf(midi){ return 440 * Math.pow(2, (midi - 69) / 12); }
  function nowMs(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function fmt(sec){
    sec = Math.max(0, sec);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------------- 音频引擎 ---------------- */
  function audio(){
    if(ac){
      if(ac.state === 'suspended'){ try{ ac.resume(); }catch(e){} }
      return ac;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = volume;
    master.connect(ac.destination);
    return ac;
  }

  /* 采样统一处理：混成单声道、最多 1.8 秒、尾部淡出。
     88 个 2.4 秒立体声采样全留着要 70 MB 以上，手机直接崩；
     截短 + 单声道后单音约 300 KB，缓存 26 个也只有 8 MB 左右。 */
  function normalizeBuf(buf){
    if(!buf) return null;
    var sr = buf.sampleRate;
    var len = Math.min(buf.length, Math.floor(sr * 1.8));
    var out = ac.createBuffer(1, len, sr);
    var dst = out.getChannelData(0);
    try{
      if(buf.numberOfChannels > 1){
        var l = buf.getChannelData(0), r = buf.getChannelData(1);
        for(var i = 0; i < len; i++) dst[i] = (l[i] + r[i]) * 0.5;
      } else {
        dst.set(buf.getChannelData(0).subarray(0, len));
      }
    }catch(e){ return buf; }
    var fade = Math.min(Math.floor(sr * 0.12), len);
    for(var i = 0; i < fade; i++) dst[len - 1 - i] *= i / fade;
    return out;
  }
  function peakOf(buf){
    try{
      var d = buf.getChannelData(0), peak = 0;
      for(var i = 0; i < d.length; i += 8){ var a = Math.abs(d[i]); if(a > peak) peak = a; }
      return peak;
    }catch(e){ return 0; }
  }
  function remember(name){
    bufOrder.push(name);
    while(bufOrder.length > BUF_LIMIT){
      var old = bufOrder.shift();
      if(old && old !== name) delete buffers[old];
    }
  }
  function playableBuffer(midi){
    var b = buffers[midi + transpose];
    if(b){
      var idx = bufOrder.indexOf(midi + transpose);
      if(idx >= 0 && idx < bufOrder.length - 1){
        bufOrder.splice(idx, 1);
        bufOrder.push(midi + transpose);
      }
      return b;
    }
    /* 没有精确采样就借邻近的：音相差 1 半音内用 playbackRate 补正，
       比整段退回合成音自然得多（88 键齐了用不到，只防中途缺文件） */
    var t = midi + transpose;
    var cands = [{ m:t - 1, r:Math.pow(2, 1 / 12) }, { m:t + 1, r:Math.pow(2, -1 / 12) }];
    for(var i = 0; i < cands.length; i++){
      var cb = buffers[cands[i].m];
      if(cb) return { buf:cb, rate:cands[i].r };
    }
    return null;
  }

  /* 合成音：三角波 + 两个泛音，过一个低通，接近电钢琴 */
  function synthInto(ctx, dest, midi, when, dur, vel){
    var f = freqOf(midi + transpose);
    var g = ctx.createGain();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(7200, f * 9);
    lp.Q.value = 0.6;
    g.connect(lp); lp.connect(dest);
    var parts = [
      { type:'triangle', mul:1, gain:0.62, det:0 },
      { type:'sine',     mul:2, gain:0.18, det:3 },
      { type:'sine',     mul:3.01, gain:0.07, det:-4 }
    ];
    var oscs = [];
    parts.forEach(function(p){
      var o = ctx.createOscillator(), og = ctx.createGain();
      o.type = p.type;
      o.frequency.value = f * p.mul;
      if(o.detune) o.detune.value = p.det;
      og.gain.value = p.gain;
      o.connect(og); og.connect(g);
      oscs.push(o);
    });
    var end = when + Math.max(0.18, dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.02, vel * 0.85), when + 0.007);
    g.gain.exponentialRampToValueAtTime(Math.max(0.015, vel * 0.26), when + 0.24);
    g.gain.setValueAtTime(Math.max(0.015, vel * 0.26), when + Math.max(0.26, dur * 0.78));
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.28);
    oscs.forEach(function(o){ o.start(when); o.stop(end + 0.34); });
    return { stop:function(t){ try{ g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, 0.05); }catch(e){} } };
  }

  function scheduleNote(ctx, dest, midi, when, dur, vel){
    var got = playableBuffer(midi);
    var buf = got ? (got.buf || got) : null;
    if(buf){
      var rate = got && got.rate ? got.rate : 1;
      var src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf;
      if(src.playbackRate) src.playbackRate.value = rate;
      src.connect(g); g.connect(dest);
      /* 采样本身录得轻（这批峰值只有 0.06），增益要能大于 1，否则导出出来几乎听不见 */
      var amp = Math.max(0.02, Math.min(30, vel * sampleGain));
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(0.02, amp), when + 0.006);
      g.gain.setValueAtTime(Math.max(0.02, amp), when + Math.max(0.02, dur - 0.08));
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.25);
      src.start(when);
      src.stop(when + dur + 0.32);
      return src;
    }
    return synthInto(ctx, dest, midi, when, dur, vel);
  }

  /* ---------------- 采样：有就用，没有就合成 ---------------- */
  function decodeInto(ab){
    return new Promise(function(resolve){
      if(!ac){ resolve(null); return; }
      try{
        ac.decodeAudioData(ab, function(b){ resolve(normalizeBuf(b)); }, function(){ resolve(null); });
      }catch(e){ resolve(null); }
    });
  }
  function finishLoad(key, buf){
    sampleLoading[key] = false;
    if(buf && buf.length){
      buffers[key] = buf;
      remember(key);
    } else {
      sampleMissing[key] = true;
    }
  }
  function tryName(key, names, i){
    if(i >= names.length){ finishLoad(key, null); return; }
    fetch('assets/piano/' + names[i] + '.' + sampleExt)
      .then(function(r){ if(!r.ok) throw new Error('404'); return r.arrayBuffer(); })
      .then(function(ab){ return decodeInto(ab); })
      .then(function(b){ if(b) finishLoad(key, b); else tryName(key, names, i + 1); })
      .catch(function(){ tryName(key, names, i + 1); });
  }
  function loadSample(midi){
    if(!samplesAvailable || !ac) return;
    var key = midi + transpose;
    if(key < START - 12 || key > END + 12) return;
    if(buffers[key] || sampleLoading[key] || sampleMissing[key]) return;
    sampleLoading[key] = true;
    tryName(key, sampleNames(key), 0);
  }
  /* 空闲时从 C4 向两侧铺开预加载，覆盖 C3–C6（最常弹的三个八度）。
     两端不预加载：真弹到时按需取，避免把缓存挤掉常用的音。 */
  var prefetchQueue = [], prefetching = false;
  var PRE_LOW = 48, PRE_HIGH = 84;
  function queuePrefetch(){
    prefetchQueue = [];
    for(var d = 0; d <= 40; d++){
      if(60 + d <= PRE_HIGH) prefetchQueue.push(60 + d);
      if(d && 60 - d >= PRE_LOW) prefetchQueue.push(60 - d);
    }
    pumpPrefetch();
  }
  function pumpPrefetch(){
    if(prefetching) return;
    prefetching = true;
    (function step(){
      if(!samplesAvailable || !ac || !prefetchQueue.length){ prefetching = false; return; }
      var m = prefetchQueue.shift();
      loadSample(m);
      setTimeout(step, 55);
    })();
  }
  /* 只探测一次：先看 C4，再退到 A4 / C5，避免目录换了命名就整体失效 */
  function probeSamples(){
    if(samplesProbed) return;
    samplesProbed = true;
    /* file:// 下浏览器不允许 fetch 本地音频（CORS），探测只会白刷 404，直接按合成音处理 */
    if(location.protocol === 'file:'){ samplesAvailable = false; return; }
    var exts = ['mp3', 'ogg', 'wav', 'm4a'];
    (function tryExt(i){
      if(i >= exts.length || !ac) return;
      fetch('assets/piano/C4.' + exts[i])
        .then(function(r){ if(!r.ok) throw new Error('404'); return r.arrayBuffer(); })
        .then(function(ab){
          sampleExt = exts[i];
          samplesAvailable = true;
          return decodeInto(ab);
        })
        .then(function(b){
          if(!b){ tryExt(i + 1); return; }
          var pk = peakOf(b);
          /* 按 C4 的峰值把整批采样补到接近满刻度；上限 20 倍，防脏文件炸音 */
          sampleGain = pk > 0.002 ? Math.max(1, Math.min(20, 0.8 / pk)) : 4;
          buffers[60] = b;
          remember(60);
          detectNaming();
          queuePrefetch();
          if(ui.src) ui.src.textContent = '采样音色（' + sampleExt.toUpperCase() + ' · 88 键）';
        })
        .catch(function(){ tryExt(i + 1); });
    })(0);
  }

  /* 用 C#4 探一次命名风格：先试 Cs4，再试 Db4。只多发一到两个请求，
     之后 35 个黑键就都能一次命中，不会每个都先 404 再回退。 */
  function detectNaming(){
    if(naming) return;
    fetch('assets/piano/Cs4.' + sampleExt)
      .then(function(r){ if(!r.ok) throw new Error('404'); naming = 'sharp'; })
      .catch(function(){
        fetch('assets/piano/Db4.' + sampleExt)
          .then(function(r){ if(!r.ok) throw new Error('404'); naming = 'flat'; })
          .catch(function(){ naming = 'sharp'; });
      });
  }

  /* ---------------- 现场弹奏 ---------------- */
  function noteOn(midi, vel){
    var ctx = audio();
    if(!ctx) return;
    if(live[midi]) noteOff(midi);
    var t = ctx.currentTime;
    var got = playableBuffer(midi);
    var node = null;
    if(got){
      var buf = got.buf || got;
      var rate = got.rate || 1;
      var src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf;
      if(src.playbackRate) src.playbackRate.value = rate;
      src.connect(g); g.connect(master);
      var amp = Math.max(0.03, Math.min(30, vel * sampleGain));
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.03, amp), t + 0.006);
      src.start(t);
      node = { src:src, gain:g, release:function(){
        var n = ctx.currentTime;
        try{ g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0.0001, n, 0.10); }catch(e){}
        try{ src.stop(n + 0.55); }catch(e){}
      }};
    } else {
      var f = freqOf(midi + transpose);
      var gain = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = Math.min(7200, f * 9); lp.Q.value = 0.6;
      gain.connect(lp); lp.connect(master);
      var parts = [
        { type:'triangle', mul:1, gain:0.62, det:0 },
        { type:'sine',     mul:2, gain:0.18, det:3 },
        { type:'sine',     mul:3.01, gain:0.07, det:-4 }
      ];
      var oscs = parts.map(function(p){
        var o = ctx.createOscillator(), og = ctx.createGain();
        o.type = p.type; o.frequency.value = f * p.mul;
        if(o.detune) o.detune.value = p.det;
        og.gain.value = p.gain;
        o.connect(og); og.connect(gain);
        o.start(t);
        return o;
      });
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.03, vel * 0.9), t + 0.007);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.02, vel * 0.28), t + 0.25);
      node = { oscs:oscs, gain:gain, release:function(){
        var n = ctx.currentTime;
        try{ gain.gain.cancelScheduledValues(n); gain.gain.setTargetAtTime(0.0001, n, 0.09); }catch(e){}
        oscs.forEach(function(o){ try{ o.stop(n + 0.5); }catch(e){} });
      }};
    }
    node.startedAt = nowMs();
    node.vel = vel;
    live[midi] = node;
    /* 弹到哪个键就顺手把它的采样拉下来，下次就是采样音 */
    loadSample(midi);
    highlight(midi, true);
  }
  function noteOff(midi){
    var node = live[midi];
    if(!node) return;
    delete live[midi];
    try{ node.release(); }catch(e){}
    if(rec.on){
      var dur = Math.max(0.06, (nowMs() - node.startedAt) / 1000);
      rec.events.push({ n:midi, t:(node.startedAt - rec.t0) / 1000, d:dur, v:node.vel || 0.8 });
      updateStatus();
    }
    highlight(midi, false);
  }
  function highlight(midi, on){
    var el = ui.keys && ui.keys.querySelector('.pn-key[data-m="' + midi + '"]');
    if(el){
      el.classList.toggle('down', on);
      if(on) keepVisible(el);
    }
  }
  /* 弹到视野外的键时把它带进来，不整页乱跳 */
  function keepVisible(el){
    var host = ui.keys;
    if(!host || !host.scrollWidth) return;
    var left = el.offsetLeft, right = left + el.offsetWidth;
    var viewL = host.scrollLeft, viewR = viewL + host.clientWidth;
    if(left < viewL) host.scrollLeft = left - 8;
    else if(right > viewR) host.scrollLeft = right - host.clientWidth + 8;
  }
  function releaseAll(){
    Object.keys(live).forEach(function(k){ noteOff(+k); });
  }

  /* ---------------- 录音 / 回放 / 导出 ---------------- */
  function startRec(){
    if(!audio()){ EN10.toast('当前浏览器不支持 Web Audio，无法录音', 'fa-exclamation-triangle'); return; }
    releaseAll();
    rec.events = [];
    rec.t0 = nowMs();
    rec.on = true;
    if(rec.timer) clearInterval(rec.timer);
    rec.timer = setInterval(updateStatus, 250);
    updateStatus();
    EN10.toast('开始录音，弹完点「停止」', 'fa-circle-dot');
  }
  function stopRec(){
    if(!rec.on) return;
    rec.on = false;
    releaseAll();
    if(rec.timer){ clearInterval(rec.timer); rec.timer = 0; }
    if(!rec.events.length){ EN10.toast('这一段没有录到音符', 'fa-microphone-slash'); }
    updateStatus();
  }
  function stopPlay(){
    rec.playNodes.forEach(function(n){ try{ if(n.stop) n.stop(); }catch(e){} });
    rec.playNodes = [];
    rec.playing = false;
    if(rec.timer){ clearInterval(rec.timer); rec.timer = 0; }
    updateStatus();
  }
  function playRec(){
    if(!rec.events.length){ EN10.toast('先录一段再回放', 'fa-microphone'); return; }
    var ctx = audio();
    if(!ctx) return;
    stopPlay();
    var t0 = ctx.currentTime + 0.12;
    rec.events.slice().sort(function(a, b){ return a.t - b.t; }).forEach(function(e){
      rec.playNodes.push(scheduleNote(ctx, master, e.n, t0 + e.t, Math.max(0.12, e.d), e.v || 0.8));
    });
    rec.playing = true;
    var dur = Math.max.apply(null, rec.events.map(function(e){ return e.t + e.d; }));
    rec.playStart = nowMs();
    rec.playDur = dur;
    if(rec.timer) clearInterval(rec.timer);
    rec.timer = setInterval(function(){
      updateStatus();
      if(!rec.playing) return;
      if((nowMs() - rec.playStart) / 1000 > dur + 0.6) stopPlay();
    }, 200);
    updateStatus();
  }

  function wavBlob(buffer){
    var ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
    var bytes = 44 + len * ch * 2;
    var ab = new ArrayBuffer(bytes), v = new DataView(ab);
    function str(off, s){ for(var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, len * ch * 2, true);
    var data = [];
    for(var c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
    var off = 44;
    for(var i = 0; i < len; i++){
      for(var c2 = 0; c2 < ch; c2++){
        var s = Math.max(-1, Math.min(1, data[c2][i]));
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
    return new Blob([ab], { type:'audio/wav' });
  }

  function exportWav(){
    if(!rec.events.length){ EN10.toast('先录一段再导出', 'fa-microphone'); return; }
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if(!OAC){ EN10.toast('当前浏览器不支持离线导出', 'fa-exclamation-triangle'); return; }
    var dur = Math.max.apply(null, rec.events.map(function(e){ return e.t + e.d; })) + 1.6;
    var oac = new OAC(2, Math.ceil(44100 * dur), 44100);
    var out = oac.createGain();
    out.gain.value = volume;
    out.connect(oac.destination);
    rec.events.forEach(function(e){
      scheduleNote(oac, out, e.n, Math.max(0.02, e.t), Math.max(0.12, e.d), e.v || 0.8);
    });
    EN10.toast('正在生成 WAV…', 'fa-spinner');
    oac.startRendering().then(function(buf){
      var blob = wavBlob(buf);
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      var pad = function(n){ return n < 10 ? '0' + n : n; };
      a.href = url;
      a.download = 'piano-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
        pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.wav';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} }, 4000);
      EN10.toast('WAV 已导出', 'fa-download');
    }).catch(function(err){
      EN10.toast('导出失败：' + (err.message || err), 'fa-exclamation-triangle');
    });
  }

  /* ---------------- 界面 ---------------- */
  function updateStatus(){
    if(!ui.status) return;
    if(rec.on){
      ui.status.textContent = '录音中 ' + fmt((nowMs() - rec.t0) / 1000) + ' · 已录 ' + rec.events.length + ' 个音';
      ui.status.className = 'pn-status rec';
    } else if(rec.playing){
      ui.status.textContent = '回放中 ' + fmt((nowMs() - rec.playStart) / 1000) + ' / ' + fmt(rec.playDur);
      ui.status.className = 'pn-status play';
    } else if(rec.events.length){
      var total = Math.max.apply(null, rec.events.map(function(e){ return e.t + e.d; }));
      ui.status.textContent = '已录 ' + rec.events.length + ' 个音 · ' + fmt(total);
      ui.status.className = 'pn-status';
    } else {
      ui.status.textContent = '就绪 · 直接弹，或点「录音」记录一段';
      ui.status.className = 'pn-status';
    }
    if(ui.rec) ui.rec.classList.toggle('on', rec.on);
    if(ui.play) ui.play.classList.toggle('on', rec.playing);
    if(ui.rec) ui.rec.innerHTML = rec.on ? '<i class="fas fa-stop"></i> 停止' : '<i class="fas fa-circle"></i> 录音';
    if(ui.play) ui.play.innerHTML = rec.playing ? '<i class="fas fa-stop"></i> 停止' : '<i class="fas fa-play"></i> 回放';
  }

  function whiteKeyWidth(host){
    /* 以「一屏放下 14 个白键（两个八度）」为舒适档，再夹到 18–44 px：
       桌面偏宽、手机偏窄，超出的部分靠横向滚动 */
    var w = Math.floor(((host.clientWidth || 720) - 8) / 14);
    return Math.max(18, Math.min(44, w));
  }

  function buildKeys(host){
    var whites = [], blacks = [];
    for(var m = START; m <= END; m++){
      if(WHITE.indexOf(((m % 12) + 12) % 12) >= 0) whites.push(m); else blacks.push(m);
    }
    var wk = whiteKeyWidth(host);
    var bw = Math.max(10, Math.round(wk * 0.62));
    var total = whites.length * wk;
    var html = '';
    whites.forEach(function(m, i){
      html += '<button class="pn-key white" data-m="' + m + '" style="left:' + (i * wk) + 'px;width:' + wk + 'px">' +
        (m % 12 === 0 ? '<em>' + noteName(m) + '</em>' : '') + '</button>';
    });
    blacks.forEach(function(m){
      var before = 0;
      for(var k = 0; k < whites.length; k++) if(whites[k] < m) before++;
      html += '<button class="pn-key black" data-m="' + m + '" style="left:' + (before * wk - bw / 2) + 'px;width:' + bw + 'px"></button>';
    });
    host.innerHTML = '<div class="pn-keys-in" style="width:' + total + 'px">' + html + '</div>';
    ui.wk = wk;
    ui.whites = whites;

    host.querySelectorAll('.pn-key').forEach(function(el){
      var midi = +el.dataset.m;
      el.addEventListener('pointerdown', function(e){
        e.preventDefault();
        try{ el.setPointerCapture(e.pointerId); }catch(err){}
        noteOn(midi, 0.86);
      });
      function up(e){
        noteOff(midi);
        try{ el.releasePointerCapture(e.pointerId); }catch(err){}
      }
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', function(e){ if(e.buttons) noteOff(midi); });
    });

    /* 打开时把 C4 摆在中间：88 键一屏放不下，默认落在最常弹的位置 */
    setTimeout(function(){ scrollToNote(60, false); }, 30);
  }

  function scrollToNote(midi, smooth){
    var host = ui.keys;
    if(!host || !ui.wk || !ui.whites) return;
    var i = ui.whites.indexOf(midi);
    if(i < 0) return;
    var left = Math.max(0, i * ui.wk - (host.clientWidth - ui.wk) / 2);
    try{
      if(smooth && host.scrollTo) host.scrollTo({ left:left, behavior:'smooth' });
      else host.scrollLeft = left;
    }catch(e){ host.scrollLeft = left; }
  }

  function open(){
    var body =
      '<div class="pn-wrap">' +
        '<div class="pn-bar">' +
          '<button class="pn-btn primary" id="pn-rec"><i class="fas fa-circle"></i> 录音</button>' +
          '<button class="pn-btn" id="pn-play"><i class="fas fa-play"></i> 回放</button>' +
          '<button class="pn-btn" id="pn-export"><i class="fas fa-download"></i> 导出 WAV</button>' +
          '<button class="pn-btn ghost" id="pn-clear" title="清空录音"><i class="fas fa-trash-alt"></i></button>' +
          '<span class="pn-status" id="pn-status">就绪</span>' +
        '</div>' +
        '<div class="pn-range">' +
          '<button class="chip" data-r="low">低音 A0–B2</button>' +
          '<button class="chip on" data-r="mid">中音 C3–B5</button>' +
          '<button class="chip" data-r="high">高音 C6–C8</button>' +
          '<span class="pn-range-tip">左右滑动看全部 88 键</span>' +
        '</div>' +
        '<div class="pn-keys" id="pn-keys"></div>' +
        '<div class="pn-hint">电脑键盘：<b>A S D F G H J K L ; \'</b> 白键　<b>W E T Y U O P</b> 黑键（C4 起）</div>' +
      '</div>';

    S._open({
      title:'钢琴',
      sub:'88 键 · 弹奏 · 录音 · 回放 · 导出',
      icon:'piano',
      body: body,
      side:
        '<div class="side-block"><div class="side-title">音量</div>' +
          '<input type="range" class="set-range" id="pn-vol" min="0" max="100" value="80" style="width:100%">' +
          '<div class="pn-tip" id="pn-vol-v">80%</div></div>' +
        '<div class="side-block"><div class="side-title">移调</div>' +
          '<div class="chips"><button class="chip" id="pn-tdown">- 12</button>' +
          '<button class="chip" id="pn-tup">+ 12</button></div>' +
          '<div class="pn-tip" id="pn-tr-v">原调</div></div>' +
        '<div class="side-block"><div class="side-title">音色</div>' +
          '<div class="pn-tip" id="pn-src">正在检测钢琴采样…</div></div>' +
        '<div class="side-block" style="font-size:11.5px;line-height:1.8;color:#8B97A2">' +
          '采样放在 <b>assets/piano/</b>，按 <b>C4</b>、<b>Db4</b>（降号）或 <b>Cs4</b>（升号）命名都能识别；缺哪个音就自动退回合成音。' +
        '</div>',
      hint:'录音只保存在当前页面里；导出的是标准 WAV 文件，可以直接交给学生或放进课件。',
      onMount:function(api){
        api.pane.classList.add('fit');
        ui.keys = api.pane.querySelector('#pn-keys');
        ui.status = api.pane.querySelector('#pn-status');
        ui.rec = api.pane.querySelector('#pn-rec');
        ui.play = api.pane.querySelector('#pn-play');
        ui.src = api.side.querySelector('#pn-src');
        buildKeys(ui.keys);

        ui.rec.onclick = function(){ rec.on ? stopRec() : startRec(); };
        ui.play.onclick = function(){ rec.playing ? stopPlay() : playRec(); };
        api.pane.querySelector('#pn-export').onclick = exportWav;
        api.pane.querySelector('#pn-clear').onclick = function(){
          stopPlay();
          rec.events = [];
          updateStatus();
          EN10.toast('录音已清空', 'fa-trash-alt');
        };

        /* 音域快捷跳转 */
        api.pane.querySelectorAll('.pn-range .chip').forEach(function(b){
          b.onclick = function(){
            api.pane.querySelectorAll('.pn-range .chip').forEach(function(x){ x.classList.remove('on'); });
            b.classList.add('on');
            var r = b.dataset.r;
            var target = r === 'low' ? 33 : (r === 'high' ? 93 : 48);
            scrollToNote(target, true);
          };
        });
        /* 滚轮横向翻键区：鼠标用户没有左右滑，给个顺手的入口 */
        ui.keys.addEventListener('wheel', function(e){
          if(Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
          e.preventDefault();
          ui.keys.scrollLeft += e.deltaY;
        }, { passive:false });

        var vol = api.side.querySelector('#pn-vol');
        vol.oninput = function(){
          volume = (+vol.value || 0) / 100;
          if(master){ try{ master.gain.value = volume; }catch(e){} }
          api.side.querySelector('#pn-vol-v').textContent = vol.value + '%';
        };
        api.side.querySelector('#pn-tdown').onclick = function(){
          transpose = Math.max(-12, transpose - 12);
          api.side.querySelector('#pn-tr-v').textContent = transpose === 0 ? '原调' : (transpose > 0 ? '+' : '') + transpose + ' 半音';
        };
        api.side.querySelector('#pn-tup').onclick = function(){
          transpose = Math.min(12, transpose + 12);
          api.side.querySelector('#pn-tr-v').textContent = transpose === 0 ? '原调' : (transpose > 0 ? '+' : '') + transpose + ' 半音';
        };

        /* 电脑键盘：记录按下时的实际音高，移调中途变化也不会卡住音符 */
        var kbHeld = {};
        function down(e){
          if(!document.body.contains(ui.keys)){ document.removeEventListener('keydown', down); return; }
          var tag = (document.activeElement && document.activeElement.tagName) || '';
          if(/INPUT|TEXTAREA|SELECT/.test(tag) || document.activeElement.isContentEditable) return;
          var k = String(e.key || '').toLowerCase();
          var m = KEYMAP[k];
          if(m == null) return;
          e.preventDefault();
          if(kbHeld[k] != null) return;
          var midi = m + transpose;
          kbHeld[k] = midi;
          noteOn(midi, 0.86);
        }
        function up(e){
          var k = String(e.key || '').toLowerCase();
          if(kbHeld[k] == null) return;
          noteOff(kbHeld[k]);
          delete kbHeld[k];
        }
        document.addEventListener('keydown', down);
        document.addEventListener('keyup', up);

        audio();
        probeSamples();
        var tries = 0;
        var wait = setInterval(function(){
          if(samplesAvailable){ clearInterval(wait); return; }
          if(samplesProbed && tries++ > 3){
            clearInterval(wait);
            if(ui.src) ui.src.textContent = '合成音色（未找到 assets/piano 采样）';
          }
        }, 500);
        updateStatus();
      },
      onClose:function(){
        stopPlay();
        if(rec.on) stopRec();
        releaseAll();
        if(rec.timer){ clearInterval(rec.timer); rec.timer = 0; }
        prefetchQueue = [];
      }
    });
  }

  window.EN10Piano = {
    open: open,
    /* 供调试/二次开发：直接看当前用的是采样还是合成 */
    state: function(){
      return { samplesAvailable:samplesAvailable, ext:sampleExt, cached:Object.keys(buffers).length, gain:sampleGain };
    }
  };
})();
