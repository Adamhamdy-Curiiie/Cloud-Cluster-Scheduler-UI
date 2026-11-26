const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

const ui = path.resolve(__dirname, '..');
buildSync({
  entryPoints: [path.join(__dirname, 'three-entry.mjs')],
  outfile: path.join(ui, 'vendor', 'three.bundle.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'SchedulerThree',
  platform: 'browser',
  target: 'chrome140',
  legalComments: 'eof'
});
fs.copyFileSync(path.join(ui, 'node_modules', 'three', 'LICENSE'),
  path.join(ui, 'vendor', 'THREE-LICENSE.txt'));
console.log('Built local Three.js, OrbitControls, and optional GLTFLoader.');
