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
      const approvalIcon = step.requiresApproval && index > 0
        ? '<i data-lucide="shield-check" style="width:10px;height:10px;color:var(--warning)"></i> '
        : '';
      return `
        <span class="pipeline-step-badge">
          <span class="pipeline-step-number">${index + 1}</span>
          ${approvalIcon}${agentName}
        </span>
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
          <div class="agent-actions-icons">
            <button class="btn btn-ghost btn-icon btn-sm" data-action="flow-pipeline" data-id="${pipeline.id}" title="Editor de fluxo">
              <i data-lucide="workflow"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm" data-action="edit-pipeline" data-id="${pipeline.id}" title="Editar pipeline">
              <i data-lucide="pencil"></i>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm btn-danger" data-action="delete-pipeline" data-id="${pipeline.id}" title="Excluir pipeline">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  },

  openCreateModal() {
    PipelinesUI._editingId = null;
    PipelinesUI._steps = [
      { agentId: '', inputTemplate: '', description: '', promptMode: 'simple', requiresApproval: false },
      { agentId: '', inputTemplate: '', description: '', promptMode: 'simple', requiresApproval: false },
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
        ? pipeline.steps.map((s) => ({
            agentId: s.agentId || '',
            inputTemplate: s.inputTemplate || '',
            description: s.description || '',
            promptMode: s.description ? 'simple' : 'advanced',
            requiresApproval: !!s.requiresApproval,
          }))
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

      const isSimple = step.promptMode !== 'advanced';
      const inputContext = isFirst
        ? 'O input inicial do pipeline'
        : 'O resultado (sumarizado) do passo anterior';

      const promptHtml = isSimple
        ? `<textarea
            class="textarea"
            rows="2"
            placeholder="Ex: Analise os requisitos e crie um plano técnico detalhado"
            data-step-field="description"
            data-step-index="${index}"
          >${Utils.escapeHtml(step.description || '')}</textarea>
          <div class="pipeline-step-hints">
            <span class="pipeline-step-hint">
              <i data-lucide="info" style="width:11px;height:11px"></i>
              ${inputContext} será injetado via <code>{{input}}</code> automaticamente no final.
            </span>
            <span class="pipeline-step-hint">
              <i data-lucide="lightbulb" style="width:11px;height:11px"></i>
              Dica: use <code>&lt;tags&gt;</code> XML para organizar melhor. Ex: <code>&lt;contexto&gt;</code> <code>&lt;regras&gt;</code> <code>&lt;formato_saida&gt;</code>
            </span>
          </div>`
        : `<textarea
            class="textarea"
            rows="3"
            placeholder="Use {{input}} para posicionar o output do passo anterior. Estruture com <tags> XML."
            data-step-field="inputTemplate"
            data-step-index="${index}"
          >${Utils.escapeHtml(step.inputTemplate || '')}</textarea>
          <div class="pipeline-step-hints">
            <span class="pipeline-step-hint">
              <i data-lucide="lightbulb" style="width:11px;height:11px"></i>
              Dica: use <code>&lt;tags&gt;</code> XML para organizar. Ex: <code>&lt;contexto&gt;{{input}}&lt;/contexto&gt;</code> <code>&lt;regras&gt;</code> <code>&lt;formato_saida&gt;</code>
            </span>
          </div>`;

      const modeIcon = isSimple ? 'code' : 'text';
      const modeLabel = isSimple ? 'Avançado' : 'Simples';

      return `
        <div class="pipeline-step-row" data-step-index="${index}">
          <span class="pipeline-step-number-lg">${index + 1}</span>
          <div class="pipeline-step-content">
            <select class="select" data-step-field="agentId" data-step-index="${index}">
              <option value="">Selecionar agente...</option>
              ${agentOptions}
            </select>
            ${promptHtml}
            <div class="pipeline-step-footer">
              ${approvalHtml}
              <button type="button" class="pipeline-mode-toggle" data-step-action="toggle-mode" data-step-index="${index}" title="Alternar entre modo simples e avançado">
                <i data-lucide="${modeIcon}" style="width:12px;height:12px"></i>
                ${modeLabel}
              </button>
            </div>
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

  _generateTemplate(description, stepIndex) {
    if (!description) return '';
    if (stepIndex === 0) {
      return `${description}\n\n{{input}}`;
    }
    return `${description}\n\nResultado do passo anterior:\n{{input}}`;
  },

  toggleMode(index) {
    PipelinesUI._syncStepsFromDOM();
    const step = PipelinesUI._steps[index];
    if (!step) return;

    if (step.promptMode === 'advanced') {
      step.promptMode = 'simple';
      if (step.inputTemplate && !step.description) {
        step.description = step.inputTemplate
          .replace(/\{\{input\}\}/g, '')
          .replace(/Resultado do passo anterior:\s*/g, '')
          .replace(/Input:\s*/g, '')
          .trim();
      }
    } else {
      step.promptMode = 'advanced';
      if (step.description && !step.inputTemplate) {
        step.inputTemplate = PipelinesUI._generateTemplate(step.description, index);
      }
    }

    PipelinesUI.renderSteps();
  },

  addStep() {
    PipelinesUI._syncStepsFromDOM();
    PipelinesUI._steps.push({ agentId: '', inputTemplate: '', description: '', promptMode: 'simple', requiresApproval: false });
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
      steps: PipelinesUI._steps.map((s, index) => {
        const isSimple = s.promptMode !== 'advanced';
        const inputTemplate = isSimple
          ? PipelinesUI._generateTemplate(s.description, index)
          : (s.inputTemplate || '');

        return {
          agentId: s.agentId,
          inputTemplate,
          description: isSimple ? (s.description || '') : '',
          requiresApproval: !!s.requiresApproval,
        };
      }),
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

    if (App._pipelineDropzone) App._pipelineDropzone.reset();

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

    if (workingDirectory && !workingDirectory.startsWith('/')) {
      Toast.warning('O diretório de trabalho deve ser um caminho absoluto (começar com /)');
      return;
    }

    try {
      let contextFiles = null;
      const dropzone = App._pipelineDropzone;
      if (dropzone && dropzone.getFiles().length > 0) {
        Toast.info('Fazendo upload dos arquivos...');
        const uploadResult = await API.uploads.send(dropzone.getFiles());
        contextFiles = uploadResult.files;
      }

      await API.pipelines.execute(pipelineId, input, workingDirectory, contextFiles);
      if (dropzone) dropzone.reset();
      Modal.close('pipeline-execute-modal-overlay');
      App.navigateTo('terminal');
      Toast.info('Pipeline iniciado');
    } catch (err) {
      Toast.error(`Erro ao executar pipeline: ${err.message}`);
    }
  },
};

window.PipelinesUI = PipelinesUI;
