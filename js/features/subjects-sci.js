/* ============================================================
   理科工具：化学方程式（自动配平）· 3D 星球（旋转缩放）
   ============================================================ */
(function(){
  var S = window.EN10Subjects;
  var esc = S._esc;

  /* ===================== 1. 化学方程式 ===================== */
  var BANK = [
    { eq:'H2 + O2 -> H2O', note:'氢气在氧气中燃烧，淡蓝色火焰，放热，产物为水。' },
    { eq:'C + O2 -> CO2', note:'木炭在氧气中剧烈燃烧，发白光，放热，生成能使澄清石灰水变浑浊的气体。' },
    { eq:'Fe + O2 -> Fe3O4', note:'铁丝在氧气中燃烧，火星四射，生成黑色固体（集气瓶底需留少量水）。' },
    { eq:'Mg + O2 -> MgO', note:'镁条燃烧，发出耀眼白光，生成白色固体。' },
    { eq:'P + O2 -> P2O5', note:'红磷燃烧产生大量白烟，可用于测定空气中氧气含量。' },
    { eq:'H2O -> H2↑ + O2↑', note:'电解水：正极产生氧气，负极产生氢气，体积比约 1:2。' },
    { eq:'KClO3 -> KCl + O2↑', note:'加热氯酸钾（二氧化锰催化）制氧气。' },
    { eq:'KMnO4 -> K2MnO4 + MnO2 + O2↑', note:'加热高锰酸钾制氧气，试管口略向下倾斜。' },
    { eq:'CaCO3 -> CaO + CO2↑', note:'高温煅烧石灰石，工业制生石灰。' },
    { eq:'CO2 + Ca(OH)2 -> CaCO3↓ + H2O', note:'澄清石灰水变浑浊，用于检验二氧化碳。' },
    { eq:'CO + Fe2O3 -> Fe + CO2', note:'一氧化碳还原氧化铁，红棕色粉末变黑，尾气需处理。' },
    { eq:'Zn + HCl -> ZnCl2 + H2↑', note:'锌与稀盐酸反应，产生气泡，实验室制氢气。' },
    { eq:'NaOH + HCl -> NaCl + H2O', note:'中和反应，放热，酚酞由红变无色。' },
    { eq:'Na2CO3 + HCl -> NaCl + H2O + CO2↑', note:'产生大量气泡，可用于检验碳酸盐。' },
    { eq:'Fe + CuSO4 -> FeSO4 + Cu', note:'铁钉表面析出红色铜，溶液由蓝色变浅绿色。' },
    { eq:'CH4 + O2 -> CO2 + H2O', note:'甲烷（天然气）燃烧，淡蓝色火焰。' },
    { eq:'C2H5OH + O2 -> CO2 + H2O', note:'乙醇燃烧，放出大量热，可作燃料。' },
    { eq:'NH3 + HCl -> NH4Cl', note:'两种气体相遇产生白烟，可用于检验氨气。' }
  ];

  function gcd(a, b){ a = Math.abs(a); b = Math.abs(b); while(b){ var t = a % b; a = b; b = t; } return a || 1; }
  function lcm(a, b){ return Math.abs(a * b) / gcd(a, b); }

  /* 解析化学式 → {元素: 个数}，支持括号与嵌套 */
  function parseFormula(f){
    var i = 0;
    function group(){
      var map = {};
      while(i < f.length){
        var ch = f[i];
        if(ch === '(' || ch === '['){
          i++;
          var sub = group();
          var mult = 1, num = '';
          while(i < f.length && /\d/.test(f[i])) num += f[i++];
          if(num) mult = parseInt(num, 10);
          Object.keys(sub).forEach(function(k){ map[k] = (map[k] || 0) + sub[k] * mult; });
        } else if(ch === ')' || ch === ']'){
          i++;
          return map;
        } else if(/[A-Z]/.test(ch)){
          var el = ch; i++;
          while(i < f.length && /[a-z]/.test(f[i])) el += f[i++];
          var n = 1, d = '';
          while(i < f.length && /\d/.test(f[i])) d += f[i++];
          if(d) n = parseInt(d, 10);
          map[el] = (map[el] || 0) + n;
        } else if(ch === '·' || ch === '.' || ch === '*'){
          // 结晶水：把后面部分当作独立组分相加
          i++;
          var rest = f.slice(i);
          var m2 = parseFormula(rest);
          Object.keys(m2).forEach(function(k){ map[k] = (map[k] || 0) + m2[k]; });
          i = f.length;
          return map;
        } else {
          i++;
        }
      }
      return map;
    }
    return group();
  }

  function splitSide(side){
    return side.split('+').map(function(s){ return s.trim(); }).filter(Boolean);
  }
  /* ↑ 气体 / ↓ 沉淀：允许直接写在化学式后面，配平时先摘掉再算原子数 */
  function takeMark(f){ var m = /([↑↓])\s*$/.exec(f); return m ? m[1] : ''; }
  function stripMark(f){ return f.replace(/[↑↓]\s*$/, ''); }

  function balance(eq){
    var norm = eq.replace(/[=＝]/g, '->').replace(/→|—>|⟶/g, '->');
    var parts = norm.split('->');
    if(parts.length !== 2) throw new Error('请用 -> 或 = 分隔反应物与生成物');
    var leftRaw = splitSide(parts[0]), rightRaw = splitSide(parts[1]);
    var left = leftRaw.map(stripMark), right = rightRaw.map(stripMark);
    if(!left.length || !right.length) throw new Error('方程式不完整');
    var marks = leftRaw.map(takeMark).concat(rightRaw.map(takeMark));
    var species = left.concat(right);
    var counts = species.map(function(f){ return parseFormula(f.replace(/^\d+/, '')); });
    var atoms = {};
    counts.forEach(function(m){ Object.keys(m).forEach(function(k){ atoms[k] = 1; }); });
    var atomList = Object.keys(atoms);
    // 每个物种的原子数矩阵：左正右负
    var A = atomList.map(function(el){
      return counts.map(function(m, i){ return (m[el] || 0) * (i < left.length ? 1 : -1); });
    });
    // RREF 求零空间
    var rows = A.length, cols = species.length;
    var M = A.map(function(r){ return r.slice(); });
    var pivots = [];
    var r = 0;
    for(var c2 = 0; c2 < cols && r < rows; c2++){
      var piv = -1;
      for(var i2 = r; i2 < rows; i2++){ if(Math.abs(M[i2][c2]) > 1e-9){ piv = i2; break; } }
      if(piv < 0) continue;
      var tmp = M[r]; M[r] = M[piv]; M[piv] = tmp;
      var pv = M[r][c2];
      for(var j = 0; j < cols; j++) M[r][j] /= pv;
      for(var i3 = 0; i3 < rows; i3++){
        if(i3 === r) continue;
        var f2 = M[i3][c2];
        if(Math.abs(f2) < 1e-9) continue;
        for(var j2 = 0; j2 < cols; j2++) M[i3][j2] -= f2 * M[r][j2];
      }
      pivots.push(c2);
      r++;
    }
    var freeCols = [];
    for(var c3 = 0; c3 < cols; c3++){ if(pivots.indexOf(c3) < 0) freeCols.push(c3); }
    if(!freeCols.length) throw new Error('无法配平（可能已是唯一解或方程式有误）');
    var free = freeCols[0];
    var sol = new Array(cols).fill(0);
    sol[free] = 1;
    pivots.forEach(function(pc, ri){
      sol[pc] = -M[ri][free];
    });
    // 化整数：找最小公分母
    var den = 1;
    sol.forEach(function(v){ den = lcm(den, Math.round(1 / Math.abs(v - Math.round(v)) || 1)); });
    var ints = sol.map(function(v){ return Math.round(v * 1); });
    // 用更稳的方式：把所有值乘以 1000 后取整再约分
    var scaled = sol.map(function(v){ return Math.round(v * 100000); });
    var g = scaled.reduce(function(a, b){ return gcd(a, b); }, 0) || 1;
    ints = scaled.map(function(v){ return v / g; });
    var neg = ints.some(function(v){ return v < 0; });
    if(neg) ints = ints.map(function(v){ return -v; });
    if(ints.some(function(v){ return v <= 0; })) throw new Error('配平失败，请检查化学式');
    return {
      left: left.map(function(f, i){ return { f:f.replace(/^\d+/, ''), k:ints[i], m:marks[i] }; }),
      right: right.map(function(f, i){ return { f:f.replace(/^\d+/, ''), k:ints[left.length + i], m:marks[left.length + i] }; }),
      ints: ints
    };
  }

  /* 化学式 → 带下标与 ↑/↓ 的 HTML */
  function pretty(f, mark){
    var mk = mark || '';
    f = String(f || '');
    if(!mk){
      var mm = /([↑↓])\s*$/.exec(f);
      if(mm){ mk = mm[1]; f = f.slice(0, mm.index); }
    }
    return esc(f).replace(/([A-Za-z\)\]])(\d+)/g, '$1<sub>$2</sub>').replace(/·/g, '·') +
      (mk ? '<sup class="chem-mark">' + mk + '</sup>' : '');
  }

  S.chem = function(){
    var res = null;

    S._open({
      title:'化学方程式',
      sub:'自动配平 · 现象说明 · 常用方程式库',
      icon:'chem',
      body:
        '<div style="display:flex;flex-direction:column;gap:12px;height:100%">' +
          '<div><label class="lbl">输入方程式（用 -> 或 = 分隔，可不配平）</label>' +
            '<div style="display:flex;gap:8px"><input class="field" id="ch-input" value="Fe + O2 -> Fe3O4" placeholder="如 C2H5OH + O2 -> CO2 + H2O">' +
            '<button class="s-btn primary" id="ch-go" style="flex:0 0 auto">配平</button></div></div>' +
          '<div id="ch-result" style="flex:1;min-height:0;overflow:auto;background:#fff;border-radius:14px;border:1px solid #E6EBF0;padding:18px"></div>' +
        '</div>',
      side:
        '<div class="side-block"><div class="side-title">常用方程式</div><div class="chem-bank" id="ch-bank"></div></div>',
      hint:'支持括号、结晶水与有机物的完整配平；点左侧方程式可一键载入。',
      insert:{ label:'插入方程式', get:function(api){
        if(!res){ EN10.toast('先配平一个方程式', 'fa-exclamation-triangle'); return false; }
        var text = res.left.map(function(x){ return (x.k > 1 ? x.k : '') + x.f + (x.m || ''); }).join(' + ') + ' → ' +
                   res.right.map(function(x){ return (x.k > 1 ? x.k : '') + x.f + (x.m || ''); }).join(' + ');
        var cv = drawEq(text);
        api.insertCanvas(cv, 1);
      }},
      onMount:function(api){
        var input = api.pane.querySelector('#ch-input');
        var out = api.pane.querySelector('#ch-result');
        var bank = api.side.querySelector('#ch-bank');
        bank.innerHTML = BANK.map(function(b, i){
          return '<button data-i="' + i + '">' + pretty(b.eq.replace(/->/g, '→')) + '</button>';
        }).join('');
        bank.querySelectorAll('button').forEach(function(btn){
          btn.onclick = function(){
            input.value = BANK[+btn.dataset.i].eq;
            bank.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', x === btn); });
            api.pane.querySelector('#ch-note') && null;
            run(true);
          };
        });
        function renderResult(idx){
          if(!res) return;
          function side(arr, tag){
            return arr.map(function(x, i){
              return '<span class="chem-sp" data-side="' + tag + '" data-i="' + i + '" title="点击切换 ↑ / ↓ 标注">' +
                (x.k > 1 ? '<b>' + x.k + '</b>' : '') + pretty(x.f, x.m) + '</span>';
            }).join(' + ');
          }
          out.innerHTML =
            '<div class="chem-eq">' + side(res.left, 'l') + ' &nbsp;⟶&nbsp; ' + side(res.right, 'r') + '</div>' +
            '<div style="text-align:center;font-size:11px;color:#96A1AC;letter-spacing:1px">已配平 · 点化学式可加 ↑ 气体 / ↓ 沉淀</div>' +
            (idx > -1 ? '<div class="poem-note" style="margin-top:16px"><b>现象：</b>' + esc(BANK[idx].note) + '</div>' : '') +
            '<div class="poem-note" style="margin-top:10px"><b>系数比：</b>' + res.ints.join(' : ') + '</div>';
          out.querySelectorAll('.chem-sp').forEach(function(el){
            el.onclick = function(){
              var arr = el.getAttribute('data-side') === 'l' ? res.left : res.right;
              var it = arr[+el.getAttribute('data-i')];
              if(!it) return;
              it.m = it.m === '↑' ? '↓' : (it.m === '↓' ? '' : '↑');
              renderResult(idx);
            };
          });
        }
        function run(fromBank){
          var eq = input.value.trim();
          if(!eq){ EN10.toast('先输入方程式', 'fa-pencil'); return; }
          var idx = -1;
          BANK.forEach(function(b, i){ if(b.eq.replace(/\s/g, '') === eq.replace(/\s/g, '')) idx = i; });
          try{
            res = balance(eq);
            renderResult(idx);
          }catch(e){
            res = null;
            out.innerHTML = '<div class="panel-empty" style="height:auto;padding:30px 0;color:#C0392B">' + esc(e.message) + '<br><span style="color:#96A1AC">例：Fe + O2 -> Fe3O4</span></div>';
          }
        }
        api.pane.querySelector('#ch-go').onclick = function(){ run(); };
        input.addEventListener('keydown', function(e){ if(e.key === 'Enter') run(); });
        run();
      }
    });

    function drawEq(text){
      var W = 900, H = 190;
      var cvs = S._canvas(W, H);
      var c = cvs.c;
      c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
      c.strokeStyle = '#E6EBF0'; c.lineWidth = 2; c.strokeRect(1, 1, W - 2, H - 2);
      // 逐段绘制，数字自动变下标
      var x = 46, base = H / 2 + 18;
      c.fillStyle = '#16241D';
      c.font = '600 40px "PingFang SC","Microsoft YaHei",sans-serif';
      c.textBaseline = 'alphabetic';
      for(var i = 0; i < text.length; i++){
        var ch = text[i];
        var isSub = /\d/.test(ch) && i > 0 && /[A-Za-z\)\]]/.test(text[i - 1]);
        var isMark = ch === '↑' || ch === '↓';
        var label = ch === '->' ? '→' : ch;
        if(ch === '-' && text[i + 1] === '>'){ label = '→'; i++; }
        if(isMark){
          c.font = '700 26px "PingFang SC",sans-serif';
          c.fillText(ch, x + 2, base - 24);
          x += c.measureText(ch).width + 4;
        } else if(isSub){
          c.font = '600 24px "PingFang SC",sans-serif';
          c.fillText(ch, x, base + 10);
          x += c.measureText(ch).width + 1;
        } else {
          c.font = '600 40px "PingFang SC","Microsoft YaHei",sans-serif';
          c.fillText(label, x, base);
          x += c.measureText(label).width + 2;
        }
      }
      c.fillStyle = '#C6D0DA'; c.font = '12px "PingFang SC",sans-serif';
      c.fillText('ParkerEasiNote · 化学方程式', 46, H - 18);
      return cvs.cv;
    }
  };

  /* ===================== 2. 3D 星球 ===================== */
  var PLANETS = [
    { name:'水星', r:1.2, d:7, color:'#9C8E80', speed:.024, info:'离太阳最近，无大气，昼夜温差可达 600℃。' },
    { name:'金星', r:1.9, d:10, color:'#E2B96B', speed:.018, info:'浓密的二氧化碳大气造成强烈温室效应，表面约 460℃。' },
    { name:'地球', r:2.0, d:13.5, color:'#2E7BC4', speed:.015, info:'目前已知唯一存在生命的行星，71% 表面被水覆盖。' },
    { name:'火星', r:1.6, d:17, color:'#C1572F', speed:.012, info:'红色来自表面氧化铁；拥有太阳系最高的火山奥林匹斯山。' },
    { name:'木星', r:4.4, d:24, color:'#D9B48A', speed:.009, info:'太阳系最大的行星，大红斑是持续数百年的巨型风暴。' },
    { name:'土星', r:3.8, d:31, color:'#E0CE9A', speed:.007, info:'壮观的行星环由冰粒与岩石碎块组成，厚度却不足 1 公里。' },
    { name:'天王星', r:2.6, d:37, color:'#8FD3D8', speed:.005, info:'自转轴几乎躺倒，像滚球一样绕太阳公转。' },
    { name:'海王星', r:2.5, d:43, color:'#3E6FD1', speed:.004, info:'风速可达 2100 km/h，是太阳系风暴最猛烈的行星。' }
  ];

  function fallback2D(stage, api){
    var cv = document.createElement('canvas');
    cv.style.cssText = 'display:block;width:100%;height:100%';
    stage.insertBefore(cv, stage.firstChild);
    var c = cv.getContext('2d');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = 0, H = 0;
    var rot = { x:.42, y:.6 }, target = { x:.42, y:.6 }, dist = 78, tdist = 78;
    var focus = -1, paused = false, raf = 0;
    var angles = PLANETS.map(function(){ return Math.random() * Math.PI * 2; });
    var stars = [];
    for(var i = 0; i < 220; i++) stars.push({ x:Math.random(), y:Math.random(), r:Math.random() * 1.4 + .3, a:Math.random() * .6 + .25 });

    function resize(){
      W = stage.clientWidth || 700; H = stage.clientHeight || 520;
      cv.width = W * dpr; cv.height = H * dpr;
    }
    resize();
    if(window.ResizeObserver) new ResizeObserver(resize).observe(stage);

    function project(x, y, z){
      // 先绕 Y 轴，再绕 X 轴，再做透视投影
      var cy = Math.cos(target.y), sy = Math.sin(target.y);
      var x1 = x * cy - z * sy, z1 = x * sy + z * cy;
      var cx = Math.cos(target.x), sx = Math.sin(target.x);
      var y1 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
      var k = Math.min(W, H) / 108 * (78 / dist);   // 单位 → 像素
      var f = 620 / (620 + z2);
      return { x:W / 2 + x1 * f * k, y:H / 2 + y1 * f * k, z:z2, f:f * k };
    }

    function draw(){
      if(!c) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      var g = c.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * .7);
      g.addColorStop(0, '#0B1A2A'); g.addColorStop(1, '#03060C');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      stars.forEach(function(st){
        c.beginPath(); c.arc(st.x * W, st.y * H, st.r, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,' + st.a + ')'; c.fill();
      });
      // 轨道
      PLANETS.forEach(function(p, i){
        c.beginPath();
        for(var a = 0; a <= 72; a++){
          var ang = a / 72 * Math.PI * 2;
          var q = project(Math.cos(ang) * p.d, 0, Math.sin(ang) * p.d);
          if(a === 0) c.moveTo(q.x, q.y); else c.lineTo(q.x, q.y);
        }
        c.strokeStyle = 'rgba(111,216,168,.18)'; c.lineWidth = 1; c.stroke();
      });
      // 太阳
      var sn = project(0, 0, 0);
      var sr = 5 * sn.f;
      var sg = c.createRadialGradient(sn.x, sn.y, 2, sn.x, sn.y, sr * 1.9);
      sg.addColorStop(0, 'rgba(255,240,190,1)'); sg.addColorStop(.45, 'rgba(255,205,110,.9)');
      sg.addColorStop(1, 'rgba(255,160,60,0)');
      c.beginPath(); c.arc(sn.x, sn.y, sr * 1.9, 0, Math.PI * 2); c.fillStyle = sg; c.fill();
      c.beginPath(); c.arc(sn.x, sn.y, sr, 0, Math.PI * 2); c.fillStyle = '#FFD27A'; c.fill();

      // 行星（远的先画）
      var order = PLANETS.map(function(p, i){
        var q = project(Math.cos(angles[i]) * p.d, 0, Math.sin(angles[i]) * p.d);
        return { i:i, q:q };
      }).sort(function(a, b){ return b.q.z - a.q.z; });

      order.forEach(function(o){
        var p = PLANETS[o.i], q = o.q;
        var r = Math.max(2.5, p.r * q.f * 1.05);
        // 光晕
        var pg = c.createRadialGradient(q.x - r * .3, q.y - r * .3, r * .12, q.x, q.y, r * 1.25);
        pg.addColorStop(0, '#ffffff');
        pg.addColorStop(.35, p.color);
        pg.addColorStop(1, 'rgba(0,0,0,.85)');
        // 土星环
        if(p.name === '土星'){
          c.save();
          c.beginPath(); c.ellipse(q.x, q.y, r * 2.2, r * .7, -.35, 0, Math.PI * 2);
          c.strokeStyle = 'rgba(232,217,176,.6)'; c.lineWidth = Math.max(1.5, r * .28); c.stroke();
          c.restore();
        }
        c.beginPath(); c.arc(q.x, q.y, r, 0, Math.PI * 2); c.fillStyle = pg; c.fill();
        if(o.i === focus){
          c.beginPath(); c.arc(q.x, q.y, r + 6, 0, Math.PI * 2);
          c.strokeStyle = 'rgba(45,195,96,.85)'; c.lineWidth = 2; c.stroke();
        }
      });
    }

    var chips = stage.querySelector('#pl-chips');
    chips.innerHTML = '<button data-i="-1" class="on">全景</button>' + PLANETS.map(function(p, i){
      return '<button data-i="' + i + '">' + p.name + '</button>';
    }).join('');
    var info = stage.querySelector('#pl-info');
    function setFocus(i){
      focus = i;
      tdist = i < 0 ? 78 : Math.max(20, PLANETS[i].d * .8);
      chips.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', +x.dataset.i === i); });
      if(i < 0) info.innerHTML = '<h4>太阳系</h4><p>拖动旋转 · 滚轮缩放 · 点击行星查看资料</p>';
      else info.innerHTML = '<h4>' + PLANETS[i].name + '</h4><p>' + PLANETS[i].info + '</p>';
    }
    chips.addEventListener('click', function(e){
      var b = e.target.closest('button'); if(!b) return; setFocus(+b.dataset.i);
    });
    var list = api.side.querySelector('#pl-list');
    list.innerHTML = PLANETS.map(function(p, i){ return '<button class="chip" data-i="' + i + '">' + p.name + '</button>'; }).join('');
    list.querySelectorAll('.chip').forEach(function(b){ b.onclick = function(){ setFocus(+b.dataset.i); }; });
    api.side.querySelector('#pl-reset').onclick = function(){ setFocus(-1); target = { x:.42, y:.6 }; };
    var pauseBtn = api.side.querySelector('#pl-pause');
    pauseBtn.onclick = function(){
      paused = !paused;
      pauseBtn.textContent = paused ? '继续公转' : '暂停公转';
      pauseBtn.classList.toggle('on', paused);
    };

    var drag = null;
    cv.style.cursor = 'grab';
    cv.addEventListener('pointerdown', function(e){
      cv.setPointerCapture(e.pointerId);
      drag = { x:e.clientX, y:e.clientY, rx:target.x, ry:target.y };
      cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', function(e){
      if(!drag) return;
      /* 跟手：向右拖 → 画面向右转；向下拖 → 画面向下转 */
      target.y = drag.ry - (e.clientX - drag.x) * .006;
      target.x = Math.max(-1.3, Math.min(1.3, drag.rx + (e.clientY - drag.y) * .005));
    });
    function up(e){ drag = null; cv.style.cursor = 'grab'; try{ cv.releasePointerCapture(e.pointerId); }catch(err){} }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', function(e){
      e.preventDefault();
      tdist = Math.max(18, Math.min(180, tdist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
    }, { passive:false });

    var last = performance.now();
    (function loop(now){
      raf = requestAnimationFrame(loop);
      var dt = Math.min(64, now - last) / 16.67; last = now;
      rot.x += (target.x - rot.x) * .14;
      rot.y += (target.y - rot.y) * .14;
      dist += (tdist - dist) * .1;
      // 用 rot 覆盖投影（project 里读的是 target，这里同步一下）
      target.x = target.x; target.y = target.y;
      if(!paused){
        angles = angles.map(function(a, i){ return a + PLANETS[i].speed * dt * .35; });
      }
      // 投影用平滑后的 rot
      var saveT = { x:target.x, y:target.y };
      target.x = rot.x; target.y = rot.y;
      draw();
      target.x = saveT.x; target.y = saveT.y;
    })(performance.now());

    window.EN10Subjects._planetShot = function(){ draw(); return cv; };
    window.EN10Subjects._planetStop = function(){ if(raf) cancelAnimationFrame(raf); raf = 0; };
  }

  S.planet = function(){
    var renderer, scene, camera, raf = 0, bodies = [], sun, stars;
    var rot = { x:.35, y:.6 }, targetRot = { x:.35, y:.6 }, dist = 78, targetDist = 78;
    var focus = -1;
    var paused = false;

    S._open({
      title:'3D 星球',
      sub:'太阳系模型 · 拖动旋转 · 滚轮缩放',
      icon:'planet',
      body:'<div class="planet-stage" id="pl-stage"><div class="planet-chip" id="pl-chips"></div>' +
        '<div class="planet-info" id="pl-info"><h4>太阳系</h4><p>拖动旋转 · 滚轮缩放 · 点击下方行星查看资料</p></div>' +
        '<div class="planet-hud"><span>拖动 = 旋转　滚轮/双指 = 缩放</span><span>数据为示意比例，非等比例模型</span></div></div>',
      side:
        '<div class="side-block"><div class="side-title">行星</div><div class="chips" id="pl-list"></div></div>' +
        '<div class="side-block"><div class="side-title">视角</div><div class="chips">' +
          '<button class="chip" id="pl-reset">复位</button><button class="chip" id="pl-pause">暂停公转</button></div></div>' +
        '<div class="side-block" style="font-size:11.5px;line-height:1.8;color:#8B97A2">提示：把光标放到行星上滚轮缩放，可以看细节；课堂演示时建议全屏投影。</div>',
      hint:'「插入白板」会把当前视角截图贴到板书，方便讲完再回看。',
      insert:{ label:'截图插入', get:function(api){
        var shot = EN10Subjects._planetShot;
        if(!shot){ EN10.toast('3D 场景还没准备好', 'fa-exclamation-triangle'); return false; }
        var cv = shot();
        if(!cv){ EN10.toast('画面还没准备好', 'fa-exclamation-triangle'); return false; }
        api.insertCanvas(cv, 1);
      }},
      onMount:function(api){
        var stage = api.pane.querySelector('#pl-stage');
        if(!window.THREE){
          stage.innerHTML = '<div class="panel-empty" style="color:#fff">3D 引擎未加载</div>';
          return;
        }
        var W = stage.clientWidth || 700, H = stage.clientHeight || 520;

        try{
          renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true, alpha:true });
        }catch(err){
          renderer = null;
        }
        if(!renderer){
          /* 没有 WebGL（部分老设备 / 远程桌面）时退到 2D 投影渲染，旋转缩放一样可用 */
          return fallback2D(stage, api);
        }
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(W, H);
        EN10Subjects._planetShot = function(){
          try{ renderer.render(scene, camera); }catch(e){}
          return renderer.domElement;
        };
        stage.insertBefore(renderer.domElement, stage.firstChild);

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(45, W / H, .1, 3000);
        camera.position.set(0, 26, dist);

        scene.add(new THREE.AmbientLight(0xffffff, .55));
        var sunLight = new THREE.PointLight(0xfff0c0, 2.4, 0, 2);
        scene.add(sunLight);

        // 星空
        var sg = new THREE.BufferGeometry();
        var pos = [];
        for(var i = 0; i < 1800; i++){
          var rr = 300 + Math.random() * 500;
          var th = Math.random() * Math.PI * 2;
          var ph = Math.acos(Math.random() * 2 - 1);
          pos.push(rr * Math.sin(ph) * Math.cos(th), rr * Math.cos(ph), rr * Math.sin(ph) * Math.sin(th));
        }
        sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        stars = new THREE.Points(sg, new THREE.PointsMaterial({ color:0xffffff, size:1.6, sizeAttenuation:true, opacity:.85, transparent:true }));
        scene.add(stars);

        // 太阳
        sun = new THREE.Mesh(
          new THREE.SphereGeometry(5, 48, 48),
          new THREE.MeshBasicMaterial({ color:0xFFD27A })
        );
        scene.add(sun);
        var glow = new THREE.Mesh(
          new THREE.SphereGeometry(6.4, 32, 32),
          new THREE.MeshBasicMaterial({ color:0xFFB340, transparent:true, opacity:.18 })
        );
        scene.add(glow);

        function makeTexture(base, bands, spot){
          var cv = document.createElement('canvas');
          cv.width = 512; cv.height = 256;
          var c = cv.getContext('2d');
          c.fillStyle = base; c.fillRect(0, 0, 512, 256);
          for(var i = 0; i < 26; i++){
            var y = Math.random() * 256;
            var h = 3 + Math.random() * 16;
            c.fillStyle = 'rgba(255,255,255,' + (Math.random() * .12 + .03) + ')';
            c.fillRect(0, y, 512, h);
            c.fillStyle = 'rgba(0,0,0,' + (Math.random() * .1 + .02) + ')';
            c.fillRect(0, y + h, 512, h * .5);
          }
          // 斑点
          for(var j = 0; j < 40; j++){
            var x = Math.random() * 512, y2 = Math.random() * 256, r = 3 + Math.random() * 16;
            c.beginPath(); c.arc(x, y2, r, 0, Math.PI * 2);
            c.fillStyle = 'rgba(0,0,0,' + (Math.random() * .12) + ')';
            c.fill();
          }
          var tex = new THREE.CanvasTexture(cv);
          tex.anisotropy = 4;
          return tex;
        }

        PLANETS.forEach(function(p, i){
          var pivot = new THREE.Object3D();
          scene.add(pivot);
          var tex = makeTexture(p.color);
          var mesh = new THREE.Mesh(
            new THREE.SphereGeometry(p.r, 40, 40),
            new THREE.MeshStandardMaterial({ map:tex, roughness:.92, metalness:.02 })
          );
          mesh.position.x = p.d;
          mesh.userData.idx = i;
          pivot.add(mesh);
          // 轨道
          var pts = [];
          for(var a = 0; a <= 128; a++){
            var ang = a / 128 * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(ang) * p.d, 0, Math.sin(ang) * p.d));
          }
          var orbit = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color:0x6FD8A8, transparent:true, opacity:.16 })
          );
          scene.add(orbit);
          // 土星环
          if(p.name === '土星'){
            var ring = new THREE.Mesh(
              new THREE.RingGeometry(p.r * 1.4, p.r * 2.3, 64),
              new THREE.MeshBasicMaterial({ color:0xE8D9B0, transparent:true, opacity:.55, side:THREE.DoubleSide })
            );
            ring.rotation.x = Math.PI / 2.3;
            mesh.add(ring);
          }
          bodies.push({ pivot:pivot, mesh:mesh, p:p, angle:Math.random() * Math.PI * 2 });
        });

        // 标签用 CSS 画不方便跟随，这里点击拾取 + 侧栏列表
        var chips = stage.querySelector('#pl-chips');
        chips.innerHTML = '<button data-i="-1" class="on">全景</button>' + PLANETS.map(function(p, i){
          return '<button data-i="' + i + '">' + p.name + '</button>';
        }).join('');
        chips.addEventListener('click', function(e){
          var b = e.target.closest('button');
          if(!b) return;
          chips.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', x === b); });
          setFocus(+b.dataset.i);
        });

        var list = api.side.querySelector('#pl-list');
        list.innerHTML = PLANETS.map(function(p, i){ return '<button class="chip" data-i="' + i + '">' + p.name + '</button>'; }).join('');
        list.querySelectorAll('.chip').forEach(function(b){
          b.onclick = function(){ setFocus(+b.dataset.i); };
        });

        var info = stage.querySelector('#pl-info');
        function setFocus(i){
          focus = i;
          targetDist = i < 0 ? 78 : Math.max(12, PLANETS[i].d * .95 + PLANETS[i].r * 4);
          if(i < 0){
            info.innerHTML = '<h4>太阳系</h4><p>拖动旋转 · 滚轮缩放 · 点击行星查看资料</p>';
          } else {
            var p = PLANETS[i];
            info.innerHTML = '<h4>' + p.name + '</h4><p>' + p.info + '</p>' +
              '<p style="margin-top:6px;color:#8FD3B8">半径 ' + p.r.toFixed(1) + ' 单位 · 轨道 ' + p.d + ' 单位</p>';
          }
          chips.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', +x.dataset.i === i); });
        }

        api.side.querySelector('#pl-reset').onclick = function(){ setFocus(-1); targetRot = { x:.35, y:.6 }; };
        var pauseBtn = api.side.querySelector('#pl-pause');
        pauseBtn.onclick = function(){
          paused = !paused;
          pauseBtn.textContent = paused ? '继续公转' : '暂停公转';
          pauseBtn.classList.toggle('on', paused);
        };

        // 交互
        var drag = null, pinchStart = 0, pinchDist = 0;
        var ptrs = new Map();
        var dom = renderer.domElement;
        dom.style.touchAction = 'none';
        dom.style.cursor = 'grab';
        dom.addEventListener('pointerdown', function(e){
          if(e.button !== undefined && e.button !== 0) return;
          e.preventDefault();
          try{ dom.setPointerCapture(e.pointerId); }catch(err){}
          dom.style.cursor = 'grabbing';
          ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
          if(ptrs.size === 1){
            drag = { x:e.clientX, y:e.clientY, rx:targetRot.x, ry:targetRot.y };
          } else if(ptrs.size === 2){
            var arr = Array.from(ptrs.values());
            pinchDist = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
            pinchStart = targetDist;
            drag = null;
          }
        });
        dom.addEventListener('pointermove', function(e){
          if(!ptrs.has(e.pointerId)) return;
          ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
          if(ptrs.size === 1 && drag){
            /* 抓住球体拖动：横拖横转、纵拖纵转，方向跟手指一致 */
            targetRot.y = drag.ry - (e.clientX - drag.x) * .005;
            targetRot.x = Math.max(-1.3, Math.min(1.3, drag.rx + (e.clientY - drag.y) * .0045));
          } else if(ptrs.size === 2){
            var arr = Array.from(ptrs.values());
            var d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
            /* 双指张开 = 拉近，间距比例直接映射到相机距离 */
            if(pinchDist) targetDist = Math.max(10, Math.min(170, pinchStart * (pinchDist / d)));
          }
        });
        function up(e){
          ptrs.delete(e.pointerId);
          if(ptrs.size === 0){ drag = null; pinchDist = 0; dom.style.cursor = 'grab'; }
          else if(ptrs.size === 1){
            var only = Array.from(ptrs.values())[0];
            drag = { x:only.x, y:only.y, rx:targetRot.x, ry:targetRot.y };
            pinchDist = 0;
          }
          try{ dom.releasePointerCapture(e.pointerId); }catch(err){}
        }
        dom.addEventListener('pointerup', up);
        dom.addEventListener('pointercancel', up);
        dom.addEventListener('wheel', function(e){
          e.preventDefault();
          var f = e.deltaY > 0 ? 1.08 : 1 / 1.08;
          targetDist = Math.max(10, Math.min(190, targetDist * f));
        }, { passive:false });
        /* 双击回到全景视角，避免转晕后找不到北 */
        dom.addEventListener('dblclick', function(){
          targetRot = { x:.35, y:.6 };
          targetDist = focus < 0 ? 78 : targetDist;
        });

        function resize(){
          var w = stage.clientWidth || W, h = stage.clientHeight || H;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
        var ro = null;
        if(window.ResizeObserver){ ro = new ResizeObserver(resize); ro.observe(stage); }
        else window.addEventListener('resize', resize);

        var t0 = performance.now();
        function loop(now){
          raf = requestAnimationFrame(loop);
          var dt = Math.min(64, now - t0) / 16.67; t0 = now;
          rot.x += (targetRot.x - rot.x) * .12;
          rot.y += (targetRot.y - rot.y) * .12;
          dist += (targetDist - dist) * .1;
          /* 球面相机：rot.x = 仰角，rot.y = 方位角；不再额外加高度偏移，旋转中心才是太阳 */
          var ce = Math.cos(rot.x), se = Math.sin(rot.x);
          camera.position.set(
            Math.sin(rot.y) * ce * dist,
            se * dist,
            Math.cos(rot.y) * ce * dist
          );
          camera.lookAt(0, 0, 0);
          if(!paused){
            bodies.forEach(function(b){
              b.angle += b.p.speed * dt * .35;
              b.mesh.position.x = Math.cos(b.angle) * b.p.d;
              b.mesh.position.z = Math.sin(b.angle) * b.p.d;
              b.mesh.rotation.y += .012 * dt;
            });
            sun.rotation.y += .002 * dt;
            stars.rotation.y += .0004 * dt;
          }
          renderer.render(scene, camera);
        }
        raf = requestAnimationFrame(loop);

        api.root.addEventListener('transitionend', resize);
        setTimeout(resize, 60);
        setTimeout(resize, 320);

        // 关闭时停掉渲染循环，避免后台烧 CPU
        var closeBtn = api.root.querySelector('#sj-close');
        if(closeBtn) closeBtn.addEventListener('click', stop, true);
        if(api.onCloseHook) api.onCloseHook = null;
        function stop(){
          if(raf) cancelAnimationFrame(raf);
          raf = 0;
          if(ro) try{ ro.disconnect(); }catch(e){}
          try{ renderer.dispose(); }catch(e){}
        }
        window.EN10Subjects._planetStop = stop;
      }
    });
  };
})();
