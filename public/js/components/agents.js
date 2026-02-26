const AgentsUI = {
  agents: [],

  avatarColors: [
    '#6366f1',
    '#8b5cf6',
    '#ec4899',
    '#f59e0b',
    '#10b981',
    '#3b82f6',
    '#ef4444',
    '#14b8a6',
  ],

  async load() {
    try {
      AgentsUI.agents = await API.agents.list();
      AgentsUI.render();
    } catch (err) {
      Toast.error(`Erro ao carregar agentes: ${err.message}`);
    }
  },

  render(filteredAgents) {
    const grid = document.getElementById('agents-grid');
    const empty = document.getElementById('agents-empty-state');

    if (!grid) return;

    const agents = filteredAgents || AgentsUI.agents;

    const existingCards = grid.querySelectorAll('.agent-card');
    existingCards.forEach((c) => c.remove());

    if (agents.length === 0) {
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    const fragment = document.createDocumentFragment();
    agents.forEach((agent) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = AgentsUI.renderCard(agent);
      fragment.appendChild(wrapper.firstElementChild);
    });

    grid.appendChild(fragment);

    if (window.lucide) lucide.createIcons({ nodes: [grid] });
  },

  filter(searchText, statusFilter) {
    const search = (searchText || '').toLowerCase();
    const status = statusFilter || '';

    const filtered = AgentsUI.agents.filter((a) => {
      const name = (a.agent_name || '').toLowerCase();
      const desc = (a.description || '').toLowerCase();
      const tags = (a.tags || []).join(' ').toLowerCase();
      const matchesSearch = !search || name.includes(search) || desc.includes(search) || tags.includes(search);
      const matchesStatus = !status || a.status === status;
      return matchesSearch && matchesStatus;
    });

    AgentsUI.render(filtered);
  },

  renderCard(agent) {
    const name = agent.agent_name || agent.name || 'Sem nome';
    const color = AgentsUI.getAvatarColor(name);
    const initials = AgentsUI.getInitials(name);
    const statusLabel = agent.status === 'active' ? 'Ativo' : 'Inativo';
    const statusClass = agent.status === 'active' ? 'badge-active' : 'badge-inactive';
    const model = (agent.config && agent.config.model) || agent.model || 'claude-sonnet-4-6';
    const updatedAt = AgentsUI.formatDate(agent.updated_at || agent.updatedAt || agent.created_at || agent.createdAt);
    const tags = Array.isArray(agent.tags) && agent.tags.length > 0
      ? `<div class="agent-tags">${agent.tags.map((t) => `<span class="tag-chip tag-chip--sm">${t}</span>`).join('')}</div>`
      : '';

    return `
      <div class="agent-card" data-agent-id="${agent.id}">
        <div class="agent-card-body">
          <div class="agent-card-top">
            <div class="agent-avatar" style="background-color: ${color}" aria-hidden="true">
              <span>${initials}</span>
            </div>
            <div class="agent-info">
              <h3 class="agent-name">${name}</h3>
              <span class="badge ${statusClass}">${statusLabel}</span>
            </div>
          </div>

          ${agent.description ? `<p class="agent-description">${agent.description}</p>` : ''}
          ${tags}

          <div class="agent-meta">
            <span class="agent-meta-item">
              <i data-lucide="cpu"></i>
              ${model}
            </span>
            <span class="agent-meta-item">
              <i data-lucide="clock"></i>
              ${updatedAt}
            </span>
          </div>
        </div>

        <div class="agent-actions">
          <button class="btn btn-primary btn-sm" data-action="execute" data-id="${agent.id}">
            <i data-lucide="play"></i>
            Executar
          </button>
          <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${agent.id}">
            <i data-lucide="pencil"></i>
            Editar
          </button>
          <button class="btn btn-ghost btn-icon btn-sm" data-action="export" data-id="${agent.id}" title="Exportar agente">
            <i data-lucide="download"></i>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm btn-danger" data-action="delete" data-id="${agent.id}" title="Excluir agente">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
  },

  openCreateModal() {
    const form = document.getElementById('agent-form');
    if (form) form.reset();

    const idField = document.getElementById('agent-form-id');
    if (idField) idField.value = '';

    const titleEl = document.getElementById('agent-modal-title');
    if (titleEl) titleEl.textContent = 'Novo Agente';

    const toggle = document.getElementById('agent-status-toggle');
    if (toggle) toggle.checked = true;

    const tagsHidden = document.getElementById('agent-tags');
    if (tagsHidden) tagsHidden.value = '[]';

    const tagsChips = document.getElementById('agent-tags-chips');
    if (tagsChips) tagsChips.innerHTML = '';

    const allowedTools = document.getElementById('agent-allowed-tools');
    if (allowedTools) allowedTools.value = '';

    const maxTurns = document.getElementById('agent-max-turns');
    if (maxTurns) maxTurns.value = '0';

    const permissionMode = document.getElementById('agent-permission-mode');
    if (permissionMode) permissionMode.value = '';

    Modal.open('agent-modal-overlay');
  },

  async openEditModal(agentId) {
    try {
      const agent = await API.agents.get(agentId);

      const titleEl = document.getElementById('agent-modal-title');
      if (titleEl) titleEl.textContent = 'Editar Agente';

      const fields = {
        'agent-form-id': agent.id,
        'agent-name': agent.agent_name || agent.name || '',
        'agent-description': agent.description || '',
        'agent-system-prompt': (agent.config && agent.config.systemPrompt) || '',
        'agent-model': (agent.config && agent.config.model) || 'claude-sonnet-4-6',
        'agent-workdir': (agent.config && agent.config.workingDirectory) || '',
        'agent-allowed-tools': (agent.config && agent.config.allowedTools) || '',
        'agent-max-turns': (agent.config && agent.config.maxTurns) || 0,
        'agent-permission-mode': (agent.config && agent.config.permissionMode) || '',
      };

      for (const [fieldId, value] of Object.entries(fields)) {
        const el = document.getElementById(fieldId);
        if (el) el.value = value;
      }

      const toggle = document.getElementById('agent-status-toggle');
      if (toggle) toggle.checked = agent.status === 'active';

      const tags = Array.isArray(agent.tags) ? agent.tags : [];
      const tagsHidden = document.getElementById('agent-tags');
      if (tagsHidden) tagsHidden.value = JSON.stringify(tags);

      const tagsChips = document.getElementById('agent-tags-chips');
      if (tagsChips) {
        tagsChips.innerHTML = tags.map((t) =>
          `<span class="tag-chip">${t}<button type="button" data-tag="${t}" class="tag-remove" aria-label="Remover tag ${t}">×</button></span>`
        ).join('');
      }

      Modal.open('agent-modal-overlay');
    } catch (err) {
      Toast.error(`Erro ao carregar agente: ${err.message}`);
    }
  },

  async save() {
    const idEl = document.getElementById('agent-form-id');
    const id = idEl ? idEl.value.trim() : '';

    const nameEl = document.getElementById('agent-name');
    if (!nameEl || !nameEl.value.trim()) {
      Toast.warning('Nome do agente é obrigatório');
      return;
    }

    const tagsHidden = document.getElementById('agent-tags');
    let tags = [];
    try {
      tags = JSON.parse(tagsHidden?.value || '[]');
    } catch {
      tags = [];
    }

    const toggle = document.getElementById('agent-status-toggle');

    const data = {
      agent_name: nameEl.value.trim(),
      description: document.getElementById('agent-description')?.value.trim() || '',
      tags,
      status: toggle && toggle.checked ? 'active' : 'inactive',
      config: {
        systemPrompt: document.getElementById('agent-system-prompt')?.value.trim() || '',
        model: document.getElementById('agent-model')?.value || 'claude-sonnet-4-6',
        workingDirectory: document.getElementById('agent-workdir')?.value.trim() || '',
        allowedTools: document.getElementById('agent-allowed-tools')?.value.trim() || '',
        maxTurns: parseInt(document.getElementById('agent-max-turns')?.value) || 0,
        permissionMode: document.getElementById('agent-permission-mode')?.value || '',
      },
    };

    try {
      if (id) {
        await API.agents.update(id, data);
        Toast.success('Agente atualizado com sucesso');
      } else {
        await API.agents.create(data);
        Toast.success('Agente criado com sucesso');
      }

      Modal.close('agent-modal-overlay');
      await AgentsUI.load();
    } catch (err) {
      Toast.error(`Erro ao salvar agente: ${err.message}`);
    }
  },

  async delete(agentId) {
    const confirmed = await Modal.confirm(
      'Excluir agente',
      'Tem certeza que deseja excluir este agente? Esta ação não pode ser desfeita.'
    );

    if (!confirmed) return;

    try {
      await API.agents.delete(agentId);
      Toast.success('Agente excluído com sucesso');
      await AgentsUI.load();
    } catch (err) {
      Toast.error(`Erro ao excluir agente: ${err.message}`);
    }
  },

  async execute(agentId) {
    try {
      const allAgents = AgentsUI.agents.length > 0 ? AgentsUI.agents : await API.agents.list();
      const selectEl = document.getElementById('execute-agent-select');

      if (selectEl) {
        selectEl.innerHTML = '<option value="">Selecionar agente...</option>' +
          allAgents
            .filter((a) => a.status === 'active')
            .map((a) => `<option value="${a.id}">${a.agent_name || a.name}</option>`)
            .join('');

        selectEl.value = agentId;
      }

      const hiddenId = document.getElementById('execute-agent-id');
      if (hiddenId) hiddenId.value = agentId;

      const taskEl = document.getElementById('execute-task-desc');
      if (taskEl) taskEl.value = '';

      const instructionsEl = document.getElementById('execute-instructions');
      if (instructionsEl) instructionsEl.value = '';

      Modal.open('execute-modal-overlay');
    } catch (err) {
      Toast.error(`Erro ao abrir modal de execução: ${err.message}`);
    }
  },

  async export(agentId) {
    try {
      const data = await API.agents.export(agentId);
      const jsonEl = document.getElementById('export-code-content');
      if (jsonEl) jsonEl.textContent = JSON.stringify(data, null, 2);
      Modal.open('export-modal-overlay');
    } catch (err) {
      Toast.error(`Erro ao exportar agente: ${err.message}`);
    }
  },

  openImportModal() {
    const textarea = document.getElementById('import-json-content');
    if (textarea) textarea.value = '';
    Modal.open('import-modal-overlay');
  },

  async importAgent() {
    const textarea = document.getElementById('import-json-content');
    if (!textarea || !textarea.value.trim()) {
      Toast.warning('Cole o JSON do agente para importar');
      return;
    }

    let data;
    try {
      data = JSON.parse(textarea.value.trim());
    } catch {
      Toast.error('JSON inválido');
      return;
    }

    try {
      await API.agents.import(data);
      Toast.success('Agente importado com sucesso');
      Modal.close('import-modal-overlay');
      await AgentsUI.load();
    } catch (err) {
      Toast.error(`Erro ao importar agente: ${err.message}`);
    }
  },

  getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AgentsUI.avatarColors.length;
    return AgentsUI.avatarColors[index];
  },

  getInitials(name) {
    return name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  },

  formatDate(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  },
};

window.AgentsUI = AgentsUI;
