const TasksUI = {
  tasks: [],
  _editingId: null,

  async load() {
    try {
      TasksUI.tasks = await API.tasks.list();
      TasksUI.render();
    } catch (err) {
      Toast.error(`Erro ao carregar tarefas: ${err.message}`);
    }
  },

  render(filteredTasks) {
    const container = document.getElementById('tasks-grid');
    const empty = document.getElementById('tasks-empty-state');

    if (!container) return;

    const tasks = filteredTasks || TasksUI.tasks;

    const existingCards = container.querySelectorAll('.task-card');
    existingCards.forEach((c) => c.remove());

    if (tasks.length === 0) {
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    const fragment = document.createDocumentFragment();

    tasks.forEach((task) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = TasksUI._renderCard(task);
      fragment.appendChild(wrapper.firstElementChild);
    });

    container.appendChild(fragment);

    if (window.lucide) lucide.createIcons({ nodes: [container] });
  },

  filter(searchText, categoryFilter) {
    const search = (searchText || '').toLowerCase();
    const category = categoryFilter || '';

    const filtered = TasksUI.tasks.filter((t) => {
      const name = (t.name || '').toLowerCase();
      const desc = (t.description || '').toLowerCase();
      const matchesSearch = !search || name.includes(search) || desc.includes(search);
      const matchesCategory = !category || t.category === category;
      return matchesSearch && matchesCategory;
    });

    TasksUI.render(filtered);
  },

  _renderCard(task) {
    const categoryClass = TasksUI._categoryClass(task.category);
    const categoryLabel = task.category || 'Geral';
    const createdAt = TasksUI._formatDate(task.createdAt || task.created_at);

    return `
      <div class="task-card" data-task-id="${task.id}">
        <div class="task-card-header">
          <h4 class="task-card-name">${task.name}</h4>
          <span class="badge ${categoryClass}">${categoryLabel}</span>
        </div>
        ${task.description ? `<p class="task-card-description">${task.description}</p>` : ''}
        <div class="task-card-footer">
          <span class="task-card-date">
            <i data-lucide="calendar"></i>
            ${createdAt}
          </span>
          <div class="task-card-actions">
            <button class="btn btn-primary btn-sm" data-action="execute-task" data-id="${task.id}" title="Executar tarefa">
              <i data-lucide="play"></i>
            </button>
            <button class="btn btn--ghost btn--sm" data-action="edit-task" data-id="${task.id}" title="Editar tarefa">
              <i data-lucide="pencil"></i>
            </button>
            <button class="btn btn--ghost btn--sm btn--danger" data-action="delete-task" data-id="${task.id}" title="Excluir tarefa">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  },

  openCreateModal() {
    TasksUI._editingId = null;
    TasksUI._openInlineForm({});
  },

  openEditModal(taskId) {
    const task = TasksUI.tasks.find((t) => t.id === taskId);
    if (!task) return;
    TasksUI._editingId = taskId;
    TasksUI._openInlineForm(task);
  },

  _openInlineForm(task) {
    const container = document.getElementById('tasks-grid');
    if (!container) return;

    const existing = document.getElementById('task-inline-form');
    if (existing) existing.remove();

    const isEdit = !!TasksUI._editingId;
    const title = isEdit ? 'Editar tarefa' : 'Nome da tarefa *';
    const btnLabel = isEdit ? 'Atualizar' : 'Salvar';

    const formHtml = `
      <div class="task-card task-card--form" id="task-inline-form">
        <div class="form-group">
          <label class="form-label" for="task-inline-name">${title}</label>
          <input type="text" id="task-inline-name" class="input" placeholder="Ex: Code Review de PR" required autocomplete="off" value="${task.name || ''}">
        </div>
        <div class="form-group">
          <label class="form-label" for="task-inline-category">Categoria</label>
          <select id="task-inline-category" class="select">
            <option value="">Selecionar...</option>
            <option value="code-review" ${task.category === 'code-review' ? 'selected' : ''}>Code Review</option>
            <option value="security" ${task.category === 'security' ? 'selected' : ''}>Segurança</option>
            <option value="refactor" ${task.category === 'refactor' ? 'selected' : ''}>Refatoração</option>
            <option value="tests" ${task.category === 'tests' ? 'selected' : ''}>Testes</option>
            <option value="docs" ${task.category === 'docs' ? 'selected' : ''}>Documentação</option>
            <option value="performance" ${task.category === 'performance' ? 'selected' : ''}>Performance</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="task-inline-description">Descrição</label>
          <textarea id="task-inline-description" class="textarea" rows="2" placeholder="Descreva o objetivo desta tarefa...">${task.description || ''}</textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn--primary" id="btn-save-inline-task" type="button">${btnLabel}</button>
          <button class="btn btn--ghost" id="btn-cancel-inline-task" type="button">Cancelar</button>
        </div>
      </div>
    `;

    const empty = document.getElementById('tasks-empty-state');
    if (empty) empty.style.display = 'none';

    container.insertAdjacentHTML('afterbegin', formHtml);

    document.getElementById('btn-save-inline-task')?.addEventListener('click', () => {
      const name = document.getElementById('task-inline-name')?.value.trim();
      const category = document.getElementById('task-inline-category')?.value;
      const description = document.getElementById('task-inline-description')?.value.trim();

      if (!name) {
        Toast.warning('Nome da tarefa é obrigatório');
        return;
      }

      TasksUI.save({ name, category, description });
    });

    document.getElementById('btn-cancel-inline-task')?.addEventListener('click', () => {
      document.getElementById('task-inline-form')?.remove();
      TasksUI._editingId = null;
      if (TasksUI.tasks.length === 0) {
        const emptyEl = document.getElementById('tasks-empty-state');
        if (emptyEl) emptyEl.style.display = 'flex';
      }
    });

    document.getElementById('task-inline-name')?.focus();
  },

  async save(data) {
    if (!data || !data.name) {
      Toast.warning('Nome da tarefa é obrigatório');
      return;
    }

    try {
      if (TasksUI._editingId) {
        await API.tasks.update(TasksUI._editingId, data);
        Toast.success('Tarefa atualizada com sucesso');
      } else {
        await API.tasks.create(data);
        Toast.success('Tarefa criada com sucesso');
      }

      TasksUI._editingId = null;
      document.getElementById('task-inline-form')?.remove();
      await TasksUI.load();
    } catch (err) {
      Toast.error(`Erro ao salvar tarefa: ${err.message}`);
    }
  },

  async delete(taskId) {
    const confirmed = await Modal.confirm(
      'Excluir tarefa',
      'Tem certeza que deseja excluir esta tarefa?'
    );

    if (!confirmed) return;

    try {
      await API.tasks.delete(taskId);
      Toast.success('Tarefa excluída com sucesso');
      await TasksUI.load();
    } catch (err) {
      Toast.error(`Erro ao excluir tarefa: ${err.message}`);
    }
  },

  async execute(taskId) {
    const task = TasksUI.tasks.find((t) => t.id === taskId);
    if (!task) return;

    try {
      const agents = await API.agents.list();
      const activeAgents = agents.filter((a) => a.status === 'active');

      if (activeAgents.length === 0) {
        Toast.warning('Nenhum agente ativo disponível para executar');
        return;
      }

      const selectEl = document.getElementById('execute-agent-select');
      if (selectEl) {
        selectEl.innerHTML = '<option value="">Selecionar agente...</option>' +
          activeAgents.map((a) => `<option value="${a.id}">${a.agent_name || a.name}</option>`).join('');
        selectEl.value = '';
      }

      const hiddenId = document.getElementById('execute-agent-id');
      if (hiddenId) hiddenId.value = '';

      const taskEl = document.getElementById('execute-task-desc');
      if (taskEl) {
        const parts = [task.name];
        if (task.description) parts.push(task.description);
        taskEl.value = parts.join('\n\n');
      }

      const instructionsEl = document.getElementById('execute-instructions');
      if (instructionsEl) instructionsEl.value = '';

      await AgentsUI._loadSavedTasks();
      const savedTaskSelect = document.getElementById('execute-saved-task');
      if (savedTaskSelect) savedTaskSelect.value = task.id;

      Modal.open('execute-modal-overlay');
    } catch (err) {
      Toast.error(`Erro ao abrir execução: ${err.message}`);
    }
  },

  _categoryClass(category) {
    const map = {
      'code-review': 'badge--blue',
      security: 'badge--red',
      refactor: 'badge--purple',
      tests: 'badge--green',
      docs: 'badge--gray',
      performance: 'badge--orange',
    };
    return map[(category || '').toLowerCase()] || 'badge--gray';
  },

  _formatDate(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleDateString('pt-BR');
  },
};

window.TasksUI = TasksUI;
