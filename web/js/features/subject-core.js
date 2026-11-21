/* ============================================================
   学科工具通用框架
   · 统一的弹窗壳（标题 / 图标 / 插入白板 / 关闭）
   · 文字卡片转 canvas（诗词、拼音、音标等「排版型」工具也能贴到白板）
   · 朗读（系统 TTS，离线可用）
   ============================================================ */
(function(){
  var layer, cur = null;

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function close(){
    if(!cur) return;
    if(layer){ layer.classList.remove('on'); }
    var old = cur;
    cur = null;
    setTimeout(function(){
      if(!cur && layer) layer.innerHTML = '';
      if(old && old.onClose) try{ old.onClose(); }catch(e){}
    }, 220);
  }

  /* opts: {title, sub, icon, narrow, body, side, hint, insert:{label, get}} */
  function open(opts){
    layer = document.getElementById('subject-layer');
    // 关闭上一个
    if(cur) close();

    layer.innerHTML =
      '<div class="subject-scrim"></div>' +
      '<div class="subject-card' + (opts.narrow ? ' narrow' : '') + '">' +
        '<div class="subject-head">' +
          '<div class="subject-ic">' + enIcon(opts.icon || 'grid', 30) + '</div>' +
          '<div style="min-width:0"><h3>' + esc(opts.title) + '</h3>' +
            (opts.sub ? '<div class="s-sub">' + esc(opts.sub) + '</div>' : '') + '</div>' +
          '<div class="subject-tools">' +
            (opts.side ? '<button class="s-btn s-sidebtn" id="sj-sidebtn"><i class="fas fa-sliders"></i><span>工具</span></button>' : '') +
            (opts.insert ? '<button class="s-btn primary" id="sj-insert"><i class="fas fa-arrow-down"></i>' + (opts.insert.label || '插入白板') + '</button>' : '') +
            '<button class="s-x" id="sj-close" title="关闭"><i class="fas fa-times"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="subject-body">' +
          '<div class="subject-pane" id="sj-pane">' + (opts.body || '') + '</div>' +
          (opts.side ? '<div class="subject-side" id="sj-side"><div class="side-grip" data-side-close><span></span></div>' + opts.side + '</div>' : '') +
        '</div>' +
        (opts.hint ? '<div class="subject-foot"><span class="hint">' + opts.hint + '</span></div>' : '') +
      '</div>';

    var card = layer.querySelector('.subject-card');
    layer.classList.add('on');
    layer.querySelector('#sj-close').onclick = close;
    layer.querySelector('.subject-scrim').onclick = close;

    /* 画布类工具：让面板不滚动，画布铺满剩余空间（窄屏才真正用得上） */
    var paneEl = layer.querySelector('#sj-pane');
    var sideEl = layer.querySelector('#sj-side');
    if(paneEl && paneEl.querySelector('.canvas-wrap')) paneEl.classList.add('fit');

    /* 窄屏工具抽屉 */
    var sb = layer.querySelector('#sj-sidebtn');
    if(sb && sideEl){
      sb.onclick = function(e){
        e.stopPropagation();
        var willOpen = !sideEl.classList.contains('open');
        sideEl.classList.toggle('open', willOpen);
        sb.classList.toggle('on', willOpen);
        if(willOpen) sideEl.scrollTop = 0;
      };
      /* 抽屉开着时不要让点击把它收走：参数要能连续调、能上下滚 */
      sideEl.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
    }

    if(sideEl){
      var grip = sideEl.querySelector('[data-side-close]');
      if(grip) grip.onclick = function(){
        sideEl.classList.remove('open');
        if(sb) sb.classList.remove('on');
      };
    }

    var api = {
      root: card,
      pane: layer.querySelector('#sj-pane'),
      side: layer.querySelector('#sj-side'),
      close: close,
      esc: esc,
      toast: function(m, i){ EN10.toast(m, i || 'fa-check'); },
      speak: speak,
      stopSpeak: stopSpeak,
      insertCanvas: function(cv, scale){
        var url = cv.toDataURL('image/png');
        EN10.insertImage(url, cv.width, cv.height, { scale: scale || 1 });
        close();
      },
      insertSvg: function(svgStr, w, h){
        var blob = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
        EN10.insertImage(blob, w, h, {});
        close();
      },
      insertHtmlCard: function(cfg){
        var cv = cardCanvas(cfg);
        EN10.insertImage(cv.toDataURL('image/png'), cv.width, cv.height, { scale: cfg.scale || 1 });
        close();
      }
    };
    cur = api;
    if(opts.onMount) opts.onMount(api);

    if(opts.insert){
      var btn = layer.querySelector('#sj-insert');
      btn.onclick = function(){
        try{
          var r = opts.insert.get(api);
          if(r === false) return;
        }catch(err){
          console.error(err);
          EN10.toast('插入失败：' + err.message, 'fa-exclamation-triangle');
        }
      };
    }
    document.addEventListener('keydown', escHandler);
    return api;
  }

  function escHandler(e){
    if(e.key !== 'Escape' || !cur) return;
    var side = document.getElementById('sj-side');
    if(side && side.classList.contains('open')){
      side.classList.remove('open');
      var b = document.getElementById('sj-sidebtn');
      if(b) b.classList.remove('on');
      e.stopPropagation();
      return;
    }
    close();
    document.removeEventListener('keydown', escHandler);
  }

  /* ---------- 文字卡片 → canvas ---------- */
  function cardCanvas(cfg){
    var dpr = 2;
    var w = cfg.w || 900, h = cfg.h || 600;
    var cv = document.createElement('canvas');
    cv.width = w * dpr; cv.height = h * dpr;
    var c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.fillStyle = cfg.bg || '#FFFFFF';
    c.fillRect(0, 0, w, h);
    if(cfg.border !== false){
      c.strokeStyle = cfg.borderColor || '#E3E8EE';
      c.lineWidth = 2;
      c.strokeRect(1, 1, w - 2, h - 2);
    }
    var pad = cfg.pad || 48;
    var y = pad;
    (cfg.lines || []).forEach(function(l){
      if(l.gap) { y += l.gap; return; }
      if(l.rule){
        c.strokeStyle = l.rule; c.lineWidth = 1;
        c.beginPath(); c.moveTo(pad, y); c.lineTo(w - pad, y); c.stroke();
        return;
      }
      c.font = (l.weight || '') + ' ' + (l.size || 24) + 'px ' + (l.font || '"PingFang SC","Microsoft YaHei",sans-serif');
      c.fillStyle = l.color || '#1C1C1E';
      c.textAlign = l.align || 'left';
      c.textBaseline = 'top';
      var x = l.align === 'center' ? w / 2 : (l.align === 'right' ? w - pad : pad);
      var text = l.text == null ? '' : String(l.text);
      var maxW = w - pad * 2;
      if(l.wrap){
        var lines = wrapText(c, text, maxW);
        lines.forEach(function(t){ c.fillText(t, x, y); y += (l.size || 24) * 1.6; });
        return;
      }
      c.fillText(text, x, y);
      y += l.line || ((l.size || 24) * 1.7);
    });
    return cv;
  }
  function wrapText(c, text, maxW){
    var out = [], line = '';
    for(var i = 0; i < text.length; i++){
      var ch = text[i];
      if(ch === '\n'){ out.push(line); line = ''; continue; }
      var t = line + ch;
      if(c.measureText(t).width > maxW && line){ out.push(line); line = ch; }
      else line = t;
    }
    if(line) out.push(line);
    return out;
  }

  /* ---------- 朗读 ---------- */
  var speaking = false;
  function speak(text, lang, rate){
    if(window.EN10TTS){
      var ok = EN10TTS.speak(text, lang || 'zh-CN', rate || 1);
      speaking = ok;
      return ok;
    }
    if(!('speechSynthesis' in window)){
      EN10.toast('当前环境不支持语音朗读', 'fa-volume-xmark');
      return false;
    }
    stopSpeak();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = lang || 'zh-CN';
    u.rate = rate || 1;
    u.pitch = 1;
    u.onend = function(){ speaking = false; };
    u.onerror = function(){ speaking = false; };
    speaking = true;
    window.speechSynthesis.speak(u);
    return true;
  }
  function stopSpeak(){
    if(window.EN10TTS) EN10TTS.stop();
    else { try{ if(window.speechSynthesis) window.speechSynthesis.cancel(); }catch(e){} }
    speaking = false;
  }

  window.EN10Subjects = window.EN10Subjects || {};
  EN10Subjects._open = open;
  EN10Subjects._card = cardCanvas;
  EN10Subjects._esc = esc;
  EN10Subjects._speak = speak;
  /* 让画布工具跟着容器尺寸走：取容器实际可见区域，最小 80px，避免小屏被固定尺寸撑爆 */
  EN10Subjects._fit = function(host, pad){
    pad = pad || 0;
    var r = host.getBoundingClientRect();
    return {
      W: Math.max(80, Math.round((r.width || host.clientWidth || 640) - pad)),
      H: Math.max(80, Math.round((r.height || host.clientHeight || 480) - pad))
    };
  };
  /* 容器尺寸变化后重建（转屏/拖窗口/抽屉开合），带 120ms 防抖 */
  EN10Subjects._observe = function(host, cb){
    if(!window.ResizeObserver || !host) return;
    var last = host.clientWidth + 'x' + host.clientHeight;
    var ro = new ResizeObserver(function(){
      var now = host.clientWidth + 'x' + host.clientHeight;
      if(now === last) return;
      last = now;
      clearTimeout(host.__fitT);
      host.__fitT = setTimeout(function(){ if(document.body.contains(host)) cb(); }, 120);
    });
    ro.observe(host);
    host.__ro = ro;
  };
  EN10Subjects._canvas = function(w, h, dpr){
    var cv = document.createElement('canvas');
    dpr = dpr || Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    var c = cv.getContext('2d');
    c.scale(dpr, dpr);
    cv.__dpr = dpr;
    return { cv: cv, c: c, dpr: dpr, w: w, h: h };
  };
})();
