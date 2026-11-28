/* ============================================================
   随机点名
   逻辑沿用「随机抽人系统」：洗牌取样不重复 → 24 次 ×100ms 滚动 → 锁定结果
   UI 按青墨规范重做（玻璃、超椭圆、弹性落位）
   ============================================================ */
(function(){
  var layer, card;
  var built = false, open = false;
  var names = [];
  var picked = [];        // 本轮已抽中（可开启不重复）
  var rolling = false, timer = 0;
  var count = 1;
  var noRepeat = true;

  var DEFAULT = '张伟, 王芳, 李娜, 刘洋, 陈静, 杨帆, 赵敏, 黄磊, 周杰, 吴倩, 徐涛, 孙悦';

  function loadNames(){
    var raw = '';
    try{ raw = localStorage.getItem('easi_picker_names') || ''; }catch(e){}
    if(!raw) raw = DEFAULT;
    names = raw.split(/[,，\n\r、;；\s]+/).map(function(s){ return s.trim(); }).filter(Boolean);
  }
  function saveNames(){
    try{ localStorage.setItem('easi_picker_names', names.join(', ')); }catch(e){}
  }

  function build(){
    if(built) return;
    built = true;
    loadNames();
    layer = document.getElementById('picker-layer');
    layer.innerHTML =
      '<div class="picker-scrim"></div>' +
      '<div class="picker-card">' +
        '<div class="picker-head"><i class="fas fa-users" style="color:#2DC360"></i>' +
          '<h3>随机点名</h3><span class="p-sub">RANDOM PICKER</span>' +
          '<button class="picker-x" id="pk-close"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="picker-body">' +
          '<div class="pk-tabs" id="pk-tabs">' +
            '<button class="on" data-tab="list"><i class="fas fa-list-ul"></i> 名单抽取</button>' +
            '<button data-tab="cam"><i class="fas fa-camera"></i> 摄像头抽取</button>' +
          '</div>' +
          '<div class="pk-pane" data-pane="list">' +
          '<div class="picker-stage" id="pk-stage">' +
            '<span class="picker-tag">准备就绪</span>' +
            '<div class="picker-name" id="pk-name">点击开始抽取</div>' +
          '</div>' +
          '<div class="picker-winners" id="pk-winners"></div>' +
          '<div class="picker-row">' +
            '<label>抽取人数</label>' +
            '<div class="seg" id="pk-count"><button data-n="1" class="on">1 人</button><button data-n="2">2 人</button><button data-n="3">3 人</button></div>' +
            '<label class="toggle" style="margin-left:auto"><input type="checkbox" id="pk-norepeat" checked>' +
              '<span class="toggle-track"><span class="toggle-thumb"></span></span><span>不重复</span></label>' +
          '</div>' +
          '<div class="picker-main">' +
            '<button class="p-btn start" id="pk-start"><i class="fas fa-dice"></i> 开始抽取</button>' +
            '<button class="p-btn reset" id="pk-reset">重置</button>' +
          '</div>' +
          '<div class="picker-names">' +
            '<div class="pn-head"><i class="fas fa-list-ul"></i> 名单（逗号或换行分隔，共 <b id="pk-total">0</b> 人）</div>' +
            '<textarea id="pk-names" placeholder="张伟, 王芳, 李娜&#10;每行一个，或用逗号/空格分隔"></textarea>' +
            '<div class="picker-note">名单自动保存在本机。开启「不重复」后，同一轮里抽过的人不会再被抽中；点「重置」清空本轮记录。</div>' +
          '</div>' +
          '</div>' +
          '<div class="pk-pane" data-pane="cam" style="display:none">' +
            '<div class="pk-cam">' +
              '<div class="pk-cam-stage" id="pk-cam-stage">' +
                '<video id="pk-cam" autoplay playsinline muted></video>' +
                '<canvas id="pk-cam-ov"></canvas>' +
                '<div class="pk-cam-tip" id="pk-cam-tip">正在请求摄像头权限…</div>' +
              '</div>' +
              '<div class="pk-cam-bar">' +
                '<span class="pk-face-count"><i class="fas fa-users"></i> 检测到 <b id="pk-face-n">0</b> 人</span>' +
                '<button class="p-btn start" id="pk-cam-start"><i class="fas fa-dice"></i> 抽取一人</button>' +
                '<button class="p-btn reset" id="pk-cam-reset">重选</button>' +
                '<button class="p-btn reset" id="pk-cam-switch" title="切换摄像头"><i class="fas fa-camera-rotate"></i> 切换</button>' +
              '</div>' +
              '<div class="pk-cam-result" id="pk-cam-result"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    card = layer.querySelector('.picker-card');

    var ta = layer.querySelector('#pk-names');
    ta.value = names.join(', ');
    layer.querySelector('#pk-total').textContent = names.length;
    ta.addEventListener('input', function(){
      names = ta.value.split(/[,，\n\r、;；\s]+/).map(function(s){ return s.trim(); }).filter(Boolean);
      layer.querySelector('#pk-total').textContent = names.length;
      saveNames();
      if(names.length < count) setCount(names.length || 1);
    });
    layer.querySelector('#pk-close').onclick = close;
    layer.querySelector('.picker-scrim').onclick = close;
    layer.querySelector('#pk-count').addEventListener('click', function(e){
      var b = e.target.closest('button[data-n]');
      if(!b) return;
      setCount(+b.dataset.n);
    });
    layer.querySelector('#pk-norepeat').addEventListener('change', function(e){
      noRepeat = e.target.checked;
      if(noRepeat) picked = [];
      renderWinners();
    });
    layer.querySelector('#pk-start').onclick = start;

    /* ---- 模式切换 ---- */
    layer.querySelector('#pk-tabs').addEventListener('click', function(e){
      var b = e.target.closest('button[data-tab]');
      if(!b) return;
      setTab(b.dataset.tab);
    });
    layer.querySelector('#pk-cam-start').onclick = camStart;
    layer.querySelector('#pk-cam-reset').onclick = camReset;
    layer.querySelector('#pk-cam-switch').onclick = switchCamera;
    layer.querySelector('#pk-reset').onclick = reset;
    document.addEventListener('keydown', function(e){
      if(!open) return;
      if(e.key === 'Escape'){ e.stopPropagation(); close(); }
      if((e.key === ' ' || e.key === 'Enter') && document.activeElement !== ta){ e.preventDefault(); start(); }
    });
  }

  /* ===================== 摄像头抽取 ===================== */
  var cam = { stream:null, raf:0, faces:[], picked:-1, ready:false, rolling:false, timer:0, loading:false, waiting:[], deviceId:'' };

  function setTab(tab){
    layer.querySelectorAll('#pk-tabs button').forEach(function(b){ b.classList.toggle('on', b.dataset.tab === tab); });
    layer.querySelectorAll('.pk-pane').forEach(function(p){
      p.style.display = (p.dataset.pane === tab) ? '' : 'none';
    });
    if(tab === 'cam') startCamera();
    else stopCamera();
  }

  function camTip(msg, warn){
    var tip = layer.querySelector('#pk-cam-tip');
    if(!tip) return;
    tip.textContent = msg || '';
    tip.style.display = msg ? 'flex' : 'none';
    tip.style.color = warn ? '#FFB340' : '';
  }

  /* 探测 WebGL 是否真的可用（部分环境有 WebGL 上下文却无法计算） */
  function hasWebGL(){
    try{
      var cv = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (cv.getContext('webgl2') || cv.getContext('webgl') || cv.getContext('experimental-webgl')));
    }catch(e){ return false; }
  }
  /* 明确挑选计算后端：优先 GPU(webgl)，不可用则退回纯 JS(cpu)。
     不指定时 tfjs 会去加载 tfjs-backend-wasm-*.wasm，离线包内没有该文件必然 404，模型随之加载失败。 */
  function pickBackend(f, cb){
    var tf = f.tf;
    if(!tf || !tf.setBackend){ cb(); return; }
    function usable(){
      try{ tf.tensor1d([1]).dataSync(); return true; }catch(e){ return false; }
    }
    function cpu(){ tf.setBackend('cpu').then(function(){ cb(); }).catch(function(){ cb(); }); }
    if(!hasWebGL()){ cpu(); return; }
    tf.setBackend('webgl').then(function(){
      if(usable()) cb(); else cpu();
    }).catch(cpu);
  }
  /* 人脸模型内联包：双击 file:// 打开时 fetch 本地 json/bin 会被判 CORS，
     这里提前把 manifest 与权重读成内存对象，再做一个只拦截模型文件的 fetch 垫片。 */
  function base64ToBytes(b64){
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for(var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function ensureInlineModel(cb){
    if(window.EN10_FACE_MODEL){ cb(true); return; }
    var s = document.createElement('script');
    s.src = 'vendor/faceapi/model-inline.js';
    s.onload = function(){ cb(!!window.EN10_FACE_MODEL); };
    s.onerror = function(){ cb(false); };
    document.head.appendChild(s);
  }
  function installFaceFetchShim(){
    if(window.__EN10FaceFetchShim || typeof window.fetch !== 'function') return;
    var rawFetch = window.fetch;
    window.fetch = function(input, init){
      var url = typeof input === 'string' ? input : ((input && input.url) || '');
      var isManifest = /tiny_face_detector_model-weights_manifest\.json(\?.*)?$/i.test(url);
      var isBin = /tiny_face_detector_model\.bin(\?.*)?$/i.test(url);
      if(!isManifest && !isBin) return rawFetch.apply(window, arguments);
      /* 模型内联包按需加载；加载完成前先把这个 fetch 挂起，避免走真实网络 */
      return new Promise(function(resolve, reject){
        ensureInlineModel(function(ok){
          var M = window.EN10_FACE_MODEL;
          if(!ok || !M){
            rawFetch.call(window, input, init).then(resolve, reject);
            return;
          }
          if(isManifest){
            resolve({
              ok:true, status:200,
              json:function(){ return Promise.resolve(JSON.parse(M.manifest)); },
              text:function(){ return Promise.resolve(M.manifest); },
              arrayBuffer:function(){ return Promise.resolve(new TextEncoder().encode(M.manifest).buffer); }
            });
          } else {
            var bytes = base64ToBytes(M.weights);
            resolve({
              ok:true, status:200,
              arrayBuffer:function(){ return Promise.resolve(bytes.buffer); },
              json:function(){ return Promise.reject(new Error('not json')); },
              text:function(){ return Promise.resolve(''); }
            });
          }
        });
      });
    };
    window.__EN10FaceFetchShim = true;
  }
  /* 必须赶在 face-api 脚本之前替换 fetch：它在脚本初始化时就会抓住全局 fetch */
  installFaceFetchShim();

  function ensureFaceApi(cb){
    if(window.faceapi && cam.ready){ cb(true); return; }
    if(cam.loading){
      cam.waiting.push(cb);
      return;
    }
    cam.loading = true;
    cam.waiting = [cb];
    function done(ok){
      cam.loading = false;
      cam.ready = !!ok;
      var q = cam.waiting || [];
      cam.waiting = [];
      q.forEach(function(fn){ try{ fn(!!ok); }catch(e){} });
    }
    function loadModel(f){
      try{ cam.backend = (f.tf && f.tf.getBackend && f.tf.getBackend()) || 'cpu'; }catch(e){ cam.backend = 'cpu'; }
      var model = 'vendor/faceapi/model';
      ensureInlineModel(function(){
        f.nets.tinyFaceDetector.loadFromUri(model).then(function(){ done(true); })
          .catch(function(err){
            console.warn('face model load failed', err);
            done(false);
          });
      });
    }
    if(window.faceapi){
      pickBackend(window.faceapi, function(){ loadModel(window.faceapi); });
      return;
    }
    var sc = document.createElement('script');
    sc.src = 'vendor/faceapi/face-api.min.js';
    sc.onload = function(){
      var f = window.faceapi;
      if(!f){ done(false); return; }
      pickBackend(f, function(){ loadModel(f); });
    };
    sc.onerror = function(){ done(false); };
    document.head.appendChild(sc);
  }

  function startCamera(){
    if(cam.stream){ return; }
    var video = layer.querySelector('#pk-cam');
    if(!video) return;
    camTip('正在请求摄像头权限…');
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      camTip('当前浏览器不支持摄像头', true);
      return;
    }
    var vc = { width:{ideal:1280}, height:{ideal:720} };
    if(cam.deviceId) vc.deviceId = { exact:cam.deviceId };
    else vc.facingMode = 'user';
    navigator.mediaDevices.getUserMedia({ video:vc, audio:false })
      .then(function(stream){
        cam.stream = stream;
        try{ cam.deviceId = stream.getVideoTracks()[0].getSettings().deviceId || cam.deviceId; }catch(e){}
        video.srcObject = stream;
        video.play().catch(function(){});
        camTip('');
        setTimeout(function(){
          camTip('正在加载人脸识别…');
          ensureFaceApi(function(ok){
            cam.ready = ok;
            if(!ok){ camTip('人脸模型加载失败，仍可用「整屏随机」抽取', true); }
            else camTip('');
            loopDetect();
          });
        }, 300);
      })
      .catch(function(err){
        var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        camTip(denied ? '摄像头权限被拒绝，请在浏览器设置里允许后重试' : '未检测到可用摄像头', true);
      });
  }

  function switchCamera(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices){
      camTip('当前环境不支持切换摄像头', true);
      return;
    }
    navigator.mediaDevices.enumerateDevices().then(function(list){
      var cams = list.filter(function(d){ return d.kind === 'videoinput'; });
      if(cams.length < 2){ camTip('只检测到一个摄像头', true); setTimeout(function(){ camTip(''); }, 1600); return; }
      var idx = -1;
      cams.forEach(function(d, i){ if(d.deviceId === cam.deviceId) idx = i; });
      var next = cams[(idx + 1) % cams.length];
      stopCamera();
      cam.deviceId = next.deviceId;
      cam.ready = cam.ready;   /* 模型已加载，不用重新加载 */
      startCamera();
      camTip('正在切换到' + (next.label || ('摄像头 ' + ((idx + 2) % cams.length + 1))) + '…');
      setTimeout(function(){ camTip(''); }, 1800);
    }).catch(function(){
      camTip('读取摄像头列表失败', true);
    });
  }

  function stopCamera(){
    if(cam.raf){ clearTimeout(cam.raf); cam.raf = 0; }
    if(cam.timer){ clearInterval(cam.timer); cam.timer = 0; }
    cam.rolling = false;
    cam.nextGap = 0;
    if(cam.stream){
      cam.stream.getTracks().forEach(function(t){ t.stop(); });
      cam.stream = null;
    }
    var video = layer.querySelector('#pk-cam');
    if(video) video.srcObject = null;
  }

  function videoRect(){
    var video = layer.querySelector('#pk-cam');
    var stage = layer.querySelector('#pk-cam-stage');
    if(!video || !stage) return null;
    var vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    var r = stage.getBoundingClientRect();
    var sc = Math.min(r.width / vw, r.height / vh);
    var w = vw * sc, h = vh * sc;
    return { x:(r.width - w) / 2, y:(r.height - h) / 2, w:w, h:h, s:sc, W:r.width, H:r.height };
  }

  function loopDetect(){
    if(!cam.stream) return;
    var video = layer.querySelector('#pk-cam');
    var gap = 320;
    if(cam.ready && video && video.readyState >= 2 && window.faceapi){
      /* 纯 JS(cpu) 后端单帧可能上百毫秒，按实测耗时自适应间隔，避免拖慢界面 */
      var size = (cam.backend === 'webgl') ? 224 : 160;
      var t0 = (performance && performance.now) ? performance.now() : Date.now();
      var opts = new faceapi.TinyFaceDetectorOptions({ inputSize:size, scoreThreshold:0.42 });
      faceapi.detectAllFaces(video, opts).then(function(dets){
        cam.faces = dets || [];
        layer.querySelector('#pk-face-n').textContent = cam.faces.length;
        drawBoxes();
        var ms = ((performance && performance.now) ? performance.now() : Date.now()) - t0;
        cam.lastMs = ms;
        cam.nextGap = Math.max(200, Math.min(1400, Math.round(ms * 1.6)));
      }).catch(function(){});
    }
    cam.raf = setTimeout(loopDetect, cam.nextGap || gap);
  }

  function drawBoxes(){
    var stage = layer.querySelector('#pk-cam-stage');
    var cv = layer.querySelector('#pk-cam-ov');
    var vr = videoRect();
    if(!stage || !cv || !vr) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(vr.W * dpr));
    cv.height = Math.max(1, Math.round(vr.H * dpr));
    cv.style.width = vr.W + 'px';
    cv.style.height = vr.H + 'px';
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, vr.W, vr.H);
    cam.faces.forEach(function(d, i){
      var b = d.box || d;
      /* 预览镜像显示：x 需要左右翻转 */
      var x = vr.x + vr.w - (b.x + b.width) * vr.s;
      var y = vr.y + b.y * vr.s;
      var w = b.width * vr.s, h = b.height * vr.s;
      var on = (i === cam.picked);
      c.lineWidth = on ? 4 : 2;
      c.strokeStyle = on ? '#2DC360' : 'rgba(255,255,255,.8)';
      c.beginPath();
      var r = Math.min(14, w * 0.18);
      c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h);
      c.stroke();
      if(on){
        c.fillStyle = 'rgba(45,195,96,.16)';
        c.fill();
        c.fillStyle = '#fff';
        c.font = '700 13px "PingFang SC",sans-serif';
        c.textAlign = 'center';
        c.fillText('抽中', x + w / 2, y - 8);
      }
    });
  }

  function camStart(){
    if(cam.rolling) return;
    var n = cam.faces.length;
    if(!cam.ready || !n){
      /* 没有检测到人脸时，退化为“整屏随机位置”抽取，保证能用 */
      if(!cam.stream){ camTip('摄像头还没打开', true); return; }
      cam.rolling = true;
      var ticks = 0;
      cam.timer = setInterval(function(){
        cam.picked = Math.floor(Math.random() * Math.max(1, cam.faces.length || 6));
        drawBoxes();
        if(++ticks >= 20){ clearInterval(cam.timer); cam.timer = 0; camRollLock(); }
      }, 80);
      return;
    }
    cam.rolling = true;
    var k = 0;
    cam.timer = setInterval(function(){
      cam.picked = Math.floor(Math.random() * n);
      drawBoxes();
      if(++k >= 22){
        clearInterval(cam.timer); cam.timer = 0;
        camRollLock();
      }
    }, 90);
  }

  function camRollLock(){
    cam.rolling = false;
    var n = cam.faces.length;
    if(n) cam.picked = Math.floor(Math.random() * n);
    drawBoxes();
    var res = layer.querySelector('#pk-cam-result');
    if(res){
      if(n){
        var b = cam.faces[cam.picked].box || cam.faces[cam.picked];
        var cx = b.x + b.width / 2;
        var order = cam.faces.map(function(f){
          var bb = f.box || f;
          return bb.x + bb.width / 2;
        }).sort(function(a, b2){ return a - b2; }).indexOf(cx) + 1;
        res.innerHTML = '<i class="fas fa-circle-check"></i> 抽中画面中第 <b>' + order + '</b> 位（共 ' + n + ' 人）';
      } else {
        res.innerHTML = '<i class="fas fa-circle-check"></i> 已随机选取一个位置';
      }
    }
    beep();
  }

  function camReset(){
    cam.picked = -1;
    drawBoxes();
    var res = layer.querySelector('#pk-cam-result');
    if(res) res.innerHTML = '';
  }

  function setCount(n){
    count = Math.max(1, Math.min(3, n || 1));
    layer.querySelectorAll('#pk-count button').forEach(function(b){ b.classList.toggle('on', +b.dataset.n === count); });
  }

  function pool(){
    if(!noRepeat) return names.slice();
    var rest = names.filter(function(n){ return picked.indexOf(n) < 0; });
    return rest;
  }

  function sample(k){
    var arr = pool();
    for(var i = arr.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr.slice(0, Math.max(0, Math.min(k, arr.length)));
  }

  function start(){
    if(rolling) return;
    if(!names.length){ flash('名单是空的，先填几个名字'); return; }
    var avail = pool().length;
    if(avail < count){ flash('剩余可抽 ' + avail + ' 人，不够抽 ' + count + ' 人'); return; }
    rolling = true;
    var btn = layer.querySelector('#pk-start');
    btn.disabled = true;
    var nameEl = layer.querySelector('#pk-name');
    nameEl.classList.add('rolling');
    var tag = layer.querySelector('.picker-tag');
    tag.textContent = '抽取中…';
    var ticks = 0, total = 24;
    timer = setInterval(function(){
      var pick = sample(count);
      nameEl.textContent = pick.join(' · ');
      ticks++;
      if(ticks >= total){
        clearInterval(timer); timer = 0;
        lock();
      }
    }, 100);
  }

  function lock(){
    rolling = false;
    var btn = layer.querySelector('#pk-start');
    btn.disabled = false;
    var chosen = sample(count);
    var nameEl = layer.querySelector('#pk-name');
    nameEl.classList.remove('rolling');
    nameEl.textContent = chosen.join(' · ');
    nameEl.classList.remove('pop');
    void nameEl.offsetWidth;
    nameEl.classList.add('pop');
    layer.querySelector('.picker-tag').textContent = '抽中 ' + chosen.length + ' 人';
    if(noRepeat) chosen.forEach(function(n){ if(picked.indexOf(n) < 0) picked.push(n); });
    renderWinners(chosen);
    beep();
    if(!noRepeat) { /* 允许重复时不累积 */ }
  }

  function renderWinners(latest){
    var wrap = layer.querySelector('#pk-winners');
    if(!noRepeat){ wrap.innerHTML = ''; return; }
    var html = '';
    picked.forEach(function(n){
      var isNew = latest && latest.indexOf(n) > -1;
      html += '<span class="win"' + (isNew ? ' style="background:#2DC360;color:#fff"' : '') + '><i class="fas fa-check"></i>' + esc(n) + '</span>';
    });
    wrap.innerHTML = html;
  }

  function reset(){
    if(rolling){ clearInterval(timer); timer = 0; rolling = false; layer.querySelector('#pk-start').disabled = false; }
    picked = [];
    renderWinners();
    var nameEl = layer.querySelector('#pk-name');
    nameEl.classList.remove('rolling', 'pop');
    nameEl.textContent = '点击开始抽取';
    layer.querySelector('.picker-tag').textContent = '准备就绪';
  }

  function flash(msg){
    var tag = layer.querySelector('.picker-tag');
    tag.textContent = msg;
    tag.style.color = '#FFB340';
    setTimeout(function(){ tag.style.color = ''; }, 1800);
  }

  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }

  function beep(){
    try{
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return;
      var ac = new AC();
      [660, 880].forEach(function(f, i){
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.12 + 0.2);
        o.connect(g); g.connect(ac.destination);
        o.start(ac.currentTime + i * 0.12); o.stop(ac.currentTime + i * 0.12 + 0.22);
      });
      setTimeout(function(){ try{ ac.close(); }catch(e){} }, 900);
    }catch(e){}
  }

  function openPanel(){
    build();
    open = true;
    layer.classList.add('on');
    if(names.length < count) setCount(names.length || 1);
    renderWinners();
  }
  function close(){
    if(!open) return;
    open = false;
    stopCamera();
    layer.classList.remove('on');
    if(rolling){ clearInterval(timer); timer = 0; rolling = false; layer.querySelector('#pk-start').disabled = false; }
  }

  window.EN10Picker = {
    open: openPanel,
    close: close,
    setNames: function(list){
      names = list || [];
      if(built){
        layer.querySelector('#pk-names').value = names.join(', ');
        layer.querySelector('#pk-total').textContent = names.length;
      }
      saveNames();
    }
  };
})();
