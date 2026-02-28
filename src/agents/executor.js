import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { settingsStore } from '../store/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SETTINGS = path.resolve(__dirname, '..', '..', 'data', 'agent-settings.json');
const CLAUDE_BIN = resolveBin();
const activeExecutions = new Map();
const executionOutputBuffers = new Map();
const MAX_OUTPUT_SIZE = 512 * 1024;
const MAX_ERROR_SIZE = 100 * 1024;
const MAX_BUFFER_LINES = 1000;
const ALLOWED_DIRECTORIES = (process.env.ALLOWED_DIRECTORIES || '').split(',').map(d => d.trim()).filter(Boolean);

let maxConcurrent = settingsStore.get().maxConcurrent || 5;

export function updateMaxConcurrent(value) {
  maxConcurrent = Math.max(1, Math.min(20, parseInt(value) || 5));
}

function isDirectoryAllowed(dir) {
  if (ALLOWED_DIRECTORIES.length === 0) return true;
  const resolved = path.resolve(dir);
  return ALLOWED_DIRECTORIES.some(allowed => resolved.startsWith(path.resolve(allowed)));
}

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

function cleanEnv(agentSecrets) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '128000';
  if (!env.SHELL) env.SHELL = '/bin/bash';
  if (!env.HOME) env.HOME = process.env.HOME || '/root';
  if (agentSecrets && typeof agentSecrets === 'object') {
    Object.assign(env, agentSecrets);
  }
  return env;
}

function buildArgs(agentConfig) {
  const model = agentConfig.model || 'claude-sonnet-4-6';
  const args = ['--output-format', 'stream-json', '--verbose', '--model', model];

  if (existsSync(AGENT_SETTINGS)) {
    args.push('--settings', AGENT_SETTINGS);
  }

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

  if (event.type === 'content_block_delta' && event.delta?.text) return event.delta.text;
  if (event.type === 'content_block_start' && event.content_block?.text) return event.content_block.text;

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

function extractToolInfo(event) {
  if (!event) return null;

  if (event.type === 'assistant' && event.message?.content) {
    const toolBlocks = event.message.content.filter((b) => b.type === 'tool_use');
    if (toolBlocks.length > 0) {
      return toolBlocks.map((b) => {
        const name = b.name || 'unknown';
        const input = b.input || {};
        let detail = '';
        if (input.command) detail = input.command.slice(0, 120);
        else if (input.file_path) detail = input.file_path;
        else if (input.pattern) detail = input.pattern;
        else if (input.query) detail = input.query;
        else if (input.path) detail = input.path;
        else if (input.prompt) detail = input.prompt.slice(0, 80);
        else if (input.description) detail = input.description.slice(0, 80);
        return { name, detail };
      });
    }
  }

  if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    return [{ name: event.content_block.name || 'tool', detail: '' }];
  }

  return null;
}

function extractSystemInfo(event) {
  if (!event) return null;

  if (event.type === 'system' && event.message) return event.message;
  if (event.type === 'error') return event.error?.message || event.message || 'Erro desconhecido';

  if (event.type === 'result') {
    const parts = [];
    if (event.num_turns) parts.push(`${event.num_turns} turnos`);
    if (event.cost_usd) parts.push(`custo: $${event.cost_usd.toFixed(4)}`);
    if (event.duration_ms) {
      const s = (event.duration_ms / 1000).toFixed(1);
      parts.push(`duração: ${s}s`);
    }
    if (event.session_id) parts.push(`sessão: ${event.session_id.slice(0, 8)}...`);
    return parts.length > 0 ? `Resultado: ${parts.join(' | ')}` : null;
  }

  return null;
}

function bufferLine(executionId, data) {
  let buf = executionOutputBuffers.get(executionId);
  if (!buf) {
    buf = [];
    executionOutputBuffers.set(executionId, buf);
  }
  buf.push(data);
  if (buf.length > MAX_BUFFER_LINES) buf.shift();
}

