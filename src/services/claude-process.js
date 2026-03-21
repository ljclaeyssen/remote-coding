import { execFileSync, execSync } from 'node:child_process';

/** @type {Map<string, {cwd: string, repoName: string, startedAt: number, channelId: string|null, pollInterval: ReturnType<typeof setInterval>}>} */
const sessions = new Map();

function tmuxName(name) {
  return `claude-${name}`;
}

export function cleanOrphanSessions() {
  try {
    const output = execSync('tmux ls -F "#{session_name}"', { encoding: 'utf-8' });
    const orphans = output.trim().split('\n').filter((s) => s.startsWith('claude-') && !sessions.has(s.slice('claude-'.length)));
    for (const name of orphans) {
      try {
        execFileSync('tmux', ['kill-session', '-t', name]);
        console.log(`Killed orphan tmux session: ${name}`);
      } catch {
        // Already dead
      }
    }
    return orphans.length;
  } catch {
    // No tmux server or no sessions
    return 0;
  }
}

export function startSession(name, cwd, onExit) {
  if (sessions.has(name)) {
    throw new Error(`Session "${name}" already running`);
  }

  const repoName = cwd.split('/').pop();
  const bunPath = `${process.env.HOME}/.bun/bin`;
  const pathEnv = `${bunPath}:${process.env.PATH}`;
  const tmux = tmuxName(name);

  try {
    execSync(
      `tmux new-session -d -s ${tmux} -c '${cwd}' 'export PATH="${pathEnv}" && claude --permission-mode acceptEdits --channels plugin:discord@claude-plugins-official'`,
    );
  } catch (err) {
    throw new Error(`Failed to start tmux session: ${err.message}`);
  }

  const session = {
    cwd,
    repoName,
    startedAt: Date.now(),
    channelId: null,
    pollInterval: null,
  };

  // Poll for tmux session death
  session.pollInterval = setInterval(() => {
    if (!isTmuxAlive(name)) {
      clearInterval(session.pollInterval);
      sessions.delete(name);
      onExit?.(1, null);
    }
  }, 5000);

  sessions.set(name, session);

  return { pid: getClaudePid(name), cwd, repoName };
}

export async function stopSession(name) {
  const session = sessions.get(name);
  if (!session) return false;

  if (session.pollInterval) {
    clearInterval(session.pollInterval);
  }

  try {
    execFileSync('tmux', ['kill-session', '-t', tmuxName(name)]);
  } catch {
    // Session already dead
  }

  sessions.delete(name);
  return true;
}

export function getSession(name) {
  const session = sessions.get(name);
  if (!session) return null;

  if (!isTmuxAlive(name)) {
    if (session.pollInterval) clearInterval(session.pollInterval);
    sessions.delete(name);
    return null;
  }

  return {
    name,
    pid: getClaudePid(name),
    cwd: session.cwd,
    repoName: session.repoName,
    startedAt: session.startedAt,
    channelId: session.channelId,
  };
}

export function isRunning(name) {
  const session = sessions.get(name);
  if (!session) return false;
  if (!isTmuxAlive(name)) {
    if (session.pollInterval) clearInterval(session.pollInterval);
    sessions.delete(name);
    return false;
  }
  return true;
}

export function getMemoryUsage(name) {
  const pid = getClaudePid(name);
  if (!pid) return null;

  try {
    const output = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf-8',
    });
    const rssKb = parseInt(output.trim(), 10);
    if (isNaN(rssKb)) return null;
    return Math.round(rssKb / 1024);
  } catch {
    return null;
  }
}

export function sendInput(name, text) {
  if (!sessions.has(name)) {
    throw new Error(`No session "${name}" running`);
  }
  const tmux = tmuxName(name);
  execFileSync('tmux', ['send-keys', '-t', tmux, '-l', text]);
  execFileSync('tmux', ['send-keys', '-t', tmux, 'Enter']);
}

export function sendKeys(name, ...keys) {
  if (!sessions.has(name)) {
    throw new Error(`No session "${name}" running`);
  }
  for (const key of keys) {
    execFileSync('tmux', ['send-keys', '-t', tmuxName(name), key]);
  }
}

export function captureScreen(name) {
  if (!sessions.has(name)) {
    throw new Error(`No session "${name}" running`);
  }

  try {
    const output = execSync(`tmux capture-pane -t ${tmuxName(name)} -p`, {
      encoding: 'utf-8',
    });
    return output;
  } catch (err) {
    throw new Error(`Failed to capture screen: ${err.message}`);
  }
}

export function setChannelId(name, channelId) {
  const session = sessions.get(name);
  if (session) {
    session.channelId = channelId;
  }
}

export function getSessionByChannelId(channelId) {
  for (const [name, session] of sessions) {
    if (session.channelId === channelId) {
      return {
        name,
        pid: getClaudePid(name),
        cwd: session.cwd,
        repoName: session.repoName,
        startedAt: session.startedAt,
        channelId: session.channelId,
      };
    }
  }
  return null;
}

export function getAllSessions() {
  const result = [];
  for (const name of sessions.keys()) {
    const s = getSession(name);
    if (s) result.push(s);
  }
  return result;
}

function isTmuxAlive(name) {
  try {
    execFileSync('tmux', ['has-session', '-t', tmuxName(name)], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getClaudePid(name) {
  try {
    const output = execSync(
      `tmux list-panes -t ${tmuxName(name)} -F '#{pane_pid}'`,
      { encoding: 'utf-8' },
    );
    return parseInt(output.trim(), 10) || null;
  } catch {
    return null;
  }
}
