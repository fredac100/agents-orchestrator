import { Router } from 'express';
import { execFile, spawn as spawnProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import os from 'os';
import multer from 'multer';
import * as manager from '../agents/manager.js';
import { tasksStore, settingsStore, executionsStore, webhooksStore, notificationsStore, secretsStore, agentVersionsStore } from '../store/db.js';
import * as scheduler from '../agents/scheduler.js';
import * as pipeline from '../agents/pipeline.js';
import { getBinPath, updateMaxConcurrent, cancelAllExecutions, getActiveExecutions } from '../agents/executor.js';
import { invalidateAgentMapCache } from '../agents/pipeline.js';
import { cached } from '../cache/index.js';
import { readdirSync, readFileSync, unlinkSync, existsSync, mkdirSync, statSync, createReadStream } from 'fs';
import { join, dirname, resolve as pathResolve, extname, basename, relative } from 'path';
import { createGzip } from 'zlib';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';

const __apiDirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__apiDirname, '..', '..', 'data', 'reports');
const UPLOADS_DIR = join(__apiDirname, '..', '..', 'data', 'uploads');

if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const sessionDir = join(UPLOADS_DIR, req.uploadSessionId || 'tmp');
      if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
      cb(null, sessionDir);
    },
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
});

const router = Router();
export const hookRouter = Router();

let wsbroadcast = null;
let wsBroadcastTo = null;

export function setWsBroadcast(fn) {
  wsbroadcast = fn;
}

export function setWsBroadcastTo(fn) {
  wsBroadcastTo = fn;
}

function wsCallback(message, clientId) {
  if (clientId && wsBroadcastTo) wsBroadcastTo(clientId, message);
  else if (wsbroadcast) wsbroadcast(message);
}

