const SettingsUI = {
  async load() {
    try {
      const [settings, info] = await Promise.all([
        API.settings.get(),
        API.system.info(),
      ]);

      SettingsUI.populateForm(settings);
      SettingsUI.populateSystemInfo(info);
    } catch (err) {
      Toast.error(`Erro ao carregar configurações: ${err.message}`);
    }
  },

  populateForm(settings) {
    const fields = {
      'settings-default-model': settings.defaultModel || 'claude-sonnet-4-6',
      'settings-default-workdir': settings.defaultWorkdir || '',
      'settings-max-concurrent': settings.maxConcurrent || 5,
    };

    for (const [id, value] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }
  },

  populateSystemInfo(info) {
    const fields = {
      'info-server-version': info.serverVersion || '1.0.0',
      'info-node-version': info.nodeVersion || 'N/A',
      'info-claude-version': info.claudeVersion || 'N/A',
      'info-platform': info.platform || 'N/A',
      'info-uptime': SettingsUI.formatUptime(info.uptime),
    };

    for (const [id, value] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }
  },

  formatUptime(seconds) {
    if (!seconds && seconds !== 0) return 'N/A';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  },

  async save() {
    const data = {
      defaultModel: document.getElementById('settings-default-model')?.value || 'claude-sonnet-4-6',
      defaultWorkdir: document.getElementById('settings-default-workdir')?.value.trim() || '',
      maxConcurrent: parseInt(document.getElementById('settings-max-concurrent')?.value) || 5,
    };

    try {
      await API.settings.save(data);
      Toast.success('Configurações salvas com sucesso');
    } catch (err) {
      Toast.error(`Erro ao salvar configurações: ${err.message}`);
    }
  },
};

window.SettingsUI = SettingsUI;
