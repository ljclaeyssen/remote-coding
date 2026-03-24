/**
 * Auto-patches the Discord plugin's cached server.ts to add permissionToGroups support.
 *
 * The official Discord plugin for Claude Code sends permission requests (Allow/Deny)
 * only to DMs. This patcher injects opt-in support for routing them to guild channels
 * instead, controlled by "permissionToGroups": true in access.json.
 * When enabled, permissions go to guild channels only (no DM spam).
 *
 * This runs at bot startup and re-applies the patch if the plugin was updated.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = process.env.HOME ?? homedir();
const PLUGINS_FILE = join(HOME, '.claude', 'plugins', 'installed_plugins.json');
const PLUGIN_KEY = 'discord@claude-plugins-official';

// ── Anchor patterns (from the upstream server.ts) ──────────────────────

// 1. Type Access — last field before closing brace
const ANCHOR_TYPE = `  chunkMode?: 'length' | 'newline'\n}`;
const INJECT_TYPE = `  chunkMode?: 'length' | 'newline'
  /** Opt-in: also send permission requests to registered guild channels, not just DMs.
   *  This patch allows you to give permissions through Discord guild channels
   *  instead of only via DMs. Set "permissionToGroups": true in access.json to enable.
   *  Auto-patched by remote-coding launcher bot at startup. */
  permissionToGroups?: boolean
}`;

// 2. readAccessFile() — last field in the return object
const ANCHOR_READ = `      chunkMode: parsed.chunkMode,\n    }`;
const INJECT_READ = `      chunkMode: parsed.chunkMode,
      permissionToGroups: parsed.permissionToGroups,
    }`;

// 3. Permission request handler — wrap DM loop with condition, add guild channel alternative
const ANCHOR_PERM = `    for (const userId of access.allowFrom) {
      void (async () => {
        try {
          const user = await client.users.fetch(userId)
          await user.send({ content: text, components: [row] })
        } catch (e) {
          process.stderr.write(\`permission_request send to \${userId} failed: \${e}\\n\`)
        }
      })()
    }
  },
)`;
const INJECT_PERM = `    // [auto-patch v2] When permissionToGroups is enabled, permissions go to guild channels only (no DMs).
    // When disabled, permissions go to DMs as usual (original behavior).
    // Patch applied by: remote-coding launcher bot (github.com/lonjon/remote-coding)
    if (!access.permissionToGroups) {
      for (const userId of access.allowFrom) {
        void (async () => {
          try {
            const user = await client.users.fetch(userId)
            await user.send({ content: text, components: [row] })
          } catch (e) {
            process.stderr.write(\`permission_request send to \${userId} failed: \${e}\\n\`)
          }
        })()
      }
    } else {
      for (const channelId of Object.keys(access.groups ?? {})) {
        void (async () => {
          try {
            const channel = await client.channels.fetch(channelId)
            if (channel?.isTextBased()) {
              await channel.send({ content: text, components: [row] })
            }
          } catch (e) {
            process.stderr.write(\`permission_request to channel \${channelId} failed: \${e}\\n\`)
          }
        })()
      }
    }
  },
)`;

const PATCHES = [
  { name: 'Access type definition', anchor: ANCHOR_TYPE, inject: INJECT_TYPE },
  { name: 'readAccessFile() return', anchor: ANCHOR_READ, inject: INJECT_READ },
  { name: 'permission request guild loop', anchor: ANCHOR_PERM, inject: INJECT_PERM },
];

/**
 * Patches the cached Discord plugin to add permissionToGroups support.
 * @returns {{ patched: boolean, version: string, errors: string[] }}
 */
export function patchDiscordPlugin() {
  const result = { patched: false, fresh: false, version: 'unknown', errors: [] };

  // Step 1 — Find the active cache path
  if (!existsSync(PLUGINS_FILE)) {
    result.errors.push(
      `[plugin-patcher] installed_plugins.json not found at ${PLUGINS_FILE}. ` +
      'Claude Code plugins may not be installed yet.'
    );
    return result;
  }

  let installPath;
  try {
    const plugins = JSON.parse(readFileSync(PLUGINS_FILE, 'utf8'));
    const entries = plugins.plugins?.[PLUGIN_KEY];
    if (!entries || entries.length === 0) {
      result.errors.push(
        `[plugin-patcher] Discord plugin (${PLUGIN_KEY}) not found in installed_plugins.json. ` +
        'Is the Discord plugin installed?'
      );
      return result;
    }
    installPath = entries[0].installPath;
    result.version = entries[0].version || 'unknown';
  } catch (e) {
    result.errors.push(`[plugin-patcher] Failed to parse installed_plugins.json: ${e.message}`);
    return result;
  }

  const serverPath = join(installPath, 'server.ts');
  if (!existsSync(serverPath)) {
    result.errors.push(
      `[plugin-patcher] server.ts not found at ${serverPath}. ` +
      'The plugin cache may be corrupted.'
    );
    return result;
  }

  // Step 2 — Read and check if already patched
  let source;
  try {
    source = readFileSync(serverPath, 'utf8');
  } catch (e) {
    result.errors.push(
      `[plugin-patcher] Failed to read server.ts: ${e.message}\n` +
      `  Path: ${serverPath}\n` +
      '  Check file permissions (chmod u+r) or if the filesystem is read-only.'
    );
    return result;
  }

  if (source.includes('[auto-patch v2]')) {
    // Already patched (current version)
    result.patched = true;
    return result;
  }

  // Step 3 — Verify ALL anchors exist before patching (all-or-nothing)
  for (const { name, anchor } of PATCHES) {
    if (!source.includes(anchor)) {
      result.errors.push(
        `[plugin-patcher] FAILED to apply "${name}": anchor pattern not found in server.ts (v${result.version}).\n` +
        '  The plugin structure has changed and the auto-patch could not find its injection point.\n' +
        '  This patch allows permission requests to be sent to Discord guild channels (not just DMs).\n' +
        '  Without it, you will only receive Allow/Deny prompts in DMs.\n' +
        '  Please update the patcher in src/services/plugin-patcher.js to match the new plugin version.\n' +
        '  See .claude/claude.md for context and history.\n' +
        `  To find the cache: cat ~/.claude/plugins/installed_plugins.json | grep installPath`
      );
    }
  }

  if (result.errors.length > 0) {
    // Don't write a partial patch — it's worse than no patch
    return result;
  }

  // All anchors found — apply all patches
  for (const { anchor, inject } of PATCHES) {
    source = source.replace(anchor, inject);
  }

  // Write back
  try {
    writeFileSync(serverPath, source, 'utf8');
    result.patched = true;
    result.fresh = true;
  } catch (e) {
    result.errors.push(
      `[plugin-patcher] Failed to write patched server.ts: ${e.message}\n` +
      `  Path: ${serverPath}\n` +
      '  Check file permissions (chmod u+w) or if the filesystem is read-only.'
    );
  }

  return result;
}
