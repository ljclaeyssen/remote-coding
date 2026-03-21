import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  startSession, stopSession, getSession, isRunning,
  getMemoryUsage, sendInput, sendKeys, captureScreen,
  setChannelId, getSessionByChannelId, getAllSessions,
} from '../services/claude-process.js';
import { createSessionChannel, deleteSessionChannel } from '../services/channel-manager.js';
import { addChannelGroup, removeChannelGroup } from '../services/access-manager.js';
import { getBaseDir, getRepoPath } from '../services/repo-manager.js';
import { notifyOwner } from '../state.js';

const WATCH_INTERVAL_SEC = 5;

// Watch state per channel: { intervalId, msg, sessionName, lastScreen }
const watchers = new Map();

function startWatch(channelId, sessionName, client) {
  if (watchers.has(channelId)) return;

  const watcher = { intervalId: null, msg: null, sessionName, lastScreen: '' };

  watcher.intervalId = setInterval(async () => {
    if (!isRunning(sessionName)) {
      clearInterval(watcher.intervalId);
      watchers.delete(channelId);
      if (watcher.msg) {
        await watcher.msg.edit('```\n(session ended)\n```').catch(() => {});
      }
      return;
    }

    try {
      const screen = captureScreen(sessionName).trimEnd();
      if (screen && screen !== watcher.lastScreen) {
        watcher.lastScreen = screen;
        const maxLen = 1980;
        const content = screen.length > maxLen ? '...' + screen.slice(-maxLen) : screen;
        const text = `\`\`\`\n${content}\n\`\`\``;

        if (watcher.msg) {
          await watcher.msg.edit(text).catch(() => {});
        } else {
          const channel = await client.channels.fetch(channelId);
          watcher.msg = await channel.send(text);
        }
      }
    } catch {
      // Non-fatal, retry next tick
    }
  }, WATCH_INTERVAL_SEC * 1000);

  watchers.set(channelId, watcher);
}

function stopWatch(channelId) {
  const watcher = watchers.get(channelId);
  if (!watcher) return;
  clearInterval(watcher.intervalId);
  if (watcher.msg) {
    watcher.msg.delete().catch(() => {});
  }
  watchers.delete(channelId);
}

export async function reanchorWatch(channelId, client) {
  const watcher = watchers.get(channelId);
  if (!watcher) return;

  // Delete old watch message
  if (watcher.msg) {
    await watcher.msg.delete().catch(() => {});
    watcher.msg = null;
  }

  // Immediately post a fresh screen
  try {
    const screen = captureScreen(watcher.sessionName).trimEnd();
    if (screen) {
      const maxLen = 1980;
      const content = screen.length > maxLen ? '...' + screen.slice(-maxLen) : screen;
      const channel = await client.channels.fetch(channelId);
      watcher.msg = await channel.send(`\`\`\`\n${content}\n\`\`\``);
      watcher.lastScreen = screen;
    }
  } catch {
    // Next interval will retry
  }
}

