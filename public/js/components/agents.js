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

    const sorted = [...agents].sort((a, b) => {
      const rank = (agent) => {
        const name = (agent.agent_name || agent.name || '').toLowerCase();
        const tags = (agent.tags || []).map((t) => t.toLowerCase());
        if (name === 'tech lead' || tags.includes('lider')) return 0;
        if (name === 'product owner' || tags.includes('po') || tags.includes('product-owner')) return 1;
        return 2;
      };
      return rank(a) - rank(b);
    });

    const fragment = document.createDocumentFragment();
    sorted.forEach((agent) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = AgentsUI.renderCard(agent);
      fragment.appendChild(wrapper.firstElementChild);
    });

    grid.appendChild(fragment);

    Utils.refreshIcons(grid);
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
      ? `<div class="agent-tags">${agent.tags.map((t) => `<span class="tag-chip tag-chip--sm">${Utils.escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    const agentNameLower = (agent.agent_name || agent.name || '').toLowerCase();
    const tagsLower = Array.isArray(agent.tags) ? agent.tags.map((t) => t.toLowerCase()) : [];
    const isLeader = agentNameLower === 'tech lead' || tagsLower.includes('lider');
    const isPO = !isLeader && (agentNameLower === 'product owner' || tagsLower.includes('po') || tagsLower.includes('product-owner'));
    const roleClass = isLeader ? ' agent-card--leader' : isPO ? ' agent-card--po' : '';
    const roleBadge = isLeader
      ? '<i data-lucide="crown" class="agent-leader-icon"></i>'
      : isPO
        ? '<i data-lucide="shield-check" class="agent-po-icon"></i>'
        : '';

    return `
      <div class="agent-card${roleClass}" data-agent-id="${agent.id}">
        <div class="agent-card-body">
          <div class="agent-card-top">
            <div class="agent-avatar" style="background-color: ${color}" aria-hidden="true">
              <span>${initials}</span>
            </div>
            <div class="agent-info">
              <h3 class="agent-name">${roleBadge}${Utils.escapeHtml(name)}</h3>
              <span class="badge ${statusClass}">${statusLabel}</span>
            </div>
          </div>

          ${agent.description ? `<p class="agent-description">${Utils.escapeHtml(agent.description)}</p>` : ''}
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
          <div class="agent-actions-icons">
            <button class="btn btn-ghost btn-icon btn-sm" data-action="edit" data-id="${agent.id}" title="Editar agente">
              <i data-lucide="pencil"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm" data-action="duplicate" data-id="${agent.id}" title="Duplicar agente">
              <i data-lucide="copy"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm" data-action="export" data-id="${agent.id}" title="Exportar agente">
              <i data-lucide="download"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm" data-action="versions" data-id="${agent.id}" title="Histórico de versões">
              <i data-lucide="history"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm btn-danger" data-action="delete" data-id="${agent.id}" title="Excluir agente">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
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

    const retryToggle = document.getElementById('agent-retry-toggle');
    if (retryToggle) retryToggle.checked = false;

    const retryMaxGroup = document.getElementById('agent-retry-max-group');
    if (retryMaxGroup) retryMaxGroup.style.display = 'none';

    const retryMax = document.getElementById('agent-retry-max');
    if (retryMax) retryMax.value = '3';

    const secretsSection = document.getElementById('agent-secrets-section');
    if (secretsSection) secretsSection.hidden = true;

    const secretsList = document.getElementById('agent-secrets-list');
    if (secretsList) secretsList.innerHTML = '';

    Modal.open('agent-modal-overlay');
    AgentsUI._setupModalListeners();
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

      const retryToggle = document.getElementById('agent-retry-toggle');
      const retryOnFailure = agent.config && agent.config.retryOnFailure;
      if (retryToggle) retryToggle.checked = !!retryOnFailure;

      const retryMaxGroup = document.getElementById('agent-retry-max-group');
      if (retryMaxGroup) retryMaxGroup.style.display = retryOnFailure ? '' : 'none';

      const retryMax = document.getElementById('agent-retry-max');
      if (retryMax) retryMax.value = (agent.config && agent.config.maxRetries) || '3';

      const secretsSection = document.getElementById('agent-secrets-section');
      if (secretsSection) secretsSection.hidden = false;

      AgentsUI._loadSecrets(agent.id);

      Modal.open('agent-modal-overlay');
      AgentsUI._setupModalListeners();
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
        retryOnFailure: !!document.getElementById('agent-retry-toggle')?.checked,
        maxRetries: parseInt(document.getElementById('agent-retry-max')?.value) || 3,
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
            .map((a) => `<option value="${a.id}">${Utils.escapeHtml(a.agent_name || a.name)}</option>`)
            .join('');

        selectEl.value = agentId;
      }

      const hiddenId = document.getElementById('execute-agent-id');
      if (hiddenId) hiddenId.value = agentId;

      const taskEl = document.getElementById('execute-task-desc');
      if (taskEl) taskEl.value = '';

      const instructionsEl = document.getElementById('execute-instructions');
      if (instructionsEl) instructionsEl.value = '';

      if (App._executeDropzone) App._executeDropzone.reset();

      AgentsUI._loadSavedTasks();

      Modal.open('execute-modal-overlay');
    } catch (err) {
      Toast.error(`Erro ao abrir modal de execução: ${err.message}`);
    }
  },

  async _loadSavedTasks() {
    const savedTaskSelect = document.getElementById('execute-saved-task');
    if (!savedTaskSelect) return;

    try {
      const tasks = await API.tasks.list();
      savedTaskSelect.innerHTML = '<option value="">Digitar manualmente...</option>' +
        tasks.map((t) => {
          const label = t.category ? `[${t.category.toUpperCase()}] ${t.name}` : t.name;
          return `<option value="${t.id}">${Utils.escapeHtml(label)}</option>`;
        }).join('');
      AgentsUI._savedTasksCache = tasks;
    } catch {
      savedTaskSelect.innerHTML = '<option value="">Digitar manualmente...</option>';
      AgentsUI._savedTasksCache = [];
    }
  },

  _savedTasksCache: [],

  async duplicate(agentId) {
    try {
      await API.agents.duplicate(agentId);
      Toast.success('Agente duplicado com sucesso');
      await AgentsUI.load();
    } catch (err) {
      Toast.error(`Erro ao duplicar agente: ${err.message}`);
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

  _setupModalListeners() {
    const retryToggle = document.getElementById('agent-retry-toggle');
    const retryMaxGroup = document.getElementById('agent-retry-max-group');

    if (retryToggle && !retryToggle._listenerAdded) {
      retryToggle._listenerAdded = true;
      retryToggle.addEventListener('change', () => {
        if (retryMaxGroup) retryMaxGroup.style.display = retryToggle.checked ? '' : 'none';
      });
    }

    const addSecretBtn = document.getElementById('agent-secret-add-btn');
    if (addSecretBtn && !addSecretBtn._listenerAdded) {
      addSecretBtn._listenerAdded = true;
      addSecretBtn.addEventListener('click', () => {
        const agentId = document.getElementById('agent-form-id')?.value;
        if (agentId) {
          AgentsUI._addSecret(agentId);
        } else {
          Toast.warning('Salve o agente primeiro para adicionar secrets');
        }
      });
    }
  },

  async _loadSecrets(agentId) {
    const list = document.getElementById('agent-secrets-list');
    if (!list) return;

    try {
      const secrets = await API.secrets.list(agentId);
      const items = Array.isArray(secrets) ? secrets : (secrets?.secrets || []);

      if (items.length === 0) {
        list.innerHTML = '<p class="text-muted text-sm">Nenhum secret configurado.</p>';
        return;
      }

      list.innerHTML = items.map(s => `
        <div class="secret-item">
          <span class="secret-name font-mono">${Utils.escapeHtml(s.name || s)}</span>
          <span class="secret-value-placeholder">••••••••</span>
          <button type="button" class="btn btn-ghost btn-icon btn-sm btn-danger" data-secret-delete="${Utils.escapeHtml(s.name || s)}" data-agent-id="${agentId}" title="Remover secret">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      `).join('');

      Utils.refreshIcons(list);

      list.querySelectorAll('[data-secret-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
          AgentsUI._deleteSecret(btn.dataset.agentId, btn.dataset.secretDelete);
        });
      });
    } catch {
      list.innerHTML = '<p class="text-muted text-sm">Erro ao carregar secrets.</p>';
    }
  },

  async _addSecret(agentId) {
    const nameEl = document.getElementById('agent-secret-name');
    const valueEl = document.getElementById('agent-secret-value');
    const name = nameEl?.value.trim();
    const value = valueEl?.value;

    if (!name) {
      Toast.warning('Nome do secret é obrigatório');
      return;
    }

    if (!value) {
      Toast.warning('Valor do secret é obrigatório');
      return;
    }

    try {
      await API.secrets.create(agentId, { name, value });
      Toast.success(`Secret "${name}" salvo`);
      if (nameEl) nameEl.value = '';
      if (valueEl) valueEl.value = '';
      AgentsUI._loadSecrets(agentId);
    } catch (err) {
      Toast.error(`Erro ao salvar secret: ${err.message}`);
    }
  },

  async _deleteSecret(agentId, secretName) {
    const confirmed = await Modal.confirm(
      'Remover secret',
      `Tem certeza que deseja remover o secret "${secretName}"?`
    );
    if (!confirmed) return;

    try {
      await API.secrets.delete(agentId, secretName);
      Toast.success(`Secret "${secretName}" removido`);
      AgentsUI._loadSecrets(agentId);
    } catch (err) {
      Toast.error(`Erro ao remover secret: ${err.message}`);
    }
  },

  async openVersionsModal(agentId) {
    const agent = AgentsUI.agents.find(a => a.id === agentId);
    const titleEl = document.getElementById('agent-versions-title');
    const contentEl = document.getElementById('agent-versions-content');

    if (titleEl) titleEl.textContent = `Versões — ${agent?.agent_name || agent?.name || 'Agente'}`;

    if (contentEl) {
      contentEl.innerHTML = '<div class="flex flex-center gap-8"><div class="spinner"></div><span class="text-secondary">Carregando versões...</span></div>';
    }

    Modal.open('agent-versions-modal-overlay');

    try {
      const versions = await API.versions.list(agentId);
      const items = Array.isArray(versions) ? versions : (versions?.versions || []);

      if (!contentEl) return;

      if (items.length === 0) {
        contentEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="history"></i></div>
            <h3 class="empty-state-title">Sem histórico de versões</h3>
            <p class="empty-state-desc">As alterações neste agente serão registradas aqui automaticamente.</p>
          </div>`;
        Utils.refreshIcons(contentEl);
        return;
      }

      contentEl.innerHTML = `
        <div class="versions-timeline">
          ${items.map((v, i) => {
            const date = v.changedAt ? new Date(v.changedAt).toLocaleString('pt-BR') : '—';
            const changedFields = AgentsUI._getChangedFields(v);
            const isLatest = i === 0;

            return `
              <div class="version-item ${isLatest ? 'version-item--latest' : ''}">
                <div class="version-node">
                  <div class="version-dot ${isLatest ? 'version-dot--active' : ''}"></div>
                  ${i < items.length - 1 ? '<div class="version-line"></div>' : ''}
                </div>
                <div class="version-content">
                  <div class="version-header">
                    <span class="version-number">v${v.version || items.length - i}</span>
                    <span class="version-date">${date}</span>
                    ${!isLatest ? `<button class="btn btn-ghost btn-sm" data-restore-version="${v.version || items.length - i}" data-agent-id="${agentId}" type="button">
                      <i data-lucide="undo-2"></i> Restaurar
                    </button>` : '<span class="badge badge-active">Atual</span>'}
                  </div>
                  ${changedFields ? `<div class="version-changes">${changedFields}</div>` : ''}
                  ${v.changelog ? `<p class="version-changelog">${Utils.escapeHtml(v.changelog)}</p>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>`;

      Utils.refreshIcons(contentEl);

      contentEl.querySelectorAll('[data-restore-version]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const version = btn.dataset.restoreVersion;
          const aid = btn.dataset.agentId;
          const confirmed = await Modal.confirm(
            'Restaurar versão',
            `Deseja restaurar a versão v${version} deste agente? A configuração atual será substituída.`
          );
          if (!confirmed) return;

          try {
            await API.versions.restore(aid, version);
            Toast.success(`Versão v${version} restaurada`);
            Modal.close('agent-versions-modal-overlay');
            await AgentsUI.load();
          } catch (err) {
            Toast.error(`Erro ao restaurar versão: ${err.message}`);
          }
        });
      });
    } catch (err) {
      if (contentEl) {
        contentEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="alert-circle"></i></div>
            <h3 class="empty-state-title">Erro ao carregar versões</h3>
            <p class="empty-state-desc">${Utils.escapeHtml(err.message)}</p>
          </div>`;
        Utils.refreshIcons(contentEl);
      }
    }
  },

  _getChangedFields(version) {
    if (!version.config) return '';
    const fieldLabels = {
      systemPrompt: 'System Prompt',
      model: 'Modelo',
      workingDirectory: 'Diretório',
      allowedTools: 'Ferramentas',
      maxTurns: 'Max Turns',
      permissionMode: 'Permission Mode',
      retryOnFailure: 'Retry',
    };

    const fields = Object.keys(version.config || {}).filter(k => fieldLabels[k]);
    if (fields.length === 0) return '';

    return fields.map(f =>
      `<span class="version-field-badge">${fieldLabels[f] || f}</span>`
    ).join('');
  },
};

window.AgentsUI = AgentsUI;
