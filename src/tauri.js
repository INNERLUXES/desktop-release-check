// What the files of a Tauri project say: the signing settings of tauri.conf.json (the version 2 layout), the
// updater settings, and the Tauri version that Cargo.toml asks for. docs/method.md gives each rule and the page of
// the official documentation it follows.

import { TAURI } from './data.js';
import { dig } from './electron.js';
import { propOf } from './json.js';

const isObject = (node) => node !== undefined && node !== null && node.t === 'object';
const empty = (node) => node.t === 'null' || (node.t === 'string' && node.value.trim() === '');

// Signing and updater settings of a tauri.conf.json node.
// windows: 'configured' (certificateThumbprint or signCommand) | 'missing'.
// mac: 'configured' | 'adhoc' | 'missing'. hardenedRuntime: 'on' | 'off' | 'default'.
// updater: { present, pubkey: 'set' | 'missing', endpoints: [{ value, line }], insecureTransport: { line } | null }.
export function analyzeTauri(config) {
  const out = {
    layout: 'v2',
    windows: { state: 'missing', line: 0, how: null },
    mac: { state: 'missing', line: 0 },
    hardenedRuntime: { state: 'default', line: 0 },
    updater: { present: false, line: 0, pubkey: 'missing', pubkeyLine: 0, endpoints: [], insecureTransport: null }
  };
  if (!isObject(config)) return out;

  // The version 1 layout nests the bundle and the updater under "tauri"; the migration guide says so. The tool
  // reads the version 2 layout only, and says so when it sees the old one.
  if (propOf(config, TAURI.v1Key) && !propOf(config, TAURI.bundle) && isObject(propOf(config, TAURI.v1Key).value)) out.layout = 'v1';

  const windows = dig(config, TAURI.bundle, TAURI.windows);
  if (windows && isObject(windows.value)) {
    for (const key of [TAURI.certificateThumbprint, TAURI.signCommand]) {
      const prop = propOf(windows.value, key);
      if (prop && !empty(prop.value)) {
        out.windows = { state: 'configured', line: prop.line, how: `bundle.windows.${key}` };
        break;
      }
    }
  }

  const mac = dig(config, TAURI.bundle, TAURI.macos);
  if (mac && isObject(mac.value)) {
    const id = propOf(mac.value, TAURI.signingIdentity);
    if (id && id.value.t === 'string' && id.value.value.trim() !== '') {
      out.mac = id.value.value === TAURI.adHocIdentity ? { state: 'adhoc', line: id.line } : { state: 'configured', line: id.line };
    }
    const hardened = propOf(mac.value, TAURI.hardenedRuntime);
    if (hardened && hardened.value.t === 'boolean') out.hardenedRuntime = { state: hardened.value.value ? 'on' : 'off', line: hardened.line };
  }

  const updater = dig(config, TAURI.plugins, TAURI.updater);
  if (updater && isObject(updater.value)) {
    out.updater.present = true;
    out.updater.line = updater.line;
    const pubkey = propOf(updater.value, TAURI.pubkey);
    if (pubkey && pubkey.value.t === 'string' && pubkey.value.value.trim() !== '') {
      out.updater.pubkey = 'set';
      out.updater.pubkeyLine = pubkey.line;
    }
    const endpoints = propOf(updater.value, TAURI.endpoints);
    if (endpoints && endpoints.value.t === 'array') {
      for (const item of endpoints.value.items) if (item.t === 'string') out.updater.endpoints.push({ value: item.value, line: item.line });
    }
    const insecure = propOf(updater.value, TAURI.insecureTransport);
    if (insecure && insecure.value.t === 'boolean' && insecure.value.value) out.updater.insecureTransport = { line: insecure.line };
  }
  return out;
}

// The lines of Cargo.toml that name tauri and the updater plugin. A line reader, not a TOML reader: it finds
// "tauri = "2"" and "tauri = { version = "2.1", ... }" at the start of a line, and the plugin name.
export function readCargo(text) {
  const out = { tauri: null, updaterPlugin: null };
  const lines = String(text).split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length && i < 20000; i += 1) {
    const line = lines[i].length > 1000 ? lines[i].slice(0, 1000) : lines[i];
    const t = line.trimStart();
    if (out.tauri === null && t.startsWith('tauri') && /^tauri\s*=/.test(t)) {
      const m = /^tauri\s*=\s*(?:"([^"]{1,40})"|\{[^}]{0,400}?\bversion\s*=\s*"([^"]{1,40})")/.exec(t);
      const spec = m ? (m[1] ?? m[2]) : null;
      const major = spec === null ? null : /^[\^~=<>\s]*(\d{1,3})/.exec(spec);
      out.tauri = { spec, major: major ? Number(major[1]) : null, line: i + 1 };
    }
    if (out.updaterPlugin === null && t.startsWith(TAURI.updaterPlugin) && /^tauri-plugin-updater\s*=/.test(t)) out.updaterPlugin = { line: i + 1 };
  }
  return out;
}
