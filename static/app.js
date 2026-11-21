'use strict';

const byId = id => document.getElementById(id);
const ui = {
  sidebar: byId('mailboxes'), mobile: byId('mobile-box-select'),
  date: byId('asof-date'), dateLabel: byId('date-readable'),
  title: byId('page-heading'), listTitle: byId('list-title'),
  list: byId('list-box'), count: byId('mail-count'), order: byId('order-label'),
  input: byId('search-input'), search: byId('search-button'), examples: byId('examples'),
  answer: byId('answer-panel'), inbox: byId('back-inbox'), actions: byId('nav-actions'),
  urgent: byId('urgent-panel'), urgentItems: byId('urgent-items'),
  paging: byId('paging'), prev: byId('prev-page'), next: byId('next-page'),
  reader: byId('reader'), readerContent: byId('reader-content'), status: byId('announce')
};
const inboxPageSize = 25;
const searchPageSize = 15;
const searchLimit = 30;
const apiConfig = document.querySelector('meta[name="mailsearch-api-origin"]');
const apiOrigin = apiConfig.hasAttribute('data-external') ? apiConfig.content : location.origin;
const state = {
  demo: !apiOrigin || new URLSearchParams(location.search).get('demo') === '1',
  actionsOnly: false, boxes: [], mailbox: '', date: '', query: '', offset: 0, total: 0,
  items: [], searchResults: [], lastAnswer: null, lastDates: new Map()
};
const requests = new Map();
const numberFormat = new Intl.NumberFormat('ru-RU');
const shortDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
});
const longDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});
const svgNs = 'http://www.w3.org/2000/svg';

