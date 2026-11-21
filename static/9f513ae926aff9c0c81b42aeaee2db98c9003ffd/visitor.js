'use strict';

const visitorMail = (() => {
  const el = name => byId('visitor-' + name);
  const syncTime = new Intl.DateTimeFormat('ru-RU', {dateStyle: 'short', timeStyle: 'short'});
  let available = false, session = null, list = [], frequency = 0, error = '';
  let version = 0, busy = false, refreshing = false, poll = 0, expiry = 0;
  let loaded = false;
  const controllers = new Set();
  const syncing = new Set();

  function storageKey() {
    return 'ayai-mail:visitor:v1:' + apiOrigin + ':' + new URL('.', location.href).pathname;
  }
  function token() { return state.demo ? '' : session?.token || ''; }
  function timer() {
    clearTimeout(expiry);
    if (session && !state.demo) expiry = setTimeout(() => {
      if (Date.now() >= session.expires) end(session.token, 'Срок сессии истёк.');
      else timer();
    }, Math.max(0, Math.min(2147483647, session.expires - Date.now())));
  }
  function restore() {
    if (state.demo) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey()));
      if (saved && typeof saved.token === 'string' && saved.token && saved.expires > Date.now()) session = saved;
      else { session = null; sessionStorage.removeItem(storageKey()); }
    } catch { if (session && session.expires <= Date.now()) session = null; }
    timer();
  }
  function stop() {
    ++version;
    clearTimeout(poll);
    for (const controller of controllers) controller.abort();
    controllers.clear();
    busy = false;
    refreshing = false;
    syncing.clear();
  }
  function feedback(message, failed = false) {
    const output = el('accounts-feedback');
    output.textContent = message;
    output.hidden = !message;
    output.classList.toggle('is-error', failed);
  }
  function cleanDialog() {
    el('account-form').reset();
    providerHelp();
    el('accounts-list').replaceChildren();
    el('accounts-error-text').textContent = '';
    el('accounts-load-error').hidden = true;
    feedback('');
    if (el('accounts-dialog').open) el('accounts-dialog').close();
  }
  function end(expected, message) {
    if (!session || expected !== session.token) return;
    stop();
    clearTimeout(expiry);
    session = null;
    list = []; loaded = false; error = ''; frequency = 0;
    try { sessionStorage.removeItem(storageKey()); } catch { /* Already cleared in memory. */ }
    cleanDialog();
    render();
    resetMailboxView();
    if (message) personal.toast(message, 'Для поиска в своей почте подключите ящик снова.');
  }
  async function request(path, body, timeout = 20000) {
    if (!available || state.demo) throw new Error('Подключение почты недоступно.');
    const controller = new AbortController();
    controllers.add(controller);
    const alarm = setTimeout(() => controller.abort(new Error('Почтовый сервер не ответил вовремя.')), timeout);
    try {
      return await fetchJSON('/api/visitor/' + path, controller, body);
    } finally {
      clearTimeout(alarm);
      controllers.delete(controller);
    }
  }
  function providerHelp() {
    const yandex = el('account-form').elements.provider.value === 'yandex';
    const link = el('account-password-link');
    link.href = yandex ? 'https://passport.yandex.ru/security/app-passwords' : 'https://myaccount.google.com/apppasswords';
    link.textContent = yandex ? 'Создать пароль приложения Яндекс ID' : 'Создать пароль приложения Google';
  }
  function render() {
    el('open').hidden = !available;
    el('open').querySelector('span').textContent = list.length ? 'Моя почта' : 'Подключить свою почту';
    const target = el('accounts-list'), focus = document.activeElement?.dataset.syncId;
    const cards = document.createDocumentFragment();
    for (const account of list) {
      const card = node('article', 'account-card'), title = node('div', 'account-title');
      title.append(node('strong', '', account.address), node('span', 'account-provider', account.provider === 'gmail' ? 'Gmail' : 'Яндекс.Почта'));
      const active = syncing.has(account.id) || account.status === 'syncing';
      const status = node('span', 'account-phase', active ? 'Синхронизация…' : account.status === 'error' ? 'Ошибка синхронизации' :
        account.last_synced ? 'Синхронизировано' : 'Ожидает синхронизации');
      status.classList.toggle('is-error', account.status === 'error');
      const stamp = new Date(account.last_synced);
      const last = account.last_synced && !Number.isNaN(stamp.getTime()) ? ' · Обновлено ' + syncTime.format(stamp) : '';
      card.append(title, status, node('p', 'account-caption', mailCount(account.count || 0) + last));
      if (account.sync_limit && account.total_available > account.sync_limit) card.append(node('p', 'account-caption',
        'В ящике ' + mailCount(account.total_available) + '. В поиск попадают последние ' + numberFormat.format(account.sync_limit) + '.'));
      if (account.pending) card.append(node('p', 'account-pending', typeof account.pending === 'number' ?
        'Осталось загрузить ' + mailCount(account.pending) + '.' : 'В очереди есть письма.'));
      if (account.error) card.append(node('p', 'mail-feedback is-error', account.error));
      const controls = node('div', 'visitor-account-actions');
      const inbox = action('Во входящие', 'text-action', async () => {
        const current = version;
        if (!getBox(account.id)) await loadMailboxes({preserve: true});
        if (current !== version || !getBox(account.id)) return;
        el('accounts-dialog').close();
        openMailbox(account.id);
      });
      const sync = action('Синхронизировать', 'secondary account-sync', () => syncAccount(account.id));
      sync.dataset.syncId = account.id;
      sync.disabled = busy || active || syncing.size > 0;
      inbox.disabled = busy;
      controls.append(inbox, sync);
      card.append(controls);
      cards.append(card);
    }
    if (session && !loaded && !error) cards.append(node('p', 'account-caption', 'Загружаем подключённые ящики…'));
    target.replaceChildren(cards);
    if (focus) Array.from(target.querySelectorAll('[data-sync-id]')).find(b => b.dataset.syncId === focus && !b.disabled)?.focus();
    const freq = el('accounts-frequency');
    freq.hidden = !list.length || frequency <= 0;
    if (!freq.hidden) freq.textContent = 'Автообновление каждые ' + (frequency % 60 ? frequency + ' сек.' : frequency / 60 + ' мин.');
    el('accounts-load-error').hidden = !error;
    el('accounts-error-text').textContent = error;
    for (const id of ['account-provider', 'account-address', 'account-password', 'account-connect']) el(id).disabled = busy;
    const logout = el('accounts-logout');
    logout.hidden = !session;
    logout.disabled = busy;
  }
  function schedule() {
    clearTimeout(poll);
    if (available && session && !document.hidden && !busy && !refreshing && !syncing.size) {
      poll = setTimeout(load, list.some(a => a.status === 'syncing' || a.pending) ? 4000 : 30000);
    }
  }
  async function load() {
    if (!available || !session || busy || refreshing || syncing.size) return;
    const start = version;
    refreshing = true;
    try {
      const data = await request('accounts');
      if (start !== version) return;
      list = data.accounts;
      frequency = data.auto_sync_seconds;
      loaded = true; error = '';
      if (list.some(a => !getBox(a.id) || a.count !== getBox(a.id).count)) await loadMailboxes({preserve: true});
    } catch (err) {
      if (start === version) error = err.message;
    } finally {
      if (start === version) { refreshing = false; render(); schedule(); }
    }
  }
  function open() {
    if (!available || state.demo) return;
    if (!el('accounts-dialog').open) {
      el('account-add').open = !list.length;
      feedback('');
      el('accounts-dialog').showModal();
    }
    render();
    load();
  }
  function setAvailable(next) {
    if (!next) clearTimeout(expiry);
    if (available === next) return;
    available = next;
    if (!next) {
      stop();
      list = []; loaded = false; error = '';
      cleanDialog();
    }
    render();
    if (next) {
      timer();
      if (location.hash === '#accounts') open();
      else load();
    }
  }
  function pauseReads() {
    stop();
    return version;
  }
  async function connect(event) {
    event.preventDefault();
    if (!available || busy || !el('account-form').reportValidity()) return;
    const provider = el('account-form').elements.provider.value, address = el('account-address').value.trim();
    const password = el('account-password').value;
    el('account-password').value = '';
    const start = pauseReads();
    busy = true;
    render(); feedback('Подключаем ваш ящик…');
    try {
      if (!session) {
        const data = await request('session', {});
        if (start !== version) return;
        if (typeof data.token !== 'string' || !data.token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
          throw new Error('Сервер не создал сессию. Повторите подключение.');
        }
        session = {token: data.token, expires: Date.now() + data.expires_in * 1000};
        try { sessionStorage.setItem(storageKey(), JSON.stringify(session)); } catch { /* The session still works in this page. */ }
        timer();
        resetMailboxView();
      }
      const {account} = await request('accounts', {provider, address, password}, 90000);
      if (start !== version) return;
      if (!account?.id) throw new Error('Сервер не вернул подключённый ящик.');
      list = [...list.filter(a => a.id !== account.id), account];
      loaded = true; error = '';
      el('account-add').open = false;
      el('account-address').value = '';
      feedback('Ящик подключён.');
      await loadMailboxes({preserve: true});
    } catch (err) {
      if (start === version) feedback(err.message, true);
    } finally {
      if (start === version) { busy = false; render(); load(); }
    }
  }
  async function syncAccount(id) {
    if (!available || !session || busy || syncing.size) return;
    const start = pauseReads();
    syncing.add(id); render(); feedback('');
    try {
      const {account} = await request('accounts/' + encodeURIComponent(id) + '/sync', {});
      if (start !== version) return;
      if (account) list = list.map(a => a.id === id ? account : a);
      await loadMailboxes({preserve: true});
    } catch (err) {
      if (start === version) feedback(err.message, true);
    } finally {
      if (start === version) { syncing.delete(id); render(); load(); }
    }
  }
  async function logout() {
    if (!available || !session || busy) return;
    const start = pauseReads(), old = session.token;
    busy = true; render(); feedback('Завершаем сессию…');
    try {
      await request('logout', {});
      end(old, 'Доступ к вашей почте закрыт.');
    } catch (err) {
      if (start === version) feedback('Выход не подтверждён. ' + err.message + ' Попробуйте ещё раз.', true);
    } finally {
      if (start === version) { busy = false; render(); schedule(); }
    }
  }
  function init() {
    el('open').addEventListener('click', open);
    el('accounts-close').addEventListener('click', () => el('accounts-dialog').close());
    el('account-form').addEventListener('submit', connect);
    el('account-provider').addEventListener('change', providerHelp);
    el('accounts-retry').addEventListener('click', load);
    el('accounts-logout').addEventListener('click', logout);
    el('accounts-dialog').addEventListener('close', () => {
      if (el('accounts-dialog').open) return;
      el('account-password').value = '';
      if (location.hash === '#accounts') history.replaceState(history.state, '', location.pathname + location.search);
    });
    el('account-add').addEventListener('toggle', () => { if (!el('account-add').open) el('account-password').value = ''; });
    window.addEventListener('hashchange', () => {
      if (location.hash === '#accounts') open();
      else if (el('accounts-dialog').open) el('accounts-dialog').close();
    });
    window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(poll);
      else if (session && Date.now() >= session.expires) end(session.token, 'Срок сессии истёк.');
      else load();
    });
  }
  return {init, token, restore, setAvailable, end};
})();