router.get('/settings', (req, res) => {
  try {
    res.json(settingsStore.get());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const allowed = ['defaultModel', 'defaultWorkdir', 'maxConcurrent'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    if (data.maxConcurrent !== undefined) {
      data.maxConcurrent = Math.max(1, Math.min(20, parseInt(data.maxConcurrent) || 5));
      updateMaxConcurrent(data.maxConcurrent);
    }
    const saved = settingsStore.save(data);
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/agents', (req, res) => {
  try {
    res.json(manager.getAllAgents());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents/:id', (req, res) => {
  try {
    const agent = manager.getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/agents', (req, res) => {
  try {
    const agent = manager.createAgent(req.body);
    invalidateAgentMapCache();
    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/agents/import', (req, res) => {
  try {
    const agent = manager.importAgent(req.body);
    invalidateAgentMapCache();
    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/agents/:id', (req, res) => {
  try {
    const agent = manager.updateAgent(req.params.id, req.body);
    if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });
    invalidateAgentMapCache();
    res.json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/agents/:id', (req, res) => {
  try {
    const deleted = manager.deleteAgent(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Agente não encontrado' });
    invalidateAgentMapCache();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/uploads', (req, res, next) => {
  req.uploadSessionId = uuidv4();
  next();
}, upload.array('files', 20), (req, res) => {
  try {
    const files = (req.files || []).map(f => ({
      originalName: f.originalname,
      path: f.path,
      size: f.size,
    }));
    res.json({ sessionId: req.uploadSessionId, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildContextFilesPrompt(contextFiles) {
  if (!Array.isArray(contextFiles) || contextFiles.length === 0) return '';
  const lines = contextFiles.map(f => `- ${f.path} (${f.originalName})`);
  return `\n\nArquivos de contexto anexados (leia cada um deles antes de iniciar):\n${lines.join('\n')}`;
}

router.post('/agents/:id/execute', (req, res) => {
  try {
    const { task, instructions, contextFiles } = req.body;
    if (!task) return res.status(400).json({ error: 'task é obrigatório' });
    const clientId = req.headers['x-client-id'] || null;
    const filesPrompt = buildContextFilesPrompt(contextFiles);
    const fullTask = task + filesPrompt;
    const executionId = manager.executeTask(req.params.id, fullTask, instructions, (msg) => wsCallback(msg, clientId));
    res.status(202).json({ executionId, status: 'started' });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.post('/agents/:id/continue', (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId é obrigatório' });
    if (!message) return res.status(400).json({ error: 'message é obrigatório' });
    const clientId = req.headers['x-client-id'] || null;
    const executionId = manager.continueConversation(req.params.id, sessionId, message, (msg) => wsCallback(msg, clientId));
    res.status(202).json({ executionId, status: 'started' });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.post('/agents/:id/cancel/:executionId', (req, res) => {
  try {
    const cancelled = manager.cancelExecution(req.params.executionId);
    if (!cancelled) return res.status(404).json({ error: 'Execução não encontrada ou já finalizada' });
    res.json({ cancelled: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents/:id/export', (req, res) => {
  try {
    const exported = manager.exportAgent(req.params.id);
    if (!exported) return res.status(404).json({ error: 'Agente não encontrado' });
    res.json(exported);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents/:id/secrets', (req, res) => {
  try {
    const agent = manager.getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });
    const all = secretsStore.getAll();
    const agentSecrets = all
      .filter((s) => s.agentId === req.params.id)
      .map((s) => ({ name: s.name, created_at: s.created_at }));
    res.json(agentSecrets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/agents/:id/secrets', (req, res) => {
  try {
    const agent = manager.getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });
    const { name, value } = req.body;
    if (!name || !value) return res.status(400).json({ error: 'name e value são obrigatórios' });
    const all = secretsStore.getAll();
    const existing = all.find((s) => s.agentId === req.params.id && s.name === name);
    if (existing) {
      secretsStore.update(existing.id, { value });
      return res.json({ name, updated: true });
    }
    secretsStore.create({ agentId: req.params.id, name, value });
    res.status(201).json({ name, created: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/agents/:id/secrets/:name', (req, res) => {
  try {
    const secretName = decodeURIComponent(req.params.name);
    const all = secretsStore.getAll();
    const secret = all.find((s) => s.agentId === req.params.id && s.name === secretName);
    if (!secret) return res.status(404).json({ error: 'Secret não encontrado' });
    secretsStore.delete(secret.id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents/:id/versions', (req, res) => {
  try {
    const agent = manager.getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });
    const all = agentVersionsStore.getAll();
    const versions = all
      .filter((v) => v.agentId === req.params.id)
      .sort((a, b) => b.version - a.version);
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/agents/:id/versions/:version/restore', (req, res) => {
  try {
    const agent = manager.getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });
    const versionNum = parseInt(req.params.version);
    const all = agentVersionsStore.getAll();
    const target = all.find((v) => v.agentId === req.params.id && v.version === versionNum);
    if (!target) return res.status(404).json({ error: 'Versão não encontrada' });
    if (!target.snapshot) return res.status(400).json({ error: 'Snapshot da versão não disponível' });
    const { id, created_at, updated_at, ...snapshotData } = target.snapshot;
    const restored = manager.updateAgent(req.params.id, snapshotData);
    if (!restored) return res.status(500).json({ error: 'Falha ao restaurar versão' });
    invalidateAgentMapCache();
    agentVersionsStore.create({
      agentId: req.params.id,
      version: Math.max(...all.filter((v) => v.agentId === req.params.id).map((v) => v.version), 0) + 1,
      changes: ['restore'],
      changelog: `Restaurado para versão ${versionNum}`,
      snapshot: structuredClone(restored),
    });
    res.json(restored);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/agents/:id/duplicate', async (req, res) => {
  try {
    const agent = manager.getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });
    const { id, created_at, updated_at, executions, ...rest } = agent;
    const duplicate = {
      ...rest,
      agent_name: `${agent.agent_name} (cópia)`,
      executions: [],
      status: 'active',
    };
    const created = manager.createAgent(duplicate);
    invalidateAgentMapCache();
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tasks', (req, res) => {
  try {
    res.json(tasksStore.getAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks', (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ error: 'name é obrigatório' });
    res.status(201).json(tasksStore.create(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/tasks/:id', (req, res) => {
  try {
    const task = tasksStore.update(req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/tasks/:id', (req, res) => {
  try {
    const deleted = tasksStore.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Tarefa não encontrada' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/schedules', (req, res) => {
  try {
    const { agentId, taskDescription, cronExpression } = req.body;
    if (!agentId || !taskDescription || !cronExpression) {
      return res.status(400).json({ error: 'agentId, taskDescription e cronExpression são obrigatórios' });
    }
    const clientId = req.headers['x-client-id'] || null;
    const result = manager.scheduleTask(agentId, taskDescription, cronExpression, (msg) => wsCallback(msg, clientId));
    res.status(201).json(result);
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.get('/schedules/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const items = executionsStore.getAll()
      .filter((e) => e.source === 'schedule')
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(0, limit);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/schedules', (req, res) => {
  try {
    res.json(scheduler.getSchedules());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/schedules/:id', (req, res) => {
  try {
    const clientId = req.headers['x-client-id'] || null;
    const updated = manager.updateScheduleTask(req.params.id, req.body, (msg) => wsCallback(msg, clientId));
    if (!updated) return res.status(404).json({ error: 'Agendamento não encontrado' });
    res.json(updated);
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/schedules/:taskId', (req, res) => {
  try {
    const removed = scheduler.unschedule(req.params.taskId);
    if (!removed) return res.status(404).json({ error: 'Agendamento não encontrado' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pipelines', (req, res) => {
  try {
    res.json(pipeline.getAllPipelines());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pipelines/:id', (req, res) => {
  try {
    const found = pipeline.getPipeline(req.params.id);
    if (!found) return res.status(404).json({ error: 'Pipeline não encontrado' });
    res.json(found);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pipelines', (req, res) => {
  try {
    res.status(201).json(pipeline.createPipeline(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/pipelines/:id', (req, res) => {
  try {
    const updated = pipeline.updatePipeline(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Pipeline não encontrado' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/pipelines/:id', (req, res) => {
  try {
    const deleted = pipeline.deletePipeline(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Pipeline não encontrado' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pipelines/:id/execute', async (req, res) => {
  try {
    const { input, workingDirectory, contextFiles } = req.body;
    if (!input) return res.status(400).json({ error: 'input é obrigatório' });
    const clientId = req.headers['x-client-id'] || null;
    const options = {};
    if (workingDirectory) options.workingDirectory = workingDirectory;
    const filesPrompt = buildContextFilesPrompt(contextFiles);
    const fullInput = input + filesPrompt;
    const result = pipeline.executePipeline(req.params.id, fullInput, (msg) => wsCallback(msg, clientId), options);
    result.catch(() => {});
    res.status(202).json({ pipelineId: req.params.id, status: 'started' });
  } catch (err) {
    const status = err.message.includes('não encontrado') || err.message.includes('desativado') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/pipelines/:id/cancel', (req, res) => {
  try {
    const cancelled = pipeline.cancelPipeline(req.params.id);
    if (!cancelled) return res.status(404).json({ error: 'Pipeline não está em execução' });
    res.json({ cancelled: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pipelines/:id/approve', (req, res) => {
  try {
    const approved = pipeline.approvePipelineStep(req.params.id);
    if (!approved) return res.status(404).json({ error: 'Nenhuma aprovação pendente para este pipeline' });
    res.json({ approved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pipelines/:id/reject', (req, res) => {
  try {
    const rejected = pipeline.rejectPipelineStep(req.params.id);
    if (!rejected) return res.status(404).json({ error: 'Nenhuma aprovação pendente para este pipeline' });
    res.json({ rejected: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pipelines/resume/:executionId', async (req, res) => {
  try {
    const clientId = req.headers['x-client-id'] || null;
    const result = pipeline.resumePipeline(req.params.executionId, (msg) => wsCallback(msg, clientId));
    result.catch(() => {});
    res.status(202).json({ status: 'resumed' });
  } catch (err) {
    const status = err.message.includes('não encontrad') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.get('/webhooks', (req, res) => {
  try {
    res.json(webhooksStore.getAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhooks', (req, res) => {
  try {
    const { name, targetType, targetId } = req.body;
    if (!name || !targetType || !targetId) {
      return res.status(400).json({ error: 'name, targetType e targetId são obrigatórios' });
    }
    if (!['agent', 'pipeline'].includes(targetType)) {
      return res.status(400).json({ error: 'targetType deve ser "agent" ou "pipeline"' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const webhook = webhooksStore.create({
      name,
      targetType,
      targetId,
      token,
      active: true,
      lastTriggeredAt: null,
      triggerCount: 0,
    });

    res.status(201).json(webhook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/webhooks/:id', (req, res) => {
  try {
    const existing = webhooksStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Webhook não encontrado' });
    const allowed = ['name', 'targetType', 'targetId', 'active'];
    const updateData = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    }
    const updated = webhooksStore.update(req.params.id, updateData);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/webhooks/:id/test', async (req, res) => {
  try {
    const wh = webhooksStore.getById(req.params.id);
    if (!wh) return res.status(404).json({ error: 'Webhook não encontrado' });

    if (wh.targetType === 'agent') {
      const executionId = manager.executeTask(wh.targetId, 'Teste de webhook', '', (msg) => {
        if (wsbroadcast) wsbroadcast(msg);
      }, { source: 'webhook-test', webhookId: wh.id });
      res.status(202).json({ success: true, message: 'Webhook disparado com sucesso', executionId });
    } else if (wh.targetType === 'pipeline') {
      pipeline.executePipeline(wh.targetId, 'Teste de webhook', (msg) => {
        if (wsbroadcast) wsbroadcast(msg);
      }).catch(() => {});
      res.status(202).json({ success: true, message: 'Pipeline disparada com sucesso', pipelineId: wh.targetId });
    } else {
      return res.status(400).json({ error: `targetType inválido: ${wh.targetType}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/webhooks/:id', (req, res) => {
  try {
    const deleted = webhooksStore.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Webhook não encontrado' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

hookRouter.post('/:token', (req, res) => {
  try {
    const webhooks = webhooksStore.getAll();
    const webhook = webhooks.find((w) => w.token === req.params.token);

    if (!webhook) return res.status(404).json({ error: 'Webhook não encontrado' });
    if (!webhook.active) return res.status(403).json({ error: 'Webhook desativado' });

    webhooksStore.update(webhook.id, {
      lastTriggeredAt: new Date().toISOString(),
      triggerCount: (webhook.triggerCount || 0) + 1,
    });

    const payload = req.body || {};

    if (webhook.targetType === 'agent') {
      const task = payload.task || payload.message || payload.input || 'Webhook trigger';
      const instructions = payload.instructions || '';
      const executionId = manager.executeTask(webhook.targetId, task, instructions, (msg) => {
        if (wsbroadcast) wsbroadcast(msg);
      });
      res.status(202).json({ executionId, status: 'started', webhook: webhook.name });
    } else if (webhook.targetType === 'pipeline') {
      const input = payload.input || payload.task || payload.message || 'Webhook trigger';
      pipeline.executePipeline(webhook.targetId, input, (msg) => {
        if (wsbroadcast) wsbroadcast(msg);
      }).catch(() => {});
      res.status(202).json({ pipelineId: webhook.targetId, status: 'started', webhook: webhook.name });
    } else {
      return res.status(400).json({ error: `targetType inválido: ${webhook.targetType}` });
    }
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get('/stats/costs', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const items = executionsStore.getAll().filter((e) => {
      if (!e.startedAt) return false;
      return new Date(e.startedAt) >= cutoff;
    });

    let totalCost = 0;
    let totalExecutions = 0;
    const byAgent = {};
    const byDay = {};

    for (const item of items) {
      const cost = item.costUsd || item.totalCostUsd || 0;
      if (cost <= 0) continue;

      totalCost += cost;
      totalExecutions++;

      const agentName = item.agentName || item.pipelineName || 'Desconhecido';
      if (!byAgent[agentName]) byAgent[agentName] = { cost: 0, count: 0 };
      byAgent[agentName].cost += cost;
      byAgent[agentName].count++;

      const day = item.startedAt.slice(0, 10);
      if (!byDay[day]) byDay[day] = 0;
      byDay[day] += cost;
    }

    const topAgents = Object.entries(byAgent)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    res.json({
      totalCost: Math.round(totalCost * 10000) / 10000,
      totalExecutions,
      period: days,
      topAgents,
      dailyCosts: byDay,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SYSTEM_STATUS_TTL = 5_000;

router.get('/system/status', (req, res) => {
  try {
    const status = cached('system:status', SYSTEM_STATUS_TTL, () => {
      const agents = manager.getAllAgents();
      const activeExecutions = manager.getActiveExecutions();
      const schedules = scheduler.getSchedules();
      const pipelines = pipeline.getAllPipelines();
      const activePipelines = pipeline.getActivePipelines();
      const webhooks = webhooksStore.getAll();

      const todayCost = (() => {
        const today = new Date().toISOString().slice(0, 10);
        return executionsStore.getAll()
          .filter((e) => e.startedAt && e.startedAt.startsWith(today))
          .reduce((sum, e) => sum + (e.costUsd || e.totalCostUsd || 0), 0);
      })();

      return {
        agents: {
          total: agents.length,
          active: agents.filter((a) => a.status === 'active').length,
          inactive: agents.filter((a) => a.status === 'inactive').length,
        },
        executions: {
          active: activeExecutions.length,
          today: manager.getDailyExecutionCount(),
          list: activeExecutions,
        },
        schedules: {
          total: schedules.length,
          active: schedules.filter((s) => s.active).length,
        },
        pipelines: {
          total: pipelines.length,
          active: pipelines.filter((p) => p.status === 'active').length,
          running: activePipelines.length,
        },
        webhooks: {
          total: webhooks.length,
          active: webhooks.filter((w) => w.active).length,
        },
        costs: {
          today: Math.round(todayCost * 10000) / 10000,
        },
      };
    });
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let claudeVersionCache = null;

router.get('/system/info', async (req, res) => {
  try {
    if (claudeVersionCache === null) {
      try {
        claudeVersionCache = await new Promise((resolve, reject) => {
          execFile(getBinPath(), ['--version'], { timeout: 5000 }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout.toString().trim());
          });
        });
      } catch {
        claudeVersionCache = 'N/A';
      }
    }
    res.json({
      serverVersion: '1.1.0',
      nodeVersion: process.version,
      claudeVersion: claudeVersionCache,
      platform: `${os.platform()} ${os.arch()}`,
      uptime: Math.floor(process.uptime()),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/executions/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const typeFilter = req.query.type || '';
    const statusFilter = req.query.status || '';
    const search = (req.query.search || '').toLowerCase();

    let items = executionsStore.getAll();

    if (typeFilter) items = items.filter((e) => e.type === typeFilter);
    if (statusFilter) items = items.filter((e) => e.status === statusFilter);
    if (search) {
      items = items.filter((e) => {
        const name = (e.agentName || e.pipelineName || '').toLowerCase();
        const task = (e.task || e.input || '').toLowerCase();
        return name.includes(search) || task.includes(search);
      });
    }

    items.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const total = items.length;
    const paged = items.slice(offset, offset + limit);

    res.json({ items: paged, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/executions/history/:id', (req, res) => {
  try {
    const exec = executionsStore.getById(req.params.id);
    if (!exec) return res.status(404).json({ error: 'Execução não encontrada' });
    res.json(exec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/executions/history/:id', (req, res) => {
  try {
    const deleted = executionsStore.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Execução não encontrada' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/executions/history', (req, res) => {
  try {
    executionsStore.save([]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/executions/active', (req, res) => {
  try {
    res.json(manager.getActiveExecutions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/executions/cancel-all', (req, res) => {
  try {
    const activePipelines = pipeline.getActivePipelines();
    for (const p of activePipelines) {
      pipeline.cancelPipeline(p.pipelineId);
    }
    cancelAllExecutions();
    const running = executionsStore.getAll().filter(e => e.status === 'running' || e.status === 'awaiting_approval');
    for (const e of running) {
      executionsStore.update(e.id, { status: 'canceled', endedAt: new Date().toISOString() });
    }
    res.json({ cancelled: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/executions/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const items = executionsStore.getAll();
    items.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    res.json(items.slice(0, limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/executions/:id/retry', async (req, res) => {
  try {
    const execution = executionsStore.getById(req.params.id);
    if (!execution) return res.status(404).json({ error: 'Execução não encontrada' });
    if (!['error', 'canceled'].includes(execution.status)) {
      return res.status(400).json({ error: 'Apenas execuções com erro ou canceladas podem ser reexecutadas' });
    }
    const clientId = req.headers['x-client-id'] || null;
    if (execution.type === 'pipeline') {
      pipeline.executePipeline(execution.pipelineId, execution.input, (msg) => wsCallback(msg, clientId)).catch(() => {});
      return res.json({ success: true, message: 'Pipeline reexecutado' });
    }
    manager.executeTask(execution.agentId, execution.task, null, (msg) => wsCallback(msg, clientId));
    res.json({ success: true, message: 'Execução reiniciada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/executions/export', async (req, res) => {
  try {
    const executions = executionsStore.getAll();
    const headers = ['ID', 'Tipo', 'Nome', 'Status', 'Início', 'Fim', 'Duração (ms)', 'Custo (USD)', 'Turnos'];
    const rows = executions.map(e => [
      e.id,
      e.type || 'agent',
      e.agentName || e.pipelineName || '',
      e.status,
      e.startedAt || '',
      e.endedAt || '',
      e.durationMs || '',
      e.costUsd || e.totalCostUsd || '',
      e.numTurns || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=executions_${new Date().toISOString().split('T')[0]}.csv`);
    res.send('\uFEFF' + csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats/charts', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const executions = executionsStore.getAll();
    const now = new Date();
    const labels = [];
    const executionCounts = [];
    const costData = [];
    const successCounts = [];
    const errorCounts = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      labels.push(dateStr);
      const dayExecs = executions.filter(e => e.startedAt && e.startedAt.startsWith(dateStr));
      executionCounts.push(dayExecs.length);
      costData.push(+(dayExecs.reduce((sum, e) => sum + (e.costUsd || e.totalCostUsd || 0), 0)).toFixed(4));
      successCounts.push(dayExecs.filter(e => e.status === 'completed').length);
      errorCounts.push(dayExecs.filter(e => e.status === 'error').length);
    }

    const agentCounts = {};
    executions.forEach(e => {
      if (e.agentName) agentCounts[e.agentName] = (agentCounts[e.agentName] || 0) + 1;
    });
    const topAgents = Object.entries(agentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const statusDist = {};
    executions.forEach(e => { statusDist[e.status] = (statusDist[e.status] || 0) + 1; });

    res.json({ labels, executionCounts, costData, successCounts, errorCounts, topAgents, statusDistribution: statusDist });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const notifications = notificationsStore.getAll();
    const unreadCount = notifications.filter(n => !n.read).length;
    res.json({ notifications: notifications.slice(-50).reverse(), unreadCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/notifications/:id/read', (req, res) => {
  try {
    const updated = notificationsStore.update(req.params.id, { read: true });
    if (!updated) return res.status(404).json({ error: 'Notificação não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/notifications/read-all', (req, res) => {
  try {
    const notifications = notificationsStore.getAll();
    for (const n of notifications) {
      if (!n.read) notificationsStore.update(n.id, { read: true });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/notifications', async (req, res) => {
  try {
    notificationsStore.save([]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/reports', (req, res) => {
  try {
    if (!existsSync(REPORTS_DIR)) return res.json([]);
    const files = readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.md'))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 100);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/:filename', (req, res) => {
  try {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9À-ÿ_.\-]/g, '');
    if (!filename.endsWith('.md')) return res.status(400).json({ error: 'Formato inválido' });
    const filepath = join(REPORTS_DIR, filename);
    const resolved = pathResolve(filepath);
    if (!resolved.startsWith(pathResolve(REPORTS_DIR))) {
      return res.status(400).json({ error: 'Caminho inválido' });
    }
    if (!existsSync(filepath)) return res.status(404).json({ error: 'Relatório não encontrado' });
    const content = readFileSync(filepath, 'utf-8');
    res.json({ filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/reports/:filename', (req, res) => {
  try {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9À-ÿ_.\-]/g, '');
    const filepath = join(REPORTS_DIR, filename);
    const resolved = pathResolve(filepath);
    if (!resolved.startsWith(pathResolve(REPORTS_DIR))) {
      return res.status(400).json({ error: 'Caminho inválido' });
    }
    if (!existsSync(filepath)) return res.status(404).json({ error: 'Relatório não encontrado' });
    unlinkSync(filepath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PROJECTS_DIR = '/home/projetos';

function resolveProjectPath(requestedPath) {
  const decoded = decodeURIComponent(requestedPath || '');
  const resolved = pathResolve(PROJECTS_DIR, decoded);
  if (!resolved.startsWith(PROJECTS_DIR)) return null;
  return resolved;
}

router.get('/files', (req, res) => {
  try {
    const targetPath = resolveProjectPath(req.query.path || '');
    if (!targetPath) return res.status(400).json({ error: 'Caminho inválido' });
    if (!existsSync(targetPath)) return res.status(404).json({ error: 'Diretório não encontrado' });

    const stat = statSync(targetPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Caminho não é um diretório' });

    const entries = readdirSync(targetPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(entry => {
        const fullPath = join(targetPath, entry.name);
        try {
          const s = statSync(fullPath);
          return {
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: entry.isDirectory() ? null : s.size,
            modified: s.mtime.toISOString(),
            extension: entry.isDirectory() ? null : extname(entry.name).slice(1).toLowerCase(),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const relativePath = relative(PROJECTS_DIR, targetPath) || '';

    res.json({
      path: relativePath,
      parent: relativePath ? dirname(relativePath) : null,
      entries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/files/download', (req, res) => {
  try {
    const targetPath = resolveProjectPath(req.query.path || '');
    if (!targetPath) return res.status(400).json({ error: 'Caminho inválido' });
    if (!existsSync(targetPath)) return res.status(404).json({ error: 'Arquivo não encontrado' });

    const stat = statSync(targetPath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Caminho não é um arquivo' });

    const filename = basename(targetPath);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', stat.size);
    createReadStream(targetPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/files/download-folder', (req, res) => {
  try {
    const targetPath = resolveProjectPath(req.query.path || '');
    if (!targetPath) return res.status(400).json({ error: 'Caminho inválido' });
    if (!existsSync(targetPath)) return res.status(404).json({ error: 'Pasta não encontrada' });

    const stat = statSync(targetPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Caminho não é uma pasta' });

    const folderName = basename(targetPath) || 'projetos';
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(folderName)}.tar.gz"`);
    res.setHeader('Content-Type', 'application/gzip');

    const parentDir = dirname(targetPath);
    const dirName = basename(targetPath);
    const tar = spawnProcess('tar', ['-czf', '-', '-C', parentDir, dirName]);
    tar.stdout.pipe(res);
    tar.stderr.on('data', () => {});
    tar.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });

    req.on('close', () => { try { tar.kill(); } catch {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
