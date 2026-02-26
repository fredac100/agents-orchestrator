const App = {
  currentSection: 'dashboard',
  ws: null,
  wsReconnectAttempts: 0,
  wsReconnectTimer: null,
  _initialized: false,

  sectionTitles: {
    dashboard: 'Dashboard',
    agents: 'Agentes',
    tasks: 'Tarefas',
    schedules: 'Agendamentos',
    pipelines: 'Pipelines',
    terminal: 'Terminal',
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
      }
    } catch (err) {
      Toast.error(`Erro ao carregar seção: ${err.message}`);
    }
  },

  setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;

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
      case 'execution_output': {
        Terminal.stopProcessing();
        const content = data.data?.content || '';
        if (content) {
          Terminal.addLine(content, 'default');
        }
        App._updateActiveBadge();
        break;
      }

      case 'execution_complete': {
        Terminal.stopProcessing();
        const result = data.data?.result || '';
        if (result) {
          Terminal.addLine(result, 'success');
        } else {
          Terminal.addLine('Execução concluída (sem resultado textual).', 'info');
        }
        if (data.data?.stderr) {
          Terminal.addLine(data.data.stderr, 'error');
        }
        Toast.success('Execução concluída');
        App.refreshCurrentSection();
        App._updateActiveBadge();
        break;
      }

      case 'execution_error':
        Terminal.stopProcessing();
        Terminal.addLine(data.data?.error || 'Erro na execução', 'error');
        Toast.error(`Erro na execução: ${data.data?.error || 'desconhecido'}`);
        App._updateActiveBadge();
        break;

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

    on('agent-form-submit', 'click', (e) => {
      e.preventDefault();
      AgentsUI.save();
    });

    on('agent-form', 'submit', (e) => {
      e.preventDefault();
      AgentsUI.save();
    });

    on('execute-form-submit', 'click', (e) => {
      e.preventDefault();
      App._handleExecute();
    });

    on('execute-form', 'submit', (e) => {
      e.preventDefault();
      App._handleExecute();
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

    on('pipelines-new-btn', 'click', () => PipelinesUI.openCreateModal());

    on('pipeline-form-submit', 'click', (e) => {
      e.preventDefault();
      PipelinesUI.save();
    });

    on('pipeline-add-step-btn', 'click', () => PipelinesUI.addStep());

    on('pipeline-execute-submit', 'click', () => PipelinesUI._executeFromModal());

    on('terminal-clear-btn', 'click', () => Terminal.clear());

    on('export-copy-btn', 'click', () => App._copyExportJson());

    on('system-status-btn', 'click', () => App.navigateTo('dashboard'));

    on('terminal-execution-select', 'change', (e) => {
      Terminal.setExecutionFilter(e.target.value || null);
    });

    on('settings-form', 'submit', (e) => {
      e.preventDefault();
      Toast.info('Configurações salvas');
    });

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

      if (action === 'delete-task') TasksUI.delete(id);
    });

    document.getElementById('schedules-tbody')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const { action, id } = btn.dataset;

      if (action === 'delete-schedule') SchedulesUI.delete(id);
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
          ${t}
          <button type="button" class="tag-remove" data-tag="${t}" aria-label="Remover tag ${t}">×</button>
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

      await API.agents.execute(agentId, task, instructions);

      Modal.close('execute-modal-overlay');
      App.navigateTo('terminal');
      Toast.info('Execução iniciada');
      Terminal.startProcessing(agentName);
    } catch (err) {
      Toast.error(`Erro ao iniciar execução: ${err.message}`);
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
