'use strict';

// Handwritten interface examples. These messages have no connection to any mailbox or dataset.
const demoApi = (() => {
  const defaultDate = '2026-11-21';
  const boxes = [
    {
      id: 'demo-main', name: 'Основной', latest_date: defaultDate,
      examples: [
        {label: 'Заказ за вчера', query: 'Какой заказ пришёл вчера?', date: defaultDate},
        {label: 'Чек за кофе', query: 'Где чек за кофе?', date: defaultDate},
        {label: 'Документы', query: 'Документы', date: defaultDate}
      ]
    },
    {
      id: 'demo-work', name: 'Рабочий', latest_date: defaultDate,
      examples: [
        {label: 'План встречи', query: 'Найти план встречи', date: defaultDate},
        {label: 'Отчёт', query: 'Где отчёт?', date: defaultDate}
      ]
    }
  ];
  const entries = [
    ['demo-main', '21', 'Книжный клуб', 'Подборка на ноябрь', 'В ноябре читаем рассказы. Встречаемся в субботу в 16:00 в читальном зале.'],
    ['demo-main', '21', 'Мастерская', 'Документы для регистрации', 'Пожалуйста, пришлите заполненную анкету до 22 ноября 2026 в 18:00.',
      {deadline: '2026-11-22', deadline_time: '18:00'}],
    ['demo-main', '21', 'Маяк Маркет', 'Возврат по заказу А-104', 'Возврат 1 490 ₽ принят. Деньги поступят на карту в течение трёх рабочих дней.'],
    ['demo-main', '21', 'Маяк Маркет', 'Отгрузка заказа А-215', 'Отгрузите заказ А-215 до 21 ноября 2026 в 20:00.',
      {deadline: '2026-11-21', deadline_time: '20:00'}],
    ['demo-main', '20', 'Городская доставка', 'Заказ А-208 прибыл в пункт выдачи', 'Заказ А-208 можно забрать до 25 ноября. Пункт выдачи открыт с 10:00 до 20:00.'],
    ['demo-main', '20', 'Кофейня «Угол»', 'Электронный чек за кофе', 'Капучино и круассан. Сумма чека 550 ₽. Оплата прошла 20 ноября в 09:14.'],
    ['demo-main', '20', 'Городские сервисы', 'Оплата проездного подтверждена', 'Проездной на декабрь оплачен. На турникете покажите код из приложения.'],
    ['demo-main', '19', 'Команда Айай', 'Добро пожаловать в Айай почту', 'Нажмите «?» рядом с поиском, чтобы попробовать один из примеров.'],
    ['demo-main', '18', 'Мастерская', 'Вечер открытых дверей', 'В пятницу в 19:00 покажем, как устроена мастерская. Вход свободный.'],
    ['demo-work', '21', 'Рабочая группа', 'План встречи по интерфейсу', 'На встрече в 15:00 посмотрим прототип и соберём замечания по поиску.'],
    ['demo-work', '20', 'Студия', 'Отчёт за неделю', 'На этой неделе подготовили первую версию интерфейса и прототип календаря.'],
    ['demo-work', '19', 'Координатор', 'Документы для согласования', 'Пожалуйста, проверьте смету и пришлите замечания.',
      {deadline: null, deadline_time: null}],
    ['demo-main', '20', 'Лекторий «Среда»', 'Приглашение на лекцию о космосе',
      'Приглашаем вас на лекцию о космосе 26 ноября 2026 в 19:00.',
      null, {event_date: '2026-11-26', event_time: '19:00'}],
    ['demo-main', '22', 'Оргкомитет', 'Приглашение на ЕГЭ',
      'Приглашение на ЕГЭ доступно в личном кабинете.']
  ];
  const letters = entries.map(([mailbox, day, sender, subject, snippet, task, event], index) => ({
    mailbox, id: 'example-' + (index + 1), sender, subject, snippet, date: '2026-11-' + day, task, event
  })).sort((a, b) => b.date.localeCompare(a.date));

  function search(visible, query, date) {
    const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const words = terms.filter(word => !['за', 'вчера', 'сегодня', 'позавчера'].includes(word) && word.length > 2);
    const daysBack = terms.includes('позавчера') ? 2 : terms.includes('вчера') ? 1 : 0;
    const restricted = daysBack > 0 || terms.includes('сегодня');
    const day = new Date(Date.parse(date) - daysBack * 86400000).toISOString().slice(0, 10);
    return visible
      .filter(letter => !restricted || letter.date === day)
      .map(letter => {
        const subject = letter.subject.toLowerCase();
        const body = (letter.sender + ' ' + letter.snippet).toLowerCase();
        const score = words.reduce((sum, word) => sum + (subject.includes(word) ? 2 : Number(body.includes(word))), 0);
        return {letter, score};
      })
      .filter(({score}) => score || (restricted && !words.length))
      .sort((a, b) => b.score - a.score)
      .map(({letter}) => letter);
  }

  return function request(path, body) {
    const {pathname, searchParams} = new URL(path, location.origin);
    if (pathname === '/api/mailboxes') {
      return {
        mailboxes: boxes.map(box => ({...box, count: letters.filter(letter => letter.mailbox === box.id).length})),
        default_mailbox: boxes[0].id,
        default_date: defaultDate
      };
    }
    const mailbox = body?.mailbox ?? searchParams.get('mailbox');
    const date = body?.date ?? searchParams.get('date');
    const from = body?.date_from ?? searchParams.get('date_from');
    const to = body?.date_to ?? searchParams.get('date_to') ?? date;
    const visible = letters.filter(letter => letter.mailbox === mailbox && (!from || letter.date >= from) && letter.date <= to);
    if (pathname === '/api/reminder-candidates') {
      return {items: visible.filter(letter => letter.task).map(({id, subject}) => ({id, subject}))};
    }
    if (pathname === '/api/inbox' || pathname === '/api/actions') {
      const offset = body?.offset ?? Number(searchParams.get('offset'));
      const limit = body?.limit ?? Number(searchParams.get('limit'));
      const marked = new Set(body?.marked || []);
      const actionsOnly = pathname === '/api/actions';
      const items = actionsOnly
        ? visible.filter(letter => letter.task || marked.has(letter.id)).map(({task, ...letter}) => ({
          ...letter, deadline: null, deadline_time: null, ...task,
          evidence: task ? letter.snippet : null, manual: marked.has(letter.id)
        }))
        : visible;
      const result = {items: items.slice(offset, offset + limit), total: items.length, offset, limit};
      if (actionsOnly) {
        const tomorrow = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
        result.urgent = items.filter(item => item.deadline && item.deadline >= date && item.deadline <= tomorrow)
          .sort((a, b) => a.deadline.localeCompare(b.deadline) || (a.deadline_time || '23:59').localeCompare(b.deadline_time || '23:59'))
          .slice(0, 3);
      }
      return result;
    }
    if (pathname.startsWith('/api/mail/')) {
      const letter = visible.find(item => item.id === decodeURIComponent(pathname.slice('/api/mail/'.length)));
      if (letter) return {...letter, body: letter.snippet, requires_action: Boolean(letter.task)};
      throw Object.assign(new Error('Письмо не найдено'), {status: 404});
    }
    if (pathname === '/api/assistant/watch') {
      const ignored = new Set(body.seen || []);
      const stop = new Set('найди когда как только придет поступит появится отследи подпишись сообщи уведоми напомни письмо письма меня мне'.split(' '));
      const terms = (body.query.toLowerCase().replaceAll('ё', 'е').match(/[а-яa-z0-9]+/g) || [])
        .filter(word => word.length >= 3 && !stop.has(word)).map(word => word.slice(0, 6));
      const found = terms.length ? visible.filter(letter => {
        const text = (letter.subject + ' ' + letter.snippet).toLowerCase().replaceAll('ё', 'е');
        return letter.date >= body.after && !ignored.has(letter.id) && terms.every(term => text.includes(term));
      }) : [];
      return {items: found.slice(0, 5), matched_ids: found.map(letter => letter.id)};
    }
    if (pathname === '/api/assistant') {
      if (/когда\s+(?:прид[её]т|поступит|появится)|как только|отследи|подпишись|(?:сообщи|уведоми)\s+о\s+новом/i.test(body.query)) {
        return {kind: 'watch', items: []};
      }
      if (/мероприят|куда.{0,50}приглас|ближайш.{0,30}событи/i.test(body.query)) {
        const end = new Date(Date.parse(date) + 30 * 86400000).toISOString().slice(0, 10);
        return {kind: 'events', items: visible.filter(letter => letter.event &&
          letter.event.event_date >= date && letter.event.event_date <= end)
          .map(({event, ...letter}) => ({...letter, ...event, evidence: letter.snippet}))};
      }
      return {kind: 'mail', items: search(visible, body.query, date).slice(0, 6)};
    }
    const items = search(visible, body.query, date);
    if (pathname === '/api/search') return {items: items.slice(0, body.limit)};
    const sources = items.slice(0, 3);
    return {
      sources,
      mode: sources.length ? 'extractive' : 'no_evidence',
      answer: sources.length
        ? sources.map((letter, index) => letter.snippet + ' [' + (index + 1) + ']').join('\n\n')
        : 'В выбранном ящике нет писем с подходящими сведениями.'
    };
  };
})();
