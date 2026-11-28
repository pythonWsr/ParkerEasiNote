/* ============================================================
   视频展台：画面可缩放、可平移，墨迹固定在屏幕上
   · 工具并入底部工具栏（移动 / 缩放 / 复位 / 拍照 / 切换摄像头）
   · 拍照 = 当前画面 + 当前批注 → 新建一页 → 整幅插入 → 自动退出展台
   · 双指缩放不依赖「移动」模式，随时可用；比例走幂曲线，大屏不会一捏就飞
   ============================================================ */
(function(){
  var tools, built = false;
  var moving = false;
  var ptrs = new Map();
  var drag = null, pinch = null;

  /* 缩放曲线指数。1 = 线性（手指距离翻倍 → 画面翻倍）；
     0.8 更接近系统相册的手感，大屏上两指本来就张得开，线性会显得「一碰就到底」 */
  var PINCH_GAMMA = 0.8;
  var ZOOM_MIN = 1, ZOOM_MAX = 6;
  var PINCH_START_DIST = 36;   /* 两指太近不接管：分母过小，轻微抖动就是几倍 */

  function v(){ return EN10.S.camView || (EN10.S.camView = { x:0, y:0, s:1 }); }
  var rafId = 0;
  function apply(){
    EN10.applyCamView();
    updateLabel();
  }
  function applySoon(){
    if(rafId) return;
    rafId = requestAnimationFrame(function(){ rafId = 0; apply(); });
  }
  function clampView(){
    if(v().s < ZOOM_MIN) v().s = ZOOM_MIN;
    if(v().s > ZOOM_MAX) v().s = ZOOM_MAX;
    /* 缩放后画面至少要盖住视口：允许的位移 = 超出部分的一半 */
    var maxX = window.innerWidth * ((v().s - 1) / 2 + 0.5);
    var maxY = window.innerHeight * ((v().s - 1) / 2 + 0.5);
    v().x = Math.max(-maxX, Math.min(maxX, v().x));
    v().y = Math.max(-maxY, Math.min(maxY, v().y));
  }
  /* 画面是 inset:0 铺满视口的元素，transform-origin 在 50% 50%，
     所以 x/y 是「相对视口中心」的偏移。要让屏幕点 (cx,cy) 在缩放前后不动：
       (cx-C) - ((cx-C) - x0) * ratio
     少减这个 C，以屏幕中心缩放时画面会整体甩向左上——大屏上看着就是忽大忽小。 */
  function originShift(cx, cy){
    return { x: cx - window.innerWidth / 2, y: cy - window.innerHeight / 2 };
  }
  function zoomAt(cx, cy, factor){
    var old = v().s;
    var s = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, old * factor));
    if(s === old) return;
    var o = originShift(cx, cy);
    v().x = o.x - (o.x - v().x) * (s / old);
    v().y = o.y - (o.y - v().y) * (s / old);
    v().s = s;
    clampView(); apply();
  }
  function reset(){ EN10.resetCamView(); apply(); }

  function updateLabel(){
    if(!tools) return;
    var el = tools.querySelector('.cam-zoom');
    if(el) el.textContent = Math.round(v().s * 100) + '%';
  }

  function setMoving(on){
    moving = on;
    document.body.classList.toggle('cam-moving', moving);
    var b = tools && tools.querySelector('[data-a="move"]');
    if(b) b.classList.toggle('on', moving);
  }

  function twoPointers(){
    var arr = [];
    ptrs.forEach(function(p){ if(arr.length < 2) arr.push(p); });
    return arr;
  }
  function distOf(a){
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  }

  function startPinch(){
    var a = twoPointers();
    if(a.length < 2) return;
    var d = distOf(a);
    if(d < PINCH_START_DIST){ pinch = null; return; }
    pinch = {
      d0: d,
      s0: v().s,
      x0: v().x,
      y0: v().y,
      cx: (a[0].x + a[1].x) / 2,
      cy: (a[0].y + a[1].y) / 2
    };
    drag = null;
    /* 捏合期间关掉 CSS 过渡：0.18s 的缓动会让画面永远落后手指，看着就是忽大忽小 */
    document.body.classList.add('cam-pinching');
    /* 第一根手指落下时可能已经起了一笔（还没提交），这里直接丢掉，
       否则双指缩放会在照片边上留一个小墨点 */
    if(EN10.cancelInk) EN10.cancelInk();
  }

  function movePinch(){
    var a = twoPointers();
    if(!pinch || a.length < 2) return;
    var d = distOf(a);
    if(d < 8) return;
    var s = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.s0 * Math.pow(d / pinch.d0, PINCH_GAMMA)));
    var mx = (a[0].x + a[1].x) / 2;
    var my = (a[0].y + a[1].y) / 2;
    /* 绝对映射：始终以「手势开始时的距离 / 视图」为基准，不在每帧累积增量。
       捏多久都不漂；两指整体平移时中点跟着走，画面就跟着手走。 */
    var ratio = s / pinch.s0;
    var mo = originShift(mx, my);
    var co = { x: pinch.cx - window.innerWidth / 2, y: pinch.cy - window.innerHeight / 2 };
    v().s = s;
    v().x = mo.x - (co.x - pinch.x0) * ratio;
    v().y = mo.y - (co.y - pinch.y0) * ratio;
    clampView();
    applySoon();
  }

  /* 当前画面 + 批注 → 新白板页 */
  function snapshotToBoard(){
    var S = EN10.S;
    if(S.mode !== 'camera'){ EN10.toast('先打开视频展台再拍照', 'fa-camera'); return; }
    var media = S.cameraFrozen && S.cameraFreezeSrc ? ('img') : ('video');
    var el = document.querySelector('#vp-media video') || document.querySelector('#vp-media img');
    if(!el){ EN10.toast('画面还没准备好，稍等一下再拍', 'fa-hourglass-half'); return; }
    if(media === 'video' && (!el.videoWidth || el.readyState < 2)){
      EN10.toast('画面还没准备好，稍等一下再拍', 'fa-hourglass-half');
      return;
    }
    var CW = EN10.CW || window.innerWidth;
    var CH = EN10.CH || window.innerHeight;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cv = document.createElement('canvas');
    cv.width = Math.round(CW * dpr);
    cv.height = Math.round(CH * dpr);
    var c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.fillStyle = '#000';
    c.fillRect(0, 0, CW, CH);

    var sw = media === 'video' ? el.videoWidth : (el.naturalWidth || el.width);
    var sh = media === 'video' ? el.videoHeight : (el.naturalHeight || el.height);
    if(!sw || !sh){ EN10.toast('画面还没准备好，稍等一下再拍', 'fa-hourglass-half'); return; }
    /* 与 CSS 的 object-fit:contain 一致：等比放进取景框，多出来的部分留黑边 */
    var sc = Math.min(CW / sw, CH / sh);
    var dw = sw * sc, dh = sh * sc;
    c.save();
    c.translate(CW / 2 + v().x, CH / 2 + v().y);
    c.scale(v().s, v().s);
    try{ c.drawImage(el, -dw / 2, -dh / 2, dw, dh); }
    catch(err){ c.restore(); EN10.toast('拍照失败，请重试', 'fa-exclamation-triangle'); return; }
    c.restore();
    /* 批注层是透明 canvas，直接叠上去，所见即所得 */
    try{ c.drawImage(EN10.D.canvas, 0, 0, CW, CH); }catch(e){}

    var url = cv.toDataURL('image/png');
    setMoving(false);
    EN10.addPage();                                  /* 新开一页，不覆盖已有板书 */
    EN10.insertImage(url, CW, CH, { exact:true, silent:true, x:0, y:0 });
    EN10.stopCamera(true);                           /* 自动关闭展台，回到白板（提示由下一行统一给） */
    EN10.toast('照片已插入新的一页，可以直接批注', 'fa-check');
  }

  function switchCamera(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices){
      EN10.toast('当前环境不支持切换摄像头', 'fa-exclamation-triangle');
      return;
    }
    navigator.mediaDevices.enumerateDevices().then(function(list){
      var cams = list.filter(function(d){ return d.kind === 'videoinput'; });
      if(cams.length < 2){
        EN10.toast('只检测到一个摄像头', 'fa-camera');
        return;
      }
      var S = EN10.S;
      var cur = S.cameraDeviceId || '';
      var idx = -1;
      cams.forEach(function(d, i){ if(d.deviceId === cur) idx = i; });
      var next = cams[(idx + 1) % cams.length];
      return navigator.mediaDevices.getUserMedia({ video:{ deviceId:{ exact:next.deviceId } }, audio:false })
        .then(function(stream){
          if(S.cameraStream) S.cameraStream.getTracks().forEach(function(t){ t.stop(); });
          S.cameraStream = stream;
          S.cameraDeviceId = next.deviceId;
          S.cameraFrozen = false;
          S.cameraFreezeSrc = '';
          if(S.mode === 'camera'){ EN10.resetCamView(); EN10.updateBg(); }
          EN10.toast('已切换摄像头' + (next.label ? '：' + next.label : ''), 'fa-camera-rotate');
        });
    }).catch(function(err){
      EN10.toast('切换摄像头失败：' + (err.message || err.name), 'fa-exclamation-triangle');
    });
  }

  function build(){
    if(built) return;
    built = true;
    var bar = document.getElementById('bottom-toolbar');
    if(!bar) return;
    tools = document.createElement('div');
    tools.id = 'cam-tools';
    tools.innerHTML =
      '<button class="cam-btn" data-a="move" title="手势移动画面（板书不动）"><i class="fas fa-hand-paper"></i><span>移动</span></button>' +
      '<button class="cam-btn" data-a="out" title="缩小"><i class="fas fa-minus"></i><span>缩小</span></button>' +
      '<span class="cam-zoom">100%</span>' +
      '<button class="cam-btn" data-a="in" title="放大"><i class="fas fa-plus"></i><span>放大</span></button>' +
      '<button class="cam-btn" data-a="reset" title="复位画面"><i class="fas fa-arrows-rotate"></i><span>复位</span></button>' +
      '<button class="cam-btn" data-a="shot" title="拍照并插入新页"><i class="fas fa-camera-retro"></i><span>拍照</span></button>' +
      '<button class="cam-btn" data-a="switch" title="切换摄像头"><i class="fas fa-camera-rotate"></i><span>切换</span></button>';
    bar.appendChild(tools);

    tools.addEventListener('click', function(e){
      var b = e.target.closest('button[data-a]');
      if(!b) return;
      var a = b.dataset.a;
      if(a === 'move'){
        setMoving(!moving);
        EN10.toast(moving ? '现在拖动画面；板书不会跟着动' : '已回到书写状态', 'fa-hand-paper');
      } else if(a === 'in'){ zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25); }
      else if(a === 'out'){ zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.25); }
      else if(a === 'reset'){ reset(); }
      else if(a === 'shot'){ snapshotToBoard(); }
      else if(a === 'switch'){ switchCamera(); }
    });

    var bg = EN10.D.bg;
    bg.addEventListener('wheel', function(e){
      if(EN10.S.mode !== 'camera') return;
      e.preventDefault();
      /* 触控板/滚轮一次 deltaY 可能上百，按指数换算成固定倍率，避免一下跳到 600% */
      var step = Math.pow(1.0016, -Math.max(-240, Math.min(240, e.deltaY)));
      zoomAt(e.clientX, e.clientY, Math.max(0.82, Math.min(1.22, step)));
    }, { passive:false });

    /* 手势统一放在 window 捕获阶段：
       画布铺满全屏，双指落下时事件目标是 canvas 而不是背景层，
       只在 bg 上监听永远收不到第二根手指——这也正是以前必须先进「移动」模式才能捏合的原因。
       捕获阶段先拿到事件：双指成立就把事件截下来，别让第二根手指在画面上再落一笔。 */
    function onChrome(t){
      if(!t || !t.closest) return false;
      return !!t.closest('#bottom-toolbar,#bottom-left,#bottom-right,#top-right,' +
        '.left-fab,#cam-tools,.subject-card,#timer-layer,#tiles-layer,#picker-layer,#bib-layer,.modal');
    }
    function pd(e){
      if(EN10.S.mode !== 'camera') return;
      if(e.button !== undefined && e.button !== 0) return;
      if(onChrome(e.target)) return;
      ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if(ptrs.size === 1){
        /* 单指：只有「移动」模式下才拖画面，其余情况这一指留给书写 */
        if(!moving){ if(e.pointerType !== 'touch') ptrs.delete(e.pointerId); return; }
        e.preventDefault();
        drag = { x:e.clientX, y:e.clientY, ox:v().x, oy:v().y };
      } else if(ptrs.size >= 2){
        e.preventDefault();
        e.stopPropagation();
        startPinch();
      }
    }
    function pm(e){
      if(EN10.S.mode !== 'camera') return;
      if(!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if(pinch){
        e.preventDefault();
        e.stopPropagation();
        movePinch();
        return;
      }
      if(ptrs.size === 1 && drag){
        v().x = drag.ox + (e.clientX - drag.x);
        v().y = drag.oy + (e.clientY - drag.y);
        clampView(); applySoon();
      } else if(ptrs.size >= 2){
        startPinch();
      }
    }
    function pu(e){
      if(!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if(ptrs.size === 0){
        drag = null;
        if(pinch){ pinch = null; }
        document.body.classList.remove('cam-pinching');
      } else if(ptrs.size === 1){
        pinch = null;
        document.body.classList.remove('cam-pinching');
        var only = twoPointers()[0];
        drag = (only && moving) ? { x:only.x, y:only.y, ox:v().x, oy:v().y } : null;
      }
    }
    window.addEventListener('pointerdown', pd, true);
    window.addEventListener('pointermove', pm, true);
    window.addEventListener('pointerup', pu, true);
    window.addEventListener('pointercancel', pu, true);

    /* 退出视频展台时自动回到书写状态 */
    var cam = document.getElementById('btn-camera');
    if(cam) cam.addEventListener('click', function(){
      setTimeout(function(){
        if(EN10.S.mode !== 'camera' && moving) setMoving(false);
        if(EN10.S.mode !== 'camera'){ ptrs.clear(); drag = null; pinch = null; }
      }, 60);
    });
    updateLabel();
  }

  function init(){ build(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.EN10Video = {
    toggleMove: function(){ setMoving(!moving); },
    zoom: function(f){ zoomAt(window.innerWidth / 2, window.innerHeight / 2, f); },
    reset: reset,
    snapshot: snapshotToBoard,
    switchCamera: switchCamera
  };
})();
