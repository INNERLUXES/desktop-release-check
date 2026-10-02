import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkProject } from '../src/index.js';
import { FAKE_CERT_PEM, FAKE_PRIVATE_PEM, RELEASES, check, find, ids, json, lineOf, mainJs, pkg, withFiles } from './helpers.js';

const SAFE = mainJs('nodeIntegration: false', 'contextIsolation: true', 'sandbox: true', 'webSecurity: true', 'allowRunningInsecureContent: false');
const SIGNED = {
  win: { sign: { type: 'signtool', certificateSubjectName: 'Example Ltd' } },
  mac: { notarize: true, sign: { identity: 'Developer ID Application: Example Ltd (ABCDE12345)', hardenedRuntime: true } },
  publish: { provider: 'generic', url: 'https://updates.example.com/app' }
};
const good = (overrides = {}) => ({ 'package.json': pkg('43.7.7', { build: SIGNED }), 'src/main.js': SAFE, ...overrides });

// ---- 1. the Electron version -----------------------------------------------------------------------------------

test('electron version: a version outside the latest three majors is an error with the file and line', async () => {
  const text = json(pkg('30.1.0', { build: SIGNED }));
  const report = await check(good({ 'package.json': text }));
  const [f] = find(report, 'electron-unsupported');
  assert.equal(f.severity, 'error');
  assert.equal(f.file, 'package.json');
  assert.equal(f.line, lineOf(text, '"electron"'));
  assert.match(f.message, /"The latest three stable major versions are supported by the Electron team"/);
  assert.match(f.message, /44, 43, 42/);
  assert.equal(report.checks[0].result, 'fail');
  assert.equal(report.gate.pass, false);
});

test('electron version: a supported major at the latest minor passes', async () => {
  const report = await check(good());
  assert.deepEqual(ids(report), []);
  assert.equal(report.checks[0].result, 'pass');
  assert.equal(report.electron.state, 'supported');
  assert.equal(report.electron.declared.major, 43);
});

test('electron version: a supported major below the latest minor is a warning', async () => {
  const report = await check(good({ 'package.json': json(pkg('43.0.0', { build: SIGNED })) }));
  const [f] = find(report, 'electron-not-latest-minor');
  assert.equal(f.severity, 'warning');
  assert.match(f.message, /43\.7/);
  assert.match(f.message, /We only support the latest minor release for each stable release series/);
  assert.equal(report.checks[0].result, 'warn');
});

test('electron version: a caret range follows the latest minor, a tilde range does not', async () => {
  assert.deepEqual(ids(await check(good({ 'package.json': json(pkg('^43.0.0', { build: SIGNED })) }))), []);
  assert.deepEqual(ids(await check(good({ 'package.json': json(pkg('~43.0.0', { build: SIGNED })) }))), ['electron-not-latest-minor']);
});

test('electron version: the dependency can be in dependencies, and devDependencies wins when both name it', async () => {
  const inDeps = await check(good({ 'package.json': json({ name: 'x', main: 'src/main.js', dependencies: { electron: '30.0.0' }, build: SIGNED }) }));
  assert.deepEqual(ids(inDeps), ['electron-unsupported']);
  const both = await check(good({ 'package.json': json({ name: 'x', main: 'src/main.js', dependencies: { electron: '30.0.0' }, devDependencies: { electron: '43.7.7' }, build: SIGNED }) }));
  assert.deepEqual(ids(both), []);
});

test('electron version: without a releases file the check says "not checked", never pass', async () => {
  const report = await check(good(), { releases: null });
  assert.deepEqual(ids(report), ['electron-support-not-checked']);
  assert.equal(report.checks[0].result, 'not checked');
  assert.match(report.findings[0].message, /Electron support was not checked/);
  assert.match(report.findings[0].fix, /releases\.electronjs\.org\/releases\.json/);
  assert.equal(report.electron.releases, null);
  assert.equal(report.gate.pass, true);
});

test('electron version: a tag or a range the tool does not read is info, and the support is not claimed', async () => {
  for (const spec of ['latest', '>=40', 'file:../electron']) {
    const report = await check(good({ 'package.json': json(pkg(spec, { build: SIGNED })) }));
    assert.deepEqual(ids(report), ['electron-version-unknown'], spec);
    assert.equal(report.electron.state, 'not read');
  }
  const notString = await check(good({ 'package.json': json(pkg(43, { build: SIGNED })) }));
  assert.deepEqual(ids(notString), ['electron-version-unknown']);
});

test('electron version: a major newer than every stable release is noted, not judged', async () => {
  const report = await check(good({ 'package.json': json(pkg('50.0.0', { build: SIGNED })) }));
  assert.deepEqual(ids(report), []);
  assert.equal(report.electron.state, 'ahead');
  assert.match(report.notes[0], /newer than the newest stable release/);
});

