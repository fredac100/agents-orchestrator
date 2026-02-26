import { v4 as uuidv4 } from 'uuid';
import { pipelinesStore, agentsStore, executionsStore } from '../store/db.js';
import * as executor from './executor.js';
import { mem } from '../cache/index.js';

const activePipelines = new Map();
const AGENT_MAP_TTL = 30_000;

function getAgentMap() {
  const hit = mem.get('agent:map');
  if (hit !== undefined) return hit;
  const agents = agentsStore.getAll();
  const map = new Map(agents.map((a) => [a.id, a.agent_name]));
  mem.set('agent:map', map, AGENT_MAP_TTL);
  return map;
}

export function invalidateAgentMapCache() {
  mem.del('agent:map');
}

function validatePipeline(data) {
  const errors = [];
  if (!data.name || typeof data.name !== 'string') {
    errors.push('name é obrigatório e deve ser uma string');
  }
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    errors.push('steps é obrigatório e deve ser um array não vazio');
  } else {
    data.steps.forEach((step, i) => {
      if (!step.agentId) errors.push(`steps[${i}].agentId é obrigatório`);
    });
  }
  return errors;
}

function buildSteps(steps) {
  return steps
    .map((step, index) => ({
      id: step.id || uuidv4(),
      agentId: step.agentId,
      order: step.order !== undefined ? step.order : index,
      inputTemplate: step.inputTemplate || null,
      description: step.description || '',
    }))
    .sort((a, b) => a.order - b.order);
}

function enrichStepsWithAgentNames(steps) {
  const agentMap = getAgentMap();
  return steps.map((s) => ({ ...s, agentName: agentMap.get(s.agentId) || s.agentId }));
}

function applyTemplate(template, input) {
  if (!template) return input;
  return template.replace(/\{\{input\}\}/g, input);
}

function executeStepAsPromise(agentConfig, prompt, pipelineState, wsCallback, pipelineId, stepIndex) {
  return new Promise((resolve, reject) => {
    const executionId = executor.execute(
      agentConfig,
      { description: prompt },
      {
        onData: (parsed, execId) => {
          if (wsCallback) {
            wsCallback({
              type: 'pipeline_step_output',
              pipelineId,
              stepIndex,
              executionId: execId,
              data: parsed,
            });
          }
        },
        onError: (err) => reject(err),
        onComplete: (result) => {
          if (result.exitCode !== 0 && !result.result) {
            reject(new Error(result.stderr || `Processo encerrado com código ${result.exitCode}`));
            return;
          }
          resolve(result.result || '');
        },
      }
    );

    if (!executionId) {
      reject(new Error('Limite de execuções simultâneas atingido'));
      return;
    }

    pipelineState.currentExecutionId = executionId;
  });
}

export async function executePipeline(pipelineId, initialInput, wsCallback) {
  const pl = pipelinesStore.getById(pipelineId);
  if (!pl) throw new Error(`Pipeline ${pipelineId} não encontrado`);

  const pipelineState = { currentExecutionId: null, currentStep: 0, canceled: false };
  activePipelines.set(pipelineId, pipelineState);

  const historyRecord = executionsStore.create({
    type: 'pipeline',
    pipelineId,
    pipelineName: pl.name,
    input: initialInput,
    status: 'running',
    startedAt: new Date().toISOString(),
    steps: [],
  });

  const steps = buildSteps(pl.steps);
  const results = [];
  let currentInput = initialInput;

  try {
    for (let i = 0; i < steps.length; i++) {
      if (pipelineState.canceled) break;

      const step = steps[i];
      pipelineState.currentStep = i;

      const agent = agentsStore.getById(step.agentId);
      if (!agent) throw new Error(`Agente ${step.agentId} não encontrado no passo ${i}`);
      if (agent.status !== 'active') throw new Error(`Agente ${agent.agent_name} está inativo`);

      const prompt = applyTemplate(step.inputTemplate, currentInput);
      const stepStart = new Date().toISOString();

      if (wsCallback) {
        wsCallback({
          type: 'pipeline_step_start',
          pipelineId,
          stepIndex: i,
          stepId: step.id,
          agentName: agent.agent_name,
          totalSteps: steps.length,
        });
      }

      const result = await executeStepAsPromise(agent.config, prompt, pipelineState, wsCallback, pipelineId, i);

      if (pipelineState.canceled) break;

      currentInput = result;
      results.push({ stepId: step.id, agentName: agent.agent_name, result });

      const current = executionsStore.getById(historyRecord.id);
      const savedSteps = current ? (current.steps || []) : [];
      savedSteps.push({
        stepIndex: i,
        agentId: step.agentId,
        agentName: agent.agent_name,
        prompt: prompt.slice(0, 5000),
        result,
        startedAt: stepStart,
        endedAt: new Date().toISOString(),
        status: 'completed',
      });
      executionsStore.update(historyRecord.id, { steps: savedSteps });

      if (wsCallback) {
        wsCallback({
          type: 'pipeline_step_complete',
          pipelineId,
          stepIndex: i,
          stepId: step.id,
          result: result.slice(0, 500),
        });
      }
    }

    activePipelines.delete(pipelineId);
    executionsStore.update(historyRecord.id, {
      status: pipelineState.canceled ? 'canceled' : 'completed',
      endedAt: new Date().toISOString(),
    });

    if (!pipelineState.canceled && wsCallback) {
      wsCallback({ type: 'pipeline_complete', pipelineId, results });
    }

    return results;
  } catch (err) {
    activePipelines.delete(pipelineId);
    executionsStore.update(historyRecord.id, {
      status: 'error',
      error: err.message,
      endedAt: new Date().toISOString(),
    });
    if (wsCallback) {
      wsCallback({
        type: 'pipeline_error',
        pipelineId,
        stepIndex: pipelineState.currentStep,
        error: err.message,
      });
    }
    throw err;
  }
}

export function cancelPipeline(pipelineId) {
  const state = activePipelines.get(pipelineId);
  if (!state) return false;
  state.canceled = true;
  if (state.currentExecutionId) executor.cancel(state.currentExecutionId);
  activePipelines.delete(pipelineId);
  return true;
}

export function getActivePipelines() {
  return Array.from(activePipelines.entries()).map(([id, state]) => ({
    pipelineId: id,
    currentStep: state.currentStep,
    currentExecutionId: state.currentExecutionId,
  }));
}

export function createPipeline(data) {
  const errors = validatePipeline(data);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return pipelinesStore.create({
    name: data.name,
    description: data.description || '',
    steps: buildSteps(data.steps),
    status: data.status || 'active',
  });
}

export function updatePipeline(id, data) {
  const existing = pipelinesStore.getById(id);
  if (!existing) return null;
  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.steps !== undefined) updateData.steps = buildSteps(data.steps);
  return pipelinesStore.update(id, updateData);
}

export function deletePipeline(id) {
  return pipelinesStore.delete(id);
}

export function getPipeline(id) {
  return pipelinesStore.getById(id);
}

export function getAllPipelines() {
  return pipelinesStore.getAll().map((p) => ({
    ...p,
    steps: enrichStepsWithAgentNames(p.steps || []),
  }));
}
