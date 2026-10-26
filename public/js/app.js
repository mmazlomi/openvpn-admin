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
const STATUS_FA = { active: 'فعال', paused: 'معلق (متوقف)', revoked: 'لغو شده', archived: 'بایگانی' };

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
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => {
      $('create-modal').hidden = true;
      $('details-modal').hidden = true;
      $('ip-modal').hidden = true;
      $('renew-modal').hidden = true;
      $('history-modal').hidden = true;
    }));
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
      body.innerHTML = '<tr><td colspan="10" class="muted center">هنوز کاربری وجود ندارد</td></tr>';
      return;
    }
    body.innerHTML = '';
    for (const c of list) {
      const tr = document.createElement('tr');
      tr.appendChild(cell(nameCell(c)));
      tr.appendChild(cell(statusPill(c)));
      tr.appendChild(cell(assignedIpCell(c)));
      tr.appendChild(cell(connectedIpCell(c)));
      tr.appendChild(cell(lastRealIpCell(c)));
      tr.appendChild(cell(trafficCell(c)));
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
  span.className = 'mono font-bold';
  span.textContent = c.name;
  return span;
}
function assignedIpCell(c) {
  if (c.staticIp) {
    return '<span class="mono ip-assigned">' + escapeHtml(c.staticIp) + '</span>';
  }
  return '<span class="muted">پویا (خودکار)</span>';
}
function connectedIpCell(c) {
  if (c.online && (c.connectedIp || c.connection?.virtualAddress)) {
    const ip = c.connectedIp || c.connection.virtualAddress;
    const real = c.connection?.realAddress ? escapeHtml(c.connection.realAddress) : '';
    return '<span class="mono ip-connected" title="' + (real ? 'آدرس اینترنتی: ' + real : '') + '">' +
           '<span class="dot-green">●</span> ' + escapeHtml(ip) + '</span>';
  }
  return '<span class="muted">–</span>';
}
function lastRealIpCell(c) {
  if (c.online && (c.connection?.realAddress || c.lastRealAddress)) {
    const addr = c.connection?.realAddress || c.lastRealAddress;
    const ip = c.lastRealIp || addr.replace(/:[0-9]+$/, '');
    return '<span class="mono ip-connected" title="آدرس آنلاین: ' + escapeHtml(addr) + '">' +
           '<span class="dot-green">●</span> ' + escapeHtml(ip) + '</span>';
  }
  if (c.lastRealIp) {
    return '<span class="mono" title="' + escapeHtml(c.lastRealAddress || '') + '">' +
           escapeHtml(c.lastRealIp) + '</span>';
  }
  return '<span class="muted">–</span>';
}
function trafficCell(c) {
  const total = c.totalBytes || 0;
  if (!total) return '<span class="muted">۰ B</span>';
  const sent = c.bytesSent || 0;
  const recv = c.bytesReceived || 0;
  return '<div class="traffic-cell">' +
         '<span class="mono font-bold">' + formatBytes(total) + '</span>' +
         '<div class="muted small-text" title="دانلود: ' + formatBytes(sent) + ' | آپلود: ' + formatBytes(recv) + '">' +
         '↓ ' + formatBytes(sent) + ' · ↑ ' + formatBytes(recv) +
         '</div></div>';
}
function statusPill(c) {
  if (c.status === 'paused' || c.paused) {
    return '<span class="status-pill status-paused">معلق (متوقف)</span>';
  }
  if (c.status === 'active' && c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) {
    return '<span class="status-pill status-expired">منقضی شده</span>';
  }
  return '<span class="status-pill status-' + c.status + '">' + (STATUS_FA[c.status] || c.status) + '</span>';
}
function actionCell(c) {
  const td = document.createElement('td');
  td.className = 'actions';

  const dl = document.createElement('button');
  dl.className = 'btn-link';
  dl.textContent = 'دانلود';
  dl.disabled = c.status !== 'active' && c.status !== 'paused' && !c.paused;
  dl.addEventListener('click', () => downloadConfig(c.name));
  td.appendChild(dl);

  const details = document.createElement('button');
  details.className = 'btn-link';
  details.textContent = 'جزئیات';
  details.addEventListener('click', () => showDetails(c.name));
  td.appendChild(details);

  const histBtn = document.createElement('button');
  histBtn.className = 'btn-link';
  histBtn.textContent = 'تاریخچه';
  histBtn.title = 'مشاهده تاریخچه اتصالات کاربر';
  histBtn.addEventListener('click', () => showHistory(c.name));
  td.appendChild(histBtn);

  const isLiveActive = (c.status === 'active' || c.status === 'paused' || c.paused);
  if (isLiveActive) {
    if (c.paused || c.status === 'paused') {
      const actBtn = document.createElement('button');
      actBtn.className = 'btn-link';
      actBtn.style.color = 'var(--success)';
      actBtn.textContent = 'فعال‌سازی';
      actBtn.title = 'فعال‌سازی و برقراری مجدد اتصال کاربر';
      actBtn.addEventListener('click', () => doResume(c.name));
      td.appendChild(actBtn);
    } else {
      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'btn-link';
      pauseBtn.style.color = 'var(--warn)';
      pauseBtn.textContent = 'توقف';
      pauseBtn.title = 'توقف موقت اتصال کاربر';
      pauseBtn.addEventListener('click', () => doPause(c.name));
      td.appendChild(pauseBtn);
    }

    const renewBtn = document.createElement('button');
    renewBtn.className = 'btn-link';
    renewBtn.textContent = 'تمدید';
    renewBtn.title = 'تمدید تاریخ انقضای گواهی';
    renewBtn.addEventListener('click', () => openRenewModal(c));
    td.appendChild(renewBtn);

    const ipBtn = document.createElement('button');
    ipBtn.className = 'btn-link';
    ipBtn.textContent = 'تنظیم IP';
    ipBtn.addEventListener('click', () => openIpModal(c));
    td.appendChild(ipBtn);

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

  const del = document.createElement('button');
  del.className = 'btn-link';
  del.style.color = 'var(--danger)';
  del.textContent = 'حذف';
  del.title = 'حذف کامل حساب کاربر';
  del.addEventListener('click', () => doDelete(c.name));
  td.appendChild(del);

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

async function doPause(name) {
  if (!confirm('آیا مطمئن هستید که می‌خواهید اتصال کاربر «' + name + '» را موقتاً متوقف کنید؟\nدر صورت اتصال، کاربر بلافاصله قطع خواهد شد و تا زمان فعال‌سازی مجدد امکان اتصال نخواهد داشت.')) return;
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/pause', { method: 'POST', body: '{}' });
    toast('اتصال کاربر «' + name + '» موقتاً متوقف شد', 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) { toast(err.message, 'bad'); }
}

async function doResume(name) {
  if (!confirm('اتصال کاربر «' + name + '» مجدداً فعال و برقرار شود؟')) return;
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/resume', { method: 'POST', body: '{}' });
    toast('اتصال کاربر «' + name + '» مجدداً فعال شد', 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) { toast(err.message, 'bad'); }
}

async function doDelete(name) {
  if (!confirm('آیا از حذف کامل حساب کاربر «' + name + '» اطمینان دارید؟\nاین عملیات برگشت‌پذیر نیست و کلیه فایل‌ها و دسترسی‌های کاربر حذف خواهند شد.')) return;
  try {
    await api('/api/clients/' + encodeURIComponent(name), { method: 'DELETE' });
    toast('کاربر «' + name + '» به طور کامل حذف شد', 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) { toast(err.message, 'bad'); }
}

async function showDetails(name) {
  try {
    const { client: c } = await api('/api/clients/' + encodeURIComponent(name));
    const rows = [
      ['نام', c.name],
      ['وضعیت', STATUS_FA[c.status] || c.status],
      ['IP تخصیص‌یافته', c.staticIp ? c.staticIp : 'پویا (خودکار)'],
      ['IP متصل فعلی (VPN)', c.online && (c.connectedIp || c.connection?.virtualAddress)
        ? (c.connectedIp || c.connection.virtualAddress) + ' (آنلاین)'
        : 'متصل نیست (آفلاین)'],
      ['آخرین IP واقعی', c.lastRealAddress || '–'],
      ['کل ترافیک مصرفی', formatBytes(c.totalBytes) + ' (دانلود: ' + formatBytes(c.bytesSent) + ' / آپلود: ' + formatBytes(c.bytesReceived) + ')'],
      ['تعداد دفعات اتصال', c.connectionCount ? String(c.connectionCount) : '–'],
      ['سریال گواهی', c.certificateSerial || '–'],
      ['ایجاد', fmtDate(c.createdAt)],
      ['انقضا', fmtDate(c.expiresAt)],
      ['لغو شده', fmtDate(c.revokedAt)],
      ['بایگانی', fmtDate(c.archivedAt)],
      ['آخرین اتصال', c.online ? 'هم‌اکنون آنلاین' : fmtDate(c.lastSeen)],
    ];
    if (c.connection) {
      rows.push(['نشست فعلی - آدرس اینترنتی', c.connection.realAddress]);
      rows.push(['نشست فعلی - دریافت/ارسال', (c.connection.bytesReceived + ' / ' + c.connection.bytesSent) + ' بایت']);
    }
    if (c.notes) rows.push(['یادداشت', c.notes]);
    $('details-body').innerHTML = rows
      .map(([k, v]) => '<dt>' + k + '</dt><dd class="mono">' + escapeHtml(String(v)) + '</dd>')
      .join('');
    $('details-modal').dataset.clientName = c.name;
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
  const staticIp = $('client-ip').value.trim();
  $('create-error').hidden = true;
  const btn = $('create-submit');
  btn.disabled = true;
  btn.textContent = 'در حال ایجاد…';
  try {
    await api('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name, notes, staticIp: staticIp || null }),
    });
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

/* ---------- static ip modal ---------- */
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
    toast(ip ? 'IP اختصاصی ذخیره شد' : 'IP اختصاصی حذف شد (تبدیل به پویا)', 'good');
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
  if (!confirm('آیا مطمئن هستید که می‌خواهید IP اختصاصی کاربر «' + name + '» حذف شده و به IP پویا تغییر کند؟')) return;
  const btn = $('ip-clear-btn');
  btn.disabled = true;
  $('ip-error').hidden = true;
  try {
    await api('/api/clients/' + encodeURIComponent(name) + '/ip', {
      method: 'POST',
      body: JSON.stringify({ staticIp: null }),
    });
    $('ip-modal').hidden = true;
    toast('IP اختصاصی حذف شد (تبدیل به پویا)', 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    $('ip-error').textContent = err.message;
    $('ip-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- renew modal ---------- */
function openRenewModal(c) {
  $('renew-client-name').value = c.name;
  $('renew-client-label').textContent = c.name;
  const isExp = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
  $('renew-current-expiry').textContent = c.expiresAt
    ? 'تاریخ انقضای فعلی: ' + fmtDate(c.expiresAt) + (isExp ? ' (منقضی شده)' : '')
    : 'تاریخ انقضا مشخص نیست';
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
      $('renew-error').textContent = 'لطفاً تعداد روز معتبر بین ۱ تا ۳۶۵۰ وارد کنید.';
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
    toast('اعتبار کاربر «' + name + '» تا تاریخ ' + fmtDateShort(res.client.expiresAt) + ' تمدید شد', 'good');
    await Promise.all([loadClients(), loadAudit()]);
  } catch (err) {
    $('renew-error').textContent = err.message;
    $('renew-error').hidden = false;
  } finally {
    btn.disabled = false;
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

/* ---------- connection history ---------- */
function formatBytes(b) {
  const bytes = Number(b) || 0;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function showHistory(name) {
  $('history-client-label').textContent = name;
  $('history-total-traffic').textContent = '–';
  $('history-traffic-detail').textContent = '–';
  $('history-last-real-ip').textContent = '–';
  $('history-real-port').textContent = '–';
  $('history-session-count').textContent = '–';
  $('history-body').innerHTML = '<tr><td colspan="6" class="muted center">در حال بارگذاری…</td></tr>';
  $('history-modal').hidden = false;

  try {
    const data = await api('/api/clients/' + encodeURIComponent(name) + '/connections?limit=50');
    const list = data.connections || [];
    const summary = data.summary || {};

    const totalTraffic = summary.totalBytes || 0;
    $('history-total-traffic').textContent = formatBytes(totalTraffic);
    $('history-traffic-detail').textContent =
      'دانلود: ' + formatBytes(summary.bytesSent || 0) + ' · آپلود: ' + formatBytes(summary.bytesReceived || 0);

    $('history-last-real-ip').textContent = summary.lastRealIp || '–';
    $('history-real-port').textContent = summary.lastRealAddress ? ('آدرس کامل: ' + summary.lastRealAddress) : '–';
    $('history-session-count').textContent = String(summary.connectionCount || list.length || 0);

    const body = $('history-body');
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted center">سابقه‌ای از اتصال برای این کاربر ثبت نشده است</td></tr>';
      return;
    }
    body.innerHTML = list
      .map((c) => {
        const isConn = c.status === 'connected';
        const statusHtml = isConn
          ? '<span class="status-pill status-active">آنلاین</span>'
          : '<span class="status-pill status-archived">قطع شده</span>';
        const discHtml = c.disconnectedAt
          ? fmtDate(c.disconnectedAt)
          : (isConn ? '<span class="dot-online">در حال اتصال</span>' : '–');
        const trafficHtml = formatBytes(c.bytesReceived) + ' دریافت / ' + formatBytes(c.bytesSent) + ' ارسال';
        return (
          '<tr>' +
          '<td>' + statusHtml + '</td>' +
          '<td><span class="mono ip-connected">' + escapeHtml(c.virtualIp || '–') + '</span></td>' +
          '<td><span class="mono muted">' + escapeHtml(c.realAddress || '–') + '</span></td>' +
          '<td>' + fmtDate(c.connectedAt) + '</td>' +
          '<td>' + discHtml + '</td>' +
          '<td class="mono">' + trafficHtml + '</td>' +
          '</tr>'
        );
      })
      .join('');
  } catch (err) {
    $('history-body').innerHTML = '<tr><td colspan="6" class="error center">' + escapeHtml(err.message) + '</td></tr>';
  }
}

init();
