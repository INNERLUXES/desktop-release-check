import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APPLE_PAGE, BUILDER, CURRENT_VERSION_ITEM, FINDINGS, FORGE, MICROSOFT_PAGE, RELEASES_URL, SECURITY_PAGE, SECURITY_SETTINGS, SOURCES, SUPPORT, TAURI, judgeVersion, stableReleases } from '../src/index.js';

const source = async (id) => {
  const entry = SOURCES.find((s) => s.id === id);
  return readFile(new URL(`../research/sources/${entry.file}`, import.meta.url), 'utf8');
};
// Text compared without line breaks, runs of white space, backticks or the typographic quotes.
const flat = (t) => t.replace(/[\u2019\u2018]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/`/g, '').replace(/\s+/g, ' ').toLowerCase();
const has = (text, needle) => flat(text).includes(flat(needle));

test('sources: every saved page has its address on the first line, as listed in src/data.js', async () => {
  for (const s of SOURCES) {
    const text = await source(s.id);
    assert.equal(text.split('\n')[0], `Source: ${s.url}`, s.file);
    assert.ok(text.length > 1000, `${s.file} holds the page text`);
  }
  assert.equal(SOURCES.length, new Set(SOURCES.map((s) => s.url)).size);
});

test('sources: the pages named for the check are all saved', () => {
  const urls = SOURCES.map((s) => s.url);
  for (const url of [
    'https://www.electronjs.org/docs/latest/tutorial/electron-timelines',
    'https://www.electronjs.org/docs/latest/tutorial/security',
    'https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options',
    'https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution',
    'https://www.electron.build/docs/win',
    'https://www.electron.build/docs/mac',
    'https://v2.tauri.app/distribute/sign/macos/',
    'https://v2.tauri.app/distribute/sign/windows/'
  ]) assert.ok(urls.includes(url), url);
  assert.equal(RELEASES_URL, 'https://releases.electronjs.org/releases.json');
});

test('sources: every address a finding points to is a saved page', () => {
  const urls = new Set(SOURCES.map((s) => s.url));
  for (const f of FINDINGS) assert.ok(urls.has(f.source), `${f.id}: ${f.source}`);
});

test('support window: the latest three stable majors, from the timelines page', async () => {
  const page = await source('electron-timelines');
  assert.ok(has(page, `${SUPPORT.policy}.`));
  assert.ok(has(page, "Electron's official support policy is the latest 3 stable releases"));
  assert.equal(SUPPORT.majors, 3);
  assert.equal(SUPPORT.page, SOURCES.find((s) => s.id === 'electron-timelines').url);
});

test('support window: only the latest minor of a line is supported, from the timelines page', async () => {
  const page = await source('electron-timelines');
  assert.ok(has(page, `${SUPPORT.minorPolicy}.`));
  assert.ok(has(page, 'if the latest release is 42.1.x, then the 41.0.x as well as the 40.2.x series are supported'));
});

test('security settings: every item is named exactly as the Electron security page names it', async () => {
  const page = await source('electron-security');
  assert.equal(SECURITY_PAGE, SOURCES.find((s) => s.id === 'electron-security').url);
  for (const s of SECURITY_SETTINGS) {
    assert.ok(page.includes(`### ${s.item}\n`), s.item);
    assert.ok(has(page, s.setting), s.setting);
  }
  assert.ok(page.includes(`### ${CURRENT_VERSION_ITEM}\n`));
  assert.deepEqual(SECURITY_SETTINGS.map((s) => s.setting), ['nodeIntegration', 'contextIsolation', 'sandbox', 'webSecurity', 'allowRunningInsecureContent']);
});

test('security settings: the unsafe value of each setting is the one the page shows as the example to avoid', async () => {
  const page = await source('electron-security');
  assert.ok(has(page, 'nodeIntegration: true'));
  assert.ok(has(page, 'contextIsolation: false'));
  assert.ok(has(page, 'sandbox: false'));
  assert.ok(has(page, 'webSecurity: false'));
  assert.ok(has(page, 'allowRunningInsecureContent: true'));
  const unsafe = Object.fromEntries(SECURITY_SETTINGS.map((s) => [s.setting, s.unsafe]));
  assert.deepEqual(unsafe, { nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false, allowRunningInsecureContent: true });
});

test('security settings: the versions since which the safe value is the default are those of the page', async () => {
  const page = await source('electron-security');
  for (const s of SECURITY_SETTINGS.filter((x) => x.defaultSince)) {
    assert.ok(has(page, s.defaultSince.text), s.setting);
    assert.ok(s.defaultSince.text.includes(`${s.defaultSince.major}.0.0`), s.setting);
  }
});

