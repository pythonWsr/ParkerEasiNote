(function(){
'use strict';

const S = {
    mode: 'whiteboard',
    pages: [{ bg: '#0F261E', elements: [] }],
    pageIdx: 0,
    tool: 'pen',
    penColor: '#ffffff',
    penThickness: 4,
    eraserSize: 64,
    /* 手势橡皮：笔模式下用较大接触面积（手掌/拇指侧面）擦除，抬手自动回到笔 */
    gestureEraser: localStorage.getItem('easinote_gesture_eraser') !== '0',
    gestureSens: (function(){
        var v = parseFloat(localStorage.getItem('easinote_gesture_sens'));
        if(isNaN(v)) v = 50;
        return Math.max(0, Math.min(100, v));
    })(),
    contactBase: 0,      /* 用户常规接触面积基线（自适应） */
    activePtrs: new Set(),
    thumbDirty: true,
    apiKey: localStorage.getItem('easinote_api_key') || '',
    lastSummary: 0,
    summarizing: false,
    abortAI: null,
    ppt: null,          
    slideIdx: 0,
    touches: new Map(),
    history: [],
    hIndex: 0,
    selection: { 
        object: null, 
        mask: null, 
        lassoPoints: [], 
        isLassoing: false, 
        dragMode: null, 
        dragStart: {x:0,y:0}, 
        startRect: null 
    },
    cameraStream: null,
    camView: { x:0, y:0, s:1 },
    cameraFrozen: false,
    cameraFreezeSrc: '',
    submenuTarget: null,
    narrow: false,
    clockTimer: null,
    prep: null,
    prepIdx: 0,
    prepSel: null,
    prepTool: 'select',
    prepShape: 'rect',
    prepTextColor: '#1b1b1b',
    prepFillColor: '#2DC360',
    prepFillOn: true,
    prepStrokeColor: '#1b1b1b',
    prepStrokeWidth: 2,
    prepFontSize: 28,
    prepBold: false,
    prepDrag: null,
    prepAnnotate: false,
    prepLastTap: null,
    doc: null,
    docIdx: 0,
    present: null,
    zoom: (function(){
        var v = parseFloat(localStorage.getItem('easinote_zoom'));
        if(isNaN(v) || v < 0.25 || v > 2) v = 1;
        return v;
    })()
};

const $ = id => document.getElementById(id);
const D = {
    app: $('app'), bg: $('bg-layer'), canvas: $('drawing-board'), cursor: $('eraser-cursor'),
    clock: $('clock'), pageInd: $('page-indicator'),
    toolbar: $('bottom-toolbar'), indicator: $('tool-indicator'), left: $('bottom-left'), right: $('bottom-right'),
    leftMenu: $('left-menu-panel'), submenu: $('submenu'), selBar: $('selection-bar'),
    toast: $('toast-container'), narrow: $('narrow-warning'),
    bigTime: $('big-time'), bigVal: $('big-time-val'), bigDate: $('big-time-date'),
    drawerOverlay: $('drawer-overlay'), drawer: $('drawer'), drawerBody: $('drawer-body'),
    modalRoot: $('modal-root'), fileImage: $('file-image'), filePpt: $('file-ppt'),
    fileAny: $('file-any'), filePrepImage: $('file-prep-image'),
    presentLayer: $('present-layer'), presentStage: $('present-stage'), presentInd: $('present-ind'),
    aiAura: $('ai-aura'),
    aiLoading: $('ai-loading')
};
const ctx = D.canvas.getContext('2d');
let DPR = window.devicePixelRatio || 1;
let CW = 0, CH = 0;

/* ===== 界面缩放 ===== */
function applyZoom(){
    var z = S.zoom;
    if(!z || isNaN(z) || z <= 0) z = 1;
    var html = document.documentElement;
    if(Math.abs(z - 1) < 0.001){
        html.style.transform = '';
        html.style.transformOrigin = '';
        html.style.width = '';
        html.style.height = '';
    } else {
        html.style.transformOrigin = '0 0';
        html.style.transform = 'scale(' + z + ')';
        html.style.width = (100 / z) + '%';
        html.style.height = (100 / z) + '%';
    }
}

/* ===== 缩放确认：先应用，给 10 秒反悔时间，超时自动还原 ===== */
var zoomTimer = null, zoomPrev = 1;
function askZoomApply(prev){
    var el = document.getElementById('zoom-confirm');
    if(!el){ return; }
    zoomPrev = (typeof prev === 'number' && prev > 0) ? prev : 1;
    el.classList.add('open');
    var secEl = el.querySelector('.zc-sec');
    var sec = 10;
    secEl.textContent = sec;
    if(zoomTimer) clearInterval(zoomTimer);
    zoomTimer = setInterval(function(){
        sec--;
        if(sec <= 0){
            clearInterval(zoomTimer); zoomTimer = null;
            el.classList.remove('open');
            revertZoom();
            return;
        }
        secEl.textContent = sec;
    }, 1000);
    el.querySelector('#zc-ok').onclick = function(){
        if(zoomTimer){ clearInterval(zoomTimer); zoomTimer = null; }
        el.classList.remove('open');
    };
    el.querySelector('#zc-back').onclick = function(){
        if(zoomTimer){ clearInterval(zoomTimer); zoomTimer = null; }
        el.classList.remove('open');
        revertZoom();
    };
}
function revertZoom(){
    S.zoom = zoomPrev;
    try{ localStorage.setItem('easinote_zoom', String(S.zoom)); }catch(e){}
    applyZoom();
    resizeCanvas();
    checkNarrow();
    setActiveToolUI();
    if(S.mode === 'prep') scaleStage();
    toast('已恢复原缩放', 'fa-rotate-left');
}

function toast(msg, icon){
    if(!icon) icon = 'fa-info-circle';
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<i class="fas '+icon+'"></i><span>'+msg+'</span>';
    D.toast.appendChild(el);
    setTimeout(function(){ el.classList.add('out'); setTimeout(function(){el.remove();},300); }, 2200);
}

/* ===== 通用触摸滚动 =====
   某些 WebView（尤其页面根节点被 transform:scale 缩放后）原生 overflow 滚动会失效或半路卡死。
   这里接管单指上下拖动：直接改 scrollTop，带惯性与点击抑制，滑块/输入框区域不拦截。 */
function makeScrollable(el){
    if(!el || el.__easiScroll) return;
    el.__easiScroll = true;
    var startY = 0, startTop = 0, lastY = 0, v = 0, moved = false, active = false, raf = 0;

    function stopMomentum(){ if(raf){ cancelAnimationFrame(raf); raf = 0; } }

    el.addEventListener('touchstart', function(e){
        if(e.touches.length !== 1){ active = false; stopMomentum(); return; }
        var t = e.touches[0];
        var tag = (t.target && t.target.tagName) || '';
        if(/^(INPUT|TEXTAREA|SELECT)$/.test(tag)){ active = false; return; }
        active = true; moved = false;
        startY = lastY = t.clientY;
        startTop = el.scrollTop;
        v = 0;
        stopMomentum();
    }, { passive:true });

    el.addEventListener('touchmove', function(e){
        if(!active || e.touches.length !== 1) return;
        var t = e.touches[0];
        var dy = t.clientY - startY;
        if(!moved && Math.abs(dy) < 4) return;      /* 轻点不当作拖动，保证点击正常 */
        moved = true;
        if(e.cancelable) e.preventDefault();
        e.stopPropagation();
        /* 页面整体被 scale(zoom) 过：视口位移换算成布局位移 */
        var z = S.zoom || 1;
        el.scrollTop = startTop - dy / z;
        v = t.clientY - lastY;
        lastY = t.clientY;
    }, { passive:false });

    el.addEventListener('touchend', function(){
        if(!active) return;
        active = false;
        if(!moved) return;
        /* 拖动结束后吃掉紧随其后的 click，避免误选页面 */
        var kill = function(ev){ ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener('click', kill, true);
        setTimeout(function(){ el.removeEventListener('click', kill, true); }, 350);
        var speed = v / (S.zoom || 1);
        if(Math.abs(speed) < 0.6) return;
        (function glide(){
            speed *= 0.94;
            el.scrollTop -= speed;
            if(Math.abs(speed) > 0.5) raf = requestAnimationFrame(glide);
            else raf = 0;
        })();
    }, { passive:true });

    el.addEventListener('touchcancel', function(){ active = false; stopMomentum(); }, { passive:true });
}

function openModal(opts){
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const actions = opts.actions || [{ id:'close', label:'确定', type:'confirm' }];
    const actHtml = actions.map(function(a){
        return '<button class="btn '+(a.type==='confirm'?'btn-confirm':'btn-cancel')+'" data-act="'+a.id+'">'+a.label+'</button>';
    }).join('');
    overlay.innerHTML = 
        '<div class="modal '+(opts.cls||'')+'">' +
            '<div class="modal-head">' +
                (opts.title ? '<h3 class="modal-title">'+opts.title+'</h3>' : '<h3 class="modal-title"></h3>') +
                '<button class="modal-maximize" type="button" title="最大化/还原" aria-label="最大化/还原"><i class="fas fa-expand"></i></button>' +
            '</div>' +
            '<div class="modal-body">'+(opts.content||'')+'</div>' +
            '<div class="modal-actions">'+actHtml+'</div>' +
        '</div>';
    D.modalRoot.appendChild(overlay);
    var modalBody = overlay.querySelector('.modal-body');
    if(modalBody) makeScrollable(modalBody);
    var maxBtn = overlay.querySelector('.modal-maximize');
    maxBtn.onclick = function(e){
        e.stopPropagation();
        var isMax = overlay.classList.toggle('maximized');
        maxBtn.innerHTML = isMax ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
        maxBtn.title = isMax ? '还原窗口' : '最大化窗口';
        requestAnimationFrame(function(){ resizeCanvas(); });
    };
    requestAnimationFrame(function(){overlay.classList.add('open');});
    overlay.querySelectorAll('[data-act]').forEach(function(btn){
        btn.onclick = function(e){
            e.stopPropagation();
            const act = actions.find(function(a){return a.id===btn.dataset.act;}) || { id:'close' };
            if(act.callback) act.callback(overlay);
            else closeModal(overlay);
        };
    });
    overlay.addEventListener('click', function(e){ if(e.target===overlay) closeModal(overlay); });
    return overlay;
}
function closeModal(overlay){
    /* 允许不传参：关掉最上层仍打开的弹窗（外部脚本/快捷键调用更安全） */
    if(!overlay){
        var opens = document.querySelectorAll('#modal-root .modal-overlay.open');
        overlay = opens.length ? opens[opens.length - 1] : null;
    }
    if(!overlay || !overlay.classList) return;
    overlay.classList.remove('open');
    setTimeout(function(){ if(overlay.parentNode) overlay.remove(); }, 300);
}
/* 供外部/快捷键使用：关闭最上层弹窗，返回是否关掉了 */
window.EN10CloseTopModal = function(){ closeModal(null); };

function resizeCanvas(){
    const r = D.app.getBoundingClientRect();
    const z = S.zoom || 1;
    var dpr = window.devicePixelRatio || 1;
    var visW = Math.max(1, r.width), visH = Math.max(1, r.height);
    /* 超大画布会被 GPU 降采样，反而更糊；这里限制总像素并保底 2x */
    var maxPixels = 5.4e6;
    if (visW * visH * dpr * dpr > maxPixels) {
        dpr = Math.max(2, Math.min(dpr, Math.sqrt(maxPixels / (visW * visH))));
    }
    DPR = dpr;
    /* rect 是缩放后的视觉尺寸，除以 z 得到逻辑尺寸 */
    CW = visW / z;
    CH = visH / z;
    var pw = Math.max(1, Math.round(CW * z * DPR));
    var ph = Math.max(1, Math.round(CH * z * DPR));
    D.canvas.style.width = CW + 'px';
    D.canvas.style.height = CH + 'px';
    if (D.canvas.width !== pw || D.canvas.height !== ph) {
        D.canvas.width = pw;
        D.canvas.height = ph;
    }
    syncBaseTransform();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    redraw();
    scaleStage();
}
/* 用真实像素尺寸反推变换，使 1 逻辑单位严格落在整数设备像素上，避免半像素发虚 */
function syncBaseTransform(k){
    if (k === undefined) k = D.canvas.width / Math.max(1, CW);
    ctx.setTransform(k || 1, 0, 0, k || 1, 0, 0);
    return k;
}

function getElements(){
    if(S.mode==='ppt' && S.ppt && S.ppt.slides[S.slideIdx]) return S.ppt.slides[S.slideIdx].elements;
    if(S.mode==='prep'){
        var pg = S.prep && S.prep.pages[S.prepIdx];
        if(!pg) return null;
        if(!pg.ink) pg.ink = [];
        return pg.ink;
    }
    if(S.mode==='doc' || S.mode==='present') return null;
    return (S.pages[S.pageIdx] || {elements:[]}).elements;
}
function setElements(arr){
    if(S.mode==='ppt' && S.ppt && S.ppt.slides[S.slideIdx]) S.ppt.slides[S.slideIdx].elements = arr;
    else if(S.mode==='prep' && S.prep && S.prep.pages[S.prepIdx]) S.prep.pages[S.prepIdx].ink = arr;
    else if(S.mode==='whiteboard' || S.mode==='camera') S.pages[S.pageIdx].elements = arr;
}
function getBg(){
    if(S.mode==='ppt' || S.mode==='prep' || S.mode==='doc' || S.mode==='present') return '#ffffff';
    if(S.mode==='camera') return '#000000';
    return S.pages[S.pageIdx].bg;
}

/* ===== 静态层缓存：落笔时只重绘当前这一笔，避免整页重绘卡顿 ===== */
var cacheCanvas = document.createElement('canvas');
var cacheCtx = cacheCanvas.getContext('2d');
var cacheValid = false;
function invalidateInk(){ cacheValid = false; }

/* 图片统一圆角：半径跟随尺寸，小图不会被切掉太多 */
function imageRadiusOf(w, h){
    var m = Math.min(Math.abs(w || 0), Math.abs(h || 0));
    if(!m) return 0;
    return Math.max(0, Math.min(18, m * 0.08));
}
function roundedRectPath(c, x, y, w, h, r){
    if(r <= 0){ c.rect(x, y, w, h); return; }
    if(c.roundRect){ c.roundRect(x, y, w, h, r); return; }
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
}
function drawRoundedImage(c, img, x, y, w, h){
    var r = imageRadiusOf(w, h);
    if(r <= 0){ c.drawImage(img, x, y, w, h); return; }
    c.save();
    c.beginPath();
    roundedRectPath(c, x, y, w, h, r);
    c.closePath();
    c.clip();
    c.drawImage(img, x, y, w, h);
    c.restore();
}

function paintOne(c, el){
    if(!el) return;
    if(el.type==='eraser'){
        drawEraserStroke(c, el);
    } else if(el.type==='pen'){
        drawInkStroke(c, el);
    } else if(el.type==='image' && el.img && el.img.complete && el.img.naturalWidth){
        drawRoundedImage(c, el.img, el.x, el.y, el.w, el.h);
    } else if(el.type==='shape'){
        drawShapeEl(c, el);
    } else if(el.type==='mask'){
        if (!el.points || el.points.length < 3) return;
        c.beginPath();
        c.moveTo(el.points[0].x, el.points[0].y);
        for (var j = 1; j < el.points.length; j++) c.lineTo(el.points[j].x, el.points[j].y);
        c.closePath();
        /* 由调用方设置 destination-out，这里的颜色不参与混色，只需不透明 */
        c.fillStyle = '#000';
        c.fill();
    }
}

/* 批注笔迹统一存“页面坐标”，这样换设备/换分辨率打开都不会错位 */
function prepStageScale(){
    var st = document.getElementById('prep-stage');
    if(!st) return null;
    var r = st.getBoundingClientRect();
    if(!r.width) return null;
    return { r:r, sc: r.width / Math.max(1, S.prep ? S.prep.w : 1) };
}
function inkCoord(t){
    if(S.mode === 'prep'){
        var info = prepStageScale();
        if(info){
            return { x:(t.clientX - info.r.left) / info.sc, y:(t.clientY - info.r.top) / info.sc };
        }
    }
    return coords(t);
}
function inkTransform(c){
    var base = (D.canvas.width / Math.max(1, CW));
    var baseY = (D.canvas.height / Math.max(1, CH));
    if(S.mode === 'prep'){
        var info = prepStageScale();
        if(info){
            c.setTransform(base*info.sc, 0, 0, baseY*info.sc, base*info.r.left, baseY*info.r.top);
            return;
        }
    }
    c.setTransform(base, 0, 0, baseY, 0, 0);
}
/* 画布设备像素 / 逻辑像素的真实倍率（含界面缩放与 DPR 取整）。
   选区截图、遮罩都必须用它：只乘 DPR 的话，界面缩放不是 100% 时整块选区会错位。 */
function inkScale(){
    return {
        x: D.canvas.width / Math.max(1, CW),
        y: D.canvas.height / Math.max(1, CH)
    };
}

function rebuildCache(){
    if(cacheCanvas.width !== D.canvas.width || cacheCanvas.height !== D.canvas.height){
        cacheCanvas.width = D.canvas.width;
        cacheCanvas.height = D.canvas.height;
        cacheValid = false;
    }
    var c = cacheCtx;
    c.setTransform(1,0,0,1,0,0);
    c.clearRect(0,0,cacheCanvas.width,cacheCanvas.height);
    var els = getElements() || [];
    if(!els.length){ cacheValid = true; return; }
    inkTransform(c);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    for(var i=0;i<els.length;i++){
        c.save();
        c.globalCompositeOperation = (els[i].type==='eraser' || els[i].type==='mask') ? 'destination-out' : 'source-over';
        paintOne(c, els[i]);
        c.restore();
    }
    cacheValid = true;
}

function redraw(reuseCache){
    if(!D.canvas.width || !D.canvas.height) return;
    if(!cacheValid || reuseCache !== true) rebuildCache();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,D.canvas.width,D.canvas.height);
    ctx.drawImage(cacheCanvas, 0, 0);
    inkTransform(ctx);

    /* 正在书写的笔迹单独叠加 */
    S.touches.forEach(function(rec){
        if(rec && rec.el){
            ctx.save();
            ctx.globalCompositeOperation = (rec.el.type==='eraser') ? 'destination-out' : 'source-over';
            paintOne(ctx, rec.el);
            ctx.restore();
        }
    });

    if(S.selection.lassoPoints && S.selection.lassoPoints.length>1){
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(S.selection.lassoPoints[0].x, S.selection.lassoPoints[0].y);
        for(var k=1;k<S.selection.lassoPoints.length;k++) ctx.lineTo(S.selection.lassoPoints[k].x, S.selection.lassoPoints[k].y);
        ctx.strokeStyle = '#2DC360';
        ctx.lineWidth = 2;
        ctx.setLineDash([8,5]);
        ctx.stroke();
        ctx.restore();
    }
    
    drawSelectionOverlay();
}

function pressureOf(p){
    var v = (p && p.pressure != null && !isNaN(p.pressure)) ? p.pressure : 0.5;
    return Math.max(0.08, Math.min(1, v));
}

/* 变宽丝带笔迹：曲线中心线 + 两侧偏移 + 单次填充，边缘锐利无接缝 */
function drawInkStroke(c, el){
    var pts = (el.pointsWithPressure && el.pointsWithPressure.length>1) ? el.pointsWithPressure : el.points;
    if(!pts || !pts.length) return;
    var base = Math.max(0.8, el.thickness || 4);
    c.setLineDash([]);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = el.color;
    c.fillStyle = el.color;

    if(pts.length === 1){
        var r0 = Math.max(0.7, base * (0.35 + pressureOf(pts[0]) * 0.55));
        c.beginPath();
        c.arc(pts[0].x, pts[0].y, r0, 0, Math.PI*2);
        c.fill();
        return;
    }

    /* 1. 抽稀：去掉 0.4px 内的冗余采样，减轻计算量又不影响观感 */
    var q = [pts[0]];
    for(var i=1;i<pts.length;i++){
        var pp = pts[i], last = q[q.length-1];
        var dx = pp.x - last.x, dy = pp.y - last.y;
        if(dx*dx + dy*dy < 0.16){
            last.pressure = pressureOf(pp); /* 保持末端压力更新 */
            continue;
        }
        q.push(pp);
    }
    if(q.length === 1){ q.push({x:q[0].x+0.01, y:q[0].y+0.01, pressure:pressureOf(q[0])}); }

    var n = q.length;
    var half = new Array(n);
    for(var j=0;j<n;j++){
        var t = n > 1 ? j/(n-1) : 0;
        /* 末端收锋；起笔从细到粗渐入（避免一落笔就鼓出一个圆点） */
        var taper = 1;
        if(t > 0.88) taper = 1 - ((t-0.88)/0.12) * 0.42;
        if(t < 0.08) taper *= 0.62 + (t/0.08) * 0.38;
        var w = base * (0.42 + pressureOf(q[j]) * 0.78) * taper;
        half[j] = Math.max(0.62, w/2);
    }

    /* 2. 法线（中心差分），保证转角处宽度连续 */
    var nx = new Array(n), ny = new Array(n);
    for(var m=0;m<n;m++){
        var a = q[Math.max(0,m-1)], b = q[Math.min(n-1,m+1)];
        var vx = b.x - a.x, vy = b.y - a.y;
        var len = Math.sqrt(vx*vx + vy*vy) || 1;
        nx[m] = -vy/len;
        ny[m] = vx/len;
    }

    /* 3. 轮廓：左边正向 → 右端 → 右边反向 → 闭合，单次填充保证锐利无接缝 */
    c.beginPath();
    c.moveTo(q[0].x + nx[0]*half[0], q[0].y + ny[0]*half[0]);
    for(var k1=1;k1<n-1;k1++){
        var cx1 = q[k1].x + nx[k1]*half[k1], cy1 = q[k1].y + ny[k1]*half[k1];
        var ex1 = q[k1+1].x + nx[k1+1]*half[k1+1], ey1 = q[k1+1].y + ny[k1+1]*half[k1+1];
        c.quadraticCurveTo(cx1, cy1, (cx1+ex1)/2, (cy1+ey1)/2);
    }
    c.lineTo(q[n-1].x + nx[n-1]*half[n-1], q[n-1].y + ny[n-1]*half[n-1]);
    c.lineTo(q[n-1].x - nx[n-1]*half[n-1], q[n-1].y - ny[n-1]*half[n-1]);
    for(var k2=n-2;k2>0;k2--){
        var cx2 = q[k2].x - nx[k2]*half[k2], cy2 = q[k2].y - ny[k2]*half[k2];
        var ex2 = q[k2-1].x - nx[k2-1]*half[k2-1], ey2 = q[k2-1].y - ny[k2-1]*half[k2-1];
        c.quadraticCurveTo(cx2, cy2, (cx2+ex2)/2, (cy2+ey2)/2);
    }
    c.closePath();
    c.fill();
    /* 两端圆帽：起点帽取后一点半径，避免起笔突兀的小圆点 */
    var rStart = Math.min(half[0], (n>1?half[1]:half[0]) * 1.05);
    c.beginPath();
    c.arc(q[0].x, q[0].y, rStart, 0, Math.PI*2);
    c.fill();
    c.beginPath();
    c.arc(q[n-1].x, q[n-1].y, half[n-1], 0, Math.PI*2);
    c.fill();
}

function drawEraserStroke(c, el){
    const pts = el.points;
    if(!pts || pts.length===0) return;
    const size = el.thickness;
    c.setLineDash([]);
    c.strokeStyle = 'rgba(0,0,0,1)';
    c.fillStyle = 'rgba(0,0,0,1)';
    c.lineWidth = size;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if(pts.length === 1){
        c.beginPath();
        c.arc(pts[0].x, pts[0].y, size/2, 0, Math.PI*2);
        c.fill();
        return;
    }
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for(var i=1;i<pts.length;i++) c.lineTo(pts[i].x, pts[i].y);
    c.stroke();
}

function drawShapeEl(c, el){
    var x1=el.startX, y1=el.startY, x2=el.endX, y2=el.endY;
    var w=Math.abs(x2-x1), h=Math.abs(y2-y1);
    var l=Math.min(x1,x2), t=Math.min(y1,y2);
    var kind = el.shapeType || 'rect';
    c.save();
    c.beginPath();
    if(kind === 'line'){
        c.moveTo(x1, y1); c.lineTo(x2, y2);
    } else if(kind === 'rect'){
        c.rect(l, t, w, h);
    } else if(kind === 'roundRect'){
        var r = Math.min(w, h) * 0.16;
        if(c.roundRect) c.roundRect(l, t, w, h, r);
        else c.rect(l, t, w, h);
    } else if(kind === 'circle' || kind === 'ellipse'){
        c.ellipse(l + w/2, t + h/2, Math.max(0.5, w/2), Math.max(0.5, h/2), 0, 0, Math.PI*2);
    } else {
        /* 其余图形直接复用课件编辑器的多边形定义，保证两处手感一致 */
        var pts = shapePolygon(kind, w, h);
        if(!pts || !pts.length){ c.rect(l, t, w, h); }
        else {
            pts.forEach(function(pt, i){
                if(i === 0) c.moveTo(l + pt[0], t + pt[1]);
                else c.lineTo(l + pt[0], t + pt[1]);
            });
            c.closePath();
        }
    }
    c.strokeStyle = el.color;
    c.lineWidth = el.thickness;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.stroke();
    c.restore();
}

/* 选择工具：点中图片直接进选框（可拖动/四角缩放），笔迹仍然用套索圈选 */
function hitImageAt(x, y){
    var els = getElements();
    for(var i = els.length - 1; i >= 0; i--){
        var el = els[i];
        if(!el || el.type !== 'image' || !el.img) continue;
        if(x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h) return el;
    }
    return null;
}
function beginImageSelection(el, x, y){
    var cv = document.createElement('canvas');
    var nw = Math.max(1, el.img.naturalWidth || Math.round(el.w));
    var nh = Math.max(1, el.img.naturalHeight || Math.round(el.h));
    var k = Math.min(2, Math.max(1, nw / Math.max(1, el.w)));
    cv.width = Math.max(1, Math.round(Math.abs(el.w) * k));
    cv.height = Math.max(1, Math.round(Math.abs(el.h) * k));
    var c = cv.getContext('2d');
    try{ c.drawImage(el.img, 0, 0, cv.width, cv.height); }catch(err){}
    S.selection.object = { canvas: cv, x: el.x, y: el.y, w: el.w, h: el.h, el: el, direct: true };
    S.selection.mask = null;
    S.selection.dragMode = 'move';
    S.selection.dragStart = { x: x, y: y };
    S.selection.startRect = { x: el.x, y: el.y, w: el.w, h: el.h };
    D.selBar.classList.add('open');
    redraw();
}

function handleSelectStart(x, y) {
    const obj = S.selection.object;
    
    if (obj) {
        const handleR = 30;
        const corners = [
            { name: 'nw', x: obj.x, y: obj.y },
            { name: 'ne', x: obj.x + obj.w, y: obj.y },
            { name: 'sw', x: obj.x, y: obj.y + obj.h },
            { name: 'se', x: obj.x + obj.w, y: obj.y + obj.h }
        ];
        
        for (var i=0; i<corners.length; i++) {
            var c = corners[i];
            if (Math.hypot(x - c.x, y - c.y) <= handleR) {
                S.selection.dragMode = c.name;
                S.selection.dragStart = { x: x, y: y };
                S.selection.startRect = { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
                return;
            }
        }
        
        if (x >= obj.x && x <= obj.x + obj.w && y >= obj.y && y <= obj.y + obj.h) {
            S.selection.dragMode = 'move';
            S.selection.dragStart = { x: x, y: y };
            S.selection.startRect = { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
            return;
        }
        
        commitSelection();
    }

    /* 图片优先：点中图片直接可拖动/缩放，不用先圈选 */
    var imgEl = hitImageAt(x, y);
    if(imgEl){ beginImageSelection(imgEl, x, y); return; }

    S.selection.isLassoing = true;
    S.selection.lassoPoints = [{ x: x, y: y }];
}

function handleSelectMove(x, y) {
    const obj = S.selection.object;
    
    if (S.selection.dragMode && obj) {
        const dx = x - S.selection.dragStart.x;
        const dy = y - S.selection.dragStart.y;
        const r = S.selection.startRect;
        
        if (S.selection.dragMode === 'move') {
            obj.x = r.x + dx;
            obj.y = r.y + dy;
        } else {
            var nx = r.x, ny = r.y, nw = r.w, nh = r.h;
            if (S.selection.dragMode === 'nw') { nx = r.x + dx; ny = r.y + dy; nw = r.w - dx; nh = r.h - dy; }
            if (S.selection.dragMode === 'ne') { ny = r.y + dy; nw = r.w + dx; nh = r.h - dy; }
            if (S.selection.dragMode === 'sw') { nx = r.x + dx; nw = r.w - dx; nh = r.h + dy; }
            if (S.selection.dragMode === 'se') { nw = r.w + dx; nh = r.h + dy; }
            if (nw < 20) nw = 20;
            if (nh < 20) nh = 20;
            obj.x = nx;
            obj.y = ny;
            obj.w = nw;
            obj.h = nh;
        }
        
        redraw();
        return;
    }
    
    if (S.selection.isLassoing) {
        S.selection.lassoPoints.push({ x: x, y: y });
        redraw();
    }
}

function handleSelectEnd() {
    if (S.selection.dragMode) {
        var mode = S.selection.dragMode;
        S.selection.dragMode = null;
        /* 直接选中的图片：松手即写回原元素，不必再点一次才生效；
           选框留着，方便连续微调位置和大小 */
        var obj = S.selection.object;
        if (obj && obj.direct && obj.el) {
            var el = obj.el;
            var changed = (Math.abs(el.x - obj.x) > 0.5 || Math.abs(el.y - obj.y) > 0.5 ||
                           Math.abs(el.w - obj.w) > 0.5 || Math.abs(el.h - obj.h) > 0.5);
            el.x = obj.x; el.y = obj.y;
            el.w = Math.max(16, obj.w); el.h = Math.max(16, obj.h);
            if (changed) pushHistory();
            invalidateInk();
            redraw();
        }
        return;
    }
    
    if (S.selection.isLassoing) {
        S.selection.isLassoing = false;
        var pts = S.selection.lassoPoints;
        S.selection.lassoPoints = []; 
        redraw(); 
        
        /* 快速划一圈往往只有 3~5 个采样点，门槛定太高会出现“圈了却没反应” */
        if (pts && pts.length > 2) {
            createSelectionFromLasso(pts);
        }
    }
}

function createSelectionFromLasso(points) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(function(p){
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    });
    
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 10 || h < 10) return;
    
    const selCanvas = document.createElement('canvas');
    var ks = inkScale();
    selCanvas.width = Math.max(1, Math.round(w * ks.x));
    selCanvas.height = Math.max(1, Math.round(h * ks.y));
    const sctx = selCanvas.getContext('2d');
    
    sctx.beginPath();
    points.forEach(function(p, i){
        const px = (p.x - minX) * ks.x;
        const py = (p.y - minY) * ks.y;
        if (i === 0) sctx.moveTo(px, py); else sctx.lineTo(px, py);
    });
    sctx.closePath();
    sctx.clip();
    
    /* 源矩形必须用画布真实倍率 ks，否则界面缩放后截到的是别的位置 */
    sctx.drawImage(D.canvas, minX * ks.x, minY * ks.y, w * ks.x, h * ks.y, 0, 0, selCanvas.width, selCanvas.height);
    
    try {
        const bgColor = getBg();
        const bgRgb = hexToRgb(bgColor);
        const imgData = sctx.getImageData(0, 0, selCanvas.width, selCanvas.height);
        const data = imgData.data;
        const tol = 40;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) continue;
            if (Math.abs(data[i] - bgRgb.r) <= tol &&
                Math.abs(data[i + 1] - bgRgb.g) <= tol &&
                Math.abs(data[i + 2] - bgRgb.b) <= tol) {
                data[i + 3] = 0;
            }
        }
        sctx.putImageData(imgData, 0, 0);
    } catch (e) { }
    
    /* 遮罩用“擦除”语义：把圈内墨迹从画布上抹掉，露出底图，而不是刷一层纯色。
       这样有背景图片的页面也不会出现一块突兀的色块。 */
    const maskEl = {
        type: 'mask',
        points: points.map(function(p){ return { x: p.x, y: p.y }; }),
        erase: true
    };
    getElements().push(maskEl);
    
    S.selection.object = {
        canvas: selCanvas,
        x: minX, y: minY, w: w, h: h
    };
    S.selection.mask = maskEl;
    S.selection.dragMode = null;
    
    redraw();
    requestAnimationFrame(function(){ redraw(); });
    D.selBar.classList.add('open');
}

