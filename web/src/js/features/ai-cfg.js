/* ============================================================
   AI 接口配置：自定义 base / model / key（默认 DeepSeek）
   余额查询 · 使用教程 · 圈选问 AI
   ============================================================ */
(function(){
  var PRESETS = [
    { id:'deepseek', name:'DeepSeek（默认）', base:'https://api.deepseek.com', model:'deepseek-chat', site:'https://platform.deepseek.com/api_keys' },
    { id:'qwen',     name:'通义千问 · 兼容模式', base:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen-plus', site:'https://bailian.console.aliyun.com/' },
    { id:'zhipu',    name:'智谱 GLM', base:'https://open.bigmodel.cn/api/paas/v4', model:'glm-4-flash', site:'https://bigmodel.cn/usercenter/apikeys' },
    { id:'moonshot', name:'Moonshot Kimi', base:'https://api.moonshot.cn/v1', model:'moonshot-v1-8k', site:'https://platform.moonshot.cn/console/api-keys' },
    { id:'openai',   name:'OpenAI', base:'https://api.openai.com/v1', model:'gpt-4o-mini', site:'https://platform.openai.com/api-keys' }
  ];

  function get(){
    var CFG = window.EN10_CONFIG || { ai:{} };
    var base = localStorage.getItem('easi_api_base') || (CFG.ai && CFG.ai.base) || 'https://api.deepseek.com';
    var model = localStorage.getItem('easi_api_model') || (CFG.ai && CFG.ai.model) || 'deepseek-chat';
    var key = localStorage.getItem('easi_api_key') || (EN10 && EN10.S ? EN10.S.apiKey : '') || '';
    return { base: base.replace(/\/+$/, ''), model: model, key: key };
  }
  function set(cfg){
    localStorage.setItem('easi_api_base', (cfg.base || '').trim().replace(/\/+$/, ''));
    localStorage.setItem('easi_api_model', (cfg.model || '').trim());
    if(cfg.key != null){
      localStorage.setItem('easi_api_key', cfg.key.trim());
      if(EN10 && EN10.setApiKey) EN10.setApiKey(cfg.key.trim());
    }
  }
  function balanceUrl(base){
    var b = String(base || '').replace(/\/+$/, '');
    if(/\/v1$/i.test(b)) b = b.replace(/\/v1$/i, '');
    return b + '/user/balance';
  }

  function cachedBalance(){
    try{
      var raw = localStorage.getItem('easi_balance_cache');
      if(!raw) return null;
      var o = JSON.parse(raw);
      if(Date.now() - o.t > 1000 * 60 * 30) return null;
      return { ok: o.ok, text: o.text };
    }catch(e){ return null; }
  }

  function fetchBalance(){
    var c = get();
    if(!c.key) return Promise.resolve({ ok:false, text:'未配置 API Key' });
    var ctrl = new AbortController();
    var to = setTimeout(function(){ ctrl.abort(); }, 10000);
    return fetch(balanceUrl(c.base), {
      headers:{ 'Authorization':'Bearer ' + c.key, 'Content-Type':'application/json' },
      signal: ctrl.signal
    }).then(function(res){
      return res.text().then(function(txt){
        if(!res.ok){
          var msg = 'HTTP ' + res.status;
          try{ var j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.type)) || msg; }catch(e){}
          throw new Error(msg);
        }
        var data = {}; try{ data = JSON.parse(txt); }catch(e){}
        var text = '—';
        if(data.balance_infos && data.balance_infos.length){
          text = data.balance_infos.map(function(b){
            var cur = b.currency === 'CNY' ? '¥' : (b.currency === 'USD' ? '$' : (b.currency || ''));
            return cur + b.total_balance;
          }).join(' / ');
          if(data.is_available === false) text += '（不可用）';
        } else if(data.total_balance != null){
          text = '$' + data.total_balance;
        } else if(data.data && data.data.balance != null){
          text = String(data.data.balance);
        } else if(data.balance != null){
          text = String(data.balance);
        } else {
          text = '该接口未返回余额字段';
        }
        return { ok:true, text: text };
      });
    }).catch(function(err){
      var msg = err && err.name === 'AbortError' ? '查询超时' : ((err && err.message) || '查询失败');
      return { ok:false, text: msg + '（该服务可能不支持余额查询）' };
    }).then(function(r){
      try{ localStorage.setItem('easi_balance_cache', JSON.stringify({ t:Date.now(), ok:r.ok, text:r.text })); }catch(e){}
      clearTimeout(to);
      return r;
    });
  }

  function open(parentOv){
    var c = get();
    var presetBtns = PRESETS.map(function(p){
      var on = c.base === p.base ? ' on' : '';
      return '<button class="chip' + on + '" data-p="' + p.id + '">' + p.name + '</button>';
    }).join('');
    var ov = EN10.openModal({
      title:'AI 接口',
      cls:'settings-modal',
      content:
        '<div class="set-list">' +
          '<div class="side-block"><span class="lbl">快速选择服务商</span><div class="chips">' + presetBtns + '</div></div>' +
          '<div class="side-block"><label class="lbl" for="api-base">接口地址（OpenAI 兼容）</label>' +
            '<input class="field" id="api-base" value="' + esc(c.base) + '" placeholder="https://api.deepseek.com">' +
            '<div class="set-sub">可填到 /v1 也可以只填域名，程序会自动补全。</div></div>' +
          '<div class="side-block"><label class="lbl" for="api-model">模型名称</label>' +
            '<input class="field" id="api-model" value="' + esc(c.model) + '" placeholder="deepseek-chat"></div>' +
          '<div class="side-block"><label class="lbl" for="api-key">API Key</label>' +
            '<input class="field" id="api-key" type="password" value="' + esc(c.key) + '" placeholder="sk-..." autocomplete="off">' +
            '<div class="set-sub">只保存在本机浏览器里，不会上传到任何服务器。</div></div>' +
          '<div class="side-block" style="display:flex;align-items:center;gap:8px">' +
            '<button class="set-btn" id="api-test">测试连接</button>' +
            '<button class="set-btn" id="api-bal">查询余额</button>' +
            '<span class="set-sub" id="api-status" style="flex:1;margin:0"></span>' +
          '</div>' +
        '</div>' +
        '<div class="set-hint">默认使用 DeepSeek 官方接口。换成其它服务商时，把接口地址和模型名一起改；支持视觉的模型（如 qwen-vl-max、gpt-4o）才能用「圈选问 AI」。</div>',
      actions:[
        { id:'cancel', label:'取消', type:'cancel' },
        { id:'save', label:'保存', type:'confirm', callback:function(o){
            var base = o.querySelector('#api-base').value.trim();
            var model = o.querySelector('#api-model').value.trim();
            var key = o.querySelector('#api-key').value.trim();
            if(!base || !/^https?:\/\//i.test(base)){ EN10.toast('接口地址要以 http(s):// 开头', 'fa-exclamation-triangle'); return; }
            if(!model){ EN10.toast('请填写模型名称', 'fa-exclamation-triangle'); return; }
            set({ base:base, model:model, key:key });
            EN10.closeModal(o);
            if(parentOv && document.body.contains(parentOv)){
              var sub = parentOv.querySelector('#set-api-sub');
              if(sub) sub.textContent = model + ' · ' + base.replace(/^https?:\/\//, '');
            }
            EN10.toast('AI 接口已更新', 'fa-check');
        }}
      ]
    });

    var st = ov.querySelector('#api-status');
    function say(text, ok){
      st.textContent = text;
      st.style.color = ok ? '#22A64F' : (ok === false ? '#c0392b' : '#96a1ac');
    }
    ov.querySelectorAll('.chip[data-p]').forEach(function(b){
      b.onclick = function(){
        var p = PRESETS.filter(function(x){ return x.id === b.dataset.p; })[0];
        if(!p) return;
        ov.querySelectorAll('.chip').forEach(function(x){ x.classList.toggle('on', x === b); });
        ov.querySelector('#api-base').value = p.base;
        ov.querySelector('#api-model').value = p.model;
        say('已填入 ' + p.name + ' 的默认参数', true);
      };
    });
    ov.querySelector('#api-test').onclick = function(){
      var tmp = { base:ov.querySelector('#api-base').value.trim(), model:ov.querySelector('#api-model').value.trim(), key:ov.querySelector('#api-key').value.trim() };
      if(!tmp.key){ say('先填 API Key', false); return; }
      say('正在测试…');
      var ctrl = new AbortController();
      var to = setTimeout(function(){ ctrl.abort(); }, 20000);
      var url = tmp.base.replace(/\/+$/, '') + (/\/v1$/i.test(tmp.base) ? '' : '/v1') + '/chat/completions';
      fetch(url, {
        method:'POST', signal: ctrl.signal,
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + tmp.key },
        body: JSON.stringify({ model:tmp.model, messages:[{ role:'user', content:'ping' }], max_tokens:8 })
      }).then(function(res){
        return res.text().then(function(txt){
          clearTimeout(to);
          if(res.ok){ say('连接成功 · ' + tmp.model, true); return; }
          var m = 'HTTP ' + res.status;
          try{ var j = JSON.parse(txt); m = (j.error && (j.error.message || j.error.type)) || m; }catch(e){}
          say('失败：' + m, false);
        });
      }).catch(function(err){
        clearTimeout(to);
        say(err.name === 'AbortError' ? '测试超时' : '失败：' + (err.message || '网络异常'), false);
      });
    };
    ov.querySelector('#api-bal').onclick = function(){
      var key = ov.querySelector('#api-key').value.trim();
      if(key !== get().key) set({ base:ov.querySelector('#api-base').value, model:ov.querySelector('#api-model').value, key:key });
      say('正在查询余额…');
      fetchBalance().then(function(r){ say((r.ok ? '余额 ' : '') + r.text, r.ok); });
    };
  }

  function guide(parentOv){
    var c = get();
    var preset = PRESETS.filter(function(p){ return c.base.indexOf(p.base.replace(/\/v1$/, '')) === 0; })[0] || PRESETS[0];
    var ov = EN10.openModal({
      title:'API 使用教程',
      cls:'settings-modal',
      content:
        '<div class="set-list guide-list">' +
          '<div class="guide-step"><span class="gs-n">1</span><div class="gs-c"><b>去官方 API 开放平台注册账号</b>' +
            '<p>打开 ' + esc(preset.name) + ' 的开放平台，用手机号注册并完成实名（多数平台赠送体验额度）。</p></div></div>' +
          '<div class="guide-step"><span class="gs-n">2</span><div class="gs-c"><b>新建一个 API Key</b>' +
            '<p>进入「API Keys / 密钥管理」→ 新建密钥 → 复制 <code>sk-</code> 开头的一整串。密钥只显示一次，记得先存好。</p></div></div>' +
          '<div class="guide-step"><span class="gs-n">3</span><div class="gs-c"><b>充值 / 确认余额</b>' +
            '<p>按量计费，几十元能用很久。课堂用建议余额不低于 10 元，避免讲到一半调用失败。</p></div></div>' +
          '<div class="guide-step"><span class="gs-n">4</span><div class="gs-c"><b>填进白板并测试</b>' +
            '<p>回到「设置 → AI 接口」，粘贴 Key，点「测试连接」看到「连接成功」即可。余额可以点「查询余额」随时看。</p></div></div>' +
          '<div class="guide-step"><span class="gs-n">5</span><div class="gs-c"><b>开始使用</b>' +
            '<p>底栏「AI总结」可总结整块白板；圈选任意区域后点浮动条上的「问AI」，可以让 AI 解释你圈出的题目或图形。</p></div></div>' +
        '</div>' +
        '<div class="set-hint">Key 只存在本机 localStorage。共享设备上建议用完清理；换服务商时记得同时改接口地址与模型名。</div>',
      actions:[
        { id:'site', label:'打开发放平台', type:'cancel', callback:function(){
            try{ window.open(preset.site, '_blank', 'noopener'); }catch(e){}
        }},
        { id:'close', label:'知道了', type:'confirm' }
      ]
    });
    return ov;
  }

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; });
  }

  window.EN10AIConfig = {
    open: open, guide: guide, get: get, set: set,
    fetchBalance: fetchBalance, cachedBalance: cachedBalance
  };

  window.EN10AskAI = {
    ask: function(dataUrl){
      if(!dataUrl) return;
      if(!get().key){
        EN10.openModal({
          title:'还没有配置 AI',
          content:'<div style="font-size:13.5px;line-height:1.8;color:#444;text-align:left">' +
            '「问 AI」需要先填写 API Key。<br>在「设置 → AI 接口」里填入任意 OpenAI 兼容接口的 Key 即可，默认对接 DeepSeek。</div>',
          actions:[
            { id:'close', label:'稍后', type:'cancel' },
            { id:'go', label:'去设置', type:'confirm', callback:function(o){
                EN10.closeModal(o);
                EN10AIConfig.open();
            }}
          ]
        });
        return;
      }
      EN10.askImage(dataUrl, '请解释我圈出的这部分内容。');
    }
  };
})();
