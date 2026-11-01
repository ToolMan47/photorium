/* Photorium 構圖相機：相機、即時分析、參考線、預覽與拍照 */
(function () {
  'use strict';
  const E = window.PhotoriumEngine;
  const $ = (id) => document.getElementById(id);
  const els = {
    stageWrap: $('stageWrap'), stage: $('stage'), view: $('view'), hint: $('hint'), srcTag: $('srcTag'),
    readout: $('readout'), camToggle: $('camToggle'), notice: $('notice'),
    modeAim: $('modeAim'), modeCrop: $('modeCrop'), chips: $('chips'),
    detailTitle: $('detailTitle'), reason: $('reason'), tips: $('tips'),
    fileIn: $('fileIn'), fileBtn: $('fileBtn'), shutter: $('shutter'), sceneBtn: $('sceneBtn'), sceneLabel: $('sceneLabel'),
    result: $('result'), resultImg: $('resultImg'), resultMeta: $('resultMeta'), resultTitle: $('resultTitle'),
    showCrop: $('showCrop'), showOrig: $('showOrig'), saveCrop: $('saveCrop'), saveOrig: $('saveOrig'),
    closeResult: $('closeResult'), toast: $('toast'), video: $('video'),
  };
  const ctx = els.view.getContext('2d');
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });

  const state = {
    source: 'none',        // 'live' | 'still'
    still: null,           // canvas / image
    stillName: '',
    sceneIndex: -1,
    cameraOk: false,
    facing: 'environment',
    stream: null,
    mode: 'aim',           // 'aim' | 'crop'
    analysis: null,
    smooth: null,
    comps: [],
    selectedId: null,
    lastChipRender: 0,
    lastAnalyze: 0,
    shot: null,
  };

  // ---------- 示範場景（程式繪製，不需外部圖片） ----------
  const SCENES = [
    { name: '海上日落', draw: drawSunset },
    { name: '霧中孤樹', draw: drawTree },
    { name: '對稱拱廊', draw: drawArcade },
  ];

  function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

  function drawSunset(c) {
    const g = c.getContext('2d'), W = c.width, H = c.height, R = rng(7);
    g.save();
    g.translate(W / 2, H / 2); g.rotate(3 * Math.PI / 180); g.translate(-W / 2, -H / 2);
    const hy = H * 0.5;
    let sky = g.createLinearGradient(0, -H * 0.1, 0, hy);
    sky.addColorStop(0, '#2b2152'); sky.addColorStop(0.45, '#a8436a'); sky.addColorStop(0.8, '#f08a4b'); sky.addColorStop(1, '#ffc46b');
    g.fillStyle = sky; g.fillRect(-W, -H, W * 3, hy + H);
    // 雲
    g.globalAlpha = 0.35;
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#ffd9a8' : '#7a3a6a';
      g.beginPath(); g.ellipse(R() * W, H * 0.08 + R() * H * 0.3, 80 + R() * 160, 8 + R() * 14, 0, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // 太陽
    g.fillStyle = '#fff1c2'; g.beginPath(); g.arc(W * 0.38, hy - 10, 46, Math.PI, 0); g.fill();
    // 海
    let sea = g.createLinearGradient(0, hy, 0, H * 1.2);
    sea.addColorStop(0, '#5a2c4a'); sea.addColorStop(1, '#120d22');
    g.fillStyle = sea; g.fillRect(-W, hy, W * 3, H * 2);
    // 倒影與波光
    for (let i = 0; i < 120; i++) {
      const y = hy + 6 + Math.pow(R(), 1.6) * H * 0.5;
      const spread = 30 + (y - hy) * 0.5;
      g.fillStyle = `rgba(255,${180 + R() * 50 | 0},120,${0.5 - (y - hy) / H})`;
      g.fillRect(W * 0.38 + (R() - 0.5) * spread * 2, y, 10 + R() * 40, 2);
    }
    g.restore();
    // 帆船剪影（不隨水平線傾斜的位置）
    g.fillStyle = '#0d0912';
    const bx = W * 0.71, by = H * 0.545;
    g.beginPath(); g.moveTo(bx - 50, by); g.lineTo(bx + 54, by); g.lineTo(bx + 36, by + 16); g.lineTo(bx - 36, by + 16); g.fill();
    g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(bx, by - 120); g.lineTo(bx + 46, by - 10); g.fill();
    g.beginPath(); g.moveTo(bx - 4, by - 100); g.lineTo(bx - 4, by - 6); g.lineTo(bx - 44, by - 6); g.fill();
  }

  function drawTree(c) {
    const g = c.getContext('2d'), W = c.width, H = c.height, R = rng(3);
    let sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#d9dee0'); sky.addColorStop(0.7, '#eef0ec'); sky.addColorStop(1, '#c9cfc4');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // 山丘
    g.fillStyle = '#b7bfae';
    g.beginPath(); g.moveTo(0, H * 0.78);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, H * 0.76 - Math.sin(x / W * Math.PI) * H * 0.05);
    g.lineTo(W, H); g.lineTo(0, H); g.fill();
    // 樹
    const tx = W * 0.57, ty = H * 0.71;
    g.strokeStyle = '#2d2a24'; g.lineCap = 'round';
    g.lineWidth = 9; g.beginPath(); g.moveTo(tx, ty + 20); g.lineTo(tx + 2, ty - 50); g.stroke();
    g.fillStyle = '#2f3a2a';
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, r = R() * 46;
      g.beginPath(); g.arc(tx + Math.cos(a) * r * 1.2, ty - 80 + Math.sin(a) * r * 0.8, 18 + R() * 16, 0, Math.PI * 2); g.fill();
    }
    // 霧
    const fog = g.createLinearGradient(0, H * 0.55, 0, H);
    fog.addColorStop(0, 'rgba(238,240,236,0)'); fog.addColorStop(1, 'rgba(238,240,236,0.45)');
    g.fillStyle = fog; g.fillRect(0, 0, W, H);
  }

  function drawArcade(c) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    g.fillStyle = '#e8dcc6'; g.fillRect(0, 0, W, H);
    // 地面透視
    g.fillStyle = '#b9a787';
    g.beginPath(); g.moveTo(0, H); g.lineTo(W * 0.4, H * 0.62); g.lineTo(W * 0.6, H * 0.62); g.lineTo(W, H); g.fill();
    g.strokeStyle = '#a08f70'; g.lineWidth = 2;
    for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(W / 2 + i * 120, H); g.lineTo(W / 2 + i * 14, H * 0.62); g.stroke(); }
    // 拱門（左右對稱、越遠越小）
    for (let k = 0; k < 5; k++) {
      const s = Math.pow(0.72, k);
      const aw = W * 0.7 * s, ah = H * 0.8 * s;
      const x0 = W / 2 - aw / 2, y1 = H * 0.62 + (H * 0.38) * s;
      g.fillStyle = k % 2 ? '#d7c7a9' : '#c9b48f';
      g.fillRect(x0 - 40 * s, y1 - ah - 30 * s, aw + 80 * s, ah + 30 * s);
      g.fillStyle = k % 2 ? '#8a7454' : '#6f5c43';
      g.beginPath();
      g.moveTo(x0, y1); g.lineTo(x0, y1 - ah + aw / 2);
      g.arc(W / 2, y1 - ah + aw / 2, aw / 2, Math.PI, 0);
      g.lineTo(x0 + aw, y1); g.closePath(); g.fill();
    }
    // 盡頭的紅門
    g.fillStyle = '#b8342a'; g.fillRect(W / 2 - 34, H * 0.47, 68, 110);
    g.fillStyle = '#f2d16b'; g.beginPath(); g.arc(W / 2, H * 0.47, 34, Math.PI, 0); g.fill();
  }

  function loadScene(i) {
    state.sceneIndex = i % SCENES.length;
    const sc = SCENES[state.sceneIndex];
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    sc.draw(c);
    setStill(c, '示範：' + sc.name);
    els.sceneLabel.textContent = `示範 ${state.sceneIndex + 1}/${SCENES.length}`;
  }

  function setStill(src, label) {
    stopCamera();
    state.source = 'still';
    state.still = src;
    state.stillName = label;
    state.smooth = null;
    state.selectedId = null;
    els.srcTag.textContent = label;
    els.camToggle.hidden = !state.cameraOk;
    els.camToggle.textContent = '回到相機';
    analyzeNow(true);
    layout();
  }

  // ---------- 相機 ----------
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      state.stream = stream;
      els.video.srcObject = stream;
      await els.video.play().catch(() => {});
      await new Promise((res) => {
        if (els.video.videoWidth) return res();
        els.video.onloadedmetadata = () => res();
        setTimeout(res, 2500);
      });
      if (!els.video.videoWidth) throw new Error('no frames');
      state.cameraOk = true;
      state.source = 'live';
      state.smooth = null;
      state.selectedId = null;
      els.srcTag.textContent = '';
      els.camToggle.hidden = false;
      els.camToggle.textContent = '切換鏡頭';
      els.notice.hidden = true;
      layout();
      return true;
    } catch (e) {
      console.warn('camera unavailable', e);
      return false;
    }
  }

  function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  }

  function srcEl() { return state.source === 'live' ? els.video : state.still; }
  function srcSize() {
    if (state.source === 'live') return { w: els.video.videoWidth || 4, h: els.video.videoHeight || 3 };
    if (state.still) return { w: state.still.naturalWidth || state.still.width, h: state.still.naturalHeight || state.still.height };
    return { w: 4, h: 3 };
  }

  // ---------- 版面 ----------
  function layout() {
    const { w, h } = srcSize();
    const box = els.stageWrap.getBoundingClientRect();
    const scale = Math.min(box.width / w, box.height / h);
    const cw = Math.max(50, Math.floor(w * scale)), ch = Math.max(50, Math.floor(h * scale));
    els.stage.style.width = cw + 'px';
    els.stage.style.height = ch + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    els.view.width = Math.round(cw * dpr);
    els.view.height = Math.round(ch * dpr);
  }
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe(els.stageWrap);

  // ---------- 分析 ----------
  /*
   * 人臉偵測：
   *  - 照片：長邊 640 px，完整兩階段掃描，每張照片只算一次
   *  - 即時：長邊 320 px、快速模式，每 0.45 秒一次；短暫偵測不到時沿用上一次（避免閃爍）
   */
  const faceCanvas = document.createElement('canvas');
  const fctx = faceCanvas.getContext('2d', { willReadFrequently: true });
  const faceState = { forStill: null, faces: [], lastRun: 0, lastSeen: 0 };
  function detectFaces(src, w, h, isStill) {
    const F = window.PhotoriumFace;
    if (!F) return [];
    if (isStill && faceState.forStill === src) return faceState.faces;
    const now = performance.now();
    if (!isStill && now - faceState.lastRun < 450) return faceState.faces;
    faceState.lastRun = now;
    const long = isStill ? 640 : 320;
    const k = long / Math.max(w, h);
    faceCanvas.width = Math.max(8, Math.round(w * k)); faceCanvas.height = Math.max(8, Math.round(h * k));
    fctx.drawImage(src, 0, 0, faceCanvas.width, faceCanvas.height);
    let faces = [];
    try { faces = F.detect(fctx.getImageData(0, 0, faceCanvas.width, faceCanvas.height), { fast: !isStill }); }
    catch (e) { console.warn('face detection failed', e); }
    if (isStill) { faceState.forStill = src; faceState.faces = faces; return faces; }
    if (faces.length) { faceState.faces = faces; faceState.lastSeen = now; }
    else if (now - faceState.lastSeen > 1000) faceState.faces = [];
    return faceState.faces;
  }

  function analyzeNow(isStill) {
    const src = srcEl();
    if (!src) return;
    const { w, h } = srcSize();
    const aw = isStill ? 200 : 160;
    work.width = aw; work.height = Math.max(8, Math.round(aw * h / w));
    wctx.drawImage(src, 0, 0, work.width, work.height);
    const data = wctx.getImageData(0, 0, work.width, work.height);
    const a = E.analyze(data, { faces: detectFaces(src, w, h, isStill) });
    if (!isStill && state.smooth && state.smooth.subject.kind === a.subject.kind) {
      const k = 0.35, s = state.smooth, n = a.subject;
      const lerp = (p, q) => p + (q - p) * k;
      n.cx = lerp(s.subject.cx, n.cx); n.cy = lerp(s.subject.cy, n.cy);
      n.box = { x: lerp(s.subject.box.x, n.box.x), y: lerp(s.subject.box.y, n.box.y), w: lerp(s.subject.box.w, n.box.w), h: lerp(s.subject.box.h, n.box.h) };
      n.area = n.box.w * n.box.h;
      n.conf = lerp(s.subject.conf, n.conf);
      if (a.horizon.valid && s.horizon.valid) {
        a.horizon.y = lerp(s.horizon.y, a.horizon.y);
        a.horizon.angle = Math.round(lerp(s.horizon.angle, a.horizon.angle) * 2) / 2;
      }
    }
    state.smooth = a;
    state.analysis = a;
    const comps = E.suggest(a);
    state.comps = comps;
    if (!state.selectedId || !comps.find((c) => c.id === state.selectedId)) state.selectedId = comps[0] && comps[0].id;
    const now = performance.now();
    if (isStill || now - state.lastChipRender > 1200) { renderChips(); state.lastChipRender = now; }
    renderDetail();
    renderReadout();
  }

  function selected() { return state.comps.find((c) => c.id === state.selectedId) || state.comps[0]; }

  function renderReadout() {
    const a = state.analysis;
    if (!a) return;
    const s = a.subject;
    const hz = a.horizon.valid ? `${a.horizon.angle > 0 ? '+' : ''}${a.horizon.angle.toFixed(1)}°` : '—';
    const who = s.kind === 'person' ? `人臉 ${s.count} · 臉寬 ${(s.faceSize * 100).toFixed(0)}%` : `主體 ${(s.area * 100).toFixed(0)}% · 信心 ${(s.conf * 100).toFixed(0)}`;
    els.readout.textContent = `${who} · 水平線 ${hz} · 對稱 ${(a.symLR * 100).toFixed(0)}`;
  }

  function renderChips() {
    const top = state.comps.slice(0, 5);
    els.chips.textContent = '';
    for (const c of top) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', c.id === state.selectedId ? 'true' : 'false');
      b.dataset.id = c.id;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
      const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = c.score;
      const bar = document.createElement('span'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = c.score + '%'; bar.appendChild(fill);
      b.append(nm, sc, bar);
      b.addEventListener('click', () => { state.selectedId = c.id; renderChips(); renderDetail(); });
      els.chips.appendChild(b);
    }
  }

  function renderDetail() {
    const c = selected();
    if (!c) return;
    els.detailTitle.textContent = `${c.name}　適合度 ${c.score}`;
    els.reason.textContent = c.reason;
    els.tips.textContent = '';
    for (const t of c.tips) { const li = document.createElement('li'); li.textContent = t; els.tips.appendChild(li); }
    // 選中的晶片同步
    for (const b of els.chips.children) b.setAttribute('aria-selected', b.dataset.id === c.id ? 'true' : 'false');
  }

  // ---------- 繪製 ----------
  function frame() {
    requestAnimationFrame(frame);
    const src = srcEl();
    const W = els.view.width, H = els.view.height;
    if (!src || !W) return;
    if (state.source === 'live') {
      const now = performance.now();
      if (now - state.lastAnalyze > 220 && els.video.readyState >= 2) { state.lastAnalyze = now; analyzeNow(false); }
    }
    const c = selected();
    const a = state.analysis;
    const { w: sw, h: sh } = srcSize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const dpr = W / els.stage.clientWidth;
    let T; // 畫面座標（0..1）→ 畫布像素
    const mirror = state.source === 'live' && state.facing === 'user';
    if (state.mode === 'crop' && c) {
      const k = c.crop;
      drawSrc(src, k.x * sw, k.y * sh, k.w * sw, k.h * sh, W, H, mirror);
      T = (p) => ({ x: mx((p.x - k.x) / k.w) * W, y: (p.y - k.y) / k.h * H });
    } else {
      drawSrc(src, 0, 0, sw, sh, W, H, mirror);
      T = (p) => ({ x: mx(p.x) * W, y: p.y * H });
    }
    function mx(x) { return mirror ? 1 - x : x; }
    if (!c || !a) return;
    drawOverlay(c, a, T, W, H, dpr);
    updateHint(c, a);
  }

  function drawSrc(src, sx, sy, sw, sh, W, H, mirror) {
    ctx.save();
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
    ctx.restore();
  }

  const COL = { guide: 'rgba(255,255,255,0.55)', faint: 'rgba(255,255,255,0.28)', focus: '#ffc531', ok: '#62e08f' };

  function line(x1, y1, x2, y2, color, width, dash) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }

  function label(text, x, y, color, dpr) {
    ctx.font = `500 ${12 * dpr}px "Noto Sans TC", system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(10,9,8,0.62)';
    ctx.fillRect(x - 4 * dpr, y - 13 * dpr, tw + 8 * dpr, 18 * dpr);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function drawOverlay(c, a, T, W, H, dpr) {
    const lw = 1.2 * dpr;
    const inCrop = state.mode === 'crop';
    // 參考線（以目前顯示的畫框為準）
    const gx = (f) => f * W, gy = (f) => f * H;
    switch (c.guide) {
      case 'thirds':
      case 'space':
        for (const f of [1 / 3, 2 / 3]) { line(gx(f), 0, gx(f), H, COL.guide, lw); line(0, gy(f), W, gy(f), COL.guide, lw); }
        break;
      case 'golden': {
        const f1 = E.PHI, f2 = 1 - E.PHI;
        for (const f of [f1, f2]) { line(gx(f), 0, gx(f), H, COL.guide, lw); line(0, gy(f), W, gy(f), COL.guide, lw); }
        drawSpiral(c, W, H, dpr, inCrop);
        break;
      }
      case 'center':
        line(W / 2, 0, W / 2, H, COL.guide, lw); line(0, H / 2, W, H / 2, COL.faint, lw);
        ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.18, 0, Math.PI * 2);
        ctx.strokeStyle = COL.faint; ctx.lineWidth = lw; ctx.stroke();
        break;
      case 'horizon':
      case 'reflection': {
        const fs = c.guide === 'horizon' ? [1 / 3, 2 / 3] : [0.5];
        for (const f of fs) line(0, gy(f), W, gy(f), Math.abs(f - c.horizonTarget) < 0.01 ? COL.focus : COL.faint, Math.abs(f - c.horizonTarget) < 0.01 ? 2 * dpr : lw, Math.abs(f - c.horizonTarget) < 0.01 ? [8 * dpr, 6 * dpr] : null);
        label('水平線放這裡', 10 * dpr, gy(c.horizonTarget) - 8 * dpr, COL.focus, dpr);
        break;
      }
      case 'diagonal':
        if (c.diagDir === '/') line(0, H, W, 0, COL.guide, lw); else line(0, 0, W, H, COL.guide, lw);
        for (const f of [1 / 3, 2 / 3]) { line(gx(f), 0, gx(f), H, COL.faint, lw); line(0, gy(f), W, gy(f), COL.faint, lw); }
        break;
      case 'portrait': {
        // 三分線；眼睛的目標線特別標示
        for (const f of [1 / 3, 2 / 3]) line(gx(f), 0, gx(f), H, COL.faint, lw);
        if (c.target.x === 0.5) line(W / 2, 0, W / 2, H, COL.faint, lw);
        line(0, gy(2 / 3), W, gy(2 / 3), COL.faint, lw);
        line(0, gy(c.target.y), W, gy(c.target.y), COL.focus, 1.6 * dpr, [8 * dpr, 6 * dpr]);
        label('眼睛放這條線', 10 * dpr, gy(c.target.y) - 8 * dpr, COL.focus, dpr);
        break;
      }
      case 'fill':
        line(W / 2, H / 2 - 14 * dpr, W / 2, H / 2 + 14 * dpr, COL.guide, lw);
        line(W / 2 - 14 * dpr, H / 2, W / 2 + 14 * dpr, H / 2, COL.guide, lw);
        break;
    }

    // 偵測到的水平線（實際位置與傾斜）
    if (a.horizon.valid && (c.guide === 'horizon' || c.guide === 'reflection' || Math.abs(a.horizon.angle) >= 1)) {
      const t = Math.tan(a.horizon.angle * Math.PI / 180);
      const sh = srcSize();
      const ar = sh.w / sh.h;
      const p1 = T({ x: 0, y: a.horizon.y - t * 0.5 * ar });
      const p2 = T({ x: 1, y: a.horizon.y + t * 0.5 * ar });
      const tilted = Math.abs(a.horizon.angle) >= 1;
      line(p1.x, p1.y, p2.x, p2.y, tilted ? '#ff8a5c' : 'rgba(255,255,255,0.8)', 1.6 * dpr, [3 * dpr, 4 * dpr]);
    }

    // 人臉框
    const S = a.subject;
    if (S.kind === 'person') {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5 * dpr;
      for (const f of S.faces) {
        const sy = f.sizeY || f.size;
        const p0 = T({ x: f.cx - f.size / 2, y: f.cy - 0.68 * sy }), p1 = T({ x: f.cx + f.size / 2, y: f.cy + 0.55 * sy });
        const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y), ww = Math.abs(p1.x - p0.x), hh = Math.abs(p1.y - p0.y);
        const rr = Math.min(ww, hh) * 0.35;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, ww, hh, rr); else ctx.rect(x, y, ww, hh);
        ctx.stroke();
      }
    }

    // 主體框（對焦框樣式）
    const b0 = T({ x: S.box.x, y: S.box.y }), b1 = T({ x: S.box.x + S.box.w, y: S.box.y + S.box.h });
    const bx = Math.min(b0.x, b1.x), by = Math.min(b0.y, b1.y), bw = Math.abs(b1.x - b0.x), bh = Math.abs(b1.y - b0.y);
    const L = Math.min(bw, bh) * 0.25 + 4 * dpr;
    ctx.strokeStyle = COL.focus; ctx.lineWidth = 2 * dpr; ctx.beginPath();
    ctx.moveTo(bx, by + L); ctx.lineTo(bx, by); ctx.lineTo(bx + L, by);
    ctx.moveTo(bx + bw - L, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + L);
    ctx.moveTo(bx + bw, by + bh - L); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw - L, by + bh);
    ctx.moveTo(bx + L, by + bh); ctx.lineTo(bx, by + bh); ctx.lineTo(bx, by + bh - L);
    ctx.stroke();

    // 主體 → 目標位置的箭頭
    let from, to, ok;
    if (inCrop) {
      if (c.guide === 'horizon' || c.guide === 'reflection') return;
      const m = state.source === 'live' && state.facing === 'user';
      from = T({ x: S.cx, y: S.cy });
      to = { x: (m ? 1 - c.target.x : c.target.x) * W, y: c.target.y * H };
      if (c.guide === 'fill') to = from;
      ok = c.cropResidual < 0.04;
    } else {
      if (c.guide === 'horizon' || c.guide === 'reflection') {
        from = T({ x: 0.5, y: a.horizon.y }); to = T({ x: 0.5, y: c.horizonTarget });
      } else {
        from = T({ x: S.cx, y: S.cy }); to = T(c.guide === 'fill' ? { x: 0.5, y: 0.5 } : c.target);
      }
      ok = c.aim.dist < 0.045;
    }
    const col = ok ? COL.ok : COL.focus;
    // 目標點
    ctx.beginPath(); ctx.arc(to.x, to.y, 11 * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.lineWidth = 2 * dpr; ctx.stroke();
    ctx.beginPath(); ctx.arc(to.x, to.y, 2.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    // 主體中心
    ctx.beginPath(); ctx.arc(from.x, from.y, 4 * dpr, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    if (d > 18 * dpr) {
      const ux = (to.x - from.x) / d, uy = (to.y - from.y) / d;
      const ex = to.x - ux * 14 * dpr, ey = to.y - uy * 14 * dpr;
      line(from.x + ux * 7 * dpr, from.y + uy * 7 * dpr, ex, ey, col, 2.2 * dpr);
      const hs = 9 * dpr;
      ctx.beginPath(); ctx.moveTo(ex + ux * 2, ey + uy * 2);
      ctx.lineTo(ex - ux * hs - uy * hs * 0.6, ey - uy * hs + ux * hs * 0.6);
      ctx.lineTo(ex - ux * hs + uy * hs * 0.6, ey - uy * hs - ux * hs * 0.6);
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    }

    // 取景模式下，用虛線標出「拍下後會裁切成的範圍」
    if (!inCrop && c.crop.w < 0.97) {
      const k0 = T({ x: c.crop.x, y: c.crop.y }), k1 = T({ x: c.crop.x + c.crop.w, y: c.crop.y + c.crop.h });
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1 * dpr; ctx.setLineDash([5 * dpr, 5 * dpr]);
      ctx.strokeRect(Math.min(k0.x, k1.x), Math.min(k0.y, k1.y), Math.abs(k1.x - k0.x), Math.abs(k1.y - k0.y));
      ctx.setLineDash([]);
    }
  }

  function drawSpiral(c, W, H, dpr, inCrop) {
    // 以目標點為中心的黃金螺旋，往離目標最遠的角落展開
    const tx = c.target.x * W, ty = c.target.y * H;
    const fx = c.target.x < 0.5 ? W : 0, fy = c.target.y < 0.5 ? H : 0;
    const R = Math.hypot(fx - tx, fy - ty);
    const start = Math.atan2(fy - ty, fx - tx);
    const b = Math.log(1.618034) / (Math.PI / 2);
    const dir = (c.target.x < 0.5) === (c.target.y < 0.5) ? 1 : -1;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.beginPath();
    for (let th = 0; th >= -7 * Math.PI; th -= 0.05) {
      const r = R * Math.exp(b * th);
      const ang = start + dir * th;
      const x = tx + Math.cos(ang) * r, y = ty + Math.sin(ang) * r;
      if (th === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,197,49,0.55)'; ctx.lineWidth = 1.4 * dpr; ctx.stroke();
    ctx.restore();
  }

  let lastHint = '';
  function updateHint(c, a) {
    let text, ok = false;
    if (state.mode === 'crop') {
      const keep = Math.round(c.crop.w * c.crop.h * 100);
      if (c.crop.w > 0.97) text = '不需裁切，直接拍就是這個構圖';
      else if (keep < 15) text = `只保留 ${keep}% 畫面，畫質會明顯下降，建議直接靠近拍`;
      else text = `拍下後裁成這樣（保留 ${keep}% 畫面）`;
      ok = c.cropResidual < 0.04;
    } else if (state.source === 'still') {
      text = c.aim.ok ? '構圖到位' : `拍攝時：${c.aim.text}`;
      ok = c.aim.ok;
    } else {
      ok = c.aim.ok;
      text = ok ? '構圖到位，可以拍了' : c.aim.text;
    }
    if (c.tips.length && !ok && state.mode === 'aim' && /傾斜/.test(c.tips[0])) text = '先把水平線轉正';
    const key = text + ok;
    if (key !== lastHint) {
      els.hint.textContent = text;
      els.hint.classList.toggle('ok', ok);
      els.shutter.classList.toggle('ready', ok && state.source === 'live');
      lastHint = key;
    }
  }

  // ---------- 拍照與輸出 ----------
  function capture() {
    const c = selected();
    const src = srcEl();
    if (!src || !c) return;
    const { w, h } = srcSize();
    const full = document.createElement('canvas');
    full.width = w; full.height = h;
    const fg = full.getContext('2d');
    const mirror = state.source === 'live' && state.facing === 'user';
    if (mirror) { fg.translate(w, 0); fg.scale(-1, 1); }
    fg.drawImage(src, 0, 0, w, h);
    const k = c.crop;
    const cw = Math.round(k.w * w), ch = Math.round(k.h * h);
    const crop = document.createElement('canvas');
    crop.width = cw; crop.height = ch;
    const kx = mirror ? (1 - k.x - k.w) : k.x;
    crop.getContext('2d').drawImage(full, Math.round(kx * w), Math.round(k.y * h), cw, ch, 0, 0, cw, ch);
    state.shot = {
      comp: c,
      full, crop,
      fullUrl: full.toDataURL('image/jpeg', 0.92),
      cropUrl: crop.toDataURL('image/jpeg', 0.92),
      time: new Date(),
    };
    showResult('crop');
    els.result.hidden = false;
    els.closeResult.focus();
  }

  function showResult(which) {
    const s = state.shot;
    if (!s) return;
    const isCrop = which === 'crop';
    els.resultImg.src = isCrop ? s.cropUrl : s.fullUrl;
    els.showCrop.classList.toggle('on', isCrop);
    els.showOrig.classList.toggle('on', !isCrop);
    els.resultTitle.textContent = `${s.comp.name}構圖`;
    const keep = Math.round(s.comp.crop.w * s.comp.crop.h * 100);
    els.resultMeta.textContent = isCrop
      ? `${s.crop.width} × ${s.crop.height} px · 保留 ${keep}% 畫面 · 適合度 ${s.comp.score}`
      : `${s.full.width} × ${s.full.height} px · 原始畫面`;
    els.toast.textContent = '';
  }

  function stamp(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  async function save(which) {
    const s = state.shot;
    if (!s) return;
    const canvas = which === 'crop' ? s.crop : s.full;
    const name = `photorium-${stamp(s.time)}-${which === 'crop' ? s.comp.id : 'original'}.jpg`;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    // 在 Claude 內：使用 downloads 能力；一般瀏覽器：直接下載
    let dl = null;
    if (window.claude && window.claude.use) { try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; } }
    if (dl) {
      try { await dl.save({ filename: name, data: blob }); els.toast.textContent = '已儲存 ' + name; }
      catch (e) { els.toast.textContent = e && e.code === 'declined' ? '已取消儲存' : '這裡無法儲存檔案，可以長按圖片另存'; }
      return;
    }
    if (window.claude) { els.toast.textContent = '這裡無法儲存檔案，可以長按或右鍵圖片另存'; return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    els.toast.textContent = '已下載 ' + name;
  }

  // ---------- 事件 ----------
  function setMode(m) {
    state.mode = m;
    els.modeAim.classList.toggle('on', m === 'aim'); els.modeAim.setAttribute('aria-selected', m === 'aim');
    els.modeCrop.classList.toggle('on', m === 'crop'); els.modeCrop.setAttribute('aria-selected', m === 'crop');
    lastHint = '';
  }
  els.modeAim.addEventListener('click', () => setMode('aim'));
  els.modeCrop.addEventListener('click', () => setMode('crop'));
  els.shutter.addEventListener('click', capture);
  els.sceneBtn.addEventListener('click', () => loadScene(state.sceneIndex + 1));
  els.camToggle.addEventListener('click', async () => {
    if (state.source === 'live') { state.facing = state.facing === 'user' ? 'environment' : 'user'; }
    await startCamera();
  });
  /*
   * 讀取照片：
   * 1. createImageBitmap 直接解碼檔案（不經過 blob: 網址，預覽環境的安全政策擋不到；會套用 EXIF 方向）
   * 2. 不支援時改用 FileReader 轉成 data: 網址再載入
   * 最後一律畫進畫布並把長邊縮到 2400 px，避免手機上大照片超出畫布限制。
   */
  const MAX_SIDE = 2400;
  function toCanvas(src, w, h) {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  async function decodeFile(f) {
    if (window.createImageBitmap) {
      try {
        let bmp;
        try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); }
        catch (e) { bmp = await createImageBitmap(f); }
        const c = toCanvas(bmp, bmp.width, bmp.height);
        if (bmp.close) bmp.close();
        return c;
      } catch (e) { console.warn('createImageBitmap failed', e); }
    }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = () => rej(r.error);
      r.readAsDataURL(f);
    });
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => rej(new Error('decode failed'));
      im.src = dataUrl;
    });
    return toCanvas(img, img.naturalWidth, img.naturalHeight);
  }
  /*
   * HEIC（iPhone 預設格式）：Safari 能直接解碼，Chrome／Edge／Firefox 不行。
   * 需要時才從 CDN 載入 heic2any（約 1.3 MB，內含 libheif），先轉成 JPEG 再解碼。
   */
  const isHeic = (f) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name || '');
  let heicLib = null;
  function loadHeicLib() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (heicLib) return heicLib;
    heicLib = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
      const timer = setTimeout(() => rej(new Error('timeout')), 20000);
      s.onload = () => { clearTimeout(timer); window.heic2any ? res(window.heic2any) : rej(new Error('no global')); };
      s.onerror = () => { clearTimeout(timer); rej(new Error('load failed')); };
      document.head.appendChild(s);
    });
    heicLib.catch(() => { heicLib = null; });
    return heicLib;
  }
  async function decodeHeic(f) {
    const heic2any = await loadHeicLib();
    let out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.92 });
    if (Array.isArray(out)) out = out[0];
    return decodeFile(out);
  }

  els.fileIn.addEventListener('change', async () => {
    const f = els.fileIn.files && els.fileIn.files[0];
    els.fileIn.value = '';
    if (!f) return;
    els.notice.hidden = true;
    try {
      let c;
      try { c = await decodeFile(f); }
      catch (e) {
        if (!isHeic(f)) throw e;
        els.notice.hidden = false;
        els.notice.textContent = '正在轉換 HEIC 照片…（第一次需要下載解碼器，約 1.3 MB）';
        c = await decodeHeic(f);
        els.notice.hidden = true;
      }
      setStill(c, '照片：' + (f.name || '未命名'));
    } catch (e) {
      console.warn('photo load failed', f.type, f.name, e);
      els.notice.hidden = false;
      els.notice.textContent = isHeic(f)
        ? 'HEIC 照片轉換失敗（可能是網路擋住了解碼器）。可以改用 Safari 開啟，或先用 tools/heic2jpg.py 把照片轉成 JPG。'
        : `這張照片無法讀取（格式：${f.type || '未知'}）。請換一張 JPG、PNG 或 WebP 照片。`;
    }
  });
  els.showCrop.addEventListener('click', () => showResult('crop'));
  els.showOrig.addEventListener('click', () => showResult('orig'));
  els.saveCrop.addEventListener('click', () => save('crop'));
  els.saveOrig.addEventListener('click', () => save('orig'));
  els.closeResult.addEventListener('click', () => { els.result.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.result.hidden) els.result.hidden = true;
    if (e.key === ' ' && els.result.hidden && e.target === document.body) { e.preventDefault(); capture(); }
  });

  window.PhotoriumDebug = { state, analyzeNow };

  // ---------- 啟動 ----------
  async function boot() {
    loadScene(0);
    requestAnimationFrame(frame);
    const ok = await startCamera();
    if (!ok) {
      els.notice.hidden = false;
      els.notice.textContent = window.claude || window.self !== window.top
        ? '這個預覽環境不允許即時相機，目前顯示示範場景。可以點「照片」拍一張或從相簿選，看看構圖建議；要用即時取景，請開啟獨立網頁版本。'
        : '無法開啟相機（需要 HTTPS 或 localhost，並允許相機權限）。目前顯示示範場景，也可以點「照片」分析自己的照片。';
    }
  }
  boot();
})();
