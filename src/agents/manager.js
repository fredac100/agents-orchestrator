import { v4 as uuidv4 } from 'uuid';
import cron from 'node-cron';
import { agentsStore, schedulesStore, executionsStore, notificationsStore, secretsStore, agentVersionsStore, withLock } from '../store/db.js';
import * as executor from './executor.js';
import * as scheduler from './scheduler.js';
import { generateAgentReport } from '../reports/generator.js';

const DEFAULT_CONFIG = {
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  workingDirectory: '',
  maxTurns: 0,
  permissionMode: 'bypassPermissions',
  allowedTools: '',
};

const MAX_RECENT = 200;
const recentExecBuffer = [];

let globalBroadcast = null;

export function setGlobalBroadcast(fn) {
  globalBroadcast = fn;
}

function getWsCallback(wsCallback) {
  return wsCallback || globalBroadcast || null;
}

function createNotification(type, title, message, metadata = {}) {
  notificationsStore.create({
    type, title, message, metadata,
    read: false,
    createdAt: new Date().toISOString(),
  });
}

let dailyExecutionCount = 0;
let dailyCountDate = new Date().toDateString();

function incrementDailyCount() {
  const today = new Date().toDateString();
  if (today !== dailyCountDate) {
    dailyExecutionCount = 0;
    dailyCountDate = today;
  }
  dailyExecutionCount++;
}

export function getDailyExecutionCount() {
  const today = new Date().toDateString();
  if (today !== dailyCountDate) {
    dailyExecutionCount = 0;
    dailyCountDate = today;
  }
  return dailyExecutionCount;
}

function validateAgent(data) {
  const errors = [];
  if (!data.agent_name || typeof data.agent_name !== 'string') {
    errors.push('agent_name é obrigatório e deve ser uma string');
  }
  if (data.config?.model && typeof data.config.model !== 'string') {
    errors.push('config.model deve ser uma string');
  }
  return errors;
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t) => typeof t === 'string' && t.length > 0 && t.length <= 50)
    .slice(0, 20);
}

export function getAllAgents() {
  return agentsStore.getAll();
}

export function getAgentById(id) {
  return agentsStore.getById(id);
}

export function createAgent(data) {
  const errors = validateAgent(data);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return agentsStore.create({
    agent_name: data.agent_name,
    description: data.description || '',
    tags: sanitizeTags(data.tags),
    tasks: data.tasks || [],
    config: { ...DEFAULT_CONFIG, ...(data.config || {}) },
    status: data.status || 'active',
    assigned_host: data.assigned_host || 'localhost',
    executions: [],
  });
}

export function updateAgent(id, data) {
  const existing = agentsStore.getById(id);
  if (!existing) return null;

  agentVersionsStore.create({
    agentId: id,
    version: existing,
    changedFields: Object.keys(data).filter(k => k !== 'id'),
  });

  const updateData = {};
  if (data.agent_name !== undefined) updateData.agent_name = data.agent_name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.tags !== undefined) updateData.tags = sanitizeTags(data.tags);
  if (data.tasks !== undefined) updateData.tasks = data.tasks;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.assigned_host !== undefined) updateData.assigned_host = data.assigned_host;
  if (data.config !== undefined) updateData.config = { ...existing.config, ...data.config };
  return agentsStore.update(id, updateData);
}

export function deleteAgent(id) {
  return agentsStore.delete(id);
}

function loadAgentSecrets(agentId) {
  const all = secretsStore.getAll();
  const agentSecrets = all.filter(s => s.agentId === agentId);
  if (agentSecrets.length === 0) return null;
  const env = {};
  for (const s of agentSecrets) env[s.name] = s.value;
  return env;
}

