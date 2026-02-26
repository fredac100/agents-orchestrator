import { v4 as uuidv4 } from 'uuid';
import { agentsStore, schedulesStore } from '../store/db.js';
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
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  const agentData = {
    agent_name: data.agent_name,
    description: data.description || '',
    tags: sanitizeTags(data.tags),
    tasks: data.tasks || [],
    config: { ...DEFAULT_CONFIG, ...(data.config || {}) },
    status: data.status || 'active',
    assigned_host: data.assigned_host || 'localhost',
    executions: [],
  };

  return agentsStore.create(agentData);
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
  if (data.config !== undefined) {
    updateData.config = { ...existing.config, ...data.config };
  }

  return agentsStore.update(id, updateData);
}

export function deleteAgent(id) {
  return agentsStore.delete(id);
}

export function executeTask(agentId, task, instructions, wsCallback) {
  const agent = agentsStore.getById(agentId);
  if (!agent) throw new Error(`Agente ${agentId} não encontrado`);
  if (agent.status !== 'active') throw new Error(`Agente ${agentId} está inativo`);

  const executionRecord = {
    executionId: null,
    agentId,
    agentName: agent.agent_name,
    task: typeof task === 'string' ? task : task.description,
    startedAt: new Date().toISOString(),
    status: 'running',
  };

  const executionId = executor.execute(
    agent.config,
    { description: task, instructions },
    {
      onData: (parsed, execId) => {
        if (wsCallback) {
          wsCallback({
            type: 'execution_output',
            executionId: execId,
            agentId,
            data: parsed,
          });
        }
      },
      onError: (err, execId) => {
        updateAgentExecution(agentId, execId, { status: 'error', error: err.message, endedAt: new Date().toISOString() });
        if (wsCallback) {
          wsCallback({
            type: 'execution_error',
            executionId: execId,
            agentId,
            data: { error: err.message },
          });
        }
      },
      onComplete: (result, execId) => {
        updateAgentExecution(agentId, execId, { status: 'completed', result, endedAt: new Date().toISOString() });
        if (wsCallback) {
          wsCallback({
            type: 'execution_complete',
            executionId: execId,
            agentId,
            data: result,
          });
        }
      },
    }
  );

  if (!executionId) {
    throw new Error('Limite de execuções simultâneas atingido');
  }

  executionRecord.executionId = executionId;
  incrementDailyCount();

  const updatedAgent = agentsStore.getById(agentId);
  const executions = [...(updatedAgent.executions || []), executionRecord];
  agentsStore.update(agentId, { executions: executions.slice(-100) });

  return executionId;
}

function updateAgentExecution(agentId, executionId, updates) {
  const agent = agentsStore.getById(agentId);
  if (!agent) return;

  const executions = (agent.executions || []).map((exec) => {
    if (exec.executionId === executionId) {
      return { ...exec, ...updates };
    }
    return exec;
  });

  agentsStore.update(agentId, { executions });
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
    executeTask(agentId, taskDescription, null, wsCallback);
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
    executeTask(agentId, taskDescription, null, wsCallback);
  });

  schedulesStore.update(scheduleId, {
    agentId,
    agentName: agent.agent_name,
    taskDescription,
    cronExpression,
  });

  return schedulesStore.getById(scheduleId);
}

export function cancelExecution(executionId) {
  return executor.cancel(executionId);
}

export function getActiveExecutions() {
  return executor.getActiveExecutions();
}

export function getRecentExecutions(limit = 20) {
  const agents = agentsStore.getAll();
  const all = agents.flatMap((a) =>
    (a.executions || []).map((e) => ({
      ...e,
      agentName: a.agent_name,
      agentId: a.id,
    }))
  );
  all.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return all.slice(0, limit);
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
  if (!data.agent_name) {
    throw new Error('agent_name é obrigatório para importação');
  }

  const agentData = {
    agent_name: data.agent_name,
    description: data.description || '',
    tags: sanitizeTags(data.tags),
    tasks: data.tasks || [],
    config: { ...DEFAULT_CONFIG, ...(data.config || {}) },
    status: data.status || 'active',
    assigned_host: data.assigned_host || 'localhost',
    executions: [],
  };

  return agentsStore.create(agentData);
}

export function restoreSchedules(wsCallback) {
  scheduler.restoreSchedules((agentId, taskDescription) => {
    try {
      executeTask(agentId, taskDescription, null, wsCallback);
    } catch (err) {
      console.log(`[manager] Erro ao executar tarefa agendada: ${err.message}`);
    }
  });
}
