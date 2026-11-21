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
    ['demo-main', '21', 'Мастерская', 'Документы для регистрации', 'Для регистрации понадобятся паспорт и заполненная анкета. Анкету можно принести на первую встречу.'],
    ['demo-main', '21', 'Маяк Маркет', 'Возврат по заказу А-104', 'Возврат 1 490 ₽ принят. Деньги поступят на карту в течение трёх рабочих дней.'],
    ['demo-main', '20', 'Городская доставка', 'Заказ А-208 прибыл в пункт выдачи', 'Заказ А-208 можно забрать до 25 ноября. Пункт выдачи открыт с 10:00 до 20:00.'],
    ['demo-main', '20', 'Кофейня «Угол»', 'Электронный чек за кофе', 'Капучино и круассан. Сумма чека 550 ₽. Оплата прошла 20 ноября в 09:14.'],
    ['demo-main', '20', 'Городские сервисы', 'Оплата проездного подтверждена', 'Проездной на декабрь оплачен. На турникете покажите код из приложения.'],
    ['demo-main', '19', 'Команда Айай', 'Добро пожаловать в Айай почту', 'Откройте письмо, выберите другой ящик или попробуйте один из примеров в «Умном поиске».'],
    ['demo-main', '18', 'Мастерская', 'Вечер открытых дверей', 'В пятницу в 19:00 покажем, как устроена мастерская. Вход свободный.'],
    ['demo-work', '21', 'Рабочая группа', 'План встречи по интерфейсу', 'На встрече в 15:00 посмотрим прототип и соберём замечания по поиску.'],
    ['demo-work', '20', 'Студия', 'Отчёт за неделю', 'На этой неделе подготовили первую версию интерфейса и прототип календаря.'],
    ['demo-work', '19', 'Координатор', 'Документы для согласования', 'В папке проекта лежат смета и расписание работ. Замечания ждём до понедельника.']
  ];
  const letters = entries.map(([mailbox, day, sender, subject, snippet], index) => ({
    mailbox, id: 'example-' + (index + 1), sender, subject, snippet, date: '2026-11-' + day
  }));

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
    const visible = letters.filter(letter => letter.mailbox === mailbox && letter.date <= date);
    if (pathname === '/api/inbox') {
      const offset = Number(searchParams.get('offset'));
      const limit = Number(searchParams.get('limit'));
      return {items: visible.slice(offset, offset + limit), total: visible.length, offset};
    }
    if (pathname.startsWith('/api/mail/')) {
      const letter = visible.find(item => item.id === decodeURIComponent(pathname.slice('/api/mail/'.length)));
      if (letter) return {...letter, body: letter.snippet};
      throw Object.assign(new Error('Письмо не найдено'), {status: 404});
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
