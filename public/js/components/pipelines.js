const PipelinesUI = {
  pipelines: [],
  agents: [],
  _editingId: null,
  _steps: [],
  _pendingApprovals: new Map(),

  async load() {
    try {
      const [pipelines, agents] = await Promise.all([
        API.pipelines.list(),
        API.agents.list(),
      ]);
      PipelinesUI.pipelines = Array.isArray(pipelines) ? pipelines : [];
      PipelinesUI.agents = Array.isArray(agents) ? agents : [];
      PipelinesUI.render();
    } catch (err) {
      Toast.error(`Erro ao carregar pipelines: ${err.message}`);
    }
  },

  filter(searchText) {
    const search = (searchText || '').toLowerCase();
    const filtered = PipelinesUI.pipelines.filter((p) => {
      const name = (p.name || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      return !search || name.includes(search) || desc.includes(search);
    });
    PipelinesUI.render(filtered);
  },

  render(filteredPipelines) {
    const grid = document.getElementById('pipelines-grid');
    if (!grid) return;

    const pipelines = filteredPipelines || PipelinesUI.pipelines;

    const existingCards = grid.querySelectorAll('.pipeline-card');
    existingCards.forEach((c) => c.remove());

    const emptyState = grid.querySelector('.empty-state');

    if (pipelines.length === 0) {
      if (!emptyState) {
        grid.insertAdjacentHTML('beforeend', PipelinesUI.renderEmpty());
      }
      Utils.refreshIcons(grid);
      return;
    }

    if (emptyState) emptyState.remove();

    const fragment = document.createDocumentFragment();
    pipelines.forEach((pipeline) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = PipelinesUI.renderCard(pipeline);
      fragment.appendChild(wrapper.firstElementChild);
    });

    grid.appendChild(fragment);

    Utils.refreshIcons(grid);
  },

  renderEmpty() {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">
          <i data-lucide="git-merge"></i>
        </div>
        <h3 class="empty-state-title">Nenhum pipeline cadastrado</h3>
        <p class="empty-state-desc">Crie seu primeiro pipeline para encadear agentes em fluxos automatizados.</p>
        <button class="btn btn--primary btn--icon-text" type="button" id="pipelines-empty-new-btn">
          <i data-lucide="plus"></i>
          <span>Criar Pipeline</span>
        </button>
      </div>
    `;
  },

  renderCard(pipeline) {
    const steps = Array.isArray(pipeline.steps) ? pipeline.steps : [];
    const stepCount = steps.length;

    const flowHtml = steps.map((step, index) => {
      const agentName = Utils.escapeHtml(step.agentName || step.agentId || 'Agente');
      const isLast = index === steps.length - 1;
      const approvalIcon = step.requiresApproval && index > 0
        ? '<i data-lucide="shield-check" style="width:10px;height:10px;color:var(--warning)"></i> '
        : '';
      return `
        <span class="pipeline-step-badge">
          <span class="pipeline-step-number">${index + 1}</span>
          ${approvalIcon}${agentName}
        </span>
        ${!isLast ? '<span class="pipeline-flow-arrow">→</span>' : ''}
      `;
    }).join('');

    return `
      <div class="agent-card pipeline-card" data-pipeline-id="${pipeline.id}">
        <div class="agent-card-body">
          <div class="agent-card-top">
            <div class="agent-info">
              <h3 class="agent-name">${Utils.escapeHtml(pipeline.name || 'Sem nome')}</h3>
              <span class="badge badge-active">${stepCount} ${stepCount === 1 ? 'passo' : 'passos'}</span>
            </div>
          </div>

          ${pipeline.description ? `<p class="agent-description">${Utils.escapeHtml(pipeline.description)}</p>` : ''}

          <div class="pipeline-flow">
            ${flowHtml || '<span class="agent-description">Nenhum passo configurado</span>'}
          </div>
        </div>

        <div class="agent-actions">
          <button class="btn btn-primary btn-sm" data-action="execute-pipeline" data-id="${pipeline.id}">
            <i data-lucide="play"></i>
            Executar
          </button>
          <button class="btn btn-ghost btn-sm" data-action="edit-pipeline" data-id="${pipeline.id}">
            <i data-lucide="pencil"></i>
            Editar
          </button>
          <button class="btn btn-ghost btn-icon btn-sm btn-danger" data-action="delete-pipeline" data-id="${pipeline.id}" title="Excluir pipeline">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
  },

  openCreateModal() {
    PipelinesUI._editingId = null;
    PipelinesUI._steps = [
      { agentId: '', inputTemplate: '', requiresApproval: false },
      { agentId: '', inputTemplate: '', requiresApproval: false },
    ];

    const titleEl = document.getElementById('pipeline-modal-title');
    if (titleEl) titleEl.textContent = 'Novo Pipeline';

    const idEl = document.getElementById('pipeline-form-id');
    if (idEl) idEl.value = '';

    const nameEl = document.getElementById('pipeline-name');
    if (nameEl) nameEl.value = '';

    const descEl = document.getElementById('pipeline-description');
    if (descEl) descEl.value = '';

    PipelinesUI.renderSteps();
    Modal.open('pipeline-modal-overlay');
  },

  async openEditModal(pipelineId) {
    try {
      const pipeline = await API.pipelines.get(pipelineId);

      PipelinesUI._editingId = pipelineId;
      PipelinesUI._steps = Array.isArray(pipeline.steps)
        ? pipeline.steps.map((s) => ({ agentId: s.agentId || '', inputTemplate: s.inputTemplate || '', requiresApproval: !!s.requiresApproval }))
        : [];

      const titleEl = document.getElementById('pipeline-modal-title');
      if (titleEl) titleEl.textContent = 'Editar Pipeline';

      const idEl = document.getElementById('pipeline-form-id');
      if (idEl) idEl.value = pipeline.id;

      const nameEl = document.getElementById('pipeline-name');
      if (nameEl) nameEl.value = pipeline.name || '';

      const descEl = document.getElementById('pipeline-description');
      if (descEl) descEl.value = pipeline.description || '';

      PipelinesUI.renderSteps();
      Modal.open('pipeline-modal-overlay');
    } catch (err) {
      Toast.error(`Erro ao carregar pipeline: ${err.message}`);
    }
  },

  renderSteps() {
    const container = document.getElementById('pipeline-steps-container');
    if (!container) return;

    if (PipelinesUI._steps.length === 0) {
      container.innerHTML = '';
      return;
    }

    const agentOptions = PipelinesUI.agents
      .map((a) => `<option value="${a.id}">${Utils.escapeHtml(a.agent_name || a.name)}</option>`)
      .join('');

    container.innerHTML = PipelinesUI._steps.map((step, index) => {
      const isFirst = index === 0;
      const isLast = index === PipelinesUI._steps.length - 1;
      const connectorHtml = !isLast
        ? '<div class="pipeline-step-connector"><i data-lucide="arrow-down" style="width:14px;height:14px"></i></div>'
        : '';

      const approvalChecked = step.requiresApproval ? 'checked' : '';
      const approvalHtml = index > 0
        ? `<label class="pipeline-step-approval">
            <input type="checkbox" data-step-field="requiresApproval" data-step-index="${index}" ${approvalChecked} />
            <i data-lucide="shield-check" style="width:12px;height:12px"></i>
            <span>Requer aprovação</span>
          </label>`
        : '';

      return `
        <div class="pipeline-step-row" data-step-index="${index}">
          <span class="pipeline-step-number-lg">${index + 1}</span>
          <div class="pipeline-step-content">
            <select class="select" data-step-field="agentId" data-step-index="${index}">
              <option value="">Selecionar agente...</option>
              ${agentOptions}
            </select>
            <textarea
              class="textarea"
              rows="2"
              placeholder="{{input}} será substituído pelo output anterior"
              data-step-field="inputTemplate"
              data-step-index="${index}"
            >${Utils.escapeHtml(step.inputTemplate || '')}</textarea>
            ${approvalHtml}
          </div>
          <div class="pipeline-step-actions">
            <button class="btn btn-ghost btn-icon btn-sm" type="button" data-step-action="move-up" data-step-index="${index}" title="Mover para cima" ${isFirst ? 'disabled' : ''}>
              <i data-lucide="chevron-up" style="width:14px;height:14px"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm" type="button" data-step-action="move-down" data-step-index="${index}" title="Mover para baixo" ${isLast ? 'disabled' : ''}>
              <i data-lucide="chevron-down" style="width:14px;height:14px"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm btn-danger" type="button" data-step-action="remove" data-step-index="${index}" title="Remover passo">
              <i data-lucide="x" style="width:14px;height:14px"></i>
            </button>
          </div>
        </div>
        ${connectorHtml}
      `;
    }).join('');

    container.querySelectorAll('select[data-step-field="agentId"]').forEach((select) => {
      const index = parseInt(select.dataset.stepIndex, 10);
      select.value = PipelinesUI._steps[index].agentId || '';
    });

    Utils.refreshIcons(container);
  },

  _syncStepsFromDOM() {
    const container = document.getElementById('pipeline-steps-container');
    if (!container) return;

    container.querySelectorAll('[data-step-field]').forEach((el) => {
      const index = parseInt(el.dataset.stepIndex, 10);
      const field = el.dataset.stepField;
      if (PipelinesUI._steps[index] !== undefined) {
        if (el.type === 'checkbox') {
          PipelinesUI._steps[index][field] = el.checked;
        } else {
          PipelinesUI._steps[index][field] = el.value;
        }
      }
    });
  },

  addStep() {
    PipelinesUI._syncStepsFromDOM();
    PipelinesUI._steps.push({ agentId: '', inputTemplate: '', requiresApproval: false });
    PipelinesUI.renderSteps();
  },

  removeStep(index) {
    PipelinesUI._syncStepsFromDOM();
    PipelinesUI._steps.splice(index, 1);
    PipelinesUI.renderSteps();
  },

  moveStep(index, direction) {
    PipelinesUI._syncStepsFromDOM();
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= PipelinesUI._steps.length) return;
    const temp = PipelinesUI._steps[index];
    PipelinesUI._steps[index] = PipelinesUI._steps[targetIndex];
    PipelinesUI._steps[targetIndex] = temp;
    PipelinesUI.renderSteps();
  },

  async save() {
    PipelinesUI._syncStepsFromDOM();

    const name = document.getElementById('pipeline-name')?.value.trim();
    if (!name) {
      Toast.warning('Nome do pipeline é obrigatório');
      return;
    }

    if (PipelinesUI._steps.length < 2) {
      Toast.warning('O pipeline precisa de pelo menos 2 passos');
      return;
    }

    const invalidStep = PipelinesUI._steps.find((s) => !s.agentId);
    if (invalidStep) {
      Toast.warning('Todos os passos devem ter um agente selecionado');
      return;
    }

    const data = {
      name,
      description: document.getElementById('pipeline-description')?.value.trim() || '',
      steps: PipelinesUI._steps.map((s) => ({
        agentId: s.agentId,
        inputTemplate: s.inputTemplate || '',
        requiresApproval: !!s.requiresApproval,
      })),
    };

    try {
      if (PipelinesUI._editingId) {
        await API.pipelines.update(PipelinesUI._editingId, data);
        Toast.success('Pipeline atualizado com sucesso');
      } else {
        await API.pipelines.create(data);
        Toast.success('Pipeline criado com sucesso');
      }

      Modal.close('pipeline-modal-overlay');
      await PipelinesUI.load();
    } catch (err) {
      Toast.error(`Erro ao salvar pipeline: ${err.message}`);
    }
  },

  async delete(pipelineId) {
    const confirmed = await Modal.confirm(
      'Excluir pipeline',
      'Tem certeza que deseja excluir este pipeline? Esta ação não pode ser desfeita.'
    );

    if (!confirmed) return;

    try {
      await API.pipelines.delete(pipelineId);
      Toast.success('Pipeline excluído com sucesso');
      await PipelinesUI.load();
    } catch (err) {
      Toast.error(`Erro ao excluir pipeline: ${err.message}`);
    }
  },

  execute(pipelineId) {
    const pipeline = PipelinesUI.pipelines.find((p) => p.id === pipelineId);

    const titleEl = document.getElementById('pipeline-execute-title');
    if (titleEl) titleEl.textContent = `Executar: ${pipeline ? pipeline.name : 'Pipeline'}`;

    const idEl = document.getElementById('pipeline-execute-id');
    if (idEl) idEl.value = pipelineId;

    const inputEl = document.getElementById('pipeline-execute-input');
    if (inputEl) inputEl.value = '';

    const workdirEl = document.getElementById('pipeline-execute-workdir');
    if (workdirEl) workdirEl.value = '';

    Modal.open('pipeline-execute-modal-overlay');
  },

  async _executeFromModal() {
    const pipelineId = document.getElementById('pipeline-execute-id')?.value;
    const input = document.getElementById('pipeline-execute-input')?.value.trim();
    const workingDirectory = document.getElementById('pipeline-execute-workdir')?.value.trim() || '';

    if (!input) {
      Toast.warning('O input inicial é obrigatório');
      return;
    }

    try {
      await API.pipelines.execute(pipelineId, input, workingDirectory);
      Modal.close('pipeline-execute-modal-overlay');
      App.navigateTo('terminal');
      Toast.info('Pipeline iniciado');
    } catch (err) {
      Toast.error(`Erro ao executar pipeline: ${err.message}`);
    }
  },
};

window.PipelinesUI = PipelinesUI;
