import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBuilder, analyzeForge, analyzeTauri, judgeVersion, parseJson, parseVersionSpec, parseYaml, publishSettings, readCargo, releasesFromNode, scanSource, stableReleases, tokenize } from '../src/index.js';
import { RELEASES } from './helpers.js';

const node = (value) => parseJson(JSON.stringify(value), 'test');
const releases = () => stableReleases(RELEASES);
const settings = (text) => scanSource(text).objects.flatMap((o) => o.props.map((p) => `${p.key}=${p.literal ? p.value : 'expr'}`));

// ---- the version -------------------------------------------------------------------------------------------

test('version spec: an exact version, a caret range, a tilde range and a partial version', () => {
  assert.deepEqual(parseVersionSpec('43.7.7'), { ok: true, major: 43, minor: 7, patch: 7, operator: 'exact', floating: false, prerelease: false });
  assert.equal(parseVersionSpec('^43.1.0').operator, 'caret');
  assert.equal(parseVersionSpec('^43.1.0').floating, true);
  assert.equal(parseVersionSpec('~43.1.2').operator, 'tilde');
  assert.equal(parseVersionSpec('~43.1.2').floating, false);
  assert.equal(parseVersionSpec('43').floating, true);
  assert.equal(parseVersionSpec('43.x').minor, null);
  assert.equal(parseVersionSpec('v42.0.0').major, 42);
  assert.equal(parseVersionSpec('44.0.0-beta.3').prerelease, true);
});

test('version spec: tags, operators, paths, addresses and long text are not read', () => {
  for (const spec of ['latest', '>=30', '30 || 31', 'file:../electron', 'npm:electron@30', 'github:electron/electron', '', '*', '1.2.3.4', 'x'.repeat(5000), '1'.repeat(5000)]) {
    assert.equal(parseVersionSpec(spec).ok, false, spec.slice(0, 20));
  }
});

test('version spec: a very long near miss is refused quickly, with no backtracking', () => {
  const started = Date.now();
  parseVersionSpec(`43.0.0-${'a-'.repeat(49)}!`);
  parseVersionSpec(`^${'4'.repeat(99)}`);
  assert.ok(Date.now() - started < 200);
});

test('releases: only stable versions of three numbers count, and prereleases are left out', () => {
  const stable = releases();
  assert.deepEqual(stable.majors, [44, 43, 42, 41, 30]);
  assert.equal(stable.latestMinor.get(43), 7);
  assert.equal(stable.latestMinor.get(44), 1);
  assert.equal(stable.majors.includes(46), false);
  assert.equal(stable.majors.includes(45), false);
});

test('support window: the latest three majors are supported, anything older is not', () => {
  const r = releases();
  const at = (major, minor = null, floating = false) => judgeVersion({ major, minor, floating }, r);
  assert.equal(at(44, 1).state, 'supported');
  assert.equal(at(42, 3).state, 'supported');
  assert.equal(at(41, 5).state, 'unsupported');
  assert.equal(at(30, 1).state, 'unsupported');
  assert.deepEqual(at(30, 1).supported, [44, 43, 42]);
});

test('support window: a version below the latest minor of its line is flagged, a floating range is not', () => {
  const r = releases();
  const exact = judgeVersion({ major: 43, minor: 0, floating: false }, r);
  assert.equal(exact.state, 'not-latest-minor');
  assert.equal(exact.latestMinor, 7);
  assert.equal(judgeVersion({ major: 43, minor: 7, floating: false }, r).state, 'supported');
  assert.equal(judgeVersion({ major: 43, minor: 0, floating: true }, r).state, 'supported');
});

test('support window: a major newer than any stable release is reported as ahead, not as unsupported', () => {
  assert.equal(judgeVersion({ major: 45, minor: 0, floating: false }, releases()).state, 'ahead');
});

test('releases file: it must be an array with versions, and say what is wrong when it is not', () => {
  assert.throws(() => releasesFromNode(node({ version: '1.0.0' })), /must be a JSON array/);
  assert.throws(() => releasesFromNode(node([])), /no entry with a "version"/);
  assert.throws(() => releasesFromNode(node([{ version: '45.0.0-alpha.1' }])), /no stable release/);
  assert.deepEqual(releasesFromNode(node([{ version: '10.0.0' }, 5, { name: 'x' }])).majors, [10]);
});

