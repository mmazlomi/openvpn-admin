'use strict';

let csrfToken = null;
const $ = (id) => document.getElementById(id);

const fmtDate = (iso) => {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
};
const fmtDateShort = (iso) => {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('fa-IR');
};
const STATUS_FA = { active: 'فعال', revoked: 'لغو شده', archived: 'بایگانی' };

function toast(msg, kind) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + (kind || '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (opts.method && opts.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('unauthenticated'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || ('HTTP ' + res.status));
  return data;
}

/* ---------- bootstrap ---------- */
async function init() {
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
  $('logout-btn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    window.location.href = '/login.html';
  });
  $('new-client-btn').addEventListener('click', openCreateModal);
  $('sync-btn').addEventListener('click', doSync);
  $('create-form').addEventListener('submit', doCreate);
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => { $('create-modal').hidden = true; $('details-modal').hidden = true; }));
  document.querySelectorAll('.modal-backdrop').forEach((bd) =>
    bd.addEventListener('click', (e) => { if (e.target === bd) bd.hidden = true; }));
}

/* ---------- status ---------- */
async function loadStatus() {
  try {
    const s = await api('/api/status');
    const badge = $('server-badge');
    if (s.server.running) {
      badge.textContent = 'سرور فعال · ' + s.server.host + ':' + s.server.port + '/' + s.server.protocol;
      badge.className = 'badge ok';
    } else {
      badge.textContent = 'سرور OpenVPN شناسایی نشد';
      badge.className = 'badge bad';
    }
    $('stat-online').textContent = s.onlineCount;
  } catch {
    $('server-badge').textContent = 'وضعیت نامشخص';
    $('server-badge').className = 'badge bad';
  }
}

/* ---------- clients ---------- */
async function loadClients() {
  const body = $('clients-body');
  try {
    const data = await api('/api/clients');
    const list = data.clients;
    $('stat-total').textContent = list.length;
    $('stat-active').textContent = list.filter((c) => c.status === 'active').length;
    $('stat-revoked').textContent = list.filter((c) => c.status === 'revoked').length;

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted center">هنوز کاربری وجود ندارد</td></tr>';
      return;
    }
    body.innerHTML = '';
    for (const c of list) {
      const tr = document.createElement('tr');
      tr.appendChild(cell(nameCell(c)));
      tr.appendChild(cell(statusPill(c.status)));
      tr.appendChild(cell(fmtDateShort(c.createdAt)));
      tr.appendChild(cell(c.status === 'revoked' ? '–' : fmtDateShort(c.expiresAt)));
      tr.appendChild(cell(c.online ? '<span class="dot-online">آنلاین</span>' : fmtDateShort(c.lastSeen)));
      tr.appendChild(actionCell(c));
      body.appendChild(tr);
    }
  } catch (err) {
    $('list-error').textContent = err.message;
    $('list-error').hidden = false;
    body.innerHTML = '';
  }
}

function cell(html) { const td = document.createElement('td'); if (html instanceof Node) td.appendChild(html); else td.innerHTML = html; return td; }
function nameCell(c) {
  const span = document.createElement('span');
  span.className = 'mono';
  span.textContent = c.name;
  return span;
}
function statusPill(status) {
  return '<span class="status-pill status-' + status + '">' + (STATUS_FA[status] || status) + '</span>';
}
function actionCell(c) {
  const td = document.createElement('td');
  td.className = 'actions';

  const dl = document.createElement('button');
  dl.className = 'btn-link';
  dl.textContent = 'دانلود';
  dl.disabled = c.status !== 'active';
  dl.addEventListener('click', () => downloadConfig(c.name));
  td.appendChild(dl);

  const details = document.createElement('button');
  details.className = 'btn-link';
  details.textContent = 'جزئیات';
  details.addEventListener('click', () => showDetails(c.name));
  td.appendChild(details);

  if (c.status === 'active') {
    const rv = document.createElement('button');
    rv.className = 'btn-link';
    rv.style.color = 'var(--danger)';
    rv.textContent = 'لغو';
    rv.addEventListener('click', () => doRevoke(c.name));
    td.appendChild(rv);
  } else if (c.status === 'revoked') {
    const ar = document.createElement('button');
    ar.className = 'btn-link';
    ar.textContent = 'بایگانی';
    ar.addEventListener('click', () => doArchive(c.name));
    td.appendChild(ar);
  }
  return td;
}

