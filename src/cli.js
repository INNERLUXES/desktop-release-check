// Command line: desktop-release-check <project-folder> [options]

import { readFileSync } from 'node:fs';
import { checkProject, FINDINGS, LIMITS } from './check.js';
import { PLATFORMS, RELEASES_URL } from './data.js';
import { toText, toMarkdown, toJson, toCsv } from './report.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FORMATS = { text: toText, markdown: toMarkdown, json: toJson, csv: toCsv };
const THRESHOLDS = ['error', 'warning'];

export const USAGE = `Usage: desktop-release-check <project-folder> [options]

Checks the release setup of an Electron or Tauri desktop app project before it ships. It reads files only: the
package.json, the electron-builder or Electron Forge configuration and the source under src/ of an Electron
project, and src-tauri/tauri.conf.json and Cargo.toml of a Tauri project. It checks the Electron version against
Electron's support policy, the webPreferences security settings, Windows signing, macOS signing and notarization,
the auto-update setup, and certificate or key files inside the project. It never runs a build, opens no network
connection and runs no program.

Options:
  --releases <file>   a saved copy of ${RELEASES_URL}, used to judge
                      the Electron version; without it that check is reported as not checked
  --platforms <list>  windows, macos or both, separated by a comma (default: windows,macos)
  --format <name>     text, markdown, json or csv (default: text)
  --fail-on <level>   exit with 1 when a finding is at this level or above: error or warning
                      (default: error)
  --help              show this text
  --version           show the version

Checks: ${FINDINGS.map((f) => f.id).join(', ')}

Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
`;

export function parseArgs(argv) {
  const o = { project: null, releases: null, platforms: [...PLATFORMS], format: 'text', failOn: 'error', help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--releases') o.releases = next();
    else if (a === '--platforms') o.platforms = next().split(',').map((p) => p.trim());
    else if (a === '--format') o.format = next();
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '-') throw new Error('reading from standard input is not supported; give the path of the project folder');
    else if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
    else if (o.project !== null) throw new Error(`give one project folder, not ${a} as well`);
    else o.project = a;
  }
  if (!o.help && !o.version) {
    if (o.project === null) throw new Error('give the path of the project folder');
    for (const value of [o.project, o.releases]) {
      if (value !== null && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error('give a local path; the tool never fetches a URL');
    }
    if (!Object.hasOwn(FORMATS, o.format)) throw new Error(`unknown format ${o.format} (text, markdown, json or csv)`);
    if (!THRESHOLDS.includes(o.failOn)) throw new Error(`--fail-on takes error or warning, not ${o.failOn}`);
    for (const p of o.platforms) if (!PLATFORMS.includes(p)) throw new Error(`--platforms takes windows, macos or both separated by a comma, not ${p === '' ? 'an empty value' : p}`);
    o.platforms = PLATFORMS.filter((p) => o.platforms.includes(p));
  }
  return o;
}

function clean(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ');
}

// Exit code: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, limits = LIMITS, base = process.cwd()) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`desktop-release-check: ${clean(error.message)}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  let report;
  try {
    report = await checkProject(o.project, { releases: o.releases, platforms: o.platforms, failOn: o.failOn, version: VERSION, limits, base });
  } catch (error) {
    io.err(`desktop-release-check: ${clean(error.message)}\n`);
    return 2;
  }
  io.out(FORMATS[o.format](report));
  return report.gate.pass ? 0 : 1;
}