test('electron version: a releases file that is missing, not JSON or not a list stops the run', async () => {
  await assert.rejects(check(good(), { releases: 'nothing.json' }), /nothing\.json: no such file/);
  await assert.rejects(withFiles({ 'package.json': json(pkg()), 'r.json': '{ nope' }, (dir) => checkProject('.', { base: dir, releases: 'r.json' })), /r\.json: line 1/);
  await assert.rejects(withFiles({ 'package.json': json(pkg()), 'r.json': '{}' }, (dir) => checkProject('.', { base: dir, releases: 'r.json' })), /must be a JSON array/);
});

// ---- 2. webPreferences -----------------------------------------------------------------------------------------

const UNSAFE = [
  ['nodeIntegration: true', 'insecure-node-integration', '2. Do not enable Node.js integration for remote content'],
  ['contextIsolation: false', 'insecure-context-isolation', '3. Enable Context Isolation'],
  ['sandbox: false', 'insecure-sandbox', '4. Enable process sandboxing'],
  ['webSecurity: false', 'insecure-web-security', '6. Do not disable webSecurity'],
  ['allowRunningInsecureContent: true', 'insecure-content', '8. Do not enable allowRunningInsecureContent']
];

for (const [line, id, item] of UNSAFE) {
  test(`webPreferences: ${line} is an error that names item "${item}" of the security page`, async () => {
    const report = await check(good({ 'src/main.js': mainJs('width: 800', line) }));
    const [f] = find(report, id);
    assert.equal(f.severity, 'error');
    assert.equal(f.file, 'src/main.js');
    assert.equal(f.line, 5);
    assert.ok(f.message.includes(`"${item}"`));
    assert.match(f.fix, /electronjs\.org\/docs\/latest\/tutorial\/security/);
    assert.equal(report.checks[1].result, 'fail');
  });
}

test('webPreferences: the safe value of each setting passes, and a setting not written is "not found in source"', async () => {
  const report = await check(good({ 'src/main.js': mainJs('sandbox: true', 'contextIsolation: true') }));
  assert.deepEqual(ids(report), []);
  const by = Object.fromEntries(report.settings.map((s) => [s.setting, s]));
  assert.equal(by.sandbox.status, 'found');
  assert.equal(by.nodeIntegration.status, 'not found in source');
  assert.equal(by.webSecurity.status, 'not found in source');
  assert.equal(by.allowRunningInsecureContent.locations.length, 0);
  assert.match(report.checks[1].detail, /3 not found in source/);
  assert.equal(by.contextIsolation.defaultSince.major, 12);
});

test('webPreferences: nothing found at all is info, and the check says "not checked", never pass', async () => {
  const report = await check(good({ 'src/main.js': 'console.log("no window");\n' }));
  assert.deepEqual(ids(report), ['web-preferences-not-found']);
  assert.equal(report.checks[1].result, 'not checked');
  assert.equal(report.source.objects, 0);
  const noSource = await check({ 'package.json': pkg('43.7.7', { build: SIGNED }) });
  assert.deepEqual(ids(noSource), ['web-preferences-not-found']);
});

test('webPreferences: a value written as an expression is info and is not judged', async () => {
  const report = await check(good({ 'src/main.js': mainJs('nodeIntegration: isDev', 'contextIsolation: true') }));
  const [f] = find(report, 'setting-not-literal');
  assert.equal(f.severity, 'info');
  assert.equal(f.line, 4);
  assert.equal(find(report, 'insecure-node-integration').length, 0);
  assert.equal(report.settings[0].locations[0].value, 'expression');
});

test('webPreferences: a setting in a comment, a string or a template is not read', async () => {
  const text = `// nodeIntegration: true\nconst s = "webPreferences: { sandbox: false }";\n${mainJs('contextIsolation: true')}`;
  const report = await check(good({ 'src/main.js': text }));
  assert.deepEqual(ids(report), []);
});

test('webPreferences: every window is read, in every source file under src, in path order', async () => {
  const report = await check(good({ 'src/main.js': mainJs('sandbox: true'), 'src/windows/settings.ts': mainJs('sandbox: false'), 'src/windows/about.tsx': mainJs('webSecurity: false'), 'src/readme.md': 'sandbox: false' }));
  assert.deepEqual(find(report, 'insecure-sandbox').map((f) => f.file), ['src/windows/settings.ts']);
  assert.deepEqual(find(report, 'insecure-web-security').map((f) => f.file), ['src/windows/about.tsx']);
  assert.equal(report.source.files, 3);
  assert.equal(report.source.objects, 3);
  assert.equal(report.source.filesWithObjects, 3);
});

