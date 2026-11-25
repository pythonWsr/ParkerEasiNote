/* ============================================================
   关于页：ParkerEasiNote10 · 流动极光背景 · 创作团队
   ============================================================ */
(function(){
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; });
  }

  function open(){
    var C = window.EN10_CONFIG || {};
    var team = C.team || [];
    var teamHtml = team.map(function(t){
      return '<div class="team-item">' +
        '<img src="' + esc(t.avatar) + '" alt="' + esc(t.name) + '" loading="lazy">' +
        '<div style="min-width:0"><div class="tn">' + esc(t.name) + '</div><div class="tr">' + esc(t.role || '') + '</div></div>' +
      '</div>';
    }).join('');

    var content =
      '<div class="about-wrap">' +
        '<div class="aurora" aria-hidden="true"><span class="a1"></span><span class="a2"></span><span class="a3"></span>' +
          '<span class="a4"></span><span class="a5"></span></div>' +
        '<div class="about-scroll">' +
          '<div class="about-logo-row">' +
            '<img class="about-logo" src="assets/img/logo.png" alt="ParkerEasiNote10">' +
            '<div><div class="about-name">Parker<span>EasiNote10</span></div>' +
              '<div class="about-tag">' + esc(C.cnName || '快捷白板') + ' · ' + esc(C.slogan || '') + '</div></div>' +
          '</div>' +
          '<p class="about-desc">' +
            '面向课堂的轻量白板：笔迹、圈选、课件、板书与课堂工具都在一个页面里。<br>' +
            '已开源，欢迎交流与反馈。技术交流群 <b>' + esc(C.qq || '') + '</b>' +
          '</p>' +
          '<div class="about-links">' +
            '<a class="about-btn primary" href="' + esc(C.website || '#') + '" target="_blank" rel="noopener">' +
              '<i class="fas fa-globe"></i>官方网站</a>' +
            '<a class="about-btn" href="' + esc(C.github || '#') + '" target="_blank" rel="noopener">' +
              '<i class="fab fa-github"></i>GitHub 仓库</a>' +
            '<button class="about-btn" id="about-check-update"><i class="fas fa-rotate"></i>检查更新</button>' +
          '</div>' +
          '<div class="about-sec-title">创作团队（共 ' + team.length + ' 位）</div>' +
          '<div class="team-grid">' + teamHtml + '</div>' +
          '<div class="about-footer">' +
            '<span class="ver">版本 ' + esc(C.version || '') + '</span>' +
            '<span>内核 ' + esc(C.kernel || C.version || '') + '</span>' +
            '<span>© ' + esc(C.build ? C.build.split('.')[0] : '2026') + ' ParkerStudio</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    var ov = EN10.openModal({
      title:'',
      cls:'about-modal',
      content: content,
      actions:[]
    });
    var btn = ov.querySelector('#about-check-update');
    if(btn) btn.onclick = function(){
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>检查中';
      if(window.EN10Update){
        window.EN10Update.checkManually().then(function(r){
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-rotate"></i>检查更新';
          if(!r) EN10.toast('已是最新版本 ' + (C.version || ''), 'fa-check');
        });
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rotate"></i>检查更新';
      }
    };
    return ov;
  }

  window.EN10About = { open: open };
})();
