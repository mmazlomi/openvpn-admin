/**
 * Internationalization (i18n) definitions and helpers for OpenVPN Admin Panel.
 * Supports Persian (FA, RTL) and English (EN, LTR).
 */
'use strict';

const I18N = {
  fa: {
    dir: 'rtl',
    langName: 'فارسی',
    altLangName: 'English',
    brand: 'پنل مدیریت OpenVPN',
    loading: 'در حال بارگذاری…',
    serverOnline: 'سرور فعال',
    serverOffline: 'سرور OpenVPN شناسایی نشد',
    serverUnknown: 'وضعیت نامشخص',
    logout: 'خروج',
    loginTitle: 'پنل مدیریت OpenVPN',
    loginSubtitle: 'برای دسترسی به پنل مدیریت وارد شوید',
    loginUsername: 'نام کاربری',
    loginPassword: 'گذرواژه',
    loginSubmit: 'ورود به سیستم',
    loginProgress: 'در حال بررسی اعتبار…',
    loginFailed: 'ورود ناموفق بود',

    // Stats
    statTotal: 'کل کاربران',
    statActive: 'کاربران فعال',
    statRevoked: 'لغو شده',
    statOnline: 'کاربران آنلاین',
    statAllTraffic: 'کل مصرف ترافیک',

    // Toolbar
    usersTitle: 'کاربران',
    usersSubtitle: 'مدیریت حساب‌ها، تخصیص IP و نظارت بر مصرف ترافیک',
    syncPki: 'همگام‌سازی PKI',
    newUser: 'کاربر جدید +',
    searchPlaceholder: 'جستجو بر اساس نام، IP یا یادداشت…',
    filterAll: 'همه',
    filterOnline: 'آنلاین',
    filterActive: 'فعال',
    filterPaused: 'معلق',
    filterRevoked: 'لغو شده',
    userCountSuffix: 'کاربر',

    // Table Columns
    colName: 'نام کاربر',
    colStatus: 'وضعیت',
    colAssignedIp: 'IP تخصیص‌یافته',
    colConnectedIp: 'IP متصل فعلی',
    colLastRealIp: 'آخرین IP واقعی',
    colTraffic: 'مصرف ترافیک',
    colLastRequest: 'آخرین درخواست / فعالیت',
    colLastUrl: 'آخرین وب‌سایت / URL',
    colCreated: 'تاریخ ایجاد',
    colExpires: 'تاریخ انقضا',
    colLastSeen: 'آخرین اتصال',
    colActions: 'عملیات',

    // Relative Time
    timeJustNow: 'هم‌اکنون فعال',
    timeSecondsAgo: '{s} ثانیه پیش',
    timeMinutesAgo: '{m} دقیقه پیش',
    timeHoursAgo: '{h} ساعت پیش',

    // Status Badges
    statusActive: 'فعال',
    statusPaused: 'معلق (متوقف)',
    statusExpired: 'منقضی شده',
    statusRevoked: 'لغو شده',
    statusArchived: 'بایگانی',
    statusOnline: 'آنلاین',
    statusOffline: 'آفلاین',
    statusDynamic: 'پویا (خودکار)',
    statusConnecting: 'در حال اتصال',

    // Action Buttons
    actionDownload: 'دانلود',
    actionDownloadTitle: 'دانلود فایل کانفیگ .ovpn',
    actionDetails: 'جزئیات',
    actionDetailsTitle: 'مشاهده مشخصات کامل کاربر',
    actionHistory: 'تاریخچه',
    actionHistoryTitle: 'مشاهده تاریخچه اتصالات و آمار ترافیک',
    actionPause: 'توقف',
    actionPauseTitle: 'توقف موقت اتصال کاربر بدون ابطال گواهی',
    actionResume: 'فعال‌سازی',
    actionResumeTitle: 'فعال‌سازی مجدد اتصال کاربر',
    actionRenew: 'تمدید',
    actionRenewTitle: 'تمدید تاریخ انقضای گواهی',
    actionSetIp: 'تنظیم IP',
    actionSetIpTitle: 'تخصیص یا تغییر IP استاتیک',
    actionRevoke: 'لغو',
    actionRevokeTitle: 'ابطال گواهی کاربر',
    actionArchive: 'بایگانی',
    actionArchiveTitle: 'بایگانی کردن حساب کاربر',
    actionDelete: 'حذف',
    actionDeleteTitle: 'حذف کامل حساب و فایل‌های کاربر',
    actionMore: 'عملیات',
    actionMoreTitle: 'سایر عملیات کاربر',

    // Traffic labels
    trafficDownload: 'دانلود',
    trafficUpload: 'آپلود',
    trafficTotal: 'مجموع ترافیک',

    // Audit Panel
    auditTitle: 'گزارش رویدادها',
    auditColTime: 'زمان',
    auditColAdmin: 'مدیر',
    auditColAction: 'عملیات',
    auditColClient: 'کاربر',
    auditColIp: 'IP مدیر',
    noAudit: 'رویدادی ثبت نشده است',

    // Modals - Create
    createTitle: 'ایجاد کاربر جدید OpenVPN',
    createNameLabel: 'نام کاربر',
    createNamePlaceholder: 'حروف انگلیسی، ارقام، _ یا -',
    createIpLabel: 'آدرس IP اختصاصی (اختیاری)',
    createIpPlaceholder: 'مثلاً 10.8.0.25 (خالی = پویا)',
    createIpHint: 'محدوده مجاز استاتیک: 10.8.0.2 تا 10.8.0.50 (IPهای بالاتر از 50 برای تخصیص پویا هستند)',
    createNotesLabel: 'یادداشت (اختیاری)',
    createSuccess: 'کاربر با موفقیت ایجاد شد.',
    createDownloadOvpn: 'دانلود فایل کانفیگ OpenVPN',
    btnCancel: 'انصراف',
    btnClose: 'بستن',
    btnCreate: 'ایجاد کاربر',

    // Modals - Details
    detailsTitle: 'مشخصات کامل کاربر',
    detailsBtnHistory: 'مشاهده تاریخچه اتصالات',

    // Modals - History
    historyTitle: 'تاریخچه اتصالات کاربر: ',
    historyCardTotalTraffic: 'کل ترافیک مصرفی',
    historyCardLastRealIp: 'آخرین IP واقعی',
    historyCardLastUrl: 'آخرین آدرس / دامنه وب',
    historyCardSessions: 'تعداد دفعات اتصال',
    historySessionsHint: 'نشست‌های ثبت شده',
    historyColStatus: 'وضعیت',
    historyColVpnIp: 'IP متصل (VPN)',
    historyColRealIp: 'آدرس اینترنتی (Real IP)',
    historyColStart: 'زمان شروع اتصال',
    historyColEnd: 'زمان قطع',
    historyColTraffic: 'ترافیک نشست',
    historyNoData: 'سابقه‌ای از اتصال برای این کاربر ثبت نشده است',
    historyFullAddr: 'آدرس کامل: ',
    historyTabConnections: 'نشست‌های اتصال',
    historyTabUrls: 'آدرس‌های وب اخیر (HTTP/HTTPS)',
    historyColUrl: 'آدرس / دامنه وب',
    historyColUrlType: 'نوع پروتکل',
    historyColUrlTime: 'زمان بازدید',
    historyNoUrls: 'هنوز آدرس وبی برای این کاربر ثبت نشده است',
    urlTypeHttps: 'امن (HTTPS)',
    urlTypeHttp: 'وب (HTTP)',
    urlTypeDns: 'دامنه (DNS)',

    // Modals - IP
    ipTitle: 'تنظیم IP اختصاصی',
    ipIntro: 'تعیین یا تغییر آدرس IP برای کاربر: ',
    ipLabel: 'آدرس IP استاتیک',
    ipPlaceholder: 'مثلاً 10.8.0.25 (خالی = پویا)',
    ipClearBtn: 'تبدیل به IP پویا (حذف استاتیک)',
    ipSubmitBtn: 'ذخیره تنظیمات IP',

    // Modals - Renew
    renewTitle: 'تمدید تاریخ انقضای گواهی',
    renewIntro: 'تمدید اعتبار گواهی برای کاربر: ',
    renewCurrentExpiry: 'انقضای فعلی: ',
    renewSelectLabel: 'مدت زمان تمدید اعتبار',
    renew30: '۳۰ روز (۱ ماه)',
    renew90: '۹۰ روز (۳ ماه)',
    renew180: '۱۸۰ روز (۶ ماه)',
    renew365: '۳۶۵ روز (۱ سال)',
    renew825: '۸۲۵ روز (~۲ سال و ۳ ماه)',
    renewCustom: 'سایر (تعداد روز دستی)...',
    renewCustomLabel: 'تعداد روز دستی (۱ تا ۳۶۵۰ روز)',
    renewCustomPlaceholder: 'مثلاً 60',
    renewCustomError: 'لطفاً تعداد روز معتبر بین ۱ تا ۳۶۵۰ وارد کنید.',
    renewSubmitBtn: 'تمدید اعتبار',

    // Confirmations & Prompts
    confirmDelete: 'آیا از حذف کامل حساب کاربر «{name}» اطمینان دارید؟\nاین عملیات برگشت‌پذیر نیست و کلیه فایل‌ها و دسترسی‌های کاربر حذف خواهند شد.',
    confirmRevoke: 'آیا از ابطال گواهی کاربر «{name}» مطمئن هستید؟ کاربر دیگر امکان اتصال نخواهد داشت.',
    deleteSuccess: 'کاربر «{name}» به طور کامل حذف شد',
    pauseSuccess: 'اتصال کاربر «{name}» متوقف شد',
    resumeSuccess: 'کاربر «{name}» مجدداً فعال گردید',
    renewSuccess: 'اعتبار کاربر «{name}» تا تاریخ {date} تمدید شد',
    ipSavedSuccess: 'تنظیمات IP کاربر «{name}» با موفقیت ذخیره شد',
    syncSuccess: 'همگام‌سازی PKI: {created} جدید، {updated} بروزرسانی',
    emptyTable: 'هنوز کاربری وجود ندارد',
    emptySearch: 'کاربری مطابق با عبارت جستجو یافت نشد',

    // Theme tooltips
    themeDark: 'تغییر به حالت تاریک',
    themeLight: 'تغییر به حالت روشن',
    themeDarkLabel: 'تاریک',
    themeLightLabel: 'روشن',
    langTooltip: 'Switch to English',
  },

  en: {
    dir: 'ltr',
    langName: 'English',
    altLangName: 'فارسی',
    brand: 'OpenVPN Admin Panel',
    loading: 'Loading…',
    serverOnline: 'Server Online',
    serverOffline: 'OpenVPN Server Not Found',
    serverUnknown: 'Unknown Status',
    logout: 'Logout',
    loginTitle: 'OpenVPN Admin Panel',
    loginSubtitle: 'Sign in to access your dashboard',
    loginUsername: 'Username',
    loginPassword: 'Password',
    loginSubmit: 'Sign In',
    loginProgress: 'Verifying credentials…',
    loginFailed: 'Authentication failed',

    // Stats
    statTotal: 'Total Users',
    statActive: 'Active Users',
    statRevoked: 'Revoked Users',
    statOnline: 'Online Users',
    statAllTraffic: 'All Traffic',

    // Toolbar
    usersTitle: 'Users',
    usersSubtitle: 'Manage client accounts, static IPs and traffic quotas',
    syncPki: 'Sync PKI',
    newUser: '+ New User',
    searchPlaceholder: 'Search by name, IP, notes…',
    filterAll: 'All',
    filterOnline: 'Online',
    filterActive: 'Active',
    filterPaused: 'Paused',
    filterRevoked: 'Revoked',
    userCountSuffix: 'users',

    // Table Columns
    colName: 'User Name',
    colStatus: 'Status',
    colAssignedIp: 'Assigned IP',
    colConnectedIp: 'Connected VPN IP',
    colLastRealIp: 'Last Real IP',
    colTraffic: 'Traffic Usage',
    colLastRequest: 'Last Request / Activity',
    colLastUrl: 'Last Visited URL',
    colCreated: 'Created',
    colExpires: 'Expires',
    colLastSeen: 'Last Seen',
    colActions: 'Actions',

    // Relative Time
    timeJustNow: 'Active now',
    timeSecondsAgo: '{s}s ago',
    timeMinutesAgo: '{m}m ago',
    timeHoursAgo: '{h}h ago',

    // Status Badges
    statusActive: 'Active',
    statusPaused: 'Paused',
    statusExpired: 'Expired',
    statusRevoked: 'Revoked',
    statusArchived: 'Archived',
    statusOnline: 'Online',
    statusOffline: 'Offline',
    statusDynamic: 'Dynamic',
    statusConnecting: 'Connecting',

    // Action Buttons
    actionDownload: 'Download',
    actionDownloadTitle: 'Download .ovpn profile',
    actionDetails: 'Details',
    actionDetailsTitle: 'View full client details',
    actionHistory: 'History',
    actionHistoryTitle: 'View connection history & traffic stats',
    actionPause: 'Pause',
    actionPauseTitle: 'Temporarily pause connection without revoking certificate',
    actionResume: 'Activate',
    actionResumeTitle: 'Re-enable user connection',
    actionRenew: 'Renew',
    actionRenewTitle: 'Extend certificate expiration date',
    actionSetIp: 'Set IP',
    actionSetIpTitle: 'Assign or modify static IP',
    actionRevoke: 'Revoke',
    actionRevokeTitle: 'Revoke client certificate',
    actionArchive: 'Archive',
    actionArchiveTitle: 'Archive client record',
    actionDelete: 'Delete',
    actionDeleteTitle: 'Permanently remove client files and database record',
    actionMore: 'More',
    actionMoreTitle: 'More user actions',

    // Traffic labels
    trafficDownload: 'Down',
    trafficUpload: 'Up',
    trafficTotal: 'Total Traffic',

    // Audit Panel
    auditTitle: 'Audit Logs',
    auditColTime: 'Timestamp',
    auditColAdmin: 'Admin',
    auditColAction: 'Action',
    auditColClient: 'Client',
    auditColIp: 'Admin IP',
    noAudit: 'No audit records found',

    // Modals - Create
    createTitle: 'Create New OpenVPN User',
    createNameLabel: 'User Name',
    createNamePlaceholder: 'letters, digits, _ or -',
    createIpLabel: 'Static IP Address (Optional)',
    createIpPlaceholder: 'e.g. 10.8.0.25 (empty = dynamic)',
    createIpHint: 'Allowed static range: 10.8.0.2 to 10.8.0.50 (IPs above 50 are dynamic pool)',
    createNotesLabel: 'Notes (Optional)',
    createSuccess: 'User created successfully.',
    createDownloadOvpn: 'Download OpenVPN Profile',
    btnCancel: 'Cancel',
    btnClose: 'Close',
    btnCreate: 'Create User',

    // Modals - Details
    detailsTitle: 'User Details',
    detailsBtnHistory: 'View Connection History',

    // Modals - History
    historyTitle: 'Connection History: ',
    historyCardTotalTraffic: 'Total Traffic',
    historyCardLastRealIp: 'Last Real IP',
    historyCardLastUrl: 'Last Visited URL',
    historyCardSessions: 'Total Sessions',
    historySessionsHint: 'Recorded connections',
    historyColStatus: 'Status',
    historyColVpnIp: 'Connected IP (VPN)',
    historyColRealIp: 'Internet Address (Real IP)',
    historyColStart: 'Connected At',
    historyColEnd: 'Disconnected At',
    historyColTraffic: 'Session Traffic',
    historyNoData: 'No connection history recorded for this user',
    historyFullAddr: 'Full Address: ',
    historyTabConnections: 'Connection Sessions',
    historyTabUrls: 'Recent Web URLs (HTTP/HTTPS)',
    historyColUrl: 'Web URL / Domain',
    historyColUrlType: 'Protocol',
    historyColUrlTime: 'Visited At',
    historyNoUrls: 'No web URLs recorded for this user yet',
    urlTypeHttps: 'Secure (HTTPS)',
    urlTypeHttp: 'Web (HTTP)',
    urlTypeDns: 'Domain (DNS)',

    // Modals - IP
    ipTitle: 'Assign Static IP Address',
    ipIntro: 'Set or change static IP address for: ',
    ipLabel: 'Static IP Address',
    ipPlaceholder: 'e.g. 10.8.0.25 (empty = dynamic)',
    ipClearBtn: 'Convert to Dynamic IP',
    ipSubmitBtn: 'Save IP Settings',

    // Modals - Renew
    renewTitle: 'Extend Certificate Expiration',
    renewIntro: 'Extend certificate expiration for: ',
    renewCurrentExpiry: 'Current Expiry: ',
    renewSelectLabel: 'Extension Duration',
    renew30: '30 Days (1 Month)',
    renew90: '90 Days (3 Months)',
    renew180: '180 Days (6 Months)',
    renew365: '365 Days (1 Year)',
    renew825: '825 Days (~2 Years 3 Months)',
    renewCustom: 'Custom Days…',
    renewCustomLabel: 'Custom Days (1 to 3650 days)',
    renewCustomPlaceholder: 'e.g. 60',
    renewCustomError: 'Please enter a valid number of days between 1 and 3650.',
    renewSubmitBtn: 'Extend Expiration',

    // Confirmations & Prompts
    confirmDelete: 'Are you sure you want to permanently delete user "{name}"?\nThis cannot be undone and all certificate files will be removed.',
    confirmRevoke: 'Are you sure you want to revoke "{name}"? The user will no longer be able to connect.',
    deleteSuccess: 'User "{name}" deleted permanently',
    pauseSuccess: 'User "{name}" connection paused',
    resumeSuccess: 'User "{name}" resumed successfully',
    renewSuccess: 'Certificate for "{name}" extended until {date}',
    ipSavedSuccess: 'IP configuration for "{name}" saved successfully',
    syncSuccess: 'PKI Sync: {created} new, {updated} updated',
    emptyTable: 'No users created yet',
    emptySearch: 'No users match your search query',

    // Theme tooltips
    themeDark: 'Switch to Dark Mode',
    themeLight: 'Switch to Light Mode',
    themeDarkLabel: 'Dark',
    themeLightLabel: 'Light',
    langTooltip: 'تغییر به زبان فارسی',
  },
};

