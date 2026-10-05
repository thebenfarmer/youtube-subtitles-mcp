# YouTube Subtitles MCP Server

Ein Model Context Protocol (MCP) Server für die Integration von YouTube-Untertiteln in Claude Code.

## Features

- **YouTube Subtitle Download**: Lädt Untertitel von YouTube-Videos in verschiedenen Sprachen herunter
- **Video Information**: Extrahiert grundlegende Informationen über YouTube-Videos  
- **VTT Parser**: Konvertiert VTT-Untertitel in lesbaren Text
- **MCP Integration**: Vollständige Integration in Claude Code

## Voraussetzungen

- Node.js (v18 oder höher)
- yt-dlp installiert und im PATH verfügbar
- Claude Desktop App
- ffmpeg (optional, aber empfohlen für bessere Kompatibilität)

## Installation

1. **yt-dlp installieren** (falls noch nicht vorhanden):
   ```bash
   brew install yt-dlp
   # oder
   pip install yt-dlp
   ```

2. **Projekt installieren**:
   ```bash
   cd youtube-mcp
   npm install
   npm run build
   ```

3. **ffmpeg installieren** (optional, aber empfohlen):
   ```bash
   # Option 1: System-ffmpeg installieren
   brew install ffmpeg  # macOS
   sudo apt install ffmpeg  # Ubuntu/Debian
   
   # Option 2: ffmpeg-static verwenden (automatisch gebundelt)
   npm install ffmpeg-static
   ```

4. **Claude Desktop konfigurieren**:
   Die Konfigurationsdatei `~/.config/claude-desktop/claude_desktop_config.json` wurde automatisch erstellt.

## Verwendung

### Verfügbare Tools

#### `get_youtube_subtitles`
Lädt Untertitel von einem YouTube-Video herunter.

**Parameter:**
- `url` (string, erforderlich): YouTube-Video URL
- `language` (string, optional): Sprachcode (z.B. "en", "de", "fr"). Standard: "en"

**Beispiel:**
```
Lade die deutschen Untertitel von diesem Video herunter: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

#### `get_youtube_info`
Extrahiert Informationen über ein YouTube-Video.

**Parameter:**
- `url` (string, erforderlich): YouTube-Video URL

**Beispiel:**
```
Zeige mir die Informationen zu diesem Video: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

### Nutzung mit Claude Code

Nach der Installation können Sie direkt in Claude Code Befehle wie folgt verwenden:

```
Kannst du die Untertitel dieses YouTube-Videos analysieren: https://www.youtube.com/watch?v=7ITff1fIbSc
```

```
Erstelle eine Zusammenfassung dieses Videos: https://www.youtube.com/watch?v=7ITff1fIbSc
```

## Entwicklung

### Lokale Entwicklung
```bash
npm run dev  # TypeScript im Watch-Modus
```

### Testen
```bash
npm run build
node dist/index.js
```

## Fehlerbehebung

### Häufige Probleme

1. **"yt-dlp not found"**
   - Stellen Sie sicher, dass yt-dlp installiert und im PATH verfügbar ist
   - Testen Sie mit: `yt-dlp --version`

2. **"No subtitles found"**
   - Nicht alle Videos haben Untertitel
   - Versuchen Sie eine andere Sprache oder prüfen Sie, ob automatische Untertitel verfügbar sind

3. **"ERROR: Did not get any data blocks"**
   - Dieser Fehler tritt oft auf, wenn ffmpeg nicht installiert ist
   - Installieren Sie ffmpeg oder verwenden Sie `npm install ffmpeg-static`
   - Der Server hat automatische Fallback-Strategien implementiert

4. **MCP Server startet nicht**
   - Überprüfen Sie die Konfiguration in `claude_desktop_config.json`
   - Stellen Sie sicher, dass der Pfad zur `index.js` korrekt ist

### Erweiterte Fehlerbehandlung

Der MCP Server verfügt über robuste Fehlerbehandlung:
- **Automatische Fallback-Strategien**: Versucht verschiedene Parameter, falls ein Ansatz fehlschlägt
- **ffmpeg-static Integration**: Verwendet automatisch gebundelte ffmpeg-Binaries, falls verfügbar
- **Detaillierte Fehlermeldungen**: Gibt spezifische Hinweise zur Fehlerbehebung
- **Cleanup**: Automatisches Aufräumen von temporären Dateien bei Fehlern

## Lizenz

MIT License