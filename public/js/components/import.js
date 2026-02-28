const ImportUI = {
  _selectedFiles: [],
  _selectedPaths: [],
  _folderName: '',
  _importing: false,

  _excludedDirs: ['.git', 'node_modules', '__pycache__', '.next', '.nuxt', 'venv', '.venv', '.cache', '.parcel-cache', 'dist', 'build', '.output', '.svelte-kit', 'vendor', 'target', '.gradle', '.idea', '.vs', 'coverage', '.nyc_output'],
  _excludedFiles: ['.git', '.DS_Store', 'Thumbs.db', 'desktop.ini', '*.pyc', '*.pyo', '*.class', '*.o', '*.so', '*.dll'],

  async load() {
    const container = document.getElementById('import-container');
    if (!container) return;

    let repos = [];
    try { repos = await API.repos.list(); } catch {}

    container.innerHTML = `
      <div class="import-layout">
        <div class="card import-card">
          <div class="card-header">
            <h2 class="card-title"><i data-lucide="upload-cloud" style="width:20px;height:20px"></i> Importar Projeto</h2>
          </div>
          <div class="card-body">
            <p class="import-desc">Selecione uma pasta do seu computador para enviar ao Gitea. Arquivos ignorados pelo <code>.gitignore</code> e pastas como <code>node_modules</code> serão filtrados automaticamente.</p>

            <input type="file" id="import-folder-input" webkitdirectory directory multiple hidden />

            <div class="form-group">
              <label class="form-label">Pasta do projeto</label>
              <div class="import-path-row">
                <div class="import-folder-display" id="import-folder-display">
                  <i data-lucide="folder-open" style="width:18px;height:18px;color:var(--text-muted)"></i>
                  <span class="text-muted">Nenhuma pasta selecionada</span>
                </div>
                <button class="btn btn--primary btn--sm" id="import-select-btn" type="button">
                  <i data-lucide="folder-search" style="width:16px;height:16px"></i> Selecionar Pasta
                </button>
              </div>
            </div>

            <div id="import-preview" class="import-preview" hidden></div>

            <div class="form-group">
              <label class="form-label">Nome do repositório no Gitea</label>
              <input type="text" class="form-input" id="import-repo-name" placeholder="meu-projeto" />
              <span class="form-hint">Letras minúsculas, números e hífens</span>
            </div>

            <button class="btn btn--primary" id="import-submit-btn" type="button" disabled>
              <i data-lucide="upload-cloud" style="width:16px;height:16px"></i> Importar para o Gitea
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title"><i data-lucide="git-branch" style="width:20px;height:20px"></i> Repositórios no Gitea</h2>
            <span class="badge badge--accent">${repos.length}</span>
          </div>
          <div class="card-body">
            ${repos.length === 0 ? '<p class="text-muted">Nenhum repositório encontrado</p>' : ''}
            <div class="import-repos-grid">
              ${repos.map(r => ImportUI._renderRepoCard(r)).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    Utils.refreshIcons(container);
    ImportUI._bindEvents();
  },

  _renderRepoCard(repo) {
    const domain = 'nitro-cloud.duckdns.org';
    const repoUrl = `https://git.${domain}/${repo.full_name || repo.name}`;
    const updated = repo.updated_at ? new Date(repo.updated_at).toLocaleDateString('pt-BR') : '';
    const size = repo.size ? ImportUI._fmtSize(repo.size * 1024) : '';

    return `
      <div class="import-repo-card">
        <div class="import-repo-header">
          <i data-lucide="git-branch" style="width:16px;height:16px;color:var(--accent)"></i>
          <a href="${Utils.escapeHtml(repoUrl)}" target="_blank" class="import-repo-name">${Utils.escapeHtml(repo.name)}</a>
        </div>
        ${repo.description ? `<p class="import-repo-desc">${Utils.escapeHtml(repo.description)}</p>` : ''}
        <div class="import-repo-meta">
          ${updated ? `<span><i data-lucide="calendar" style="width:12px;height:12px"></i> ${updated}</span>` : ''}
          ${size ? `<span><i data-lucide="hard-drive" style="width:12px;height:12px"></i> ${size}</span>` : ''}
          ${repo.default_branch ? `<span><i data-lucide="git-commit" style="width:12px;height:12px"></i> ${Utils.escapeHtml(repo.default_branch)}</span>` : ''}
        </div>
      </div>
    `;
  },

  _fmtSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  },

  _bindEvents() {
    const selectBtn = document.getElementById('import-select-btn');
    const folderInput = document.getElementById('import-folder-input');
    const submitBtn = document.getElementById('import-submit-btn');

    if (selectBtn && folderInput) {
      selectBtn.addEventListener('click', () => folderInput.click());
      folderInput.addEventListener('change', () => ImportUI._onFolderSelected(folderInput.files));
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', () => ImportUI._doUpload());
    }
  },

  _shouldExclude(relativePath) {
    const parts = relativePath.split('/');
    for (const part of parts.slice(0, -1)) {
      if (ImportUI._excludedDirs.includes(part)) return true;
    }
    const fileName = parts[parts.length - 1];
    for (const pattern of ImportUI._excludedFiles) {
      if (pattern.startsWith('*.')) {
        if (fileName.endsWith(pattern.slice(1))) return true;
      } else {
        if (fileName === pattern) return true;
      }
    }
    return false;
  },

  _parseGitignore(content) {
    const patterns = [];
    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      patterns.push(line.replace(/\/$/, ''));
    }
    return patterns;
  },

  _matchesGitignore(relativePath, patterns) {
    const parts = relativePath.split('/');
    for (const pattern of patterns) {
      if (pattern.includes('/')) {
        if (relativePath.startsWith(pattern + '/') || relativePath === pattern) return true;
      } else if (pattern.startsWith('*.')) {
        const ext = pattern.slice(1);
        if (relativePath.endsWith(ext)) return true;
      } else {
        for (const part of parts) {
          if (part === pattern) return true;
        }
      }
    }
    return false;
  },

  _onFolderSelected(fileList) {
    if (!fileList || fileList.length === 0) return;

    const allFiles = Array.from(fileList);
    const firstPath = allFiles[0].webkitRelativePath || '';
    ImportUI._folderName = firstPath.split('/')[0] || 'projeto';

    let gitignorePatterns = [];
    const gitignoreFile = allFiles.find(f => {
      const rel = f.webkitRelativePath || '';
      const parts = rel.split('/');
      return parts.length === 2 && parts[1] === '.gitignore';
    });

    if (gitignoreFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        gitignorePatterns = ImportUI._parseGitignore(e.target.result);
        ImportUI._applyFilter(allFiles, gitignorePatterns);
      };
      reader.readAsText(gitignoreFile);
    } else {
      ImportUI._applyFilter(allFiles, []);
    }
  },

  _applyFilter(allFiles, gitignorePatterns) {
    const filtered = [];
    const paths = [];
    let totalSize = 0;
    let excluded = 0;

    for (const file of allFiles) {
      const fullRel = file.webkitRelativePath || file.name;
      const relWithoutRoot = fullRel.split('/').slice(1).join('/');
      if (!relWithoutRoot) continue;

      if (ImportUI._shouldExclude(relWithoutRoot)) { excluded++; continue; }
      if (gitignorePatterns.length > 0 && ImportUI._matchesGitignore(relWithoutRoot, gitignorePatterns)) { excluded++; continue; }

      filtered.push(file);
      paths.push(fullRel);
      totalSize += file.size;
    }

    ImportUI._selectedFiles = filtered;
    ImportUI._selectedPaths = paths;

    const display = document.getElementById('import-folder-display');
    if (display) {
      display.innerHTML = `
        <i data-lucide="folder" style="width:18px;height:18px;color:var(--warning)"></i>
        <strong>${Utils.escapeHtml(ImportUI._folderName)}</strong>
      `;
      Utils.refreshIcons(display);
    }

    const preview = document.getElementById('import-preview');
    if (preview) {
      preview.hidden = false;
      preview.innerHTML = `
        <div class="import-preview-stats">
          <div class="import-stat">
            <i data-lucide="file" style="width:16px;height:16px"></i>
            <span><strong>${filtered.length}</strong> arquivos selecionados</span>
          </div>
          <div class="import-stat">
            <i data-lucide="hard-drive" style="width:16px;height:16px"></i>
            <span><strong>${ImportUI._fmtSize(totalSize)}</strong> total</span>
          </div>
          ${excluded > 0 ? `<div class="import-stat import-stat--muted">
            <i data-lucide="eye-off" style="width:16px;height:16px"></i>
            <span>${excluded} arquivos ignorados (.gitignore / node_modules / etc.)</span>
          </div>` : ''}
        </div>
      `;
      Utils.refreshIcons(preview);
    }

    const nameInput = document.getElementById('import-repo-name');
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = ImportUI._folderName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    }

    const submitBtn = document.getElementById('import-submit-btn');
    if (submitBtn) submitBtn.disabled = filtered.length === 0;
  },

  async _doUpload() {
    if (ImportUI._importing) return;
    if (ImportUI._selectedFiles.length === 0) { Toast.warning('Selecione uma pasta primeiro'); return; }

    const nameInput = document.getElementById('import-repo-name');
    const submitBtn = document.getElementById('import-submit-btn');
    const repoName = (nameInput?.value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!repoName) { Toast.warning('Informe o nome do repositório'); return; }

    ImportUI._importing = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px" class="spin"></i> Enviando...';
      Utils.refreshIcons(submitBtn);
    }

    try {
      Toast.info(`Enviando ${ImportUI._selectedFiles.length} arquivos...`);
      const result = await API.projects.upload(ImportUI._selectedFiles, ImportUI._selectedPaths, repoName);

      Toast.success('Projeto importado com sucesso!');

      const modal = document.getElementById('execution-detail-modal-overlay');
      const title = document.getElementById('execution-detail-title');
      const content = document.getElementById('execution-detail-content');
      if (modal && title && content) {
        title.textContent = 'Projeto Importado';
        content.innerHTML = `
          <div class="publish-result">
            <div class="publish-result-item"><strong>Repositório:</strong> <a href="${Utils.escapeHtml(result.repoUrl)}" target="_blank">${Utils.escapeHtml(result.repoUrl)}</a></div>
            <div class="publish-result-item"><strong>Diretório:</strong> <code>${Utils.escapeHtml(result.projectDir)}</code></div>
            <div class="publish-result-item"><strong>Status:</strong> <span class="badge badge-active">${Utils.escapeHtml(result.status)}</span></div>
            ${result.message ? `<div class="publish-result-item"><em>${Utils.escapeHtml(result.message)}</em></div>` : ''}
            <div class="publish-result-steps">
              <strong>Passos:</strong>
              <ul>${(result.steps || []).map(s => `<li>${Utils.escapeHtml(s)}</li>`).join('')}</ul>
            </div>
          </div>`;
        Modal.open('execution-detail-modal-overlay');
      }

      ImportUI._selectedFiles = [];
      ImportUI._selectedPaths = [];
      ImportUI._folderName = '';
      if (nameInput) nameInput.value = '';
      App._reposCache = null;
      await ImportUI.load();
    } catch (err) {
      Toast.error(`Erro ao importar: ${err.message}`);
    } finally {
      ImportUI._importing = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="upload-cloud" style="width:16px;height:16px"></i> Importar para o Gitea';
        Utils.refreshIcons(submitBtn);
      }
    }
  },
};

window.ImportUI = ImportUI;
