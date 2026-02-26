const WebhooksUI = {
  webhooks: [],
  agents: [],
  pipelines: [],

  async load() {
    try {
      const [webhooks, agents, pipelines] = await Promise.all([
        API.webhooks.list(),
        API.agents.list(),
        API.pipelines.list(),
      ]);
      WebhooksUI.webhooks = Array.isArray(webhooks) ? webhooks : [];
      WebhooksUI.agents = Array.isArray(agents) ? agents : [];
      WebhooksUI.pipelines = Array.isArray(pipelines) ? pipelines : [];
      WebhooksUI.render();
    } catch (err) {
      Toast.error(`Erro ao carregar webhooks: ${err.message}`);
    }
  },

  filter(searchText) {
    const search = (searchText || '').toLowerCase();
    const filtered = WebhooksUI.webhooks.filter((w) => {
      const name = (w.name || '').toLowerCase();
      return !search || name.includes(search);
    });
    WebhooksUI.render(filtered);
  },

  render(filteredWebhooks) {
    const container = document.getElementById('webhooks-list');
    if (!container) return;

    const webhooks = filteredWebhooks || WebhooksUI.webhooks;

    if (webhooks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <i data-lucide="webhook"></i>
          </div>
          <h3 class="empty-state-title">Nenhum webhook cadastrado</h3>
          <p class="empty-state-desc">Crie webhooks para disparar agentes ou pipelines via HTTP.</p>
        </div>
      `;
      Utils.refreshIcons(container);
      return;
    }

    container.innerHTML = webhooks.map((w) => WebhooksUI._renderCard(w)).join('');
    Utils.refreshIcons(container);
  },

  _renderCard(webhook) {
    const typeBadge = webhook.targetType === 'pipeline'
      ? '<span class="badge badge--purple">Pipeline</span>'
      : '<span class="badge badge--blue">Agente</span>';

    const statusBadge = webhook.active
      ? '<span class="badge badge-active">Ativo</span>'
      : '<span class="badge badge-inactive">Inativo</span>';

    const targetName = WebhooksUI._resolveTargetName(webhook);
    const hookUrl = `${window.location.origin}/hook/${webhook.token}`;
    const lastTrigger = webhook.lastTriggeredAt
      ? new Date(webhook.lastTriggeredAt).toLocaleString('pt-BR')
      : 'Nunca';

    return `
      <article class="webhook-card">
        <div class="webhook-card-header">
          <div class="webhook-card-identity">
            <span class="webhook-card-name">${Utils.escapeHtml(webhook.name)}</span>
            ${typeBadge}
            ${statusBadge}
          </div>
          <div class="webhook-card-actions">
            <button class="btn btn-ghost btn-sm btn-icon" data-action="toggle-webhook" data-id="${webhook.id}" title="${webhook.active ? 'Desativar' : 'Ativar'}">
              <i data-lucide="${webhook.active ? 'pause' : 'play'}"></i>
            </button>
            <button class="btn btn-ghost btn-sm btn-icon" data-action="edit-webhook" data-id="${webhook.id}" title="Editar">
              <i data-lucide="pencil"></i>
            </button>
            <button class="btn btn-ghost btn-sm btn-icon" data-action="test-webhook" data-id="${webhook.id}" title="Testar">
              <i data-lucide="zap"></i>
            </button>
            <button class="btn btn-ghost btn-sm btn-icon btn-danger" data-action="delete-webhook" data-id="${webhook.id}" title="Excluir">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
        <div class="webhook-card-body">
          <div class="webhook-card-target">
            <span class="webhook-card-label">Destino</span>
            <span class="webhook-card-value">${Utils.escapeHtml(targetName)}</span>
          </div>
          <div class="webhook-card-url">
            <span class="webhook-card-label">URL</span>
            <div class="webhook-url-field">
              <code class="webhook-url-code">${hookUrl}</code>
              <button class="btn btn-ghost btn-sm btn-icon" data-action="copy-webhook-url" data-url="${hookUrl}" title="Copiar URL">
                <i data-lucide="copy"></i>
              </button>
            </div>
          </div>
          <div class="webhook-card-curl">
            <button class="btn btn-ghost btn-sm btn-icon-text" data-action="copy-webhook-curl" data-id="${webhook.id}" title="Copiar comando cURL">
              <i data-lucide="terminal"></i>
              <span>Copiar cURL</span>
            </button>
          </div>
          <div class="webhook-card-meta">
            <span class="webhook-meta-item">
              <i data-lucide="activity" style="width:12px;height:12px"></i>
              ${webhook.triggerCount || 0} disparos
            </span>
            <span class="webhook-meta-item">
              <i data-lucide="clock" style="width:12px;height:12px"></i>
              Último: ${lastTrigger}
            </span>
          </div>
        </div>
      </article>
    `;
  },

  _resolveTargetName(webhook) {
    if (webhook.targetType === 'agent') {
      const agent = WebhooksUI.agents.find((a) => a.id === webhook.targetId);
      return agent ? (agent.agent_name || agent.name) : webhook.targetId;
    }
    const pl = WebhooksUI.pipelines.find((p) => p.id === webhook.targetId);
    return pl ? pl.name : webhook.targetId;
  },

  openCreateModal() {
    const titleEl = document.getElementById('webhook-modal-title');
    if (titleEl) titleEl.textContent = 'Novo Webhook';

    const nameEl = document.getElementById('webhook-name');
    if (nameEl) nameEl.value = '';

    const typeEl = document.getElementById('webhook-target-type');
    if (typeEl) {
      typeEl.value = 'agent';
      WebhooksUI._updateTargetSelect('agent');
    }

    const submitBtn = document.getElementById('webhook-form-submit');
    if (submitBtn) submitBtn.dataset.editId = '';

    Modal.open('webhook-modal-overlay');
  },

  openEditModal(webhookId) {
    const webhook = WebhooksUI.webhooks.find(w => w.id === webhookId);
    if (!webhook) return;

    const titleEl = document.getElementById('webhook-modal-title');
    if (titleEl) titleEl.textContent = 'Editar Webhook';

    const nameEl = document.getElementById('webhook-name');
    if (nameEl) nameEl.value = webhook.name || '';

    const typeEl = document.getElementById('webhook-target-type');
    if (typeEl) {
      typeEl.value = webhook.targetType || 'agent';
      WebhooksUI._updateTargetSelect(webhook.targetType || 'agent');
    }

    const targetEl = document.getElementById('webhook-target-id');
    if (targetEl) targetEl.value = webhook.targetId || '';

    const submitBtn = document.getElementById('webhook-form-submit');
    if (submitBtn) submitBtn.dataset.editId = webhookId;

    Modal.open('webhook-modal-overlay');
  },

  async test(webhookId) {
    try {
      const result = await API.webhooks.test(webhookId);
      Toast.success(result.message || 'Webhook testado com sucesso');
    } catch (err) {
      Toast.error(`Erro ao testar webhook: ${err.message}`);
    }
  },

  _updateTargetSelect(targetType) {
    const selectEl = document.getElementById('webhook-target-id');
    if (!selectEl) return;

    if (targetType === 'agent') {
      selectEl.innerHTML = '<option value="">Selecionar agente...</option>' +
        WebhooksUI.agents.map((a) => `<option value="${a.id}">${Utils.escapeHtml(a.agent_name || a.name)}</option>`).join('');
    } else {
      selectEl.innerHTML = '<option value="">Selecionar pipeline...</option>' +
        WebhooksUI.pipelines.map((p) => `<option value="${p.id}">${Utils.escapeHtml(p.name)}</option>`).join('');
    }
  },

  async save() {
    const name = document.getElementById('webhook-name')?.value.trim();
    const targetType = document.getElementById('webhook-target-type')?.value;
    const targetId = document.getElementById('webhook-target-id')?.value;
    const submitBtn = document.getElementById('webhook-form-submit');
    const editId = submitBtn?.dataset.editId || '';

    if (!name) { Toast.warning('Nome do webhook é obrigatório'); return; }
    if (!targetId) { Toast.warning('Selecione um destino'); return; }

    try {
      if (editId) {
        await API.webhooks.update(editId, { name, targetType, targetId });
        Modal.close('webhook-modal-overlay');
        Toast.success('Webhook atualizado com sucesso');
      } else {
        await API.webhooks.create({ name, targetType, targetId });
        Modal.close('webhook-modal-overlay');
        Toast.success('Webhook criado com sucesso');
      }
      await WebhooksUI.load();
    } catch (err) {
      Toast.error(`Erro ao salvar webhook: ${err.message}`);
    }
  },

  async toggleActive(webhookId) {
    const webhook = WebhooksUI.webhooks.find((w) => w.id === webhookId);
    if (!webhook) return;

    try {
      await API.webhooks.update(webhookId, { active: !webhook.active });
      Toast.success(webhook.active ? 'Webhook desativado' : 'Webhook ativado');
      await WebhooksUI.load();
    } catch (err) {
      Toast.error(`Erro ao atualizar webhook: ${err.message}`);
    }
  },

  async delete(webhookId) {
    const confirmed = await Modal.confirm(
      'Excluir webhook',
      'Tem certeza que deseja excluir este webhook? Integrações que usam esta URL deixarão de funcionar.'
    );
    if (!confirmed) return;

    try {
      await API.webhooks.delete(webhookId);
      Toast.success('Webhook excluído');
      await WebhooksUI.load();
    } catch (err) {
      Toast.error(`Erro ao excluir webhook: ${err.message}`);
    }
  },

  async copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      Toast.success('URL copiada');
    } catch {
      Toast.error('Não foi possível copiar a URL');
    }
  },

  async copyCurl(webhookId) {
    const webhook = WebhooksUI.webhooks.find((w) => w.id === webhookId);
    if (!webhook) return;

    const hookUrl = `${window.location.origin}/hook/${webhook.token}`;
    const targetName = WebhooksUI._resolveTargetName(webhook);

    let payload;
    if (webhook.targetType === 'pipeline') {
      payload = JSON.stringify({
        input: 'Texto de entrada para o pipeline',
        workingDirectory: '/caminho/do/projeto (opcional)',
      }, null, 2);
    } else {
      payload = JSON.stringify({
        task: 'Descreva a tarefa a ser executada',
        instructions: 'Instruções adicionais (opcional)',
      }, null, 2);
    }

    const curl = `curl -X POST '${hookUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${payload}'`;

    try {
      await navigator.clipboard.writeText(curl);
      Toast.success('cURL copiado');
    } catch {
      Toast.error('Não foi possível copiar o cURL');
    }
  },

};

window.WebhooksUI = WebhooksUI;