function downloadConfig(name) {
  // Authenticated GET; browser handles the attachment.
  const a = document.createElement('a');
  a.href = '/api/clients/' + encodeURIComponent(name) + '/config';
  a.download = name + '.ovpn';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function doRevoke(name) {
  if (!confirm('کاربر «' + name + '» لغو شود؟ این عملیات گواهی را در CRL قرار می‌دهد.')) return;
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/revoke', { method: 'POST', body: '{}' });
    toast('کاربر لغو شد', 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) { toast(err.message, 'bad'); }
}

async function doArchive(name) {
  if (!confirm('کاربر «' + name + '» بایگانی شود؟ گواهی روی دیسک حذف نمی‌شود.')) return;
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/archive', { method: 'POST', body: '{}' });
    toast('کاربر بایگانی شد', 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) { toast(err.message, 'bad'); }
}

async function showDetails(name) {
  try {
    const { client: c } = await api('/api/clients/' + encodeURIComponent(name));
    const rows = [
      ['نام', c.name],
      ['وضعیت', STATUS_FA[c.status] || c.status],
      ['سریال گواهی', c.certificateSerial || '–'],
      ['ایجاد', fmtDate(c.createdAt)],
      ['انقضا', fmtDate(c.expiresAt)],
      ['لغو شده', fmtDate(c.revokedAt)],
      ['بایگانی', fmtDate(c.archivedAt)],
      ['آخرین اتصال', c.online ? 'هم‌اکنون آنلاین' : fmtDate(c.lastSeen)],
    ];
    if (c.connection) {
      rows.push(['آدرس مجازی', c.connection.virtualAddress]);
      rows.push(['آدرس واقعی', c.connection.realAddress]);
      rows.push(['دریافت/ارسال', (c.connection.bytesReceived + ' / ' + c.connection.bytesSent) + ' بایت']);
    }
    if (c.notes) rows.push(['یادداشت', c.notes]);
    $('details-body').innerHTML = rows
      .map(([k, v]) => '<dt>' + k + '</dt><dd class="mono">' + escapeHtml(String(v)) + '</dd>')
      .join('');
    $('details-modal').hidden = false;
  } catch (err) { toast(err.message, 'bad'); }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- create ---------- */
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
  $('create-error').hidden = true;
  const btn = $('create-submit');
  btn.disabled = true;
  btn.textContent = 'در حال ایجاد…';
  try {
    await api('/api/clients', { method: 'POST', body: JSON.stringify({ name, notes }) });
    $('create-download').href = '/api/clients/' + encodeURIComponent(name) + '/config';
    $('create-download').setAttribute('download', name + '.ovpn');
    $('create-success').hidden = false;
    btn.hidden = true;
    toast('کاربر ایجاد شد', 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    $('create-error').textContent = err.message;
    $('create-error').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'ایجاد کاربر';
  }
}

async function doSync() {
  const btn = $('sync-btn');
  btn.disabled = true;
  try {
    const { summary } = await api('/api/sync', { method: 'POST', body: '{}' });
    toast('همگام‌سازی: ' + summary.created + ' جدید، ' + summary.updated + ' بروزرسانی', 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) { toast(err.message, 'bad'); }
  finally { btn.disabled = false; }
}

/* ---------- audit ---------- */
async function loadAudit() {
  try {
    const { entries } = await api('/api/audit?limit=25');
    const body = $('audit-body');
    if (!entries.length) { body.innerHTML = '<tr><td colspan="5" class="muted center">–</td></tr>'; return; }
    body.innerHTML = entries
      .map((e) =>
        '<tr><td>' + fmtDate(e.at) + '</td><td>' + escapeHtml(e.admin || '–') +
        '</td><td>' + escapeHtml(e.action) + '</td><td class="mono">' + escapeHtml(e.client || '–') +
        '</td><td class="mono">' + escapeHtml(e.ip || '–') + '</td></tr>')
      .join('');
  } catch { /* non-critical */ }
}

init();
