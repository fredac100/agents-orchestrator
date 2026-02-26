import cron from 'node-cron';
import { EventEmitter } from 'events';
import { schedulesStore } from '../store/db.js';

const HISTORY_LIMIT = 50;
const schedules = new Map();
const history = [];
const emitter = new EventEmitter();

const cronDateCache = new Map();
const CRON_CACHE_TTL = 60_000;

function addToHistory(entry) {
  history.unshift(entry);
  if (history.length > HISTORY_LIMIT) history.splice(HISTORY_LIMIT);
}

function matchesCronPart(part, value) {
  if (part === '*') return true;
  if (part.startsWith('*/')) return value % parseInt(part.slice(2)) === 0;
  if (part.includes(',')) return part.split(',').map(Number).includes(value);
  if (part.includes('-')) {
    const [start, end] = part.split('-').map(Number);
    return value >= start && value <= end;
  }
  return parseInt(part) === value;
}

function computeNextCronDate(cronExpr) {
  const parts = cronExpr.split(' ');
  if (parts.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const candidate = new Date();
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < 525600; i++) {
    if (
      matchesCronPart(minute, candidate.getMinutes()) &&
      matchesCronPart(hour, candidate.getHours()) &&
      matchesCronPart(dayOfMonth, candidate.getDate()) &&
      matchesCronPart(month, candidate.getMonth() + 1) &&
      matchesCronPart(dayOfWeek, candidate.getDay())
    ) {
      return candidate.toISOString();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

function nextCronDate(cronExpr) {
  const now = Date.now();
  const cached = cronDateCache.get(cronExpr);
  if (cached && now - cached.at < CRON_CACHE_TTL) return cached.val;
  const val = computeNextCronDate(cronExpr);
  cronDateCache.set(cronExpr, { val, at: now });
  return val;
}

export function schedule(taskId, cronExpr, callback, persist = true) {
  if (schedules.has(taskId)) unschedule(taskId, false);
  if (!cron.validate(cronExpr)) throw new Error(`Expressão cron inválida: ${cronExpr}`);

  const task = cron.schedule(
    cronExpr,
    () => {
      const firedAt = new Date().toISOString();
      addToHistory({ taskId, cronExpr, firedAt });
      emitter.emit('scheduled-task', { taskId, firedAt });
      cronDateCache.delete(cronExpr);
      if (callback) callback({ taskId, firedAt });
    },
    { scheduled: true }
  );

  schedules.set(taskId, { taskId, cronExpr, task, active: true, createdAt: new Date().toISOString() });
  return { taskId, cronExpr };
}

export function unschedule(taskId, persist = true) {
  const entry = schedules.get(taskId);
  if (!entry) return false;
  entry.task.stop();
  schedules.delete(taskId);
  if (persist) schedulesStore.delete(taskId);
  return true;
}

export function updateSchedule(taskId, cronExpr, callback) {
  const entry = schedules.get(taskId);
  if (!entry) return false;
  entry.task.stop();
  schedules.delete(taskId);
  if (!cron.validate(cronExpr)) throw new Error(`Expressão cron inválida: ${cronExpr}`);
  schedule(taskId, cronExpr, callback, false);
  return true;
}

export function setActive(taskId, active) {
  const entry = schedules.get(taskId);
  if (!entry) return false;
  active ? entry.task.start() : entry.task.stop();
  entry.active = active;
  return true;
}

export function getSchedules() {
  const stored = schedulesStore.getAll();
  return stored.map((s) => {
    const inMemory = schedules.get(s.id);
    const cronExpr = s.cronExpression || s.cronExpr || '';
    return {
      ...s,
      cronExpr,
      active: inMemory ? inMemory.active : false,
      nextRun: nextCronDate(cronExpr),
    };
  });
}

export function getHistory() {
  return [...history];
}

export function restoreSchedules(executeFn) {
  const stored = schedulesStore.getAll();
  let restored = 0;

  for (const s of stored) {
    if (!s.active) continue;
    const cronExpr = s.cronExpression || s.cronExpr;
    try {
      schedule(s.id, cronExpr, () => executeFn(s.agentId, s.taskDescription, s.id), false);
      restored++;
    } catch (err) {
      console.log(`[scheduler] Falha ao restaurar ${s.id}: ${err.message}`);
    }
  }

  if (restored > 0) console.log(`[scheduler] ${restored} agendamento(s) restaurado(s)`);
}

export function on(event, listener) {
  emitter.on(event, listener);
}

export function off(event, listener) {
  emitter.off(event, listener);
}
