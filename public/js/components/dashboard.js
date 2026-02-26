const DashboardUI = {
  async load() {
    try {
      const [status, recentExecs] = await Promise.all([
        API.system.status(),
        API.executions.recent(10),
      ]);

      DashboardUI.updateMetrics(status);
      DashboardUI.updateRecentActivity(recentExecs || []);
      DashboardUI.updateSystemStatus(status);
    } catch (err) {
      Toast.error(`Erro ao carregar dashboard: ${err.message}`);
    }
  },

  updateMetrics(status) {
    const metrics = {
      'metric-total-agents': status.agents?.total ?? 0,
      'metric-active-agents': status.agents?.active ?? 0,
      'metric-executions-today': status.executions?.today ?? 0,
      'metric-schedules': status.schedules?.total ?? 0,
    };

    for (const [id, target] of Object.entries(metrics)) {
      const el = document.getElementById(id);
      if (!el) continue;

      const current = parseInt(el.textContent, 10) || 0;
      DashboardUI._animateCount(el, current, target);
    }

    const costEl = document.getElementById('metric-cost-today');
    if (costEl) {
      const cost = status.costs?.today ?? 0;
      costEl.textContent = `$${cost.toFixed(4)}`;
    }

    const webhooksEl = document.getElementById('metric-webhooks');
    if (webhooksEl) {
      const current = parseInt(webhooksEl.textContent, 10) || 0;
      DashboardUI._animateCount(webhooksEl, current, status.webhooks?.active ?? 0);
    }
  },

  _animateCount(el, from, to) {
    const duration = 600;
    const start = performance.now();

    const step = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (to - from) * eased);
      el.textContent = value;

      if (progress < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  },

  updateRecentActivity(executions) {
    const list = document.getElementById('activity-list');
    if (!list) return;

    if (!executions || executions.length === 0) {
      list.innerHTML = `
        <li class="activity-empty">
          <i data-lucide="inbox"></i>
          <span>Nenhuma execução recente</span>
        </li>
      `;
      if (window.lucide) lucide.createIcons({ nodes: [list] });
      return;
    }

    list.innerHTML = executions.map((exec) => {
      const statusClass = DashboardUI._statusBadgeClass(exec.status);
      const statusLabel = DashboardUI._statusLabel(exec.status);
      const name = Utils.escapeHtml(exec.agentName || exec.pipelineName || exec.agentId || 'Execução');
      const taskText = Utils.escapeHtml(exec.task || exec.input || '');
      const typeBadge = exec.type === 'pipeline'
        ? '<span class="badge badge--purple" style="font-size:0.6rem;padding:1px 5px;">Pipeline</span> '
        : '';
      const time = exec.startedAt
        ? new Date(exec.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : '—';
      const date = exec.startedAt
        ? new Date(exec.startedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        : '';
      const cost = exec.costUsd || exec.totalCostUsd || 0;
      const costHtml = cost > 0
        ? `<span class="activity-item-cost">$${cost.toFixed(4)}</span>`
        : '';

      return `
        <li class="activity-item">
          <div class="activity-item-info">
            <span class="activity-item-agent">${typeBadge}${name}</span>
            <span class="activity-item-task">${taskText.length > 80 ? taskText.slice(0, 80) + '...' : taskText}</span>
          </div>
          <div class="activity-item-meta">
            ${costHtml}
            <span class="badge ${statusClass}">${statusLabel}</span>
            <span class="activity-item-time">${date} ${time}</span>
          </div>
        </li>
      `;
    }).join('');
  },

  updateSystemStatus(status) {
    const wsBadge = document.getElementById('system-ws-status-badge');
    if (wsBadge) {
      const wsConnected = document.getElementById('ws-indicator')?.classList.contains('ws-indicator--connected');
      wsBadge.textContent = wsConnected ? 'Conectado' : 'Desconectado';
      wsBadge.className = `badge ${wsConnected ? 'badge--green' : 'badge--red'}`;
    }
  },

  _statusBadgeClass(status) {
    const map = {
      running: 'badge--blue',
      completed: 'badge--green',
      error: 'badge--red',
      canceled: 'badge--gray',
      awaiting_approval: 'badge--yellow',
      rejected: 'badge--red',
    };
    return map[status] || 'badge--gray';
  },

  _statusLabel(status) {
    const map = {
      running: 'Em execução',
      completed: 'Concluído',
      error: 'Erro',
      canceled: 'Cancelado',
      awaiting_approval: 'Aguardando',
      rejected: 'Rejeitado',
    };
    return map[status] || status || 'Desconhecido';
  },
};

window.DashboardUI = DashboardUI;
