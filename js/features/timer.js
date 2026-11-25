/* ============================================================
   课堂计时器 / 倒计时
   精准到秒（基于时间戳，不用累加 interval）· 暂停 / 重置 / 全屏
   ============================================================ */
(function(){
  var fab, layer, panel, big;
  var st = {
    mode: 'down',        // down = 倒计时, up = 正计时
    total: 5 * 60,       // 倒计时总秒数
    elapsed: 0,          // 已走秒数
    running: false,
    endAt: 0,
    startAt: 0,
    baseElapsed: 0,
    timer: 0,
    opened: false,
    beeped: false
  };

  function fmt(sec){
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  function remain(){
    if(st.mode === 'up') return st.elapsed;
    return Math.max(0, st.total - st.elapsed);
  }
  function nowElapsed(){
    if(!st.running) return st.elapsed;
    var t = (Date.now() - st.startAt) / 1000;
    return st.baseElapsed + t;
  }
  function syncElapsed(){
    if(st.running) st.elapsed = nowElapsed();
  }

  function build(){
    fab = document.getElementById('timer-fab');
    layer = document.getElementById('timer-layer');
    /* 先藏在顶栏，等真正用过计时器再常驻显示 */
    fab.innerHTML = '<i class="fas fa-stopwatch"></i><span class="tval">--:--</span>';
    layer.innerHTML =
      '<div class="timer-scrim"></div>' +
      '<div class="timer-panel">' +
        '<div class="timer-seg"><button data-mode="down" class="on">倒计时</button><button data-mode="up">正计时</button></div>' +
        '<div class="timer-digits" id="t-digits">05:00</div>' +
        '<div class="timer-sub" id="t-sub">准备开始</div>' +
        '<div class="timer-presets" id="t-presets"></div>' +
        '<div class="timer-actions">' +
          '<button class="t-reset" id="t-reset" title="重置"><i class="fas fa-rotate-left"></i></button>' +
          '<button class="t-start" id="t-start">开始</button>' +
          '<button class="t-full" id="t-full" title="全屏投影"><i class="fas fa-expand"></i></button>' +
        '</div>' +
      '</div>';
    panel = layer.querySelector('.timer-panel');

    // 全屏层
    big = document.createElement('div');
    big.className = 'timer-big';
    big.innerHTML =
      '<div class="big-digits">05:00</div><div class="big-label" id="t-big-label">课堂倒计时</div>' +
      '<div class="big-actions">' +
        '<button data-a="toggle" title="暂停/继续"><i class="fas fa-pause"></i></button>' +
        '<button data-a="reset" title="重置"><i class="fas fa-rotate-left"></i></button>' +
        '<button data-a="close" title="退出全屏"><i class="fas fa-compress"></i></button>' +
      '</div>';
    document.body.appendChild(big);

    fab.onclick = function(e){ e.stopPropagation(); togglePanel(); };
    layer.querySelector('.timer-scrim').onclick = function(){ closePanel(); };
    layer.querySelectorAll('.timer-seg button').forEach(function(b){
      b.onclick = function(){
        if(st.mode === b.dataset.mode) return;
        resetTimer();
        st.mode = b.dataset.mode;
        layer.querySelectorAll('.timer-seg button').forEach(function(x){ x.classList.toggle('on', x === b); });
        renderPresets();
        update();
        savePrefs();
      };
    });
    layer.querySelector('#t-start').onclick = toggleRun;
    layer.querySelector('#t-reset').onclick = function(){ resetTimer(); update(); };
    layer.querySelector('#t-full').onclick = function(){ closePanel(); big.classList.add('on'); };
    big.addEventListener('click', function(e){
      var b = e.target.closest('[data-a]');
      if(!b){ return; }
      var a = b.dataset.a;
      if(a === 'toggle'){ toggleRun(); }
      else if(a === 'reset'){ resetTimer(); update(); }
      else if(a === 'close'){ big.classList.remove('on'); }
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && big.classList.contains('on')){ big.classList.remove('on'); }
    });
    document.addEventListener('click', function(e){
      if(st.opened && !layer.contains(e.target) && !fab.contains(e.target)) closePanel();
    });
    renderPresets();
    update();
  }

  function renderPresets(){
    var wrap = layer.querySelector('#t-presets');
    if(st.mode === 'up'){ wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    var list = [1, 3, 5, 10, 15, 20, 30, 45];
    var html = '';
    list.forEach(function(m){
      html += '<button data-min="' + m + '"' + (st.total === m * 60 ? ' class="on"' : '') + '>' + m + ' 分</button>';
    });
    html += '<button data-min="0">自定义</button>';
    wrap.innerHTML = html;
    wrap.querySelectorAll('button').forEach(function(b){
      b.onclick = function(){
        var m = +b.dataset.min;
        if(m === 0){
          var v = prompt('自定义倒计时（分钟，可填小数，如 2.5）', (st.total / 60).toFixed(0));
          if(v == null) return;
          var n = parseFloat(v);
          if(isNaN(n) || n <= 0 || n > 600){ EN10.toast('请输入 1 - 600 分钟', 'fa-exclamation-triangle'); return; }
          st.total = Math.round(n * 60);
        } else {
          st.total = m * 60;
        }
        st.elapsed = 0; st.running = false; st.beeped = false;
        update(); savePrefs();
      };
    });
  }

  function togglePanel(){
    if(st.opened){ closePanel(); return; }
    st.opened = true;
    fab.classList.remove('hidden');
    layer.classList.add('on');
    update();
  }
  function closePanel(){
    st.opened = false;
    layer.classList.remove('on');
  }

  function toggleRun(){
    fab.classList.remove('hidden');
    if(st.running){
      // 暂停
      st.elapsed = nowElapsed();
      st.running = false;
      st.beeped = false;
    } else {
      if(st.mode === 'down' && st.elapsed >= st.total - 0.001){ st.elapsed = 0; }
      st.baseElapsed = st.elapsed;
      st.startAt = Date.now();
      st.running = true;
    }
    ensureTick();
    update();
  }

  function resetTimer(){
    st.running = false;
    st.elapsed = 0;
    st.baseElapsed = 0;
    st.beeped = false;
    big.classList.remove('done');
    fab.classList.remove('done', 'warn');
    update();
  }

  function ensureTick(){
    if(st.timer) return;
    st.timer = setInterval(function(){
      syncElapsed();
      update();
      // 到点提示音 + 自动停表
      if(st.mode === 'down' && st.running && st.elapsed >= st.total){
        st.running = false;
        st.elapsed = st.total;
        st.baseElapsed = st.total;
        if(!st.beeped){ st.beeped = true; beep(); }
      }
    }, 200);
  }

  function beep(){
    try{
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return;
      var ac = new AC();
      [0, .28, .56].forEach(function(t){
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.22);
        o.connect(g); g.connect(ac.destination);
        o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.24);
      });
      setTimeout(function(){ try{ ac.close(); }catch(e){} }, 1400);
    }catch(e){}
  }

  function update(){
    if(!fab) return;
    var left = remain();
    var txt = fmt(left);
    fab.querySelector('.tval').textContent = txt;
    fab.classList.toggle('warn', st.mode === 'down' && st.running && left <= 60 && left > 0);
    fab.classList.toggle('done', st.mode === 'down' && left <= 0);
    if(panel){
      var d = layer.querySelector('#t-digits');
      d.textContent = txt;
      d.classList.toggle('warn', st.mode === 'down' && left <= 60 && left > 0);
      d.classList.toggle('done', st.mode === 'down' && left <= 0);
      var sub = layer.querySelector('#t-sub');
      if(st.mode === 'down'){
        sub.textContent = left <= 0 ? '时间到 · 点击重置再来一轮'
          : (st.running ? '剩余 ' + fmt(left) + ' · 倒计时进行中'
          : (st.elapsed > 0 ? '已暂停 · 还剩 ' + fmt(left) : '总时长 ' + fmt(st.total)));
      } else {
        sub.textContent = st.running ? '正计时进行中' : (st.elapsed > 0 ? '已暂停' : '从 00:00 开始正向计时');
      }
      var btn = layer.querySelector('#t-start');
      btn.textContent = st.running ? '暂停' : (st.elapsed > 0 ? '继续' : '开始');
      btn.classList.toggle('paused', st.running);
      layer.querySelectorAll('#t-presets button[data-min]').forEach(function(b){
        if(+b.dataset.min === 0) return;
        b.classList.toggle('on', st.total === +b.dataset.min * 60);
      });
    }
    if(big){
      big.querySelector('.big-digits').textContent = txt;
      big.classList.toggle('warn', st.mode === 'down' && left <= 60 && left > 0);
      big.classList.toggle('done', st.mode === 'down' && left <= 0);
      big.querySelector('#t-big-label').textContent = st.mode === 'down'
        ? (left <= 0 ? '时间到' : '课堂倒计时')
        : '课堂计时';
      var tb = big.querySelector('[data-a="toggle"] i');
      if(tb) tb.className = st.running ? 'fas fa-pause' : 'fas fa-play';
    }
    if(st.running) ensureTick();
  }

  function savePrefs(){
    try{ localStorage.setItem('easi_timer_total', String(st.total)); }catch(e){}
  }

  function init(){
    if(window.__EN10TimerInit) return;
    window.__EN10TimerInit = true;
    build();
    var t = parseFloat(localStorage.getItem('easi_timer_total'));
    if(t > 0) st.total = t;
    ensureTick();
    update();
  }

  window.EN10Timer = {
    open: function(){ init(); if(!st.opened){ st.opened = true; layer.classList.add('on'); } update(); },
    start: function(sec){ init(); st.mode = 'down'; st.total = sec || 300; resetTimer(); toggleRun(); },
    fullscreen: function(){ init(); big.classList.add('on'); },
    isRunning: function(){ return st.running; }
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
