/* ============================================================
   本地图标集（内联 SVG，不依赖网络字体）
   24×24 网格 · 1.7 线宽 · currentColor
   ============================================================ */
(function(){
  var P = {
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l4.6-4.6a2 2 0 012.8 0L20 20"/>',
    shapes: '<rect x="3" y="12" width="9" height="9" rx="2"/><circle cx="16.5" cy="8" r="4.5"/><path d="M7.5 3.5l4 6h-8z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/>',
    atom: '<circle cx="12" cy="12" r="2.2"/><ellipse cx="12" cy="12" rx="9.2" ry="4.2"/><ellipse cx="12" cy="12" rx="9.2" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.2" ry="4.2" transform="rotate(120 12 12)"/>',
    flask: '<path d="M9 3h6M10 3v5.2L4.8 17A2.5 2.5 0 007 20.7h10a2.5 2.5 0 002.2-3.7L14 8.2V3"/><path d="M7.2 14h9.6"/>',
    hanzi: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 8h8M12 8v8M8.5 16h7M9 12h6"/>',
    pinyin: '<path d="M4 17V7h3.2a2.6 2.6 0 010 5.2H4"/><path d="M13 17V7h2.6a3 3 0 010 10H13"/><path d="M19.5 9.5v5"/>',
    poem: '<path d="M4 5.5A2.5 2.5 0 016.5 3H19v18H6.5A2.5 2.5 0 014 18.5z"/><path d="M8 7.5h7M8 11h7M8 14.5h4"/>',
    compass: '<circle cx="12" cy="5" r="2.2"/><path d="M12 7.2L7 20M12 7.2L17 20"/><path d="M9 15.2a4.4 4.4 0 006 0"/><circle cx="12" cy="12.4" r="1"/>',
    func: '<path d="M4 19c4.5 0 5-3 5.6-7S11 4 15.5 4"/><path d="M6 12h7M3 19h6"/><path d="M14 15.5c2.6-3.4 4-1 4 1.2"/>',
    sigma: '<path d="M18 5H7l5.5 7L7 19h11"/><path d="M4.5 12h2"/>',
    rule: '<path d="M3 6.5h18M3 12h18M3 17.5h18" stroke-dasharray="2.5 2.5"/><path d="M6 9.2h6"/>',
    ipa: '<path d="M4 11v2a1 1 0 001 1h2l4 3.5V6.5L7 10H5a1 1 0 00-1 1z"/><path d="M15 9.5a3.5 3.5 0 010 5M17.6 7a7 7 0 010 10"/>',
    dict: '<path d="M4 5.5A2.5 2.5 0 016.5 3H19v16.5H6.5A2.5 2.5 0 004 22z"/><circle cx="13" cy="10.5" r="3"/><path d="M15.2 12.7L18 15.5"/>',
    dictation: '<path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3" y="13" width="4" height="7" rx="1.8"/><rect x="17" y="13" width="4" height="7" rx="1.8"/><path d="M17 20a3 3 0 01-3 3h-2"/>',
    chem: '<path d="M8 3h8M9 3v5L5.2 17.4A2.3 2.3 0 007.3 20.6h9.4a2.3 2.3 0 002.1-3.2L15 8V3"/><path d="M7.6 13.5h8.8"/><circle cx="11" cy="16.4" r="1"/><circle cx="14" cy="17.4" r=".8"/>',
    planet: '<circle cx="12" cy="12" r="5.4"/><ellipse cx="12" cy="12" rx="10" ry="3.6" transform="rotate(-22 12 12)"/><circle cx="18.6" cy="6.4" r="1.2"/>',
    mindmap: '<rect x="3" y="9.5" width="6" height="5" rx="1.6"/><rect x="15" y="3" width="6" height="5" rx="1.6"/><rect x="15" y="16" width="6" height="5" rx="1.6"/><path d="M9 12h3.2V5.5H15M12.2 12v6H15"/>',
    timer: '<circle cx="12" cy="13" r="7.6"/><path d="M12 9.4V13l2.6 1.8"/><path d="M9 2.6h6M12 2.6V5"/>',
    board: '<rect x="3" y="5" width="18" height="12.5" rx="2.4"/><path d="M8 21l4-3.5 4 3.5"/><path d="M7.5 9.5h6M7.5 12.5h4"/>',
    picker: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16.5 6.2a3 3 0 010 5.6"/><path d="M18 14.4c1.7.7 2.5 2.3 2.5 4.6"/>',
    web: '<rect x="3" y="4" width="18" height="15" rx="2.6"/><path d="M3 8.5h18M6.5 6.2h.01M9 6.2h.01"/><path d="M7.5 13h6M7.5 16h4"/>',
    camera: '<rect x="2.6" y="6.4" width="12.6" height="11.2" rx="2.6"/><path d="M15.2 10.6l5.2-3.1v9l-5.2-3.1z"/><circle cx="7.2" cy="12" r="1.7"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'
  };
  /* 少数工具用字形比线条图更好认（拼音 ā、音标 æ、汉字 字） */
  var TEXT = { hanzi:'字', pinyin:'ā', ipa:'æ' };

  window.EN10_ICONS = P;
  window.enIcon = function(name, size){
    var s = size || 24;
    if(TEXT[name]){
      var ch = TEXT[name];
      var fs = ch === '字' ? s * .82 : s * .92;
      return '<svg class="en-ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true">' +
        '<text x="12" y="12" text-anchor="middle" dominant-baseline="central" ' +
        'font-family="PingFang SC,Microsoft YaHei,Georgia,serif" font-size="' + fs + '" font-weight="600" ' +
        'fill="currentColor" stroke="none">' + ch + '</text></svg>';
    }
    var d = P[name] || P.grid;
    return '<svg class="en-ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  };
})();
