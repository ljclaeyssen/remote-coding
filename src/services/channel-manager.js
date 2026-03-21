import { ChannelType, PermissionFlagsBits } from 'discord.js';

/**
 * Create a dedicated text channel for a Claude session.
 * @param {import('discord.js').Guild} guild
 * @param {string} repoName
 * @param {string} [categoryId] - Optional category to nest the channel under
 * @returns {Promise<import('discord.js').TextChannel>}
 */
export async function createSessionChannel(guild, repoName, categoryId) {
  const channelName = `claude-${repoName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const options = {
    name: channelName,
    type: ChannelType.GuildText,
    topic: `Claude Code session — ${repoName}`,
  };

  if (categoryId) {
    options.parent = categoryId;
  }

  return guild.channels.create(options);
}

/**
 * Delete a session channel.
 * @param {import('discord.js').TextChannel} channel
 */
export async function deleteSessionChannel(channel) {
  await channel.delete('Claude session ended');
}