/**
 * Current language state management.
 */
let currentLang = localStorage.getItem('openvpn_admin_lang') || 'fa';
if (currentLang !== 'fa' && currentLang !== 'en') currentLang = 'fa';

function t(key, params = {}) {
  const dict = I18N[currentLang] || I18N.fa;
  let str = dict[key] !== undefined ? dict[key] : (I18N.en[key] || key);
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return str;
}

function setLanguage(lang) {
  if (lang !== 'fa' && lang !== 'en') return;
  currentLang = lang;
  localStorage.setItem('openvpn_admin_lang', lang);
  applyI18nToDom();
}

function toggleLanguage() {
  setLanguage(currentLang === 'fa' ? 'en' : 'fa');
}

function applyI18nToDom() {
  const dict = I18N[currentLang];
  document.documentElement.lang = currentLang;
  document.documentElement.dir = dict.dir;

  // Text content
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });

  // Placeholder
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const key = el.getAttribute('data-i18n-ph');
    if (dict[key]) el.placeholder = dict[key];
  });

  // Title / Tooltip
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (dict[key]) el.title = dict[key];
  });

  // Update switcher button label
  const langLabel = document.getElementById('lang-label');
  if (langLabel) {
    langLabel.textContent = currentLang === 'fa' ? 'EN' : 'فا';
  }
  const langToggle = document.getElementById('lang-toggle');
  if (langToggle) {
    langToggle.title = dict.langTooltip || (currentLang === 'fa' ? 'Switch to English' : 'تغییر به فارسی');
  }

  // Dispatch custom event for dynamic components to re-render
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: currentLang } }));
}

/**
 * Theme management: Dark / Light
 */
let currentTheme = localStorage.getItem('openvpn_admin_theme');
if (!currentTheme) {
  currentTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
if (currentTheme !== 'dark' && currentTheme !== 'light') currentTheme = 'dark';

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
  }
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.title = currentTheme === 'dark' ? t('themeLight') : t('themeDark');
  }
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('openvpn_admin_theme', currentTheme);
  applyTheme();
}

// Initial auto-apply before page finishes rendering to prevent flash of wrong theme/lang
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', currentTheme);
  document.documentElement.lang = currentLang;
  document.documentElement.dir = (I18N[currentLang] || I18N.fa).dir;
}