test('webPreferences: the main entry outside src is read too, and one inside the project only', async () => {
  const report = await check({ 'package.json': pkg('43.7.7', { main: 'app/main.js', build: SIGNED }), 'app/main.js': mainJs('sandbox: false') });
  assert.deepEqual(find(report, 'insecure-sandbox').map((f) => f.file), ['app/main.js']);
  const outside = await check({ 'package.json': pkg('43.7.7', { main: '../elsewhere.js', build: SIGNED }) });
  assert.deepEqual(ids(outside), ['web-preferences-not-found']);
});

test('webPreferences: node_modules under src and files of other types are left alone', async () => {
  const report = await check(good({ 'src/node_modules/x/index.js': mainJs('sandbox: false'), 'src/data.json': '{ "webPreferences": { "sandbox": false } }' }));
  assert.deepEqual(ids(report), []);
});

// ---- 3 and 4. signing and notarization ------------------------------------------------------------------------

test('Windows signing: not configured in electron-builder is a warning that cites the Microsoft page', async () => {
  const text = json(pkg('43.7.7', { build: { ...SIGNED, win: { target: 'nsis' } } }));
  const report = await check(good({ 'package.json': text }));
  const [f] = find(report, 'windows-signing-missing');
  assert.equal(f.severity, 'warning');
  assert.equal(f.file, 'package.json');
  assert.equal(f.line, lineOf(text, '"win"'));
  assert.ok(f.message.includes('https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options'));
  assert.match(f.message, /WIN_CSC_LINK/);
  assert.equal(report.checks[2].result, 'warn');
  assert.equal(report.signing.windows[0].state, 'missing');
});

test('Windows signing: win.sign false is a warning of its own, a typed win.sign passes', async () => {
  const text = json(pkg('43.7.7', { build: { ...SIGNED, win: { sign: false } } }));
  const off = await check(good({ 'package.json': text }));
  assert.deepEqual(ids(off), ['windows-signing-disabled']);
  assert.equal(off.findings[0].line, lineOf(text, '"sign": false'));
  for (const type of ['signtool', 'hsm', 'pkcs11', 'azure']) {
    const report = await check(good({ 'package.json': json(pkg('43.7.7', { build: { ...SIGNED, win: { sign: { type } } } })) }));
    assert.deepEqual(ids(report), [], type);
  }
});

test('macOS: no identity, a null identity and the ad hoc identity are three different warnings', async () => {
  const mac = (m) => check(good({ 'package.json': json(pkg('43.7.7', { build: { ...SIGNED, mac: m } })) }));
  assert.deepEqual(ids(await mac({ notarize: true })), ['macos-signing-missing']);
  assert.deepEqual(ids(await mac({ notarize: true, sign: { identity: null } })), ['macos-signing-disabled']);
  assert.deepEqual(ids(await mac({ notarize: true, sign: { identity: '-' } })), ['macos-signing-adhoc']);
  assert.match((await mac({ notarize: true, sign: { identity: '-' } })).findings[0].message, /cannot be notarized/);
});

test('macOS: hardenedRuntime false is a warning, unset is the documented default and passes', async () => {
  const mac = (sign) => check(good({ 'package.json': json(pkg('43.7.7', { build: { ...SIGNED, mac: { notarize: true, sign: { identity: 'Developer ID Application: A (B)', ...sign } } } })) }));
  const off = await mac({ hardenedRuntime: false });
  assert.deepEqual(ids(off), ['macos-hardened-runtime-off']);
  assert.match(off.findings[0].message, /Enable the Hardened Runtime capability for your app and command line targets/);
  assert.deepEqual(ids(await mac({})), []);
  assert.equal((await mac({})).signing.macos[0].hardenedRuntime, 'default');
});

test('macOS: notarization not enabled and turned off are warnings that cite the Apple page', async () => {
  const mac = (m) => check(good({ 'package.json': json(pkg('43.7.7', { build: { ...SIGNED, mac: { sign: SIGNED.mac.sign, ...m } } })) }));
  const missing = await mac({});
  assert.deepEqual(ids(missing), ['macos-notarization-missing']);
  assert.ok(missing.findings[0].message.includes('https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution'));
  assert.match(missing.findings[0].message, /not enabled/);
  const off = await mac({ notarize: false });
  assert.match(off.findings[0].message, /turned off/);
  assert.deepEqual(ids(await mac({ notarize: true })), []);
});

test('signing: the older flat mac keys of electron-builder are read', async () => {
  const report = await check(good({ 'package.json': json(pkg('43.7.7', { build: { ...SIGNED, mac: { notarize: true, identity: 'Developer ID Application: A (B)', hardenedRuntime: false } } })) }));
  assert.deepEqual(ids(report), ['macos-hardened-runtime-off']);
});

