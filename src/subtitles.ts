const CUE_TIMING = /^(?:\d+:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(?:\d+:)?\d{2}:\d{2}\.\d{3}/;
// YouTube's automatic captions carry per-word timestamps like <00:00:19.039>.
const INLINE_TIMESTAMP = /<(?:\d+:)?\d{2}:\d{2}\.\d{3}>/;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanLine(line: string): string {
  return decodeEntities(line.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

export interface ParsedSubtitles {
  text: string;
  automatic: boolean;
}

/**
 * Turns a WebVTT file into plain text without dropping spoken content.
 *
 * Manual subtitles are kept line by line. Automatic captions are "rolling":
 * each cue repeats the previous line before adding new words, so for them a
 * line without word timestamps is only kept if it differs from the line
 * emitted just before it.
 */
export function parseVtt(vtt: string): ParsedSubtitles {
  const lines = vtt.replace(/\r\n?/g, '\n').split('\n');
  const automatic = INLINE_TIMESTAMP.test(vtt);
  const output: string[] = [];
  let inCue = false;
  let lastEmitted = '';

  for (const raw of lines) {
    if (CUE_TIMING.test(raw.trim())) {
      inCue = true;
      continue;
    }
    if (raw === '') {
      inCue = false;
      continue;
    }
    if (!inCue) continue;

    const text = cleanLine(raw);
    if (!text) continue;

    if (automatic && !INLINE_TIMESTAMP.test(raw) && text === lastEmitted) continue;

    output.push(text);
    lastEmitted = text;
  }

  return { text: output.join(' '), automatic };
}

export interface SubtitleCandidate {
  language: string;
  content: string;
}

export interface ChosenSubtitles {
  language: string;
  label: string;
  text: string;
}

/**
 * Picks the most faithful track: manual subtitles in the requested language,
 * then automatic captions in it, then automatic captions in the video's
 * original language ("<lang>-orig").
 */
export function chooseSubtitles(candidates: SubtitleCandidate[], requested: string): ChosenSubtitles | null {
  const parsed = candidates
    .map(c => ({ language: c.language, ...parseVtt(c.content) }))
    .filter(c => c.text.length > 0);
  if (parsed.length === 0) return null;

  const rank = (c: (typeof parsed)[number]): number => {
    if (c.language === requested && !c.automatic) return 0;
    if (c.language === `${requested}-orig`) return 1;
    if (c.language === requested) return 2;
    if (c.language.endsWith('-orig')) return 3;
    return 4;
  };

  const best = [...parsed].sort((a, b) => rank(a) - rank(b))[0];
  return {
    language: best.language.replace(/-orig$/, ''),
    label: best.automatic ? 'automatic captions' : 'manual subtitles',
    text: best.text,
  };
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/;

export function extractVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  let id: string | null = null;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOSTS.test(url.hostname)) {
    const [, first, second] = url.pathname.split('/');
    if (first === 'watch') id = url.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(first)) id = second ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export function isValidLanguage(language: string): boolean {
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(language);
}

export function wrapText(text: string, width = 100): string {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

export function truncateText(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) return { text, truncated: false };
  const cut = text.slice(0, maxLength);
  const lastBreak = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return { text: lastBreak > 0 ? cut.slice(0, lastBreak) : cut, truncated: true };
}

/** yt-dlp warns on stderr once it is older than 90 days; an outdated yt-dlp breaks when YouTube changes. */
export function outdatedNotice(stderr: string): string | null {
  const line = stderr.split('\n').find(l => /yt-dlp version .* is older than \d+ days/i.test(l));
  if (!line) return null;
  return `[NOTICE: ${line.replace(/^WARNING:\s*/, '').trim()} Update it (e.g. \`brew upgrade yt-dlp\`) before YouTube changes break it.]`;
}

export type FailureKind = 'rate-limited' | 'bot-check' | 'no-subtitles' | 'unavailable' | 'timeout' | 'unknown';

export function classifyFailure(stderr: string, stdout: string, timedOut: boolean): FailureKind {
  const output = `${stderr}\n${stdout}`;
  if (timedOut) return 'timeout';
  if (/HTTP Error 429/i.test(output)) return 'rate-limited';
  if (/Sign in to confirm/i.test(output)) return 'bot-check';
  if (/Private video|Video unavailable|This video has been removed|Unsupported URL/i.test(output)) return 'unavailable';
  if (/There are no subtitles|no subtitles for the requested languages|has no (?:automatic captions|subtitles)/i.test(output)) {
    return 'no-subtitles';
  }
  return 'unknown';
}

export function describeFailure(kind: FailureKind, details: { language?: string; timeoutSeconds?: number; stderr?: string }): string {
  switch (kind) {
    case 'rate-limited':
      return 'YouTube answered with HTTP 429 (Too Many Requests). No further attempts were made, because retrying ' +
        'can extend the block. This is either a temporary block of this connection or YouTube demanding a PO token ' +
        'for this video. Try again later, or try another video to tell the two apart.';
    case 'bot-check':
      return 'YouTube asks to sign in to confirm this is not a bot. This connection is treated as automated; ' +
        'yt-dlp needs browser cookies (--cookies-from-browser) to get past it.';
    case 'no-subtitles':
      return `This video has no subtitles in "${details.language}" and no automatic captions in its original language. ` +
        'Manual subtitles in another language may still exist; request that language explicitly.';
    case 'unavailable':
      return 'The video is private, removed, or the URL is not a YouTube video.';
    case 'timeout':
      return `yt-dlp did not finish within ${details.timeoutSeconds} seconds and was stopped.`;
    default: {
      const tail = (details.stderr ?? '').trim().split('\n').slice(-5).join('\n');
      return `yt-dlp failed for an unrecognised reason. Last output:\n${tail || '(none)'}`;
    }
  }
}
