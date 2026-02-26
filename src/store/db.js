import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = `${__dirname}/../../data`;
const AGENTS_FILE = `${DATA_DIR}/agents.json`;
const TASKS_FILE = `${DATA_DIR}/tasks.json`;
const PIPELINES_FILE = `${DATA_DIR}/pipelines.json`;
const SCHEDULES_FILE = `${DATA_DIR}/schedules.json`;
const SETTINGS_FILE = `${DATA_DIR}/settings.json`;

const DEFAULT_SETTINGS = {
  defaultModel: 'claude-sonnet-4-6',
  defaultWorkdir: '',
  maxConcurrent: 5,
};

const writeLocks = new Map();
const fileCache = new Map();

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getCacheMtime(filePath) {
  const cached = fileCache.get(filePath);
  if (!cached) return null;
  return cached.mtime;
}

function loadFile(filePath, defaultValue = []) {
  ensureDataDir();
  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
    fileCache.set(filePath, { data: defaultValue, mtime: Date.now() });
    return JSON.parse(JSON.stringify(defaultValue));
  }

  try {
    const stat = statSync(filePath);
    const mtime = stat.mtimeMs;
    const cached = fileCache.get(filePath);

    if (cached && cached.mtime === mtime) {
      return JSON.parse(JSON.stringify(cached.data));
    }

    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    fileCache.set(filePath, { data, mtime });
    return JSON.parse(JSON.stringify(data));
  } catch {
    return JSON.parse(JSON.stringify(defaultValue));
  }
}

function saveFile(filePath, data) {
  ensureDataDir();
  const prev = writeLocks.get(filePath) || Promise.resolve();
  const next = prev.then(() => {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    const stat = statSync(filePath);
    fileCache.set(filePath, { data: JSON.parse(JSON.stringify(data)), mtime: stat.mtimeMs });
  }).catch(() => {});
  writeLocks.set(filePath, next);
  return next;
}

function createStore(filePath) {
  return {
    load: () => loadFile(filePath),

    save: (data) => saveFile(filePath, data),

    getAll: () => loadFile(filePath),

    getById: (id) => {
      const items = loadFile(filePath);
      return items.find((item) => item.id === id) || null;
    },

    create: (data) => {
      const items = loadFile(filePath);
      const newItem = {
        id: uuidv4(),
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      items.push(newItem);
      saveFile(filePath, items);
      return newItem;
    },

    update: (id, data) => {
      const items = loadFile(filePath);
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      items[index] = {
        ...items[index],
        ...data,
        id,
        updated_at: new Date().toISOString(),
      };
      saveFile(filePath, items);
      return items[index];
    },

    delete: (id) => {
      const items = loadFile(filePath);
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return false;
      items.splice(index, 1);
      saveFile(filePath, items);
      return true;
    },
  };
}

function createSettingsStore(filePath) {
  return {
    get: () => loadFile(filePath, DEFAULT_SETTINGS),

    save: (data) => {
      const current = loadFile(filePath, DEFAULT_SETTINGS);
      const merged = { ...current, ...data };
      saveFile(filePath, merged);
      return merged;
    },
  };
}

export const agentsStore = createStore(AGENTS_FILE);
export const tasksStore = createStore(TASKS_FILE);
export const pipelinesStore = createStore(PIPELINES_FILE);
export const schedulesStore = createStore(SCHEDULES_FILE);
export const settingsStore = createSettingsStore(SETTINGS_FILE);
