// Reads the files of an Electron or Tauri project, checks its release setup against the official documentation
// of docs/rules-and-sources.md, and returns one report. docs/method.md gives the reason behind every finding.
// The tool reads files only: it opens no connection and never runs a build or a program.

import { stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import {
  APPLE_PAGE, BUILDER, CURRENT_VERSION_ITEM, ELECTRON_PACKAGE, FORGE, KEY_EXTENSIONS, MICROSOFT_PAGE, PACKAGE_FILE, PEM_BEGIN, PEM_EXTENSION, PEM_MARKER,
  PLATFORMS, RELEASES_URL, SECURITY_PAGE, SECURITY_SETTINGS, SOURCE_DIR, SOURCE_EXTENSIONS, SUPPORT, TAURI
} from './data.js';
import { analyzeBuilder, analyzeForge, dig, electronDependency, judgeVersion, parseVersionSpec, publishSettings, releasesFromNode } from './electron.js';
import { LIMITS, displayPath, peek, readBounded, walk } from './files.js';
import { parseJson, propOf } from './json.js';
import { SCAN_LIMITS, scanSource } from './scan.js';
import { analyzeTauri, readCargo } from './tauri.js';
import { parseYaml } from './yaml.js';

export { LIMITS };
export const SEVERITIES = ['error', 'warning', 'info'];
export const RANK = { error: 0, warning: 1, info: 2 };

// The six checks, in the order of the report.
export const CHECKS = [
  { n: 1, id: 'electron-support', name: 'Electron version' },
  { n: 2, id: 'electron-security', name: 'Electron security settings' },
  { n: 3, id: 'windows-signing', name: 'Windows signing' },
  { n: 4, id: 'macos-signing', name: 'macOS signing and notarization' },
  { n: 5, id: 'auto-update', name: 'Auto-update' },
  { n: 6, id: 'key-files', name: 'Certificate and key files' }
];

const S = {
  timelines: 'https://www.electronjs.org/docs/latest/tutorial/electron-timelines',
  security: SECURITY_PAGE,
  microsoft: MICROSOFT_PAGE,
  apple: APPLE_PAGE,
  builderWin: 'https://www.electron.build/docs/win',
  builderMac: 'https://www.electron.build/docs/mac',
  builderNotarize: 'https://www.electron.build/docs/features/code-signing/notarization',
  builderPublish: 'https://www.electron.build/docs/publish',
  builderConfig: 'https://www.electron.build/docs/configuration',
  forgeWin: 'https://www.electronforge.io/guides/code-signing/code-signing-windows',
  forgeMac: 'https://www.electronforge.io/guides/code-signing/code-signing-macos',
  tauriWin: 'https://v2.tauri.app/distribute/sign/windows/',
  tauriMac: 'https://v2.tauri.app/distribute/sign/macos/',
  tauriUpdater: 'https://v2.tauri.app/plugin/updater/',
  tauriConfig: 'https://v2.tauri.app/reference/config/',
  tauriMigrate: 'https://v2.tauri.app/start/migrate/from-tauri-1/'
};

// Every finding, in report order within a severity. check is the number of the check it belongs to (0: the run).
export const FINDINGS = [
  { id: 'config-unreadable', severity: 'error', check: 0, what: 'A configuration file that cannot be read: not valid JSON, or YAML outside the subset the tool reads, or not a regular file', source: S.builderConfig },
  { id: 'electron-unsupported', severity: 'error', check: 1, what: 'The Electron major version is not one of the latest three stable majors', source: S.timelines },
  { id: 'insecure-node-integration', severity: 'error', check: 2, what: 'webPreferences sets nodeIntegration to true', source: S.security },
  { id: 'insecure-context-isolation', severity: 'error', check: 2, what: 'webPreferences sets contextIsolation to false', source: S.security },
  { id: 'insecure-sandbox', severity: 'error', check: 2, what: 'webPreferences sets sandbox to false', source: S.security },
  { id: 'insecure-web-security', severity: 'error', check: 2, what: 'webPreferences sets webSecurity to false', source: S.security },
  { id: 'insecure-content', severity: 'error', check: 2, what: 'webPreferences sets allowRunningInsecureContent to true', source: S.security },
  { id: 'update-insecure-url', severity: 'error', check: 5, what: 'A publish or updater address that starts with http://, or a publish protocol of http', source: S.builderPublish },
  { id: 'updater-no-pubkey', severity: 'error', check: 5, what: 'The Tauri updater is configured without a pubkey', source: S.tauriUpdater },
  { id: 'updater-insecure-transport', severity: 'error', check: 5, what: 'The Tauri updater sets dangerousInsecureTransportProtocol to true', source: S.tauriUpdater },
  { id: 'committed-key-file', severity: 'error', check: 6, what: 'A certificate or private key file inside the project: .pfx, .p12, .key, or a .pem that holds a private key', source: S.microsoft },
  { id: 'electron-not-latest-minor', severity: 'warning', check: 1, what: 'The Electron version is in a supported line but is not the latest minor release of it', source: S.timelines },
  { id: 'windows-signing-missing', severity: 'warning', check: 3, what: 'No Windows code signing is configured in the files', source: S.microsoft },
  { id: 'windows-signing-disabled', severity: 'warning', check: 3, what: 'Windows code signing is turned off in the configuration', source: S.microsoft },
  { id: 'macos-signing-missing', severity: 'warning', check: 4, what: 'No macOS code signing identity is configured in the files', source: S.apple },
  { id: 'macos-signing-disabled', severity: 'warning', check: 4, what: 'macOS code signing is turned off in the configuration', source: S.apple },
  { id: 'macos-signing-adhoc', severity: 'warning', check: 4, what: 'macOS signing uses the ad-hoc identity "-", which cannot be notarized', source: S.apple },
  { id: 'macos-hardened-runtime-off', severity: 'warning', check: 4, what: 'The hardened runtime is turned off, and notarization requires it', source: S.apple },
  { id: 'macos-notarization-missing', severity: 'warning', check: 4, what: 'Notarization is not enabled in the configuration', source: S.apple },
  { id: 'config-not-read', severity: 'info', check: 0, what: 'A configuration file of a format the tool does not read is present', source: S.builderConfig },
  { id: 'source-not-read', severity: 'info', check: 0, what: 'A source file or a folder was left out: too large, too many files, or too long to scan', source: S.security },
  { id: 'tauri-v1-layout', severity: 'info', check: 0, what: 'tauri.conf.json has the version 1 layout, which the tool does not read', source: S.tauriMigrate },
  { id: 'electron-support-not-checked', severity: 'info', check: 1, what: 'Electron support was not checked because no releases file was given', source: S.timelines },
  { id: 'electron-version-unknown', severity: 'info', check: 1, what: 'The Electron version in package.json is not one the tool reads, so its support was not checked', source: S.timelines },
  { id: 'web-preferences-not-found', severity: 'info', check: 2, what: 'No webPreferences object was found in the source that was read', source: S.security },
  { id: 'setting-not-literal', severity: 'info', check: 2, what: 'A webPreferences setting is written as an expression, not as true or false, so it was not checked', source: S.security },
  { id: 'macos-notarization-env', severity: 'info', check: 4, what: 'Tauri notarization is configured through environment variables, which the files cannot show', source: S.tauriMac },
  { id: 'no-auto-update', severity: 'info', check: 5, what: 'No update setup was found', source: S.builderPublish },
  { id: 'updater-config-not-found', severity: 'info', check: 5, what: 'Cargo.toml names the Tauri updater plugin but tauri.conf.json has no plugins.updater', source: S.tauriUpdater }
];

export const STATE_TEXT = { configured: 'configured', missing: 'not configured', disabled: 'turned off', adhoc: 'ad hoc identity' };
const NOTARIZE_TEXT = { on: 'on', off: 'off', missing: 'not enabled', env: 'by environment variables, not checked' };

const ORDER = Object.fromEntries(FINDINGS.map((f, i) => [f.id, i]));
const BY_ID = Object.fromEntries(FINDINGS.map((f) => [f.id, f]));

// Text from the input: control, line separator and direction characters replaced by a space, length capped.
export function safeText(value, max = 300) {
  const s = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ');
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function meetsThreshold(severity, failOn) {
  return RANK[severity] <= RANK[failOn];
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function plural(count, one, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

// The line a read error names, and its text without the label in front.
function splitError(message) {
  const m = /^[a-z0-9 .-]{1,60}: (?:line (\d+): )?([\s\S]*)$/i.exec(String(message));
  return m ? { line: m[1] ? Number(m[1]) : 1, text: m[2] } : { line: 1, text: String(message) };
}

// Reads a file of the project: { status: 'missing' } when it does not exist, { status: 'error', reason } when it is
// not a usable file, or { status: 'ok', text }.
async function readProjectFile(path, limits) {
  try {
    return { status: 'ok', text: (await readBounded(path, limits)).toString('utf8') };
  } catch (error) {
    if (error.reason === 'no such file') return { status: 'missing' };
    return { status: 'error', reason: error.reason ?? error.message };
  }
}

const isInside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !resolve(root, rel).startsWith('..') && !rel.split(sep).includes('..');
};

// Runs the checks. options: { releases (path of a releases.json), platforms (list of windows, macos), failOn, base,
// version, limits }. base is the folder that paths are shown relative to and that relative paths are opened from
// (default: the current folder). A project folder that does not exist, one with no Electron or Tauri project in
// it, and a releases file that cannot be used stop the run with an error.
export async function checkProject(projectArg, { releases = null, platforms = PLATFORMS, failOn = 'error', base = process.cwd(), version = '0.0.0', limits = LIMITS } = {}) {
  limits = { ...LIMITS, ...limits };
  const baseDir = resolve(base);
  const root = resolve(baseDir, projectArg);
  const show = (p) => safeText(displayPath(p, baseDir));
  try {
    if (!(await stat(root)).isDirectory()) throw new Error('not a folder');
  } catch (error) {
    throw new Error(`${safeText(projectArg)}: ${error.code === 'ENOENT' ? 'no such folder' : 'not a folder; give the project folder'}`);
  }
  const want = new Set(platforms);

  // The releases file.
  let stable = null;
  let releasesShown = null;
  if (releases !== null) {
    const path = resolve(baseDir, releases);
    releasesShown = show(path);
    let buffer;
    try {
      buffer = await readBounded(path, limits, limits.maxFileBytes, true);
    } catch (error) {
      throw new Error(`${safeText(releases)}: ${safeText(error.reason ?? error.message)}`);
    }
    try {
      stable = releasesFromNode(parseJson(buffer.toString('utf8'), 'releases'));
    } catch (error) {
      const { line, text } = splitError(error.message);
      const withLine = /^[a-z0-9 .-]{1,60}: line [0-9]+: /i.test(String(error.message));
      throw new Error(`${releasesShown}: ${withLine ? `line ${line}: ` : ''}${safeText(text, 300)}`);
    }
  }

  const notes = [];
  const note = (text) => notes.push(safeText(text, 600));
  const all = [];
  const add = (id, file, line, subject, message, fix, severity = BY_ID[id].severity) => {
    all.push({ id, severity, check: BY_ID[id].check, file, line: Math.max(1, Number(line) || 1), subject: safeText(subject), message: safeText(message, 1200), fix: safeText(fix, 1200), source: BY_ID[id].source });
  };
  const shown = (name) => show(resolve(root, name));

  // Which files exist.
  const pkgRead = await readProjectFile(resolve(root, PACKAGE_FILE), limits);
  const tauriPath = resolve(root, TAURI.dir, TAURI.file);
  const tauriRead = await readProjectFile(tauriPath, limits);
  if (pkgRead.status === 'missing' && tauriRead.status === 'missing') {
    throw new Error(`${safeText(projectArg)}: no Electron or Tauri project here (looked for ${PACKAGE_FILE} and ${TAURI.dir}/${TAURI.file})`);
  }

  // package.json
  let pkg = null;
  const pkgShown = shown(PACKAGE_FILE);
  if (pkgRead.status === 'error') add('config-unreadable', pkgShown, 1, PACKAGE_FILE, `${pkgShown} cannot be read: ${safeText(pkgRead.reason)}`, 'Make it a regular JSON file under the size limit');
  if (pkgRead.status === 'ok') {
    try {
      pkg = parseJson(pkgRead.text, 'package');
      if (pkg.t !== 'object') throw new Error('package: line 1: the file must hold a JSON object');
    } catch (error) {
      pkg = null;
      const { line, text } = splitError(error.message);
      add('config-unreadable', pkgShown, line, PACKAGE_FILE, `${pkgShown} cannot be read: ${safeText(text)}`, 'Fix the file so that it is JSON');
    }
  }
  const dependency = electronDependency(pkg, ELECTRON_PACKAGE);
  const isElectron = pkgRead.status !== 'missing' && (dependency !== null || (pkgRead.status !== 'ok' || pkg === null));
  const isTauri = tauriRead.status !== 'missing';
  if (!isElectron && !isTauri) {
    throw new Error(`${safeText(projectArg)}: ${PACKAGE_FILE} has no "${ELECTRON_PACKAGE}" dependency and there is no ${TAURI.dir}/${TAURI.file}, so there is no Electron or Tauri project here`);
  }
  const kinds = [...(isElectron ? ['electron'] : []), ...(isTauri ? ['tauri'] : [])];

  const facts = {
    electron: null,
    settings: [],
    sourceSummary: { files: 0, objects: 0, filesWithObjects: 0 },
    signing: [],
    update: [],
    keyFiles: { scanned: 0, found: [] }
  };
  const checkExtra = {}; // per check: { status, detail } overrides

  // ---- Electron ----------------------------------------------------------------------------------------------
  let electronMajor = null;
  const builderConfigs = []; // { file, node, label }
  let forgeConfig = null; // { file, node }
  if (isElectron) {
    // Configuration files.
    if (pkg) {
      const build = propOf(pkg, BUILDER.buildKey);
      if (build && build.value.t === 'object') builderConfigs.push({ file: pkgShown, node: build.value, label: `${PACKAGE_FILE} "${BUILDER.buildKey}"` });
    }
    for (const name of BUILDER.configFiles) {
      const read = await readProjectFile(resolve(root, name), limits);
      const file = shown(name);
      if (read.status === 'missing') continue;
      if (read.status === 'error') {
        add('config-unreadable', file, 1, name, `${file} cannot be read: ${safeText(read.reason)}`, 'Make it a regular file under the size limit');
        continue;
      }
      try {
        const node = name.endsWith('.json') ? parseJson(read.text, name) : parseYaml(read.text, name);
        if (node.t === 'object') builderConfigs.push({ file, node, label: name });
        else if (node.t !== 'null') throw new Error(`${name}: line 1: the file must hold a mapping`);
      } catch (error) {
        const { line, text } = splitError(error.message);
        add('config-unreadable', file, line, name, `${file} cannot be read: ${safeText(text)}`, name.endsWith('.json') ? 'Fix the file so that it is JSON' : 'Write the file in the YAML subset described in docs/config-files.md, or as JSON');
      }
    }
    const forgeRead = await readProjectFile(resolve(root, FORGE.file), limits);
    if (forgeRead.status === 'ok') {
      const file = shown(FORGE.file);
      try {
        const node = parseJson(forgeRead.text, FORGE.file);
        if (node.t === 'object') forgeConfig = { file, node };
      } catch (error) {
        const { line, text } = splitError(error.message);
        add('config-unreadable', file, line, FORGE.file, `${file} cannot be read: ${safeText(text)}`, 'Fix the file so that it is JSON');
      }
    } else if (forgeRead.status === 'error') {
      add('config-unreadable', shown(FORGE.file), 1, FORGE.file, `${shown(FORGE.file)} cannot be read: ${safeText(forgeRead.reason)}`, 'Make it a regular file under the size limit');
    }
    for (const name of [...BUILDER.unreadFiles, ...FORGE.unreadFiles]) {
      try {
        if ((await stat(resolve(root, name))).isFile()) {
          add('config-not-read', shown(name), 1, name, `${shown(name)} is present, but the tool reads only JSON and the YAML subset (docs/config-files.md); its settings were not checked`, 'Keep the signing, notarization and publish settings in a file the tool reads, or check them by hand');
        }
      } catch {
        // not there
      }
    }
    if (builderConfigs.length > 1) note(`more than one electron-builder configuration was read (${builderConfigs.map((c) => c.label).join(', ')}); a setting counts as present when any of them sets it`);

    // 1. The Electron version.
    const spec = dependency && dependency.spec !== null ? dependency.spec : null;
    let parsed = null;
    if (dependency) {
      if (spec === null) {
        add('electron-version-unknown', pkgShown, dependency.line, ELECTRON_PACKAGE, `The ${ELECTRON_PACKAGE} dependency in ${pkgShown}:${dependency.line} is not a string, so its version is not read and its support was not checked`, 'Write the version as a string such as "43.0.0"');
      } else {
        parsed = parseVersionSpec(spec);
        if (!parsed.ok) add('electron-version-unknown', pkgShown, dependency.line, ELECTRON_PACKAGE, `${ELECTRON_PACKAGE} "${safeText(spec, 100)}" (${pkgShown}:${dependency.line}) ${parsed.reason}, so its support was not checked`, 'Pin the version, or use a ^ or ~ range of one');
      }
    }
    let judged = null;
    if (parsed && parsed.ok) {
      electronMajor = parsed.major;
      if (stable === null) {
        add('electron-support-not-checked', pkgShown, dependency.line, ELECTRON_PACKAGE, `Electron support was not checked: no releases file was given, so the tool cannot know which majors are the latest three. ${ELECTRON_PACKAGE} "${safeText(spec, 100)}" is major ${parsed.major}`, `Download ${RELEASES_URL} and pass it with --releases`);
        checkExtra[1] = { status: 'not checked', detail: `${ELECTRON_PACKAGE} ${spec}: no --releases file, support not checked` };
      } else {
        judged = judgeVersion(parsed, stable);
        const list = judged.supported.join(', ');
        if (judged.state === 'unsupported') {
          add('electron-unsupported', pkgShown, dependency.line, ELECTRON_PACKAGE, `${ELECTRON_PACKAGE} "${safeText(spec, 100)}" (${pkgShown}:${dependency.line}) is major ${parsed.major}. Electron's support policy: "${SUPPORT.policy}"; in ${releasesShown} the latest stable major is ${judged.latestMajor}, so the supported majors are ${list}`, `Upgrade to Electron ${judged.latestMajor}, one major at a time. The security page asks to "${CURRENT_VERSION_ITEM}"`);
        } else if (judged.state === 'not-latest-minor') {
          add('electron-not-latest-minor', pkgShown, dependency.line, ELECTRON_PACKAGE, `${ELECTRON_PACKAGE} "${safeText(spec, 100)}" (${pkgShown}:${dependency.line}) is in the supported line ${parsed.major}, but not the latest minor release of it, ${parsed.major}.${judged.latestMinor}. Electron: "${SUPPORT.minorPolicy}"`, `Update to ${parsed.major}.${judged.latestMinor}.x`);
        } else if (judged.state === 'ahead') {
          note(`${ELECTRON_PACKAGE} ${safeText(spec, 100)} is newer than the newest stable release in ${releasesShown} (major ${judged.latestMajor}), so it was not judged`);
        }
      }
    }
    facts.electron = {
      declared: dependency ? { spec, file: pkgShown, line: dependency.line, section: dependency.section, major: parsed && parsed.ok ? parsed.major : null, minor: parsed && parsed.ok ? parsed.minor : null, operator: parsed && parsed.ok ? parsed.operator : null } : null,
      releases: stable ? { file: releasesShown, latestMajor: stable.majors[0], supported: stable.majors.slice(0, SUPPORT.majors) } : null,
      state: !dependency ? 'no dependency' : !parsed || !parsed.ok ? 'not read' : judged ? judged.state : 'not checked',
      latestMinor: judged && judged.latestMinor !== undefined ? judged.latestMinor : null
    };

    // 2. webPreferences in the source.
    const roots = [];
    const sourceDir = resolve(root, SOURCE_DIR);
    let srcFiles = [];
    let truncatedWalk = false;
    try {
      if ((await stat(sourceDir)).isDirectory()) {
        const result = await walk(sourceDir, { skip: ['node_modules', '.git'], maxFiles: limits.maxSourceFiles, accept: (name) => SOURCE_EXTENSIONS.includes(extname(name)) });
        srcFiles = result.files.map((f) => ({ path: f.path }));
        truncatedWalk = result.truncated;
        roots.push(SOURCE_DIR);
      }
    } catch {
      // no src folder
    }
    const mainProp = pkg ? propOf(pkg, 'main') : undefined;
    if (mainProp && mainProp.value.t === 'string' && mainProp.value.value.length < 300) {
      const mainPath = resolve(root, mainProp.value.value);
      if (isInside(root, mainPath) && SOURCE_EXTENSIONS.includes(extname(mainPath)) && !srcFiles.some((f) => f.path === mainPath)) {
        try {
          if ((await stat(mainPath)).isFile()) {
            srcFiles.push({ path: mainPath });
            roots.push(displayPath(mainPath, root));
          }
        } catch {
          // the main file is not there
        }
      }
    }
    if (truncatedWalk) add('source-not-read', shown(SOURCE_DIR), 1, SOURCE_DIR, `More than ${limits.maxSourceFiles.toLocaleString('en-US')} source files under ${shown(SOURCE_DIR)}; only the first ${limits.maxSourceFiles.toLocaleString('en-US')} (in path order) were read`, 'Check the rest by hand, or run the tool on a smaller project folder');
    const found = new Map(SECURITY_SETTINGS.map((s) => [s.setting, []]));
    let objectCount = 0;
    let filesWithObjects = 0;
    for (const f of srcFiles) {
      const file = show(f.path);
      let text;
      try {
        text = (await readBounded(f.path, limits, limits.maxSourceBytes)).toString('utf8');
      } catch (error) {
        add('source-not-read', file, 1, file, `${file} was not scanned: ${safeText(error.reason ?? error.message)}`, 'Check this file by hand, or split it');
        continue;
      }
      const result = scanSource(text, SCAN_LIMITS);
      if (result.truncated) add('source-not-read', file, 1, file, `${file} has more than ${SCAN_LIMITS.maxTokens.toLocaleString('en-US')} tokens; only the start was scanned`, 'Check this file by hand, or split it');
      if (result.objects.length) filesWithObjects += 1;
      objectCount += result.objects.length;
      for (const object of result.objects) {
        for (const prop of object.props) {
          if (!found.has(prop.key)) continue;
          found.get(prop.key).push({ file, line: prop.line, value: prop.literal ? prop.value : null, literal: prop.literal });
        }
      }
    }
    facts.sourceSummary = { files: srcFiles.length, objects: objectCount, filesWithObjects, roots };
    let unsafe = 0;
    let notFound = 0;
    for (const def of SECURITY_SETTINGS) {
      const locations = found.get(def.setting);
      const defaultSince = def.defaultSince ? { major: def.defaultSince.major, text: def.defaultSince.text } : null;
      facts.settings.push({ setting: def.setting, item: def.item, status: locations.length ? 'found' : 'not found in source', unsafeValue: String(def.unsafe), defaultSince, locations: locations.map((l) => ({ file: l.file, line: l.line, value: l.literal ? l.value : 'expression', unsafe: l.literal && l.value === String(def.unsafe) })) });
      if (!locations.length) notFound += 1;
      for (const l of locations) {
        if (l.literal && l.value === String(def.unsafe)) {
          unsafe += 1;
          add(def.id, l.file, l.line, def.setting, `${def.setting}: ${l.value} (${l.file}:${l.line}) breaks item "${def.item}" of the Electron security checklist. It matters most for a window that loads remote content, which the tool cannot see`, `Set ${def.setting} to ${def.unsafe ? 'false' : 'true'}, or remove it; see ${SECURITY_PAGE}`);
        } else if (!l.literal) {
          add('setting-not-literal', l.file, l.line, def.setting, `${def.setting} (${l.file}:${l.line}) is not written as true or false, so the tool did not evaluate it`, 'Write the value as a literal, or check this window by hand');
        }
      }
    }
    if (objectCount === 0) {
      add('web-preferences-not-found', roots.length ? shown(SOURCE_DIR) : pkgShown, 1, 'webPreferences', `No webPreferences object was found in the ${srcFiles.length === 0 ? 'source (there are no source files under src/ and the main entry was not read)' : `${plural(srcFiles.length, 'source file')} that were read`}, so none of the five settings was checked`, 'Run the tool on the project folder that holds the main process source');
    }
    checkExtra[2] = { detail: objectCount === 0 ? 'no webPreferences found in source, nothing checked' : `${plural(objectCount, 'webPreferences object')} in ${plural(filesWithObjects, 'file')}: ${unsafe} unsafe, ${5 - notFound} found, ${notFound} not found in source`, status: objectCount === 0 ? 'not checked' : undefined };
  }

  // ---- Tauri -------------------------------------------------------------------------------------------------
  let tauriFacts = null;
  let cargo = null;
  const tauriShown = show(tauriPath);
  if (isTauri) {
    if (tauriRead.status === 'error') {
      add('config-unreadable', tauriShown, 1, TAURI.file, `${tauriShown} cannot be read: ${safeText(tauriRead.reason)}`, 'Make it a regular file under the size limit');
    } else {
      let node = null;
      try {
        node = parseJson(tauriRead.text, TAURI.file);
        if (node.t !== 'object') throw new Error(`${TAURI.file}: line 1: the file must hold a JSON object`);
      } catch (error) {
        node = null;
        const { line, text } = splitError(error.message);
        add('config-unreadable', tauriShown, line, TAURI.file, `${tauriShown} cannot be read: ${safeText(text)}`, 'Fix the file so that it is JSON; a .json5 or Tauri.toml configuration is not read');
      }
      if (node) {
        tauriFacts = analyzeTauri(node);
        if (tauriFacts.layout === 'v1') {
          add('tauri-v1-layout', tauriShown, propOf(node, TAURI.v1Key).line, TAURI.file, `${tauriShown} has the version 1 layout (a "${TAURI.v1Key}" key and no "${TAURI.bundle}" key). The migration guide moved "${TAURI.v1Key} > ${TAURI.bundle}" to the top level and "${TAURI.v1Key} > ${TAURI.updater}" to "${TAURI.plugins} > ${TAURI.updater}"; the tool reads the version 2 layout only, so signing and updater settings were not checked`, `Migrate the configuration to version 2 (${S.tauriMigrate})`);
          tauriFacts = null;
        }
      }
    }
    for (const name of TAURI.unreadFiles) {
      try {
        if ((await stat(resolve(root, TAURI.dir, name))).isFile()) {
          add('config-not-read', show(resolve(root, TAURI.dir, name)), 1, name, `${show(resolve(root, TAURI.dir, name))} is present, but the tool reads ${TAURI.file} only; its settings were not checked`, `Keep the settings in ${TAURI.dir}/${TAURI.file}, or check them by hand`);
        }
      } catch {
        // not there
      }
    }
    const cargoRead = await readProjectFile(resolve(root, TAURI.dir, TAURI.cargo), limits);
    if (cargoRead.status === 'ok') {
      cargo = readCargo(cargoRead.text);
      if (cargo.tauri && cargo.tauri.major === 1 && tauriFacts) note(`${show(resolve(root, TAURI.dir, TAURI.cargo))}:${cargo.tauri.line} asks for Tauri 1 (${safeText(cargo.tauri.spec, 40)}), but ${TAURI.file} has the version 2 layout; check that the two match`);
    }
  }

  // ---- 3 and 4. Signing ----------------------------------------------------------------------------------------
  const winSigning = [];
  const macSigning = [];

  // The best state among several configurations: configured before the rest.
  const bestOf = (items, rank) => items.reduce((best, item) => (best === null || rank.indexOf(item.state) < rank.indexOf(best.state) ? item : best), null);
  const WIN_RANK = ['configured', 'disabled', 'missing'];
  const MAC_RANK = ['configured', 'adhoc', 'disabled', 'missing'];
  const NOT_RANK = ['on', 'off', 'missing'];

  if (isElectron) {
    if (builderConfigs.length) {
      const analyses = builderConfigs.map((c) => ({ c, a: analyzeBuilder(c.node) }));
      const win = bestOf(analyses.map(({ c, a }) => ({ ...a.windows, c })), WIN_RANK);
      const mac = bestOf(analyses.map(({ c, a }) => ({ ...a.mac, c })), MAC_RANK);
      const notarize = bestOf(analyses.map(({ c, a }) => ({ ...a.notarize, c })), NOT_RANK);
      const offHardened = analyses.map(({ c, a }) => ({ ...a.hardenedRuntime, c })).find((h) => h.state === 'off');
      const anyHardened = analyses.map(({ c, a }) => ({ ...a.hardenedRuntime, c })).find((h) => h.state === 'on');
      const lineOf = (c, key) => {
        const p = dig(c.node, key);
        return p ? p.line : 1;
      };
      winSigning.push({ packager: 'electron-builder', state: win.state, file: win.c.file, line: win.line || lineOf(win.c, BUILDER.winKey), how: win.how });
      macSigning.push({ packager: 'electron-builder', state: mac.state, file: mac.c.file, line: mac.line || lineOf(mac.c, BUILDER.macKey), how: mac.how, hardenedRuntime: offHardened ? { state: 'off', file: offHardened.c.file, line: offHardened.line } : anyHardened ? { state: 'on', file: anyHardened.c.file, line: anyHardened.line } : { state: 'default', file: mac.c.file, line: mac.line || 1 }, notarize: { state: notarize.state, file: notarize.c.file, line: notarize.line || lineOf(notarize.c, BUILDER.macKey) } });
    } else if (forgeConfig) {
      const a = analyzeForge(forgeConfig.node);
      winSigning.push({ packager: 'electron-forge', state: a.windows.state, file: forgeConfig.file, line: a.windows.line || 1, how: a.windows.how });
      macSigning.push({ packager: 'electron-forge', state: a.mac.state, file: forgeConfig.file, line: a.mac.line || 1, how: a.mac.how, hardenedRuntime: null, notarize: { state: a.notarize.state, file: forgeConfig.file, line: a.notarize.line || 1 } });
    } else {
      winSigning.push({ packager: 'none found', state: 'missing', file: pkgShown, line: 1, how: null });
      macSigning.push({ packager: 'none found', state: 'missing', file: pkgShown, line: 1, how: null, hardenedRuntime: null, notarize: { state: 'missing', file: pkgShown, line: 1 } });
    }
    if (builderConfigs.length && forgeConfig) note(`${FORGE.file} was not used for signing: an electron-builder configuration was read`);
  }
  if (isTauri && tauriFacts) {
    winSigning.push({ packager: 'tauri', state: tauriFacts.windows.state, file: tauriShown, line: tauriFacts.windows.line || 1, how: tauriFacts.windows.how });
    macSigning.push({ packager: 'tauri', state: tauriFacts.mac.state, file: tauriShown, line: tauriFacts.mac.line || 1, how: tauriFacts.mac.state === 'missing' ? null : 'bundle.macOS.signingIdentity', hardenedRuntime: { state: tauriFacts.hardenedRuntime.state, file: tauriShown, line: tauriFacts.hardenedRuntime.line || 1 }, notarize: { state: 'env', file: tauriShown, line: 1 } });
  }

  if (want.has('windows')) {
    for (const w of winSigning) {
      const where = `${w.file}:${w.line}`;
      if (w.state === 'configured') continue;
      const forWhat = w.packager === 'none found' ? 'no electron-builder configuration (package.json "build", electron-builder.yml, electron-builder.json) and no forge.config.json was read' : `${w.packager}`;
      const envNote = w.packager === 'electron-builder' ? ' electron-builder also signs with a certificate from the WIN_CSC_LINK or CSC_LINK environment variable, which the files cannot show.' : '';
      const reasonText = `Microsoft's code signing page says signing consecutive releases "with a consistent publisher/signing identity lets publisher reputation build over time", which an unsigned app cannot do (${MICROSOFT_PAGE})`;
      if (w.state === 'disabled') {
        add('windows-signing-disabled', w.file, w.line, 'windows signing', `Windows code signing is turned off in ${where} (${w.how}). ${reasonText}`, w.packager === 'electron-builder' ? 'Remove win.sign: false, or set win.sign with a type of signtool, hsm, pkcs11 or azure' : 'Turn signing on');
      } else {
        const how = w.packager === 'electron-builder' ? 'Set win.sign with a type of signtool, hsm, pkcs11 or azure' : w.packager === 'electron-forge' ? 'Add windowsSign to packagerConfig, or certificateFile to the Squirrel.Windows or MSI maker config' : w.packager === 'tauri' ? 'Set bundle.windows.certificateThumbprint, or bundle.windows.signCommand' : 'Add an electron-builder configuration or a forge.config.json with signing set';
        add('windows-signing-missing', w.file, w.line, 'windows signing', `No Windows code signing is configured (${forWhat}).${envNote} ${reasonText}`, how);
      }
    }
  }
  if (want.has('macos')) {
    for (const m of macSigning) {
      const where = `${m.file}:${m.line}`;
      const apple = `Apple's notarization page (${APPLE_PAGE})`;
      const forWhat = m.packager === 'none found' ? 'no electron-builder configuration (package.json "build", electron-builder.yml, electron-builder.json) and no forge.config.json was read' : m.packager;
      const signFix = m.packager === 'electron-builder' ? 'Set mac.sign.identity to your Developer ID Application certificate' : m.packager === 'electron-forge' ? 'Add osxSign to packagerConfig' : m.packager === 'tauri' ? 'Set bundle.macOS.signingIdentity' : 'Add an electron-builder configuration or a forge.config.json with signing set';
      if (m.state === 'disabled') add('macos-signing-disabled', m.file, m.line, 'macos signing', `macOS code signing is turned off in ${where} (${m.how}). ${apple} asks to "Enable code-signing for all of the executables you distribute"`, signFix);
      else if (m.state === 'adhoc') add('macos-signing-adhoc', m.file, m.line, 'macos signing', `macOS signing uses the ad-hoc identity "-" in ${where}, which has no Developer ID, so the app cannot be notarized. ${apple} asks for a Developer ID certificate for the code-signing signature and says not to use an ad hoc one`, signFix);
      else if (m.state === 'missing') add('macos-signing-missing', m.file, m.line, 'macos signing', `No macOS code signing identity is configured (${forWhat}). ${apple} asks to "Enable code-signing for all of the executables you distribute"${m.packager === 'electron-builder' ? '. electron-builder also looks for a certificate in the keychain or in the CSC_LINK environment variable, which the files cannot show' : ''}`, signFix);
      if (m.hardenedRuntime && m.hardenedRuntime.state === 'off') {
        add('macos-hardened-runtime-off', m.hardenedRuntime.file, m.hardenedRuntime.line, 'hardened runtime', `The hardened runtime is turned off in ${m.hardenedRuntime.file}:${m.hardenedRuntime.line}. ${apple} asks to "Enable the Hardened Runtime capability for your app and command line targets"`, m.packager === 'tauri' ? 'Set bundle.macOS.hardenedRuntime to true, or remove it (the default is true)' : 'Set mac.sign.hardenedRuntime to true, or remove it (the default is true)');
      }
      if (m.packager === 'tauri') {
        add('macos-notarization-env', m.file, 1, 'notarization', `Tauri notarizes when the Apple credentials are set as environment variables (APPLE_API_ISSUER, APPLE_API_KEY and APPLE_API_KEY_PATH, or APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID) when the build runs. The files cannot show them, so notarization was not checked. ${apple}`, 'Check that the release job sets them; see ' + S.tauriMac);
      } else if (m.notarize && m.notarize.state !== 'on') {
        const off = m.notarize.state === 'off';
        add('macos-notarization-missing', m.notarize.file, m.notarize.line, 'notarization', `Notarization is ${off ? 'turned off' : 'not enabled'} in ${m.notarize.file}:${m.notarize.line} (${m.packager === 'electron-forge' ? 'packagerConfig.osxNotarize' : 'mac.notarize'}). ${apple}: "Notarize your macOS software to give users more confidence that the Developer ID-signed software you distribute has been checked by Apple for malicious components"`, m.packager === 'electron-forge' ? 'Add osxNotarize to packagerConfig, with the credentials read from the environment' : m.packager === 'electron-builder' ? 'Set mac.notarize to true and give the Apple credentials as environment variables (docs/rules-and-sources.md)' : 'Enable notarization in the packager configuration');
      }
    }
  }

  // ---- 5. Auto-update ------------------------------------------------------------------------------------------
  if (isElectron) {
    let present = false;
    const updater = pkg ? dig(pkg, 'dependencies', BUILDER.updaterPackage) || dig(pkg, 'devDependencies', BUILDER.updaterPackage) : undefined;
    if (updater) present = true;
    const publishes = [];
    for (const c of builderConfigs) {
      const p = publishSettings(c.node);
      if (p.present) {
        present = true;
        publishes.push({ file: c.file, line: p.firstLine });
      }
      for (const i of p.insecure) {
        add('update-insecure-url', c.file, i.line, i.key, `${i.key} is ${safeText(i.value, 200)} (${c.file}:${i.line}): updates are fetched over plain http, so anyone on the network path can read or replace what the app downloads`, i.value === 'http' ? 'Remove the protocol, or set it to https' : 'Use an https:// address');
      }
    }
    facts.update.push({ packager: 'electron', present, file: updater ? pkgShown : publishes[0] ? publishes[0].file : null, line: updater ? updater.line : publishes[0] ? publishes[0].line : null, how: updater ? `${BUILDER.updaterPackage} dependency` : publishes[0] ? 'publish' : null });
    if (!present) add('no-auto-update', pkgShown, 1, 'auto-update', `No update setup was found for the Electron app: no "${BUILDER.publish}" setting in the electron-builder configuration and no "${BUILDER.updaterPackage}" dependency`, 'If the app updates itself some other way, ignore this; if not, see ' + S.builderPublish);
  }
  if (isTauri && tauriFacts) {
    const u = tauriFacts.updater;
    const cargoPlugin = cargo && cargo.updaterPlugin;
    facts.update.push({ packager: 'tauri', present: u.present || Boolean(cargoPlugin), file: tauriShown, line: u.present ? u.line : null, how: u.present ? 'plugins.updater' : cargoPlugin ? 'tauri-plugin-updater in Cargo.toml' : null });
    if (u.present) {
      if (u.pubkey === 'missing') add('updater-no-pubkey', tauriShown, u.line, 'plugins.updater', `plugins.updater in ${tauriShown}:${u.line} has no pubkey. The updater page: the pubkey "has to be the public key generated from the Tauri CLI". Without it the app cannot verify what it downloads. (A pubkey set in the Rust code with Builder::pubkey is not read by the tool)`, 'Set plugins.updater.pubkey to the content of the public key; it cannot be a file path');
      for (const e of u.endpoints) {
        if (/^\s*http:\/\//i.test(e.value)) add('update-insecure-url', tauriShown, e.line, 'plugins.updater.endpoints', `An updater endpoint is ${safeText(e.value, 200)} (${tauriShown}:${e.line}): it is plain http. The updater page: "TLS is enforced in production mode"`, 'Use an https:// address');
      }
      if (u.insecureTransport) add('updater-insecure-transport', tauriShown, u.insecureTransport.line, 'plugins.updater.dangerousInsecureTransportProtocol', `dangerousInsecureTransportProtocol is true (${tauriShown}:${u.insecureTransport.line}). The updater page: "Setting this to true allows the updater to accept non-HTTPS endpoints. Use this configuration with caution!"`, 'Remove the setting, and serve the updates over https');
    } else if (cargoPlugin) {
      add('updater-config-not-found', tauriShown, 1, 'plugins.updater', `${show(resolve(root, TAURI.dir, TAURI.cargo))}:${cargoPlugin.line} names ${TAURI.updaterPlugin}, but ${tauriShown} has no plugins.updater, so the pubkey and the endpoints were not checked (they may be set in the Rust code, which the tool does not read)`, 'Set plugins.updater.pubkey and plugins.updater.endpoints in the configuration');
    } else {
      add('no-auto-update', tauriShown, 1, 'auto-update', `No update setup was found for the Tauri app: no plugins.updater in ${tauriShown} and no ${TAURI.updaterPlugin} in ${TAURI.cargo}`, 'If the app updates itself some other way, ignore this; if not, see ' + S.tauriUpdater);
    }
  }

  // ---- 6. Certificate and key files ----------------------------------------------------------------------------
  {
    const walked = await walk(root, {
      skip: ['node_modules', '.git', 'target'],
      maxFiles: limits.maxWalkFiles,
      maxVisited: limits.maxVisited,
      maxDepth: limits.maxDepth,
      accept: (name) => {
        const ext = extname(name).toLowerCase();
        return KEY_EXTENSIONS.includes(ext) || ext === PEM_EXTENSION;
      }
    });
    facts.keyFiles.scanned = walked.files.length;
    for (const f of walked.files) {
      const ext = extname(f.rel).toLowerCase();
      let hit = KEY_EXTENSIONS.includes(ext);
      let kind = ext;
      if (ext === PEM_EXTENSION) {
        try {
          const text = (await peek(f.path, limits.pemPeekBytes)).toString('latin1');
          hit = text.indexOf(PEM_BEGIN) !== -1 && text.indexOf(PEM_MARKER) !== -1;
          kind = '.pem with a private key';
        } catch {
          hit = false;
        }
      }
      if (hit) {
        const file = show(resolve(root, f.rel));
        facts.keyFiles.found.push({ file, kind });
        add('committed-key-file', file, 1, kind, `${file} (${kind}) is a certificate or private key file inside the project. Its contents are not shown. If git tracks it, anyone with the repository has the key`, 'Remove it from the project and from the git history, revoke the certificate if it was ever pushed, and give the signing step the key from a secret store or an environment variable');
      }
    }
    if (walked.truncated) add('source-not-read', show(root), 1, 'project folder', `The project folder has more than ${limits.maxVisited.toLocaleString('en-US')} files, or folders nested deeper than ${limits.maxDepth}, so some folders were not searched for certificate and key files`, 'Run the tool on a smaller folder, or search the rest by hand');
  }

  // ---- The report ----------------------------------------------------------------------------------------------
  all.sort((a, b) => RANK[a.severity] - RANK[b.severity] || ORDER[a.id] - ORDER[b.id] || compare(a.file, b.file) || a.line - b.line || compare(a.subject, b.subject));
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of all) counts[f.severity] += 1;

  const skipped = (platform) => !want.has(platform);
  const checks = CHECKS.map((c) => {
    const own = all.filter((f) => f.check === c.n);
    const worst = own.length ? own.reduce((w, f) => (RANK[f.severity] < RANK[w] ? f.severity : w), 'info') : null;
    let result = worst === 'error' ? 'fail' : worst === 'warning' ? 'warn' : worst === 'info' ? 'info' : 'pass';
    let detail = own.length ? own.map((f) => f.subject).filter((v, i, a) => a.indexOf(v) === i).join(', ') : 'no finding';
    if ((c.n === 1 || c.n === 2) && !isElectron) {
      result = 'n/a';
      detail = 'no Electron project';
    } else if (c.n === 3 && skipped('windows')) {
      result = 'skipped';
      detail = 'Windows left out with --platforms';
    } else if (c.n === 4 && skipped('macos')) {
      result = 'skipped';
      detail = 'macOS left out with --platforms';
    } else if (c.n === 3 || c.n === 4) {
      const list = (c.n === 3 ? winSigning : macSigning).map((s) => `${s.packager}: ${STATE_TEXT[s.state] ?? s.state}${c.n === 4 && s.hardenedRuntime ? `, hardened runtime ${s.hardenedRuntime.state}` : ''}${c.n === 4 && s.notarize ? `, notarization ${NOTARIZE_TEXT[s.notarize.state] ?? s.notarize.state}` : ''}`);
      detail = list.length ? list.join('; ') : 'no packager configuration was read';
      if (!list.length) result = 'not checked';
    } else if (checkExtra[c.n]) {
      if (checkExtra[c.n].status) result = checkExtra[c.n].status;
      detail = checkExtra[c.n].detail;
    } else if (c.n === 5) {
      detail = facts.update.map((u) => `${u.packager}: ${u.present ? u.how : 'no update setup found'}`).join('; ') || 'nothing to check';
      if (own.some((f) => f.severity !== 'info')) detail += `; ${plural(own.filter((f) => f.severity !== 'info').length, 'problem')}`;
    } else if (c.n === 6) {
      detail = facts.keyFiles.found.length ? plural(facts.keyFiles.found.length, 'file') : 'none found';
    } else if (c.n === 1) {
      detail = facts.electron && facts.electron.declared ? `${ELECTRON_PACKAGE} ${facts.electron.declared.spec} (major ${facts.electron.declared.major}) is ${facts.electron.state}` : detail;
    }
    return { n: c.n, id: c.id, name: c.name, result, detail: safeText(detail, 400) };
  });

  const failing = all.filter((f) => meetsThreshold(f.severity, failOn));
  const eCount = failing.filter((f) => f.severity === 'error').length;
  const wCount = failing.filter((f) => f.severity === 'warning').length;
  const reason = [eCount ? plural(eCount, 'error') : null, wCount ? plural(wCount, 'warning') : null].filter(Boolean).join(', ');

  return {
    tool: 'desktop-release-check',
    version,
    project: { path: show(root), kinds },
    platforms: PLATFORMS.filter((p) => want.has(p)),
    electron: facts.electron,
    source: facts.sourceSummary,
    settings: facts.settings,
    signing: {
      windows: winSigning.map((s) => ({ packager: s.packager, state: s.state, file: s.file, line: s.line, how: s.how })),
      macos: macSigning.map((s) => ({ packager: s.packager, state: s.state, file: s.file, line: s.line, how: s.how, hardenedRuntime: s.hardenedRuntime ? s.hardenedRuntime.state : null, notarization: s.notarize ? s.notarize.state : null }))
    },
    update: facts.update,
    keyFiles: { scanned: facts.keyFiles.scanned, found: facts.keyFiles.found },
    checks,
    findings: all,
    notes,
    counts,
    gate: { failOn, pass: failing.length === 0, reason }
  };
}
