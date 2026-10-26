/**
 * OpenVPN Admin Panel - Main Client Application
 * Features:
 * - Real-time client search & status filtering
 * - Two-language support (FA / EN) with dynamic switching
 * - Dark & Light theme switching
 * - Beautified UX/UI table and modals with SVG icons
 */
'use strict';

let csrfToken = null;
let cachedClients = [];
let activeFilter = 'all';
let searchQuery = '';
let cachedAuditEntries = [];

const $ = (id) => document.getElementById(id);

/* ---------- Date & Number Formatting ---------- */
const fmtDate = (iso) => {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  const locale = currentLang === 'fa' ? 'fa-IR' : 'en-US';
  return (
    d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  );
};

const fmtDateShort = (iso) => {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  const locale = currentLang === 'fa' ? 'fa-IR' : 'en-US';
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
};

function formatTimeAgo(iso) {
  if (!iso) return '–';
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 0 || diffSec < 15) return t('timeJustNow');
  if (diffSec < 60) return t('timeSecondsAgo', { s: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('timeMinutesAgo', { m: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t('timeHoursAgo', { h: diffHour });
  return fmtDateShort(iso);
}

function formatBytes(b) {
  const bytes = Number(b) || 0;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Toast Notifications ---------- */
function toast(msg, kind) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + (kind || '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

/* ---------- API Helper ---------- */
async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (opts.method && opts.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('unauthenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || ('HTTP ' + res.status));
  return data;
}

/* ---------- Bootstrap ---------- */
async function init() {
  // Apply initial translations and theme
  applyI18nToDom();
  applyTheme();

  try {
    const me = await api('/api/auth/me');
    csrfToken = me.csrfToken;
    $('whoami').textContent = me.user.username;
  } catch {
    window.location.href = '/login.html';
    return;
  }

  wireEvents();
  await Promise.all([loadStatus(), loadClients(), loadAudit()]);
}

function wireEvents() {
  // Theme & Language toggles
  $('theme-toggle').addEventListener('click', () => {
    toggleTheme();
  });

  $('lang-toggle').addEventListener('click', () => {
    toggleLanguage();
    applyTheme();
  });

  // Re-render dynamic elements on language change
  window.addEventListener('langchange', () => {
    renderClients();
    renderAudit();
    loadStatus();
  });

  // Logout
  $('logout-btn').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    window.location.href = '/login.html';
  });

  // Search input
  $('client-search').addEventListener('input', (e) => {
    searchQuery = (e.target.value || '').trim().toLowerCase();
    renderClients();
  });

  // Status Filter Tabs
  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.getAttribute('data-filter') || 'all';
      renderClients();
    });
  });

  // Toolbar & Modals
  $('new-client-btn').addEventListener('click', openCreateModal);
  $('sync-btn').addEventListener('click', doSync);
  $('create-form').addEventListener('submit', doCreate);
  $('ip-form').addEventListener('submit', doSaveIp);
  $('ip-clear-btn').addEventListener('click', doClearIp);
  $('renew-form').addEventListener('submit', doRenew);
  $('renew-days-select').addEventListener('change', (e) => {
    $('renew-custom-group').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });

  $('details-view-history-btn').addEventListener('click', () => {
    $('details-modal').hidden = true;
    showHistory($('details-modal').dataset.clientName);
  });

  // Close modals
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => {
      $('create-modal').hidden = true;
      $('details-modal').hidden = true;
      $('ip-modal').hidden = true;
      $('renew-modal').hidden = true;
      $('history-modal').hidden = true;
    }),
  );

  document.querySelectorAll('.modal-backdrop').forEach((bd) =>
    bd.addEventListener('click', (e) => {
      if (e.target === bd) bd.hidden = true;
    }),
  );
}

