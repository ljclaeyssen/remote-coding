import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { startSession, stopSession, getSession, isRunning, getMemoryUsage, sendStdin } from '../services/claude-process.js';
import { getBaseDir } from '../services/repo-manager.js';
import { notifyOwner, onClaudeExit } from '../state.js';

export const data = new SlashCommandBuilder()
  .setName('claude')
  .setDescription('Control Claude Code session')
  .setDefaultMemberPermissions(0n)
  .addSubcommand((sub) => sub.setName('start').setDescription('Start a new Claude session'))
  .addSubcommand((sub) => sub.setName('stop').setDescription('Stop the current Claude session'))
  .addSubcommand((sub) => sub.setName('restart').setDescription('Restart the current Claude session'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Show current session status'))
  .addSubcommand((sub) => sub.setName('lock').setDescription('Lock Claude to owner-only access via Discord plugin'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'start':
      return handleStart(interaction);
    case 'stop':
      return handleStop(interaction);
    case 'restart':
      return handleRestart(interaction);
    case 'status':
      return handleStatus(interaction);
    case 'lock':
      return handleLock(interaction);
  }
}

async function handleStart(interaction) {
  if (isRunning()) {
    const session = getSession();
    return interaction.reply({ content: `Already running (PID ${session.pid}) in **${session.repoName}**. Stop first.`, ephemeral: true });
  }

  try {
    const result = startSession(getBaseDir(), (code, signal) => {
      notifyOwner(`Claude exited (code=${code}, signal=${signal}).`);
    });
    return interaction.reply(`Claude started (PID ${result.pid}) in **${result.repoName}**.`);
  } catch (err) {
    return interaction.reply({ content: `Failed to start: ${err.message}`, ephemeral: true });
  }
}

async function handleStop(interaction) {
  if (!isRunning()) {
    return interaction.reply({ content: 'No session running.', ephemeral: true });
  }

  const session = getSession();
  await stopSession();
  return interaction.reply(`Claude stopped (was PID ${session.pid} in **${session.repoName}**).`);
}

async function handleRestart(interaction) {
  await interaction.deferReply();

  const session = getSession();
  const cwd = session?.cwd || getBaseDir();

  if (isRunning()) {
    await stopSession();
  }

  try {
    const result = startSession(cwd, (code, signal) => {
      notifyOwner(`Claude exited (code=${code}, signal=${signal}).`);
    });
    return interaction.editReply(`Claude restarted (PID ${result.pid}) in **${result.repoName}**.`);
  } catch (err) {
    return interaction.editReply(`Failed to restart: ${err.message}`);
  }
}

async function handleStatus(interaction) {
  const session = getSession();

  if (!session) {
    return interaction.reply({ content: 'No session running.', ephemeral: true });
  }

  const memMb = getMemoryUsage();
  const maxMb = parseInt(process.env.CLAUDE_MAX_MEMORY_MB || '2048', 10);
  const uptimeMs = Date.now() - session.startedAt;
  const uptimeMin = Math.floor(uptimeMs / 60_000);
  const uptimeH = Math.floor(uptimeMin / 60);
  const uptimeStr = uptimeH > 0 ? `${uptimeH}h ${uptimeMin % 60}m` : `${uptimeMin}m`;

  // Memory progress bar
  let memBar = 'N/A';
  if (memMb !== null) {
    const pct = Math.min((memMb / maxMb) * 100, 100);
    const filled = Math.round(pct / 5);
    memBar = '`' + '█'.repeat(filled) + '░'.repeat(20 - filled) + '`' + ` ${memMb} MB / ${maxMb} MB (${Math.round(pct)}%)`;
  }

  const embed = new EmbedBuilder()
    .setTitle('Claude Code Session')
    .addFields(
      { name: 'PID', value: String(session.pid), inline: true },
      { name: 'Repo', value: session.repoName, inline: true },
      { name: 'Uptime', value: uptimeStr, inline: true },
      { name: 'Memory', value: memBar },
    )
    .setColor(0x7c3aed)
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

async function handleLock(interaction) {
  if (!isRunning()) {
    return interaction.reply({ content: 'No session running.', ephemeral: true });
  }

  try {
    sendStdin('/discord:access policy allowlist\n');
    return interaction.reply('Claude locked to owner-only access.');
  } catch (err) {
    return interaction.reply({ content: `Failed to lock: ${err.message}`, ephemeral: true });
  }
}
