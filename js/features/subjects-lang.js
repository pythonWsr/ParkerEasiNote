/* ============================================================
   语文 / 英语类学科工具
   汉字 · 拼音 · 古诗词 · 四线三格 · 音标 · 听写
   ============================================================ */
(function(){
  var S = window.EN10Subjects;
  var esc = S._esc;

  /* ---------- 懒加载本地数据 ---------- */
  function loadScript(src, test, cb){
    if(test()){ cb(); return; }
    var s = document.createElement('script');
    s.src = src;
    s.onload = function(){ cb(); };
    s.onerror = function(){ EN10.toast('本地数据加载失败：' + src, 'fa-exclamation-triangle'); };
    document.head.appendChild(s);
  }

  /* ===================== 1. 汉字 ===================== */
  S.hanzi = function(){
    var lastChars = [];
    function meta(ch){
      var d = (window.EN10_HANZI || {})[ch] || [];
      return { py: d[0] || '', stroke: d[1] || '', rad: d[2] || '' };
    }
    /* 把字卡排成一行画到 canvas，插入白板用 */
    function composeHanzi(chars){
      var cw = 250, chh = 320, gap = 16;
      var w = chars.length * cw + (chars.length - 1) * gap + 40;
      var cvs = S._canvas(w, chh + 30);
      var c = cvs.c;
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, chh + 30);
      chars.forEach(function(c2, i){
        var x = 20 + i * (cw + gap), y = 15;
        var m = meta(c2);
        c.textAlign = 'center'; c.textBaseline = 'top';
        c.fillStyle = '#1B8641'; c.font = '600 22px "PingFang SC","Microsoft YaHei",sans-serif';
        c.fillText(m.py || '', x + cw / 2, y);
        var gy = y + 36, gh = chh - 60;
        c.strokeStyle = '#D8E0E7'; c.lineWidth = 2;
        c.strokeRect(x, gy, cw, gh);
        c.strokeStyle = '#EDF2F6'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x + cw / 2, gy + 6); c.lineTo(x + cw / 2, gy + gh - 6); c.stroke();
        c.beginPath(); c.moveTo(x + 6, gy + gh / 2); c.lineTo(x + cw - 6, gy + gh / 2); c.stroke();
        c.fillStyle = '#16241D';
        c.font = '600 ' + Math.round(gh * .66) + 'px "Kaiti SC","STKaiti","KaiTi",serif';
        c.textBaseline = 'middle';
        c.fillText(c2, x + cw / 2, gy + gh / 2 + 4);
        c.fillStyle = '#8B97A2'; c.font = '12px "PingFang SC",sans-serif'; c.textBaseline = 'top';
        c.fillText('笔画 ' + (m.stroke || '—') + ' · 部首 ' + (m.rad || '—'), x + cw / 2, gy + gh + 8);
      });
      return cvs.cv;
    }

    S._open({
      title:'汉字',
      sub:'田字格 · 拼音 · 笔画 · 部首',
      icon:'hanzi',
      body:
        '<div class="hanzi-card">' +
          '<div class="chips" style="justify-content:center">' +
            '<input class="field" id="hz-input" maxlength="12" placeholder="输入 1-6 个汉字，回车生成" style="max-width:280px">' +
            '<button class="s-btn primary" id="hz-go">生成</button>' +
            '<button class="s-btn" id="hz-speak"><i class="fas fa-volume-high"></i>朗读</button>' +
          '</div>' +
          '<div id="hz-cards" class="chips" style="justify-content:center;gap:14px"></div>' +
          '<div class="panel-empty" id="hz-empty" style="height:auto;padding:26px 0">输入汉字后，这里会出现田字格卡片<br>点卡片可听读音</div>' +
        '</div>',
      hint:'「插入字卡」会把当前所有字卡排成一行贴到板书上，适合讲生字时直接用。',
      insert:{ label:'插入字卡', get:function(api){
        if(!lastChars.length){ EN10.toast('先输入汉字', 'fa-exclamation-triangle'); return false; }
        api.insertCanvas(composeHanzi(lastChars), .9);
      }},
      onMount:function(api){
        var input = api.pane.querySelector('#hz-input');
        function render(txt){
          lastChars = Array.from(txt);
          var wrap = api.pane.querySelector('#hz-cards');
          var empty = api.pane.querySelector('#hz-empty');
          if(empty) empty.style.display = 'none';
          wrap.innerHTML = lastChars.map(function(ch){
            var m = meta(ch);
            return '<div class="hz-item" data-ch="' + ch + '" style="cursor:pointer">' +
              '<div class="hz-py">' + (m.py || '—') + '</div>' +
              '<div class="tian-grid"><span class="hz' + (lastChars.length > 3 ? ' small' : '') + '">' + ch + '</span></div>' +
              '<div class="hz-meta" style="margin-top:8px;justify-content:center">' +
                '<span>笔画 <b>' + (m.stroke || '—') + '</b></span>' +
                '<span>部首 <b>' + (m.rad || '—') + '</b></span>' +
              '</div></div>';
          }).join('');
          wrap.querySelectorAll('.hz-item').forEach(function(el){
            el.onclick = function(){ S._speak(el.dataset.ch, 'zh-CN', .7); };
          });
        }
        function ready(){
          var go = function(){
            var txt = (input.value || '').replace(/[^\u4e00-\u9fff]/g, '').slice(0, 6);
            if(!txt){ EN10.toast('请输入汉字', 'fa-exclamation-triangle'); return; }
            render(txt);
          };
          input.addEventListener('keydown', function(e){ if(e.key === 'Enter') go(); });
          api.pane.querySelector('#hz-go').onclick = go;
          api.pane.querySelector('#hz-speak').onclick = function(){
            var txt = (input.value || '').replace(/[^\u4e00-\u9fff]/g, '');
            if(txt) S._speak(txt, 'zh-CN', .8);
          };
          input.value = '永';
          render('永');
        }
        loadScript('data/hanzi.js', function(){ return !!window.EN10_HANZI; }, ready);
      }
    });
  };

  /* ===================== 2. 拼音 ===================== */
  S.pinyin = function(){
    var SHENGMU = ['b','p','m','f','d','t','n','l','g','k','h','j','q','x','zh','ch','sh','r','z','c','s','y','w'];
    var YUNMU = ['a','o','e','i','u','ü','ai','ei','ui','ao','ou','iu','ie','üe','er','an','en','in','un','ün','ang','eng','ing','ong'];
    var ZHENGTI = ['zhi','chi','shi','ri','zi','ci','si','yi','wu','yu','ye','yue','yuan','yin','yun','ying'];
    var TONES = [{m:'ˉ',n:1},{m:'ˊ',n:2},{m:'ˇ',n:3},{m:'ˋ',n:4},{m:'·',n:0}];
    var tone = 0;
    var pick = { s:'', y:'' };
    function outText(){
      var syl = (pick.z ? pick.z : (pick.s + pick.y));
      if(!syl) return '—';
      return toneMark(syl, tone);
    }

    function toneMark(syl, t){
      if(!t) return syl;
      var marks = {
        1:{a:'ā',o:'ō',e:'ē',i:'ī',u:'ū','ü':'ǖ'},
        2:{a:'á',o:'ó',e:'é',i:'í',u:'ú','ü':'ǘ'},
        3:{a:'ǎ',o:'ǒ',e:'ě',i:'ǐ',u:'ǔ','ü':'ǚ'},
        4:{a:'à',o:'ò',e:'è',i:'ì',u:'ù','ü':'ǜ'}
      };
      var m = marks[t];
      var idx = -1;
      if(syl.indexOf('a') > -1) idx = syl.indexOf('a');
      else if(syl.indexOf('o') > -1) idx = syl.indexOf('o');
      else if(syl.indexOf('e') > -1) idx = syl.indexOf('e');
      else if(syl.indexOf('iu') > -1) idx = syl.indexOf('iu') + 1;
      else if(syl.indexOf('ui') > -1) idx = syl.indexOf('ui') + 1;
      else {
        for(var i = syl.length - 1; i >= 0; i--){
          if('iuvü'.indexOf(syl[i]) > -1 || syl[i] === 'ü'){ idx = i; break; }
        }
      }
      if(idx < 0) return syl;
      var ch = syl[idx];
      return syl.slice(0, idx) + (m[ch] || ch) + syl.slice(idx + 1);
    }

    S._open({
      title:'拼音',
      sub:'声母 · 韵母 · 整体认读 · 拼读器',
      icon:'pinyin',
      body:
        '<div id="py-comb-wrap">' +
          '<div class="py-comb">' +
            '<div class="slot" id="py-s1">?</div><span class="eq">+</span>' +
            '<div class="slot" id="py-s2">?</div><span class="eq">=</span>' +
            '<div class="slot out" id="py-out">—</div>' +
            '<button class="s-btn primary" id="py-play" style="margin-left:6px"><i class="fas fa-volume-high"></i>读</button>' +
            '<button class="s-btn" id="py-clear">清空</button>' +
          '</div>' +
          '<div class="chips" style="justify-content:center;margin-bottom:14px" id="py-tones"></div>' +
        '</div>' +
        '<div class="ipa-group"><div class="side-title">声母（23）</div><div class="py-grid" id="py-sm"></div></div>' +
        '<div class="ipa-group"><div class="side-title">韵母（24）</div><div class="py-grid" id="py-ym"></div></div>' +
        '<div class="ipa-group"><div class="side-title">整体认读（16）</div><div class="py-grid" id="py-zt"></div></div>',
      hint:'先点声母再点韵母，右侧合成音节；声调可单独选。点任意格子会朗读。',
      insert:{ label:'插入白板', get:function(api){
        api.insertHtmlCard({
          w: 900, h: 560, bg:'#FFFFFF', pad:44,
          lines: [
            { text:'拼音 · 声母韵母表', size:28, weight:'800', color:'#16241D', line:52 },
            { text:'声母：' + SHENGMU.join('  '), size:20, color:'#2C3A33', line:44, wrap:true },
            { text:'韵母：' + YUNMU.join('  '), size:20, color:'#2C3A33', line:44, wrap:true },
            { text:'整体认读：' + ZHENGTI.join('  '), size:20, color:'#2C3A33', line:44, wrap:true },
            { text: pick.s || pick.y ? ('拼读：' + (pick.s + pick.y) + ' = ' + outText()) : '拼读：点击声母 + 韵母合成音节', size:20, color:'#1B8641', line:44, wrap:true }
          ]
        });
      }},
      onMount:function(api){
        var smWrap = api.pane.querySelector('#py-sm');
        var ymWrap = api.pane.querySelector('#py-ym');
        var ztWrap = api.pane.querySelector('#py-zt');
        smWrap.innerHTML = SHENGMU.map(function(x){ return '<button class="py-cell" data-t="s" data-v="' + x + '">' + x + '</button>'; }).join('');
        ymWrap.innerHTML = YUNMU.map(function(x){ return '<button class="py-cell" data-t="y" data-v="' + x + '">' + x + '</button>'; }).join('');
        ztWrap.innerHTML = ZHENGTI.map(function(x){ return '<button class="py-cell" data-t="z" data-v="' + x + '">' + x + '</button>'; }).join('');
        var toneWrap = api.pane.querySelector('#py-tones');
        toneWrap.innerHTML = '<span class="lbl" style="margin:0 6px 0 0">声调</span>' + TONES.map(function(t, i){
          return '<button class="chip' + (i === 0 ? ' on' : '') + '" data-tone="' + t.n + '">' + t.m + '</button>';
        }).join('');
        toneWrap.querySelectorAll('.chip').forEach(function(b){
          b.onclick = function(){
            toneWrap.querySelectorAll('.chip').forEach(function(x){ x.classList.toggle('on', x === b); });
            tone = +b.dataset.tone;
            paint();
          };
        });

        function paint(){
          api.pane.querySelector('#py-s1').textContent = pick.s || '?';
          api.pane.querySelector('#py-s2').textContent = pick.y || '?';
          api.pane.querySelector('#py-out').textContent = outText();
        }
        api.pane.addEventListener('click', function(e){
          var b = e.target.closest('.py-cell');
          if(!b) return;
          var t = b.dataset.t, v = b.dataset.v;
          if(t === 's'){ pick.s = v; pick.z = ''; }
          else if(t === 'y'){ pick.y = v; pick.z = ''; }
          else { pick.z = v; pick.s = ''; pick.y = ''; }
          api.pane.querySelectorAll('.py-cell').forEach(function(x){ x.classList.remove('hl'); });
          b.classList.add('hl');
          paint();
          var syl = outText();
          if(syl && syl !== '—') S._speak(syl, 'zh-CN', .8);
        });
        api.pane.querySelector('#py-play').onclick = function(){
          var syl = outText();
          if(syl !== '—') S._speak(syl, 'zh-CN', .8);
        };
        api.pane.querySelector('#py-clear').onclick = function(){
          pick = { s:'', y:'', z:'' }; tone = 0;
          api.pane.querySelectorAll('.py-cell').forEach(function(x){ x.classList.remove('hl'); });
          toneWrap.querySelectorAll('.chip').forEach(function(x, i){ x.classList.toggle('on', i === 0); });
          paint();
        };
        paint();
      }
    });
  };

  /* ===================== 3. 古诗词 ===================== */
  /* 诗库放 data/poems.js（80 首），打开时懒加载，避免首屏变大 */
  var POEMS = [];
  function loadPoems(cb){
    if(window.EN10_POEMS && window.EN10_POEMS.length){ POEMS = window.EN10_POEMS; cb(); return; }
    var sc = document.createElement('script');
    sc.src = 'data/poems.js';
    sc.onload = function(){ POEMS = window.EN10_POEMS || []; cb(); };
    sc.onerror = function(){ EN10.toast('诗库加载失败：data/poems.js', 'fa-exclamation-triangle'); cb(); };
    document.head.appendChild(sc);
  }

  S.poem = function(){
    var idx = 0;
    var kw = '';
    var dynasty = '全部';
    var view = [];

    S._open({
      title:'古诗词',
      sub:'离线诗库 · 注释 · 朗读',
      icon:'poem',
      body:
        '<div class="poem-wrap">' +
          '<div class="poem-side">' +
            '<input class="field sm" id="pm-search" placeholder="搜索题目 / 作者 / 诗句">' +
            '<div class="chips" id="pm-dyn" style="margin:8px 0"></div>' +
            '<div class="poem-list" id="pm-list"></div>' +
            '<div class="pm-count" id="pm-count"></div>' +
          '</div>' +
          '<div class="poem-paper" id="pm-paper"><div class="pm-empty">选择左侧诗词查看</div></div>' +
        '</div>',
      hint:'点诗句可单句朗读，点标题旁的喇叭可整首朗读；诗库离线内置，不联网也能用。',
      insert:{ label:'插入诗词', get:function(api){
        var p = POEMS[idx];
        if(!p){ EN10.toast('先选一首诗','fa-exclamation-triangle'); return false; }
        api.insertHtmlCard({
          w: 900, h: 640, bg:'#FFFDF7', borderColor:'#EFE7D5', pad:56,
          lines: [
            { text:p.t, size:34, weight:'800', color:'#2A2418', align:'center', line:54 },
            { text:p.d + ' · ' + p.a, size:16, color:'#8B7E68', align:'center', line:46 },
            { gap:10 }
          ].concat(p.l.map(function(line){
            return { text:line, size:26, color:'#2E2820', align:'center', line:52, font:'"Kaiti SC","STKaiti","KaiTi",serif' };
          })).concat([
            { gap:10 },
            { text:'注释：' + p.n, size:13.5, color:'#6B6252', line:24, wrap:true, font:'"PingFang SC",sans-serif' }
          ])
        });
      }},
      onMount:function(api){
        var list = api.pane.querySelector('#pm-list');
        var paper = api.pane.querySelector('#pm-paper');
        var search = api.pane.querySelector('#pm-search');
        var dynBox = api.pane.querySelector('#pm-dyn');
        var countEl = api.pane.querySelector('#pm-count');

        function dynasties(){
          var set = {};
          POEMS.forEach(function(p){ set[p.d] = 1; });
          return ['全部'].concat(Object.keys(set));
        }
        function refreshDyn(){
          dynBox.innerHTML = dynasties().map(function(d){
            return '<button class="chip' + (d === dynasty ? ' on' : '') + '" data-d="' + esc(d) + '">' + esc(d) + '</button>';
          }).join('');
          dynBox.querySelectorAll('[data-d]').forEach(function(b){
            b.onclick = function(){ dynasty = b.dataset.d; refreshDyn(); filter(); };
          });
        }
        function filter(){
          var q = kw.trim();
          view = POEMS.filter(function(p){
            if(dynasty !== '全部' && p.d !== dynasty) return false;
            if(!q) return true;
            if(p.t.indexOf(q) > -1 || p.a.indexOf(q) > -1 || p.d.indexOf(q) > -1) return true;
            return p.l.join('').indexOf(q) > -1;
          });
          if(!view.length){ idx = 0; }
          else if(view.indexOf(POEMS[idx]) < 0) idx = 0;
          renderList();
          render();
        }
        function renderList(){
          if(!view.length){
            list.innerHTML = '<div class="pm-empty">没有匹配的诗词</div>';
            countEl.textContent = '';
            return;
          }
          list.innerHTML = view.map(function(p, i){
            var real = POEMS.indexOf(p);
            return '<button data-i="' + i + '" class="' + (real === idx ? 'on' : '') + '">' +
              '<b>' + esc(p.t) + '</b><span>' + esc(p.d) + ' · ' + esc(p.a) + '</span></button>';
          }).join('');
          list.querySelectorAll('button').forEach(function(b){
            b.onclick = function(){ idx = POEMS.indexOf(view[+b.dataset.i]); renderList(); render(); };
          });
          countEl.textContent = '共 ' + view.length + ' 首 / 诗库 ' + POEMS.length + ' 首';
        }
        function render(){
          var p = POEMS[idx];
          if(!p){ paper.innerHTML = '<div class="pm-empty">没有匹配的诗词</div>'; return; }
          paper.innerHTML =
            '<div class="poem-head">' +
              '<div style="flex:1"><h2 class="poem-title">' + esc(p.t) + '</h2>' +
              '<div class="poem-meta">' + esc(p.d) + ' · ' + esc(p.a) + '</div></div>' +
              '<button class="s-btn" id="pm-play" title="整首朗读"><i class="fas fa-volume-high"></i>朗读</button>' +
            '</div>' +
            '<div id="pm-lines">' + p.l.map(function(line, i){
              return '<div class="poem-line" data-i="' + i + '">' + esc(line) + '</div>';
            }).join('') + '</div>' +
            '<div class="poem-note"><b>注释：</b>' + esc(p.n) + '</div>';
          paper.querySelector('#pm-play').onclick = function(){ S._speak(p.t + '。' + p.l.join(''), 'zh-CN', .82); };
          paper.querySelectorAll('.poem-line').forEach(function(el){
            el.onclick = function(){
              paper.querySelectorAll('.poem-line').forEach(function(x){ x.classList.toggle('on', x === el); });
              S._speak(el.textContent, 'zh-CN', .8);
            };
          });
        }
        search.addEventListener('input', function(){ kw = search.value; filter(); });

        paper.innerHTML = '<div class="pm-empty">正在加载诗库…</div>';
        loadPoems(function(){
          refreshDyn();
          view = POEMS.slice();
          renderList();
          render();
        });
      }
    });
  };

  /* ===================== 4. 四线三格 ===================== */
  S.rule = function(){
    var text = 'Hello, boys and girls!';
    var size = 64;
    var color = '#1F6FEB';
    var cvs, cv, c;

    S._open({
      title:'四线三格',
      sub:'英语书写格 · 可导出贴到白板',
      icon:'rule',
      body:
        '<div class="rule-tools">' +
          '<input class="field" id="rl-text" value="' + esc(text) + '" placeholder="输入英文内容" style="max-width:320px">' +
          '<label class="lbl" style="margin:0">字号</label>' +
          '<input type="range" class="set-range" id="rl-size" min="24" max="120" value="' + size + '" style="width:130px">' +
          '<div class="chips" id="rl-colors"></div>' +
        '</div>' +
        '<div id="rl-stage" class="canvas-wrap"></div>',
      hint:'四线三格按英语书写规范绘制：字母主体占中间格，上扬笔画到上格，下沉笔画到下格。',
      insert:{ label:'插入白板', get:function(api){
        api.insertCanvas(cv, 1);
      }},
      onMount:function(api){
        var stage = api.pane.querySelector('#rl-stage');
        var input = api.pane.querySelector('#rl-text');
        var range = api.pane.querySelector('#rl-size');
        var colors = api.pane.querySelector('#rl-colors');
        var COLORS = ['#1F6FEB', '#16241D', '#D9362B', '#1B8641'];
        colors.innerHTML = COLORS.map(function(c, i){
          return '<span class="bib-dot' + (i === 0 ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></span>';
        }).join('');
        colors.querySelectorAll('.bib-dot').forEach(function(d){
          d.onclick = function(){
            color = d.dataset.c;
            colors.querySelectorAll('.bib-dot').forEach(function(x){ x.classList.toggle('on', x === d); });
            draw();
          };
        });

        function build(){
          var fit = S._fit(stage);
          cvs = S._canvas(fit.W, fit.H);
          cv = cvs.cv; c = cvs.c;
          stage.innerHTML = '';
          stage.appendChild(cv);
          cv.className = 'tool-canvas';
          draw();
        }
        function draw(){
          if(!c) return;
          var W = cvs.w, H = cvs.h;
          c.clearRect(0, 0, W, H);
          c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
          /* 按画布比例排版：小屏也不会挤成一条 */
          var padX = Math.max(14, Math.round(W * 0.05));
          var top = Math.round(H * 0.14);
          var lineGap = Math.max(24, (H * 0.70) / 3);
          var fsz = Math.min(size, Math.max(18, lineGap * 0.92));
          c.strokeStyle = '#4A6FA5'; c.lineWidth = 1.2;
          for(var i = 0; i <= 3; i++){
            var y = top + i * lineGap;
            c.beginPath();
            c.moveTo(padX, y); c.lineTo(W - padX, y);
            c.stroke();
          }
          // 中格淡底，帮助识别书写区
          c.fillStyle = 'rgba(31,111,235,.03)';
          c.fillRect(padX, top + lineGap, W - padX * 2, lineGap);
          c.fillStyle = color;
          c.textBaseline = 'alphabetic';
          c.textAlign = 'left';
          var maxW = W - padX * 2;
          var font = '400 ' + fsz + 'px "ENHand","Comic Sans MS","Segoe Print",cursive';
          c.font = font;
          var lines = [], cur = '';
          for(var k = 0; k < text.length; k++){
            var ch = text[k];
            if(ch === '\n'){ lines.push(cur); cur = ''; continue; }
            var t2 = cur + ch;
            if(c.measureText(t2).width > maxW && cur){ lines.push(cur); cur = ch; }
            else cur = t2;
          }
          if(cur) lines.push(cur);
          var baseY = top + lineGap * 2.1;
          lines.slice(0, 4).forEach(function(line, i){
            var by = baseY + i * lineGap;
            if(by > H - 20) return;
            // 逐字绘制：让字母落在基线，形成书写感
            var x = padX;
            for(var j = 0; j < line.length; j++){
              var cw = c.measureText(line[j]).width;
              c.fillText(line[j], x, by);
              x += cw;
            }
          });
          c.fillStyle = '#C6D0DA'; c.font = '12px "PingFang SC",sans-serif';
          c.fillText('四线三格 · ParkerEasiNote', padX, H - 18);
        }
        input.addEventListener('input', function(){ text = input.value; draw(); });
        range.addEventListener('input', function(){ size = +range.value; draw(); });
        if(document.fonts && document.fonts.load){
          document.fonts.load('40px ENHand').then(function(){ draw(); }, function(){});
        }
        build();
        S._observe(stage, build);
        setTimeout(build, 120);
      }
    });
  };

  /* ===================== 5. 音标 ===================== */
  var IPA = [
    { g:'元音 · 短元音', list:[['ɪ','sit'],['e','bed'],['æ','cat'],['ʌ','cup'],['ɒ','hot'],['ʊ','book'],['ə','about']] },
    { g:'元音 · 长元音', list:[['iː','see'],['ɑː','car'],['ɔː','door'],['uː','food'],['ɜː','bird']] },
    { g:'双元音', list:[['eɪ','day'],['aɪ','my'],['ɔɪ','boy'],['aʊ','now'],['əʊ','go'],['ɪə','here'],['eə','hair'],['ʊə','tour']] },
    { g:'辅音 · 清辅音', list:[['p','pen'],['t','ten'],['k','key'],['f','five'],['θ','think'],['s','see'],['ʃ','she'],['tʃ','chair'],['tr','tree'],['ts','cats'],['h','hat']] },
    { g:'辅音 · 浊辅音', list:[['b','bag'],['d','dog'],['g','go'],['v','very'],['ð','this'],['z','zoo'],['ʒ','measure'],['dʒ','job'],['dr','dream'],['dz','beds'],['r','red']] },
    { g:'其他辅音', list:[['m','man'],['n','no'],['ŋ','sing'],['l','leg'],['w','we'],['j','yes']] }
  ];

  S.ipa = function(){
    S._open({
      title:'音标',
      sub:'48 个国际音标 · 点击朗读例词',
      icon:'ipa',
      body: IPA.map(function(g, gi){
        return '<div class="ipa-group"><div class="side-title">' + g.g + '</div><div class="ipa-grid">' +
          g.list.map(function(x){
            return '<button class="ipa-cell" data-w="' + x[1] + '"><b>' + x[0] + '</b><small>' + x[1] + '</small></button>';
          }).join('') + '</div></div>';
      }).join(''),
      hint:'朗读使用系统英语语音，点击格子会读例词；没有声音时请检查系统的语音包。',
      insert:{ label:'插入音标表', get:function(api){
        api.insertHtmlCard({
          w: 980, h: 700, bg:'#fff', pad:40,
          lines: [
            { text:'国际音标（IPA）', size:28, weight:'800', color:'#16241D', line:52 }
          ].concat(IPA.map(function(g){
            return { text:g.g + '：' + g.list.map(function(x){ return x[0] + '(' + x[1] + ')'; }).join('  '), size:16, color:'#33413A', line:40, wrap:true };
          }))
        });
      }},
      onMount:function(api){
        api.pane.addEventListener('click', function(e){
          var b = e.target.closest('.ipa-cell');
          if(!b) return;
          api.pane.querySelectorAll('.ipa-cell').forEach(function(x){ x.classList.remove('on'); });
          b.style.background = '#EAFBF0';
          setTimeout(function(){ b.style.background = ''; }, 320);
          S._speak(b.dataset.w, 'en-US', .8);
        });
      }
    });
  };

  /* ===================== 6. 听写 ===================== */
  var DICT_DEFAULT = 'apple, banana, orange, pencil, school, teacher, friend, water, happy, music, science, history';

  S.dictation = function(){
    var words = [], order = [], at = 0, right = 0, wrong = 0, answered = false;

    S._open({
      title:'听写',
      sub:'系统朗读 · 逐词听写 · 自动判分',
      icon:'dictation',
      narrow:true,
      body:
        '<div class="dictation-stage">' +
          '<div class="dict-progress" id="dt-prog">准备开始</div>' +
          '<button class="dict-speak" id="dt-speak" title="再听一遍"><i class="fas fa-volume-high"></i></button>' +
          '<div class="dict-answer">' +
            '<input class="field" id="dt-input" placeholder="听到什么就写什么" autocomplete="off" autocapitalize="off" spellcheck="false">' +
            '<button class="s-btn primary" id="dt-check" style="flex:0 0 auto">检查</button>' +
          '</div>' +
          '<div class="dict-feedback" id="dt-fb"></div>' +
          '<div class="chips" style="justify-content:center">' +
            '<button class="s-btn" id="dt-next">下一个</button>' +
            '<button class="s-btn" id="dt-restart">重新开始</button>' +
            '<button class="s-btn" id="dt-show">显示答案</button>' +
          '</div>' +
          '<div style="width:100%;max-width:520px;margin-top:6px">' +
            '<label class="lbl">听写词表（逗号或换行分隔）</label>' +
            '<textarea class="area" id="dt-words" style="min-height:80px">' + esc(DICT_DEFAULT) + '</textarea>' +
          '</div>' +
        '</div>',
      hint:'判分忽略大小写与首尾空格；答错会给出正确拼写。',
      onMount:function(api){
        var input = api.pane.querySelector('#dt-input');
        var fb = api.pane.querySelector('#dt-fb');
        var prog = api.pane.querySelector('#dt-prog');
        var area = api.pane.querySelector('#dt-words');
        function parse(){
          words = area.value.split(/[,，\n\r;；]+/).map(function(s){ return s.trim(); }).filter(Boolean);
          order = words.map(function(_, i){ return i; });
        }
        function start(){
          parse();
          if(!words.length){ EN10.toast('词表是空的', 'fa-exclamation-triangle'); return; }
          at = 0; right = 0; wrong = 0;
          // 打乱顺序
          for(var i = order.length - 1; i > 0; i--){
            var j = Math.floor(Math.random() * (i + 1));
            var t = order[i]; order[i] = order[j]; order[j] = t;
          }
          fb.textContent = ''; fb.className = 'dict-feedback';
          input.value = ''; input.disabled = false;
          ask();
        }
        function ask(){
          if(at >= order.length){ finish(); return; }
          answered = false;
          prog.textContent = '第 ' + (at + 1) + ' / ' + order.length + ' 个 · 答对 ' + right + ' · 答错 ' + wrong;
          var w = words[order[at]];
          S._speak(w, 'en-US', .78);
          input.focus();
        }
        function check(){
          if(answered) return;
          if(at >= order.length) return;
          var w = words[order[at]];
          var v = (input.value || '').trim();
          if(!v){ EN10.toast('先写答案再检查', 'fa-pencil'); return; }
          answered = true;
          if(v.toLowerCase() === w.toLowerCase()){
            right++;
            fb.textContent = '✓ 正确：' + w;
            fb.className = 'dict-feedback ok';
          } else {
            wrong++;
            fb.textContent = '✗ 正确写法：' + w;
            fb.className = 'dict-feedback no';
          }
        }
        function next(){
          if(!answered){ check(); return; }
          at++;
          input.value = '';
          if(at >= order.length){ finish(); return; }
          ask();
        }
        function finish(){
          input.disabled = true;
          var total = order.length;
          prog.textContent = '听写结束';
          fb.textContent = '共 ' + total + ' 个 · 答对 ' + right + ' · 答错 ' + wrong + ' · 正确率 ' + Math.round(right / total * 100) + '%';
          fb.className = 'dict-feedback ' + (right >= total * .8 ? 'ok' : 'no');
        }
        api.pane.querySelector('#dt-speak').onclick = function(){
          if(at < order.length) S._speak(words[order[at]], 'en-US', .72);
        };
        api.pane.querySelector('#dt-check').onclick = check;
        api.pane.querySelector('#dt-next').onclick = next;
        api.pane.querySelector('#dt-restart').onclick = start;
        api.pane.querySelector('#dt-show').onclick = function(){
          if(at < order.length){ fb.textContent = '答案：' + words[order[at]]; fb.className = 'dict-feedback'; }
        };
        input.addEventListener('keydown', function(e){
          if(e.key === 'Enter'){ e.preventDefault(); if(answered) next(); else check(); }
        });
        start();
      }
    });
  };
})();