/* ---------- Status ---------- */
async function loadStatus() {
  try {
    const s = await api('/api/status');
    const badge = $('server-badge');
    if (s.server.running) {
      badge.innerHTML =
        '<span class="pulse-dot"></span> ' +
        escapeHtml(t('serverOnline')) +
        ' · ' +
        escapeHtml(s.server.host + ':' + s.server.port + '/' + s.server.protocol);
      badge.className = 'badge ok';
    } else {
      badge.innerHTML = '<span class="pulse-dot" style="background:#ef4444;box-shadow:none;"></span> ' + escapeHtml(t('serverOffline'));
      badge.className = 'badge bad';
    }
    $('stat-online').textContent = s.onlineCount;
  } catch {
    $('server-badge').innerHTML = '<span class="pulse-dot" style="background:#ef4444;box-shadow:none;"></span> ' + escapeHtml(t('serverUnknown'));
    $('server-badge').className = 'badge bad';
  }
}

/* ---------- Clients Data Loading ---------- */
async function loadClients() {
  try {
    const data = await api('/api/clients');
    cachedClients = data.clients || [];

    // Update Stats
    $('stat-total').textContent = cachedClients.length;
    $('stat-active').textContent = cachedClients.filter((c) => c.status === 'active' && !c.paused).length;
    $('stat-revoked').textContent = cachedClients.filter((c) => c.status === 'revoked').length;
    $('stat-online').textContent = cachedClients.filter((c) => c.online).length;

    // Server-wide All Traffic
    const totalAll = data.totalTraffic?.totalBytes || cachedClients.reduce((acc, c) => acc + (c.totalBytes || 0), 0);
    const sentAll = data.totalTraffic?.bytesSent || cachedClients.reduce((acc, c) => acc + (c.bytesSent || 0), 0);
    const recvAll = data.totalTraffic?.bytesReceived || cachedClients.reduce((acc, c) => acc + (c.bytesReceived || 0), 0);
    const statTraffic = $('stat-traffic');
    if (statTraffic) statTraffic.textContent = formatBytes(totalAll);
    const statSplit = $('stat-traffic-split');
    if (statSplit) statSplit.textContent = `↓ ${formatBytes(sentAll)} · ↑ ${formatBytes(recvAll)}`;

    renderClients();
  } catch (err) {
    $('list-error').textContent = err.message;
    $('list-error').hidden = false;
    $('clients-body').innerHTML = '';
  }
}

