import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export class ContainerManager {
  constructor(opts = {}) {
    this.image = opts.image || 'vps-agents-orchestrator';
    this.network = opts.network || 'vps_vps-net';
    this.idleTimeoutMin = opts.idleTimeoutMin || 60;
    this.sharedBinds = opts.sharedBinds || [];
    this.workerEnv = opts.workerEnv || [];
    this.cache = new Map();
    this.locks = new Map();
    this._cleanupTimer = null;
  }

  activeCount() {
    return this.cache.size;
  }

  _containerName(userId) {
    return `orch-${userId.substring(0, 8)}`;
  }

  async ensure(userId) {
    const cached = this.cache.get(userId);
    if (cached) {
      cached.lastActivity = Date.now();
      return cached.host;
    }

    while (this.locks.has(userId)) {
      await this.locks.get(userId);
    }

    if (this.cache.has(userId)) {
      this.cache.get(userId).lastActivity = Date.now();
      return this.cache.get(userId).host;
    }

    let resolve;
    this.locks.set(userId, new Promise(r => { resolve = r; }));

    try {
      const host = await this._ensureContainer(userId);
      this.cache.set(userId, { host, lastActivity: Date.now() });
      return host;
    } finally {
      this.locks.delete(userId);
      resolve();
    }
  }

  async _ensureContainer(userId) {
    const name = this._containerName(userId);

    try {
      const container = docker.getContainer(name);
      const info = await container.inspect();

      if (!info.State.Running) {
        console.log(`[containers] Iniciando container ${name}...`);
        await container.start();
        await this._waitForReady(name);
      }

      return name;
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    console.log(`[containers] Criando container ${name} para usuário ${userId.substring(0, 8)}...`);

    const binds = [
      `orch-data-${userId.substring(0, 8)}:/app/data`,
      ...this.sharedBinds,
    ];

    await docker.createContainer({
      Image: this.image,
      name,
      Env: [
        'MODE=worker',
        'HOST=0.0.0.0',
        'PORT=3000',
        `USER_ID=${userId}`,
        ...this.workerEnv,
      ],
      HostConfig: {
        Binds: binds,
        NetworkMode: this.network,
        RestartPolicy: { Name: 'unless-stopped' },
      },
      Labels: {
        'orchestrator.role': 'worker',
        'orchestrator.userId': userId,
      },
    });

    const container = docker.getContainer(name);
    await container.start();
    await this._waitForReady(name);

    console.log(`[containers] Container ${name} pronto.`);
    return name;
  }

  async _waitForReady(name, maxRetries = 30, interval = 500) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(`http://${name}:3000/api/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Container ${name} não ficou pronto em ${(maxRetries * interval) / 1000}s`);
  }

  startIdleCleanup() {
    this._cleanupTimer = setInterval(() => this._stopIdle(), 5 * 60 * 1000);
  }

  async _stopIdle() {
    const maxIdleMs = this.idleTimeoutMin * 60 * 1000;
    const now = Date.now();

    for (const [userId, info] of this.cache) {
      if (now - info.lastActivity > maxIdleMs) {
        const name = this._containerName(userId);
        try {
          console.log(`[containers] Parando container idle: ${name}`);
          const container = docker.getContainer(name);
          await container.stop({ t: 10 });
        } catch (err) {
          console.error(`[containers] Erro ao parar ${name}:`, err.message);
        }
        this.cache.delete(userId);
      }
    }
  }

  async stopAll() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);

    const promises = [];
    for (const [userId] of this.cache) {
      const name = this._containerName(userId);
      promises.push(
        docker.getContainer(name).stop({ t: 5 }).catch(() => {})
      );
    }
    await Promise.all(promises);
    this.cache.clear();
  }

  async listWorkers() {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: ['orchestrator.role=worker'] },
    });
    return containers.map(c => ({
      name: c.Names[0]?.replace('/', ''),
      state: c.State,
      status: c.Status,
      userId: c.Labels['orchestrator.userId'],
    }));
  }
}
