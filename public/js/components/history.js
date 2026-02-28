const HistoryUI = {
  executions: [],
  total: 0,
  page: 0,
  pageSize: 20,
  _currentSearch: '',
  _currentType: '',
  _currentStatus: '',

  _exportListenerAdded: false,

  async load() {
    if (!HistoryUI._exportListenerAdded) {
      HistoryUI._exportListenerAdded = true;
      const exportBtn = document.getElementById('history-export-csv');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => API.executions.exportCsv());
      }
    }

    const params = { limit: HistoryUI.pageSize, offset: HistoryUI.page * HistoryUI.pageSize };
    if (HistoryUI._currentType) params.type = HistoryUI._currentType;
    if (HistoryUI._currentStatus) params.status = HistoryUI._currentStatus;
    if (HistoryUI._currentSearch) params.search = HistoryUI._currentSearch;

    try {
      const data = await API.executions.history(params);
      HistoryUI.executions = data.items || [];
      HistoryUI.total = data.total || 0;
      HistoryUI.render();
      HistoryUI._renderPagination();
    } catch (err) {
      Toast.error(`Erro ao carregar histórico: ${err.message}`);
    }
  },

  render() {
    const container = document.getElementById('history-list');
    if (!container) return;

    if (HistoryUI.executions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <i data-lucide="history"></i>
          </div>
          <h3 class="empty-state-title">Nenhuma execução encontrada</h3>
          <p class="empty-state-text">O histórico de execuções aparecerá aqui.</p>
        </div>
      `;
      Utils.refreshIcons(container);
      return;
    }

    container.innerHTML = HistoryUI.executions.map((exec) => HistoryUI._renderCard(exec)).join('');
    Utils.refreshIcons(container);
  },

  _renderCard(exec) {
    const typeBadge = exec.type === 'pipeline'
      ? '<span class="badge badge-pipeline">Pipeline</span>'
      : '<span class="badge badge-agent">Agente</span>';

    const statusBadge = HistoryUI._statusBadge(exec.status);
    const name = exec.type === 'pipeline'
      ? (exec.pipelineName || 'Pipeline')
      : (exec.agentName || 'Agente');
    const taskRaw = exec.type === 'pipeline'
      ? (exec.input || '')
      : (exec.task || '');
    const task = taskRaw.length > 150 ? taskRaw.slice(0, 150) + '…' : taskRaw;
    const date = HistoryUI._formatDate(exec.startedAt);
    const duration = HistoryUI._formatDuration(exec.startedAt, exec.endedAt);
    const cost = exec.costUsd || exec.totalCostUsd || 0;
    const costHtml = cost > 0
      ? `<span class="history-card-cost"><i data-lucide="dollar-sign" aria-hidden="true"></i>$${cost.toFixed(4)}</span>`
      : '';

    return `
      <article class="history-card">
        <div class="history-card-header">
          <div class="history-card-identity">
            ${typeBadge}
            <span class="history-card-name">${Utils.escapeHtml(name)}</span>
            ${statusBadge}
          </div>
        </div>
        <div class="history-card-task" title="${Utils.escapeHtml(taskRaw)}">${Utils.escapeHtml(task)}</div>
        <div class="history-card-info">
          <span class="history-card-date">
            <i data-lucide="calendar" aria-hidden="true"></i>
            ${date}
          </span>
          <span class="history-card-duration">
            <i data-lucide="clock" aria-hidden="true"></i>
            ${duration}
          </span>
          ${costHtml}
        </div>
        <div class="history-card-actions">
          <button class="btn btn-ghost btn-sm" data-action="view-execution" data-id="${exec.id}" type="button">
            <i data-lucide="eye"></i>
            Ver detalhes
          </button>
          ${(exec.status === 'error' && exec.type === 'pipeline' && exec.failedAtStep !== undefined) ? `
          <button class="btn btn-ghost btn-sm" data-action="resume-pipeline" data-id="${exec.id}" type="button" title="Retomar do passo ${(exec.failedAtStep || 0) + 1}">
            <i data-lucide="play"></i>
            Retomar
          </button>` : ''}
          ${(exec.status === 'error' || exec.status === 'canceled') ? `
          <button class="btn btn-ghost btn-sm" data-action="retry" data-id="${exec.id}" type="button" title="Reexecutar">
            <i data-lucide="refresh-cw"></i>
          </button>` : ''}
          <button class="btn btn-ghost btn-sm btn-danger" data-action="delete-execution" data-id="${exec.id}" type="button" aria-label="Excluir execução">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </article>
    `;
  },

  _renderPagination() {
    const container = document.getElementById('history-pagination');
    if (!container) return;

    const totalPages = Math.ceil(HistoryUI.total / HistoryUI.pageSize);
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    const hasPrev = HistoryUI.page > 0;
    const hasNext = HistoryUI.page < totalPages - 1;
    const start = HistoryUI.page * HistoryUI.pageSize + 1;
    const end = Math.min((HistoryUI.page + 1) * HistoryUI.pageSize, HistoryUI.total);

    container.innerHTML = `
      <div class="pagination">
        <span class="pagination-info">${start}–${end} de ${HistoryUI.total}</span>
        <div class="pagination-controls">
          <button class="btn btn-ghost btn-sm" id="history-prev-btn" type="button" ${hasPrev ? '' : 'disabled'}>
            <i data-lucide="chevron-left"></i>
            Anterior
          </button>
          <span class="pagination-page">Página ${HistoryUI.page + 1} de ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" id="history-next-btn" type="button" ${hasNext ? '' : 'disabled'}>
            Próxima
            <i data-lucide="chevron-right"></i>
          </button>
        </div>
      </div>
    `;

    Utils.refreshIcons(container);

    document.getElementById('history-prev-btn')?.addEventListener('click', () => {
      HistoryUI.page--;
      HistoryUI.load();
    });

    document.getElementById('history-next-btn')?.addEventListener('click', () => {
      HistoryUI.page++;
      HistoryUI.load();
    });
  },

  filter(search, type, status) {
    HistoryUI._currentSearch = search || '';
    HistoryUI._currentType = type || '';
    HistoryUI._currentStatus = status || '';
    HistoryUI.page = 0;
    HistoryUI.load();
  },

  async viewDetail(id) {
    try {
      const exec = await API.executions.get(id);
      const modal = document.getElementById('execution-detail-modal-overlay');
      const title = document.getElementById('execution-detail-title');
      const content = document.getElementById('execution-detail-content');

      if (!modal || !title || !content) return;

      const name = exec.type === 'pipeline'
        ? (exec.pipelineName || 'Pipeline')
        : (exec.agentName || 'Agente');

      title.textContent = name;
      content.innerHTML = exec.type === 'pipeline'
        ? HistoryUI._renderPipelineDetail(exec)
        : HistoryUI._renderAgentDetail(exec);

      Modal.open('execution-detail-modal-overlay');
      Utils.refreshIcons(content);

      content.querySelector('[data-action="download-result-md"]')?.addEventListener('click', () => {
        HistoryUI._downloadResultMd(exec);
      });

      content.querySelectorAll('.pipeline-step-prompt-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          const stepCard = btn.closest('.pipeline-step-detail');
          const promptBody = stepCard?.querySelector('.pipeline-step-prompt-body');
          if (!promptBody) return;
          const isHidden = promptBody.hidden;
          promptBody.hidden = !isHidden;
          btn.setAttribute('aria-expanded', String(isHidden));
        });
      });
    } catch (err) {
      Toast.error(`Erro ao carregar execução: ${err.message}`);
    }
  },

  _renderAgentDetail(exec) {
    const duration = HistoryUI._formatDuration(exec.startedAt, exec.endedAt);
    const startDate = HistoryUI._formatDate(exec.startedAt);
    const endDate = exec.endedAt ? HistoryUI._formatDate(exec.endedAt) : '—';

    const resultBlock = exec.result
      ? `<div class="execution-result" role="region" aria-label="Resultado da execução">${Utils.escapeHtml(exec.result)}</div>`
      : '';

    const errorBlock = exec.error
      ? `<div class="execution-result execution-result--error" role="alert">${Utils.escapeHtml(exec.error)}</div>`
      : '';

    return `
      ${exec.result ? `
      <div class="report-actions">
        <button class="btn btn-ghost btn-sm" data-action="download-result-md" type="button">
          <i data-lucide="download"></i> Download .md
        </button>
      </div>` : ''}
      <div class="execution-detail-meta">
        <div class="execution-detail-row">
          <span class="execution-detail-label">Agente</span>
          <span class="execution-detail-value">${Utils.escapeHtml(exec.agentName || exec.agentId || '—')}</span>
        </div>
        <div class="execution-detail-row">
          <span class="execution-detail-label">Status</span>
          <span class="execution-detail-value">${HistoryUI._statusBadge(exec.status)}</span>
        </div>
        <div class="execution-detail-row">
          <span class="execution-detail-label">Início</span>
          <span class="execution-detail-value">${startDate}</span>
        </div>
        <div class="execution-detail-row">
          <span class="execution-detail-label">Fim</span>
          <span class="execution-detail-value">${endDate}</span>
        </div>
        <div class="execution-detail-row">
          <span class="execution-detail-label">Duração</span>
          <span class="execution-detail-value">${duration}</span>
        </div>
        ${exec.exitCode !== undefined && exec.exitCode !== null ? `
        <div class="execution-detail-row">
          <span class="execution-detail-label">Exit Code</span>
          <span class="execution-detail-value font-mono">${exec.exitCode}</span>
        </div>` : ''}
        ${exec.costUsd || exec.totalCostUsd ? `
        <div class="execution-detail-row">
          <span class="execution-detail-label">Custo</span>
          <span class="execution-detail-value cost-value">$${(exec.costUsd || exec.totalCostUsd || 0).toFixed(4)}</span>
        </div>` : ''}
        ${exec.numTurns ? `
        <div class="execution-detail-row">
          <span class="execution-detail-label">Turnos</span>
          <span class="execution-detail-value font-mono">${exec.numTurns}</span>
        </div>` : ''}
      </div>
      ${exec.task ? `
      <div class="execution-detail-section">
        <h3 class="execution-detail-section-title">Tarefa</h3>
        <p class="execution-detail-task">${Utils.escapeHtml(exec.task)}</p>
      </div>` : ''}
      ${resultBlock ? `
      <div class="execution-detail-section">
        <h3 class="execution-detail-section-title">Resultado</h3>
        ${resultBlock}
      </div>` : ''}
      ${errorBlock ? `
      <div class="execution-detail-section">
        <h3 class="execution-detail-section-title">Erro</h3>
        ${errorBlock}
      </div>` : ''}
    `;
  },

  _renderPipelineDetail(exec) {
    const duration = HistoryUI._formatDuration(exec.startedAt, exec.endedAt);
    const startDate = HistoryUI._formatDate(exec.startedAt);
    const endDate = exec.endedAt ? HistoryUI._formatDate(exec.endedAt) : '—';
    const steps = Array.isArray(exec.steps) ? exec.steps : [];

    const stepsHtml = steps.map((step, index) => {
      const stepDuration = HistoryUI._formatDuration(step.startedAt, step.endedAt);
      const isLast = index === steps.length - 1;

      return `
        <div class="pipeline-step-item">
          <div class="pipeline-step-connector">
            <div class="pipeline-step-node ${step.status === 'error' ? 'pipeline-step-node--error' : step.status === 'completed' ? 'pipeline-step-node--completed' : ''}">
              <span>${step.stepIndex + 1}</span>
            </div>
            ${isLast ? '' : '<div class="pipeline-step-connector-line" aria-hidden="true"></div>'}
          </div>
          <div class="pipeline-step-detail">
            <div class="pipeline-step-header">
              <div class="pipeline-step-identity">
                <span class="pipeline-step-agent">${Utils.escapeHtml(step.agentName || step.agentId || 'Agente')}</span>
                ${HistoryUI._statusBadge(step.status)}
              </div>
              <span class="pipeline-step-meta-group">
                <span class="pipeline-step-duration">
                  <i data-lucide="clock" aria-hidden="true"></i>
                  ${stepDuration}
                </span>
                ${step.costUsd ? `<span class="pipeline-step-cost">$${step.costUsd.toFixed(4)}</span>` : ''}
              </span>
            </div>
            ${step.prompt ? `
            <div class="pipeline-step-prompt">
              <button class="pipeline-step-prompt-toggle" type="button" aria-expanded="false">
                <i data-lucide="chevron-right"></i>
                Prompt utilizado
              </button>
              <div class="pipeline-step-prompt-body" hidden>
                <div class="execution-result execution-result--prompt">${Utils.escapeHtml(step.prompt)}</div>
              </div>
            </div>` : ''}
            ${step.result ? `
            <div class="pipeline-step-result">
              <span class="pipeline-step-result-label">Resultado</span>
              <div class="execution-result">${Utils.escapeHtml(step.result)}</div>
            </div>` : ''}
            ${step.status === 'error' ? `
            <div class="execution-result execution-result--error">Passo falhou.</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    const hasResults = steps.some(s => s.result);
    return `
      ${hasResults ? `
      <div class="report-actions">
        <button class="btn btn-ghost btn-sm" data-action="download-result-md" type="button">
          <i data-lucide="download"></i> Download .md
        </button>
      </div>` : ''}
      <div class="execution-detail-meta">
        <div class="execution-detail-row">
          <span class="execution-detail-label">Pipeline</span>
          <span class="execution-detail-value">${Utils.escapeHtml(exec.pipelineName || exec.pipelineId || '—')}</span>
        </div>
        <div class="execution-detail-row">
          <span class="execution-detail-label">Status</span>
          <span class="execution-detail-value">${HistoryUI._statusBadge(exec.status)}</span>
        </div>
        <div class="execution-detail-row">
          <span class="execution-detail-label">Início</span>
          <span class="execution-detail-value">${startDate}</span>
        </div>
        <div class="execution-detail-row">
          <span class="execution-detail-label">Fim</span>
          <span class="execution-detail-value">${endDate}</span>
        </div>
        <div class="execution-detail-row">
          <span class="execution-detail-label">Duração</span>
          <span class="execution-detail-value">${duration}</span>
        </div>
        ${exec.totalCostUsd ? `
        <div class="execution-detail-row">
          <span class="execution-detail-label">Custo Total</span>
          <span class="execution-detail-value cost-value">$${(exec.totalCostUsd || 0).toFixed(4)}</span>
        </div>` : ''}
      </div>
      ${exec.input ? `
      <div class="execution-detail-section">
        <h3 class="execution-detail-section-title">Input Inicial</h3>
        <p class="execution-detail-task">${Utils.escapeHtml(exec.input)}</p>
      </div>` : ''}
      ${steps.length > 0 ? `
      <div class="execution-detail-section">
        <h3 class="execution-detail-section-title">Passos do Pipeline</h3>
        <div class="pipeline-timeline">
          ${stepsHtml}
        </div>
      </div>` : ''}
      ${exec.error ? `
      <div class="execution-detail-section">
        <h3 class="execution-detail-section-title">Erro</h3>
        <div class="execution-result execution-result--error">${Utils.escapeHtml(exec.error)}</div>
      </div>` : ''}
    `;
  },

  _downloadResultMd(exec) {
    let md = '';
    const name = exec.type === 'pipeline'
      ? (exec.pipelineName || 'Pipeline')
      : (exec.agentName || 'Agente');

    if (exec.type === 'pipeline') {
      md += `# ${name}\n\n`;
      const steps = Array.isArray(exec.steps) ? exec.steps : [];
      steps.forEach((step, i) => {
        md += `## Passo ${i + 1} — ${step.agentName || 'Agente'}\n\n`;
        if (step.result) md += `${step.result}\n\n`;
      });
    } else {
      md += exec.result || '';
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const filename = `${slug}-${new Date(exec.startedAt || Date.now()).toISOString().slice(0, 10)}.md`;

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    Toast.success('Download iniciado');
  },

  async resumePipeline(executionId) {
    try {
      await API.pipelines.resume(executionId);
      Toast.info('Pipeline retomado');
      App.navigateTo('terminal');
    } catch (err) {
      Toast.error(`Erro ao retomar pipeline: ${err.message}`);
    }
  },

  async retryExecution(id) {
    try {
      await API.executions.retry(id);
      Toast.success('Execução reiniciada');
      App.navigateTo('terminal');
    } catch (err) {
      Toast.error(`Erro ao reexecutar: ${err.message}`);
    }
  },

  async deleteExecution(id) {
    const confirmed = await Modal.confirm(
      'Excluir execução',
      'Tem certeza que deseja excluir esta execução do histórico? Esta ação não pode ser desfeita.'
    );
    if (!confirmed) return;

    try {
      await API.executions.delete(id);
      Toast.success('Execução excluída do histórico');
      await HistoryUI.load();
    } catch (err) {
      Toast.error(`Erro ao excluir execução: ${err.message}`);
    }
  },

  async clearHistory() {
    const confirmed = await Modal.confirm(
      'Limpar histórico',
      'Tem certeza que deseja excluir todo o histórico de execuções? Esta ação não pode ser desfeita.'
    );
    if (!confirmed) return;

    try {
      await API.executions.clearAll();
      Toast.success('Histórico limpo com sucesso');
      HistoryUI.page = 0;
      await HistoryUI.load();
    } catch (err) {
      Toast.error(`Erro ao limpar histórico: ${err.message}`);
    }
  },

  _statusBadge(status) {
    const map = {
      running: ['badge-running', 'Em execução'],
      completed: ['badge-active', 'Concluído'],
      error: ['badge-error', 'Erro'],
      awaiting_approval: ['badge-warning', 'Aguardando'],
      rejected: ['badge-error', 'Rejeitado'],
      canceled: ['badge-inactive', 'Cancelado'],
    };
    const [cls, label] = map[status] || ['badge-inactive', status || 'Desconhecido'];
    return `<span class="badge ${cls}">${label}</span>`;
  },

  _formatDuration(start, end) {
    if (!start) return '—';
    const startMs = new Date(start).getTime();
    const endMs = end ? new Date(end).getTime() : Date.now();
    const totalSeconds = Math.floor((endMs - startMs) / 1000);

    if (totalSeconds < 0) return '—';
    if (totalSeconds < 60) return `${totalSeconds}s`;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds}s`;
  },

  _formatDate(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  },

};

window.HistoryUI = HistoryUI;