function processChildOutput(child, executionId, callbacks, options = {}) {
  const { onData, onError, onComplete } = callbacks;
  const timeoutMs = options.timeout || 1800000;
  const sessionIdOverride = options.sessionIdOverride || null;
  let outputBuffer = '';
  let errorBuffer = '';
  let fullText = '';
  let resultMeta = null;
  let turnCount = 0;
  let hadError = false;

  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
  }, timeoutMs);

  function processEvent(parsed) {
    if (!parsed) return;

    const tools = extractToolInfo(parsed);
    if (tools) {
      for (const t of tools) {
        const msg = t.detail ? `${t.name}: ${t.detail}` : t.name;
        const data = { type: 'tool', content: msg, toolName: t.name };
        bufferLine(executionId, data);
        if (onData) onData(data, executionId);
      }
    }

    const text = extractText(parsed);
    if (text) {
      if (fullText.length < MAX_OUTPUT_SIZE) {
        fullText += text;
      }
      const data = { type: 'chunk', content: text };
      bufferLine(executionId, data);
      if (onData) onData(data, executionId);
    }

    const sysInfo = extractSystemInfo(parsed);
    if (sysInfo) {
      const data = { type: 'system', content: sysInfo };
      bufferLine(executionId, data);
      if (onData) onData(data, executionId);
    }

    if (parsed.type === 'assistant') {
      turnCount++;
      const data = { type: 'turn', content: `Turno ${turnCount}`, turn: turnCount };
      bufferLine(executionId, data);
      if (onData) onData(data, executionId);
    }

    if (parsed.type === 'result') {
      resultMeta = {
        costUsd: parsed.cost_usd || 0,
        totalCostUsd: parsed.total_cost_usd || 0,
        durationMs: parsed.duration_ms || 0,
        durationApiMs: parsed.duration_api_ms || 0,
        numTurns: parsed.num_turns || 0,
        sessionId: parsed.session_id || sessionIdOverride || '',
        isError: parsed.is_error || false,
        errors: parsed.errors || [],
      };
    }
  }

  child.stdout.on('data', (chunk) => {
    const lines = (outputBuffer + chunk.toString()).split('\n');
    outputBuffer = lines.pop();
    for (const line of lines) processEvent(parseStreamLine(line));
  });

  child.stderr.on('data', (chunk) => {
    const str = chunk.toString();
    if (errorBuffer.length < MAX_ERROR_SIZE) {
      errorBuffer += str;
    }
    const lines = str.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const data = { type: 'stderr', content: line.trim() };
      bufferLine(executionId, data);
      if (onData) onData(data, executionId);
    }
  });

  child.on('error', (err) => {
    clearTimeout(timeout);
    console.log(`[executor][error] ${err.message}`);
    hadError = true;
    activeExecutions.delete(executionId);
    executionOutputBuffers.delete(executionId);
    if (onError) onError(err, executionId);
  });

  child.on('close', (code) => {
    clearTimeout(timeout);
    const wasCanceled = activeExecutions.get(executionId)?.canceled || false;
    activeExecutions.delete(executionId);
    executionOutputBuffers.delete(executionId);
    if (hadError) return;
    if (outputBuffer.trim()) processEvent(parseStreamLine(outputBuffer));

    if (resultMeta?.isError && resultMeta.errors?.length > 0) {
      const errorMsg = resultMeta.errors.join('; ');
      if (onError) onError(new Error(errorMsg), executionId);
      return;
    }

    if (onComplete) {
      onComplete({
        executionId,
        exitCode: code,
        result: fullText,
        stderr: errorBuffer,
        canceled: wasCanceled,
        ...(resultMeta || {}),
      }, executionId);
    }
  });
}

function validateWorkingDirectory(agentConfig, executionId, onError) {
  if (!agentConfig.workingDirectory || !agentConfig.workingDirectory.trim()) return true;

  if (!isDirectoryAllowed(agentConfig.workingDirectory)) {
    const err = new Error(`Diretório de trabalho não permitido: ${agentConfig.workingDirectory}`);
    if (onError) onError(err, executionId);
    return false;
  }

  if (!existsSync(agentConfig.workingDirectory)) {
    try {
      mkdirSync(agentConfig.workingDirectory, { recursive: true });
    } catch (e) {
      const err = new Error(`Não foi possível criar o diretório: ${agentConfig.workingDirectory} (${e.message})`);
      if (onError) onError(err, executionId);
      return false;
    }
  }

  return true;
}

