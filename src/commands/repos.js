import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { isRunning, getSession, startSession, setChannelId } from '../services/claude-process.js';
import { cloneRepo, listRepos, pullRepo, getRepoPath } from '../services/repo-manager.js';
import { createSessionChannel, deleteSessionChannel } from '../services/channel-manager.js';
import { addChannelGroup, removeChannelGroup } from '../services/access-manager.js';
import { notifyOwner } from '../state.js';

export const data = new SlashCommandBuilder()
  .setName('repos')
  .setDescription('Manage repositories')
  .setDefaultMemberPermissions(0n)
  .addSubcommand((sub) =>
    sub
      .setName('clone')
      .setDescription('Clone a repository')
      .addStringOption((opt) => opt.setName('url').setDescription('Git URL to clone').setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List available repositories'))
  .addSubcommand((sub) =>
    sub
      .setName('open')
      .setDescription('Pull latest and start a Claude session')
      .addStringOption((opt) => opt.setName('name').setDescription('Repository name').setRequired(true).setAutocomplete(true)),
  );

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const repos = listRepos();
  const filtered = repos.filter((r) => r.name.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
  await interaction.respond(filtered.map((r) => ({ name: r.name, value: r.name })));
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'clone':
      return handleClone(interaction);
    case 'list':
      return handleList(interaction);
    case 'open':
      return handleOpen(interaction);
  }
}

async function handleClone(interaction) {
  await interaction.deferReply();
  const url = interaction.options.getString('url');

  try {
    const repo = cloneRepo(url);
    return interaction.editReply(`Cloned **${repo.name}**. Use \`/claude start ${repo.name}\` or \`/repos open ${repo.name}\` to start a session.`);
  } catch (err) {
    return interaction.editReply(`Clone failed: ${err.message}`);
  }
}

async function handleList(interaction) {
  const repos = listRepos();

  if (repos.length === 0) {
    return interaction.reply({ content: 'No repositories found.', ephemeral: true });
  }

  const rows = repos.slice(0, 5).map((repo) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`open_repo:${repo.name}`).setLabel(repo.name).setStyle(ButtonStyle.Secondary),
    ),
  );

  const names = repos.map((r) => {
    const running = isRunning(r.name);
    const prefix = running ? '🟢' : '⚪';
    return `${prefix} **${r.name}**`;
  }).join('\n');

  return interaction.reply({ content: `**Repositories:**\n${names}`, components: rows });
}

async function handleOpen(interaction) {
  await interaction.deferReply();
  const name = interaction.options.getString('name');

  const repoPath = getRepoPath(name);
  if (!repoPath) {
    return interaction.editReply(`Repo **${name}** not found.`);
  }

  // Already running? Just point to the channel
  if (isRunning(name)) {
    const session = getSession(name);
    return interaction.editReply(`**${name}** already running. Channel: <#${session.channelId}>`);
  }

  // Pull latest
  try {
    pullRepo(name);
  } catch {
    // Non-fatal
  }

  // Start session (same flow as /claude start)
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    return interaction.editReply('`DISCORD_GUILD_ID` not configured in .env');
  }

  const guild = interaction.client.guilds.cache.get(guildId) || await interaction.client.guilds.fetch(guildId);
  const categoryId = process.env.DISCORD_CATEGORY_ID || null;

  let channel;
  try {
    channel = await createSessionChannel(guild, name, categoryId);
  } catch (err) {
    return interaction.editReply(`Failed to create channel: ${err.message}`);
  }

  try {
    addChannelGroup(channel.id);
  } catch (err) {
    await deleteSessionChannel(channel);
    return interaction.editReply(`Failed to update access.json: ${err.message}`);
  }

  try {
    const result = startSession(name, repoPath, async (code, signal) => {
      notifyOwner(`Claude **${name}** exited (code=${code}, signal=${signal}).`);
    });
    setChannelId(name, channel.id);
    return interaction.editReply(`Opened **${name}** (PID ${result.pid}). Channel: <#${channel.id}>`);
  } catch (err) {
    removeChannelGroup(channel.id);
    await deleteSessionChannel(channel);
    return interaction.editReply(`Failed to start Claude in **${name}**: ${err.message}`);
  }
}

// Button handler — called from bot.js
export async function handleButton(interaction) {
  const customId = interaction.customId;

  if (!customId.startsWith('open_repo:')) return;

  const repoName = customId.slice('open_repo:'.length);
  const repoPath = getRepoPath(repoName);

  if (!repoPath) {
    return interaction.update({ content: `Repo **${repoName}** not found.`, components: [] });
  }

  // Already running? Point to channel
  if (isRunning(repoName)) {
    const session = getSession(repoName);
    return interaction.update({ content: `**${repoName}** already running. Channel: <#${session.channelId}>`, components: [] });
  }

  // Pull + start (same flow as handleOpen)
  await interaction.update({ content: `Opening **${repoName}**...`, components: [] });

  try {
    pullRepo(repoName);
  } catch {
    // Non-fatal
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    return interaction.editReply('`DISCORD_GUILD_ID` not configured.');
  }

  const guild = interaction.client.guilds.cache.get(guildId) || await interaction.client.guilds.fetch(guildId);
  const categoryId = process.env.DISCORD_CATEGORY_ID || null;

  let channel;
  try {
    channel = await createSessionChannel(guild, repoName, categoryId);
    addChannelGroup(channel.id);
    const result = startSession(repoName, repoPath, async (code, signal) => {
      notifyOwner(`Claude **${repoName}** exited (code=${code}, signal=${signal}).`);
    });
    setChannelId(repoName, channel.id);
    await interaction.editReply(`Opened **${repoName}** (PID ${result.pid}). Channel: <#${channel.id}>`);
  } catch (err) {
    if (channel) {
      removeChannelGroup(channel.id);
      await deleteSessionChannel(channel).catch(() => {});
    }
    await interaction.editReply(`Failed to open **${repoName}**: ${err.message}`);
  }
}
