/* Fail closed when tests are missing, flattened, empty, skipped, or not executed. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const TESTS = path.join(ROOT, 'tests');
const REQUIRED = ['model.test.cjs', 'dashboard.test.cjs', 'publication.test.cjs'];
try {
  for (const file of REQUIRED) {
    if (!fs.statSync(path.join(TESTS, file)).isFile()) throw Error('Missing required suite: ' + file);
  }
  const files = fs.readdirSync(TESTS).filter(name => name.endsWith('.test.cjs')).sort();
  if (!files.length) throw Error('No JavaScript test files found.');
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files.map(name => path.join(TESTS, name))], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  const values = Object.fromEntries([...String(result.stdout).matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm)].map(m => [m[1], Number(m[2])]));
  // The baseline contains 26 JS cases. Do not accept a silent empty discovery.
  if (!Number.isInteger(values.tests) || values.tests < 26 || values.pass !== values.tests || values.fail || values.cancelled || values.skipped || values.todo) {
    throw Error('Incomplete JavaScript test run: expected at least 26 real, passing cases and no skips.');
  }
  if (result.status !== 0) throw Error('JavaScript tests failed (exit ' + result.status + ').');
} catch (error) {
  console.error('Test guard:', error.message); process.exitCode = 1;
}
