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

class YouTubeSubtitlesMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'youtube-subtitles-mcp',
        version: '1.0.0',
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

  private log(level: 'info' | 'error' | 'debug', message: string, data?: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'youtube-subtitles-mcp',
      message,
      ...(data && { data })
    };
    console.error(JSON.stringify(logEntry));
  }

  private setupHandlers(): void {
    // Tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_youtube_subtitles',
            description: 'Download subtitles from a YouTube video',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'YouTube video URL',
                },
                language: {
                  type: 'string',
                  description: 'Language code for subtitles (e.g., "en", "de")',
                  default: 'en',
                },
                maxLength: {
                  type: 'number',
                  description: 'Maximum character length for subtitles (default: 50000)',
                  default: 50000,
                },
                compressionLevel: {
                  type: 'string',
                  description: 'Compression level: "full" (all text), "medium" (key segments), "summary" (condensed)',
                  enum: ['full', 'medium', 'summary'],
                  default: 'full',
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
      };
    });

    // Resources handler
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [],
      };
    });

    // Prompts handler
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_youtube_subtitles':
            return await this.getYouTubeSubtitles(
              (args as any)?.url, 
              (args as any)?.language || 'en',
              (args as any)?.maxLength || 50000,
              (args as any)?.compressionLevel || 'full'
            );
          case 'get_youtube_info':
            return await this.getYouTubeInfo((args as any)?.url);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async getYouTubeSubtitles(url: string, language: string, maxLength: number = 50000, compressionLevel: 'full' | 'medium' | 'summary' = 'full'): Promise<CallToolResult> {
    let tempDir: string | null = null;
    
    try {
      // Create temporary directory for subtitles
      tempDir = await fs.mkdtemp(join(tmpdir(), 'youtube-subtitles-'));
      const subtitlePath = join(tempDir, 'subtitles.%(ext)s');

      // Use system ffmpeg if available, fallback to bundled version
      let ffmpegPath: string | undefined;
      try {
        // Try to get system ffmpeg first
        const { stdout } = await execa('which', ['ffmpeg']);
        ffmpegPath = stdout.trim();
        this.log('info', 'Using system ffmpeg', { path: ffmpegPath });
      } catch (error) {
        // Fallback to bundled ffmpeg-static if system ffmpeg not available
        try {
          const ffmpegStatic = await import('ffmpeg-static');
          ffmpegPath = ffmpegStatic.default || undefined;
          if (ffmpegPath) {
            this.log('info', 'Using bundled ffmpeg from ffmpeg-static');
          }
        } catch (error) {
          this.log('info', 'No ffmpeg found, attempting without ffmpeg specification');
        }
      }

      // Try multiple subtitle download strategies
      const strategies = [
        // Strategy 1: Try manual subtitles first
        {
          name: 'manual',
          args: [
            '--write-sub',
            '--sub-lang', language,
            '--skip-download',
            '--sub-format', 'vtt',
            '--output', subtitlePath,
            url,
          ]
        },
        // Strategy 2: Try auto-generated subtitles
        {
          name: 'auto',
          args: [
            '--write-auto-sub',
            '--sub-lang', language,
            '--skip-download',
            '--sub-format', 'vtt',
            '--output', subtitlePath,
            url,
          ]
        },
        // Strategy 3: Try both manual and auto for the language
        {
          name: 'both',
          args: [
            '--write-sub',
            '--write-auto-sub',
            '--sub-lang', language,
            '--skip-download',
            '--sub-format', 'vtt',
            '--output', subtitlePath,
            url,
          ]
        }
      ];

      // Add fallback languages for German and English
      const fallbackLanguages = this.getFallbackLanguages(language);
      for (const fallbackLang of fallbackLanguages) {
        strategies.push({
          name: `fallback-${fallbackLang}`,
          args: [
            '--write-sub',
            '--write-auto-sub',
            '--sub-lang', fallbackLang,
            '--skip-download',
            '--sub-format', 'vtt',
            '--output', subtitlePath,
            url,
          ]
        });
      }

      let lastError: Error | null = null;
      let subtitleFile: string | undefined;

      for (const strategy of strategies) {
        try {
          this.log('info', 'Trying strategy', { strategy: strategy.name });
          
          // Clean temp directory for each attempt
          const files = await fs.readdir(tempDir);
          for (const file of files) {
            await fs.unlink(join(tempDir, file));
          }

          const args = [...strategy.args];
          
          // Add ffmpeg location if available
          if (ffmpegPath) {
            args.unshift('--ffmpeg-location', ffmpegPath);
          }
          
          await execa('yt-dlp', args);
          this.log('info', 'Strategy completed successfully', { strategy: strategy.name });

          // Find the downloaded subtitle file
          const newFiles = await fs.readdir(tempDir);
          subtitleFile = newFiles.find(file => file.endsWith('.vtt'));
          
          if (subtitleFile) {
            this.log('info', 'Found subtitle file', { filename: subtitleFile });
            break;
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Unknown error');
          this.log('error', 'Strategy failed', { strategy: strategy.name, error: lastError.message });
          continue;
        }
      }
      
      if (!subtitleFile) {
        // Try to provide more helpful error message
        const availableFiles = await fs.readdir(tempDir);
        const fileList = availableFiles.join(', ');
        throw new Error(`No subtitles found for language: ${language}. Available files: ${fileList || 'none'}. Last error: ${lastError?.message || 'Unknown'}. This might be due to: 1) No subtitles available for this video, 2) Language not available, 3) Private or restricted video`);
      }

      // Read subtitle content
      const subtitleContent = await fs.readFile(join(tempDir, subtitleFile), 'utf-8');
      
      // Clean up temporary directory
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }

      // Parse VTT content to extract text with intelligent compression
      const textContent = this.parseVTTContent(subtitleContent, maxLength, compressionLevel);

      // Determine the actual language used
      const actualLanguage = this.detectLanguageFromFilename(subtitleFile, language);

      return {
        content: [
          {
            type: 'text',
            text: `YouTube Subtitles (${actualLanguage}):\n\n${textContent}`,
          },
        ],
      };
    } catch (error) {
      // Clean up temporary directory in case of error
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          this.log('error', 'Failed to clean up temp directory', { error: cleanupError });
        }
      }
      
      // Enhanced error handling
      let errorMessage = 'Failed to download subtitles: ';
      
      if (error instanceof Error) {
        errorMessage += error.message;
        
        // Add specific guidance for common errors
        if (error.message.includes('ERROR: Did not get any data blocks')) {
          errorMessage += '\n\nThis error often occurs when ffmpeg is not installed. Please install ffmpeg: https://ffmpeg.org/download.html';
        } else if (error.message.includes('ERROR: Unsupported URL')) {
          errorMessage += '\n\nPlease provide a valid YouTube URL (e.g., https://www.youtube.com/watch?v=...)';
        } else if (error.message.includes('ERROR: Private video')) {
          errorMessage += '\n\nThis video is private and cannot be accessed.';
        }
      } else {
        errorMessage += 'Unknown error';
      }
      
      throw new Error(errorMessage);
    }
  }

  private getFallbackLanguages(language: string): string[] {
    const fallbacks: {[key: string]: string[]} = {
      'de': ['de-DE', 'de-AT', 'de-CH', 'en', 'en-US', 'en-GB'],
      'en': ['en-US', 'en-GB', 'en-CA', 'en-AU', 'de'],
      'de-DE': ['de', 'de-AT', 'de-CH', 'en'],
      'en-US': ['en', 'en-GB', 'en-CA', 'de'],
      'en-GB': ['en', 'en-US', 'en-CA', 'de'],
    };
    
    return fallbacks[language] || ['en', 'en-US', 'de'];
  }

  private detectLanguageFromFilename(filename: string, requestedLanguage: string): string {
    // Extract language code from filename
    const matches = filename.match(/\.([a-z]{2}(?:-[A-Z]{2})?)\./);
    if (matches) {
      return matches[1];
    }
    
    // Check for auto-generated indicator
    if (filename.includes('auto')) {
      return `${requestedLanguage} (auto-generated)`;
    }
    
    return requestedLanguage;
  }

  private async getYouTubeInfo(url: string): Promise<CallToolResult> {
    try {
      const { stdout } = await execa('yt-dlp', [
        '--dump-json',
        '--no-download',
        url,
      ]);

      const info = JSON.parse(stdout);
      
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

      return {
        content: [
          {
            type: 'text',
            text: `Video Information:\n${JSON.stringify(videoInfo, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      // Enhanced error handling
      let errorMessage = 'Failed to get video info: ';
      
      if (error instanceof Error) {
        errorMessage += error.message;
        
        // Add specific guidance for common errors
        if (error.message.includes('ERROR: Unsupported URL')) {
          errorMessage += '\n\nPlease provide a valid YouTube URL (e.g., https://www.youtube.com/watch?v=...)';
        } else if (error.message.includes('ERROR: Private video')) {
          errorMessage += '\n\nThis video is private and cannot be accessed.';
        } else if (error.message.includes('ERROR: Video unavailable')) {
          errorMessage += '\n\nThis video is unavailable or has been removed.';
        }
      } else {
        errorMessage += 'Unknown error';
      }
      
      throw new Error(errorMessage);
    }
  }

  private parseVTTContent(vttContent: string, maxLength: number = 50000, compressionLevel: 'full' | 'medium' | 'summary' = 'full'): string {
    const lines = vttContent.split('\n');
    const subtitleSegments: Array<{text: string, startTime: number, endTime: number}> = [];
    let currentText = '';
    let currentTimestamp = '';
    
    // Parse VTT segments
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip VTT header and empty lines
      if (line === 'WEBVTT' || line === '' || line.startsWith('NOTE')) {
        continue;
      }
      
      // Detect timestamp lines
      const timestampMatch = line.match(/^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/);
      if (timestampMatch) {
        // Save previous segment if exists
        if (currentText && currentTimestamp) {
          const prevTimestamp = currentTimestamp.match(/^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/);
          if (prevTimestamp) {
            subtitleSegments.push({
              text: currentText,
              startTime: this.parseTimestamp(prevTimestamp[1]),
              endTime: this.parseTimestamp(prevTimestamp[2])
            });
          }
        }
        
        currentTimestamp = line;
        currentText = '';
        continue;
      }
      
      // Skip cue identifier lines (numbers)
      if (line.match(/^\d+$/)) {
        continue;
      }
      
      // Collect text content
      if (line && currentTimestamp) {
        // Remove HTML tags and styling
        const cleanText = line.replace(/<[^>]*>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        
        if (cleanText) {
          currentText += (currentText ? ' ' : '') + cleanText;
        }
      }
    }
    
    // Add last segment
    if (currentText && currentTimestamp) {
      const lastTimestamp = currentTimestamp.match(/^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/);
      if (lastTimestamp) {
        subtitleSegments.push({
          text: currentText,
          startTime: this.parseTimestamp(lastTimestamp[1]),
          endTime: this.parseTimestamp(lastTimestamp[2])
        });
      }
    }
    
    // Remove duplicates and merge overlapping segments
    let processedSegments = this.removeDuplicatesAndMerge(subtitleSegments);
    
    // Calculate optimal maxLength if too high or using default
    if (maxLength > 50000) {
      maxLength = this.calculateOptimalMaxLength(processedSegments.length, compressionLevel);
    }
    
    // Apply compression based on level
    processedSegments = this.applyCompressionLevel(processedSegments, compressionLevel);
    
    // Join all text segments
    const fullText = processedSegments.map(segment => segment.text).join(' ');
    
    // Final length limiting with intelligent truncation
    return this.applyIntelligentTruncation(fullText, maxLength);
  }

  private parseTimestamp(timestamp: string): number {
    const [hours, minutes, seconds] = timestamp.split(':');
    const [secs, ms] = seconds.split('.');
    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(secs) + parseInt(ms) / 1000;
  }

  private removeDuplicatesAndMerge(segments: Array<{text: string, startTime: number, endTime: number}>): Array<{text: string, startTime: number, endTime: number}> {
    if (segments.length === 0) return [];
    
    // Sort by start time
    segments.sort((a, b) => a.startTime - b.startTime);
    
    // Phase 1: Remove exact duplicates and normalize
    const phase1: Array<{text: string, startTime: number, endTime: number}> = [];
    const exactSeen = new Set<string>();
    
    for (const segment of segments) {
      const normalizedText = this.normalizeText(segment.text);
      
      if (!exactSeen.has(normalizedText) && normalizedText.length > 0) {
        phase1.push(segment);
        exactSeen.add(normalizedText);
      }
    }
    
    // Phase 2: Remove semantic duplicates with higher precision
    const phase2: Array<{text: string, startTime: number, endTime: number}> = [];
    
    for (const segment of phase1) {
      let isDuplicate = false;
      const currentNorm = this.normalizeText(segment.text);
      
      // Check against all existing segments with stricter similarity
      for (const existing of phase2) {
        const existingNorm = this.normalizeText(existing.text);
        
        if (this.isAdvancedTextDuplicate(currentNorm, existingNorm)) {
          isDuplicate = true;
          break;
        }
      }
      
      if (!isDuplicate) {
        phase2.push(segment);
      }
    }
    
    // Phase 3: Merge temporally close segments and remove phrase repetitions
    const phase3: Array<{text: string, startTime: number, endTime: number}> = [];
    
    for (const segment of phase2) {
      let merged = false;
      
      // Check if this segment can be merged with recent segments
      if (phase3.length > 0) {
        const lastSegment = phase3[phase3.length - 1];
        
        // If segments are close in time (within 2 seconds)
        if (segment.startTime <= lastSegment.endTime + 2.0) {
          const similarity = this.calculateTextSimilarity(lastSegment.text, segment.text);
          
          // If similarity is high, it's likely a repetition
          if (similarity > 0.8) {
            // Skip this segment as it's likely a repetition
            merged = true;
          } else if (similarity < 0.6) {
            // Low similarity, safe to merge
            lastSegment.text = lastSegment.text + ' ' + segment.text;
            lastSegment.endTime = Math.max(lastSegment.endTime, segment.endTime);
            merged = true;
          }
        }
      }
      
      if (!merged) {
        phase3.push(segment);
      }
    }
    
    // Phase 4: Final pass - remove internal phrase repetitions
    const finalSegments: Array<{text: string, startTime: number, endTime: number}> = [];
    
    for (const segment of phase3) {
      const cleanedText = this.removeInternalPhraseRepetitions(segment.text);
      if (cleanedText.length > 0) {
        finalSegments.push({
          ...segment,
          text: cleanedText
        });
      }
    }
    
    return finalSegments;
  }

  private normalizeText(text: string): string {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isTextDuplicate(text1: string, text2: string): boolean {
    // Check for exact match
    if (text1 === text2) return true;
    
    // Check if one text is contained in the other (for partial duplicates)
    if (text1.length > 20 && text2.length > 20) {
      const longer = text1.length > text2.length ? text1 : text2;
      const shorter = text1.length > text2.length ? text2 : text1;
      
      // If the shorter text is more than 80% contained in the longer text
      if (longer.includes(shorter) && shorter.length / longer.length > 0.8) {
        return true;
      }
    }
    
    // Check similarity for medium-length texts
    if (text1.length > 50 && text2.length > 50) {
      const similarity = this.calculateTextSimilarity(text1, text2);
      return similarity > 0.85; // 85% similarity threshold
    }
    
    return false;
  }

  private isAdvancedTextDuplicate(text1: string, text2: string): boolean {
    // Check for exact match
    if (text1 === text2) return true;
    
    // Check for very short texts - skip if too short
    if (text1.length < 10 || text2.length < 10) {
      return text1 === text2;
    }
    
    // Check if one text is completely contained in the other
    if (text1.includes(text2) || text2.includes(text1)) {
      const shorter = text1.length < text2.length ? text1 : text2;
      const longer = text1.length < text2.length ? text2 : text1;
      
      // If the shorter text is more than 90% of the longer text
      if (shorter.length / longer.length > 0.9) {
        return true;
      }
    }
    
    // Use higher precision similarity check
    const similarity = this.calculateTextSimilarity(text1, text2);
    return similarity > 0.9; // 90% similarity threshold for advanced detection
  }

  private removeInternalPhraseRepetitions(text: string): string {
    // Step 1: Remove consecutive duplicate words
    let cleaned = this.removeConsecutiveDuplicateWords(text);
    
    // Step 2: Remove repeated phrases within sentences
    cleaned = this.removeRepeatedPhrases(cleaned);
    
    // Step 3: Remove duplicate sentences
    cleaned = this.removeDuplicateSentences(cleaned);
    
    return cleaned.trim();
  }
  
  private removeConsecutiveDuplicateWords(text: string): string {
    const words = text.split(/\s+/);
    const result: string[] = [];
    let lastWord = '';
    
    for (const word of words) {
      const normalized = this.normalizeText(word);
      if (normalized !== this.normalizeText(lastWord) || normalized.length < 3) {
        result.push(word);
        lastWord = word;
      }
    }
    
    return result.join(' ');
  }
  
  private removeRepeatedPhrases(text: string): string {
    // Apply multiple passes for different types of repetitions
    let result = text;
    
    // Pass 1: Remove exact phrase repetitions
    result = this.removeExactPhraseRepetitions(result);
    
    // Pass 2: Remove overlapping phrase repetitions
    result = this.removeOverlappingPhraseRepetitions(result);
    
    // Pass 3: Remove scattered repetitions
    result = this.removeScatteredRepetitions(result);
    
    return result;
  }
  
  private removeExactPhraseRepetitions(text: string): string {
    const words = text.split(/\s+/);
    const result: string[] = [];
    
    let i = 0;
    while (i < words.length) {
      let foundRepetition = false;
      
      // Check for exact phrase repetitions from longest to shortest
      for (let phraseLength = 10; phraseLength >= 3 && i + phraseLength * 2 <= words.length; phraseLength--) {
        const phrase1 = words.slice(i, i + phraseLength).join(' ');
        const phrase2 = words.slice(i + phraseLength, i + phraseLength * 2).join(' ');
        
        const norm1 = this.normalizeText(phrase1);
        const norm2 = this.normalizeText(phrase2);
        
        if (norm1 === norm2 && norm1.length > 15) {
          // Found exact repetition, add only the first occurrence
          result.push(...words.slice(i, i + phraseLength));
          i += phraseLength * 2;
          foundRepetition = true;
          break;
        }
      }
      
      if (!foundRepetition) {
        result.push(words[i]);
        i++;
      }
    }
    
    return result.join(' ');
  }
  
  private removeOverlappingPhraseRepetitions(text: string): string {
    const words = text.split(/\s+/);
    const result: string[] = [];
    
    let i = 0;
    while (i < words.length) {
      let foundRepetition = false;
      
      // Look for overlapping repetitions (e.g., "A B C A B C D")
      for (let phraseLength = 3; phraseLength <= 7 && i + phraseLength < words.length; phraseLength++) {
        const phrase1 = words.slice(i, i + phraseLength);
        
        // Look for this phrase appearing again within the next 15 words
        for (let j = i + phraseLength; j <= Math.min(i + phraseLength + 15, words.length - phraseLength); j++) {
          const phrase2 = words.slice(j, j + phraseLength);
          
          const norm1 = phrase1.map(w => this.normalizeText(w)).join(' ');
          const norm2 = phrase2.map(w => this.normalizeText(w)).join(' ');
          
          if (norm1 === norm2 && norm1.length > 15) {
            // Found overlapping repetition, add first occurrence and skip to after second
            result.push(...phrase1);
            i = j + phraseLength;
            foundRepetition = true;
            break;
          }
        }
        
        if (foundRepetition) break;
      }
      
      if (!foundRepetition) {
        result.push(words[i]);
        i++;
      }
    }
    
    return result.join(' ');
  }
  
  private removeScatteredRepetitions(text: string): string {
    const words = text.split(/\s+/);
    const phrases = new Map<string, number>();
    const result: string[] = [];
    
    // First pass: identify repeated phrases
    for (let i = 0; i < words.length; i++) {
      for (let phraseLength = 4; phraseLength <= 8 && i + phraseLength <= words.length; phraseLength++) {
        const phrase = words.slice(i, i + phraseLength).join(' ');
        const normalized = this.normalizeText(phrase);
        
        if (normalized.length > 20) {
          phrases.set(normalized, (phrases.get(normalized) || 0) + 1);
        }
      }
    }
    
    // Second pass: remove repeated phrases
    let i = 0;
    const seenPhrases = new Set<string>();
    
    while (i < words.length) {
      let foundKnownRepetition = false;
      
      // Check if current position starts a known repeated phrase
      for (let phraseLength = 8; phraseLength >= 4 && i + phraseLength <= words.length; phraseLength--) {
        const phrase = words.slice(i, i + phraseLength).join(' ');
        const normalized = this.normalizeText(phrase);
        
        if ((phrases.get(normalized) || 0) > 1) {
          if (seenPhrases.has(normalized)) {
            // Skip this repetition
            i += phraseLength;
            foundKnownRepetition = true;
            break;
          } else {
            // First occurrence, keep it
            seenPhrases.add(normalized);
            result.push(...words.slice(i, i + phraseLength));
            i += phraseLength;
            foundKnownRepetition = true;
            break;
          }
        }
      }
      
      if (!foundKnownRepetition) {
        result.push(words[i]);
        i++;
      }
    }
    
    return result.join(' ');
  }
  
  private removeDuplicateSentences(text: string): string {
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    const seenSentences = new Set<string>();
    const uniqueSentences: string[] = [];
    
    for (const sentence of sentences) {
      const normalized = this.normalizeText(sentence);
      if (!seenSentences.has(normalized) && normalized.length > 5) {
        uniqueSentences.push(sentence);
        seenSentences.add(normalized);
      }
    }
    
    return uniqueSentences.join('. ');
  }


  private calculateOptimalMaxLength(segmentCount: number, compressionLevel: 'full' | 'medium' | 'summary'): number {
    // Base calculation: estimate tokens and leave buffer for JSON structure
    const maxTokens = 20000; // Leave 5000 tokens buffer for JSON structure
    const tokensPerCharacter = 0.3; // More conservative: 3.3 chars per token
    const maxCharacters = Math.floor(maxTokens / tokensPerCharacter);
    
    // Adjust based on compression level
    switch (compressionLevel) {
      case 'full':
        return Math.min(maxCharacters, 50000); // Reduced from 80k
      case 'medium':
        return Math.min(maxCharacters, 25000); // Reduced from 40k
      case 'summary':
        return Math.min(maxCharacters, 12000); // Reduced from 20k
      default:
        return maxCharacters;
    }
  }
  
  private applyCompressionLevel(segments: Array<{text: string, startTime: number, endTime: number}>, compressionLevel: 'full' | 'medium' | 'summary'): Array<{text: string, startTime: number, endTime: number}> {
    if (compressionLevel === 'full') {
      return segments; // No compression
    }
    
    const totalDuration = segments.length > 0 ? segments[segments.length - 1].endTime : 0;
    
    switch (compressionLevel) {
      case 'medium':
        // Take every 2nd segment for medium compression
        return segments.filter((_, index) => index % 2 === 0);
        
      case 'summary':
        // Intelligent sampling for summary:
        // - Take first 10% of segments (introduction)
        // - Take samples from middle sections
        // - Take last 5% of segments (conclusion)
        const result: Array<{text: string, startTime: number, endTime: number}> = [];
        const segmentCount = segments.length;
        
        // First 10% (introduction)
        const introCount = Math.floor(segmentCount * 0.1);
        result.push(...segments.slice(0, introCount));
        
        // Middle sections - take every 5th segment
        const middleStart = introCount;
        const middleEnd = segmentCount - Math.floor(segmentCount * 0.05);
        for (let i = middleStart; i < middleEnd; i += 5) {
          if (i < segments.length) result.push(segments[i]);
        }
        
        // Last 5% (conclusion)
        const outroCount = Math.floor(segmentCount * 0.05);
        result.push(...segments.slice(-outroCount));
        
        return result;
        
      default:
        return segments;
    }
  }
  
  private applyIntelligentTruncation(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    
    // Try to truncate at sentence boundaries
    const sentences = text.split(/[.!?]+/);
    let truncated = '';
    
    for (const sentence of sentences) {
      const nextLength = truncated.length + sentence.length + 1;
      if (nextLength > maxLength * 0.95) { // Leave 5% buffer
        break;
      }
      truncated += (truncated ? '. ' : '') + sentence.trim();
    }
    
    if (truncated.length > 0) {
      return truncated + '... [Content truncated at sentence boundary]';
    }
    
    // Fallback to word boundaries
    const words = text.split(/\s+/);
    truncated = '';
    
    for (const word of words) {
      const nextLength = truncated.length + word.length + 1;
      if (nextLength > maxLength * 0.95) {
        break;
      }
      truncated += (truncated ? ' ' : '') + word;
    }
    
    return truncated + '... [Content truncated at word boundary]';
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    // Normalize texts for comparison
    const norm1 = this.normalizeText(text1);
    const norm2 = this.normalizeText(text2);
    
    // Use Jaccard similarity for better performance on longer texts
    const words1 = new Set(norm1.split(' ').filter(w => w.length > 2));
    const words2 = new Set(norm2.split(' ').filter(w => w.length > 2));
    
    if (words1.size === 0 && words2.size === 0) return 1.0;
    if (words1.size === 0 || words2.size === 0) return 0.0;
    
    // Calculate intersection and union
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }


  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.log('info', 'YouTube Subtitles MCP Server running on stdio');
  }
}

// Start the server
const server = new YouTubeSubtitlesMCPServer();
server.run().catch((error) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    service: 'youtube-subtitles-mcp',
    message: 'Failed to start server',
    error: error.message,
    stack: error.stack
  }));
  process.exit(1);
});