import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LIMITS, displayPath, fileError, peek, readBounded, walk } from '../src/index.js';
import { withFiles } from './helpers.js';

const rel = (files) => files.map((f) => f.rel);

test('readBounded: reads a regular file whole', async () => {
  await withFiles({ 'a.txt': 'hello' }, async (dir) => {
    assert.equal((await readBounded(resolve(dir, 'a.txt'))).toString(), 'hello');
  });
});

test('readBounded: a missing file, a folder and a file over the limit are refused with the reason', async () => {
  await withFiles({ 'a.txt': 'x'.repeat(50), 'sub/b.txt': 'y' }, async (dir) => {
    await assert.rejects(readBounded(resolve(dir, 'none.txt')), (e) => e.reason === 'no such file');
    await assert.rejects(readBounded(resolve(dir, 'sub')), (e) => e.reason === 'a folder, not a file');
    await assert.rejects(readBounded(resolve(dir, 'a.txt'), { ...LIMITS, maxFileBytes: 10 }), (e) => /50 bytes is over the 10 byte limit/.test(e.reason));
    await assert.rejects(readBounded(resolve(dir, 'a.txt'), LIMITS, 20), /bytes is over the 20 byte limit/);
  });
});

test('readBounded: a symbolic link is refused, unless the path was given by the person who runs the tool', async (t) => {
  await withFiles({ 'real.txt': 'data' }, async (dir) => {
    try {
      await symlink(resolve(dir, 'real.txt'), resolve(dir, 'link.txt'));
    } catch {
      t.skip('this system does not allow a symbolic link here');
      return;
    }
    await assert.rejects(readBounded(resolve(dir, 'link.txt')), (e) => /symbolic link/.test(e.reason));
    assert.equal((await readBounded(resolve(dir, 'link.txt'), LIMITS, LIMITS.maxFileBytes, true)).toString(), 'data');
  });
});

test('peek: reads only the first bytes of a large file', async () => {
  await withFiles({ 'big.txt': `${'a'.repeat(1000)}${'b'.repeat(1000)}` }, async (dir) => {
    assert.equal((await peek(resolve(dir, 'big.txt'), 10)).toString(), 'aaaaaaaaaa');
  });
});

test('fileError: the path is in the message and the reason alone in .reason', () => {
  const e = fileError('x/y', 'no such file');
  assert.equal(e.message, 'x/y: no such file');
  assert.equal(e.reason, 'no such file');
});

test('walk: files sorted by the letters of the path, with forward slashes, whatever the order on disk', async () => {
  await withFiles({ 'b.txt': '1', 'a/z.txt': '1', 'a/B.txt': '1', 'a/c/d.txt': '1', 'A.txt': '1' }, async (dir) => {
    const { files, truncated } = await walk(dir);
    assert.deepEqual(rel(files), ['A.txt', 'a/B.txt', 'a/c/d.txt', 'a/z.txt', 'b.txt']);
    assert.equal(truncated, false);
  });
});

test('walk: skipped folder names are not entered, and the accept function picks the files', async () => {
  await withFiles({ 'node_modules/x/k.pfx': '1', 'keep/k.pfx': '1', 'keep/other.txt': '1' }, async (dir) => {
    const { files } = await walk(dir, { skip: ['node_modules'], accept: (name) => name.endsWith('.pfx') });
    assert.deepEqual(rel(files), ['keep/k.pfx']);
  });
});

test('walk: a symbolic link to a folder is not entered', async (t) => {
  await withFiles({ 'real/f.txt': '1', 'g.txt': '1' }, async (dir) => {
    try {
      await symlink(resolve(dir, 'real'), resolve(dir, 'linked'), 'junction');
    } catch {
      t.skip('this system does not allow a symbolic link here');
      return;
    }
    assert.deepEqual(rel((await walk(dir)).files), ['g.txt', 'real/f.txt']);
  });
});

test('walk: the limits on the files kept, the files looked at and the depth are reported as truncated', async () => {
  await withFiles({ '1.k': 'x', '2.k': 'x', '3.k': 'x', 'a/b/c/d.k': 'x' }, async (dir) => {
    const kept = await walk(dir, { maxFiles: 2, accept: (n) => n.endsWith('.k') });
    assert.equal(kept.files.length, 2);
    assert.equal(kept.truncated, true);
    const looked = await walk(dir, { maxVisited: 3 });
    assert.equal(looked.truncated, true);
    const deep = await walk(dir, { maxDepth: 2 });
    assert.equal(deep.truncated, true);
    assert.deepEqual(rel(deep.files), ['1.k', '2.k', '3.k']);
    assert.equal((await walk(dir)).truncated, false);
  });
});

test('walk: a folder that cannot be listed is left out without stopping the walk', async () => {
  await withFiles({ 'f.txt': '1' }, async (dir) => {
    assert.deepEqual(rel((await walk(resolve(dir, 'missing'))).files), []);
    await mkdir(resolve(dir, 'empty'));
    await writeFile(resolve(dir, 'empty', '.hidden'), '1');
    assert.deepEqual(rel((await walk(dir)).files), ['empty/.hidden', 'f.txt']);
  });
});

test('displayPath: relative to the base with forward slashes, a dot for the base, absolute outside it', () => {
  const base = resolve('/work/project');
  assert.equal(displayPath(resolve(base, 'src', 'main.js'), base), 'src/main.js');
  assert.equal(displayPath(base, base), '.');
  assert.equal(displayPath(resolve('/work/other/file.js'), base).includes('\\'), false);
  assert.ok(displayPath(resolve('/work/other/file.js'), base).endsWith('/work/other/file.js'));
  assert.equal(displayPath(resolve(base, '..foo'), base), '..foo');
});
