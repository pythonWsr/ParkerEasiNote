/* ============================================================
   启动静默检查更新（GitHub Releases）
   查询失败 / 没有新版本 → 完全不打扰
   ============================================================ */
(function(){
  var checking = false;

  function cmp(a, b){
    var pa = String(a || '').replace(/^v/i, '').split(/[.\-+]/).map(function(x){ return parseInt(x, 10) || 0; });
    var pb = String(b || '').replace(/^v/i, '').split(/[.\-+]/).map(function(x){ return parseInt(x, 10) || 0; });
    var n = Math.max(pa.length, pb.length);
    for(var i = 0; i < n; i++){
      var x = pa[i] || 0, y = pb[i] || 0;
      if(x > y) return 1;
      if(x < y) return -1;
    }
    return 0;
  }

  function getJSON(url, ms){
    var ctrl = new AbortController();
    var to = setTimeout(function(){ ctrl.abort(); }, ms || 6500);
    return fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'Accept': 'application/vnd.github+json' }
    }).then(function(res){
      clearTimeout(to);
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).catch(function(e){ clearTimeout(to); throw e; });
  }

  function query(){
    var C = window.EN10_CONFIG || {};
    if(!C.repo) return Promise.reject(new Error('未配置仓库'));
    return getJSON('https://api.github.com/repos/' + C.repo + '/releases/latest', 7000)
      .catch(function(){
        /* 接口被限流 / 被墙时，退回到仓库里的 version.json（存在才会成功） */
        return getJSON('https://raw.githubusercontent.com/' + C.repo + '/main/version.json', 6000);
      });
  }

  function parseNotes(body){
    if(!body) return '';
    var lines = String(body).replace(/\r/g, '').split('\n');
    var html = '', inList = false;
    lines.forEach(function(line){
      var t = line.trim();
      if(!t) return;
      if(/^#{1,4}\s+/.test(t)){
        if(inList){ html += '</ul>'; inList = false; }
        html += '<h4>' + esc(t.replace(/^#{1,4}\s+/, '')) + '</h4>';
      } else if(/^[-*+]\s+/.test(t)){
        if(!inList){ html += '<ul>'; inList = true; }
        html += '<li>' + esc(t.replace(/^[-*+]\s+/, '')) + '</li>';
      } else {
        if(inList){ html += '</ul>'; inList = false; }
        html += '<p style="margin:0 0 6px">' + esc(t) + '</p>';
      }
    });
    if(inList) html += '</ul>';
    return html;
  }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; });
  }

  function show(info){
    var C = window.EN10_CONFIG || {};
    var notes = parseNotes(info.body);
    EN10.openModal({
      title:'',
      cls:'update-modal',
      content:
        '<div class="update-head">' +
          '<img src="assets/img/logo.png" alt="">' +
          '<div><h4>发现新版本 ' + esc(info.version) + '</h4>' +
            '<p>当前 ' + esc(C.version) + ' · 更新于 ' + esc(info.date || '') + '</p></div>' +
          '<span class="ver-badge" style="margin-left:auto"><i class="fas fa-arrow-up"></i>NEW</span>' +
        '</div>' +
        '<div class="update-log">' + (notes || '<p>本次更新包含体验与稳定性改进。</p>') + '</div>',
      actions:[
        { id:'later', label:'稍后', type:'cancel' },
        { id:'go', label:'前往下载', type:'confirm', callback:function(o){
            EN10.closeModal(o);
            var url = info.url || C.github;
            try{ window.open(url, '_blank', 'noopener'); }catch(e){}
        }}
      ]
    });
    if(window.EN10Update) window.EN10Update._last = info;
  }

  function check(opts){
    opts = opts || {};
    var C = window.EN10_CONFIG || {};
    if(checking) return Promise.resolve(false);
    checking = true;
    return query().then(function(data){
      checking = false;
      var latest = data.tag_name || data.version || data.name || '';
      latest = String(latest).replace(/^v/i, '').trim();
      if(!latest) return false;
      if(cmp(latest, C.version) > 0){
        show({
          version: latest,
          body: data.body || data.notes || '',
          date: (data.published_at || data.date || '').slice(0, 10),
          url: data.html_url || C.github
        });
        return true;
      }
      return false;
    }).catch(function(){
      checking = false;
      /* 静默：网络失败、仓库不存在、限流，一律不提示 */
      return false;
    });
  }

  window.EN10Update = {
    checkSilently: function(){
      /* 离线优先：file:// 打开、断网、或 24 小时内查过，都不发请求，
         避免教室断网时控制台满屏红字，也不影响启动速度 */
      try{
        if(location.protocol === 'file:') return;
        if(navigator.onLine === false) return;
        var last = +(localStorage.getItem('easi_update_checked') || 0);
        if(last && Date.now() - last < 86400000) return;
        localStorage.setItem('easi_update_checked', String(Date.now()));
      }catch(e){ return; }
      setTimeout(function(){ check({ silent:true }); }, 1200);
    },
    checkManually: function(){
      return check({ manual:true });
    },
    _last: null,
    compare: cmp
  };
})();
