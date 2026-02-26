import cron from 'node-cron';
import { EventEmitter } from 'events';

const HISTORY_LIMIT = 50;
const schedules = new Map();
const history = [];
const emitter = new EventEmitter();

function addToHistory(entry) {
  history.unshift(entry);
  if (history.length > HISTORY_LIMIT) {
    history.splice(HISTORY_LIMIT);
  }
}

export function schedule(taskId, cronExpr, callback) {
  if (schedules.has(taskId)) {
    unschedule(taskId);
  }

  if (!cron.validate(cronExpr)) {
    throw new Error(`Expressão cron inválida: ${cronExpr}`);
  }

  const task = cron.schedule(
    cronExpr,
    () => {
      const firedAt = new Date().toISOString();
      addToHistory({ taskId, cronExpr, firedAt });
      emitter.emit('scheduled-task', { taskId, firedAt });
      if (callback) callback({ taskId, firedAt });
    },
    { scheduled: true }
  );

  schedules.set(taskId, {
    taskId,
    cronExpr,
    task,
    active: true,
    createdAt: new Date().toISOString(),
  });

  return { taskId, cronExpr };
}

export function unschedule(taskId) {
  const entry = schedules.get(taskId);
  if (!entry) return false;

  entry.task.stop();
  schedules.delete(taskId);
  return true;
}

export function setActive(taskId, active) {
  const entry = schedules.get(taskId);
  if (!entry) return false;

  if (active) {
    entry.task.start();
  } else {
    entry.task.stop();
  }

  entry.active = active;
  return true;
}

export function getSchedules() {
  return Array.from(schedules.values()).map(({ task: _, ...rest }) => rest);
}

export function getHistory() {
  return [...history];
}

export function on(event, listener) {
  emitter.on(event, listener);
}

export function off(event, listener) {
  emitter.off(event, listener);
}
