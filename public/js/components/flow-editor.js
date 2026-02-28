const FlowEditor = {
  _overlay: null,
  _canvas: null,
  _ctx: null,
  _nodesContainer: null,
  _pipelineId: null,
  _pipeline: null,
  _agents: [],
  _nodes: [],
  _dragState: null,
  _panOffset: { x: 0, y: 0 },
  _panStart: null,
  _scale: 1,
  _selectedNode: null,
  _editingNode: null,
  _resizeObserver: null,
  _animFrame: null,
  _dirty: false,

  NODE_WIDTH: 240,
  NODE_HEIGHT: 72,
  NODE_GAP_Y: 100,
  START_X: 0,
  START_Y: 60,

  async open(pipelineId) {
    try {
      const [pipeline, agents] = await Promise.all([
        API.pipelines.get(pipelineId),
        API.agents.list(),
      ]);

      FlowEditor._pipelineId = pipelineId;
      FlowEditor._pipeline = pipeline;
      FlowEditor._agents = Array.isArray(agents) ? agents : [];
      FlowEditor._selectedNode = null;
      FlowEditor._editingNode = null;
      FlowEditor._panOffset = { x: 0, y: 0 };
      FlowEditor._scale = 1;
      FlowEditor._dirty = false;

      FlowEditor._buildNodes();
      FlowEditor._show();
      FlowEditor._centerView();
      FlowEditor._render();
    } catch (err) {
      Toast.error('Erro ao abrir editor de fluxo: ' + err.message);
    }
  },

  _buildNodes() {
    const steps = Array.isArray(FlowEditor._pipeline.steps) ? FlowEditor._pipeline.steps : [];
    FlowEditor._nodes = steps.map((step, i) => {
      const agent = FlowEditor._agents.find((a) => a.id === step.agentId);
      return {
        id: step.id || 'step-' + i,
        index: i,
        x: 0,
        y: i * (FlowEditor.NODE_HEIGHT + FlowEditor.NODE_GAP_Y),
        agentId: step.agentId || '',
        agentName: agent ? (agent.agent_name || agent.name) : (step.agentName || 'Agente'),
        inputTemplate: step.inputTemplate || '',
        requiresApproval: !!step.requiresApproval,
        description: step.description || '',
      };
    });
  },

  _show() {
    let overlay = document.getElementById('flow-editor-overlay');
    if (!overlay) {
      FlowEditor._createDOM();
      overlay = document.getElementById('flow-editor-overlay');
    }

    FlowEditor._overlay = overlay;
    FlowEditor._canvas = document.getElementById('flow-editor-canvas');
    FlowEditor._ctx = FlowEditor._canvas.getContext('2d');
    FlowEditor._nodesContainer = document.getElementById('flow-editor-nodes');

    const titleEl = document.getElementById('flow-editor-title');
    if (titleEl) titleEl.textContent = FlowEditor._pipeline.name || 'Pipeline';

    const saveBtn = document.getElementById('flow-editor-save-btn');
    if (saveBtn) saveBtn.classList.toggle('flow-btn--disabled', true);

    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('active'));

    FlowEditor._setupEvents();
    FlowEditor._resizeCanvas();

    if (!FlowEditor._resizeObserver) {
      FlowEditor._resizeObserver = new ResizeObserver(() => {
        FlowEditor._resizeCanvas();
        FlowEditor._render();
      });
    }
    FlowEditor._resizeObserver.observe(FlowEditor._canvas.parentElement);
  },

  _createDOM() {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="flow-editor-overlay" id="flow-editor-overlay" hidden>
        <div class="flow-editor">
          <div class="flow-editor-header">
            <div class="flow-editor-header-left">
              <button class="flow-btn flow-btn--ghost" id="flow-editor-close-btn" title="Voltar">
                <i data-lucide="arrow-left" style="width:18px;height:18px"></i>
              </button>
              <div class="flow-editor-title-group">
                <h2 class="flow-editor-title" id="flow-editor-title">Pipeline</h2>
                <span class="flow-editor-subtitle">Editor de Fluxo</span>
              </div>
            </div>
            <div class="flow-editor-header-actions">
              <div class="flow-editor-zoom">
                <button class="flow-btn flow-btn--ghost flow-btn--sm" id="flow-zoom-out" title="Diminuir zoom">
                  <i data-lucide="minus" style="width:14px;height:14px"></i>
                </button>
                <span class="flow-zoom-label" id="flow-zoom-label">100%</span>
                <button class="flow-btn flow-btn--ghost flow-btn--sm" id="flow-zoom-in" title="Aumentar zoom">
                  <i data-lucide="plus" style="width:14px;height:14px"></i>
                </button>
                <button class="flow-btn flow-btn--ghost flow-btn--sm" id="flow-zoom-fit" title="Centralizar">
                  <i data-lucide="maximize-2" style="width:14px;height:14px"></i>
                </button>
              </div>
              <button class="flow-btn flow-btn--ghost flow-btn--sm" id="flow-add-node-btn" title="Adicionar passo">
                <i data-lucide="plus-circle" style="width:16px;height:16px"></i>
                <span>Passo</span>
              </button>
              <button class="flow-btn flow-btn--primary flow-btn--disabled" id="flow-editor-save-btn">
                <i data-lucide="save" style="width:14px;height:14px"></i>
                <span>Salvar</span>
              </button>
            </div>
          </div>
          <div class="flow-editor-body">
            <div class="flow-editor-canvas-wrap" id="flow-editor-canvas-wrap">
              <canvas id="flow-editor-canvas"></canvas>
              <div class="flow-editor-nodes" id="flow-editor-nodes"></div>
            </div>
            <div class="flow-editor-panel" id="flow-editor-panel" hidden>
              <div class="flow-panel-header">
                <h3 class="flow-panel-title" id="flow-panel-title">Configuração</h3>
                <button class="flow-btn flow-btn--ghost flow-btn--sm" id="flow-panel-close" title="Fechar painel">
                  <i data-lucide="x" style="width:14px;height:14px"></i>
                </button>
              </div>
              <div class="flow-panel-body" id="flow-panel-body"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(div.firstElementChild);
  },

  _setupEvents() {
    const wrap = document.getElementById('flow-editor-canvas-wrap');
    if (!wrap || wrap._flowBound) return;
    wrap._flowBound = true;

    wrap.addEventListener('pointerdown', FlowEditor._onPointerDown);
    wrap.addEventListener('pointermove', FlowEditor._onPointerMove);
    wrap.addEventListener('pointerup', FlowEditor._onPointerUp);
    wrap.addEventListener('wheel', FlowEditor._onWheel, { passive: false });

    document.getElementById('flow-editor-close-btn')?.addEventListener('click', FlowEditor._close);
    document.getElementById('flow-editor-save-btn')?.addEventListener('click', FlowEditor._save);
    document.getElementById('flow-add-node-btn')?.addEventListener('click', FlowEditor._addNode);
    document.getElementById('flow-zoom-in')?.addEventListener('click', () => FlowEditor._zoom(0.1));
    document.getElementById('flow-zoom-out')?.addEventListener('click', () => FlowEditor._zoom(-0.1));
    document.getElementById('flow-zoom-fit')?.addEventListener('click', () => FlowEditor._centerView());
    document.getElementById('flow-panel-close')?.addEventListener('click', FlowEditor._closePanel);

    document.addEventListener('keydown', FlowEditor._onKeyDown);
  },

  _resizeCanvas() {
    const wrap = document.getElementById('flow-editor-canvas-wrap');
    const canvas = FlowEditor._canvas;
    if (!wrap || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    FlowEditor._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  _render() {
    if (FlowEditor._animFrame) cancelAnimationFrame(FlowEditor._animFrame);
    FlowEditor._animFrame = requestAnimationFrame(FlowEditor._draw);
  },

  _draw() {
    const ctx = FlowEditor._ctx;
    const canvas = FlowEditor._canvas;
    if (!ctx || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(FlowEditor._panOffset.x, FlowEditor._panOffset.y);
    ctx.scale(FlowEditor._scale, FlowEditor._scale);

    FlowEditor._drawGrid(ctx, w, h);
    FlowEditor._drawConnections(ctx);

    ctx.restore();
    FlowEditor._renderNodes();
  },

  _drawGrid(ctx, w, h) {
    const scale = FlowEditor._scale;
    const ox = FlowEditor._panOffset.x;
    const oy = FlowEditor._panOffset.y;
    const gridSize = 24;

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1 / scale;

    const startX = Math.floor(-ox / scale / gridSize) * gridSize;
    const startY = Math.floor(-oy / scale / gridSize) * gridSize;
    const endX = startX + w / scale + gridSize * 2;
    const endY = startY + h / scale + gridSize * 2;

    ctx.beginPath();
    for (let x = startX; x < endX; x += gridSize) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += gridSize) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();
  },

  _drawConnections(ctx) {
    const nodes = FlowEditor._nodes;
    const nw = FlowEditor.NODE_WIDTH;
    const nh = FlowEditor.NODE_HEIGHT;

    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];

      const ax = a.x + nw / 2;
      const ay = a.y + nh;
      const bx = b.x + nw / 2;
      const by = b.y;

      const midY = (ay + by) / 2;

      const grad = ctx.createLinearGradient(ax, ay, bx, by);
      grad.addColorStop(0, 'rgba(99,102,241,0.6)');
      grad.addColorStop(1, 'rgba(139,92,246,0.6)');

      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(ax, midY, bx, midY, bx, by);
      ctx.stroke();

      const arrowSize = 6;
      const angle = Math.atan2(by - midY, bx - bx) || Math.PI / 2;
      ctx.fillStyle = 'rgba(139,92,246,0.8)';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - arrowSize * Math.cos(angle - 0.4), by - arrowSize * Math.sin(angle - 0.4));
      ctx.lineTo(bx - arrowSize * Math.cos(angle + 0.4), by - arrowSize * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fill();

      if (b.requiresApproval) {
        const iconX = (ax + bx) / 2;
        const iconY = midY;
        ctx.fillStyle = '#0a0a0f';
        ctx.beginPath();
        ctx.arc(iconX, iconY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(245,158,11,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', iconX, iconY);
      }
    }
  },

  _renderNodes() {
    const container = FlowEditor._nodesContainer;
    if (!container) return;

    const ox = FlowEditor._panOffset.x;
    const oy = FlowEditor._panOffset.y;
    const scale = FlowEditor._scale;

    let existingEls = container.querySelectorAll('.flow-node');
    const existingMap = {};
    existingEls.forEach((el) => { existingMap[el.dataset.nodeId] = el; });

    FlowEditor._nodes.forEach((node, i) => {
      const screenX = node.x * scale + ox;
      const screenY = node.y * scale + oy;
      const isSelected = FlowEditor._selectedNode === i;

      let el = existingMap[node.id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'flow-node';
        el.dataset.nodeId = node.id;
        el.dataset.nodeIndex = i;
        container.appendChild(el);
      }

      el.dataset.nodeIndex = i;
      el.style.transform = `translate(${screenX}px, ${screenY}px) scale(${scale})`;
      el.style.width = FlowEditor.NODE_WIDTH + 'px';
      el.style.height = FlowEditor.NODE_HEIGHT + 'px';
      el.classList.toggle('flow-node--selected', isSelected);

      const stepNum = i + 1;
      const name = Utils.escapeHtml(node.agentName || 'Selecionar agente...');
      const approvalBadge = node.requiresApproval && i > 0
        ? '<span class="flow-node-approval">Aprovação</span>'
        : '';

      el.innerHTML = `
        <div class="flow-node-header">
          <span class="flow-node-number">${stepNum}</span>
          <span class="flow-node-name" title="${name}">${name}</span>
          ${approvalBadge}
        </div>
        <div class="flow-node-sub">
          ${node.inputTemplate ? Utils.escapeHtml(Utils.truncate(node.inputTemplate, 40)) : '<span class="flow-node-placeholder">Sem template de input</span>'}
        </div>
      `;

      delete existingMap[node.id];
    });

    Object.values(existingMap).forEach((el) => el.remove());
  },

  _centerView() {
    const canvas = FlowEditor._canvas;
    if (!canvas || FlowEditor._nodes.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    const nw = FlowEditor.NODE_WIDTH;
    const nh = FlowEditor.NODE_HEIGHT;
    const nodes = FlowEditor._nodes;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + nw);
      maxY = Math.max(maxY, n.y + nh);
    });

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const padding = 80;
    const scaleX = (w - padding * 2) / contentW;
    const scaleY = (h - padding * 2) / contentH;
    const scale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.3), 1.5);

    FlowEditor._scale = scale;
    FlowEditor._panOffset = {
      x: (w - contentW * scale) / 2 - minX * scale,
      y: (h - contentH * scale) / 2 - minY * scale,
    };

    FlowEditor._updateZoomLabel();
    FlowEditor._render();
  },

  _zoom(delta) {
    const oldScale = FlowEditor._scale;
    FlowEditor._scale = Math.min(Math.max(oldScale + delta, 0.2), 2.5);
    FlowEditor._updateZoomLabel();
    FlowEditor._render();
  },

  _updateZoomLabel() {
    const el = document.getElementById('flow-zoom-label');
    if (el) el.textContent = Math.round(FlowEditor._scale * 100) + '%';
  },

  _onPointerDown(e) {
    const nodeEl = e.target.closest('.flow-node');

    if (nodeEl) {
      const idx = parseInt(nodeEl.dataset.nodeIndex, 10);
      FlowEditor._selectedNode = idx;

      if (e.detail === 2) {
        FlowEditor._openNodePanel(idx);
        FlowEditor._render();
        return;
      }

      const node = FlowEditor._nodes[idx];
      FlowEditor._dragState = {
        type: 'node',
        index: idx,
        startX: e.clientX,
        startY: e.clientY,
        origX: node.x,
        origY: node.y,
        moved: false,
      };

      nodeEl.setPointerCapture(e.pointerId);
      FlowEditor._render();
      return;
    }

    if (e.target.closest('.flow-editor-panel') || e.target.closest('.flow-editor-header')) return;

    FlowEditor._selectedNode = null;
    FlowEditor._panStart = {
      x: e.clientX - FlowEditor._panOffset.x,
      y: e.clientY - FlowEditor._panOffset.y,
    };

    FlowEditor._render();
  },

  _onPointerMove(e) {
    if (FlowEditor._dragState) {
      const ds = FlowEditor._dragState;
      const dx = (e.clientX - ds.startX) / FlowEditor._scale;
      const dy = (e.clientY - ds.startY) / FlowEditor._scale;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) ds.moved = true;

      FlowEditor._nodes[ds.index].x = ds.origX + dx;
      FlowEditor._nodes[ds.index].y = ds.origY + dy;
      FlowEditor._render();
      return;
    }

    if (FlowEditor._panStart) {
      FlowEditor._panOffset.x = e.clientX - FlowEditor._panStart.x;
      FlowEditor._panOffset.y = e.clientY - FlowEditor._panStart.y;
      FlowEditor._render();
    }
  },

  _onPointerUp(e) {
    if (FlowEditor._dragState) {
      const ds = FlowEditor._dragState;
      if (!ds.moved) {
        FlowEditor._openNodePanel(ds.index);
      } else {
        FlowEditor._markDirty();
      }
      FlowEditor._dragState = null;
      FlowEditor._render();
      return;
    }

    FlowEditor._panStart = null;
  },

  _onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const oldScale = FlowEditor._scale;
    const newScale = Math.min(Math.max(oldScale + delta, 0.2), 2.5);

    const rect = FlowEditor._canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    FlowEditor._panOffset.x = mx - (mx - FlowEditor._panOffset.x) * (newScale / oldScale);
    FlowEditor._panOffset.y = my - (my - FlowEditor._panOffset.y) * (newScale / oldScale);
    FlowEditor._scale = newScale;

    FlowEditor._updateZoomLabel();
    FlowEditor._render();
  },

  _onKeyDown(e) {
    if (!FlowEditor._overlay || FlowEditor._overlay.hidden) return;

    if (e.key === 'Escape') {
      if (FlowEditor._editingNode !== null) {
        FlowEditor._closePanel();
      } else {
        FlowEditor._close();
      }
      e.stopPropagation();
      return;
    }

    if (e.key === 'Delete' && FlowEditor._selectedNode !== null && FlowEditor._editingNode === null) {
      FlowEditor._removeNode(FlowEditor._selectedNode);
    }
  },

  _openNodePanel(index) {
    const node = FlowEditor._nodes[index];
    if (!node) return;

    FlowEditor._editingNode = index;
    FlowEditor._selectedNode = index;

    const panel = document.getElementById('flow-editor-panel');
    const title = document.getElementById('flow-panel-title');
    const body = document.getElementById('flow-panel-body');
    if (!panel || !body) return;

    if (title) title.textContent = `Passo ${index + 1}`;
    panel.hidden = false;

    const agentOptions = FlowEditor._agents
      .map((a) => {
        const aName = Utils.escapeHtml(a.agent_name || a.name);
        const selected = a.id === node.agentId ? 'selected' : '';
        return `<option value="${a.id}" ${selected}>${aName}</option>`;
      })
      .join('');

    const approvalChecked = node.requiresApproval ? 'checked' : '';
    const showApproval = index > 0;

    body.innerHTML = `
      <div class="flow-panel-field">
        <label class="flow-panel-label">Agente</label>
        <select class="flow-panel-select" id="flow-panel-agent">
          <option value="">Selecionar agente...</option>
          ${agentOptions}
        </select>
      </div>
      <div class="flow-panel-field">
        <label class="flow-panel-label">Template de Input</label>
        <textarea class="flow-panel-textarea" id="flow-panel-template" rows="4" placeholder="{{input}} será substituído pelo output anterior">${Utils.escapeHtml(node.inputTemplate || '')}</textarea>
        <span class="flow-panel-hint">Use <code>{{input}}</code> para referenciar o output do passo anterior</span>
      </div>
      ${showApproval ? `
      <div class="flow-panel-field">
        <label class="flow-panel-checkbox">
          <input type="checkbox" id="flow-panel-approval" ${approvalChecked} />
          <span>Requer aprovação antes de executar</span>
        </label>
      </div>` : ''}
      <div class="flow-panel-field flow-panel-actions-group">
        <button class="flow-btn flow-btn--ghost flow-btn--sm flow-btn--full" id="flow-panel-move-up" ${index === 0 ? 'disabled' : ''}>
          <i data-lucide="chevron-up" style="width:14px;height:14px"></i> Mover acima
        </button>
        <button class="flow-btn flow-btn--ghost flow-btn--sm flow-btn--full" id="flow-panel-move-down" ${index === FlowEditor._nodes.length - 1 ? 'disabled' : ''}>
          <i data-lucide="chevron-down" style="width:14px;height:14px"></i> Mover abaixo
        </button>
        <button class="flow-btn flow-btn--danger flow-btn--sm flow-btn--full" id="flow-panel-delete">
          <i data-lucide="trash-2" style="width:14px;height:14px"></i> Remover passo
        </button>
      </div>
    `;

    Utils.refreshIcons(body);

    document.getElementById('flow-panel-agent')?.addEventListener('change', (ev) => {
      const val = ev.target.value;
      node.agentId = val;
      const agent = FlowEditor._agents.find((a) => a.id === val);
      node.agentName = agent ? (agent.agent_name || agent.name) : 'Selecionar agente...';
      FlowEditor._markDirty();
      FlowEditor._render();
    });

    document.getElementById('flow-panel-template')?.addEventListener('input', (ev) => {
      node.inputTemplate = ev.target.value;
      FlowEditor._markDirty();
      FlowEditor._render();
    });

    document.getElementById('flow-panel-approval')?.addEventListener('change', (ev) => {
      node.requiresApproval = ev.target.checked;
      FlowEditor._markDirty();
      FlowEditor._render();
    });

    document.getElementById('flow-panel-move-up')?.addEventListener('click', () => {
      FlowEditor._swapNodes(index, index - 1);
    });

    document.getElementById('flow-panel-move-down')?.addEventListener('click', () => {
      FlowEditor._swapNodes(index, index + 1);
    });

    document.getElementById('flow-panel-delete')?.addEventListener('click', () => {
      FlowEditor._removeNode(index);
    });
  },

  _closePanel() {
    const panel = document.getElementById('flow-editor-panel');
    if (panel) panel.hidden = true;
    FlowEditor._editingNode = null;
  },

  _addNode() {
    const lastNode = FlowEditor._nodes[FlowEditor._nodes.length - 1];
    const newY = lastNode
      ? lastNode.y + FlowEditor.NODE_HEIGHT + FlowEditor.NODE_GAP_Y
      : FlowEditor.START_Y;
    const newX = lastNode ? lastNode.x : FlowEditor.START_X;

    FlowEditor._nodes.push({
      id: 'step-new-' + Date.now(),
      index: FlowEditor._nodes.length,
      x: newX,
      y: newY,
      agentId: '',
      agentName: 'Selecionar agente...',
      inputTemplate: '',
      requiresApproval: false,
      description: '',
    });

    FlowEditor._markDirty();
    FlowEditor._render();

    const newIdx = FlowEditor._nodes.length - 1;
    FlowEditor._selectedNode = newIdx;
    FlowEditor._openNodePanel(newIdx);
  },

  _removeNode(index) {
    if (FlowEditor._nodes.length <= 2) {
      Toast.warning('O pipeline precisa de pelo menos 2 passos');
      return;
    }

    FlowEditor._nodes.splice(index, 1);
    FlowEditor._nodes.forEach((n, i) => { n.index = i; });

    if (FlowEditor._editingNode === index) FlowEditor._closePanel();
    if (FlowEditor._selectedNode === index) FlowEditor._selectedNode = null;

    FlowEditor._markDirty();
    FlowEditor._render();
  },

  _swapNodes(a, b) {
    if (b < 0 || b >= FlowEditor._nodes.length) return;

    const tempX = FlowEditor._nodes[a].x;
    const tempY = FlowEditor._nodes[a].y;
    FlowEditor._nodes[a].x = FlowEditor._nodes[b].x;
    FlowEditor._nodes[a].y = FlowEditor._nodes[b].y;
    FlowEditor._nodes[b].x = tempX;
    FlowEditor._nodes[b].y = tempY;

    const temp = FlowEditor._nodes[a];
    FlowEditor._nodes[a] = FlowEditor._nodes[b];
    FlowEditor._nodes[b] = temp;

    FlowEditor._nodes.forEach((n, i) => { n.index = i; });

    FlowEditor._selectedNode = b;
    FlowEditor._editingNode = b;
    FlowEditor._markDirty();
    FlowEditor._openNodePanel(b);
    FlowEditor._render();
  },

  _markDirty() {
    FlowEditor._dirty = true;
    const btn = document.getElementById('flow-editor-save-btn');
    if (btn) btn.classList.remove('flow-btn--disabled');
  },

  async _save() {
    if (!FlowEditor._dirty) return;

    const invalidNode = FlowEditor._nodes.find((n) => !n.agentId);
    if (invalidNode) {
      Toast.warning('Todos os passos devem ter um agente selecionado');
      return;
    }

    if (FlowEditor._nodes.length < 2) {
      Toast.warning('O pipeline precisa de pelo menos 2 passos');
      return;
    }

    const steps = FlowEditor._nodes.map((n) => ({
      agentId: n.agentId,
      inputTemplate: n.inputTemplate || '',
      requiresApproval: !!n.requiresApproval,
    }));

    try {
      await API.pipelines.update(FlowEditor._pipelineId, {
        name: FlowEditor._pipeline.name,
        description: FlowEditor._pipeline.description,
        steps,
      });

      FlowEditor._dirty = false;
      const btn = document.getElementById('flow-editor-save-btn');
      if (btn) btn.classList.add('flow-btn--disabled');

      Toast.success('Pipeline atualizado com sucesso');

      if (typeof PipelinesUI !== 'undefined') PipelinesUI.load();
    } catch (err) {
      Toast.error('Erro ao salvar: ' + err.message);
    }
  },

  _close() {
    if (FlowEditor._dirty) {
      const leave = confirm('Existem alterações não salvas. Deseja sair mesmo assim?');
      if (!leave) return;
    }

    FlowEditor._teardown();
  },

  _teardown() {
    const overlay = FlowEditor._overlay;
    if (!overlay || overlay.hidden) return;

    overlay.classList.remove('active');
    setTimeout(() => { overlay.hidden = true; }, 200);

    FlowEditor._closePanel();

    if (FlowEditor._resizeObserver) {
      FlowEditor._resizeObserver.disconnect();
    }

    document.removeEventListener('keydown', FlowEditor._onKeyDown);

    FlowEditor._editingNode = null;
    FlowEditor._selectedNode = null;
    FlowEditor._dragState = null;
    FlowEditor._panStart = null;
    FlowEditor._dirty = false;
  },
};

window.FlowEditor = FlowEditor;
