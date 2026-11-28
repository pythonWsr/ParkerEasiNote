/* ============================================================
   数学类学科工具：几何画板 · 函数工具 · 公式编辑
   ============================================================ */
(function(){
  var S = window.EN10Subjects;
  var esc = S._esc;

  /* ===================== 1. 几何画板 ===================== */
  S.geometry = function(){
    var pts = [{ x:220, y:260, label:'A' }, { x:520, y:200, label:'B' }, { x:420, y:400, label:'C' }];
    var segs = [[0,1],[1,2],[2,0]];
    var circles = [];
    var mode = 'move';
    var dragIdx = -1;
    var pending = null;
    var showMeasure = true;
    var view = { s:1, x:0, y:0 };      // 视图缩放/平移
    var cvs, cv, c;
    var pinch = null;

    S._open({
      title:'几何画板',
      sub:'点 · 线段 · 圆 · 拖动变形 · 实时度量',
      icon:'compass',
      body:'<div id="geo-stage" class="canvas-wrap"></div>',
      side:
        '<div class="side-block"><div class="side-title">工具</div>' +
          '<div class="chips" id="geo-tools">' +
            '<button class="chip on" data-m="move">拖动</button>' +
            '<button class="chip" data-m="point">点</button>' +
            '<button class="chip" data-m="seg">线段</button>' +
            '<button class="chip" data-m="circle">圆</button>' +
            '<button class="chip" data-m="erase">删除</button>' +
          '</div></div>' +
        '<div class="side-block"><div class="side-title">视图</div>' +
          '<div class="chips"><button class="chip" id="geo-zin">放大</button><button class="chip" id="geo-zout">缩小</button><button class="chip" id="geo-fit">复位</button></div>' +
          '<div class="kv" style="margin-top:6px"><span>当前缩放</span><b id="geo-zoom">100%</b></div></div>' +
        '<div class="side-block"><div class="side-title">显示</div>' +
          '<label class="toggle"><input type="checkbox" id="geo-measure" checked><span class="toggle-track"><span class="toggle-thumb"></span></span><span>显示度量</span></label></div>' +
        '<div class="side-block"><div class="side-title">度量结果</div><div id="geo-info" style="font-size:12px;color:#4A5560;line-height:1.9"></div></div>' +
        '<div class="side-block"><button class="s-btn" id="geo-clear" style="width:100%">清空画板</button></div>',
      hint:'滚轮缩放、空白处拖动画布；「点」落点，「线段」依次点两个点连线，拖动模式下按住点即可改变图形。',
      insert:{ label:'插入图形', get:function(api){ api.insertCanvas(cv, 1); }},
      onMount:function(api){
        var stage = api.pane.querySelector('#geo-stage');
        var info = api.side.querySelector('#geo-info');
        var zoomEl = api.side.querySelector('#geo-zoom');

        /* 画布只建一次：尺寸变化时只改后备缓冲，事件监听不会丢 */
        function resize(){
          if(!cv){
            cvs = S._canvas(600, 400);
            cv = cvs.cv; c = cvs.c;
            cv.className = 'tool-canvas';
            stage.appendChild(cv);
          }
          var fit = S._fit(stage);
          if(fit.W === cvs.w && fit.H === cvs.h){ draw(); return; }
          cvs.w = fit.W; cvs.h = fit.H;
          cv.width = Math.round(fit.W * cvs.dpr);
          cv.height = Math.round(fit.H * cvs.dpr);
          cv.style.width = fit.W + 'px';
          cv.style.height = fit.H + 'px';
          if(!fitted){ fitted = true; fitContent(); }
          draw();
        }
        /* 小屏首屏把示例图形缩到看得见的范围，免得一进来只有网格 */
        var fitted = false;
        function fitContent(){
          if(!pts.length) return;
          var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          pts.forEach(function(p){
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          });
          var pad = 70;
          var bw = Math.max(120, maxX - minX) + pad * 2;
          var bh = Math.max(120, maxY - minY) + pad * 2;
          var ns = Math.max(0.35, Math.min(1.6, Math.min(cvs.w / bw, cvs.h / bh)));
          view.s = ns;
          view.x = (cvs.w - (minX + maxX) * ns) / 2;
          view.y = (cvs.h - (minY + maxY) * ns) / 2;
        }
        function snap(v){ return Math.round(v / 10) * 10; }
        /* 屏幕坐标 → 画布逻辑坐标（含视图缩放） */
        function pos(e){
          var r = cv.getBoundingClientRect();
          return {
            x: ((e.clientX - r.left) - view.x) / view.s,
            y: ((e.clientY - r.top) - view.y) / view.s
          };
        }
        function hit(p){
          for(var i = pts.length - 1; i >= 0; i--){
            if(Math.hypot(pts[i].x - p.x, pts[i].y - p.y) < 16 / view.s) return i;
          }
          return -1;
        }
        function nextLabel(){
          var used = pts.map(function(p){ return p.label; });
          for(var i = 0; i < 26; i++){
            var L = String.fromCharCode(65 + i);
            if(used.indexOf(L) < 0) return L;
          }
          return 'P' + pts.length;
        }
        function applyView(){
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.translate(view.x, view.y);
          c.scale(view.s, view.s);
        }
        function draw(){
          if(!c) return;
          var W = cvs.w, H = cvs.h, dpr = cvs.dpr || 1;
          /* 先回到设备像素基准，再叠加视图变换；否则 DPR>1 时只画出左上角四分之一 */
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          c.clearRect(0, 0, W, H);
          c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
          c.save();
          c.translate(view.x, view.y);
          c.scale(view.s, view.s);
          /* 网格：以 20 逻辑像素为基准，按缩放调整密度，始终铺满可视区 */
          var step = 20;
          while(step * view.s < 12) step *= 2;
          while(step * view.s > 52) step /= 2;
          c.strokeStyle = '#F0F4F7'; c.lineWidth = 1 / view.s;
          var startX = -view.x / view.s, endX = (W - view.x) / view.s;
          var startY = -view.y / view.s, endY = (H - view.y) / view.s;
          for(var x = Math.floor(startX / step) * step; x < endX; x += step){
            c.beginPath(); c.moveTo(x, startY); c.lineTo(x, endY); c.stroke();
          }
          for(var y = Math.floor(startY / step) * step; y < endY; y += step){
            c.beginPath(); c.moveTo(startX, y); c.lineTo(endX, y); c.stroke();
          }
          // 圆
          circles.forEach(function(ci){
            var a = pts[ci.a], b = pts[ci.b];
            if(!a || !b) return;
            var r = Math.hypot(a.x - b.x, a.y - b.y);
            c.beginPath(); c.arc(a.x, a.y, r, 0, Math.PI * 2);
            c.strokeStyle = '#45D47D'; c.lineWidth = 2 / view.s; c.stroke();
            c.fillStyle = 'rgba(69,212,125,.05)'; c.fill();
            if(showMeasure){
              c.fillStyle = '#1B8641'; c.font = (11 / view.s) + 'px "PingFang SC",sans-serif'; c.textAlign = 'left';
              c.fillText('r = ' + (r / 20).toFixed(2) + ' 格', a.x + r + 6, a.y);
            }
          });
          // 线段
          segs.forEach(function(sg){
            var a = pts[sg[0]], b = pts[sg[1]];
            if(!a || !b) return;
            c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
            c.strokeStyle = '#2C6BE0'; c.lineWidth = 2.4 / view.s; c.lineCap = 'round'; c.stroke();
            if(showMeasure){
              var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              var len = Math.hypot(a.x - b.x, a.y - b.y) / 20;
              var ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
              c.fillStyle = '#2C6BE0'; c.font = (11 / view.s) + 'px "PingFang SC",sans-serif'; c.textAlign = 'center';
              c.fillText(len.toFixed(2) + ' 格 / ' + ang.toFixed(0) + '°', mx, my - 10 / view.s);
            }
          });
          // 点
          pts.forEach(function(p, i){
            c.beginPath(); c.arc(p.x, p.y, 6 / view.s, 0, Math.PI * 2);
            c.fillStyle = (i === pending) ? '#FF9500' : '#16241D';
            c.fill();
            c.strokeStyle = '#fff'; c.lineWidth = 2 / view.s; c.stroke();
            c.fillStyle = '#16241D'; c.font = '600 ' + (13 / view.s) + 'px "PingFang SC",sans-serif'; c.textAlign = 'left';
            c.fillText(p.label, p.x + 10 / view.s, p.y - 10 / view.s);
          });
          // 角度
          if(showMeasure && segs.length >= 2){
            var lines = segs.map(function(sg){
              var a = pts[sg[0]], b = pts[sg[1]];
              return a && b ? { a:a, b:b } : null;
            }).filter(Boolean);
            var txt = [];
            for(var i = 0; i < Math.min(3, lines.length); i++){
              for(var j = i + 1; j < Math.min(3, lines.length); j++){
                var L1 = lines[i], L2 = lines[j];
                var shared = null;
                if(L1.a === L2.a) shared = L1.a;
                else if(L1.a === L2.b) shared = L1.a;
                else if(L1.b === L2.a) shared = L1.b;
                else if(L1.b === L2.b) shared = L1.b;
                if(!shared) continue;
                var o1 = (L1.a === shared ? L1.b : L1.a), o2 = (L2.a === shared ? L2.b : L2.a);
                var v1 = Math.atan2(o1.y - shared.y, o1.x - shared.x);
                var v2 = Math.atan2(o2.y - shared.y, o2.x - shared.x);
                var deg = Math.abs((v2 - v1) * 180 / Math.PI);
                if(deg > 180) deg = 360 - deg;
                txt.push('∠' + shared.label + ' = ' + deg.toFixed(1) + '°');
              }
            }
            info.innerHTML = txt.map(function(t){ return '<div>' + t + '</div>'; }).join('') || '<span style="color:#96A1AC">拖动点试试</span>';
          } else if(info){
            info.innerHTML = '<span style="color:#96A1AC">度量已关闭</span>';
          }
          c.restore();
          if(zoomEl) zoomEl.textContent = Math.round(view.s * 100) + '%';
        }
        function zoomAt(mx, my, factor){
          var old = view.s;
          var ns = Math.max(0.35, Math.min(4, old * factor));
          if(Math.abs(ns - old) < 0.001) return;
          view.x = mx - (mx - view.x) * (ns / old);
          view.y = my - (my - view.y) * (ns / old);
          view.s = ns;
          draw();
        }
        resize();
        api.side.querySelector('#geo-zin').onclick = function(){ zoomAt(cvs.w / 2, cvs.h / 2, 1.25); };
        api.side.querySelector('#geo-zout').onclick = function(){ zoomAt(cvs.w / 2, cvs.h / 2, 1 / 1.25); };
        api.side.querySelector('#geo-fit').onclick = function(){ fitContent(); draw(); };

        cv.addEventListener('pointerdown', function(e){
          if(e.button === 1 || e.button === 2){ pan = { x:e.clientX, y:e.clientY, vx:view.x, vy:view.y }; cv.setPointerCapture(e.pointerId); return; }
          var p = pos(e);
          var h = hit(p);
          if(mode === 'move'){
            if(h >= 0){ dragIdx = h; cv.setPointerCapture(e.pointerId); }
            else { pan = { x:e.clientX, y:e.clientY, vx:view.x, vy:view.y }; cv.setPointerCapture(e.pointerId); }
            return;
          }
          if(mode === 'erase'){
            if(h >= 0){
              segs = segs.filter(function(sg){ return sg[0] !== h && sg[1] !== h; });
              circles = circles.filter(function(ci){ return ci.a !== h && ci.b !== h; });
              pts.splice(h, 1);
              segs = segs.map(function(sg){ return [sg[0] > h ? sg[0] - 1 : sg[0], sg[1] > h ? sg[1] - 1 : sg[1]]; });
              circles = circles.map(function(ci){ return { a: ci.a > h ? ci.a - 1 : ci.a, b: ci.b > h ? ci.b - 1 : ci.b }; });
              draw();
            }
            return;
          }
          if(mode === 'point'){
            pts.push({ x:snap(p.x), y:snap(p.y), label:nextLabel() });
            draw(); return;
          }
          if(mode === 'seg' || mode === 'circle'){
            var idx = h;
            if(idx < 0){
              pts.push({ x:snap(p.x), y:snap(p.y), label:nextLabel() });
              idx = pts.length - 1;
            }
            if(pending == null){ pending = idx; draw(); return; }
            if(pending !== idx){
              if(mode === 'seg') segs.push([pending, idx]);
              else circles.push({ a:pending, b:idx });
            }
            pending = null;
            draw();
          }
        });
        var pan = null;
        cv.addEventListener('pointermove', function(e){
          if(pan){
            view.x = pan.vx + (e.clientX - pan.x);
            view.y = pan.vy + (e.clientY - pan.y);
            draw(); return;
          }
          if(dragIdx < 0) return;
          var p = pos(e);
          pts[dragIdx].x = snap(p.x);
          pts[dragIdx].y = snap(p.y);
          draw();
        });
        function up(e){
          if(pan){ pan = null; try{ cv.releasePointerCapture(e.pointerId); }catch(err){} }
          if(dragIdx < 0) return;
          dragIdx = -1;
          try{ cv.releasePointerCapture(e.pointerId); }catch(err){}
        }
        cv.addEventListener('pointerup', up);
        cv.addEventListener('pointercancel', up);
        cv.addEventListener('contextmenu', function(e){ e.preventDefault(); });
        cv.addEventListener('wheel', function(e){
          e.preventDefault();
          var r = cv.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY > 0 ? 1 / 1.12 : 1.12);
        }, { passive:false });
        /* 双指捏合缩放 */
        cv.addEventListener('touchstart', function(e){
          if(e.touches.length === 2){
            var a = e.touches[0], b = e.touches[1];
            pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: view.s };
            dragIdx = -1; pan = null;
          }
        }, { passive:true });
        cv.addEventListener('touchmove', function(e){
          if(e.touches.length === 2 && pinch){
            e.preventDefault();
            var a = e.touches[0], b = e.touches[1];
            var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            var r = cv.getBoundingClientRect();
            var cx = (a.clientX + b.clientX) / 2 - r.left;
            var cy = (a.clientY + b.clientY) / 2 - r.top;
            var target = Math.max(0.35, Math.min(4, pinch.s * d / (pinch.d || 1)));
            zoomAt(cx, cy, target / view.s);
          }
        }, { passive:false });
        cv.addEventListener('touchend', function(){ pinch = null; });

        api.side.querySelector('#geo-tools').addEventListener('click', function(e){
          var b = e.target.closest('.chip');
          if(!b) return;
          mode = b.dataset.m;
          pending = null;
          api.side.querySelectorAll('#geo-tools .chip').forEach(function(x){ x.classList.toggle('on', x === b); });
          draw();
        });
        api.side.querySelector('#geo-measure').addEventListener('change', function(e){
          showMeasure = e.target.checked; draw();
        });
        api.side.querySelector('#geo-clear').onclick = function(){
          pts = []; segs = []; circles = []; pending = null; draw();
        };
        S._observe(stage, resize);
        setTimeout(resize, 120);
      }
    });
  };

  /* ===================== 2. 函数工具 ===================== */
  S.func = function(){
    var fns = [
      { expr:'sin(x)', color:'#2DC360' },
      { expr:'x^2/4', color:'#2C6BE0' }
    ];
    var view = { cx:0, cy:0, scale:40 };  // 40px / 单位
    var hover = null;
    var cvs, cv, c;

    function compile(expr){
      var e = String(expr).replace(/\s+/g, '')
        .replace(/\^/g, '**')
        .replace(/\bln\(/g, 'Math.log(')
        .replace(/\blog\(/g, 'Math.log10(')
        .replace(/\bsin\(/g, 'Math.sin(')
        .replace(/\bcos\(/g, 'Math.cos(')
        .replace(/\btan\(/g, 'Math.tan(')
        .replace(/\bsqrt\(/g, 'Math.sqrt(')
        .replace(/\babs\(/g, 'Math.abs(')
        .replace(/\bpi\b/gi, 'Math.PI')
        .replace(/\be\b/g, 'Math.E');
      if(/[^0-9a-zA-Z_+\-*/().,\s*MathsincotaqrtbPIElg]/.test(e.replace(/Math\./g, ''))) {
        throw new Error('含有不支持的字符');
      }
      /* eslint-disable no-new-func */
      var f = new Function('x', 'with(Math){ return (' + e + '); }');
      f(0);
      return f;
    }

    S._open({
      title:'函数工具',
      sub:'解析式绘图 · 缩放平移 · 追踪取值',
      icon:'func',
      body:'<div id="fx-stage" class="canvas-wrap"></div>',
      side:
        '<div class="side-block"><div class="side-title">函数列表</div><div id="fx-list"></div>' +
          '<button class="s-btn" id="fx-add" style="width:100%;margin-top:8px"><i class="fas fa-plus"></i>添加函数</button></div>' +
        '<div class="side-block"><div class="side-title">视图</div>' +
          '<div class="chips"><button class="chip" id="fx-zin">放大</button><button class="chip" id="fx-zout">缩小</button><button class="chip" id="fx-reset">复位</button></div>' +
          '<div class="kv" style="margin-top:8px"><span>x 范围</span><b id="fx-range">—</b></div></div>' +
        '<div class="side-block"><div class="side-title">追踪</div><div id="fx-trace" style="font-size:12px;color:#4A5560;line-height:1.9">把鼠标移到曲线上</div></div>',
      hint:'支持 sin cos tan sqrt abs log ln ^ 与 pi、e；鼠标滚轮缩放，按住空白处拖动平移。',
      insert:{ label:'插入图像', get:function(api){ api.insertCanvas(cv, 1); }},
      onMount:function(api){
        var stage = api.pane.querySelector('#fx-stage');
        var listEl = api.side.querySelector('#fx-list');
        var traceEl = api.side.querySelector('#fx-trace');

        /* 画布常驻：只改尺寸，指针事件不会因为重建而失效 */
        function resize(keepView){
          if(!cv){
            cvs = S._canvas(600, 420);
            cv = cvs.cv; c = cvs.c;
            cv.className = 'tool-canvas';
            stage.appendChild(cv);
          }
          var fit = S._fit(stage);
          var changed = fit.W !== cvs.w || fit.H !== cvs.h;
          if(changed){
            cvs.w = fit.W; cvs.h = fit.H;
            cv.width = Math.round(fit.W * cvs.dpr);
            cv.height = Math.round(fit.H * cvs.dpr);
            cv.style.width = fit.W + 'px';
            cv.style.height = fit.H + 'px';
            /* resize 会把上下文状态清空，DPR 缩放要重新写回 */
            c.setTransform(cvs.dpr, 0, 0, cvs.dpr, 0, 0);
          }
          if(changed || !keepView){ view.cx = fit.W / 2; view.cy = fit.H / 2; }
          draw();
        }
        function sx(x){ return view.cx + x * view.scale; }
        function sy(y){ return view.cy - y * view.scale; }
        function ux(px){ return (px - view.cx) / view.scale; }
        function uy(py){ return (view.cy - py) / view.scale; }

        function draw(){
          if(!c) return;
          var W = cvs.w, H = cvs.h;
          c.clearRect(0, 0, W, H);
          c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
          // 网格步长自适应
          var step = 1;
          while(step * view.scale < 34) step *= 2;
          while(step * view.scale > 110) step /= 2;
          c.strokeStyle = '#EFF3F6'; c.lineWidth = 1;
          var x0 = Math.ceil(ux(0) / step) * step;
          for(var x = x0; sx(x) < W; x += step){
            c.beginPath(); c.moveTo(sx(x), 0); c.lineTo(sx(x), H); c.stroke();
          }
          var y0 = Math.ceil(uy(H) / step) * step;
          for(var y = y0; sy(y) > 0; y += step){
            c.beginPath(); c.moveTo(0, sy(y)); c.lineTo(W, sy(y)); c.stroke();
          }
          // 轴
          c.strokeStyle = '#9FB0BC'; c.lineWidth = 1.4;
          c.beginPath(); c.moveTo(0, view.cy); c.lineTo(W, view.cy); c.stroke();
          c.beginPath(); c.moveTo(view.cx, 0); c.lineTo(view.cx, H); c.stroke();
          c.fillStyle = '#8B97A2'; c.font = '10.5px "PingFang SC",sans-serif';
          c.textAlign = 'center'; c.textBaseline = 'top';
          for(var xt = x0; sx(xt) < W; xt += step){
            if(Math.abs(xt) < 1e-9) continue;
            c.fillText(fmtNum(xt), sx(xt), view.cy + 4);
          }
          c.textAlign = 'right'; c.textBaseline = 'middle';
          for(var yt = y0; sy(yt) > 0; yt += step){
            if(Math.abs(yt) < 1e-9) continue;
            c.fillText(fmtNum(yt), view.cx - 4, sy(yt));
          }
          // 曲线
          fns.forEach(function(fn){
            if(fn.err) return;
            c.beginPath();
            var started = false, prevY = null;
            for(var px = 0; px <= W; px += 1){
              var ux0 = ux(px);
              var val;
              try{ val = fn.f(ux0); }catch(e){ val = NaN; }
              if(!isFinite(val)){ started = false; prevY = null; continue; }
              var py = sy(val);
              if(py < -H * 4 || py > H * 5){ started = false; prevY = null; continue; }
              // 断点（如 tan）不连线
              if(prevY != null && Math.abs(py - prevY) > H * 1.6){ started = false; }
              if(!started){ c.moveTo(px, py); started = true; }
              else c.lineTo(px, py);
              prevY = py;
            }
            c.strokeStyle = fn.color; c.lineWidth = 2.2;
            c.lineJoin = 'round'; c.lineCap = 'round';
            c.stroke();
          });
          // 追踪点
          if(hover != null){
            var hv = hover;
            fns.forEach(function(fn){
              if(fn.err) return;
              var val; try{ val = fn.f(hv); }catch(e){ return; }
              if(!isFinite(val)) return;
              var px = sx(hv), py = sy(val);
              if(py < 0 || py > H) return;
              c.beginPath(); c.arc(px, py, 4.5, 0, Math.PI * 2);
              c.fillStyle = fn.color; c.fill();
              c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
            });
          }
          var lft = ux(0), rgt = ux(W);
          api.side.querySelector('#fx-range').textContent = fmtNum(lft) + ' ~ ' + fmtNum(rgt);
        }
        function fmtNum(n){
          if(Math.abs(n) >= 1000) return n.toExponential(1);
          var s = (Math.round(n * 100) / 100).toString();
          return s;
        }

        function renderList(){
          listEl.innerHTML = fns.map(function(fn, i){
            return '<div class="fx-item" data-i="' + i + '" style="display:flex;align-items:center;gap:7px;margin-bottom:7px">' +
              '<span style="width:10px;height:10px;border-radius:50%;background:' + fn.color + ';flex:0 0 10px"></span>' +
              '<input class="field sm" value="' + esc(fn.expr) + '" data-i="' + i + '" style="flex:1">' +
              (fns.length > 1 ? '<button class="bib-mini" data-del="' + i + '" title="删除"><i class="fas fa-times"></i></button>' : '') +
              '</div>' + (fn.err ? '<div style="font-size:10.5px;color:#c0392b;margin:-4px 0 8px 17px">' + esc(fn.err) + '</div>' : '');
          }).join('');
          listEl.querySelectorAll('input[data-i]').forEach(function(inp){
            inp.addEventListener('change', function(){
              var i = +inp.dataset.i;
              setExpr(i, inp.value);
            });
          });
          listEl.querySelectorAll('[data-del]').forEach(function(b){
            b.onclick = function(){ fns.splice(+b.dataset.del, 1); renderList(); draw(); };
          });
        }
        function setExpr(i, expr){
          try{
            fns[i].f = compile(expr);
            fns[i].expr = expr;
            fns[i].err = '';
          }catch(e){
            fns[i].err = e.message || '解析失败';
          }
          renderList(); draw();
        }

        fns.forEach(function(fn){ try{ fn.f = compile(fn.expr); }catch(e){ fn.err = e.message; } });
        renderList();
        api.side.querySelector('#fx-add').onclick = function(){
          if(fns.length >= 4){ EN10.toast('最多同时画 4 条曲线', 'fa-exclamation-triangle'); return; }
          var colors = ['#2DC360', '#2C6BE0', '#FF9500', '#AF52DE'];
          fns.push({ expr:'x', color:colors[fns.length % 4], f:compile('x'), err:'' });
          renderList(); draw();
        };
        api.side.querySelector('#fx-zin').onclick = function(){ view.scale *= 1.3; draw(); };
        api.side.querySelector('#fx-zout').onclick = function(){ view.scale /= 1.3; draw(); };
        api.side.querySelector('#fx-reset').onclick = function(){ view.scale = 40; resize(false); };

        resize(true);
        var drag = null;
        cv.addEventListener('pointerdown', function(e){
          drag = { x:e.clientX, y:e.clientY, cx:view.cx, cy:view.cy };
          cv.setPointerCapture(e.pointerId);
        });
        cv.addEventListener('pointermove', function(e){
          var r = cv.getBoundingClientRect();
          if(drag){
            view.cx = drag.cx + (e.clientX - drag.x);
            view.cy = drag.cy + (e.clientY - drag.y);
            draw();
            return;
          }
          var px = e.clientX - r.left;
          var val = ux(px);
          hover = val;
          var lines = fns.filter(function(f){ return !f.err; }).map(function(f){
            var y; try{ y = f.f(val); }catch(err){ y = NaN; }
            return isFinite(y) ? ('<div style="color:' + f.color + '">y = ' + fmtNum(y) + '</div>') : '';
          }).join('');
          traceEl.innerHTML = '<div style="color:#8B97A2">x = ' + fmtNum(val) + '</div>' + lines;
          draw();
        });
        function end(e){
          if(!drag) return;
          drag = null;
          try{ cv.releasePointerCapture(e.pointerId); }catch(err){}
        }
        cv.addEventListener('pointerup', end);
        cv.addEventListener('pointercancel', end);
        cv.addEventListener('pointerleave', function(){ hover = null; draw(); });
        cv.addEventListener('wheel', function(e){
          e.preventDefault();
          var old = view.scale;
          var s = Math.max(6, Math.min(400, old * (e.deltaY > 0 ? 1 / 1.1 : 1.1)));
          var r = cv.getBoundingClientRect();
          var mx = e.clientX - r.left, my = e.clientY - r.top;
          view.cx = mx - (mx - view.cx) * (s / old);
          view.cy = my - (my - view.cy) * (s / old);
          view.scale = s;
          draw();
        }, { passive:false });

        /* 双指捏合缩放 */
        var pinch = null;
        cv.addEventListener('touchstart', function(e){
          if(e.touches.length === 2){
            var a = e.touches[0], b = e.touches[1];
            pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: view.scale };
            drag = null;
          }
        }, { passive:true });
        cv.addEventListener('touchmove', function(e){
          if(e.touches.length !== 2 || !pinch) return;
          e.preventDefault();
          var a = e.touches[0], b = e.touches[1];
          var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          var r = cv.getBoundingClientRect();
          var mx = (a.clientX + b.clientX) / 2 - r.left;
          var my = (a.clientY + b.clientY) / 2 - r.top;
          var target = Math.max(6, Math.min(400, pinch.s * d / (pinch.d || 1)));
          var old = view.scale;
          if(Math.abs(target - old) > 0.01){
            view.cx = mx - (mx - view.cx) * (target / old);
            view.cy = my - (my - view.cy) * (target / old);
            view.scale = target;
            draw();
          }
        }, { passive:false });
        cv.addEventListener('touchend', function(){ pinch = null; });

        S._observe(stage, function(){ resize(true); });
        setTimeout(function(){ resize(true); }, 120);
      }
    });
  };

  /* ===================== 3. 公式编辑 ===================== */
  S.formula = function(){
    var tex = '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}';
    var GROUPS = [
      { l:'常用', items:[
        { t:'\\frac{a}{b}', l:'分式', k:'a/b' },
        { t:'\\sqrt{x}', l:'根号', k:'√' },
        { t:'x^{2}', l:'上标', k:'x²' },
        { t:'x_{1}', l:'下标', k:'x₁' },
        { t:'\\le', l:'≤', k:'≤' },
        { t:'\\ge', l:'≥', k:'≥' },
        { t:'\\ne', l:'≠', k:'≠' },
        { t:'\\pm', l:'±', k:'±' },
        { t:'\\times', l:'×', k:'×' },
        { t:'\\div', l:'÷', k:'÷' },
        { t:'\\angle', l:'∠', k:'∠' },
        { t:'\\triangle', l:'△', k:'△' },
        { t:'\\pi', l:'π', k:'π' },
        { t:'\\infty', l:'∞', k:'∞' },
        { t:'\\because', l:'∵', k:'∵' },
        { t:'\\therefore', l:'∴', k:'∴' }
      ]},
      { l:'结构', items:[
        { t:'\\sqrt[n]{x}', l:'n 次根', k:'ⁿ√x' },
        { t:'\\sum_{i=1}^{n}', l:'求和', k:'∑' },
        { t:'\\int_{a}^{b}', l:'积分', k:'∫' },
        { t:'\\lim_{x \\to 0}', l:'极限', k:'lim' },
        { t:'\\begin{cases} a \\\\ b \\end{cases}', l:'分段', k:'{ 分段' },
        { t:'\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', l:'矩阵', k:'▦' },
        { t:'\\vec{a}', l:'向量', k:'→a' },
        { t:'\\bar{x}', l:'平均', k:'x̄' },
        { t:'\\overline{AB}', l:'线段', k:'AB' },
        { t:'\\alpha \\beta \\gamma', l:'希腊', k:'αβγ' }
      ]}
    ];
    var TPL = [
      { l:'一元二次求根', t:'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}' },
      { l:'勾股定理', t:'a^2 + b^2 = c^2' },
      { l:'球的体积', t:'V = \\frac{4}{3}\\pi r^3' },
      { l:'导数定义', t:"f'(x) = \\lim_{\\Delta x \\to 0} \\frac{f(x+\\Delta x)-f(x)}{\\Delta x}" },
      { l:'等差数列', t:'S_n = \\frac{n(a_1+a_n)}{2}' },
      { l:'二项式', t:'(a+b)^n = \\sum_{k=0}^{n} \\binom{n}{k} a^{n-k} b^{k}' }
    ];
    var lastSvg = null, lastW = 0, lastH = 0;

    function num(v, dflt){
      var n = parseFloat(v);
      return isFinite(n) && n > 0 ? n : dflt;
    }
    /* MathJax 的宽高常是 ex 单位，换算成 px 才不会缩成一团 */
    function px(v, dflt){
      var m = /^([\d.]+)(ex|em|px)?$/.exec(String(v || '').trim());
      if(!m) return dflt;
      var n = parseFloat(m[1]);
      if(!isFinite(n)) return dflt;
      if(m[2] === 'ex') return n * 8.4;
      if(m[2] === 'em') return n * 16;
      return n;
    }

    S._open({
      title:'公式编辑',
      sub:'直接改字 · 按键插入 · 实时预览',
      icon:'sigma',
      body:
        '<div class="fx-wrap">' +
          '<div class="fx-edit">' +
            '<div class="fx-lbl">公式内容<span>可直接编辑，点下面的键插入结构</span></div>' +
            '<textarea class="area fx-area" id="fx-tex" spellcheck="false" placeholder="例如：x = \\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"></textarea>' +
            '<div class="fx-tabs" id="fx-tabs"></div>' +
            '<div class="fx-keys" id="fx-pal"></div>' +
          '</div>' +
          '<div class="fx-prev">' +
            '<div class="fx-lbl">实时预览</div>' +
            '<div class="fx-prevbox"><div id="fx-preview"></div></div>' +
            '<div class="fx-err" id="fx-err"></div>' +
          '</div>' +
        '</div>',
      side:
        '<div class="side-block"><div class="side-title">常用公式</div><div class="chips" id="fx-tpl"></div></div>' +
        '<div class="side-block"><div class="side-title">写法提示</div>' +
          '<div class="fx-tip">分式 <b>\\frac{分子}{分母}</b><br>根号 <b>\\sqrt{x}</b><br>' +
          '上标 <b>x^{2}</b>　下标 <b>x_{1}</b><br>中文可在 <b>\\text{…}</b> 里写</div></div>',
      hint:'左栏可像打字一样改公式；不确定写法就先点「常用公式」套模板，再改里面的数字。',
      insert:{ label:'插入白板', get:function(api){
        if(!lastSvg){ EN10.toast('公式还没渲染好，稍等一下', 'fa-exclamation-triangle'); return false; }
        rasterize(lastSvg, lastW, lastH, function(url){
          if(!url){ EN10.toast('公式导出失败，请检查写法', 'fa-exclamation-triangle'); return; }
          EN10.insertImage(url, lastW, lastH, { silent:true });
          EN10.toast('公式已插入白板', 'fa-check');
          api.close();
        });
      }},
      onMount:function(api){
        var ta = api.pane.querySelector('#fx-tex');
        var pv = api.pane.querySelector('#fx-preview');
        var errEl = api.pane.querySelector('#fx-err');
        var pal = api.pane.querySelector('#fx-pal');
        var tabs = api.pane.querySelector('#fx-tabs');
        var tpl = api.side.querySelector('#fx-tpl');
        var gi = 0;

        function render(){
          var t = ta.value.trim();
          if(!t){
            pv.innerHTML = '<span class="fx-empty">在上面输入公式，这里会实时显示</span>';
            errEl.textContent = '';
            lastSvg = null;
            return;
          }
          if(!window.MathJax || !MathJax.tex2svg){
            pv.textContent = t;
            errEl.textContent = '公式引擎还在加载…';
            setTimeout(render, 300);
            return;
          }
          try{
            var node = MathJax.tex2svg(t, { display:true });
            var svg = node.querySelector('svg');
            if(!svg) throw new Error('无法解析');
            /* 去掉隐藏的 MathML 副本，否则个别环境会重复显示一份 */
            var as = node.querySelector('mjx-assistive-mml');
            if(as && as.parentNode) as.parentNode.removeChild(as);

            var naturalW = px(svg.getAttribute('width'), 300);
            var naturalH = px(svg.getAttribute('height'), 60);
            var vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
            var ratio = (vb.length === 4 && vb[2] > 0) ? Math.abs(vb[3] / vb[2]) : naturalH / naturalW;
            var W = Math.max(180, Math.min(860, naturalW * 2.1));
            var H = Math.max(40, W * ratio);

            var out = svg.cloneNode(true);
            out.removeAttribute('style');
            out.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            out.setAttribute('width', W);
            out.setAttribute('height', H);
            if(!out.getAttribute('viewBox')) out.setAttribute('viewBox', '0 0 ' + naturalW + ' ' + naturalH);
            /* currentColor 在离屏 canvas 里会变黑，先固定成墨色 */
            out.querySelectorAll('[fill="currentColor"]').forEach(function(g){ g.setAttribute('fill', '#16241D'); });
            out.querySelectorAll('[stroke="currentColor"]').forEach(function(g){ g.setAttribute('stroke', '#16241D'); });
            lastSvg = new XMLSerializer().serializeToString(out);
            lastW = W; lastH = H;

            var show = out.cloneNode(true);
            show.setAttribute('width', Math.min(560, W));
            show.setAttribute('height', Math.min(560, W) * ratio);
            pv.innerHTML = '';
            pv.appendChild(show);
            errEl.textContent = '';
          }catch(e){
            lastSvg = null;
            errEl.textContent = '写法有误：检查括号是否成对、反斜杠是否漏写';
            pv.innerHTML = '<span class="fx-empty">暂时显示不出来</span>';
          }
        }

        function insertText(t, selectInner){
          var s0 = ta.selectionStart || 0, e0 = ta.selectionEnd || 0;
          ta.value = ta.value.slice(0, s0) + t + ta.value.slice(e0);
          ta.focus();
          var caret = s0 + t.length;
          if(selectInner){
            var i = t.indexOf('{');
            var j = t.indexOf('}');
            if(i >= 0 && j > i){ ta.selectionStart = s0 + i + 1; ta.selectionEnd = s0 + j; }
            else { ta.selectionStart = ta.selectionEnd = caret; }
          } else {
            ta.selectionStart = ta.selectionEnd = caret;
          }
          render();
        }

        function paintPal(){
          tabs.innerHTML = GROUPS.map(function(g, i){
            return '<button class="fx-tab' + (i === gi ? ' on' : '') + '" data-g="' + i + '">' + g.l + '</button>';
          }).join('');
          pal.innerHTML = GROUPS[gi].items.map(function(p, i){
            return '<button class="fx-key" data-i="' + i + '" title="' + esc(p.t) + '">' +
              '<b>' + esc(p.k || p.t) + '</b><span>' + esc(p.l) + '</span></button>';
          }).join('');
        }
        tabs.addEventListener('click', function(e){
          var b = e.target.closest('.fx-tab'); if(!b) return;
          gi = +b.dataset.g; paintPal();
        });
        pal.addEventListener('click', function(e){
          var b = e.target.closest('.fx-key'); if(!b) return;
          var it = GROUPS[gi].items[+b.dataset.i];
          insertText(it.t, /\{/.test(it.t));
        });

        tpl.innerHTML = TPL.map(function(p, i){ return '<button class="chip" data-t="' + i + '">' + p.l + '</button>'; }).join('');
        tpl.querySelectorAll('.chip').forEach(function(b){
          b.onclick = function(){
            ta.value = TPL[+b.dataset.t].t;
            render();
            ta.focus();
          };
        });

        ta.addEventListener('input', render);
        ta.value = tex;
        paintPal();
        var tries = 0;
        (function wait(){
          if(window.MathJax && MathJax.tex2svg){ render(); return; }
          if(tries++ < 50) setTimeout(wait, 200);
          else { pv.textContent = '公式引擎加载失败'; }
        })();
      }
    });
  };

  /* SVG → PNG（离屏栅格化）：白板里存位图，任何浏览器都不会因 <use>/currentColor 画不出来 */
  function rasterize(svgStr, w, h, cb){
    var img = new Image();
    img.onload = function(){
      try{
        var s = 2;
        var cv = document.createElement('canvas');
        cv.width = Math.max(2, Math.round(w * s));
        cv.height = Math.max(2, Math.round(h * s));
        var c = cv.getContext('2d');
        c.drawImage(img, 0, 0, cv.width, cv.height);
        cb(cv.toDataURL('image/png'));
      }catch(e){ cb(null); }
    };
    img.onerror = function(){ cb(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
  }
})();