function drawSelectionOverlay() {
    const obj = S.selection.object;
    if (!obj) return;
    
    ctx.save();
    /* 选区画布本身就是 w×h 的设备像素图，按源尺寸铺到逻辑矩形上，避免二次缩放 */
    ctx.save();
    ctx.beginPath();
    roundedRectPath(ctx, obj.x, obj.y, obj.w, obj.h, imageRadiusOf(obj.w, obj.h));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(obj.canvas, 0, 0, obj.canvas.width, obj.canvas.height, obj.x, obj.y, obj.w, obj.h);
    ctx.restore();
    
    ctx.strokeStyle = '#2DC360';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
    ctx.setLineDash([]);
    
    const hs = 6;
    const corners = [
        [obj.x, obj.y],
        [obj.x + obj.w, obj.y],
        [obj.x, obj.y + obj.h],
        [obj.x + obj.w, obj.y + obj.h]
    ];
    corners.forEach(function(c){
        var hx = c[0], hy = c[1];
        ctx.beginPath();
        ctx.arc(hx, hy, hs, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#2DC360';
        ctx.lineWidth = 2;
        ctx.stroke();
    });
    
    ctx.restore();
}

function commitSelection() {
    const obj = S.selection.object;
    if (!obj) return;

    /* 直接选中的图片：只把新位置/尺寸写回原元素，不再生成新图片 */
    if(obj.direct && obj.el){
        var el = obj.el;
        var moved = (Math.abs(el.x - obj.x) > 0.5 || Math.abs(el.y - obj.y) > 0.5 ||
                     Math.abs(el.w - obj.w) > 0.5 || Math.abs(el.h - obj.h) > 0.5);
        el.x = obj.x; el.y = obj.y;
        el.w = Math.max(16, obj.w); el.h = Math.max(16, obj.h);
        S.selection.object = null;
        S.selection.dragMode = null;
        S.selection.lassoPoints = [];
        S.selection.isLassoing = false;
        D.selBar.classList.remove('open');
        if(moved) pushHistory();
        invalidateInk();
        redraw();
        return;
    }

    S.selection.object = null;
    S.selection.dragMode = null;
    S.selection.lassoPoints = [];
    S.selection.isLassoing = false;
    D.selBar.classList.remove('open');
    
    /* 直接拿选区自身分辨率的位图，不再按 DPR 二次缩放 */
    const dataUrl = obj.canvas.toDataURL('image/png');
    
    const img = new Image();
    img.onload = function(){ redraw(); };
    img.src = dataUrl;
    
    getElements().push({
        type: 'image', img: img, src: dataUrl,
        x: obj.x, y: obj.y, w: obj.w, h: obj.h
    });
    
    redraw();
    pushHistory();
}

function copySelection() {
    const obj = S.selection.object;
    if (!obj) return;

    /* 直接选中的图片：复制一份原图，偏移一点，原图位置不变 */
    if(obj.direct && obj.el){
        var src = obj.el;
        var dup = new Image();
        dup.src = src.src || src.img.src;
        getElements().push({
            type:'image', img: dup, src: dup.src,
            x: src.x + 22, y: src.y + 22, w: src.w, h: src.h
        });
        dup.onload = function(){ invalidateInk(); redraw(); };
        S.selection.object = null;
        S.selection.dragMode = null;
        D.selBar.classList.remove('open');
        redraw();
        pushHistory();
        toast('已复制图片', 'fa-copy');
        return;
    }
    
    /* 直接拿选区自身分辨率的位图，不再按 DPR 二次缩放 */
    const dataUrl = obj.canvas.toDataURL('image/png');
    
    if (S.selection.mask) {
        const maskIdx = getElements().indexOf(S.selection.mask);
        if (maskIdx > -1) getElements().splice(maskIdx, 1);
        S.selection.mask = null;
    }
    
    S.selection.object = null;
    S.selection.dragMode = null;
    S.selection.lassoPoints = [];
    S.selection.isLassoing = false;
    D.selBar.classList.remove('open');
    
    const img = new Image();
    img.onload = function(){ redraw(); };
    img.src = dataUrl;
    
    getElements().push({
        type: 'image', img: img, src: dataUrl,
        x: obj.x, y: obj.y, w: obj.w, h: obj.h
    });
    
    redraw();
    pushHistory();
}

function hexToRgb(hex){
    hex = (hex||'#000').replace('#','');
    if(hex.length===3) hex = hex.split('').map(function(c){return c+c;}).join('');
    return { r:parseInt(hex.substr(0,2),16)||0, g:parseInt(hex.substr(2,2),16)||0, b:parseInt(hex.substr(4,2),16)||0 };
}

$('sel-copy').onclick = function(){ copySelection(); };
/* 圈选后「问 AI」：把选区位图交给 AI，不打断原来的复制/取消流程 */
$('sel-ask').onclick = function(){
    var obj = S.selection.object;
    if(!obj){ return; }
    if(!window.EN10AskAI){ toast('AI 模块未加载','fa-exclamation-triangle'); return; }
    var dataUrl = obj.canvas.toDataURL('image/png');
    /* 提问不改变板书：把遮罩撤掉，相当于「取消」后再问 */
    if (S.selection.mask) {
        var mi = getElements().indexOf(S.selection.mask);
        if (mi > -1) getElements().splice(mi, 1);
        S.selection.mask = null;
    }
    S.selection.object = null;
    S.selection.dragMode = null;
    S.selection.lassoPoints = [];
    D.selBar.classList.remove('open');
    redraw();
    window.EN10AskAI.ask(dataUrl);
};
$('sel-cancel').onclick = function(){
    if (S.selection.mask) {
        const maskIdx = getElements().findIndex(function(e){return e === S.selection.mask;});
        if (maskIdx > -1) getElements().splice(maskIdx, 1);
    }
    S.selection.object = null;
    S.selection.mask = null;
    S.selection.dragMode = null;
    D.selBar.classList.remove('open');
    redraw();
};

function coords(e){
    const r = D.canvas.getBoundingClientRect();
    const z = S.zoom || 1;
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
}

/* ===== 接触面积 → 手势橡皮 =====
   触屏 PointerEvent 的 width/height 是接触椭圆尺寸，手指明显比笔大。
   以用户自己平时的接触面积做基线自适应，换设备/换姿势都不用重新调阈值。 */
function contactSize(t){
    if(!t) return 0;
    var w = t.width || t.radiusX || 0, h = t.height || t.radiusY || 0;
    return Math.max(w, h) || 0;
}
function gestureThreshold(){
    var base = S.contactBase || 24;
    var sens = Math.max(0, Math.min(100, S.gestureSens));
    var f = 2.55 - (sens / 100) * 1.35;   /* 灵敏度越高，阈值越接近常规笔迹 */
    return Math.max(14, base * f);
}
function shouldGestureErase(t){
    if(!S.gestureEraser || !t) return false;
    if(S.gestureSens <= 0) return false;
    if(t.pointerType === 'mouse') return false;
    var cs = contactSize(t);
    return cs > 0 && cs >= gestureThreshold();
}
function noteContact(cs){
    if(!(cs > 0)) return;
    S.contactBase = S.contactBase ? (S.contactBase * 0.82 + cs * 0.18) : cs;
}
function anyGestureEraser(){
    var hit = null;
    S.touches.forEach(function(r){ if(r && r.gesture && !hit) hit = r; });
    return hit;
}

/* 丢掉所有“还在写”的笔迹（切页 / 失焦 / 指针事件丢失时兜底，避免一笔永远糊在画布上） */
function abortTouches(){
    if(S.touches && S.touches.size){
        S.touches.clear();
        D.cursor.style.display = 'none';
        S.selection.lassoPoints = [];
        S.selection.isLassoing = false;
        redraw();
    }
    if(S.activePtrs) S.activePtrs.clear();
}
/* 把失去 up 事件的笔迹正常收笔，避免“加页/橡皮都失效”的假死观感 */
function flushTouches(){
    if(!S.touches || !S.touches.size) return;
    var committed = false;
    S.touches.forEach(function(rec){ if(commitTouchRec(rec, null)) committed = true; });
    S.touches.clear();
    if(S.activePtrs) S.activePtrs.clear();
    D.cursor.style.display = 'none';
    if(committed){ invalidateInk(); pushHistory(); }
    redraw();
}

function onDown(e){
    if(S.narrow) return;
    closeSubmenu();
    
    if(S.selection.object && S.tool !== 'select'){
        commitSelection(); 
    }
    
    if(S.tool==='select'){
        const touch = (e.touches && e.touches[0]) || e;
        const p = coords(touch);
        handleSelectStart(p.x, p.y);
        return;
    }
    if(S.tool==='shape') return;
    
    const list = e.touches ? Array.from(e.touches) : [e];
    for(var i=0; i<list.length; i++){
        var t = list[i];
        var id = t.identifier !== undefined ? t.identifier : (t.pointerId !== undefined ? t.pointerId : 'mouse');
        var p = inkCoord(t);
        var isEraser = (S.tool==='eraser');
        var cs = contactSize(t);
        var gesture = false;
        /* 笔模式下手掌/拇指侧面这类大接触面积直接当橡皮用，抬手自然回到笔 */
        if(!isEraser && S.tool === 'pen' && shouldGestureErase(t)){ isEraser = true; gesture = true; }
        if(!isEraser && S.tool === 'pen') noteContact(cs);
        var pr = 0.5;
        if(!isEraser && t.pressure !== undefined && t.pressure > 0 && t.pressure !== 0.5) pr = t.pressure;
        /* 批注态存页面坐标，线宽同步换算成页面单位 */
        var unit = 1;
        if(S.mode === 'prep'){ var _si = prepStageScale(); if(_si) unit = _si.sc || 1; }
        var eraserW = gesture ? Math.max(S.eraserSize, Math.min(S.eraserSize * 1.5, cs * 1.6)) : S.eraserSize;

        var stroke = {
            type: isEraser ? 'eraser' : 'pen',
            color: isEraser ? '#000' : S.penColor,
            thickness: (isEraser ? eraserW : S.penThickness) / unit,
            points: [{ x:p.x, y:p.y, pressure: pr }]
        };
        /* 不再立即入栈：配合静态层缓存，抬手时才提交 */
        S.touches.set(id, {
            el: stroke, sx: p.x, sy: p.y, lastX: p.x, lastY: p.y,
            lastT: (window.performance && performance.now) ? performance.now() : Date.now(),
            lastV: 0.72, moved: false, gesture: gesture, eraseW: eraserW
        });
        if(gesture){
            D.cursor.style.display = 'block';
            D.cursor.style.left = p.x + 'px';
            D.cursor.style.top = p.y + 'px';
            D.cursor.style.width = eraserW + 'px';
            D.cursor.style.height = eraserW + 'px';
        }
    }
    redraw(true);
}

function onMove(e){
    if(S.narrow) return;
    
    const touch = (e.touches && e.touches[0]) || e;
    var gRec = anyGestureEraser();
    if(S.tool==='eraser' || gRec){
        const p = coords(touch);
        var ew = gRec ? (gRec.eraseW || S.eraserSize) : S.eraserSize;
        D.cursor.style.display = 'block';
        D.cursor.style.left = p.x + 'px';
        D.cursor.style.top = p.y + 'px';
        D.cursor.style.width = ew + 'px';
        D.cursor.style.height = ew + 'px';
    } else {
        D.cursor.style.display = 'none';
    }

    if(S.tool==='select'){
        const t = (e.touches && e.touches[0]) || e;
        handleSelectMove(coords(t).x, coords(t).y);
        return;
    }
    if(S.tool==='shape') return;

    var list;
    if(e.touches) list = Array.from(e.touches);
    else if(e.changedTouches) list = Array.from(e.changedTouches);
    else if(typeof e.getCoalescedEvents === 'function'){
        var samples = e.getCoalescedEvents();
        list = (samples && samples.length) ? samples : [e];
    } else list = [e];
    var dirty = false;
    for(var i=0; i<list.length; i++){
        var t = list[i];
        var id = t.identifier !== undefined ? t.identifier : (t.pointerId !== undefined ? t.pointerId : 'mouse');
        var rec = S.touches.get(id);
        if(!rec) continue;
        var p = inkCoord(t);
        var el = rec.el;
        var isEraser = (el.type === 'eraser');

        /* 指数平滑：慢写过滤抖动，快写自动跟手（避免快速连笔时点稀、看着像断墨） */
        var rawDx = p.x - rec.sx, rawDy = p.y - rec.sy;
        var rawDist = Math.sqrt(rawDx*rawDx + rawDy*rawDy);
        var k = isEraser ? 0.92 : Math.min(0.94, 0.62 + rawDist * 0.055);
        rec.sx += rawDx * k;
        rec.sy += rawDy * k;
        if(!isEraser && rawDist > 80) { rec.sx = p.x; rec.sy = p.y; }
        var sx = rec.sx, sy = rec.sy;

        var dx = sx - rec.lastX, dy = sy - rec.lastY;
        var dist2 = dx*dx + dy*dy;
        if(dist2 < 0.16) continue;

        /* 采样间隔过大时线性补点，保证轮廓连续不断墨 */
        if(dist2 > 900 && !isEraser){
            var steps = Math.min(6, Math.floor(Math.sqrt(dist2) / 24));
            for(var s1=1; s1<steps; s1++){
                var tt = s1/steps;
                el.points.push({
                    x: rec.lastX + dx*tt,
                    y: rec.lastY + dy*tt,
                    pressure: (el.points[el.points.length-1] || {pressure:0.6}).pressure
                });
            }
            sx = rec.sx; sy = rec.sy;
        }

        var now = (window.performance && performance.now) ? performance.now() : Date.now();
        var dt = Math.max(now - rec.lastT, 1);
        var speed = Math.sqrt(dist2) / dt;   /* px/ms */
        rec.lastV = rec.lastV * 0.72 + speed * 0.28;

        var pressure;
        var native = (t.pressure !== undefined && t.pressure !== null) ? t.pressure : t.force;
        if(native !== undefined && native !== null && native > 0 && native !== 0.5 && native < 1){
            pressure = native;
        } else {
            /* 无压感设备用速度模拟：写快变细，写慢变粗 */
            pressure = Math.max(0.42, Math.min(0.94, 0.94 - rec.lastV * 0.46));
        }
        var prev = el.points[el.points.length - 1];
        if(prev && !isEraser){
            pressure = prev.pressure * 0.72 + pressure * 0.28;   /* 压力平滑，避免粗细跳变 */
        }
        el.points.push({ x: sx, y: sy, pressure: pressure });

        rec.lastX = sx; rec.lastY = sy; rec.lastT = now;
        rec.moved = true;
        dirty = true;
    }
    if(dirty) redraw(true);
}

function onUp(e){
    D.cursor.style.display = 'none';
    if(S.tool==='select'){
        handleSelectEnd();
        return;
    }
    if(S.tool==='shape') return;
    
    const list = e.changedTouches ? Array.from(e.changedTouches) : (e.touches ? Array.from(e.touches) : [e]);
    var committed = false;
    for(var i=0; i<list.length; i++){
        var t = list[i];
        var id = t.identifier !== undefined ? t.identifier : (t.pointerId !== undefined ? t.pointerId : 'mouse');
        var rec = S.touches.get(id);
        if(rec){
            if(commitTouchRec(rec, t)) committed = true;
            S.touches.delete(id);
        }
        if(S.activePtrs) S.activePtrs.delete(id);
    }
    if(committed){ invalidateInk(); pushHistory(); }
    redraw();
}

/* 收尾一笔：补末端采样点 + 入到当前页元素里 */
function commitTouchRec(rec, t){
    if(!rec || !rec.el) return false;
    /* 抬手坐标补进最后一个采样点：快速书写时 pointermove 常常漏掉末端，容易看着“断墨” */
    if(t && t.clientX !== undefined && rec.el.points && rec.el.points.length){
        var pu = inkCoord(t);
        var lp = rec.el.points[rec.el.points.length-1];
        var ddx = pu.x - lp.x, ddy = pu.y - lp.y;
        if(ddx*ddx + ddy*ddy > 1){
            rec.el.points.push({ x:pu.x, y:pu.y, pressure:lp.pressure });
        }
    }
    var arr = getElements();
    if(arr && rec.el.points && rec.el.points.length > 0){ arr.push(rec.el); return true; }
    return false;
}

/* ===== 撤销：快照栈（指针式） =====
   栈里每一项都是“某个时刻的完整页面元素”，undo 只把指针往回挪一格再整页恢复，
   所以连续撤销不会把栈掏空、画一笔也不会卡住。 */
function snapElements(){
    var arr = getElements();
    if(!arr) return null;
    var out = [];
    for(var i=0;i<arr.length;i++){
        var e = arr[i];
        if(!e) continue;
        if(e.type === 'image'){
            out.push({ type:'image', src:e.src || (e.img ? e.img.src : ''), x:e.x, y:e.y, w:e.w, h:e.h });
        } else if(e.type === 'pen' || e.type === 'eraser'){
            out.push({ type:e.type, color:e.color, thickness:e.thickness,
                       points:(e.points||[]).map(function(pt){ return { x:pt.x, y:pt.y, pressure:pt.pressure }; }) });
        } else if(e.type === 'shape'){
            out.push({ type:'shape', shapeType:e.shapeType, color:e.color, thickness:e.thickness,
                       startX:e.startX, startY:e.startY, endX:e.endX, endY:e.endY });
        } else {
            try{ out.push(JSON.parse(JSON.stringify(e))); }catch(err){}
        }
    }
    return out;
}

function makeSnap(){
    return { mode:S.mode, page:S.pageIdx, slide:S.slideIdx, prep:S.prepIdx, data:snapElements() };
}

function resetHistory(){
    S.history = [];
    S.hIndex = 0;
    var snap = makeSnap();
    if(snap.data) S.history = [snap];
}

/* 每页（每张幻灯片）各自一份撤销栈，切页回来还能继续撤销自己页面的内容 */
var histStacks = {};
function histKeyNow(){
    return S.mode + ':' + (S.mode === 'prep' ? S.prepIdx : (S.mode === 'ppt' ? S.slideIdx : S.pageIdx));
}
function switchHistStack(){
    var k = histKeyNow();
    if(S._histKey === k) return;
    if(S._histKey) histStacks[S._histKey] = { list:S.history, idx:S.hIndex };
    var saved = histStacks[k];
    S._histKey = k;
    if(saved){ S.history = saved.list; S.hIndex = saved.idx; }
    else { S.history = []; S.hIndex = 0; resetHistory(); }
}
function clearHistStacks(){
    histStacks = {};
    S._histKey = null;
}

function pushHistory(){
    var snap = makeSnap();
    if(!snap.data) return;
    if(S.hIndex < S.history.length - 1) S.history = S.history.slice(0, S.hIndex + 1);
    S.history.push(snap);
    S.hIndex = S.history.length - 1;
    if(S.history.length > 60){ S.history.shift(); S.hIndex--; }
}

function restoreSnap(h){
    var data = (h.data || []).map(function(e){
        if(e.type === 'image' && e.src){
            var img = new Image();
            img.src = e.src;
            return Object.assign({}, e, { img: img });
        }
        return e;
    });
    if(h.mode === 'ppt' && S.ppt){
        S.slideIdx = h.slide || 0;
        if(S.ppt.slides[S.slideIdx]) S.ppt.slides[S.slideIdx].elements = data;
        renderPPT();
    } else if(h.mode === 'prep' && S.prep){
        S.prepIdx = h.prep || 0;
        var pg0 = S.prep.pages[S.prepIdx];
        if(pg0) pg0.ink = data;
        redraw();
        updatePageInd();
        updatePageThumbnails();
    } else {
        S.pageIdx = h.page || 0;
        if(!S.pages[S.pageIdx]) S.pages[S.pageIdx] = { bg:'#0F261E', elements:[] };
        S.pages[S.pageIdx].elements = data;
        updateBg();
        redraw();
        updatePageInd();
    }
    invalidateInk();
    updatePageThumbnails();
}

function undo(){
    if(!S.history || !S.history.length || S.hIndex <= 0){
        toast('没有可撤销的操作','fa-undo');
        return;
    }
    S.hIndex--;
    restoreSnap(S.history[S.hIndex]);
}

var submenuTimer = null;
function closeSubmenu(){
    if(!S.submenuTarget) return;
    D.submenu.classList.add('hide');
    if(submenuTimer) clearTimeout(submenuTimer);
    submenuTimer = setTimeout(function(){
        submenuTimer = null;
        D.submenu.style.display='none';
        D.submenu.classList.remove('hide');
        D.submenu.innerHTML='';
        S.submenuTarget = null;
    },200);
}

function openSubmenu(target, html){
    if(S.submenuTarget===target){
        closeSubmenu();
        return;
    }
    if(S.submenuTarget) closeSubmenu();
    /* 取消上一个菜单的收起定时器，否则快速切换时新菜单会被清空 */
    if(submenuTimer){ clearTimeout(submenuTimer); submenuTimer = null; }
    D.submenu.style.display='flex';
    D.submenu.innerHTML = html;
    D.submenu.classList.remove('hide');
    
    var barEl = (S.mode === 'prep' && D.prepToolbar) ? D.prepToolbar : D.toolbar;
    var anchor = (target && target.getBoundingClientRect) ? target.getBoundingClientRect() : barEl.getBoundingClientRect();
    if(anchor.width === 0 || anchor.height === 0) anchor = barEl.getBoundingClientRect();
    const sr = D.submenu.getBoundingClientRect();
    const z = S.zoom || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    /* 视觉坐标系下计算，再除以 z 转成布局坐标 */
    var left = anchor.left + anchor.width/2 - sr.width/2;
    left = Math.max(12, Math.min(vw - sr.width - 12, left));
    var bottom = vh - anchor.top + 10;
    D.submenu.style.left = (left / z) + 'px';
    D.submenu.style.bottom = (bottom / z) + 'px';
    S.submenuTarget = target;
}

function positionIndicator(){
    var isPrep = (S.mode === 'prep');
    var bar = isPrep ? (D.prepToolbar || document.getElementById('prep-toolbar')) : D.toolbar;
    var ind = isPrep ? (D.prepIndicator || document.getElementById('prep-indicator')) : D.indicator;
    if(!bar || !ind){ return; }
    var act = bar.querySelector('.tool-btn.active');
    if(!act || !act.offsetWidth){ ind.style.opacity = '0'; return; }
    /* 全部用布局坐标计算：offsetLeft 与绝对定位的 padding 基准完全一致，
       不受 transform:scale()、边框和 DPR 取整影响，彻底消除几 px 的错位 */
    var x = act.offsetLeft;
    var w = act.offsetWidth;
    ind.style.width = w + 'px';
    ind.style.transform = 'translateX(' + x + 'px)';
    ind.style.opacity = '1';
}

function setActiveToolUI(){
    if(S.mode === 'prep'){ positionIndicator(); return; }
    document.querySelectorAll('#bottom-toolbar .tool-btn').forEach(function(b){b.classList.remove('active');});
    if(S.tool==='pen') { var p=$('tool-pen'); if(p) p.classList.add('active'); }
    else if(S.tool==='eraser') { var e=$('tool-eraser'); if(e) e.classList.add('active'); }
    else if(S.tool==='select') { var s=$('tool-select'); if(s) s.classList.add('active'); }
    else if(S.tool==='more') { var m=$('tool-more'); if(m) m.classList.add('active'); }
    else {
        var byTool = document.querySelector('.tool-btn[data-tool="'+S.tool+'"]');
        if(byTool) byTool.classList.add('active');
    }
    positionIndicator();
    requestAnimationFrame(positionIndicator);
    /* 圈选/橡皮：自定义光标负责“看得见”，桌面端不能再把系统指针一起关掉（旧版圈选看不到鼠标） */
    var touchOnly = matchMedia('(hover:none) and (pointer:coarse)').matches;
    D.canvas.style.cursor = (S.tool==='select') ? (touchOnly ? 'none' : 'crosshair') : (S.tool==='eraser' ? 'none' : 'crosshair');
    document.body.classList.toggle('tool-select-mode', S.tool==='select');
}

function clearSelectionAndSwitch(toolName) {
    if (S.selection.object) commitSelection();
    /* 换工具时把还没抬手的笔迹收掉，避免旧笔迹继续跟着手指画 */
    if (S.touches && S.touches.size) abortTouches();
    S.tool = toolName;
    setActiveToolUI();
}

$('tool-pen').onclick = function(e){
    e.stopPropagation();
    if(S.tool==='pen'){
        openSubmenu(e.currentTarget, penSubmenuHTML());
        bindPenSubmenu();
    } else {
        closeSubmenu();
        clearSelectionAndSwitch('pen');
    }
};

function penSubmenuHTML(){
    const colors = ['#000000','#ffffff','#2DC360','#ff0000','#ffff00','#0000ff','#800080','#ffa500'];
    return '<div class="pen-colors">' + colors.map(function(c){return '<div class="swatch '+(c===S.penColor?'active':'')+'" data-c="'+c+'" style="background:'+c+';'+(c==='#ffffff'?'border:1px solid #999':'')+'"></div>';}).join('') + '</div>' +
        '<div class="pen-slider-wrap">' +
            '<label>笔触粗细: '+S.penThickness+'px</label>' +
            '<input type="range" class="pen-slider" id="pen-size" min="1" max="24" value="'+S.penThickness+'">' +
        '</div>';
}
function bindPenSubmenu(){
    D.submenu.querySelectorAll('.swatch').forEach(function(el){
        el.onclick = function(e){
            e.stopPropagation();
            S.penColor = el.dataset.c;
            D.submenu.querySelectorAll('.swatch').forEach(function(s){s.classList.remove('active');});
            el.classList.add('active');
        };
    });
    const slider = D.submenu.querySelector('#pen-size');
    if(slider){
        slider.oninput = function(e){
            e.stopPropagation();
            S.penThickness = +slider.value;
            slider.previousElementSibling.textContent = '笔触粗细: '+S.penThickness+'px';
        };
    }
}

$('tool-eraser').onclick = function(e){
    e.stopPropagation();
    if(S.tool==='eraser'){
        openSubmenu(e.currentTarget, 
            '<button class="sub-btn danger" id="sub-clear"><i class="fas fa-trash"></i>全部擦除</button>' +
            '<label class="toggle">' +
                '<input type="checkbox" id="sub-gesture" '+(S.gestureEraser?'checked':'')+'>' +
                '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
                '<span>手势橡皮（笔模式可用）</span>' +
            '</label>'
        );
        D.submenu.querySelector('#sub-clear').onclick = function(e){
            e.stopPropagation();
            closeSubmenu();
            openModal({
                title:'是否清除全部内容',
                content:'<div style="font-size:14px;color:#666;">此操作将会去除当前页面的所有笔迹</div>',
                actions:[
                    { id:'cancel', label:'取消', type:'cancel' },
                    { id:'ok', label:'确定', type:'confirm', callback:function(ov){
                        closeModal(ov);
                        setElements([]);
                        resetHistory();
                        S.selection.object = null;
                        D.selBar.classList.remove('open');
                        redraw();
                        updatePageThumbnails();
                        toast('已清除全部笔迹','fa-check');
                    }}
                ]
            });
        };
        D.submenu.querySelector('#sub-gesture').onchange = function(ev){
            S.gestureEraser = ev.target.checked;
            localStorage.setItem('easinote_gesture_eraser', S.gestureEraser ? '1' : '0');
            toast(S.gestureEraser ? '手势橡皮已开启（笔模式下也生效）' : '手势橡皮已关闭', 'fa-hand-paper');
        };
    } else {
        closeSubmenu();
        clearSelectionAndSwitch('eraser');
    }
};

$('tool-shape').onclick = function(e){
    e.stopPropagation();
    if(S.tool === 'shape'){
        openSubmenu(e.currentTarget, shapeListHTML());
        bindShapeSubmenu(D.submenu);
        return;
    }
    closeSubmenu();
    if(S.selection.object) commitSelection();
    S.tool = 'shape';
    setActiveToolUI();
    openSubmenu(e.currentTarget, shapeListHTML());
    bindShapeSubmenu(D.submenu);
};
function bindShapeSubmenu(scope){
    if(!scope) return;
    scope.querySelectorAll('.shape-item[data-s]').forEach(function(si){
        si.onclick = function(ev){
            ev.stopPropagation();
            closeSubmenu();
            startShapeDraw(si.dataset.s);
        };
    });
}

$('tool-select').onclick = function(){
    closeSubmenu();
    clearSelectionAndSwitch('select');
    toast('套索选择：拖动圈选，可拖动或四角缩放','fa-arrow-pointer');
};

$('tool-undo').onclick = function(){ 
    closeSubmenu(); 
    if (S.selection.object) commitSelection();
    undo(); 
};

$('tool-more').onclick = function(e){
    e.stopPropagation();
    /* 更多：Win8 磁贴面板（3D 飞入 + 背景模糊） */
    if(window.EN10Tiles){
        closeSubmenu();
        if(S.tool !== 'more') clearSelectionAndSwitch('more');
        window.EN10Tiles.toggle();
        return;
    }
    if(S.submenuTarget === e.currentTarget && !D.submenu.classList.contains('hide')){ closeSubmenu(); return; }
    if(S.tool !== 'more') clearSelectionAndSwitch('more');
    openSubmenu(e.currentTarget, moreSubmenuHTML());
    bindMoreSubmenu();
};

function moreSubmenuHTML(){
    return '<button class="sub-btn" data-m="image"><i class="fas fa-image"></i>插入图片</button>' +
        '<button class="sub-btn" data-m="shape"><i class="fas fa-shapes"></i>绘制图形</button>' +
        '<button class="sub-btn" data-m="web"><i class="fas fa-globe"></i>添加网页扩展</button>' +
        '<button class="sub-btn" data-m="physics"><i class="fas fa-atom"></i>物理实验</button>' +
        '<button class="sub-btn" data-m="chem"><i class="fas fa-flask"></i>化学实验</button>';
}
function bindMoreSubmenu(){
    D.submenu.querySelectorAll('[data-m]').forEach(function(el){
        el.onclick = function(e){
            e.stopPropagation();
            var m = el.dataset.m;
            if(m==='image'){
                closeSubmenu();
                D.fileImage.value='';
                D.fileImage.click();
            } else if(m==='shape'){
                D.submenu.innerHTML = shapeListHTML();
                bindShapeSubmenu(D.submenu);
            } else if(m==='web'){
                closeSubmenu();
                openWebExtModal();
            } else if(m==='physics'){
                closeSubmenu();
                openEmbedModal('https://wl.nobook.com/physics/new?moduleId=1','物理实验');
            } else if(m==='chem'){
                closeSubmenu();
                openEmbedModal('https://hx.nobook.com/chemical/new?moduleId=9','化学实验');
            }
        };
    });
}
var WB_SHAPES = [
    { k:'rect',          name:'矩形',   icon:'fa-square' },
    { k:'roundRect',     name:'圆角',   icon:'fa-square-full' },
    { k:'circle',        name:'圆形',   icon:'fa-circle' },
    { k:'ellipse',       name:'椭圆',   icon:'fa-circle-notch' },
    { k:'triangle',      name:'三角',   icon:'fa-play' },
    { k:'rtTriangle',    name:'直角三角', icon:'fa-play' },
    { k:'diamond',       name:'菱形',   icon:'fa-diamond' },
    { k:'pentagon',      name:'五边形', icon:'fa-caret-up' },
    { k:'hexagon',       name:'六边形', icon:'fa-hexagon-nodes' },
    { k:'octagon',       name:'八边形', icon:'fa-stop' },
    { k:'star5',         name:'五角星', icon:'fa-star' },
    { k:'star6',         name:'六角星', icon:'fa-star-of-life' },
    { k:'rightArrow',    name:'箭头',   icon:'fa-arrow-right' },
    { k:'arrowLeft',     name:'左箭头', icon:'fa-arrow-left' },
    { k:'chevron',       name:'折角',   icon:'fa-chevron-right' },
    { k:'parallelogram', name:'平行四边形', icon:'fa-slash' },
    { k:'trapezoid',     name:'梯形',   icon:'fa-caret-square-up' },
    { k:'cross',         name:'十字',   icon:'fa-plus' },
    { k:'line',          name:'直线',   icon:'fa-minus' }
];
function shapeListHTML(){
    return '<div class="shp-head">选择图形后在画布上拖动绘制</div>' +
        '<div class="shape-grid shp-grid">' +
            WB_SHAPES.map(function(s){
                return '<div class="shape-item" data-s="' + s.k + '"><i class="fas ' + s.icon + '"></i>' + s.name + '</div>';
            }).join('') +
        '</div>';
}

$('tool-ai').onclick = function(e){ 
    e.stopPropagation(); 
    if(S.selection.object) commitSelection(); 
    openSubmenu(this, aiMenuHTML());
    bindAIMenu();
};

/* ---- AI 二级菜单 ---- */
function aiMenuHTML(){
    return '<div class="ai-menu">' +
        '<div class="ai-menu-item" data-ai="chat">' +
            '<i class="fas fa-comments"></i>' +
            '<div><b>问 AI</b><span>直接对话提问</span></div>' +
        '</div>' +
        '<div class="ai-menu-item" data-ai="ocr">' +
            '<i class="fas fa-crop-simple"></i>' +
            '<div><b>智慧识屏</b><span>识别白板内容并总结</span></div>' +
        '</div>' +
    '</div>';
}
function bindAIMenu(){
    if(!D.submenu) return;
    var items = D.submenu.querySelectorAll('.ai-menu-item');
    for(var i=0;i<items.length;i++){
        items[i].onclick = function(ev){
            ev.stopPropagation();
            var kind = this.dataset.ai;
            closeSubmenu();
            if(kind === 'chat') openAIChat();
            else startAI();
        };
    }
}

let shapeDrawing = null;
function startShapeDraw(type){
    if(S.touches && S.touches.size) abortTouches();
    S.tool = 'shape';
    S.shapeType = type;
    setActiveToolUI();
    toast('在画布上拖动绘制图形','fa-shapes');
    D.canvas.style.cursor = 'crosshair';
}

function shapeDown(e){
    if(S.tool!=='shape') return;
    const p = coords(e);
    shapeDrawing = { type:'shape', shapeType:S.shapeType, startX:p.x, startY:p.y, endX:p.x, endY:p.y, color:S.penColor, thickness:S.penThickness };
    getElements().push(shapeDrawing);
}
function shapeMove(e){
    if(S.tool!=='shape' || !shapeDrawing) return;
    const p = coords(e);
    shapeDrawing.endX = p.x;
    shapeDrawing.endY = p.y;
    redraw();
}
function shapeUp(){
    if(S.tool!=='shape' || !shapeDrawing) return;
    shapeDrawing = null;
    pushHistory();
    S.tool='pen';
    setActiveToolUI();
    redraw();
}

/* ===== AI 接口配置（默认 DeepSeek，可在设置里改成任意 OpenAI 兼容接口） ===== */
function aiCfg(){
    var CFG = window.EN10_CONFIG || {};
    var defBase = (CFG.ai && CFG.ai.base) || 'https://api.deepseek.com';
    var base = localStorage.getItem('easi_api_base') || defBase;
    base = String(base).trim().replace(/\/+$/, '');
    return {
        base: base,
        key: S.apiKey || localStorage.getItem('easi_api_key') || '',
        model: localStorage.getItem('easi_api_model') || ((CFG.ai && CFG.ai.model) || 'deepseek-chat')
    };
}
/* base 可以带 /v1 也可以不带，两种写法都兼容 */
function aiEndpoint(kind){
    var base = aiCfg().base;
    var hasV1 = /\/v1$/i.test(base);
    if(kind === 'balance'){
        return (hasV1 ? base.replace(/\/v1$/i, '') : base) + '/user/balance';
    }
    return base + (hasV1 ? '' : '/v1') + '/chat/completions';
}

function startAI(){
    if(S.summarizing) return;
    const now = Date.now();
    if(now - S.lastSummary < 10000){
        toast('请等待 '+Math.ceil((10000-(now-S.lastSummary))/1000)+' 秒后再试','fa-clock');
        return;
    }
    if(!S.apiKey){
        showAPIKeyModal();
        return;
    }
    doAI();
}

function showAPIKeyModal(onReady){
    const done = (typeof onReady === 'function') ? onReady : doAI;
    const ov = openModal({
        title:'输入 API Key',
        content: 
            '<div class="api-field">' +
                '<input type="password" id="api-suffix" class="api-input" maxlength="6" placeholder="输入后6位" autocomplete="off">' +
            '</div>' +
            '<div class="api-hint">我的 API Key 前缀: sk-677be0605b63495daa9bb5a5f6</div>' +
            '<span class="api-link" id="use-own">用我自己的 API Key</span>',
        actions:[
            { id:'cancel', label:'取消', type:'cancel' },
            { id:'ok', label:'确定', type:'confirm', callback:function(o){
                const suffix = o.querySelector('#api-suffix').value.trim();
                if(suffix.length!==6){ toast('请输入后6位字符','fa-exclamation-triangle'); return; }
                S.apiKey = 'sk-677be0605b63495daa9bb5a5f6' + suffix;
                localStorage.setItem('easinote_api_key', S.apiKey);
                closeModal(o);
                done();
            }}
        ]
    });
    ov.querySelector('#use-own').onclick = function(e){
        e.stopPropagation();
        closeModal(ov);
        const ov2 = openModal({
            title:'使用自己的 API Key',
            content:'<div class="api-field"><input type="text" id="own-key" class="api-input" style="letter-spacing:0;text-align:left;font-size:14px;" placeholder="sk-..."></div>',
            actions:[
                { id:'cancel', label:'取消', type:'cancel' },
                { id:'ok', label:'保存', type:'confirm', callback:function(o){
                    const k = o.querySelector('#own-key').value.trim();
                    if(!k){ toast('请输入 API Key','fa-exclamation-triangle'); return; }
                    S.apiKey = k;
                    localStorage.setItem('easinote_api_key', S.apiKey);
                    closeModal(o);
                    toast('API Key 已保存','fa-check');
                }}
            ]
        });
    };
}

/* ---- AI 彩光特效 ---- */
var auraTimer = null, auraAnim = null;
function startAura(anchor){
    var aura = D.aiAura;
    if(!aura) return;
    aura.classList.add('on');
    var burst = aura.querySelector('.aura-burst');
    var btn = anchor || document.getElementById('tool-ai');
    var r = btn ? btn.getBoundingClientRect() : { left: window.innerWidth/2, top: window.innerHeight - 80, width: 0, height: 0 };
    var cx = r.left + r.width/2, cy = r.top + r.height/2;
    var vw = window.innerWidth, vh = window.innerHeight;
    if(burst){
        burst.style.opacity = '1';
        var mx = (cx + vw/2)/2, my = (cy + vh/2)/2;
        if(burst.animate){
            try{
                auraAnim = burst.animate([
                    { transform:'translate('+cx+'px,'+cy+'px) scale(.15) rotate(0deg)', opacity:0, offset:0 },
                    { transform:'translate('+cx+'px,'+cy+'px) scale(.45) rotate(40deg)', opacity:1, offset:.1 },
                    { transform:'translate('+mx+'px,'+my+'px) scale(1.9) rotate(190deg)', opacity:1, offset:.42 },
                    { transform:'translate('+(vw/2)+'px,'+(vh/2)+'px) scale(4.2) rotate(290deg)', opacity:.6, offset:.72 },
                    { transform:'translate('+(vw/2)+'px,'+(vh/2)+'px) scale(7.5) rotate(380deg)', opacity:0, offset:1 }
                ], { duration:1400, easing:'cubic-bezier(.24,.85,.25,1)', fill:'forwards' });
            }catch(e){}
        } else {
            burst.style.transform = 'translate('+(vw/2)+'px,'+(vh/2)+'px) scale(9)';
        }
    }
    if(auraTimer) clearTimeout(auraTimer);
    auraTimer = setTimeout(function(){
        if(burst) burst.style.opacity = '0';
    }, 1150);
}
function stopAura(){
    var aura = D.aiAura;
    if(!aura) return;
    if(auraTimer){ clearTimeout(auraTimer); auraTimer = null; }
    aura.classList.remove('on');
    var burst = aura.querySelector('.aura-burst');
    if(burst) burst.style.opacity = '0';
    if(auraAnim){ try{ auraAnim.cancel(); }catch(e){} auraAnim = null; }
}

function doAI(){
    S.summarizing = true;
    S.lastSummary = Date.now();
    D.aiLoading.style.display = 'flex';
    startAura(document.getElementById('tool-ai'));
    const ctrl = new AbortController();
    S.abortAI = ctrl;

    const tmp = document.createElement('canvas');
    /* 直接用画布原始分辨率，避免缩放/DPR 不一致时二次重采样 */
    tmp.width = D.canvas.width; tmp.height = D.canvas.height;
    const tc = tmp.getContext('2d');
    tc.fillStyle = getBg();
    tc.fillRect(0, 0, tmp.width, tmp.height);
    tc.drawImage(D.canvas, 0, 0);
    const dataUrl = tmp.toDataURL('image/jpeg', 0.8);

    fetch(aiEndpoint('chat'), {
        method:'POST',
        signal: ctrl.signal,
        headers:{
            'Content-Type':'application/json',
            'Authorization':'Bearer ' + aiCfg().key
        },
        body: JSON.stringify({
            model: aiCfg().model,
            messages:[
                { role:'system', content:'你是一个白板内容总结助手，需要帮用户总结图片中白板上留下来的内容。请忽略纯色背景。' },
                { role:'user', content:[
                    { type:'text', text:'请总结这张白板图片中的内容。' },
                    { type:'image_url', image_url:{ url:dataUrl } }
                ]}
            ]
        })
    }).then(function(res){
        if(!res.ok) throw new Error('API 请求失败: ' + res.status);
        return res.json();
    }).then(function(data){
        const text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '（无返回内容）';
        D.aiLoading.style.display='none';
        S.summarizing=false;
        stopAura();
        var aiOv = openModal({
            title:'AI 总结',
            cls:'ai-result-modal',
            content:'<div class="ai-scroll" style="text-align:left;max-height:56vh;overflow-y:auto;-webkit-overflow-scrolling:touch;">'+renderMarkdown(text)+'</div>',
            actions:[
                { id:'copy', label:'复制文本', type:'cancel', callback:function(){
                    if(navigator.clipboard && navigator.clipboard.writeText){
                        navigator.clipboard.writeText(text).then(function(){ toast('已复制','fa-check'); }, function(){ toast('复制失败','fa-exclamation-triangle'); });
                    } else {
                        var ta = document.createElement('textarea');
                        ta.value = text; document.body.appendChild(ta); ta.select();
                        try{ document.execCommand('copy'); toast('已复制','fa-check'); }catch(e){ toast('复制失败','fa-exclamation-triangle'); }
                        ta.remove();
                    }
                }},
                { id:'close', label:'关闭', type:'confirm' }
            ]
        });
        var aiBody = aiOv.querySelector('.ai-scroll');
        if(aiBody) aiBody.scrollTop = 0;
    }).catch(function(err){
        D.aiLoading.style.display='none';
        S.summarizing=false;
        stopAura();
        if(err.name==='AbortError'){ toast('已停止总结','fa-stop'); return; }
        openModal({
            title:'总结失败',
            content:'<div style="color:#c00;font-size:13px;">'+escapeHtml(err.message || '网络或API错误')+'</div><div style="color:#999;font-size:12px;margin-top:8px;">请检查API Key与网络连接</div>',
            actions:[{ id:'close', label:'关闭', type:'confirm' }]
        });
    });
}

/* ===== 问 AI：聊天窗 ===== */
var chatState = { busy:false, history:[], ov:null, pendingImage:null };

function openAIChat(){
    if(chatState.ov && document.body.contains(chatState.ov)){
        var t0 = chatState.ov.querySelector('#chat-input');
        if(t0) t0.focus();
        return;
    }
    var ov = document.createElement('div');
    ov.className = 'modal-overlay ai-chat-overlay';
    ov.innerHTML =
        '<div class="modal ai-chat">' +
            '<div class="ai-chat-head">' +
                '<div class="ai-chat-title"><i class="fas fa-comments"></i>问 AI</div>' +
                '<div class="ai-chat-head-r">' +
                    '<button class="ai-chat-btn" id="chat-max" title="最大化"><i class="fas fa-expand"></i></button>' +
                    '<button class="ai-chat-btn" id="chat-clear" title="新对话"><i class="fas fa-trash-alt"></i></button>' +
                    '<button class="ai-chat-btn" id="chat-close" title="关闭"><i class="fas fa-times"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="ai-chat-list" id="chat-list">' +
                '<div class="chat-empty"><i class="fas fa-wand-magic-sparkles"></i>可以向 AI 提问、让它解释白板上的内容，<br>或者帮你梳理知识点。</div>' +
            '</div>' +
            '<div class="ai-composer">' +
                '<textarea id="chat-input" rows="1" placeholder="向 AI 提问…" autocomplete="off"></textarea>' +
                '<button class="ai-send" id="chat-send" title="发送"><i class="fas fa-arrow-up"></i></button>' +
            '</div>' +
        '</div>';
    D.modalRoot.appendChild(ov);
    requestAnimationFrame(function(){ ov.classList.add('open'); });
    chatState.ov = ov;

    var list = ov.querySelector('#chat-list');
    var ta = ov.querySelector('#chat-input');
    makeScrollable(list);

    /* 关掉再打开时把之前的对话接上，别让上下文和界面对不上 */
    if(chatState.history.length){
        var emptyEl = list.querySelector('.chat-empty');
        if(emptyEl) emptyEl.remove();
        chatState.history.forEach(function(m){
            var b = document.createElement('div');
            b.className = 'chat-bubble ' + (m.role === 'user' ? 'user' : 'ai');
            var thumb = m.image ? '<img class="chat-thumb" src="' + m.image + '" alt="圈选内容">' : '';
            b.innerHTML = (m.role === 'user') ? (thumb + escapeHtml(m.content)) : renderMarkdown(m.content);
            if(m.role !== 'user') mathify(b);
            list.appendChild(b);
        });
        requestAnimationFrame(function(){ list.scrollTop = list.scrollHeight; });
    }

    function closeChat(){
        /* 关窗就中止在途请求，避免下次打开被 busy 卡住 */
        if(chatState.ctrl){ try{ chatState.ctrl.abort(); }catch(err){} chatState.ctrl = null; }
        chatState.busy = false;
        closeModal(ov);
        if(chatState.ov === ov) chatState.ov = null;
    }
    ov.querySelector('#chat-close').onclick = closeChat;
    ov.addEventListener('click', function(e){ if(e.target === ov) closeChat(); });
    ov.querySelector('#chat-clear').onclick = function(){
        if(chatState.busy){ toast('请等待 AI 回复完成','fa-clock'); return; }
        chatState.history = [];
        list.innerHTML = '<div class="chat-empty"><i class="fas fa-wand-magic-sparkles"></i>已开启新对话，继续提问吧。</div>';
    };
    ov.querySelector('#chat-max').onclick = function(){
        var on = ov.classList.toggle('max');
        this.innerHTML = on ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
        this.title = on ? '还原' : '最大化';
    };
    ov.querySelector('#chat-send').onclick = sendChat;
    ta.addEventListener('input', function(){ chatAutoGrow(ta); });
    ta.addEventListener('keydown', function(e){
        if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
            e.preventDefault();
            sendChat();
        }
    });
    setTimeout(function(){ ta.focus(); }, 320);
}

