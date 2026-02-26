const Terminal = {
  lines: [],
  maxLines: 1000,
  autoScroll: true,
  executionFilter: null,
  _processingInterval: null,
  _chatSession: null,

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

  render() {
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
