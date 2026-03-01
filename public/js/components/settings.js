const SettingsUI = {
  _providers: null,
  _currentSettings: null,
  _initialized: false,

  async load() {
    try {
      const [settings, info, providers] = await Promise.all([
        API.settings.getSafe(),
        API.system.info(),
        API.settings.providers(),
      ]);

      SettingsUI._currentSettings = settings;
      SettingsUI._providers = providers;

      SettingsUI.populateForm(settings);
      SettingsUI.populateSystemInfo(info);
      SettingsUI.updateThemeInfo();
      SettingsUI._applyExecutionMode(settings.executionMode || 'cli');
      SettingsUI._populateProviderConfig(settings);

      if (!SettingsUI._initialized) {
        SettingsUI._setupEvents();
        SettingsUI._initialized = true;
      }
    } catch (err) {
      Toast.error(`Erro ao carregar configurações: ${err.message}`);
    }
  },

  _setupEvents() {
    document.querySelectorAll('input[name="executionMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        SettingsUI._applyExecutionMode(e.target.value);
        SettingsUI._saveExecutionMode(e.target.value);
      });
    });

    const providerSelect = document.getElementById('settings-llm-provider');
    if (providerSelect) {
      providerSelect.addEventListener('change', () => {
        SettingsUI._onProviderChange();
      });
    }

    const tempRange = document.getElementById('settings-llm-temperature');
    if (tempRange) {
      tempRange.addEventListener('input', () => {
        const val = document.getElementById('settings-temperature-value');
        if (val) val.textContent = parseFloat(tempRange.value).toFixed(1);
      });
    }

    const toggleKeyBtn = document.getElementById('settings-toggle-key-visibility');
    if (toggleKeyBtn) {
      toggleKeyBtn.addEventListener('click', () => {
        const input = document.getElementById('settings-api-key');
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        const icon = toggleKeyBtn.querySelector('i');
        if (icon) {
          icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
          lucide.createIcons({ nodes: [icon.parentElement] });
        }
      });
    }

    const saveLlmBtn = document.getElementById('settings-save-llm');
    if (saveLlmBtn) {
      saveLlmBtn.addEventListener('click', () => SettingsUI._saveLlmConfig());
    }

    const testBtn = document.getElementById('settings-test-connection');
    if (testBtn) {
      testBtn.addEventListener('click', () => SettingsUI._testConnection());
    }
  },

  _applyExecutionMode(mode) {
    const apiConfig = document.getElementById('settings-api-config');
    const modelGroup = document.getElementById('settings-default-model-group');

    document.querySelectorAll('.mode-option').forEach(el => {
      el.classList.toggle('active', el.dataset.mode === mode);
    });

    const radio = document.querySelector(`input[name="executionMode"][value="${mode}"]`);
    if (radio) radio.checked = true;

    if (apiConfig) apiConfig.style.display = mode === 'api' ? '' : 'none';
    if (modelGroup) modelGroup.style.display = mode === 'cli' ? '' : 'none';

    const modeInfo = document.getElementById('info-execution-mode');
    if (modeInfo) modeInfo.textContent = mode === 'cli' ? 'Claude Code CLI' : 'API Direta';
  },

  async _saveExecutionMode(mode) {
    try {
      await API.settings.save({ executionMode: mode });
    } catch (err) {
      Toast.error(`Erro ao salvar modo: ${err.message}`);
    }
  },

  _populateProviderConfig(settings) {
    const providerSelect = document.getElementById('settings-llm-provider');
    if (providerSelect) {
      providerSelect.value = settings.llmProvider || 'anthropic';
    }

    const tempRange = document.getElementById('settings-llm-temperature');
    const tempValue = document.getElementById('settings-temperature-value');
    if (tempRange) {
      tempRange.value = settings.llmTemperature ?? 1;
      if (tempValue) tempValue.textContent = parseFloat(tempRange.value).toFixed(1);
    }

    const maxTokens = document.getElementById('settings-llm-max-tokens');
    if (maxTokens) maxTokens.value = settings.llmMaxOutputTokens || 128000;

    SettingsUI._onProviderChange();

    SettingsUI._updateKeyStatus(settings.llmProvider || 'anthropic', settings.llmApiKeys);
  },

  _onProviderChange() {
    const provider = document.getElementById('settings-llm-provider')?.value || 'anthropic';
    const providers = SettingsUI._providers;
    if (!providers || !providers[provider]) return;

    const info = providers[provider];
    const modelSelect = document.getElementById('settings-llm-model');
    if (modelSelect) {
      modelSelect.innerHTML = '';
      for (const m of info.models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        modelSelect.appendChild(opt);
      }

      const settings = SettingsUI._currentSettings;
      if (settings?.llmModels?.[provider]) {
        modelSelect.value = settings.llmModels[provider];
      }
    }

    const keyInput = document.getElementById('settings-api-key');
    if (keyInput) {
      keyInput.placeholder = info.keyPlaceholder || '';
      keyInput.value = '';
    }

    const hint = document.getElementById('settings-api-key-hint');
    if (hint) {
      hint.textContent = `Chave para ${info.name}. Armazenada de forma segura no servidor.`;
    }

    SettingsUI._updateKeyStatus(provider, SettingsUI._currentSettings?.llmApiKeys);
  },

  _updateKeyStatus(provider, keys) {
    const status = document.getElementById('settings-api-key-status');
    if (!status) return;

    const maskedKey = keys?.[provider];
    if (maskedKey && maskedKey !== '' && maskedKey !== '****') {
      status.className = 'api-key-status configured';
      status.textContent = `Configurada (${maskedKey})`;
    } else {
      status.className = 'api-key-status not-configured';
      status.textContent = 'Não configurada';
    }
  },

  async _saveLlmConfig() {
    const provider = document.getElementById('settings-llm-provider')?.value || 'anthropic';
    const model = document.getElementById('settings-llm-model')?.value || '';
    const apiKey = document.getElementById('settings-api-key')?.value?.trim() || '';
    const temperature = parseFloat(document.getElementById('settings-llm-temperature')?.value) || 1;
    const maxTokens = parseInt(document.getElementById('settings-llm-max-tokens')?.value) || 128000;

    const data = {
      llmProvider: provider,
      llmModels: { [provider]: model },
      llmTemperature: temperature,
      llmMaxOutputTokens: maxTokens,
    };

    if (apiKey) {
      data.llmApiKeys = { [provider]: apiKey };
    }

    try {
      const saved = await API.settings.save(data);
      SettingsUI._currentSettings = { ...SettingsUI._currentSettings, ...saved };
      if (saved.llmApiKeys) {
        SettingsUI._updateKeyStatus(provider, saved.llmApiKeys);
      }
      document.getElementById('settings-api-key').value = '';
      Toast.success('Configurações do provider salvas');
    } catch (err) {
      Toast.error(`Erro ao salvar: ${err.message}`);
    }
  },

  async _testConnection() {
    const provider = document.getElementById('settings-llm-provider')?.value || 'anthropic';
    const settings = SettingsUI._currentSettings;

    if (!settings?.llmApiKeys?.[provider] || settings.llmApiKeys[provider] === '') {
      Toast.error('Nenhuma API key configurada para este provider');
      return;
    }

    const btn = document.getElementById('settings-test-connection');
    const originalText = btn.textContent;
    btn.textContent = 'Testando...';
    btn.disabled = true;

    try {
      const result = await API.request('POST', '/settings/test-connection', { provider });
      if (result.success) {
        Toast.success(`Conexão com ${SettingsUI._providers[provider]?.name || provider} OK`);
      } else {
        Toast.error(`Falha: ${result.error || 'Erro desconhecido'}`);
      }
    } catch (err) {
      Toast.error(`Erro ao testar: ${err.message}`);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  },

  updateThemeInfo() {
    const themeEl = document.getElementById('info-current-theme');
    if (themeEl) {
      const theme = document.documentElement.getAttribute('data-theme') || 'dark';
      themeEl.textContent = theme === 'dark' ? 'Escuro' : 'Claro';
    }
  },

  populateForm(settings) {
    const fields = {
      'settings-default-model': settings.defaultModel || 'claude-sonnet-4-6',
      'settings-default-workdir': settings.defaultWorkdir || '',
      'settings-max-concurrent': settings.maxConcurrent || 5,
      'settings-execution-timeout': String(settings.executionTimeout || 1800000),
      'settings-idle-timeout': String(settings.idleTimeout || 300000),
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
      executionTimeout: parseInt(document.getElementById('settings-execution-timeout')?.value) || 1800000,
      idleTimeout: parseInt(document.getElementById('settings-idle-timeout')?.value) || 300000,
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
