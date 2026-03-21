# Claude Discord Launcher

> Multi-session Claude Code from Discord — each session gets its own channel.

---

## How it works

```
Bot 1 (Launcher)                      Bot 2 (Plugin MCP Discord)
  └─ Slash commands                     └─ Reads messages from channels
     /claude start → creates channel       configured in access.json
     /claude stop  → archives channel    └─ Responds in the same channel
     /claude screen → captures tmux      └─ Routes via channel ID → session
     /claude input → sends to tmux
```

1. **Two separate Discord bots**: the Launcher (this project) and the Claude Code Discord plugin
2. `/claude start` creates a dedicated Discord channel + tmux session
3. Claude Code runs with the Discord plugin — responds in the session channel
4. Multiple sessions can run in parallel, each in its own channel
5. `/claude screen` and `/claude input` let you interact with the terminal from Discord

Only **you** can trigger commands (protected by `OWNER_DISCORD_ID`).

---

## Prerequisites

| Tool | Check | Install |
|---|---|---|
| Node.js 20+ | `node --version` | [nodejs.org](https://nodejs.org) |
| npm | `npm --version` | comes with Node.js |
| Claude Code | `claude --version` | `npm install -g @anthropic-ai/claude-code` |
| git | `git --version` | `sudo apt install git` |
| tmux | `tmux -V` | `sudo apt install tmux` |

> VPS users — designed for small VPS (4 GB RAM). The built-in watchdog monitors memory and auto-restarts Claude Code.

---

## Setup

### 1 — Create the Launcher bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → name it (e.g. `claude-launcher`)
3. Sidebar → **Bot** → **Reset Token** → copy it
4. Sidebar → **OAuth2** → **URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: **Send Messages**, **Use Slash Commands**, **Manage Channels**
5. Open the generated URL → add the bot to your server

### 2 — Set up the Claude Code Discord plugin (Bot 2)

This is a separate bot. Follow the official Claude Code Discord plugin setup:

```
claude
/plugin install discord@claude-plugins-official
/discord:configure YOUR_PLUGIN_BOT_TOKEN
```

The plugin stores its token in `~/.claude/channels/discord/.env`.

### 3 — Get your IDs

- **Discord User ID**: Settings → Advanced → Developer Mode → right-click your name → Copy User ID
- **Server (Guild) ID**: right-click your server name → Copy Server ID
- **Category ID** (optional): right-click a category → Copy Channel ID

### 4 — Install and configure

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```env
LAUNCHER_BOT_TOKEN=your_launcher_bot_token
LAUNCHER_CLIENT_ID=your_launcher_client_id
OWNER_DISCORD_ID=123456789012345678
DISCORD_GUILD_ID=your_server_id
DISCORD_CATEGORY_ID=optional_category_id
CLAUDE_MAX_MEMORY_MB=2048
SESSION_BASE_DIR=~/WebstormProjects
```

### 5 — Register slash commands

```bash
npm run deploy-commands
```

### 6 — Start the bot

```bash
npm start
```

---

## Commands

All commands require your Discord User ID to match `OWNER_DISCORD_ID`.

### `/claude`

| Subcommand | Description |
|---|---|
| `/claude start [repo]` | Create a channel + start Claude in the repo (or base dir) |
| `/claude stop` | Stop the session linked to the current channel (deletes it) |
| `/claude screen` | Capture the tmux screen of the current session |
| `/claude input <text>` | Send text input to the tmux session |
| `/claude status` | Show all active sessions with PID, memory, uptime |

### `/repos`

| Subcommand | Description |
|---|---|
| `/repos clone <url>` | Clone a repo (does not start a session) |
| `/repos list` | List repos with status indicators and "Open" buttons |
| `/repos open <name>` | Pull latest + create channel + start Claude session |

---

## Production (systemd)

Copy and adapt the included unit file:

```bash
sudo cp claude-launcher.service /etc/systemd/system/
sudo nano /etc/systemd/system/claude-launcher.service  # adjust User, WorkingDirectory, EnvironmentFile
sudo systemctl enable claude-launcher
sudo systemctl start claude-launcher
```

---

## Project structure

```
remote-coding/
├── src/
│   ├── bot.js                    # Entry point, auth gate, event routing
│   ├── state.js                  # Shared state (notifyOwner, sendToChannel)
│   ├── commands/
│   │   ├── claude.js             # /claude start|stop|screen|input|status
│   │   └── repos.js              # /repos clone|list|open + autocomplete + buttons
│   ├── services/
│   │   ├── claude-process.js     # Multi-session management via tmux (Map<name, session>)
│   │   ├── channel-manager.js    # Create/delete Discord channels
│   │   ├── access-manager.js     # Manage ~/.claude/channels/discord/access.json
│   │   └── repo-manager.js       # Clone/list/pull repos
│   └── watchdog.js               # Memory polling per session (30s)
├── deploy-commands.js            # One-shot slash command registration
├── claude-launcher.service       # systemd unit file
├── .env.example
└── package.json
```

---

## Memory watchdog

Claude Code can leak memory on long sessions. The watchdog polls every 30 seconds **per session**:

- **80% of limit** → DM warning (with cooldown, resets below 70%)
- **100% of limit** → auto-restart + DM notification

Adjust `CLAUDE_MAX_MEMORY_MB` in `.env`.

---

## Security

- **Owner-only** — all interactions gated by `OWNER_DISCORD_ID`
- **Two-bot architecture** — launcher token and plugin token are separate
- **Bot tokens** — in `.env`, never committed (`.gitignore`)
- **No shell injection** — subprocess calls use `execFileSync` (no `shell: true`)
- **Channel isolation** — each session has its own Discord channel

---

## Troubleshooting

**Slash commands don't appear**
→ Run `npm run deploy-commands`. Global commands can take up to 1 hour to propagate.

**Bot is online but commands say "Not authorized"**
→ Check `OWNER_DISCORD_ID` in `.env` matches your Discord user ID.

**Channel creation fails**
→ Ensure the Launcher bot has **Manage Channels** permission and `DISCORD_GUILD_ID` is set.

**Claude starts but doesn't respond in the channel**
→ Make sure the Discord plugin is installed, configured, and its bot is online (Bot 2).

**OOM / server freezes**
→ Lower `CLAUDE_MAX_MEMORY_MB`. The watchdog will kick in sooner.

---

## License

MIT