function chatAutoGrow(ta){
    if(!ta) return;
    ta.style.height = '42px';
    ta.style.height = Math.min(104, Math.max(42, ta.scrollHeight)) + 'px';
}

function chatScrollBottom(){
    var list = chatState.ov && chatState.ov.querySelector('#chat-list');
    if(!list) return;
    requestAnimationFrame(function(){ list.scrollTop = list.scrollHeight; });
}

function chatBubble(kind, html){
    var list = chatState.ov && chatState.ov.querySelector('#chat-list');
    if(!list) return null;
    var empty = list.querySelector('.chat-empty');
    if(empty) empty.remove();
    var el = document.createElement('div');
    el.className = 'chat-bubble ' + kind;
    el.innerHTML = html;
    list.appendChild(el);
    chatScrollBottom();
    return el;
}

function sendChat(){
    if(chatState.busy) return;
    var ta = chatState.ov && chatState.ov.querySelector('#chat-input');
    if(!ta) return;
    var text = (ta.value || '').trim();
    if(!text && !chatState.pendingImage) return;
    if(!text) text = '请解释我圈出的这部分内容。';
    if(!aiCfg().key){
        showAPIKeyModal(function(){ doSendChat(text, chatState.pendingImage); });
        return;
    }
    doSendChat(text, chatState.pendingImage);
}

function doSendChat(text, image){
    if(chatState.busy || !chatState.ov) return;
    var ta = chatState.ov.querySelector('#chat-input');
    if(ta){ ta.value = ''; chatAutoGrow(ta); }
    var thumb = image ? '<img class="chat-thumb" src="' + image + '" alt="圈选内容">' : '';
    chatBubble('user', thumb + escapeHtml(text));
    chatState.history.push({ role:'user', content:text, image: image || undefined });
    if(image){
        chatState.pendingImage = null;
        var pv = chatState.ov.querySelector('#chat-attach');
        if(pv) pv.remove();
    }
    /* 只保留最近 20 轮，避免请求体越来越大 */
    if(chatState.history.length > 40) chatState.history = chatState.history.slice(-40);

    chatState.busy = true;
    var sendBtn = chatState.ov.querySelector('#chat-send');
    if(sendBtn) sendBtn.disabled = true;
    var bubble = chatBubble('ai', '<div class="chat-typing"><i></i><i></i><i></i></div>');

    var historyMsgs = chatState.history.map(function(m){
        if(m.image){
            return { role:m.role, content:[
                { type:'text', text:m.content },
                { type:'image_url', image_url:{ url:m.image } }
            ]};
        }
        return { role:m.role, content:m.content };
    });
    var msgs = [{ role:'system', content:'你是 ParkerEasiNote 白板里的 AI 助手。回答简洁、准确、有条理，可以使用 Markdown（列表、表格、标题、引用）。如果用户让你解释白板内容，请根据图片与上下文推断。' }]
        .concat(historyMsgs);

    var ctrl = new AbortController();
    chatState.ctrl = ctrl;

    fetch(aiEndpoint('chat'), {
        method:'POST',
        signal: ctrl.signal,
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + aiCfg().key },
        body: JSON.stringify({ model: aiCfg().model, messages: msgs })
    }).then(function(res){
        if(!res.ok) throw new Error('请求失败: ' + res.status);
        return res.json();
    }).then(function(data){
        var text2 = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
        if(!text2) throw new Error('没有返回内容');
        if(bubble && bubble.isConnected){ bubble.innerHTML = renderMarkdown(text2); mathify(bubble); }
        else if(chatState.ov){ var nb = chatBubble('ai', renderMarkdown(text2)); mathify(nb); }
        chatState.history.push({ role:'assistant', content:text2 });
        chatScrollBottom();
    }).catch(function(err){
        if(err && err.name === 'AbortError') return;
        if(bubble && bubble.isConnected){
            bubble.className = 'chat-bubble err';
            var extra = /image|vision|multimodal|content|400/i.test(String(err.message||''))
                ? '<br>当前模型可能不支持图片输入，可在「设置 → AI 接口」里换成支持视觉的模型（如 qwen-vl、gpt-4o）。'
                : '<br>请检查 API Key、接口地址或网络后重试。';
            bubble.innerHTML = '请求失败：' + escapeHtml(err.message || '网络异常') + extra;
        }
        /* 失败的那一句不留在上下文里，重发时不会被重复带入 */
        if(chatState.history.length && chatState.history[chatState.history.length-1].role === 'user'){
            chatState.history.pop();
        }
        chatScrollBottom();
    }).then(function(){
        /* 只有仍是当前请求才解除忙碌状态，避免旧请求把新会话的 busy 清掉 */
        if(chatState.ctrl === ctrl){
            chatState.ctrl = null;
            chatState.busy = false;
        }
        if(sendBtn) sendBtn.disabled = false;
    });
}

function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
        return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
}
function escapeXml(s){
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

$('btn-stop-ai').onclick = function(){
    if(S.abortAI) S.abortAI.abort();
};

function openWebExtModal(){
    const saved = localStorage.getItem('easinote_web_url') || '';
    const ov = openModal({
        title:'添加网页扩展',
        content: 
            '<div class="api-field">' +
                '<input type="text" id="web-url" class="api-input" style="letter-spacing:0;text-align:left;font-size:14px;" placeholder="https://example.com" value="'+escapeHtml(saved)+'">' +
            '</div>' +
            '<div class="api-hint">下次点击将直接打开此网页</div>',
        actions:[
            { id:'cancel', label:'取消', type:'cancel' },
            { id:'ok', label:'打开', type:'confirm', callback:function(o){
                const url = o.querySelector('#web-url').value.trim();
                if(!url){ toast('请输入网址','fa-exclamation-triangle'); return; }
                localStorage.setItem('easinote_web_url', url);
                closeModal(o);
                openEmbedModal(url, '网页扩展');
            }}
        ]
    });
}

function openEmbedModal(url, title){
    var ov = openModal({
        title:title,
        cls:'embed-modal',
        content:'<iframe src="'+escapeHtml(url)+'" allow="fullscreen; autoplay; clipboard-read; clipboard-write; microphone; camera" allowfullscreen webkitallowfullscreen></iframe>',
        actions:[{ id:'close', label:'关闭', type:'confirm' }]
    });
    var modal = ov.querySelector('.modal');
    var head = ov.querySelector('.modal-head');
    var frame = ov.querySelector('iframe');

    var expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'embed-expand-btn';
    expandBtn.title = '全屏（保留关闭按钮）';
    expandBtn.setAttribute('aria-label', '全屏');
    expandBtn.innerHTML = '<i class="fas fa-expand"></i>';
    head.appendChild(expandBtn);

    var floatClose = document.createElement('button');
    floatClose.type = 'button';
    floatClose.className = 'embed-float-close';
    floatClose.innerHTML = '<i class="fas fa-times"></i><span>关闭</span>';
    modal.appendChild(floatClose);

    var FULL_PROPS = ['position','top','left','right','bottom','width','height','min-width','min-height',
                      'max-width','max-height','margin','padding','border-radius','transform','border','box-shadow','background'];
    function setFull(on){
        modal.classList.toggle('embed-full', on);
        var st = modal.style;
        if(on){
            /* 内联 !important：绕开任何样式表冲突，也绕开老内核不支持 inset 的问题 */
            var v = {
                'position':'fixed','top':'0px','left':'0px','right':'0px','bottom':'0px',
                'width':'100vw','height':'100vh','min-width':'100vw','min-height':'100vh',
                'max-width':'none','max-height':'none','margin':'0','padding':'0',
                'border-radius':'0','transform':'none','border':'0','box-shadow':'none','background':'#0b0f14'
            };
            Object.keys(v).forEach(function(k){ st.setProperty(k, v[k], 'important'); });
            var ovEl = modal.parentElement;
            if(ovEl){ ovEl.style.setProperty('padding','0','important'); ovEl.style.setProperty('background','#000','important'); }
            if(frame){
                frame.style.setProperty('width','100%','important');
                frame.style.setProperty('height','100%','important');
                frame.style.setProperty('min-height','0','important');
                frame.style.setProperty('border-radius','0','important');
            }
        } else {
            FULL_PROPS.forEach(function(k){ st.removeProperty(k); });
            var ov2 = modal.parentElement;
            if(ov2){ ov2.style.removeProperty('padding'); ov2.style.removeProperty('background'); }
            if(frame){ frame.style.removeProperty('width'); frame.style.removeProperty('height'); }
        }
        expandBtn.innerHTML = on ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
        expandBtn.title = on ? '退出全屏' : '全屏（保留关闭按钮）';
        /* 全屏时网页优先拿到焦点，方便直接操作实验 */
        if(on && frame){ setTimeout(function(){ try{ frame.focus(); }catch(e){} }, 260); }
    }

    expandBtn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        setFull(!modal.classList.contains('embed-full'));
    });
    floatClose.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        closeModal(ov);
    });
    /* 全屏时按 Esc 先退出全屏，再按一次才关闭 */
    function onKey(e){
        if(e.key !== 'Escape') return;
        if(modal.classList.contains('embed-full')){
            e.stopPropagation();
            setFull(false);
        }
    }
    document.addEventListener('keydown', onKey, true);
    var cleanup = function(){ document.removeEventListener('keydown', onKey, true); };
    ov.addEventListener('click', function(e){ if(e.target === ov) cleanup(); });
    return ov;
}

function insertImageFile(f){
    var reader = new FileReader();
    reader.onload = function(ev){
        var img = new Image();
        img.onload = function(){
            if(S.mode === 'prep'){
                var maxW = S.prep.w * 0.6, maxH = S.prep.h * 0.6;
                var fitScale = Math.min(maxW/img.width, maxH/img.height, 1);
                var pw = img.width*fitScale, ph = img.height*fitScale;
                addPrepElement({
                    type:'image', src: ev.target.result, name: f.name || '图片',
                    x:(S.prep.w-pw)/2, y:(S.prep.h-ph)/2, w:pw, h:ph
                });
                toast('图片已插入','fa-check');
                return;
            }
            const scale = Math.min(CW*0.6/img.width, CH*0.6/img.height, 1);
            const w = img.width*scale, h = img.height*scale;
            var arr = getElements();
            if(!arr) return;
            arr.push({
                type:'image', img: img, src: ev.target.result,
                x:(CW-w)/2, y:(CH-h)/2, w: w, h: h
            });
            pushHistory();
            redraw();
            toast('图片已插入','fa-check');
        };
        img.onerror = function(){ toast('该图片格式暂不支持或文件已损坏','fa-exclamation-triangle'); };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(f);
}

D.fileImage.onchange = function(e){
    const f = e.target.files[0];
    D.fileImage.value = '';
    if(!f) return;
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    if(ext === 'pdf'){ importPDF(f); return; }
    if(ext === 'txt' || ext === 'md'){
        var fr = new FileReader();
        fr.onload = function(ev){
            var text = String(ev.target.result || '');
            openModal({title:f.name,content:'<div style="text-align:left;max-height:65vh;overflow:auto;">'+renderMarkdown(text)+'</div>',actions:[{id:'close',label:'关闭',type:'confirm'}]});
        };
        fr.readAsText(f, 'UTF-8');
        return;
    }
    insertImageFile(f);
};

function importPDF(file){
    if(typeof pdfjsLib === 'undefined'){
        openModal({
            title:'导入 PDF',
            content:'<div style="color:#444;font-size:13px;line-height:1.7">PDF 需要 PDF.js 组件。请确认网络可用后重试，或将 PDF 转为图片后导入。</div>',
            actions:[{id:'close',label:'知道了',type:'confirm'}]
        });
        return;
    }
    toast('正在读取 PDF…','fa-spinner');
    var reader = new FileReader();
    reader.onload = function(){
        pdfjsLib.getDocument({data:new Uint8Array(reader.result)}).promise.then(async function(pdf){
            var newPages = [];
            for(var n=1;n<=pdf.numPages;n++){
                var page = await pdf.getPage(n);
                var base = page.getViewport({scale:1});
                var scale = Math.min(1800/base.width, 1800/base.height, 2);
                var viewport = page.getViewport({scale:scale});
                var cv = document.createElement('canvas');
                cv.width = Math.ceil(viewport.width); cv.height = Math.ceil(viewport.height);
                await page.render({canvasContext:cv.getContext('2d'),viewport:viewport}).promise;
                var data = cv.toDataURL('image/png');
                var img = new Image();
                var fit = Math.min(CW/cv.width, CH/cv.height);
                var drawW = cv.width * fit, drawH = cv.height * fit;
                img.onload = function(){ redraw(); };
                img.src = data;
                newPages.push({bg:'#ffffff',elements:[{type:'image',img:img,src:data,x:(CW-drawW)/2,y:(CH-drawH)/2,w:drawW,h:drawH}]});
            }
            S.mode='whiteboard'; S.ppt=null; S.pages=newPages; S.pageIdx=0; S.history=[];
            updatePptUi(false); $('menu-exit-ppt').classList.add('hidden');
            updateBg(); redraw(); updatePageInd(); updatePageThumbnails();
            toast('PDF 已导入，共 '+newPages.length+' 页','fa-check');
        }).catch(function(err){ toast('PDF 读取失败：'+(err.message||'未知错误'),'fa-exclamation-triangle'); });
    };
    reader.readAsArrayBuffer(file);
}

/* ---- 统一下载/打开入口 ---- */
function openFileDialog(){
    D.filePpt.value = '';
    D.filePpt.click();
}

function openAnyFile(f){
    if(!f) return;
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    if(ext === 'pptx') return importPptx(f);
    if(ext === 'docx') return importDocx(f);
    if(ext === 'pdf') return importPDF(f);
    if(ext === 'zip' || ext === 'course' || ext === 'pnbx') return importCourseware(f);
    if(ext === 'ppt' || ext === 'doc'){
        toast('不支持旧版 .' + ext + ' 格式，请先另存为 .' + ext + 'x','fa-exclamation-triangle');
        return;
    }
    if(ext === 'txt' || ext === 'md'){
        var fr = new FileReader();
        fr.onload = function(ev){
            openModal({ title:f.name, content:'<div style="text-align:left;max-height:65vh;overflow:auto;">'+renderMarkdown(String(ev.target.result||''))+'</div>', actions:[{id:'close',label:'关闭',type:'confirm'}] });
        };
        fr.readAsText(f, 'UTF-8');
        return;
    }
    if(/^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name)) return insertImageFile(f);
    toast('无法识别的文件类型：' + (ext || f.type || '未知'), 'fa-exclamation-triangle');
}

function importPptx(f){
    toast('正在解析 PPT，请稍候…','fa-spinner');
    var t0 = Date.now();
    parsePPTX(f).then(function(data){
        if(!data.slides.length){ toast('未解析到幻灯片','fa-exclamation-triangle'); return; }
        exitPrepSilent();
        S.ppt = data;
        S.mode = 'ppt';
        S.slideIdx = 0;
        S.tool = 'pen';
        clearHistStacks();
        resetHistory();
        S.selection.object = null;
        document.body.classList.add('ppt-mode');
        document.body.classList.remove('prep-mode','doc-mode');
        $('menu-exit-ppt').classList.remove('hidden');
        updatePptUi(true);
        renderPPT();
        toast('PPT 加载成功（'+data.slides.length+' 页，'+(Date.now()-t0)+'ms）','fa-check');
    }).catch(function(err){
        console.error(err);
        toast('PPT 解析失败：' + err.message,'fa-exclamation-triangle');
    });
}

D.filePpt.onchange = function(e){
    var f = e.target.files[0];
    D.filePpt.value = '';
    openAnyFile(f);
};
D.fileAny.onchange = function(e){
    var f = e.target.files[0];
    D.fileAny.value = '';
    openAnyFile(f);
};
D.filePrepImage.onchange = function(e){
    var f = e.target.files[0];
    D.filePrepImage.value = '';
    if(f) insertImageFile(f);
};

/* 把 ZipKit 适配成和 JSZip 一致的 file()/async() 接口，PPT 解析可脱离 JSZip 运行 */
function openZipLike(file){
    return ZipKit.read(file).then(function(z){
        var nameMap = {};
        z.names.forEach(function(n){ nameMap[n] = true; });
        return {
            files: nameMap,
            names: z.names,
            _reader: z,
            file: function(path){
                if(!path) return null;
                var p = String(path).replace(/^\/+/, '');
                var hit = nameMap[p] ? p : null;
                if(!hit){
                    var lower = p.toLowerCase();
                    for(var i=0;i<z.names.length;i++){
                        if(z.names[i].toLowerCase() === lower){ hit = z.names[i]; break; }
                    }
                }
                if(!hit) return null;
                return {
                    async: function(type){
                        if(type === 'base64') return z.base64(hit);
                        if(type === 'uint8array') return z.bytes(hit);
                        return z.text(hit);
                    }
                };
            }
        };
    });
}

function mimeOf(path){
    var ext = (String(path).split('.').pop() || '').toLowerCase();
    var map = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', bmp:'image/bmp',
        svg:'image/svg+xml', webp:'image/webp', emf:'image/emf', wmf:'image/wmf', tif:'image/tiff', tiff:'image/tiff' };
    return map[ext] || 'image/png';
}

/* 幻灯片图片按需读取：打开文件时只解析结构，滑到该页才解码图片 */
function ensureSlideImages(slide){
    if(!slide || !S.ppt || !S.ppt.zip) return;
    var bg = slide.bg || {};
    if(bg.imagePath && !bg.image && !bg._loading){
        bg._loading = true;
        var bf = S.ppt.zip.file(bg.imagePath);
        if(bf){
            bf.async('base64').then(function(b64){
                bg.image = 'data:' + mimeOf(bg.imagePath) + ';base64,' + b64;
                var st = D.bg.querySelector('.ppt-stage');
                if(st && S.mode === 'ppt' && S.ppt.slides[S.slideIdx] === slide){
                    st.style.backgroundImage = 'url(' + bg.image + ')';
                }
            }).catch(function(){});
        }
    }
    (slide.shapes || []).forEach(function(s){
        if(s.type === 'image' && !s.src) resolveShapeImage(s);
    });
}

function resolveShapeImage(s){
    if(!s) return Promise.resolve('');
    if(s.src) return Promise.resolve(s.src);
    if(s._imgPromise) return s._imgPromise;
    if(!s.imgPath || !S.ppt || !S.ppt.zip){ s._imgPromise = Promise.resolve(''); return s._imgPromise; }
    var f = S.ppt.zip.file(s.imgPath);
    if(!f){ s._imgPromise = Promise.resolve(''); return s._imgPromise; }
    s._imgPromise = f.async('base64').then(function(b64){
        s.src = 'data:' + (s.mime || mimeOf(s.imgPath)) + ';base64,' + b64;
        return s.src;
    }).catch(function(){ return ''; });
    return s._imgPromise;
}

