// Runs the README examples, checks that they report what the README shows, and writes the reports of the
// failing example app to examples/output. CI runs it and then fails if those files changed, so the example
// output in the repository is always the real output.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, LIMITS } from '../src/index.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const releases = resolve(root, 'test/fixtures/releases.json');

// Runs the tool on files of the repository; paths in the report are relative to the repository.
async function run(argv) {
  let out = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => process.stderr.write(t) }, LIMITS, root);
  return { code, out };
}

const problems = [];
function expect(name, result, code, expected, unwanted) {
  const missing = expected.filter((e) => !result.out.includes(e));
  const wrong = unwanted.filter((e) => result.out.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})`);
  }
}

const failing = await run([resolve(root, 'examples/harbor-notes'), '--releases', releases]);
process.stdout.write(failing.out);
expect('failing app', failing, 1, [
  'desktop-release-check: examples/harbor-notes',
  'major 30, latest stable major 44, supported 44, 43, 42 (test/fixtures/releases.json)',
  'nodeIntegration               true           examples/harbor-notes/src/main.js:9  UNSAFE',
  'webSecurity                   not found in source',
  'findings: 5 error, 2 warning, 0 info',
  'ERROR    electron-unsupported  examples/harbor-notes/package.json:7  electron',
  'ERROR    update-insecure-url  examples/harbor-notes/electron-builder.yml:12  publish.url',
  'ERROR    committed-key-file  examples/harbor-notes/build/FAKE-signing-certificate.pfx:1',
  'WARNING  windows-signing-missing  examples/harbor-notes/electron-builder.yml:3  windows signing',
  'WARNING  macos-notarization-missing  examples/harbor-notes/electron-builder.yml:5  notarization',
  'GATE: FAIL - 5 errors'
], ['GATE: PASS']);

process.stdout.write('\n');
const fixed = await run([resolve(root, 'examples/harbor-notes-fixed'), '--releases', releases, '--fail-on', 'warning']);
process.stdout.write(fixed.out);
expect('fixed app with --fail-on warning', fixed, 0, [
  'major 43, latest stable major 44, supported 44, 43, 42 (test/fixtures/releases.json)',
  'allowRunningInsecureContent   false          examples/harbor-notes-fixed/src/main.js:14',
  'findings: 0 error, 0 warning, 0 info',
  'GATE: PASS (--fail-on warning)'
], ['ERROR', 'WARNING', 'webSecurity                   not found in source']);

process.stdout.write('\n');
const tauri = await run([resolve(root, 'examples/tidewater-sync')]);
process.stdout.write(tauri.out);
expect('tauri app', tauri, 1, [
  'desktop-release-check: examples/tidewater-sync',
  'findings: 2 error, 2 warning, 1 info',
  'ERROR    update-insecure-url  examples/tidewater-sync/src-tauri/tauri.conf.json:18  plugins.updater.endpoints',
  'ERROR    updater-no-pubkey  examples/tidewater-sync/src-tauri/tauri.conf.json:16  plugins.updater',
  'WARNING  macos-signing-missing  examples/tidewater-sync/src-tauri/tauri.conf.json:1  macos signing',
  'WARNING  macos-hardened-runtime-off  examples/tidewater-sync/src-tauri/tauri.conf.json:12  hardened runtime',
  'INFO     macos-notarization-env',
  'GATE: FAIL - 2 errors'
], ['GATE: PASS']);

process.stdout.write('\n');
const tauriFixed = await run([resolve(root, 'examples/tidewater-sync-fixed'), '--fail-on', 'warning']);
process.stdout.write(tauriFixed.out);
expect('fixed tauri app with --fail-on warning', tauriFixed, 0, [
  'findings: 0 error, 0 warning, 1 info',
  'INFO     macos-notarization-env',
  'GATE: PASS (--fail-on warning)'
], ['ERROR', 'WARNING']);

// Without a releases file the support check says that it did not run.
process.stdout.write('\n');
const unchecked = await run([resolve(root, 'examples/harbor-notes-fixed')]);
expect('without --releases', unchecked, 0, [
  '1  Electron version                not checked',
  'INFO     electron-support-not-checked'
], ['1  Electron version                pass']);

// The README shows the runs as they are printed.
const readme = (await readFile(resolve(root, 'README.md'), 'utf8')).split('\r\n').join('\n');
if (!readme.includes(failing.out)) problems.push('README: the sample output of the failing app differs from a real run');
if (!readme.includes(fixed.out)) problems.push('README: the sample output of the fixed app differs from a real run');
if (!readme.includes(tauri.out)) problems.push('README: the sample output of the Tauri app differs from a real run');

// The same project in the other formats, kept as examples of what each one looks like.
await mkdir(resolve(root, 'examples/output'), { recursive: true });
await writeFile(resolve(root, 'examples/output/harbor-notes.txt'), failing.out);
for (const [format, name] of [['markdown', 'harbor-notes.md'], ['json', 'harbor-notes.json'], ['csv', 'harbor-notes.csv']]) {
  const r = await run([resolve(root, 'examples/harbor-notes'), '--releases', releases, '--format', format]);
  if (r.code !== 1) problems.push(`${format}: exit code ${r.code}, expected 1`);
  await writeFile(resolve(root, 'examples/output', name), r.out);
}

if (problems.length) {
  for (const p of problems) console.error(`example: ${p}`);
  process.exit(1);
}
