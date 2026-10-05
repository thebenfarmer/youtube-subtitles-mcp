import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { wrapText } from './subtitles.js';

export const MAX_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CachedTranscript {
  path: string;
  videoId: string;
  language: string;
  label: string;
  text: string;
}

export function defaultCacheDir(): string {
  return process.env.YOUTUBE_MCP_CACHE_DIR || join(homedir(), '.cache', 'youtube-subtitles-mcp');
}

function cachePath(dir: string, videoId: string, requestedLanguage: string): string {
  return join(dir, `${videoId}.${requestedLanguage}.txt`);
}

/** Header lines start with "# ", the wrapped transcript follows after one blank line. */
export async function writeTranscript(
  dir: string,
  requestedLanguage: string,
  entry: Omit<CachedTranscript, 'path'>,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const path = cachePath(dir, entry.videoId, requestedLanguage);
  const header = [
    `# video: https://www.youtube.com/watch?v=${entry.videoId}`,
    `# language: ${entry.language}`,
    `# source: ${entry.label}`,
    `# fetched: ${new Date().toISOString()}`,
  ].join('\n');
  await fs.writeFile(path, `${header}\n\n${wrapText(entry.text)}\n`, 'utf-8');
  return path;
}

export async function readTranscript(
  dir: string,
  videoId: string,
  requestedLanguage: string,
): Promise<CachedTranscript | null> {
  const path = cachePath(dir, videoId, requestedLanguage);
  let content: string;
  try {
    content = await fs.readFile(path, 'utf-8');
  } catch {
    return null;
  }

  const separator = content.indexOf('\n\n');
  if (separator === -1) return null;
  const header = Object.fromEntries(
    content
      .slice(0, separator)
      .split('\n')
      .map(line => line.match(/^# (\w+): (.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => [m[1], m[2]]),
  );
  if (!header.language || !header.source) return null;

  const now = new Date();
  await fs.utimes(path, now, now);
  return {
    path,
    videoId,
    language: header.language,
    label: header.source,
    text: content.slice(separator + 2).trim(),
  };
}

/** Deletes transcripts that were neither written nor read for MAX_AGE_DAYS. */
export async function pruneCache(dir: string, now = Date.now()): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.txt')) continue;
    const path = join(dir, name);
    try {
      const { mtimeMs } = await fs.stat(path);
      if (now - mtimeMs > MAX_AGE_DAYS * DAY_MS) {
        await fs.unlink(path);
        removed.push(name);
      }
    } catch {
      // A file removed concurrently is already gone, which is the goal.
    }
  }
  return removed;
}
