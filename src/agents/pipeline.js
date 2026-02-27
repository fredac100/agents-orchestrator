import { v4 as uuidv4 } from 'uuid';
import { pipelinesStore, agentsStore, executionsStore } from '../store/db.js';
import * as executor from './executor.js';
import { mem } from '../cache/index.js';
import { generatePipelineReport } from '../reports/generator.js';

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
      requiresApproval: index === 0 ? false : !!step.requiresApproval,
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
          resolve({
            text: result.result || '',
            costUsd: result.costUsd || 0,
            durationMs: result.durationMs || 0,
            numTurns: result.numTurns || 0,
          });
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

function waitForApproval(executionId, pipelineId, stepIndex, previousOutput, agentName, wsCallback) {
  return new Promise((resolve) => {
    const state = activePipelines.get(executionId);
    if (!state) { resolve(false); return; }

    state.pendingApproval = {
      stepIndex,
      previousOutput: previousOutput.slice(0, 3000),
      agentName,
      resolve,
    };

    if (wsCallback) {
      wsCallback({
        type: 'pipeline_approval_required',
        pipelineId,
        executionId,
        stepIndex,
        agentName,
        previousOutput: previousOutput.slice(0, 3000),
      });
    }
  });
}

function findPipelineState(idOrExecId) {
  if (activePipelines.has(idOrExecId)) return activePipelines.get(idOrExecId);
  for (const [, state] of activePipelines) {
    if (state.pipelineId === idOrExecId) return state;
  }
  return null;
}

export function approvePipelineStep(id) {
  const state = findPipelineState(id);
  if (!state?.pendingApproval) return false;
  const { resolve } = state.pendingApproval;
  state.pendingApproval = null;
  resolve(true);
  return true;
}

export function rejectPipelineStep(id) {
  const state = findPipelineState(id);
  if (!state?.pendingApproval) return false;
  const { resolve } = state.pendingApproval;
  state.pendingApproval = null;
  resolve(false);
  return true;
}

