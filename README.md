# Teamkill Discord Bot

Discord-Bot fuer `teamkill.club`, der eine Teamkill-Liste in einem Channel anzeigt und live aktualisiert.

## Features

- Slash-Commands fuer Erstellen/Verknuepfen/Trennen
- Live-Leaderboard im Discord-Channel
- Optionales Zaehlen per Buttons (`+1` / `-1`) mit `count_token`

## Voraussetzungen

- Node.js 18+
- Discord Bot Application mit aktivierten Slash Commands

## Installation

```bash
npm install
```

## Konfiguration

`.env.example` nach `.env` kopieren und Werte setzen:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
GUILD_ID=your_discord_guild_id
API_BASE=https://teamkill.club
```

## Commands

- `/teamkill create` - erstellt eine neue Liste
- `/teamkill link` - verknuepft bestehende Liste mit einem Channel
- `/teamkill unlink` - loest die Verknuepfung

## Start

```bash
npm start
```

Slash-Commands neu registrieren:

```bash
npm run register
```

## Sicherheit

- Niemals `.env` committen
- `count_token` und `owner`-Links vertraulich behandeln