function parsePPTX(file){
    return openZipLike(file).then(function(zip){
        function parseXml(text) {
            if (!text) return null;
            try { return new DOMParser().parseFromString(text, 'text/xml'); } catch (e) { return null; }
        }
        function getLocalName(node) { return node.localName || node.nodeName.split(':').pop(); }
        function getAttr(node, name) {
            var v = node.getAttribute(name);
            if (v) return v;
            return node.getAttribute(name.split(':').pop()) || '';
        }
        function directChildren(parent, localName) {
            var r = [];
            if (!parent || !parent.childNodes) return r;
            for (var i = 0; i < parent.childNodes.length; i++) {
                var n = parent.childNodes[i];
                if (n.nodeType === 1 && (!localName || getLocalName(n) === localName)) r.push(n);
            }
            return r;
        }
        function firstDirect(parent, localName) {
            var c = directChildren(parent, localName); return c.length ? c[0] : null;
        }
        function allByLocalName(parent, localName) {
            var r = [], ch = parent ? parent.getElementsByTagName('*') : [];
            for (var i = 0; i < ch.length; i++) if (getLocalName(ch[i]) === localName) r.push(ch[i]);
            return r;
        }
        function firstByLocalName(parent, localName) {
            var c = allByLocalName(parent, localName); return c.length ? c[0] : null;
        }
        function emuToPx(emu) { return (parseInt(emu, 10) || 0) / 914400 * 96; }
        function resolveRel(relsDoc, rId) {
            if (!relsDoc || !rId) return '';
            var rels = allByLocalName(relsDoc, 'Relationship');
            for (var i = 0; i < rels.length; i++) if (getAttr(rels[i], 'Id') === rId) return getAttr(rels[i], 'Target');
            return '';
        }
        function normalizePath(base, target) {
            if (!target) return '';
            try { target = decodeURIComponent(target); } catch (e) {}
            if (target.charAt(0) === '/') return target.substring(1);
            var b = base.split('/'); b.pop();
            var t = target.split('/');
            for (var i = 0; i < t.length; i++) {
                var p = t[i];
                if (p === '..') b.pop();
                else if (p !== '.' && p !== '') b.push(p);
            }
            return b.join('/');
        }
        function findZipFile(zip, path) {
            if (!path) return null;
            var f = zip.file(path); if (f) return f;
            var lower = path.toLowerCase(), files = zip.files;
            for (var n in files) if (files.hasOwnProperty(n) && n.toLowerCase() === lower) return files[n];
            if (path.charAt(0) === '/') return findZipFile(zip, path.substring(1));
            return null;
        }
        function readZipText(zip, path) { var f = findZipFile(zip, path); return f ? f.async('string') : Promise.resolve(''); }
        function readZipDataUrl(zip, path, mime) {
            var f = findZipFile(zip, path);
            if (!f) return Promise.resolve('');
            return f.async('base64').then(function(b64){ return 'data:' + (mime || 'image/png') + ';base64,' + b64; });
        }
        function guessMime(path) {
            var ext = (path.split('.').pop() || '').toLowerCase();
            var map = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', bmp:'image/bmp', svg:'image/svg+xml' };
            return map[ext] || 'application/octet-stream';
        }

        var THEME_COLORS = {};
        var DEFAULT_THEME = {
            dk1:'#000000', lt1:'#FFFFFF', dk2:'#44546A', lt2:'#E7E6E6',
            accent1:'#4472C4', accent2:'#ED7D31', accent3:'#A5A5A5',
            accent4:'#FFC000', accent5:'#5B9BD5', accent6:'#70AD47',
            hlink:'#0563C1', folHlink:'#954F72'
        };
        function getThemeColor(val) {
            var map = { tx1:'dk1', bg1:'lt1', tx2:'dk2', bg2:'lt2' };
            var key = map[val] || val;
            return THEME_COLORS[key] || DEFAULT_THEME[key] || null;
        }
        function hexToRgb(hex) {
            if (!hex || hex.length < 4) return { r:0, g:0, b:0 };
            hex = hex.replace('#','');
            if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
            return { r: parseInt(hex.substr(0,2),16)||0, g: parseInt(hex.substr(2,2),16)||0, b: parseInt(hex.substr(4,2),16)||0 };
        }
        function rgbToHsl(c) {
            var r = c.r/255, g = c.g/255, b = c.b/255;
            var max = Math.max(r,g,b), min = Math.min(r,g,b);
            var h = 0, s = 0, l = (max+min)/2;
            if (max !== min) {
                var d = max - min;
                s = l > 0.5 ? d/(2-max-min) : d/(max+min);
                if (max === r) h = (g-b)/d + (g<b?6:0);
                else if (max === g) h = (b-r)/d + 2;
                else h = (r-g)/d + 4;
                h /= 6;
            }
            return { h:h, s:s, l:l };
        }
        function hslToRgb(hsl) {
            var h = hsl.h, s = hsl.s, l = hsl.l;
            if (s === 0) return { r: Math.round(l*255), g: Math.round(l*255), b: Math.round(l*255) };
            function hue2rgb(p,q,t) {
                if (t < 0) t += 1; if (t > 1) t -= 1;
                if (t < 1/6) return p + (q-p)*6*t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q-p)*(2/3-t)*6;
                return p;
            }
            var q = l < 0.5 ? l*(1+s) : l+s-l*s;
            var p = 2*l - q;
            return { r: Math.round(hue2rgb(p,q,h+1/3)*255), g: Math.round(hue2rgb(p,q,h)*255), b: Math.round(hue2rgb(p,q,h-1/3)*255) };
        }
        function toHex2(n) { var s = n.toString(16); return s.length === 1 ? '0'+s : s; }
        function rgbToHex(c) { return '#' + toHex2(c.r) + toHex2(c.g) + toHex2(c.b); }
        function applyColorMods(hex, mods) {
            if (!mods || !mods.length) return hex;
            var rgb = hexToRgb(hex), hsl = rgbToHsl(rgb), alpha = 1;
            for (var i = 0; i < mods.length; i++) {
                var ln = getLocalName(mods[i]), val = parseInt(getAttr(mods[i], 'val'), 10);
                if (isNaN(val)) continue;
                var frac = val / 100000;
                if (ln === 'lumMod') hsl.l = hsl.l * frac;
                else if (ln === 'lumOff') hsl.l = hsl.l + frac;
                else if (ln === 'tint') hsl.l = hsl.l + (1 - hsl.l) * frac;
                else if (ln === 'shade') hsl.l = hsl.l * (1 - frac);
                else if (ln === 'alpha') alpha = frac;
            }
            if (hsl.l > 1) hsl.l = 1;
            if (hsl.l < 0) hsl.l = 0;
            if (hsl.s > 1) hsl.s = 1;
            if (hsl.s < 0) hsl.s = 0;
            var res = hslToRgb(hsl);
            return alpha < 1 ? 'rgba('+res.r+','+res.g+','+res.b+','+alpha+')' : rgbToHex(res);
        }
        function colorFromColorElement(el) {
            if (!el) return null;
            var ln = getLocalName(el), base = null;
            if (ln === 'srgbClr') { var v = getAttr(el, 'val'); if (v && v.length >= 6) base = '#' + v; }
            else if (ln === 'schemeClr') base = getThemeColor(getAttr(el, 'val'));
            else if (ln === 'sysClr') { var lc = getAttr(el, 'lastClr'); base = lc ? '#' + lc : '#000000'; }
            if (!base) return null;
            return applyColorMods(base, directChildren(el));
        }
        function colorFromSolidFill(solidFill) {
            if (!solidFill) return null;
            var kids = directChildren(solidFill);
            for (var i = 0; i < kids.length; i++) {
                var ln = getLocalName(kids[i]);
                if (['srgbClr','schemeClr','sysClr','prstClr'].indexOf(ln) > -1) return colorFromColorElement(kids[i]);
            }
            return null;
        }
        function colorFromStyleRef(style, refName) {
            if (!style) return undefined;
            var ref = firstDirect(style, refName);
            if (!ref) return undefined;
            var kids = directChildren(ref);
            for (var i = 0; i < kids.length; i++) {
                var c = colorFromColorElement(kids[i]);
                if (c) return c;
            }
            var idx = parseInt(getAttr(ref, 'idx'), 10);
            if (isNaN(idx)) idx = -1;
            if (refName === 'fillRef' || refName === 'lnRef') {
                if (idx === 0) return null;
                if (idx >= 1 && idx <= 6) return getThemeColor('accent' + idx);
                return null;
            }
            if (refName === 'fontRef') return getThemeColor('tx1') || '#000000';
            return undefined;
        }
        
        function gradientCss(gf) {
            if (!gf) return null;
            var gsLst = firstDirect(gf, 'gsLst');
            if (!gsLst) return null;
            var gsList = directChildren(gsLst, 'gs');
            if (!gsList.length) return null;
            var stops = [];
            for (var i = 0; i < gsList.length; i++) {
                var pos = parseInt(getAttr(gsList[i], 'pos'), 10);
                if (isNaN(pos)) pos = 0;
                var col = null, kids = directChildren(gsList[i]);
                for (var k = 0; k < kids.length; k++) {
                    col = colorFromColorElement(kids[k]);
                    if (col) break;
                }
                if (!col) col = '#cccccc';
                stops.push(col + ' ' + (pos / 1000).toFixed(1) + '%');
            }
            if (stops.length === 1) stops.push(stops[0]);
            var lin = firstDirect(gf, 'lin');
            var ang = lin ? (parseInt(getAttr(lin, 'ang'), 10) || 0) / 60000 : 90;
            /* DrawingML 角度自 3 点钟方向顺时针；CSS 自 12 点钟方向顺时针 */
            var deg = (ang + 90) % 360;
            return 'linear-gradient(' + deg.toFixed(1) + 'deg, ' + stops.join(', ') + ')';
        }

        function resolveFill(spPr, style) {
            if (spPr) {
                if (firstDirect(spPr, 'noFill')) return { color: null };
                var sf = firstDirect(spPr, 'solidFill');
                if (sf) { var c = colorFromSolidFill(sf); if (c) return { color: c }; }
                var gf = firstDirect(spPr, 'gradFill');
                if (gf) {
                    var gcss = gradientCss(gf);
                    if (gcss) return { color: null, gradient: gcss };
                    var gs = firstByLocalName(gf, 'gs');
                    if (gs) { var gsf = firstDirect(gs, 'solidFill'); if (gsf) { var gc = colorFromSolidFill(gsf); if (gc) return { color: gc }; } }
                }
                if (firstDirect(spPr, 'blipFill') || firstDirect(spPr, 'pattFill')) return { color: null };
            }
            var sc = colorFromStyleRef(style, 'fillRef');
            if (sc === null) return { color: null };
            if (sc !== undefined) return { color: sc };
            return { color: null };
        }
        
        function resolveLine(spPr, style) {
            var result = { color: null, width: 0, dash: 'solid' };
            if (spPr) {
                var ln = firstDirect(spPr, 'ln');
                if (ln) {
                    if (firstDirect(ln, 'noFill')) return result;
                    var w = parseInt(getAttr(ln, 'w'), 10);
                    if (w > 0) result.width = emuToPx(w);
                    var sf = firstDirect(ln, 'solidFill');
                    if (sf) { var c = colorFromSolidFill(sf); if (c) result.color = c; }
                    var pd = firstDirect(ln, 'prstDash');
                    if (pd) {
                        var pv = getAttr(pd, 'val') || 'solid';
                        if (pv === 'dot' || pv === 'sysDot') result.dash = 'dotted';
                        else if (pv === 'dash' || pv === 'lgDash' || pv === 'dashDot' || pv === 'lgDashDot' || pv === 'sysDash') result.dash = 'dashed';
                        else result.dash = 'solid';
                    }
                    if (!result.color) {
                        var lc2 = colorFromStyleRef(style, 'lnRef');
                        if (lc2 && lc2 !== null) { result.color = lc2; if (result.width <= 0) result.width = 1; }
                    }
                    return result;
                }
            }
            var lc = colorFromStyleRef(style, 'lnRef');
            if (lc && lc !== null) { result.color = lc; if (result.width <= 0) result.width = 1; }
            return result;
        }
        
        function isRoundRect(prstGeom) {
            if (getAttr(prstGeom, 'prst') !== 'roundRect') return false;
            var avLst = firstDirect(prstGeom, 'avLst');
            if (!avLst) return true;
            var gds = directChildren(avLst, 'gd');
            for (var i = 0; i < gds.length; i++) {
                if (getAttr(gds[i], 'name') === 'adj') {
                    var fmla = getAttr(gds[i], 'fmla'), val = parseInt(fmla.replace('val ', ''), 10);
                    if (val === 0) return false;
                }
            }
            return true;
        }

        var PRST_MAP = {
            rect:'rect', roundRect:'roundRect', flowChartProcess:'rect',
            ellipse:'ellipse', circle:'ellipse', donut:'ellipse',
            triangle:'triangle', rtTriangle:'rtTriangle',
            diamond:'diamond', pentagon:'pentagon', hexagon:'hexagon', octagon:'octagon',
            star4:'star5', star5:'star5', star6:'star6', star8:'star6',
            rightArrow:'rightArrow', leftArrow:'leftArrow', upArrow:'upArrow', downArrow:'downArrow',
            chevron:'chevron', parallelogram:'parallelogram', trapezoid:'trapezoid',
            plus:'cross', mathPlus:'cross', line:'line', straightConnector1:'line',
            bentConnector3:'line', curvedConnector3:'line'
        };
        function mapPrst(prst, prstGeom) {
            if (!prst) return '';
            if (prst === 'roundRect') return isRoundRect(prstGeom) ? 'roundRect' : 'rect';
            return PRST_MAP[prst] || 'rect';
        }

        function applyRunProps(rPr, target, defaultColor) {
            var sz = parseInt(getAttr(rPr, 'sz'), 10);
            if (sz > 0) target.fontSize = sz / 100 * 96 / 72;
            var b = getAttr(rPr, 'b'); if (b === '1' || b === 'true') target.bold = true; else if (b === '0' || b === 'false') target.bold = false;
            var it = getAttr(rPr, 'i'); if (it === '1' || it === 'true') target.italic = true; else if (it === '0' || it === 'false') target.italic = false;
            var u = getAttr(rPr, 'u'); if (u && u !== 'none') target.underline = true;
            var latin = firstDirect(rPr, 'latin'); if (latin) { var tf = getAttr(latin, 'typeface'); if (tf) target.fontFamily = tf; }
            var sf = firstDirect(rPr, 'solidFill'); if (sf) { var c = colorFromSolidFill(sf); if (c) target.color = c; }
        }
        
        function parseTextBody(txBody, style) {
            var result = { text: '', paragraphs: [], defaultColor: '#000000', defaultFontSize: 18, anchor: 'top', wrap: true };
            if (!txBody) return result;
            var fc = colorFromStyleRef(style, 'fontRef'); if (fc && fc !== null) result.defaultColor = fc;
            var bodyPr = firstDirect(txBody, 'bodyPr');
            if (bodyPr) {
                var anc = getAttr(bodyPr, 'anchor');
                if (anc === 'ctr') result.anchor = 'middle'; else if (anc === 'b') result.anchor = 'bottom';
                var wrapAttr = getAttr(bodyPr, 'wrap'); if (wrapAttr === 'none') result.wrap = false;
            }
            var paras = directChildren(txBody, 'p'), allText = [];
            for (var i = 0; i < paras.length; i++) {
                var p = paras[i], pPr = firstDirect(p, 'pPr');
                var para = { text: '', fontSize: result.defaultFontSize, color: result.defaultColor, bold: false, italic: false, underline: false, fontFamily: '', align: 'left' };
                if (pPr) {
                    var defRPr = firstDirect(pPr, 'defRPr'); if (defRPr) applyRunProps(defRPr, para, result.defaultColor);
                    var algn = getAttr(pPr, 'algn'); if (algn === 'ctr') para.align = 'center'; else if (algn === 'r') para.align = 'right'; else if (algn === 'just') para.align = 'justify';
                }
                var kids = directChildren(p), paraText = '', firstRunStyleSet = false, segs = [], pending = '';
                function flushPending(){ if (pending) { segs.push({ t: pending }); pending = ''; } }
                for (var k = 0; k < kids.length; k++) {
                    var kn = kids[k], kln = getLocalName(kn);
                    if (kln === 'r') {
                        var rPr = firstDirect(kn, 'rPr');
                        var runStyle = { fontSize: para.fontSize, color: para.color, bold: para.bold, italic: para.italic, underline: para.underline, fontFamily: para.fontFamily };
                        if (rPr) applyRunProps(rPr, runStyle, result.defaultColor);
                        var t = firstDirect(kn, 't'), txt = t ? (t.textContent || '') : '';
                        if (txt) {
                            paraText += txt; pending += txt;
                            if (!firstRunStyleSet) {
                                para.fontSize = runStyle.fontSize; para.color = runStyle.color; para.bold = runStyle.bold; para.italic = runStyle.italic; para.underline = runStyle.underline; para.fontFamily = runStyle.fontFamily; firstRunStyleSet = true;
                            }
                        }
                    } else if (kln === 'br') { paraText += '\n'; pending += '\n'; }
                    else if (kln === 'fld') { var ft = firstDirect(kn, 't'); if (ft) { paraText += (ft.textContent || ''); pending += (ft.textContent || ''); } }
                    else if (kln === 'AlternateContent' || kln === 'oMath' || kln === 'oMathPara') {
                        /* Office 公式（OMML）：转成 LaTeX，后面交给本地 MathJax 画成 SVG */
                        var om = (kln === 'oMath') ? kn : firstByLocalName(kn, 'oMath');
                        if (om && window.PPTExt) {
                            var tex = PPTExt.ommlToTex(om);
                            if (tex) { flushPending(); segs.push({ tex: tex }); }
                        }
                    }
                }
                flushPending();
                if (segs.length && segs.some(function(sg){ return !!sg.tex; })) para.segs = segs;
                para.text = paraText; allText.push(para);
            }
            var full = '';
            for (var m = 0; m < allText.length; m++) { if (m > 0) full += '\n'; full += allText[m].text; }
            result.text = full; result.paragraphs = allText;
            if (allText.length > 0) { result.defaultFontSize = allText[0].fontSize; result.defaultColor = allText[0].color; }
            return result;
        }

        function collectShapeItems(parent, baseX, baseY, items) {
            var ch = parent.childNodes;
            for (var i = 0; i < ch.length; i++) {
                var n = ch[i]; if (n.nodeType !== 1) continue;
                var ln = getLocalName(n);
                if (ln === 'sp' || ln === 'pic' || ln === 'cxnSp' || ln === 'graphicFrame') {
                    items.push({ type: ln, node: n, offsetX: baseX, offsetY: baseY });
                } else if (ln === 'grpSp') {
                    var grpSpPr = firstDirect(n, 'grpSpPr'), xfrm = grpSpPr ? firstDirect(grpSpPr, 'xfrm') : null;
                    var off = xfrm ? firstDirect(xfrm, 'off') : null;
                    var gx = off ? emuToPx(getAttr(off, 'x')) : 0, gy = off ? emuToPx(getAttr(off, 'y')) : 0;
                    collectShapeItems(n, baseX + gx, baseY + gy, items);
                }
            }
        }

        /* graphicFrame：表格 / SmartArt(结构图) / 图表，之前整块被跳过，导致课件里“图都不见了” */
        function parseGraphicFrame(zip, item, relsDoc, slideDir, docIndex) {
            var node = item.node;
            try {
                var xfrm = firstDirect(node, 'xfrm') || firstByLocalName(node, 'xfrm');
                var off = xfrm ? firstDirect(xfrm, 'off') : null;
                var ext = xfrm ? firstDirect(xfrm, 'ext') : null;
                var x = (off ? emuToPx(getAttr(off, 'x')) : 0) + item.offsetX;
                var y = (off ? emuToPx(getAttr(off, 'y')) : 0) + item.offsetY;
                var w = ext ? emuToPx(getAttr(ext, 'cx')) : 0;
                var h = ext ? emuToPx(getAttr(ext, 'cy')) : 0;
                if (!(w > 0)) w = 400;
                if (!(h > 0)) h = 200;
                var cNvPr = firstByLocalName(node, 'cNvPr');
                var id = (cNvPr && getAttr(cNvPr, 'id')) || ('gf_' + docIndex);
                var base = { id:id, x:x, y:y, w:w, h:h, rot:0, borderWidth:0, borderColor:'none',
                             fillColor:null, fillGradient:null, shapeType:'' };
                if (!window.PPTExt) return Promise.resolve(null);
                var gd = firstByLocalName(node, 'graphicData');
                var uri = gd ? getAttr(gd, 'uri') : '';

                if (/table/i.test(uri)) {
                    var tbl = gd ? firstByLocalName(gd, 'tbl') : null;
                    return tbl ? Promise.resolve(PPTExt.tableShape(tbl, base)) : Promise.resolve(null);
                }
                if (/diagram/i.test(uri)) {
                    var relIds = gd ? firstByLocalName(gd, 'relIds') : null;
                    var dmId = relIds ? getAttr(relIds, 'r:dm') : '';
                    var target = dmId ? resolveRel(relsDoc, dmId) : '';
                    if (!target) return Promise.resolve(null);
                    var dpath = normalizePath(slideDir + '/x', target);
                    return readZipText(zip, dpath).then(function(xml){ return PPTExt.smartartShape(xml, base); })
                        .catch(function(){ return null; });
                }
                if (/chart/i.test(uri)) {
                    var chNode = gd ? firstByLocalName(gd, 'chart') : null;
                    var cRid = chNode ? getAttr(chNode, 'r:id') : '';
                    var cTgt = cRid ? resolveRel(relsDoc, cRid) : '';
                    if (!cTgt) return Promise.resolve(null);
                    var cpath = normalizePath(slideDir + '/x', cTgt);
                    return readZipText(zip, cpath).then(function(xml){ return PPTExt.chartShape(xml, base); })
                        .catch(function(){ return null; });
                }
                return Promise.resolve(null);
            } catch (e) {
                console.warn('graphicFrame parse error:', e);
                return Promise.resolve(null);
            }
        }

        function parseShapeItem(zip, item, relsDoc, slideDir, docIndex, slideW, slideH) {
            if (item.type === 'graphicFrame') return parseGraphicFrame(zip, item, relsDoc, slideDir, docIndex);
            try {
                var node = item.node, isPic = item.type === 'pic', isCxn = item.type === 'cxnSp';
                var spPr = firstDirect(node, 'spPr'), xfrm = spPr ? firstDirect(spPr, 'xfrm') : null;
                var off = xfrm ? firstDirect(xfrm, 'off') : null, ext = xfrm ? firstDirect(xfrm, 'ext') : null;
                
                var x = (off ? emuToPx(getAttr(off, 'x')) : 0) + item.offsetX;
                var y = (off ? emuToPx(getAttr(off, 'y')) : 0) + item.offsetY;
                var w = ext ? emuToPx(getAttr(ext, 'cx')) : 0, h = ext ? emuToPx(getAttr(ext, 'cy')) : 0;
                
                if (isCxn && h < 2) h = 2; 
                if (isCxn && w < 2) w = 2;

                var nvSpPr = firstDirect(node, 'nvSpPr') || firstDirect(node, 'nvPicPr') || firstDirect(node, 'nvCxnSpPr');
                var cNvPr = nvSpPr ? firstDirect(nvSpPr, 'cNvPr') : null;
                var shapeId = cNvPr ? getAttr(cNvPr, 'id') : '';
                if (!shapeId) shapeId = 'shape_' + docIndex;

                var style = firstDirect(node, 'style'), fillInfo = resolveFill(spPr, style), lineInfo = resolveLine(spPr, style);
                if (lineInfo.width > 5) lineInfo.width = 5;

                var shapeType = '', prstGeom = spPr ? firstDirect(spPr, 'prstGeom') : null;
                if (prstGeom) {
                    var prst = getAttr(prstGeom, 'prst');
                    shapeType = mapPrst(prst, prstGeom);
                }
                var rotDeg = 0;
                if (xfrm) {
                    var rotVal = parseInt(getAttr(xfrm, 'rot'), 10);
                    if (!isNaN(rotVal)) rotDeg = rotVal / 60000;
                }
                var base = {
                    id: shapeId, x: x, y: y, w: w, h: h,
                    fillColor: fillInfo.color || null, fillGradient: fillInfo.gradient || null,
                    borderColor: lineInfo.color, borderWidth: lineInfo.width, dash: lineInfo.dash,
                    rot: rotDeg, shapeType: shapeType
                };

                if (isPic) {
                    var blipFill = firstDirect(node, 'blipFill');
                    var blip = blipFill ? firstDirect(blipFill, 'blip') : firstDirect(node, 'blip');
                    var rId = blip ? (getAttr(blip, 'r:embed') || getAttr(blip, 'embed')) : '';
                    var target = rId ? resolveRel(relsDoc, rId) : '';
                    if (!target) return Promise.resolve(Object.assign({}, base, { type:'shape', text:'', paragraphs:[] }));
                    var imgPath = normalizePath(slideDir + '/x', target);
                    /* 图片延后解码：先出结构，滑到这一页时再读 zip，避免一次性解析全部图片 */
                    return Promise.resolve(Object.assign({}, base, { type:'image', imgPath: imgPath, mime: guessMime(imgPath) }));
                }

                var txBody = firstDirect(node, 'txBody'), textInfo = parseTextBody(txBody, style);
                
                if (w <= 0 || h <= 0) {
                    if (textInfo.text && textInfo.text.trim()) {
                        w = w > 0 ? w : 600;
                        h = h > 0 ? h : 100;
                        
                        var ph = firstByLocalName(node, 'ph');
                        var phType = ph ? getAttr(ph, 'type') : '';
                        
                        if (phType === 'title' || phType === 'ctrTitle') {
                            x = x > 0 ? x : (slideW - w) / 2;
                            y = y > 0 ? y : slideH * 0.07;
                        } else if (phType === 'subTitle') {
                            x = x > 0 ? x : (slideW - w) / 2;
                            y = y > 0 ? y : slideH * 0.2;
                        } else {
                            x = x > 0 ? x : (slideW - w) / 2;
                            y = y > 0 ? y : slideH * 0.5;
                        }
                    } else {
                        return Promise.resolve(null);
                    }
                }

                var hasMath = (textInfo.paragraphs || []).some(function(pp){ return !!(pp.segs && pp.segs.length); });
                if (!textInfo.text && !hasMath && !fillInfo.color && !fillInfo.gradient && !lineInfo.color && !isCxn) return Promise.resolve(null);
                return Promise.resolve(Object.assign({}, base, {
                    type: (textInfo.text || hasMath) ? 'text' : 'shape',
                    x: x, y: y, w: w, h: h,
                    text: textInfo.text, paragraphs: textInfo.paragraphs,
                    anchor: textInfo.anchor, wrap: textInfo.wrap
                }));
            } catch(e) {
                console.warn('Shape parse error:', e);
                return Promise.resolve(null);
            }
        }

        /* 把 PowerPoint 的进场预设归成 4 种好实现的 CSS 动效，其余统一淡入 */
        var ANIM_EFFECT = {
            1:'none', 2:'fly', 3:'wipe', 4:'zoom', 5:'fade', 6:'zoom', 7:'fly', 8:'zoom',
            9:'fade', 10:'fade', 11:'fade', 12:'fly', 13:'wipe', 14:'wipe', 15:'zoom',
            16:'wipe', 17:'zoom', 18:'wipe', 19:'zoom', 20:'zoom', 21:'zoom', 22:'wipe',
            23:'zoom', 24:'fade', 25:'fly', 26:'zoom'
        };
        function animEffectOf(par) {
            try {
                var cTns = allByLocalName(par, 'cTn');
                for (var i = 0; i < cTns.length; i++) {
                    if (getAttr(cTns[i], 'presetClass') !== 'entr') continue;
                    var pid = parseInt(getAttr(cTns[i], 'presetID'), 10);
                    var name = ANIM_EFFECT[pid];
                    if (name) return name;
                }
                if (firstByLocalName(par, 'animEffect')) return 'fade';
                if (firstByLocalName(par, 'animRot')) return 'zoom';
                if (firstByLocalName(par, 'anim')) return 'fly';
            } catch(e) {}
            return 'fade';
        }

        function parseAnimation(slideDoc, shapes) {
            var steps = [], animatedIds = {};
            try {
                var timing = firstByLocalName(slideDoc, 'timing');
                if (timing) {
                    var allSpTgts = allByLocalName(timing, 'spTgt');
                    for (var i = 0; i < allSpTgts.length; i++) {
                        var spid = getAttr(allSpTgts[i], 'spid');
                        if (spid) animatedIds[spid] = true;
                    }
                    var mainSeq = null, allCTn = allByLocalName(timing, 'cTn');
                    for (var j = 0; j < allCTn.length; j++) {
                        if (getAttr(allCTn[j], 'nodeType') === 'mainSeq') { mainSeq = allCTn[j]; break; }
                    }
                    if (mainSeq) {
                        var childTnLst = firstDirect(mainSeq, 'childTnLst');
                        if (childTnLst) {
                            var clickPars = directChildren(childTnLst, 'par');
                            for (var p = 0; p < clickPars.length; p++) {
                                var stepIds = [], innerSpTgts = allByLocalName(clickPars[p], 'spTgt');
                                for (var t = 0; t < innerSpTgts.length; t++) {
                                    var pid = getAttr(innerSpTgts[t], 'spid');
                                    if (pid) stepIds.push(pid);
                                }
                                if (stepIds.length > 0) steps.push({ shapeIds: stepIds, effect: animEffectOf(clickPars[p]) });
                            }
                        }
                    }
                }
            } catch(e) { console.warn('Anim parse error', e); }

            var immediateIds = [];
            for (var s = 0; s < shapes.length; s++) {
                if (!animatedIds[shapes[s].id]) immediateIds.push(shapes[s].id);
            }
            if (steps.length === 0 && shapes.length > 0 && Object.keys(animatedIds).length > 0) {
                immediateIds = shapes.map(function(s){ return s.id; });
            }
            return { steps: steps, immediateIds: immediateIds };
        }

        function extractBgColorOrImg(bgNode, slideDir, relsDoc) {
            var bgData = { color: '#ffffff', image: null, imagePath: null };
            if (!bgNode) return Promise.resolve(bgData);
            
            var bgPr = firstDirect(bgNode, 'bgPr');
            if (!bgPr) return Promise.resolve(bgData);
            
            var sf = firstDirect(bgPr, 'solidFill');
            if (sf) {
                var c = colorFromSolidFill(sf);
                if (c) bgData.color = c;
            }
            
            var bf = firstDirect(bgPr, 'blipFill');
            if (bf) {
                var blip = firstDirect(bf, 'blip');
                var rId = blip ? (getAttr(blip, 'r:embed') || getAttr(blip, 'embed')) : '';
                if (rId && relsDoc) {
                    var target = resolveRel(relsDoc, rId);
                    if (target) bgData.imagePath = normalizePath(slideDir + '/x', target);
                }
            }
            return Promise.resolve(bgData);
        }

        return readZipText(zip, 'ppt/theme/theme1.xml').then(function(themeXml){
            if (themeXml) {
                var doc = parseXml(themeXml), clrScheme = doc ? firstByLocalName(doc, 'clrScheme') : null;
                if (clrScheme) {
                    var names = directChildren(clrScheme);
                    for (var i = 0; i < names.length; i++) {
                        var key = getLocalName(names[i]), srgb = firstDirect(names[i], 'srgbClr');
                        if (srgb) { var v = getAttr(srgb, 'val'); if (v) THEME_COLORS[key] = '#' + v; continue; }
                        var sys = firstDirect(names[i], 'sysClr');
                        if (sys) { var last = getAttr(sys, 'lastClr'); if (last) THEME_COLORS[key] = '#' + last; }
                    }
                }
            }
            return readZipText(zip, 'ppt/presentation.xml');
        }).then(function(presXml){
            var presDoc = parseXml(presXml);
            var sldSz = presDoc ? firstByLocalName(presDoc, 'sldSz') : null;
            var slideW = sldSz ? emuToPx(getAttr(sldSz, 'cx')) : 960;
            var slideH = sldSz ? emuToPx(getAttr(sldSz, 'cy')) : 540;
            if (slideW < 10) slideW = 960; 
            if (slideH < 10) slideH = 540;

            return readZipText(zip, 'ppt/_rels/presentation.xml.rels').then(function(presRelsXml){
                var presRelsDoc = parseXml(presRelsXml);
                var sldIdLst = presDoc ? firstByLocalName(presDoc, 'sldIdLst') : null;
                var sldIds = sldIdLst ? allByLocalName(sldIdLst, 'sldId') : [];
                var slidePaths = [];
                for (var i = 0; i < sldIds.length; i++) {
                    var rId = getAttr(sldIds[i], 'r:id') || getAttr(sldIds[i], 'id');
                    var target = resolveRel(presRelsDoc, rId);
                    if (target) slidePaths.push(normalizePath('ppt/presentation.xml', target));
                }

                return Promise.all(slidePaths.map(function(slidePath, index){
                    return readZipText(zip, slidePath).then(function(slideXml){
                        var slideDoc = parseXml(slideXml);
                        if (!slideDoc) return { index:index, shapes:[], elements:[] };
                        var slideDir = slidePath.substring(0, slidePath.lastIndexOf('/'));
                        var slideName = slidePath.substring(slidePath.lastIndexOf('/') + 1);
                        var relsPath = slideDir + '/_rels/' + slideName + '.rels';
                        
                        return readZipText(zip, relsPath).then(function(relsXml){
                            var relsDoc = parseXml(relsXml);
                            var spTree = firstByLocalName(slideDoc, 'spTree');
                            if (!spTree) return { index:index, shapes:[], elements:[], bg: {color:'#fff'} };
                            
                            var bgNode = firstByLocalName(slideDoc, 'bg');
                            
                            return extractBgColorOrImg(bgNode, slideDir, relsDoc).then(function(bgData){
                                var items = [];
                                collectShapeItems(spTree, 0, 0, items);
                                return Promise.all(items.map(function(item, idx){ return parseShapeItem(zip, item, relsDoc, slideDir, idx, slideW, slideH); })).then(function(parsed){
                                    var shapes = parsed.filter(Boolean);
                                    var anim = parseAnimation(slideDoc, shapes);
                                    return { index:index, shapes:shapes, anim:anim, bg:bgData, elements: [] };
                                });
                            });
                        });
                    });
                })).then(function(slides){
                    slides.sort(function(a,b){ return a.index - b.index; });
                    return { width: slideW, height: slideH, slides: slides, zip: zip };
                });
            });
        });
    });
}

function updatePptUi(isPpt) {
    var saveBtn = $('btn-save');
    if (isPpt) {
        document.body.classList.add('ppt-mode');
        saveBtn.innerHTML = '<i class="fas fa-times"></i>';
        saveBtn.style.background = 'rgba(255, 59, 48, 0.9)';
        saveBtn.style.borderColor = 'rgba(255, 150, 150, 0.6)';
    } else {
        document.body.classList.remove('ppt-mode');
        saveBtn.innerHTML = '<i class="fas fa-download"></i>';
        saveBtn.style.background = '';
        saveBtn.style.borderColor = '';
    }
    requestAnimationFrame(function(){ setActiveToolUI(); });
}

/* 视频展台：画面层自己的位移/缩放（不与墨迹同步） */
function applyCamView(){
    var el = document.getElementById('vp-media');
    if(!el) return;
    var v = S.camView || { x:0, y:0, s:1 };
    el.style.transform = 'translate3d(' + v.x + 'px,' + v.y + 'px,0) scale(' + v.s + ')';
}
function resetCamView(){
    S.camView = { x:0, y:0, s:1 };
    applyCamView();
}

function updateBg(){
    D.bg.innerHTML = '';

    if(S.mode==='ppt' || S.mode==='doc' || S.mode==='prep'){
        D.toolbar.classList.add('dark-glass');
        D.right.classList.add('dark-glass');
        D.left.querySelectorAll('.left-fab').forEach(function(el){el.classList.add('dark-glass');});
        var pb = document.getElementById('prep-toolbar');
        if(pb) pb.classList.add('dark-glass');
    } else {
        D.toolbar.classList.remove('dark-glass');
        D.right.classList.remove('dark-glass');
        D.left.querySelectorAll('.left-fab').forEach(function(el){el.classList.remove('dark-glass');});
    }

    if(S.mode==='ppt'){
        buildPptSlide();
    } else if(S.mode==='prep'){
        buildPrepStage();
    } else if(S.mode==='doc'){
        buildDocStage();
    } else if(S.mode==='whiteboard'){
        D.bg.style.background = S.pages[S.pageIdx].bg;
    } else if(S.mode==='camera'){
        D.bg.style.background = '#000';
        /* 视频画面独立一层，可缩放/平移；笔迹在另一张 canvas 上，不跟着动 */
        var wrap = document.createElement('div');
        wrap.className = 'vp-media';
        wrap.id = 'vp-media';
        if(S.cameraFrozen && S.cameraFreezeSrc){
            var fi = document.createElement('img');
            fi.className = 'freeze-frame';
            fi.src = S.cameraFreezeSrc;
            wrap.appendChild(fi);
        } else if(S.cameraStream){
            var v = document.createElement('video');
            v.srcObject = S.cameraStream;
            v.autoplay = true;
            v.playsInline = true;
            v.muted = true;
            wrap.appendChild(v);
            v.onloadedmetadata = function(){ try{ v.play(); }catch(e){} };
        }
        D.bg.appendChild(wrap);
        applyCamView();
    }
    document.body.classList.toggle('camera-mode', S.mode === 'camera');
    var fz = document.getElementById('btn-freeze');
    if(fz) fz.classList.toggle('on', !!S.cameraFrozen);
    redraw();
}

function buildPptSlide(){
    var viewport = document.createElement('div');
    viewport.className = 'ppt-viewport';
    var stage = document.createElement('div');
    stage.className = 'ppt-stage';
    stage.style.width = S.ppt.width + 'px';
    stage.style.height = S.ppt.height + 'px';

    var slide = S.ppt.slides[S.slideIdx];
    if(slide){
        if (slide.bg.image) {
            stage.style.backgroundImage = 'url('+slide.bg.image+')';
        } else {
            stage.style.backgroundImage = 'none';
            stage.style.backgroundColor = slide.bg.color || '#ffffff';
        }
        ensureSlideImages(slide);
        var immediateSet = {};
        slide.anim.immediateIds.forEach(function(id){ immediateSet[id] = true; });
        var frag = document.createDocumentFragment();
        slide.shapes.forEach(function(s){
            frag.appendChild(mkPptShape(s, immediateSet[s.id]));
        });
        stage.appendChild(frag);
    }
    viewport.appendChild(stage);
    D.bg.appendChild(viewport);
    scaleStage();
}

/* 幻灯片元素渲染：多边形用 SVG 绘制，保证填充/描边贴合形状，文字层不被裁切 */
function gradientFirstColor(css){
    if(!css) return null;
    var m = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/.exec(css);
    return m ? m[0] : null;
}
/* MathJax 转 SVG：顺手去掉隐藏用的 MathML 副本，
   否则在没加载到 MathJax 自带样式表时会“同一公式显示两遍” */
function texToSvg(tex, display){
    if(!window.MathJax || typeof MathJax.tex2svg !== 'function') return null;
    try{
        var out = MathJax.tex2svg(tex, { display: !!display });
        if(out && out.querySelector){
            var as = out.querySelector('mjx-assistive-mml');
            if(as && as.parentNode) as.parentNode.removeChild(as);
        }
        return out || null;
    }catch(e){ return null; }
}

