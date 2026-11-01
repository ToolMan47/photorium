const E = require('../web/src/engine.js');
function img(w,h,fn){const d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const [r,g,b]=fn(x/w,y/h);const i=(y*w+x)*4;d[i]=r;d[i+1]=g;d[i+2]=b;d[i+3]=255;}return {width:w,height:h,data:d};}
const W=160,H=120;
// 1. red ball on blue-grey bg at (0.72,0.42)
let a=E.analyze(img(W,H,(x,y)=>{const d=Math.hypot((x-0.72)*1.33,y-0.42);return d<0.08?[220,40,40]:[90,110,140+y*30];}));
console.log('ball', a.subject, a.horizon.valid);
console.log(E.suggest(a).map(c=>[c.id,c.score,c.aim.text,c.crop.w.toFixed(2)]));
// 2. horizon tilted 4deg at y=0.55, sky gradient, sea dark
const t=Math.tan(4*Math.PI/180);
a=E.analyze(img(W,H,(x,y)=>{const hy=0.55+t*(x-0.5)*1.33; return y<hy?[250-y*100,170-y*60,120+y*60]:[30,50,80+((x*37+y*91)%0.1)*300];}));
console.log('horizon', a.horizon, a.symTB.toFixed(2));
console.log(E.suggest(a).map(c=>[c.id,c.score,c.aim.text,c.tips]));
// 3. symmetric facade
a=E.analyze(img(W,H,(x,y)=>{const dx=Math.abs(x-0.5);const win=(Math.floor(dx*20)%2==0 && Math.floor(y*10)%2==0 && y>0.2&&y<0.8)?60:0;return dx<0.08&&y>0.45?[60,40,30]:[200-win,190-win,170-win];}));
console.log('sym', a.symLR.toFixed(2), E.suggest(a).slice(0,3).map(c=>[c.id,c.score]));
