# Claude Discord Launcher

> Control Claude Code remotely from Discord — no terminal, no SSH, just slash commands.

---

## How it works

```
You (Discord)  ──▶  Discord Bot (always running)
                          │
                          ├──▶  Spawns Claude Code with Discord plugin
                          │           │
                          │           └──▶  Claude Code ◀──▶ You (via Discord plugin)
                          │
                          └──▶  Manages repos, memory watchdog, auto-restart
```

1. A Discord bot runs permanently on your server (or local machine)
2. You run `/claude start` from Discord
3. The bot spawns Claude Code with the official Discord plugin
4. Claude Code connects back to Discord — you can now code remotely
5. `/repos` commands let you clone, list, and switch between projects

Only **you** can trigger commands (protected by `OWNER_DISCORD_ID`).

---

## Prerequisites

| Tool | Check | Install |
|---|---|---|
| Node.js 20+ | `node --version` | [nodejs.org](https://nodejs.org) |
| npm | `npm --version` | comes with Node.js |
| Claude Code | `claude --version` | `npm install -g @anthropic-ai/claude-code` |
| git | `git --version` | `sudo apt install git` |

> VPS users — designed for small VPS (4 GB RAM). The built-in watchdog monitors memory and auto-restarts Claude Code.

---

## Setup

### 1 — Create your Discord bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → name it (e.g. `claude-launcher`)
3. Sidebar → **Bot** → **Reset Token** → copy it (you only see it once)
4. Sidebar → **OAuth2** → **URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: Send Messages, Use Slash Commands
5. Open the generated URL → add the bot to your server

### 2 — Get your Discord User ID

1. Discord **Settings** → **Advanced** → enable **Developer Mode**
2. Right-click your username → **Copy User ID**

### 3 — Install and configure

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_BOT_TOKEN=your_token_here
DISCORD_CLIENT_ID=your_client_id_here
OWNER_DISCORD_ID=123456789012345678
CLAUDE_MAX_MEMORY_MB=2048
SESSION_BASE_DIR=~/remote-coding/session
```

`SESSION_BASE_DIR` controls where repos are cloned/scanned:
- **VPS**: `~/remote-coding/session` (default)
- **Local**: `/home/youruser/Projects` (use your existing projects folder)

### 4 — Install the Claude Code Discord plugin

Run `claude` once, then inside the session:

```
/plugin install discord@claude-plugins-official
/discord:configure YOUR_BOT_TOKEN
```

Exit Claude Code (`Ctrl+C`). The plugin is now configured.

### 5 — Register slash commands

```bash
npm run deploy-commands
```

Commands appear globally in Discord (works in servers and DMs).

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
| `/claude start` | Start a Claude session in `SESSION_BASE_DIR` |
| `/claude stop` | Stop the running session |
| `/claude restart` | Stop + start (keeps same working directory) |
| `/claude status` | Show PID, memory usage (progress bar), repo, uptime |
| `/claude lock` | Switch Claude to allowlist-only access |

### `/repos`

| Subcommand | Description |
|---|---|
| `/repos clone <url>` | Clone a repo, npm install if needed, start Claude in it |
| `/repos list` | List repos in `SESSION_BASE_DIR` with "Open" buttons |
| `/repos open <name>` | Pull + start Claude in a repo (autocomplete enabled) |

When a session is already running, `/repos clone` and `/repos open` show confirmation buttons before switching.

---

## Production (systemd)

Copy and adapt the included unit file:

```bash
sudo cp claude-launcher.service /etc/systemd/system/
sudo nano /etc/systemd/system/claude-launcher.service  # adjust User, WorkingDirectory, EnvironmentFile
sudo systemctl enable claude-launcher
sudo systemctl start claude-launcher
```

### Auto-deploy (GitHub Actions)

The workflow at `.github/workflows/deploy.yml` deploys on push to `main` (path-filtered to `src/**` and `package.json`).

Required GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.

---

## Project structure

```
remote-coding/
├── src/
│   ├── bot.js                    # Entry point, auth gate, event routing
│   ├── state.js                  # Shared state (notifyOwner, onClaudeExit)
│   ├── commands/
│   │   ├── claude.js             # /claude start|stop|restart|status|lock
│   │   └── repos.js              # /repos clone|list|open + autocomplete + buttons
│   ├── services/
│   │   ├── claude-process.js     # Singleton Claude session management
│   │   └── repo-manager.js       # Clone/list/pull repos
│   └── watchdog.js               # Memory polling (30s), warning 80%, restart 100%
├── deploy-commands.js            # One-shot slash command registration
├── claude-launcher.service       # systemd unit file
├── .env.example
└── package.json
```

---

## Memory watchdog

Claude Code can leak memory on long sessions. The watchdog polls every 30 seconds:

- **80% of limit** → DM warning (with cooldown, resets when it drops below 70%)
- **100% of limit** → auto-restart + DM notification

Adjust `CLAUDE_MAX_MEMORY_MB` in `.env`. Manual restart anytime with `/claude restart`.

---

## Security

- **Owner-only** — all interactions are gated by `OWNER_DISCORD_ID`
- **Bot token** — in `.env`, never committed (`.gitignore`)
- **No shell injection** — all subprocess calls use `execFileSync`/`spawn` (no `shell: true`)
- **Lock command** — `/claude lock` restricts Discord plugin access to allowlist

---

## Troubleshooting

**Slash commands don't appear**
→ Run `npm run deploy-commands`. Global commands can take up to 1 hour to propagate.

**Bot is online but commands say "Not authorized"**
→ Check `OWNER_DISCORD_ID` in `.env` matches your Discord user ID exactly.

**Claude starts but doesn't respond in Discord**
→ Make sure the Discord plugin is installed and configured (Step 4).

**OOM / server freezes**
→ Lower `CLAUDE_MAX_MEMORY_MB` and restart. The watchdog will kick in sooner.

---

## License

MIT