// ---- YAML --------------------------------------------------------------------------------------------------

const yaml = (text) => JSON.parse(JSON.stringify(parseYaml(text, 'y'), (k, v) => (k === 'line' ? undefined : v)));

test('yaml: mappings, nested mappings, comments and the scalar kinds', () => {
  const root = yaml('# top\nappId: com.example.app # trailing\nwin:\n  sign: false\n  count: 3\n  empty:\nname: "quoted: yes"\nother: \'it\'\'s\'\n');
  const get = (key) => root.props.find((p) => p.key === key).value;
  assert.equal(get('appId').value, 'com.example.app');
  assert.equal(get('win').props.find((p) => p.key === 'sign').value.value, false);
  assert.equal(get('win').props.find((p) => p.key === 'count').value.value, 3);
  assert.equal(get('win').props.find((p) => p.key === 'empty').value.t, 'null');
  assert.equal(get('name').value, 'quoted: yes');
  assert.equal(get('other').value, "it's");
});

test('yaml: sequences of scalars and of mappings, with the lines of the values', () => {
  const root = parseYaml('mac:\n  target:\n    - dmg\n    - zip\npublish:\n  - provider: github\n    protocol: https\n  - provider: generic\n    url: http://example.com\n', 'y');
  const mac = root.props[0].value.props[0].value;
  assert.deepEqual(mac.items.map((i) => i.value), ['dmg', 'zip']);
  const publish = root.props[1].value;
  assert.equal(publish.items.length, 2);
  assert.equal(publish.items[1].props[1].value.value, 'http://example.com');
  assert.equal(publish.items[1].props[1].line, 9);
});

test('yaml: a sequence at the same indent as its key, a flow sequence and a document start', () => {
  const root = yaml('---\nfiles:\n- a\n- b\nlist: [x, "y, z", 3]\nnone: []\n');
  assert.deepEqual(root.props[0].value.items.map((i) => i.value), ['a', 'b']);
  assert.deepEqual(root.props[1].value.items.map((i) => i.value), ['x', 'y, z', 3]);
  assert.equal(root.props[2].value.items.length, 0);
});

test('yaml: a url with a hash or a colon inside a value is one string', () => {
  const root = yaml('url: https://example.com/a#b\nidentity: Developer ID Application: Example Ltd (ABCDE12345)\n');
  assert.equal(root.props[0].value.value, 'https://example.com/a#b');
  assert.equal(root.props[1].value.value, 'Developer ID Application: Example Ltd (ABCDE12345)');
});

test('yaml: what is not in the subset is refused with its line', () => {
  const refuse = (text, pattern) => assert.throws(() => parseYaml(text, 'y'), pattern);
  refuse('a:\n\tb: 1\n', /line 2: a tab in the indentation/);
  refuse('a: &x 1\n', /line 1: "&" at the start of a value/);
  refuse('a: *x\n', /line 1: "\*" at the start/);
  refuse('a: !tag 1\n', /line 1: "!" at the start/);
  refuse('a: |\n  text\n', /line 1: "\|" at the start/);
  refuse('a: 1\n---\nb: 2\n', /line 2: more than one document/);
  refuse('a: {b: 1}\n', /flow mapping with content/);
  refuse('a: [[1]]\n', /flow sequence inside a flow sequence/);
  refuse('a: 1\na: 2\n', /line 2: the key "a" appears twice/);
  refuse('a: "open\n', /not closed/);
  refuse('a: 1\n  b: 2\n', /line 2: unexpected indentation/);
  refuse('<<: x\n', /this kind of key/);
  refuse('- - a\n', /sequence inside a sequence/);
});