function mkPptShape(s, visible){
    var el = document.createElement('div');
    el.className = 'shape' + (visible ? ' visible' : '');
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    el.style.width = s.w + 'px';
    el.style.height = s.h + 'px';

    var kind = s.shapeType || '';
    if (s.rot) el.style.transform = 'rotate(' + s.rot + 'deg)';

    var w = Math.max(1, s.w), h = Math.max(1, s.h);
    var sw = Math.max(0, s.borderWidth || 0);
    var strokeColor = s.borderColor || 'none';
    var fill = s.fillColor || gradientFirstColor(s.fillGradient) || 'none';
    var isPoly = kind && kind !== 'rect' && kind !== 'ellipse' && kind !== 'roundRect' && kind !== 'line' && kind !== 'image';

    /* 表格 / SmartArt / 图表：交给增强渲染器生成 DOM，避免整块空白 */
    if (s.type === 'table' || s.type === 'smartart' || s.type === 'chart') {
        el.style.overflow = 'hidden';
        if (window.PPTExt) {
            var ext = PPTExt.render(s);
            if (ext) { el.appendChild(ext); el.dataset.shapeId = s.id; return el; }
        }
        el.style.background = 'rgba(0,0,0,.04)';
        el.dataset.shapeId = s.id;
        return el;
    }

    if (s.type === 'image') {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;' +
            (kind === 'ellipse' ? 'border-radius:50%;' : (kind === 'roundRect' ? 'border-radius:8px;' : ''));
        if (isPoly) {
            wrap.style.clipPath = 'polygon(' + shapePolygon(kind, w, h).map(function(pt){
                return (pt[0]/w*100).toFixed(3) + '% ' + (pt[1]/h*100).toFixed(3) + '%';
            }).join(',') + ')';
            wrap.style.webkitClipPath = wrap.style.clipPath;
        }
        var img = document.createElement('img');
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.display = 'block';
        img.onerror = function(){ this.style.display = 'none'; };
        if (s.src) img.src = s.src;
        else {
            img.style.background = 'linear-gradient(135deg,#eef1f4,#dfe4e9)';
            resolveShapeImage(s).then(function(url){ if(url) img.src = url; });
        }
        wrap.appendChild(img);
        if (sw > 0 && strokeColor !== 'none') {
            el.style.border = sw + 'px ' + (s.dash || 'solid') + ' ' + strokeColor;
        }
        el.appendChild(wrap);
    } else if (isPoly) {
        el.innerHTML = '<svg width="100%" height="100%" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="display:block;overflow:visible">' +
            '<path d="' + polygonPath(shapePolygon(kind, w, h), 0, 0) + '" fill="' + fill + '" stroke="' + strokeColor +
            '" stroke-width="' + sw + '" stroke-linejoin="round"' + (s.dash === 'dashed' ? ' stroke-dasharray="'+(Math.max(2,sw*3))+' '+(Math.max(2,sw*2))+'"' : (s.dash === 'dotted' ? ' stroke-dasharray="1 '+(Math.max(2,sw*1.6))+'"' : '')) + '/>' +
        '</svg>';
    } else if (kind === 'line') {
        el.style.height = '1px';
        el.style.borderTop = Math.max(1, sw) + 'px ' + (s.dash || 'solid') + ' ' + (s.borderColor || '#333');
    } else {
        if (kind === 'ellipse') el.style.borderRadius = '50%';
        else if (kind === 'roundRect') el.style.borderRadius = '8px';
        if (s.fillGradient) el.style.backgroundImage = s.fillGradient;
        else if (s.fillColor) el.style.backgroundColor = s.fillColor;
        if (sw > 0 && strokeColor !== 'none') {
            el.style.border = sw + 'px ' + (s.dash || 'solid') + ' ' + strokeColor;
            if (kind === 'ellipse') el.style.boxSizing = 'border-box';
        }
    }

    if (s.type === 'text') {
        var cell = document.createElement('div');
        cell.className = 'ppt-text';
        cell.style.justifyContent = s.anchor === 'middle' ? 'center' : (s.anchor === 'bottom' ? 'flex-end' : 'flex-start');
        cell.style.textAlign = (s.paragraphs && s.paragraphs[0] && s.paragraphs[0].align) || 'left';

        var paras = s.paragraphs || [];
        if (paras.length === 0) paras = [{ text: s.text || '', fontSize: 18, color: '#000', bold:false, italic:false, underline:false, fontFamily:'', align:'left' }];

        paras.forEach(function(pp){
            var pd = document.createElement('div');
            pd.style.fontSize = (pp.fontSize || 18) + 'px';
            pd.style.color = pp.color || '#000';
            pd.style.lineHeight = pp.lineHeight || 1.22;
            pd.style.textAlign = pp.align || 'left';
            pd.style.wordBreak = 'break-word';
            pd.style.whiteSpace = s.wrap === false ? 'nowrap' : 'pre-wrap';
            if (pp.bold) pd.style.fontWeight = 'bold';
            if (pp.italic) pd.style.fontStyle = 'italic';
            if (pp.underline) pd.style.textDecoration = 'underline';
            if (pp.fontFamily) pd.style.fontFamily = '"' + String(pp.fontFamily).replace(/"/g,'') + '", -apple-system, "Microsoft YaHei", sans-serif';
            var txt = pp.text || '';
            if (pp.segs && pp.segs.length && pp.segs.some(function(sg){ return !!sg.tex; })) {
                /* 段落里混了公式：文本走文本、公式走本地 MathJax(SVG)，都不用联网 */
                pp.segs.forEach(function(sg){
                    if (sg.tex) {
                        var sp = document.createElement('span');
                        sp.className = 'ppt-math';
                        sp.style.cssText = 'display:inline-block;vertical-align:middle;font-size:' + (pp.fontSize || 18) + 'px;margin:0 1px;';
                        var msvg = texToSvg(sg.tex, false);
                        if (msvg) sp.appendChild(msvg); else sp.textContent = '[公式]';
                        pd.appendChild(sp);
                    } else if (sg.t) {
                        var segLines = String(sg.t).split('\n');
                        segLines.forEach(function(line, li){
                            if (li > 0) pd.appendChild(document.createElement('br'));
                            pd.appendChild(document.createTextNode(line));
                        });
                    }
                });
            } else if (txt) {
                var lines = txt.split('\n');
                lines.forEach(function(line, li){
                    if (li > 0) pd.appendChild(document.createElement('br'));
                    pd.appendChild(document.createTextNode(line));
                });
            } else {
                pd.innerHTML = '&nbsp;';
            }
            cell.appendChild(pd);
        });
        el.appendChild(cell);
    }
    el.dataset.shapeId = s.id;
    return el;
}

function scaleStage(){
    var stage = null, baseW = 0, baseH = 0;
    if(S.mode==='ppt' && S.ppt){
        stage = D.bg.querySelector('.ppt-stage');
        baseW = S.ppt.width; baseH = S.ppt.height;
    } else if(S.mode==='doc' && S.doc){
        stage = D.bg.querySelector('.doc-stage');
        baseW = S.doc.w; baseH = S.doc.h;
    } else if(S.mode==='prep' && S.prep){
        stage = D.bg.querySelector('.prep-stage');
        baseW = S.prep.w; baseH = S.prep.h;
    }
    if(!stage || !baseW || !baseH) return;
    var scale;
    if(S.mode === 'prep'){
        /* 编辑态留出边距，能看清页面边界，也避免被底栏压住 */
        scale = Math.min((CW - 56) / baseW, (CH - 140) / baseH);
    } else {
        scale = Math.min(CW / baseW, CH / baseH);
    }
    if (!(scale > 0)) scale = 0.1;
    stage.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
    stage.dataset.scale = scale;
}
function scalePPT(){ scaleStage(); }

function renderPPT(){
    updateBg();
    redraw();
    updatePageInd();
    updatePageThumbnails();
}
function renderPrep(){
    updateBg();
    updatePageInd();
    updatePrepSelection();
}
function renderDoc(){
    updateBg();
    updatePageInd();
}

function updatePageInd(){
    if(S.mode==='ppt' && S.ppt) D.pageInd.textContent = (S.slideIdx+1)+'/'+S.ppt.slides.length;
    else if(S.mode==='prep' && S.prep) D.pageInd.textContent = (S.prepIdx+1)+'/'+S.prep.pages.length;
    else if(S.mode==='doc' && S.doc) D.pageInd.textContent = (S.docIdx+1)+'/'+S.doc.pages.length;
    else D.pageInd.textContent = (S.pageIdx+1)+'/'+S.pages.length;

    /* 切页后重建撤销基线，避免撤销时莫名跳回上一页 */
    switchHistStack();

    /* 换页/撤销时把“还没抬手”的笔迹丢掉，避免残影糊在新页面上、后续橡皮也擦不掉 */
    if(S.touches && S.touches.size) abortTouches();
}

$('btn-add-page').onclick = function(){
    if(S.mode==='ppt'){ toast('PPT模式下无法加页','fa-exclamation-triangle'); return; }
    if(S.mode==='doc'){ toast('文档模式下无法加页','fa-exclamation-triangle'); return; }
    if(S.mode==='prep'){
        S.prep.pages.splice(S.prepIdx+1, 0, { bg:'#ffffff', elements:[], ink:[], name:'第'+(S.prep.pages.length+1)+'页' });
        S.prepIdx++;
        S.prepSel = null;
        renderPrep();
        toast('已新增一页','fa-plus');
        return;
    }
    S.pages.push({ bg:'#0F261E', elements:[] });
    S.pageIdx = S.pages.length-1;
    updateBg(); redraw(); updatePageInd(); updatePageThumbnails();
};

$('btn-prev-page').onclick = function(){
    if(S.mode==='ppt'){
        if(S.slideIdx>0){ S.slideIdx--; renderPPT(); }
    } else if(S.mode==='prep'){
        if(S.prepIdx>0){ S.prepIdx--; S.prepSel=null; renderPrep(); }
    } else if(S.mode==='doc'){
        if(S.docIdx>0){ S.docIdx--; renderDoc(); }
    } else {
        if(S.pageIdx>0){ S.pageIdx--; updateBg(); redraw(); updatePageInd(); }
    }
};

$('btn-next-page').onclick = function(){
    if(S.mode==='ppt'){
        var slide = S.ppt.slides[S.slideIdx];
        if (slide) {
            var visibleShapes = D.bg.querySelectorAll('.shape.visible');
            var visibleIds = Array.prototype.map.call(visibleShapes, function(el){ return el.dataset.shapeId; });
            var nextStep = slide.anim.steps.find(function(step){ return step.shapeIds.some(function(id){ return visibleIds.indexOf(id) === -1; }); });
            
            if (nextStep) {
                var ef = nextStep.effect || 'fade';
                nextStep.shapeIds.forEach(function(id){
                    var el = D.bg.querySelector('.shape[data-shape-id="'+id+'"]');
                    if (!el) return;
                    if (ef !== 'none') el.classList.add('ef-' + ef);
                    el.classList.add('visible');
                });
            } else if (S.slideIdx < S.ppt.slides.length - 1) {
                S.slideIdx++; 
                renderPPT();
            }
        }
    } else if(S.mode==='prep'){
        if(S.prepIdx < S.prep.pages.length-1){ S.prepIdx++; S.prepSel=null; renderPrep(); }
    } else if(S.mode==='doc'){
        if(S.docIdx < S.doc.pages.length-1){ S.docIdx++; renderDoc(); }
    } else {
        if(S.pageIdx<S.pages.length-1){ S.pageIdx++; updateBg(); redraw(); updatePageInd(); }
    }
};
$('btn-catalog').onclick = function(){ openDrawer(); };

function openDrawer(){
    D.drawerOverlay.classList.add('open');
    D.drawer.classList.add('open');
    updatePageThumbnails();
    /* 打开时把当前页滚到中间，长课件不用手动找 */
    setTimeout(function(){
        var act = D.drawerBody.querySelector('.thumb.active');
        if(act){
            var top = act.getBoundingClientRect().top - D.drawerBody.getBoundingClientRect().top + D.drawerBody.scrollTop;
            D.drawerBody.scrollTop = Math.max(0, top - (D.drawerBody.clientHeight - act.offsetHeight) / 2);
        } else {
            D.drawerBody.scrollTop = 0;
        }
    }, 80);
}
function closeDrawer(){
    D.drawerOverlay.classList.remove('open');
    D.drawer.classList.remove('open');
}
D.drawerOverlay.onclick = closeDrawer;
$('drawer-close').onclick = closeDrawer;

/* 目录滚动交给自定义滚动器，避免 WebView 里原生滚动被卡死 */
makeScrollable(D.drawerBody);

function thumbPoly(tc, kind, w, h){
    if(kind === 'ellipse'){ tc.beginPath(); tc.ellipse(w/2, h/2, Math.max(0.3,w/2), Math.max(0.3,h/2), 0, 0, Math.PI*2); return; }
    if(kind === 'roundRect'){
        var r = Math.min(w,h) * 0.16;
        tc.beginPath();
        if(tc.roundRect) tc.roundRect(0,0,w,h,r);
        else tc.rect(0,0,w,h);
        return;
    }
    if(kind === 'line'){ tc.beginPath(); tc.moveTo(0, h/2); tc.lineTo(w, h/2); return; }
    var pts = shapePolygon(kind, w, h);
    tc.beginPath();
    for(var i=0;i<pts.length;i++){
        if(i === 0) tc.moveTo(pts[i][0], pts[i][1]);
        else tc.lineTo(pts[i][0], pts[i][1]);
    }
    tc.closePath();
}

function thumbText(tc, text, x, y, maxW, lineH, maxLines){
    var lines = String(text||'').split('\n');
    var out = [];
    for(var i=0;i<lines.length;i++){
        var line = lines[i];
        if(!line){ out.push(''); continue; }
        var cur = '';
        for(var c=0;c<line.length;c++){
            var test = cur + line.charAt(c);
            if(tc.measureText(test).width > maxW && cur){ out.push(cur); cur = line.charAt(c); }
            else cur = test;
        }
        out.push(cur);
    }
    var shown = out.slice(0, maxLines || 3);
    shown.forEach(function(l, i){ tc.fillText(l, x, y + i*lineH); });
}

/* ===== 目录缩略图 =====
   1) 页面参数只在打开时算一次，按页比例占位，先出列表再逐帧画内容，长课件不卡；
   2) 关闭状态下的刷新只置脏标记，等下次打开再画，避免每加一页就全量重绘；
   3) 图片未解码时先占位，解码完成后单独重绘这一张，不会出现“加载异常”的空白缩略图。 */
var thumbRaf = 0;
var thumbToken = 0;

function pageSetNow(){
    var isPpt = (S.mode === 'ppt' && S.ppt);
    var isPrep = (S.mode === 'prep' && S.prep);
    var isDoc = (S.mode === 'doc' && S.doc);
    var list = isPpt ? S.ppt.slides : (isPrep ? S.prep.pages : (isDoc ? S.doc.pages : S.pages));
    var cur = isPpt ? S.slideIdx : (isPrep ? S.prepIdx : (isDoc ? S.docIdx : S.pageIdx));
    var baseW = isPpt ? S.ppt.width : (isPrep ? S.prep.w : (isDoc ? S.doc.w : CW));
    var baseH = isPpt ? S.ppt.height : (isPrep ? S.prep.h : (isDoc ? S.doc.h : CH));
    if(!baseW || !baseH){ baseW = 16; baseH = 9; }
    return {
        kind: isPpt ? 'ppt' : (isPrep ? 'prep' : (isDoc ? 'doc' : 'wb')),
        list: list || [], cur: cur, baseW: baseW, baseH: baseH
    };
}

function updatePageThumbnails(){
    if(!D.drawerBody) return;
    /* 抽屉关着就不用画，记个标记，等打开时统一生成 */
    if(!D.drawer.classList.contains('open')){ S.thumbDirty = true; return; }
    buildThumbList();
}

function buildThumbList(){
    var token = ++thumbToken;
    if(thumbRaf){ cancelAnimationFrame(thumbRaf); thumbRaf = 0; }
    S.thumbDirty = false;

    var set = pageSetNow();
    D.drawerBody.innerHTML = '';
    D.drawerBody.scrollTop = 0;
    if(!set.list.length) return;

    var ratio = set.baseH / Math.max(1, set.baseW);
    var padTop = Math.max(38, Math.min(135, ratio * 100));
    var frag = document.createDocumentFragment();
    var items = [];

    set.list.forEach(function(pg, i){
        var div = document.createElement('div');
        div.className = 'thumb' + (i === set.cur ? ' active' : '');
        div.style.paddingTop = padTop + '%';
        var c = document.createElement('canvas');
        div.appendChild(c);
        div.onclick = function(){
            closeDrawer();
            if(set.kind === 'ppt'){ S.slideIdx = i; renderPPT(); }
            else if(set.kind === 'prep'){ S.prepIdx = i; S.prepSel = null; renderPrep(); }
            else if(set.kind === 'doc'){ S.docIdx = i; renderDoc(); }
            else { S.pageIdx = i; updateBg(); redraw(); updatePageInd(); }
        };
        frag.appendChild(div);
        items.push({ div: div, canvas: c, pg: pg, repaint: 0 });
    });
    D.drawerBody.appendChild(frag);

    var idx = 0;
    var now = function(){ return (window.performance && performance.now) ? performance.now() : Date.now(); };
    function step(){
        if(token !== thumbToken) return;
        /* 中途关掉抽屉就不再继续画，省下算力 */
        if(!D.drawer.classList.contains('open')){ thumbRaf = 0; return; }
        var t0 = now();
        while(idx < items.length){
            paintThumb(items[idx], set, token);
            idx++;
            if(now() - t0 > 10) break;   /* 每帧最多画 10ms，滚动不会被抢 */
        }
        if(idx < items.length) thumbRaf = requestAnimationFrame(step);
        else thumbRaf = 0;
    }
    step();
}

/* 画一张缩略图；图片异步解码完成后再补画一次 */
function paintThumb(item, set, token){
    var div = item.div, c = item.canvas;
    if(!div || div.isConnected === false) return;
    var cw = Math.max(1, Math.round(div.clientWidth || 240));
    var ch = Math.max(1, Math.round(div.clientHeight || 135));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if(c.width !== pw || c.height !== ph){ c.width = pw; c.height = ph; }
    var tc = c.getContext('2d');
    tc.setTransform(dpr, 0, 0, dpr, 0, 0);
    tc.clearRect(0, 0, cw, ch);

    var pg = item.pg || {};
    var baseW = set.baseW, baseH = set.baseH;
    var fit = Math.min(cw / baseW, ch / baseH);
    var dw = Math.max(1, baseW * fit), dh = Math.max(1, baseH * fit);
    var ox = (cw - dw) / 2, oy = (ch - dh) / 2;
    var repaint = function(){
        if(item.repaint >= 3) return;
        item.repaint++;
        if(token === thumbToken) paintThumb(item, set, token);
    };
    var drawImg = function(src, x, y, w, h){
        if(!src) return;
        var im = new Image();
        var used = false;
        im.onload = function(){
            if(used) return;
            used = true;
            try{ tc.drawImage(im, x, y, w, h); }catch(e){}
            repaint();
        };
        im.onerror = function(){ used = true; };
        im.src = src;
        if(im.complete && im.naturalWidth){
            try{ tc.drawImage(im, x, y, w, h); }catch(e){}
            used = true;
        }
    };

    /* 页面底色铺满整块，避免出现刺眼的黑边 */
    var bgColor = set.kind === 'ppt' ? ((pg.bg && pg.bg.color) || '#ffffff')
                : set.kind === 'prep' ? (pg.bg || '#ffffff')
                : set.kind === 'doc' ? '#ffffff'
                : (pg.bg || '#0F261E');
    tc.fillStyle = bgColor;
    tc.fillRect(0, 0, cw, ch);

    if(set.kind === 'ppt'){
        /* 幻灯片图片是按需从压缩包里解码的：缩略图要主动触发一次，解完再补画，
           否则没翻到过的页面会一直是空白缩略图 */
        var needBg = !!(pg.bg && pg.bg.imagePath && !pg.bg.image);
        if(needBg) ensureSlideImages(pg);
        (pg.shapes || []).forEach(function(s){
            if(s && s.type === 'image' && !s.src && s.imgPath){
                resolveShapeImage(s).then(function(src){ if(src) repaint(); }).catch(function(){});
            }
        });
        if(needBg){
            var tries = 0;
            (function pollBg(){
                if(token !== thumbToken) return;
                if(pg.bg && pg.bg.image){ repaint(); return; }
                if(++tries < 12) setTimeout(pollBg, 220);
            })();
        }
        if(pg.bg && pg.bg.image) drawImg(pg.bg.image, ox, oy, dw, dh);
        (pg.shapes || []).forEach(function(s){
            tc.save();
            tc.translate(ox + (s.x + s.w / 2) * fit, oy + (s.y + s.h / 2) * fit);
            if(s.rot) tc.rotate(s.rot * Math.PI / 180);
            tc.translate(-(s.w / 2) * fit, -(s.h / 2) * fit);
            var w = Math.max(1, s.w * fit), h = Math.max(1, s.h * fit);
            thumbPoly(tc, s.shapeType || 'rect', w, h);
            if(s.type === 'image'){
                if(s.src) drawImg(s.src, 0, 0, w, h);
                else { tc.fillStyle = 'rgba(150,163,175,.4)'; tc.fill(); }
            } else if(s.type === 'table' && s.rows){
                /* 缩略图只勾格子骨架，够看清版式即可 */
                tc.fillStyle = '#fff'; tc.fillRect(0, 0, w, h);
                tc.strokeStyle = 'rgba(0,0,0,.35)'; tc.lineWidth = Math.max(0.4, fit);
                var ty = 0, totH = 0;
                s.rows.forEach(function(r){ totH += Math.max(8, r.h); });
                s.rows.forEach(function(r){
                    var rh = Math.max(8, r.h) / (totH || 1) * h;
                    tc.beginPath(); tc.moveTo(0, ty); tc.lineTo(w, ty); tc.stroke();
                    ty += rh;
                });
                tc.beginPath(); tc.moveTo(0, h); tc.lineTo(w, h); tc.stroke();
                if(s.colW && s.colW.length){
                    var totW = s.colW.reduce(function(a,b){ return a + b; }, 0) || 1, cx2 = 0;
                    s.colW.slice(0, -1).forEach(function(cw){
                        cx2 += cw / totW * w;
                        tc.beginPath(); tc.moveTo(cx2, 0); tc.lineTo(cx2, h); tc.stroke();
                    });
                }
            } else if(s.type === 'smartart' && s.nodes){
                tc.fillStyle = '#4472C4';
                s.nodes.forEach(function(nd){
                    tc.fillStyle = ['#4472C4','#5B9BD5','#8FAADC','#B4C7E7'][nd.depth % 4];
                    tc.fillRect(nd.x / s.w * w, nd.y / s.h * h, Math.max(1, nd.w / s.w * w), Math.max(1, nd.h / s.h * h));
                });
            } else if(s.type === 'chart' && s.series){
                tc.fillStyle = '#fff'; tc.fillRect(0, 0, w, h);
                var mx = 0;
                s.series.forEach(function(se){ se.values.forEach(function(v){ mx = Math.max(mx, v); }); });
                mx = mx || 1;
                if(s.chartKind === 'pie' || s.chartKind === 'doughnut'){
                    tc.fillStyle = '#4472C4';
                    tc.beginPath(); tc.moveTo(w/2, h/2);
                    tc.arc(w/2, h/2, Math.min(w,h)/2 - 1, 0, Math.PI * 1.5);
                    tc.closePath(); tc.fill();
                } else {
                    var vals = (s.series[0] && s.series[0].values) || [];
                    var slot = w / Math.max(1, vals.length);
                    tc.fillStyle = '#4472C4';
                    vals.forEach(function(v, i){
                        var bh = Math.max(0, v) / mx * (h * 0.8);
                        tc.fillRect(i * slot + slot * 0.2, h - bh, Math.max(0.6, slot * 0.6), bh);
                    });
                }
            } else if(s.fillColor){
                tc.fillStyle = s.fillColor;
                tc.fill();
            }
            if(s.borderColor && s.borderWidth > 0){
                tc.strokeStyle = s.borderColor;
                tc.lineWidth = Math.max(0.5, s.borderWidth * fit);
                tc.stroke();
            }
            if(s.type === 'text'){
                var paras = s.paragraphs && s.paragraphs.length ? s.paragraphs : [{ text: s.text }];
                var phh = Math.max(3, (paras[0].fontSize || 18) * fit);
                var yy = Math.max(phh, h * 0.28);
                paras.slice(0, 6).forEach(function(pp){
                    tc.fillStyle = pp.color || '#333';
                    tc.font = (pp.bold ? 'bold ' : '') + phh + 'px sans-serif';
                    tc.textBaseline = 'alphabetic';
                    thumbText(tc, pp.text, 2, yy, Math.max(4, w - 4), phh * 1.25, 2);
                    yy += phh * 1.35 * 2;
                });
            }
            tc.restore();
        });
    } else if(set.kind === 'prep'){
        (pg.elements || []).forEach(function(el){
            tc.save();
            tc.translate(ox, oy);
            var x = el.x * fit, y = el.y * fit, w = Math.max(1, el.w * fit), h = Math.max(1, el.h * fit);
            if(el.type === 'shape'){
                tc.translate(x + w / 2, y + h / 2);
                tc.translate(-w / 2, -h / 2);
                thumbPoly(tc, el.kind, w, h);
                if(el.fill && el.fill !== 'none'){ tc.fillStyle = el.fill; tc.fill(); }
                if(el.stroke && el.stroke !== 'none'){
                    tc.strokeStyle = el.stroke;
                    tc.lineWidth = Math.max(0.4, (el.strokeWidth || 1) * fit);
                    tc.stroke();
                }
            } else if(el.type === 'text'){
                var fs = Math.max(2.5, (el.fontSize || 28) * fit);
                tc.fillStyle = el.color || '#1b1b1b';
                tc.font = (el.bold ? 'bold ' : '') + fs + 'px sans-serif';
                thumbText(tc, el.text, x + 1, y + fs, Math.max(4, w - 2), fs * 1.3, Math.max(1, Math.floor(h / (fs * 1.3))));
            } else if(el.type === 'image' && el.src){
                drawImg(el.src, x, y, w, h);
            }
            tc.restore();
        });
        /* 批注笔迹 */
        if(pg.ink && pg.ink.length){
            pg.ink.forEach(function(st){
                tc.save();
                tc.translate(ox, oy);
                tc.scale(fit, fit);
                tc.globalCompositeOperation = (st.type === 'eraser') ? 'destination-out' : 'source-over';
                paintOne(tc, st);
                tc.restore();
            });
        }
    } else if(set.kind === 'doc'){
        var tmp = document.createElement('div');
        tmp.innerHTML = pg.html || '';
        var txt = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
        tc.fillStyle = '#dbe3ea';
        for(var li = 0; li < 12; li++){
            var ly = oy + dh * 0.12 + li * (dh * 0.072);
            if(ly > oy + dh - 4) break;
            var lw = dw * (li === 0 ? 0.55 : 0.78) * (0.7 + (li % 3) * 0.1);
            tc.fillRect(ox + dw * 0.08, ly, lw, 1.6);
        }
        if(txt){
            tc.fillStyle = '#9aa7b3';
            tc.font = '5px sans-serif';
            thumbText(tc, txt.slice(0, 60), ox + dw * 0.08, oy + dh * 0.08, dw * 0.84, 7, 1);
        }
    } else {
        var sx = dw / Math.max(1, baseW), sy = dh / Math.max(1, baseH);
        (pg.elements || []).forEach(function(el){
            if(el.type === 'pen' && el.points && el.points.length > 1){
                tc.beginPath();
                tc.moveTo(ox + el.points[0].x * sx, oy + el.points[0].y * sy);
                for(var k = 1; k < el.points.length; k++) tc.lineTo(ox + el.points[k].x * sx, oy + el.points[k].y * sy);
                tc.strokeStyle = el.color;
                tc.lineWidth = Math.max(0.6, el.thickness * Math.max(sx, sy) * 0.8);
                tc.lineCap = 'round';
                tc.lineJoin = 'round';
                tc.stroke();
            } else if(el.type === 'image'){
                var src = el.src || (el.img && el.img.src) || '';
                if(src) drawImg(src, ox + el.x * sx, oy + el.y * sy, el.w * sx, el.h * sy);
            } else if(el.type === 'shape'){
                tc.save();
                tc.translate(ox, oy);
                var l = Math.min(el.startX, el.endX) * sx, t2 = Math.min(el.startY, el.endY) * sy;
                var ww = Math.abs(el.endX - el.startX) * sx, hh = Math.abs(el.endY - el.startY) * sy;
                tc.strokeStyle = el.color;
                tc.lineWidth = Math.max(0.6, el.thickness * sx * 0.8);
                if(el.shapeType === 'rect') tc.strokeRect(l, t2, ww, hh);
                else if(el.shapeType === 'circle'){ tc.beginPath(); tc.ellipse(l + ww / 2, t2 + hh / 2, ww / 2, hh / 2, 0, 0, Math.PI * 2); tc.stroke(); }
                else if(el.shapeType === 'triangle'){ tc.beginPath(); tc.moveTo(l + ww / 2, t2); tc.lineTo(l + ww, t2 + hh); tc.lineTo(l, t2 + hh); tc.closePath(); tc.stroke(); }
                tc.restore();
            }
        });
    }

    /* 页面边界：白底页面在深色抽屉里也能看清范围 */
    tc.setTransform(dpr, 0, 0, dpr, 0, 0);
    tc.strokeStyle = 'rgba(128,148,166,.35)';
    tc.lineWidth = 1;
    tc.strokeRect(ox + 0.5, oy + 0.5, Math.max(1, dw - 1), Math.max(1, dh - 1));
}
function tick(){
    var d = new Date();
    var h = String(d.getHours()).padStart(2,'0');
    var m = String(d.getMinutes()).padStart(2,'0');
    var s = String(d.getSeconds()).padStart(2,'0');
    D.clock.textContent = h+':'+m+':'+s;
    if(D.bigTime.classList.contains('open')){
        D.bigVal.textContent = h+':'+m+':'+s;
        D.bigDate.textContent = d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日 星期'+'日一二三四五六'[d.getDay()];
    }
}
D.clock.onclick = function(){ D.bigTime.classList.add('open'); };
D.bigTime.onclick = function(){ D.bigTime.classList.remove('open'); };

function syncMenu(){
    var lbl = $('menu-prep-label');
    if(lbl){
        if(S.mode === 'prep') lbl.textContent = S.prepAnnotate ? '返回备课（编辑）' : '退出备课';
        else lbl.textContent = '返回备课';
    }
    var ex = $('menu-exit-ppt');
    if(ex) ex.classList.toggle('hidden', !(S.mode === 'ppt' || S.mode === 'doc'));
}

$('btn-menu').onclick = function(e){
    e.stopPropagation();
    syncMenu();
    D.leftMenu.classList.toggle('open');
};
D.leftMenu.querySelectorAll('.menu-item').forEach(function(item){
    item.onclick = function(e){
        e.stopPropagation();
        var m = item.dataset.m;
        D.leftMenu.classList.remove('open');
        if(m==='about') showAbout();
        else if(m==='load') showLoadList();
        else if(m==='export'){
            if(S.mode === 'prep') exportCourseware();
            else exportImage();
        }
        else if(m==='prep'){
            if(S.mode === 'prep' && S.prepAnnotate) setPrepAnnotate(false);
            else enterPrep();
        }
        else if(m==='ppt') openFileDialog();
        else if(m==='exit-ppt') exitFileMode(false);
        else if(m==='settings') showSettings();
        else if(m==='exit-app') confirmExitApp();
    };
});
document.addEventListener('click', function(e){
    if(!D.leftMenu.contains(e.target) && e.target!==$('btn-menu')) D.leftMenu.classList.remove('open');
    if(D.submenu.contains(e.target) || (e.target.closest && e.target.closest('.tool-btn'))) return;
    closeSubmenu();
});

$('btn-save').onclick = function(){
    if (S.mode === 'ppt' || S.mode === 'doc') {
        exitFileMode(false);
    } else if (S.mode === 'prep') {
        exportCourseware();
    } else {
        saveBoard();
    }
};

function saveBoard(){
    var key = 'easinote_save_' + Date.now();
    var data = {
        time: new Date().toLocaleString('zh-CN'),
        pages: S.pages.map(function(p){
            return {
                bg:p.bg,
                elements:p.elements.map(function(e){
                    if(e.type==='image') return { type:'image', src: e.src || (e.img ? e.img.src : ''), x:e.x, y:e.y, w:e.w, h:e.h };
                    return JSON.parse(JSON.stringify(e));
                })
            };
        })
    };
    try{
        localStorage.setItem(key, JSON.stringify(data));
        openModal({
            title:'保存成功',
            content:'<div style="text-align:center;padding:12px 0;font-size:52px;color:#2DC360;"><i class="fas fa-check"></i></div>',
            actions:[{ id:'close', label:'确定', type:'confirm' }]
        });
    }catch(e){
        toast('保存失败：' + e.message,'fa-exclamation-triangle');
    }
}

function showLoadList(){
    var keys = [];
    for(var i=0;i<localStorage.length;i++){
        var k = localStorage.key(i);
        if(k && k.indexOf('easinote_save_') === 0) keys.push(k);
    }
    keys.sort().reverse();
    var html = '<div class="save-list">';
    if(!keys.length) html += '<div class="save-empty">暂无保存的文件</div>';
    else {
        keys.forEach(function(k){
            var d = {};
            try{ d = JSON.parse(localStorage.getItem(k)); }catch(e){}
            var t = d.time || k.replace('easinote_save_','');
            html += '<div class="save-item" data-k="'+k+'">' +
                '<span class="name"><i class="fas fa-file-signature" style="color:#2DC360;"></i>'+t+'</span>' +
                '<span class="date">'+(d.pages?d.pages.length:0)+'页</span>' +
                '<button class="del" data-del="'+k+'"><i class="fas fa-trash"></i></button>' +
            '</div>';
        });
    }
    html += '</div>';
    var ov = openModal({
        title:'保存的文件',
        content:html,
        actions:[{ id:'close', label:'关闭', type:'cancel' }]
    });
    ov.querySelectorAll('.save-item').forEach(function(el){
        el.onclick = function(e){
            if(e.target.closest('.del')) return;
            var k = el.dataset.k;
            try{
                var d = JSON.parse(localStorage.getItem(k));
                if(d && d.pages){
                    S.pages = d.pages.map(function(p){
                        return {
                            bg:p.bg || '#0F261E',
                            elements:(p.elements||[]).map(function(e){
                                if(e.type==='image' && e.src){
                                    var img = new Image(); img.src = e.src;
                                    return Object.assign({}, e, { img: img });
                                }
                                return e;
                            })
                        };
                    });
                    S.pageIdx = 0;
                    S.mode = 'whiteboard';
                    clearHistStacks();
                    resetHistory();
                    $('menu-exit-ppt').classList.add('hidden');
                    updatePptUi(false);
                    updateBg(); redraw(); updatePageInd(); updatePageThumbnails();
                    closeModal(ov);
                    toast('加载成功','fa-check');
                }
            }catch(err){ toast('加载失败','fa-exclamation-triangle'); }
        };
    });
    ov.querySelectorAll('[data-del]').forEach(function(btn){
        btn.onclick = function(e){
            e.stopPropagation();
            localStorage.removeItem(btn.dataset.del);
            closeModal(ov);
            showLoadList();
        };
    });
}

function exportImage(){
    var tmp = document.createElement('canvas');
    tmp.width = CW * DPR; tmp.height = CH * DPR;
    var tc = tmp.getContext('2d');
    tc.fillStyle = getBg();
    tc.fillRect(0, 0, tmp.width, tmp.height);
    tc.drawImage(D.canvas, 0, 0);
    
    var a = document.createElement('a');
    a.download = '白板_' + Date.now() + '.png';
    a.href = tmp.toDataURL('image/png');
    a.click();
    toast('已导出图片','fa-check');
}

function confirmExitApp(){
    openModal({
        title:'退出白板',
        content:'<div style="color:#333;font-size:14px;line-height:1.8;text-align:left">' +
            '确定要关闭白板吗？关闭后当前页面会直接退出。<br>' +
            '<span style="color:#999;font-size:12.5px">未保存的板书会丢失，建议先「保存」或导出课件。</span></div>',
        actions:[
            { id:'cancel', label:'继续使用', type:'cancel' },
            { id:'exit', label:'关闭页面', type:'confirm', callback:function(ov){
                closeModal(ov);
                doExitApp();
            }}
        ]
    });
}

function doExitApp(){
    if(S.cameraStream){ try{ stopCamera(); }catch(e){} }
    try{
        localStorage.removeItem('easinote_login');
        localStorage.removeItem('easinote_token');
        localStorage.removeItem('easinote_user');
        localStorage.removeItem('easinote_userinfo');
    }catch(e){}

    /* 有原生壳（EXE / APK）时交给它关；没有就老老实实关标签页 */
    try{ if(callNativeExit()) return; }catch(e){}

    try{ window.open('', '_self'); }catch(e){}
    try{ window.close(); }catch(e){}

    /* 浏览器不允许脚本关闭非脚本打开的标签页：离开到空白页，效果等同关掉 */
    setTimeout(function(){
        if(!window.closed){
            try{ location.replace('about:blank'); }catch(e){}
        }
    }, 200);
}

/* 尽力调用宿主提供的“关闭/退出”能力；成功返回 true */
function callNativeExit(){
    var names = ['AndroidBridge','Android','NativeBridge','JSBridge','easinote','EasiNote','EasiNoteApp','app','App','ReactNativeWebView'];
    var meths = ['closeApp','exitApp','finishApp','finish','logout','exit','close','killApp','shutdown'];
    for(var i=0;i<names.length;i++){
        var obj = null;
        try{ obj = window[names[i]]; }catch(e){ continue; }
        if(!obj) continue;
        for(var j=0;j<meths.length;j++){
            try{
                if(typeof obj[meths[j]] === 'function'){
                    obj[meths[j]]();
                    return true;
                }
            }catch(e){}
        }
        /* WKWebView / 通用 postMessage 桥 */
        try{
            if(obj.messageHandlers){
                var hs = ['close','exit','logout','finish'];
                for(var k=0;k<hs.length;k++){
                    if(obj.messageHandlers[hs[k]]){
                        obj.messageHandlers[hs[k]].postMessage({ action:'exit' });
                        return true;
                    }
                }
            }
        }catch(e){}
    }
    /* React Native WebView */
    try{
        if(window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function'){
            window.ReactNativeWebView.postMessage(JSON.stringify({ action:'exit', type:'close' }));
            return true;
        }
    }catch(e){}

    /* URL Scheme 兜底（部分壳监听这些 scheme 自行关闭页面） */
    try{
        if(/EasiNote|easinote/i.test(navigator.userAgent)){
            location.href = 'easinote://exit';
            return true;
        }
    }catch(e){}
    return false;
}

function showExitedScreen(mode){
    var old = document.getElementById('exit-screen');
    if(old) old.remove();
    mode = mode || 'manual';
    var closing = (mode === 'closing');
    var el = document.createElement('div');
    el.id = 'exit-screen';
    el.innerHTML = '<div class="exit-card">' +
            '<div class="exit-ic"><i class="fas ' + (closing ? 'fa-spinner fa-spin' : 'fa-power-off') + '"></i></div>' +
            '<div class="exit-title">' + (closing ? '正在退出…' : '已退出登录') + '</div>' +
            '<div class="exit-sub">' + (closing ? '正在通知宿主关闭窗口' : '当前运行环境（EXE / APK 壳）不允许网页自行关闭窗口') +
                '<br>' + (closing ? '如果窗口没有自动关闭，请稍候…' : '请点击窗口右上角关闭，或按 Alt + F4 结束程序') + '</div>' +
            '<div class="exit-actions">' +
                (closing ? '' : '<button class="exit-btn ghost" id="exit-retry">再次尝试关闭</button>') +
                '<button class="exit-btn" id="exit-back">返回白板</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(el);
    var b = el.querySelector('#exit-back');
    if(b) b.onclick = function(){ el.remove(); };
    var rt = el.querySelector('#exit-retry');
    if(rt) rt.onclick = function(){
        el.remove();
        doExitApp();
    };
}

function exitPPT(){
    if(S.cameraStream) stopCamera();
    S.mode = 'whiteboard';
    S.ppt = null;
    S.doc = null;
    document.body.classList.remove('ppt-mode','doc-mode');
    if(!S.pages.length) S.pages = [{ bg:'#0F261E', elements:[] }];
    if(S.pageIdx >= S.pages.length) S.pageIdx = 0;
    $('menu-exit-ppt').classList.add('hidden');
    updatePptUi(false);
    updateBg(); redraw(); updatePageInd(); updatePageThumbnails();
    toast('已返回白板','fa-check');
}

function showAbout(){
    if(window.EN10About){ window.EN10About.open(); return; }
    openModal({
        title:'',
        cls:'about-modal',
        content:
            '<div class="about-name">EasiNote10</div>' +
            '<div style="font-size:13px;color:#555;line-height:1.75;">' +
                '快捷白板10 Beta<br>' +
                '已开源，交流群：1129349388<br>' +
                '©ParkerStudio<br>' +
                '<a class="about-link" href="https://parkerstudioxkissice.app.workbuddy.host/?sharecode=UZYO5WR4L6" target="_blank" rel="noopener">官方网站 https://parkerstudioxkissice.app.workbuddy.host/?sharecode=UZYO5WR4L6</a>' +
            '</div>' +
            '<div class="about-footer">' +
                '<span>版本 10.0</span>' +
                '<span>内核 10.0.0</span>' +
                '<span>ParkerStudio</span>' +
            '</div>',
        actions:[{ id:'close', label:'确定', type:'confirm' }]
    });
}

function showSettings(){
    var zoomPct = Math.round((S.zoom || 1) * 100);
    var sensPct = Math.round(S.gestureSens);
    var sensLabel = function(v){
        if(v >= 80) return '灵敏 ' + v;
        if(v >= 45) return '适中 ' + v;
        if(v > 0) return '迟钝 ' + v;
        return '关闭';
    };
    var ov = openModal({
        title:'设置',
        cls:'settings-modal',
        content:
            '<div class="set-list">' +
                '<div class="set-row">' +
                    '<div class="set-label"><span>全屏模式</span></div>' +
                    '<button class="set-btn" id="set-full">切换</button>' +
                '</div>' +
                '<div class="set-row col">' +
                    '<div class="set-row-top"><span>界面缩放</span><b class="set-val" id="set-zoom-val">' + zoomPct + '%</b></div>' +
                    '<input type="range" class="set-range" id="set-zoom" min="25" max="200" step="5" value="' + zoomPct + '">' +
                    '<div class="set-scale"><span>25%</span><span>100%</span><span>200%</span></div>' +
                '</div>' +
                '<div class="set-row">' +
                    '<div class="set-label"><span>手势橡皮</span>' +
                        '<span class="set-sub">笔模式下用较大的接触面积（手掌、拇指侧面）直接擦除，抬手自动回到笔</span>' +
                    '</div>' +
                    '<label class="toggle"><input type="checkbox" id="set-gesture" ' + (S.gestureEraser ? 'checked' : '') + '>' +
                        '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
                    '</label>' +
                '</div>' +
                '<div class="set-row col">' +
                    '<div class="set-row-top"><span>手势橡皮触发灵敏度</span><b class="set-val" id="set-sens-val">' + sensLabel(sensPct) + '</b></div>' +
                    '<input type="range" class="set-range" id="set-sens" min="0" max="100" step="1" value="' + sensPct + '">' +
                    '<div class="set-scale"><span>迟钝</span><span>适中</span><span>灵敏</span></div>' +
                '</div>' +
                '<div class="set-row">' +
                    '<div class="set-label"><span>AI 接口</span>' +
                        '<span class="set-sub" id="set-api-sub">默认 DeepSeek · 可换成任意 OpenAI 兼容接口</span>' +
                    '</div>' +
                    '<button class="set-btn" id="set-api">配置</button>' +
                '</div>' +
                '<div class="set-row">' +
                    '<div class="set-label"><span>账户余额</span>' +
                        '<span class="set-sub" id="set-balance-sub">未查询</span>' +
                    '</div>' +
                    '<button class="set-btn" id="set-balance">查询</button>' +
                '</div>' +
                '<div class="set-row">' +
                    '<div class="set-label"><span>API 使用教程</span>' +
                        '<span class="set-sub">注册开放平台 → 新建 API Key → 填入白板</span>' +
                    '</div>' +
                    '<button class="set-btn" id="set-api-guide">查看</button>' +
                '</div>' +
            '</div>' +
            '<div class="set-hint">界面缩放 25% - 200%，拖动滑杆后松手生效；小屏设备调小可显示完整界面。手势橡皮只影响笔模式，不会改变当前工具：接触面积明显大于平时笔迹时临时当橡皮，抬手即恢复书写。</div>',
        actions:[{ id:'close', label:'关闭', type:'cancel' }]
    });

    /* ---- 界面缩放滑杆：拖动时只更新数值，松手再应用，避免整页缩放带着手指跑 ---- */
    var zoomRange = ov.querySelector('#set-zoom');
    var zoomVal = ov.querySelector('#set-zoom-val');
    zoomRange.addEventListener('input', function(){
        zoomVal.textContent = zoomRange.value + '%';
    });
    zoomRange.addEventListener('change', function(){
        var v = Math.round(Math.max(25, Math.min(200, parseFloat(zoomRange.value) || 100)));
        zoomRange.value = v;
        zoomVal.textContent = v + '%';
        var z = v / 100;
        if(Math.abs(z - (S.zoom || 1)) < 0.001) return;
        var prevZoom = S.zoom || 1;
        S.zoom = z;
        localStorage.setItem('easinote_zoom', String(z));
        applyZoom();
        resizeCanvas();
        checkNarrow();
        setActiveToolUI();
        if(S.mode === 'prep') scaleStage();
        /* 缩放后给 10 秒确认窗口，避免误调后界面变得不好用 */
        askZoomApply(prevZoom);
    });

    /* ---- 手势橡皮开关与灵敏度 ---- */
    var gToggle = ov.querySelector('#set-gesture');
    gToggle.addEventListener('change', function(){
        S.gestureEraser = gToggle.checked;
        if(S.gestureEraser && S.gestureSens <= 0){
            S.gestureSens = 50;
            sensRange.value = 50;
            sensVal.textContent = sensLabel(50);
            localStorage.setItem('easinote_gesture_sens', '50');
        }
        localStorage.setItem('easinote_gesture_eraser', S.gestureEraser ? '1' : '0');
        toast(S.gestureEraser ? '手势橡皮已开启' : '手势橡皮已关闭', 'fa-hand-paper');
    });

    var sensRange = ov.querySelector('#set-sens');
    var sensVal = ov.querySelector('#set-sens-val');
    sensRange.addEventListener('input', function(){
        sensVal.textContent = sensLabel(Math.round(parseFloat(sensRange.value) || 0));
    });
    sensRange.addEventListener('change', function(){
        var v = Math.round(Math.max(0, Math.min(100, parseFloat(sensRange.value) || 0)));
        S.gestureSens = v;
        localStorage.setItem('easinote_gesture_sens', String(v));
        sensVal.textContent = sensLabel(v);
        if(v <= 0){
            S.gestureEraser = false;
            gToggle.checked = false;
            localStorage.setItem('easinote_gesture_eraser', '0');
            toast('灵敏度为 0，手势橡皮已关闭', 'fa-hand-paper');
            return;
        }
        if(!S.gestureEraser){
            S.gestureEraser = true;
            gToggle.checked = true;
            localStorage.setItem('easinote_gesture_eraser', '1');
        }
        toast('触发灵敏度：' + sensLabel(v) + '（按你平时的笔迹面积自适应）', 'fa-sliders-h');
    });

    ov.querySelector('#set-full').onclick = function(){
        if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function(){});
        else document.exitFullscreen();
    };
    ov.querySelector('#set-api').onclick = function(){
        if(window.EN10AIConfig){ window.EN10AIConfig.open(ov); return; }
        closeModal(ov);
        S.apiKey='';
        localStorage.removeItem('easinote_api_key');
        /* 从设置里改 Key 不应该顺手触发一次总结 */
        showAPIKeyModal(function(){ toast('API Key 已更新','fa-check'); });
    };
    var balBtn = ov.querySelector('#set-balance');
    if(balBtn) balBtn.onclick = function(){
        if(!window.EN10AIConfig){ toast('AI 配置模块未加载','fa-exclamation-triangle'); return; }
        var sub = ov.querySelector('#set-balance-sub');
        balBtn.disabled = true;
        balBtn.textContent = '查询中';
        window.EN10AIConfig.fetchBalance().then(function(info){
            sub.textContent = info.text;
            sub.style.color = info.ok ? '#22A64F' : '#c0392b';
        }).then(function(){
            balBtn.disabled = false;
            balBtn.textContent = '查询';
        });
    };
    var guideBtn = ov.querySelector('#set-api-guide');
    if(guideBtn) guideBtn.onclick = function(){
        if(window.EN10AIConfig) window.EN10AIConfig.guide(ov);
    };
    /* 打开设置时顺手把当前接口与余额状态写出来 */
    (function(){
        var sub = ov.querySelector('#set-api-sub');
        var bal = ov.querySelector('#set-balance-sub');
        if(sub && window.EN10AIConfig){
            var c = window.EN10AIConfig.get();
            sub.textContent = c.model + ' · ' + c.base.replace(/^https?:\/\//,'');
        }
        if(bal && window.EN10AIConfig){
            var cached = window.EN10AIConfig.cachedBalance();
            if(cached){ bal.textContent = cached.text; bal.style.color = cached.ok ? '#22A64F' : '#c0392b'; }
            else if(!window.EN10AIConfig.get().key){ bal.textContent = '未配置 API Key'; }
        }
    })();
}
$('btn-camera').onclick = function(){
    if(S.mode==='camera'){ stopCamera(); return; }
    
    // 兼容老版 WebView 的 API
    var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (getUserMedia) {
            getUserMedia.call(navigator, { video: true }, function(stream) {
                S.cameraStream = stream;
                S.mode = 'camera';
                resetCamView();
                updateBg(); redraw();
                $('btn-camera').classList.add('on');
                toast('视频展台已开启','fa-camera');
            }, function(err) {
                toast('无法访问摄像头: ' + (err.name || err.message) + ' (WebView需原生授权)', 'fa-exclamation-triangle');
            });
            return;
        }
        toast('当前环境不支持摄像头。如果是在App的WebView中，请让开发者添加 CAMERA 权限并设置 WebChromeClient 授权。','fa-exclamation-triangle');
        return;
    }
    
    // 现代标准 API
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function(stream){
        S.cameraStream = stream;
        S.mode = 'camera';
        resetCamView();
        updateBg(); redraw();
        $('btn-camera').classList.add('on');
        toast('视频展台已开启','fa-camera');
    }).catch(function(err){
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            toast('摄像头权限被拒绝。请检查系统或WebView权限设置。','fa-exclamation-triangle');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            toast('未找到可用的摄像头设备','fa-exclamation-triangle');
        } else {
            toast('无法访问摄像头: ' + err.message,'fa-exclamation-triangle');
        }
    });
};
$('btn-freeze').onclick = function(e){
    e.stopPropagation();
    toggleFreeze();
};

