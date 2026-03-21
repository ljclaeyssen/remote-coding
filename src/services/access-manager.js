import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ACCESS_PATH = join(process.env.HOME, '.claude', 'channels', 'discord', 'access.json');

function readAccess() {
  try {
    return JSON.parse(readFileSync(ACCESS_PATH, 'utf-8'));
  } catch {
    return { dmPolicy: 'pairing', allowFrom: [], groups: {}, pending: {} };
  }
}

function writeAccess(data) {
  const dir = dirname(ACCESS_PATH);
  mkdirSync(dir, { recursive: true });

  // Atomic write: tmp file in same dir + rename
  const tmp = join(dir, `.access-${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, ACCESS_PATH);
}

export function addChannelGroup(channelId) {
  const data = readAccess();
  data.groups[channelId] = { requireMention: false, allowFrom: [] };
  writeAccess(data);
}

export function removeChannelGroup(channelId) {
  const data = readAccess();
  delete data.groups[channelId];
  writeAccess(data);
}