test('signing: electron-builder.yml and electron-builder.json are read, with the line in the file', async () => {
  const yml = 'appId: com.example.x\nwin:\n  target: nsis\nmac:\n  notarize: false\n  sign:\n    identity: "Developer ID Application: A (B)"\npublish:\n  provider: github\n';
  const fromYaml = await check({ 'package.json': pkg(), 'src/main.js': SAFE, 'electron-builder.yml': yml });
  assert.deepEqual(find(fromYaml, 'windows-signing-missing').map((f) => `${f.file}:${f.line}`), ['electron-builder.yml:2']);
  assert.deepEqual(find(fromYaml, 'macos-notarization-missing').map((f) => `${f.file}:${f.line}`), ['electron-builder.yml:5']);
  const fromJson = await check({ 'package.json': pkg(), 'src/main.js': SAFE, 'electron-builder.json': json({ win: { sign: false }, publish: 'github' }) });
  assert.deepEqual(find(fromJson, 'windows-signing-disabled').map((f) => `${f.file}:${f.line}`), ['electron-builder.json:3']);
});

test('signing: with two configurations a setting counts when any of them sets it, and a note says so', async () => {
  const report = await check({ 'package.json': pkg('43.7.7', { build: { win: { sign: { type: 'azure' } } } }), 'src/main.js': SAFE, 'electron-builder.yml': 'mac:\n  notarize: true\n  sign:\n    identity: "Developer ID Application: A (B)"\npublish: github\n' });
  assert.deepEqual(ids(report), []);
  assert.match(report.notes[0], /more than one electron-builder configuration/);
});

test('signing: Electron Forge signing in forge.config.json, used when there is no electron-builder configuration', async () => {
  const forge = { packagerConfig: { osxSign: {}, osxNotarize: { appleId: 'x' } }, makers: [{ name: 'squirrel', config: { certificateFile: 'x' } }] };
  const ok = await check({ 'package.json': pkg('43.7.7', { dependencies: { 'electron-updater': '6.0.0' } }), 'src/main.js': SAFE, 'forge.config.json': forge });
  assert.deepEqual(ids(ok), []);
  assert.equal(ok.signing.windows[0].packager, 'electron-forge');
  const bare = await check({ 'package.json': pkg('43.7.7', { dependencies: { 'electron-updater': '6.0.0' } }), 'src/main.js': SAFE, 'forge.config.json': { packagerConfig: {} } });
  assert.deepEqual(ids(bare), ['windows-signing-missing', 'macos-signing-missing', 'macos-notarization-missing']);
  assert.deepEqual(bare.findings.map((f) => f.file), ['forge.config.json', 'forge.config.json', 'forge.config.json']);
});

test('signing: no electron-builder configuration and no Forge configuration is said in the finding', async () => {
  const report = await check({ 'package.json': pkg(), 'src/main.js': SAFE });
  const [w] = find(report, 'windows-signing-missing');
  assert.match(w.message, /no electron-builder configuration .* no forge\.config\.json was read/);
  assert.equal(report.signing.windows[0].packager, 'none found');
});

test('signing: --platforms leaves a platform out, and the check says "skipped"', async () => {
  const files = good({ 'package.json': json(pkg('43.7.7', { build: { publish: 'github' } })) });
  const both = await check(files);
  assert.deepEqual(ids(both), ['windows-signing-missing', 'macos-signing-missing', 'macos-notarization-missing']);
  const winOnly = await check(files, { platforms: ['windows'] });
  assert.deepEqual(ids(winOnly), ['windows-signing-missing']);
  assert.equal(winOnly.checks[3].result, 'skipped');
  const macOnly = await check(files, { platforms: ['macos'] });
  assert.equal(macOnly.checks[2].result, 'skipped');
  assert.deepEqual(macOnly.platforms, ['macos']);
});

test('signing: a configuration of a format the tool does not read is info, and says which file', async () => {
  const report = await check(good({ 'electron-builder.toml': 'appId = "x"\n', 'forge.config.js': 'module.exports = {};\n' }));
  assert.deepEqual(find(report, 'config-not-read').map((f) => f.file), ['electron-builder.toml', 'forge.config.js']);
  assert.equal(find(report, 'config-not-read')[0].severity, 'info');
});

const TAURI_OK = { productName: 'x', bundle: { windows: { signCommand: 'sign %1' }, macOS: { signingIdentity: 'Developer ID Application: A (B)' } }, plugins: { updater: { pubkey: 'FAKE-TEST-KEY', endpoints: ['https://example.com/{{target}}'] } } };
const tauri = (config, extra = {}) => ({ 'src-tauri/tauri.conf.json': config, ...extra });

