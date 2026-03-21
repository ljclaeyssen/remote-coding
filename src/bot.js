import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { setNotifyOwner, setSendToChannel } from './state.js';
import { ensureBaseDir } from './services/repo-manager.js';
import {
  isRunning, getMemoryUsage, stopSession, getSession,
  startSession, setChannelId, getAllSessions,
} from './services/claude-process.js';
import { removeChannelGroup } from './services/access-manager.js';
import { startWatchdog, stopWatchdog } from './watchdog.js';
import { notifyOwner } from './state.js';

// Import commands
import * as claudeCmd from './commands/claude.js';
import * as reposCmd from './commands/repos.js';

const { LAUNCHER_BOT_TOKEN, PLUGIN_BOT_TOKEN, OWNER_DISCORD_ID, CLAUDE_MAX_MEMORY_MB = '2048' } = process.env;

// Sync plugin bot token to ~/.claude/channels/discord/.env
if (PLUGIN_BOT_TOKEN) {
  const pluginDir = join(process.env.HOME, '.claude', 'channels', 'discord');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, '.env'), `DISCORD_BOT_TOKEN=${PLUGIN_BOT_TOKEN}\n`);
}

if (!LAUNCHER_BOT_TOKEN) {
  console.error('LAUNCHER_BOT_TOKEN is required');
  process.exit(1);
}

if (!OWNER_DISCORD_ID) {
  console.error('OWNER_DISCORD_ID is required');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Register commands
const commands = new Collection();
commands.set(claudeCmd.data.name, claudeCmd);
commands.set(reposCmd.data.name, reposCmd);

client.once('ready', () => {
  console.log(`Bot online as ${client.user.tag}`);

  ensureBaseDir();

  // Set up owner notification via DM
  setNotifyOwner(async (msg) => {
    try {
      const owner = await client.users.fetch(OWNER_DISCORD_ID);
      await owner.send(msg);
    } catch (err) {
      console.error('Failed to DM owner:', err.message);
    }
  });

  // Set up channel messaging
  setSendToChannel(async (channelId, msg) => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel) await channel.send(msg);
    } catch (err) {
      console.error(`Failed to send to channel ${channelId}:`, err.message);
    }
  });

  // Start watchdog
  const maxMb = parseInt(CLAUDE_MAX_MEMORY_MB, 10);
  startWatchdog({
    getAllSessions,
    getMemoryUsage,
    isRunning,
    maxMb,
    notifyFn: (msg) => notifyOwner(msg),
    restartFn: async (name) => {
      const session = getSession(name);
      const cwd = session?.cwd;
      const channelId = session?.channelId;
      await stopSession(name);
      if (cwd) {
        try {
          startSession(name, cwd, (code, signal) => {
            notifyOwner(`Claude **${name}** exited after watchdog restart (code=${code}, signal=${signal}).`);
          });
          if (channelId) setChannelId(name, channelId);
          await notifyOwner(`Claude **${name}** restarted by watchdog.`);
        } catch (err) {
          await notifyOwner(`Watchdog restart of **${name}** failed: ${err.message}`);
        }
      }
    },
  });
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Auth gate
    if (interaction.user.id !== OWNER_DISCORD_ID) {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'Not authorized.', ephemeral: true });
      }
      return;
    }

    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    // Autocomplete
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction);
      }
      return;
    }

    // Button interactions
    if (interaction.isButton()) {
      await reposCmd.handleButton(interaction);
      return;
    }
  } catch (err) {
    console.error('Interaction error:', err);
    try {
      const content = { content: `Error: ${err.message}`, ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(content);
      } else if (interaction.isRepliable()) {
        await interaction.reply(content);
      }
    } catch {
      // Can't respond, swallow
    }
  }
});

// Global error handlers
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Graceful shutdown — stop all sessions
async function shutdown() {
  console.log('Shutting down...');
  stopWatchdog();

  const sessions = getAllSessions();
  for (const session of sessions) {
    try {
      await stopSession(session.name);
      if (session.channelId) {
        removeChannelGroup(session.channelId);
      }
    } catch {
      // Best effort
    }
  }

  client.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(LAUNCHER_BOT_TOKEN);
