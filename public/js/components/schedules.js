const SchedulesUI = {
  schedules: [],

  async load() {
    try {
      SchedulesUI.schedules = await API.schedules.list();
      SchedulesUI.render();
      SchedulesUI.loadHistory();
    } catch (err) {
      Toast.error(`Erro ao carregar agendamentos: ${err.message}`);
    }
  },

  render(filteredSchedules) {
    const tbody = document.getElementById('schedules-tbody');
    if (!tbody) return;

    const schedules = filteredSchedules || SchedulesUI.schedules;

    if (schedules.length === 0) {
      tbody.innerHTML = `
        <tr class="table-empty-row">
          <td colspan="6">
            <div class="empty-state empty-state--inline">
              <i data-lucide="clock"></i>
              <span>Nenhum agendamento configurado</span>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide) lucide.createIcons({ nodes: [tbody] });
      return;
    }

    tbody.innerHTML = schedules.map((schedule) => {
      const cronExpr = schedule.cronExpression || schedule.cronExpr || '';
      const statusClass = schedule.active ? 'badge-active' : 'badge-inactive';
      const statusLabel = schedule.active ? 'Ativo' : 'Inativo';
      const humanCron = SchedulesUI.cronToHuman(cronExpr);
      const nextRun = schedule.nextRun
        ? new Date(schedule.nextRun).toLocaleString('pt-BR')
        : '—';
      const scheduleId = schedule.id || schedule.taskId;

      return `
        <tr>
          <td>${schedule.agentName || '—'}</td>
          <td class="schedule-task-cell" title="${schedule.taskDescription || ''}">${schedule.taskDescription || '—'}</td>
          <td>
            <code class="font-mono">${cronExpr}</code>
          </td>
          <td>${nextRun}</td>
          <td><span class="badge ${statusClass}">${statusLabel}</span></td>
          <td>
            <div class="schedule-actions-cell">
              <button
                class="btn btn-ghost btn-sm"
                data-action="edit-schedule"
                data-id="${scheduleId}"
                title="Editar agendamento"
                aria-label="Editar agendamento"
              >
                <i data-lucide="pencil"></i>
              </button>
              <button
                class="btn btn-ghost btn-sm btn-danger"
                data-action="delete-schedule"
                data-id="${scheduleId}"
                title="Remover agendamento"
                aria-label="Remover agendamento"
              >
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons({ nodes: [tbody] });
  },

  filter(searchText, statusFilter) {
    const search = (searchText || '').toLowerCase();
    const status = statusFilter || '';

    const filtered = SchedulesUI.schedules.filter((s) => {
      const agent = (s.agentName || '').toLowerCase();
      const task = (s.taskDescription || '').toLowerCase();
      const matchesSearch = !search || agent.includes(search) || task.includes(search);
      const matchesStatus = !status ||
        (status === 'active' && s.active) ||
        (status === 'paused' && !s.active);
      return matchesSearch && matchesStatus;
    });

    SchedulesUI.render(filtered);
  },

  async openCreateModal(editSchedule) {
    try {
      const agents = await API.agents.list();
      const select = document.getElementById('schedule-agent');

      if (select) {
        select.innerHTML = '<option value="">Selecionar agente...</option>' +
          agents
            .filter((a) => a.status === 'active')
            .map((a) => `<option value="${a.id}">${a.agent_name || a.name}</option>`)
            .join('');
      }

      const titleEl = document.getElementById('schedule-modal-title');
      const idEl = document.getElementById('schedule-form-id');
      const taskEl = document.getElementById('schedule-task');
      const cronEl = document.getElementById('schedule-cron');

      if (editSchedule) {
        if (titleEl) titleEl.textContent = 'Editar Agendamento';
        if (idEl) idEl.value = editSchedule.id || editSchedule.taskId || '';
        if (select) select.value = editSchedule.agentId || '';
        if (taskEl) taskEl.value = editSchedule.taskDescription || '';
        if (cronEl) cronEl.value = editSchedule.cronExpression || editSchedule.cronExpr || '';
      } else {
        if (titleEl) titleEl.textContent = 'Novo Agendamento';
        if (idEl) idEl.value = '';
        if (taskEl) taskEl.value = '';
        if (cronEl) cronEl.value = '';
      }

      Modal.open('schedule-modal-overlay');
    } catch (err) {
      Toast.error(`Erro ao abrir modal de agendamento: ${err.message}`);
    }
  },

  async openEditModal(scheduleId) {
    const schedule = SchedulesUI.schedules.find(
      (s) => (s.id || s.taskId) === scheduleId
    );
    if (!schedule) return;
    await SchedulesUI.openCreateModal(schedule);
  },

  async save() {
    const scheduleId = document.getElementById('schedule-form-id')?.value.trim();
    const agentId = document.getElementById('schedule-agent')?.value;
    const taskDescription = document.getElementById('schedule-task')?.value.trim();
    const cronExpression = document.getElementById('schedule-cron')?.value.trim();

    if (!agentId) {
      Toast.warning('Selecione um agente');
      return;
    }

    if (!taskDescription) {
      Toast.warning('Descrição da tarefa é obrigatória');
      return;
    }

    if (!cronExpression) {
      Toast.warning('Expressão cron é obrigatória');
      return;
    }

    try {
      if (scheduleId) {
        await API.schedules.update(scheduleId, { agentId, taskDescription, cronExpression });
        Toast.success('Agendamento atualizado com sucesso');
      } else {
        await API.schedules.create({ agentId, taskDescription, cronExpression });
        Toast.success('Agendamento criado com sucesso');
      }
      Modal.close('schedule-modal-overlay');
      await SchedulesUI.load();
    } catch (err) {
      Toast.error(`Erro ao salvar agendamento: ${err.message}`);
    }
  },

  async delete(taskId) {
    const confirmed = await Modal.confirm(
      'Remover agendamento',
      'Tem certeza que deseja remover este agendamento?'
    );

    if (!confirmed) return;

    try {
      await API.schedules.delete(taskId);
      Toast.success('Agendamento removido com sucesso');
      await SchedulesUI.load();
    } catch (err) {
      Toast.error(`Erro ao remover agendamento: ${err.message}`);
    }
  },

  async loadHistory() {
    try {
      const history = await API.schedules.history();
      SchedulesUI.renderHistory(history || []);
    } catch {
    }
  },

  renderHistory(history) {
    const container = document.getElementById('schedules-history');
    if (!container) return;

    if (history.length === 0) {
      container.innerHTML = '<p class="empty-state-desc">Nenhum disparo registrado</p>';
      return;
    }

    container.innerHTML = `
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Agente</th>
              <th scope="col">Tarefa</th>
              <th scope="col">Status</th>
              <th scope="col">Data</th>
              <th scope="col">Duração</th>
              <th scope="col">Custo</th>
              <th scope="col" aria-label="Ações"></th>
            </tr>
          </thead>
          <tbody>
            ${history.map((exec) => {
              const status = SchedulesUI._statusBadge(exec.status);
              const date = exec.startedAt ? new Date(exec.startedAt).toLocaleString('pt-BR') : '—';
              const duration = SchedulesUI._formatDuration(exec.startedAt, exec.endedAt);
              const cost = exec.costUsd || exec.totalCostUsd || 0;
              const costStr = cost > 0 ? `$${cost.toFixed(4)}` : '—';
              const taskStr = SchedulesUI._escapeHtml(SchedulesUI._truncate(exec.task || '', 60));

              return `
                <tr>
                  <td>${SchedulesUI._escapeHtml(exec.agentName || '—')}</td>
                  <td title="${SchedulesUI._escapeHtml(exec.task || '')}">${taskStr}</td>
                  <td>${status}</td>
                  <td>${date}</td>
                  <td>${duration}</td>
                  <td class="font-mono">${costStr}</td>
                  <td>
                    <button class="btn btn-ghost btn-sm" data-action="view-schedule-exec" data-id="${exec.id}" type="button" title="Ver resultado">
                      <i data-lucide="eye"></i>
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    if (window.lucide) lucide.createIcons({ nodes: [container] });
  },

  _statusBadge(status) {
    const map = {
      running: ['badge-running', 'Executando'],
      completed: ['badge-active', 'Concluído'],
      error: ['badge-error', 'Erro'],
    };
    const [cls, label] = map[status] || ['badge-inactive', status || '—'];
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

  _escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  _truncate(str, max) {
    if (!str || str.length <= max) return str;
    return str.slice(0, max) + '…';
  },

  cronToHuman(expression) {
    if (!expression) return '—';

    const presets = {
      '* * * * *': 'A cada minuto',
      '*/5 * * * *': 'A cada 5 minutos',
      '*/10 * * * *': 'A cada 10 minutos',
      '*/15 * * * *': 'A cada 15 minutos',
      '*/30 * * * *': 'A cada 30 minutos',
      '0 * * * *': 'A cada hora',
      '0 */2 * * *': 'A cada 2 horas',
      '0 */6 * * *': 'A cada 6 horas',
      '0 */12 * * *': 'A cada 12 horas',
      '0 0 * * *': 'Todo dia à meia-noite',
      '0 9 * * *': 'Todo dia às 9h',
      '0 18 * * *': 'Todo dia às 18h',
      '0 0 * * 1': 'Toda segunda-feira',
      '0 0 * * 1-5': 'Dias úteis à meia-noite',
      '0 9 * * 1-5': 'Dias úteis às 9h',
      '0 9 * * 1': 'Semanal (seg 09:00)',
      '0 0 1 * *': 'Todo primeiro do mês',
      '0 0 1 1 *': 'Todo 1º de janeiro',
    };

    if (presets[expression]) return presets[expression];

    const parts = expression.split(' ');
    if (parts.length !== 5) return expression;

    const [minute, hour, day, month, weekday] = parts;

    if (minute.startsWith('*/')) return `A cada ${minute.slice(2)} minutos`;
    if (hour.startsWith('*/') && minute === '0') return `A cada ${hour.slice(2)} horas`;
    if (hour !== '*' && day === '*' && month === '*' && weekday === '*') {
      const h = hour.padStart(2, '0');
      if (minute === '0') return `Todo dia às ${h}h`;
      return `Todo dia às ${h}:${minute.padStart(2, '0')}`;
    }

    return expression;
  },
};

window.SchedulesUI = SchedulesUI;
