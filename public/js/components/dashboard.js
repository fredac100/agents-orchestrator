const DashboardUI = {
  async load() {
    try {
      const [status, agents] = await Promise.all([
        API.system.status(),
        API.agents.list(),
      ]);

      DashboardUI.updateMetrics(status, agents);
      DashboardUI.updateRecentActivity(status.executions?.list || []);
      DashboardUI.updateSystemStatus(status);
    } catch (err) {
      Toast.error(`Erro ao carregar dashboard: ${err.message}`);
    }
  },

  updateMetrics(status, agents) {
    const metrics = {
      'metric-total-agents': status.agents?.total ?? (agents?.length ?? 0),
      'metric-active-agents': status.agents?.active ?? 0,
      'metric-executions-today': status.executions?.active ?? 0,
      'metric-schedules': status.schedules?.total ?? 0,
    };

    for (const [id, target] of Object.entries(metrics)) {
      const el = document.getElementById(id);
      if (!el) continue;

      const current = parseInt(el.textContent, 10) || 0;
      DashboardUI._animateCount(el, current, target);
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
      const time = exec.startedAt
        ? new Date(exec.startedAt).toLocaleTimeString('pt-BR')
        : '—';

      return `
        <li class="activity-item">
          <div class="activity-item-info">
            <span class="activity-item-agent">${exec.agentName || exec.agentId || 'Agente'}</span>
            <span class="activity-item-task">${exec.task || ''}</span>
          </div>
          <div class="activity-item-meta">
            <span class="badge ${statusClass}">${statusLabel}</span>
            <span class="activity-item-time">${time}</span>
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
      cancelled: 'badge--gray',
    };
    return map[status] || 'badge--gray';
  },

  _statusLabel(status) {
    const map = {
      running: 'Em execução',
      completed: 'Concluído',
      error: 'Erro',
      cancelled: 'Cancelado',
    };
    return map[status] || status || 'Desconhecido';
  },
};

window.DashboardUI = DashboardUI;