test('Tauri: a complete configuration has only the notarization note', async () => {
  const report = await check(tauri(TAURI_OK));
  assert.deepEqual(ids(report), ['macos-notarization-env']);
  assert.equal(report.project.kinds[0], 'tauri');
  assert.equal(report.checks[0].result, 'n/a');
  assert.equal(report.checks[3].result, 'info');
});

test('Tauri: no Windows signing is a warning with the line of the windows section, or of the file', async () => {
  const withSection = await check(tauri({ ...TAURI_OK, bundle: { windows: { digestAlgorithm: 'sha256' }, macOS: TAURI_OK.bundle.macOS } }));
  assert.deepEqual(find(withSection, 'windows-signing-missing').map((f) => f.file), ['src-tauri/tauri.conf.json']);
  const without = await check(tauri({ ...TAURI_OK, bundle: { macOS: TAURI_OK.bundle.macOS } }));
  assert.equal(find(without, 'windows-signing-missing')[0].line, 1);
  assert.match(find(without, 'windows-signing-missing')[0].fix, /certificateThumbprint, or bundle\.windows\.signCommand/);
});

test('Tauri: macOS signing identity unset, "-" and the hardened runtime off', async () => {
  const mac = (m) => check(tauri({ ...TAURI_OK, bundle: { windows: TAURI_OK.bundle.windows, macOS: m } }));
  assert.deepEqual(ids(await mac({})).filter((i) => i !== 'macos-notarization-env'), ['macos-signing-missing']);
  assert.deepEqual(ids(await mac({ signingIdentity: '-' })).filter((i) => i !== 'macos-notarization-env'), ['macos-signing-adhoc']);
  assert.deepEqual(ids(await mac({ signingIdentity: 'Developer ID Application: A (B)', hardenedRuntime: false })).filter((i) => i !== 'macos-notarization-env'), ['macos-hardened-runtime-off']);
});

test('Tauri: the notarization finding names the environment variables and is info, not a warning', async () => {
  const report = await check(tauri(TAURI_OK));
  const [f] = find(report, 'macos-notarization-env');
  assert.equal(f.severity, 'info');
  assert.match(f.message, /APPLE_API_ISSUER/);
  assert.match(f.message, /APPLE_TEAM_ID/);
});

test('Tauri: a configuration in the version 1 layout is reported and not judged', async () => {
  const report = await check(tauri({ package: { productName: 'x' }, tauri: { bundle: { windows: {} }, updater: { active: true } } }));
  assert.deepEqual(ids(report), ['tauri-v1-layout']);
  assert.match(report.findings[0].message, /tauri > bundle/);
  assert.equal(report.checks[2].result, 'not checked');
});

test('a project with both an Electron app and a Tauri app is checked as both', async () => {
  const report = await check({ ...good(), ...tauri(TAURI_OK) });
  assert.deepEqual(report.project.kinds, ['electron', 'tauri']);
  assert.equal(report.signing.windows.length, 2);
  assert.deepEqual(ids(report), ['macos-notarization-env']);
});

// ---- 5. auto-update --------------------------------------------------------------------------------------------

test('auto-update: a publish url over plain http is an error with the line of the url', async () => {
  const text = json(pkg('43.7.7', { build: { ...SIGNED, publish: { provider: 'generic', url: 'http://updates.example.com/app' } } }));
  const report = await check(good({ 'package.json': text }));
  const [f] = find(report, 'update-insecure-url');
  assert.equal(f.severity, 'error');
  assert.equal(f.line, lineOf(text, 'http://updates'));
  assert.equal(f.subject, 'publish.url');
  assert.equal(report.checks[4].result, 'fail');
});

test('auto-update: a publish protocol of http and an http S3 endpoint are errors too', async () => {
  const report = await check(good({ 'package.json': json(pkg('43.7.7', { build: { ...SIGNED, publish: [{ provider: 'github', protocol: 'http' }, { provider: 's3', endpoint: 'http://s3.example.com' }] } })) }));
  assert.deepEqual(find(report, 'update-insecure-url').map((f) => f.subject), ['publish.protocol', 'publish.endpoint']);
});

test('auto-update: an https publish url passes, and so does the electron-updater dependency', async () => {
  assert.deepEqual(ids(await check(good())), []);
  const dep = await check({ 'package.json': pkg('43.7.7', { dependencies: { 'electron-updater': '6.0.0' }, build: { ...SIGNED, publish: undefined } }), 'src/main.js': SAFE });
  assert.deepEqual(ids(dep), []);
  assert.equal(dep.update[0].how, 'electron-updater dependency');
});

