#!/usr/bin/env node
/*
 * Photorium 測試照片集工具
 *
 * 先用 tools/testset_prep.py 把照片轉成分析用的快取（testset/cache/*.rgba），再執行：
 *
 *   node tools/testset.js features   分析照片、把特徵存到 testset/cache/features.json
 *                                    （每次最多約 2 分鐘，沒做完會提示再執行一次；已分析過的會略過）
 *   node tools/testset.js eval       類型判斷準確率（留一交叉驗證）、信心度門檻、混淆矩陣
 *   node tools/testset.js fit        挑選特徵並重新產生 web/src/scene-model.js
 *   node tools/testset.js report     每張照片的判斷結果
 *
 * eval、fit、report 只讀取 features.json，速度很快；新增照片後先跑 features。
 * 可加參數：[labels.csv] [cache 資料夾]，預設 testset/labels.csv、testset/cache
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'web/src/engine.js'));

const [cmd = 'eval', labelsPath = path.join(ROOT, 'testset/labels.csv'), cacheDir = path.join(ROOT, 'testset/cache')] = process.argv.slice(2);
const FEAT_FILE = path.join(cacheDir, 'features.json');
const TIME_BUDGET_MS = 120000;

function readLabels(p) {
  const rows = fs.readFileSync(p, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
  return rows.map((r) => { const [file, type, ...note] = r.split(','); return { file: (file || '').trim(), type: (type || '').trim(), note: note.join(',') }; })
    .filter((r) => r.file && E.SCENE_TYPES[r.type]);
}

function loadRgba(file) {
  const p = path.join(cacheDir, file + '.rgba');
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
  return { width: w, height: h, data: new Uint8ClampedArray(b.buffer, b.byteOffset + 8, w * h * 4) };
}

// 縮到寬 200 px（和網頁版分析照片時一樣）
function downscale(img, width) {
  const k = width / img.width;
  const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.floor(x / k)), sy = Math.min(img.height - 1, Math.floor(y / k));
    const si = (sy * img.width + sx) * 4, di = (y * w + x) * 4;
    out[di] = img.data[si]; out[di + 1] = img.data[si + 1]; out[di + 2] = img.data[si + 2]; out[di + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

function loadFeatures() {
  try { return JSON.parse(fs.readFileSync(FEAT_FILE, 'utf8')); } catch (e) { return {}; }
}

function cmdFeatures(labels) {
  const F = require(path.join(ROOT, 'test/face-load.js'));
  const cache = loadFeatures();
  // 特徵定義改了（引擎更新）就全部重算
  const sig = E.SCENE_FEATURES.join(',');
  if (cache.__sig !== sig) { for (const k of Object.keys(cache)) delete cache[k]; cache.__sig = sig; }
  const t0 = Date.now();
  let done = 0, left = 0, missing = 0;
  for (const L of labels) {
    if (cache[L.file]) continue;
    if (Date.now() - t0 > TIME_BUDGET_MS) { left++; continue; }
    const img = loadRgba(L.file);
    if (!img) { missing++; continue; }
    const faces = F.detect(img); // 快取是長邊 640 px，和網頁版照片模式相同
    const a = E.analyze(downscale(img, 200), { faces });
    cache[L.file] = { f: E.sceneFeatures(a).map((v) => +v.toFixed(4)), face: a.person ? +a.person.faceSize.toFixed(3) : 0 };
    done++;
    if (done % 20 === 0) fs.writeFileSync(FEAT_FILE, JSON.stringify(cache));
  }
  fs.writeFileSync(FEAT_FILE, JSON.stringify(cache));
  console.log(`分析 ${done} 張${left ? `，還有 ${left} 張沒做完，請再執行一次 features` : '，全部完成'}${missing ? `；${missing} 張沒有快取（先跑 testset_prep.py）` : ''}`);
}

function samplesFrom(labels) {
  const cache = loadFeatures();
  const out = [], miss = [];
  for (const L of labels) { const c = cache[L.file]; if (c) out.push({ ...L, f: c.f, face: c.face }); else miss.push(L.file); }
  if (miss.length) console.warn(`有 ${miss.length} 張還沒分析，先執行 node tools/testset.js features`);
  return out;
}

function fitModel(samples, use) {
  // 人像由人臉決定，不放進中心點
  const groups = {};
  for (const s of samples) if (s.type !== 'portrait') (groups[s.type] = groups[s.type] || []).push(s.f);
  const dim = samples[0].f.length;
  const all = samples.filter((s) => s.type !== 'portrait').map((s) => s.f);
  const mean = Array(dim).fill(0), std = Array(dim).fill(0);
  for (const f of all) f.forEach((v, i) => { mean[i] += v / all.length; });
  for (const f of all) f.forEach((v, i) => { std[i] += (v - mean[i]) ** 2 / all.length; });
  for (let i = 0; i < dim; i++) std[i] = Math.max(0.05, Math.sqrt(std[i])); // 下限避免樣本少時過度放大
  const centroids = {}, counts = {};
  for (const [k, fs_] of Object.entries(groups)) {
    centroids[k] = Array(dim).fill(0);
    for (const f of fs_) f.forEach((v, i) => { centroids[k][i] += v / fs_.length; });
    counts[k] = fs_.length;
  }
  return { features: E.SCENE_FEATURES, use: use || E.SCENE_FEATURES, centroids, std, counts, temperature: 0.5 };
}

// 留一交叉驗證：每次拿掉一張，用其他照片產生模型，再判斷拿掉的那張
function loo(samples, use) {
  return samples.map((s, i) => {
    const m = fitModel(samples.filter((_, j) => j !== i), use);
    return { s, r: E.classifyFeatures(s.f, s.face, m) };
  });
}
const looScore = (samples, use) => loo(samples, use).filter((x) => x.s.type !== 'portrait' && x.s.face < 0.05 && x.r.type === x.s.type).length;

// 貪婪前向挑選特徵：每次加入最能提高準確率的特徵，直到不再進步
function selectFeatures(samples) {
  let use = [], cur = -1;
  for (;;) {
    let bestName = null, bestV = cur;
    for (const n of E.SCENE_FEATURES) {
      if (use.includes(n)) continue;
      const v = looScore(samples, [...use, n]);
      if (v > bestV) { bestV = v; bestName = n; }
    }
    if (!bestName) break;
    use.push(bestName); cur = bestV;
  }
  return use;
}

const round = (a) => a.map((v) => +v.toFixed(4));

function main() {
  const labels = readLabels(labelsPath);
  if (cmd === 'features') return cmdFeatures(labels);
  const samples = samplesFrom(labels);
  if (!samples.length) { console.error('沒有可用的照片：先執行 tools/testset_prep.py，再執行 node tools/testset.js features'); process.exit(1); }
  const types = Object.keys(E.SCENE_TYPES);

  if (cmd === 'fit') {
    const use = selectFeatures(samples);
    console.log('挑選的特徵：', use.join('、'));
    const m = fitModel(samples, use);
    const out = `/* 由 tools/testset.js fit 自動產生，請勿手動編輯。\n * 標註照片：${samples.length} 張（${Object.entries(m.counts).map(([k, v]) => E.SCENE_TYPES[k] + ' ' + v).join('、')}；人像另由人臉判斷）\n * 產生時間：${new Date().toISOString()}\n */\n(function (root) {\n  const model = ${JSON.stringify({ ...m, std: round(m.std), centroids: Object.fromEntries(Object.entries(m.centroids).map(([k, v]) => [k, round(v)])) }, null, 2).replace(/\n/g, '\n  ')};\n  if (typeof module !== 'undefined' && module.exports) module.exports = model;\n  else root.PhotoriumSceneModel = model;\n})(typeof window !== 'undefined' ? window : globalThis);\n`;
    fs.writeFileSync(path.join(ROOT, 'web/src/scene-model.js'), out);
    console.log('已更新 web/src/scene-model.js', m.counts);
    return;
  }

  if (cmd === 'eval' || cmd === 'report') {
    let use;
    try { delete require.cache[require.resolve(path.join(ROOT, 'web/src/scene-model.js'))]; use = require(path.join(ROOT, 'web/src/scene-model.js')).use; } catch (e) { use = undefined; }
    const res = loo(samples, use);
    const conf = {}; types.forEach((t) => { conf[t] = {}; types.forEach((u) => { conf[t][u] = 0; }); });
    let ok = 0;
    for (const { s, r } of res) { conf[s.type][r.type]++; if (r.type === s.type) ok++; }
    if (cmd === 'report') {
      for (const { s, r } of res) console.log(`${s.file}\t標註 ${E.SCENE_TYPES[s.type]}\t判斷 ${E.SCENE_TYPES[r.type]} ${(r.conf * 100).toFixed(0)}%\t${s.type === r.type ? '✓' : '✗'}\t${s.note}`);
      console.log('');
    }
    console.log(`使用的特徵：${(use || E.SCENE_FEATURES).join('、')}`);
    console.log(`類型判斷準確率（留一交叉驗證）：${ok}/${samples.length} = ${(ok / samples.length * 100).toFixed(0)}%\n`);
    console.log('信心度門檻    判斷張數    正確率');
    for (const t of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
      const sel = res.filter((x) => x.r.conf >= t);
      if (sel.length) console.log(`  ≥ ${t.toFixed(1)}       ${String(sel.length).padStart(3)}        ${(sel.filter((x) => x.r.type === x.s.type).length / sel.length * 100).toFixed(0)}%`);
    }
    console.log('\n混淆矩陣（列 = 標註，欄 = 判斷）');
    console.log('        ' + types.map((t) => E.SCENE_TYPES[t]).join('  '));
    for (const t of types) {
      const n = types.reduce((a, u) => a + conf[t][u], 0);
      if (!n) continue;
      console.log(`${E.SCENE_TYPES[t]}(${n})`.padEnd(8) + types.map((u) => String(conf[t][u]).padStart(4)).join('  ') + `   正確 ${(conf[t][t] / n * 100).toFixed(0)}%`);
    }
    return;
  }
  console.error('未知的指令：' + cmd);
}
main();