function toggleFreeze(){
    if(S.mode !== 'camera'){ toast('请先打开视频展台','fa-camera'); return; }
    if(S.cameraFrozen){
        S.cameraFrozen = false;
        S.cameraFreezeSrc = '';
        updateBg(); redraw();
        toast('已恢复实时画面','fa-video');
        return;
    }
    var v = D.bg.querySelector('video');
    if(!v || !v.videoWidth){
        toast('画面还没准备好，稍等一下再冻结','fa-hourglass-half');
        return;
    }
    var cv = document.createElement('canvas');
    cv.width = v.videoWidth;
    cv.height = v.videoHeight;
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    try{ S.cameraFreezeSrc = cv.toDataURL('image/jpeg', 0.92); }
    catch(err){ toast('冻结失败：' + (err.message||''),'fa-exclamation-triangle'); return; }
    S.cameraFrozen = true;
    updateBg(); redraw();
    toast('画面已冻结，可以直接在上面批注','fa-snowflake');
}

function stopCamera(){
    if(S.cameraStream){
        S.cameraStream.getTracks().forEach(function(t){t.stop();});
        S.cameraStream = null;
    }
    S.cameraFrozen = false;
    S.cameraFreezeSrc = '';
    S.mode = 'whiteboard';
    updateBg(); redraw();
    $('btn-camera').classList.remove('on');
    toast('视频展台已关闭','fa-camera');
}

var narrowTimer = 0;
function checkNarrow(){
    var effW = window.innerWidth / (S.zoom || 1);
    var tooNarrow = effW < 560;
    if(tooNarrow && !S.narrow){
        S.narrow = true;
        D.narrow.style.display = 'flex';
        clearTimeout(narrowTimer);
        /* 只提示，不遮挡；6 秒后自己收起来，转回宽屏会立刻消失 */
        narrowTimer = setTimeout(function(){ D.narrow.style.display = 'none'; }, 6000);
    } else if(!tooNarrow && S.narrow){
        S.narrow = false;
        clearTimeout(narrowTimer);
        D.narrow.style.display = 'none';
    }
}

function showUpdate(){
    if(localStorage.getItem('easinote_no_update')==='true') return;
    var ov = openModal({
        title:'已更新至 快捷白板10 备课版',
        content:
            '<img class="update-icon" src="src/easinote.png" onerror="this.style.display=\'none\'">' +
            '<div class="update-log">' +
                '<h4>欢迎使用快捷白板10</h4>' +
                '<ul>' +
                    '<li>作者 ParkerStudio</li>' +
                    '<li>有任何问题欢迎反馈</li>' +
                    '<li>交流群：1129349388</li>' +
                '</ul>' +
                '<h4>主要更新</h4>' +
                '<ul>' +
                    '<li><b>课件格式</b>：导出为自有格式 <b>.pnbx</b>，可直接打开并批注，返回备课才能编辑</li>' +
                    '<li><b>笔迹</b>：起笔不再出现小圆点，快速连笔不断墨</li>' +
                    '<li><b>撤销</b>：重写为快照栈，连续撤销后继续书写不再卡住</li>' +
                    '<li><b>备课</b>：双击文字即可编辑、文本框拖动更跟手、出现顺序面板重做</li>' +
                    '<li><b>视频展台</b>：新增「冻结画面」，冻结后可直接批注</li>' +
                    '<li><b>实验 / 网页</b>：修复全屏只占左上角的问题，兼容旧内核</li>' +
                    '<li><b>AI 总结</b>：彩光向内渐染，冷却时间改为 10 秒，结果支持 Markdown</li>' +
                    '<li>修复菜单状态不同步、颜色光边硬切等问题</li>' +
                '</ul>' +
            '</div>' +
            '<label class="checkbox" style="justify-content:center;color:#555;">' +
                '<input type="checkbox" id="no-tip">' +
                '<span class="checkbox-box"><i class="fas fa-check"></i></span>' +
                '<span style="font-size:13px;">不再提示</span>' +
            '</label>',
        actions:[
            { id:'ok', label:'确定', type:'confirm', callback:function(o){
                if(o.querySelector('#no-tip').checked) localStorage.setItem('easinote_no_update','true');
                closeModal(o);
            }}
        ]
    });
}

/* ================= 备课模式 ================= */

var PREP_SHAPES = [
    { k:'rect', name:'矩形', icon:'fa-square' },
    { k:'roundRect', name:'圆角', icon:'fa-square-full' },
    { k:'ellipse', name:'圆形', icon:'fa-circle' },
    { k:'triangle', name:'三角', icon:'fa-play' },
    { k:'diamond', name:'菱形', icon:'fa-square' },
    { k:'pentagon', name:'五边形', icon:'fa-caret-up' },
    { k:'hexagon', name:'六边形', icon:'fa-circle' },
    { k:'star5', name:'五角星', icon:'fa-star' },
    { k:'rightArrow', name:'箭头', icon:'fa-arrow-right' },
    { k:'chevron', name:'折角', icon:'fa-chevron-right' },
    { k:'parallelogram', name:'平行四边形', icon:'fa-slash' },
    { k:'cross', name:'十字', icon:'fa-plus' },
    { k:'line', name:'直线', icon:'fa-minus' }
];
var PREP_COLORS = ['#1b1b1b','#ffffff','#2DC360','#007aff','#ff3b30','#ff9500','#ffcc00','#af52de','#8e8e93','#00c7be'];

function prepPage(){ return (S.prep && S.prep.pages[S.prepIdx]) || null; }
function prepElById(id){
    var pg = prepPage(); if(!pg) return null;
    for(var i=0;i<pg.elements.length;i++) if(pg.elements[i].id === id) return pg.elements[i];
    return null;
}
function newPrepDoc(w, h){
    return {
        title: '未命名课件',
        w: Math.max(320, Math.round(w || 1280)),
        h: Math.max(240, Math.round(h || 800)),
        pages: [{ bg:'#ffffff', elements:[], ink:[], name:'第 1 页' }],
        nextId: 1
    };
}
function prepNextId(){
    if(!S.prep.nextId) S.prep.nextId = 1;
    return 'e' + (S.prep.nextId++);
}
function addPrepElement(el){
    var pg = prepPage(); if(!pg) return null;
    el.id = prepNextId();
    if(el.order === undefined) el.order = 0;
    pg.elements.push(el);
    renderPrep();
    selectPrep(el);
    return el;
}
function prepShapeBody(el){
    var w = Math.max(1, el.w), h = Math.max(1, el.h);
    var sw = Math.max(0, el.strokeWidth || 0);
    var fill = el.fill || 'none';
    var stroke = el.stroke || 'none';
    var common = 'fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'" stroke-linejoin="round"';
    if(el.kind === 'line'){
        return '<line x1="0" y1="'+h/2+'" x2="'+w+'" y2="'+h/2+'" stroke="'+(el.stroke||'#1b1b1b')+'" stroke-width="'+Math.max(1,sw)+'" stroke-linecap="round"/>';
    }
    if(el.kind === 'ellipse'){
        return '<ellipse cx="'+w/2+'" cy="'+h/2+'" rx="'+Math.max(0.5,(w-sw)/2)+'" ry="'+Math.max(0.5,(h-sw)/2)+'" '+common+'/>';
    }
    if(el.kind === 'rect' || el.kind === 'roundRect'){
        var rx = el.kind === 'roundRect' ? Math.min(w,h) * 0.16 : 0;
        return '<rect x="'+sw/2+'" y="'+sw/2+'" width="'+Math.max(0.5,w-sw)+'" height="'+Math.max(0.5,h-sw)+'" rx="'+rx+'" '+common+'/>';
    }
    return '<path d="'+polygonPath(shapePolygon(el.kind, w, h), 0, 0)+'" '+common+'/>';
}
function mkPrepNode(el){
    var d = document.createElement('div');
    d.className = 'prep-el prep-' + el.type;
    d.dataset.id = el.id;
    d.style.left = el.x + 'px';
    d.style.top = el.y + 'px';
    d.style.width = Math.max(1, el.w) + 'px';
    d.style.height = Math.max(1, el.h) + 'px';

    if(el.type === 'shape'){
        d.innerHTML = '<svg width="100%" height="100%" viewBox="0 0 '+Math.max(1,el.w)+' '+Math.max(1,el.h)+'" preserveAspectRatio="none" style="display:block;overflow:visible">'+prepShapeBody(el)+'</svg>';
    } else if(el.type === 'text'){
        d.style.color = el.color || '#1b1b1b';
        d.style.fontSize = (el.fontSize || 28) + 'px';
        d.style.fontWeight = el.bold ? '800' : '400';
        d.style.fontStyle = el.italic ? 'italic' : 'normal';
        d.style.textAlign = el.align || 'left';
        d.style.lineHeight = (el.lineHeight || 1.35);
        d.style.justifyContent = el.anchor === 'middle' ? 'center' : (el.anchor === 'bottom' ? 'flex-end' : 'flex-start');
        d.style.padding = '2px 4px';
        d.textContent = el.text || '';
        if(!el.text) d.innerHTML = '<span style="opacity:.32">双击输入文字</span>';
    } else if(el.type === 'image'){
        var img = document.createElement('img');
        img.src = el.src || '';
        img.draggable = false;
        d.appendChild(img);
    }
    if(el.order > 0){
        var chip = document.createElement('div');
        chip.className = 'prep-order-chip';
        chip.textContent = el.order;
        d.appendChild(chip);
    }
    return d;
}

function buildPrepStage(){
    var pg = prepPage();
    var vp = document.createElement('div');
    vp.className = 'prep-viewport';
    var stage = document.createElement('div');
    stage.className = 'prep-stage';
    stage.id = 'prep-stage';
    stage.style.width = S.prep.w + 'px';
    stage.style.height = S.prep.h + 'px';
    stage.style.background = (pg && pg.bg) || '#ffffff';

    if(pg){
        pg.elements.forEach(function(el){ stage.appendChild(mkPrepNode(el)); });
        if(!pg.elements.length){
            var tip = document.createElement('div');
            tip.className = 'prep-tip';
            tip.innerHTML = '点击下方工具插入形状 / 文字 / 图片<br>选中元素后可直接拖动、缩放';
            stage.appendChild(tip);
        }
    }
    var sel = document.createElement('div');
    sel.className = 'prep-sel';
    sel.id = 'prep-sel';
    sel.style.display = 'none';
    ['nw','ne','sw','se'].forEach(function(c){
        var hd = document.createElement('div');
        hd.className = 'prep-handle';
        hd.dataset.corner = c;
        sel.appendChild(hd);
    });
    stage.appendChild(sel);
    vp.appendChild(stage);
    D.bg.innerHTML = '';
    D.bg.appendChild(vp);
    stage.addEventListener('pointerdown', prepPointerDown);
    scaleStage();
    updatePrepSelection();
}

function prepStageEl(){ return document.getElementById('prep-stage'); }
function prepPoint(e){
    var st = prepStageEl();
    if(!st) return { x:0, y:0 };
    var r = st.getBoundingClientRect();
    var sc = (r.width / (S.prep.w || 1)) || 1;
    return { x:(e.clientX - r.left) / sc, y:(e.clientY - r.top) / sc };
}

function selectPrep(el){
    S.prepSel = el || null;
    updatePrepSelection();
    renderPrepProps();
}
function updatePrepSelection(){
    var sel = document.getElementById('prep-sel');
    var st = prepStageEl();
    if(!sel || !st) return;
    var el = S.prepSel;
    if(S.mode !== 'prep' || !el || !prepElById(el.id)){ sel.style.display = 'none'; return; }
    var sc = parseFloat(st.dataset.scale || '1') || 1;
    var hs = 22 / sc;
    sel.style.display = 'block';
    sel.style.left = el.x + 'px';
    sel.style.top = el.y + 'px';
    sel.style.width = Math.max(1, el.w) + 'px';
    sel.style.height = Math.max(1, el.h) + 'px';
    sel.querySelectorAll('.prep-handle').forEach(function(hd){
        hd.style.width = hs + 'px';
        hd.style.height = hs + 'px';
        hd.style.borderWidth = Math.max(1, 2/sc) + 'px';
        var c = hd.dataset.corner;
        hd.style.left = (c === 'nw' || c === 'sw') ? (-hs/2) + 'px' : 'auto';
        hd.style.right = (c === 'ne' || c === 'se') ? (-hs/2) + 'px' : 'auto';
        hd.style.top = (c === 'nw' || c === 'ne') ? (-hs/2) + 'px' : 'auto';
        hd.style.bottom = (c === 'sw' || c === 'se') ? (-hs/2) + 'px' : 'auto';
        hd.style.cursor = (c === 'nw' || c === 'se') ? 'nwse-resize' : 'nesw-resize';
    });
    renderPrepProps();
}

function prepClamp(el){
    el.x = Math.max(-el.w * 0.9, Math.min(S.prep.w - 20, el.x));
    el.y = Math.max(-el.h * 0.9, Math.min(S.prep.h - 20, el.y));
}

function prepPointerDown(e){
    if(S.mode !== 'prep') return;
    if(e.button !== undefined && e.button !== 0) return;
    var t = e.target;
    if(t && t.classList && t.classList.contains('prep-handle')){
        var el = S.prepSel;
        if(!el) return;
        S.prepDrag = { mode:'resize', corner:t.dataset.corner, el:el,
            sx:prepPoint(e).x, sy:prepPoint(e).y, ox:el.x, oy:el.y, ow:el.w, oh:el.h };
        e.preventDefault(); e.stopPropagation();
        return;
    }
    var node = t && t.closest ? t.closest('.prep-el') : null;
    if(node){
        var target = prepElById(node.dataset.id);
        if(!target) return;

        var nowTap = Date.now();
        var pt = prepPoint(e);
        /* 第二次按下的“双击候选”先记下来，等抬手确认没拖动才算双击 —— 这样不会抢掉拖动 */
        var isDbl = S.prepLastTap && S.prepLastTap.id === target.id &&
                    (nowTap - S.prepLastTap.t) < 330 &&
                    Math.abs(pt.x - S.prepLastTap.x) < 12 && Math.abs(pt.y - S.prepLastTap.y) < 12;
        S.prepDblPending = isDbl ? target : null;
        S.prepLastTap = { id:target.id, t:nowTap, x:pt.x, y:pt.y };

        selectPrep(target);
        S.prepDrag = { mode:'move', el:target, sx:pt.x, sy:pt.y, ox:target.x, oy:target.y,
                       px:e.clientX, py:e.clientY, started:false };
        try{ if(e.pointerId !== undefined && e.currentTarget && e.currentTarget.setPointerCapture){
            e.currentTarget.setPointerCapture(e.pointerId);
        } }catch(err){}
        e.stopPropagation();
        return;
    }
    if(S.prepTool === 'shape'){
        var p2 = prepPoint(e);
        var shape = {
            type:'shape', kind:S.prepShape,
            x:p2.x, y:p2.y, w:1, h:1,
            fill: S.prepFillOn ? S.prepFillColor : 'none',
            stroke: S.prepStrokeColor, strokeWidth: S.prepStrokeWidth,
            order: 0
        };
        var created = addPrepElement(shape);
        if(created){
            S.prepDrag = { mode:'draw', el:created, sx:p2.x, sy:p2.y };
        }
        e.preventDefault(); e.stopPropagation();
        return;
    }
    if(S.prepTool === 'text'){
        var p3 = prepPoint(e);
        var w = Math.min(420, S.prep.w * 0.5), h = Math.max(70, S.prepFontSize * 2.4);
        var txt = { type:'text', x:Math.max(0,p3.x - w/2), y:Math.max(0,p3.y - h/2), w:w, h:h,
            text:'双击输入文字', color:S.prepTextColor, fontSize:S.prepFontSize,
            bold:S.prepBold, italic:false, align:'left', order:0 };
        var tEl = addPrepElement(txt);
        setPrepTool('select');
        if(tEl) setTimeout(function(){ editPrepText(tEl); }, 60);
        e.preventDefault(); e.stopPropagation();
        return;
    }
    selectPrep(null);
}

function prepPointerMove(e){
    if(S.mode !== 'prep' || !S.prepDrag) return;
    var d = S.prepDrag;
    var p = prepPoint(e);
    var el = d.el;
    if(!el) return;
    if(d.mode === 'move'){
        /* 3px 死区：点一下不跑位，拖起来才跟手 */
        if(!d.started){
            if(Math.abs(e.clientX - d.px) < 3 && Math.abs(e.clientY - d.py) < 3) return;
            d.started = true;
        }
        el.x = d.ox + (p.x - d.sx);
        el.y = d.oy + (p.y - d.sy);
        prepClamp(el);
    } else if(d.mode === 'resize'){
        var dx = p.x - d.sx, dy = p.y - d.sy;
        var x = d.ox, y = d.oy, w = d.ow, h = d.oh;
        if(d.corner === 'nw'){ x = d.ox + dx; y = d.oy + dy; w = d.ow - dx; h = d.oh - dy; }
        if(d.corner === 'ne'){ y = d.oy + dy; w = d.ow + dx; h = d.oh - dy; }
        if(d.corner === 'sw'){ x = d.ox + dx; w = d.ow - dx; h = d.oh + dy; }
        if(d.corner === 'se'){ w = d.ow + dx; h = d.oh + dy; }
        if(w < 24){ w = 24; if(d.corner === 'nw' || d.corner === 'sw') x = d.ox + d.ow - 24; }
        if(h < 24){ h = 24; if(d.corner === 'nw' || d.corner === 'ne') y = d.oy + d.oh - 24; }
        el.x = x; el.y = y; el.w = w; el.h = h;
    } else if(d.mode === 'draw'){
        var x0 = Math.min(d.sx, p.x), y0 = Math.min(d.sy, p.y);
        var w2 = Math.max(6, Math.abs(p.x - d.sx)), h2 = Math.max(6, Math.abs(p.y - d.sy));
        el.x = x0; el.y = y0; el.w = w2; el.h = h2;
        if(el.kind === 'line'){ el.h = Math.max(6, h2); }
    }
    var node = document.querySelector('.prep-el[data-id="'+el.id+'"]');
    if(node){
        node.style.left = el.x + 'px';
        node.style.top = el.y + 'px';
        node.style.width = Math.max(1,el.w) + 'px';
        node.style.height = Math.max(1,el.h) + 'px';
        if(el.type === 'shape'){
            var svg = node.querySelector('svg');
            if(svg){
                svg.setAttribute('viewBox', '0 0 '+Math.max(1,el.w)+' '+Math.max(1,el.h));
                var body = prepShapeBody(el);
                if(svg.firstElementChild) svg.removeChild(svg.firstElementChild);
                svg.insertAdjacentHTML('afterbegin', body);
            }
        }
    }
    updatePrepSelection();
}

function prepPointerUp(e){
    if(S.mode !== 'prep') return;
    if(!S.prepDrag) return;
    var d = S.prepDrag;
    S.prepDrag = null;
    try{ if(e && e.pointerId !== undefined && e.currentTarget && e.currentTarget.releasePointerCapture){
        e.currentTarget.releasePointerCapture(e.pointerId);
    } }catch(err){}

    /* 双击判定放在抬手：没移动 = 双击（文字则打开编辑框），移动过就当作拖动 */
    if(d.mode === 'move'){
        if(!d.started && S.prepDblPending){
            var tgt = S.prepDblPending;
            S.prepDblPending = null;
            S.prepLastTap = null;
            if(tgt && tgt.type === 'text'){ editPrepText(tgt); return; }
        }
        if(d.started) S.prepLastTap = null;
        S.prepDblPending = null;
    }
    if(d.mode === 'draw' && d.el && (d.el.w < 12 || d.el.h < 12)){
        d.el.w = 140; d.el.h = 100;
        var node = document.querySelector('.prep-el[data-id="'+d.el.id+'"]');
        if(node){ node.style.width='140px'; node.style.height='100px'; }
    }
    if(d.mode === 'draw') setPrepTool('select');
    renderPrep();
    selectPrep(d.el);
}

document.addEventListener('pointermove', prepPointerMove, { passive:false });
document.addEventListener('pointerup', prepPointerUp);
document.addEventListener('pointercancel', prepPointerUp);

/* ---- 备课底栏 ---- */
function buildPrepToolbar(){
    var old = document.getElementById('prep-toolbar');
    if(old) old.remove();
    var bar = document.createElement('div');
    bar.id = 'prep-toolbar';
    bar.className = 'glass prep-toolbar';
    if(S.prepAnnotate){
        bar.innerHTML =
            '<div class="tool-indicator" id="prep-indicator"></div>' +
            '<button class="tool-btn active" data-tool="pen"><i class="fas fa-pen"></i><span>批注</span></button>' +
            '<button class="tool-btn" data-tool="eraser"><i class="fas fa-eraser"></i><span>橡皮</span></button>' +
            '<button class="tool-btn" data-tool="undo"><i class="fas fa-undo"></i><span>撤销</span></button>' +
            '<button class="tool-btn" data-tool="clear-ink"><i class="fas fa-trash-alt"></i><span>清空</span></button>' +
            '<button class="tool-btn" data-tool="present"><i class="fas fa-play"></i><span>放映</span></button>' +
            '<button class="tool-btn" data-tool="export"><i class="fas fa-file-export"></i><span>导出</span></button>' +
            '<button class="tool-btn" data-tool="edit"><i class="fas fa-edit"></i><span>返回备课</span></button>' +
            '<button class="tool-btn" data-tool="back"><i class="fas fa-times"></i><span>关闭</span></button>';
    } else {
        bar.innerHTML =
            '<div class="tool-indicator" id="prep-indicator"></div>' +
            '<button class="tool-btn active" data-tool="select"><i class="fas fa-arrow-pointer"></i><span>选择</span></button>' +
            '<button class="tool-btn" data-tool="shape"><i class="fas fa-shapes"></i><span>形状</span></button>' +
            '<button class="tool-btn" data-tool="text"><i class="fas fa-font"></i><span>文字</span></button>' +
            '<button class="tool-btn" data-tool="image"><i class="fas fa-image"></i><span>图片</span></button>' +
            '<button class="tool-btn" data-tool="order"><i class="fas fa-layer-group"></i><span>顺序</span></button>' +
            '<button class="tool-btn" data-tool="present"><i class="fas fa-play"></i><span>放映</span></button>' +
            '<button class="tool-btn" data-tool="export"><i class="fas fa-file-export"></i><span>导出</span></button>' +
            '<button class="tool-btn" data-tool="back"><i class="fas fa-rotate-left"></i><span>返回</span></button>';
    }
    document.getElementById('app').appendChild(bar);
    bar.querySelectorAll('.tool-btn').forEach(function(btn){
        btn.addEventListener('click', function(e){ e.stopPropagation(); onPrepToolBtn(btn.dataset.tool, btn); });
    });
    D.prepToolbar = bar;
    D.prepIndicator = bar.querySelector('#prep-indicator');
    requestAnimationFrame(positionIndicator);
}

function onPrepToolBtn(tool, btn){
    if(tool === 'pen'){
        if(S.prepTool === 'pen'){ openSubmenu(btn, penSubmenuHTML()); bindPenSubmenu(); }
        else { closeSubmenu(); setPrepTool('pen'); }
        return;
    }
    if(tool === 'eraser'){
        if(S.prepTool === 'eraser'){
            openSubmenu(btn, '<div class="pen-slider-wrap"><label>橡皮大小: '+S.eraserSize+'px</label>' +
                '<input type="range" class="pen-slider" id="prep-eraser" min="12" max="180" value="'+S.eraserSize+'"></div>');
            var sl = D.submenu.querySelector('#prep-eraser');
            if(sl) sl.oninput = function(){ S.eraserSize = +sl.value; sl.previousElementSibling.textContent = '橡皮大小: '+S.eraserSize+'px'; };
        } else { closeSubmenu(); setPrepTool('eraser'); }
        return;
    }
    if(tool === 'undo'){ undo(); return; }
    if(tool === 'clear-ink'){
        var pg2 = prepPage();
        if(!pg2 || !(pg2.ink && pg2.ink.length)){ toast('这一页还没有批注','fa-eraser'); return; }
        openModal({
            title:'清除本页批注',
            content:'<div style="font-size:14px;color:#666;text-align:left">将删除这一页的所有批注笔迹，课件内容不受影响。</div>',
            actions:[
                { id:'cancel', label:'取消', type:'cancel' },
                { id:'ok', label:'清除', type:'confirm', callback:function(ov){
                    closeModal(ov);
                    pg2.ink = [];
                    resetHistory();
                    redraw();
                    updatePageThumbnails();
                    toast('已清除本页批注','fa-check');
                }}
            ]
        });
        return;
    }
    if(tool === 'select'){ setPrepTool('select'); return; }
    if(tool === 'shape'){ openPrepShapeMenu(btn); return; }
    if(tool === 'text'){ setPrepTool('text'); openPrepTextMenu(btn); return; }
    if(tool === 'image'){ D.filePrepImage.value=''; D.filePrepImage.click(); return; }
    if(tool === 'order'){ openOrderPanel(); return; }
    if(tool === 'present'){ startPresent(S.prepIdx); return; }
    if(tool === 'export'){ exportCourseware(); return; }
    if(tool === 'edit'){ setPrepAnnotate(false); return; }
    if(tool === 'back'){
        if(S.prepAnnotate){ confirmCloseCourseware(); }
        else exitPrep();
        return;
    }
}

function confirmCloseCourseware(){
    openModal({
        title:'关闭课件',
        content:'<div style="font-size:14px;color:#666;text-align:left">关闭后回到白板。批注不会自动保存，需要保留请先「导出」。</div>',
        actions:[
            { id:'cancel', label:'继续批注', type:'cancel' },
            { id:'ok', label:'关闭', type:'confirm', callback:function(ov){
                closeModal(ov);
                S.prepAnnotate = false;
                document.body.classList.remove('prep-annotate');
                exitPrep();
            }}
        ]
    });
}

/* 在“只读批注”和“可编辑备课”之间切换 */
function inkColorForBg(bg){
    var hex = String(bg || '#ffffff').replace('#','');
    if(hex.length === 3) hex = hex.split('').map(function(c){ return c+c; }).join('');
    var r = parseInt(hex.substr(0,2),16) || 0;
    var g = parseInt(hex.substr(2,2),16) || 0;
    var b = parseInt(hex.substr(4,2),16) || 0;
    var lum = 0.299*r + 0.587*g + 0.114*b;
    return lum > 140 ? '#1b1b1b' : '#ffffff';
}
function autoInkColor(){
    var pg = prepPage();
    if(!pg) return;
    if(S.penColor === '#ffffff' || S.penColor === '#1b1b1b'){
        S.penColor = inkColorForBg(pg.bg);
    }
}

function setPrepAnnotate(on){
    S.prepAnnotate = !!on;
    document.body.classList.toggle('prep-annotate', S.prepAnnotate);
    if(S.prepAnnotate){
        autoInkColor();
        S.prepSel = null;
        setPrepTool('pen');
        document.body.classList.remove('prep-placing');
        var pr = document.getElementById('prep-sel');
        if(pr) pr.style.display = 'none';
        var pp = document.getElementById('prep-props');
        if(pp) pp.classList.remove('open');
    } else {
        S.tool = 'pen';
        resetHistory();
        toast('已进入编辑模式，可以修改课件内容','fa-edit');
    }
    buildPrepToolbar();
    setPrepTool(S.prepAnnotate ? 'pen' : 'select');
    var lbl = $('menu-prep-label');
    if(lbl) lbl.textContent = S.prepAnnotate ? '返回备课（编辑）' : '退出备课';
    positionIndicator();
    updateBg();
    redraw();
    updatePageThumbnails();
}

function setPrepTool(tool){
    if(S.touches && S.touches.size && S.tool !== tool) abortTouches();
    S.prepTool = tool;
    var bar = D.prepToolbar;
    if(bar){
        bar.querySelectorAll('.tool-btn').forEach(function(b){
            b.classList.toggle('active', b.dataset.tool === tool);
        });
    }
    /* 批注态下，笔/橡皮接管画布手势 */
    if(S.prepAnnotate && (tool === 'pen' || tool === 'eraser')) S.tool = tool;
    if(!S.prepAnnotate && S.mode === 'prep') S.tool = 'pen';
    var canvasOn = (tool === 'shape' || tool === 'text');
    document.body.classList.toggle('prep-placing', canvasOn);
    if(tool === 'shape') toast('在页面上拖动绘制'+prepShapeName(S.prepShape),'fa-shapes');
    if(tool === 'text') toast('点击页面任意位置输入文字','fa-font');
    positionIndicator();
    requestAnimationFrame(positionIndicator);
}

function prepShapeName(k){
    for(var i=0;i<PREP_SHAPES.length;i++) if(PREP_SHAPES[i].k === k) return PREP_SHAPES[i].name;
    return '图形';
}

function prepFillPanelHtml(){
    return '<div class="prep-panel-title">填充</div><div class="prep-color">' +
        '<div class="prep-swatch-none" data-fill="none">无</div>' +
        PREP_COLORS.map(function(c){
            return '<div class="swatch '+(S.prepFillOn && c===S.prepFillColor?'active':'')+'" data-fill="'+c+'" style="background:'+c+';'+(c==='#ffffff'?'border:1px solid #bbb':'')+'"></div>';
        }).join('') + '</div>';
}
function prepStrokePanelHtml(){
    return '<div class="prep-panel-title">边框</div><div class="prep-color">' +
        '<div class="prep-swatch-none" data-stroke="none">无</div>' +
        PREP_COLORS.map(function(c){
            return '<div class="swatch '+(S.prepStrokeColor===c?'active':'')+'" data-stroke="'+c+'" style="background:'+c+';'+(c==='#ffffff'?'border:1px solid #bbb':'')+'"></div>';
        }).join('') + '</div>' +
        '<div class="pen-slider-wrap"><label>边框粗细: '+S.prepStrokeWidth+'px</label>' +
        '<input type="range" class="pen-slider" id="prep-stroke-w" min="0" max="14" value="'+S.prepStrokeWidth+'"></div>';
}
function refreshPrepShapeNode(el){
    if(!el) return;
    var node = document.querySelector('.prep-el[data-id="'+el.id+'"] svg');
    if(!node) return;
    node.setAttribute('viewBox', '0 0 '+Math.max(1,el.w)+' '+Math.max(1,el.h));
    var body = prepShapeBody(el);
    if(node.firstElementChild) node.removeChild(node.firstElementChild);
    node.insertAdjacentHTML('afterbegin', body);
}
function bindPrepFillPanel(scope){
    scope.querySelectorAll('[data-fill]').forEach(function(it){
        it.onclick = function(e){
            e.stopPropagation();
            var v = it.dataset.fill;
            if(v === 'none'){ S.prepFillOn = false; }
            else { S.prepFillOn = true; S.prepFillColor = v; }
            if(S.prepSel && S.prepSel.type === 'shape'){
                S.prepSel.fill = S.prepFillOn ? S.prepFillColor : 'none';
                refreshPrepShapeNode(S.prepSel);
            }
            scope.querySelectorAll('[data-fill]').forEach(function(o){ o.classList.remove('active'); });
            it.classList.add('active');
        };
    });
}
function bindPrepStrokePanel(scope){
    scope.querySelectorAll('[data-stroke]').forEach(function(it){
        it.onclick = function(e){
            e.stopPropagation();
            var v = it.dataset.stroke;
            S.prepStrokeColor = (v === 'none') ? 'none' : v;
            if(S.prepSel && S.prepSel.type === 'shape'){
                S.prepSel.stroke = S.prepStrokeColor;
                S.prepSel.strokeWidth = S.prepStrokeWidth;
                refreshPrepShapeNode(S.prepSel);
            }
            scope.querySelectorAll('[data-stroke]').forEach(function(o){ o.classList.remove('active'); });
            it.classList.add('active');
        };
    });
    var sl = scope.querySelector('#prep-stroke-w');
    if(sl) sl.oninput = function(){
        S.prepStrokeWidth = +sl.value;
        sl.previousElementSibling.textContent = '边框粗细: ' + S.prepStrokeWidth + 'px';
        if(S.prepSel && S.prepSel.type === 'shape'){
            S.prepSel.strokeWidth = S.prepStrokeWidth;
            refreshPrepShapeNode(S.prepSel);
        }
    };
}

