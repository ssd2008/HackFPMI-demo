'use strict';

const personal = (() => {
  const assistantId = 'assistant-panel';
  let lastWatchPoll = 0;
  let checking = false;

  function storageKey() {
    return 'ayai-mail:personal:' + (state.demo ? 'demo' : apiOrigin);
  }

  function read() {
    try {
      return JSON.parse(localStorage.getItem(storageKey())) || {marks: {}, reminders: {}, watches: []};
    } catch {
      return {marks: {}, reminders: {}, watches: []};
    }
  }

  function save(data) {
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
    if (box !== state.mailbox || cutoff > state.date) openMailbox(box, cutoff);
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
          showFolder(true);
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
      if (state.actionsOnly) loadFolder(0);
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

  function toggleAssistant(open) {
    byId(assistantId).hidden = !open;
    byId('assistant-open').setAttribute('aria-expanded', String(open));
    if (open) {
      renderWatches();
      byId('assistant-query').focus();
    } else {
      byId('assistant-open').focus();
    }
  }

  function renderWatches() {
    const watches = read().watches;
    byId('watch-panel').hidden = !watches.length;
    byId('watch-items').replaceChildren(...watches.map(watch => {
      const row = node('div', 'watch-item');
      const text = node('div');
      text.append(node('strong', '', watch.query), node('p', '', (getBox(watch.mailbox)?.name || 'Ящик') +
        (watch.match ? ' · письмо найдено' : ' · ждём письмо')));
      const remove = action(watch.match ? 'Убрать' : 'Отменить', 'text-action', () => {
        const data = read();
        data.watches = data.watches.filter(item => item.id !== watch.id);
        if (save(data)) renderWatches();
      });
      row.append(text);
      if (watch.match) row.append(action('Открыть', 'text-action', () => gotoSource(watch.mailbox, watch.match.date, watch.match)));
      row.append(remove);
      return row;
    }));
  }

  async function ask() {
    const query = byId('assistant-query').value.trim();
    if (!query || !state.mailbox || !state.date) return;
    const results = byId('assistant-results');
    const context = {mailbox: state.mailbox, date: state.date, query};
    const controller = start('assistant');
    results.replaceChildren(spinner('Проверяем письма…'));
    try {
      const reply = await fetchJSON('/api/assistant', controller, context);
      if (!current('assistant', controller)) return;
      if (reply.kind === 'watch') {
        const baseline = await fetchJSON('/api/assistant/watch', controller, {...context, after: context.date});
        if (!current('assistant', controller)) return;
        const data = read();
        if (!data.watches.some(watch => !watch.match && watch.mailbox === context.mailbox && watch.query === query)) {
          data.watches.push({id: crypto.randomUUID(), ...context,
            latest: getBox(context.mailbox)?.latest_date, seen: baseline.matched_ids});
          if (!save(data)) {
            results.replaceChildren(node('p', '', 'Не удалось сохранить отслеживание.'));
            return;
          }
        }
        results.replaceChildren(node('p', '', 'Слежу за новыми письмами по этому запросу.'));
        renderWatches();
        return;
      }
      const title = reply.message || (reply.items.length
        ? (reply.kind === 'events' ? 'Приглашения на ближайшие 30 дней' : 'Подходящие письма')
        : (reply.kind === 'events' ? 'Приглашений с датой на ближайшие 30 дней нет.' : 'Подходящие письма не найдены.'));
      results.replaceChildren(node('p', 'assistant-reply', title), ...reply.items.map(mail => {
        const card = action('', 'assistant-source', () => gotoSource(context.mailbox, context.date, mail));
        card.append(node('strong', '', mail.subject || 'Без темы'));
        if (mail.event_date) card.append(node('span', 'urgent-date', dateText(mail.event_date) + (mail.event_time ? ', ' + mail.event_time : '')));
        card.append(node('span', '', mail.evidence || mail.snippet || 'Открыть письмо'));
        return card;
      }));
    } catch {
      if (current('assistant', controller)) results.replaceChildren(node('p', '', 'Не удалось проверить письма. Попробуйте ещё раз.'));
    }
  }

  async function pollWatches(force = false) {
    if (checking || !state.date || (!force && Date.now() - lastWatchPoll < 60000)) return;
    const pending = read().watches.filter(watch => !watch.match);
    if (!pending.length) return;
    checking = true;
    lastWatchPoll = Date.now();
    const storage = storageKey();
    const controller = start('assistant-watch');
    try {
      const {mailboxes} = await fetchJSON('/api/mailboxes', controller);
      for (const watch of pending) {
        if (!current('assistant-watch', controller) || storage !== storageKey()) return;
        const snapshot = state.lastDates.get(watch.mailbox) || watch.date;
        const box = mailboxes.find(box => box.id === watch.mailbox);
        if (!box) continue;
        const latest = box.latest_date;
        const cutoff = latest && latest > (watch.latest || watch.date) && latest > snapshot ? latest : snapshot;
        if (cutoff < watch.date) continue;
        const result = await fetchJSON('/api/assistant/watch', controller, {
          mailbox: watch.mailbox, date: cutoff, after: watch.date, seen: watch.seen, query: watch.query
        });
        if (!current('assistant-watch', controller) || storage !== storageKey()) return;
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
    cancel('assistant');
    cancel('reminder-candidates');
    const open = byId('assistant-open');
    open.disabled = !state.mailbox;
    byId('assistant-box').textContent = getBox(state.mailbox)?.name || '';
    byId('assistant-results').replaceChildren();
    renderWatches();
    if (!state.mailbox) {
      byId(assistantId).hidden = true;
      open.setAttribute('aria-expanded', 'false');
      byId('notifications').replaceChildren();
      cancel('assistant-watch');
      return;
    }
    syncCandidates();
    deliverReminders();
    pollWatches(true);
  }

  function init() {
    byId('assistant-open').addEventListener('click', () => toggleAssistant(byId(assistantId).hidden));
    byId('assistant-close').addEventListener('click', () => toggleAssistant(false));
    byId(assistantId).addEventListener('keydown', event => { if (event.key === 'Escape') toggleAssistant(false); });
    byId('assistant-form').addEventListener('submit', event => { event.preventDefault(); ask(); });
    for (const example of byId(assistantId).querySelectorAll('.assistant-examples button')) {
      example.addEventListener('click', () => { byId('assistant-query').value = example.textContent; ask(); });
    }
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

  return {init, markedIds, contextChanged, mailControls};
})();
