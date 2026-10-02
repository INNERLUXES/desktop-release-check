import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { csvCell, mdCell, parseArgs, safeText, toCsv, toJson, toMarkdown, toText, USAGE, VERSION } from '../src/index.js';
import { RELEASES, check, cli, json, mainJs, pkg, run } from './helpers.js';

const BAD = {
  'package.json': pkg('30.1.0', { build: { win: { target: 'nsis' }, mac: { notarize: true, sign: { identity: 'Developer ID Application: A (B)' } }, publish: { provider: 'generic', url: 'http://updates.example.com/a' } } }),
  'src/main.js': mainJs('nodeIntegration: true', 'sandbox: true'),
  'releases.json': RELEASES
};
const GOOD = {
  'package.json': pkg('43.7.7', { build: { win: { sign: { type: 'signtool' } }, mac: { notarize: true, sign: { identity: 'Developer ID Application: A (B)' } }, publish: 'github' } }),
  'src/main.js': mainJs('nodeIntegration: false', 'contextIsolation: true', 'sandbox: true', 'webSecurity: true', 'allowRunningInsecureContent: false'),
  'releases.json': RELEASES
};

// ---- the reports -------------------------------------------------------------------------------------------

test('text report: the project, the settings, the signing, the checks, every finding with file, line and fix, and the gate', async () => {
  const { out, code } = await run(BAD, ['.', '--releases', 'releases.json']);
  assert.equal(code, 1);
  assert.match(out, /^desktop-release-check: \.\nproject: electron\n/);
  assert.match(out, /electron: 30\.1\.0 \(package\.json:\d+\), major 30, latest stable major 44, supported 44, 43, 42 \(releases\.json\)/);
  assert.match(out, /nodeIntegration +true +src\/main\.js:4 {2}UNSAFE/);
  assert.match(out, /webSecurity +not found in source/);
  assert.match(out, /windows {2}electron-builder: not configured/);
  assert.match(out, /\n {2}1 {2}Electron version +fail /);
  assert.match(out, /\nERROR {4}electron-unsupported {2}package\.json:\d+ {2}electron\n {9}electron "30\.1\.0"/);
  assert.match(out, /\n {9}fix: /);
  assert.match(out, /\nGATE: FAIL - 3 errors\n$/);
});

test('text report: a clean project says "no findings" and the gate with the level', async () => {
  const { out, code } = await run(GOOD, ['.', '--releases', 'releases.json', '--fail-on', 'warning']);
  assert.equal(code, 0);
  assert.match(out, /findings: 0 error, 0 warning, 0 info\n\nno findings\n\nGATE: PASS \(--fail-on warning\)\n$/);
  assert.doesNotMatch(out, /S {2,}not found in source/);
});

test('text report: without --releases the Electron version line and the check say it was not checked', async () => {
  const { out } = await run({ ...GOOD }, ['.']);
  assert.match(out, /support not checked \(no --releases file\)/);
  assert.match(out, /1 {2}Electron version +not checked /);
});