export const data = new SlashCommandBuilder()
  .setName('claude')
  .setDescription('Control Claude Code sessions')
  .setDefaultMemberPermissions(0n)
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('Start a new Claude session with a dedicated channel')
      .addStringOption((opt) =>
        opt.setName('repo').setDescription('Repository name (defaults to base dir)').setRequired(false).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) => sub.setName('stop').setDescription('Stop the session linked to this channel'))
  .addSubcommand((sub) => sub.setName('screen').setDescription('Capture the tmux screen of this session'))
  .addSubcommand((sub) =>
    sub
      .setName('input')
      .setDescription('Send input to the tmux session')
      .addStringOption((opt) => opt.setName('text').setDescription('Text to send').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('validate')
      .setDescription('Navigate down N times then press Enter (for menus)')
      .addIntegerOption((opt) => opt.setName('option').setDescription('Menu option number (0 = just Enter)').setRequired(true).setMinValue(0).setMaxValue(10)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('key')
      .setDescription('Send a special key (enter, escape, tab, up, down)')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Key name').setRequired(true)
          .addChoices(
            { name: 'Enter', value: 'Enter' },
            { name: 'Escape', value: 'Escape' },
            { name: 'Tab', value: 'Tab' },
            { name: 'Up', value: 'Up' },
            { name: 'Down', value: 'Down' },
            { name: 'Ctrl+C', value: 'C-c' },
            { name: 'Ctrl+E', value: 'C-e' },
          ),
      ),
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Show all active sessions'));

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const { listRepos } = await import('../services/repo-manager.js');
  const repos = listRepos();
  const filtered = repos.filter((r) => r.name.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
  await interaction.respond(filtered.map((r) => ({ name: r.name, value: r.name })));
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'start':
      return handleStart(interaction);
    case 'stop':
      return handleStop(interaction);
    case 'screen':
      return handleScreen(interaction);
    case 'input':
      return handleInput(interaction);
    case 'validate':
      return handleValidate(interaction);
    case 'key':
      return handleKey(interaction);
    case 'status':
      return handleStatus(interaction);
  }
}

async function handleStart(interaction) {
  await interaction.deferReply();

  const repoOption = interaction.options.getString('repo');
  let cwd;
  let sessionName;

  if (repoOption) {
    const repoPath = getRepoPath(repoOption);
    if (!repoPath) {
      return interaction.editReply(`Repo **${repoOption}** not found.`);
    }
    cwd = repoPath;
    sessionName = repoOption;
  } else {
    cwd = getBaseDir();
    sessionName = cwd.split('/').pop();
  }

  if (isRunning(sessionName)) {
    const session = getSession(sessionName);
    return interaction.editReply(`Session **${sessionName}** already running. Channel: <#${session.channelId}>`);
  }

  // 1. Create Discord channel
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    return interaction.editReply('`DISCORD_GUILD_ID` not configured in .env');
  }

  const guild = interaction.client.guilds.cache.get(guildId) || await interaction.client.guilds.fetch(guildId);
  const categoryId = process.env.DISCORD_CATEGORY_ID || null;

  let channel;
  try {
    channel = await createSessionChannel(guild, sessionName, categoryId);
  } catch (err) {
    return interaction.editReply(`Failed to create channel: ${err.message}`);
  }

  // 2. Register channel in access.json for the Discord plugin
  try {
    addChannelGroup(channel.id);
  } catch (err) {
    await deleteSessionChannel(channel);
    return interaction.editReply(`Failed to update access.json: ${err.message}`);
  }

  // 3. Start tmux session
  try {
    const result = startSession(sessionName, cwd, async (code, signal) => {
      notifyOwner(`Claude **${sessionName}** exited (code=${code}, signal=${signal}).`);
      stopWatch(channel.id);
    });
    setChannelId(sessionName, channel.id);

    // 4. Auto-start watch
    startWatch(channel.id, sessionName, interaction.client);

    return interaction.editReply(`Claude started in **${sessionName}** (PID ${result.pid}). Channel: <#${channel.id}>`);
  } catch (err) {
    // Rollback: remove channel group + delete channel
    removeChannelGroup(channel.id);
    await deleteSessionChannel(channel);
    return interaction.editReply(`Failed to start Claude: ${err.message}`);
  }
}

async function handleStop(interaction) {
  const session = getSessionByChannelId(interaction.channelId);

  if (!session) {
    return interaction.reply({ content: 'No session linked to this channel. Use this command in a session channel.', ephemeral: true });
  }

  await interaction.deferReply();

  const { name, repoName, channelId } = session;

  // 1. Stop watch + tmux
  stopWatch(channelId);
  await stopSession(name);

  // 2. Remove from access.json
  try {
    removeChannelGroup(channelId);
  } catch {
    // Non-fatal
  }

  // 3. Delete the channel (reply first since channel will be gone)
  await interaction.editReply(`Stopping session **${repoName}**... Channel will be deleted.`);

  try {
    const channel = interaction.client.channels.cache.get(channelId);
    if (channel) {
      setTimeout(() => deleteSessionChannel(channel), 2000);
    }
  } catch {
    // Non-fatal
  }
}

