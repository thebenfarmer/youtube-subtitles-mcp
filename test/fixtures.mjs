// Invented sample text in the formats YouTube delivers.

export const SENTENCES = [
  'We need to talk about sales and marketing today.',
  'Okay.',
  'Okay.',
  'The agents are getting better every single month.',
  'Is it worth it? I think it is worth it.',
  'So what you want to do is focus on the customer first.',
  'Then you build the system around the customer.',
  'And then what you want to do is focus on the customer first again.',
];

const ts = seconds => {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${h}:${m}:${s}`;
};

export function manualVtt(lines = SENTENCES) {
  const cues = lines.map((line, i) => `${i + 1}\n${ts(i * 3)} --> ${ts(i * 3 + 2)}\n${line}`);
  return `WEBVTT\nKind: captions\nLanguage: en\n\nNOTE written by hand\n\n${cues.join('\n\n')}\n`;
}

/**
 * Rolling automatic captions: every cue repeats the previous line, new words carry
 * <timestamp><c> tags, and a 10 ms cue repeats the finished line without tags.
 */
export function automaticVtt(chunks) {
  const out = ['WEBVTT', 'Kind: captions', 'Language: en', ''];
  let t = 0;
  let previous = '';
  for (const chunk of chunks) {
    const [first, ...rest] = chunk.split(' ');
    const tagged = [first, ...rest.map((w, i) => `<${ts(t + 0.2 * (i + 1))}><c> ${w}</c>`)].join('');
    out.push(`${ts(t)} --> ${ts(t + 2)} align:start position:0%`, previous || ' ', tagged, '');
    out.push(`${ts(t + 2)} --> ${ts(t + 2.01)} align:start position:0%`, chunk, ' ', '');
    previous = chunk;
    t += 2.01;
  }
  return out.join('\n');
}

export const AUTO_CHUNKS = [
  'so the first thing we',
  'want to look at is',
  'how the agents work',
  'want to look at is',
  'and why it matters',
];
