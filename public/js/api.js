const API = {
  baseUrl: '/api',
  clientId: sessionStorage.getItem('clientId') || (() => {
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    sessionStorage.setItem('clientId', id);
    return id;
  })(),

  async request(method, path, body = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': API.clientId,
      },
    };

    if (body !== null) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API.baseUrl}${path}`, options);

    if (response.status === 204) return null;

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Erro HTTP ${response.status}`);
    }

    return data;
  },

  agents: {
    list() { return API.request('GET', '/agents'); },
    get(id) { return API.request('GET', `/agents/${id}`); },
    create(data) { return API.request('POST', '/agents', data); },
    update(id, data) { return API.request('PUT', `/agents/${id}`, data); },
    delete(id) { return API.request('DELETE', `/agents/${id}`); },
    execute(id, task, instructions, contextFiles, workingDirectory, repoName, repoBranch) {
      const body = { task, instructions };
      if (repoName) { body.repoName = repoName; if (repoBranch) body.repoBranch = repoBranch; }
      else if (workingDirectory) body.workingDirectory = workingDirectory;
      if (contextFiles && contextFiles.length > 0) body.contextFiles = contextFiles;
      return API.request('POST', `/agents/${id}/execute`, body);
    },
    cancel(id, executionId) { return API.request('POST', `/agents/${id}/cancel/${executionId}`); },
    continue(id, sessionId, message) { return API.request('POST', `/agents/${id}/continue`, { sessionId, message }); },
    export(id) { return API.request('GET', `/agents/${id}/export`); },
    import(data) { return API.request('POST', '/agents/import', data); },
    duplicate(id) { return API.request('POST', `/agents/${id}/duplicate`); },
  },

  secrets: {
    list(agentId) { return API.request('GET', `/agents/${agentId}/secrets`); },
    create(agentId, data) { return API.request('POST', `/agents/${agentId}/secrets`, data); },
    delete(agentId, name) { return API.request('DELETE', `/agents/${agentId}/secrets/${encodeURIComponent(name)}`); },
  },

  versions: {
    list(agentId) { return API.request('GET', `/agents/${agentId}/versions`); },
    restore(agentId, version) { return API.request('POST', `/agents/${agentId}/versions/${version}/restore`); },
  },

  tasks: {
    list() { return API.request('GET', '/tasks'); },
    create(data) { return API.request('POST', '/tasks', data); },
    update(id, data) { return API.request('PUT', `/tasks/${id}`, data); },
    delete(id) { return API.request('DELETE', `/tasks/${id}`); },
  },

  schedules: {
    list() { return API.request('GET', '/schedules'); },
    create(data) { return API.request('POST', '/schedules', data); },
    update(id, data) { return API.request('PUT', `/schedules/${id}`, data); },
    delete(taskId) { return API.request('DELETE', `/schedules/${taskId}`); },
    history() { return API.request('GET', '/schedules/history'); },
  },

  pipelines: {
    list() { return API.request('GET', '/pipelines'); },
    get(id) { return API.request('GET', `/pipelines/${id}`); },
    create(data) { return API.request('POST', '/pipelines', data); },
    update(id, data) { return API.request('PUT', `/pipelines/${id}`, data); },
    delete(id) { return API.request('DELETE', `/pipelines/${id}`); },
    execute(id, input, workingDirectory, contextFiles, repoName, repoBranch) {
      const body = { input };
      if (repoName) { body.repoName = repoName; if (repoBranch) body.repoBranch = repoBranch; }
      else if (workingDirectory) body.workingDirectory = workingDirectory;
      if (contextFiles && contextFiles.length > 0) body.contextFiles = contextFiles;
      return API.request('POST', `/pipelines/${id}/execute`, body);
    },
    cancel(id) { return API.request('POST', `/pipelines/${id}/cancel`); },
    approve(id) { return API.request('POST', `/pipelines/${id}/approve`); },
    reject(id) { return API.request('POST', `/pipelines/${id}/reject`); },
    resume(executionId) { return API.request('POST', `/pipelines/resume/${executionId}`); },
  },

  webhooks: {
    list() { return API.request('GET', '/webhooks'); },
    create(data) { return API.request('POST', '/webhooks', data); },
    update(id, data) { return API.request('PUT', `/webhooks/${id}`, data); },
    delete(id) { return API.request('DELETE', `/webhooks/${id}`); },
    test(id) { return API.request('POST', `/webhooks/${id}/test`); },
  },

  stats: {
    costs(days) { return API.request('GET', `/stats/costs${days ? '?days=' + days : ''}`); },
    charts(days) { return API.request('GET', `/stats/charts${days ? '?days=' + days : ''}`); },
  },

  notifications: {
    list() { return API.request('GET', '/notifications'); },
    markRead(id) { return API.request('POST', `/notifications/${id}/read`); },
    markAllRead() { return API.request('POST', '/notifications/read-all'); },
    clear() { return API.request('DELETE', '/notifications'); },
  },

  system: {
    status() { return API.request('GET', '/system/status'); },
    info() { return API.request('GET', '/system/info'); },
    activeExecutions() { return API.request('GET', '/executions/active'); },
    cancelAll() { return API.request('POST', '/executions/cancel-all'); },
  },

  settings: {
    get() { return API.request('GET', '/settings'); },
    save(data) { return API.request('PUT', '/settings', data); },
  },

  uploads: {
    async send(files) {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const response = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'X-Client-Id': API.clientId },
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro no upload');
      return data;
    },
  },

  repos: {
    list() { return API.request('GET', '/repos'); },
    branches(name) { return API.request('GET', `/repos/${encodeURIComponent(name)}/branches`); },
  },

  projects: {
    browse(path) { return API.request('GET', `/browse?path=${encodeURIComponent(path || '/home')}`); },
    import(sourcePath, repoName) { return API.request('POST', '/projects/import', { sourcePath, repoName }); },
  },

  files: {
    list(path) { return API.request('GET', `/files${path ? '?path=' + encodeURIComponent(path) : ''}`); },
    delete(path) { return API.request('DELETE', `/files?path=${encodeURIComponent(path)}`); },
    publish(path) { return API.request('POST', '/files/publish', { path }); },
  },

  reports: {
    list() { return API.request('GET', '/reports'); },
    get(filename) { return API.request('GET', `/reports/${encodeURIComponent(filename)}`); },
    delete(filename) { return API.request('DELETE', `/reports/${encodeURIComponent(filename)}`); },
  },

  executions: {
    recent(limit = 20) { return API.request('GET', `/executions/recent?limit=${limit}`); },
    history(params = {}) {
      const qs = new URLSearchParams(params).toString();
      return API.request('GET', `/executions/history${qs ? '?' + qs : ''}`);
    },
    get(id) { return API.request('GET', `/executions/history/${id}`); },
    delete(id) { return API.request('DELETE', `/executions/history/${id}`); },
    clearAll() { return API.request('DELETE', '/executions/history'); },
    retry(id) { return API.request('POST', `/executions/${id}/retry`); },
    async exportCsv() {
      const response = await fetch('/api/executions/export', {
        headers: { 'X-Client-Id': API.clientId },
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `execucoes_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  },
};

window.API = API;