test('auto-update: no update setup at all is info', async () => {
  const report = await check(good({ 'package.json': json(pkg('43.7.7', { build: { ...SIGNED, publish: undefined } })) }));
  assert.deepEqual(ids(report), ['no-auto-update']);
  assert.equal(report.findings[0].severity, 'info');
  assert.equal(report.gate.pass, true);
  assert.equal(report.checks[4].result, 'info');
});

test('auto-update: a Tauri updater without a pubkey is an error, with a pubkey it passes', async () => {
  const noKey = await check(tauri({ ...TAURI_OK, plugins: { updater: { endpoints: ['https://example.com/u'] } } }));
  const [f] = find(noKey, 'updater-no-pubkey');
  assert.equal(f.severity, 'error');
  assert.equal(f.file, 'src-tauri/tauri.conf.json');
  assert.match(f.message, /has to be the public key generated from the Tauri CLI/);
  assert.deepEqual(find(await check(tauri(TAURI_OK)), 'updater-no-pubkey'), []);
});

test('auto-update: a Tauri endpoint over http and dangerousInsecureTransportProtocol are errors', async () => {
  const report = await check(tauri({ ...TAURI_OK, plugins: { updater: { pubkey: 'k', endpoints: ['https://a.example.com', 'http://b.example.com'], dangerousInsecureTransportProtocol: true } } }));
  assert.deepEqual(find(report, 'update-insecure-url').map((f) => f.subject), ['plugins.updater.endpoints']);
  assert.match(find(report, 'update-insecure-url')[0].message, /b\.example\.com/);
  assert.equal(find(report, 'updater-insecure-transport')[0].severity, 'error');
  const off = await check(tauri({ ...TAURI_OK, plugins: { updater: { pubkey: 'k', endpoints: ['https://a.example.com'], dangerousInsecureTransportProtocol: false } } }));
  assert.deepEqual(find(off, 'updater-insecure-transport'), []);
});

test('auto-update: Tauri with no updater is info, and an updater plugin in Cargo.toml without a configuration is info', async () => {
  const none = await check(tauri({ ...TAURI_OK, plugins: {} }));
  assert.ok(ids(none).includes('no-auto-update'));
  const cargo = await check(tauri({ ...TAURI_OK, plugins: {} }, { 'src-tauri/Cargo.toml': '[dependencies]\ntauri = "2"\ntauri-plugin-updater = "2"\n' }));
  assert.ok(ids(cargo).includes('updater-config-not-found'));
  assert.ok(!ids(cargo).includes('no-auto-update'));
  assert.equal(find(cargo, 'updater-config-not-found')[0].severity, 'info');
});

test('auto-update: Tauri 1 in Cargo.toml with the version 2 layout is noted', async () => {
  const report = await check(tauri(TAURI_OK, { 'src-tauri/Cargo.toml': 'tauri = "1.5"\n' }));
  assert.match(report.notes[0], /asks for Tauri 1/);
});

// ---- 6. certificate and key files ------------------------------------------------------------------------------

test('key files: .pfx, .p12 and .key files are errors, wherever they are, with the path and not the contents', async () => {
  const report = await check(good({ 'build/cert.pfx': 'FAKE-TEST-KEY', 'certs/deep/er/sign.p12': 'FAKE-TEST-KEY', 'secrets/app.key': 'FAKE-TEST-KEY', 'CERT.PFX': 'FAKE-TEST-KEY' }));
  assert.deepEqual(find(report, 'committed-key-file').map((f) => f.file), ['CERT.PFX', 'build/cert.pfx', 'certs/deep/er/sign.p12', 'secrets/app.key']);
  assert.ok(report.findings.every((f) => !JSON.stringify(f).includes('FAKE-TEST-KEY')));
  assert.equal(report.checks[5].result, 'fail');
  assert.equal(report.keyFiles.found.length, 4);
});

test('key files: a .pem is an error only when it holds a private key', async () => {
  const report = await check(good({ 'a/private.pem': FAKE_PRIVATE_PEM, 'a/public.pem': FAKE_CERT_PEM, 'a/other.pem': 'just some text\n' }));
  assert.deepEqual(find(report, 'committed-key-file').map((f) => f.file), ['a/private.pem']);
  assert.match(find(report, 'committed-key-file')[0].message, /\.pem with a private key/);
});

test('key files: only the beginning of a large .pem is read', async () => {
  const report = await check(good({ 'big.pem': `${'x'.repeat(200000)}\n${FAKE_PRIVATE_PEM}` }));
  assert.deepEqual(find(report, 'committed-key-file'), []);
});

test('key files: node_modules, .git and target folders are not entered', async () => {
  const report = await check(good({ 'node_modules/p/k.pfx': 'x', '.git/k.key': 'x', 'src-tauri/target/k.p12': 'x' }));
  assert.deepEqual(find(report, 'committed-key-file'), []);
  assert.equal(report.checks[5].result, 'pass');
});