export function executeTask(agentId, task, instructions, wsCallback, metadata = {}) {
  const agent = agentsStore.getById(agentId);
  if (!agent) throw new Error(`Agente ${agentId} não encontrado`);
  if (agent.status !== 'active') throw new Error(`Agente ${agentId} está inativo`);

  const retryEnabled = agent.config?.retryOnFailure === true;
  const maxRetries = Math.min(Math.max(parseInt(agent.config?.maxRetries) || 1, 1), 3);
  const attempt = metadata._retryAttempt || 1;

  const cb = getWsCallback(wsCallback);
  const taskText = typeof task === 'string' ? task : task.description;
  const startedAt = new Date().toISOString();

  const historyRecord = metadata._historyRecordId
    ? { id: metadata._historyRecordId }
    : executionsStore.create({
        type: 'agent',
        ...metadata,
        agentId,
        agentName: agent.agent_name,
        task: taskText,
        instructions: instructions || '',
        status: 'running',
        startedAt,
      });

  if (metadata._retryAttempt) {
    executionsStore.update(historyRecord.id, { status: 'running', error: null });
  }

  const execRecord = {
    executionId: null,
    agentId,
    agentName: agent.agent_name,
    task: taskText,
    startedAt,
    status: 'running',
  };

  const agentSecrets = loadAgentSecrets(agentId);

  const executionId = executor.execute(
    agent.config,
    { description: task, instructions },
    {
      onData: (parsed, execId) => {
        if (cb) cb({ type: 'execution_output', executionId: execId, agentId, data: parsed });
      },
      onError: (err, execId) => {
        const endedAt = new Date().toISOString();
        updateExecutionRecord(agentId, execId, { status: 'error', error: err.message, endedAt });

        if (retryEnabled && attempt < maxRetries) {
          const delayMs = attempt * 5000;
          executionsStore.update(historyRecord.id, { status: 'retrying', error: err.message, attempt, endedAt });
          if (cb) cb({
            type: 'execution_retry',
            executionId: execId,
            agentId,
            data: { attempt, maxRetries, nextRetryIn: delayMs / 1000, reason: err.message },
          });
          setTimeout(() => {
            try {
              executeTask(agentId, task, instructions, wsCallback, {
                ...metadata,
                _retryAttempt: attempt + 1,
                _historyRecordId: historyRecord.id,
              });
            } catch (retryErr) {
              executionsStore.update(historyRecord.id, { status: 'error', error: retryErr.message, endedAt: new Date().toISOString() });
              if (cb) cb({ type: 'execution_error', executionId: execId, agentId, data: { error: retryErr.message } });
            }
          }, delayMs);
          return;
        }

        executionsStore.update(historyRecord.id, { status: 'error', error: err.message, endedAt });
        createNotification('error', 'Execução falhou', `Agente "${agent.agent_name}" encontrou um erro`, { agentId, executionId: execId });
        if (cb) cb({ type: 'execution_error', executionId: execId, agentId, data: { error: err.message } });
      },
      onComplete: (result, execId) => {
        const endedAt = new Date().toISOString();
        updateExecutionRecord(agentId, execId, { status: 'completed', result, endedAt });
        executionsStore.update(historyRecord.id, {
          status: 'completed',
          result: result.result || '',
          exitCode: result.exitCode,
          endedAt,
          costUsd: result.costUsd || 0,
          totalCostUsd: result.totalCostUsd || 0,
          durationMs: result.durationMs || 0,
          numTurns: result.numTurns || 0,
          sessionId: result.sessionId || '',
        });
        createNotification('success', 'Execução concluída', `Agente "${agent.agent_name}" finalizou a tarefa`, { agentId, executionId: execId });
        try {
          const updated = executionsStore.getById(historyRecord.id);
          if (updated) {
            const report = generateAgentReport(updated);
            if (cb) cb({ type: 'report_generated', executionId: execId, agentId, reportFile: report.filename });
          }
        } catch (e) { console.error('[manager] Erro ao gerar relatório:', e.message); }
        if (cb) cb({ type: 'execution_complete', executionId: execId, agentId, data: result });
      },
    },
    agentSecrets
  );

  if (!executionId) {
    executionsStore.update(historyRecord.id, { status: 'error', error: 'Limite de execuções simultâneas atingido', endedAt: new Date().toISOString() });
    throw new Error('Limite de execuções simultâneas atingido');
  }

  execRecord.executionId = executionId;
  executionsStore.update(historyRecord.id, { executionId });
  incrementDailyCount();

  const updatedAgent = agentsStore.getById(agentId);
  const executions = [...(updatedAgent.executions || []), execRecord];
  agentsStore.update(agentId, { executions: executions.slice(-100) });

  recentExecBuffer.unshift({ ...execRecord });
  if (recentExecBuffer.length > MAX_RECENT) recentExecBuffer.length = MAX_RECENT;

  return executionId;
}

async function updateExecutionRecord(agentId, executionId, updates) {
  await withLock(`agent:${agentId}`, () => {
    const agent = agentsStore.getById(agentId);
    if (!agent) return;
    const executions = (agent.executions || []).map((exec) =>
      exec.executionId === executionId ? { ...exec, ...updates } : exec
    );
    agentsStore.update(agentId, { executions });
  });
}

export function getRecentExecutions(limit = 20) {
  return recentExecBuffer.slice(0, Math.min(limit, MAX_RECENT));
}