test('yaml: nesting deeper than the limit and a very long line are refused', () => {
  const deep = Array.from({ length: 80 }, (_, i) => `${' '.repeat(i * 2)}k${i}:`).join('\n');
  assert.throws(() => parseYaml(deep, 'y'), /nested more than 64 deep/);
  assert.throws(() => parseYaml(`a: ${'x'.repeat(5000)}\n`, 'y'), /longer than 4000/);
  assert.throws(() => parseYaml('a: 1\n'.repeat(10), 'y', { limits: { maxDepth: 64, maxLines: 5, maxLineLength: 100 } }), /more than 5 lines/);
});

test('yaml: an empty file or one with only comments is an empty value', () => {
  assert.equal(parseYaml('', 'y').t, 'null');
  assert.equal(parseYaml('# nothing\n\n', 'y').t, 'null');
});

// ---- the source scanner ------------------------------------------------------------------------------------

test('scan: webPreferences with literal values, quoted keys and a trailing comma', () => {
  assert.deepEqual(settings("new BrowserWindow({ webPreferences: { nodeIntegration: true, 'contextIsolation': false, sandbox: true, } })"), ['nodeIntegration=true', 'contextIsolation=false', 'sandbox=true']);
});

test('scan: the line of every property is kept', () => {
  const { objects } = scanSource('a();\nconst w = {\n  webPreferences: {\n    nodeIntegration: true,\n\n    webSecurity: false\n  }\n};\n');
  assert.deepEqual(objects[0].props.map((p) => [p.key, p.line]), [['nodeIntegration', 4], ['webSecurity', 6]]);
});

test('scan: an expression, a shorthand property and a spread are not literals', () => {
  assert.deepEqual(settings('x = { webPreferences: { nodeIntegration: isDev, sandbox, ...base, contextIsolation: !legacy, webSecurity: false } }'), ['nodeIntegration=expr', 'sandbox=expr', '...=expr', 'contextIsolation=expr', 'webSecurity=false']);
  assert.equal(scanSource('x = { webPreferences: { ...base } }').objects[0].props[0].spread, true);
});

test('scan: comments, strings, templates and regular expressions are not code', () => {
  const text = [
    '// webPreferences: { nodeIntegration: true }',
    '/* webPreferences: { sandbox: false } */',
    "const a = 'webPreferences: { webSecurity: false }';",
    'const b = `webPreferences: { nodeIntegration: ${x ? true : false} }`;',
    'const c = /webPreferences: [{]/;',
    'real = { webPreferences: { contextIsolation: true } };'
  ].join('\n');
  assert.deepEqual(settings(text), ['contextIsolation=true']);
});

test('scan: an object assigned with = and nested objects and calls inside the value', () => {
  assert.deepEqual(settings('opts.webPreferences = { preload: join(a, { b: 1 }), nodeIntegration: false, list: [1, { sandbox: false }] };'), ['preload=expr', 'nodeIntegration=false', 'list=expr']);
});

test('scan: a comparison is not a setting, and webPreferences without an object is skipped', () => {
  assert.deepEqual(scanSource('if (webPreferences == { a: 1 }) {}\nuse(webPreferences);\nconst webPreferences2 = { nodeIntegration: true };').objects, []);
});

test('scan: two windows give two objects', () => {
  const { objects } = scanSource('a = { webPreferences: { sandbox: false } };\nb = { webPreferences: { sandbox: true } };\n');
  assert.equal(objects.length, 2);
});

