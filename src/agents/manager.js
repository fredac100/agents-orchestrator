import { v4 as uuidv4 } from 'uuid';
import { agentsStore } from '../store/db.js';
import * as executor from './executor.js';
import * as scheduler from './scheduler.js';

const DEFAULT_CONFIG = {
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  workingDirectory: '',
  maxTokens: 16000,
  temperature: 1,
};

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

  executionRecord.executionId = executionId;

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

  scheduler.schedule(scheduleId, cronExpression, () => {
    executeTask(agentId, taskDescription, null, wsCallback);
  });

  return { scheduleId, agentId, taskDescription, cronExpression };
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
    id: agent.id,
    agent_name: agent.agent_name,
    description: agent.description,
    tasks: agent.tasks,
    config: agent.config,
    status: agent.status,
    assigned_host: agent.assigned_host,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
    executions: agent.executions || [],
  };
}