export function scheduleTask(agentId, taskDescription, cronExpression, wsCallback) {
  const agent = agentsStore.getById(agentId);
  if (!agent) throw new Error(`Agente ${agentId} não encontrado`);

  if (!cron.validate(cronExpression)) {
    throw new Error(`Expressão cron inválida: ${cronExpression}`);
  }

  const scheduleId = uuidv4();
  const items = schedulesStore.getAll();
  items.push({
    id: scheduleId,
    agentId,
    agentName: agent.agent_name,
    taskDescription,
    cronExpression,
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  schedulesStore.save(items);

  scheduler.schedule(scheduleId, cronExpression, () => {
    executeTask(agentId, taskDescription, null, null, { source: 'schedule', scheduleId });
  }, false);

  return { scheduleId, agentId, agentName: agent.agent_name, taskDescription, cronExpression };
}

export function updateScheduleTask(scheduleId, data, wsCallback) {
  const stored = schedulesStore.getById(scheduleId);
  if (!stored) return null;

  const agentId = data.agentId || stored.agentId;
  const agent = agentsStore.getById(agentId);
  if (!agent) throw new Error(`Agente ${agentId} não encontrado`);

  const taskDescription = data.taskDescription || stored.taskDescription;
  const cronExpression = data.cronExpression || stored.cronExpression;

  scheduler.updateSchedule(scheduleId, cronExpression, () => {
    executeTask(agentId, taskDescription, null, null, { source: 'schedule', scheduleId });
  });

  schedulesStore.update(scheduleId, { agentId, agentName: agent.agent_name, taskDescription, cronExpression });
  return schedulesStore.getById(scheduleId);
}

export function continueConversation(agentId, sessionId, message, wsCallback) {
  const agent = agentsStore.getById(agentId);
  if (!agent) throw new Error(`Agente ${agentId} não encontrado`);

  const cb = getWsCallback(wsCallback);
  const startedAt = new Date().toISOString();

  const historyRecord = executionsStore.create({
    type: 'agent',
    agentId,
    agentName: agent.agent_name,
    task: message,
    status: 'running',
    startedAt,
    parentSessionId: sessionId,
  });

  const executionId = executor.resume(
    agent.config,
    sessionId,
    message,
    {
      onData: (parsed, execId) => {
        if (cb) cb({ type: 'execution_output', executionId: execId, agentId, data: parsed });
      },
      onError: (err, execId) => {
        const endedAt = new Date().toISOString();
        executionsStore.update(historyRecord.id, { status: 'error', error: err.message, endedAt });
        if (cb) cb({ type: 'execution_error', executionId: execId, agentId, data: { error: err.message } });
      },
      onComplete: (result, execId) => {
        const endedAt = new Date().toISOString();
        executionsStore.update(historyRecord.id, {
          status: 'completed',
          result: result.result || '',
          exitCode: result.exitCode,
          endedAt,
          costUsd: result.costUsd || 0,
          totalCostUsd: result.totalCostUsd || 0,
          durationMs: result.durationMs || 0,
          numTurns: result.numTurns || 0,
          sessionId: result.sessionId || sessionId,
        });
        try {
          const updated = executionsStore.getById(historyRecord.id);
          if (updated) {
            const report = generateAgentReport(updated);
            if (cb) cb({ type: 'report_generated', executionId: execId, agentId, reportFile: report.filename });
          }
        } catch (e) { console.error('[manager] Erro ao gerar relatório:', e.message); }
        if (cb) cb({ type: 'execution_complete', executionId: execId, agentId, data: result });
      },
    }
  );

  if (!executionId) {
    executionsStore.update(historyRecord.id, { status: 'error', error: 'Limite de execuções simultâneas atingido', endedAt: new Date().toISOString() });
    throw new Error('Limite de execuções simultâneas atingido');
  }

  executionsStore.update(historyRecord.id, { executionId });
  incrementDailyCount();
  return executionId;
}

export function cancelExecution(executionId) {
  return executor.cancel(executionId);
}

export function getActiveExecutions() {
  return executor.getActiveExecutions();
}

export function exportAgent(agentId) {
  const agent = agentsStore.getById(agentId);
  if (!agent) return null;
  return {
    agent_name: agent.agent_name,
    description: agent.description,
    tags: agent.tags || [],
    tasks: agent.tasks,
    config: agent.config,
    status: agent.status,
    assigned_host: agent.assigned_host,
  };
}

export function importAgent(data) {
  if (!data.agent_name) throw new Error('agent_name é obrigatório para importação');
  return agentsStore.create({
    agent_name: data.agent_name,
    description: data.description || '',
    tags: sanitizeTags(data.tags),
    tasks: data.tasks || [],
    config: { ...DEFAULT_CONFIG, ...(data.config || {}) },
    status: data.status || 'active',
    assigned_host: data.assigned_host || 'localhost',
    executions: [],
  });
}

export function restoreSchedules() {
  scheduler.restoreSchedules((agentId, taskDescription, scheduleId) => {
    try {
      executeTask(agentId, taskDescription, null, null, { source: 'schedule', scheduleId });
    } catch (err) {
      console.log(`[manager] Erro ao executar tarefa agendada: ${err.message}`);
    }
  });
}
