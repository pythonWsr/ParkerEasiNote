/* ============================================================
   PPT 增强渲染：表格 / SmartArt / 图表 / Office 公式(OMML→LaTeX)
   独立于 app.js，只做「XML → 结构化数据 → DOM」的转换，
   由 app.js 在解析与绘制幻灯片时调用。
   ============================================================ */
(function(){
  var EMU = 9525;              /* 1px = 9525 EMU（96dpi） */

  function ln(n){ return (n && (n.localName || n.nodeName) || '').replace(/^.*:/, ''); }
  function kids(n, name){
    var out = [];
    if(!n || !n.childNodes) return out;
    for(var i=0;i<n.childNodes.length;i++){
      var c = n.childNodes[i];
      if(c.nodeType === 1 && (!name || ln(c) === name)) out.push(c);
    }
    return out;
  }
  function first(n, name){
    if(!n || !n.childNodes) return null;
    for(var i=0;i<n.childNodes.length;i++){
      var c = n.childNodes[i];
      if(c.nodeType === 1 && ln(c) === name) return c;
    }
    return null;
  }
  function desc(n, name){
    if(!n || !n.getElementsByTagName) return [];
    var out = [], all = n.getElementsByTagName('*');
    for(var i=0;i<all.length;i++) if(ln(all[i]) === name) out.push(all[i]);
    return out;
  }
  function descFirst(n, name){
    var a = desc(n, name);
    return a.length ? a[0] : null;
  }
  function num(v, d){ var n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }
  function attr(n, k){ return n && n.getAttribute ? (n.getAttribute(k) || '') : ''; }
  function parseXml(text){
    if(!text || typeof DOMParser === 'undefined') return null;
    try{
      var d = new DOMParser().parseFromString(text, 'application/xml');
      if(d && d.getElementsByTagName('parsererror').length) return null;
      return d;
    }catch(e){ return null; }
  }
  function hexOf(el){
    if(!el) return null;
    var s = first(el, 'srgbClr');
    if(s) return '#' + attr(s, 'val');
    var sc = first(el, 'schemeClr');
    if(sc){
      var v = attr(sc, 'val');
      var map = { tx1:'#000000', tx2:'#44546A', bg1:'#FFFFFF', bg2:'#E7E6E6',
                  accent1:'#4472C4', accent2:'#ED7D31', accent3:'#A5A5A5', accent4:'#FFC000',
                  accent5:'#5B9BD5', accent6:'#70AD47', dk1:'#000000', lt1:'#FFFFFF' };
      return map[v] || null;
    }
    var p = first(el, 'prstClr');
    if(p) return attr(p, 'val');
    return null;
  }

  /* ---------------- 表格 ---------------- */
  function cellFromTc(tc){
    var cell = { text:'', paragraphs:[], fill:null, color:null, bold:false, align:'left',
                 fontSize:0, vAlign:'middle', span:1, italic:false };
    var span = attr(tc, 'gridSpan');
    if(span) cell.span = Math.max(1, parseInt(span, 10) || 1);
    var tcPr = first(tc, 'tcPr');
    if(tcPr){
      var sf = first(tcPr, 'solidFill'); if(sf) cell.fill = hexOf(sf);
      var anc = attr(tcPr, 'anchor');
      if(anc === 't') cell.vAlign = 'top'; else if(anc === 'b') cell.vAlign = 'bottom';
      var borders = first(tcPr, 'lnL') || first(tcPr, 'lnT');
      if(borders !== null){} /* 边框统一用默认细线，避免逐格计算 */
    }
    var tx = first(tc, 'txBody');
    if(tx){
      var ps = kids(tx, 'p'), lines = [];
      ps.forEach(function(p){
        var pPr = first(p, 'pPr'), algn = attr(pPr, 'algn');
        var txt = '', bold = false, color = null, fs = 0, italic = false;
        kids(p, 'r').forEach(function(r){
          var rPr = first(r, 'rPr');
          if(rPr){
            var b = attr(rPr, 'b'); if(b === '1' || b === 'true') bold = true;
            var i2 = attr(rPr, 'i'); if(i2 === '1' || i2 === 'true') italic = true;
            var sz = attr(rPr, 'sz'); if(sz) fs = num(sz) / 100;
            var sf = first(rPr, 'solidFill'); if(sf) color = hexOf(sf);
          }
          var t = first(r, 't'); if(t) txt += (t.textContent || '');
        });
        var fld = first(p, 'fld'); if(fld){ var ft = first(fld, 't'); if(ft) txt += ft.textContent || ''; }
        if(!txt) return;
        if(algn === 'ctr') cell.align = 'center'; else if(algn === 'r') cell.align = 'right';
        if(bold) cell.bold = true;
        if(italic) cell.italic = true;
        if(color) cell.color = color;
        if(fs) cell.fontSize = fs;
        lines.push(txt);
      });
      cell.text = lines.join('\n');
    }
    return cell;
  }

  function tableShape(tbl, base){
    var colW = [];
    var grid = first(tbl, 'tblGrid');
    kids(grid, 'gridCol').forEach(function(g){ colW.push(num(attr(g, 'w')) / EMU); });
    var rows = [], totalH = 0;
    kids(tbl, 'tr').forEach(function(tr){
      var h = num(attr(tr, 'h')) / EMU;
      var cells = kids(tr, 'tc').map(cellFromTc);
      if(!h){
        /* 没写行高就按内容估一个，避免整表塌成一条线 */
        var maxLine = 1;
        cells.forEach(function(c){ maxLine = Math.max(maxLine, (c.text.split('\n').length)); });
        h = Math.max(24, maxLine * ((cells[0] && cells[0].fontSize) || 16) * 1.45);
      }
      rows.push({ h:h, cells:cells });
      totalH += h;
    });
    var totalW = colW.reduce(function(a,b){ return a + b; }, 0);
    if(!totalW){
      var maxCols = 0;
      rows.forEach(function(r){ maxCols = Math.max(maxCols, r.cells.length); });
      totalW = base.w || (maxCols * 120);
      colW = [];
      for(var i=0;i<maxCols;i++) colW.push(totalW / maxCols);
    }
    return Object.assign({}, base, {
      type:'table', rows:rows, colW:colW, rowH:rows.map(function(r){ return r.h; }),
      tableW:totalW, tableH:totalH
    });
  }

  /* ---------------- SmartArt ---------------- */
  function ptText(pt){
    var t = first(pt, 't');
    if(!t) return '';
    var lines = [];
    desc(t, 'p').forEach(function(p){
      var s = '';
      desc(p, 't').forEach(function(tt){ s += (tt.textContent || ''); });
      if(s.trim()) lines.push(s.trim());
    });
    if(!lines.length){
      desc(t, 't').forEach(function(tt){ if((tt.textContent||'').trim()) lines.push(tt.textContent.trim()); });
    }
    return lines.join('\n');
  }

  function smartartShape(xmlText, base){
    var doc = parseXml(xmlText);
    if(!doc) return null;
    var dataModel = descFirst(doc, 'dataModel') || doc.documentElement;
    var ptLst = first(dataModel, 'ptLst');
    var nodes = {}, order = [];
    desc(ptLst, 'pt').forEach(function(pt){
      var id = attr(pt, 'modelId');
      var type = attr(pt, 'type');
      nodes[id] = { id:id, type:type, text: ptText(pt), children:[], parents:[] };
      order.push(id);
    });
    var cxnLst = first(dataModel, 'cxnLst');
    desc(cxnLst, 'cxn').forEach(function(c){
      var s = attr(c, 'srcId'), d = attr(c, 'destId'), ty = attr(c, 'type') || 'parOf';
      if(ty !== 'parOf') return;
      if(nodes[s] && nodes[d]){ nodes[s].children.push(d); nodes[d].parents.push(s); }
    });
    /* 从文档根往下走，得到阅读顺序 */
    var docIds = order.filter(function(id){ return nodes[id].type === 'doc'; });
    var roots = [];
    if(docIds.length){
      docIds.forEach(function(id){ roots = roots.concat(nodes[id].children); });
    }
    if(!roots.length){
      roots = order.filter(function(id){ return nodes[id].type !== 'doc' && !nodes[id].parents.length; });
    }
    var levels = [], seen = {};
    (function walk(list, depth){
      if(!list.length || depth > 8) return;
      levels[depth] = levels[depth] || [];
      var next = [];
      list.forEach(function(id){
        if(seen[id] || !nodes[id]) return;
        seen[id] = true;
        if(nodes[id].text) levels[depth].push(id);
        nodes[id].children.forEach(function(c){ if(!seen[c]) next.push(c); });
      });
      walk(next, depth + 1);
    })(roots, 0);
    /* 没有连接信息（很多导出工具会丢 cxn）时按顺序平铺 */
    var flat = [];
    levels.forEach(function(lv){ flat = flat.concat(lv); });
    order.forEach(function(id){ if(nodes[id].text && flat.indexOf(id) < 0) flat.push(id); });
    if(!flat.length) return null;
    if(!levels.length) levels = [flat];

    var W = Math.max(40, base.w || 400), H = Math.max(40, base.h || 200);
    var maxLevel = levels.length;
    var perLevel = levels.map(function(l){ return l.length; });
    var maxPer = Math.max.apply(null, perLevel.concat([1]));
    var gapX = Math.min(18, W * 0.04), gapY = Math.min(16, H * 0.06);
    var boxW = Math.min(W / maxPer - gapX, (W - gapX * (maxPer + 1)) / maxPer);
    boxW = Math.max(28, boxW);
    var boxH = Math.max(22, (H - gapY * (maxLevel + 1)) / maxLevel);

    var out = [], links = [];
    levels.forEach(function(lv, li){
      var n = lv.length || 1;
      var totalW = n * boxW + (n - 1) * gapX;
      var startX = (W - totalW) / 2;
      lv.forEach(function(id, i){
        var nd = nodes[id];
        var bx = startX + i * (boxW + gapX);
        var by = gapY + li * (boxH + gapY);
        out.push({ id:id, text: nd.text, x:bx, y:by, w:boxW, h:boxH, depth:li });
      });
    });
    var pos = {};
    out.forEach(function(o){ pos[o.id] = o; });
    order.forEach(function(id){
      var nd = nodes[id];
      if(!pos[id]) return;
      nd.children.forEach(function(cid){
        if(!pos[cid]) return;
        var a = pos[id], b = pos[cid];
        links.push({ x1:a.x + a.w / 2, y1:a.y + a.h, x2:b.x + b.w / 2, y2:b.y });
      });
    });
    return Object.assign({}, base, { type:'smartart', nodes:out, links:links });
  }

  /* ---------------- 图表 ---------------- */
  function srgbList(node){
    var cache = descFirst(node, 'strCache') || descFirst(node, 'numCache');
    var out = [];
    if(cache){ desc(cache, 'pt').forEach(function(p){ var v = first(p, 'v'); out.push(v ? v.textContent : ''); }); }
    if(!out.length){
      var ref = descFirst(node, 'strRef') || descFirst(node, 'numRef');
      if(ref){ desc(ref, 'pt').forEach(function(p){ var v = first(p, 'v'); out.push(v ? v.textContent : ''); }); }
    }
    return out;
  }
  function chartShape(xmlText, base){
    var doc = parseXml(xmlText);
    if(!doc) return null;
    var plot = descFirst(doc, 'plotArea') || doc.documentElement;
    var kind = 'bar';
    ['barChart','colChart','lineChart','pieChart','doughnutChart','areaChart','scatterChart','radarChart'].forEach(function(k){
      if(descFirst(plot, k)) kind = k.replace('Chart','');
    });
    var series = [], cats = [];
    desc(plot, 'ser').forEach(function(ser){
      var nm = descFirst(ser, 'tx');
      var name = nm ? (srgbList(nm).join(' ') || '') : '';
      var catNode = first(ser, 'cat');
      var valNode = first(ser, 'val');
      var c2 = catNode ? srgbList(catNode) : [];
      var v2 = valNode ? srgbList(valNode).map(function(v){ return parseFloat(v) || 0; }) : [];
      if(c2.length > cats.length) cats = c2;
      series.push({ name:name, values:v2 });
    });
    if(!series.length) return null;
    var titleNode = descFirst(doc, 'title');
    var title = '';
    if(titleNode) desc(titleNode, 't').forEach(function(t){ title += t.textContent || ''; });
    if(kind === 'col') kind = 'bar';
    return Object.assign({}, base, { type:'chart', chartKind:kind, title:title, cats:cats, series:series });
  }

  /* ---------------- 渲染成 DOM ---------------- */
  function el(tag, css){
    var d = document.createElement(tag);
    if(css) d.style.cssText = css;
    return d;
  }

  function renderTable(s){
    var box = el('div', 'position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;');
    var tbl = el('div', 'display:flex;flex-direction:column;width:100%;border:1px solid rgba(0,0,0,.28);box-sizing:border-box;');
    var totalW = s.tableW || s.w || 1;
    s.rows.forEach(function(row){
      var tr = el('div', 'display:flex;min-height:' + Math.max(14, row.h) + 'px;' +
        'height:' + Math.max(14, row.h) + 'px;box-sizing:border-box;');
      row.cells.forEach(function(c, ci){
        var cw = 0;
        for(var i=0;i<c.span;i++) cw += (s.colW[ci + i] || 0);
        if(!cw) cw = totalW / Math.max(1, row.cells.length);
        var td = el('div', 'width:' + (cw / totalW * 100) + '%;box-sizing:border-box;' +
          'border-right:1px solid rgba(0,0,0,.22);border-bottom:1px solid rgba(0,0,0,.22);' +
          'padding:3px 5px;overflow:hidden;display:flex;align-items:center;' +
          'justify-content:' + (c.align === 'center' ? 'center' : (c.align === 'right' ? 'flex-end' : 'flex-start')) + ';' +
          'align-items:' + (c.vAlign === 'top' ? 'flex-start' : (c.vAlign === 'bottom' ? 'flex-end' : 'center')) + ';' +
          'font-size:' + Math.max(7, c.fontSize || 15) + 'px;line-height:1.25;word-break:break-word;white-space:pre-wrap;' +
          'color:' + (c.color || '#1f1f1f') + ';' + (c.bold ? 'font-weight:700;' : '') + (c.italic ? 'font-style:italic;' : '') +
          (c.fill ? 'background:' + c.fill + ';' : ''));
        td.textContent = c.text || '';
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
    box.appendChild(tbl);
    return box;
  }

  function renderSmartArt(s, theme){
    var box = el('div', 'position:absolute;inset:0;overflow:hidden;');
    var svg = '<svg width="100%" height="100%" viewBox="0 0 ' + s.w + ' ' + s.h + '" preserveAspectRatio="none" style="position:absolute;inset:0">';
    (s.links || []).forEach(function(l){
      svg += '<line x1="' + l.x1 + '" y1="' + l.y1 + '" x2="' + l.x2 + '" y2="' + l.y2 +
             '" stroke="' + (theme && theme.line || '#8FA3B8') + '" stroke-width="1.4"/>';
    });
    svg += '</svg>';
    box.innerHTML = svg;
    s.nodes.forEach(function(n){
      var tone = (theme && theme.fills && theme.fills[n.depth % theme.fills.length]) || '#4472C4';
      var d = el('div', 'position:absolute;left:' + n.x + 'px;top:' + n.y + 'px;width:' + n.w + 'px;height:' + n.h + 'px;' +
        'background:' + tone + ';border-radius:6px;box-sizing:border-box;padding:3px 5px;overflow:hidden;' +
        'display:flex;align-items:center;justify-content:center;text-align:center;' +
        'color:#fff;font-size:' + Math.max(8, Math.min(18, Math.round(n.h * 0.34))) + 'px;line-height:1.22;word-break:break-word;');
      d.textContent = n.text;
      box.appendChild(d);
    });
    return box;
  }

  function renderChart(s){
    var box = el('div', 'position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;');
    var head = '';
    if(s.title) head = '<div style="font-size:13px;font-weight:600;color:#333;padding:2px 4px;">' +
      String(s.title).replace(/[<>&]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }) + '</div>';
    var W = Math.max(60, s.w), H = Math.max(50, s.h);
    var padL = 26, padR = 10, padT = s.title ? 22 : 8, padB = 22;
    var iw = Math.max(20, W - padL - padR), ih = Math.max(20, H - padT - padB);
    var maxV = 0;
    s.series.forEach(function(se){ se.values.forEach(function(v){ maxV = Math.max(maxV, v); }); });
    if(maxV <= 0) maxV = 1;
    var colors = ['#4472C4','#ED7D31','#A5A5A5','#FFC000','#5B9BD5','#70AD47'];
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">';
    if(s.chartKind === 'pie' || s.chartKind === 'doughnut'){
      var vals = s.series[0].values, sum = vals.reduce(function(a,b){ return a + Math.max(0,b); }, 0) || 1;
      var cx = padL + iw / 2, cy = padT + ih / 2, r = Math.min(iw, ih) / 2 - 4, a0 = -Math.PI / 2;
      vals.forEach(function(v, i){
        var a1 = a0 + Math.max(0, v) / sum * Math.PI * 2;
        var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        var big = (a1 - a0) > Math.PI ? 1 : 0;
        svg += '<path d="M' + cx + ' ' + cy + ' L' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' + big + ' 1 ' + x1 + ' ' + y1 + ' Z" fill="' +
               colors[i % colors.length] + '" stroke="#fff" stroke-width="1"/>';
        a0 = a1;
      });
    } else {
      /* 坐标轴 */
      svg += '<line x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (padL + iw) + '" y2="' + (padT + ih) + '" stroke="#c9d2db"/>';
      svg += '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + ih) + '" stroke="#c9d2db"/>';
      var n = Math.max(1, s.cats.length || (s.series[0] ? s.series[0].values.length : 1));
      var slot = iw / n;
      if(s.chartKind === 'line' || s.chartKind === 'area' || s.chartKind === 'radar' || s.chartKind === 'scatter'){
        s.series.forEach(function(se, si){
          var pts = se.values.map(function(v, i){
            return (padL + slot * (i + 0.5)) + ',' + (padT + ih - (Math.max(0, v) / maxV) * ih);
          });
          svg += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + colors[si % colors.length] + '" stroke-width="2"/>';
          se.values.forEach(function(v, i){
            svg += '<circle cx="' + (padL + slot * (i + 0.5)) + '" cy="' + (padT + ih - (Math.max(0, v) / maxV) * ih) +
                   '" r="2.6" fill="' + colors[si % colors.length] + '"/>';
          });
        });
      } else {
        var groups = s.series.length;
        var bw = Math.max(2, slot * 0.62 / Math.max(1, groups));
        s.series.forEach(function(se, si){
          se.values.forEach(function(v, i){
            var bh = (Math.max(0, v) / maxV) * ih;
            var bx = padL + slot * i + slot * 0.19 + si * bw;
            svg += '<rect x="' + bx + '" y="' + (padT + ih - bh) + '" width="' + bw + '" height="' + bh +
                   '" fill="' + colors[si % colors.length] + '"/>';
          });
        });
      }
      /* 分类标签 */
      s.cats.forEach(function(c, i){
        if(n > 10 && i % Math.ceil(n / 8) !== 0) return;
        var tx = padL + slot * (i + 0.5);
        var label = String(c).slice(0, 6).replace(/[<>&]/g, '');
        svg += '<text x="' + tx + '" y="' + (padT + ih + 13) + '" font-size="9" fill="#5a6672" text-anchor="middle">' + label + '</text>';
      });
    }
    svg += '</svg>';
    box.innerHTML = head + '<div style="flex:1;min-height:0;position:relative">' + svg + '</div>';
    return box;
  }

  function render(s){
    if(s.type === 'table') return renderTable(s);
    if(s.type === 'smartart'){
      return renderSmartArt(s, { fills:['#4472C4','#5B9BD5','#8FAADC','#B4C7E7'], line:'#9DB2C8' });
    }
    if(s.type === 'chart') return renderChart(s);
    return null;
  }

  /* ---------------- OMML → LaTeX ---------------- */
  var CHR = { '∫':'\\int', '∬':'\\iint', '∭':'\\iiint', '∮':'\\oint',
              '∑':'\\sum', '∏':'\\prod', '∐':'\\coprod', '⋃':'\\bigcup', '⋂':'\\bigcap',
              '∮':'\\oint', '√':'\\sqrt', '∂':'\\partial', '∞':'\\infty', '≤':'\\leq', '≥':'\\geq',
              '≠':'\\neq', '≈':'\\approx', '±':'\\pm', '×':'\\times', '÷':'\\div', '→':'\\rightarrow',
              '←':'\\leftarrow', '⇒':'\\Rightarrow', '∈':'\\in', '∉':'\\notin', '⊂':'\\subset',
              '∪':'\\cup', '∩':'\\cap', '∀':'\\forall', '∃':'\\exists', '∇':'\\nabla', '∠':'\\angle',
              '°':'^{\\circ}', '′':"'", '″':"''", '⋅':'\\cdot', '…':'\\ldots', '⋯':'\\cdots' };

  function escTex(s){
    return String(s || '')
      .replace(/\\/g, '\\backslash ')
      .replace(/([{}$&#_%^~])/g, function(c){ return '\\' + c; });
  }
  function chrTex(ch){
    if(CHR[ch]) return CHR[ch];
    return escTex(ch);
  }
  function txtTex(str){
    var out = '';
    for(var i=0;i<str.length;i++){
      var ch = str[i];
      if(/[A-Za-z0-9]/.test(ch)) out += ch;
      else out += chrTex(ch);
    }
    return out;
  }
  function ommlChildren(n){
    var out = [];
    if(!n || !n.childNodes) return out;
    for(var i=0;i<n.childNodes.length;i++) if(n.childNodes[i].nodeType === 1) out.push(n.childNodes[i]);
    return out;
  }
  function ommlToTex(node){
    if(!node) return '';
    function conv(n){
      if(!n) return '';
      var name = ln(n);
      switch(name){
        case 'oMath': case 'oMathPara': case 'e': case 'num': case 'den': case 'sub': case 'sup':
        case 'fName': case 'lim': case 'deg': case 'box': case 'groupChr':
          return ommlChildren(n).map(conv).join('');
        case 'r': {
          var t = first(n, 't');
          return t ? txtTex(t.textContent || '') : '';
        }
        case 't': return txtTex(n.textContent || '');
        case 'f': {
          var num2 = first(n, 'num'), den = first(n, 'den');
          return '\\frac{' + conv(num2) + '}{' + conv(den) + '}';
        }
        case 'sSub': {
          var b1 = first(n, 'e'), s1 = first(n, 'sub');
          return '{' + conv(b1) + '}_{' + conv(s1) + '}';
        }
        case 'sSup': {
          var b2 = first(n, 'e'), s2 = first(n, 'sup');
          return '{' + conv(b2) + '}^{' + conv(s2) + '}';
        }
        case 'sSubSup': {
          var b3 = first(n, 'e'), s3 = first(n, 'sub'), s4 = first(n, 'sup');
          return '{' + conv(b3) + '}_{' + conv(s3) + '}^{' + conv(s4) + '}';
        }
        case 'sPre': {
          var b4 = first(n, 'e'), s5 = first(n, 'sub'), s6 = first(n, 'sup');
          return '{}_{' + conv(s5) + '}^{' + conv(s6) + '}{' + conv(b4) + '}';
        }
        case 'rad': {
          var deg = first(n, 'deg'), e1 = first(n, 'e');
          var dTex = conv(deg);
          if(dTex && dTex.replace(/[\s{}]/g, '')) return '\\sqrt[' + dTex + ']{' + conv(e1) + '}';
          return '\\sqrt{' + conv(e1) + '}';
        }
        case 'nary': {
          var naryPr = first(n, 'naryPr');
          var chr = '∑';
          if(naryPr){
            var c2 = first(naryPr, 'chr');
            if(c2 && attr(c2, 'val')) chr = attr(c2, 'val');
          }
          var op = CHR[chr] || '\\sum';
          var sub = first(n, 'sub'), sup = first(n, 'sup'), e2 = first(n, 'e');
          var out = op;
          if(sub){ var st = conv(sub); if(st.trim()) out += '_{' + st + '}'; }
          if(sup){ var pt = conv(sup); if(pt.trim()) out += '^{' + pt + '}'; }
          return out + ' ' + conv(e2);
        }
        case 'd': {
          var dPr = first(n, 'dPr');
          var beg = '(', end = ')';
          if(dPr){
            var b = first(dPr, 'begChr'), en = first(dPr, 'endChr');
            if(b) beg = attr(b, 'val');
            if(en) end = attr(en, 'val');
            if(beg === '{' ) beg = '\\{';
            if(end === '}') end = '\\}';
            if(beg === '') beg = '.';
            if(end === '') end = '.';
          }
          var inner = ommlChildren(n).filter(function(k){ return ln(k) === 'e'; }).map(conv).join(',');
          return '\\left' + beg + inner + '\\right' + end;
        }
        case 'func': {
          var fn = first(n, 'fName'), fe = first(n, 'e');
          var fnTex = conv(fn).trim();
          if(/^[A-Za-z]+$/.test(fnTex)) fnTex = '\\' + fnTex;
          return fnTex + '\\left(' + conv(fe) + '\\right)';
        }
        case 'bar': {
          var bPr = first(n, 'barPr'), pos = bPr ? attr(first(bPr, 'pos'), 'val') : '';
          var be = conv(first(n, 'e'));
          return (pos === 'bot' ? '\\underline{' : '\\overline{') + be + '}';
        }
        case 'acc': {
          var aPr = first(n, 'accPr'), aChr = '^';
          if(aPr){ var ac = first(aPr, 'chr'); if(ac) aChr = attr(ac, 'val'); }
          var ae = conv(first(n, 'e'));
          var cmd = aChr === '̄' ? '\\bar' : (aChr === '→' ? '\\vec' : (aChr === '˙' ? '\\dot' : (aChr === '¨' ? '\\ddot' : '\\hat')));
          return cmd + '{' + ae + '}';
        }
        case 'limLow': {
          var le = conv(first(n, 'e')), ll = conv(first(n, 'lim'));
          return '{' + le + '}_{' + ll + '}';
        }
        case 'limUpp': {
          var ue = conv(first(n, 'e')), ul = conv(first(n, 'lim'));
          return '{' + ue + '}^{' + ul + '}';
        }
        case 'm': {
          var rows = kids(n, 'mr').map(function(mr){
            return kids(mr, 'e').map(conv).join(' & ');
          }).filter(function(r){ return r.replace(/\s|&/g,''); });
          if(!rows.length) return '';
          return '\\begin{matrix}' + rows.join(' \\\\ ') + '\\end{matrix}';
        }
        case 'eqArr': {
          var rows2 = kids(n, 'e').map(conv).filter(function(r){ return r.trim(); });
          return '\\begin{aligned}' + rows2.join(' \\\\ ') + '\\end{aligned}';
        }
        default:
          return ommlChildren(n).map(conv).join('');
      }
    }
    try{
      var tex = conv(node);
      return tex.replace(/\s+/g, ' ').trim();
    }catch(e){ return ''; }
  }

  window.PPTExt = {
    tableShape: tableShape,
    smartartShape: smartartShape,
    chartShape: chartShape,
    render: render,
    ommlToTex: ommlToTex,
    parseXml: parseXml,
    ln: ln,
    first: first
  };
})();
