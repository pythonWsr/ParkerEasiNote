/* ============================================================
   「更多」= 二级菜单
   一级：分类（课堂 / 语文 / 数学 / 英语 / 理科 / 创作）
   二级：分类下的工具；全部在一屏网格里，不横向滚动
   纯 flex 布局 + 位移/透明度动画，老浏览器也能打开
   ============================================================ */
(function(){
  var layer, colsEl;
  var open = false;
  var built = false;
  var closeTimer = 0;

  /* 分类顺序即列顺序；每类最多 4 项，保证一屏放得下 */
  var GROUPS = [
    { id:'class', name:'课堂', icon:'chalkboard', color:'#2DC360', items:[
      { id:'timer',   name:'计时器',   icon:'timer',   run:function(){ EN10Timer.open(); } },
      { id:'bib',     name:'板中板',   icon:'board',   run:function(){ EN10Board.open(); } },
      { id:'picker',  name:'随机点名', icon:'picker',  run:function(){ EN10Picker.open(); } },
      { id:'camera',  name:'视频展台', icon:'camera',  run:function(){ var b=document.getElementById('btn-camera'); if(b) b.click(); } }
    ]},
    { id:'cn', name:'语文', icon:'hanzi', color:'#2C6BE0', items:[
      { id:'hanzi',    name:'汉字',   icon:'hanzi',    run:function(){ EN10Subjects.hanzi(); } },
      { id:'pinyin',   name:'拼音',   icon:'pinyin',   run:function(){ EN10Subjects.pinyin(); } },
      { id:'poem',     name:'古诗词', icon:'poem',     run:function(){ EN10Subjects.poem(); } },
      { id:'dictation',name:'听写',   icon:'dictation',run:function(){ EN10Subjects.dictation(); } }
    ]},
    { id:'math', name:'数学', icon:'compass', color:'#FF9500', items:[
      { id:'geometry', name:'几何画板', icon:'compass', run:function(){ EN10Subjects.geometry(); } },
      { id:'func',     name:'函数工具', icon:'func',    run:function(){ EN10Subjects.func(); } },
      { id:'formula',  name:'公式编辑', icon:'sigma',   run:function(){ EN10Subjects.formula(); } }
    ]},
    { id:'en', name:'英语', icon:'rule', color:'#AF52DE', items:[
      { id:'rule', name:'四线三格', icon:'rule', run:function(){ EN10Subjects.rule(); } },
      { id:'ipa',  name:'音标',     icon:'ipa',  run:function(){ EN10Subjects.ipa(); } },
      { id:'dict', name:'英汉字典', icon:'dict', run:function(){ EN10Subjects.dict(); } }
    ]},
    { id:'sci', name:'理科', icon:'atom', color:'#0AA5A5', items:[
      { id:'chem',    name:'化学方程式', icon:'chem',  run:function(){ EN10Subjects.chem(); } },
      { id:'planet',  name:'3D 星球',    icon:'planet',run:function(){ EN10Subjects.planet(); } },
      { id:'physics', name:'物理实验',   icon:'atom',  run:function(){ EN10.openEmbed('https://wl.nobook.com/physics/new?moduleId=1','物理实验'); } },
      { id:'chemlab', name:'化学实验',   icon:'flask', run:function(){ EN10.openEmbed('https://hx.nobook.com/chemical/new?moduleId=9','化学实验'); } }
    ]},
    { id:'make', name:'创作', icon:'mindmap', color:'#D9362B', items:[
      { id:'mindmap', name:'思维导图', icon:'mindmap', run:function(){ EN10Subjects.mindmap(); } },
      { id:'piano',   name:'钢琴',     icon:'piano',   run:function(){ if(window.EN10Piano) EN10Piano.open(); else EN10.toast('钢琴模块未加载','fa-exclamation-triangle'); } },
      { id:'image',   name:'插入图片', icon:'image',   run:function(){ EN10.openImage(); } },
      { id:'web',     name:'网页扩展', icon:'web',     run:function(){ EN10.openWeb(); } }
    ]}
  ];

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function build(){
    if(built) return;
    built = true;
    layer = document.getElementById('tiles-layer');
    layer.innerHTML =
      '<div class="tiles-scrim"></div>' +
      '<div class="mt-scene">' +
        '<div class="mt-head">' +
          '<div class="mt-title">更多<small>课堂工具与学科工具</small></div>' +
          '<button class="mt-close" aria-label="关闭"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="mt-cols" id="mt-cols"></div>' +
      '</div>';
    colsEl = layer.querySelector('#mt-cols');

    colsEl.innerHTML = GROUPS.map(function(g){
      var items = g.items.map(function(it){
        return '<button class="mt-item" data-g="' + g.id + '" data-id="' + it.id + '">' +
          '<i class="mt-ic" style="color:' + g.color + '">' + enIcon(it.icon, 18) + '</i>' +
          '<span>' + esc(it.name) + '</span></button>';
      }).join('');
      return '<div class="mt-col" data-g="' + g.id + '">' +
        '<div class="mt-col-head"><i style="color:' + g.color + '">' + enIcon(g.icon, 14) + '</i><span>' + esc(g.name) + '</span></div>' +
        '<div class="mt-body">' + items + '</div></div>';
    }).join('');

    layer.querySelector('.mt-close').onclick = function(){ close(); };
    layer.querySelector('.tiles-scrim').onclick = function(){ close(); };

    colsEl.addEventListener('click', function(e){
      var btn = e.target.closest('.mt-item');
      if(!btn) return;
      e.stopPropagation();
      var gid = btn.getAttribute('data-g'), id = btn.getAttribute('data-id');
      var g = GROUPS.filter(function(x){ return x.id === gid; })[0];
      var item = g && g.items.filter(function(x){ return x.id === id; })[0];
      if(!item) return;
      close(true);
      setTimeout(function(){
        try{ item.run(); }
        catch(err){ console.error(err); EN10.toast('打开失败：' + err.message, 'fa-exclamation-triangle'); }
      }, 170);
    });
  }

  /* 按可用宽高排成 6 列（窄屏 3 列 × 2 行），再把字号压到刚好放得下 */
  function layout(){
    if(!colsEl) return;
    var W = colsEl.clientWidth || window.innerWidth;
    var H = layer.clientHeight || window.innerHeight;
    var small = W < 520 && H >= 420;
    var nCol = small ? 3 : 6;
    var rows = small ? 2 : 1;
    var cols = colsEl.querySelectorAll('.mt-col');
    Array.prototype.forEach.call(cols, function(col){
      col.style.width = (100 / nCol) + '%';
      col.style.height = 'auto';
      col.style.borderRight = '1px solid rgba(255,255,255,.09)';
    });

    /* 可用高度按“屏幕 - 标题 - 内边距”算，不能拿当前内容高度当上限，
       否则第一次排版会把自己越缩越小 */
    var box = Math.max(90, H - 92);
    var itemH = Math.floor((box / rows - 34) / 4);
    itemH = Math.max(22, Math.min(78, itemH));

    function apply(h){
      var fs = h < 32 ? 9.5 : (h < 40 ? 10.5 : (h < 54 ? 11.5 : 13));
      var isz = h < 32 ? 12 : (h < 44 ? 14 : (h < 54 ? 16 : 18));
      var big = h >= 54;
      colsEl.querySelectorAll('.mt-item').forEach(function(el){
        el.style.height = h + 'px';
        el.style.fontSize = fs + 'px';
        el.classList.toggle('mt-big', big);
        var ic = el.querySelector('.mt-ic');
        if(ic) ic.style.fontSize = (big ? Math.min(22, isz + 4) : isz) + 'px';
      });
    }
    apply(itemH);
    for(var guard = 0; guard < 40; guard++){
      if(colsEl.scrollHeight <= box + 1) break;
      if(itemH <= 22) break;
      itemH -= 1;
      apply(itemH);
    }
    colsEl.classList.toggle('mt-narrow', small);
  }

  function openPanel(){
    build();
    clearTimeout(closeTimer);
    layer.classList.remove('leaving', 'gone');
    open = true;
    layer.classList.add('on');
    layer.setAttribute('aria-hidden', 'false');
    void layer.offsetHeight;
    layout();
    /* 矮屏再去掉说明文字，给工具腾地方 */
    layer.classList.toggle('mt-compact', layer.clientHeight < 360);
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
    if(instant){ done(); return; }
    layer.classList.add('leaving');
    closeTimer = setTimeout(done, 180);
  }

  function toggle(){ if(open) close(); else openPanel(); }

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
