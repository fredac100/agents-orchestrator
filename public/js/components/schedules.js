const SchedulesUI = {
  schedules: [],

  async load() {
    try {
      SchedulesUI.schedules = await API.schedules.list();
      SchedulesUI.render();
    } catch (err) {
      Toast.error(`Erro ao carregar agendamentos: ${err.message}`);
    }
  },

  render() {
    const tbody = document.getElementById('schedules-tbody');
    if (!tbody) return;

    if (SchedulesUI.schedules.length === 0) {
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

    tbody.innerHTML = SchedulesUI.schedules.map((schedule) => {
      const cronExpr = schedule.cronExpression || schedule.cronExpr || '';
      const statusClass = schedule.active ? 'badge-active' : 'badge-inactive';
      const statusLabel = schedule.active ? 'Ativo' : 'Inativo';
      const humanCron = SchedulesUI.cronToHuman(cronExpr);
      const nextRun = schedule.nextRun
        ? new Date(schedule.nextRun).toLocaleString('pt-BR')
        : '—';

      return `
        <tr>
          <td>${schedule.agentName || schedule.agentId || '—'}</td>
          <td class="schedule-task-cell" title="${schedule.taskDescription || ''}">${schedule.taskDescription || '—'}</td>
          <td>
            <span title="${cronExpr}">${humanCron}</span>
            <small class="font-mono">${cronExpr}</small>
          </td>
          <td>${nextRun}</td>
          <td><span class="badge ${statusClass}">${statusLabel}</span></td>
          <td>
            <button
              class="btn btn-ghost btn-sm btn-danger"
              data-action="delete-schedule"
              data-id="${schedule.taskId}"
              title="Remover agendamento"
              aria-label="Remover agendamento"
            >
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons({ nodes: [tbody] });
  },

  async openCreateModal() {
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

      const taskEl = document.getElementById('schedule-task');
      if (taskEl) taskEl.value = '';

      const cronEl = document.getElementById('schedule-cron');
      if (cronEl) cronEl.value = '';

      Modal.open('schedule-modal-overlay');
    } catch (err) {
      Toast.error(`Erro ao abrir modal de agendamento: ${err.message}`);
    }
  },

  async save() {
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
      await API.schedules.create({ agentId, taskDescription, cronExpression });
      Toast.success('Agendamento criado com sucesso');
      Modal.close('schedule-modal-overlay');
      await SchedulesUI.load();
    } catch (err) {
      Toast.error(`Erro ao criar agendamento: ${err.message}`);
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
    if (minute === '0' && hour !== '*' && day === '*' && month === '*' && weekday === '*') {
      return `Todo dia às ${hour.padStart(2, '0')}h`;
    }

    return expression;
  },
};

window.SchedulesUI = SchedulesUI;
