/* 习惯打卡 · 多用户在线版前端 */
const $ = (sel) => document.querySelector(sel);
const authView = $('#authView');
const appView = $('#appView');
const authForm = $('#authForm');
const authUsername = $('#authUsername');
const authPassword = $('#authPassword');
const authError = $('#authError');
const authSubmit = $('#authSubmit');
const tabLogin = $('#tabLogin');
const tabRegister = $('#tabRegister');
const logoutBtn = $('#logoutBtn');
const listEl = $('#habitList');
const emptyHint = $('#emptyHint');
const addForm = $('#addForm');
const addInput = $('#addInput');
const toast = $('#toast');
const doneCount = $('#doneCount');
const totalCount = $('#totalCount');
const progressFill = $('#progressFill');
const streakNum = $('#streakNum');
const weekHistory = $('#weekHistory');
const dateLine = $('#dateLine');
const themeBtn = $('#themeToggle');
const aiBtn = $('#aiBtn');
const aiSummaryBox = $('#aiSummaryBox');
const aiSummary = $('#aiSummary');
const aiClose = $('#aiClose');
const confirmModal = $('#confirmModal');
const confirmText = $('#confirmText');
const confirmOk = $('#confirmOk');
const confirmCancel = $('#confirmCancel');

const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
const TOKEN_KEY = 'habit-token';

const PEN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