function openPrepShapeMenu(btn, applyToSel){
    var applying = !!(applyToSel && S.prepSel && S.prepSel.type === 'shape');
    var html = '<div class="prep-panel-title">' + (applying ? '更换选中图形的形状' : '选择图形（选中后在页面上拖动绘制）') + '</div><div class="shape-grid">' +
        PREP_SHAPES.map(function(s){
            return '<div class="shape-item" data-k="'+s.k+'" style="'+(s.k===S.prepShape?'outline:2px solid #2DC360;':'')+'"><i class="fas '+s.icon+'"></i>'+s.name+'</div>';
        }).join('') + '</div>' +
        prepFillPanelHtml() + prepStrokePanelHtml();
    openSubmenu(btn, html);
    D.submenu.querySelectorAll('[data-k]').forEach(function(it){
        it.onclick = function(e){
            e.stopPropagation();
            S.prepShape = it.dataset.k;
            D.submenu.querySelectorAll('[data-k]').forEach(function(o){ o.style.outline='none'; });
            it.style.outline = '2px solid #2DC360';
            if(applying){
                applyPrepStyleToSelection();
                closeSubmenu();
                return;
            }
            setPrepTool('shape');
            closeSubmenu();
        };
    });
    bindPrepFillPanel(D.submenu);
    bindPrepStrokePanel(D.submenu);
}

function applyPrepStyleToSelection(){
    if(!S.prepSel || S.prepSel.type !== 'shape') return;
    S.prepSel.kind = S.prepShape;
    S.prepSel.fill = S.prepFillOn ? S.prepFillColor : 'none';
    S.prepSel.stroke = S.prepStrokeColor;
    S.prepSel.strokeWidth = S.prepStrokeWidth;
    renderPrep(); selectPrep(S.prepSel);
}

function openPrepTextMenu(btn){
    var html = '<div class="prep-panel-title">字号 ' + S.prepFontSize + 'px</div>' +
        '<input type="range" class="pen-slider" id="prep-font" min="10" max="140" value="'+S.prepFontSize+'">' +
        '<div class="prep-color" style="margin-top:8px">' +
            PREP_COLORS.map(function(c){ return '<div class="swatch '+(S.prepTextColor===c?'active':'')+'" data-tc="'+c+'" style="background:'+c+';'+(c==='#ffffff'?'border:1px solid #bbb':'')+'"></div>'; }).join('') +
        '</div>' +
        '<div class="prep-row">' +
            '<button class="prep-mini-btn '+(S.prepBold?'on':'')+'" id="prep-bold">加粗</button>' +
            '<button class="prep-mini-btn" id="prep-newtext">在页面添加文字</button>' +
        '</div>' +
        (S.prepSel && S.prepSel.type === 'text' ? '<div class="prep-row"><button class="prep-mini-btn" id="prep-edittext">编辑选中文字</button></div>' : '');
    openSubmenu(btn, html);
    var fs = D.submenu.querySelector('#prep-font');
    if(fs) fs.oninput = function(){
        S.prepFontSize = +fs.value;
        fs.previousElementSibling.textContent = '字号 ' + S.prepFontSize + 'px';
        if(S.prepSel && S.prepSel.type === 'text'){
            S.prepSel.fontSize = S.prepFontSize;
            var node = document.querySelector('.prep-el[data-id="'+S.prepSel.id+'"]');
            if(node) node.style.fontSize = S.prepFontSize + 'px';
            updatePrepSelection();
        }
    };
    D.submenu.querySelectorAll('[data-tc]').forEach(function(it){
        it.onclick = function(e){
            e.stopPropagation();
            S.prepTextColor = it.dataset.tc;
            if(S.prepSel && S.prepSel.type === 'text'){
                S.prepSel.color = S.prepTextColor;
                var node = document.querySelector('.prep-el[data-id="'+S.prepSel.id+'"]');
                if(node) node.style.color = S.prepTextColor;
            }
            D.submenu.querySelectorAll('[data-tc]').forEach(function(o){ o.classList.remove('active'); });
            it.classList.add('active');
        };
    });
    var b = D.submenu.querySelector('#prep-bold');
    if(b) b.onclick = function(e){
        e.stopPropagation();
        S.prepBold = !S.prepBold;
        b.classList.toggle('on', S.prepBold);
        if(S.prepSel && S.prepSel.type === 'text'){
            S.prepSel.bold = S.prepBold;
            var node = document.querySelector('.prep-el[data-id="'+S.prepSel.id+'"]');
            if(node) node.style.fontWeight = S.prepBold ? '800' : '400';
        }
    };
    var nt = D.submenu.querySelector('#prep-newtext');
    if(nt) nt.onclick = function(e){
        e.stopPropagation();
        closeSubmenu();
        setPrepTool('text');
    };
    var et = D.submenu.querySelector('#prep-edittext');
    if(et) et.onclick = function(e){ e.stopPropagation(); closeSubmenu(); editPrepText(S.prepSel); };
}

