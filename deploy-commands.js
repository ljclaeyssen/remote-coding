import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { data as claudeData } from './src/commands/claude.js';
import { data as reposData } from './src/commands/repos.js';

const { DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID } = process.env;

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required');
  process.exit(1);
}

const commands = [claudeData.toJSON(), reposData.toJSON()];
const rest = new REST().setToken(DISCORD_BOT_TOKEN);

try {
  console.log(`Registering ${commands.length} commands...`);
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
  console.log('Commands registered successfully.');
} catch (err) {
  console.error('Failed to register commands:', err);
  process.exit(1);
}