/* ---------- Filter and Render Clients Table ---------- */
function renderClients() {
  const body = $('clients-body');
  if (!body) return;

  // Filter clients
  let filtered = cachedClients.slice();

  if (activeFilter === 'online') {
    filtered = filtered.filter((c) => c.online);
  } else if (activeFilter === 'active') {
    filtered = filtered.filter((c) => c.status === 'active' && !c.paused);
  } else if (activeFilter === 'paused') {
    filtered = filtered.filter((c) => c.paused || c.status === 'paused');
  } else if (activeFilter === 'revoked') {
    filtered = filtered.filter((c) => c.status === 'revoked');
  }

  if (searchQuery) {
    filtered = filtered.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const staticIp = (c.staticIp || '').toLowerCase();
      const connectedIp = (c.connectedIp || '').toLowerCase();
      const lastReal = (c.lastRealIp || c.lastRealAddress || '').toLowerCase();
      const notes = (c.notes || '').toLowerCase();
      return (
        name.includes(searchQuery) ||
        staticIp.includes(searchQuery) ||
        connectedIp.includes(searchQuery) ||
        lastReal.includes(searchQuery) ||
        notes.includes(searchQuery)
      );
    });
  }

  // Update badge count
  const badge = $('users-count-badge');
  if (badge) badge.textContent = filtered.length;

  if (!filtered.length) {
    const emptyMsg = searchQuery ? t('emptySearch') : t('emptyTable');
    body.innerHTML = `
      <tr>
        <td colspan="10" class="muted center">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            <div class="empty-state-text">${escapeHtml(emptyMsg)}</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = '';
  for (const c of filtered) {
    const tr = document.createElement('tr');
    addCell(tr, 'colName', nameCell(c), 'cell-user');
    addCell(tr, 'colStatus', statusPill(c));
    addCell(tr, 'colAssignedIp', assignedIpCell(c));
    addCell(tr, 'colConnectedIp', connectedIpCell(c));
    addCell(tr, 'colLastRealIp', lastRealIpCell(c));
    addCell(tr, 'colTraffic', trafficCell(c));
    addCell(tr, 'colLastRequest', lastRequestCell(c));
    addCell(tr, 'colCreated', fmtDateShort(c.createdAt));
    addCell(tr, 'colExpires', c.status === 'revoked' ? '–' : fmtDateShort(c.expiresAt));
    tr.appendChild(actionCell(c));
    body.appendChild(tr);
  }
}

function addCell(tr, labelKey, content, className = '') {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.setAttribute('data-label', t(labelKey));
  if (content instanceof Node) td.appendChild(content);
  else td.innerHTML = content;
  tr.appendChild(td);
  return td;
}

function nameCell(c) {
  const div = document.createElement('div');
  div.className = 'user-cell';

  const dot = document.createElement('span');
  dot.className = c.online ? 'pulse-dot' : 'dot-offline';
  dot.title = c.online ? t('statusOnline') : t('statusOffline');
  div.appendChild(dot);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'user-name';
  nameSpan.textContent = c.name;
  div.appendChild(nameSpan);

  return div;
}

function assignedIpCell(c) {
  if (c.staticIp) {
    return `<span class="chip chip-static" title="Static IP">${escapeHtml(c.staticIp)}</span>`;
  }
  return `<span class="chip chip-dynamic">${escapeHtml(t('statusDynamic'))}</span>`;
}

function connectedIpCell(c) {
  if (c.online && (c.connectedIp || c.connection?.virtualAddress)) {
    const ip = c.connectedIp || c.connection.virtualAddress;
    const real = c.connection?.realAddress ? escapeHtml(c.connection.realAddress) : '';
    return `<span class="chip chip-online" title="${real ? 'Real IP: ' + real : ''}"><span class="pulse-dot"></span> ${escapeHtml(ip)}</span>`;
  }
  return '<span class="dim">–</span>';
}

function lastRealIpCell(c) {
  if (c.online && (c.connection?.realAddress || c.lastRealAddress)) {
    const addr = c.connection?.realAddress || c.lastRealAddress;
    const ip = c.lastRealIp || addr.replace(/:[0-9]+$/, '');
    return `<span class="chip chip-online" title="${escapeHtml(addr)}"><span class="pulse-dot"></span> ${escapeHtml(ip)}</span>`;
  }
  if (c.lastRealIp) {
    return `<span class="chip chip-real" title="${escapeHtml(c.lastRealAddress || '')}">${escapeHtml(c.lastRealIp)}</span>`;
  }
  return '<span class="dim">–</span>';
}

function trafficCell(c) {
  const total = c.totalBytes || 0;
  if (!total) return '<span class="dim">0 B</span>';
  const sent = c.bytesSent || 0;
  const recv = c.bytesReceived || 0;
  return `
    <div class="traffic-cell">
      <span class="traffic-total">${formatBytes(total)}</span>
      <div class="traffic-split">
        <span class="down" title="${escapeHtml(t('trafficDownload'))}">↓ ${formatBytes(sent)}</span>
        <span class="up" title="${escapeHtml(t('trafficUpload'))}">↑ ${formatBytes(recv)}</span>
      </div>
    </div>
  `;
}

function lastRequestCell(c) {
  const reqTime = c.lastRequest || c.lastSeen;
  if (c.online && reqTime) {
    return `<span class="chip chip-online" title="${escapeHtml(fmtDate(reqTime))}"><span class="pulse-dot"></span> ${escapeHtml(formatTimeAgo(reqTime))}</span>`;
  }
  if (reqTime) {
    return `<span class="chip chip-real" title="${escapeHtml(fmtDate(reqTime))}">${escapeHtml(formatTimeAgo(reqTime))}</span>`;
  }
  return '<span class="dim">–</span>';
}

function lastSeenCell(c) {
  if (c.online) {
    return `<span class="status-pill status-active"><span class="dot">●</span> ${escapeHtml(t('statusOnline'))}</span>`;
  }
  return fmtDateShort(c.lastSeen);
}

function statusPill(c) {
  if (c.status === 'paused' || c.paused) {
    return `<span class="status-pill status-paused"><span class="dot">●</span> ${escapeHtml(t('statusPaused'))}</span>`;
  }
  if (c.status === 'active' && c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) {
    return `<span class="status-pill status-expired"><span class="dot">●</span> ${escapeHtml(t('statusExpired'))}</span>`;
  }
  let label = t('statusActive');
  if (c.status === 'revoked') label = t('statusRevoked');
  else if (c.status === 'archived') label = t('statusArchived');
  return `<span class="status-pill status-${c.status}"><span class="dot">●</span> ${escapeHtml(label)}</span>`;
}

/* ---------- Dropdown Action Menu System ---------- */
let activeDropdownMenu = null;

function closeActiveDropdown() {
  if (activeDropdownMenu) {
    activeDropdownMenu.remove();
    activeDropdownMenu = null;
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown-menu') && !e.target.closest('.btn-more-actions')) {
    closeActiveDropdown();
  }
});
window.addEventListener('scroll', closeActiveDropdown, true);
window.addEventListener('resize', closeActiveDropdown);

function createDropdownItem(iconSvg, label, onClick, isDanger = false, isWarn = false, isSuccess = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dropdown-item' + (isDanger ? ' danger' : '') + (isWarn ? ' warn' : '') + (isSuccess ? ' success' : '');
  btn.innerHTML = `${iconSvg} <span>${escapeHtml(label)}</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeActiveDropdown();
    onClick();
  });
  return btn;
}

