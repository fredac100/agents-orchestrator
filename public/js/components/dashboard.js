const DashboardUI = {
  charts: {},

  async load() {
    try {
      const [status, recentExecs] = await Promise.all([
        API.system.status(),
        API.executions.recent(10),
      ]);

      DashboardUI.updateMetrics(status);
      DashboardUI.updateRecentActivity(recentExecs || []);
      DashboardUI.updateSystemStatus(status);
      DashboardUI.setupChartPeriod();
      DashboardUI.loadCharts();
    } catch (err) {
      Toast.error(`Erro ao carregar dashboard: ${err.message}`);
    }
  },

  async loadCharts() {
    try {
      const period = document.getElementById('chart-period');
      const days = period ? parseInt(period.value) : 7;
      const data = await API.stats.charts(days);
      DashboardUI.renderExecutionsChart(data);
      DashboardUI.renderCostChart(data);
      DashboardUI.renderStatusChart(data);
      DashboardUI.renderTopAgentsChart(data);
      DashboardUI.renderSuccessRateChart(data);
    } catch (e) {
      console.error('Erro ao carregar gráficos:', e);
    }
  },

  _cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  },

  renderExecutionsChart(data) {
    const ctx = document.getElementById('executions-chart');
    if (!ctx) return;
    if (DashboardUI.charts.executions) DashboardUI.charts.executions.destroy();

    const labels = (data.labels || []).map(l => {
      const d = new Date(l + 'T12:00:00');
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    });

    DashboardUI.charts.executions = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Sucesso', data: data.successCounts || [], backgroundColor: 'rgba(34, 197, 94, 0.8)', borderRadius: 4 },
          { label: 'Erro', data: data.errorCounts || [], backgroundColor: 'rgba(239, 68, 68, 0.8)', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: DashboardUI._cssVar('--text-secondary'), font: { size: 11 } },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: DashboardUI._cssVar('--text-tertiary'), font: { size: 10 } },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: 'rgba(128,128,128,0.1)' },
            ticks: { color: DashboardUI._cssVar('--text-tertiary'), font: { size: 10 } },
          },
        },
      },
    });
  },

  renderCostChart(data) {
    const ctx = document.getElementById('cost-chart');
    if (!ctx) return;
    if (DashboardUI.charts.cost) DashboardUI.charts.cost.destroy();

    const labels = (data.labels || []).map(l => {
      const d = new Date(l + 'T12:00:00');
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    });

    DashboardUI.charts.cost = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Custo (USD)',
          data: data.costData || [],
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#6366f1',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: DashboardUI._cssVar('--text-tertiary'), font: { size: 10 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(128,128,128,0.1)' },
            ticks: {
              color: DashboardUI._cssVar('--text-tertiary'),
              font: { size: 10 },
              callback: (v) => '$' + v.toFixed(2),
            },
          },
        },
      },
    });
  },

  renderStatusChart(data) {
    const ctx = document.getElementById('status-chart');
    if (!ctx) return;
    if (DashboardUI.charts.status) DashboardUI.charts.status.destroy();

    const dist = data.statusDistribution || {};
    const statuses = Object.keys(dist);
    const values = Object.values(dist);
    const colors = {
      completed: '#22c55e',
      error: '#ef4444',
      running: '#6366f1',
      canceled: '#f59e0b',
      rejected: '#ef4444',
    };

    DashboardUI.charts.status = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: statuses.map(s => s.charAt(0).toUpperCase() + s.slice(1)),
        datasets: [{
          data: values,
          backgroundColor: statuses.map(s => colors[s] || '#94a3b8'),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: DashboardUI._cssVar('--text-secondary'),
              font: { size: 11 },
              padding: 12,
            },
          },
        },
      },
    });
  },

  renderTopAgentsChart(data) {
    const ctx = document.getElementById('agents-chart');
    if (!ctx) return;
    if (DashboardUI.charts.agents) DashboardUI.charts.agents.destroy();

    const top = data.topAgents || [];

    DashboardUI.charts.agents = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top.map(a => a.name.length > 15 ? a.name.substring(0, 15) + '\u2026' : a.name),
        datasets: [{
          data: top.map(a => a.count),
          backgroundColor: ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'],
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: 'rgba(128,128,128,0.1)' },
            ticks: { color: DashboardUI._cssVar('--text-tertiary'), font: { size: 10 } },
          },
          y: {
            grid: { display: false },
            ticks: { color: DashboardUI._cssVar('--text-secondary'), font: { size: 10 } },
          },
        },
      },
    });
  },

  renderSuccessRateChart(data) {
    const ctx = document.getElementById('success-rate-chart');
    if (!ctx) return;
    if (DashboardUI.charts.successRate) DashboardUI.charts.successRate.destroy();

    const dist = data.statusDistribution || {};
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    const success = dist.completed || 0;
    const rate = total > 0 ? Math.round((success / total) * 100) : 0;

    DashboardUI.charts.successRate = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Sucesso', 'Outros'],
        datasets: [{
          data: [rate, 100 - rate],
          backgroundColor: ['#22c55e', 'rgba(128,128,128,0.15)'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1,
        cutout: '75%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [{
        id: 'centerText',
        afterDraw(chart) {
          const { ctx: c, width, height } = chart;
          c.save();
          c.font = 'bold 24px Inter';
          c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(rate + '%', width / 2, height / 2);
          c.restore();
        },
      }],
    });
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
      Utils.refreshIcons(list);
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

  setupChartPeriod() {
    const chartPeriod = document.getElementById('chart-period');
    if (chartPeriod && !chartPeriod._listenerAdded) {
      chartPeriod._listenerAdded = true;
      chartPeriod.addEventListener('change', () => DashboardUI.loadCharts());
    }
  },

  updateSystemStatus(status) {
    const wsBadge = document.getElementById('system-ws-status-badge');
    if (wsBadge) {
      const wsConnected = document.getElementById('ws-indicator')?.classList.contains('ws-indicator--connected');
      wsBadge.textContent = wsConnected ? 'Conectado' : 'Desconectado';
      wsBadge.className = `badge ${wsConnected ? 'badge--green' : 'badge--red'}`;
    }

    const claudeBadge = document.getElementById('system-claude-status-badge');
    if (claudeBadge) {
      API.system.info().then((info) => {
        const available = info.claudeVersion && info.claudeVersion !== 'N/A';
        claudeBadge.textContent = available ? info.claudeVersion : 'Indisponível';
        claudeBadge.className = `badge ${available ? 'badge--green' : 'badge--red'}`;
      }).catch(() => {
        claudeBadge.textContent = 'Indisponível';
        claudeBadge.className = 'badge badge--red';
      });
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
