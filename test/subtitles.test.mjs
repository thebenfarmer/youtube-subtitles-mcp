import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseSubtitles,
  classifyFailure,
  extractVideoId,
  isValidLanguage,
  parseVtt,
  truncateText,
  wrapText,
} from '../dist/subtitles.js';
import { AUTO_CHUNKS, SENTENCES, automaticVtt, manualVtt } from './fixtures.mjs';

test('manual subtitles keep every sentence, in order, including repeats', () => {
  const { text, automatic } = parseVtt(manualVtt());
  assert.equal(automatic, false);
  assert.equal(text, SENTENCES.join(' '));
});

test('automatic captions keep each chunk once, including a chunk spoken twice', () => {
  const { text, automatic } = parseVtt(automaticVtt(AUTO_CHUNKS));
  assert.equal(automatic, true);
  assert.equal(text, AUTO_CHUNKS.join(' '));
});

test('multi-line cues, short timestamps, entities and non-Latin text survive', () => {
  const vtt = [
    'WEBVTT', '',
    '00:01.000 --> 00:02.000', 'Fish &amp; chips', 'on two lines', '',
    '00:02.000 --> 00:03.000', 'Über Ärger &#8211; ok', '',
    '00:03.000 --> 00:04.000', '<c.colorE5E5E5>Привет мир</c>', '',
  ].join('\n');
  assert.equal(parseVtt(vtt).text, 'Fish & chips on two lines Über Ärger – ok Привет мир');
});

test('CRLF files parse the same', () => {
  assert.equal(parseVtt(manualVtt().replace(/\n/g, '\r\n')).text, SENTENCES.join(' '));
});

test('chooseSubtitles prefers manual, then original captions, then translation', () => {
  const manual = { language: 'en', content: manualVtt(['Manual line.']) };
  const orig = { language: 'en-orig', content: automaticVtt(['original english words']) };
  assert.equal(chooseSubtitles([orig, manual], 'en').label, 'manual subtitles');

  const autoEn = { language: 'en', content: automaticVtt(['auto english words']) };
  const pick = chooseSubtitles([autoEn, orig], 'en');
  assert.equal(pick.text, 'original english words');
  assert.equal(pick.label, 'automatic captions');
});

test('chooseSubtitles falls back to the original language when the requested one is missing', () => {
  const germanOrig = { language: 'de-orig', content: automaticVtt(['deutsche originalworte']) };
  const pick = chooseSubtitles([germanOrig], 'en');
  assert.equal(pick.language, 'de');
  assert.equal(pick.label, 'automatic captions');
  assert.equal(pick.text, 'deutsche originalworte');
});

test('chooseSubtitles prefers the requested language over another original language', () => {
  const manualEn = { language: 'en', content: manualVtt(['English line.']) };
  const germanOrig = { language: 'de-orig', content: automaticVtt(['deutsche originalworte']) };
  assert.equal(chooseSubtitles([germanOrig, manualEn], 'en').language, 'en');
});

test('chooseSubtitles returns null without usable text', () => {
  assert.equal(chooseSubtitles([], 'en'), null);
  assert.equal(chooseSubtitles([{ language: 'en', content: 'WEBVTT\n' }], 'en'), null);
});

test('extractVideoId accepts YouTube URL shapes and rejects everything else', () => {
  const id = '638GQZ9UZ4w';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?feature=share&v=${id}&t=10`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
  ]) {
    assert.equal(extractVideoId(url), id, url);
  }
  for (const url of [
    '--exec=touch /tmp/pwned',
    `https://evil.example/watch?v=${id}`,
    `https://www.youtube.com.evil.example/watch?v=${id}`,
    'https://www.youtube.com/watch?v=short',
    `file:///watch?v=${id}`,
    '',
  ]) {
    assert.equal(extractVideoId(url), null, url);
  }
});

test('isValidLanguage blocks regex and option characters', () => {
  for (const ok of ['en', 'de', 'en-US', 'zh-Hans', 'pt-BR']) assert.ok(isValidLanguage(ok), ok);
  for (const bad of ['.*', 'en,de', '-x', 'en|de', '', 'e']) assert.ok(!isValidLanguage(bad), bad);
});

test('wrapText keeps every word and short lines', () => {
  const text = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
  const wrapped = wrapText(text, 100);
  assert.ok(wrapped.split('\n').every(line => line.length <= 100));
  assert.equal(wrapped.replace(/\n/g, ' '), text);
});

test('truncateText cuts at a word boundary and reports it', () => {
  assert.deepEqual(truncateText('short', 10), { text: 'short', truncated: false });
  const cut = truncateText('alpha beta gamma delta', 12);
  assert.equal(cut.truncated, true);
  assert.equal(cut.text, 'alpha beta');
});

test('classifyFailure recognises the yt-dlp messages seen in practice', () => {
  assert.equal(classifyFailure('ERROR: Unable to download video subtitles for \'en\': HTTP Error 429: Too Many Requests', '', false), 'rate-limited');
  assert.equal(classifyFailure('ERROR: [youtube] x: Sign in to confirm you’re not a bot.', '', false), 'bot-check');
  assert.equal(classifyFailure('', '[info] There are no subtitles for the requested languages', false), 'no-subtitles');
  assert.equal(classifyFailure('ERROR: [youtube] x: Private video', '', false), 'unavailable');
  assert.equal(classifyFailure('', '', true), 'timeout');
  assert.equal(classifyFailure('something new', '', false), 'unknown');
});
