import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { setNotifyOwner } from './state.js';
import { ensureBaseDir } from './services/repo-manager.js';
import { isRunning, getMemoryUsage, stopSession, getSession, startSession } from './services/claude-process.js';
import { startWatchdog, stopWatchdog } from './watchdog.js';
import { notifyOwner } from './state.js';

// Import commands
import * as claudeCmd from './commands/claude.js';
import * as reposCmd from './commands/repos.js';

const { DISCORD_BOT_TOKEN, OWNER_DISCORD_ID, CLAUDE_MAX_MEMORY_MB = '2048' } = process.env;

if (!DISCORD_BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKEN is required');
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

  // Start watchdog
  const maxMb = parseInt(CLAUDE_MAX_MEMORY_MB, 10);
  startWatchdog({
    getMemoryUsage,
    isRunning,
    maxMb,
    notifyFn: (msg) => notifyOwner(msg),
    restartFn: async () => {
      const session = getSession();
      const cwd = session?.cwd;
      await stopSession();
      if (cwd) {
        try {
          startSession(cwd, (code, signal) => {
            notifyOwner(`Claude exited after watchdog restart (code=${code}, signal=${signal}).`);
          });
          await notifyOwner('Claude restarted by watchdog.');
        } catch (err) {
          await notifyOwner(`Watchdog restart failed: ${err.message}`);
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

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  stopWatchdog();
  if (isRunning()) {
    await stopSession();
  }
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  stopWatchdog();
  if (isRunning()) {
    await stopSession();
  }
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_BOT_TOKEN);
