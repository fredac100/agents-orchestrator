const Auth = {
  TOKEN_KEY: 'auth_token',
  USER_KEY: 'auth_user',

  getToken() {
    return localStorage.getItem(Auth.TOKEN_KEY);
  },

  setToken(token) {
    localStorage.setItem(Auth.TOKEN_KEY, token);
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem(Auth.USER_KEY));
    } catch {
      return null;
    }
  },

  setUser(user) {
    localStorage.setItem(Auth.USER_KEY, JSON.stringify(user));
  },

  clear() {
    localStorage.removeItem(Auth.TOKEN_KEY);
    localStorage.removeItem(Auth.USER_KEY);
  },

  isAuthenticated() {
    return !!Auth.getToken();
  },

  logout() {
    Auth.clear();
    window.location.href = '/login.html';
  },

  requireAuth() {
    if (!Auth.isAuthenticated()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  },

  async verify() {
    const token = Auth.getToken();
    if (!token) return null;

    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) {
        Auth.clear();
        return null;
      }
      const data = await res.json();
      Auth.setUser(data.user);
      return data;
    } catch {
      return null;
    }
  },

  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    return data;
  },

  async register(name, email, password) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    return data;
  },

  async checkFirstUser() {
    try {
      const res = await fetch('/api/auth/plans');
      return res.ok;
    } catch {
      return false;
    }
  },
};

window.Auth = Auth;
