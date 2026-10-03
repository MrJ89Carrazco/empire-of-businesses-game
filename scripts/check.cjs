'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
let count = 0;
for (const directory of ['game', 'js', 'data', 'scripts', 'tests']) {
  for (const file of fs.readdirSync(path.join(ROOT, directory))) {
    if (!/\.(?:js|cjs)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, directory, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
    count++;
  }
}
if (!count) throw Error('No JavaScript files checked.');
console.log('Syntax checked ' + count + ' JavaScript files.');
