import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = `${__dirname}/../../data`;
const AGENTS_FILE = `${DATA_DIR}/agents.json`;
const TASKS_FILE = `${DATA_DIR}/tasks.json`;
const PIPELINES_FILE = `${DATA_DIR}/pipelines.json`;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFile(filePath) {
  ensureDataDir();
  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify([]), 'utf8');
    return [];
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

function saveFile(filePath, data) {
  ensureDataDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
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

export const agentsStore = createStore(AGENTS_FILE);
export const tasksStore = createStore(TASKS_FILE);
export const pipelinesStore = createStore(PIPELINES_FILE);
