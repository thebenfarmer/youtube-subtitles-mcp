# YouTube Subtitles MCP Server

MCP-Server, der Claude Code das vollständige Transkript eines YouTube-Videos liefert, gelesen aus dessen Untertiteln.

## Was er tut

- **`get_youtube_subtitles`** holt die Untertitel und gibt den gesprochenen Text vollständig zurück. Nichts wird zusammengefasst, ausgedünnt oder als „doppelt" geraten weggelassen.
- **`get_youtube_info`** liefert Titel, Beschreibung, Dauer, Kanal und Zahlen eines Videos.

### Welche Untertitel er nimmt

Ein einziger `yt-dlp`-Lauf je Video fragt die gewünschte Sprache und die automatischen Untertitel in der Originalsprache des Videos (`<sprache>-orig`) an. Ausgewählt wird in dieser Reihenfolge:

1. von Hand erstellte Untertitel in der gewünschten Sprache
2. automatische Untertitel in der gewünschten Sprache
3. automatische Untertitel in der Originalsprache des Videos

Die Antwort nennt Sprache und Art („manual subtitles" oder „automatic captions").

Automatische Untertitel von YouTube wiederholen in jedem Abschnitt die vorige Zeile. Der Server übernimmt deshalb nur die Wörter, die YouTube mit eigenem Zeitstempel als neu markiert. Von Hand erstellte Untertitel bleiben Zeile für Zeile erhalten, auch Wiederholungen.

### Lange Videos und Zwischenspeicher

- Jedes Transkript landet als Textdatei in `~/.cache/youtube-subtitles-mcp/<video-id>.<sprache>.txt` (anderer Ort über `YOUTUBE_MCP_CACHE_DIR`). Die Zeilen sind höchstens 100 Zeichen lang, damit zeilenweise lesende Werkzeuge nichts abschneiden.
- Die Antwort enthält den Text bis `maxLength` Zeichen (Standard 40.000) und immer den Pfad der Datei. Ist der Text länger, endet die Antwort mit `[TRUNCATED: showing X of Y characters. Read the rest from <pfad>]`.
- Ein zweiter Abruf desselben Videos in derselben Sprache liest aus der Datei und fragt YouTube nicht erneut.
- Dateien, die 90 Tage weder geschrieben noch gelesen wurden, löscht der Server beim nächsten Abruf. Der Ordner lässt sich jederzeit von Hand leeren.

### Wenn YouTube ablehnt

- **HTTP 429 (Too Many Requests):** Der Server hört nach dem ersten Fehlschlag auf, `yt-dlp` läuft mit `--retries 0`. Jeder weitere Versuch kann die Sperre verlängern. 429 kann eine Sperre des Anschlusses sein oder bedeuten, dass YouTube für dieses Video einen PO-Token verlangt. Unterscheiden lässt sich das, indem man ein anderes, älteres Video abruft.
- **„Sign in to confirm you're not a bot":** YouTube hält den Anschluss für automatisiert, typisch für Server in Rechenzentren. Dort hilft nur `yt-dlp` mit Browser-Cookies.
- `yt-dlp` hat ein Zeitlimit von 120 Sekunden.

### Sicherheit

Nur Adressen von `youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtube-nocookie.com` und `youtu.be` mit gültiger Video-ID werden angenommen. Die Adresse steht hinter `--`, damit `yt-dlp` sie nie als Option liest. Sprachcodes werden geprüft, bevor sie in den Aufruf gehen.

## Voraussetzungen

- Node.js 18 oder neuer
- `yt-dlp` im `PATH`, **aktuell gehalten**. YouTube ändert seine Schnittstellen oft, ein `yt-dlp`, das älter als ein paar Monate ist, scheitert dann. `yt-dlp` warnt selbst ab 90 Tagen Alter.
  ```bash
  brew install yt-dlp     # einrichten
  brew upgrade yt-dlp     # aktualisieren
  ```

## Installation

```bash
npm install
npm run build
```

Eintrag in der `.mcp.json` des Projekts, das den Server nutzt:

```json
{
  "mcpServers": {
    "youtube-subtitles": {
      "command": "node",
      "args": ["/pfad/zu/youtube-mcp/dist/index.js"]
    }
  }
}
```

Nach einer Änderung am Server braucht Claude Code eine neue Session, um ihn neu zu laden.

## Parameter

`get_youtube_subtitles`

| Parameter | Pflicht | Standard | Bedeutung |
|-----------|---------|----------|-----------|
| `url` | ja | | YouTube-Adresse |
| `language` | nein | `en` | gewünschte Sprache, z. B. `de`, `en-US` |
| `maxLength` | nein | `40000` | höchstens so viele Zeichen in der Antwort, die Datei hält immer alles |

`get_youtube_info`: nur `url`.

## Tests

```bash
npm test
```

Baut den Server und prüft ihn ohne Netz. Die Server-Tests ersetzen `yt-dlp` durch ein Skript, das jeden Aufruf mitschreibt. So ist belegt, dass je Video genau ein Aufruf läuft, bei 429 kein zweiter folgt, ein Treffer im Zwischenspeicher gar keinen auslöst und eine Adresse wie `--exec=...` gar nicht erst bei `yt-dlp` ankommt.

## Lizenz

MIT
