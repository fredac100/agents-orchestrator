import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, '..', '..', 'data', 'reports');

function ensureDir() {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9À-ÿ_-]/g, '_').slice(0, 60);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return '—';
  const ms = new Date(endIso) - new Date(startIso);
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  return `${m}m ${s % 60}s`;
}

export function generateAgentReport(execution) {
  ensureDir();

  const name = execution.agentName || 'Agente';
  const filename = `agente_${sanitizeFilename(name)}_${timestamp()}.md`;
  const filepath = join(REPORTS_DIR, filename);

  const status = execution.status === 'completed' ? '✅ Concluído' : '❌ Erro';
  const cost = (execution.costUsd || execution.totalCostUsd || 0).toFixed(4);

  const lines = [
    `# Relatório de Execução — ${name}`,
    '',
    `**Data:** ${formatDate(execution.startedAt)}`,
    `**Status:** ${status}`,
    `**Duração:** ${formatDuration(execution.startedAt, execution.endedAt)}`,
    `**Custo:** $${cost}`,
    `**Turnos:** ${execution.numTurns || '—'}`,
    `**Session ID:** \`${execution.sessionId || '—'}\``,
    '',
    '---',
    '',
    '## Tarefa',
    '',
    execution.task || '_(sem tarefa definida)_',
    '',
  ];

  if (execution.instructions) {
    lines.push('## Instruções Adicionais', '', execution.instructions, '');
  }

  lines.push('---', '', '## Resultado', '');

  if (execution.status === 'error' && execution.error) {
    lines.push('### Erro', '', '```', execution.error, '```', '');
  }

  if (execution.result) {
    lines.push(execution.result);
  } else {
    lines.push('_(sem resultado textual)_');
  }

  lines.push('', '---', '', `_Relatório gerado automaticamente em ${formatDate(new Date().toISOString())}_`);

  writeFileSync(filepath, lines.join('\n'), 'utf-8');
  return { filename, filepath };
}

export function generatePipelineReport(execution) {
  ensureDir();

  const name = execution.pipelineName || 'Pipeline';
  const filename = `pipeline_${sanitizeFilename(name)}_${timestamp()}.md`;
  const filepath = join(REPORTS_DIR, filename);

  const status = execution.status === 'completed' ? '✅ Concluído'
    : execution.status === 'error' ? '❌ Erro'
    : execution.status === 'canceled' ? '⚠️ Cancelado'
    : execution.status;

  const totalCost = (execution.totalCostUsd || 0).toFixed(4);
  const steps = Array.isArray(execution.steps) ? execution.steps : [];

  const lines = [
    `# Relatório de Pipeline — ${name}`,
    '',
    `**Data:** ${formatDate(execution.startedAt)}`,
    `**Status:** ${status}`,
    `**Duração:** ${formatDuration(execution.startedAt, execution.endedAt)}`,
    `**Custo Total:** $${totalCost}`,
    `**Passos:** ${steps.length}`,
    '',
    '---',
    '',
    '## Input Inicial',
    '',
    execution.input || '_(sem input)_',
    '',
    '---',
    '',
    '## Execução dos Passos',
    '',
  ];

  steps.forEach((step, i) => {
    const stepStatus = step.status === 'completed' ? '✅' : step.status === 'error' ? '❌' : '⏳';
    const stepCost = (step.costUsd || 0).toFixed(4);
    const stepDuration = formatDuration(step.startedAt, step.endedAt);

    lines.push(
      `### Passo ${i + 1} — ${step.agentName || 'Agente'} ${stepStatus}`,
      '',
      `| Propriedade | Valor |`,
      `|-------------|-------|`,
      `| Status | ${step.status || '—'} |`,
      `| Duração | ${stepDuration} |`,
      `| Custo | $${stepCost} |`,
      `| Turnos | ${step.numTurns || '—'} |`,
      '',
    );

    if (step.prompt) {
      lines.push(
        '<details>',
        '<summary>Prompt utilizado</summary>',
        '',
        '```',
        step.prompt,
        '```',
        '',
        '</details>',
        '',
      );
    }

    if (step.result) {
      lines.push('**Resultado:**', '', step.result, '');
    } else if (step.status === 'error') {
      lines.push('**Erro:** Passo falhou durante a execução.', '');
    }

    if (i < steps.length - 1) {
      lines.push('---', '');
    }
  });

  if (execution.error) {
    lines.push('---', '', '## Erro da Pipeline', '', '```', execution.error, '```', '');
  }

  const lastStep = steps[steps.length - 1];
  if (execution.status === 'completed' && lastStep?.result) {
    lines.push(
      '---',
      '',
      '## Resultado Final',
      '',
      lastStep.result,
      '',
    );
  }

  lines.push('---', '', `_Relatório gerado automaticamente em ${formatDate(new Date().toISOString())}_`);

  writeFileSync(filepath, lines.join('\n'), 'utf-8');
  return { filename, filepath };
}