export function execute(agentConfig, task, callbacks = {}, secrets = null) {
  if (activeExecutions.size >= maxConcurrent) {
    const err = new Error(`Limite de ${maxConcurrent} execuções simultâneas atingido`);
    if (callbacks.onError) callbacks.onError(err, uuidv4());
    return null;
  }

  const executionId = uuidv4();
  const { onData, onError, onComplete } = callbacks;

  if (!validateWorkingDirectory(agentConfig, executionId, onError)) return null;

  const prompt = buildPrompt(task.description || task, task.instructions);
  const args = buildArgs(agentConfig);

  const spawnOptions = {
    env: cleanEnv(secrets),
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  if (agentConfig.workingDirectory && agentConfig.workingDirectory.trim()) {
    spawnOptions.cwd = agentConfig.workingDirectory;
  }

  console.log(`[executor] Iniciando: ${executionId} | Modelo: ${agentConfig.model || 'claude-sonnet-4-6'}`);

  const child = spawn(CLAUDE_BIN, args, spawnOptions);
  child.stdin.write(prompt);
  child.stdin.end();

  activeExecutions.set(executionId, {
    process: child,
    agentConfig,
    task,
    startedAt: new Date().toISOString(),
    executionId,
  });

  processChildOutput(child, executionId, { onData, onError, onComplete }, {
    timeout: agentConfig.timeout || 1800000,
  });

  return executionId;
}

export function resume(agentConfig, sessionId, message, callbacks = {}) {
  if (activeExecutions.size >= maxConcurrent) {
    const err = new Error(`Limite de ${maxConcurrent} execuções simultâneas atingido`);
    if (callbacks.onError) callbacks.onError(err, uuidv4());
    return null;
  }

  const executionId = uuidv4();
  const { onData, onError, onComplete } = callbacks;

  if (!validateWorkingDirectory(agentConfig, executionId, onError)) return null;

  const model = agentConfig.model || 'claude-sonnet-4-6';
  const args = [
    '--resume', sessionId,
    '-p', sanitizeText(message),
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--permission-mode', agentConfig.permissionMode || 'bypassPermissions',
  ];

  if (existsSync(AGENT_SETTINGS)) {
    args.push('--settings', AGENT_SETTINGS);
  }

  if (agentConfig.maxTurns && agentConfig.maxTurns > 0) {
    args.push('--max-turns', String(agentConfig.maxTurns));
  }

  const spawnOptions = {
    env: cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  if (agentConfig.workingDirectory && agentConfig.workingDirectory.trim()) {
    spawnOptions.cwd = agentConfig.workingDirectory;
  }

  console.log(`[executor] Resumindo sessão: ${sessionId} | Execução: ${executionId}`);

  const child = spawn(CLAUDE_BIN, args, spawnOptions);

  activeExecutions.set(executionId, {
    process: child,
    agentConfig,
    task: { description: message },
    startedAt: new Date().toISOString(),
    executionId,
  });

  processChildOutput(child, executionId, { onData, onError, onComplete }, {
    timeout: agentConfig.timeout || 1800000,
    sessionIdOverride: sessionId,
  });

  return executionId;
}

export function cancel(executionId) {
  const execution = activeExecutions.get(executionId);
  if (!execution) return false;
  execution.canceled = true;
  execution.process.kill('SIGTERM');
  return true;
}

export function cancelAllExecutions() {
  for (const [, exec] of activeExecutions) exec.process.kill('SIGTERM');
  activeExecutions.clear();
  executionOutputBuffers.clear();
}

export function getActiveExecutions() {
  return Array.from(activeExecutions.values()).map((exec) => ({
    executionId: exec.executionId,
    startedAt: exec.startedAt,
    agentConfig: exec.agentConfig,
    outputBuffer: executionOutputBuffers.get(exec.executionId) || [],
  }));
}

export function summarize(text, threshold = 1500) {
  return new Promise((resolve) => {
    if (!text || text.length <= threshold) {
      resolve(text);
      return;
    }

    const prompt = `Resuma o conteúdo abaixo de forma estruturada e concisa. Preserve TODAS as informações críticas:
- Decisões técnicas e justificativas
- Trechos de código essenciais
- Dados, números e métricas
- Problemas encontrados e soluções
- Recomendações e próximos passos

Organize o resumo usando <tags> XML (ex: <decisoes>, <codigo>, <problemas>, <recomendacoes>).
NÃO omita informações que seriam necessárias para outro profissional continuar o trabalho.

<conteudo_para_resumir>
${text}
</conteudo_para_resumir>`;

    const args = [
      '--output-format', 'text',
      '--model', 'claude-haiku-4-5-20251001',
      '--max-turns', '1',
      '--permission-mode', 'bypassPermissions',
    ];

    if (existsSync(AGENT_SETTINGS)) {
      args.push('--settings', AGENT_SETTINGS);
    }

    const child = spawn(CLAUDE_BIN, args, {
      env: cleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.write(prompt);
    child.stdin.end();

    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, 120000);

    child.stdout.on('data', (chunk) => { output += chunk.toString(); });

    child.on('close', () => {
      clearTimeout(timer);
      const result = output.trim();
      console.log(`[executor] Sumarização: ${text.length} → ${result.length} chars`);
      resolve(result || text);
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve(text);
    });
  });
}

export function getBinPath() {
  return CLAUDE_BIN;
}
