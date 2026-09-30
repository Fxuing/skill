// Assembles src/* + three.module.min.js (r160) into one self-contained HTML file.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const read = p => fs.readFileSync(path.join(dir, p), 'utf8');

let three = read('three.module.min.js');
const at = three.lastIndexOf('export{');
if (at < 0) throw new Error('export block not found');
const exportBody = three.slice(at + 7, three.lastIndexOf('}'));
const props = exportBody.split(',').map(s => {
  const m = s.trim().split(/\s+as\s+/);
  return m.length === 2 ? `${m[1]}:${m[0]}` : m[0];
});
three = `const THREE=(()=>{${three.slice(0, at)};return{${props.join(',')}};})();`;

const parts = ['core', 'sky', 'world', 'garden', 'pavilion', 'decor', 'tree', 'life', 'rabbit', 'fx', 'main']
  .map(n => `// ===== ${n}.js =====\n` + read(`src/${n}.js`))
  .join('\n')
  .replace(/^import \* as THREE from 'three';\s*$/m, '');

for (const [name, s] of [['three', three], ['app', parts]]) {
  if (/<\/script|<!--/i.test(s)) throw new Error(`${name} contains an HTML-breaking sequence`);
}

// function replacer: the payload contains `$` sequences that string replacement would expand
const html = read('src/head.html').replace('<!--SCRIPTS-->',
  () => `<script type="module">\n${three}\n${parts}\n</script>`);
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(`index.html written: ${(html.length / 1024).toFixed(0)} KB`);