function openDropdownMenu(c, moreBtn) {
  if (activeDropdownMenu && activeDropdownMenu._triggerBtn === moreBtn) {
    closeActiveDropdown();
    return;
  }
  closeActiveDropdown();

  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  menu._triggerBtn = moreBtn;

  // 1. Details
  menu.appendChild(
    createDropdownItem(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      t('actionDetails'),
      () => showDetails(c.name),
    ),
  );

  const isLiveActive = c.status === 'active' || c.status === 'paused' || c.paused;
  if (isLiveActive) {
    // 2. Pause / Resume
    if (c.paused || c.status === 'paused') {
      menu.appendChild(
        createDropdownItem(
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>',
          t('actionResume'),
          () => doResume(c.name),
          false,
          false,
          true,
        ),
      );
    } else {
      menu.appendChild(
        createDropdownItem(
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>',
          t('actionPause'),
          () => doPause(c.name),
          false,
          true,
          false,
        ),
      );
    }

    // 3. Renew
    menu.appendChild(
      createDropdownItem(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        t('actionRenew'),
        () => openRenewModal(c),
      ),
    );

    // 4. Set IP
    menu.appendChild(
      createDropdownItem(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
        t('actionSetIp'),
        () => openIpModal(c),
      ),
    );

    // 5. Revoke
    menu.appendChild(
      createDropdownItem(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
        t('actionRevoke'),
        () => doRevoke(c.name),
        true,
      ),
    );
  } else if (c.status === 'revoked') {
    // Archive
    menu.appendChild(
      createDropdownItem(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
        t('actionArchive'),
        () => doArchive(c.name),
      ),
    );
  }

  // Divider
  const div = document.createElement('div');
  div.className = 'dropdown-divider';
  menu.appendChild(div);

  // Delete
  menu.appendChild(
    createDropdownItem(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      t('actionDelete'),
      () => doDelete(c.name),
      true,
    ),
  );

  document.body.appendChild(menu);

  // Position calculation relative to moreBtn
  const rect = moreBtn.getBoundingClientRect();
  const isRtl = document.documentElement.dir === 'rtl';
  menu.style.top = rect.bottom + 4 + 'px';
  if (isRtl) {
    menu.style.left = Math.max(8, rect.left) + 'px';
    menu.style.right = 'auto';
  } else {
    menu.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
    menu.style.left = 'auto';
  }

  activeDropdownMenu = menu;
}

