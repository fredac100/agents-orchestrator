import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, basename } from 'path';

const PROJECTS_DIR = '/home/projetos';
const GITEA_URL = () => process.env.GITEA_URL || 'http://gitea:3000';
const GITEA_USER = () => process.env.GITEA_USER || 'fred';
const GITEA_PASS = () => process.env.GITEA_PASS || '';
const DOMAIN = () => process.env.DOMAIN || 'nitro-cloud.duckdns.org';

function exec(cmd, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('sh', ['-c', cmd], {
      cwd,
      env: { ...process.env, HOME: '/tmp', GIT_TERMINAL_PROMPT: '0' },
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `exit ${code}`))
    );
  });
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${GITEA_USER()}:${GITEA_PASS()}`).toString('base64');
}

function repoCloneUrl(repoName) {
  return `${GITEA_URL().replace('://', `://${encodeURIComponent(GITEA_USER())}:${encodeURIComponent(GITEA_PASS())}@`)}/${GITEA_USER()}/${repoName}.git`;
}

export async function listRepos() {
  const url = `${GITEA_URL()}/api/v1/user/repos?limit=50&sort=updated`;
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error('Erro ao listar repositórios');
  const repos = await res.json();
  return repos.map(r => ({
    name: r.name,
    fullName: r.full_name,
    description: r.description || '',
    defaultBranch: r.default_branch || 'main',
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
    cloneUrl: r.clone_url,
    empty: r.empty,
  }));
}

export async function listBranches(repoName) {
  const url = `${GITEA_URL()}/api/v1/repos/${GITEA_USER()}/${repoName}/branches?limit=50`;
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!res.ok) return [];
  const branches = await res.json();
  return branches.map(b => b.name);
}

export async function cloneOrPull(repoName, branch) {
  const targetDir = join(PROJECTS_DIR, repoName);
  const cloneUrl = repoCloneUrl(repoName);

  if (existsSync(join(targetDir, '.git'))) {
    await exec(`git remote set-url origin "${cloneUrl}"`, targetDir);
    await exec('git fetch origin', targetDir);
    if (branch) {
      try {
        await exec(`git checkout ${branch}`, targetDir);
      } catch {
        await exec(`git checkout -b ${branch} origin/${branch}`, targetDir);
      }
      await exec(`git reset --hard origin/${branch}`, targetDir);
    } else {
      const currentBranch = await exec('git rev-parse --abbrev-ref HEAD', targetDir);
      await exec(`git reset --hard origin/${currentBranch}`, targetDir);
    }
    return { dir: targetDir, action: 'pull' };
  }

  const branchArg = branch ? `-b ${branch}` : '';
  await exec(`git clone ${branchArg} "${cloneUrl}" "${targetDir}"`);
  return { dir: targetDir, action: 'clone' };
}

export async function commitAndPush(repoDir, agentName, taskSummary) {
  try {
    const status = await exec('git status --porcelain', repoDir);
    if (!status) return { changed: false };

    await exec('git add -A', repoDir);

    const summary = taskSummary
      ? taskSummary.slice(0, 100).replace(/"/g, '\\"')
      : 'Alterações automáticas';

    const message = `${summary}\n\nExecutado por: ${agentName}`;
    await exec(
      `git -c user.name="Agents Orchestrator" -c user.email="agents@${DOMAIN()}" commit -m "${message}"`,
      repoDir
    );

    await exec('git push origin HEAD', repoDir);

    const commitHash = await exec('git rev-parse --short HEAD', repoDir);
    const branch = await exec('git rev-parse --abbrev-ref HEAD', repoDir);
    const repoName = basename(repoDir);
    const commitUrl = `https://git.${DOMAIN()}/${GITEA_USER()}/${repoName}/commit/${commitHash}`;

    return { changed: true, commitHash, branch, commitUrl, filesChanged: status.split('\n').length };
  } catch (err) {
    return { changed: false, error: err.message };
  }
}

export function getProjectDir(repoName) {
  return join(PROJECTS_DIR, repoName);
}
