import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const baseDir = resolveBaseDir(process.env.SESSION_BASE_DIR || '~/remote-coding/session');

function resolveBaseDir(dir) {
  if (dir.startsWith('~')) {
    return resolve(join(homedir(), dir.slice(1)));
  }
  return resolve(dir);
}

export function ensureBaseDir() {
  mkdirSync(baseDir, { recursive: true });
}

export function cloneRepo(url) {
  // Extract repo name from URL (handles .git suffix and trailing slashes)
  const name = url
    .replace(/\/+$/, '')
    .split('/')
    .pop()
    .replace(/\.git$/, '');

  const repoPath = join(baseDir, name);

  if (existsSync(repoPath)) {
    throw new Error(`Directory "${name}" already exists in ${baseDir}`);
  }

  execFileSync('git', ['clone', url, repoPath], { encoding: 'utf-8', timeout: 120_000 });

  // npm install if package.json exists
  const pkgPath = join(repoPath, 'package.json');
  if (existsSync(pkgPath)) {
    execFileSync('npm', ['install'], { cwd: repoPath, encoding: 'utf-8', timeout: 120_000 });
  }

  return { name, path: repoPath };
}

export function listRepos() {
  if (!existsSync(baseDir)) return [];

  return readdirSync(baseDir)
    .filter((entry) => {
      const fullPath = join(baseDir, entry);
      try {
        return statSync(fullPath).isDirectory() && existsSync(join(fullPath, '.git'));
      } catch {
        return false;
      }
    })
    .map((name) => ({ name, path: join(baseDir, name) }));
}

export function pullRepo(name) {
  const repoPath = getRepoPath(name);
  if (!repoPath) {
    throw new Error(`Repo "${name}" not found in ${baseDir}`);
  }

  execFileSync('git', ['pull'], { cwd: repoPath, encoding: 'utf-8', timeout: 60_000 });
  return { name, path: repoPath };
}

export function getRepoPath(name) {
  const repoPath = join(baseDir, name);
  if (!existsSync(repoPath) || !existsSync(join(repoPath, '.git'))) {
    return null;
  }
  return repoPath;
}

export function getBaseDir() {
  return baseDir;
}