test('markdown report: tables for the checks, the settings and the findings, and the gate', async () => {
  const { out } = await run(BAD, ['.', '--releases', 'releases.json', '--format', 'markdown']);
  assert.match(out, /^## desktop-release-check: 3 error, 1 warning/);
  assert.match(out, /\| Check \| Result \| Detail \|/);
  assert.match(out, /\| 1\. Electron version \| \*\*fail\*\* \|/);
  assert.match(out, /\| webPreferences setting \| Where \| Value \|/);
  assert.match(out, /\| nodeIntegration \| src\/main\.js:4 \| \*\*true\*\* \|/);
  assert.match(out, /\| Severity \| Check \| Where \| Message \| Fix \|/);
  assert.match(out, /\*\*Gate failed:\*\* 3 errors\.\n$/);
});

test('markdown report: pipes, angle brackets, ampersands, backslashes and line breaks from the input cannot break a table', () => {
  assert.equal(mdCell('a|b\\c<d>&e\nf'), 'a\\|b\\\\c&lt;d&gt;&amp;e f');
});

test('markdown report: a hostile publish address stays inside its table cell', async () => {
  const url = 'http://example.com/|<img src=x onerror=1>&\nnext';
  const { out } = await run({ ...GOOD, 'package.json': pkg('43.7.7', { build: { ...JSON.parse(JSON.stringify(GOOD['package.json'].build)), publish: { provider: 'generic', url } } }) }, ['.', '--format', 'markdown']);
  const row = out.split('\n').find((l) => l.includes('update-insecure-url'));
  assert.ok(row.includes('\\|&lt;img src=x onerror=1&gt;&amp; next'));
  assert.equal(row.split(/(?<!\\)\|/).length, 7);
});

test('json report: the whole report, every check, setting and finding with its fields', async () => {
  const { out } = await run(BAD, ['.', '--releases', 'releases.json', '--format', 'json']);
  const r = JSON.parse(out);
  assert.equal(r.tool, 'desktop-release-check');
  assert.equal(r.version, VERSION);
  assert.deepEqual(r.project, { path: '.', kinds: ['electron'] });
  assert.equal(r.electron.declared.major, 30);
  assert.deepEqual(r.electron.releases.supported, [44, 43, 42]);
  assert.equal(r.settings.length, 5);
  assert.equal(r.checks.length, 6);
  assert.deepEqual(r.counts, { error: 3, warning: 1, info: 0 });
  assert.deepEqual(Object.keys(r.findings[0]), ['id', 'severity', 'check', 'file', 'line', 'subject', 'message', 'fix', 'source']);
  assert.equal(r.gate.pass, false);
  assert.deepEqual(r.signing.windows[0], { packager: 'electron-builder', state: 'missing', file: 'package.json', line: r.signing.windows[0].line, how: null });
});

test('csv report: a header, one row per finding, RFC 4180 quoting and CRLF line ends', async () => {
  const { out } = await run(BAD, ['.', '--releases', 'releases.json', '--format', 'csv']);
  const lines = out.split('\r\n');
  assert.equal(lines[0], 'severity,id,check,file,line,subject,message,fix');
  assert.equal(lines.length, 6);
  assert.equal(lines.at(-1), '');
  assert.ok(lines[1].startsWith('error,electron-unsupported,1,package.json,'));
  assert.match(lines[1], /"electron ""30\.1\.0"" /);
});

test('csv report: a cell that a spreadsheet would run as a formula gets a leading quote', async () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell(null), '');
  const { out } = await run({ ...GOOD, '=evil.pfx': 'x' }, ['.', '--format', 'csv']);
  assert.match(out, /'=evil\.pfx/);
});

test('safeText: control, direction and separator characters become spaces, and a long text is cut', () => {
  assert.equal(safeText('a\u001b[2Jb\u202ec\u2028d\u0085e'), 'a [2Jb c d e');
  assert.equal(safeText('x'.repeat(400)).length, 300);
  assert.ok(safeText('x'.repeat(400)).endsWith('...'));
});

// ---- the command line --------------------------------------------------------------------------------------

test('exit code 0 when no finding reaches the --fail-on level, and 1 when one does', async () => {
  assert.equal((await run(GOOD, ['.', '--releases', 'releases.json'])).code, 0);
  assert.equal((await run(BAD, ['.', '--releases', 'releases.json'])).code, 1);
});

test('--fail-on warning fails on a warning that --fail-on error lets through', async () => {
  const warn = { ...GOOD, 'package.json': pkg('43.7.7', { build: { win: { sign: false }, mac: GOOD['package.json'].build.mac, publish: 'github' } }) };
  assert.equal((await run(warn, ['.', '--releases', 'releases.json'])).code, 0);
  const strict = await run(warn, ['.', '--releases', 'releases.json', '--fail-on', 'warning']);
  assert.equal(strict.code, 1);
  assert.match(strict.out, /GATE: FAIL - 1 warning\n/);
});

test('info findings never fail the run, even with --fail-on warning', async () => {
  const info = { ...GOOD, 'package.json': pkg('43.7.7', { build: { win: { sign: { type: 'azure' } }, mac: GOOD['package.json'].build.mac } }) };
  const r = await run(info, ['.', '--releases', 'releases.json', '--fail-on', 'warning']);
  assert.equal(r.code, 0);
  assert.match(r.out, /INFO {5}no-auto-update/);
});

test('--platforms windows leaves macOS out, with a line in the report', async () => {
  const { out } = await run(BAD, ['.', '--releases', 'releases.json', '--platforms', 'windows']);
  assert.match(out, /macos {4}skipped \(--platforms\)/);
  assert.doesNotMatch(out, /macos-signing/);
});

test('usage errors exit with 2 and say what is wrong', async () => {
  const cases = [
    [[], /give the path of the project folder/],
    [['a', 'b'], /give one project folder, not b as well/],
    [['.', '--format', 'xml'], /unknown format xml/],
    [['.', '--fail-on', 'info'], /--fail-on takes error or warning, not info/],
    [['.', '--platforms', 'linux'], /--platforms takes windows, macos or both/],
    [['.', '--platforms', ''], /an empty value/],
    [['.', '--releases'], /--releases needs a value/],
    [['.', '--releases', '--format'], /--releases needs a value/],
    [['.', '--nope'], /unknown argument --nope/],
    [['-'], /standard input is not supported/],
    [['https://example.com/app'], /never fetches a URL/],
    [['.', '--releases', 'https://releases.electronjs.org/releases.json'], /never fetches a URL/]
  ];
  for (const [argv, pattern] of cases) {
    const r = await cli(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, pattern);
    assert.match(r.err, /Usage: desktop-release-check/);
    assert.equal(r.out, '');
  }
});

test('input errors exit with 2: a missing folder, no project, a missing releases file, a releases file that is not JSON', async () => {
  assert.match((await run(GOOD, ['nothing'])).err, /nothing: no such folder/);
  assert.equal((await run(GOOD, ['nothing'])).code, 2);
  assert.equal((await run({ 'readme.txt': 'x' }, ['.'])).code, 2);
  const missing = await run(GOOD, ['.', '--releases', 'absent.json']);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /absent\.json: no such file/);
  const bad = await run({ ...GOOD, 'releases.json': '[1,' }, ['.', '--releases', 'releases.json']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /releases\.json: line 1/);
});

