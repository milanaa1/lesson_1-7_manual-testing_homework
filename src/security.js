import { PREFIX } from './api.js';

export const CANARY_KEY = `${PREFIX}canary`;
const LOG_KEY = `${PREFIX}incidents`;
const BLOCK_KEY = `${PREFIX}blockedUntil`;
const REASON_KEY = `${PREFIX}blockReason`;

const LOG_LIMIT = 30;
const BLOCK_MS = 30_000;
const REFRESH_WINDOW_MS = 5_000;
const REFRESH_LIMIT = 5; // шестая попытка за окно = инцидент
const ALLOWED_TOPICS = ['html', 'javascript', 'api'];

let log = [];
let blockedUntil = 0;
let blockReason = '';
let timerId = null;
let refreshTimes = [];

// Безопасная работа с localStorage: недоступное хранилище не ломает приложение
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch { /* только память */ } }
function remove(key) { try { localStorage.removeItem(key); } catch { /* только память */ } }

function loadLog() {
  try {
    const value = JSON.parse(read(LOG_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(e => e && typeof e.time === 'number' && typeof e.type === 'string' && typeof e.reason === 'string')
      .slice(-LOG_LIMIT);
  } catch {
    return [];
  }
}

function renderLog() {
  const list = document.querySelector('#incident-list');
  const items = log.slice().reverse().map(entry => {
    const li = document.createElement('li');
    li.textContent = `${new Date(entry.time).toLocaleTimeString('ru-RU')} · ${entry.type}: ${entry.reason}`;
    return li;
  });
  list.replaceChildren(...items);
  document.querySelector('#incidents-empty').hidden = log.length > 0;
  document.querySelector('#incident-count').textContent = String(log.length);
}

function renderRestriction() {
  const status = document.querySelector('#security-status');
  const detail = document.querySelector('#restriction-detail');
  const left = Math.ceil((blockedUntil - Date.now()) / 1000);
  if (left > 0) {
    status.textContent = `Ограничение: осталось ${left} с`;
    detail.textContent = `Причина: ${blockReason}. Отправка и обновление списка недоступны, чтение доступно.`;
    detail.hidden = false;
  } else {
    status.textContent = 'Ограничений нет';
    detail.hidden = true;
  }
}

function clearRestriction() {
  clearInterval(timerId);
  timerId = null;
  blockedUntil = 0;
  blockReason = '';
  remove(BLOCK_KEY);
  remove(REASON_KEY);
  renderRestriction();
}

function tick() {
  if (isRestricted()) renderRestriction();
  else clearRestriction();
}

function startTimer() {
  clearInterval(timerId);
  renderRestriction();
  timerId = setInterval(tick, 1000);
}

function startRestriction(reason) {
  if (isRestricted()) return; // новые инциденты во время паузы её не продлевают
  blockedUntil = Date.now() + BLOCK_MS;
  blockReason = reason;
  write(BLOCK_KEY, String(blockedUntil));
  write(REASON_KEY, reason);
  startTimer();
}

export function reportIncident(type, reason) {
  log.push({ time: Date.now(), type, reason });
  log = log.slice(-LOG_LIMIT);
  write(LOG_KEY, JSON.stringify(log));
  renderLog();
  startRestriction(reason);
}

// T5: маркер подменён на admin. Отсутствие или битый JSON не считаются атакой.
function checkCanary() {
  let data;
  try { data = JSON.parse(read(CANARY_KEY)); } catch { return; }
  if (data && data.role === 'admin') {
    reportIncident('T5', 'Маркер canary изменён на role: admin');
    write(CANARY_KEY, JSON.stringify({ role: 'visitor' })); // обработан однократно
  }
}

// T6: параметр staff=1. После обработки убираем его из адреса.
function checkUrl() {
  const url = new URL(location.href);
  if (url.searchParams.get('staff') === '1') {
    reportIncident('T6', 'В адресе параметр staff=1');
    url.searchParams.delete('staff');
    history.replaceState(null, '', url);
  }
}

// События: startup, refresh, submit, decoy.
export function checkActivity(action, details = {}) {
  switch (action) {
    case 'refresh': { // T1: скользящее окно 5 секунд
      const now = Date.now();
      refreshTimes = refreshTimes.filter(time => now - time < REFRESH_WINDOW_MS);
      refreshTimes.push(now);
      if (refreshTimes.length > REFRESH_LIMIT) {
        refreshTimes = [];
        reportIncident('T1', 'Шестое обновление списка за 5 секунд');
      }
      break;
    }
    case 'submit': // T2 и T4
      if (details.supportCode) reportIncident('T2', 'Заполнено скрытое поле supportCode');
      if (details.topic && !ALLOWED_TOPICS.includes(details.topic)) reportIncident('T4', 'Получено направление вне списка');
      break;
    case 'decoy': // T3
      reportIncident('T3', 'Вызвана скрытая кнопка staff-export');
      break;
    case 'startup':
      checkCanary();
      checkUrl();
      break;
  }
}

export function isRestricted() {
  return Date.now() < blockedUntil;
}

export function initializeSecurity() {
  log = loadLog();
  renderLog();

  // Продолжаем отсчёт после перезагрузки (не дольше 30 с от текущего момента)
  const saved = Number(read(BLOCK_KEY));
  if (Number.isFinite(saved) && saved > Date.now()) {
    blockedUntil = Math.min(saved, Date.now() + BLOCK_MS);
    blockReason = read(REASON_KEY) || 'Зарегистрирован инцидент';
    startTimer();
  } else {
    remove(BLOCK_KEY);
    remove(REASON_KEY);
    renderRestriction();
  }

  try {
    if (localStorage.getItem(CANARY_KEY) === null) {
      localStorage.setItem(CANARY_KEY, JSON.stringify({ role: 'visitor' }));
    }
  } catch { /* хранилище недоступно */ }
  checkActivity('startup');
}

export function resetSecurity() {
  clearInterval(timerId);
  timerId = null;
  blockedUntil = 0;
  blockReason = '';
  refreshTimes = [];
  log = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX) && key !== `${PREFIX}applications`) localStorage.removeItem(key);
    }
    localStorage.setItem(CANARY_KEY, JSON.stringify({ role: 'visitor' }));
  } catch { /* Учебный сброс остаётся доступным без storage. */ }
  renderLog();
  renderRestriction();
}