export async function executePipeline(pipelineId, initialInput, wsCallback, options = {}) {
  const pl = pipelinesStore.getById(pipelineId);
  if (!pl) throw new Error(`Pipeline ${pipelineId} não encontrado`);
  if (pl.status !== 'active') throw new Error(`Pipeline "${pl.name}" está desativado`);

  const executionId = uuidv4();
  const pipelineState = { pipelineId, currentExecutionId: null, currentStep: 0, canceled: false, pendingApproval: null };
  activePipelines.set(executionId, pipelineState);

  const historyRecord = executionsStore.create({
    type: 'pipeline',
    pipelineId,
    pipelineName: pl.name,
    input: initialInput,
    status: 'running',
    startedAt: new Date().toISOString(),
    steps: [],
    totalCostUsd: 0,
  });

  const steps = buildSteps(pl.steps);
  const results = [];
  let currentInput = initialInput;
  let totalCost = 0;

  try {
    for (let i = 0; i < steps.length; i++) {
      if (pipelineState.canceled) break;

      const step = steps[i];
      pipelineState.currentStep = i;

      if (step.requiresApproval && i > 0) {
        const prevAgentName = results.length > 0 ? results[results.length - 1].agentName : '';

        executionsStore.update(historyRecord.id, { status: 'awaiting_approval' });

        if (wsCallback) {
          wsCallback({ type: 'pipeline_status', pipelineId, status: 'awaiting_approval', stepIndex: i });
        }

        const approved = await waitForApproval(executionId, pipelineId, i, currentInput, prevAgentName, wsCallback);

        if (!approved) {
          pipelineState.canceled = true;
          executionsStore.update(historyRecord.id, { status: 'rejected', endedAt: new Date().toISOString(), totalCostUsd: totalCost });
          if (wsCallback) {
            wsCallback({ type: 'pipeline_rejected', pipelineId, stepIndex: i });
          }
          break;
        }

        executionsStore.update(historyRecord.id, { status: 'running' });
      }

      if (pipelineState.canceled) break;

      const agent = agentsStore.getById(step.agentId);
      if (!agent) throw new Error(`Agente ${step.agentId} não encontrado no passo ${i}`);
      if (agent.status !== 'active') throw new Error(`Agente ${agent.agent_name} está inativo`);

      const stepConfig = { ...agent.config };
      if (options.workingDirectory) {
        stepConfig.workingDirectory = options.workingDirectory;
      }

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

      const stepResult = await executeStepAsPromise(stepConfig, prompt, pipelineState, wsCallback, pipelineId, i);

      if (pipelineState.canceled) break;

      totalCost += stepResult.costUsd;
      currentInput = stepResult.text;
      results.push({ stepId: step.id, agentName: agent.agent_name, result: stepResult.text });

      const current = executionsStore.getById(historyRecord.id);
      const savedSteps = current ? (current.steps || []) : [];
      savedSteps.push({
        stepIndex: i,
        agentId: step.agentId,
        agentName: agent.agent_name,
        prompt: prompt.slice(0, 5000),
        result: stepResult.text,
        startedAt: stepStart,
        endedAt: new Date().toISOString(),
        status: 'completed',
        costUsd: stepResult.costUsd,
        durationMs: stepResult.durationMs,
        numTurns: stepResult.numTurns,
      });
      executionsStore.update(historyRecord.id, { steps: savedSteps, totalCostUsd: totalCost });

      if (wsCallback) {
        wsCallback({
          type: 'pipeline_step_complete',
          pipelineId,
          stepIndex: i,
          stepId: step.id,
          result: stepResult.text.slice(0, 500),
          costUsd: stepResult.costUsd,
        });
      }
    }

    activePipelines.delete(executionId);

    const finalStatus = pipelineState.canceled ? 'canceled' : 'completed';
    executionsStore.update(historyRecord.id, {
      status: finalStatus,
      endedAt: new Date().toISOString(),
      totalCostUsd: totalCost,
    });

    if (!pipelineState.canceled) {
      try {
        const updated = executionsStore.getById(historyRecord.id);
        if (updated) {
          const report = generatePipelineReport(updated);
          if (wsCallback) wsCallback({ type: 'report_generated', pipelineId, reportFile: report.filename });
        }
      } catch (e) { console.error('[pipeline] Erro ao gerar relatório:', e.message); }
      if (wsCallback) wsCallback({ type: 'pipeline_complete', pipelineId, executionId, results, totalCostUsd: totalCost });
    }

    return { executionId, results };
  } catch (err) {
    activePipelines.delete(executionId);
    executionsStore.update(historyRecord.id, {
      status: 'error',
      error: err.message,
      endedAt: new Date().toISOString(),
      totalCostUsd: totalCost,
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

export function cancelPipeline(id) {
  let executionId = id;
  let state = activePipelines.get(id);
  if (!state) {
    for (const [execId, s] of activePipelines) {
      if (s.pipelineId === id) { state = s; executionId = execId; break; }
    }
  }
  if (!state) return false;
  state.canceled = true;
  if (state.pendingApproval) {
    state.pendingApproval.resolve(false);
    state.pendingApproval = null;
  }
  if (state.currentExecutionId) executor.cancel(state.currentExecutionId);
  activePipelines.delete(executionId);

  const allExecs = executionsStore.getAll();
  const exec = allExecs.find(e => e.pipelineId === state.pipelineId && (e.status === 'running' || e.status === 'awaiting_approval'));
  if (exec) {
    executionsStore.update(exec.id, { status: 'canceled', endedAt: new Date().toISOString() });
  }

  return true;
}

export function getActivePipelines() {
  return Array.from(activePipelines.entries()).map(([id, state]) => ({
    executionId: id,
    pipelineId: state.pipelineId,
    currentStep: state.currentStep,
    currentExecutionId: state.currentExecutionId,
    pendingApproval: !!state.pendingApproval,
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
