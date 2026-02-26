const NotificationsUI = {
  notifications: [],
  unreadCount: 0,
  pollInterval: null,

  init() {
    this.setupEventListeners();
    this.startPolling();
  },

  setupEventListeners() {
    const bell = document.getElementById('notification-bell');
    const panel = document.getElementById('notification-panel');

    if (bell) {
      bell.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) this.load();
      });
    }

    document.addEventListener('click', (e) => {
      if (panel && !panel.contains(e.target) && e.target !== bell) {
        panel.classList.add('hidden');
      }
    });

    const markAllBtn = document.getElementById('mark-all-read');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', () => this.markAllRead());
    }

    const clearBtn = document.getElementById('clear-notifications');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearAll());
    }
  },

  startPolling() {
    this.pollInterval = setInterval(() => this.loadCount(), 15000);
    this.loadCount();
  },

  async loadCount() {
    try {
      const data = await API.request('GET', '/notifications');
      this.unreadCount = data.unreadCount || 0;
      this.updateBadge();
    } catch (e) {}
  },

  async load() {
    try {
      const data = await API.request('GET', '/notifications');
      this.notifications = data.notifications || [];
      this.unreadCount = data.unreadCount || 0;
      this.updateBadge();
      this.render();
    } catch (e) {
      console.error('Erro ao carregar notificações:', e);
    }
  },

  updateBadge() {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    if (this.unreadCount > 0) {
      badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  render() {
    const list = document.getElementById('notification-list');
    if (!list) return;

    if (this.notifications.length === 0) {
      list.innerHTML = '<div class="notification-empty">Nenhuma notificação</div>';
      return;
    }

    list.innerHTML = this.notifications.map(n => {
      const iconClass = n.type === 'success' ? 'success' : n.type === 'error' ? 'error' : 'info';
      const icon = n.type === 'success' ? '✓' : n.type === 'error' ? '✕' : 'ℹ';
      const time = this.timeAgo(n.createdAt);
      const unread = n.read ? '' : ' unread';
      return `<div class="notification-item${unread}" data-id="${n.id}">
        <div class="notification-item-icon ${iconClass}">${icon}</div>
        <div class="notification-item-content">
          <div class="notification-item-title">${Utils.escapeHtml(n.title)}</div>
          <div class="notification-item-message">${Utils.escapeHtml(n.message)}</div>
          <div class="notification-item-time">${time}</div>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.notification-item').forEach(item => {
      item.addEventListener('click', () => this.markAsRead(item.dataset.id));
    });
  },

  async markAsRead(id) {
    try {
      await API.request('POST', `/notifications/${id}/read`);
      const n = this.notifications.find(n => n.id === id);
      if (n) n.read = true;
      this.unreadCount = Math.max(0, this.unreadCount - 1);
      this.updateBadge();
      this.render();
    } catch (e) {}
  },

  async markAllRead() {
    try {
      await API.request('POST', '/notifications/read-all');
      this.notifications.forEach(n => n.read = true);
      this.unreadCount = 0;
      this.updateBadge();
      this.render();
    } catch (e) {}
  },

  async clearAll() {
    try {
      await API.request('DELETE', '/notifications');
      this.notifications = [];
      this.unreadCount = 0;
      this.updateBadge();
      this.render();
    } catch (e) {}
  },

  timeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'agora';
    if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
    return `${Math.floor(diff / 86400)}d atrás`;
  },

  showBrowserNotification(title, body) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  }
};

window.NotificationsUI = NotificationsUI;