test('scan: an unclosed object and a very deep input are handled without a hang', () => {
  assert.deepEqual(scanSource('x = { webPreferences: { nodeIntegration: true ').objects, []);
  const started = Date.now();
  scanSource('('.repeat(200000));
  scanSource(`x = { webPreferences: { a: ${'['.repeat(100000)} } }`);
  scanSource(`${'`${'.repeat(5000)}`);
  scanSource('/'.repeat(100000));
  scanSource('"\\'.repeat(100000));
  assert.ok(Date.now() - started < 3000);
});

test('scan: the token limit stops a very large input and says so', () => {
  const result = scanSource('a;'.repeat(50), { maxTokens: 20, maxObjectTokens: 100, maxTemplateDepth: 4 });
  assert.equal(result.truncated, true);
  assert.equal(tokenize('a b c').tokens.length, 3);
});

// ---- electron-builder, Forge, Tauri --------------------------------------------------------------------------

test('electron-builder Windows: win.sign as an object with a type, false, null and unset', () => {
  assert.equal(analyzeBuilder(node({ win: { sign: { type: 'signtool' } } })).windows.state, 'configured');
  assert.equal(analyzeBuilder(node({ win: { sign: { type: 'azure' } } })).windows.how, 'win.sign type azure');
  assert.equal(analyzeBuilder(node({ win: { sign: false } })).windows.state, 'disabled');
  assert.equal(analyzeBuilder(node({ win: { sign: null } })).windows.state, 'disabled');
  assert.equal(analyzeBuilder(node({ win: { target: 'nsis' } })).windows.state, 'missing');
  assert.equal(analyzeBuilder(node({})).windows.state, 'missing');
  assert.equal(analyzeBuilder(node({ win: { sign: { type: 'other' } } })).windows.state, 'missing');
  assert.equal(analyzeBuilder(node({ win: { sign: './customSign.js' } })).windows.state, 'configured');
});

test('electron-builder Windows: the older signtoolOptions and azureSignOptions keys still count', () => {
  assert.equal(analyzeBuilder(node({ win: { signtoolOptions: { certificateFile: 'x' } } })).windows.how, 'win.signtoolOptions');
  assert.equal(analyzeBuilder(node({ win: { azureSignOptions: {} } })).windows.state, 'configured');
});

test('electron-builder macOS: identity named, null, "-" and unset, in mac.sign and in the older flat layout', () => {
  const mac = (m) => analyzeBuilder(node({ mac: m })).mac;
  assert.equal(mac({ sign: { identity: 'Developer ID Application: A (B)' } }).state, 'configured');
  assert.equal(mac({ sign: { identity: null } }).state, 'disabled');
  assert.equal(mac({ sign: null }).state, 'disabled');
  assert.equal(mac({ sign: { identity: '-' } }).state, 'adhoc');
  assert.equal(mac({ sign: { hardenedRuntime: true } }).state, 'missing');
  assert.equal(mac({ identity: 'Developer ID Application: A (B)' }).state, 'configured');
  assert.equal(mac({ identity: 'Developer ID Application: A (B)' }).how, 'mac.identity');
  assert.equal(mac({ identity: null }).state, 'disabled');
  assert.equal(mac({ target: 'dmg' }).state, 'missing');
});

test('electron-builder macOS: hardenedRuntime and notarize', () => {
  const a = (m) => analyzeBuilder(node({ mac: m }));
  assert.equal(a({ sign: { hardenedRuntime: false } }).hardenedRuntime.state, 'off');
  assert.equal(a({ hardenedRuntime: false }).hardenedRuntime.state, 'off');
  assert.equal(a({ sign: { hardenedRuntime: true } }).hardenedRuntime.state, 'on');
  assert.equal(a({}).hardenedRuntime.state, 'default');
  assert.equal(a({ notarize: true }).notarize.state, 'on');
  assert.equal(a({ notarize: false }).notarize.state, 'off');
  assert.equal(a({}).notarize.state, 'missing');
});

test('electron-builder publish: plain http in url, endpoint, publicUrl and protocol, at any level', () => {
  const p = (c) => publishSettings(node(c));
  assert.equal(p({ publish: { provider: 'generic', url: 'http://example.com/u' } }).insecure[0].key, 'publish.url');
  assert.equal(p({ win: { publish: [{ provider: 's3', endpoint: 'HTTP://s3.example.com' }] } }).insecure[0].key, 'win.publish.endpoint');
  assert.equal(p({ publish: { provider: 'r2', publicUrl: ' http://cdn.example.com' } }).insecure[0].key, 'publish.publicUrl');
  assert.equal(p({ mac: { publish: { provider: 'github', protocol: 'http' } } }).insecure[0].value, 'http');
  assert.deepEqual(p({ publish: { provider: 'generic', url: 'https://example.com/u' } }).insecure, []);
  assert.equal(p({ publish: 'github' }).present, true);
  assert.equal(p({ appId: 'x', productName: 'http://not-a-publish-key.example.com' }).present, false);
  assert.deepEqual(p({ extraMetadata: { url: 'http://example.com' } }).insecure, []);
});

test('electron-builder publish: a publish of null is no update setup, and a very deep config is cut off', () => {
  assert.equal(publishSettings(node({ publish: null })).present, false);
  let deep = { publish: { url: 'http://deep.example.com' } };
  for (let i = 0; i < 30; i += 1) deep = { a: deep };
  assert.equal(publishSettings(node(deep)).present, false);
});

test('Electron Forge: osxSign, osxNotarize, windowsSign in packagerConfig and certificateFile in a maker', () => {
  const f = (c) => analyzeForge(node(c));
  assert.equal(f({ packagerConfig: { osxSign: {}, osxNotarize: { appleId: 'x' } } }).mac.state, 'configured');
  assert.equal(f({ packagerConfig: { osxSign: {}, osxNotarize: { appleId: 'x' } } }).notarize.state, 'on');
  assert.equal(f({ packagerConfig: { osxSign: {} } }).notarize.state, 'missing');
  assert.equal(f({ packagerConfig: { osxSign: false } }).mac.state, 'missing');
  assert.equal(f({ packagerConfig: { windowsSign: { x: 1 } } }).windows.state, 'configured');
  assert.equal(f({ makers: [{ name: 'squirrel', config: { certificateFile: './cert.pfx' } }] }).windows.how, 'makers[].config.certificateFile');
  assert.equal(f({ makers: [{ name: 'zip' }] }).windows.state, 'missing');
  assert.equal(f({}).mac.state, 'missing');
});

test('Tauri: signing and updater settings of the version 2 layout', () => {
  const t = analyzeTauri(node({ bundle: { windows: { certificateThumbprint: 'AB' }, macOS: { signingIdentity: 'Developer ID Application: A (B)', hardenedRuntime: false } }, plugins: { updater: { pubkey: 'k', endpoints: ['https://a', 'http://b'], dangerousInsecureTransportProtocol: true } } }));
  assert.equal(t.windows.state, 'configured');
  assert.equal(t.mac.state, 'configured');
  assert.equal(t.hardenedRuntime.state, 'off');
  assert.equal(t.updater.pubkey, 'set');
  assert.equal(t.updater.endpoints.length, 2);
  assert.ok(t.updater.insecureTransport);
});

test('Tauri: null and empty values are not settings, "-" is ad hoc, and a missing pubkey is missing', () => {
  const t = analyzeTauri(node({ bundle: { windows: { certificateThumbprint: null, signCommand: ' ' }, macOS: { signingIdentity: '-' } }, plugins: { updater: { pubkey: '', endpoints: [] } } }));
  assert.equal(t.windows.state, 'missing');
  assert.equal(t.mac.state, 'adhoc');
  assert.equal(t.updater.present, true);
  assert.equal(t.updater.pubkey, 'missing');
  assert.equal(analyzeTauri(node({ bundle: { macOS: { signingIdentity: null } } })).mac.state, 'missing');
});

test('Tauri: the version 1 layout is recognized by the tauri key and the missing bundle key', () => {
  assert.equal(analyzeTauri(node({ tauri: { bundle: {} } })).layout, 'v1');
  assert.equal(analyzeTauri(node({ tauri: {}, bundle: {} })).layout, 'v2');
  assert.equal(analyzeTauri(node({ productName: 'x' })).layout, 'v2');
});

test('Cargo.toml: the Tauri version as a string or in a table, and the updater plugin', () => {
  assert.deepEqual(readCargo('[dependencies]\ntauri = "2"\n').tauri, { spec: '2', major: 2, line: 2 });
  assert.equal(readCargo('tauri = { version = "1.5", features = ["x"] }\n').tauri.major, 1);
  assert.equal(readCargo('tauri = { path = "../tauri" }\n').tauri.major, null);
  assert.equal(readCargo('tauri-build = "2"\n').tauri, null);
  assert.deepEqual(readCargo('a = 1\ntauri-plugin-updater = "2"\n').updaterPlugin, { line: 2 });
  assert.equal(readCargo(`tauri = ${'x'.repeat(100000)}\n`).tauri.major, null);
});
