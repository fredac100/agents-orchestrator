import { Router } from 'express';
import { execSync } from 'child_process';
import os from 'os';
import * as manager from '../agents/manager.js';
import { tasksStore, settingsStore } from '../store/db.js';
import * as scheduler from '../agents/scheduler.js';
import * as pipeline from '../agents/pipeline.js';
import { getBinPath } from '../agents/executor.js';

const router = Router();

let wsbroadcast = null;
let wsBroadcastTo = null;

export function setWsBroadcast(fn) {
  wsbroadcast = fn;
}

export function setWsBroadcastTo(fn) {
  wsBroadcastTo = fn;
}

function wsCallback(message, clientId) {
  if (clientId && wsBroadcastTo) {
    wsBroadcastTo(clientId, message);
  } else if (wsbroadcast) {
    wsbroadcast(message);
  }
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
    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/agents/import', (req, res) => {
  try {
    const agent = manager.importAgent(req.body);
    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/agents/:id', (req, res) => {
  try {
    const agent = manager.updateAgent(req.params.id, req.body);
    if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });
    res.json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/agents/:id', (req, res) => {
  try {
    const deleted = manager.deleteAgent(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Agente não encontrado' });
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
    const executionId = manager.executeTask(
      req.params.id, task, instructions,
      (msg) => wsCallback(msg, clientId)
    );
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
    const task = tasksStore.create(req.body);
    res.status(201).json(task);
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
    res.json(scheduler.getHistory());
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
    const created = pipeline.createPipeline(req.body);
    res.status(201).json(created);
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
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: 'input é obrigatório' });

    const clientId = req.headers['x-client-id'] || null;
    pipeline.executePipeline(req.params.id, input, (msg) => wsCallback(msg, clientId)).catch(() => {});
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

router.get('/system/status', (req, res) => {
  try {
    const agents = manager.getAllAgents();
    const activeExecutions = manager.getActiveExecutions();
    const schedules = scheduler.getSchedules();
    const pipelines = pipeline.getAllPipelines();
    const activePipelines = pipeline.getActivePipelines();

    res.json({
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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/system/info', (req, res) => {
  try {
    let claudeVersion = 'N/A';
    try {
      claudeVersion = execSync(`${getBinPath()} --version`, { timeout: 5000 }).toString().trim();
    } catch {}

    res.json({
      serverVersion: '1.0.0',
      nodeVersion: process.version,
      claudeVersion,
      platform: `${os.platform()} ${os.arch()}`,
      uptime: Math.floor(process.uptime()),
    });
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
    res.json(manager.getRecentExecutions(limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
