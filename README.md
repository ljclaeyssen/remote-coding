# Claude Discord Launcher

> Multi-session Claude Code from Discord — each session gets its own channel with a live terminal view.

---

## How it works

```
Bot 1 (Launcher)                      Bot 2 (Plugin MCP Discord)
  └─ Slash commands                     └─ Reads messages from channels
     /claude start → creates channel       configured in access.json
     /claude stop  → deletes channel     └─ Responds in the same channel
     /claude screen → captures tmux      └─ Routes via channel ID → session
     /claude input → sends to tmux
     /claude validate → menu navigation
     + auto watch (live terminal in channel)
```

1. **Two separate Discord bots**: the Launcher (this project) and the Claude Code Discord plugin
2. `/claude start` creates a dedicated Discord channel + tmux session + live watch
3. Claude Code runs with the Discord plugin — responds in the session channel
4. The watch auto-updates a single message with the current terminal state
5. Multiple sessions can run in parallel, each in its own channel

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

---

## Setup

### 1 — Create Bot 1 (Launcher)

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → name it (e.g. `claude-launcher`)
3. Sidebar → **Bot**:
   - **Reset Token** → copy it → this is your `LAUNCHER_BOT_TOKEN`
   - Copy the **Application ID** → this is your `LAUNCHER_CLIENT_ID`
   - Enable **Message Content Intent** under Privileged Gateway Intents
4. Sidebar → **OAuth2** → **URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: **Send Messages**, **Read Messages/View Channels**, **Manage Channels**, **Read Message History**
5. Open the generated URL → add the bot to your server

### 2 — Create Bot 2 (Discord Plugin)

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → name it (e.g. `claude-plugin`)
3. Sidebar → **Bot**:
   - **Reset Token** → copy it → this is your `PLUGIN_BOT_TOKEN`
   - Enable **Message Content Intent** under Privileged Gateway Intents
   - Enable **Server Members Intent** (recommended)
   - Enable **Presence Intent** (for online status)
4. Sidebar → **OAuth2** → **URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: **Send Messages**, **Read Messages/View Channels**, **Read Message History**
5. Open the generated URL → add the bot to your server

### 3 — Install the Claude Code Discord plugin

Run Claude Code once to install the plugin:

```bash
claude
```

Inside the Claude session:

```
/plugin install discord@claude-plugins-official
```

Exit Claude (`Ctrl+C`). The plugin token will be auto-synced from `.env` at bot startup.

### 4 — Get your IDs

| ID | How to get it |
|---|---|
| **Discord User ID** | Settings → Advanced → Developer Mode → right-click your name → Copy User ID |
| **Server (Guild) ID** | Right-click your server name → Copy Server ID |
| **Category ID** (optional) | Right-click a channel category → Copy Channel ID |

### 5 — Install and configure

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```env
# Bot 1 — Launcher (slash commands, channel management)
LAUNCHER_BOT_TOKEN=your_launcher_bot_token
LAUNCHER_CLIENT_ID=your_launcher_client_id

# Bot 2 — Claude Code Discord plugin (reads/responds in channels)
PLUGIN_BOT_TOKEN=your_plugin_bot_token

# Discord IDs
OWNER_DISCORD_ID=your_user_id
DISCORD_GUILD_ID=your_server_id
DISCORD_CATEGORY_ID=optional_category_id

# Limits
CLAUDE_MAX_MEMORY_MB=2048
SESSION_BASE_DIR=~/WebstormProjects
```

The bot auto-syncs `PLUGIN_BOT_TOKEN` to `~/.claude/channels/discord/.env` at startup.

### 6 — Register slash commands

```bash
npm run deploy-commands
```

### 7 — Start the bot

```bash
npm start
```

---

## Commands

All commands require your Discord User ID to match `OWNER_DISCORD_ID`.

### `/claude`

| Subcommand | Description |
|---|---|
| `/claude start [repo]` | Create a channel + start Claude + auto-watch |
| `/claude stop` | Stop session + delete the channel |
| `/claude screen` | One-shot terminal capture |
| `/claude input <text>` | Send text + Enter to the terminal |
| `/claude validate <option>` | Navigate menus: N times Down + Enter (0 = Enter only) |
| `/claude key <name>` | Send a special key (Enter, Escape, Tab, Up, Down, Ctrl+C, Ctrl+E) |
| `/claude status` | Show all active sessions (PID, memory, uptime, channel) |

### `/repos`

| Subcommand | Description |
|---|---|
| `/repos clone <url>` | Clone a repo (does not start a session) |
| `/repos list` | List repos with active/inactive indicators + "Open" buttons |
| `/repos open <name>` | Pull latest + create channel + start Claude (autocomplete) |

### Auto-watch

When a session starts, a **live terminal message** is automatically posted in the channel:

- Updates every 5 seconds (only when the screen changes)
- Edits a single message in place (no spam)
- When you send a message, the watch deletes itself and re-posts below your message (stays at the bottom like a terminal)
- Stops automatically when the session ends

---

## Startup cleanup

On boot, the bot automatically:

- Kills orphan tmux sessions (`claude-*`) from previous runs
- Deletes orphan Discord channels linked to dead sessions
- Clears stale entries from `access.json`

---

## Production (systemd)

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
│   ├── bot.js                    # Entry point, auth gate, event routing, startup cleanup
│   ├── state.js                  # Shared state (notifyOwner, sendToChannel)
│   ├── commands/
│   │   ├── claude.js             # /claude commands + auto-watch logic
│   │   └── repos.js              # /repos clone|list|open + buttons
│   ├── services/
│   │   ├── claude-process.js     # Multi-session tmux management + orphan cleanup
│   │   ├── channel-manager.js    # Create/delete Discord channels
│   │   ├── access-manager.js     # Manage ~/.claude/channels/discord/access.json
│   │   └── repo-manager.js       # Clone/list/pull repos
│   └── watchdog.js               # Memory polling per session (30s)
├── deploy-commands.js            # Slash command registration
├── claude-launcher.service       # systemd unit file
├── .env.example
└── package.json
```

---

## Memory watchdog

Polls every 30 seconds **per session**:

- **80%** → DM warning (cooldown, resets below 70%)
- **100%** → auto-restart + DM notification

Adjust `CLAUDE_MAX_MEMORY_MB` in `.env`.

---

## Security

- **Owner-only** — all interactions gated by `OWNER_DISCORD_ID`
- **Two-bot architecture** — launcher and plugin tokens are separate
- **Tokens** — centralized in `.env`, never committed (`.gitignore`)
- **Channel isolation** — each session has its own Discord channel
- **Auto-cleanup** — orphan sessions and channels are cleaned on restart

---

## Troubleshooting

**Slash commands don't appear**
→ Run `npm run deploy-commands`. Global commands can take up to 1 hour to propagate.

**Bot says "Not authorized"**
→ Check `OWNER_DISCORD_ID` in `.env`.

**Channel creation fails**
→ Ensure Bot 1 has **Manage Channels** permission and `DISCORD_GUILD_ID` is set.

**Bot 2 (plugin) stays offline**
→ Check that all 3 Privileged Gateway Intents are enabled in the Discord developer portal for Bot 2.

**Claude starts but doesn't respond in the channel**
→ Verify the plugin is installed (`/plugin install discord@claude-plugins-official`) and `PLUGIN_BOT_TOKEN` is set in `.env`.

---

## License

MIT
