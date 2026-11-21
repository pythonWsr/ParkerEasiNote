/* ============================================================
   「更多」= Win8 磁贴面板（水平滚动，不分组）
   3D 飞入 + 背景模糊 · 正方形圆角磁贴 · 白底绿图标
   ============================================================ */
(function(){
  var layer, rail;
  var open = false;
  var built = false;
  var closeTimer = 0;

  /* 一屏平铺，不再分组；顺序按课堂使用频率排 */
  var ITEMS = [
    { id:'timer',   name:'计时器',   icon:'timer',   run: function(){ EN10Timer.open(); } },
    { id:'bib',     name:'板中板',   icon:'board',   run: function(){ EN10Board.open(); } },
    { id:'picker',  name:'随机点名', icon:'picker',  run: function(){ EN10Picker.open(); } },
    { id:'hanzi',    name:'汉字',     icon:'hanzi',   run: function(){ EN10Subjects.hanzi(); } },
    { id:'pinyin',   name:'拼音',     icon:'pinyin',  run: function(){ EN10Subjects.pinyin(); } },
    { id:'poem',     name:'古诗词',   icon:'poem',    run: function(){ EN10Subjects.poem(); } },
    { id:'geometry', name:'几何画板', icon:'compass', run: function(){ EN10Subjects.geometry(); } },
    { id:'func',     name:'函数工具', icon:'func',    run: function(){ EN10Subjects.func(); } },
    { id:'formula',  name:'公式编辑', icon:'sigma',   run: function(){ EN10Subjects.formula(); } },
    { id:'rule',     name:'四线三格', icon:'rule',    run: function(){ EN10Subjects.rule(); } },
    { id:'ipa',      name:'音标',     icon:'ipa',     run: function(){ EN10Subjects.ipa(); } },
    { id:'dict',     name:'英汉字典', icon:'dict',    run: function(){ EN10Subjects.dict(); } },
    { id:'dictation',name:'听写',     icon:'dictation',run: function(){ EN10Subjects.dictation(); } },
    { id:'chem',     name:'化学方程式',icon:'chem',   run: function(){ EN10Subjects.chem(); } },
    { id:'planet',   name:'3D 星球',  icon:'planet',  tag:'3D', run: function(){ EN10Subjects.planet(); } },
    { id:'mindmap',  name:'思维导图', icon:'mindmap', run: function(){ EN10Subjects.mindmap(); } },
    { id:'image',  name:'插入图片', icon:'image',  run: function(){ EN10.openImage(); } },
    { id:'web',    name:'网页扩展', icon:'web',    run: function(){ EN10.openWeb(); } },
    { id:'physics',name:'物理实验', icon:'atom',   run: function(){ EN10.openEmbed('https://wl.nobook.com/physics/new?moduleId=1','物理实验'); } },
    { id:'chemlab',name:'化学实验', icon:'flask',  run: function(){ EN10.openEmbed('https://hx.nobook.com/chemical/new?moduleId=9','化学实验'); } },
    { id:'camera', name:'视频展台', icon:'camera', run: function(){ var b=document.getElementById('btn-camera'); if(b) b.click(); } }
  ];

  function build(){
    if(built) return;
    built = true;
    layer = document.getElementById('tiles-layer');
    layer.innerHTML =
      '<div class="tiles-scrim"></div>' +
      '<div class="tiles-scene">' +
        '<div class="tiles-head">' +
          '<div class="tiles-title">更多<small>MORE · 课堂工具与学科工具</small></div>' +
          '<button class="tiles-close" aria-label="关闭"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="tiles-rail" id="tiles-rail"></div>' +
        '<div class="tiles-hintline"><i class="fas fa-arrows-left-right"></i> 横向滚动查看更多</div>' +
      '</div>';
    rail = layer.querySelector('#tiles-rail');

    rail.innerHTML = ITEMS.map(function(it, i){
      return '<button class="tile" data-id="' + it.id + '" data-i="' + i + '">' +
        (it.tag ? '<em>' + it.tag + '</em>' : '') +
        '<i class="tile-ic">' + enIcon(it.icon, 30) + '</i><span>' + it.name + '</span></button>';
    }).join('');

    layer.querySelector('.tiles-close').onclick = function(){ close(); };
    layer.querySelector('.tiles-scrim').onclick = function(){ close(); };

    rail.querySelectorAll('.tile').forEach(function(btn){
      btn.onclick = function(e){
        e.stopPropagation();
        var id = btn.dataset.id;
        var item = ITEMS.filter(function(x){ return x.id === id; })[0];
        if(!item) return;
        close(true);
        setTimeout(function(){
          try{ item.run(); }
          catch(err){ console.error(err); EN10.toast('打开失败：' + err.message, 'fa-exclamation-triangle'); }
        }, 200);
      };
    });

    /* 鼠标滚轮 / 触控板：纵向滚 → 横向滚动；到底再交给页面 */
    rail.addEventListener('wheel', function(e){
      if(Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      var canLeft = rail.scrollLeft > 0;
      var canRight = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1;
      if((e.deltaY > 0 && canRight) || (e.deltaY < 0 && canLeft)){
        e.preventDefault();
        rail.scrollLeft += e.deltaY;
      }
    }, { passive:false });

    /* 鼠标按住拖动也能滑（触屏用原生 pan-x） */
    var drag = null;
    rail.addEventListener('pointerdown', function(e){
      if(e.pointerType === 'touch') return;
      if(e.target.closest('.tile')) return;
      drag = { x:e.clientX, left:rail.scrollLeft, moved:false };
    });
    window.addEventListener('pointermove', function(e){
      if(!drag) return;
      var dx = e.clientX - drag.x;
      if(Math.abs(dx) > 4) drag.moved = true;
      rail.scrollLeft = drag.left - dx;
    });
    window.addEventListener('pointerup', function(){ drag = null; });

    /* 桌面端轻微视差（只动 transform，交给合成层） */
    if(matchMedia('(hover:hover)').matches){
      layer.addEventListener('mousemove', function(e){
        if(!open) return;
        var nx = (e.clientX / window.innerWidth - .5), ny = (e.clientY / window.innerHeight - .5);
        var inner = layer.querySelector('.tiles-scene');
        if(inner) inner.style.transform = 'rotateY(' + (nx * 1.6).toFixed(2) + 'deg) rotateX(' + (-ny * 1.1).toFixed(2) + 'deg)';
      });
      layer.addEventListener('mouseleave', function(){
        var inner = layer.querySelector('.tiles-scene');
        if(inner) inner.style.transform = '';
      });
    }
  }

  /* 按可用高度算行数与磁贴边长：不多留一丝空隙，也不出现纵向滚动 */
  function layout(){
    if(!rail) return;
    var gap = 10;
    var cs = getComputedStyle(rail);
    var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var H = (rail.clientHeight || 0) - padY;
    /* 按高度决定行数：每格约 170px，2~5 行，尽量把整块地方用满 */
    var rows = Math.max(2, Math.min(5, Math.round(H / 190)));
    var size = Math.floor((H - gap * (rows - 1)) / rows);
    while(size > 200 && rows < 5){ rows++; size = Math.floor((H - gap * (rows - 1)) / rows); }
    size = Math.max(64, Math.min(200, size));
    rail.style.gridTemplateRows = 'repeat(' + rows + ',' + size + 'px)';
    rail.style.gridAutoColumns = size + 'px';
    rail.style.setProperty('--tile-size', size + 'px');
    Array.prototype.forEach.call(rail.children, function(el, i){
      var col = Math.floor(i / rows), row = i % rows;
      el.style.setProperty('--col', col);
      el.style.setProperty('--row', row);
      /* 错峰收在 260ms 内，避免长列表末尾迟迟不出现 */
      el.style.animationDelay = (Math.min(col, 6) * 42 + row * 20) + 'ms';
    });
    rail.classList.toggle('tile-sm', size < 92);
    var hint = layer.querySelector('.tiles-hintline');
    if(hint) hint.style.display = (rail.scrollWidth > rail.clientWidth + 2) ? '' : 'none';
  }

  function openPanel(){
    build();
    clearTimeout(closeTimer);
    layer.classList.remove('leaving', 'gone');
    open = true;
    layer.classList.add('on');
    /* 先显示再算尺寸：隐藏状态下 clientHeight 为 0，会把磁贴算成最小值 */
    void layer.offsetHeight;
    layer.setAttribute('aria-hidden', 'false');
    rail.scrollLeft = 0;
    /* 先清掉上一轮的动画，再算尺寸（顺带把错峰延迟写回去，顺序不能反） */
    Array.prototype.forEach.call(rail.children, function(el){ el.style.animation = 'none'; });
    void layer.offsetHeight;
    Array.prototype.forEach.call(rail.children, function(el){ el.style.animation = ''; });
    layout();
  }

  function close(instant){
    if(!open) return;
    open = false;
    clearTimeout(closeTimer);
    layer.setAttribute('aria-hidden', 'true');
    var done = function(){
      layer.classList.remove('on', 'leaving');
      if(EN10.S.tool === 'more') EN10.setActiveTool('pen');
    };
    if(instant){
      /* 选了工具就直接让位，别让退场动画挡住新弹窗 */
      done();
      return;
    }
    /* 保留 .on 让退场动画能跑完，动画结束后再隐藏 */
    layer.classList.add('leaving');
    closeTimer = setTimeout(done, 460);
  }

  function toggle(){
    if(open) close(); else openPanel();
  }

  window.addEventListener('resize', function(){ if(open) layout(); });
  document.addEventListener('keydown', function(e){
    if(open && e.key === 'Escape'){ e.stopPropagation(); close(); }
  }, true);

  window.EN10Tiles = {
    open: openPanel,
    close: close,
    toggle: toggle,
    isOpen: function(){ return open; }
  };
})();
