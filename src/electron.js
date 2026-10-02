// What the files of an Electron project say: the Electron version it asks for, whether that version is inside the
// window Electron supports, the signing and notarization settings of electron-builder and Electron Forge, and the
// update settings. docs/method.md gives each rule and the page of the official documentation it follows.

import { BUILDER, FORGE, SUPPORT } from './data.js';
import { propOf } from './json.js';

const isObject = (node) => node !== undefined && node !== null && node.t === 'object';

// The property of an object node at a path of keys, or undefined when a step is missing or is not an object.
export function dig(node, ...keys) {
  let current = node;
  let prop;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    prop = propOf(current, key);
    if (prop === undefined) return undefined;
    current = prop.value;
  }
  return prop;
}

// ---------------------------------------------------------------------------------------------------------------
// The Electron version

const SPEC = /^([\^~]?)v?(\d{1,4})(?:\.(\d{1,4}|x|X|\*))?(?:\.(\d{1,4}|x|X|\*))?(?:-[0-9A-Za-z.-]{1,60})?$/;

// A version as written in package.json: 43.0.0, ^43.1.0, ~43.1.2, 43, 43.x, with or without a pre-release part.
// Ranges with an operator or a space, tags such as latest, paths and addresses are not read. Returns { ok, major,
// minor (a number or null when it is not fixed), patch, operator, floating } or { ok: false, reason }.
export function parseVersionSpec(spec) {
  const text = String(spec).trim();
  if (text.length === 0 || text.length > 100) return { ok: false, reason: 'is empty or very long' };
  const m = SPEC.exec(text);
  if (!m) return { ok: false, reason: 'is not a version, a ^ range or a ~ range that the tool reads (a tag, a range with an operator, a path and an address are not read)' };
  const num = (x) => (x === undefined || x === 'x' || x === 'X' || x === '*' ? null : Number(x));
  const operator = m[1] === '^' ? 'caret' : m[1] === '~' ? 'tilde' : 'exact';
  const major = Number(m[2]);
  const minor = num(m[3]);
  const patch = num(m[4]);
  // A caret range follows later minor versions, a tilde range follows later patches, and a version with a missing
  // part or an x follows everything below it.
  const floating = operator === 'caret' || minor === null;
  return { ok: true, major, minor, patch, operator, floating, prerelease: text.includes('-') };
}

// The stable releases of a releases.json list: { majors (newest first), latestMinor (a Map from a major to its
// highest minor) }. A stable release has a version of three numbers and nothing after them; alphas, betas and
// nightly builds are left out.
export function stableReleases(list) {
  const latestMinor = new Map();
  for (const entry of list) {
    const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(entry.version);
    if (!m) continue;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (!latestMinor.has(major) || latestMinor.get(major) < minor) latestMinor.set(major, minor);
  }
  const majors = [...latestMinor.keys()].sort((a, b) => b - a);
  return { majors, latestMinor };
}

// Reads a releases.json file already parsed into JSON nodes: an array of objects with a "version" string.
export function releasesFromNode(root) {
  if (root.t !== 'array') throw new Error('the releases file must be a JSON array, as https://releases.electronjs.org/releases.json is');
  const list = [];
  for (const item of root.items) {
    if (item.t !== 'object') continue;
    const v = propOf(item, 'version');
    if (v && v.value.t === 'string') list.push({ version: v.value.value });
  }
  if (list.length === 0) throw new Error('the releases file has no entry with a "version"');
  const stable = stableReleases(list);
  if (stable.majors.length === 0) throw new Error('the releases file has no stable release (a version of three numbers)');
  return stable;
}

// Judges a declared version against the stable releases. Returns { state, supported (the supported majors), ... }
// where state is 'supported', 'not-latest-minor', 'unsupported' or 'ahead'.
export function judgeVersion(version, releases) {
  const supported = releases.majors.slice(0, SUPPORT.majors);
  const latestMajor = releases.majors[0];
  if (version.major > latestMajor) return { state: 'ahead', supported, latestMajor };
  if (!supported.includes(version.major)) return { state: 'unsupported', supported, latestMajor };
  const latestMinor = releases.latestMinor.get(version.major);
  if (!version.floating && version.minor !== null && version.minor < latestMinor) return { state: 'not-latest-minor', supported, latestMajor, latestMinor };
  return { state: 'supported', supported, latestMajor, latestMinor };
}

