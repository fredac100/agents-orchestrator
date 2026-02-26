const App = {
  currentSection: 'dashboard',
  ws: null,
  wsReconnectAttempts: 0,
  wsReconnectTimer: null,
  _initialized: false,
  _lastAgentName: '',

  sectionTitles: {
    dashboard: 'Dashboard',
    agents: 'Agentes',
    tasks: 'Tarefas',
    schedules: 'Agendamentos',
    pipelines: 'Pipelines',
    webhooks: 'Webhooks',
    terminal: 'Terminal',
    history: 'Histórico',
    settings: 'Configurações',
  },

  init() {
    if (App._initialized) return;
    App._initialized = true;

    App.setupNavigation();
    App.setupWebSocket();
    App.setupEventListeners();
    App.setupKeyboardShortcuts();
    App.navigateTo('dashboard');
    App.startPeriodicRefresh();

    if (window.lucide) lucide.createIcons();
  },

  setupNavigation() {
    document.querySelectorAll('.sidebar-nav-link[data-section]').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        App.navigateTo(link.dataset.section);
      });
    });

    const refreshBtn = document.getElementById('refresh-activity-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => DashboardUI.load());
    }
  },

  navigateTo(section) {
    document.querySelectorAll('.section').forEach((el) => {
      const isActive = el.id === section;
      el.classList.toggle('active', isActive);
      el.hidden = !isActive;
    });

    document.querySelectorAll('.sidebar-nav-item').forEach((item) => {
      const link = item.querySelector('.sidebar-nav-link');
      item.classList.toggle('active', link && link.dataset.section === section);
    });

    const titleEl = document.getElementById('header-title');
    if (titleEl) titleEl.textContent = App.sectionTitles[section] || section;

    App.currentSection = section;
    App._loadSection(section);
  },

  async _loadSection(section) {
    try {
      switch (section) {
        case 'dashboard': await DashboardUI.load(); break;
        case 'agents': await AgentsUI.load(); break;
        case 'tasks': await TasksUI.load(); break;
        case 'schedules': await SchedulesUI.load(); break;
        case 'pipelines': await PipelinesUI.load(); break;
        case 'webhooks': await WebhooksUI.load(); break;
        case 'history': await HistoryUI.load(); break;
        case 'settings': await SettingsUI.load(); break;
      }
    } catch (err) {
      Toast.error(`Erro ao carregar seção: ${err.message}`);
    }
  },

  setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const clientId = API.clientId;
    const url = `${protocol}//${window.location.host}?clientId=${clientId}`;

    try {
      App.ws = new WebSocket(url);

      App.ws.onopen = () => {
        App.updateWsStatus('connected');
        App.wsReconnectAttempts = 0;
        if (App.wsReconnectTimer) {
          clearTimeout(App.wsReconnectTimer);
          App.wsReconnectTimer = null;
        }
      };

      App.ws.onclose = () => {
        App.updateWsStatus('disconnected');
        App._scheduleWsReconnect();
      };

      App.ws.onerror = () => {
        App.updateWsStatus('error');
      };

      App.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          App.handleWsMessage(data);
        } catch {
          //
        }
      };
    } catch {
      App.updateWsStatus('error');
      App._scheduleWsReconnect();
    }
  },

  _scheduleWsReconnect() {
    const delay = Math.min(1000 * Math.pow(2, App.wsReconnectAttempts), 30000);
    App.wsReconnectAttempts++;

    App.wsReconnectTimer = setTimeout(() => {
      App.setupWebSocket();
    }, delay);
  },

  handleWsMessage(data) {
    switch (data.type) {
      case 'connected':
        break;

      case 'execution_output': {
        Terminal.stopProcessing();
        const content = data.data?.content || '';
        if (content) {
          Terminal.addLine(content, 'default', data.executionId);
        }
        App._updateActiveBadge();
        break;
      }

      case 'execution_complete': {
        Terminal.stopProcessing();
        const result = data.data?.result || '';
        if (result) {
          Terminal.addLine(result, 'success', data.executionId);
        } else {
          Terminal.addLine('Execução concluída (sem resultado textual).', 'info', data.executionId);
        }
        if (data.data?.stderr) {
          Terminal.addLine(data.data.stderr, 'error', data.executionId);
        }
        const costUsd = data.data?.costUsd || 0;
        const numTurns = data.data?.numTurns || 0;
        if (costUsd > 0) {
          Terminal.addLine(`Custo: $${costUsd.toFixed(4)} | Turnos: ${numTurns}`, 'info', data.executionId);
        }

        const sessionId = data.data?.sessionId || '';
        if (sessionId && data.agentId) {
          if (Terminal.getChatSession()?.sessionId === sessionId || !Terminal.getChatSession()) {
            const agentName = App._lastAgentName || 'Agente';
            Terminal.enableChat(data.agentId, agentName, sessionId);
          }
          if (Terminal.getChatSession()) {
            Terminal.updateSessionId(sessionId);
          }
        }

        Toast.success('Execução concluída');
        App.refreshCurrentSection();
        App._updateActiveBadge();
        break;
      }

      case 'execution_error':
        Terminal.stopProcessing();
        Terminal.addLine(data.data?.error || 'Erro na execução', 'error', data.executionId);
        Toast.error(`Erro na execução: ${data.data?.error || 'desconhecido'}`);
        App._updateActiveBadge();
        break;

      case 'pipeline_step_output': {
        Terminal.stopProcessing();
        const stepContent = data.data?.content || '';
        if (stepContent) {
          Terminal.addLine(stepContent, 'default', data.executionId);
        }
        break;
      }

      case 'pipeline_step_start':
        Terminal.stopProcessing();
        Terminal.addLine(`Pipeline passo ${data.stepIndex + 1}/${data.totalSteps}: Executando agente "${data.agentName}"...`, 'system');
        Terminal.startProcessing(data.agentName);
        break;

      case 'pipeline_step_complete':
        Terminal.stopProcessing();
        Terminal.addLine(`Passo ${data.stepIndex + 1} concluído.`, 'info');
        Terminal.addLine(data.result || '(sem output)', 'default');
        break;

      case 'pipeline_complete':
        Terminal.stopProcessing();
        Terminal.addLine('Pipeline concluído com sucesso.', 'success');
        Toast.success('Pipeline concluído');
        App.refreshCurrentSection();
        break;

      case 'pipeline_error':
        Terminal.stopProcessing();
        Terminal.addLine(`Erro no passo ${data.stepIndex + 1}: ${data.error}`, 'error');
        Toast.error('Erro no pipeline');
        break;

      case 'pipeline_approval_required':
        Terminal.stopProcessing();
        Terminal.addLine(`Passo ${data.stepIndex + 1} requer aprovação antes de executar.`, 'system');
        if (data.previousOutput) {
          Terminal.addLine(`Output do passo anterior:\n${data.previousOutput.slice(0, 1000)}`, 'info');
        }
        App._showApprovalNotification(data.pipelineId, data.stepIndex, data.agentName);
        Toast.warning('Pipeline aguardando aprovação');
        break;

      case 'pipeline_rejected':
        Terminal.stopProcessing();
        Terminal.addLine(`Pipeline rejeitado no passo ${data.stepIndex + 1}.`, 'error');
        App._hideApprovalNotification();
        Toast.info('Pipeline rejeitado');
        App.refreshCurrentSection();
        break;

      case 'pipeline_status':
        break;
    }
  },

  _showApprovalNotification(pipelineId, stepIndex, agentName) {
    const container = document.getElementById('approval-notification');
    if (!container) return;

    container.innerHTML = `
      <div class="approval-content">
        <div class="approval-icon"><i data-lucide="shield-alert"></i></div>
        <div class="approval-text">
          <strong>Aprovação necessária</strong>
          <span>Passo ${stepIndex + 1} (${Utils.escapeHtml(agentName) || 'agente'}) aguardando autorização</span>
        </div>
        <div class="approval-actions">
          <button class="btn btn--primary btn--sm" id="approval-approve-btn" type="button">Aprovar</button>
          <button class="btn btn--danger btn--sm" id="approval-reject-btn" type="button">Rejeitar</button>
        </div>
      </div>
    `;
    container.hidden = false;
    container.dataset.pipelineId = pipelineId;

    if (window.lucide) lucide.createIcons({ nodes: [container] });

    document.getElementById('approval-approve-btn')?.addEventListener('click', () => {
      App._handleApproval(pipelineId, true);
    });
    document.getElementById('approval-reject-btn')?.addEventListener('click', () => {
      App._handleApproval(pipelineId, false);
    });
  },

  _hideApprovalNotification() {
    const container = document.getElementById('approval-notification');
    if (container) {
      container.hidden = true;
      container.innerHTML = '';
    }
  },

  async _handleApproval(pipelineId, approve) {
    try {
      if (approve) {
        await API.pipelines.approve(pipelineId);
        Terminal.addLine('Passo aprovado. Continuando pipeline...', 'success');
        Toast.success('Passo aprovado');
      } else {
        await API.pipelines.reject(pipelineId);
        Terminal.addLine('Pipeline rejeitado pelo usuário.', 'error');
        Toast.info('Pipeline rejeitado');
      }
      App._hideApprovalNotification();
    } catch (err) {
      Toast.error(`Erro: ${err.message}`);
    }
  },

  updateWsStatus(status) {
    const indicator = document.getElementById('ws-indicator');
    const label = document.getElementById('ws-label');
    const terminalDot = document.getElementById('terminal-ws-dot');
    const terminalLabel = document.getElementById('terminal-ws-label');
    const wsBadge = document.getElementById('system-ws-status-badge');

    const labels = {
      connected: 'Conectado',
      disconnected: 'Desconectado',
      error: 'Erro de conexão',
    };

    const cssClass = {
      connected: 'ws-indicator--connected',
      disconnected: 'ws-indicator--disconnected',
      error: 'ws-indicator--error',
    };

    const badgeClass = {
      connected: 'badge--green',
      disconnected: 'badge--red',
      error: 'badge--red',
    };

    const displayLabel = labels[status] || status;
    const dotClass = cssClass[status] || 'ws-indicator--disconnected';

    [indicator, terminalDot].forEach((el) => {
      if (!el) return;
      el.className = `ws-indicator ${dotClass}`;
    });

    [label, terminalLabel].forEach((el) => {
      if (el) el.textContent = displayLabel;
    });

    if (wsBadge) {
      wsBadge.textContent = displayLabel;
      wsBadge.className = `badge ${badgeClass[status] || 'badge--red'}`;
    }
  },

  setupEventListeners() {
    const on = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    };

    on('new-agent-btn', 'click', () => AgentsUI.openCreateModal());
    on('agents-empty-new-btn', 'click', () => AgentsUI.openCreateModal());
    on('import-agent-btn', 'click', () => AgentsUI.openImportModal());

    on('agent-form-submit', 'click', (e) => {
      e.preventDefault();
      AgentsUI.save();
    });

    on('agent-form', 'submit', (e) => {
      e.preventDefault();
      AgentsUI.save();
    });

    on('import-confirm-btn', 'click', () => AgentsUI.importAgent());

    on('execute-form-submit', 'click', (e) => {
      e.preventDefault();
      App._handleExecute();
    });

    on('execute-form', 'submit', (e) => {
      e.preventDefault();
      App._handleExecute();
    });

    on('execute-saved-task', 'change', (e) => {
      const taskId = e.target.value;
      if (!taskId) return;
      const task = (AgentsUI._savedTasksCache || []).find((t) => t.id === taskId);
      if (!task) return;
      const taskEl = document.getElementById('execute-task-desc');
      if (taskEl) {
        const parts = [task.name];
        if (task.description) parts.push(task.description);
        taskEl.value = parts.join('\n\n');
      }
    });

    on('tasks-new-btn', 'click', () => TasksUI.openCreateModal());
    on('tasks-empty-new-btn', 'click', () => TasksUI.openCreateModal());

    on('schedules-new-btn', 'click', () => SchedulesUI.openCreateModal());

    on('schedule-form-submit', 'click', (e) => {
      e.preventDefault();
      SchedulesUI.save();
    });

    on('schedule-form', 'submit', (e) => {
      e.preventDefault();
      SchedulesUI.save();
    });

    on('webhooks-new-btn', 'click', () => WebhooksUI.openCreateModal());

    on('webhook-form-submit', 'click', (e) => {
      e.preventDefault();
      WebhooksUI.save();
    });

    on('webhook-target-type', 'change', (e) => {
      WebhooksUI._updateTargetSelect(e.target.value);
    });

    on('pipelines-new-btn', 'click', () => PipelinesUI.openCreateModal());

    on('pipeline-form-submit', 'click', (e) => {
      e.preventDefault();
      PipelinesUI.save();
    });

    on('pipeline-add-step-btn', 'click', () => PipelinesUI.addStep());

    on('pipeline-execute-submit', 'click', () => PipelinesUI._executeFromModal());

    on('terminal-clear-btn', 'click', () => {
      Terminal.clear();
      Terminal.disableChat();
    });

    on('terminal-send-btn', 'click', () => App._sendChatMessage());

    on('terminal-input', 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        App._sendChatMessage();
      }
    });

    on('export-copy-btn', 'click', () => App._copyExportJson());

    on('system-status-btn', 'click', () => App.navigateTo('dashboard'));

    on('terminal-execution-select', 'change', (e) => {
      Terminal.setExecutionFilter(e.target.value || null);
    });

    on('settings-form', 'submit', (e) => {
      e.preventDefault();
      SettingsUI.save();
    });

    on('agents-search', 'input', () => {
      AgentsUI.filter(
        document.getElementById('agents-search')?.value,
        document.getElementById('agents-filter-status')?.value
      );
    });

    on('agents-filter-status', 'change', () => {
      AgentsUI.filter(
        document.getElementById('agents-search')?.value,
        document.getElementById('agents-filter-status')?.value
      );
    });

    on('tasks-search', 'input', () => {
      TasksUI.filter(
        document.getElementById('tasks-search')?.value,
        document.getElementById('tasks-filter-category')?.value
      );
    });

    on('tasks-filter-category', 'change', () => {
      TasksUI.filter(
        document.getElementById('tasks-search')?.value,
        document.getElementById('tasks-filter-category')?.value
      );
    });

    on('schedules-search', 'input', () => {
      SchedulesUI.filter(
        document.getElementById('schedules-search')?.value,
        document.getElementById('schedules-filter-status')?.value
      );
    });

    on('schedules-filter-status', 'change', () => {
      SchedulesUI.filter(
        document.getElementById('schedules-search')?.value,
        document.getElementById('schedules-filter-status')?.value
      );
    });

    on('webhooks-search', 'input', () => {
      WebhooksUI.filter(document.getElementById('webhooks-search')?.value);
    });

    on('pipelines-search', 'input', () => {
      PipelinesUI.filter(document.getElementById('pipelines-search')?.value);
    });

    on('history-search', 'input', () => {
      HistoryUI.filter(
        document.getElementById('history-search')?.value,
        document.getElementById('history-filter-type')?.value,
        document.getElementById('history-filter-status')?.value
      );
    });

    on('history-filter-type', 'change', () => {
      HistoryUI.filter(
        document.getElementById('history-search')?.value,
        document.getElementById('history-filter-type')?.value,
        document.getElementById('history-filter-status')?.value
      );
    });

    on('history-filter-status', 'change', () => {
      HistoryUI.filter(
        document.getElementById('history-search')?.value,
        document.getElementById('history-filter-type')?.value,
        document.getElementById('history-filter-status')?.value
      );
    });

    on('history-clear-btn', 'click', () => HistoryUI.clearHistory());

    document.getElementById('agents-grid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const { action, id } = btn.dataset;

      switch (action) {
        case 'execute': AgentsUI.execute(id); break;
        case 'edit': AgentsUI.openEditModal(id); break;
        case 'export': AgentsUI.export(id); break;
        case 'delete': AgentsUI.delete(id); break;
      }
    });

    document.getElementById('tasks-grid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const { action, id } = btn.dataset;

      switch (action) {
        case 'execute-task': TasksUI.execute(id); break;
        case 'edit-task': TasksUI.openEditModal(id); break;
        case 'delete-task': TasksUI.delete(id); break;
      }
    });

    document.getElementById('schedules-tbody')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const { action, id } = btn.dataset;

      switch (action) {
        case 'edit-schedule': SchedulesUI.openEditModal(id); break;
        case 'delete-schedule': SchedulesUI.delete(id); break;
      }
    });

    document.getElementById('schedules-history')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === 'view-schedule-exec') HistoryUI.viewDetail(id);
    });

    document.getElementById('pipelines-grid')?.addEventListener('click', (e) => {
      if (e.target.closest('#pipelines-empty-new-btn')) {
        PipelinesUI.openCreateModal();
        return;
      }

      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const { action, id } = btn.dataset;

      switch (action) {
        case 'execute-pipeline': PipelinesUI.execute(id); break;
        case 'edit-pipeline': PipelinesUI.openEditModal(id); break;
        case 'delete-pipeline': PipelinesUI.delete(id); break;
      }
    });

    document.getElementById('history-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      switch (action) {
        case 'view-execution': HistoryUI.viewDetail(id); break;
        case 'delete-execution': HistoryUI.deleteExecution(id); break;
      }
    });

    document.getElementById('webhooks-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id, url } = btn.dataset;
      switch (action) {
        case 'toggle-webhook': WebhooksUI.toggleActive(id); break;
        case 'delete-webhook': WebhooksUI.delete(id); break;
        case 'copy-webhook-url': WebhooksUI.copyUrl(url); break;
        case 'copy-webhook-curl': WebhooksUI.copyCurl(id); break;
      }
    });

    document.getElementById('pipeline-steps-container')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-step-action]');
      if (!btn) return;

      const stepAction = btn.dataset.stepAction;
      const stepIndex = parseInt(btn.dataset.stepIndex, 10);

      switch (stepAction) {
        case 'move-up': PipelinesUI.moveStep(stepIndex, -1); break;
        case 'move-down': PipelinesUI.moveStep(stepIndex, 1); break;
        case 'remove': PipelinesUI.removeStep(stepIndex); break;
      }
    });

    document.addEventListener('click', (e) => {
      const template = e.target.closest('[data-template]');
      if (template) {
        const taskEl = document.getElementById('execute-task-desc');
        if (taskEl) taskEl.value = template.dataset.template;
        return;
      }

      const cronPreset = e.target.closest('[data-cron]');
      if (cronPreset) {
        const cronEl = document.getElementById('schedule-cron');
        if (cronEl) cronEl.value = cronPreset.dataset.cron;
        return;
      }
    });

    App._setupTagsInput();
  },

  _setupTagsInput() {
    const input = document.getElementById('agent-tags-input');
    const chips = document.getElementById('agent-tags-chips');
    const hidden = document.getElementById('agent-tags');

    if (!input || !chips || !hidden) return;

    const getTags = () => {
      try { return JSON.parse(hidden.value || '[]'); } catch { return []; }
    };

    const setTags = (tags) => {
      hidden.value = JSON.stringify(tags);
      chips.innerHTML = tags.map((t) => `
        <span class="tag-chip">
          ${Utils.escapeHtml(t)}
          <button type="button" class="tag-remove" data-tag="${Utils.escapeHtml(t)}" aria-label="Remover tag ${Utils.escapeHtml(t)}">×</button>
        </span>
      `).join('');
    };

    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();

      const value = input.value.trim().replace(/,$/, '');
      if (!value) return;

      const tags = getTags();
      if (!tags.includes(value)) {
        tags.push(value);
        setTags(tags);
      }

      input.value = '';
    });

    chips.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.tag-remove');
      if (!removeBtn) return;

      const tag = removeBtn.dataset.tag;
      const tags = getTags().filter((t) => t !== tag);
      setTags(tags);
    });
  },

  async _handleExecute() {
    const agentId = document.getElementById('execute-agent-select')?.value
      || document.getElementById('execute-agent-id')?.value;

    if (!agentId) {
      Toast.warning('Selecione um agente para executar');
      return;
    }

    const task = document.getElementById('execute-task-desc')?.value.trim();
    if (!task) {
      Toast.warning('Descreva a tarefa a ser executada');
      return;
    }

    const instructions = document.getElementById('execute-instructions')?.value.trim() || '';

    try {
      const selectEl = document.getElementById('execute-agent-select');
      const agentName = selectEl?.selectedOptions[0]?.text || 'Agente';

      Terminal.disableChat();
      App._lastAgentName = agentName;

      await API.agents.execute(agentId, task, instructions);

      Modal.close('execute-modal-overlay');
      App.navigateTo('terminal');
      Toast.info('Execução iniciada');
      Terminal.startProcessing(agentName);
    } catch (err) {
      Toast.error(`Erro ao iniciar execução: ${err.message}`);
    }
  },

  async _sendChatMessage() {
    const session = Terminal.getChatSession();
    if (!session) return;

    const input = document.getElementById('terminal-input');
    const message = input?.value.trim();
    if (!message) return;

    input.value = '';

    Terminal.addLine(`❯ ${message}`, 'user-message', null);

    try {
      await API.agents.continue(session.agentId, session.sessionId, message);
      Terminal.startProcessing(session.agentName);
    } catch (err) {
      Terminal.addLine(`Erro: ${err.message}`, 'error');
      Toast.error(`Erro ao continuar conversa: ${err.message}`);
    }
  },

  async _copyExportJson() {
    const jsonEl = document.getElementById('export-code-content');
    if (!jsonEl) return;

    try {
      await navigator.clipboard.writeText(jsonEl.textContent);
      Toast.success('JSON copiado para a área de transferência');
    } catch {
      Toast.error('Não foi possível copiar o JSON');
    }
  },

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        Modal.closeAll();
        return;
      }

      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (isTyping) return;

      if (e.key === 'n' || e.key === 'N') {
        if (App.currentSection === 'agents') {
          AgentsUI.openCreateModal();
        }
      }
    });
  },

  async refreshCurrentSection() {
    await App._loadSection(App.currentSection);
  },

  async _updateActiveBadge() {
    try {
      const active = await API.system.activeExecutions();
      const count = Array.isArray(active) ? active.length : 0;

      const badge = document.getElementById('active-executions-badge');
      const countEl = document.getElementById('active-executions-count');

      if (countEl) countEl.textContent = count;
      if (badge) badge.style.display = count > 0 ? 'flex' : 'none';

      const terminalSelect = document.getElementById('terminal-execution-select');
      if (terminalSelect && Array.isArray(active)) {
        const existing = new Set(
          Array.from(terminalSelect.options).map((o) => o.value).filter(Boolean)
        );

        active.forEach((exec) => {
          const execId = exec.executionId || exec.id;
          if (!existing.has(execId)) {
            const option = document.createElement('option');
            option.value = execId;
            const agentName = (exec.agentConfig && exec.agentConfig.agent_name) || exec.agentId || 'Agente';
            option.textContent = `${agentName} — ${new Date(exec.startedAt).toLocaleTimeString('pt-BR')}`;
            terminalSelect.appendChild(option);
          }
        });
      }
    } catch {
      //
    }
  },

  startPeriodicRefresh() {
    setInterval(async () => {
      await App._updateActiveBadge();

      if (App.currentSection === 'dashboard') {
        await DashboardUI.load();
      }
    }, 30000);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

window.App = App;
