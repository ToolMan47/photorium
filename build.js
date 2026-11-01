// 把 src/ 內的檔案合併成單一 HTML：dist/photorium.html（可直接開啟，也可發佈）
const fs = require('fs'), path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'web/src', f), 'utf8');
let html = src('index.html')
  .replace('/*__CSS__*/', () => src('app.css'))
  .replace('/*__ENGINE__*/', () => src('engine.js'))
  .replace('/*__FACE__*/', () => src('face.js').replace('/*__FACEFINDER_B64__*/', () =>
    fs.readFileSync(path.join(__dirname, 'web/vendor/facefinder')).toString('base64')))
  .replace('/*__APP__*/', () => src('app.js'));
fs.mkdirSync(path.join(__dirname, 'web/dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'web/dist/photorium.html'), html);
// 獨立網頁版：補上完整的 HTML 外殼，可放在任何 HTTPS 主機或 localhost
const standalone = `<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="theme-color" content="#12110f">\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(__dirname, 'web/dist/index.html'), standalone);
// GitHub Pages：從 docs/ 發佈
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'docs/index.html'), standalone);
fs.writeFileSync(path.join(__dirname, 'docs/.nojekyll'), '');
console.log('built', html.length, 'bytes');
