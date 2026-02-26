const TasksUI = {
  tasks: [],

  async load() {
    try {
      TasksUI.tasks = await API.tasks.list();
      TasksUI.render();
    } catch (err) {
      Toast.error(`Erro ao carregar tarefas: ${err.message}`);
    }
  },

  render() {
    const container = document.getElementById('tasks-grid');
    const empty = document.getElementById('tasks-empty-state');

    if (!container) return;

    const existingCards = container.querySelectorAll('.task-card');
    existingCards.forEach((c) => c.remove());

    if (TasksUI.tasks.length === 0) {
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    const fragment = document.createDocumentFragment();

    TasksUI.tasks.forEach((task) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = TasksUI._renderCard(task);
      fragment.appendChild(wrapper.firstElementChild);
    });

    container.appendChild(fragment);

    if (window.lucide) lucide.createIcons({ nodes: [container] });
  },

  _renderCard(task) {
    const categoryClass = TasksUI._categoryClass(task.category);
    const categoryLabel = task.category || 'Geral';
    const createdAt = TasksUI._formatDate(task.createdAt);

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
    const container = document.getElementById('tasks-grid');
    if (!container) return;

    const existing = document.getElementById('task-inline-form');
    if (existing) {
      existing.remove();
      return;
    }

    const formHtml = `
      <div class="task-card task-card--form" id="task-inline-form">
        <div class="form-group">
          <label class="form-label" for="task-inline-name">Nome da tarefa *</label>
          <input type="text" id="task-inline-name" class="input" placeholder="Ex: Code Review de PR" required autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label" for="task-inline-category">Categoria</label>
          <select id="task-inline-category" class="select">
            <option value="">Selecionar...</option>
            <option value="code-review">Code Review</option>
            <option value="security">Segurança</option>
            <option value="refactor">Refatoração</option>
            <option value="tests">Testes</option>
            <option value="docs">Documentação</option>
            <option value="performance">Performance</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="task-inline-description">Descrição</label>
          <textarea id="task-inline-description" class="textarea" rows="2" placeholder="Descreva o objetivo desta tarefa..."></textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn--primary" id="btn-save-inline-task" type="button">Salvar</button>
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
      await API.tasks.create(data);
      Toast.success('Tarefa criada com sucesso');
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