test('key files: a symbolic link is not followed or listed', async (t) => {
  await withFiles({ 'package.json': json(pkg('43.7.7', { build: SIGNED })), 'real/k.pfx': 'x' }, async (dir) => {
    try {
      await symlink(resolve(dir, 'real'), resolve(dir, 'link'), 'junction');
    } catch {
      t.skip('this system does not allow a symbolic link here');
      return;
    }
    const report = await checkProject('.', { base: dir });
    assert.deepEqual(find(report, 'committed-key-file').map((f) => f.file), ['real/k.pfx']);
  });
});

// ---- unreadable files, folders and paths -----------------------------------------------------------------------

test('a package.json that is not JSON is an error with the line, and the rest of the run still happens', async () => {
  const report = await check({ 'package.json': '{\n  "name": "x",\n  "devDependencies": {\n}\n', 'src-tauri/tauri.conf.json': TAURI_OK });
  const [f] = find(report, 'config-unreadable');
  assert.equal(f.file, 'package.json');
  assert.ok(f.line >= 4);
  assert.ok(report.project.kinds.includes('tauri'));
});

test('an electron-builder.yml outside the YAML subset and a forge.config.json that is not JSON are errors', async () => {
  const report = await check(good({ 'electron-builder.yml': 'a: &anchor 1\n', 'forge.config.json': '{ nope' }));
  assert.deepEqual(find(report, 'config-unreadable').map((f) => `${f.file}:${f.line}`), ['electron-builder.yml:1', 'forge.config.json:1']);
  assert.match(find(report, 'config-unreadable')[0].message, /anchors, aliases, tags and block scalars/);
});

test('a configuration that is not an object, a folder where a file should be, and a duplicate key are errors', async () => {
  const report = await check({ 'package.json': '[]', 'src-tauri/tauri.conf.json': '{ "a": 1, "a": 2 }' });
  assert.deepEqual(find(report, 'config-unreadable').map((f) => f.file), ['package.json', 'src-tauri/tauri.conf.json']);
  await withFiles({ 'package.json': json(pkg()), 'electron-builder.yml/x': '1' }, async (dir) => {
    const r = await checkProject('.', { base: dir });
    assert.match(find(r, 'config-unreadable')[0].message, /not a regular file|a folder, not a file/);
  });
});

test('a folder that does not exist, one with no project and a file instead of a folder stop the run', async () => {
  await withFiles({ 'readme.txt': 'x', 'package.json2': 'x' }, async (dir) => {
    await assert.rejects(checkProject('missing', { base: dir }), /missing: no such folder/);
    await assert.rejects(checkProject('.', { base: dir }), /no Electron or Tauri project here/);
    await assert.rejects(checkProject('readme.txt', { base: dir }), /not a folder/);
  });
  await withFiles({ 'package.json': json({ name: 'web', dependencies: { react: '1' } }) }, async (dir) => {
    await assert.rejects(checkProject('.', { base: dir }), /has no "electron" dependency/);
  });
});

test('a package.json without electron next to a Tauri app is the front end, and is not checked as Electron', async () => {
  const report = await check({ 'package.json': { name: 'ui', dependencies: { react: '19.0.0' } }, ...tauri(TAURI_OK) });
  assert.deepEqual(report.project.kinds, ['tauri']);
});

test('paths in the report are relative with forward slashes, compared exactly, and shown absolute outside the base', async () => {
  await withFiles({ 'app/package.json': json(pkg('30.1.0')), 'app/src/MainWindow.js': mainJs('sandbox: false'), 'app/src/zebra/second.js': mainJs('webSecurity: false') }, async (dir) => {
    const report = await checkProject('app', { base: dir });
    const files = report.findings.filter((f) => f.id.startsWith('insecure-')).map((f) => f.file);
    assert.ok(files.every((f) => f.startsWith('app/src/') && !f.includes('\\')), files.join(','));
    assert.equal(report.project.path, 'app');
    assert.deepEqual(files, ['app/src/MainWindow.js', 'app/src/zebra/second.js']);
    const outside = await checkProject(resolve(dir, 'app'), { base: resolve(dir, 'app', 'src') });
    assert.ok(outside.findings.some((f) => f.file === '../package.json' || f.file.endsWith('/app/package.json')));
  });
});

test('the same files give the same report', async () => {
  const files = good({ 'package.json': json(pkg('30.1.0', { build: { win: { sign: false } } })), 'src/main.js': mainJs('sandbox: false', 'nodeIntegration: true') });
  assert.deepEqual(await check(files), await check(files));
});

// ---- limits and hostile input ----------------------------------------------------------------------------------

