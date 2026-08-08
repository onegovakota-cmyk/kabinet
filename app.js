(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const cfg = window.APP_CONFIG || {};
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const currentMonthISO = () => todayISO().slice(0, 7);
  const money = (v) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(Number(v || 0));
  const num = (v) => Number(v || 0);
  const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const prettyDate = (iso) => iso ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso + 'T12:00:00')) : '—';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const daysInMonth = (ym) => { const [y,m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const monthBounds = (ym) => { const [y,m] = ym.split('-').map(Number); const start = `${ym}-01`; const end = `${ym}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`; return {start,end}; };
  const isInMonth = (date, ym) => date && date.slice(0,7) === ym;

  let sb = null;
  let user = null;
  let authMode = 'login';
  let activeTab = 'dashboard';
  let state = {
    settings: { monthly_income_target: 110000, yearly_book_goal: 24, daily_reading_goal_minutes: 20, sleep_goal_hours: 8 },
    debts: [], fixed: [], incomes: [], expenses: [], payments: [], habits: [], habitLogs: [], tasks: [],
    books: [], readingLogs: [], media: [], moods: [], sleep: []
  };

  const moodMeta = {
    1: { emoji: '😣', label: 'Очень плохо' },
    2: { emoji: '😕', label: 'Плохо' },
    3: { emoji: '😐', label: 'Нормально' },
    4: { emoji: '🙂', label: 'Хорошо' },
    5: { emoji: '🤩', label: 'Отлично' }
  };
  const bookStatusLabels = { reading:'Читаю', wishlist:'Хочу прочитать', finished:'Прочитано', paused:'Отложено' };
  const mediaStatusLabels = { wishlist:'Хочу посмотреть', watching:'Смотрю', watched:'Просмотрено', dropped:'Брошено' };
  const mediaTypeLabels = { movie:'Фильм', series:'Сериал' };

  let readingTimer = { running:false, startedAt:null, accumulated:0, bookId:null, tick:null };

  const tabMeta = {
    dashboard: ['Главная', 'Ваш финансовый обзор на сегодня'],
    debts: ['Долги', 'Текущие остатки, цели и платежи'],
    incomes: ['Доходы', 'Добавляйте поступления и распределяйте их по плану'],
    expenses: ['Расходы', 'Фактические траты и постоянные расходы'],
    habits: ['Привычки', 'Трекер на каждый день месяца'],
    tasks: ['Задачи', 'Работа, репетиторство и домашние дела'],
    books: ['Книги', 'Библиотека, прогресс, дневник и статистика чтения'],
    media: ['Фильмы и сериалы', 'Хочу посмотреть, смотрю и уже посмотрела'],
    mood: ['Настроение', 'Как менялось ваше настроение по дням'],
    sleep: ['Сон', 'Длительность и качество сна по дням'],
    settings: ['Настройки', 'Параметры вашего личного кабинета']
  };

  function toast(message, kind = 'ok') {
    const el = $('#toast');
    el.textContent = message;
    el.style.background = kind === 'error' ? '#b53f4c' : '#212632';
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function setSync(text = 'Синхронизировано', busy = false) {
    const el = $('#syncState');
    el.textContent = `${busy ? '○' : '●'} ${text}`;
    el.style.color = busy ? '#b7791f' : '#1f9d6a';
    el.style.background = busy ? '#fff7e6' : '#eaf8f2';
  }

  function showApp(show) {
    $('#authView').classList.toggle('hidden', show);
    $('#appView').classList.toggle('hidden', !show);
  }

  function switchTab(tab) {
    activeTab = tab;
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    $$('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const [title, subtitle] = tabMeta[tab] || tabMeta.dashboard;
    $('#pageTitle').textContent = title;
    $('#pageSubtitle').textContent = subtitle;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'habits') renderHabits();
    if (tab === 'tasks') renderTasks();
    if (tab === 'books') renderBooks();
    if (tab === 'media') renderMedia();
    if (tab === 'mood') renderMood();
    if (tab === 'sleep') renderSleep();
  }

  function monthsRemaining(targetDate) {
    if (!targetDate) return null;
    const now = new Date(todayISO() + 'T12:00:00');
    const target = new Date(targetDate + 'T12:00:00');
    const days = (target - now) / 86400000;
    return Math.max(1, Math.ceil(days / 30.4375));
  }

  function targetPayment(debt) {
    const balance = num(debt.current_balance);
    if (balance <= 0) return 0;
    const min = num(debt.min_payment);
    const n = monthsRemaining(debt.target_date);
    if (!n) return min;
    const apr = num(debt.apr);
    let goal;
    if (apr > 0) {
      const r = apr / 100 / 12;
      goal = balance * r / (1 - Math.pow(1 + r, -n));
    } else {
      goal = balance / n;
    }
    return Math.max(min, goal);
  }

  function buildPlan() {
    const monthlyIncome = num(state.settings.monthly_income_target || 110000);
    const fixedTotal = state.fixed.reduce((s,x) => s + num(x.monthly_amount), 0);
    const activeDebts = state.debts.filter(d => d.active && num(d.current_balance) > 0);

    const planByDebt = new Map();
    let used = fixedTotal;
    activeDebts.forEach(d => {
      const base = Math.min(num(d.min_payment), num(d.current_balance));
      planByDebt.set(d.id, base);
      used += base;
    });

    let remaining = Math.max(0, monthlyIncome - used);
    [...activeDebts].sort((a,b) => num(a.priority) - num(b.priority)).forEach(d => {
      const current = planByDebt.get(d.id) || 0;
      const goal = Math.min(targetPayment(d), num(d.current_balance));
      const gap = Math.max(0, goal - current);
      const add = Math.min(gap, remaining);
      planByDebt.set(d.id, current + add);
      remaining -= add;
    });

    if (remaining > 0) {
      const top = [...activeDebts].sort((a,b) => num(a.priority) - num(b.priority))[0];
      if (top) planByDebt.set(top.id, (planByDebt.get(top.id) || 0) + remaining);
    }

    const desiredDebt = activeDebts.reduce((s,d) => s + Math.min(targetPayment(d), num(d.current_balance)), 0);
    const desiredTotal = fixedTotal + desiredDebt;
    const gap = Math.max(0, desiredTotal - monthlyIncome);
    const shortMinimum = Math.max(0, fixedTotal + activeDebts.reduce((s,d)=>s+num(d.min_payment),0) - monthlyIncome);

    const items = [];
    if (fixedTotal > 0) items.push({ key:'fixed', label:'Постоянные расходы', amount: Math.min(fixedTotal, monthlyIncome), pct: monthlyIncome ? Math.min(fixedTotal, monthlyIncome) / monthlyIncome * 100 : 0 });
    activeDebts.forEach(d => {
      const amount = planByDebt.get(d.id) || 0;
      items.push({ key:d.id, label:d.name, amount, pct: monthlyIncome ? amount / monthlyIncome * 100 : 0, debt:d });
    });

    return { monthlyIncome, fixedTotal, items, desiredTotal, gap, shortMinimum, planByDebt };
  }

  async function ensureDefaults() {
    const uid = user.id;
    await sb.from('pf_settings').upsert({ user_id: uid, monthly_income_target: 110000 }, { onConflict: 'user_id', ignoreDuplicates: true });

    const debts = [
      { user_id: uid, name: 'Автокредит', debt_type: 'car', initial_balance: 1153814, current_balance: 1153814, apr: 21.9, min_payment: 60479, target_date: '2027-08-08', priority: 2 },
      { user_id: uid, name: 'Кредитная карта', debt_type: 'credit_card', initial_balance: 104086, current_balance: 104086, apr: 0, min_payment: 0, target_date: '2027-02-08', priority: 1 },
      { user_id: uid, name: 'Кредит на учёбу', debt_type: 'education', initial_balance: 29328, current_balance: 29328, apr: 0, min_payment: 3289, target_date: null, priority: 3 }
    ];
    await sb.from('pf_debts').upsert(debts, { onConflict: 'user_id,name', ignoreDuplicates: true });

    const fixed = [
      { user_id: uid, name: 'Уход', monthly_amount: 5000 },
      { user_id: uid, name: 'Телефон', monthly_amount: 2000 },
      { user_id: uid, name: 'Подписки', monthly_amount: 2000 }
    ];
    await sb.from('pf_fixed_expenses').upsert(fixed, { onConflict: 'user_id,name', ignoreDuplicates: true });
  }

  async function loadAll({silent=false} = {}) {
    if (!user) return;
    if (!silent) setSync('Обновление…', true);
    const uid = user.id;
    const [settings, debts, fixed, incomes, expenses, payments, habits, habitLogs, tasks, books, readingLogs, media, moods, sleep] = await Promise.all([
      sb.from('pf_settings').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('pf_debts').select('*').eq('user_id', uid).order('priority'),
      sb.from('pf_fixed_expenses').select('*').eq('user_id', uid).order('created_at'),
      sb.from('pf_incomes').select('*').eq('user_id', uid).order('received_on', {ascending:false}).order('created_at',{ascending:false}),
      sb.from('pf_expenses').select('*').eq('user_id', uid).order('spent_on', {ascending:false}).order('created_at',{ascending:false}),
      sb.from('pf_debt_payments').select('*, pf_debts(name)').eq('user_id', uid).order('paid_on', {ascending:false}).order('created_at',{ascending:false}),
      sb.from('pf_habits').select('*').eq('user_id', uid).eq('active', true).order('created_at'),
      sb.from('pf_habit_logs').select('*').eq('user_id', uid),
      sb.from('pf_tasks').select('*').eq('user_id', uid).order('created_at'),
      sb.from('pf_books').select('*').eq('user_id', uid).order('updated_at', {ascending:false}),
      sb.from('pf_reading_logs').select('*, pf_books(title)').eq('user_id', uid).order('read_on', {ascending:false}).order('created_at', {ascending:false}),
      sb.from('pf_media').select('*').eq('user_id', uid).order('updated_at', {ascending:false}),
      sb.from('pf_moods').select('*').eq('user_id', uid).order('day', {ascending:false}),
      sb.from('pf_sleep').select('*').eq('user_id', uid).order('day', {ascending:false})
    ]);

    const errors = [settings,debts,fixed,incomes,expenses,payments,habits,habitLogs,tasks,books,readingLogs,media,moods,sleep].map(x=>x.error).filter(Boolean);
    if (errors.length) {
      console.error(errors);
      toast('Не удалось загрузить часть данных. Проверьте supabase.sql.', 'error');
      setSync('Ошибка', false);
      return;
    }

    state.settings = settings.data || { monthly_income_target: 110000 };
    state.debts = debts.data || [];
    state.fixed = fixed.data || [];
    state.incomes = incomes.data || [];
    state.expenses = expenses.data || [];
    state.payments = payments.data || [];
    state.habits = habits.data || [];
    state.habitLogs = habitLogs.data || [];
    state.tasks = tasks.data || [];
    state.books = books.data || [];
    state.readingLogs = readingLogs.data || [];
    state.media = media.data || [];
    state.moods = moods.data || [];
    state.sleep = sleep.data || [];

    renderAll();
    setSync('Синхронизировано', false);
  }

  function renderAll() {
    $('#userEmail').textContent = user?.email || '';
    $('#monthlyIncomeTarget').value = num(state.settings.monthly_income_target || 110000);
    $('#yearlyBookGoal').value = num(state.settings.yearly_book_goal || 24);
    $('#dailyReadingGoal').value = num(state.settings.daily_reading_goal_minutes || 20);
    $('#sleepGoalHours').value = num(state.settings.sleep_goal_hours || 8);
    renderDashboard();
    renderDebts();
    renderIncomes();
    renderExpenses();
    renderHabits();
    renderTasks();
    renderBooks();
    renderMedia();
    renderMood();
    renderSleep();
  }

  function renderDashboard() {
    const ym = currentMonthISO();
    const monthIncomes = state.incomes.filter(x=>isInMonth(x.received_on,ym));
    const monthExpenses = state.expenses.filter(x=>isInMonth(x.spent_on,ym));
    const monthPayments = state.payments.filter(x=>isInMonth(x.paid_on,ym));
    const inc = monthIncomes.reduce((s,x)=>s+num(x.amount),0);
    const exp = monthExpenses.reduce((s,x)=>s+num(x.amount),0);
    const pay = monthPayments.reduce((s,x)=>s+num(x.amount),0);
    const bal = inc-exp-pay;
    const target = num(state.settings.monthly_income_target || 110000);
    $('#sumIncome').textContent = money(inc);
    $('#sumExpenses').textContent = money(exp);
    $('#sumDebtPayments').textContent = money(pay);
    $('#sumBalance').textContent = money(bal);
    $('#sumBalance').style.color = bal < 0 ? '#d95763' : '#3578e5';
    $('#sumIncomeHint').textContent = `цель ${money(target)}`;

    const plan = buildPlan();
    const debtPlanMonth = [...plan.planByDebt.values()].reduce((s,x)=>s+x,0);
    $('#sumDebtHint').textContent = `ориентир ${money(debtPlanMonth)} / месяц`;
    renderAllocation($('#allocationPlan'), plan, null);

    const gapBadge = $('#planGapBadge');
    if (plan.shortMinimum > 0) {
      gapBadge.textContent = `не хватает ${money(plan.shortMinimum)} даже на минимум`;
      gapBadge.className = 'badge bad';
    } else if (plan.gap > 0) {
      gapBadge.textContent = `до целей +${money(plan.gap)}/мес`;
      gapBadge.className = 'badge warn';
    } else {
      gapBadge.textContent = 'цели укладываются в доход';
      gapBadge.className = 'badge good';
    }
    $('#planNote').innerHTML = plan.gap > 0
      ? `Чтобы закрывать долги по выбранным срокам и покрывать указанные постоянные расходы, ориентир по среднему доходу — <strong>${money(plan.desiredTotal)}</strong> в месяц. При текущем среднем доходе ${money(plan.monthlyIncome)} разница составляет <strong>${money(plan.gap)}</strong>. Поэтому приложение сначала закрывает постоянные расходы и минимальные платежи, затем — цели по приоритету.`
      : `Текущего среднего дохода достаточно для указанных целей. Свободный остаток можно направлять в долг с самым высоким приоритетом.`;

    const debtBox = $('#dashboardDebts');
    if (!state.debts.length) debtBox.innerHTML = '<div class="empty">Долгов нет.</div>';
    else debtBox.innerHTML = state.debts.map(d => {
      const progress = num(d.initial_balance) ? clamp((1-num(d.current_balance)/num(d.initial_balance))*100,0,100) : 0;
      return `<div class="debt-mini"><div><strong>${esc(d.name)}</strong><small>Осталось ${money(d.current_balance)} · цель ${d.target_date ? prettyDate(d.target_date) : 'по графику'}</small></div><strong>${Math.round(progress)}%</strong><div class="progress"><span style="width:${progress}%"></span></div></div>`;
    }).join('');

    $('#todayLabel').textContent = new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
    renderTodayTasks();
    renderTodayHabits();
    renderLifeDashboard();
  }

  function renderAllocation(container, plan, enteredAmount) {
    const base = plan.monthlyIncome || 1;
    const amountToSplit = enteredAmount == null ? base : Math.max(0, enteredAmount);
    container.innerHTML = plan.items.map(item => {
      const share = base ? item.amount/base : 0;
      const displayAmount = enteredAmount == null ? item.amount : amountToSplit * share;
      return `<div class="allocation-row"><span>${esc(item.label)}</span><em>${(share*100).toFixed(1).replace('.',',')}%</em><strong>${money(displayAmount)}</strong><div class="track"><span style="width:${clamp(share*100,0,100)}%"></span></div></div>`;
    }).join('') || '<div class="empty">Добавьте доход и финансовые цели.</div>';
  }

  function renderDebts() {
    const box = $('#debtsList');
    if (!state.debts.length) { box.innerHTML = '<div class="empty">Долгов нет.</div>'; return; }
    const plan = buildPlan();
    box.innerHTML = state.debts.map(d => {
      const initial = num(d.initial_balance);
      const current = num(d.current_balance);
      const progress = initial ? clamp((1-current/initial)*100,0,100) : 0;
      const goal = targetPayment(d);
      const allocated = plan.planByDebt.get(d.id) || 0;
      const months = monthsRemaining(d.target_date);
      const reached = current <= 0;
      return `<article class="debt-card">
        <div class="debt-card-head"><div><h3>${esc(d.name)}</h3><span class="badge ${reached?'good':''}">${reached?'Погашен':`приоритет ${d.priority}`}</span></div><button class="icon-btn debt-edit" data-id="${d.id}" title="Редактировать">✎</button></div>
        <div class="debt-amount">${money(current)}</div><div class="muted">текущий остаток</div>
        <div class="progress mt-md"><span style="width:${progress}%"></span></div><div class="hint">Погашено ${progress.toFixed(1).replace('.',',')}% от исходного остатка</div>
        <div class="debt-meta">
          <div class="mini-stat"><span>Ставка</span><strong>${num(d.apr).toFixed(2).replace('.',',')}%</strong></div>
          <div class="mini-stat"><span>Мин. платёж</span><strong>${money(d.min_payment)}</strong></div>
          <div class="mini-stat"><span>Для цели сейчас</span><strong>${money(goal)}/мес</strong></div>
          <div class="mini-stat"><span>Реально по плану</span><strong>${money(allocated)}/мес</strong></div>
          <div class="mini-stat"><span>Целевая дата</span><strong>${d.target_date ? prettyDate(d.target_date) : 'по графику'}</strong></div>
          <div class="mini-stat"><span>До цели</span><strong>${months ? `${months} мес.` : '—'}</strong></div>
        </div>
        ${d.debt_type==='credit_card' && num(d.apr)===0 ? '<div class="hint">Ставка кредитки пока не указана — прогноз считается без процентов.</div>' : ''}
        <div class="debt-actions"><button class="btn primary small debt-pay" data-id="${d.id}" ${reached?'disabled':''}>+ Платёж</button><button class="btn ghost small debt-edit" data-id="${d.id}">Изменить остаток</button></div>
      </article>`;
    }).join('');

    const ym = currentMonthISO();
    const monthPayments = state.payments.filter(x=>isInMonth(x.paid_on,ym));
    $('#debtPaymentsMonthTotal').textContent = money(monthPayments.reduce((sum,x)=>sum+num(x.amount),0));
    $('#debtPaymentsHistory').innerHTML = state.payments.length ? `<table><thead><tr><th>Дата</th><th>Долг</th><th>Комментарий</th><th>Платёж</th></tr></thead><tbody>${state.payments.slice(0,100).map(x=>`<tr><td>${prettyDate(x.paid_on)}</td><td>${esc(x.pf_debts?.name || 'Долг')}</td><td>${esc(x.note||'—')}</td><td class="amount-neg">${money(x.amount)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Платежей пока нет.</div>';

    $$('.debt-edit').forEach(b => b.onclick = () => openDebtEdit(b.dataset.id));
    $$('.debt-pay').forEach(b => b.onclick = () => openPayment(b.dataset.id));
  }

  function openDebtNew() {
    $('#debtDialogTitle').textContent = 'Добавить долг';
    $('#debtEditId').value = '';
    $('#debtEditName').value = '';
    $('#debtEditBalance').value = '';
    $('#debtEditApr').value = '0';
    $('#debtEditMin').value = '0';
    $('#debtEditTarget').value = '';
    $('#debtEditPriority').value = '5';
    $('#debtDialog').showModal();
  }

  function openDebtEdit(id) {
    const d = state.debts.find(x=>x.id===id); if (!d) return;
    $('#debtDialogTitle').textContent = 'Редактировать долг';
    $('#debtEditId').value = d.id;
    $('#debtEditName').value = d.name;
    $('#debtEditBalance').value = num(d.current_balance);
    $('#debtEditApr').value = num(d.apr);
    $('#debtEditMin').value = num(d.min_payment);
    $('#debtEditTarget').value = d.target_date || '';
    $('#debtEditPriority').value = num(d.priority || 5);
    $('#debtDialog').showModal();
  }

  function openPayment(id) {
    const d = state.debts.find(x=>x.id===id); if (!d) return;
    $('#paymentDebtId').value = id;
    $('#paymentDebtName').textContent = `${d.name} · осталось ${money(d.current_balance)}`;
    $('#paymentAmount').value = '';
    $('#paymentAmount').max = num(d.current_balance);
    $('#paymentDate').value = todayISO();
    $('#paymentNote').value = '';
    $('#paymentDialog').showModal();
  }

  function renderIncomes() {
    const ym = currentMonthISO();
    const month = state.incomes.filter(x=>isInMonth(x.received_on,ym));
    const total = month.reduce((s,x)=>s+num(x.amount),0);
    $('#incomeMonthTotal').textContent = money(total);
    const rows = state.incomes.slice(0,100);
    $('#incomeHistory').innerHTML = rows.length ? `<table><thead><tr><th>Дата</th><th>Источник</th><th>Комментарий</th><th>Сумма</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${prettyDate(x.received_on)}</td><td>${esc(x.category)}</td><td>${esc(x.note||'—')}</td><td class="amount-pos">+${money(x.amount)}</td><td class="table-actions"><button class="delete-income" data-id="${x.id}">Удалить</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Доходов пока нет.</div>';
    $$('.delete-income').forEach(b=>b.onclick=()=>deleteRow('pf_incomes',b.dataset.id,'Доход удалён'));
    updateSplitPreview();
  }

  function renderExpenses() {
    const ym = currentMonthISO();
    const month = state.expenses.filter(x=>isInMonth(x.spent_on,ym));
    const total = month.reduce((s,x)=>s+num(x.amount),0);
    $('#expenseMonthTotal').textContent = money(total);
    const rows = state.expenses.slice(0,100);
    $('#expenseHistory').innerHTML = rows.length ? `<table><thead><tr><th>Дата</th><th>Категория</th><th>Комментарий</th><th>Сумма</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${prettyDate(x.spent_on)}</td><td>${esc(x.category)}</td><td>${esc(x.note||'—')}</td><td class="amount-neg">−${money(x.amount)}</td><td class="table-actions"><button class="delete-expense" data-id="${x.id}">Удалить</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Расходов пока нет.</div>';
    $$('.delete-expense').forEach(b=>b.onclick=()=>deleteRow('pf_expenses',b.dataset.id,'Расход удалён'));

    $('#fixedExpensesList').innerHTML = state.fixed.length ? state.fixed.map(x=>`<div class="fixed-row"><span>${esc(x.name)}</span><strong>${money(x.monthly_amount)}</strong><button class="text-btn delete-fixed" data-id="${x.id}">Удалить</button></div>`).join('') : '<div class="empty">Постоянных расходов пока нет.</div>';
    $$('.delete-fixed').forEach(b=>b.onclick=()=>deleteRow('pf_fixed_expenses',b.dataset.id,'Категория удалена'));
  }

  function updateSplitPreview() {
    const amount = num($('#splitAmount')?.value || 0);
    const el = $('#splitPreview'); if (!el) return;
    renderAllocation(el, buildPlan(), amount);
  }

  function renderHabits() {
    const ym = $('#habitMonth').value || currentMonthISO();
    if (!$('#habitMonth').value) $('#habitMonth').value = ym;
    const totalDays = daysInMonth(ym);
    const tracker = $('#habitTracker');
    if (!state.habits.length) { tracker.innerHTML = '<article class="panel"><div class="empty">Добавьте первую привычку — например, чтение, прогулку или зарядку.</div></article>'; return; }
    tracker.innerHTML = state.habits.map(h => {
      const logs = state.habitLogs.filter(l=>l.habit_id===h.id && l.day.slice(0,7)===ym && l.completed);
      const doneSet = new Set(logs.map(l=>l.day));
      const cells = Array.from({length:31},(_,i)=>{
        const day = i+1;
        if (day > totalDays) return `<button class="day-cell out">${day}</button>`;
        const date = `${ym}-${String(day).padStart(2,'0')}`;
        return `<button class="day-cell ${doneSet.has(date)?'done':''} habit-day" data-habit="${h.id}" data-day="${date}">${day}</button>`;
      }).join('');
      const pct = totalDays ? logs.length / totalDays * 100 : 0;
      return `<article class="habit-card"><div class="habit-head"><div><div class="habit-title">${esc(h.name)}</div><div class="muted">${logs.length} из ${totalDays} дней</div></div><button class="text-btn delete-habit" data-id="${h.id}">Удалить</button></div><div class="habit-grid">${cells}</div><div class="habit-progress-line"><div class="progress"><span style="width:${pct}%"></span></div><strong>${Math.round(pct)}%</strong></div></article>`;
    }).join('');
    $$('.habit-day').forEach(b=>b.onclick=()=>toggleHabitDay(b.dataset.habit,b.dataset.day));
    $$('.delete-habit').forEach(b=>b.onclick=()=>deleteHabit(b.dataset.id));
  }

  function renderTodayHabits() {
    const box = $('#todayHabits');
    if (!state.habits.length) { box.innerHTML = '<div class="empty">Привычек пока нет.</div>'; return; }
    const day = todayISO();
    box.innerHTML = state.habits.map(h=>{
      const done = state.habitLogs.some(l=>l.habit_id===h.id && l.day===day && l.completed);
      return `<button class="today-habit ${done?'done':''}" data-habit="${h.id}" data-day="${day}"><span>${done?'✓':'○'} ${esc(h.name)}</span><strong>${done?'готово':'отметить'}</strong></button>`;
    }).join('');
    $$('.today-habit').forEach(b=>b.onclick=()=>toggleHabitDay(b.dataset.habit,b.dataset.day));
  }

  function renderTasks() {
    const date = $('#taskDate').value || todayISO();
    if (!$('#taskDate').value) $('#taskDate').value = date;
    const categories = ['work','tutoring','home'];
    categories.forEach(cat=>{
      const items = state.tasks.filter(t=>t.task_date===date && t.category===cat);
      $(`#count-${cat}`).textContent = `${items.filter(x=>x.completed).length}/${items.length}`;
      const box = $(`#tasks-${cat}`);
      box.innerHTML = items.length ? items.map(t=>taskRow(t)).join('') : '<div class="empty">Нет задач.</div>';
    });
    bindTaskEvents();
  }

  function taskRow(t) {
    return `<div class="task-row ${t.completed?'completed':''}"><input class="task-check" type="checkbox" ${t.completed?'checked':''} data-id="${t.id}" /><span class="task-text">${esc(t.title)}</span><button class="task-delete" data-id="${t.id}" title="Удалить">✕</button></div>`;
  }

  function bindTaskEvents() {
    $$('.task-check').forEach(c=>c.onchange=()=>toggleTask(c.dataset.id,c.checked));
    $$('.task-delete').forEach(b=>b.onclick=()=>deleteRow('pf_tasks',b.dataset.id,'Задача удалена'));
  }

  function renderTodayTasks() {
    const box = $('#todayTasks');
    const items = state.tasks.filter(t=>t.task_date===todayISO());
    if (!items.length) { box.innerHTML = '<div class="empty">На сегодня задач нет.</div>'; return; }
    box.innerHTML = items.slice(0,7).map(t=>taskRow(t)).join('');
    bindTaskEvents();
  }


  // ===== Книги =====
  function coverHTML(url, emoji, alt='') {
    if (!url) return `<div class="cover"><div class="cover-fallback">${emoji}</div></div>`;
    return `<div class="cover"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="cover-fallback">${emoji}</div></div>`;
  }

  function smallCoverHTML(url, emoji='📚') {
    if (!url) return emoji;
    return `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">`;
  }

  function stars(rating) {
    const r = clamp(Math.round(num(rating)), 0, 5);
    return r ? '★'.repeat(r) + '☆'.repeat(5-r) : 'Без оценки';
  }

  function addDaysISO(iso, delta) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0,10);
  }

  function readingStreakDays() {
    const days = new Set(state.readingLogs.filter(x => num(x.pages_read) > 0 || num(x.minutes) > 0).map(x => x.read_on));
    if (!days.size) return 0;
    let cursor = todayISO();
    if (!days.has(cursor)) cursor = addDaysISO(cursor, -1);
    let streak = 0;
    while (days.has(cursor)) {
      streak++;
      cursor = addDaysISO(cursor, -1);
    }
    return streak;
  }

  function calendarHTML(ym, dayRenderer) {
    const total = daysInMonth(ym);
    const [y,m] = ym.split('-').map(Number);
    const first = new Date(y, m-1, 1, 12);
    const offset = (first.getDay() + 6) % 7;
    const names = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    let html = names.map(n=>`<div class="calendar-weekday">${n}</div>`).join('');
    html += Array.from({length:offset},()=>'<div class="calendar-day empty-day"></div>').join('');
    for (let day=1; day<=total; day++) {
      const iso = `${ym}-${String(day).padStart(2,'0')}`;
      html += dayRenderer(day, iso);
    }
    return html;
  }

  function renderBooks() {
    const reading = state.books.filter(b=>b.status==='reading');
    const year = todayISO().slice(0,4);
    const currentYM = currentMonthISO();
    const finishedYear = state.books.filter(b=>b.status==='finished' && (b.finished_on || '').startsWith(year)).length;
    const monthLogs = state.readingLogs.filter(l=>isInMonth(l.read_on,currentYM));
    const monthPages = monthLogs.reduce((s,l)=>s+num(l.pages_read),0);
    const monthMinutes = monthLogs.reduce((s,l)=>s+num(l.minutes),0);

    $('#booksReadingCount').textContent = reading.length;
    $('#booksFinishedYear').textContent = finishedYear;
    $('#booksGoalHint').textContent = `цель — ${num(state.settings.yearly_book_goal || 24)}`;
    $('#readingStreak').textContent = readingStreakDays();
    $('#readingMonthPages').textContent = `${monthPages} стр.`;
    $('#readingMonthMinutes').textContent = `${monthMinutes} мин.`;
    const todayMinutes=state.readingLogs.filter(l=>l.read_on===todayISO()).reduce((s,l)=>s+num(l.minutes),0);
    const dailyGoal=num(state.settings.daily_reading_goal_minutes||20);
    $('#readingTodayGoal').textContent=`Сегодня: ${todayMinutes} из ${dailyGoal} мин. · ${todayMinutes>=dailyGoal?'цель выполнена ✓':`осталось ${Math.max(0,dailyGoal-todayMinutes)} мин.`}`;

    const currentBox = $('#currentBooks');
    currentBox.innerHTML = reading.length ? reading.map(b=>{
      const total=num(b.total_pages), current=num(b.current_page);
      const pct=total ? clamp(current/total*100,0,100) : 0;
      return `<div class="current-book-row">
        <div class="current-book-cover">${smallCoverHTML(b.cover_url)}</div>
        <div class="current-book-info"><strong>${esc(b.title)}</strong><small>${esc(b.author||'Автор не указан')} · ${total ? `${current} / ${total} стр.` : `стр. ${current}`}</small><div class="progress"><span style="width:${pct}%"></span></div></div>
        <button class="btn primary small book-log" data-id="${b.id}">Записать чтение</button>
      </div>`;
    }).join('') : '<div class="empty">Сейчас нет активной книги. Добавьте книгу со статусом «Читаю».</div>';

    const q = ($('#bookSearch')?.value || '').trim().toLowerCase();
    const status = $('#bookStatusFilter')?.value || 'all';
    const filtered = state.books.filter(b => {
      const statusMatch = status==='all' || (status==='owned' ? b.owned : status==='favorite' ? b.favorite : b.status===status);
      return statusMatch && (!q || `${b.title} ${b.author||''}`.toLowerCase().includes(q));
    });
    const lib = $('#booksLibrary');
    lib.innerHTML = filtered.length ? filtered.map(b=>{
      const total=num(b.total_pages), current=num(b.current_page);
      const pct=total ? clamp(current/total*100,0,100) : 0;
      const quick = b.status==='reading'
        ? `<button class="btn primary book-log" data-id="${b.id}">+ Чтение</button>`
        : b.status==='wishlist'
          ? `<button class="btn secondary book-start" data-id="${b.id}">Начать</button>`
          : '';
      return `<article class="library-card">
        ${b.favorite ? '<div class="favorite-mark">❤️</div>' : ''}
        ${coverHTML(b.cover_url,'📖',b.title)}
        <div class="library-card-body">
          <span class="status-pill ${b.status}">${bookStatusLabels[b.status] || b.status}</span>
          <div class="library-card-title">${esc(b.title)}</div>
          <div class="library-card-subtitle">${esc(b.author||'Автор не указан')}</div>
          ${total ? `<div class="progress"><span style="width:${pct}%"></span></div><div class="library-card-meta"><span>${current}/${total} стр.</span><strong>${Math.round(pct)}%</strong></div>` : `<div class="library-card-meta"><span>стр. ${current}</span><span>${b.owned?'📚 Куплена':''}</span></div>`}
          <div class="star-line">${stars(b.rating)}</div>
          <div class="library-card-actions">${quick}<button class="btn ghost book-edit" data-id="${b.id}">Изменить</button></div>
        </div>
      </article>`;
    }).join('') : '<div class="empty">По выбранному фильтру книг пока нет.</div>';

    $$('.book-edit').forEach(b=>b.onclick=()=>openBookEdit(b.dataset.id));
    $$('.book-log').forEach(b=>b.onclick=()=>openReading(b.dataset.id));
    $$('.book-start').forEach(b=>b.onclick=async()=>{
      const book=state.books.find(x=>x.id===b.dataset.id);
      if (!book) return;
      const {error}=await sb.from('pf_books').update({status:'reading',started_on:book.started_on||todayISO()}).eq('id',book.id);
      if (error) toast('Не удалось начать книгу','error'); else toast('Книга перенесена в «Читаю»');
      await loadAll({silent:true});
    });

    renderReadingCalendar();
    renderReadingJournal();
    renderReadingTimerOptions();
  }

  function renderReadingCalendar() {
    const ym = $('#readingMonth')?.value || currentMonthISO();
    if ($('#readingMonth') && !$('#readingMonth').value) $('#readingMonth').value=ym;
    const byDay = new Map();
    state.readingLogs.filter(l=>isInMonth(l.read_on,ym)).forEach(l=>{
      const old=byDay.get(l.read_on)||{pages:0,minutes:0};
      old.pages+=num(l.pages_read); old.minutes+=num(l.minutes);
      byDay.set(l.read_on,old);
    });
    const maxPages=Math.max(1,...[...byDay.values()].map(x=>x.pages));
    $('#readingCalendar').innerHTML=calendarHTML(ym,(day,iso)=>{
      const d=byDay.get(iso);
      if (!d) return `<div class="calendar-day"><span class="day-num">${day}</span></div>`;
      const level=Math.max(1,Math.ceil(d.pages/maxPages*4));
      return `<div class="calendar-day read-${level}"><span class="day-num">${day}</span><span class="calendar-value">${d.pages} стр.</span><small>${d.minutes} мин.</small></div>`;
    });
  }

  function renderReadingJournal() {
    const box=$('#readingJournal');
    const rows=state.readingLogs.slice(0,30);
    box.innerHTML=rows.length ? rows.map(l=>`<div class="journal-entry">
      <div class="journal-entry-head"><strong>${esc(l.pf_books?.title||'Книга')}</strong><small>${prettyDate(l.read_on)}</small></div>
      <small>+${num(l.pages_read)} стр. · ${num(l.minutes)} мин. · до стр. ${num(l.page_after)}</small>
      ${l.note ? `<p>${esc(l.note)}</p>` : ''}
    </div>`).join('') : '<div class="empty">Записей чтения пока нет.</div>';
  }

  function openBookNew() {
    $('#bookDialogTitle').textContent='Добавить книгу';
    $('#bookId').value='';
    $('#bookTitle').value='';
    $('#bookAuthor').value='';
    $('#bookStatus').value='wishlist';
    $('#bookCover').value='';
    $('#bookTotalPages').value='';
    $('#bookCurrentPage').value='0';
    $('#bookRating').value='0';
    $('#bookStartedOn').value='';
    $('#bookFinishedOn').value='';
    $('#bookFavorite').checked=false;
    $('#bookOwned').checked=false;
    $('#bookNotes').value='';
    $('#deleteBookBtn').classList.add('hidden');
    $('#bookDialog').showModal();
  }

  function openBookEdit(id) {
    const b=state.books.find(x=>x.id===id); if (!b) return;
    $('#bookDialogTitle').textContent='Редактировать книгу';
    $('#bookId').value=b.id;
    $('#bookTitle').value=b.title||'';
    $('#bookAuthor').value=b.author||'';
    $('#bookStatus').value=b.status||'wishlist';
    $('#bookCover').value=b.cover_url||'';
    $('#bookTotalPages').value=num(b.total_pages);
    $('#bookCurrentPage').value=num(b.current_page);
    $('#bookRating').value=num(b.rating);
    $('#bookStartedOn').value=b.started_on||'';
    $('#bookFinishedOn').value=b.finished_on||'';
    $('#bookFavorite').checked=!!b.favorite;
    $('#bookOwned').checked=!!b.owned;
    $('#bookNotes').value=b.notes||'';
    $('#deleteBookBtn').classList.remove('hidden');
    $('#bookDialog').showModal();
  }

  function openReading(id, minutes=0) {
    const b=state.books.find(x=>x.id===id); if (!b) return;
    $('#readingBookId').value=b.id;
    $('#readingBookLabel').textContent=`${b.title} · сейчас стр. ${num(b.current_page)}${num(b.total_pages)?` из ${num(b.total_pages)}`:''}`;
    $('#readingNewPage').value=num(b.current_page);
    $('#readingNewPage').max=num(b.total_pages)>0?num(b.total_pages):'';
    $('#readingMinutes').value=Math.max(0,Math.round(minutes));
    $('#readingDate').value=todayISO();
    $('#readingNote').value='';
    $('#readingDialog').showModal();
  }

  function restoreReadingTimer() {
    try {
      const raw=localStorage.getItem('pf_reading_timer_v1');
      if (raw) {
        const data=JSON.parse(raw);
        readingTimer={...readingTimer,...data, tick:null, loaded:true};
      } else readingTimer.loaded=true;
    } catch { readingTimer.loaded=true; }
    if (readingTimer.running && readingTimer.startedAt) startTimerTick();
  }

  function saveReadingTimer() {
    localStorage.setItem('pf_reading_timer_v1',JSON.stringify({
      running:readingTimer.running,startedAt:readingTimer.startedAt,accumulated:readingTimer.accumulated,bookId:readingTimer.bookId
    }));
  }

  function timerElapsedMs() {
    return num(readingTimer.accumulated)+(readingTimer.running && readingTimer.startedAt ? Date.now()-readingTimer.startedAt : 0);
  }

  function formatTimer(ms) {
    const sec=Math.max(0,Math.floor(ms/1000));
    const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
    return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
  }

  function startTimerTick() {
    clearInterval(readingTimer.tick);
    readingTimer.tick=setInterval(updateReadingTimerUI,1000);
  }

  function updateReadingTimerUI() {
    const display=$('#readingTimerDisplay'); if (!display) return;
    display.textContent=formatTimer(timerElapsedMs());
    const toggle=$('#readingTimerToggle');
    if (toggle) toggle.textContent=readingTimer.running?'⏸ Пауза':'▶ Начать';
    const select=$('#readingTimerBook');
    if (select) select.disabled=readingTimer.running;
    const finish=$('#readingTimerFinish');
    if (finish) finish.disabled=!readingTimer.bookId || timerElapsedMs()<=0;
  }

  function renderReadingTimerOptions() {
    if (!readingTimer.loaded) restoreReadingTimer();
    const select=$('#readingTimerBook'); if (!select) return;
    const reading=state.books.filter(b=>b.status==='reading');
    const preferred=reading.some(b=>b.id===readingTimer.bookId)?readingTimer.bookId:(reading[0]?.id||'');
    if (!readingTimer.running) readingTimer.bookId=preferred;
    select.innerHTML=reading.length?reading.map(b=>`<option value="${b.id}" ${b.id===readingTimer.bookId?'selected':''}>${esc(b.title)}</option>`).join(''):'<option value="">Нет активных книг</option>';
    $('#readingTimerToggle').disabled=!reading.length;
    $('#readingTimerFinish').disabled=!reading.length || timerElapsedMs()<=0;
    updateReadingTimerUI();
  }

  function resetReadingTimer() {
    readingTimer.running=false; readingTimer.startedAt=null; readingTimer.accumulated=0;
    clearInterval(readingTimer.tick); readingTimer.tick=null;
    saveReadingTimer(); updateReadingTimerUI();
    if ($('#readingTimerFinish')) $('#readingTimerFinish').disabled=true;
  }

  // ===== Фильмы и сериалы =====
  function mediaProgressText(m) {
    if (m.media_type!=='series') return m.watched_on ? `Просмотрено ${prettyDate(m.watched_on)}` : '';
    if (num(m.episodes_total)>0) return `${num(m.episode_current)} / ${num(m.episodes_total)} серий`;
    if (num(m.seasons_total)>0) return `${num(m.season_current)} / ${num(m.seasons_total)} сезонов`;
    return num(m.season_current)>0 ? `Сезон ${num(m.season_current)}` : '';
  }

  function renderMedia() {
    const year=todayISO().slice(0,4);
    const wishlist=state.media.filter(m=>m.status==='wishlist');
    const watching=state.media.filter(m=>m.status==='watching');
    const watchedYear=state.media.filter(m=>m.status==='watched' && (m.watched_on||'').startsWith(year));
    const rated=state.media.filter(m=>num(m.rating)>0);
    const avg=rated.length?rated.reduce((s,m)=>s+num(m.rating),0)/rated.length:0;
    $('#mediaWishlistCount').textContent=wishlist.length;
    $('#mediaWatchingCount').textContent=watching.length;
    $('#mediaWatchedYear').textContent=watchedYear.length;
    $('#mediaAverageRating').textContent=rated.length?avg.toFixed(1).replace('.',','):'—';

    const q=($('#mediaSearch')?.value||'').trim().toLowerCase();
    const type=$('#mediaTypeFilter')?.value||'all';
    const status=$('#mediaStatusFilter')?.value||'all';
    const filtered=state.media.filter(m=>(type==='all'||m.media_type===type)&&(status==='all'||m.status===status)&&(!q||m.title.toLowerCase().includes(q)));
    $('#mediaLibrary').innerHTML=filtered.length?filtered.map(m=>{
      const progress=mediaProgressText(m);
      return `<article class="library-card">
        ${m.favorite?'<div class="favorite-mark">❤️</div>':''}
        ${coverHTML(m.cover_url,m.media_type==='series'?'📺':'🎬',m.title)}
        <div class="library-card-body">
          <span class="status-pill ${m.status}">${mediaStatusLabels[m.status]||m.status}</span>
          <div class="library-card-title">${esc(m.title)}</div>
          <div class="library-card-subtitle">${mediaTypeLabels[m.media_type]||m.media_type}${m.release_year?` · ${m.release_year}`:''}</div>
          <div class="library-card-meta"><span>${esc(progress||'')}</span><strong>${num(m.rating)>0?`${num(m.rating).toFixed(1).replace('.',',')}/10`:''}</strong></div>
          <div class="library-card-actions"><button class="btn ghost media-edit" data-id="${m.id}">Изменить</button></div>
        </div>
      </article>`;
    }).join(''):'<div class="empty">По выбранному фильтру ничего нет.</div>';
    $$('.media-edit').forEach(b=>b.onclick=()=>openMediaEdit(b.dataset.id));
  }

  function openMediaNew() {
    $('#mediaDialogTitle').textContent='Добавить фильм или сериал';
    $('#mediaId').value=''; $('#mediaTitle').value=''; $('#mediaType').value='movie'; $('#mediaStatus').value='wishlist';
    $('#mediaYear').value=''; $('#mediaCover').value=''; $('#mediaRating').value='0';
    $('#mediaSeasonCurrent').value='0'; $('#mediaSeasonsTotal').value='0'; $('#mediaEpisodeCurrent').value='0'; $('#mediaEpisodesTotal').value='0';
    $('#mediaWatchedOn').value=''; $('#mediaFavorite').checked=false; $('#mediaNotes').value='';
    $('#deleteMediaBtn').classList.add('hidden'); toggleMediaSeriesFields(); $('#mediaDialog').showModal();
  }

  function openMediaEdit(id) {
    const m=state.media.find(x=>x.id===id); if (!m) return;
    $('#mediaDialogTitle').textContent='Редактировать';
    $('#mediaId').value=m.id; $('#mediaTitle').value=m.title||''; $('#mediaType').value=m.media_type||'movie'; $('#mediaStatus').value=m.status||'wishlist';
    $('#mediaYear').value=m.release_year||''; $('#mediaCover').value=m.cover_url||''; $('#mediaRating').value=num(m.rating);
    $('#mediaSeasonCurrent').value=num(m.season_current); $('#mediaSeasonsTotal').value=num(m.seasons_total); $('#mediaEpisodeCurrent').value=num(m.episode_current); $('#mediaEpisodesTotal').value=num(m.episodes_total);
    $('#mediaWatchedOn').value=m.watched_on||''; $('#mediaFavorite').checked=!!m.favorite; $('#mediaNotes').value=m.notes||'';
    $('#deleteMediaBtn').classList.remove('hidden'); toggleMediaSeriesFields(); $('#mediaDialog').showModal();
  }

  function toggleMediaSeriesFields() {
    const show=$('#mediaType')?.value==='series';
    $$('.series-only').forEach(el=>el.classList.toggle('hidden',!show));
  }

  function pickRandomMedia(target='#randomMediaResult') {
    const items=state.media.filter(m=>m.status==='wishlist');
    const box=$(target); if (!box) return;
    if (!items.length) { box.innerHTML='Добавьте что-нибудь в «Хочу посмотреть».'; return; }
    const m=items[Math.floor(Math.random()*items.length)];
    box.innerHTML=`<div class="random-cover">${smallCoverHTML(m.cover_url,m.media_type==='series'?'📺':'🎬')}</div><div><strong>${esc(m.title)}</strong><div class="muted">${mediaTypeLabels[m.media_type]}${m.release_year?` · ${m.release_year}`:''}</div></div><button class="btn secondary small random-open" data-id="${m.id}">Открыть</button>`;
    box.querySelector('.random-open')?.addEventListener('click',()=>openMediaEdit(m.id));
  }

  // ===== Настроение =====
  function renderMood() {
    const ym=$('#moodMonth')?.value||currentMonthISO();
    if ($('#moodMonth')&&!$('#moodMonth').value) $('#moodMonth').value=ym;
    const rows=state.moods.filter(x=>isInMonth(x.day,ym));
    const avg=rows.length?rows.reduce((s,x)=>s+num(x.mood),0)/rows.length:0;
    const counts={}; rows.forEach(x=>counts[x.mood]=(counts[x.mood]||0)+1);
    const common=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    const today=state.moods.find(x=>x.day===todayISO());
    $('#moodAverage').textContent=rows.length?`${moodMeta[Math.round(avg)]?.emoji||''} ${avg.toFixed(1).replace('.',',')}`:'—';
    $('#moodDaysCount').textContent=rows.length;
    $('#moodMostCommon').textContent=common?`${moodMeta[common].emoji} ${moodMeta[common].label}`:'—';
    $('#moodTodayValue').textContent=today?`${moodMeta[today.mood].emoji} ${moodMeta[today.mood].label}`:'—';

    const map=new Map(rows.map(x=>[x.day,x]));
    $('#moodCalendar').innerHTML=calendarHTML(ym,(day,iso)=>{
      const r=map.get(iso);
      return `<button class="calendar-day mood-day" data-day="${iso}"><span class="day-num">${day}</span>${r?`<span class="mood-emoji">${moodMeta[r.mood].emoji}</span><small>${esc((r.note||'').slice(0,18))}</small>`:'<span class="mood-emoji">·</span>'}</button>`;
    });
    $$('.mood-day').forEach(b=>b.onclick=()=>openMood(b.dataset.day));

    $('#moodHistory').innerHTML=state.moods.slice(0,30).map(r=>`<div class="journal-entry"><div class="journal-entry-head"><strong>${moodMeta[r.mood].emoji} ${moodMeta[r.mood].label}</strong><small>${prettyDate(r.day)}</small></div>${r.note?`<p>${esc(r.note)}</p>`:''}</div>`).join('')||'<div class="empty">Записей пока нет.</div>';
  }

  function selectMood(value) {
    $('#moodValue').value=String(value);
    $$('[data-mood]').forEach(b=>b.classList.toggle('selected',num(b.dataset.mood)===num(value)));
  }

  function openMood(day) {
    const r=state.moods.find(x=>x.day===day);
    $('#moodDate').value=day;
    $('#moodNote').value=r?.note||'';
    selectMood(r?.mood||3);
    $('#moodDialog').showModal();
  }

  // ===== Сон =====
  function sleepDurationMinutes(bed,wake) {
    if (!bed||!wake) return 0;
    const [bh,bm]=bed.split(':').map(Number), [wh,wm]=wake.split(':').map(Number);
    let start=bh*60+bm, end=wh*60+wm;
    if (end<=start) end+=1440;
    return clamp(end-start,0,1440);
  }

  function formatSleepMinutes(mins) {
    const h=Math.floor(num(mins)/60), m=num(mins)%60;
    return `${h} ч ${m?`${m} мин`:' '}`.trim();
  }

  function renderSleep() {
    const ym=$('#sleepMonth')?.value||currentMonthISO();
    if ($('#sleepMonth')&&!$('#sleepMonth').value) $('#sleepMonth').value=ym;
    const rows=state.sleep.filter(x=>isInMonth(x.day,ym));
    const avgMinutes=rows.length?rows.reduce((s,x)=>s+num(x.duration_minutes),0)/rows.length:0;
    const avgQuality=rows.length?rows.reduce((s,x)=>s+num(x.quality),0)/rows.length:0;
    const goal=num(state.settings.sleep_goal_hours||8);
    $('#sleepAverageHours').textContent=rows.length?`${(avgMinutes/60).toFixed(1).replace('.',',')} ч`:'—';
    $('#sleepAverageQuality').textContent=rows.length?`${avgQuality.toFixed(1).replace('.',',')} / 5`:'—';
    $('#sleepNightsCount').textContent=rows.length;
    $('#sleepGoalLabel').textContent=`${String(goal).replace('.',',')} ч`;
    const map=new Map(rows.map(x=>[x.day,x]));
    $('#sleepCalendar').innerHTML=calendarHTML(ym,(day,iso)=>{
      const r=map.get(iso);
      if (!r) return `<button class="calendar-day sleep-day" data-day="${iso}"><span class="day-num">${day}</span></button>`;
      const pct=clamp(num(r.duration_minutes)/(goal*60)*100,0,100);
      return `<button class="calendar-day sleep-day" data-day="${iso}"><span class="day-num">${day}</span><span class="sleep-hours">${(num(r.duration_minutes)/60).toFixed(1).replace('.',',')} ч</span><span class="sleep-quality">${'★'.repeat(num(r.quality))}</span><div class="sleep-bar"><span style="width:${pct}%"></span></div></button>`;
    });
    $$('.sleep-day').forEach(b=>b.onclick=()=>openSleep(b.dataset.day));

    $('#sleepHistory').innerHTML=state.sleep.length?`<table><thead><tr><th>Дата</th><th>Сон</th><th>Длительность</th><th>Качество</th><th>Заметка</th><th></th></tr></thead><tbody>${state.sleep.slice(0,60).map(r=>`<tr><td>${prettyDate(r.day)}</td><td>${String(r.bed_time).slice(0,5)} → ${String(r.wake_time).slice(0,5)}</td><td>${formatSleepMinutes(r.duration_minutes)}</td><td>${'★'.repeat(num(r.quality))}</td><td>${esc(r.note||'—')}</td><td><button class="text-btn sleep-edit" data-day="${r.day}">Изменить</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Записей сна пока нет.</div>';
    $$('.sleep-edit').forEach(b=>b.onclick=()=>openSleep(b.dataset.day));
  }

  function updateSleepPreview() {
    const mins=sleepDurationMinutes($('#sleepBedTime')?.value,$('#sleepWakeTime')?.value);
    if ($('#sleepDurationPreview')) $('#sleepDurationPreview').textContent=mins?`Длительность: ${formatSleepMinutes(mins)}.`:'Укажите время сна и пробуждения.';
  }

  function openSleep(day) {
    const r=state.sleep.find(x=>x.day===day);
    $('#sleepDate').value=day;
    $('#sleepBedTime').value=r?String(r.bed_time).slice(0,5):'23:30';
    $('#sleepWakeTime').value=r?String(r.wake_time).slice(0,5):'07:30';
    $('#sleepQuality').value=r?.quality||3;
    $('#sleepNote').value=r?.note||'';
    updateSleepPreview();
    $('#sleepDialog').showModal();
  }

  function renderLifeDashboard() {
    const reading=state.books.filter(b=>b.status==='reading');
    $('#dashboardReading').innerHTML=reading.length?reading.slice(0,2).map(b=>{
      const pct=num(b.total_pages)?clamp(num(b.current_page)/num(b.total_pages)*100,0,100):0;
      return `<div class="dashboard-life-row"><strong>${esc(b.title)}</strong><small>${num(b.total_pages)?`${num(b.current_page)} / ${num(b.total_pages)} стр.`:`стр. ${num(b.current_page)}`}</small><div class="progress"><span style="width:${pct}%"></span></div></div>`;
    }).join(''):'<div class="empty">Нет книги в процессе.</div>';

    const wish=state.media.filter(m=>m.status==='wishlist');
    if (wish.length) {
      const seed=todayISO().split('').reduce((s,c)=>s+c.charCodeAt(0),0);
      const m=wish[seed%wish.length];
      $('#dashboardRandomMedia').innerHTML=`<div class="dashboard-life-row"><strong>${esc(m.title)}</strong><small>${mediaTypeLabels[m.media_type]} · вариантов в желаниях: ${wish.length}</small></div>`;
    } else $('#dashboardRandomMedia').innerHTML='<div class="empty">Список желаний пока пуст.</div>';

    const mood=state.moods.find(x=>x.day===todayISO());
    $('#dashboardMood').innerHTML=mood?`<div class="dashboard-life-row"><strong>${moodMeta[mood.mood].emoji} ${moodMeta[mood.mood].label}</strong><small>${esc(mood.note||'Сегодня отмечено')}</small></div>`:'<div class="empty">Сегодня настроение ещё не отмечено.</div>';

    const sleep=state.sleep[0];
    $('#dashboardSleep').innerHTML=sleep?`<div class="dashboard-life-row"><strong>${formatSleepMinutes(sleep.duration_minutes)}</strong><small>${prettyDate(sleep.day)} · качество ${num(sleep.quality)}/5</small></div>`:'<div class="empty">Сон пока не записывали.</div>';
  }

  async function toggleHabitDay(habitId, day) {
    const existing = state.habitLogs.find(l=>l.habit_id===habitId && l.day===day);
    setSync('Сохранение…', true);
    let result;
    if (existing) result = await sb.from('pf_habit_logs').delete().eq('id',existing.id);
    else result = await sb.from('pf_habit_logs').insert({user_id:user.id, habit_id:habitId, day, completed:true});
    if (result.error) { console.error(result.error); toast('Не удалось сохранить привычку','error'); }
    await loadAll({silent:true});
  }

  async function toggleTask(id, completed) {
    const {error} = await sb.from('pf_tasks').update({completed}).eq('id',id);
    if (error) toast('Не удалось обновить задачу','error');
    await loadAll({silent:true});
  }

  async function deleteHabit(id) {
    if (!confirm('Удалить привычку и все отметки по ней?')) return;
    const {error} = await sb.from('pf_habits').delete().eq('id',id);
    if (error) toast('Не удалось удалить привычку','error'); else toast('Привычка удалена');
    await loadAll({silent:true});
  }

  async function deleteRow(table, id, success) {
    if (!confirm('Удалить эту запись?')) return;
    const {error} = await sb.from(table).delete().eq('id',id);
    if (error) { console.error(error); toast('Не удалось удалить запись','error'); }
    else toast(success);
    await loadAll({silent:true});
  }

  function bindUI() {
    $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
    $$('[data-go]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.go)));
    $('#refreshBtn').onclick = ()=>loadAll();
    $('#logoutBtn').onclick = logout;
    $('#logoutBtn2').onclick = logout;
    $('#splitAmount').addEventListener('input', updateSplitPreview);
    $('#habitMonth').addEventListener('change', renderHabits);
    $('#taskDate').addEventListener('change', renderTasks);
    $('#addHabitBtn').onclick = ()=>{ $('#habitName').value=''; $('#habitDialog').showModal(); };
    $('#addDebtBtn').onclick = openDebtNew;

    // Книги
    $('#addBookBtn').onclick = openBookNew;
    $('#bookSearch').addEventListener('input', renderBooks);
    $('#bookStatusFilter').addEventListener('change', renderBooks);
    $('#readingMonth').addEventListener('change', renderReadingCalendar);
    $('#readingTimerBook').addEventListener('change', e => { if (!readingTimer.running) { readingTimer.bookId=e.target.value||null; saveReadingTimer(); } });
    $('#readingTimerToggle').onclick = () => {
      if (readingTimer.running) {
        readingTimer.accumulated=timerElapsedMs();
        readingTimer.running=false;
        readingTimer.startedAt=null;
        clearInterval(readingTimer.tick); readingTimer.tick=null;
      } else {
        const id=$('#readingTimerBook').value;
        if (!id) return;
        readingTimer.bookId=id;
        readingTimer.running=true;
        readingTimer.startedAt=Date.now();
        startTimerTick();
      }
      saveReadingTimer(); updateReadingTimerUI();
      $('#readingTimerFinish').disabled=timerElapsedMs()<=0;
    };
    $('#readingTimerFinish').onclick = () => {
      const id=readingTimer.bookId||$('#readingTimerBook').value;
      if (!id) return;
      if (readingTimer.running) {
        readingTimer.accumulated=timerElapsedMs();
        readingTimer.running=false; readingTimer.startedAt=null;
        clearInterval(readingTimer.tick); readingTimer.tick=null;
        saveReadingTimer(); updateReadingTimerUI();
      }
      const mins=timerElapsedMs()>0?Math.max(1,Math.round(timerElapsedMs()/60000)):0;
      openReading(id,mins);
    };
    $('#readingTimerReset').onclick = () => { if (timerElapsedMs()>0 && !confirm('Сбросить таймер чтения?')) return; resetReadingTimer(); };

    // Фильмы и сериалы
    $('#addMediaBtn').onclick = openMediaNew;
    $('#mediaType').addEventListener('change', toggleMediaSeriesFields);
    $('#mediaSearch').addEventListener('input', renderMedia);
    $('#mediaTypeFilter').addEventListener('change', renderMedia);
    $('#mediaStatusFilter').addEventListener('change', renderMedia);
    $('#randomMediaBtn').onclick = () => pickRandomMedia();

    // Настроение
    $('#moodMonth').addEventListener('change', renderMood);
    $('#moodTodayBtn').onclick = () => openMood(todayISO());
    $$('[data-mood]').forEach(b=>b.addEventListener('click',()=>selectMood(b.dataset.mood)));

    // Сон
    $('#sleepMonth').addEventListener('change', renderSleep);
    $('#sleepTodayBtn').onclick = () => openSleep(todayISO());
    $('#sleepBedTime').addEventListener('input', updateSleepPreview);
    $('#sleepWakeTime').addEventListener('input', updateSleepPreview);
    $$('.dialog-close').forEach(b => b.onclick = () => { const d = document.getElementById(b.dataset.dialog); if (d?.open) d.close(); });

    $('#authModeToggle').onclick = () => {
      authMode = authMode === 'login' ? 'register' : 'login';
      $('#authSubmit').textContent = authMode === 'login' ? 'Войти' : 'Создать аккаунт';
      $('#authModeToggle').textContent = authMode === 'login' ? 'Создать аккаунт' : 'У меня уже есть аккаунт';
      $('#authPassword').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    };

    $('#authForm').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#authEmail').value.trim();
      const password = $('#authPassword').value;
      $('#authSubmit').disabled = true;
      $('#authHint').textContent = authMode === 'login' ? 'Проверяю email и пароль…' : 'Создаю аккаунт…';
      $('#authHint').style.color = '';
      try {
        if (authMode === 'login') {
          const {error} = await sb.auth.signInWithPassword({email,password});
          if (error) throw error;
          $('#authHint').textContent = 'Вход выполнен. Загружаю личный кабинет…';
        } else {
          const {data,error} = await sb.auth.signUp({email,password});
          if (error) throw error;
          if (!data.session) {
            toast('Аккаунт создан. Подтвердите email и затем войдите.');
            $('#authHint').textContent = 'Аккаунт создан. Проверьте почту для подтверждения email.';
          }
        }
      } catch (err) {
        console.error(err);
        const message = err.message || 'Ошибка входа';
        toast(message,'error');
        $('#authHint').textContent = `Ошибка: ${message}`;
        $('#authHint').style.color = '#b53f4c';
      } finally { $('#authSubmit').disabled = false; }
    });

    $('#incomeForm').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {user_id:user.id, amount:num($('#incomeAmount').value), category:$('#incomeCategory').value, received_on:$('#incomeDate').value, note:$('#incomeNote').value.trim() || null};
      const {error} = await sb.from('pf_incomes').insert(payload);
      if (error) toast('Не удалось добавить доход','error'); else { toast('Доход добавлен'); e.target.reset(); $('#incomeDate').value=todayISO(); }
      await loadAll({silent:true});
    });

    $('#expenseForm').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {user_id:user.id, amount:num($('#expenseAmount').value), category:$('#expenseCategory').value, spent_on:$('#expenseDate').value, note:$('#expenseNote').value.trim() || null};
      const {error} = await sb.from('pf_expenses').insert(payload);
      if (error) toast('Не удалось добавить расход','error'); else { toast('Расход добавлен'); e.target.reset(); $('#expenseDate').value=todayISO(); }
      await loadAll({silent:true});
    });

    $('#fixedExpenseForm').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {user_id:user.id, name:$('#fixedExpenseName').value.trim(), monthly_amount:num($('#fixedExpenseAmount').value)};
      const {error} = await sb.from('pf_fixed_expenses').upsert(payload,{onConflict:'user_id,name'});
      if (error) toast('Не удалось сохранить расход','error'); else { toast('Постоянный расход сохранён'); e.target.reset(); }
      await loadAll({silent:true});
    });

    $('#settingsForm').addEventListener('submit', async e => {
      e.preventDefault();
      const amount = num($('#monthlyIncomeTarget').value);
      const payload = {
        user_id:user.id,
        monthly_income_target:amount,
        yearly_book_goal:num($('#yearlyBookGoal').value || 24),
        daily_reading_goal_minutes:num($('#dailyReadingGoal').value || 20),
        sleep_goal_hours:num($('#sleepGoalHours').value || 8)
      };
      const {error} = await sb.from('pf_settings').upsert(payload,{onConflict:'user_id'});
      if (error) toast('Не удалось сохранить настройки','error'); else toast('Настройки сохранены');
      await loadAll({silent:true});
    });

    $('#taskForm').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {user_id:user.id,title:$('#taskTitle').value.trim(),category:$('#taskCategory').value,task_date:$('#taskDate').value,completed:false};
      const {error} = await sb.from('pf_tasks').insert(payload);
      if (error) toast('Не удалось добавить задачу','error'); else { $('#taskTitle').value=''; toast('Задача добавлена'); }
      await loadAll({silent:true});
    });

    $('#habitForm').addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#habitName').value.trim();
      if (!name) return;
      const {error} = await sb.from('pf_habits').upsert({user_id:user.id,name,active:true},{onConflict:'user_id,name'});
      if (error) toast('Не удалось добавить привычку','error'); else { toast('Привычка добавлена'); $('#habitDialog').close(); }
      await loadAll({silent:true});
    });

    $('#bookForm').addEventListener('submit', async e => {
      e.preventDefault();
      const id=$('#bookId').value;
      let total=Math.max(0,Math.round(num($('#bookTotalPages').value)));
      let current=Math.max(0,Math.round(num($('#bookCurrentPage').value)));
      if (total>0 && current>total) { toast('Текущая страница не может быть больше общего числа страниц','error'); return; }
      const status=$('#bookStatus').value;
      if (status==='finished' && total>0) current=total;
      const payload={
        title:$('#bookTitle').value.trim(),
        author:$('#bookAuthor').value.trim()||null,
        status,
        cover_url:$('#bookCover').value.trim()||null,
        total_pages:total,
        current_page:current,
        rating:num($('#bookRating').value),
        favorite:$('#bookFavorite').checked,
        owned:$('#bookOwned').checked,
        started_on:$('#bookStartedOn').value||((status==='reading'||status==='finished')?todayISO():null),
        finished_on:$('#bookFinishedOn').value||(status==='finished'?todayISO():null),
        notes:$('#bookNotes').value.trim()||null
      };
      const result=id?await sb.from('pf_books').update(payload).eq('id',id):await sb.from('pf_books').insert({...payload,user_id:user.id});
      if (result.error) { console.error(result.error); toast('Не удалось сохранить книгу','error'); }
      else { toast(id?'Книга обновлена':'Книга добавлена'); $('#bookDialog').close(); }
      await loadAll({silent:true});
    });

    $('#deleteBookBtn').onclick = async () => {
      const id=$('#bookId').value; if (!id || !confirm('Удалить книгу и весь дневник чтения по ней?')) return;
      const {error}=await sb.from('pf_books').delete().eq('id',id);
      if (error) toast('Не удалось удалить книгу','error'); else { toast('Книга удалена'); $('#bookDialog').close(); }
      if (readingTimer.bookId===id) resetReadingTimer();
      await loadAll({silent:true});
    };

    $('#readingForm').addEventListener('submit', async e => {
      e.preventDefault();
      const id=$('#readingBookId').value;
      const {error}=await sb.rpc('pf_record_reading_session',{
        p_book_id:id,
        p_new_page:Math.round(num($('#readingNewPage').value)),
        p_minutes:Math.round(num($('#readingMinutes').value)),
        p_read_on:$('#readingDate').value,
        p_note:$('#readingNote').value.trim()||null
      });
      if (error) { console.error(error); toast(error.message||'Не удалось записать чтение','error'); }
      else { toast('Чтение записано'); $('#readingDialog').close(); if (readingTimer.bookId===id && timerElapsedMs()>0) resetReadingTimer(); }
      await loadAll({silent:true});
    });

    $('#mediaForm').addEventListener('submit', async e => {
      e.preventDefault();
      const id=$('#mediaId').value;
      const type=$('#mediaType').value, status=$('#mediaStatus').value;
      const payload={
        title:$('#mediaTitle').value.trim(),
        media_type:type,
        status,
        cover_url:$('#mediaCover').value.trim()||null,
        release_year:$('#mediaYear').value?Math.round(num($('#mediaYear').value)):null,
        rating:num($('#mediaRating').value),
        favorite:$('#mediaFavorite').checked,
        season_current:type==='series'?Math.round(num($('#mediaSeasonCurrent').value)):0,
        seasons_total:type==='series'?Math.round(num($('#mediaSeasonsTotal').value)):0,
        episode_current:type==='series'?Math.round(num($('#mediaEpisodeCurrent').value)):0,
        episodes_total:type==='series'?Math.round(num($('#mediaEpisodesTotal').value)):0,
        watched_on:$('#mediaWatchedOn').value||(status==='watched'?todayISO():null),
        notes:$('#mediaNotes').value.trim()||null
      };
      const result=id?await sb.from('pf_media').update(payload).eq('id',id):await sb.from('pf_media').insert({...payload,user_id:user.id});
      if (result.error) { console.error(result.error); toast('Не удалось сохранить','error'); }
      else { toast(id?'Запись обновлена':'Добавлено'); $('#mediaDialog').close(); }
      await loadAll({silent:true});
    });

    $('#deleteMediaBtn').onclick = async () => {
      const id=$('#mediaId').value; if (!id || !confirm('Удалить фильм или сериал?')) return;
      const {error}=await sb.from('pf_media').delete().eq('id',id);
      if (error) toast('Не удалось удалить','error'); else { toast('Удалено'); $('#mediaDialog').close(); }
      await loadAll({silent:true});
    };

    $('#moodForm').addEventListener('submit', async e => {
      e.preventDefault();
      const mood=num($('#moodValue').value); if (!mood) { toast('Выберите настроение','error'); return; }
      const payload={user_id:user.id,day:$('#moodDate').value,mood,note:$('#moodNote').value.trim()||null};
      const {error}=await sb.from('pf_moods').upsert(payload,{onConflict:'user_id,day'});
      if (error) { console.error(error); toast('Не удалось сохранить настроение','error'); }
      else { toast('Настроение сохранено'); $('#moodDialog').close(); }
      await loadAll({silent:true});
    });

    $('#sleepForm').addEventListener('submit', async e => {
      e.preventDefault();
      const bed=$('#sleepBedTime').value, wake=$('#sleepWakeTime').value;
      const duration=sleepDurationMinutes(bed,wake);
      if (!duration) { toast('Проверьте время сна','error'); return; }
      const payload={user_id:user.id,day:$('#sleepDate').value,bed_time:bed,wake_time:wake,duration_minutes:duration,quality:num($('#sleepQuality').value),note:$('#sleepNote').value.trim()||null};
      const {error}=await sb.from('pf_sleep').upsert(payload,{onConflict:'user_id,day'});
      if (error) { console.error(error); toast('Не удалось сохранить сон','error'); }
      else { toast('Сон сохранён'); $('#sleepDialog').close(); }
      await loadAll({silent:true});
    });

    $('#debtEditForm').addEventListener('submit', async e => {
      e.preventDefault();
      const id = $('#debtEditId').value;
      const balance = num($('#debtEditBalance').value);
      const payload = {name:$('#debtEditName').value.trim(),current_balance:balance,apr:num($('#debtEditApr').value),min_payment:num($('#debtEditMin').value),target_date:$('#debtEditTarget').value || null,priority:num($('#debtEditPriority').value || 5)};
      let result;
      if (id) result = await sb.from('pf_debts').update(payload).eq('id',id);
      else result = await sb.from('pf_debts').insert({...payload,user_id:user.id,debt_type:'other',initial_balance:balance,active:true});
      if (result.error) toast(id ? 'Не удалось обновить долг' : 'Не удалось добавить долг','error');
      else { toast(id ? 'Долг обновлён' : 'Долг добавлен'); $('#debtDialog').close(); }
      await loadAll({silent:true});
    });

    $('#paymentForm').addEventListener('submit', async e => {
      e.preventDefault();
      const debtId = $('#paymentDebtId').value;
      const amount = num($('#paymentAmount').value);
      const d = state.debts.find(x=>x.id===debtId);
      if (!d || amount <= 0) return;
      if (amount > num(d.current_balance)) {
        if (!confirm('Платёж больше текущего остатка. Записать его всё равно? Остаток станет 0 ₽.')) return;
      }
      const {error} = await sb.rpc('pf_record_debt_payment',{p_debt_id:debtId,p_amount:amount,p_paid_on:$('#paymentDate').value,p_note:$('#paymentNote').value.trim() || null});
      if (error) { console.error(error); toast('Не удалось записать платёж','error'); }
      else { toast('Платёж записан'); $('#paymentDialog').close(); }
      await loadAll({silent:true});
    });
  }

  async function logout() {
    await sb.auth.signOut();
    user = null;
    showApp(false);
  }

  async function onSession(session) {
    user = session?.user || null;
    if (!user) { showApp(false); return; }
    showApp(true);
    $('#incomeDate').value = todayISO();
    $('#expenseDate').value = todayISO();
    $('#taskDate').value = todayISO();
    $('#habitMonth').value = currentMonthISO();
    $('#readingMonth').value = currentMonthISO();
    $('#moodMonth').value = currentMonthISO();
    $('#sleepMonth').value = currentMonthISO();
    $('#readingDate').value = todayISO();
    $('#moodDate').value = todayISO();
    $('#sleepDate').value = todayISO();
    $('#paymentDate').value = todayISO();
    setSync('Подготовка…', true);
    await ensureDefaults();
    await loadAll();
  }

  async function init() {
    bindUI();
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_URL.includes('ВАШ')) {
      $('#configWarning').textContent = 'Сначала заполните SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY в config.js.';
      $('#configWarning').classList.remove('hidden');
      $('#authSubmit').disabled = true;
      return;
    }
    if (!window.supabase) {
      $('#configWarning').textContent = 'Не удалось загрузить библиотеку Supabase. Проверьте интернет.';
      $('#configWarning').classList.remove('hidden');
      return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
    const {data} = await sb.auth.getSession();
    await onSession(data.session);
    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id !== user?.id) onSession(session);
    });
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) { navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(console.warn); }
    window.addEventListener('focus',()=>{ if (user) loadAll({silent:true}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
