let intervalId = null;
let warningNotified = false;

export function startWatchdog({ getMemoryUsage, isRunning, restartFn, notifyFn, maxMb }) {
  stopWatchdog();

  intervalId = setInterval(async () => {
    if (!isRunning()) {
      warningNotified = false;
      return;
    }

    const memMb = getMemoryUsage();
    if (memMb === null) return;

    const pct = (memMb / maxMb) * 100;

    if (memMb >= maxMb) {
      await notifyFn(`⚠️ Claude memory at ${memMb} MB (${Math.round(pct)}% of ${maxMb} MB limit). Restarting...`);
      await restartFn();
      warningNotified = false;
    } else if (pct >= 80 && !warningNotified) {
      await notifyFn(`⚠️ Claude memory at ${memMb} MB (${Math.round(pct)}% of ${maxMb} MB limit).`);
      warningNotified = true;
    } else if (pct < 70) {
      warningNotified = false;
    }
  }, 30_000);
}

export function stopWatchdog() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  warningNotified = false;
}
