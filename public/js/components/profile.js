const ProfileUI = {
  _initialized: false,

  async load() {
    try {
      const [meData, profileData] = await Promise.all([
        API.request('GET', '/auth/me'),
        API.auth.getProfile(),
      ]);

      ProfileUI._populateAccountInfo(meData);
      ProfileUI._populateForm(profileData);

      if (!ProfileUI._initialized) {
        ProfileUI._setupEvents();
        ProfileUI._initialized = true;
      }
    } catch (err) {
      Toast.error(`Erro ao carregar perfil: ${err.message}`);
    }
  },

  _setupEvents() {
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
      profileForm.addEventListener('submit', (e) => {
        e.preventDefault();
        ProfileUI._saveProfile();
      });
    }

    const passwordForm = document.getElementById('profile-password-form');
    if (passwordForm) {
      passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        ProfileUI._changePassword();
      });
    }

    const cpfInput = document.getElementById('profile-cpf');
    if (cpfInput) {
      cpfInput.addEventListener('input', () => {
        cpfInput.value = ProfileUI._maskCpf(cpfInput.value);
      });
    }

    const phoneInput = document.getElementById('profile-phone');
    if (phoneInput) {
      phoneInput.addEventListener('input', () => {
        phoneInput.value = ProfileUI._maskPhone(phoneInput.value);
      });
    }

    const zipInput = document.getElementById('profile-zipcode');
    if (zipInput) {
      zipInput.addEventListener('input', () => {
        zipInput.value = ProfileUI._maskZip(zipInput.value);
      });
    }

    const searchCepBtn = document.getElementById('profile-search-cep');
    if (searchCepBtn) {
      searchCepBtn.addEventListener('click', () => ProfileUI._searchCep());
    }
  },

  _populateAccountInfo(meData) {
    const user = meData.user || {};
    const el = (id, val) => {
      const e = document.getElementById(id);
      if (e) e.textContent = val;
    };

    el('profile-user-id', user.id ? user.id.slice(0, 8) + '...' : '—');
    el('profile-plan', meData.plan?.name || user.plan || '—');
    el('profile-role', user.role === 'owner' ? 'Administrador' : user.role === 'admin' ? 'Admin' : 'Membro');

    const emailEl = document.getElementById('profile-email');
    if (emailEl) emailEl.value = user.email || '';
  },

  _populateForm(profile) {
    const fields = {
      'profile-fullname': profile.fullName || '',
      'profile-cpf': profile.cpf || '',
      'profile-phone': profile.phone || '',
      'profile-birthdate': profile.birthDate || '',
      'profile-address': profile.address || '',
      'profile-address-number': profile.addressNumber || '',
      'profile-complement': profile.complement || '',
      'profile-neighborhood': profile.neighborhood || '',
      'profile-city': profile.city || '',
      'profile-state': profile.state || '',
      'profile-zipcode': profile.zipCode || '',
    };

    for (const [id, value] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }
  },

  async _saveProfile() {
    const data = {
      fullName: document.getElementById('profile-fullname')?.value?.trim() || '',
      cpf: document.getElementById('profile-cpf')?.value?.trim() || '',
      phone: document.getElementById('profile-phone')?.value?.trim() || '',
      birthDate: document.getElementById('profile-birthdate')?.value || '',
      address: document.getElementById('profile-address')?.value?.trim() || '',
      addressNumber: document.getElementById('profile-address-number')?.value?.trim() || '',
      complement: document.getElementById('profile-complement')?.value?.trim() || '',
      neighborhood: document.getElementById('profile-neighborhood')?.value?.trim() || '',
      city: document.getElementById('profile-city')?.value?.trim() || '',
      state: document.getElementById('profile-state')?.value || '',
      zipCode: document.getElementById('profile-zipcode')?.value?.trim() || '',
    };

    if (!data.fullName) {
      Toast.error('Nome completo é obrigatório');
      return;
    }

    try {
      await API.auth.saveProfile(data);

      const nameEl = document.getElementById('header-user-name');
      if (nameEl && data.fullName) nameEl.textContent = data.fullName;

      Toast.success('Perfil salvo com sucesso');
    } catch (err) {
      Toast.error(`Erro ao salvar perfil: ${err.message}`);
    }
  },

  async _changePassword() {
    const currentPassword = document.getElementById('profile-current-password')?.value || '';
    const newPassword = document.getElementById('profile-new-password')?.value || '';

    if (!currentPassword || !newPassword) {
      Toast.error('Preencha a senha atual e a nova senha');
      return;
    }

    if (newPassword.length < 6) {
      Toast.error('Nova senha deve ter no mínimo 6 caracteres');
      return;
    }

    try {
      await API.request('PUT', '/auth/profile', { currentPassword, newPassword });
      document.getElementById('profile-current-password').value = '';
      document.getElementById('profile-new-password').value = '';
      Toast.success('Senha alterada com sucesso');
    } catch (err) {
      Toast.error(`Erro ao alterar senha: ${err.message}`);
    }
  },

  async _searchCep() {
    const zip = document.getElementById('profile-zipcode')?.value?.replace(/\D/g, '') || '';
    if (zip.length !== 8) {
      Toast.error('CEP deve ter 8 dígitos');
      return;
    }

    try {
      const res = await fetch(`https://viacep.com.br/ws/${zip}/json/`);
      const data = await res.json();
      if (data.erro) {
        Toast.error('CEP não encontrado');
        return;
      }

      const fields = {
        'profile-address': data.logradouro || '',
        'profile-neighborhood': data.bairro || '',
        'profile-city': data.localidade || '',
        'profile-state': data.uf || '',
      };

      for (const [id, value] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el && value) el.value = value;
      }

      const numEl = document.getElementById('profile-address-number');
      if (numEl) numEl.focus();

      Toast.success('Endereço preenchido');
    } catch {
      Toast.error('Erro ao buscar CEP');
    }
  },

  _maskCpf(v) {
    return v.replace(/\D/g, '').slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  },

  _maskPhone(v) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
  },

  _maskZip(v) {
    return v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
  },
};

window.ProfileUI = ProfileUI;
