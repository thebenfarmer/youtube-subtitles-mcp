import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SENTENCES, automaticVtt, manualVtt } from './fixtures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = 'https://www.youtube.com/watch?v=638GQZ9UZ4w';

// Stand-in for yt-dlp: logs each call, then behaves as FAKE_MODE says.
const FAKE_YT_DLP = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
const out = args[args.indexOf('--output') + 1];
const write = (lang, content) => fs.writeFileSync(out.replace('%(ext)s', lang + '.vtt'), content);
const mode = process.env.FAKE_MODE;
if (mode === 'manual') write('en', process.env.FAKE_VTT);
if (mode === 'original-only') write('de-orig', process.env.FAKE_VTT);
if (mode === '429') { console.error("ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests"); process.exit(1); }
if (mode === 'nosubs') console.log('[info] There are no subtitles for the requested languages');
`;

async function setup(mode, extraEnv = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'yt-server-test-'));
  const bin = join(dir, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(join(bin, 'yt-dlp'), FAKE_YT_DLP, { mode: 0o755 });
  const log = join(dir, 'calls.log');
  await fs.writeFile(log, '');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_LOG: log,
    FAKE_MODE: mode,
    YOUTUBE_MCP_CACHE_DIR: join(dir, 'cache'),
    ...extraEnv,
  };
  const calls = async () => (await fs.readFile(log, 'utf-8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { env, calls, cacheDir: join(dir, 'cache') };
}

async function callTool(env, name, args) {
  const child = spawn('node', [join(root, 'dist/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const responses = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (message.id !== undefined) responses.set(message.id, message);
    }
  });
  const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const waitFor = async id => {
    for (let i = 0; i < 200 && !responses.has(id); i++) await new Promise(r => setTimeout(r, 25));
    if (!responses.has(id)) throw new Error(`no response for request ${id}`);
    return responses.get(id);
  };

  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  await waitFor(1);
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/call', params: { name, arguments: args } });
  const response = await waitFor(2);
  child.kill();
  return response.result;
}

test('fetches the full transcript with one yt-dlp call and caches it', async () => {
  const { env, calls, cacheDir } = await setup('manual', { FAKE_VTT: manualVtt() });

  const first = await callTool(env, 'get_youtube_subtitles', { url: VIDEO });
  assert.ok(!first.isError, first.content[0].text);
  const text = first.content[0].text;
  for (const sentence of SENTENCES) assert.ok(text.replace(/\n/g, ' ').includes(sentence), sentence);
  assert.match(text, /manual subtitles/);

  const recorded = await calls();
  assert.equal(recorded.length, 1);
  const args = recorded[0];
  assert.equal(args.at(-2), '--', 'URL is separated from options');
  assert.equal(args.at(-1), VIDEO);
  assert.equal(args[args.indexOf('--retries') + 1], '0');
  assert.equal(args[args.indexOf('--sub-langs') + 1], 'en,.*-orig');

  const files = await fs.readdir(cacheDir);
  assert.deepEqual(files, ['638GQZ9UZ4w.en.txt']);

  const second = await callTool(env, 'get_youtube_subtitles', { url: VIDEO });
  assert.match(second.content[0].text, /from cache/);
  assert.equal((await calls()).length, 1, 'cache hit does not call yt-dlp');
});

test('stops after one call on HTTP 429 and says so', async () => {
  const { env, calls } = await setup('429');
  const result = await callTool(env, 'get_youtube_subtitles', { url: VIDEO });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 429/);
  assert.match(result.content[0].text, /No further attempts/);
  assert.equal((await calls()).length, 1);
});

test('reports a video without subtitles plainly', async () => {
  const { env } = await setup('nosubs');
  const result = await callTool(env, 'get_youtube_subtitles', { url: VIDEO, language: 'de' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no subtitles in "de"/);
});

test('rejects option-like or foreign URLs before running yt-dlp', async () => {
  const { env, calls } = await setup('manual', { FAKE_VTT: manualVtt() });
  for (const url of ['--exec=touch /tmp/pwned', 'https://evil.example/watch?v=638GQZ9UZ4w']) {
    const result = await callTool(env, 'get_youtube_subtitles', { url });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Not a YouTube video URL/);
  }
  const info = await callTool(env, 'get_youtube_info', { url: '--exec=touch /tmp/pwned' });
  assert.equal(info.isError, true);
  assert.equal((await calls()).length, 0);
});

test('long transcripts are cut inline with a pointer to the full file', async () => {
  const { env } = await setup('manual', { FAKE_VTT: manualVtt() });
  const result = await callTool(env, 'get_youtube_subtitles', { url: VIDEO, maxLength: 60 });
  const text = result.content[0].text;
  assert.match(text, /\[TRUNCATED: showing \d+ of \d+ characters\. Read the rest from .*638GQZ9UZ4w\.en\.txt\]/);
});

test('falls back to the original-language captions', async () => {
  const { env } = await setup('original-only', { FAKE_VTT: automaticVtt(['deutsche originalworte']) });
  const result = await callTool(env, 'get_youtube_subtitles', { url: VIDEO });
  assert.match(result.content[0].text, /^YouTube transcript \(de, automatic captions\)/);
  assert.match(result.content[0].text, /deutsche originalworte/);
});
