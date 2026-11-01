// 測試用：載入 face.js 並嵌入模型（與 build.js 相同的處理）
const fs = require('fs'), path = require('path');
const b64 = fs.readFileSync(path.join(__dirname, '../web/vendor/facefinder')).toString('base64');
const src = fs.readFileSync(path.join(__dirname, '../web/src/face.js'), 'utf8').replace('/*__FACEFINDER_B64__*/', b64);
const m = { exports: {} };
new Function('module', 'globalThis', src)(m, globalThis);
module.exports = m.exports;