function node(tag, cls, content) {
  const result = document.createElement(tag);
  if (cls) result.className = cls;
  if (content !== undefined) result.textContent = content;
  return result;
}
function icon(name) {
  const graphic = document.createElementNS(svgNs, 'svg');
  graphic.classList.add('icon');
  graphic.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svgNs, 'use');
  use.setAttribute('href', './static/icons.svg#' + name);
  graphic.append(use);
  return graphic;
}
function action(label, className, onClick) {
  const button = node('button', className, label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}
function dateText(value, long = false) {
  if (!value) return 'Без даты';
  const ts = new Date(value + 'T12:00:00Z');
  if (Number.isNaN(ts.getTime())) return 'Без даты';
  const formatted = (long ? longDate : shortDate).format(ts);
  return formatted.replace(/\s*г\.$/, '');
}
function mailCount(count) {
  const last = count % 10;
  const teens = count % 100;
  const word = teens >= 11 && teens <= 14 ? 'писем' :
    last === 1 ? 'письмо' : last >= 2 && last <= 4 ? 'письма' : 'писем';
  return numberFormat.format(count) + ' ' + word;
}
function getBox(id) {
  return state.boxes.find(box => box.id === id);
}
function announce(message) {
  ui.status.textContent = message;
}
function cancel(kind) {
  requests.get(kind)?.abort();
  requests.delete(kind);
}
function start(kind) {
  cancel(kind);
  const controller = new AbortController();
  requests.set(kind, controller);
  return controller;
}
function current(kind, controller) {
  return requests.get(kind) === controller && !controller.signal.aborted;
}
async function fetchJSON(path, controller, body) {
  if (state.demo) return demoApi(path, body);
  const options = {signal: controller.signal, cache: 'no-store'};
  if (body !== undefined) {
    options.method = 'POST';
    options.headers = {'Content-Type': 'application/json'};
    options.body = JSON.stringify(body);
  }
  const response = await fetch(new URL(path, apiOrigin), options);
  if (!response.ok) {
    const error = new Error('HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function params(values) {
  return '?' + new URLSearchParams(values).toString();
}
function spinner(message) {
  const wrap = node('div', 'list-state');
  const spin = node('span', 'spinner');
  spin.setAttribute('aria-hidden', 'true');
  wrap.append(spin, node('span', '', message));
  return wrap;
}
function messageState(title, detail, iconName, button) {
  const wrap = node('div', 'message-state');
  const glyph = node('span', 'state-glyph');
  glyph.append(icon(iconName));
  wrap.append(glyph, node('strong', '', title));
  if (detail) wrap.append(node('p', '', detail));
  if (button) wrap.append(button);
  return wrap;
}

function populateMailboxes() {
  const sidebar = document.createDocumentFragment();
  const options = document.createDocumentFragment();
  state.boxes.forEach(box => {
    const button = action('', 'box-button', () => openMailbox(box.id));
    button.dataset.id = box.id;
    button.title = box.name + ' · ' + box.id + ' · ' + mailCount(box.count);
    button.setAttribute('aria-label', box.name + ', ' + mailCount(box.count));
    button.append(icon('box'), node('span', 'box-name', box.name), node('span', 'box-count', numberFormat.format(box.count)));
    sidebar.append(button);
    const opt = node('option', '', box.name);
    opt.value = box.id;
    options.append(opt);
  });
  ui.sidebar.replaceChildren(sidebar);
  ui.mobile.replaceChildren(options);
  ui.mobile.disabled = !state.boxes.length;
  byId('box-total').textContent = numberFormat.format(state.boxes.length);
}
function setDate(value) {
  state.date = value;
  state.lastDates.set(state.mailbox, value);
  ui.date.value = value;
  ui.dateLabel.textContent = dateText(value);
  personal.contextChanged();
}
function renderExamples(box) {
  const rows = (box.examples || []).filter(row => row.query && row.date);
  ui.examples.hidden = !rows.length;
  ui.examples.replaceChildren();
  if (!rows.length) return;
  rows.forEach(row => {
    const button = action('', 'example-button', () => {
      setDate(row.date);
      ui.input.value = row.query;
      showSearch(row.query);
    });
    button.title = row.query + ' · дата запроса ' + dateText(row.date, true);
    button.setAttribute('aria-label', (row.label || row.query) + ', пример на ' + dateText(row.date, true));
    button.append(node('span', '', row.label || row.query));
    ui.examples.append(button);
  });
}
function openMailbox(id, initialDate) {
  const box = getBox(id);
  if (!box) return;
  closeReader();
  clearAnswer();
  state.mailbox = id;
  const date = initialDate || state.lastDates.get(id) || box.latest_date || state.date;
  setDate(date);
  for (const button of ui.sidebar.children) {
    if (button.dataset.id === id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
  ui.mobile.value = id;
  const context = byId('page-context');
  context.textContent = state.demo ? box.name + ' · вымышленные письма' : box.name + ' · ' + id;
  context.hidden = false;
  byId('nav-inbox').disabled = false;
  ui.actions.disabled = false;
  ui.date.disabled = false;
  ui.input.disabled = false;
  ui.search.disabled = false;
  renderExamples(box);
  showFolder(state.actionsOnly);
  window.scrollTo(0, 0);
}
async function loadMailboxes() {
  const controller = start('boxes');
  setListLoading('Открываем почтовый архив…');
  try {
    const data = await fetchJSON('/api/mailboxes', controller);
    if (!current('boxes', controller)) return;
    const sorted = [...data.mailboxes].sort((a, b) => a.id.localeCompare(b.id));
    state.boxes = sorted.map((box, index) => ({
      ...box, name: state.demo ? box.name : 'Ящик ' + String(index + 1).padStart(2, '0')
    }));
    populateMailboxes();
    if (!sorted.length) {
      ui.list.setAttribute('aria-busy', 'false');
      ui.list.replaceChildren(messageState('Ящиков пока нет', 'Корпус писем пуст.', 'archive'));
      return;
    }
    const chosen = getBox(data.default_mailbox) || state.boxes[0];
    openMailbox(chosen.id, data.default_date || chosen.latest_date);
  } catch (error) {
    if (!current('boxes', controller)) return;
    const detail = apiOrigin === location.origin
      ? 'Проверьте, что локальный сервер запущен.'
      : 'Сервер демо недоступен. Попробуйте ещё раз.';
    showListError('Не удалось открыть архив', detail, loadMailboxes);
    if (!state.demo) {
      ui.list.firstElementChild.append(action('Открыть демо', 'text-action', () => setDemoMode(true)));
    }
  }
}
function setMode() {
  const searching = Boolean(state.query);
  ui.title.textContent = searching ? 'Поиск по почте' : state.actionsOnly ? 'Требуют действия' : 'Входящие';
  ui.listTitle.textContent = searching ? 'Найденные письма' : state.actionsOnly ? 'Письма, которые требуют действия' : 'Все письма';
  const nav = byId('nav-inbox');
  if (searching || state.actionsOnly) nav.removeAttribute('aria-current');
  else nav.setAttribute('aria-current', 'page');
  if (state.actionsOnly) ui.actions.setAttribute('aria-current', 'page');
  else ui.actions.removeAttribute('aria-current');
  ui.inbox.hidden = !searching;
  ui.urgent.hidden = true;
  byId('sort-text').textContent = searching ? 'По релевантности' : 'Сначала новые';
  updateQueryNotice();
  document.title = ui.title.textContent + ' — Айай почта';
}
function updateQueryNotice() {
  const notice = byId('query-notice');
  notice.hidden = !state.query || state.query === ui.input.value.trim();
  notice.textContent = notice.hidden ? '' : 'Ниже результаты предыдущего запроса. Нажмите «Найти», чтобы обновить их.';
}
function setListLoading(message) {
  ui.paging.hidden = true;
  ui.count.hidden = true;
  ui.order.hidden = true;
  ui.list.setAttribute('aria-busy', 'true');
  ui.list.replaceChildren(spinner(message));
  announce(message);
}
function showListError(title, detail, retry) {
  ui.list.setAttribute('aria-busy', 'false');
  ui.list.replaceChildren(messageState(title, detail, 'warning', action('Попробовать снова', 'secondary', retry)));
  ui.order.hidden = true;
  ui.count.hidden = true;
  ui.paging.hidden = true;
  announce(title);
}
function showInbox() {
  showFolder(false);
}
function showFolder(actionsOnly) {
  state.actionsOnly = actionsOnly;
  ui.input.value = '';
  state.query = '';
  state.searchResults = [];
  state.total = 0;
  clearAnswer();
  setMode();
  loadFolder(0);
}
async function loadFolder(offset) {
  const controller = start('list');
  setListLoading('Загружаем письма…');
  const endpoint = state.actionsOnly ? '/api/actions' : '/api/inbox';
  try {
    const scope = {mailbox: state.mailbox, date: state.date, offset, limit: inboxPageSize};
    const marked = state.actionsOnly ? personal.markedIds(state.mailbox) : [];
    const data = marked.length
      ? await fetchJSON(endpoint, controller, {...scope, marked})
      : await fetchJSON(endpoint + params(scope), controller);
    if (!current('list', controller)) return;
    state.items = data.items;
    state.total = data.total;
    state.offset = data.offset;
    renderUrgent(data.urgent || []);
    renderList();
  } catch (error) {
    if (!current('list', controller)) return;
    ui.urgent.hidden = true;
    showListError('Не удалось загрузить письма', 'Проверьте подключение к локальной почте.', () => loadFolder(offset));
  }
}
async function showSearch(query) {
  const text = query.trim();
  if (!text) { showInbox(); return; }
  state.actionsOnly = false;
  state.query = text;
  state.offset = 0;
  state.total = 0;
  state.searchResults = [];
  setMode();
  clearAnswer();
  const controller = start('list');
  setListLoading('Ищем письма…');
  try {
    const data = await fetchJSON('/api/search', controller, {
      mailbox: state.mailbox, date: state.date, query: text, limit: searchLimit
    });
    if (!current('list', controller)) return;
    state.searchResults = data.items;
    state.total = data.items.length;
    const latency = Number(data.elapsed_ms);
    byId('sort-text').textContent = Number.isFinite(latency)
      ? 'По релевантности · ' + numberFormat.format(Math.round(latency)) + ' мс'
      : 'По релевантности';
    renderSearchPage(0);
    if (state.total) renderAnswerPrompt();
  } catch (error) {
    if (!current('list', controller)) return;
    let detail = 'Проверьте подключение к локальному поиску.';
    if (error.status === 400 || error.status === 422) detail = 'Проверьте текст запроса и выбранную дату.';
    showListError('Поиск не завершился', detail, () => showSearch(text));
  }
}
function renderSearchPage(offset) {
  state.offset = offset;
  state.items = state.searchResults.slice(offset, offset + searchPageSize);
  renderList();
}
function category(mail) {
  const subject = (mail.subject || '').toLowerCase();
  if (/возврат/.test(subject)) return ['undo', 'return'];
  if (/штраф|ошибк|сбой|отклон/.test(subject)) return ['warning', 'alert'];
  if (/чек|квитанц/.test(subject)) return ['receipt', 'receipt'];
  if (/оплат|оплачен|плат[её]ж|транзакц|операци/.test(subject)) return ['card', 'payment'];
  if (/документ|договор|отч[её]т|счет|счёт/.test(subject)) return ['file', 'file'];
  if (/автомашин|на склад|прибыт|доставк|перевоз/.test(subject)) return ['truck', 'truck'];
  if (/заказ|покупк/.test(subject)) return ['package', 'order'];
  return ['box', 'mail'];
}
function mailGlyph(mail) {
  const [symbol, theme] = category(mail);
  const glyph = node('span', 'mail-glyph cat-' + theme);
  glyph.append(icon(symbol));
  return glyph;
}
function makeMailRow(mail) {
  const row = action('', 'mail-row', () => openMail(mail.id, mail.subject));
  const lines = node('span', 'mail-lines');
  const subject = mail.subject || 'Без темы';
  const sender = mail.sender || 'Без отправителя';
  const snippet = state.actionsOnly ? mail.evidence || (mail.manual ? 'Помечено вручную' : '') : mail.snippet || '';
  lines.append(node('span', 'mail-subject', subject));
  if (snippet) lines.append(node('span', 'mail-snippet', snippet));
  const shownDate = state.actionsOnly ? mail.deadline : mail.date;
  const date = node(shownDate ? 'time' : 'span', 'row-date', state.actionsOnly ? deadlineText(mail) : dateText(shownDate));
  if (shownDate) date.dateTime = shownDate;
  date.title = state.actionsOnly ? deadlineText(mail) : dateText(shownDate, true);
  if (state.actionsOnly && shownDate) date.classList.add('row-deadline');
  if (state.actionsOnly && shownDate && shownDate < state.date) date.classList.add('past-deadline');
  row.setAttribute('aria-label', 'Открыть письмо: ' + subject + ', ' + sender + ', ' + date.title);
  const senderLabel = node('span', 'mail-sender', sender);
  senderLabel.title = sender;
  row.append(mailGlyph(mail), senderLabel, lines, date);
  return row;
}
function deadlineText(mail) {
  if (!mail.deadline) return 'Без срока';
  const date = dateText(mail.deadline);
  return 'До ' + date + (mail.deadline_time ? ', ' + mail.deadline_time : '');
}
function renderUrgent(letters) {
  ui.urgent.hidden = !letters.length;
  ui.urgentItems.replaceChildren(...letters.map(mail => {
    const button = action('', 'urgent-card', () => openMail(mail.id, mail.subject));
    button.append(node('span', 'urgent-date', deadlineText(mail)),
      node('strong', '', mail.subject || 'Без темы'),
      node('span', 'urgent-evidence', mail.evidence));
    return button;
  }));
}
function inboxRows() {
  const rows = document.createDocumentFragment();
  const previousDay = new Date(state.date + 'T12:00:00Z');
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const yesterday = Number.isNaN(previousDay.getTime()) ? '' : previousDay.toISOString().slice(0, 10);
  let group;
  for (const mail of state.items) {
    const date = mail.date || '';
    if (date !== group) {
      const label = date && date === state.date ? 'Сегодня' : date && date === yesterday ? 'Вчера' : dateText(date, true);
      rows.append(node('h3', 'mail-day', label));
      group = date;
    }
    rows.append(makeMailRow(mail));
  }
  return rows;
}
function renderList() {
  const searching = Boolean(state.query);
  ui.list.setAttribute('aria-busy', 'false');
  ui.count.textContent = searching && state.total === searchLimit ? 'первые ' + searchLimit : numberFormat.format(state.total);
  ui.count.title = searching
    ? 'Количество писем в выдаче, максимум ' + searchLimit
    : 'Письма, доступные на выбранную дату';
  ui.count.hidden = false;
  ui.order.hidden = !state.items.length;
  if (!state.items.length) {
    const reset = searching ? action('Во входящие', 'secondary', showInbox) : undefined;
    const title = searching ? 'Подходящих писем не найдено' :
      state.actionsOnly ? 'Нет писем, которые требуют действия' : 'На эту дату писем нет';
    const detail = searching ? 'Измените запрос или дату поиска.' : 'Выберите другую дату или другой ящик.';
    ui.list.replaceChildren(messageState(title, detail, searching ? 'search' : 'inbox', reset));
    ui.paging.hidden = true;
    announce(title + '.');
    return;
  }
  if (searching || state.actionsOnly) ui.list.replaceChildren(...state.items.map(makeMailRow));
  else ui.list.replaceChildren(inboxRows());
  const pageSize = searching ? searchPageSize : inboxPageSize;
  ui.paging.hidden = state.total <= pageSize;
  const stop = state.offset + state.items.length;
  byId('paging-label').textContent = numberFormat.format(state.offset + 1) + '–' +
    numberFormat.format(stop) + ' из ' + numberFormat.format(state.total);
  ui.prev.disabled = state.offset === 0;
  ui.next.disabled = stop >= state.total;
  announce((searching ? 'В выдаче ' : 'Доступно ') + mailCount(state.total) + '.');
}
function changePage(direction) {
  const pageSize = state.query ? searchPageSize : inboxPageSize;
  const offset = Math.max(0, state.offset + direction * pageSize);
  if (offset === state.offset || offset >= state.total) return;
  if (state.query) renderSearchPage(offset);
  else loadFolder(offset);
  byId('mail-section').scrollIntoView({block: 'start'});
}

function clearAnswer() {
  cancel('answer');
  state.lastAnswer = null;
  ui.answer.hidden = true;
  ui.answer.removeAttribute('aria-busy');
  ui.answer.replaceChildren();
}
function answerHeader(title, description, symbol, button) {
  const header = node('div', 'answer-header');
  const titleWrap = node('div', 'answer-title-wrap');
  const mark = node('span', 'answer-mark');
  mark.append(icon(symbol));
  const text = node('div', '');
  text.append(node('h2', 'answer-heading', title));
  if (description) text.append(node('p', 'answer-caption', description));
  titleWrap.append(mark, text);
  header.append(titleWrap);
  if (button) header.append(button);
  return header;
}
function renderAnswerPrompt() {
  ui.answer.hidden = false;
  ui.answer.setAttribute('aria-busy', 'false');
  const reveal = state.lastAnswer ? action('Развернуть', 'secondary', () => renderAnswer(state.lastAnswer))
    : action('Получить ответ', 'secondary', generateAnswer);
  ui.answer.replaceChildren(answerHeader(
    'Ответ по письмам', 'До трёх подходящих писем со ссылками на источники.', 'sparkle', reveal
  ));
}
function addCitations(container, text, sources) {
  const segments = text.split(/(\[\d+\])/g);
  for (const segment of segments) {
    const match = /^\[(\d+)\]$/.exec(segment);
    const source = match && sources[Number(match[1]) - 1];
    if (!source || !source.id) { container.append(document.createTextNode(segment)); continue; }
    const ref = action(segment, 'citation', () => openMail(source.id, source.subject));
    ref.title = source.subject || 'Письмо ' + match[1];
    ref.setAttribute('aria-label', 'Открыть источник ' + match[1] + ': ' + ref.title);
    container.append(ref);
  }
}
function renderAnswer(data) {
  state.lastAnswer = data;
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const title = data.mode === 'extractive' ? 'Выдержки из писем' :
    data.mode === 'no_evidence' ? 'Недостаточно данных для ответа' : 'Ответ по письмам';
  const reset = action('Свернуть', 'text-action', renderAnswerPrompt);
  ui.answer.replaceChildren(answerHeader(title, null, data.mode === 'extractive' ? 'quote' : 'sparkle', reset));
  const body = node('p', 'answer-prose');
  addCitations(body, data.answer || '', sources);
  ui.answer.append(body);
  if (sources.length) {
    const bar = node('div', 'sources');
    bar.append(node('span', 'sources-label', sources.length === 1 ? 'Источник' : 'Источники'));
    sources.forEach((src, index) => {
      if (!src.id) return;
      const open = action('', 'source-button', () => openMail(src.id, src.subject));
      open.title = src.subject || 'Без темы';
      open.append(node('span', 'source-number', String(index + 1)), node('span', 'source-name', open.title));
      bar.append(open);
    });
    ui.answer.append(bar);
  }
  announce(title + '.');
}
async function generateAnswer() {
  const controller = start('answer');
  const stop = action('Отменить', 'text-action', () => {
    cancel('answer');
    renderAnswerPrompt();
  });
  ui.answer.hidden = false;
  ui.answer.setAttribute('aria-busy', 'true');
  ui.answer.replaceChildren(answerHeader('Готовим ответ по письмам…', null, 'sparkle', stop));
  const mark = ui.answer.querySelector('.answer-mark');
  const spin = node('span', 'spinner');
  spin.setAttribute('aria-hidden', 'true');
  mark.replaceChildren(spin);
  announce('Готовим ответ по найденным письмам.');
  try {
    const data = await fetchJSON('/api/answer', controller, {
      mailbox: state.mailbox, date: state.date, query: state.query
    });
    if (!current('answer', controller)) return;
    ui.answer.setAttribute('aria-busy', 'false');
    renderAnswer(data);
  } catch (error) {
    if (!current('answer', controller)) return;
    ui.answer.setAttribute('aria-busy', 'false');
    ui.answer.replaceChildren(answerHeader(
      'Не удалось получить ответ', 'Найденные письма доступны ниже.', 'warning',
      action('Повторить', 'secondary', generateAnswer)
    ));
    announce('Не удалось получить ответ по письмам.');
  }
}

function closeReader() {
  cancel('mail');
  if (ui.reader.open) ui.reader.close();
}
function cleanBody(original) {
  // The subject and sender are already visible above. Strip only explicit leading mail headers.
  const lines = String(original || '').replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  while (start < lines.length && (!lines[start].trim() || /^(?:от|from|тема|subject)\s*:/iu.test(lines[start].trim()))) start++;
  if (start < lines.length) lines[start] = lines[start].replace(/^\s*(?:текст письма|тело письма)\s*:\s*/iu, '');
  return lines.slice(start).join('\n').trim() || String(original || '');
}
function renderMail(mail) {
  const badge = node('div', 'reader-mark');
  badge.append(mailGlyph(mail));
  const title = node('h2', '', mail.subject || 'Без темы');
  title.id = 'reader-heading';
  const meta = node('dl', 'message-meta');
  const fields = [
    ['От', mail.sender || 'Отправитель не указан'],
    ['Получено', mail.date ? dateText(mail.date, true) : 'Дата неизвестна']
  ];
  for (const [label, text] of fields) meta.append(node('dt', '', label), node('dd', '', text));
  const original = String(mail.body || '');
  const readable = cleanBody(original);
  const body = node('div', 'message-body', readable);
  ui.readerContent.replaceChildren(badge, title, meta, personal.mailControls(mail));
  if (original !== readable) {
    const toggle = action('Показать исходный текст', 'body-toggle', () => {
      const showOriginal = toggle.getAttribute('aria-pressed') === 'false';
      toggle.setAttribute('aria-pressed', String(showOriginal));
      toggle.textContent = showOriginal ? 'Скрыть заголовки письма' : 'Показать исходный текст';
      body.textContent = showOriginal ? original : readable;
    });
    toggle.setAttribute('aria-pressed', 'false');
    ui.readerContent.append(toggle);
  }
  ui.readerContent.append(body);
  ui.readerContent.scrollTop = 0;
}
async function openMail(id, subject) {
  const controller = start('mail');
  const title = node('h2', 'sr-only', subject || 'Письмо');
  title.id = 'reader-heading';
  ui.readerContent.replaceChildren(title, spinner('Открываем письмо…'));
  if (!ui.reader.open) ui.reader.showModal();
  ui.readerContent.setAttribute('aria-busy', 'true');
  try {
    const mail = await fetchJSON('/api/mail/' + encodeURIComponent(id) + params({
      mailbox: state.mailbox, date: state.date
    }), controller);
    if (!current('mail', controller) || !ui.reader.open) return;
    ui.readerContent.setAttribute('aria-busy', 'false');
    renderMail(mail);
  } catch (error) {
    if (!current('mail', controller) || !ui.reader.open) return;
    ui.readerContent.setAttribute('aria-busy', 'false');
    const unavailable = error.status === 404;
    const detail = unavailable ? 'Письмо недоступно в этом ящике на выбранную дату.' : 'Проверьте подключение к локальной почте.';
    ui.readerContent.replaceChildren(title, messageState('Не удалось открыть письмо', detail, 'warning',
      unavailable ? action('Закрыть', 'secondary', closeReader) : action('Попробовать снова', 'secondary', () => openMail(id, subject))));
  }
}

byId('search-form').addEventListener('submit', event => {
  event.preventDefault();
  if (ui.input.disabled) return;
  const query = ui.input.value.trim();
  if (!query && !state.query) { ui.input.focus(); return; }
  showSearch(query);
});
ui.input.addEventListener('input', () => {
  if (!ui.input.value && state.query) showInbox();
  else updateQueryNotice();
});
ui.inbox.addEventListener('click', showInbox);
byId('nav-inbox').addEventListener('click', () => {
  if (state.query || state.actionsOnly) showInbox();
  window.scrollTo(0, 0);
});
ui.actions.addEventListener('click', () => {
  if (!state.actionsOnly) showFolder(true);
  window.scrollTo(0, 0);
});
ui.mobile.addEventListener('change', () => openMailbox(ui.mobile.value));
ui.date.addEventListener('change', () => {
  if (!ui.date.value || !ui.date.validity.valid) { ui.date.value = state.date; return; }
  if (ui.date.value === state.date) return;
  setDate(ui.date.value);
  ui.urgent.hidden = true;
  closeReader();
  if (state.query) showSearch(state.query);
  else loadFolder(0);
});
byId('reader-close').addEventListener('click', closeReader);
ui.reader.addEventListener('close', () => { if (!ui.reader.open) cancel('mail'); });
ui.reader.addEventListener('click', event => {
  if (event.target !== ui.reader) return;
  const rect = ui.reader.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) closeReader();
});
ui.prev.addEventListener('click', () => changePage(-1));
ui.next.addEventListener('click', () => changePage(1));
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || ui.reader.open || ui.input.disabled) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault();
  ui.input.focus();
});
function setDemoMode(enabled) {
  closeReader();
  clearAnswer();
  cancel('list');
  state.demo = enabled;
  state.actionsOnly = false;
  state.mailbox = '';
  state.date = '';
  state.query = '';
  ui.input.value = '';
  ui.input.disabled = true;
  ui.search.disabled = true;
  ui.mobile.disabled = true;
  ui.mobile.replaceChildren(node('option', '', 'Почтовый ящик'));
  ui.date.disabled = true;
  ui.dateLabel.textContent = 'Дата запроса';
  ui.examples.hidden = true;
  ui.sidebar.replaceChildren();
  byId('box-total').textContent = '';
  byId('page-context').hidden = true;
  byId('nav-inbox').disabled = true;
  ui.actions.disabled = true;
  byId('demo-label').hidden = !enabled;
  byId('search-description').textContent = enabled
    ? 'Поиск по словам в вымышленных письмах.'
    : 'Опишите, что помните о письме, своими словами.';
  byId('leave-demo').hidden = !enabled || !apiOrigin;
  setMode();
  personal.contextChanged();
  loadMailboxes();
}
byId('leave-demo').addEventListener('click', () => setDemoMode(false));
personal.init();
setDemoMode(state.demo);
