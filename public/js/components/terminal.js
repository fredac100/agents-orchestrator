const Terminal = {
  lines: [],
  maxLines: 1000,
  autoScroll: true,
  executionFilter: null,
  _processingInterval: null,
  _chatSession: null,
  searchMatches: [],
  searchIndex: -1,
  _toolbarInitialized: false,

  enableChat(agentId, agentName, sessionId) {
    Terminal._chatSession = { agentId, agentName, sessionId };
    const bar = document.getElementById('terminal-input-bar');
    const ctx = document.getElementById('terminal-input-context');
    const input = document.getElementById('terminal-input');
    if (bar) bar.hidden = false;
    if (ctx) ctx.textContent = `Conversando com: ${agentName}`;
    if (input) { input.value = ''; input.focus(); }
  },

  disableChat() {
    Terminal._chatSession = null;
    const bar = document.getElementById('terminal-input-bar');
    if (bar) bar.hidden = true;
  },

  getChatSession() {
    return Terminal._chatSession;
  },

  updateSessionId(sessionId) {
    if (Terminal._chatSession) Terminal._chatSession.sessionId = sessionId;
  },

  addLine(content, type = 'default', executionId = null) {
    const time = new Date();
    const formatted = time.toTimeString().slice(0, 8);

    Terminal.lines.push({ content, type, timestamp: formatted, executionId });

    if (Terminal.lines.length > Terminal.maxLines) {
      Terminal.lines.shift();
    }

    Terminal.render();
  },

  startProcessing(agentName) {
    Terminal.stopProcessing();
    Terminal.addLine(`Agente "${agentName}" processando tarefa...`, 'system');

    let dots = 0;
    Terminal._processingInterval = setInterval(() => {
      dots = (dots + 1) % 4;
      const indicator = document.getElementById('terminal-processing');
      if (indicator) {
        indicator.textContent = 'Processando' + '.'.repeat(dots + 1);
      }
    }, 500);

    Terminal.render();
  },

  stopProcessing() {
    if (Terminal._processingInterval) {
      clearInterval(Terminal._processingInterval);
      Terminal._processingInterval = null;
    }
  },

  clear() {
    Terminal.stopProcessing();
    Terminal.lines = [];
    Terminal.executionFilter = null;
    Terminal.render();
  },

  setExecutionFilter(executionId) {
    Terminal.executionFilter = executionId;
    Terminal.render();
  },

  scrollToBottom() {
    const output = document.getElementById('terminal-output');
    if (output) output.scrollTop = output.scrollHeight;
  },

  initToolbar() {
    if (Terminal._toolbarInitialized) return;
    Terminal._toolbarInitialized = true;

    const searchToggle = document.getElementById('terminal-search-toggle');
    const searchBar = document.getElementById('terminal-search-bar');
    const searchInput = document.getElementById('terminal-search-input');
    const searchClose = document.getElementById('terminal-search-close');
    const searchPrev = document.getElementById('terminal-search-prev');
    const searchNext = document.getElementById('terminal-search-next');
    const downloadBtn = document.getElementById('terminal-download');
    const copyBtn = document.getElementById('terminal-copy');
    const autoScrollCheck = document.getElementById('terminal-autoscroll');

    if (searchToggle && searchBar) {
      searchToggle.addEventListener('click', () => {
        searchBar.classList.toggle('hidden');
        if (!searchBar.classList.contains('hidden') && searchInput) searchInput.focus();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => Terminal.search(searchInput.value));
    }

    if (searchClose && searchBar) {
      searchClose.addEventListener('click', () => {
        searchBar.classList.add('hidden');
        Terminal.clearSearch();
      });
    }

    if (searchPrev) searchPrev.addEventListener('click', () => Terminal.searchPrev());
    if (searchNext) searchNext.addEventListener('click', () => Terminal.searchNext());

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => Terminal.downloadOutput());
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', () => Terminal.copyOutput());
    }

    if (autoScrollCheck) {
      autoScrollCheck.addEventListener('change', (e) => {
        Terminal.autoScroll = e.target.checked;
      });
    }
  },

  search(query) {
    const output = document.getElementById('terminal-output');
    if (!output || !query) { Terminal.clearSearch(); return; }

    const text = output.textContent;
    Terminal.searchMatches = [];
    Terminal.searchIndex = -1;

    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      Terminal.searchMatches.push(match.index);
    }

    const countEl = document.getElementById('terminal-search-count');
    if (countEl) countEl.textContent = Terminal.searchMatches.length > 0 ? `0/${Terminal.searchMatches.length}` : '0/0';

    if (Terminal.searchMatches.length > 0) Terminal.searchNext();
  },

  searchNext() {
    if (Terminal.searchMatches.length === 0) return;
    Terminal.searchIndex = (Terminal.searchIndex + 1) % Terminal.searchMatches.length;
    const countEl = document.getElementById('terminal-search-count');
    if (countEl) countEl.textContent = `${Terminal.searchIndex + 1}/${Terminal.searchMatches.length}`;
  },

  searchPrev() {
    if (Terminal.searchMatches.length === 0) return;
    Terminal.searchIndex = Terminal.searchIndex <= 0 ? Terminal.searchMatches.length - 1 : Terminal.searchIndex - 1;
    const countEl = document.getElementById('terminal-search-count');
    if (countEl) countEl.textContent = `${Terminal.searchIndex + 1}/${Terminal.searchMatches.length}`;
  },

  clearSearch() {
    Terminal.searchMatches = [];
    Terminal.searchIndex = -1;
    const countEl = document.getElementById('terminal-search-count');
    if (countEl) countEl.textContent = '0/0';
  },

  downloadOutput() {
    const output = document.getElementById('terminal-output');
    if (!output) return;
    const text = output.textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terminal_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    if (typeof Toast !== 'undefined') Toast.success('Saída baixada');
  },

  copyOutput() {
    const output = document.getElementById('terminal-output');
    if (!output) return;
    navigator.clipboard.writeText(output.textContent).then(() => {
      if (typeof Toast !== 'undefined') Toast.success('Saída copiada');
    });
  },

  render() {
    Terminal.initToolbar();
    const output = document.getElementById('terminal-output');
    if (!output) return;

    const lines = Terminal.executionFilter
      ? Terminal.lines.filter((l) => !l.executionId || l.executionId === Terminal.executionFilter)
      : Terminal.lines;

    if (lines.length === 0 && !Terminal._processingInterval) {
      output.innerHTML = `
        <div class="terminal-welcome">
          <span class="terminal-prompt">$</span>
          <span class="terminal-text">Aguardando execução de agente...</span>
        </div>`;
      return;
    }

    const html = lines.map((line) => {
      const typeClass = line.type && line.type !== 'default' ? ' ' + line.type : '';
      const escaped = Utils.escapeHtml(line.content);
      const formatted = escaped.replace(/\n/g, '<br>');

      return `<div class="terminal-line${typeClass}">
        <span class="timestamp">${line.timestamp}</span>
        <span class="content">${formatted}</span>
      </div>`;
    }).join('');

    const processing = Terminal._processingInterval
      ? '<div class="terminal-line system"><span class="terminal-processing-indicator"><span id="terminal-processing" class="processing-dots">Processando...</span><span class="terminal-spinner"></span></span></div>'
      : '';

    output.innerHTML = html + processing + '<span class="terminal-cursor blink">_</span>';

    if (Terminal.autoScroll) Terminal.scrollToBottom();
  },

};

window.Terminal = Terminal;
