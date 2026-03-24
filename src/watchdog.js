let intervalId = null;
const warningState = new Map(); // sessionName → boolean

export function startWatchdog({ getAllSessions, getMemoryUsage, isRunning, restartFn, notifyFn, maxMb }) {
  stopWatchdog();

  intervalId = setInterval(async () => {
    const sessions = getAllSessions();

    for (const session of sessions) {
      if (!isRunning(session.name)) {
        warningState.delete(session.name);
        continue;
      }

      const memMb = getMemoryUsage(session.name);
      if (memMb === null) continue;

      const pct = (memMb / maxMb) * 100;

      if (memMb >= maxMb) {
        await notifyFn(`⚠️ **${session.repoName}** memory at ${memMb} MB (${Math.round(pct)}% of ${maxMb} MB limit). Restarting...`);
        await restartFn(session.name);
        warningState.delete(session.name);
      } else if (pct >= 80 && !warningState.get(session.name)) {
        await notifyFn(`⚠️ **${session.repoName}** memory at ${memMb} MB (${Math.round(pct)}% of ${maxMb} MB limit).`);
        warningState.set(session.name, true);
      } else if (pct < 70) {
        warningState.delete(session.name);
      }
    }
  }, 30_000);
}

export function stopWatchdog() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  warningState.clear();
}
