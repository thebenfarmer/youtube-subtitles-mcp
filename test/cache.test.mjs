import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MAX_AGE_DAYS, pruneCache, readTranscript, writeTranscript } from '../dist/cache.js';

const DAY = 24 * 60 * 60 * 1000;
const tempDir = () => fs.mkdtemp(join(tmpdir(), 'yt-cache-test-'));

test('a written transcript reads back with language, label and full text', async () => {
  const dir = await tempDir();
  const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  const path = await writeTranscript(dir, 'en', { videoId: 'abcdefghijk', language: 'de', label: 'automatic captions', text });

  const lines = (await fs.readFile(path, 'utf-8')).split('\n');
  assert.ok(lines.every(line => line.length <= 100), 'file lines stay short enough for line-based readers');

  const back = await readTranscript(dir, 'abcdefghijk', 'en');
  assert.equal(back.language, 'de');
  assert.equal(back.label, 'automatic captions');
  assert.equal(back.text.replace(/\n/g, ' '), text);
  assert.equal(await readTranscript(dir, 'abcdefghijk', 'fr'), null);
});

test('pruneCache removes files unused for the age limit and keeps the rest', async () => {
  const dir = await tempDir();
  const now = Date.now();
  const old = await writeTranscript(dir, 'en', { videoId: 'oldoldoldol', language: 'en', label: 'manual subtitles', text: 'old' });
  const fresh = await writeTranscript(dir, 'en', { videoId: 'freshfreshf', language: 'en', label: 'manual subtitles', text: 'fresh' });
  const past = new Date(now - (MAX_AGE_DAYS + 1) * DAY);
  await fs.utimes(old, past, past);

  assert.deepEqual(await pruneCache(dir, now), ['oldoldoldol.en.txt']);
  await assert.rejects(fs.stat(old));
  await fs.stat(fresh);
});

test('reading a transcript counts as use and protects it from pruning', async () => {
  const dir = await tempDir();
  const path = await writeTranscript(dir, 'en', { videoId: 'usedusedused'.slice(0, 11), language: 'en', label: 'manual subtitles', text: 'x' });
  const past = new Date(Date.now() - (MAX_AGE_DAYS + 1) * DAY);
  await fs.utimes(path, past, past);

  await readTranscript(dir, 'usedusedused'.slice(0, 11), 'en');
  assert.deepEqual(await pruneCache(dir), []);
});

test('pruneCache on a missing folder does nothing', async () => {
  assert.deepEqual(await pruneCache(join(tmpdir(), 'does-not-exist-yt-cache')), []);
});