function editPrepText(el){
    if(!el) return;
    var ov = openModal({
        title:'编辑文字',
        content:'<div style="text-align:left">' +
            '<textarea id="prep-text-input" style="width:100%;height:150px;border:1.5px solid #e0e4e8;border-radius:12px;padding:12px;font-size:15px;line-height:1.6;font-family:inherit;outline:none;resize:none;color:#222;box-sizing:border-box;">'+escapeHtml(el.text||'')+'</textarea>' +
            '<div style="font-size:11px;color:#999;margin-top:8px;">支持换行，字号与颜色可在底栏「文字」中调整</div>' +
        '</div>',
        actions:[
            { id:'cancel', label:'取消', type:'cancel' },
            { id:'ok', label:'确定', type:'confirm', callback:function(o){
                var v = o.querySelector('#prep-text-input').value;
                el.text = v;
                closeModal(o);
                renderPrep();
                selectPrep(el);
            }}
        ]
    });
    var ta = ov.querySelector('#prep-text-input');
    if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

/* ---- 选中元素属性面板 ---- */
function ensurePrepProps(){
    var p = document.getElementById('prep-props');
    if(p) return p;
    p = document.createElement('div');
    p.id = 'prep-props';
    document.getElementById('app').appendChild(p);
    return p;
}
function renderPrepProps(){
    var p = ensurePrepProps();
    var el = S.prepSel;
    if(S.mode !== 'prep' || !el){ p.classList.remove('open'); p.innerHTML=''; return; }
    var html = '';
    if(el.type === 'shape'){
        html += '<span class="pp-label">'+prepShapeName(el.kind)+'</span>' +
            '<button class="prep-mini-btn" data-p="kind">换形状</button>' +
            '<button class="prep-mini-btn" data-p="fill">填充</button>' +
            '<button class="prep-mini-btn" data-p="stroke">边框</button>';
    } else if(el.type === 'text'){
        html += '<span class="pp-label">文字</span>' +
            '<button class="prep-mini-btn" data-p="edit">编辑</button>' +
            '<button class="prep-mini-btn" data-p="bold">'+(el.bold?'取消加粗':'加粗')+'</button>' +
            '<button class="prep-mini-btn" data-p="fontsize">字号</button>' +
            '<button class="prep-mini-btn" data-p="align">'+(el.align==='center'?'居中':(el.align==='right'?'右对齐':'左对齐'))+'</button>';
    } else if(el.type === 'image'){
        html += '<span class="pp-label">图片</span>' +
            '<button class="prep-mini-btn" data-p="replace">替换</button>';
    }
    html += '<button class="prep-mini-btn" data-p="order">顺序'+(el.order>0?(' '+el.order):'')+'</button>' +
        '<button class="prep-mini-btn" data-p="dup">复制</button>' +
        '<button class="prep-mini-btn pp-danger" data-p="del">删除</button>';
    p.innerHTML = html;
    p.classList.add('open');
    p.querySelectorAll('[data-p]').forEach(function(b){
        b.onclick = function(e){ e.stopPropagation(); onPrepPropAction(b.dataset.p, b); };
    });
}
function onPrepPropAction(act, btn){
    var el = S.prepSel;
    if(!el) return;
    if(act === 'del'){
        var pg = prepPage();
        var idx = pg.elements.indexOf(el);
        if(idx > -1) pg.elements.splice(idx, 1);
        S.prepSel = null;
        renderPrep();
        return;
    }
    if(act === 'dup'){
        var copy = JSON.parse(JSON.stringify(el));
        delete copy.id;
        copy.x += 24; copy.y += 24;
        addPrepElement(copy);
        return;
    }
    if(act === 'order'){ openOrderPanel(); return; }
    if(act === 'kind'){ openPrepShapeMenu(btn, true); return; }
    if(act === 'edit'){ editPrepText(el); return; }
    if(act === 'bold'){ el.bold = !el.bold; renderPrep(); selectPrep(el); return; }
    if(act === 'align'){
        el.align = el.align === 'center' ? 'right' : (el.align === 'right' ? 'left' : 'center');
        renderPrep(); selectPrep(el); return;
    }
    if(act === 'fontsize'){
        if(!btn) return;
        openSubmenu(btn, '<div class="prep-panel-title">字号 <span id="pp-fs-val">'+(el.fontSize||28)+'</span> px</div>' +
            '<input type="range" class="pen-slider" id="pp-fs" min="8" max="160" value="'+(el.fontSize||28)+'">');
        var sl = D.submenu.querySelector('#pp-fs');
        if(sl) sl.oninput = function(){
            el.fontSize = +sl.value;
            D.submenu.querySelector('#pp-fs-val').textContent = sl.value;
            var node = document.querySelector('.prep-el[data-id="'+el.id+'"]');
            if(node) node.style.fontSize = el.fontSize + 'px';
            updatePrepSelection();
        };
        return;
    }
    if(act === 'replace'){
        D.filePrepImage.value='';
        D.prepReplaceTarget = el;
        D.filePrepImage.click();
        return;
    }
    if(act === 'fill'){
        if(!btn) return;
        openSubmenu(btn, prepFillPanelHtml());
        bindPrepFillPanel(D.submenu);
        return;
    }
    if(act === 'stroke'){
        if(!btn) return;
        openSubmenu(btn, prepStrokePanelHtml());
        bindPrepStrokePanel(D.submenu);
        return;
    }
}

/* ---- 出现顺序 ---- */
function openOrderPanel(){
    var pg = prepPage();
    if(!pg) return;
    if(!pg.elements.length){ toast('当前页还没有元素','fa-exclamation-triangle'); return; }

    var ov = openModal({
        title:'元素出现顺序',
        content:'<div id="ord-box"></div>',
        actions:[{ id:'close', label:'完成', type:'confirm', callback:function(o){ closeModal(o); renderPrep(); } }]
    });
    var box = ov.querySelector('#ord-box');

    /* 显示顺序：已设顺序的按 order 升序在前，未设的按图层顺序排后面 */
    function seqList(){
        var withO = pg.elements.filter(function(e){ return e.order > 0; })
            .sort(function(a,b){ return a.order - b.order; });
        var noO = pg.elements.filter(function(e){ return !(e.order > 0); });
        return withO.concat(noO);
    }
    function renumber(list){ list.forEach(function(el, i){ el.order = i + 1; }); }

    function render(){
        var list = seqList();
        var html = '<div class="ord-tip">从上到下就是放映时的出现先后。点 ↑ ↓ 直接调顺序；不设置则全部直接显示。</div>' +
            '<div class="prep-list">';
        list.forEach(function(el, i){
            var nm = el.type === 'text' ? ('文字：' + (el.text||'（空）').replace(/\n/g,' ').slice(0,12)) :
                     (el.type === 'image' ? '图片' : (prepShapeName(el.kind) + '图形'));
            html += '<div class="prep-item" data-id="'+el.id+'">' +
                '<span class="ord '+(el.order>0?'on':'')+'">'+(el.order>0?el.order:'–')+'</span>' +
                '<span class="nm">'+escapeHtml(nm)+'</span>' +
                '<button class="mv" data-act="up" '+(i===0?'disabled':'')+'><i class="fas fa-chevron-up"></i></button>' +
                '<button class="mv" data-act="down" '+(i===list.length-1?'disabled':'')+'><i class="fas fa-chevron-down"></i></button>' +
            '</div>';
        });
        html += '</div>' +
            '<div class="ord-actions">' +
                '<button class="prep-mini-btn" data-act="enable">按列表顺序编号</button>' +
                '<button class="prep-mini-btn" data-act="clear">全部常显</button>' +
            '</div>';
        box.innerHTML = html;

        box.querySelectorAll('.prep-item').forEach(function(row){
            row.querySelectorAll('[data-act]').forEach(function(btn){
                btn.onclick = function(e){
                    e.stopPropagation();
                    var l = seqList();
                    var i = l.findIndex ? l.findIndex(function(x){ return x.id === row.dataset.id; })
                                        : (function(){ for(var k=0;k<l.length;k++) if(l[k].id===row.dataset.id) return k; return -1; })();
                    if(i < 0) return;
                    var j = btn.dataset.act === 'up' ? i-1 : i+1;
                    if(j < 0 || j >= l.length) return;
                    var tmp = l[i]; l[i] = l[j]; l[j] = tmp;
                    renumber(l);      /* 手动调整后统一从 1 连续编号，避免出现重复/空号 */
                    render();
                };
            });
        });
        var en = box.querySelector('[data-act="enable"]');
        if(en) en.onclick = function(){ renumber(seqList()); render(); };
        var cl = box.querySelector('[data-act="clear"]');
        if(cl) cl.onclick = function(){ pg.elements.forEach(function(e){ e.order = 0; }); render(); };
    }
    render();
}




/* ================= 模式切换：备课 / 文件 / 放映 ================= */

function enterPrep(){
    if(S.mode === 'prep'){ exitPrep(); return; }
    if(S.mode === 'present') exitPresent();
    if(S.mode === 'ppt' || S.mode === 'doc') exitFileMode(true);
    if(!S.prep) S.prep = newPrepDoc(CW, CH);
    S.mode = 'prep';
    S.prepIdx = Math.min(S.prepIdx || 0, S.prep.pages.length - 1);
    S.prepSel = null;
    S.prepTool = 'select';
    S.prepAnnotate = false;
    document.body.classList.remove('prep-annotate');
    document.body.classList.add('prep-mode');
    document.body.classList.remove('ppt-mode','doc-mode');
    document.body.classList.remove('prep-placing');
    $('menu-exit-ppt').classList.add('hidden');
    $('menu-prep-label').textContent = '退出备课';
    buildPrepToolbar();
    updateBg();
    updatePageInd();
    setPrepTool('select');
    updatePageThumbnails();
    toast('已进入备课模式','fa-archive');
}

function exitPrep(){
    if(S.mode !== 'prep') return;
    S.prepSel = null;
    S.prepDrag = null;
    S.prepAnnotate = false;
    document.body.classList.remove('prep-annotate');
    S.mode = 'whiteboard';
    S.tool = 'pen';
    document.body.classList.remove('prep-mode','prep-placing');
    var p = document.getElementById('prep-props');
    if(p) p.classList.remove('open');
    $('menu-prep-label').textContent = '返回备课';
    closeSubmenu();
    updateBg(); redraw(); updatePageInd(); updatePageThumbnails(); setActiveToolUI();
    toast('已返回白板','fa-check');
}

function exitPrepSilent(){
    S.prepSel = null;
    S.prepDrag = null;
    document.body.classList.remove('prep-mode','prep-placing','prep-annotate');
    var p = document.getElementById('prep-props');
    if(p) p.classList.remove('open');
    var lbl = $('menu-prep-label');
    if(lbl) lbl.textContent = '返回备课';
}

function exitFileMode(silent){
    if(S.cameraStream) stopCamera();
    S.mode = 'whiteboard';
    S.ppt = null;
    S.doc = null;
    document.body.classList.remove('ppt-mode','doc-mode');
    $('menu-exit-ppt').classList.add('hidden');
    updatePptUi(false);
    if(!silent){
        updateBg(); redraw(); updatePageInd(); updatePageThumbnails();
        toast('已返回白板','fa-check');
    }
}
function exitPPT(){ exitFileMode(false); }

/* ================= 放映 ================= */
function startPresent(startIdx){
    if(!S.prep || !S.prep.pages.length) return;
    if(S.mode === 'prep'){ S.prepSel = null; updatePrepSelection(); }
    S.present = { pg: startIdx || 0, step: 0, maxStep: 0 };
    D.presentLayer.classList.add('on');
    renderPresentPage();
}
function renderPresentPage(){
    if(!S.present) return;
    var st = D.presentStage;
    var pg = S.prep.pages[S.present.pg];
    if(!pg) return;
    st.innerHTML = '';
    st.style.width = S.prep.w + 'px';
    st.style.height = S.prep.h + 'px';
    st.style.background = pg.bg || '#ffffff';
    var maxOrder = 0;
    pg.elements.forEach(function(el){
        var node = mkPrepNode(el);
        node.classList.add('present-el');
        node.classList.remove('prep-el');
        var chip = node.querySelector('.prep-order-chip');
        if(chip) chip.remove();
        if(el.order > 0 && el.order > S.present.step) node.classList.add('hiddenstep');
        st.appendChild(node);
        if(el.order > maxOrder) maxOrder = el.order;
    });
    /* 叠加批注笔迹 */
    if(pg.ink && pg.ink.length){
        var icv = document.createElement('canvas');
        icv.width = Math.max(1, Math.round(S.prep.w));
        icv.height = Math.max(1, Math.round(S.prep.h));
        icv.className = 'present-ink';
        var ic = icv.getContext('2d');
        ic.setTransform(1,0,0,1,0,0);
        ic.lineJoin = 'round'; ic.lineCap = 'round';
        pg.ink.forEach(function(st){
            ic.save();
            ic.globalCompositeOperation = (st.type === 'eraser') ? 'destination-out' : 'source-over';
            paintOne(ic, st);
            ic.restore();
        });
        st.appendChild(icv);
    }
    S.present.maxStep = maxOrder;
    var sc = Math.min(CW / S.prep.w, CH / S.prep.h);
    st.style.transform = 'translate(-50%,-50%) scale(' + sc + ')';
    D.presentInd.textContent = (S.present.pg+1) + ' / ' + S.prep.pages.length + (maxOrder ? ('  ·  ' + Math.min(S.present.step, maxOrder) + '/' + maxOrder) : '');
}
function presentNext(){
    if(!S.present) return;
    if(S.present.step < S.present.maxStep){ S.present.step++; renderPresentPage(); return; }
    if(S.present.pg < S.prep.pages.length - 1){
        S.present.pg++; S.present.step = 0; renderPresentPage();
    } else {
        toast('已经是最后一页','fa-flag-checkered');
    }
}
function presentPrev(){
    if(!S.present) return;
    if(S.present.step > 0){ S.present.step--; renderPresentPage(); return; }
    if(S.present.pg > 0){
        S.present.pg--; S.present.step = 0;
        var pg = S.prep.pages[S.present.pg];
        var mx = 0;
        pg.elements.forEach(function(el){ if(el.order > mx) mx = el.order; });
        S.present.step = mx;
        renderPresentPage();
    }
}
function exitPresent(){
    D.presentLayer.classList.remove('on');
    S.present = null;
    if(S.mode === 'prep') updatePrepSelection();
}
D.presentLayer.addEventListener('click', function(e){
    if(e.target.closest('.present-hud')) return;
    presentNext();
});
$('present-next').onclick = function(e){ e.stopPropagation(); presentNext(); };
$('present-prev').onclick = function(e){ e.stopPropagation(); presentPrev(); };
$('present-exit').onclick = function(e){ e.stopPropagation(); exitPresent(); };

/* ================= 课件导出 / 打开 ================= */
function dataUrlToBase64(src){
    var i = String(src).indexOf(',');
    return i > -1 ? String(src).slice(i+1) : '';
}
function buildPageXml(pg, pageIndex, imgResolver){
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n';
    s += '<page index="'+(pageIndex+1)+'" width="'+S.prep.w+'" height="'+S.prep.h+'" background="'+escapeXml(pg.bg||'#ffffff')+'">\n';
    (pg.elements||[]).forEach(function(el){
        var common = 'id="'+escapeXml(el.id)+'" type="'+el.type+'" x="'+Math.round(el.x)+'" y="'+Math.round(el.y)+'" w="'+Math.round(el.w)+'" h="'+Math.round(el.h)+'" order="'+(el.order||0)+'"';
        if(el.type === 'shape'){
            s += '  <element '+common+' kind="'+escapeXml(el.kind||'rect')+'" fill="'+escapeXml(el.fill||'none')+'" stroke="'+escapeXml(el.stroke||'none')+'" strokeWidth="'+(el.strokeWidth||0)+'"'+(el.lineHeight?(' lineHeight="'+el.lineHeight+'"'):'')+'/>\n';
        } else if(el.type === 'text'){
            s += '  <element '+common+' color="'+escapeXml(el.color||'#1b1b1b')+'" fontSize="'+(el.fontSize||28)+'" bold="'+(el.bold?1:0)+'" italic="'+(el.italic?1:0)+'" align="'+escapeXml(el.align||'left')+'" anchor="'+escapeXml(el.anchor||'top')+'" lineHeight="'+(el.lineHeight||1.35)+'"><text>'+escapeXml(el.text||'')+'</text></element>\n';
        } else if(el.type === 'image'){
            var src = imgResolver ? imgResolver(el) : '';
            s += '  <element '+common+' src="'+escapeXml(src)+'" name="'+escapeXml(el.name||'')+'"/>\n';
        }
    });
    var ink = pg.ink || [];
    if(ink.length){
        s += '  <annotations>\n';
        ink.forEach(function(st){
            s += '    <stroke type="'+escapeXml(st.type||'pen')+'" color="'+escapeXml(st.color||'#ffffff')+'" thickness="'+(Math.round((st.thickness||4)*100)/100)+'">';
            (st.points||[]).forEach(function(pt){
                var pr = (pt.pressure != null && !isNaN(pt.pressure)) ? Math.round(pt.pressure*100)/100 : 0.5;
                s += '<p x="'+(Math.round(pt.x*10)/10)+'" y="'+(Math.round(pt.y*10)/10)+'" pr="'+pr+'"/>';
            });
            s += '</stroke>\n';
        });
        s += '  </annotations>\n';
    }
    s += '</page>\n';
    return s;
}

function exportCourseware(){
    if(!S.prep){ toast('还没有可导出的课件','fa-exclamation-triangle'); return; }
    var zip = ZipKit.create();
    var imgMap = {}, imgCount = 0, pagePaths = [];
    function imgResolver(el){
        if(el.src && imgMap[el.src]) return imgMap[el.src];
        imgCount++;
        var name = 'src/img_' + imgCount + '.png';
        var b64 = dataUrlToBase64(el.src);
        if(b64){
            if(zip.__mini) zip.file(name, { base64: b64 });          // 内置 MiniZip
            else zip.file(name, b64, { base64: true });              // JSZip 三参写法
        }
        imgMap[el.src] = name;
        return name;
    }
    S.prep.pages.forEach(function(pg, i){
        var path = 'pages/page' + (i+1) + '.xml';
        zip.file(path, buildPageXml(pg, i, imgResolver));
        pagePaths.push({ path:path, name: pg.name || ('第 '+(i+1)+' 页') });
    });
    var course = '<?xml version="1.0" encoding="UTF-8"?>\n';
    course += '<course version="1.0" width="'+S.prep.w+'" height="'+S.prep.h+'" pages="'+S.prep.pages.length+'" title="'+escapeXml(S.prep.title||'未命名课件')+'" created="'+new Date().toISOString()+'">\n';
    pagePaths.forEach(function(p, i){
        course += '  <page file="'+escapeXml(p.path)+'" index="'+(i+1)+'" name="'+escapeXml(p.name)+'"/>\n';
    });
    course += '</course>\n';
    zip.file('course.xml', course);

    var fname = (S.prep.title || '课件').replace(/[\\/:*?"<>|]/g,'_') + '.pnbx';
    ZipKit.writeBlob(zip).then(function(blob){
        if(saveBlob(blob, fname)){
            toast('课件已导出（'+S.prep.pages.length+' 页）','fa-check');
        } else {
            openModal({ title:'导出失败', content:'当前环境不支持直接下载，请换用系统浏览器打开。', actions:[{id:'close',label:'知道了',type:'confirm'}] });
        }
    }).catch(function(err){
        toast('导出失败：' + (err.message || '未知错误'),'fa-exclamation-triangle');
    });
}

function attrOf(node, name, def){
    var v = node.getAttribute(name);
    return (v === null || v === undefined || v === '') ? def : v;
}
function importCourseware(file){
    toast('正在打开课件…','fa-spinner');
    ZipKit.read(file).then(function(z){
        var hasCourse = z.names.some(function(n){ return n.toLowerCase() === 'course.xml'; });
        if(!hasCourse){ throw new Error('缺少 course.xml，可能不是本程序导出的课件'); }
        return z.text('course.xml').then(function(xml){
            var doc = new DOMParser().parseFromString(xml, 'application/xml');
            if(doc.getElementsByTagName('parsererror').length) throw new Error('课件描述文件损坏');
            var root = doc.documentElement;
            var w = parseFloat(attrOf(root, 'width', '1280')) || 1280;
            var h = parseFloat(attrOf(root, 'height', '800')) || 800;
            var title = attrOf(root, 'title', '未命名课件');
            var pageNodes = Array.prototype.slice.call(root.getElementsByTagName('page'));
            var jobs = pageNodes.map(function(pn){
                var p = attrOf(pn, 'file', '');
                return z.text(p).then(function(pageXml){ return { xml: pageXml, name: attrOf(pn, 'name', '') }; });
            });
            return Promise.all(jobs).then(function(pages){
                var data = { title:title, w:w, h:h, pages:[], nextId:1 };
                pages.forEach(function(item, idx){
                    var pd = new DOMParser().parseFromString(item.xml, 'application/xml');
                    var proot = pd.documentElement;
                    var els = Array.prototype.slice.call(proot.getElementsByTagName('element'));
                    var out = [];
                    var imgJobs = [];
                    els.forEach(function(en){
                        var type = attrOf(en, 'type', 'shape');
                        var el = {
                            id: attrOf(en, 'id', 'e'+(idx+1)+'_'+out.length),
                            type: type,
                            x: parseFloat(attrOf(en, 'x', '0')) || 0,
                            y: parseFloat(attrOf(en, 'y', '0')) || 0,
                            w: parseFloat(attrOf(en, 'w', '100')) || 100,
                            h: parseFloat(attrOf(en, 'h', '100')) || 100,
                            order: parseInt(attrOf(en, 'order', '0'), 10) || 0
                        };
                        if(type === 'shape'){
                            el.kind = attrOf(en, 'kind', 'rect');
                            el.fill = attrOf(en, 'fill', 'none');
                            el.stroke = attrOf(en, 'stroke', 'none');
                            el.strokeWidth = parseFloat(attrOf(en, 'strokeWidth', '0')) || 0;
                        } else if(type === 'text'){
                            el.color = attrOf(en, 'color', '#1b1b1b');
                            el.fontSize = parseFloat(attrOf(en, 'fontSize', '28')) || 28;
                            el.bold = attrOf(en, 'bold', '0') === '1';
                            el.italic = attrOf(en, 'italic', '0') === '1';
                            el.align = attrOf(en, 'align', 'left');
                            el.anchor = attrOf(en, 'anchor', 'top');
                            el.lineHeight = parseFloat(attrOf(en, 'lineHeight', '1.35')) || 1.35;
                            var tn = en.getElementsByTagName('text')[0];
                            el.text = tn ? tn.textContent : '';
                        } else if(type === 'image'){
                            el.name = attrOf(en, 'name', '');
                            var srcPath = attrOf(en, 'src', '');
                            el.src = '';
                            if(srcPath){
                                imgJobs.push(z.base64(srcPath).then(function(b64){
                                    if(b64) el.src = 'data:' + mimeOf(srcPath) + ';base64,' + b64;
                                }));
                            }
                        }
                        out.push(el);
                    });
                    /* 批注笔迹 */
                    var inkArr = [];
                    var strokeNodes = proot.getElementsByTagName('stroke');
                    for(var si=0; si<strokeNodes.length; si++){
                        var sn = strokeNodes[si];
                        var pts = [];
                        var pNodes = sn.getElementsByTagName('p');
                        for(var pi=0; pi<pNodes.length; pi++){
                            pts.push({
                                x: parseFloat(attrOf(pNodes[pi], 'x', '0')) || 0,
                                y: parseFloat(attrOf(pNodes[pi], 'y', '0')) || 0,
                                pressure: parseFloat(attrOf(pNodes[pi], 'pr', '0.5'))
                            });
                        }
                        if(!pts.length) continue;
                        inkArr.push({
                            type: attrOf(sn, 'type', 'pen'),
                            color: attrOf(sn, 'color', '#ffffff'),
                            thickness: parseFloat(attrOf(sn, 'thickness', '4')) || 4,
                            points: pts
                        });
                    }
                    data.pages.push({ bg: attrOf(proot, 'background', '#ffffff'), elements: out, ink: inkArr, name: item.name || ('第 '+(idx+1)+' 页'), _jobs: imgJobs });
                });
                var allJobs = [];
                data.pages.forEach(function(p){ allJobs = allJobs.concat(p._jobs || []); });
                return Promise.all(allJobs).then(function(){
                    data.pages.forEach(function(p){ delete p._jobs; });
                    if(!data.pages.length) data.pages = [{ bg:'#ffffff', elements:[], name:'第 1 页' }];
                    // 修正 nextId 防止新增元素 id 冲突
                    var maxId = 0;
                    data.pages.forEach(function(p){
                        p.elements.forEach(function(el){
                            var m = /^e(\d+)$/.exec(el.id || '');
                            if(m) maxId = Math.max(maxId, parseInt(m[1],10));
                        });
                    });
                    data.nextId = maxId + 1;
                    return data;
                });
            });
        });
    }).then(function(data){
        exitPrepSilent();
        exitFileMode(true);
        S.prep = data;
        S.prepIdx = 0;
        S.prepSel = null;
        S.mode = 'prep';
        clearHistStacks();
        S.prepAnnotate = true;
        S.penColor = (function(){
            var bg0 = (data.pages[0] && data.pages[0].bg) || '#ffffff';
            var hex = String(bg0).replace('#','');
            if(hex.length === 3) hex = hex.split('').map(function(c){ return c+c; }).join('');
            var r = parseInt(hex.substr(0,2),16)||0, g = parseInt(hex.substr(2,2),16)||0, b = parseInt(hex.substr(4,2),16)||0;
            return (0.299*r + 0.587*g + 0.114*b) > 140 ? '#1b1b1b' : '#ffffff';
        })();
        document.body.classList.add('prep-mode','prep-annotate');
        $('menu-prep-label').textContent = '返回备课（编辑）';
        buildPrepToolbar();
        updateBg(); updatePageInd(); setPrepTool('pen'); updatePageThumbnails();
        resetHistory();
        redraw();
        toast('课件《'+data.title+'》已打开（'+(data.pages.length)+' 页），可直接批注','fa-check');
    }).catch(function(err){
        console.error(err);
        toast('打开课件失败：' + (err.message || '未知错误'),'fa-exclamation-triangle');
    });
}



/* ================= Word 文档 ================= */
function xlocal(node){ return (node.localName || node.nodeName.split(':').pop() || '').toLowerCase(); }
function xattr(node, name){
    if(!node || !node.getAttribute) return null;
    var v = node.getAttribute(name);
    if(v !== null) return v;
    var local = name.split(':').pop().toLowerCase();
    for(var i=0;i<node.attributes.length;i++){
        if((node.attributes[i].localName || '').toLowerCase() === local) return node.attributes[i].value;
    }
    return null;
}
function xchild(node, name){
    if(!node) return null;
    var ln = name.toLowerCase();
    for(var i=0;i<node.childNodes.length;i++){
        var c = node.childNodes[i];
        if(c.nodeType === 1 && xlocal(c) === ln) return c;
    }
    return null;
}
function xchildren(node, name){
    var out = [], ln = name.toLowerCase();
    if(!node) return out;
    for(var i=0;i<node.childNodes.length;i++){
        var c = node.childNodes[i];
        if(c.nodeType === 1 && xlocal(c) === ln) out.push(c);
    }
    return out;
}
function xfind(node, name){
    var ln = name.toLowerCase();
    var all = node.getElementsByTagName('*');
    for(var i=0;i<all.length;i++) if(xlocal(all[i]) === ln) return all[i];
    return null;
}

function importDocx(file){
    toast('正在解析 Word 文档…','fa-spinner');
    var t0 = Date.now();
    ZipKit.read(file).then(function(z){
        var docPath = null, relsPath = null;
        z.names.forEach(function(n){
            var l = n.toLowerCase();
            if(l === 'word/document.xml') docPath = n;
            if(l === 'word/_rels/document.xml.rels') relsPath = n;
        });
        if(!docPath) throw new Error('不是有效的 .docx 文件');
        var mediaNames = z.names.filter(function(n){ return /^word\/media\//i.test(n); }).slice(0, 80);

        return Promise.all([
            z.text(docPath),
            relsPath ? z.text(relsPath) : Promise.resolve(''),
            Promise.all(mediaNames.map(function(n){
                return z.base64(n).then(function(b64){ return { name:n, b64:b64 }; });
            }))
        ]).then(function(res){
            var xml = res[0], relsXml = res[1], mediaList = res[2];
            var mediaByPath = {};
            mediaList.forEach(function(m){
                mediaByPath[m.name.toLowerCase()] = 'data:' + mimeOf(m.name) + ';base64,' + m.b64;
            });
            var relMap = {};
            if(relsXml){
                var rdoc = new DOMParser().parseFromString(relsXml, 'application/xml');
                var rels = rdoc.getElementsByTagName('*');
                for(var i=0;i<rels.length;i++){
                    if(xlocal(rels[i]) !== 'relationship') continue;
                    var id = xattr(rels[i], 'Id');
                    var target = xattr(rels[i], 'Target') || '';
                    if(id && target && /media\//i.test(target)) relMap[id] = target.replace(/^\.?\//,'');
                }
            }
            var blocks = parseDocxBlocks(xml, mediaByPath, relMap);
            var W = 794, H = 1123;
            var pagesHtml = paginateDoc(blocks, W, H);
            var doc = {
                w: W, h: H,
                pages: pagesHtml.map(function(html, i){
                    return { html: html, name: '第 ' + (i+1) + ' 页' };
                })
            };
            exitPrepSilent();
            exitFileMode(true);
            S.doc = doc;
            S.docIdx = 0;
            S.mode = 'doc';
            S.selection.object = null;
            document.body.classList.add('doc-mode');
            document.body.classList.remove('prep-mode','ppt-mode');
            $('menu-exit-ppt').classList.remove('hidden');
            updateBg(); updatePageInd(); updatePageThumbnails();
            toast('Word 已打开：'+doc.pages.length+' 页（'+(Date.now()-t0)+'ms）','fa-check');
        });
    }).catch(function(err){
        console.error(err);
        toast('Word 解析失败：' + (err.message || '未知错误'),'fa-exclamation-triangle');
    });
}

function parseDocxBlocks(xml, mediaByPath, relMap){
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var body = xfind(doc, 'body') || doc.documentElement;
    var blocks = [];

    function runInfo(r){
        var rPr = xchild(r, 'rPr');
        var info = { bold:false, italic:false, underline:false, size:0, color:'' };
        if(rPr){
            var b = xchild(rPr, 'b');
            if(b && xattr(b, 'w:val') !== '0' && xattr(b,'val') !== '0') info.bold = true;
            if(xchild(rPr, 'i')) info.italic = true;
            if(xchild(rPr, 'u')) info.underline = true;
            var sz = xchild(rPr, 'sz');
            if(sz){ var sv = parseFloat(xattr(sz,'w:val') || xattr(sz,'val') || '0'); if(sv > 0) info.size = sv / 2; }
            var c = xchild(rPr, 'color');
            if(c){ var cv = xattr(c,'w:val') || xattr(c,'val'); if(cv && cv !== 'auto') info.color = '#' + cv; }
        }
        return info;
    }
    function wrap(text, info){
        if(!text) return '';
        var t = escapeHtml(text).replace(/\n/g, '<br>');
        var st = [];
        if(info.size) st.push('font-size:' + info.size + 'px');
        if(info.color) st.push('color:' + info.color);
        if(info.bold) t = '<strong>'+t+'</strong>';
        if(info.italic) t = '<em>'+t+'</em>';
        if(info.underline) t = '<span style="text-decoration:underline">'+t+'</span>';
        return st.length ? '<span style="'+st.join(';')+'">'+t+'</span>' : t;
    }
    function imgFromDrawing(node){
        var blip = xfind(node, 'blip');
        if(!blip) return '';
        var rid = xattr(blip, 'r:embed') || xattr(blip, 'embed');
        var target = rid ? relMap[rid] : '';
        if(!target) return '';
        var url = mediaByPath[target.toLowerCase()] || mediaByPath[('word/'+target).toLowerCase()];
        if(!url) return '';
        return '<img src="'+url+'" alt="">';
    }

    function paraHtml(p){
        var pPr = xchild(p, 'pPr');
        var tag = 'p', styleParts = [], bullet = false;
        if(pPr){
            var st = xchild(pPr, 'pStyle');
            var stv = st ? (xattr(st,'w:val') || xattr(st,'val') || '') : '';
            if(/ListBullet|List Paragraph|ListBullet2/i.test(stv) || xchild(pPr, 'numPr')) bullet = true;
            if(/^(heading|标题)\s*1$/i.test(stv) || /^Heading1$/.test(stv)) tag = 'h1';
            else if(/Heading2$/i.test(stv)) tag = 'h2';
            else if(/Heading3$/i.test(stv)) tag = 'h3';
            else if(/Title$/i.test(stv)) tag = 'h1';
            var jc = xchild(pPr, 'jc');
            if(jc){
                var jv = xattr(jc,'w:val') || xattr(jc,'val');
                if(jv === 'center') styleParts.push('text-align:center');
                else if(jv === 'right') styleParts.push('text-align:right');
                else if(jv === 'both') styleParts.push('text-align:justify');
            }
            if(xchild(pPr, 'numPr')){
                // 简单列表前缀
            }
        }
        var inner = '';
        var hasImg = false;
        (function walk(node){
            var kids = node.childNodes;
            for(var i=0;i<kids.length;i++){
                var c = kids[i];
                if(c.nodeType !== 1) continue;
                var ln = xlocal(c);
                if(ln === 'r'){
                    var info = runInfo(c);
                    var buf = '';
                    for(var k=0;k<c.childNodes.length;k++){
                        var cc = c.childNodes[k];
                        if(cc.nodeType !== 1) continue;
                        var cl = xlocal(cc);
                        if(cl === 't') buf += cc.textContent || '';
                        else if(cl === 'br') buf += '\n';
                        else if(cl === 'tab') buf += ' ';
                        else if(cl === 'drawing' || cl === 'pict'){
                            var im = imgFromDrawing(cc);
                            if(im){ inner += im; hasImg = true; }
                        }
                    }
                    inner += wrap(buf, info);
                } else if(ln === 'hyperlink' || ln === 'smartTag' || ln === 'ins' || ln === 'del'){
                    walk(c);
                } else if(ln === 'drawing' || ln === 'pict'){
                    var im2 = imgFromDrawing(c);
                    if(im2){ inner += im2; hasImg = true; }
                }
            }
        })(p);

        if(!inner.trim() && !hasImg) return { html:'', text:'' };
        if(bullet) inner = '<span style="color:#2DC360;margin-right:6px">●</span>' + inner;
        var style = styleParts.length ? ' style="'+styleParts.join(';')+'"' : '';
        if(bullet) style = ' style="' + styleParts.concat(['padding-left:18px','text-indent:-14px']).join(';') + '"';
        return { html: '<'+tag+style+'>' + inner + '</'+tag+'>', text: p.textContent || '', tag: tag, hasImg: hasImg };
    }

    function tableHtml(tbl){
        var rows = [], trs = tbl.getElementsByTagName('*');
        var out = '<table>';
        for(var i=0;i<trs.length;i++){
            if(xlocal(trs[i]) !== 'tr') continue;
            var cells = xchildren(trs[i], 'tc');
            var tr = '<tr>';
            for(var j=0;j<cells.length;j++){
                var ps = xchildren(cells[j], 'p');
                var txt = '';
                for(var k=0;k<ps.length;k++){
                    var ph = paraHtml(ps[k]);
                    txt += ph.html || '';
                }
                var span = xchild(cells[j], 'tcPr');
                var spanV = 1;
                if(span){
                    var gs = xchild(span, 'gridSpan');
                    if(gs) spanV = parseInt(xattr(gs,'w:val') || xattr(gs,'val') || '1', 10) || 1;
                }
                tr += '<td' + (spanV > 1 ? ' colspan="'+spanV+'"' : '') + '>' + (txt || '&nbsp;') + '</td>';
            }
            tr += '</tr>';
            rows.push(tr);
        }
        out += rows.join('') + '</table>';
        return out;
    }

    (function collect(parent){
        var kids = parent.childNodes;
        for(var i=0;i<kids.length;i++){
            var n = kids[i];
            if(n.nodeType !== 1) continue;
            var ln = xlocal(n);
            if(ln === 'p'){
                var ph = paraHtml(n);
                if(!ph.html) continue;
                blocks.push({
                    html: ph.html,
                    text: ph.text,
                    tag: ph.tag,
                    hasImg: ph.hasImg
                });
            } else if(ln === 'tbl'){
                blocks.push({ html: tableHtml(n), text: '', tag: 'table', hasImg: true });
            } else if(ln === 'sdt'){
                var content = xchild(n, 'sdtContent');
                if(content) collect(content);
            }
        }
    })(body);
    return blocks;
}

function paginateDoc(blocks, W, H){
    var padX = 54, padY = 48;
    var box = document.createElement('div');
    box.className = 'doc-page';
    box.style.cssText = 'position:fixed;left:-30000px;top:0;width:'+W+'px;height:auto;padding:'+padY+'px '+padX+'px;box-sizing:border-box;visibility:hidden;';
    document.body.appendChild(box);
    function measure(html){
        box.innerHTML = '<div style="display:flow-root">' + html + '</div>';
        return box.firstChild ? box.firstChild.offsetHeight : 0;
    }
    var avail = H - padY * 2;
    var pages = [], cur = '', curH = 0;
    function flush(){ if(cur){ pages.push(cur); } cur = ''; curH = 0; }

    function textBlockHtml(b, text){
        var style = '';
        return '<'+b.tag+style+'>' + escapeHtml(text).replace(/\n/g,'<br>') + '</'+b.tag+'>';
    }
    function splitBlock(b, text){
        var lo = 1, hi = text.length, best = 0;
        while(lo <= hi){
            var mid = (lo + hi) >> 1;
            if(measure(textBlockHtml(b, text.slice(0, mid))) <= avail){ best = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return best;
    }

    blocks.forEach(function(b){
        var h = measure(b.html);
        if(curH + h <= avail){ cur += b.html; curH += h; return; }
        if(h > avail){
            flush();
            var splittable = (b.tag === 'p' || b.tag === 'h1' || b.tag === 'h2' || b.tag === 'h3') && !b.hasImg && b.text;
            if(!splittable){
                cur = '<div style="max-height:'+avail+'px;overflow:hidden">' + b.html + '</div>';
                flush();
                return;
            }
            var text = b.text;
            while(text){
                var n = splitBlock(b, text);
                if(n < 1){
                    cur = '<div style="max-height:'+avail+'px;overflow:hidden">' + textBlockHtml(b, text) + '</div>';
                    flush();
                    break;
                }
                cur = textBlockHtml(b, text.slice(0, n));
                flush();
                text = text.slice(n).replace(/^\s+/, '');
            }
            return;
        }
        flush();
        cur = b.html; curH = h;
        if(curH >= avail){ flush(); }
    });
    flush();
    document.body.removeChild(box);
    return pages.length ? pages : [''];
}

function buildDocStage(){
    var vp = document.createElement('div');
    vp.className = 'doc-viewport';
    var stage = document.createElement('div');
    stage.className = 'doc-stage';
    stage.style.width = S.doc.w + 'px';
    stage.style.height = S.doc.h + 'px';
    var page = document.createElement('div');
    page.className = 'doc-page';
    var data = S.doc.pages[S.docIdx];
    page.innerHTML = data ? data.html : '';
    stage.appendChild(page);
    vp.appendChild(stage);
    D.bg.appendChild(vp);
    scaleStage();
}



/* ================= 通用工具：ZIP 读写 / 下载 / 形状几何 / Markdown ================= */

function saveBlob(blob, filename){
    try{
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 4000);
        return true;
    }catch(e){ return false; }
}

/* ---- 内置 ZIP（store 模式），JSZip 不可用时兜底，保证离线也能导出/打开课件 ---- */
var MiniZip = (function(){
    var TABLE = (function(){
        var t = new Uint32Array(256);
        for(var n=0;n<256;n++){
            var c = n;
            for(var k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(buf){
        var c = 0xFFFFFFFF;
        for(var i=0;i<buf.length;i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function utf8(str){
        if(window.TextEncoder) return new TextEncoder().encode(str);
        var s = unescape(encodeURIComponent(str));
        var a = new Uint8Array(s.length);
        for(var i=0;i<s.length;i++) a[i] = s.charCodeAt(i);
        return a;
    }
    function utf8Decode(u8){
        if(window.TextDecoder) return new TextDecoder('utf-8').decode(u8);
        var s = '';
        for(var i=0;i<u8.length;i++) s += String.fromCharCode(u8[i]);
        try{ return decodeURIComponent(escape(s)); }catch(e){ return s; }
    }
    function b64ToBytes(b64){
        var bin = atob(String(b64).replace(/\s/g,''));
        var a = new Uint8Array(bin.length);
        for(var i=0;i<a.length;i++) a[i] = bin.charCodeAt(i);
        return a;
    }
    function bytesToB64(u8){
        var s = '', CH = 0x8000;
        for(var i=0;i<u8.length;i+=CH) s += String.fromCharCode.apply(null, u8.subarray(i, i+CH));
        return btoa(s);
    }
    function toBytes(data){
        if(typeof data === 'string') return utf8(data);
        if(data instanceof Uint8Array) return data;
        if(data && data.base64) return b64ToBytes(data.base64);
        if(data instanceof ArrayBuffer) return new Uint8Array(data);
        return utf8(String(data == null ? '' : data));
    }

    function create(){
        var entries = [];
        return {
            __mini: true,
            file: function(name, data){ entries.push({ name:name, data:toBytes(data) }); return this; },
            generate: function(){
                var now = new Date();
                var dosTime = ((now.getHours()<<11) | (now.getMinutes()<<5) | (now.getSeconds()/2)) & 0xFFFF;
                var dosDate = (((now.getFullYear()-1980)<<9) | ((now.getMonth()+1)<<5) | now.getDate()) & 0xFFFF;
                var chunks = [], central = [], offset = 0;
                function u16(v){ return [v & 0xFF, (v>>8) & 0xFF]; }
                function u32(v){ return [v & 0xFF, (v>>8) & 0xFF, (v>>16) & 0xFF, (v>>24) & 0xFF]; }
                entries.forEach(function(en){
                    var nameBytes = utf8(en.name);
                    var crc = crc32(en.data);
                    var local = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0),
                        u16(dosTime), u16(dosDate), u32(crc), u32(en.data.length), u32(en.data.length),
                        u16(nameBytes.length), u16(0));
                    chunks.push(new Uint8Array(local), nameBytes, en.data);
                    central.push({ name:nameBytes, crc:crc, size:en.data.length, offset:offset });
                    offset += local.length + nameBytes.length + en.data.length;
                });
                var cdChunks = [], cdSize = 0;
                central.forEach(function(e){
                    var cd = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
                        u16(dosTime), u16(dosDate), u32(e.crc), u32(e.size), u32(e.size),
                        u16(e.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.offset));
                    cdChunks.push(new Uint8Array(cd), e.name);
                    cdSize += cd.length + e.name.length;
                });
                var eocd = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0),
                    u16(entries.length), u16(entries.length), u32(cdSize), u32(offset), u16(0)));
                var all = chunks.concat(cdChunks, [eocd]);
                var total = 0;
                all.forEach(function(c){ total += c.length; });
                var out = new Uint8Array(total), p = 0;
                all.forEach(function(c){ out.set(c, p); p += c.length; });
                return out;
            }
        };
    }

    function inflateRaw(u8){
        if(typeof DecompressionStream === 'undefined'){
            return Promise.reject(new Error('当前运行环境不支持解压缩，请联网后重试'));
        }
        try{
            var ds = new DecompressionStream('deflate-raw');
            var stream = new Blob([u8]).stream().pipeThrough(ds);
            return new Response(stream).arrayBuffer().then(function(buf){ return new Uint8Array(buf); });
        }catch(e){ return Promise.reject(e); }
    }

    function read(arrayBuffer){
        return new Promise(function(resolve, reject){
            try{
                var u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
                var view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
                var eocd = -1;
                for(var i=u8.length-22; i>=0 && i>u8.length-70000; i--){
                    if(view.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
                }
                if(eocd < 0){ reject(new Error('不是有效的 ZIP 文件')); return; }
                var count = view.getUint16(eocd+10, true);
                var cdOffset = view.getUint32(eocd+16, true);
                var entries = [];
                var p = cdOffset;
                for(var n=0;n<count;n++){
                    if(view.getUint32(p, true) !== 0x02014b50) break;
                    var method = view.getUint16(p+10, true);
                    var csize = view.getUint32(p+20, true);
                    var nameLen = view.getUint16(p+28, true);
                    var extraLen = view.getUint16(p+30, true);
                    var cmtLen = view.getUint16(p+32, true);
                    var localOff = view.getUint32(p+42, true);
                    var name = utf8Decode(u8.subarray(p+46, p+46+nameLen));
                    var lNameLen = view.getUint16(localOff+26, true);
                    var lExtraLen = view.getUint16(localOff+28, true);
                    var dataStart = localOff + 30 + lNameLen + lExtraLen;
                    entries.push({ name:name, method:method, raw:u8.subarray(dataStart, dataStart + csize) });
                    p += 46 + nameLen + extraLen + cmtLen;
                }
                Promise.all(entries.map(function(en){
                    if(en.method === 0) return Promise.resolve(en.raw);
                    if(en.method === 8) return inflateRaw(en.raw);
                    return Promise.reject(new Error('不支持的压缩方式：' + en.method));
                })).then(function(list){
                    var files = {};
                    entries.forEach(function(en, idx){ files[en.name] = list[idx]; });
                    resolve({
                        names: entries.map(function(e){ return e.name; }),
                        bytes: function(name){ return files[name] || null; },
                        text: function(name){ return files[name] ? utf8Decode(files[name]) : ''; },
                        base64: function(name){ return files[name] ? bytesToB64(files[name]) : ''; }
                    });
                }).catch(reject);
            }catch(e){ reject(e); }
        });
    }

    return { create:create, read:read, b64ToBytes:b64ToBytes, bytesToB64:bytesToB64 };
})();

/* 统一封装：优先使用 JSZip，缺失时用内置实现 */
var ZipKit = {
    available: true,
    create: function(){
        if(typeof JSZip !== 'undefined') return JSZip();
        return MiniZip.create();
    },
    writeBlob: function(zipObj, opts){
        return new Promise(function(resolve, reject){
            try{
                if(typeof zipObj.generateAsync === 'function'){
                    zipObj.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{level:6} }).then(resolve, reject);
                } else {
                    resolve(new Blob([zipObj.generate()], { type:'application/zip' }));
                }
            }catch(e){ reject(e); }
        });
    },
    read: function(file){
        return new Promise(function(resolve, reject){
            var fr = new FileReader();
            fr.onload = function(){
                var buf = fr.result;
                if(typeof JSZip !== 'undefined'){
                    JSZip.loadAsync(buf).then(function(zip){
                        resolve({
                            zip: zip,
                            names: Object.keys(zip.files),
                            text: function(n){ var f = zip.file(n); return f ? f.async('string') : Promise.resolve(''); },
                            base64: function(n){ var f = zip.file(n); return f ? f.async('base64') : Promise.resolve(''); },
                            bytes: function(n){ var f = zip.file(n); return f ? f.async('uint8array') : Promise.resolve(null); }
                        });
                    }).catch(function(){
                        MiniZip.read(buf).then(function(z){ resolve(wrapMini(z)); }, reject);
                    });
                } else {
                    MiniZip.read(buf).then(function(z){ resolve(wrapMini(z)); }, reject);
                }
            };
            fr.onerror = function(){ reject(new Error('读取文件失败')); };
            fr.readAsArrayBuffer(file);
        });
        function wrapMini(z){
            return {
                zip:null,
                names:z.names,
                text:function(n){ return Promise.resolve(z.text(n)); },
                base64:function(n){ return Promise.resolve(z.base64(n)); },
                bytes:function(n){ return Promise.resolve(z.bytes(n)); }
            };
        }
    }
};

/* ---- 形状几何（备课 / 缩略图 / 演示共用） ---- */
function shapePolygon(kind, w, h){
    var p = [];
    var i, ang, r;
    if(kind === 'triangle') return [[w/2,0],[w,h],[0,h]];
    if(kind === 'rtTriangle') return [[0,0],[0,h],[w,h]];
    if(kind === 'diamond') return [[w/2,0],[w,h/2],[w/2,h],[0,h/2]];
    if(kind === 'pentagon' || kind === 'hexagon' || kind === 'octagon' ||
       kind === 'star5' || kind === 'star6'){
        var sides = { pentagon:5, hexagon:6, octagon:8, star5:5, star6:6 }[kind];
        var star = kind.indexOf('star') === 0;
        var cx = w/2, cy = h/2, rx = w/2, ry = h/2;
        var total = star ? sides*2 : sides;
        for(i=0;i<total;i++){
            ang = -Math.PI/2 + i * (Math.PI*2/total);
            r = star && (i % 2) ? 0.46 : 1;
            p.push([cx + Math.cos(ang)*rx*r, cy + Math.sin(ang)*ry*r]);
        }
        return p;
    }
    if(kind === 'rightArrow'){
        return [[0,h*0.28],[w*0.62,h*0.28],[w*0.62,0],[w,h/2],[w*0.62,h],[w*0.62,h*0.72],[0,h*0.72]];
    }
    if(kind === 'arrowLeft'){
        return [[w,h*0.28],[w*0.38,h*0.28],[w*0.38,0],[0,h/2],[w*0.38,h],[w*0.38,h*0.72],[w,h*0.72]];
    }
    if(kind === 'chevron'){
        return [[0,0],[w*0.72,0],[w,h/2],[w*0.72,h],[0,h],[w*0.28,h/2]];
    }
    if(kind === 'parallelogram'){
        return [[w*0.22,0],[w,0],[w*0.78,h],[0,h]];
    }
    if(kind === 'trapezoid'){
        return [[w*0.2,0],[w*0.8,0],[w,h],[0,h]];
    }
    if(kind === 'cross'){
        return [[w*0.34,0],[w*0.66,0],[w*0.66,h*0.34],[w,h*0.34],[w,h*0.66],[w*0.66,h*0.66],[w*0.66,h],[w*0.34,h],[w*0.34,h*0.66],[0,h*0.66],[0,h*0.34],[w*0.34,h*0.34]];
    }
    return [[0,0],[w,0],[w,h],[0,h]];
}
function polygonPath(points, dx, dy, scale){
    var d = '';
    for(var i=0;i<points.length;i++){
        var x = (points[i][0] * (scale||1)) + (dx||0);
        var y = (points[i][1] * (scale||1)) + (dy||0);
        d += (i ? 'L' : 'M') + (Math.round(x*100)/100) + ' ' + (Math.round(y*100)/100) + ' ';
    }
    return d + 'Z';
}

/* ---- AI 回复里的公式：交给本地 MathJax 渲染成 SVG（支持 $..$ / $$..$$ / \(..\) / \[..\]） ---- */
function mathify(root){
    if(!root || !window.MathJax || typeof MathJax.tex2svg !== 'function') return;
    var RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]{1,600}?)\$/g;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    while((n = walker.nextNode())){
        var v = n.nodeValue || '';
        if(v.indexOf('$') < 0 && v.indexOf('\\(') < 0 && v.indexOf('\\[') < 0) continue;
        var p = n.parentNode;
        if(p && (p.tagName === 'CODE' || p.tagName === 'PRE')) continue;
        nodes.push(n);
    }
    nodes.forEach(function(node){
        var text = node.nodeValue;
        RE.lastIndex = 0;
        if(!RE.test(text)) return;
        RE.lastIndex = 0;
        var frag = document.createDocumentFragment();
        var last = 0, m;
        while((m = RE.exec(text))){
            if(m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            var tex = m[1] || m[2] || m[3] || m[4] || '';
            var display = !!(m[1] || m[2]);
            var span = document.createElement('span');
            span.className = 'md-math' + (display ? ' block' : '');
            var out = texToSvg(tex, display);
            if(out) span.appendChild(out);
            else span.textContent = m[0];
            frag.appendChild(span);
            last = m.index + m[0].length;
        }
        if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
    });
}

/* ---- 轻量 Markdown ---- */
function renderMarkdown(src){
    var text = String(src == null ? '' : src).replace(/\r\n?/g,'\n');
    var lines = text.split('\n');
    var out = [], i = 0;

    function inline(s){
        var t = escapeHtml(s);
        t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
        t = t.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        return t;
    }
    function isTableSep(s){
        return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
    }
    function splitRow(s){
        var t = s.trim();
        if(t.charAt(0) === '|') t = t.substring(1);
        if(t.charAt(t.length-1) === '|') t = t.substring(0, t.length-1);
        return t.split('|').map(function(c){ return c.trim(); });
    }

    while(i < lines.length){
        var line = lines[i];

        if(/^\s*```/.test(line)){
            var lang = line.replace(/^\s*```\s*/,'').trim();
            var buf = [];
            i++;
            while(i < lines.length && !/^\s*```/.test(lines[i])){ buf.push(lines[i]); i++; }
            i++;
            out.push('<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>');
            continue;
        }
        if(/^\s*$/.test(line)){ i++; continue; }

        var h = /^(#{1,6})\s+(.*)$/.exec(line);
        if(h){
            var lv = h[1].length;
            out.push('<h'+lv+'>'+inline(h[2].replace(/\s+#+\s*$/,''))+'</h'+lv+'>');
            i++; continue;
        }
        if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)){ out.push('<hr>'); i++; continue; }

        if(/^\s*\|/.test(line) && i+1 < lines.length && isTableSep(lines[i+1])){
            var head = splitRow(line);
            i += 2;
            var rows = [];
            while(i < lines.length && /^\s*\|/.test(lines[i])){ rows.push(splitRow(lines[i])); i++; }
            var th = '<tr>' + head.map(function(c){ return '<th>'+inline(c)+'</th>'; }).join('') + '</tr>';
            var tb = rows.map(function(r){
                return '<tr>' + r.map(function(c){ return '<td>'+inline(c)+'</td>'; }).join('') + '</tr>';
            }).join('');
            out.push('<div class="md-table-wrap"><table><thead>'+th+'</thead><tbody>'+tb+'</tbody></table></div>');
            continue;
        }
        if(/^\s*>\s?/.test(line)){
            var q = [];
            while(i < lines.length && /^\s*>\s?/.test(lines[i])){
                q.push(lines[i].replace(/^\s*>\s?/, ''));
                i++;
            }
            var paras = q.join('\n').split(/\n{2,}/).map(function(p){
                return '<p>' + inline(p).replace(/\n/g,'<br>') + '</p>';
            }).join('');
            out.push('<blockquote>'+paras+'</blockquote>');
            continue;
        }
        if(/^\s*[-*+]\s+/.test(line)){
            var items = [];
            while(i < lines.length && /^\s*[-*+]\s+/.test(lines[i])){
                items.push('<li>' + inline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>');
                i++;
            }
            out.push('<ul>'+items.join('')+'</ul>');
            continue;
        }
        if(/^\s*\d+[.)]\s+/.test(line)){
            var oitems = [];
            while(i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])){
                oitems.push('<li>' + inline(lines[i].replace(/^\s*\d+[.)]\s+/, '')) + '</li>');
                i++;
            }
            out.push('<ol>'+oitems.join('')+'</ol>');
            continue;
        }

        var para = [];
        while(i < lines.length && !/^\s*$/.test(lines[i]) &&
              !/^\s*(#{1,6})\s+/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) &&
              !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) &&
              !/^\s*\|/.test(lines[i]) && !/^\s*```/.test(lines[i])){
            para.push(lines[i]);
            i++;
        }
        if(!para.length){ i++; continue; }
        out.push('<p>' + inline(para.join('\n')).replace(/\n/g,'<br>') + '</p>');
    }
    return '<div class="md-body">' + out.join('') + '</div>';
}

/* ============================================================
   对外 API：新增的磁贴面板 / 课堂工具 / 学科工具全部通过 EN10 调用，
   不复制一份画布逻辑，保证笔迹、撤销、目录缩略图始终一致
   ============================================================ */
function insertImageEl(src, w, h, opts){
    opts = opts || {};
    var maxW = CW * 0.78, maxH = CH * 0.78;
    var scale = Math.min(maxW / (w || 1), maxH / (h || 1), 1);
    if(opts.scale) scale *= opts.scale;
    var iw = Math.max(40, (w || 400) * scale);
    var ih = Math.max(40, (h || 300) * scale);
    var nw = (typeof w === 'number' && w > 0) ? iw : CW * 0.5;
    var nh = (typeof h === 'number' && h > 0) ? ih : CH * 0.5;
    var img = new Image();
    img.onload = function(){ redraw(); };
    img.src = src;
    var el = {
        type:'image', img:img, src:src,
        x: opts.x != null ? opts.x : (CW - nw) / 2,
        y: opts.y != null ? opts.y : (CH - nh) / 2,
        w: nw, h: nh
    };
    getElements().push(el);
    redraw();
    pushHistory();
    if(!opts.silent) toast('已插入白板', 'fa-check');
    return el;
}

function aiChatRequest(messages, opts){
    opts = opts || {};
    var cfg = aiCfg();
    if(!cfg.key) return Promise.reject(new Error('还没有配置 API Key'));
    return fetch(aiEndpoint('chat'), {
        method:'POST',
        signal: opts.signal,
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + cfg.key },
        body: JSON.stringify(opts.rawBody || {
            model: cfg.model,
            messages: messages,
            temperature: opts.temperature != null ? opts.temperature : 0.7
        })
    }).then(function(res){
        return res.text().then(function(txt){
            if(!res.ok){
                var msg = 'HTTP ' + res.status;
                try{ var j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.type)) || msg; }catch(e){}
                throw new Error(msg);
            }
            var data = {};
            try{ data = JSON.parse(txt); }catch(e){ throw new Error('返回内容不是合法 JSON'); }
            var text = data && data.choices && data.choices[0] && data.choices[0].message
                ? (data.choices[0].message.content || '') : '';
            return { text: text, raw: data };
        });
    });
}

/* 圈选后「问 AI」：把选区图片挂到聊天输入框上方，可改问题后再发 */
function askImage(dataUrl, defaultQ){
    openAIChat();
    setTimeout(function(){
        if(!chatState.ov) return;
        var composer = chatState.ov.querySelector('.ai-composer');
        if(!composer) return;
        var old = chatState.ov.querySelector('#chat-attach');
        if(old) old.remove();
        var bar = document.createElement('div');
        bar.id = 'chat-attach';
        bar.className = 'chat-attach';
        bar.innerHTML = '<img src="' + dataUrl + '" alt="圈选">' +
            '<div class="chat-attach-meta"><b>已附加圈选内容</b><span>可以直接提问，或换一个说法</span></div>' +
            '<button class="chat-attach-x" title="移除"><i class="fas fa-times"></i></button>';
        composer.parentNode.insertBefore(bar, composer);
        bar.querySelector('.chat-attach-x').onclick = function(){
            chatState.pendingImage = null;
            bar.remove();
        };
        chatState.pendingImage = dataUrl;
        var ta = chatState.ov.querySelector('#chat-input');
        if(ta){
            if(!ta.value) ta.value = defaultQ || '请解释我圈出的这部分内容。';
            chatAutoGrow(ta);
            ta.focus();
            ta.select();
        }
    }, 320);
}

window.EN10 = {
    S: S, D: D, ctx: ctx,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    redraw: redraw,
    updateBg: updateBg,
    pushHistory: pushHistory,
    resetHistory: resetHistory,
    invalidateInk: invalidateInk,
    getElements: getElements,
    setElements: setElements,
    inkScale: inkScale,
    coords: coords,
    escapeHtml: escapeHtml,
    renderMarkdown: renderMarkdown,
    insertImage: insertImageEl,
    aiChat: aiChatRequest,
    aiCfg: aiCfg,
    aiEndpoint: aiEndpoint,
    applyCamView: applyCamView,
    resetCamView: resetCamView,
    currentBg: function(){ return getBg(); },
    openImage: function(){ D.fileImage.value=''; D.fileImage.click(); },
    openWeb: function(){ openWebExtModal(); },
    openEmbed: function(url, title){ openEmbedModal(url, title); },
    startShape: function(t){ startShapeDraw(t); },
    shapes: ['rect','circle','triangle'],
    openAIChat: openAIChat,
    askImage: askImage,
    setActiveTool: function(t){ clearSelectionAndSwitch(t); },
    closeSubmenu: closeSubmenu,
    cameraMode: function(){ return S.mode === 'camera'; },
    setApiKey: function(k){
        S.apiKey = k || '';
        try{
            if(k) localStorage.setItem('easinote_api_key', k);
            else localStorage.removeItem('easinote_api_key');
        }catch(e){}
    },
    saveSnapshot: function(){
        var tmp = document.createElement('canvas');
        tmp.width = D.canvas.width; tmp.height = D.canvas.height;
        var tc = tmp.getContext('2d');
        tc.fillStyle = getBg(); tc.fillRect(0,0,tmp.width,tmp.height);
        tc.drawImage(D.canvas, 0, 0);
        return tmp;
    }
};

function init(){
    applyZoom();
    resizeCanvas();
    updateBg();
    updatePageInd();
    resetHistory();
    /* 调试入口（不影响功能） */
    window.__EASI = { S:S, D:D, undo:undo, pushHistory:pushHistory, resetHistory:resetHistory, redraw:redraw,
                      applyZoom:applyZoom, resizeCanvas:resizeCanvas, invalidateInk:invalidateInk,
                      inkScale:inkScale, getElements:getElements, startAI:startAI, openAIChat:openAIChat };
    setActiveToolUI();
    checkNarrow();
    tick();
    S.clockTimer = setInterval(tick,1000);

    // Pointer Events 统一鼠标、触控笔和触屏输入，并利用浏览器合并采样点提升笔迹细腻度
    function pointerEnd(e){
        if(!e || e.__easiEnded) return;
        e.__easiEnded = true;
        /* 先收笔再释放捕获：释放可能触发 lostpointercapture，那时已没有待收的记录 */
        if(S.tool === 'shape') shapeUp();
        else onUp(e);
        if(S.activePtrs) S.activePtrs.delete(e.pointerId);
        try { D.canvas.releasePointerCapture(e.pointerId); } catch(err) {}
    }
    D.canvas.addEventListener('pointerdown', function(e){
        if(e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        if(S.activePtrs) S.activePtrs.add(e.pointerId);
        /* 同一个 pointerId 上次没收到 up：先丢掉残影再重开，避免新笔迹接在旧记录上 */
        if(S.touches.has(e.pointerId)) S.touches.delete(e.pointerId);
        try { D.canvas.setPointerCapture(e.pointerId); } catch(err) {}
        if(S.tool === 'shape') shapeDown(e);
        else onDown(e);
    });
    D.canvas.addEventListener('pointermove', function(e){
        /* 鼠标/触控笔已经离开但 up 事件丢了（个别 WebView）：这里补收笔，避免一笔永远糊在画布上。
           触摸不在这里判断：个别内核在触摸移动时把 buttons 报成 0，误判会把正常笔迹截断。 */
        if(S.touches.has(e.pointerId) && e.buttons === 0 && (e.pointerType === 'mouse' || e.pointerType === 'pen')){
            pointerEnd(e);
            return;
        }
        if(S.tool === 'shape') shapeMove(e);
        else onMove(e);
    });
    D.canvas.addEventListener('pointerup', pointerEnd);
    D.canvas.addEventListener('pointercancel', pointerEnd);
    D.canvas.addEventListener('lostpointercapture', pointerEnd);
    /* 捕获失效或指针在画布外抬起时的兜底（capture 阶段只会触发一次） */
    window.addEventListener('pointerup', function(e){
        if(e.target !== D.canvas && S.touches.has(e.pointerId)){
            onUp({ identifier:e.pointerId, clientX:e.clientX, clientY:e.clientY, pressure:e.pressure });
            if(S.activePtrs) S.activePtrs.delete(e.pointerId);
        }
    }, true);
    window.addEventListener('pointercancel', function(e){
        if(e.target !== D.canvas && S.touches.has(e.pointerId)){
            onUp({ identifier:e.pointerId, clientX:e.clientX, clientY:e.clientY, pressure:e.pressure });
            if(S.activePtrs) S.activePtrs.delete(e.pointerId);
        }
    }, true);
    /* 只投递 touch 事件的老内核：所有手指都离开时清空在写的笔迹 */
    window.addEventListener('touchend', function(e){
        if(e.touches && e.touches.length === 0 && S.touches.size) setTimeout(flushTouches, 60);
    }, { passive:true });
    window.addEventListener('touchcancel', function(){
        if(S.touches.size) flushTouches();
    }, { passive:true });
    window.addEventListener('blur', abortTouches);
    document.addEventListener('visibilitychange', function(){ if(document.hidden) abortTouches(); });
    /* 看门狗：6 秒没有采样更新说明 up 事件彻底丢了，收笔止损 */
    setInterval(function(){
        if(!S.touches.size) return;
        var now = (window.performance && performance.now) ? performance.now() : Date.now();
        var stale = [];
        S.touches.forEach(function(rec, id){ if(rec && (now - (rec.lastT || 0)) > 6000) stale.push(id); });
        if(!stale.length) return;
        var committed = false;
        stale.forEach(function(id){
            var rec = S.touches.get(id);
            if(rec && commitTouchRec(rec, null)) committed = true;
            S.touches.delete(id);
            if(S.activePtrs) S.activePtrs.delete(id);
        });
        if(committed){ invalidateInk(); pushHistory(); }
        D.cursor.style.display = 'none';
        redraw();
    }, 1000);

    window.addEventListener('resize', function(){
        resizeCanvas();
        checkNarrow();
        setActiveToolUI();
        positionIndicator();
        if(S.present) renderPresentPage();
    });
    window.addEventListener('orientationchange', function(){
        setTimeout(function(){ resizeCanvas(); checkNarrow(); positionIndicator(); if(S.present) renderPresentPage(); }, 260);
    });
    /* 工具栏缩放动画结束后重新对齐胶囊，避免过渡期间的中间态被当成最终位置 */
    D.toolbar.addEventListener('transitionend', positionIndicator);
    if(document.fonts && document.fonts.ready){
        document.fonts.ready.then(function(){ setTimeout(positionIndicator, 60); });
    }

    window.addEventListener('keydown', function(e){
        if(S.present){
            if(e.key === 'Escape'){ exitPresent(); return; }
            if(e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); presentNext(); return; }
            if(e.key === 'ArrowLeft' || e.key === 'PageUp'){ e.preventDefault(); presentPrev(); return; }
            return;
        }
        if(e.key === 'Escape'){
            var activeModal = D.modalRoot.querySelector('.modal-overlay.open');
            if(activeModal){ closeModal(activeModal); return; }
            if(D.leftMenu.classList.contains('open')) D.leftMenu.classList.remove('open');
            if(D.drawer.classList.contains('open')) closeDrawer();
            if(S.mode === 'prep' && S.prepSel) selectPrep(null);
        }
        if((e.key === 'Delete' || e.key === 'Backspace') && S.mode === 'prep' && S.prepSel){
            if(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
            e.preventDefault();
            onPrepPropAction('del');
            return;
        }
        if(S.mode === 'ppt' && (e.key === 'ArrowRight' || e.key === 'PageDown')){
            e.preventDefault(); $('btn-next-page').click();
        }
        if(S.mode === 'ppt' && (e.key === 'ArrowLeft' || e.key === 'PageUp')){
            e.preventDefault(); $('btn-prev-page').click();
        }
        if(S.mode === 'prep' && !S.prepSel){
            if(e.key === 'ArrowRight' || e.key === 'PageDown'){ e.preventDefault(); $('btn-next-page').click(); }
            if(e.key === 'ArrowLeft' || e.key === 'PageUp'){ e.preventDefault(); $('btn-prev-page').click(); }
        }
    });

    setTimeout(function(){ if(window.EN10Update) window.EN10Update.checkSilently(); }, 1400);
}

init();

})();