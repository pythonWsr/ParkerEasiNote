/* ============================================================
   视频展台：画面可缩放、可平移
   墨迹在独立 canvas 上，不跟着画面移动（板书相对屏幕固定）
   ============================================================ */
(function(){
  var bar, built = false;
  var moving = false;
  var ptrs = new Map();
  var drag = null, pinch = null;

  function v(){ return EN10.S.camView || (EN10.S.camView = { x:0, y:0, s:1 }); }
  var rafId = 0;
  function apply(){
    EN10.applyCamView();
    updateLabel();
  }
  /* 指针事件比屏幕刷新快，用 rAF 合批，避免一帧里写多次 transform 造成“卡住”的错觉 */
  function applySoon(){
    if(rafId) return;
    rafId = requestAnimationFrame(function(){ rafId = 0; apply(); });
  }
  function clampView(){
    var s = v().s;
    if(s < 1){ v().s = 1; }
    if(v().s > 6) v().s = 6;
    /* 允许把画面挪到任意位置：即使 100% 也留出半个屏幕的活动范围 */
    var maxX = window.innerWidth * ((v().s - 1) / 2 + 0.5);
    var maxY = window.innerHeight * ((v().s - 1) / 2 + 0.5);
    v().x = Math.max(-maxX, Math.min(maxX, v().x));
    v().y = Math.max(-maxY, Math.min(maxY, v().y));
  }
  function zoomAt(cx, cy, factor){
    var old = v().s;
    var s = Math.max(1, Math.min(6, old * factor));
    if(s === old) return;
    var r = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    // 以指针为锚点缩放
    v().x = cx - (cx - v().x) * (s / old);
    v().y = cy - (cy - v().y) * (s / old);
    v().s = s;
    clampView(); apply();
  }
  function reset(){ EN10.resetCamView(); apply(); }

  function updateLabel(){
    if(!bar) return;
    var el = bar.querySelector('.cam-zoom');
    if(el) el.textContent = Math.round(v().s * 100) + '%';
  }

  function build(){
    if(built) return;
    built = true;
    bar = document.createElement('div');
    bar.className = 'cam-toolbar';
    bar.innerHTML =
      '<button data-a="move" title="拖动/缩放画面（不影响板书）"><i class="fas fa-hand-paper"></i>移动画面</button>' +
      '<button data-a="out" title="缩小"><i class="fas fa-minus"></i></button>' +
      '<span class="cam-zoom">100%</span>' +
      '<button data-a="in" title="放大"><i class="fas fa-plus"></i></button>' +
      '<button data-a="reset" title="复位"><i class="fas fa-arrows-rotate"></i></button>' +
      '<button data-a="freeze" title="冻结画面"><i class="fas fa-snowflake"></i></button>';
    document.body.appendChild(bar);

    bar.addEventListener('click', function(e){
      var b = e.target.closest('button[data-a]');
      if(!b) return;
      var a = b.dataset.a;
      if(a === 'move'){
        moving = !moving;
        b.classList.toggle('on', moving);
        document.body.classList.toggle('cam-moving', moving);
        EN10.toast(moving ? '现在拖动画面；板书不会跟着动' : '已回到书写状态', 'fa-hand-paper');
      } else if(a === 'in'){ zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.2); }
      else if(a === 'out'){ zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.2); }
      else if(a === 'reset'){ reset(); }
      else if(a === 'freeze'){ document.getElementById('btn-freeze').click(); }
    });

    var bg = EN10.D.bg;
    bg.addEventListener('wheel', function(e){
      if(EN10.S.mode !== 'camera' || !moving) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1 / 1.08 : 1.08);
    }, { passive:false });

    bg.addEventListener('pointerdown', function(e){
      if(EN10.S.mode !== 'camera' || !moving) return;
      e.preventDefault();
      bg.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if(ptrs.size === 1){
        drag = { x:e.clientX, y:e.clientY, ox:v().x, oy:v().y };
      } else if(ptrs.size === 2){
        var arr = Array.from(ptrs.values());
        pinch = {
          d: Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y),
          s: v().s,
          cx: (arr[0].x + arr[1].x) / 2,
          cy: (arr[0].y + arr[1].y) / 2
        };
        drag = null;
      }
    });
    bg.addEventListener('pointermove', function(e){
      if(EN10.S.mode !== 'camera' || !moving) return;
      if(!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if(ptrs.size === 1 && drag){
        v().x = drag.ox + (e.clientX - drag.x);
        v().y = drag.oy + (e.clientY - drag.y);
        clampView(); applySoon();
      } else if(ptrs.size === 2 && pinch){
        var arr = Array.from(ptrs.values());
        var d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
        var factor = d / (pinch.d || 1);
        var target = Math.max(1, Math.min(6, pinch.s * factor));
        if(Math.abs(target - v().s) > 0.002){
          zoomAt(pinch.cx, pinch.cy, target / v().s);
        }
      }
    });
    function up(e){
      ptrs.delete(e.pointerId);
      if(ptrs.size === 0){ drag = null; pinch = null; }
      if(ptrs.size === 1){
        var only = Array.from(ptrs.values())[0];
        drag = { x:only.x, y:only.y, ox:v().x, oy:v().y };
        pinch = null;
      }
      try{ bg.releasePointerCapture(e.pointerId); }catch(err){}
    }
    bg.addEventListener('pointerup', up);
    bg.addEventListener('pointercancel', up);

    /* 退出视频展台时自动回到书写状态 */
    var cam = document.getElementById('btn-camera');
    if(cam) cam.addEventListener('click', function(){
      setTimeout(function(){
        if(EN10.S.mode !== 'camera' && moving){
          moving = false;
          document.body.classList.remove('cam-moving');
          var mb = bar.querySelector('[data-a="move"]');
          if(mb) mb.classList.remove('on');
        }
      }, 60);
    });
    updateLabel();
  }

  function init(){ build(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.EN10Video = {
    toggleMove: function(){ if(bar) bar.querySelector('[data-a="move"]').click(); },
    zoom: function(f){ zoomAt(window.innerWidth / 2, window.innerHeight / 2, f); },
    reset: reset
  };
})();