/* ---------- Actions Cell (Compact 3 buttons) ---------- */
function actionCell(c) {
  const td = document.createElement('td');
  td.className = 'actions';
  td.setAttribute('data-label', t('colActions'));

  // 1. Quick Action: Download
  const dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'btn-action btn-action-primary';
  dl.title = t('actionDownloadTitle');
  dl.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    <span>${escapeHtml(t('actionDownload'))}</span>
  `;
  dl.disabled = c.status !== 'active' && c.status !== 'paused' && !c.paused;
  dl.addEventListener('click', () => downloadConfig(c.name));
  td.appendChild(dl);

  // 2. Quick Action: History
  const histBtn = document.createElement('button');
  histBtn.type = 'button';
  histBtn.className = 'btn-action';
  histBtn.title = t('actionHistoryTitle');
  histBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    <span>${escapeHtml(t('actionHistory'))}</span>
  `;
  histBtn.addEventListener('click', () => showHistory(c.name));
  td.appendChild(histBtn);

  // 3. More Actions Dropdown Trigger (•••)
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'btn-action btn-more-actions';
  moreBtn.title = t('actionMoreTitle');
  moreBtn.innerHTML = '•••';
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDropdownMenu(c, moreBtn);
  });
  td.appendChild(moreBtn);

  return td;
}

