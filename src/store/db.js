import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { writeFile, rename } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = `${__dirname}/../../data`;

const DEFAULT_SETTINGS = {
  defaultModel: 'claude-sonnet-4-6',
  defaultWorkdir: '',
  maxConcurrent: 5,
};

const DEBOUNCE_MS = 300;
const allStores = [];

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensureDir();
  const tmpPath = path + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmpPath, path);
}

async function writeJsonAsync(path, data) {
  ensureDir();
  const tmpPath = path + '.tmp';
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmpPath, path);
}

function clone(v) {
  return structuredClone(v);
}

function createStore(filePath) {
  let mem = null;
  let dirty = false;
  let timer = null;
  let maxSize = Infinity;

  function boot() {
    if (mem !== null) return;
    ensureDir();
    mem = readJson(filePath, []);
  }

  function touch() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (dirty) {
        writeJsonAsync(filePath, mem).catch((e) => console.error(`[db] Erro ao salvar ${filePath}:`, e.message));
        dirty = false;
      }
    }, DEBOUNCE_MS);
  }

  const store = {
    getAll() {
      boot();
      return clone(mem);
    },

    getById(id) {
      boot();
      const item = mem.find((i) => i.id === id);
      return item ? clone(item) : null;
    },

    findById(id) {
      return store.getById(id);
    },

    count() {
      boot();
      return mem.length;
    },

    filter(predicate) {
      boot();
      return mem.filter(predicate).map((item) => clone(item));
    },

    create(data) {
      boot();
      const item = {
        id: uuidv4(),
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mem.push(item);
      if (maxSize !== Infinity && mem.length > maxSize) {
        mem.splice(0, mem.length - maxSize);
      }
      touch();
      return clone(item);
    },

    update(id, data) {
      boot();
      const i = mem.findIndex((x) => x.id === id);
      if (i === -1) return null;
      mem[i] = { ...mem[i], ...data, id, updated_at: new Date().toISOString() };
      touch();
      return clone(mem[i]);
    },

    delete(id) {
      boot();
      const i = mem.findIndex((x) => x.id === id);
      if (i === -1) return false;
      mem.splice(i, 1);
      touch();
      return true;
    },

    save(items) {
      if (!Array.isArray(items)) return;
      mem = items;
      touch();
    },

    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (mem !== null && dirty) {
        writeJson(filePath, mem);
        dirty = false;
      }
    },

    setMaxSize(n) {
      maxSize = n;
    },
  };

  allStores.push(store);
  return store;
}

function createSettingsStore(filePath) {
  let mem = null;
  let dirty = false;
  let timer = null;

  function boot() {
    if (mem !== null) return;
    ensureDir();
    mem = { ...DEFAULT_SETTINGS, ...readJson(filePath, DEFAULT_SETTINGS) };
  }

  function touch() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (dirty) {
        writeJson(filePath, mem);
        dirty = false;
      }
    }, DEBOUNCE_MS);
  }

  const store = {
    get() {
      boot();
      return clone(mem);
    },

    save(data) {
      boot();
      mem = { ...mem, ...data };
      touch();
      return clone(mem);
    },

    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (mem !== null && dirty) {
        writeJson(filePath, mem);
        dirty = false;
      }
    },
  };

  allStores.push(store);
  return store;
}

const locks = new Map();

export async function withLock(key, fn) {
  while (locks.has(key)) await locks.get(key);
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  locks.set(key, promise);
  try {
    return await fn();
  } finally {
    locks.delete(key);
    resolve();
  }
}

export function flushAllStores() {
  for (const s of allStores) s.flush();
}

export const agentsStore = createStore(`${DATA_DIR}/agents.json`);
export const tasksStore = createStore(`${DATA_DIR}/tasks.json`);
export const pipelinesStore = createStore(`${DATA_DIR}/pipelines.json`);
export const schedulesStore = createStore(`${DATA_DIR}/schedules.json`);
export const executionsStore = createStore(`${DATA_DIR}/executions.json`);
executionsStore.setMaxSize(5000);
export const webhooksStore = createStore(`${DATA_DIR}/webhooks.json`);
export const settingsStore = createSettingsStore(`${DATA_DIR}/settings.json`);
export const secretsStore = createStore(`${DATA_DIR}/secrets.json`);
export const notificationsStore = createStore(`${DATA_DIR}/notifications.json`);
notificationsStore.setMaxSize(200);
export const agentVersionsStore = createStore(`${DATA_DIR}/agent_versions.json`);
let _usersImpl = createStore(`${DATA_DIR}/users.json`);

export const usersStore = {
  getAll: (...a) => _usersImpl.getAll(...a),
  getById: (...a) => _usersImpl.getById(...a),
  findById: (...a) => _usersImpl.findById(...a),
  count: (...a) => _usersImpl.count(...a),
  filter: (...a) => _usersImpl.filter(...a),
  create: (...a) => _usersImpl.create(...a),
  update: (...a) => _usersImpl.update(...a),
  delete: (...a) => _usersImpl.delete(...a),
  save: (...a) => _usersImpl.save(...a),
  flush: (...a) => _usersImpl.flush(...a),
  setMaxSize: (...a) => _usersImpl.setMaxSize?.(...a),
};

export async function initOracleUsers(config) {
  const { createOracleUsersStore } = await import('./oracle-users.js');
  _usersImpl = await createOracleUsersStore(config);
}