test('Windows signing: the reason is on the Microsoft page, whose address is the one named for the check', async () => {
  const page = await source('microsoft-code-signing-options');
  assert.equal(MICROSOFT_PAGE, 'https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options');
  assert.ok(has(page, 'signing consecutive releases with a consistent publisher/signing identity lets publisher reputation build over time'));
});

test('macOS signing: the words quoted in the findings are on the Apple page', async () => {
  const page = await source('apple-notarization');
  assert.equal(APPLE_PAGE, 'https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution');
  assert.ok(has(page, 'Enable code-signing for all of the executables you distribute'));
  assert.ok(has(page, 'Enable the Hardened Runtime capability for your app and command line targets'));
  assert.ok(has(page, 'Notarize your macOS software to give users more confidence that the Developer ID-signed software you distribute has been checked by Apple for malicious components'));
  assert.ok(has(page, 'Use a "Developer ID" application, kernel extension, system extension, or installer certificate'));
});

test('electron-builder Windows: win.sign, its four types and the older keys are named on its pages', async () => {
  const win = await source('electron-builder-win');
  const signing = await source('electron-builder-code-signing-win');
  assert.equal(BUILDER.winKey, 'win');
  assert.ok(has(win, '### sign?'));
  assert.ok(has(win, 'Set to false or null to disable code signing entirely'));
  for (const type of BUILDER.signTypes) assert.ok(has(signing, `type: "${type}"`), type);
  assert.deepEqual(BUILDER.signTypes, ['signtool', 'hsm', 'pkcs11', 'azure']);
  for (const legacy of BUILDER.legacyWin) assert.ok(has(win, legacy), legacy);
  assert.ok(has(signing, 'WIN_CSC_LINK'));
  assert.ok(has(signing, 'CSC_LINK'));
});

test('electron-builder macOS: mac.sign.identity, "-", hardenedRuntime and notarize are named on its pages', async () => {
  const mac = await source('electron-builder-mac');
  const signing = await source('electron-builder-code-signing-mac');
  const notarization = await source('electron-builder-notarization');
  assert.equal(BUILDER.macKey, 'mac');
  assert.ok(has(mac, 'mac.sign.identity: null (or mac.sign: null) to skip signing entirely'));
  assert.ok(has(mac, 'mac.sign.identity: "-" to use an ad-hoc signature'));
  assert.equal(BUILDER.adHocIdentity, '-');
  assert.ok(has(mac, 'mac.sign.hardenedRuntime is required for notarization'));
  assert.ok(has(mac, 'The default is true for standard darwin builds'));
  assert.ok(has(mac, 'signIgnore is now sign.ignore'));
  assert.ok(has(mac, 'old flat keys'));
  assert.ok(has(mac, '### notarize?'));
  assert.ok(has(notarization, 'notarize: true'));
  assert.ok(has(notarization, 'notarize stays on mac'));
  assert.ok(has(signing, 'mac.sign.identity'));
  assert.ok(has(notarization, 'APPLE_API_KEY'));
});

test('electron-builder publish: the address keys, the http protocol and the updater package are named on its pages', async () => {
  const publish = await source('electron-builder-publish');
  const update = await source('electron-builder-auto-update');
  assert.equal(BUILDER.publish, 'publish');
  assert.ok(has(publish, 'optional protocol?: "https" | "http" | null'));
  assert.ok(has(publish, '### endpoint?'));
  assert.ok(has(publish, '### publicUrl?'));
  assert.ok(has(update, "provider: 'generic'"));
  assert.ok(has(update, "url: 'https://example.com/auto-updates'"));
  assert.ok(has(update, `from "${BUILDER.updaterPackage}"`));
  assert.deepEqual(BUILDER.publishUrlKeys, ['url', 'endpoint', 'publicUrl']);
});

test('electron-builder configuration: the build key of package.json and electron-builder.yml are named on its page', async () => {
  const page = await source('electron-builder-configuration');
  assert.equal(BUILDER.buildKey, 'build');
  assert.ok(has(page, 'in the package.json file of your project using the build key on the top level'));
  assert.ok(has(page, 'Defaults to electron-builder.yml'));
  assert.ok(has(page, 'json, json5, toml or js/ts'));
  for (const name of BUILDER.unreadFiles.filter((n) => n.endsWith('json5') || n.endsWith('toml'))) assert.ok(has(page, name.replace('electron-builder.', '')), name);
  assert.ok(BUILDER.configFiles.includes('electron-builder.yml'));
});

