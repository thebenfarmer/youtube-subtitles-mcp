#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { execa } from 'execa';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { defaultCacheDir, pruneCache, readTranscript, writeTranscript } from './cache.js';
import {
  chooseSubtitles,
  classifyFailure,
  describeFailure,
  extractVideoId,
  isValidLanguage,
  truncateText,
  wrapText,
} from './subtitles.js';

const YT_DLP_TIMEOUT_SECONDS = 120;
const DEFAULT_MAX_LENGTH = 40000;

// Retries are disabled on purpose: on HTTP 429 every further request extends the block.
const YT_DLP_BASE_ARGS = ['--no-playlist', '--retries', '0', '--extractor-retries', '0'];

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

class YouTubeSubtitlesMCPServer {
  private server: Server;

  constructor(private cacheDir = defaultCacheDir()) {
    this.server = new Server(
      {
        name: 'youtube-subtitles-mcp',
        version: '2.0.0',
        description: 'YouTube Subtitles MCP Server for Claude Code',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.setupHandlers();
  }

  private log(level: 'info' | 'error', message: string, data?: unknown): void {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: 'youtube-subtitles-mcp',
      message,
      ...(data !== undefined && { data }),
    }));
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_youtube_subtitles',
          description:
            'Get the complete transcript of a YouTube video from its subtitles. Returns the full spoken text ' +
            '(nothing is summarised or dropped) and the path of a cached text file holding all of it. ' +
            'Long transcripts are cut in the response with a marker; read the rest from that file.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'YouTube video URL',
              },
              language: {
                type: 'string',
                description: 'Preferred language code (e.g. "en", "de"). Falls back to the video\'s original language.',
                default: 'en',
              },
              maxLength: {
                type: 'number',
                description: `Maximum characters returned inline (default: ${DEFAULT_MAX_LENGTH}). The file always holds everything.`,
                default: DEFAULT_MAX_LENGTH,
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'get_youtube_info',
          description: 'Get basic information about a YouTube video',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'YouTube video URL',
              },
            },
            required: ['url'],
          },
        },
      ] as Tool[],
    }));

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const input = (args ?? {}) as Record<string, unknown>;

      try {
        switch (name) {
          case 'get_youtube_subtitles':
            return await this.getYouTubeSubtitles(
              String(input.url ?? ''),
              typeof input.language === 'string' && input.language ? input.language : 'en',
              typeof input.maxLength === 'number' && input.maxLength > 0 ? input.maxLength : DEFAULT_MAX_LENGTH,
            );
          case 'get_youtube_info':
            return await this.getYouTubeInfo(String(input.url ?? ''));
          default:
            return errorResult(`Unknown tool: ${name}`);
        }
      } catch (error) {
        this.log('error', 'Tool failed', { tool: name, error: error instanceof Error ? error.message : String(error) });
        return errorResult(error instanceof Error ? error.message : 'Unknown error');
      }
    });
  }

  private async getYouTubeSubtitles(url: string, language: string, maxLength: number): Promise<CallToolResult> {
    const videoId = extractVideoId(url);
    if (!videoId) {
      return errorResult(`Not a YouTube video URL: ${url}`);
    }
    if (!isValidLanguage(language)) {
      return errorResult(`Not a language code: ${language}`);
    }

    const removed = await pruneCache(this.cacheDir);
    if (removed.length > 0) {
      this.log('info', 'Pruned cache', { removed: removed.length });
    }

    const cached = await readTranscript(this.cacheDir, videoId, language);
    if (cached) {
      return this.formatTranscript(cached.path, cached.language, cached.label, cached.text, maxLength, true);
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), 'youtube-subtitles-'));
    try {
      // One yt-dlp run: the requested language plus the original-language automatic captions.
      const result = await execa('yt-dlp', [
        ...YT_DLP_BASE_ARGS,
        '--ignore-errors',
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-format', 'vtt',
        '--sub-langs', `${language},.*-orig`,
        '--output', join(tempDir, 'subtitles.%(ext)s'),
        '--',
        url,
      ], { reject: false, timeout: YT_DLP_TIMEOUT_SECONDS * 1000 });

      const files = (await fs.readdir(tempDir)).filter(f => f.endsWith('.vtt'));
      const candidates = await Promise.all(files.map(async file => ({
        language: file.replace(/^subtitles\./, '').replace(/\.vtt$/, ''),
        content: await fs.readFile(join(tempDir, file), 'utf-8'),
      })));

      const chosen = chooseSubtitles(candidates, language);
      if (!chosen) {
        const kind = files.length > 0 ? 'no-subtitles' : classifyFailure(result.stderr, result.stdout, Boolean(result.timedOut));
        this.log('error', 'No subtitles', { videoId, kind, exitCode: result.exitCode });
        return errorResult(describeFailure(kind, {
          language,
          timeoutSeconds: YT_DLP_TIMEOUT_SECONDS,
          stderr: result.stderr,
        }));
      }

      const path = await writeTranscript(this.cacheDir, language, {
        videoId,
        language: chosen.language,
        label: chosen.label,
        text: chosen.text,
      });
      return this.formatTranscript(path, chosen.language, chosen.label, wrapText(chosen.text), maxLength, false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private formatTranscript(
    path: string,
    language: string,
    label: string,
    text: string,
    maxLength: number,
    fromCache: boolean,
  ): CallToolResult {
    const shown = truncateText(text, maxLength);
    const header = [
      `YouTube transcript (${language}, ${label})`,
      `Full transcript file: ${path} (${text.length} characters${fromCache ? ', from cache' : ''})`,
    ].join('\n');
    const footer = shown.truncated
      ? `\n\n[TRUNCATED: showing ${shown.text.length} of ${text.length} characters. Read the rest from ${path}]`
      : '';
    return { content: [{ type: 'text', text: `${header}\n\n${shown.text}${footer}` }] };
  }

  private async getYouTubeInfo(url: string): Promise<CallToolResult> {
    if (!extractVideoId(url)) {
      return errorResult(`Not a YouTube video URL: ${url}`);
    }

    const result = await execa('yt-dlp', [...YT_DLP_BASE_ARGS, '--dump-json', '--skip-download', '--', url], {
      reject: false,
      timeout: YT_DLP_TIMEOUT_SECONDS * 1000,
    });
    if (result.exitCode !== 0 || result.timedOut) {
      const kind = classifyFailure(result.stderr, result.stdout, Boolean(result.timedOut));
      return errorResult(describeFailure(kind, { timeoutSeconds: YT_DLP_TIMEOUT_SECONDS, stderr: result.stderr }));
    }

    const info = JSON.parse(result.stdout);
    const videoInfo = {
      title: info.title,
      description: info.description,
      duration: info.duration,
      upload_date: info.upload_date,
      uploader: info.uploader,
      view_count: info.view_count,
      like_count: info.like_count,
      channel: info.channel,
      thumbnail: info.thumbnail,
    };
    return { content: [{ type: 'text', text: `Video Information:\n${JSON.stringify(videoInfo, null, 2)}` }] };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.log('info', 'YouTube Subtitles MCP Server running on stdio', { cacheDir: this.cacheDir });
  }
}

const server = new YouTubeSubtitlesMCPServer();
server.run().catch((error) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    service: 'youtube-subtitles-mcp',
    message: 'Failed to start server',
    error: error.message,
    stack: error.stack,
  }));
  process.exit(1);
});
