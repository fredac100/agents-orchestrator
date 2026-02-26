import { Router } from 'express';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import os from 'os';
import * as manager from '../agents/manager.js';
import { tasksStore, settingsStore, executionsStore, webhooksStore } from '../store/db.js';
import * as scheduler from '../agents/scheduler.js';
import * as pipeline from '../agents/pipeline.js';
import { getBinPath, updateMaxConcurrent } from '../agents/executor.js';
import { invalidateAgentMapCache } from '../agents/pipeline.js';
import { cached } from '../cache/index.js';

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

router.post('/agents/:id/execute', (req, res) => {
  try {
    const { task, instructions } = req.body;
    if (!task) return res.status(400).json({ error: 'task é obrigatório' });
    const clientId = req.headers['x-client-id'] || null;
    const executionId = manager.executeTask(req.params.id, task, instructions, (msg) => wsCallback(msg, clientId));
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

router.post('/pipelines/:id/execute', (req, res) => {
  try {
    const { input, workingDirectory } = req.body;
    if (!input) return res.status(400).json({ error: 'input é obrigatório' });
    const clientId = req.headers['x-client-id'] || null;
    const options = {};
    if (workingDirectory) options.workingDirectory = workingDirectory;
    pipeline.executePipeline(req.params.id, input, (msg) => wsCallback(msg, clientId), options).catch(() => {});
    res.status(202).json({ pipelineId: req.params.id, status: 'started' });
  } catch (err) {
    const status = err.message.includes('não encontrado') ? 404 : 400;
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

    const updateData = {};
    if (req.body.name !== undefined) updateData.name = req.body.name;
    if (req.body.active !== undefined) updateData.active = !!req.body.active;

    const updated = webhooksStore.update(req.params.id, updateData);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
      const options = {};
      if (payload.workingDirectory) options.workingDirectory = payload.workingDirectory;
      pipeline.executePipeline(webhook.targetId, input, (msg) => {
        if (wsbroadcast) wsbroadcast(msg);
      }, options).catch(() => {});
      res.status(202).json({ pipelineId: webhook.targetId, status: 'started', webhook: webhook.name });
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

router.get('/system/info', (req, res) => {
  try {
    if (claudeVersionCache === null) {
      try {
        claudeVersionCache = execSync(`${getBinPath()} --version`, { timeout: 5000 }).toString().trim();
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

export default router;
