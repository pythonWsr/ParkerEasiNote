/* ============================================================
   思维导图：拖动节点、增删改、颜色、缩放平移、导出贴板
   ============================================================ */
(function(){
  var S = window.EN10Subjects;
  var esc = S._esc;

  var COLORS = ['#2DC360', '#2C6BE0', '#FF9500', '#AF52DE', '#D9362B', '#0AA5A5'];

  S.mindmap = function(){
    var nodes = [];
    var sel = null;
    var seq = 0;
    var wrap, stage, svg, canvasWrap;

    function add(text, parent, x, y, color){
      var n = { id:++seq, text:text, parent:parent, x:x, y:y, color:color || COLORS[0], collapsed:false };
      nodes.push(n);
      return n;
    }
    function children(id){ return nodes.filter(function(n){ return n.parent === id; }); }
    function byId(id){ return nodes.filter(function(n){ return n.id === id; })[0]; }

    // 初始示例
    var root = add('中心主题', null, 0, 0, '#2DC360');
    var b1 = add('分支一', root.id, -240, -110, '#2C6BE0');
    var b2 = add('分支二', root.id, -240, 10, '#FF9500');
    var b3 = add('分支三', root.id, -240, 130, '#AF52DE');
    add('要点 A', b1.id, -470, -150, '#2C6BE0');
    add('要点 B', b1.id, -470, -80, '#2C6BE0');
    add('要点 C', b2.id, -470, 10, '#FF9500');
    add('要点 D', b3.id, -470, 130, '#AF52DE');
    sel = root;

    S._open({
      title:'思维导图',
      sub:'拖动节点 · 滚轮缩放 · 空白处拖动画布',
      icon:'mindmap',
      body:
        '<div class="mm-wrap" id="mm-wrap">' +
          '<div class="mm-stage" id="mm-stage">' +
            '<svg class="mm-svg" id="mm-svg"></svg>' +
            '<div id="mm-nodes"></div>' +
          '</div>' +
          '<div class="mm-toolbar">' +
            '<button data-a="child"><i class="fas fa-plus"></i> 子节点</button>' +
            '<button data-a="sibling">同级</button>' +
            '<button data-a="del">删除</button>' +
            '<button data-a="color">换色</button>' +
            '<button data-a="zin" title="放大"><i class="fas fa-magnifying-glass-plus"></i></button>' +
            '<button data-a="zout" title="缩小"><i class="fas fa-magnifying-glass-minus"></i></button>' +
            '<button data-a="fit">居中</button>' +
            '<span class="mm-zoom" id="mm-zoom">100%</span>' +
          '</div>' +
        '</div>',
      hint:'滚轮/双指缩放，空白处拖动画布；选中节点后 Tab 新建子节点、Enter 新建同级，双击节点改字。',
      insert:{ label:'插入导图', get:function(api){
        if(!EN10Subjects._mmCapture){ EN10.toast('导图还没准备好', 'fa-exclamation-triangle'); return false; }
        var cv = EN10Subjects._mmCapture();
        api.insertCanvas(cv, 1);
      }},
      onMount:function(api){
        wrap = api.pane.querySelector('#mm-wrap');
        stage = api.pane.querySelector('#mm-stage');
        svg = api.pane.querySelector('#mm-svg');
        canvasWrap = api.pane.querySelector('#mm-nodes');
        var zoomEl = api.pane.querySelector('#mm-zoom');
        var view = { x:0, y:0, s:1 };
        var pan = null, pinch = null;

        /* 把所有节点装进可视区：小屏一打开就能看到整张图 */
        function fitView(){
          if(!nodes.length) return;
          var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          nodes.forEach(function(n){
            var el = canvasWrap.querySelector('.mm-node[data-id="' + n.id + '"]');
            var w = el ? (el.offsetWidth || 110) : 110, h = el ? (el.offsetHeight || 38) : 38;
            minX = Math.min(minX, n.x - w / 2); maxX = Math.max(maxX, n.x + w / 2);
            minY = Math.min(minY, n.y - h / 2); maxY = Math.max(maxY, n.y + h / 2);
          });
          var padX = 48, padTop = 34, padBottom = 84;   /* 底部留出工具栏高度 */
          var bw = (maxX - minX) + padX * 2, bh = (maxY - minY) + padTop + padBottom;
          var W = wrap.clientWidth || 600, H = wrap.clientHeight || 400;
          var ns = Math.min(W / bw, H / bh, 1);
          view.s = Math.max(0.32, Math.min(1, ns));
          view.x = W / 2 - (minX + maxX) / 2 * view.s;
          view.y = padTop + (H - padTop - padBottom) / 2 - (minY + maxY) / 2 * view.s;
          applyView();
        }

        function applyView(){
          stage.style.transform = 'translate3d(' + view.x + 'px,' + view.y + 'px,0) scale(' + view.s + ')';
          if(zoomEl) zoomEl.textContent = Math.round(view.s * 100) + '%';
        }

        function linesHtml(){
          var out = '';
          nodes.forEach(function(n){
            if(n.parent == null) return;
            var p = byId(n.parent);
            if(!p) return;
            var mx = (p.x + n.x) / 2;
            out += '<path d="M' + p.x + ',' + p.y + ' C' + mx + ',' + p.y + ' ' + mx + ',' + n.y + ' ' + n.x + ',' + n.y +
              '" fill="none" stroke="' + n.color + '" stroke-opacity=".45" stroke-width="' + (2 / view.s) + '"/>';
          });
          return out;
        }

        function paint(){
          svg.innerHTML = linesHtml();
          canvasWrap.innerHTML = nodes.map(function(n){
            var cls = 'mm-node' + (n.id === sel ? ' on' : '') + (n.parent == null ? ' root' : '');
            var st = 'left:' + n.x + 'px;top:' + n.y + 'px;';
            if(n.parent != null) st += 'border-color:' + n.color + '55;';
            if(n.parent === null) st += 'background:' + n.color + ';border-color:' + n.color + ';';
            return '<div class="' + cls + '" data-id="' + n.id + '" style="' + st + '">' + esc(n.text) +
              (n.parent == null ? '' : '<span class="mm-add" data-add="' + n.id + '">+</span>') + '</div>';
          }).join('');
          bindNodes();
          applyView();
        }

        function zoomAt(mx, my, factor){
          var old = view.s;
          var ns = Math.max(0.3, Math.min(3.2, old * factor));
          if(Math.abs(ns - old) < 0.002) return;
          view.x = mx - (mx - view.x) * (ns / old);
          view.y = my - (my - view.y) * (ns / old);
          view.s = ns;
          svg.innerHTML = linesHtml();
          applyView();
        }

        function bindNodes(){
          canvasWrap.querySelectorAll('.mm-node').forEach(function(el){
            var id = +el.dataset.id;
            el.addEventListener('pointerdown', function(e){
              if(e.target.classList.contains('mm-add')) return;
              if(e.button === 1 || e.button === 2) return;
              e.stopPropagation();
              select(id);
              var n = byId(id);
              var start = { x:e.clientX, y:e.clientY, nx:n.x, ny:n.y };
              el.setPointerCapture(e.pointerId);
              function mv(ev){
                n.x = start.nx + (ev.clientX - start.x) / view.s;
                n.y = start.ny + (ev.clientY - start.y) / view.s;
                el.style.left = n.x + 'px';
                el.style.top = n.y + 'px';
                svg.innerHTML = linesHtml();
              }
              function up(ev){
                el.removeEventListener('pointermove', mv);
                el.removeEventListener('pointerup', up);
                el.removeEventListener('pointercancel', up);
                try{ el.releasePointerCapture(ev.pointerId); }catch(err){}
              }
              el.addEventListener('pointermove', mv);
              el.addEventListener('pointerup', up);
              el.addEventListener('pointercancel', up);
            });
            el.addEventListener('dblclick', function(e){
              e.stopPropagation();
              edit(id);
            });
            var addBtn = el.querySelector('.mm-add');
            if(addBtn){
              addBtn.addEventListener('pointerdown', function(e){
                e.stopPropagation(); e.preventDefault();
                var parent = byId(id);
                var sib = children(parent.id).length;
                var n = add('新节点', parent.id, parent.x - 210, parent.y + (sib * 56) - 20, parent.color);
                select(n.id); paint(); edit(n.id);
              });
            }
          });
        }
        function select(id){
          sel = id;
          canvasWrap.querySelectorAll('.mm-node').forEach(function(el){
            el.classList.toggle('on', +el.dataset.id === id);
          });
        }
        function edit(id){
          var n = byId(id);
          if(!n) return;
          var el = canvasWrap.querySelector('.mm-node[data-id="' + id + '"]');
          if(!el) return;
          var old = n.text;
          el.contentEditable = 'true';
          el.style.whiteSpace = 'pre';
          el.focus();
          document.execCommand && document.execCommand('selectAll', false, null);
          el.addEventListener('blur', function done(){
            n.text = (el.textContent || '').trim() || old;
            el.contentEditable = 'false';
            el.removeEventListener('blur', done);
            paint();
          });
        }
        function addChild(){
          var p = byId(sel);
          if(!p) return;
          var sib = children(p.id).length;
          var n = add('新节点', p.id, p.x - 210, p.y + (sib * 56) - 20, p.color);
          select(n.id); paint(); edit(n.id);
        }
        function addSibling(){
          var p = byId(sel);
          if(!p || p.parent == null) return;
          var par = byId(p.parent);
          var sib = children(par.id).length;
          var n = add('新节点', par.id, par.x - 210, par.y + (sib * 56) - 20, p.color);
          select(n.id); paint(); edit(n.id);
        }
        function del(){
          var p = byId(sel);
          if(!p) return;
          if(p.parent == null){ EN10.toast('中心主题不能删除', 'fa-exclamation-triangle'); return; }
          (function collect(id, acc){
            acc.push(id);
            children(id).forEach(function(c){ collect(c.id, acc); });
            return acc;
          })(p.id, []).forEach(function(id){
            nodes = nodes.filter(function(n){ return n.id !== id; });
          });
          sel = nodes.length ? nodes[0].id : null;
          paint();
        }
        function cycleColor(){
          var n = byId(sel);
          if(!n) return;
          var i = COLORS.indexOf(n.color);
          n.color = COLORS[(i + 1) % COLORS.length];
          paint();
        }
        function fit(){
          fitView();
        }

        wrap.querySelector('.mm-toolbar').addEventListener('click', function(e){
          var b = e.target.closest('button[data-a]');
          if(!b) return;
          var a = b.dataset.a;
          if(a === 'child') addChild();
          else if(a === 'sibling') addSibling();
          else if(a === 'del') del();
          else if(a === 'color') cycleColor();
          else if(a === 'fit') fit();
          else if(a === 'zin') zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.25);
          else if(a === 'zout') zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1 / 1.25);
        });

        /* 空白处拖动平移；滚轮缩放 */
        wrap.addEventListener('pointerdown', function(e){
          if(e.target.closest('.mm-node') || e.target.closest('.mm-toolbar')) return;
          sel = null;
          canvasWrap.querySelectorAll('.mm-node.on').forEach(function(x){ x.classList.remove('on'); });
          pan = { x:e.clientX, y:e.clientY, vx:view.x, vy:view.y };
          try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
        });
        wrap.addEventListener('pointermove', function(e){
          if(!pan) return;
          view.x = pan.vx + (e.clientX - pan.x);
          view.y = pan.vy + (e.clientY - pan.y);
          applyView();
        });
        function endPan(e){
          if(!pan) return;
          pan = null;
          try{ wrap.releasePointerCapture(e.pointerId); }catch(err){}
        }
        wrap.addEventListener('pointerup', endPan);
        wrap.addEventListener('pointercancel', endPan);
        wrap.addEventListener('wheel', function(e){
          e.preventDefault();
          var r = wrap.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY > 0 ? 1 / 1.12 : 1.12);
        }, { passive:false });

        wrap.addEventListener('touchstart', function(e){
          if(e.touches.length === 2){
            var a = e.touches[0], b = e.touches[1];
            pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: view.s };
            pan = null;
          }
        }, { passive:true });
        wrap.addEventListener('touchmove', function(e){
          if(e.touches.length !== 2 || !pinch) return;
          e.preventDefault();
          var a = e.touches[0], b = e.touches[1];
          var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          var r = wrap.getBoundingClientRect();
          var cx = (a.clientX + b.clientX) / 2 - r.left;
          var cy = (a.clientY + b.clientY) / 2 - r.top;
          var target = Math.max(0.3, Math.min(3.2, pinch.s * d / (pinch.d || 1)));
          zoomAt(cx, cy, target / view.s);
        }, { passive:false });
        wrap.addEventListener('touchend', function(){ pinch = null; });

        document.addEventListener('keydown', function onKey(e){
          if(!document.body.contains(wrap)){ document.removeEventListener('keydown', onKey); return; }
          if(/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
          if(document.activeElement && document.activeElement.isContentEditable) return;
          if(e.key === 'Tab'){ e.preventDefault(); addChild(); }
          else if(e.key === 'Enter'){ e.preventDefault(); addSibling(); }
          else if(e.key === 'Delete' || e.key === 'Backspace'){ e.preventDefault(); del(); }
        });

        S._observe(wrap, function(){ paint(); fitView(); });
        paint();
        fitView();

        function renderToCanvas(){
          /* 包围盒按设计坐标算，导出与当前缩放无关 */
          var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          var metrics = nodes.map(function(n){
            var el = canvasWrap.querySelector('.mm-node[data-id="' + n.id + '"]');
            var w = el ? (el.offsetWidth || 90) : 90, h = el ? (el.offsetHeight || 34) : 34;
            var x = n.x - w / 2, y = n.y - h / 2;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
            return { n:n, x:x, y:y, w:w, h:h };
          });
          var pad = 40;
          var W = Math.max(320, maxX - minX + pad * 2);
          var H = Math.max(220, maxY - minY + pad * 2);
          var cvs = S._canvas(W, H, 2);
          var c = cvs.c;
          c.fillStyle = '#FBFCFD'; c.fillRect(0, 0, W, H);
          metrics.forEach(function(m){
            if(m.n.parent == null) return;
            var pm = metrics.filter(function(x){ return x.n.id === m.n.parent; })[0];
            if(!pm) return;
            var x1 = pm.x + pm.w, y1 = pm.y + pm.h / 2, x2 = m.x, y2 = m.y + m.h / 2;
            var mx = (x1 + x2) / 2;
            c.beginPath();
            c.moveTo(x1 - minX + pad, y1 - minY + pad);
            c.bezierCurveTo(mx - minX + pad, y1 - minY + pad, mx - minX + pad, y2 - minY + pad, x2 - minX + pad, y2 - minY + pad);
            c.strokeStyle = m.n.color + '88'; c.lineWidth = 2.2; c.stroke();
          });
          metrics.forEach(function(m){
            var x = m.x - minX + pad, y = m.y - minY + pad;
            var r = 12;
            c.beginPath();
            c.moveTo(x + r, y);
            c.arcTo(x + m.w, y, x + m.w, y + m.h, r);
            c.arcTo(x + m.w, y + m.h, x, y + m.h, r);
            c.arcTo(x, y + m.h, x, y, r);
            c.arcTo(x, y, x + m.w, y, r);
            c.closePath();
            if(m.n.parent == null){ c.fillStyle = m.n.color; c.fill(); }
            else { c.fillStyle = '#fff'; c.fill(); c.strokeStyle = m.n.color + '77'; c.lineWidth = 1.6; c.stroke(); }
            c.fillStyle = m.n.parent == null ? '#fff' : '#1E2C25';
            c.font = (m.n.parent == null ? '800 ' : '600 ') + '14px "PingFang SC","Microsoft YaHei",sans-serif';
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(m.n.text, x + m.w / 2, y + m.h / 2, m.w - 12);
          });
          return cvs.cv;
        }
        EN10Subjects._mmCapture = renderToCanvas;
      }
    });
  };
})();
