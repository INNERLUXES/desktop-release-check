// Shared test helpers: project files written inline into a temporary folder that is removed after the test.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { checkProject, main } from '../src/index.js';

export async function withFiles(files, fn) {
  const dir = await mkdtemp(resolve(tmpdir(), 'desktop-release-check-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(resolve(dir, rel)), { recursive: true });
      await writeFile(resolve(dir, rel), content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// The releases file used by the tests: a small made-up list in the shape of releases.json. The latest stable
// major is 44, so the supported majors are 44, 43 and 42; 43 has the minors 0 and 7.
export const RELEASES = [
  { version: '46.0.0-nightly.1' },
  { version: '45.0.0-beta.2' },
  { version: '44.1.0' },
  { version: '44.0.0' },
  { version: '43.7.7' },
  { version: '43.0.0' },
  { version: '42.3.1' },
  { version: '41.5.0' },
  { version: '30.1.0' }
];

// A package.json for an Electron app.
export const pkg = (electron = '43.7.7', extra = {}) => ({ name: 'demo', main: 'src/main.js', devDependencies: { electron }, ...extra });

// A main process file with these webPreferences lines.
export const mainJs = (...lines) => `const { BrowserWindow } = require('electron');\nnew BrowserWindow({\n  webPreferences: {\n${lines.map((l) => `    ${l},`).join('\n')}\n  }\n});\n`;

// Writes the files (objects are written as JSON, strings as they are) and checks the folder. The releases file
// RELEASES is written as releases.json and used, unless the options say `releases: null`.
export async function check(files, options = {}) {
  const written = { 'releases.json': json(RELEASES) };
  for (const [name, content] of Object.entries(files)) written[name] = typeof content === 'string' ? content : json(content);
  return withFiles(written, (dir) => checkProject('.', { releases: 'releases.json', ...options, base: dir }));
}

// Writes the files and runs the command line with these arguments (paths relative to the folder).
export async function run(files, args = [], limits) {
  const written = {};
  for (const [name, content] of Object.entries(files)) written[name] = typeof content === 'string' ? content : json(content);
  return withFiles(written, async (dir) => {
    let out = '';
    let err = '';
    const code = await main(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, limits, dir);
    return { code, out, err };
  });
}

// Runs the command line with exactly these arguments.
export async function cli(argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
}

export const ids = (report) => report.findings.map((f) => f.id);
export const find = (report, id) => report.findings.filter((f) => f.id === id);

// Fake key material for the tests: a header line built in two parts, so that no file of the repository holds a
// whole private key header, and the text FAKE-TEST-KEY. It is never a real key.
export const FAKE_PRIVATE_PEM = `${'-----BEGIN '}${'PRIVATE KEY-----'}\nFAKE-TEST-KEY\n${'-----END '}${'PRIVATE KEY-----'}\n`;
export const FAKE_CERT_PEM = `${'-----BEGIN '}${'CERTIFICATE-----'}\nFAKE-TEST-KEY\n${'-----END '}${'CERTIFICATE-----'}\n`;

// The line (from 1) of the first line of the text that holds the needle.
export function lineOf(text, needle) {
  const index = text.split(String.fromCharCode(10)).findIndex((l) => l.includes(needle));
  return index === -1 ? -1 : index + 1;
}
