import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { settingsStore } from '../store/db.js';

const CLAUDE_BIN = resolveBin();
const activeExecutions = new Map();

function resolveBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;

  const home = process.env.HOME || '';
  const candidates = [
    `${home}/.local/bin/claude`,
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return 'claude';
}

function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\x00/g, '')
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .slice(0, 50000);
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.ANTHROPIC_API_KEY;
  return env;
}

function buildArgs(agentConfig, prompt) {
  const model = agentConfig.model || 'claude-sonnet-4-6';
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', model];

  if (agentConfig.systemPrompt) {
    args.push('--system-prompt', agentConfig.systemPrompt);
  }

  if (agentConfig.maxTurns && agentConfig.maxTurns > 0) {
    args.push('--max-turns', String(agentConfig.maxTurns));
  }

  if (agentConfig.allowedTools && agentConfig.allowedTools.length > 0) {
    const tools = Array.isArray(agentConfig.allowedTools)
      ? agentConfig.allowedTools.join(',')
      : agentConfig.allowedTools;
    args.push('--allowedTools', tools);
  }

  args.push('--permission-mode', agentConfig.permissionMode || 'bypassPermissions');

  return args;
}

function buildPrompt(task, instructions) {
  const parts = [];
  if (task) parts.push(sanitizeText(task));
  if (instructions) parts.push(`\nInstruções adicionais:\n${sanitizeText(instructions)}`);
  return parts.join('\n');
}

function parseStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { type: 'text', content: trimmed };
  }
}

function extractText(event) {
  if (!event) return null;

  if (event.type === 'assistant' && event.message?.content) {
    return event.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  if (event.type === 'content_block_delta' && event.delta?.text) {
    return event.delta.text;
  }

  if (event.type === 'content_block_start' && event.content_block?.text) {
    return event.content_block.text;
  }

  if (event.type === 'result') {
    if (typeof event.result === 'string') return event.result;
    if (event.result?.content) {
      return event.result.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }
  }

  if (event.type === 'text') return event.content || null;

  return null;
}

function getMaxConcurrent() {
  const s = settingsStore.get();
  return s.maxConcurrent || 5;
}

export function execute(agentConfig, task, callbacks = {}) {
  const maxConcurrent = getMaxConcurrent();
  if (activeExecutions.size >= maxConcurrent) {
    const err = new Error(`Limite de ${maxConcurrent} execuções simultâneas atingido`);
    if (callbacks.onError) callbacks.onError(err, uuidv4());
    return null;
  }

  const executionId = uuidv4();
  const { onData, onError, onComplete } = callbacks;

  const prompt = buildPrompt(task.description || task, task.instructions);
  const args = buildArgs(agentConfig, prompt);

  const spawnOptions = {
    env: cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  if (agentConfig.workingDirectory && agentConfig.workingDirectory.trim()) {
    if (!existsSync(agentConfig.workingDirectory)) {
      const err = new Error(`Diretório de trabalho não encontrado: ${agentConfig.workingDirectory}`);
      if (onError) onError(err, executionId);
      return executionId;
    }
    spawnOptions.cwd = agentConfig.workingDirectory;
  }

  console.log(`[executor] Iniciando: ${executionId}`);
  console.log(`[executor] Modelo: ${agentConfig.model || 'claude-sonnet-4-6'}`);
  console.log(`[executor] cwd: ${spawnOptions.cwd || process.cwd()}`);

  const child = spawn(CLAUDE_BIN, args, spawnOptions);
  let hadError = false;

  activeExecutions.set(executionId, {
    process: child,
    agentConfig,
    task,
    startedAt: new Date().toISOString(),
    executionId,
  });

  let outputBuffer = '';
  let errorBuffer = '';
  let fullText = '';

  child.stdout.on('data', (chunk) => {
    const raw = chunk.toString();
    const lines = (outputBuffer + raw).split('\n');
    outputBuffer = lines.pop();

    for (const line of lines) {
      const parsed = parseStreamLine(line);
      if (!parsed) continue;

      const text = extractText(parsed);
      if (text) {
        fullText += text;
        if (onData) onData({ type: 'chunk', content: text }, executionId);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    errorBuffer += chunk.toString();
  });

  child.on('error', (err) => {
    console.log(`[executor][error] ${err.message}`);
    hadError = true;
    activeExecutions.delete(executionId);
    if (onError) onError(err, executionId);
  });

  child.on('close', (code) => {
    console.log(`[executor][close] code=${code} hadError=${hadError}`);
    activeExecutions.delete(executionId);
    if (hadError) return;

    if (outputBuffer.trim()) {
      const parsed = parseStreamLine(outputBuffer);
      if (parsed) {
        const text = extractText(parsed);
        if (text) fullText += text;
      }
    }

    if (onComplete) {
      onComplete(
        {
          executionId,
          exitCode: code,
          result: fullText,
          stderr: errorBuffer,
        },
        executionId,
      );
    }
  });

  return executionId;
}

export function cancel(executionId) {
  const execution = activeExecutions.get(executionId);
  if (!execution) return false;

  execution.process.kill('SIGTERM');
  activeExecutions.delete(executionId);
  return true;
}

export function cancelAllExecutions() {
  for (const [id, exec] of activeExecutions) {
    exec.process.kill('SIGTERM');
  }
  activeExecutions.clear();
}

export function getActiveExecutions() {
  return Array.from(activeExecutions.entries()).map(([id, exec]) => ({
    executionId: id,
    startedAt: exec.startedAt,
    agentConfig: exec.agentConfig,
  }));
}

export function getBinPath() {
  return CLAUDE_BIN;
}
