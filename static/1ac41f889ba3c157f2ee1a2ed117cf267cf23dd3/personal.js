'use strict';

const personal = (() => {
  let lastWatchPoll = 0;
  let checking = false;
  const blank = () => ({marks: {}, reminders: {}, watches: []});
  let privateData = blank();

  function privateContext() {
    return Boolean(visitorMail.token()) || getBox(state.mailbox)?.kind === 'live';
  }

  function storageKey() {
    return 'ayai-mail:personal:' + (state.demo ? 'demo' : apiOrigin);
  }

  function read() {
    if (privateContext()) return privateData;
    try {
      return JSON.parse(localStorage.getItem(storageKey())) || blank();
    } catch {
      return blank();
    }
  }

  function save(data) {
    if (privateContext()) { privateData = data; return true; }
    try {
      localStorage.setItem(storageKey(), JSON.stringify(data));
      return true;
    } catch {
      announce('Не удалось сохранить настройки в этом браузере.');
      return false;
    }
  }

  function key(box, id) { return JSON.stringify([box, id]); }
  function markedIds(box) {
    return Object.values(read().marks).filter(mark => mark.box === box).map(mark => mark.id);
  }

  function defaultTimes(now = new Date()) {
    const evening = new Date(now);
    evening.setHours(19, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    return evening > now ? [+evening, +tomorrow] : [+tomorrow];
  }

  function schedule(data, box, cutoff, mail) {
    const id = key(box, mail.id);
    if (data.reminders[id]) return false;
    data.reminders[id] = {box, date: cutoff, id: mail.id, subject: mail.subject, times: defaultTimes(), type: 'auto'};
    return true;
  }

  function localDateTime(time) {
    const value = new Date(time);
    return new Date(time - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function timeText(time) {
    return new Intl.DateTimeFormat('ru-RU', {dateStyle: 'short', timeStyle: 'short'}).format(time);
  }

  function toast(title, detail, open) {
    const card = node('div', 'notification');
    const text = node('div', 'notification-text');
    text.setAttribute('role', 'status');
    text.append(node('strong', '', title), node('p', '', detail));
    const dismiss = action('', 'notification-close icon-button', () => card.remove());
    dismiss.setAttribute('aria-label', 'Закрыть уведомление');
    dismiss.append(icon('close'));
    card.append(icon('bell'), text, dismiss);
    if (open) card.append(action('Открыть', 'text-action notification-open', () => { card.remove(); open(); }));
    byId('notifications').prepend(card);
  }

  function gotoSource(box, cutoff, mail) {
    if (box !== state.mailbox || cutoff > state.date) {
      if (state.dateRanges.get(box)?.date_to < cutoff) state.dateRanges.delete(box);
      openMailbox(box, cutoff);
    }
    openMail(mail.id, mail.subject);
  }

  function deliverReminders() {
    const data = read();
    const due = new Map();
    const now = Date.now();
    for (const reminder of Object.values(data.reminders)) {
      if (!reminder.times.some(time => time <= now)) continue;
      reminder.times = reminder.times.filter(time => time > now);
      if (!due.has(reminder.box)) due.set(reminder.box, []);
      due.get(reminder.box).push(reminder);
    }
    if (!due.size || !save(data)) return;
    for (const [box, letters] of due) {
      const first = letters[0];
      if (letters.length === 1) {
        toast('Письмо требует действия', first.subject || 'Без темы', () => gotoSource(box, first.date, first));
      } else {
        const cutoff = letters.reduce((latest, letter) => letter.date > latest ? letter.date : latest, first.date);
        toast('Письма требуют действия', (getBox(box)?.name || 'Почтовый ящик') + ' · ' + mailCount(letters.length), () => {
          if (state.mailbox !== box || state.date < cutoff) openMailbox(box, cutoff);
          showFolder('actions');
        });
      }
    }
  }

  async function syncCandidates() {
    if (!state.mailbox || !state.date) return;
    const box = state.mailbox;
    const cutoff = state.date;
    const controller = start('reminder-candidates');
    try {
      const result = await fetchJSON('/api/reminder-candidates' + params({mailbox: box, date: cutoff}), controller);
      if (!current('reminder-candidates', controller)) return;
      const data = read();
      let changed = false;
      for (const mail of result.items) {
        if (schedule(data, box, cutoff, mail)) changed = true;
      }
      if (changed) save(data);
    } catch {
      // Existing reminders remain available during network interruptions.
    }
  }

  function mailControls(mail) {
    const box = state.mailbox;
    const cutoff = state.date;
    const id = key(box, mail.id);
    const group = node('div', 'mail-controls');
    const mark = action('', 'secondary mark-action', () => {
      const data = read();
      if (data.marks[id]) {
        delete data.marks[id];
        if (!mail.requires_action) delete data.reminders[id];
      } else {
        data.marks[id] = {box, id: mail.id};
        schedule(data, box, cutoff, mail);
      }
      if (!save(data)) return;
      update();
      if (state.folder === 'actions') loadFolder(0);
    });
    const label = node('span', '');
    mark.append(icon('priority'), label);
    const remind = action('Напомнить', 'secondary', () => { form.hidden = !form.hidden; if (!form.hidden) input.focus(); });
    const form = node('form', 'reminder-form');
    form.hidden = true;
    const inputLabel = node('label', '', 'Дата и время напоминания');
    const input = node('input');
    input.type = 'datetime-local';
    input.required = true;
    inputLabel.append(input);
    const submit = node('button', 'primary', 'Сохранить');
    const disable = action('Отключить', 'text-action', () => {
      const data = read();
      data.reminders[id] = {box, date: cutoff, id: mail.id, subject: mail.subject, times: [], type: 'off'};
      if (save(data)) { form.hidden = true; update(); }
    });
    form.append(inputLabel, submit, disable);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const when = +new Date(input.value);
      if (!(when > Date.now())) {
        input.setCustomValidity('Выберите время в будущем.');
        input.reportValidity();
        return;
      }
      const data = read();
      data.reminders[id] = {box, date: cutoff, id: mail.id, subject: mail.subject, times: [when], type: 'custom'};
      if (save(data)) { form.hidden = true; update(); }
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    const status = node('span', 'reminder-status');
    group.append(mark, remind, status, form);
    function update() {
      const data = read();
      const marked = Boolean(data.marks[id]);
      label.textContent = marked ? 'Требует действия' : 'Пометить для действия';
      mark.setAttribute('aria-pressed', String(marked));
      remind.hidden = !marked && !mail.requires_action;
      if (remind.hidden) form.hidden = true;
      const reminder = data.reminders[id];
      const next = reminder?.times[0];
      status.textContent = next ? (reminder.type === 'auto' ? 'Автонапоминание ' : 'Напоминание ') + timeText(next)
        : reminder?.type === 'off' ? 'Напоминания отключены' : '';
      input.min = localDateTime(Date.now());
      input.value = localDateTime(next && next > Date.now() ? next : defaultTimes()[0]);
    }

    if (mail.requires_action) {
      const data = read();
      if (schedule(data, box, cutoff, mail)) save(data);
    }
    update();
    return group;
  }

  function watchStatus(message, error = false) {
    const status = byId('watch-status');
    status.hidden = !message;
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }

  function renderWatches() {
    const list = byId('watch-items');
    const watches = read().watches;
    if (!watches.length) {
      list.replaceChildren(messageState('Вы пока не отслеживаете письма', '', 'clock'));
      return;
    }
    list.replaceChildren(...watches.slice().reverse().map(watch => {
      const row = node('article', 'watch-item');
      const marker = node('span', 'watch-marker');
      marker.append(icon(watch.match ? 'checklist' : 'clock'));
      const text = node('div', 'watch-item-text');
      const label = node('span', 'watch-state', watch.match ? 'Письмо найдено' : 'Ждём письмо');
      if (watch.match) label.classList.add('is-found');
      text.append(node('h3', '', watch.query),
        node('p', '', getBox(watch.mailbox)?.name || 'Почтовый ящик'), label);
      const controls = node('div', 'watch-item-actions');
      if (watch.match) {
        controls.append(action('Открыть письмо', 'secondary', () => gotoSource(watch.mailbox, watch.match.date, watch.match)));
      }
      const remove = action(watch.match ? 'Убрать' : 'Отменить', 'text-action', () => {
        const data = read();
        data.watches = data.watches.filter(item => item.id !== watch.id);
        if (!save(data)) return;
        renderWatches();
        byId('watch-query').focus();
        watchStatus(watch.match ? 'Письмо убрано из списка.' : 'Отслеживание отменено.');
      });
      controls.append(remove);
      row.append(marker, text, controls);
      return row;
    }));
  }

  async function createWatch() {
    const input = byId('watch-query');
    const submit = byId('watch-submit');
    const query = input.value.trim();
    if (!query || !state.mailbox || !state.date || submit.disabled) return;
    const box = getBox(state.mailbox);
    const date = box?.kind === 'live' ? new Date().toLocaleDateString('sv-SE')
      : box?.latest_date > state.date ? box.latest_date : state.date;
    const context = {mailbox: state.mailbox, date, query};
    const controller = start('watch-create');
    submit.disabled = true;
    watchStatus('Сохраняем ожидание…');
    try {
      const baseline = await fetchJSON('/api/assistant/watch', controller, {...context, after: date});
      if (!current('watch-create', controller)) return;
      if (baseline.query_valid === false) {
        watchStatus('Добавьте тему письма, имя отправителя или другое ключевое слово.', true);
        return;
      }
      const data = read();
      if (data.watches.some(watch => !watch.match && watch.mailbox === context.mailbox &&
          watch.query.toLowerCase() === query.toLowerCase())) {
        watchStatus('Такое ожидание уже есть.');
        return;
      }
      data.watches.push({id: crypto.randomUUID(), ...context, seen: baseline.matched_ids});
      if (!save(data)) {
        watchStatus('Не удалось сохранить ожидание.', true);
        return;
      }
      if (input.value.trim() === query) input.value = '';
      watchStatus('Теперь ждём это письмо.');
      renderWatches();
    } catch {
      if (current('watch-create', controller)) watchStatus('Не удалось сохранить ожидание. Попробуйте ещё раз.', true);
    } finally {
      if (current('watch-create', controller)) submit.disabled = false;
    }
  }

  async function pollWatches(force = false) {
    if (checking || !state.date || (!force && Date.now() - lastWatchPoll < 60000)) return;
    const pending = read().watches.filter(watch => !watch.match);
    if (!pending.length) return;
    checking = true;
    lastWatchPoll = Date.now();
    const storage = storageKey();
    const visitor = visitorMail.token();
    const controller = start('watch-poll');
    const sameContext = () => current('watch-poll', controller) && storage === storageKey() && visitor === visitorMail.token();
    try {
      const {mailboxes} = await fetchJSON('/api/mailboxes', controller);
      for (const watch of pending) {
        if (!sameContext()) return;
        const box = mailboxes.find(box => box.id === watch.mailbox);
        if (!box) continue;
        const cutoff = [watch.date, box.latest_date, state.lastDates.get(watch.mailbox),
          state.mailbox === watch.mailbox && state.date].filter(Boolean).sort().at(-1);
        let result;
        try {
          result = await fetchJSON('/api/assistant/watch', controller, {
            mailbox: watch.mailbox, date: cutoff, after: watch.date, seen: watch.seen, query: watch.query
          });
        } catch {
          continue;
        }
        if (!sameContext()) return;
        if (!result.items.length) continue;
        const data = read();
        const active = data.watches.find(item => item.id === watch.id);
        if (!active || active.match) continue;
        active.match = result.items[0];
        if (save(data)) {
          toast('Письмо найдено', active.match.subject, () => gotoSource(active.mailbox, active.match.date, active.match));
          renderWatches();
        }
      }
    } catch {
      // A watch remains active and is retried when the mailbox is available.
    } finally { checking = false; }
  }

  function contextChanged() {
    cancel('watch-create');
    cancel('reminder-candidates');
    byId('watch-submit').disabled = !state.mailbox;
    watchStatus('');
    renderWatches();
    if (!state.mailbox) {
      byId('notifications').replaceChildren();
      cancel('watch-poll');
      return;
    }
    syncCandidates();
    deliverReminders();
    pollWatches(true);
  }

  function resetPrivate() {
    privateData = blank();
    lastWatchPoll = 0;
    byId('watch-query').value = '';
    watchStatus('');
    byId('watch-items').replaceChildren();
    byId('notifications').replaceChildren();
  }

  function init() {
    byId('watch-form').addEventListener('submit', event => { event.preventDefault(); createWatch(); });
    byId('watch-query').addEventListener('input', () => watchStatus(''));
    window.addEventListener('storage', event => {
      if (!privateContext() && event.key === storageKey()) renderWatches();
    });
    const tick = () => {
      if (!state.mailbox || document.hidden) return;
      if (navigator.locks) navigator.locks.request(storageKey() + ':notify', deliverReminders).catch(() => {});
      else deliverReminders();
      pollWatches();
    };
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    setInterval(tick, 5000);
  }

  return {init, markedIds, contextChanged, resetPrivate, mailControls, renderWatches, toast};
})();
