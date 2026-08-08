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
  let bookShelfFilter = 'all';
  let mediaShelfFilter = 'all';
  let financeSubtab = 'overview';
  let planSubtab = 'goals';
  let stateSubtab = 'energy';
  let state = {
    settings: { monthly_income_target: 110000, yearly_book_goal: 24, daily_reading_goal_minutes: 20, sleep_goal_hours: 8, theme: 'violet' },
    debts: [], fixed: [], incomes: [], expenses: [], payments: [], habits: [], habitLogs: [], tasks: [],
    books: [], readingLogs: [], media: [], moods: [], sleep: [],
    goals: [], projects: [], projectSteps: [], monthPlans: [], monthEvents: [], weeklyReviews: [], inbox: [], energy: [], courses: [], achievements: [], lifeWheel: []
  };

  const moodMeta = {
    1: { emoji: '😣', label: 'Очень плохо' },
    2: { emoji: '😕', label: 'Плохо' },
    3: { emoji: '😐', label: 'Нормально' },
    4: { emoji: '🙂', label: 'Хорошо' },
    5: { emoji: '🤩', label: 'Отлично' }
  };
  const bookStatusLabels = { reading:'Читаю', wishlist:'Хочу прочитать', finished:'Прочитано', paused:'Отложено' };
  const bookFormatLabels = { paper:'📖 Бумажная', ebook:'📱 Электронная', audio:'🎧 Аудиокнига', other:'Формат не указан' };
  const mediaStatusLabels = { wishlist:'Хочу посмотреть', watching:'Смотрю', watched:'Просмотрено', dropped:'Брошено' };
  const mediaTypeLabels = { movie:'Фильм', series:'Сериал' };
  const allowedThemes = new Set(['violet','rose','ocean','sage','peach']);

  function applyTheme(theme) {
    const value = allowedThemes.has(theme) ? theme : 'violet';
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem('pf_theme', value); } catch (_) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    const colors = { violet:'#6f5cff', rose:'#d96b8b', ocean:'#3f83c5', sage:'#5f8f72', peach:'#d77b55' };
    if (meta) meta.setAttribute('content', colors[value]);
    return value;
  }

  applyTheme((() => { try { return localStorage.getItem('pf_theme') || 'violet'; } catch (_) { return 'violet'; } })());

  let readingTimer = { running:false, startedAt:null, accumulated:0, bookId:null, tick:null };

  const tabMeta = {
    dashboard: ['Сегодня', 'Главное на сегодня без лишнего шума'],
    finance: ['Финансы', 'Доходы, расходы, долги и свободный остаток в одном месте'],
    habits: ['Привычки', 'Трекер на каждый день месяца'],
    tasks: ['Задачи', 'Работа, репетиторство и домашние дела'],
    plan: ['Планирование', 'Цели, проекты, месяц, неделя и Inbox'],
    books: ['Книги', 'Библиотека, прогресс, дневник и статистика чтения'],
    media: ['Фильмы и сериалы', 'Хочу посмотреть, смотрю и уже посмотрела'],
    mood: ['Настроение', 'Как менялось ваше настроение по дням'],
    sleep: ['Сон', 'Длительность и качество сна по дням'],
    state: ['Состояние', 'Энергия, стресс, самочувствие и баланс сфер жизни'],
    growth: ['Развитие', 'Курсы, обучение и навыки с понятным прогрессом'],
    results: ['Итоги', 'Достижения и ваш год в цифрах'],
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
    if (tab === 'plan') renderPlanning();
    if (tab === 'state') renderState();
    if (tab === 'growth') renderGrowth();
    if (tab === 'results') renderResults();
  }

  function switchFinanceView(view = 'overview') {
    financeSubtab = ['overview','incomes','expenses','debts'].includes(view) ? view : 'overview';
    $$('.finance-view').forEach(el => el.classList.toggle('active', el.id === `finance-view-${financeSubtab}`));
    $$('[data-finance-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.financeTab === financeSubtab));
  }

  function switchPlanView(view = 'goals') {
    planSubtab = ['goals','projects','month','week','inbox'].includes(view) ? view : 'goals';
    $$('.plan-tabs [data-plan-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.planTab === planSubtab));
    $$('[id^="plan-view-"]').forEach(el => el.classList.toggle('active', el.id === `plan-view-${planSubtab}`));
    if (planSubtab === 'month') renderMonthPlan();
    if (planSubtab === 'week') renderWeeklyReview();
  }

  function switchStateView(view = 'energy') {
    stateSubtab = ['energy','wheel'].includes(view) ? view : 'energy';
    $$('.state-tabs [data-state-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.stateTab === stateSubtab));
    $$('[id^="state-view-"]').forEach(el => el.classList.toggle('active', el.id === `state-view-${stateSubtab}`));
    if (stateSubtab === 'wheel') renderLifeWheel();
  }

  function monthFirst(ym) { return `${ym}-01`; }
  function mondayOf(iso) { const d=new Date((iso||todayISO())+'T12:00:00'); const day=d.getDay()||7; d.setDate(d.getDate()-day+1); return d.toISOString().slice(0,10); }
  function inRange(date,start,end){ return !!date && date>=start && date<=end; }


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
    const [settings, debts, fixed, incomes, expenses, payments, habits, habitLogs, tasks, books, readingLogs, media, moods, sleep, goals, projects, projectSteps, monthPlans, monthEvents, weeklyReviews, inbox, energy, courses, achievements, lifeWheel] = await Promise.all([
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
      sb.from('pf_sleep').select('*').eq('user_id', uid).order('day', {ascending:false}),
      sb.from('pf_goals').select('*').eq('user_id', uid).order('created_at', {ascending:false}),
      sb.from('pf_projects').select('*').eq('user_id', uid).order('updated_at', {ascending:false}),
      sb.from('pf_project_steps').select('*').eq('user_id', uid).order('sort_order').order('created_at'),
      sb.from('pf_month_plans').select('*').eq('user_id', uid).order('month', {ascending:false}),
      sb.from('pf_month_events').select('*').eq('user_id', uid).order('event_date', {ascending:true}),
      sb.from('pf_weekly_reviews').select('*').eq('user_id', uid).order('week_start', {ascending:false}),
      sb.from('pf_inbox').select('*').eq('user_id', uid).order('created_at', {ascending:false}),
      sb.from('pf_energy').select('*').eq('user_id', uid).order('day', {ascending:false}),
      sb.from('pf_courses').select('*').eq('user_id', uid).order('updated_at', {ascending:false}),
      sb.from('pf_achievements').select('*').eq('user_id', uid).order('achieved_on', {ascending:false}),
      sb.from('pf_life_wheel').select('*').eq('user_id', uid).order('month', {ascending:false})
    ]);

    const errors = [settings,debts,fixed,incomes,expenses,payments,habits,habitLogs,tasks,books,readingLogs,media,moods,sleep,goals,projects,projectSteps,monthPlans,monthEvents,weeklyReviews,inbox,energy,courses,achievements,lifeWheel].map(x=>x.error).filter(Boolean);
    if (errors.length) {
      console.error(errors);
      toast('Не удалось загрузить часть данных. Проверьте supabase.sql.', 'error');
      setSync('Ошибка', false);
      return;
    }

    state.settings = settings.data || { monthly_income_target: 110000, theme: 'violet' };
    state.settings.theme = applyTheme(state.settings.theme || 'violet');
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
    state.goals = goals.data || []; state.projects = projects.data || []; state.projectSteps = projectSteps.data || [];
    state.monthPlans = monthPlans.data || []; state.monthEvents = monthEvents.data || []; state.weeklyReviews = weeklyReviews.data || [];
    state.inbox = inbox.data || []; state.energy = energy.data || []; state.courses = courses.data || [];
    state.achievements = achievements.data || []; state.lifeWheel = lifeWheel.data || [];

    renderAll();
    setSync('Синхронизировано', false);
  }

  function renderAll() {
    $('#userEmail').textContent = user?.email || '';
    $('#monthlyIncomeTarget').value = num(state.settings.monthly_income_target || 110000);
    $('#yearlyBookGoal').value = num(state.settings.yearly_book_goal || 24);
    $('#dailyReadingGoal').value = num(state.settings.daily_reading_goal_minutes || 20);
    $('#sleepGoalHours').value = num(state.settings.sleep_goal_hours || 8);
    const currentTheme = applyTheme(state.settings.theme || 'violet');
    $$('input[name="cabinetTheme"]').forEach(r => { r.checked = r.value === currentTheme; });
    renderDashboard();
    renderFinanceSummary();
    renderDebts();
    renderIncomes();
    renderExpenses();
    renderHabits();
    renderTasks();
    renderBooks();
    renderMedia();
    renderMood();
    renderSleep();
    renderPlanning();
    renderState();
    renderGrowth();
    renderResults();
    renderTodayOverview();
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

  // ===== v10: планирование, состояние, развитие, итоги =====
  const goalCategoryMeta = {finance:'💰 Финансы',work:'💼 Работа',growth:'🎓 Развитие',home:'🏠 Дом',health:'🌿 Самочувствие',other:'✨ Другое'};
  const projectAreaMeta = {work:'💼 Работа',tutoring:'📚 Репетиторство',content:'📱 Контент',home:'🏠 Дом',personal:'✨ Личное',other:'Другое'};
  const wheelAreas = [['finance','Финансы'],['work','Работа'],['growth','Развитие'],['rest','Отдых'],['health','Здоровье / энергия'],['home','Дом'],['relationships','Отношения'],['creativity','Творчество']];

  function renderTodayOverview() {
    if (!$('#todayHeroDate')) return;
    const fmt=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'});
    const label=fmt.format(new Date(todayISO()+'T12:00:00'));
    $('#todayHeroDate').textContent=label.charAt(0).toUpperCase()+label.slice(1);
    const ym=currentMonthISO();
    const plan=state.monthPlans.find(x=>String(x.month).slice(0,7)===ym);
    $('#todayFocusText').textContent=plan?.focus||'Главный фокус месяца пока не задан.';
    const inc=state.incomes.filter(x=>isInMonth(x.received_on,ym)).reduce((s,x)=>s+num(x.amount),0);
    const exp=state.expenses.filter(x=>isInMonth(x.spent_on,ym)).reduce((s,x)=>s+num(x.amount),0);
    const pay=state.payments.filter(x=>isInMonth(x.paid_on,ym)).reduce((s,x)=>s+num(x.amount),0);
    $('#todayFreeMoney').textContent=money(inc-exp-pay);
    const mood=state.moods.find(x=>x.day===todayISO()); $('#todayMoodMini').textContent=mood?(moodMeta[mood.mood]?.emoji||mood.mood):'—';
    const sleep=state.sleep.find(x=>x.day===todayISO())||state.sleep[0]; $('#todaySleepMini').textContent=sleep?`${(num(sleep.duration_minutes)/60).toFixed(1)} ч`:'—';
    const en=state.energy.find(x=>x.day===todayISO()); $('#todayEnergyMini').textContent=en?`${en.energy}/5`:'—';
  }

  function renderPlanning(){
    $('#planGoalsCount').textContent=state.goals.filter(x=>x.status==='active').length+state.debts.filter(x=>x.active!==false&&num(x.current_balance)>0).length;
    $('#planProjectsCount').textContent=state.projects.filter(x=>x.status==='active').length;
    $('#planInboxCount').textContent=state.inbox.filter(x=>x.status==='inbox').length;
    const p=state.monthPlans.find(x=>String(x.month).slice(0,7)===currentMonthISO()); $('#planMonthFocusMini').textContent=p?.focus?(p.focus.length>22?p.focus.slice(0,22)+'…':p.focus):'—';
    renderGoals();renderProjects();renderInbox();switchPlanView(planSubtab);
  }
  function goalProgressCard(title,meta,current,target,unit='',deadline='',extra=''){
    const pct=target>0?clamp(current/target*100,0,100):0;
    return `<article class="goal-card"><div class="goal-card-head"><div><span class="status-pill">${esc(meta)}</span><h4>${esc(title)}</h4></div><strong>${Math.round(pct)}%</strong></div><div class="progress"><span style="width:${pct}%"></span></div><div class="goal-values"><span>${esc(String(current))}${unit?' '+esc(unit):''}</span><span>из ${esc(String(target))}${unit?' '+esc(unit):''}</span></div>${deadline?`<div class="muted">Срок: ${prettyDate(deadline)}</div>`:''}${extra}</article>`;
  }
  function renderGoals(){
    const auto=[];
    state.debts.filter(d=>d.active!==false).forEach(d=>{const initial=Math.max(num(d.initial_balance),num(d.current_balance));const paid=Math.max(0,initial-num(d.current_balance));auto.push(goalProgressCard(`Закрыть: ${d.name}`,'Автоматическая · Финансы',Math.round(paid),Math.round(initial),'₽',d.target_date,`<div class="goal-foot"><span>Осталось ${money(d.current_balance)}</span></div>`));});
    const year=new Date().getFullYear(), finished=state.books.filter(b=>b.status==='finished'&&(b.finished_on||'').startsWith(String(year))).length, target=num(state.settings.yearly_book_goal||24);
    auto.push(goalProgressCard('Книжная цель года','Автоматическая · Книги',finished,target,'книг',`${year}-12-31`));
    $('#automaticGoals').innerHTML=auto.join('');
    $('#customGoals').innerHTML=state.goals.length?state.goals.map(g=>{const pct=num(g.target_value)>0?clamp(num(g.current_value)/num(g.target_value)*100,0,100):(g.status==='done'?100:0);return `<article class="goal-card ${g.status==='done'?'done-card':''}"><div class="goal-card-head"><div><span class="status-pill">${goalCategoryMeta[g.category]||'✨ Другое'}</span><h4>${esc(g.title)}</h4></div><button class="text-btn edit-goal" data-id="${g.id}">Изменить</button></div><div class="progress"><span style="width:${pct}%"></span></div><div class="goal-values"><span>${num(g.current_value)} ${esc(g.unit||'')}</span><span>${num(g.target_value)} ${esc(g.unit||'')}</span></div><div class="goal-foot"><span>${g.status==='done'?'✓ Готово':g.status==='paused'?'На паузе':'В работе'}</span><span>${g.target_date?prettyDate(g.target_date):'Без срока'}</span></div>${g.notes?`<p class="card-note">${esc(g.notes)}</p>`:''}</article>`;}).join(''):'<article class="panel"><div class="empty">Добавьте первую личную цель.</div></article>';
    $$('.edit-goal').forEach(b=>b.onclick=()=>openGoalEdit(b.dataset.id));
  }
  function renderProjects(){
    $('#projectsList').innerHTML=state.projects.length?state.projects.map(p=>{const steps=state.projectSteps.filter(s=>s.project_id===p.id),done=steps.filter(s=>s.completed).length,pct=steps.length?Math.round(done/steps.length*100):num(p.progress);return `<article class="project-card"><div class="project-card-head"><div><span class="status-pill ${p.status==='done'?'finished':p.status==='paused'?'paused':p.status==='active'?'reading':''}">${projectAreaMeta[p.area]||'Проект'} · ${p.status==='done'?'Готово':p.status==='active'?'В работе':p.status==='paused'?'Пауза':'План'}</span><h4>${esc(p.title)}</h4></div><button class="text-btn edit-project" data-id="${p.id}">Изменить</button></div><div class="progress"><span style="width:${clamp(pct,0,100)}%"></span></div><div class="project-meta"><span>${steps.length?`${done}/${steps.length} этапов`:`${Math.round(pct)}%`}</span><span>${p.deadline?`до ${prettyDate(p.deadline)}`:'без дедлайна'}</span></div><div class="project-steps">${steps.map(s=>`<label class="project-step ${s.completed?'done':''}"><input class="project-step-check" type="checkbox" data-id="${s.id}" ${s.completed?'checked':''}/><span>${esc(s.title)}</span><button class="project-step-delete" data-id="${s.id}" type="button">✕</button></label>`).join('')||'<div class="empty">Этапов пока нет.</div>'}</div><div class="row gap-sm"><button class="btn ghost small-btn add-project-step" type="button" data-project="${p.id}">+ Этап</button><button class="btn ghost small-btn project-to-task" type="button" data-project="${p.id}">+ Задача</button></div></article>`;}).join(''):'<article class="panel"><div class="empty">Создайте первый проект.</div></article>';
    $$('.edit-project').forEach(b=>b.onclick=()=>openProjectEdit(b.dataset.id));$$('.add-project-step').forEach(b=>b.onclick=()=>openProjectStep(b.dataset.project));$$('.project-step-check').forEach(c=>c.onchange=()=>toggleProjectStep(c.dataset.id,c.checked));$$('.project-to-task').forEach(b=>b.onclick=()=>{switchTab('tasks');$('#taskProject').value=b.dataset.project;$('#taskTitle').focus();});$$('.project-step-delete').forEach(b=>b.onclick=()=>deleteRow('pf_project_steps',b.dataset.id,'Этап удалён'));
  }
  function renderMonthPlan(){
    const ym=$('#monthPlanMonth')?.value||currentMonthISO();if($('#monthPlanMonth')&&!$('#monthPlanMonth').value)$('#monthPlanMonth').value=ym;
    const p=state.monthPlans.find(x=>String(x.month).slice(0,7)===ym);$('#monthFocus').value=p?.focus||'';$('#monthPriority1').value=p?.priority1||'';$('#monthPriority2').value=p?.priority2||'';$('#monthPriority3').value=p?.priority3||'';$('#monthNotes').value=p?.notes||'';
    if($('#monthEventDate')&&!$('#monthEventDate').value?.startsWith(ym))$('#monthEventDate').value=`${ym}-01`;
    const rows=state.monthEvents.filter(x=>(x.event_date||'').startsWith(ym)).map(x=>({date:x.event_date,title:x.title,type:x.event_type,amount:x.amount,id:x.id,source:'event'}));
    state.goals.filter(g=>g.target_date?.startsWith(ym)).forEach(g=>rows.push({date:g.target_date,title:`Цель: ${g.title}`,type:'deadline',source:'goal'}));state.projects.filter(p=>p.deadline?.startsWith(ym)).forEach(p=>rows.push({date:p.deadline,title:`Проект: ${p.title}`,type:'deadline',source:'project'}));state.tasks.filter(t=>t.task_date?.startsWith(ym)&&!t.completed).forEach(t=>rows.push({date:t.task_date,title:`Задача: ${t.title}`,type:'task',source:'task'}));rows.sort((a,b)=>a.date.localeCompare(b.date));
    const icons={event:'📌',payment:'💳',purchase:'🛍️',birthday:'🎂',deadline:'⏰',task:'📋',other:'•'};$('#monthTimeline').innerHTML=rows.length?rows.map(e=>`<div class="timeline-row"><div class="timeline-date">${prettyDate(e.date)}</div><div class="timeline-dot">${icons[e.type]||'•'}</div><div class="timeline-content"><strong>${esc(e.title)}</strong>${num(e.amount)>0?`<span>${money(e.amount)}</span>`:''}</div>${e.source==='event'?`<button class="text-btn delete-month-event" data-id="${e.id}">Удалить</button>`:''}</div>`).join(''):'<div class="empty">На этот месяц пока нет важных дат.</div>';$$('.delete-month-event').forEach(b=>b.onclick=()=>deleteRow('pf_month_events',b.dataset.id,'Событие удалено'));
  }
  function weekBoundsFromDate(date){const start=mondayOf(date);return {start,end:addDaysISO(start,6)};}
  function renderWeeklyReview(){
    const date=$('#weeklyReviewDate')?.value||todayISO();if($('#weeklyReviewDate')&&!$('#weeklyReviewDate').value)$('#weeklyReviewDate').value=date;const {start,end}=weekBoundsFromDate(date),r=state.weeklyReviews.find(x=>x.week_start===start);$('#weekWins').value=r?.wins||'';$('#weekChallenges').value=r?.challenges||'';$('#weekDrained').value=r?.drained||'';$('#weekNextFocus').value=r?.next_focus||'';$('#weekScore').value=String(r?.score||8);
    const tasks=state.tasks.filter(t=>inRange(t.task_date,start,end)),done=tasks.filter(t=>t.completed).length,reading=state.readingLogs.filter(x=>inRange(x.read_on,start,end)).reduce((s,x)=>s+num(x.minutes),0),moods=state.moods.filter(x=>inRange(x.day,start,end)),sleeps=state.sleep.filter(x=>inRange(x.day,start,end));const am=moods.length?moods.reduce((s,x)=>s+num(x.mood),0)/moods.length:0,as=sleeps.length?sleeps.reduce((s,x)=>s+num(x.duration_minutes),0)/sleeps.length/60:0;
    $('#weeklyAutoStats').innerHTML=`<article class="summary-card"><span>Задачи</span><strong>${done}/${tasks.length}</strong><small>выполнено</small></article><article class="summary-card"><span>Чтение</span><strong>${reading} мин</strong><small>за неделю</small></article><article class="summary-card"><span>Настроение</span><strong>${am?am.toFixed(1):'—'}</strong><small>из 5</small></article><article class="summary-card"><span>Сон</span><strong>${as?as.toFixed(1)+' ч':'—'}</strong><small>в среднем</small></article>`;
    $('#weeklyReviewHistory').innerHTML=state.weeklyReviews.length?state.weeklyReviews.slice(0,10).map(x=>`<div class="journal-row"><div><strong>Неделя с ${prettyDate(x.week_start)}</strong><span>Оценка ${x.score}/10${x.next_focus?` · Фокус: ${esc(x.next_focus)}`:''}</span></div><button class="text-btn load-week-review" data-date="${x.week_start}">Открыть</button></div>`).join(''):'<div class="empty">Сохранённых обзоров пока нет.</div>';$$('.load-week-review').forEach(b=>b.onclick=()=>{$('#weeklyReviewDate').value=b.dataset.date;renderWeeklyReview();});
  }
  function renderInbox(){
    const rows=state.inbox.filter(x=>x.status==='inbox');$('#inboxList').innerHTML=rows.length?rows.map(x=>`<article class="inbox-row"><div class="inbox-main"><span class="status-pill">${x.item_type==='idea'?'💡 Идея':x.item_type==='task'?'📋 Задача':x.item_type==='purchase'?'🛍️ Покупка':x.item_type==='content'?'📱 Контент':'Заметка'}</span><strong>${esc(x.text)}</strong><small>${new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(x.created_at))}</small></div><div class="inbox-actions"><button class="text-btn inbox-to" data-action="task" data-id="${x.id}">→ задача</button><button class="text-btn inbox-to" data-action="project" data-id="${x.id}">→ проект</button><button class="text-btn inbox-to" data-action="book" data-id="${x.id}">→ книга</button><button class="text-btn inbox-to" data-action="media" data-id="${x.id}">→ кино</button><button class="text-btn inbox-to" data-action="archive" data-id="${x.id}">✓ разобрано</button></div></article>`).join(''):'<article class="panel"><div class="empty">Inbox пуст — всё разобрано ✨</div></article>';$$('.inbox-to').forEach(b=>b.onclick=()=>processInbox(b.dataset.id,b.dataset.action));
  }
  function renderState(){renderEnergy();renderLifeWheel();switchStateView(stateSubtab);}
  function renderEnergy(){
    const ym=$('#energyMonth')?.value||currentMonthISO();if($('#energyMonth')&&!$('#energyMonth').value)$('#energyMonth').value=ym;const rows=state.energy.filter(x=>isInMonth(x.day,ym)),avg=k=>rows.length?rows.reduce((s,x)=>s+num(x[k]),0)/rows.length:0;$('#energyAverage').textContent=rows.length?avg('energy').toFixed(1):'—';$('#stressAverage').textContent=rows.length?avg('stress').toFixed(1):'—';$('#wellbeingAverage').textContent=rows.length?avg('wellbeing').toFixed(1):'—';$('#energyDaysCount').textContent=rows.length;$('#energyHistory').innerHTML=state.energy.slice(0,14).map(x=>`<div class="journal-row"><div><strong>${prettyDate(x.day)} · ⚡ ${x.energy}/5 · стресс ${x.stress}/5</strong><span>${x.note?esc(x.note):'Без заметки'}</span></div><button class="text-btn load-energy" data-day="${x.day}">Изменить</button></div>`).join('')||'<div class="empty">Записей пока нет.</div>';$$('.load-energy').forEach(b=>b.onclick=()=>loadEnergyDay(b.dataset.day));
  }
  function lifeWheelScores(ym){const v={};state.lifeWheel.filter(x=>String(x.month).slice(0,7)===ym).forEach(x=>v[x.area]=num(x.score));return v;}
  function renderLifeWheel(){const ym=$('#lifeWheelMonth')?.value||currentMonthISO();if($('#lifeWheelMonth')&&!$('#lifeWheelMonth').value)$('#lifeWheelMonth').value=ym;const scores=lifeWheelScores(ym);$('#lifeWheelInputs').innerHTML=wheelAreas.map(([key,label])=>{const v=scores[key]||5;return `<label class="wheel-input"><div><span>${esc(label)}</span><strong id="wheel-value-${key}">${v}</strong></div><input type="range" min="1" max="10" value="${v}" data-wheel-area="${key}" /></label>`;}).join('');$$('[data-wheel-area]').forEach(r=>r.oninput=()=>{$(`#wheel-value-${r.dataset.wheelArea}`).textContent=r.value;renderLifeWheelChart();});renderLifeWheelChart();}
  function renderLifeWheelChart(){const chart=$('#lifeWheelChart');if(!chart)return;const controls=$$('[data-wheel-area]'),vals=wheelAreas.map(([key])=>num(controls.find(x=>x.dataset.wheelArea===key)?.value||5)),cx=150,cy=150,R=112,n=wheelAreas.length,point=(i,r)=>{const a=-Math.PI/2+i*2*Math.PI/n;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];};let grid='';[2,4,6,8,10].forEach(level=>grid+=`<polygon points="${wheelAreas.map((_,i)=>point(i,R*level/10).join(',')).join(' ')}" fill="none" stroke="var(--border)"/>`);const axes=wheelAreas.map((_,i)=>{const p=point(i,R);return `<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}" stroke="var(--border)"/>`;}).join(''),poly=wheelAreas.map((_,i)=>point(i,R*vals[i]/10).join(',')).join(' '),labels=wheelAreas.map(([k,label],i)=>{const p=point(i,R+24);return `<text x="${p[0]}" y="${p[1]}" text-anchor="middle">${esc(label.split(' / ')[0])}</text>`;}).join('');chart.innerHTML=`<svg viewBox="0 0 300 300">${grid}${axes}<polygon class="wheel-result" points="${poly}"/>${labels}</svg>`;const avg=vals.reduce((a,b)=>a+b,0)/vals.length;$('#lifeWheelAverage').innerHTML=`Средний баланс: <strong>${avg.toFixed(1)}/10</strong>`;}
  function renderGrowth(){
    const active=state.courses.filter(x=>x.status==='active'),finished=state.courses.filter(x=>x.status==='finished'),wish=state.courses.filter(x=>x.status==='wishlist'),avg=active.length?active.reduce((s,x)=>s+(num(x.total_units)>0?clamp(num(x.completed_units)/num(x.total_units)*100,0,100):0),0)/active.length:0;$('#coursesActiveCount').textContent=active.length;$('#coursesFinishedCount').textContent=finished.length;$('#coursesWishlistCount').textContent=wish.length;$('#coursesAverageProgress').textContent=`${Math.round(avg)}%`;
    $('#coursesList').innerHTML=state.courses.length?state.courses.map(c=>{const pct=num(c.total_units)>0?clamp(num(c.completed_units)/num(c.total_units)*100,0,100):(c.status==='finished'?100:0);return `<article class="course-card"><div class="project-card-head"><div><span class="status-pill ${c.status==='finished'?'finished':c.status==='paused'?'paused':c.status==='active'?'reading':'wishlist'}">${c.status==='finished'?'Завершено':c.status==='active'?'Изучаю':c.status==='paused'?'Пауза':'Хочу изучить'}</span><h4>${esc(c.title)}</h4><span class="muted">${esc(c.provider||'')}</span></div><button class="text-btn edit-course" data-id="${c.id}">Изменить</button></div><div class="progress"><span style="width:${pct}%"></span></div><div class="project-meta"><span>${num(c.completed_units)} / ${num(c.total_units)||'—'} уроков</span><strong>${Math.round(pct)}%</strong></div>${c.url?`<a class="text-btn inline-link" href="${esc(c.url)}" target="_blank" rel="noopener">Открыть курс ↗</a>`:''}${c.notes?`<p class="card-note">${esc(c.notes)}</p>`:''}</article>`;}).join(''):'<article class="panel"><div class="empty">Добавьте курс или навык.</div></article>';$$('.edit-course').forEach(b=>b.onclick=()=>openCourseEdit(b.dataset.id));
  }
  function yearRange(year){return {start:`${year}-01-01`,end:`${year}-12-31`};}
  function renderResults(){
    const sel=$('#resultsYear'),current=new Date().getFullYear();if(!sel.options.length){for(let y=current;y>=current-5;y--){const o=document.createElement('option');o.value=y;o.textContent=y;sel.appendChild(o);}}const year=num(sel.value||current),{start,end}=yearRange(year),incomes=state.incomes.filter(x=>inRange(x.received_on,start,end)),expenses=state.expenses.filter(x=>inRange(x.spent_on,start,end)),payments=state.payments.filter(x=>inRange(x.paid_on,start,end)),books=state.books.filter(x=>x.status==='finished'&&inRange(x.finished_on,start,end)),media=state.media.filter(x=>x.status==='watched'&&inRange(x.watched_on,start,end)),tasks=state.tasks.filter(x=>inRange(x.task_date,start,end)),moods=state.moods.filter(x=>inRange(x.day,start,end)),sleeps=state.sleep.filter(x=>inRange(x.day,start,end)),energies=state.energy.filter(x=>inRange(x.day,start,end)),sum=(a,k)=>a.reduce((s,x)=>s+num(x[k]),0),avg=(a,k)=>a.length?sum(a,k)/a.length:0;
    const income=sum(incomes,'amount'),expense=sum(expenses,'amount'),debt=sum(payments,'amount');$('#yearStats').innerHTML=`<article class="year-stat"><span>💰 Доход</span><strong>${money(income)}</strong></article><article class="year-stat"><span>🧾 Расходы</span><strong>${money(expense)}</strong></article><article class="year-stat"><span>💳 На долги</span><strong>${money(debt)}</strong></article><article class="year-stat"><span>📚 Книги</span><strong>${books.length}</strong></article><article class="year-stat"><span>🎬 Просмотрено</span><strong>${media.length}</strong></article><article class="year-stat"><span>✅ Задачи</span><strong>${tasks.filter(x=>x.completed).length}</strong></article><article class="year-stat"><span>😊 Настроение</span><strong>${moods.length?avg(moods,'mood').toFixed(1):'—'}</strong></article><article class="year-stat"><span>😴 Сон</span><strong>${sleeps.length?(avg(sleeps,'duration_minutes')/60).toFixed(1)+' ч':'—'}</strong></article><article class="year-stat"><span>🌿 Энергия</span><strong>${energies.length?avg(energies,'energy').toFixed(1):'—'}</strong></article>`;
    const auto=[];state.debts.filter(d=>num(d.current_balance)<=0).forEach(d=>auto.push(['💳',`Закрыт долг «${d.name}»`]));if(books.length>=5)auto.push(['📚',`Прочитано ${books.length} книг за год`]);if(books.length>=10)auto.push(['🔥','10+ книг за год']);if(media.length>=25)auto.push(['🎬',`${media.length} фильмов и сериалов просмотрено`]);const dt=tasks.filter(x=>x.completed).length;if(dt>=100)auto.push(['✅',`${dt} выполненных задач`]);const fc=state.courses.filter(c=>c.status==='finished'&&(!c.finished_on||inRange(c.finished_on,start,end))).length;if(fc)auto.push(['🎓',`Завершено курсов: ${fc}`]);if(income>0){const ms={};incomes.forEach(x=>{const m=x.received_on.slice(0,7);ms[m]=(ms[m]||0)+num(x.amount)});const best=Object.entries(ms).sort((a,b)=>b[1]-a[1])[0];if(best)auto.push(['💰',`Лучший месяц по доходу: ${money(best[1])}`]);}$('#autoAchievements').innerHTML=auto.length?auto.map(([i,t])=>`<div class="achievement-card"><span>${i}</span><strong>${esc(t)}</strong></div>`).join(''):'<div class="empty">Автоматические достижения появятся по мере заполнения кабинета.</div>';
    const manual=state.achievements.filter(a=>inRange(a.achieved_on,start,end));$('#manualAchievements').innerHTML=manual.length?manual.map(a=>`<div class="journal-row"><div><strong>${esc(a.title)}</strong><span>${prettyDate(a.achieved_on)}${a.note?' · '+esc(a.note):''}</span></div><button class="text-btn delete-achievement" data-id="${a.id}">Удалить</button></div>`).join(''):'<div class="empty">Добавьте личное достижение.</div>';$$('.delete-achievement').forEach(b=>b.onclick=()=>deleteRow('pf_achievements',b.dataset.id,'Достижение удалено'));
  }

  function renderFinanceSummary() {
    const ym = currentMonthISO();
    const monthIncomes = state.incomes.filter(x=>isInMonth(x.received_on,ym));
    const monthExpenses = state.expenses.filter(x=>isInMonth(x.spent_on,ym));
    const monthPayments = state.payments.filter(x=>isInMonth(x.paid_on,ym));

    const income = monthIncomes.reduce((s,x)=>s+num(x.amount),0);
    const expenses = monthExpenses.reduce((s,x)=>s+num(x.amount),0);
    const debts = monthPayments.reduce((s,x)=>s+num(x.amount),0);
    const balance = income - expenses - debts;
    const cardIncome = monthIncomes.filter(x=>(x.income_method||'other')==='card').reduce((s,x)=>s+num(x.amount),0);
    const cashIncome = monthIncomes.filter(x=>(x.income_method||'other')==='cash').reduce((s,x)=>s+num(x.amount),0);

    const put = (selector, value) => { const el=$(selector); if (el) el.textContent=money(value); };
    put('#financeIncomeTotal', income);
    put('#financeExpenseTotal', expenses);
    put('#financeDebtTotal', debts);
    put('#financeBalanceTotal', balance);
    put('#financeCardIncome', cardIncome);
    put('#financeCashIncome', cashIncome);
    put('#financeOverviewIncome', income);
    put('#financeOverviewSpent', expenses);
    put('#financeOverviewDebt', debts);
    put('#financeOverviewBalance', balance);

    [$('#financeBalanceTotal'), $('#financeOverviewBalance')].filter(Boolean)
      .forEach(el => el.style.color = balance < 0 ? '#d95763' : 'var(--primary)');

    const planBox = $('#financeAllocationPlan');
    if (planBox) renderAllocation(planBox, buildPlan(), null);
    switchFinanceView(financeSubtab);
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
    const ym = $('#incomeAnalysisMonth')?.value || currentMonthISO();
    if ($('#incomeAnalysisMonth') && !$('#incomeAnalysisMonth').value) $('#incomeAnalysisMonth').value = ym;

    const month = state.incomes.filter(x=>isInMonth(x.received_on,ym));
    const total = month.reduce((s,x)=>s+num(x.amount),0);

    $('#incomeMonthTotal').textContent = money(total);
    $('#incomeAnalysisTotal').textContent = money(total);

    // Всегда показываем основные источники, даже если в месяце по ним было 0 ₽.
    const preferredSources = ['Школа','Репетиторство','Игры и материалы','Другое'];
    const sourceMap = new Map(preferredSources.map(name => [name, 0]));

    month.forEach(x => {
      const source = (x.category || 'Другое').trim() || 'Другое';
      sourceMap.set(source, (sourceMap.get(source) || 0) + num(x.amount));
    });

    const sources = [...sourceMap.entries()]
      .map(([name, amount]) => ({name, amount}))
      .sort((a,b)=>b.amount-a.amount);

    const nonZeroSources = sources.filter(x=>x.amount>0);
    const top = nonZeroSources[0] || null;

    $('#incomeSourceCount').textContent = nonZeroSources.length;
    $('#incomeAveragePayment').textContent = money(month.length ? total / month.length : 0);

    if (top) {
      const share = total > 0 ? top.amount / total * 100 : 0;
      $('#incomeTopSourceName').textContent = top.name;
      $('#incomeTopSourceAmount').textContent = money(top.amount);
      $('#incomeTopSourceShare').textContent = `${share.toFixed(1)}% всего дохода месяца`;
    } else {
      $('#incomeTopSourceName').textContent = '—';
      $('#incomeTopSourceAmount').textContent = money(0);
      $('#incomeTopSourceShare').textContent = 'Добавьте доходы, чтобы увидеть анализ.';
    }

    const maxAmount = top?.amount || 0;
    const sourceIcons = {
      'Школа':'🏫',
      'Репетиторство':'👩‍🏫',
      'Игры и материалы':'🎮',
      'Другое':'✨'
    };

    $('#incomeSourceCards').innerHTML = sources.map((s,index)=>{
      const share = total > 0 ? s.amount / total * 100 : 0;
      const bar = maxAmount > 0 ? s.amount / maxAmount * 100 : 0;
      return `<article class="income-source-card ${s.amount===0?'zero':''}">
        <div class="income-source-head">
          <div class="income-source-name">
            <span class="income-source-icon">${sourceIcons[s.name] || '💰'}</span>
            <div><strong>${esc(s.name)}</strong><small>${share.toFixed(1)}% общего дохода</small></div>
          </div>
          <strong class="income-source-amount">${money(s.amount)}</strong>
        </div>
        <div class="income-source-bar"><span style="width:${bar}%"></span></div>
      </article>`;
    }).join('');

    const monthLabel = new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'})
      .format(new Date(`${ym}-01T12:00:00`));
    $('#incomeHistoryPeriod').textContent = `За ${monthLabel}`;

    const rows = month.slice().sort((a,b)=>{
      const byDate = String(b.received_on).localeCompare(String(a.received_on));
      return byDate || String(b.created_at||'').localeCompare(String(a.created_at||''));
    });

    $('#incomeHistory').innerHTML = rows.length
      ? `<table><thead><tr><th>Дата</th><th>Источник</th><th>Получено</th><th>Комментарий</th><th>Сумма</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${prettyDate(x.received_on)}</td><td>${esc(x.category)}</td><td>${x.income_method==='cash'?'💵 Наличными':x.income_method==='card'?'💳 На карту':'—'}</td><td>${esc(x.note||'—')}</td><td class="amount-pos">+${money(x.amount)}</td><td class="table-actions"><button class="delete-income" data-id="${x.id}">Удалить</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Доходов за выбранный месяц пока нет.</div>';

    $$('.delete-income').forEach(b=>b.onclick=()=>deleteRow('pf_incomes',b.dataset.id,'Доход удалён'));
    updateSplitPreview();
  }

  function renderExpenses() {
    const ym = $('#expenseAnalysisMonth')?.value || currentMonthISO();
    if ($('#expenseAnalysisMonth') && !$('#expenseAnalysisMonth').value) $('#expenseAnalysisMonth').value = ym;

    const month = state.expenses.filter(x=>isInMonth(x.spent_on,ym));
    const total = month.reduce((s,x)=>s+num(x.amount),0);
    $('#expenseMonthTotal').textContent = money(total);
    $('#expenseAnalysisTotal').textContent = money(total);

    const categoryMap = new Map();
    month.forEach(x => {
      const category = (x.category || 'Другое').trim() || 'Другое';
      categoryMap.set(category, (categoryMap.get(category) || 0) + num(x.amount));
    });

    const categories = [...categoryMap.entries()]
      .map(([name, amount]) => ({name, amount}))
      .sort((a,b)=>b.amount-a.amount);

    const top = categories[0] || null;
    $('#expenseCategoryCount').textContent = categories.length;
    $('#expenseAverageCheck').textContent = money(month.length ? total / month.length : 0);

    if (top) {
      const share = total > 0 ? top.amount / total * 100 : 0;
      $('#expenseTopCategoryName').textContent = top.name;
      $('#expenseTopCategoryAmount').textContent = money(top.amount);
      $('#expenseTopCategoryShare').textContent = `${share.toFixed(1)}% всех расходов месяца`;
    } else {
      $('#expenseTopCategoryName').textContent = '—';
      $('#expenseTopCategoryAmount').textContent = money(0);
      $('#expenseTopCategoryShare').textContent = 'Добавьте расходы, чтобы увидеть анализ.';
    }

    const maxAmount = top?.amount || 0;
    $('#expenseCategoryBreakdown').innerHTML = categories.length
      ? categories.map((c,index)=>{
          const share = total > 0 ? c.amount / total * 100 : 0;
          const bar = maxAmount > 0 ? c.amount / maxAmount * 100 : 0;
          return `<div class="expense-category-row">
            <div class="expense-category-rank">${index+1}</div>
            <div class="expense-category-main">
              <div class="expense-category-line">
                <strong>${esc(c.name)}</strong>
                <span>${money(c.amount)} · ${share.toFixed(1)}%</span>
              </div>
              <div class="expense-category-bar"><span style="width:${bar}%"></span></div>
            </div>
          </div>`;
        }).join('')
      : '<div class="empty">В этом месяце пока нет расходов.</div>';

    const monthLabel = new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'})
      .format(new Date(`${ym}-01T12:00:00`));
    $('#expenseHistoryPeriod').textContent = `За ${monthLabel}`;

    const rows = month.slice().sort((a,b)=>{
      const byDate = String(b.spent_on).localeCompare(String(a.spent_on));
      return byDate || String(b.created_at||'').localeCompare(String(a.created_at||''));
    });

    $('#expenseHistory').innerHTML = rows.length
      ? `<table><thead><tr><th>Дата</th><th>Категория</th><th>Комментарий</th><th>Сумма</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${prettyDate(x.spent_on)}</td><td>${esc(x.category)}</td><td>${esc(x.note||'—')}</td><td class="amount-neg">−${money(x.amount)}</td><td class="table-actions"><button class="delete-expense" data-id="${x.id}">Удалить</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Расходов за выбранный месяц пока нет.</div>';

    $$('.delete-expense').forEach(b=>b.onclick=()=>deleteRow('pf_expenses',b.dataset.id,'Расход удалён'));

    $('#fixedExpensesList').innerHTML = state.fixed.length
      ? state.fixed.map(x=>`<div class="fixed-row"><span>${esc(x.name)}</span><strong>${money(x.monthly_amount)}</strong><button class="text-btn delete-fixed" data-id="${x.id}">Удалить</button></div>`).join('')
      : '<div class="empty">Постоянных расходов пока нет.</div>';
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
    const projectSelect=$('#taskProject');
    if (projectSelect) {
      const current=projectSelect.value;
      projectSelect.innerHTML='<option value="">Без проекта</option>'+state.projects.filter(p=>p.status!=='done').map(p=>`<option value="${p.id}">${esc(p.title)}</option>`).join('');
      if ([...projectSelect.options].some(o=>o.value===current)) projectSelect.value=current;
    }
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
    const project=state.projects.find(p=>p.id===t.project_id);
    return `<div class="task-row ${t.completed?'completed':''}"><input class="task-check" type="checkbox" ${t.completed?'checked':''} data-id="${t.id}" /><span class="task-text">${esc(t.title)}${project?`<small class="task-project-label">🚀 ${esc(project.title)}</small>`:''}</span><button class="task-delete" data-id="${t.id}" title="Удалить">✕</button></div>`;
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


  function setBookShelfFilter(filter, {scroll=false} = {}) {
    const allowed = new Set(['all','reading','wishlist','finished','paused','owned','favorite']);
    bookShelfFilter = allowed.has(filter) ? filter : 'all';
    renderBooks();
    if (scroll) {
      requestAnimationFrame(() => $('#booksLibrary')?.scrollIntoView({behavior:'smooth', block:'start'}));
    }
  }

  function timerEligibleBooks() {
    return state.books.filter(b => b.status !== 'finished');
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
        <div class="current-book-info"><strong>${esc(b.title)}</strong><small>${esc(b.author||'Автор не указан')} · ${bookFormatLabels[b.book_format||'other']} · ${total ? `${current} / ${total} стр.` : `стр. ${current}`}</small><div class="progress"><span style="width:${pct}%"></span></div></div>
        <button class="btn primary small book-log" data-id="${b.id}">Записать чтение</button>
      </div>`;
    }).join('') : '<div class="empty">Сейчас нет активной книги. Добавьте книгу со статусом «Читаю».</div>';

    const bookCounts = {
      all: state.books.length,
      reading: state.books.filter(b=>b.status==='reading').length,
      wishlist: state.books.filter(b=>b.status==='wishlist').length,
      finished: state.books.filter(b=>b.status==='finished').length,
      paused: state.books.filter(b=>b.status==='paused').length,
      owned: state.books.filter(b=>b.owned).length,
      favorite: state.books.filter(b=>b.favorite).length
    };
    $$('[data-book-filter]').forEach(btn => {
      const isActive = btn.dataset.bookFilter === bookShelfFilter;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      const count = btn.querySelector('[data-count]');
      if (count) count.textContent = bookCounts[btn.dataset.bookFilter] ?? 0;
    });

    const q = ($('#bookSearch')?.value || '').trim().toLowerCase();
    const status = bookShelfFilter;
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
          <div class="library-card-badges">
            <span class="status-pill ${b.status}">${bookStatusLabels[b.status] || b.status}</span>
            <span class="status-pill">${bookFormatLabels[b.book_format||'other']}</span>
          </div>
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
      if (error) {
        toast('Не удалось начать книгу','error');
        return;
      }
      toast('Книга перенесена в «Читаю»');
      bookShelfFilter='reading';
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
    $('#bookFormat').value='paper';
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
    document.body.classList.add('dialog-open');
    $('#bookDialog').showModal();
  }

  function openBookEdit(id) {
    const b=state.books.find(x=>x.id===id); if (!b) return;
    $('#bookDialogTitle').textContent='Редактировать книгу';
    $('#bookId').value=b.id;
    $('#bookTitle').value=b.title||'';
    $('#bookAuthor').value=b.author||'';
    $('#bookStatus').value=b.status||'wishlist';
    $('#bookFormat').value=(b.book_format && b.book_format!=='other') ? b.book_format : 'paper';
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
    document.body.classList.add('dialog-open');
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

    const status=$('#readingTimerStatus');
    if (status) {
      const book=state.books.find(b=>b.id===readingTimer.bookId);
      if (!book) status.textContent='Добавьте книгу, чтобы запустить таймер.';
      else if (readingTimer.running) status.textContent=`Сейчас читаем: ${book.title}`;
      else if (timerElapsedMs()>0) status.textContent=`Таймер на паузе · ${book.title}`;
      else if (book.status!=='reading') status.textContent=`${book.title} перейдёт в «Читаю» при запуске таймера.`;
      else status.textContent=`Готово к чтению: ${book.title}`;
    }
  }

  function renderReadingTimerOptions() {
    if (!readingTimer.loaded) restoreReadingTimer();
    const select=$('#readingTimerBook'); if (!select) return;

    const eligible=timerEligibleBooks();

    // Если в localStorage осталась удалённая/завершённая книга, сбрасываем старый таймер.
    if (readingTimer.bookId && !eligible.some(b=>b.id===readingTimer.bookId)) {
      readingTimer.running=false;
      readingTimer.startedAt=null;
      readingTimer.accumulated=0;
      clearInterval(readingTimer.tick);
      readingTimer.tick=null;
      readingTimer.bookId=null;
      saveReadingTimer();
    }

    const preferred=eligible.some(b=>b.id===readingTimer.bookId)
      ? readingTimer.bookId
      : (eligible.find(b=>b.status==='reading')?.id || eligible[0]?.id || '');

    if (!readingTimer.running) readingTimer.bookId=preferred;

    select.innerHTML=eligible.length
      ? eligible.map(b=>`<option value="${b.id}" ${b.id===readingTimer.bookId?'selected':''}>${bookStatusLabels[b.status]||b.status} · ${esc(b.title)}</option>`).join('')
      : '<option value="">Добавьте книгу</option>';

    $('#readingTimerToggle').disabled=!eligible.length;
    $('#readingTimerFinish').disabled=!readingTimer.bookId || timerElapsedMs()<=0;
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

    const mediaCounts = {
      all: state.media.length,
      wishlist: state.media.filter(m=>m.status==='wishlist').length,
      watching: state.media.filter(m=>m.status==='watching').length,
      watched: state.media.filter(m=>m.status==='watched').length,
      dropped: state.media.filter(m=>m.status==='dropped').length,
      favorite: state.media.filter(m=>m.favorite).length
    };
    $$('[data-media-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mediaFilter === mediaShelfFilter);
      const count = btn.querySelector('[data-count]');
      if (count) count.textContent = mediaCounts[btn.dataset.mediaFilter] ?? 0;
    });

    const q=($('#mediaSearch')?.value||'').trim().toLowerCase();
    const type=$('#mediaTypeFilter')?.value||'all';
    const status=mediaShelfFilter;
    const filtered=state.media.filter(m=>{
      const statusMatch = status==='all' || (status==='favorite' ? m.favorite : m.status===status);
      return (type==='all'||m.media_type===type) && statusMatch && (!q||m.title.toLowerCase().includes(q));
    });
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
          ${m.impression?`<div class="library-card-review">${esc(m.impression)}</div>`:''}
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
    $('#mediaWatchedOn').value=''; $('#mediaFavorite').checked=false; $('#mediaNotes').value=''; $('#mediaImpression').value='';
    $('#deleteMediaBtn').classList.add('hidden'); toggleMediaSeriesFields(); document.body.classList.add('dialog-open'); $('#mediaDialog').showModal();
  }

  function openMediaEdit(id) {
    const m=state.media.find(x=>x.id===id); if (!m) return;
    $('#mediaDialogTitle').textContent='Редактировать';
    $('#mediaId').value=m.id; $('#mediaTitle').value=m.title||''; $('#mediaType').value=m.media_type||'movie'; $('#mediaStatus').value=m.status||'wishlist';
    $('#mediaYear').value=m.release_year||''; $('#mediaCover').value=m.cover_url||''; $('#mediaRating').value=num(m.rating);
    $('#mediaSeasonCurrent').value=num(m.season_current); $('#mediaSeasonsTotal').value=num(m.seasons_total); $('#mediaEpisodeCurrent').value=num(m.episode_current); $('#mediaEpisodesTotal').value=num(m.episodes_total);
    $('#mediaWatchedOn').value=m.watched_on||''; $('#mediaFavorite').checked=!!m.favorite; $('#mediaNotes').value=m.notes||''; $('#mediaImpression').value=m.impression||'';
    $('#deleteMediaBtn').classList.remove('hidden'); toggleMediaSeriesFields(); document.body.classList.add('dialog-open'); $('#mediaDialog').showModal();
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

  function openGoalNew(){ $('#goalForm').reset();$('#goalId').value='';$('#goalDialogTitle').textContent='Новая цель';$('#goalTargetValue').value=100;$('#goalCurrentValue').value=0;$('#goalStatus').value='active';$('#deleteGoalBtn').classList.add('hidden');$('#goalDialog').showModal(); }
  function openGoalEdit(id){const g=state.goals.find(x=>x.id===id);if(!g)return;$('#goalId').value=g.id;$('#goalDialogTitle').textContent='Изменить цель';$('#goalTitle').value=g.title;$('#goalCategory').value=g.category||'other';$('#goalTargetDate').value=g.target_date||'';$('#goalTargetValue').value=num(g.target_value);$('#goalCurrentValue').value=num(g.current_value);$('#goalUnit').value=g.unit||'';$('#goalStatus').value=g.status||'active';$('#goalNotes').value=g.notes||'';$('#deleteGoalBtn').classList.remove('hidden');$('#goalDialog').showModal();}
  function openProjectNew(){ $('#projectForm').reset();$('#projectId').value='';$('#projectDialogTitle').textContent='Новый проект';$('#projectProgress').value=0;$('#projectStatus').value='planned';$('#deleteProjectBtn').classList.add('hidden');$('#projectDialog').showModal(); }
  function openProjectEdit(id){const p=state.projects.find(x=>x.id===id);if(!p)return;$('#projectId').value=p.id;$('#projectDialogTitle').textContent='Изменить проект';$('#projectTitle').value=p.title;$('#projectArea').value=p.area||'other';$('#projectStatus').value=p.status||'planned';$('#projectDeadline').value=p.deadline||'';$('#projectProgress').value=num(p.progress);$('#projectNotes').value=p.notes||'';$('#deleteProjectBtn').classList.remove('hidden');$('#projectDialog').showModal();}
  function openProjectStep(id){$('#projectStepForm').reset();$('#projectStepProjectId').value=id;$('#projectStepDialog').showModal();}
  function openCourseNew(){ $('#courseForm').reset();$('#courseId').value='';$('#courseDialogTitle').textContent='Добавить курс';$('#courseStatus').value='wishlist';$('#deleteCourseBtn').classList.add('hidden');$('#courseDialog').showModal(); }
  function openCourseEdit(id){const c=state.courses.find(x=>x.id===id);if(!c)return;$('#courseId').value=c.id;$('#courseDialogTitle').textContent='Изменить курс';$('#courseTitle').value=c.title;$('#courseProvider').value=c.provider||'';$('#courseStatus').value=c.status||'wishlist';$('#courseTotalUnits').value=num(c.total_units);$('#courseCompletedUnits').value=num(c.completed_units);$('#courseUrl').value=c.url||'';$('#courseNotes').value=c.notes||'';$('#deleteCourseBtn').classList.remove('hidden');$('#courseDialog').showModal();}
  function loadEnergyDay(day){const x=state.energy.find(e=>e.day===day);$('#energyDate').value=day;$('#energyValue').value=String(x?.energy||3);$('#stressValue').value=String(x?.stress||3);$('#wellbeingValue').value=String(x?.wellbeing||3);$('#energyNote').value=x?.note||'';switchTab('state');stateSubtab='energy';switchStateView('energy');}
  async function toggleProjectStep(id,completed){const {error}=await sb.from('pf_project_steps').update({completed}).eq('id',id).eq('user_id',user.id);if(error)toast('Не удалось обновить этап','error');else await loadAll({silent:true});}
  async function processInbox(id,action){const item=state.inbox.find(x=>x.id===id);if(!item)return;let result={error:null};if(action==='task')result=await sb.from('pf_tasks').insert({user_id:user.id,title:item.text,category:'work',task_date:todayISO(),completed:false});if(action==='project')result=await sb.from('pf_projects').insert({user_id:user.id,title:item.text,area:'other',status:'planned',progress:0});if(action==='book')result=await sb.from('pf_books').insert({user_id:user.id,title:item.text,status:'wishlist',book_format:'other'});if(action==='media')result=await sb.from('pf_media').insert({user_id:user.id,title:item.text,media_type:'movie',status:'wishlist'});if(result.error){console.error(result.error);toast('Не удалось перенести запись','error');return;}const {error}=await sb.from('pf_inbox').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id);if(error)toast('Не удалось отметить запись разобранной','error');else toast(action==='archive'?'Запись разобрана':'Перенесено');await loadAll({silent:true});}

  function bindUI() {
    $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>{
      if (b.dataset.tab === 'finance') financeSubtab = 'overview';
      switchTab(b.dataset.tab);
      if (b.dataset.tab === 'finance') switchFinanceView(financeSubtab);
    }));
    $$('[data-go]').forEach(b=>b.addEventListener('click',()=>{
      if (b.dataset.financeView) financeSubtab = b.dataset.financeView;
      switchTab(b.dataset.go);
      if (b.dataset.go === 'finance') switchFinanceView(financeSubtab);
    }));
    $$('[data-finance-tab]').forEach(b=>b.addEventListener('click',()=>switchFinanceView(b.dataset.financeTab)));
    $$('[data-plan-tab]').forEach(b=>b.addEventListener('click',()=>switchPlanView(b.dataset.planTab)));
    $$('[data-state-tab]').forEach(b=>b.addEventListener('click',()=>switchStateView(b.dataset.stateTab)));
    $('#addGoalBtn').onclick=openGoalNew; $('#addProjectBtn').onclick=openProjectNew;
    $('#addInboxBtn').onclick=()=>{ $('#inboxForm').reset(); $('#inboxDialog').showModal(); };
    $('#addCourseBtn').onclick=openCourseNew;
    $('#addAchievementBtn').onclick=()=>{ $('#achievementForm').reset(); $('#achievementDate').value=todayISO(); $('#achievementDialog').showModal(); };
    $('#monthPlanMonth').addEventListener('change',renderMonthPlan); $('#weeklyReviewDate').addEventListener('change',renderWeeklyReview);
    $('#energyMonth').addEventListener('change',renderEnergy); $('#lifeWheelMonth').addEventListener('change',renderLifeWheel); $('#resultsYear').addEventListener('change',renderResults);
    $$('[data-quick]').forEach(b=>b.addEventListener('click',()=>{const q=b.dataset.quick;if(q==='income'){financeSubtab='incomes';switchTab('finance');switchFinanceView('incomes');$('#incomeAmount')?.focus();}if(q==='expense'){financeSubtab='expenses';switchTab('finance');switchFinanceView('expenses');$('#expenseAmount')?.focus();}if(q==='task'){switchTab('tasks');$('#taskTitle')?.focus();}if(q==='idea'){ $('#inboxForm').reset();$('#inboxDialog').showModal(); }if(q==='mood')openMood(todayISO());if(q==='sleep')openSleep(todayISO());if(q==='energy'){switchTab('state');stateSubtab='energy';switchStateView('energy');$('#energyDate').value=todayISO();}}));
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
    $('#bookShelfTabs').addEventListener('click', e => {
      const btn=e.target.closest('[data-book-filter]');
      if (!btn) return;
      e.preventDefault();
      setBookShelfFilter(btn.dataset.bookFilter || 'all', {scroll:true});
    });
    $('#readingMonth').addEventListener('change', renderReadingCalendar);
    $('#readingTimerBook').addEventListener('change', e => { if (!readingTimer.running) { readingTimer.bookId=e.target.value||null; saveReadingTimer(); } });
    $('#readingTimerToggle').onclick = async () => {
      if (readingTimer.running) {
        readingTimer.accumulated=timerElapsedMs();
        readingTimer.running=false;
        readingTimer.startedAt=null;
        clearInterval(readingTimer.tick); readingTimer.tick=null;
      } else {
        const id=$('#readingTimerBook').value;
        if (!id) {
          toast('Сначала добавьте или выберите книгу','error');
          return;
        }

        const book=state.books.find(b=>b.id===id);
        if (!book) {
          toast('Книга не найдена. Обновите страницу.','error');
          return;
        }

        if (book.status!=='reading') {
          const {error}=await sb.from('pf_books')
            .update({status:'reading',started_on:book.started_on||todayISO()})
            .eq('id',id)
            .eq('user_id',user.id);

          if (error) {
            console.error(error);
            toast('Не удалось перевести книгу в «Читаю»','error');
            return;
          }

          // Обновляем локально сразу, чтобы таймер запускался без ожидания перезагрузки.
          book.status='reading';
          book.started_on=book.started_on||todayISO();
          bookShelfFilter='reading';
          renderBooks();
          $('#readingTimerBook').value=id;
        }

        readingTimer.bookId=id;
        readingTimer.running=true;
        readingTimer.startedAt=Date.now();
        startTimerTick();
      }

      saveReadingTimer();
      updateReadingTimerUI();
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
    $$('[data-media-filter]').forEach(btn => btn.addEventListener('click', () => {
      mediaShelfFilter = btn.dataset.mediaFilter || 'all';
      renderMedia();
      $('#mediaLibrary')?.scrollIntoView({behavior:'smooth', block:'start'});
    }));
    $('#mediaTypeFilter').addEventListener('change', renderMedia);
    $('#randomMediaBtn').onclick = () => pickRandomMedia();

    // Тема кабинета — предпросмотр сразу при выборе
    $$('input[name="cabinetTheme"]').forEach(r => r.addEventListener('change', () => applyTheme(r.value)));

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
    ['bookDialog','mediaDialog'].forEach(id => {
      const dialog = document.getElementById(id);
      dialog?.addEventListener('click', e => {
        if (e.target === dialog) dialog.close();
      });
      dialog?.addEventListener('close', () => {
        document.body.classList.remove('dialog-open');
      });
    });

    $('#goalForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('#goalId').value,payload={title:$('#goalTitle').value.trim(),category:$('#goalCategory').value,target_date:$('#goalTargetDate').value||null,target_value:num($('#goalTargetValue').value),current_value:num($('#goalCurrentValue').value),unit:$('#goalUnit').value.trim()||null,status:$('#goalStatus').value,notes:$('#goalNotes').value.trim()||null};const r=id?await sb.from('pf_goals').update(payload).eq('id',id).eq('user_id',user.id):await sb.from('pf_goals').insert({...payload,user_id:user.id});if(r.error){console.error(r.error);toast('Не удалось сохранить цель','error');return;}$('#goalDialog').close();toast('Цель сохранена');await loadAll({silent:true});});
    $('#deleteGoalBtn').onclick=async()=>{const id=$('#goalId').value;if(!id||!confirm('Удалить цель?'))return;const {error}=await sb.from('pf_goals').delete().eq('id',id).eq('user_id',user.id);if(error)toast('Не удалось удалить','error');else{$('#goalDialog').close();toast('Цель удалена');await loadAll({silent:true});}};
    $('#projectForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('#projectId').value,payload={title:$('#projectTitle').value.trim(),area:$('#projectArea').value,status:$('#projectStatus').value,deadline:$('#projectDeadline').value||null,progress:clamp(num($('#projectProgress').value),0,100),notes:$('#projectNotes').value.trim()||null};const r=id?await sb.from('pf_projects').update(payload).eq('id',id).eq('user_id',user.id):await sb.from('pf_projects').insert({...payload,user_id:user.id});if(r.error){console.error(r.error);toast('Не удалось сохранить проект','error');return;}$('#projectDialog').close();toast('Проект сохранён');await loadAll({silent:true});});
    $('#deleteProjectBtn').onclick=async()=>{const id=$('#projectId').value;if(!id||!confirm('Удалить проект и его этапы?'))return;const {error}=await sb.from('pf_projects').delete().eq('id',id).eq('user_id',user.id);if(error)toast('Не удалось удалить','error');else{$('#projectDialog').close();toast('Проект удалён');await loadAll({silent:true});}};
    $('#projectStepForm').addEventListener('submit',async e=>{e.preventDefault();const {error}=await sb.from('pf_project_steps').insert({user_id:user.id,project_id:$('#projectStepProjectId').value,title:$('#projectStepTitle').value.trim()});if(error)toast('Не удалось добавить этап','error');else{$('#projectStepDialog').close();toast('Этап добавлен');await loadAll({silent:true});}});
    $('#monthPlanForm').addEventListener('submit',async e=>{e.preventDefault();const ym=$('#monthPlanMonth').value||currentMonthISO(),payload={user_id:user.id,month:monthFirst(ym),focus:$('#monthFocus').value.trim()||null,priority1:$('#monthPriority1').value.trim()||null,priority2:$('#monthPriority2').value.trim()||null,priority3:$('#monthPriority3').value.trim()||null,notes:$('#monthNotes').value.trim()||null};const {error}=await sb.from('pf_month_plans').upsert(payload,{onConflict:'user_id,month'});if(error)toast('Не удалось сохранить месяц','error');else{toast('План месяца сохранён');await loadAll({silent:true});}});
    $('#monthEventForm').addEventListener('submit',async e=>{e.preventDefault();const payload={user_id:user.id,title:$('#monthEventTitle').value.trim(),event_date:$('#monthEventDate').value,event_type:$('#monthEventType').value,amount:num($('#monthEventAmount').value)||null};const {error}=await sb.from('pf_month_events').insert(payload);if(error)toast('Не удалось добавить событие','error');else{toast('Дата добавлена');e.target.reset();$('#monthEventDate').value=`${$('#monthPlanMonth').value||currentMonthISO()}-01`;await loadAll({silent:true});}});
    $('#weeklyReviewForm').addEventListener('submit',async e=>{e.preventDefault();const payload={user_id:user.id,week_start:mondayOf($('#weeklyReviewDate').value||todayISO()),wins:$('#weekWins').value.trim()||null,challenges:$('#weekChallenges').value.trim()||null,drained:$('#weekDrained').value.trim()||null,next_focus:$('#weekNextFocus').value.trim()||null,score:num($('#weekScore').value)};const {error}=await sb.from('pf_weekly_reviews').upsert(payload,{onConflict:'user_id,week_start'});if(error)toast('Не удалось сохранить обзор','error');else{toast('Обзор недели сохранён');await loadAll({silent:true});}});
    $('#inboxForm').addEventListener('submit',async e=>{e.preventDefault();const {error}=await sb.from('pf_inbox').insert({user_id:user.id,text:$('#inboxText').value.trim(),item_type:$('#inboxType').value,status:'inbox'});if(error)toast('Не удалось сохранить мысль','error');else{$('#inboxDialog').close();toast('Записано в Inbox');await loadAll({silent:true});}});
    $('#energyForm').addEventListener('submit',async e=>{e.preventDefault();const payload={user_id:user.id,day:$('#energyDate').value,energy:num($('#energyValue').value),stress:num($('#stressValue').value),wellbeing:num($('#wellbeingValue').value),note:$('#energyNote').value.trim()||null};const {error}=await sb.from('pf_energy').upsert(payload,{onConflict:'user_id,day'});if(error)toast('Не удалось сохранить состояние','error');else{toast('Состояние сохранено');await loadAll({silent:true});}});
    $('#lifeWheelForm').addEventListener('submit',async e=>{e.preventDefault();const ym=$('#lifeWheelMonth').value||currentMonthISO(),rows=$$('[data-wheel-area]').map(r=>({user_id:user.id,month:monthFirst(ym),area:r.dataset.wheelArea,score:num(r.value)}));const {error}=await sb.from('pf_life_wheel').upsert(rows,{onConflict:'user_id,month,area'});if(error)toast('Не удалось сохранить колесо жизни','error');else{toast('Колесо жизни сохранено');await loadAll({silent:true});}});
    $('#courseForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('#courseId').value,status=$('#courseStatus').value;let completed=Math.round(num($('#courseCompletedUnits').value)),total=Math.round(num($('#courseTotalUnits').value));if(total>0)completed=Math.min(completed,total);const payload={title:$('#courseTitle').value.trim(),provider:$('#courseProvider').value.trim()||null,status,total_units:total,completed_units:completed,url:$('#courseUrl').value.trim()||null,notes:$('#courseNotes').value.trim()||null,started_on:status==='active'?todayISO():null,finished_on:status==='finished'?todayISO():null};const r=id?await sb.from('pf_courses').update(payload).eq('id',id).eq('user_id',user.id):await sb.from('pf_courses').insert({...payload,user_id:user.id});if(r.error){console.error(r.error);toast('Не удалось сохранить курс','error');return;}$('#courseDialog').close();toast('Курс сохранён');await loadAll({silent:true});});
    $('#deleteCourseBtn').onclick=async()=>{const id=$('#courseId').value;if(!id||!confirm('Удалить курс?'))return;const {error}=await sb.from('pf_courses').delete().eq('id',id).eq('user_id',user.id);if(error)toast('Не удалось удалить','error');else{$('#courseDialog').close();toast('Курс удалён');await loadAll({silent:true});}};
    $('#achievementForm').addEventListener('submit',async e=>{e.preventDefault();const {error}=await sb.from('pf_achievements').insert({user_id:user.id,title:$('#achievementTitle').value.trim(),achieved_on:$('#achievementDate').value,category:$('#achievementCategory').value,note:$('#achievementNote').value.trim()||null});if(error)toast('Не удалось добавить достижение','error');else{$('#achievementDialog').close();toast('Достижение добавлено');await loadAll({silent:true});}});

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

    $('#incomeAnalysisMonth').addEventListener('change', renderIncomes);
    $('#incomeForm').addEventListener('submit', async e => {
      e.preventDefault();

      const amount=num($('#incomeAmount').value);
      if (!(amount > 0)) {
        toast('Введите сумму дохода больше 0 ₽','error');
        return;
      }

      const payload = {
        user_id:user.id,
        amount,
        category:$('#incomeCategory').value,
        income_method:$('#incomeMethod').value,
        received_on:$('#incomeDate').value || todayISO(),
        note:$('#incomeNote').value.trim() || null
      };

      let result = await sb.from('pf_incomes').insert(payload);

      // Совместимость со старой схемой: если колонка income_method ещё не создана,
      // доход всё равно сохраняется, а пользователь получает понятную подсказку.
      const msg = String(result.error?.message || '');
      const schemaMissing = result.error && (
        result.error.code === 'PGRST204' ||
        result.error.code === '42703' ||
        msg.includes('income_method') ||
        msg.includes("Could not find the 'income_method' column")
      );

      if (schemaMissing) {
        const legacyPayload = {...payload};
        delete legacyPayload.income_method;
        result = await sb.from('pf_incomes').insert(legacyPayload);

        if (!result.error) {
          console.warn('Доход сохранён без income_method: требуется SQL v10.1');
          toast('Доход добавлен. Чтобы сохранять «карта/наличные», запустите SQL v10.1.');
        }
      }

      if (result.error) {
        console.error('Income insert error:', result.error);
        const detail = result.error.message || result.error.details || result.error.hint || 'неизвестная ошибка';
        toast(`Не удалось добавить доход: ${detail}`,'error');
        return;
      }

      if (!schemaMissing) toast('Доход добавлен');
      e.target.reset();
      $('#incomeDate').value=todayISO();
      $('#incomeMethod').value='card';
      await loadAll({silent:true});
    });

    $('#expenseAnalysisMonth').addEventListener('change', renderExpenses);
    $('#expenseForm').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {user_id:user.id, amount:num($('#expenseAmount').value), category:$('#expenseCategory').value, spent_on:$('#expenseDate').value, note:$('#expenseNote').value.trim() || null};
      const {error} = await sb.from('pf_expenses').insert(payload);
      if (error) {
        console.error(error);
        toast(error.message || 'Не удалось добавить расход','error');
      } else {
        toast('Расход добавлен');
        const addedMonth = String(payload.spent_on || todayISO()).slice(0,7);
        e.target.reset();
        $('#expenseDate').value=todayISO();
        $('#expenseAnalysisMonth').value=addedMonth;
      }
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
        sleep_goal_hours:num($('#sleepGoalHours').value || 8),
        theme:applyTheme($('input[name="cabinetTheme"]:checked')?.value || state.settings.theme || 'violet')
      };
      const {error} = await sb.from('pf_settings').upsert(payload,{onConflict:'user_id'});
      if (error) toast('Не удалось сохранить настройки','error'); else toast('Настройки сохранены');
      await loadAll({silent:true});
    });

    $('#taskForm').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {user_id:user.id,title:$('#taskTitle').value.trim(),category:$('#taskCategory').value,task_date:$('#taskDate').value,project_id:$('#taskProject').value||null,completed:false};
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
        book_format:$('#bookFormat').value,
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
      const result=id
        ? await sb.from('pf_books').update(payload).eq('id',id).eq('user_id',user.id)
        : await sb.from('pf_books').insert({...payload,user_id:user.id});

      if (result.error) {
        console.error(result.error);
        toast(result.error.message || 'Не удалось сохранить книгу','error');
        return;
      }

      bookShelfFilter=status;
      toast(id?'Книга обновлена':'Книга добавлена');
      $('#bookDialog').close();
      document.body.classList.remove('dialog-open');
      await loadAll({silent:true});
      switchTab('books');
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
        notes:$('#mediaNotes').value.trim()||null,
        impression:$('#mediaImpression').value.trim()||null
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
    $('#incomeAnalysisMonth').value = currentMonthISO();
    $('#expenseDate').value = todayISO();
    $('#expenseAnalysisMonth').value = currentMonthISO();
    $('#taskDate').value = todayISO();
    $('#habitMonth').value = currentMonthISO();
    $('#readingMonth').value = currentMonthISO();
    $('#moodMonth').value = currentMonthISO();
    $('#sleepMonth').value = currentMonthISO();
    $('#monthPlanMonth').value = currentMonthISO(); $('#weeklyReviewDate').value = todayISO(); $('#energyMonth').value = currentMonthISO(); $('#energyDate').value = todayISO(); $('#lifeWheelMonth').value = currentMonthISO(); $('#achievementDate').value = todayISO();
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
    document.addEventListener('visibilitychange',()=>{ if (!document.hidden) updateReadingTimerUI(); });
    window.addEventListener('pageshow',()=>updateReadingTimerUI());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
