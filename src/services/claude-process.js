import { spawn, execFileSync } from 'node:child_process';

let currentSession = null;

export function startSession(cwd, onExit) {
  if (currentSession) {
    throw new Error(`Session already running (PID ${currentSession.process.pid}) in ${currentSession.repoName}`);
  }

  const repoName = cwd.split('/').pop();
  let proc;

  try {
    proc = spawn('claude', ['--channels', 'plugin:discord@claude-plugins-official'], {
      stdio: 'pipe',
      cwd,
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('claude binary not found in PATH');
    }
    throw err;
  }

  proc.on('error', (err) => {
    if (err.code === 'ENOENT') {
      currentSession = null;
      onExit?.(-1, null);
    }
  });

  proc.on('exit', (code, signal) => {
    currentSession = null;
    onExit?.(code, signal);
  });

  currentSession = {
    process: proc,
    cwd,
    repoName,
    startedAt: Date.now(),
  };

  return { pid: proc.pid, cwd, repoName };
}

export async function stopSession() {
  if (!currentSession) return false;

  const proc = currentSession.process;
  proc.kill('SIGTERM');

  const exited = await Promise.race([
    new Promise((resolve) => proc.on('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);

  if (!exited) {
    proc.kill('SIGKILL');
  }

  currentSession = null;
  return true;
}

export function getSession() {
  return currentSession
    ? {
        pid: currentSession.process.pid,
        cwd: currentSession.cwd,
        repoName: currentSession.repoName,
        startedAt: currentSession.startedAt,
      }
    : null;
}

export function isRunning() {
  return currentSession !== null;
}

export function getMemoryUsage() {
  if (!currentSession) return null;

  try {
    const output = execFileSync('ps', ['-o', 'rss=', '-p', String(currentSession.process.pid)], {
      encoding: 'utf-8',
    });
    const rssKb = parseInt(output.trim(), 10);
    if (isNaN(rssKb)) return null;
    return Math.round(rssKb / 1024);
  } catch {
    return null;
  }
}

export function sendStdin(text) {
  if (!currentSession) {
    throw new Error('No session running');
  }
  currentSession.process.stdin.write(text);
}
