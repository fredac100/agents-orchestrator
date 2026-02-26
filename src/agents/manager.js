import { v4 as uuidv4 } from 'uuid';
import { agentsStore, schedulesStore, executionsStore } from '../store/db.js';
import * as executor from './executor.js';
import * as scheduler from './scheduler.js';

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

export function executeTask(agentId, task, instructions, wsCallback) {
  const agent = agentsStore.getById(agentId);
  if (!agent) throw new Error(`Agente ${agentId} não encontrado`);
  if (agent.status !== 'active') throw new Error(`Agente ${agentId} está inativo`);

  const cb = getWsCallback(wsCallback);
  const taskText = typeof task === 'string' ? task : task.description;
  const startedAt = new Date().toISOString();

  const historyRecord = executionsStore.create({
    type: 'agent',
    agentId,
    agentName: agent.agent_name,
    task: taskText,
    instructions: instructions || '',
    status: 'running',
    startedAt,
  });

  const execRecord = {
    executionId: null,
    agentId,
    agentName: agent.agent_name,
    task: taskText,
    startedAt,
    status: 'running',
  };

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
        executionsStore.update(historyRecord.id, { status: 'error', error: err.message, endedAt });
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
        });
        if (cb) cb({ type: 'execution_complete', executionId: execId, agentId, data: result });
      },
    }
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

function updateRecentBuffer(executionId, updates) {
  const entry = recentExecBuffer.find((e) => e.executionId === executionId);
  if (entry) Object.assign(entry, updates);
}

function updateExecutionRecord(agentId, executionId, updates) {
  const agent = agentsStore.getById(agentId);
  if (!agent) return;
  const executions = (agent.executions || []).map((exec) =>
    exec.executionId === executionId ? { ...exec, ...updates } : exec
  );
  agentsStore.update(agentId, { executions });
}

export function getRecentExecutions(limit = 20) {
  return recentExecBuffer.slice(0, Math.min(limit, MAX_RECENT));
}

export function scheduleTask(agentId, taskDescription, cronExpression, wsCallback) {
  const agent = agentsStore.getById(agentId);
  if (!agent) throw new Error(`Agente ${agentId} não encontrado`);

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
    executeTask(agentId, taskDescription, null, null);
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
    executeTask(agentId, taskDescription, null, null);
  });

  schedulesStore.update(scheduleId, { agentId, agentName: agent.agent_name, taskDescription, cronExpression });
  return schedulesStore.getById(scheduleId);
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
  scheduler.restoreSchedules((agentId, taskDescription) => {
    try {
      executeTask(agentId, taskDescription, null, null);
    } catch (err) {
      console.log(`[manager] Erro ao executar tarefa agendada: ${err.message}`);
    }
  });
}