async function handleScreen(interaction) {
  const session = getSessionByChannelId(interaction.channelId);

  if (!session) {
    return interaction.reply({ content: 'No session linked to this channel.', ephemeral: true });
  }

  try {
    const screen = captureScreen(session.name);
    const trimmed = screen.trimEnd();

    if (!trimmed) {
      return interaction.reply({ content: '*(empty screen)*', ephemeral: true });
    }

    const maxLen = 1980;
    const content = trimmed.length > maxLen ? '...' + trimmed.slice(-maxLen) : trimmed;

    return interaction.reply(`\`\`\`\n${content}\n\`\`\``);
  } catch (err) {
    return interaction.reply({ content: `Failed to capture screen: ${err.message}`, ephemeral: true });
  }
}

async function handleInput(interaction) {
  const session = getSessionByChannelId(interaction.channelId);

  if (!session) {
    return interaction.reply({ content: 'No session linked to this channel.', ephemeral: true });
  }

  const text = interaction.options.getString('text');

  try {
    sendInput(session.name, text + '\n');
    return interaction.reply(`Sent: \`${text}\``);
  } catch (err) {
    return interaction.reply({ content: `Failed to send input: ${err.message}`, ephemeral: true });
  }
}

async function handleValidate(interaction) {
  const session = getSessionByChannelId(interaction.channelId);

  if (!session) {
    return interaction.reply({ content: 'No session linked to this channel.', ephemeral: true });
  }

  const option = interaction.options.getInteger('option');

  try {
    const keys = [];
    for (let i = 0; i < option; i++) {
      keys.push('Down');
    }
    keys.push('Enter');
    sendKeys(session.name, ...keys);
    return interaction.reply(`Sent: ${option > 0 ? `${option}x Down + ` : ''}Enter`);
  } catch (err) {
    return interaction.reply({ content: `Failed: ${err.message}`, ephemeral: true });
  }
}

async function handleKey(interaction) {
  const session = getSessionByChannelId(interaction.channelId);

  if (!session) {
    return interaction.reply({ content: 'No session linked to this channel.', ephemeral: true });
  }

  const key = interaction.options.getString('name');

  try {
    sendKeys(session.name, key);
    return interaction.reply(`Sent: \`${key}\``);
  } catch (err) {
    return interaction.reply({ content: `Failed: ${err.message}`, ephemeral: true });
  }
}

async function handleStatus(interaction) {
  const sessions = getAllSessions();

  if (sessions.length === 0) {
    return interaction.reply({ content: 'No active sessions.', ephemeral: true });
  }

  const maxMb = parseInt(process.env.CLAUDE_MAX_MEMORY_MB || '2048', 10);

  const fields = sessions.map((s) => {
    const memMb = getMemoryUsage(s.name);
    const uptimeMs = Date.now() - s.startedAt;
    const uptimeMin = Math.floor(uptimeMs / 60_000);
    const uptimeH = Math.floor(uptimeMin / 60);
    const uptimeStr = uptimeH > 0 ? `${uptimeH}h ${uptimeMin % 60}m` : `${uptimeMin}m`;

    let memStr = 'N/A';
    if (memMb !== null) {
      const pct = Math.min((memMb / maxMb) * 100, 100);
      memStr = `${memMb} MB (${Math.round(pct)}%)`;
    }

    const channelStr = s.channelId ? `<#${s.channelId}>` : 'none';

    return {
      name: s.repoName,
      value: `PID ${s.pid} | ${uptimeStr} | ${memStr} | ${channelStr}`,
    };
  });

  const embed = new EmbedBuilder()
    .setTitle('Active Claude Sessions')
    .addFields(fields)
    .setColor(0x7c3aed)
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}
