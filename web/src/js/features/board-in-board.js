/* ============================================================
   板中板：可移动的小黑板
   · 顶部胶囊手柄拖动
   · 右上角「调整大小」→ popconfirm 三档
   · 画布底色与笔迹跟随主板
   ============================================================ */
(function(){
  var layer, win, wrap, canvas, ctx, pop;
  var built = false, open = false;
  var strokes = [], cur = null;
  var pen = { color:'#ffffff', width:3 };
  var pos = { x:0, y:0 };
  var size = { w:640, h:450, key:'m' };
  var SIZES = {
    s: { w:430, h:310, label:'小', note:'430 × 310' },
    m: { w:640, h:450, label:'中', note:'640 × 450' },
    l: { w:900, h:640, label:'大', note:'900 × 640' }
  };
  var COLORS = ['#ffffff', '#FF6B63', '#FFD166', '#45D47D', '#5AB8FF', '#C79BFF'];

  function z(){ return (EN10.S.zoom || 1); }

  function build(){
    if(built) return;
    built = true;
    layer = document.getElementById('bib-layer');
    layer.innerHTML =
      '<div class="bib-window" id="bib-win">' +
        '<div class="bib-head" id="bib-head">' +
          '<span class="bib-grip" title="按住拖动"></span>' +
          '<span class="bib-title">板中板</span>' +
          '<button class="bib-btn" id="bib-resize" title="调整大小"><i class="fas fa-up-right-and-down-left-from-center"></i></button>' +
          '<button class="bib-btn close" id="bib-close" title="关闭"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="bib-canvas-wrap" id="bib-wrap">' +
          '<canvas id="bib-canvas"></canvas>' +
          '<div class="bib-hint" id="bib-hint">按住顶部胶囊拖动位置<br>在这里写，不影响主板书</div>' +
        '</div>' +
        '<div class="bib-foot" id="bib-foot"></div>' +
      '</div>';
    win = layer.querySelector('#bib-win');
    wrap = layer.querySelector('#bib-wrap');
    canvas = layer.querySelector('#bib-canvas');
    ctx = canvas.getContext('2d');
    layer.querySelector('#bib-close').onclick = close;
    layer.querySelector('#bib-resize').onclick = function(e){ e.stopPropagation(); togglePop(); };
    // 笔色
    var foot = layer.querySelector('#bib-foot');
    var fh = '';
    COLORS.forEach(function(c, i){
      fh += '<span class="bib-dot' + (i === 0 ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + ';' +
        (c === '#ffffff' ? 'box-shadow:0 0 0 1px rgba(0,0,0,.25) inset;' : '') + '"></span>';
    });
    fh += '<span class="bib-sep"></span>' +
      '<button class="bib-mini" id="bib-thin" title="细">细</button>' +
      '<button class="bib-mini" id="bib-thick" title="粗">粗</button>' +
      '<span class="bib-sep"></span>' +
      '<button class="bib-mini" id="bib-undo" title="撤销"><i class="fas fa-rotate-left"></i></button>' +
      '<button class="bib-mini" id="bib-clear" title="清空"><i class="fas fa-trash"></i></button>' +
      '<button class="bib-mini primary" id="bib-insert" title="把板中板内容贴到主白板">插入白板</button>';
    foot.innerHTML = fh;
    foot.querySelectorAll('.bib-dot').forEach(function(d){
      d.onclick = function(){
        pen.color = d.dataset.c;
        foot.querySelectorAll('.bib-dot').forEach(function(x){ x.classList.toggle('on', x === d); });
      };
    });
    foot.querySelector('#bib-thin').onclick = function(){ pen.width = 2; };
    foot.querySelector('#bib-thick').onclick = function(){ pen.width = 6; };
    foot.querySelector('#bib-undo').onclick = function(){ strokes.pop(); redraw(); };
    foot.querySelector('#bib-clear').onclick = function(){
      if(!strokes.length) return;
      strokes = []; redraw(); EN10.toast('板中板已清空', 'fa-eraser');
    };
    foot.querySelector('#bib-insert').onclick = insertToBoard;

    // 拖动
    var head = layer.querySelector('#bib-head');
    var drag = null;
    head.addEventListener('pointerdown', function(e){
      if(e.target.closest('button')) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      head.classList.add('dragging');
      drag = { x:e.clientX, y:e.clientY, ox:pos.x, oy:pos.y };
      closePop();
    });
    head.addEventListener('pointermove', function(e){
      if(!drag) return;
      var zz = z();
      pos.x = drag.ox + (e.clientX - drag.x) / zz;
      pos.y = drag.oy + (e.clientY - drag.y) / zz;
      clamp();
      paintPos();
    });
    function endDrag(e){
      if(!drag) return;
      drag = null;
      head.classList.remove('dragging');
      try{ head.releasePointerCapture(e.pointerId); }catch(err){}
    }
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);

    // 绘制
    var drawing = false;
    function pt(e){
      var r = wrap.getBoundingClientRect();
      return { x:(e.clientX - r.left) / z(), y:(e.clientY - r.top) / z(), p: e.pressure > 0 && e.pointerType === 'pen' ? e.pressure : .5 };
    }
    wrap.addEventListener('pointerdown', function(e){
      if(e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      wrap.setPointerCapture(e.pointerId);
      drawing = true;
      var q = pt(e);
      cur = { color:pen.color, width:pen.width, pts:[q] };
      strokes.push(cur);
      var hint = layer.querySelector('#bib-hint');
      if(hint) hint.style.display = 'none';
      redraw();
    });
    wrap.addEventListener('pointermove', function(e){
      if(!drawing || !cur) return;
      var list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if(list && list.length){
        list.forEach(function(ev){
          var q = pt(ev);
          var last = cur.pts[cur.pts.length - 1];
          if(Math.hypot(q.x - last.x, q.y - last.y) > .6) cur.pts.push(q);
        });
      } else {
        var q2 = pt(e);
        var last2 = cur.pts[cur.pts.length - 1];
        if(Math.hypot(q2.x - last2.x, q2.y - last2.y) > .6) cur.pts.push(q2);
      }
      redraw();
    });
    function up(e){
      if(!drawing) return;
      drawing = false;
      cur = null;
      try{ wrap.releasePointerCapture(e.pointerId); }catch(err){}
      redraw();
    }
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);

    window.addEventListener('resize', function(){ if(open) resizeCanvas(); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && open){ if(pop && pop.parentNode){ closePop(); } else { close(); } }
    });
  }

  function clamp(){
    var vw = window.innerWidth / z(), vh = window.innerHeight / z();
    pos.x = Math.max(4, Math.min(vw - size.w - 4, pos.x));
    pos.y = Math.max(4, Math.min(vh - size.h - 4, pos.y));
  }
  function paintPos(){
    if(!win) return;
    win.style.left = pos.x + 'px';
    win.style.top = pos.y + 'px';
  }

  function resizeCanvas(){
    if(!canvas) return;
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    var w = size.w, h = size.h - 34 - 38;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.__dpr = dpr;
    redraw();
  }

  /* 画布底色与主板一致；笔迹语义也一致（圆头、平滑） */
  function redraw(){
    if(!ctx) return;
    var dpr = canvas.__dpr || 1;
    var bg = (EN10 && EN10.currentBg) ? EN10.currentBg() : EN10.S.pages[EN10.S.pageIdx].bg;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    strokes.forEach(function(s){
      if(s.pts.length < 1) return;
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if(s.pts.length === 1){
        ctx.arc(s.pts[0].x, s.pts[0].y, s.width / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for(var i = 1; i < s.pts.length - 1; i++){
        var mx = (s.pts[i].x + s.pts[i + 1].x) / 2;
        var my = (s.pts[i].y + s.pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(s.pts[i].x, s.pts[i].y, mx, my);
      }
      var last = s.pts[s.pts.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    });
  }

  function togglePop(){
    if(pop && pop.parentNode){ closePop(); return; }
    pop = document.createElement('div');
    pop.className = 'bib-pop';
    var html = '<h5>板中板大小</h5>';
    Object.keys(SIZES).forEach(function(k){
      html += '<button data-k="' + k + '"' + (size.key === k ? ' class="on"' : '') + '>' +
        '<i class="fas fa-' + (k === 's' ? 'square' : k === 'm' ? 'expand' : 'up-right-and-down-left-from-center') + '"></i>' +
        SIZES[k].label + '<small>' + SIZES[k].note + '</small></button>';
    });
    pop.innerHTML = html;
    win.appendChild(pop);
    pop.querySelectorAll('button').forEach(function(b){
      b.onclick = function(e){
        e.stopPropagation();
        setSize(b.dataset.k);
        closePop();
      };
    });
  }
  function closePop(){ if(pop && pop.parentNode) pop.parentNode.removeChild(pop); pop = null; }

  function setSize(k){
    var s = SIZES[k] || SIZES.m;
    size = { w:s.w, h:s.h, key:k };
    // 以左上角为锚点，溢出时向左上收
    var vw = window.innerWidth / z(), vh = window.innerHeight / z();
    if(pos.x + size.w > vw - 4) pos.x = Math.max(4, vw - size.w - 4);
    if(pos.y + size.h > vh - 4) pos.y = Math.max(4, vh - size.h - 4);
    win.style.width = size.w + 'px';
    win.style.height = size.h + 'px';
    paintPos();
    resizeCanvas();
  }

  function insertToBoard(){
    if(!canvas) return;
    var dpr = canvas.__dpr || 1;
    var tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
    var tc = tmp.getContext('2d');
    tc.drawImage(canvas, 0, 0);
    var url = tmp.toDataURL('image/png');
    EN10.insertImage(url, canvas.width / dpr, canvas.height / dpr, { scale:.8 });
    close();
  }

  function openPanel(){
    build();
    var vw = window.innerWidth / z(), vh = window.innerHeight / z();
    pos.x = Math.max(24, (vw - size.w) / 2 + 40);
    pos.y = Math.max(24, (vh - size.h) / 2 - 20);
    win.style.width = size.w + 'px';
    win.style.height = size.h + 'px';
    layer.classList.add('on');
    open = true;
    paintPos();
    clamp(); paintPos();
    resizeCanvas();
    var hint = layer.querySelector('#bib-hint');
    if(hint) hint.style.display = strokes.length ? 'none' : '';
  }
  function close(){
    if(!open) return;
    open = false;
    closePop();
    layer.classList.remove('on');
    EN10.toast('板中板已收起（内容还在）', 'fa-board');
  }

  window.EN10Board = {
    open: openPanel,
    close: close,
    insert: insertToBoard,
    isOpen: function(){ return open; }
  };
})();
