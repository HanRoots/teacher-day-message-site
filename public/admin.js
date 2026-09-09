const loginLayer = document.querySelector('#loginLayer');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');
const passwordInput = document.querySelector('#password');
const logoutButton = document.querySelector('#logoutButton');
const messageList = document.querySelector('#messageList');
const emptyState = document.querySelector('#emptyState');
const searchInput = document.querySelector('#searchInput');
const filterButtons = [...document.querySelectorAll('[data-filter]')];
const API_BASE = String(window.APP_CONFIG?.apiBase || '').replace(/\/$/, '');
const apiUrl = path => `${API_BASE}${path}`;
let adminToken = sessionStorage.getItem('teacherAdminToken') || '';

function adminFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  return fetch(apiUrl(path), { ...options, headers, credentials: 'include' });
}

let messages = [];
let filter = 'all';

document.querySelector('#todayLabel').textContent = new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', weekday: 'long'
}).format(new Date());

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value || '';
  return div.innerHTML;
}

function formatDate(value) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function updateStats() {
  document.querySelector('#totalCount').textContent = messages.length;
  document.querySelector('#unreadCount').textContent = messages.filter(item => !item.listened).length;
  document.querySelector('#audioCount').textContent = messages.filter(item => item.audioUrl).length;
}

function visibleMessages() {
  const query = searchInput.value.trim().toLowerCase();
  return messages.filter(item => {
    const matchesFilter = filter === 'all' || (filter === 'unread' && !item.listened) || (filter === 'audio' && item.audioUrl);
    const haystack = `${item.teacher} ${item.sender} ${item.message}`.toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function renderMessages() {
  const visible = visibleMessages();
  emptyState.hidden = visible.length > 0;
  messageList.innerHTML = visible.map(item => `
    <article class="message-item ${item.listened ? '' : 'unread'}" data-id="${item.id}">
      <div class="avatar">${escapeHtml((item.sender || '暖').slice(0, 1))}</div>
      <div class="message-meta">
        <strong>写给${escapeHtml(item.teacher)}</strong>
        <span>${escapeHtml(item.sender || '匿名留言')} · ${formatDate(item.createdAt)}</span>
      </div>
      <div class="message-copy"><p>${escapeHtml(item.message)}</p></div>
      <div class="audio-box">
        ${item.playbackUrl ? `<audio controls preload="none" src="${escapeHtml(new URL(item.playbackUrl, API_BASE || location.origin).href)}" aria-label="${escapeHtml(item.sender || '匿名')}的语音留言"></audio>` : '<span class="no-audio">文字留言</span>'}
      </div>
      <button class="status-button ${item.listened ? 'listened' : ''}" type="button" data-status>
        ${item.listened ? '已听' : '标为已听'}
      </button>
    </article>
  `).join('');

  document.querySelectorAll('.message-item audio').forEach(audio => {
    audio.addEventListener('play', () => markListened(audio.closest('.message-item').dataset.id, true));
  });
  document.querySelectorAll('[data-status]').forEach(button => {
    button.addEventListener('click', () => {
      const item = messages.find(entry => entry.id === button.closest('.message-item').dataset.id);
      markListened(item.id, !item.listened);
    });
  });
}

async function markListened(id, listened) {
  const item = messages.find(entry => entry.id === id);
  if (!item || item.listened === listened) return;
  item.listened = listened;
  updateStats();
  renderMessages();
  const response = await adminFetch(`/api/admin/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listened })
  });
  if (response.status === 401) loginLayer.hidden = false;
}

async function loadMessages() {
  const response = await adminFetch('/api/admin/messages');
  if (response.status === 401) {
    loginLayer.hidden = false;
    return;
  }
  const data = await response.json();
  messages = data.messages || [];
  loginLayer.hidden = true;
  updateStats();
  renderMessages();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginError.textContent = '';
  const submit = loginForm.querySelector('button');
  submit.disabled = true;
  const response = await fetch(apiUrl('/api/admin/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: passwordInput.value })
  });
  const data = await response.json();
  submit.disabled = false;
  if (!response.ok) {
    loginError.textContent = data.error || '登录失败';
    passwordInput.select();
    return;
  }
  adminToken = data.token || '';
  sessionStorage.setItem('teacherAdminToken', adminToken);
  passwordInput.value = '';
  await loadMessages();
});

logoutButton.addEventListener('click', async () => {
  await adminFetch('/api/admin/logout', { method: 'POST' });
  adminToken = '';
  sessionStorage.removeItem('teacherAdminToken');
  loginLayer.hidden = false;
  passwordInput.focus();
});

filterButtons.forEach(button => {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    filterButtons.forEach(item => item.classList.toggle('active', item === button));
    renderMessages();
  });
});
searchInput.addEventListener('input', renderMessages);
loadMessages();