test('Electron Forge: packagerConfig, osxSign, osxNotarize, windowsSign and certificateFile are named on its pages', async () => {
  const mac = await source('forge-code-signing-macos');
  const win = await source('forge-code-signing-windows');
  assert.ok(has(mac, `packagerConfig.${FORGE.osxSign}`));
  assert.ok(has(mac, `${FORGE.osxNotarize}: {`));
  assert.ok(has(win, `${FORGE.windowsSign},`));
  assert.ok(has(win, `${FORGE.certificateFile}: './cert.pfx'`));
  assert.ok(has(win, 'certificateFile and certificatePassword fields'));
  assert.ok(has(win, `packagerConfig: {`));
  assert.ok(has(mac, 'object must exist even if empty'));
  assert.ok(FORGE.unreadFiles.every((n) => has(mac + win, n)));
  assert.equal(FORGE.file, 'forge.config.json');
});

test('Tauri Windows signing: certificateThumbprint and signCommand are named on its pages', async () => {
  const guide = await source('tauri-sign-windows');
  const reference = await source('tauri-config-reference');
  for (const key of [TAURI.certificateThumbprint, TAURI.signCommand]) {
    assert.ok(has(guide, key), key);
    assert.ok(has(reference, `##### ${key}`), key);
  }
  assert.ok(has(guide, 'bundle > windows > signCommand'));
});

test('Tauri macOS signing: signingIdentity, the ad-hoc identity and the hardened runtime default are named on its pages', async () => {
  const guide = await source('tauri-sign-macos');
  const reference = await source('tauri-config-reference');
  assert.equal(TAURI.macos, 'macOS');
  assert.ok(has(guide, 'tauri.conf.json > bundle > macOS > signingIdentity'));
  assert.ok(has(guide, '"signingIdentity": "-"'));
  assert.equal(TAURI.adHocIdentity, '-');
  assert.ok(has(reference, '##### hardenedRuntime'));
  assert.ok(has(reference, 'Whether the codesign should enable hardened runtime (for executables) or not. Default: true'));
  assert.ok(has(guide, 'APPLE_API_ISSUER'));
  assert.ok(has(guide, 'APPLE_PASSWORD'));
  assert.ok(has(guide, 'Notarization is required when using a Developer ID Application certificate'));
});

test('Tauri updater: pubkey, endpoints and dangerousInsecureTransportProtocol, with the words quoted in the findings', async () => {
  const page = await source('tauri-updater');
  for (const key of [TAURI.pubkey, TAURI.endpoints, TAURI.insecureTransport]) assert.ok(has(page, key), key);
  assert.ok(has(page, 'This has to be the public key generated from the Tauri CLI'));
  assert.ok(has(page, 'TLS is enforced in production mode'));
  assert.ok(has(page, 'Setting this to true allows the updater to accept non-HTTPS endpoints. Use this configuration with caution!'));
  assert.ok(has(page, '"plugins": { "updater": {'));
  assert.ok(has(page, '.pubkey("<your public key>")'));
});

test('Tauri version 1 layout: the migration guide moves bundle to the top level and the updater to plugins', async () => {
  const page = await source('tauri-migrate-from-v1');
  assert.ok(has(page, 'tauri > bundle moved top-level'));
  assert.ok(has(page, 'tauri > updater moved to plugins > updater'));
  assert.equal(TAURI.v1Key, 'tauri');
  assert.ok(has(await source('tauri-config-reference'), TAURI.unreadFiles[0]));
});

test('releases fixture: a trimmed copy of releases.json with the same shape, for the tests and examples only', async () => {
  const list = JSON.parse(await readFile(new URL('./fixtures/releases.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(list) && list.length > 10 && list.length < 100);
  assert.ok(list.every((e) => typeof e.version === 'string' && typeof e.date === 'string'));
  assert.ok(list.some((e) => e.version.includes('-nightly.')) && list.some((e) => e.version.includes('-beta.')) && list.some((e) => e.version.includes('-alpha.')));
  const stable = stableReleases(list);
  assert.equal(new Set(stable.majors).size, stable.majors.length);
  assert.ok(stable.majors.length >= 7);
  const judged = judgeVersion({ major: stable.majors[0], minor: 0, floating: false }, stable);
  assert.deepEqual(judged.supported, stable.majors.slice(0, 3));
});