let habits = [];
let stats = null;
let authMode = 'login'; // 'login' | 'register'

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  const t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch(path, Object.assign({}, options, { headers }));
  if (res.status === 401 && !path.startsWith('/api/login')) {
    setToken('');
    showAuth();
    throw new Error('请先登录');
  }
  if (!res.ok) {
    let msg = '请求失败';
    try { msg = (await res.json()).error || msg; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function todayStr() {
  const n = new Date();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${n.getFullYear()}-${m}-${d}`;
}

function showAuth() {
  appView.classList.add('hidden');
  authView.classList.remove('hidden');
  authPassword.value = '';
}
function showApp() {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  loadAll().catch((err) => showToast(err.message));
}

function setAuthMode(mode) {
  authMode = mode;
  tabLogin.classList.toggle('active', mode === 'login');
  tabRegister.classList.toggle('active', mode === 'register');
  authSubmit.textContent = mode === 'login' ? '登 录' : '注 册';
  authError.textContent = '';
}function renderHabits() {
  listEl.innerHTML = '';
  emptyHint.classList.toggle('hidden', habits.length > 0);
  for (const h of habits) {
    const li = document.createElement('li');
    li.className = 'habit' + (h.doneToday ? ' done' : '');
    li.dataset.id = h.id;
    li.innerHTML = '<span class="check" aria-hidden="true"></span>' +
      '<span class="name">' + escapeHtml(h.name) + '</span>' +
      '<span class="actions">' +
      '<button class="icon-btn edit" title="改名" aria-label="改名习惯">' + PEN_SVG + '</button>' +
      '<button class="icon-btn del" title="删除" aria-label="删除习惯">' + TRASH_SVG + '</button>' +
      '</span>';
    listEl.appendChild(li);
  }
}

function renderStats() {
  if (!stats) return;
  const today = stats.today;
  doneCount.textContent = today.done;
  totalCount.textContent = today.total;
  progressFill.style.width = today.total ? Math.round((today.done / today.total) * 100) + '%' : '0%';
  streakNum.textContent = stats.streak;
  const t = todayStr();
  weekHistory.innerHTML = stats.history.map((d) => {
    const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
    const dt = new Date(d.date + 'T00:00:00');
    const isToday = d.date === t;
    return '<div class="day' + (isToday ? ' today' : '') + '">' +
      '<span class="day-label">' + (isToday ? '今' : weekNames[dt.getDay()]) + '</span>' +
      '<div class="day-bar"><div class="day-fill" style="height:' + pct + '%"></div></div>' +
      '<span class="day-num">' + d.done + '/' + d.total + '</span>' +
      '</div>';
  }).join('');
}

function updateDate() {
  const now = new Date();
  dateLine.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 · 星期' + weekNames[now.getDay()];
}

async function loadAll() {
  const [h, s, info] = await Promise.all([
    api('/api/habits'),
    api('/api/stats'),
    api('/api/info').catch(() => null),
  ]);
  habits = h;
  stats = s;
  renderHabits();
  renderStats();
  updateDate();
  if (info && info.lanUrl) {
    const u = info.publicUrl && !info.publicUrl.includes('localhost') ? info.publicUrl : info.lanUrl;
    $('#lanUrl').textContent = u;
  }
}async function toggleHabit(id) {
  try {
    const res = await api('/api/habits/' + id + '/toggle', { method: 'POST' });
    const habit = habits.find((x) => x.id === id);
    if (habit) habit.doneToday = res.doneToday;
    stats = res.stats;
    renderHabits();
    renderStats();
  } catch (err) {
    showToast(err.message);
  }
}

function startRename(li, id) {
  const habit = habits.find((x) => x.id === id);
  if (!habit) return;
  const nameEl = li.querySelector('.name');
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = habit.name;
  input.maxLength = 30;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    if (save) {
      const name = input.value.trim();
      if (name && name !== habit.name) {
        try {
          const updated = await api('/api/habits/' + id, { method: 'PUT', body: JSON.stringify({ name }) });
          habit.name = updated.name;
        } catch (err) {
          showToast(err.message);
        }
      }
    }
    renderHabits();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function confirmDelete(id) {
  const habit = habits.find((x) => x.id === id);
  if (!habit) return;
  if (!(await askConfirm('确定删除「' + habit.name + '」吗？\n它的打卡历史也会一并清除。'))) return;
  try {
    await api('/api/habits/' + id, { method: 'DELETE' });
    habits = habits.filter((x) => x.id !== id);
    stats = await api('/api/stats');
    renderHabits();
    renderStats();
  } catch (err) {
    showToast(err.message);
  }
}

listEl.addEventListener('click', (e) => {
  const li = e.target.closest('.habit');
  if (!li) return;
  const id = Number(li.dataset.id);
  if (e.target.closest('.edit')) { startRename(li, id); return; }
  if (e.target.closest('.del')) { confirmDelete(id); return; }
  toggleHabit(id);
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = addInput.value.trim();
  if (!name) { showToast('请输入习惯名称'); addInput.focus(); return; }
  try {
    await api('/api/habits', { method: 'POST', body: JSON.stringify({ name }) });
    addInput.value = '';
    addInput.focus();
    await loadAll();
  } catch (err) {
    showToast(err.message);
  }
});/* ---- 确认弹窗（替代 window.confirm，兼容手机浏览器） ---- */
let confirmResolve = null;
function askConfirm(message) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    confirmText.textContent = message;
    confirmModal.classList.remove('hidden');
  });
}
confirmOk.addEventListener('click', () => {
  confirmModal.classList.add('hidden');
  if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(true); }
});
confirmCancel.addEventListener('click', () => {
  confirmModal.classList.add('hidden');
  if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(false); }
});

/* ---- 登录 / 注册 ---- */
tabLogin.addEventListener('click', () => setAuthMode('login'));
tabRegister.addEventListener('click', () => setAuthMode('register'));

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = authUsername.value.trim();
  const password = authPassword.value;
  authError.textContent = '';
  if (!username || !password) { authError.textContent = '请输入用户名和密码'; return; }
  authSubmit.disabled = true;
  authSubmit.textContent = authMode === 'login' ? '登录中…' : '注册中…';
  try {
    const res = await fetch('/api/' + (authMode === 'login' ? 'login' : 'register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      authError.textContent = data.error || (authMode === 'login' ? '登录失败' : '注册失败');
      return;
    }
    setToken(data.token);
    authUsername.value = '';
    showApp();
  } catch (err) {
    authError.textContent = '网络错误，请确认服务已启动';
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === 'login' ? '登 录' : '注 册';
  }
});

logoutBtn.addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  setToken('');
  showAuth();
});

/* ---- AI 周总结 ---- */
aiBtn.addEventListener('click', async () => {
  aiBtn.disabled = true;
  const old = aiBtn.textContent;
  aiBtn.textContent = '生成中…';
  try {
    const res = await api('/api/ai/weekly', { method: 'POST' });
    aiSummary.textContent = res.summary;
    aiSummaryBox.classList.remove('hidden');
  } catch (err) {
    showToast(err.message);
  } finally {
    aiBtn.disabled = false;
    aiBtn.textContent = old;
  }
});
aiClose.addEventListener('click', () => aiSummaryBox.classList.add('hidden'));/* ---- 明暗主题 ---- */
const THEME_KEY = 'habit-theme';
let theme = localStorage.getItem(THEME_KEY);
if (theme !== 'light' && theme !== 'dark') {
  theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(t) {
  theme = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
}
applyTheme(theme);
themeBtn.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));


/* ---- 公开首页：开始使用按钮 -> 滚动到登录框 ---- */
const landingCta = $('#landingCta');
landingCta.addEventListener('click', () => {
  const card = document.querySelector('.auth-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => authUsername.focus(), 400);
});

/* ---- 回到页面时自动刷新（覆盖跨天情况） ---- */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !authView.classList.contains('hidden')) {
    loadAll().catch(() => {});
  }
});

/* ---- PWA service worker ---- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

/* ---- 启动：判断登录态 ---- */
(async () => {
  if (getToken()) {
    try {
      await api('/api/me');
      showApp();
      return;
    } catch (e) { /* token 无效，回登录页 */ }
  }
  showAuth();
})();