// The Electron dependency of a package.json node: { spec, line, section } or null.
export function electronDependency(pkg, name) {
  if (!isObject(pkg)) return null;
  for (const section of ['devDependencies', 'dependencies']) {
    const prop = dig(pkg, section, name);
    if (prop) return { spec: prop.value.t === 'string' ? prop.value.value : null, line: prop.line, section, kind: prop.value.t };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// electron-builder

// What one electron-builder configuration (a node) says. Every field is { state, line } with a state that names
// what was found. Windows signing: 'configured', 'disabled' (win.sign is false or null), 'missing' (not set, so
// electron-builder looks for a certificate in the environment, which the files cannot show). macOS signing:
// 'configured', 'disabled' (null), 'adhoc' (identity "-"), 'missing'. hardenedRuntime: 'on', 'off', 'default'.
// notarize: 'on', 'off', 'missing'.
export function analyzeBuilder(config) {
  const out = {
    windows: { state: 'missing', line: 0, how: null },
    mac: { state: 'missing', line: 0, how: null },
    hardenedRuntime: { state: 'default', line: 0 },
    notarize: { state: 'missing', line: 0 },
    hasWin: dig(config, BUILDER.winKey) !== undefined,
    hasMac: dig(config, BUILDER.macKey) !== undefined
  };

  // Windows
  const win = dig(config, BUILDER.winKey);
  if (win && isObject(win.value)) {
    const sign = propOf(win.value, BUILDER.signKey);
    if (sign) {
      const v = sign.value;
      if (v.t === 'null' || (v.t === 'boolean' && v.value === false)) out.windows = { state: 'disabled', line: sign.line, how: 'win.sign' };
      else if (v.t === 'object') {
        const type = propOf(v, 'type');
        if (type && type.value.t === 'string' && BUILDER.signTypes.includes(type.value.value)) out.windows = { state: 'configured', line: sign.line, how: `win.sign type ${type.value.value}` };
        else out.windows = { state: 'missing', line: sign.line, how: 'win.sign without a type of signtool, hsm, pkcs11 or azure' };
      } else if (v.t === 'string') out.windows = { state: 'configured', line: sign.line, how: 'win.sign' };
    } else {
      for (const legacy of BUILDER.legacyWin) {
        const prop = propOf(win.value, legacy);
        if (prop && prop.value.t === 'object') {
          out.windows = { state: 'configured', line: prop.line, how: `win.${legacy}` };
          break;
        }
      }
    }
  }

  // macOS
  const mac = dig(config, BUILDER.macKey);
  if (mac && isObject(mac.value)) {
    const sign = propOf(mac.value, BUILDER.signKey);
    let identity = null;
    let identityLine = 0;
    let how = 'mac.sign.identity';
    let signObject = null;
    if (sign) {
      if (sign.value.t === 'null') out.mac = { state: 'disabled', line: sign.line, how: 'mac.sign' };
      else if (sign.value.t === 'string') out.mac = { state: 'configured', line: sign.line, how: 'mac.sign' };
      else if (sign.value.t === 'object') {
        signObject = sign.value;
        const id = propOf(sign.value, BUILDER.identity);
        if (id) {
          identity = id.value;
          identityLine = id.line;
        }
      }
    } else {
      const id = propOf(mac.value, BUILDER.identity);
      if (id) {
        identity = id.value;
        identityLine = id.line;
        how = 'mac.identity';
      }
    }
    if (identity) {
      if (identity.t === 'null') out.mac = { state: 'disabled', line: identityLine, how };
      else if (identity.t === 'string' && identity.value === BUILDER.adHocIdentity) out.mac = { state: 'adhoc', line: identityLine, how };
      else if (identity.t === 'string') out.mac = { state: 'configured', line: identityLine, how };
    } else if (signObject && out.mac.state === 'missing') {
      out.mac = { state: 'missing', line: sign.line, how: 'mac.sign without an identity' };
    }
    const hardened = (signObject && propOf(signObject, BUILDER.hardenedRuntime)) || propOf(mac.value, BUILDER.hardenedRuntime);
    if (hardened && hardened.value.t === 'boolean') out.hardenedRuntime = { state: hardened.value.value ? 'on' : 'off', line: hardened.line };
    const notarize = propOf(mac.value, BUILDER.notarize);
    if (notarize) {
      if (notarize.value.t === 'boolean') out.notarize = { state: notarize.value.value ? 'on' : 'off', line: notarize.line };
      else if (notarize.value.t === 'object') out.notarize = { state: 'on', line: notarize.line };
    }
  }
  return out;
}

const URL_HTTP = /^\s*http:\/\//i;

// The publish settings of a configuration, searched at any level up to a depth: { present, urls } where urls are
// the plain-http addresses and protocols found inside publish values: { key, value, line }.
export function publishSettings(config, maxDepth = 8) {
  const result = { present: false, firstLine: 0, insecure: [] };
  function inPublish(node, key) {
    if (node.t === 'string') {
      // a provider name such as "github"
      return;
    }
    if (node.t === 'array') {
      for (const item of node.items) inPublish(item, key);
    } else if (node.t === 'object') {
      for (const p of node.props) {
        if (BUILDER.publishUrlKeys.includes(p.key) && p.value.t === 'string' && URL_HTTP.test(p.value.value)) result.insecure.push({ key: `${key}.${p.key}`, value: p.value.value.trim(), line: p.line });
        else if (p.key === BUILDER.protocolKey && p.value.t === 'string' && p.value.value.toLowerCase() === 'http') result.insecure.push({ key: `${key}.${p.key}`, value: 'http', line: p.line });
      }
    }
  }
  function visit(node, path, depth) {
    if (depth > maxDepth) return;
    if (node.t === 'object') {
      for (const p of node.props) {
        const here = path === '' ? p.key : `${path}.${p.key}`;
        if (p.key === BUILDER.publish && p.value.t !== 'null') {
          if (!result.present) result.firstLine = p.line;
          result.present = true;
          inPublish(p.value, here);
        } else visit(p.value, here, depth + 1);
      }
    } else if (node.t === 'array') {
      node.items.forEach((item, i) => visit(item, `${path}[${i}]`, depth + 1));
    }
  }
  visit(config, '', 0);
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Electron Forge

// What a forge.config.json (a node) says: windows 'configured' | 'missing', mac signing 'configured' | 'missing'
// and notarization 'on' | 'missing'.
export function analyzeForge(config) {
  const packager = dig(config, FORGE.packagerConfig);
  const out = { windows: { state: 'missing', line: 0, how: null }, mac: { state: 'missing', line: 0, how: null }, notarize: { state: 'missing', line: 0 } };
  const present = (prop) => prop !== undefined && prop.value.t !== 'null' && !(prop.value.t === 'boolean' && prop.value.value === false);
  if (packager && isObject(packager.value)) {
    const sign = propOf(packager.value, FORGE.osxSign);
    if (present(sign)) out.mac = { state: 'configured', line: sign.line, how: `${FORGE.packagerConfig}.${FORGE.osxSign}` };
    const notarize = propOf(packager.value, FORGE.osxNotarize);
    if (present(notarize)) out.notarize = { state: 'on', line: notarize.line };
    const winSign = propOf(packager.value, FORGE.windowsSign);
    if (present(winSign)) out.windows = { state: 'configured', line: winSign.line, how: `${FORGE.packagerConfig}.${FORGE.windowsSign}` };
  }
  const makers = dig(config, FORGE.makers);
  if (makers && makers.value.t === 'array' && out.windows.state === 'missing') {
    for (const maker of makers.value.items) {
      const cfg = isObject(maker) ? propOf(maker, FORGE.makerConfig) : undefined;
      if (!cfg || !isObject(cfg.value)) continue;
      for (const key of [FORGE.windowsSign, FORGE.certificateFile]) {
        const prop = propOf(cfg.value, key);
        if (present(prop)) {
          out.windows = { state: 'configured', line: prop.line, how: `${FORGE.makers}[].${FORGE.makerConfig}.${key}` };
          break;
        }
      }
      if (out.windows.state === 'configured') break;
    }
  }
  return out;
}