test('--help prints the usage and --version the version, both with exit code 0', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.equal(help.out, USAGE);
  assert.match(help.out, /releases\.electronjs\.org\/releases\.json/);
  assert.match(help.out, /Checks: .*electron-unsupported.*committed-key-file/);
  const version = await cli(['--version']);
  assert.equal(version.out, `${VERSION}\n`);
  assert.equal(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version, VERSION);
});

test('arguments: the defaults and every option are parsed', () => {
  assert.deepEqual(parseArgs(['p']), { project: 'p', releases: null, platforms: ['windows', 'macos'], format: 'text', failOn: 'error', help: false, version: false });
  const o = parseArgs(['p', '--releases', 'r.json', '--platforms', 'macos,windows', '--format', 'csv', '--fail-on', 'warning']);
  assert.deepEqual([o.releases, o.platforms, o.format, o.failOn], ['r.json', ['windows', 'macos'], 'csv', 'warning']);
});

test('the error message of a hostile folder name is cleaned before it is printed', async () => {
  const r = await cli(['no\u001b[31msuch\u202efolder']);
  assert.equal(r.code, 2);
  assert.equal(/[\u0000-\u0008\u001b\u202e]/.test(r.err), false);
});

test('the report is the same on every format for the same files, and paths use forward slashes', async () => {
  const files = { ...BAD, 'src/deep/win.js': mainJs('sandbox: false') };
  const text = (await run(files, ['.', '--releases', 'releases.json'])).out;
  const csv = (await run(files, ['.', '--releases', 'releases.json', '--format', 'csv'])).out;
  assert.ok(text.includes('src/deep/win.js:'));
  assert.ok(csv.includes('src/deep/win.js'));
  assert.equal(/\\/.test(text.replace(/\\n/g, '')), false);
});

// ---- the code itself ---------------------------------------------------------------------------------------

test('the tool opens no connection and runs no program: no module of src imports a network or process module', async () => {
  const dir = new URL('../src/', import.meta.url);
  for (const name of await readdir(dir)) {
    const text = await readFile(new URL(name, dir), 'utf8');
    assert.doesNotMatch(text, /from 'node:(?:http|https|http2|net|tls|dns|dgram|child_process|worker_threads|vm|cluster)'/, name);
    assert.doesNotMatch(text, /(?<![.\w])(?:fetch|XMLHttpRequest|WebSocket|eval|spawn|exec|execFile)\s*\(/, name);
    assert.doesNotMatch(text, /require\(/, name);
  }
});

test('the tool writes nothing to disk: no module of src imports a write function', async () => {
  const dir = new URL('../src/', import.meta.url);
  for (const name of await readdir(dir)) {
    const text = await readFile(new URL(name, dir), 'utf8');
    assert.doesNotMatch(text, /\b(?:writeFile|appendFile|unlink|rm|rename|mkdir|createWriteStream|copyFile|symlink)\b/, name);
  }
});

test('source files stay ASCII and the package has no dependencies', async () => {
  const dir = new URL('../src/', import.meta.url);
  for (const name of await readdir(dir)) assert.equal(/[^\x00-\x7f]/.test(await readFile(new URL(name, dir), 'utf8')), false, name);
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(manifest.engines.node, '>=22');
  assert.equal(manifest.homepage, 'https://innerluxes.dev/application/development/desktop');
});

test('the README closes with the Background link to the desktop page', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const background = readme.slice(readme.indexOf('## Background'));
  assert.ok(background.includes('[desktop application development services](https://innerluxes.dev/application/development/desktop)'));
});

test('the example reports match what the examples produce', async () => {
  const dir = resolve(import.meta.dirname, '..', 'examples', 'output');
  const names = (await readdir(dir)).sort();
  assert.deepEqual(names, ['harbor-notes.csv', 'harbor-notes.json', 'harbor-notes.md', 'harbor-notes.txt']);
  assert.equal(JSON.parse(await readFile(resolve(dir, 'harbor-notes.json'), 'utf8')).counts.error, 5);
});

test('check() helper: a clean project passes with the fixture releases', async () => {
  const report = await check({ 'package.json': GOOD['package.json'], 'src/main.js': GOOD['src/main.js'] });
  assert.equal(report.gate.pass, true);
  assert.ok(toText(report).length > 0 && toMarkdown(report).length > 0 && toJson(report).length > 0 && toCsv(report).length > 0);
  assert.equal(json({ a: 1 }), '{\n  "a": 1\n}\n');
});