function downloadConfig(name) {
  const a = document.createElement('a');
  a.href = '/api/clients/' + encodeURIComponent(name) + '/config';
  a.download = name + '.ovpn';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------- Client Lifecycle Actions ---------- */
async function doRevoke(name) {
  if (!confirm(t('confirmRevoke', { name }))) return;
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/revoke', { method: 'POST', body: '{}' });
    toast(t('statusRevoked'), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function doArchive(name) {
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/archive', { method: 'POST', body: '{}' });
    toast(t('statusArchived'), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function doPause(name) {
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/pause', { method: 'POST', body: '{}' });
    toast(t('pauseSuccess', { name }), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function doResume(name) {
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/resume', { method: 'POST', body: '{}' });
    toast(t('resumeSuccess', { name }), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function doDelete(name) {
  if (!confirm(t('confirmDelete', { name }))) return;
  try {
    await api('/api/clients/' + encodeURIComponent(name), { method: 'DELETE' });
    toast(t('deleteSuccess', { name }), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

/* ---------- Details Modal ---------- */
async function showDetails(name) {
  try {
    const { client: c } = await api('/api/clients/' + encodeURIComponent(name));
    const statusLabel =
      c.status === 'paused' || c.paused
        ? t('statusPaused')
        : (c.status === 'active' && c.expiresAt && new Date(c.expiresAt).getTime() < Date.now() ? t('statusExpired') : (t('status' + c.status.charAt(0).toUpperCase() + c.status.slice(1)) || c.status));

    const rows = [
      [t('colName'), c.name],
      [t('colStatus'), statusLabel],
      [t('colAssignedIp'), c.staticIp ? c.staticIp : t('statusDynamic')],
      [
        t('colConnectedIp'),
        c.online && (c.connectedIp || c.connection?.virtualAddress)
          ? (c.connectedIp || c.connection.virtualAddress) + ' (' + t('statusOnline') + ')'
          : t('statusOffline'),
      ],
      [t('colLastRealIp'), c.lastRealAddress || '–'],
      [
        t('colTraffic'),
        formatBytes(c.totalBytes) + ' (' + t('trafficDownload') + ': ' + formatBytes(c.bytesSent) + ' / ' + t('trafficUpload') + ': ' + formatBytes(c.bytesReceived) + ')',
      ],
      [t('colLastRequest'), c.lastRequest ? fmtDate(c.lastRequest) + ' (' + formatTimeAgo(c.lastRequest) + ')' : '–'],
      [t('historyCardSessions'), c.connectionCount ? String(c.connectionCount) : '–'],
      ['Certificate Serial', c.certificateSerial || '–'],
      [t('colCreated'), fmtDate(c.createdAt)],
      [t('colExpires'), fmtDate(c.expiresAt)],
      [t('colLastSeen'), c.online ? t('statusOnline') : fmtDate(c.lastSeen)],
    ];
    if (c.connection) {
      rows.push(['Real IP (Current)', c.connection.realAddress]);
      rows.push(['Current Session', formatBytes(c.connection.bytesReceived) + ' in / ' + formatBytes(c.connection.bytesSent) + ' out']);
    }
    if (c.notes) rows.push(['Notes', c.notes]);

    $('details-body').innerHTML = rows
      .map(([k, v]) => '<dt>' + escapeHtml(k) + '</dt><dd class="mono">' + escapeHtml(String(v)) + '</dd>')
      .join('');
    $('details-modal').dataset.clientName = c.name;
    $('details-modal').hidden = false;
  } catch (err) {
    toast(err.message, 'bad');
  }
}

/* ---------- History Modal ---------- */
async function showHistory(name) {
  $('history-client-label').textContent = name;
  $('history-total-traffic').textContent = '–';
  $('history-traffic-detail').textContent = '–';
  $('history-last-real-ip').textContent = '–';
  $('history-real-port').textContent = '–';
  $('history-session-count').textContent = '–';
  $('history-body').innerHTML = `<tr><td colspan="6" class="muted center">${escapeHtml(t('loading'))}</td></tr>`;
  $('history-modal').hidden = false;

  try {
    const data = await api('/api/clients/' + encodeURIComponent(name) + '/connections?limit=50');
    const list = data.connections || [];
    const summary = data.summary || {};

    const totalTraffic = summary.totalBytes || 0;
    $('history-total-traffic').textContent = formatBytes(totalTraffic);
    $('history-traffic-detail').textContent =
      t('trafficDownload') + ': ' + formatBytes(summary.bytesSent || 0) + ' · ' + t('trafficUpload') + ': ' + formatBytes(summary.bytesReceived || 0);

    $('history-last-real-ip').textContent = summary.lastRealIp || '–';
    $('history-real-port').textContent = summary.lastRealAddress ? t('historyFullAddr') + summary.lastRealAddress : '–';
    $('history-session-count').textContent = String(summary.connectionCount || list.length || 0);

    const body = $('history-body');
    if (!list.length) {
      body.innerHTML = `<tr><td colspan="6" class="muted center">${escapeHtml(t('historyNoData'))}</td></tr>`;
      return;
    }
    body.innerHTML = list
      .map((c) => {
        const isConn = c.status === 'connected';
        const statusHtml = isConn
          ? `<span class="status-pill status-active"><span class="dot">●</span> ${escapeHtml(t('statusOnline'))}</span>`
          : `<span class="status-pill status-archived">${escapeHtml(t('statusOffline'))}</span>`;
        const discHtml = c.disconnectedAt
          ? fmtDate(c.disconnectedAt)
          : (isConn ? `<span class="pulse-dot"></span> ${escapeHtml(t('statusConnecting'))}` : '–');
        const trafficHtml = formatBytes(c.bytesReceived) + ' ' + t('trafficUpload') + ' / ' + formatBytes(c.bytesSent) + ' ' + t('trafficDownload');
        return `
          <tr>
            <td>${statusHtml}</td>
            <td><span class="chip chip-online">${escapeHtml(c.virtualIp || '–')}</span></td>
            <td><span class="chip chip-real">${escapeHtml(c.realAddress || '–')}</span></td>
            <td>${fmtDate(c.connectedAt)}</td>
            <td>${discHtml}</td>
            <td class="mono">${trafficHtml}</td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    $('history-body').innerHTML = `<tr><td colspan="6" class="error center">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ---------- Create Client Modal ---------- */
function openCreateModal() {
  $('create-form').reset();
  $('create-error').hidden = true;
  $('create-success').hidden = true;
  $('create-submit').hidden = false;
  $('create-submit').disabled = false;
  $('create-modal').hidden = false;
  $('client-name').focus();
}

async function doCreate(e) {
  e.preventDefault();
  const name = $('client-name').value.trim();
  const notes = $('client-notes').value.trim();
  const staticIp = $('client-ip').value.trim();
  $('create-error').hidden = true;
  const btn = $('create-submit');
  btn.disabled = true;
  btn.textContent = t('loading');
  try {
    await api('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name, notes, staticIp: staticIp || null }),
    });
    $('create-download').href = '/api/clients/' + encodeURIComponent(name) + '/config';
    $('create-download').setAttribute('download', name + '.ovpn');
    $('create-success').hidden = false;
    btn.hidden = true;
    toast(t('createSuccess'), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    $('create-error').textContent = err.message;
    $('create-error').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnCreate');
  }
}

/* ---------- Static IP Modal ---------- */
function openIpModal(c) {
  $('ip-client-name').value = c.name;
  $('ip-modal-client-label').textContent = c.name;
  $('ip-address-input').value = c.staticIp || '';
  $('ip-error').hidden = true;
  $('ip-submit').disabled = false;
  $('ip-clear-btn').hidden = !c.staticIp;
  $('ip-modal').hidden = false;
  $('ip-address-input').focus();
}

async function doSaveIp(e) {
  e.preventDefault();
  const name = $('ip-client-name').value;
  const ip = $('ip-address-input').value.trim();
  const btn = $('ip-submit');
  btn.disabled = true;
  $('ip-error').hidden = true;
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/ip', {
      method: 'POST',
      body: JSON.stringify({ staticIp: ip || null }),
    });
    $('ip-modal').hidden = true;
    toast(t('ipSavedSuccess', { name }), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    $('ip-error').textContent = err.message;
    $('ip-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function doClearIp() {
  const name = $('ip-client-name').value;
  const btn = $('ip-clear-btn');
  btn.disabled = true;
  $('ip-error').hidden = true;
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/ip', {
      method: 'POST',
      body: JSON.stringify({ staticIp: null }),
    });
    $('ip-modal').hidden = true;
    toast(t('ipSavedSuccess', { name }), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    $('ip-error').textContent = err.message;
    $('ip-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Renew Modal ---------- */
function openRenewModal(c) {
  $('renew-client-name').value = c.name;
  $('renew-client-label').textContent = c.name;
  const isExp = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
  $('renew-current-expiry').textContent = c.expiresAt
    ? t('renewCurrentExpiry') + fmtDate(c.expiresAt) + (isExp ? ' (' + t('statusExpired') + ')' : '')
    : '–';
  $('renew-days-select').value = '365';
  $('renew-custom-group').style.display = 'none';
  $('renew-custom-days').value = '';
  $('renew-error').hidden = true;
  $('renew-submit').disabled = false;
  $('renew-modal').hidden = false;
}

async function doRenew(e) {
  e.preventDefault();
  const name = $('renew-client-name').value;
  const sel = $('renew-days-select').value;
  let days;
  if (sel === 'custom') {
    days = parseInt($('renew-custom-days').value, 10);
    if (!days || days < 1 || days > 3650) {
      $('renew-error').textContent = t('renewCustomError');
      $('renew-error').hidden = false;
      return;
    }
  } else {
    days = parseInt(sel, 10);
  }

  const btn = $('renew-submit');
  btn.disabled = true;
  $('renew-error').hidden = true;
  try {
    const res = await api('/api/clients/' + encodeURIComponent(name) + '/renew', {
      method: 'POST',
      body: JSON.stringify({ days }),
    });
    $('renew-modal').hidden = true;
    toast(t('renewSuccess', { name, date: fmtDateShort(res.client.expiresAt) }), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    $('renew-error').textContent = err.message;
    $('renew-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Sync PKI ---------- */
async function doSync() {
  const btn = $('sync-btn');
  btn.disabled = true;
  try {
    const { summary } = await api('/api/sync', { method: 'POST', body: '{}' });
    toast(t('syncSuccess', { created: summary.created, updated: summary.updated }), 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Audit Log ---------- */
async function loadAudit() {
  try {
    const { entries } = await api('/api/audit?limit=25');
    cachedAuditEntries = entries || [];
    renderAudit();
  } catch {
    /* non-critical */
  }
}

function renderAudit() {
  const body = $('audit-body');
  if (!body) return;
  if (!cachedAuditEntries.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted center">${escapeHtml(t('noAudit'))}</td></tr>`;
    return;
  }
  body.innerHTML = cachedAuditEntries
    .map(
      (e) => `
        <tr>
          <td>${fmtDate(e.at)}</td>
          <td>${escapeHtml(e.admin || '–')}</td>
          <td><span class="chip">${escapeHtml(e.action)}</span></td>
          <td class="mono font-bold">${escapeHtml(e.client || '–')}</td>
          <td class="mono dim">${escapeHtml(e.ip || '–')}</td>
        </tr>
      `,
    )
    .join('');
}

init();
