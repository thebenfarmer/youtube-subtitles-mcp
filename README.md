# YouTube Subtitles MCP Server

MCP server that gives Claude Code the full transcript of a YouTube video, read from its subtitles.

## What it does

- **`get_youtube_subtitles`** fetches the subtitles and returns the spoken text in full. Nothing is summarized, thinned out, or dropped on the guess that it is a "duplicate".
- **`get_youtube_info`** returns title, description, duration, channel and statistics of a video.

### Which subtitles it picks

A single `yt-dlp` run per video requests the desired language and the automatic captions in the video's original language (`<language>-orig`). The choice is made in this order:

1. manually created subtitles in the desired language
2. automatic captions in the desired language
3. automatic captions in the video's original language

The response names the language and the kind ("manual subtitles" or "automatic captions").

YouTube's automatic captions repeat the previous line in every segment. The server therefore keeps only the words that YouTube marks as new with their own timestamp. Manually created subtitles are kept line by line, repetitions included.

### Long videos and cache

- Every transcript is saved as a text file at `~/.cache/youtube-subtitles-mcp/<video-id>.<language>.txt` (use `YOUTUBE_MCP_CACHE_DIR` for another location). Lines are at most 100 characters long so that tools reading line by line do not cut anything off.
- The response contains the text up to `maxLength` characters (default 40,000) and always the path of the file. If the text is longer, the response ends with `[TRUNCATED: showing X of Y characters. Read the rest from <path>]`.
- A second request for the same video in the same language reads from the file and does not ask YouTube again.
- Files that have been neither written nor read for 90 days are deleted by the server on the next request. The folder can be emptied by hand at any time.

### When YouTube refuses

- **HTTP 429 (Too Many Requests):** The server stops after the first failure; `yt-dlp` runs with `--retries 0`. Every further attempt can extend the block. 429 can be a block of the connection or mean that YouTube requires a PO token for this video. You can tell the two apart by requesting a different, older video.
- **"Sign in to confirm you're not a bot":** YouTube considers the connection automated, typical for servers in data centers. Only `yt-dlp` with browser cookies helps there.
- `yt-dlp` has a timeout of 120 seconds.
- **Outdated `yt-dlp`:** If `yt-dlp` reports that it is older than 90 days, the server appends a `[NOTICE: ...]` with the update command to its response, on success as well as on errors. Requests served from the cache do not start `yt-dlp` and therefore report nothing.

### Security

Only URLs from `youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtube-nocookie.com` and `youtu.be` with a valid video ID are accepted. The URL is placed after `--` so that `yt-dlp` never reads it as an option. Language codes are validated before they go into the call.

## Requirements

- Node.js 18 or newer
- `yt-dlp` in the `PATH`, **kept up to date**. YouTube changes its interfaces often, and a `yt-dlp` older than a few months then fails. `yt-dlp` itself warns from an age of 90 days.
  ```bash
  brew install yt-dlp     # set up
  brew upgrade yt-dlp     # update
  ```

## Installation

```bash
npm install
npm run build
```

Entry in the `.mcp.json` of the project that uses the server:

```json
{
  "mcpServers": {
    "youtube-subtitles": {
      "command": "node",
      "args": ["/path/to/youtube-mcp/dist/index.js"]
    }
  }
}
```

After a change to the server, Claude Code needs a new session to reload it.

## Parameters

`get_youtube_subtitles`

| Parameter | Required | Default | Meaning |
|-----------|----------|---------|---------|
| `url` | yes | | YouTube URL |
| `language` | no | `en` | desired language, e.g. `de`, `en-US` |
| `maxLength` | no | `40000` | maximum number of characters in the response; the file always holds everything |

`get_youtube_info`: `url` only.

## Tests

```bash
npm test
```

Builds the server and tests it without network. The server tests replace `yt-dlp` with a script that logs every call. This proves that exactly one call runs per video, that no second one follows after a 429, that a cache hit triggers none at all, and that a URL like `--exec=...` never even reaches `yt-dlp`.

## License

MIT
