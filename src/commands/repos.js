import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { startSession, stopSession, getSession, isRunning } from '../services/claude-process.js';
import { cloneRepo, listRepos, pullRepo, getRepoPath } from '../services/repo-manager.js';
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
      .setDescription('Open a repository (pull + start Claude)')
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

function makeExitHandler() {
  return (code, signal) => {
    notifyOwner(`Claude exited (code=${code}, signal=${signal}).`);
  };
}

async function startInRepo(repoPath) {
  return startSession(repoPath, makeExitHandler());
}

function confirmationRow(repoName) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_switch:${repoName}`).setLabel('Confirm').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cancel_switch').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

async function handleClone(interaction) {
  await interaction.deferReply();
  const url = interaction.options.getString('url');

  let repo;
  try {
    repo = cloneRepo(url);
  } catch (err) {
    return interaction.editReply(`Clone failed: ${err.message}`);
  }

  if (isRunning()) {
    const session = getSession();
    return interaction.editReply({
      content: `Cloned **${repo.name}**. Session active on **${session.repoName}**. Switch to **${repo.name}**?`,
      components: [confirmationRow(repo.name)],
    });
  }

  try {
    const result = await startInRepo(repo.path);
    return interaction.editReply(`Cloned **${repo.name}** and started Claude (PID ${result.pid}).`);
  } catch (err) {
    return interaction.editReply(`Cloned **${repo.name}** but failed to start Claude: ${err.message}`);
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

  const names = repos.map((r) => `- **${r.name}**`).join('\n');
  return interaction.reply({ content: `**Repositories:**\n${names}`, components: rows });
}

async function handleOpen(interaction) {
  await interaction.deferReply();
  const name = interaction.options.getString('name');

  const repoPath = getRepoPath(name);
  if (!repoPath) {
    return interaction.editReply(`Repo **${name}** not found.`);
  }

  try {
    pullRepo(name);
  } catch {
    // Pull failure is non-fatal — continue with existing state
  }

  if (isRunning()) {
    const session = getSession();
    if (session.repoName === name) {
      return interaction.editReply(`Already running on **${name}**.`);
    }
    return interaction.editReply({
      content: `Session active on **${session.repoName}**. Switch to **${name}**?`,
      components: [confirmationRow(name)],
    });
  }

  try {
    const result = await startInRepo(repoPath);
    return interaction.editReply(`Opened **${name}** and started Claude (PID ${result.pid}).`);
  } catch (err) {
    return interaction.editReply(`Failed to start Claude in **${name}**: ${err.message}`);
  }
}

// Button handler — called from bot.js
export async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'cancel_switch') {
    return interaction.update({ content: 'Cancelled.', components: [] });
  }

  let repoName;
  if (customId.startsWith('confirm_switch:')) {
    repoName = customId.slice('confirm_switch:'.length);
  } else if (customId.startsWith('open_repo:')) {
    repoName = customId.slice('open_repo:'.length);
  } else {
    return;
  }

  const repoPath = getRepoPath(repoName);
  if (!repoPath) {
    return interaction.update({ content: `Repo **${repoName}** not found.`, components: [] });
  }

  // For open_repo buttons, try pull first
  if (customId.startsWith('open_repo:')) {
    // If session already on this repo, skip
    if (isRunning() && getSession().repoName === repoName) {
      return interaction.update({ content: `Already running on **${repoName}**.`, components: [] });
    }

    try {
      pullRepo(repoName);
    } catch {
      // Non-fatal
    }

    if (isRunning()) {
      const session = getSession();
      return interaction.update({
        content: `Session active on **${session.repoName}**. Switch to **${repoName}**?`,
        components: [confirmationRow(repoName)],
      });
    }
  }

  // Stop existing session if running
  if (isRunning()) {
    await stopSession();
  }

  try {
    const result = await startInRepo(repoPath);
    return interaction.update({ content: `Switched to **${repoName}** (PID ${result.pid}).`, components: [] });
  } catch (err) {
    return interaction.update({ content: `Failed to start Claude in **${repoName}**: ${err.message}`, components: [] });
  }
}
