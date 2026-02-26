const API = {
  baseUrl: '/api',

  async request(method, path, body = null) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
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
    execute(id, task, instructions) { return API.request('POST', `/agents/${id}/execute`, { task, instructions }); },
    cancel(id, executionId) { return API.request('POST', `/agents/${id}/cancel/${executionId}`); },
    export(id) { return API.request('GET', `/agents/${id}/export`); },
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
    delete(taskId) { return API.request('DELETE', `/schedules/${taskId}`); },
  },

  pipelines: {
    list() { return API.request('GET', '/pipelines'); },
    get(id) { return API.request('GET', `/pipelines/${id}`); },
    create(data) { return API.request('POST', '/pipelines', data); },
    update(id, data) { return API.request('PUT', `/pipelines/${id}`, data); },
    delete(id) { return API.request('DELETE', `/pipelines/${id}`); },
    execute(id, input) { return API.request('POST', `/pipelines/${id}/execute`, { input }); },
    cancel(id) { return API.request('POST', `/pipelines/${id}/cancel`); },
  },

  system: {
    status() { return API.request('GET', '/system/status'); },
    activeExecutions() { return API.request('GET', '/executions/active'); },
  },
};

window.API = API;
