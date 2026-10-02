// Reading files of the project. A file is read whole, and only when it is a regular file under the size limit.
// The size is taken from the open file, so it cannot change between the check and the read. Folders are walked
// without following a symbolic link, with a limit on the depth and on the number of files.

import { lstat, open, readdir, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxSourceBytes: 2 * 1024 * 1024,
  maxSourceFiles: 3000,
  maxWalkFiles: 20000,
  maxVisited: 200000,
  maxDepth: 16,
  pemPeekBytes: 64 * 1024
};

// An error with the path in its message and the reason alone in .reason, so a caller can show its own path.
export function fileError(path, reason) {
  return Object.assign(new Error(`${path}: ${reason}`), { reason });
}

// Looks at the path before it is opened, so that a pipe or a device is never opened (opening one can block). A
// symbolic link is refused unless the caller was given the path by the person who runs the tool (allowLink).
async function beforeOpen(path, allowLink) {
  let info;
  try {
    info = await (allowLink ? stat : lstat)(resolve(path));
  } catch (error) {
    if (error.code === 'ENOENT') throw fileError(path, 'no such file');
    throw fileError(path, `cannot be read (${error.code ?? error.message})`);
  }
  if (info.isSymbolicLink()) throw fileError(path, 'a symbolic link, which is not followed');
  if (info.isDirectory()) throw fileError(path, 'a folder, not a file');
  if (!info.isFile()) throw fileError(path, 'not a regular file');
}

async function readOpen(path, maxBytes, wholeOnly, allowLink) {
  await beforeOpen(path, allowLink);
  let handle;
  try {
    handle = await open(resolve(path), 'r');
  } catch (error) {
    if (error.code === 'ENOENT') throw fileError(path, 'no such file');
    if (error.code === 'EISDIR') throw fileError(path, 'a folder, not a file');
    throw fileError(path, `cannot be read (${error.code ?? error.message})`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw fileError(path, 'not a regular file');
    if (wholeOnly && info.size > maxBytes) throw fileError(path, `${info.size.toLocaleString('en-US')} bytes is over the ${maxBytes >= 1048576 ? `${(maxBytes / 1048576).toLocaleString('en-US')} MB` : `${maxBytes.toLocaleString('en-US')} byte`} limit`);
    const size = Math.min(info.size, maxBytes);
    const buffer = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const { bytesRead } = await handle.read(buffer, read, size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return buffer.subarray(0, read);
  } finally {
    await handle.close();
  }
}

// The whole file, or an error when it is not a regular file or is over the limit. A symbolic link is not followed
// unless allowLink is true, which is for a path that the person who runs the tool gave.
export function readBounded(path, limits = LIMITS, maxBytes = limits.maxFileBytes, allowLink = false) {
  return readOpen(path, maxBytes, true, allowLink);
}

// The first bytes of a regular file, whatever its size.
export function peek(path, bytes) {
  return readOpen(path, bytes, false, false);
}

function toPosix(path) {
  return sep === '/' ? path : path.split(sep).join('/');
}

// A path as shown in a report: relative to the base folder with forward slashes; a path outside it is shown
// absolute, also with forward slashes.
export function displayPath(path, base) {
  const rel = relative(base, path);
  if (rel === '') return '.';
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return toPosix(path);
  return toPosix(rel);
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Every regular file under a folder, as { path, rel } with rel relative to the folder and with forward slashes,
// sorted by the letters of the path so that the order is the same on every system. A symbolic link, a device and
// a pipe are never followed or listed. Folders named in skip are not entered. truncated is true when the limit on
// the number of files kept, the number of files looked at or the depth cut the walk short.
export async function walk(root, { skip = [], maxFiles = LIMITS.maxWalkFiles, maxVisited = LIMITS.maxVisited, maxDepth = LIMITS.maxDepth, accept = () => true } = {}) {
  const skipped = new Set(skip);
  const files = [];
  let visited = 0;
  let truncated = false;

  async function visit(dir, rel, depth) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => compare(a.name, b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles || visited >= maxVisited) {
        truncated = true;
        return;
      }
      const name = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skipped.has(entry.name)) continue;
        if (depth >= maxDepth) {
          truncated = true;
          continue;
        }
        await visit(resolve(dir, entry.name), name, depth + 1);
      } else if (entry.isFile()) {
        visited += 1;
        if (accept(entry.name, name)) files.push({ path: resolve(dir, entry.name), rel: name });
      }
    }
  }

  await visit(resolve(root), '', 0);
  files.sort((a, b) => compare(a.rel, b.rel));
  return { files, truncated };
}