test('limits: a file over the size limit is an error, a source file over its limit is info, and the run goes on', async () => {
  const limits = { maxFileBytes: 400, maxSourceBytes: 100, maxSourceFiles: 3000, maxWalkFiles: 20000, maxDepth: 16, pemPeekBytes: 64 };
  const report = await check({ 'package.json': json(pkg('43.7.7', { description: 'x'.repeat(500) })), 'src/main.js': mainJs('sandbox: false') }, { limits, releases: null });
  assert.match(find(report, 'config-unreadable')[0].message, /over the 0 MB limit|bytes is over/);
  const report2 = await check({ 'package.json': pkg(), 'src/main.js': `${mainJs('sandbox: false')}${'//'.padEnd(300, 'x')}` }, { limits: { ...limits, maxFileBytes: 100000 } });
  assert.match(find(report2, 'source-not-read')[0].message, /was not scanned/);
});

test('limits: more source files than the limit is info that says how many were read', async () => {
  const files = { 'package.json': pkg() };
  for (let i = 0; i < 6; i += 1) files[`src/f${i}.js`] = 'x();\n';
  const report = await check(files, { limits: { maxFileBytes: 1000000, maxSourceBytes: 100000, maxSourceFiles: 3, maxWalkFiles: 20000, maxDepth: 16, pemPeekBytes: 64 } });
  assert.match(find(report, 'source-not-read')[0].message, /only the first 3/);
  assert.equal(report.source.files, 3);
});

test('limits: more files than the walk limit, and folders nested too deep, are reported', async () => {
  const files = { 'package.json': pkg() };
  for (let i = 0; i < 8; i += 1) files[`d/f${i}.txt`] = 'x';
  const report = await check(files, { limits: { maxFileBytes: 1000000, maxSourceBytes: 100000, maxSourceFiles: 3000, maxWalkFiles: 20000, maxVisited: 2, maxDepth: 16, pemPeekBytes: 64 } });
  assert.ok(find(report, 'source-not-read').some((f) => /more than 2 files/.test(f.message)));
  const deep = await check({ 'package.json': pkg(), 'a/b/c/d/k.pfx': 'x' }, { limits: { maxFileBytes: 1000000, maxSourceBytes: 100000, maxSourceFiles: 3000, maxWalkFiles: 100, maxDepth: 2, pemPeekBytes: 64 } });
  assert.ok(find(deep, 'source-not-read').length === 1);
});

test('hostile input: a key named __proto__ or constructor in package.json is data, and nothing changes', async () => {
  const text = '{ "name": "x", "__proto__": { "polluted": true }, "constructor": 1, "devDependencies": { "electron": "43.7.7", "__proto__": "x" }, "build": { "__proto__": { "win": 1 } } }';
  const report = await check({ 'package.json': text, 'src/main.js': SAFE });
  assert.equal({}.polluted, undefined);
  assert.equal(report.electron.declared.spec, '43.7.7');
});

test('hostile input: control and direction characters in a url or a file name are removed from the report', async () => {
  const url = 'http://exa\u001b[31mmple.com/\u202eevil';
  const report = await check(good({ 'package.json': json(pkg('43.7.7', { build: { ...SIGNED, publish: { provider: 'generic', url } } })) }));
  const text = JSON.stringify(report);
  assert.equal(/[\u0000-\u001f\u202e]/.test(report.findings.map((f) => f.message).join('')), false);
  assert.ok(text.includes('exa'));
});

test('hostile input: a very deeply nested package.json and a very long version string are refused or ignored quickly', async () => {
  const started = Date.now();
  const deep = `{ "a": ${'['.repeat(100000)}${']'.repeat(100000)} }`;
  const report = await check({ 'package.json': deep, ...tauri(TAURI_OK) });
  assert.match(find(report, 'config-unreadable')[0].message, /nested more than 64 deep/);
  const long = await check(good({ 'package.json': json(pkg('4'.repeat(100000), { build: SIGNED })) }));
  assert.deepEqual(ids(long), ['electron-version-unknown']);
  assert.ok(Date.now() - started < 3000);
});

test('the fixture list is the one the tests judge against', () => {
  assert.equal(RELEASES.filter((r) => /^\d+\.\d+\.\d+$/.test(r.version)).length, 7);
});

test('a report holds the six checks, in order, with the finding counts and the gate', async () => {
  const report = await check(good({ 'package.json': json(pkg('30.1.0', { build: SIGNED })) }));
  assert.deepEqual(report.checks.map((c) => c.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(report.counts, { error: 1, warning: 0, info: 0 });
  assert.equal(report.gate.reason, '1 error');
  assert.equal(report.tool, 'desktop-release-check');
});
