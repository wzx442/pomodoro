/* ============================================================
   番茄钟 · 逻辑
   零依赖 · 数据保存在 localStorage
   ============================================================ */
(function () {
  'use strict';

  /* ==================== 基础工具 ==================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const sum = (arr, fn) => arr.reduce((acc, x) => acc + fn(x), 0);

  const MIN_MS = 60000;
  const HOUR_MS = 3600000;
  const DAY_MS = 86400000;

  const STORE_KEY = 'tomato.v1';
  const SNAP_KEY = 'tomato.snapshot.v1';

  const COLORS = ['#ff6b5e', '#f5b544', '#46d7a0', '#5aa9f7', '#a78bfa', '#f472b6', '#38bdf8', '#84cc16'];

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : COLORS[0]);

  /* ==================== 时间格式化 ==================== */
  function fmtClockSecs(totalSec) {
    const secs = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function fmtMinutes(min) {
    const m = Math.max(0, Math.round(min));
    if (m < 60) return { value: String(m), unit: '分钟' };
    return { value: (m / 60).toFixed(m % 60 === 0 ? 0 : 1), unit: '小时' };
  }

  function fmtCompact(ms) {
    const m = Math.round(ms / MIN_MS);
    if (m < 60) return `${m} 分钟`;
    const h = m / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} 小时`;
  }

  function fmtHM(ms) {
    const m = Math.round(ms / MIN_MS);
    if (m < 60) return `${m}m`;
    return `${(m / 60).toFixed(m % 60 === 0 ? 0 : 1)}h`;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function md(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function longDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function startOfWeek(ts) {
    const d = new Date(startOfDay(ts));
    const offset = (d.getDay() + 6) % 7; // 周一为一周之始
    d.setDate(d.getDate() - offset);
    return d.getTime();
  }

  function startOfMonth(ts) {
    const d = new Date(ts);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  /* ==================== 状态 ==================== */
  function defaultSettings() {
    return {
      focusMin: 25,
      shortMin: 5,
      longMin: 15,
      longEvery: 4,
      dailyGoalMin: 120,
      sound: true,
      notify: false,
      autoBreak: true,
      autoFocus: false,
      theme: null,
    };
  }

  function makeTask(name, color) {
    return { id: uid(), name, color, createdAt: Date.now() };
  }

  function defaultState() {
    return {
      version: 1,
      settings: defaultSettings(),
      tasks: [makeTask('工作', COLORS[0]), makeTask('学习', COLORS[3]), makeTask('阅读', COLORS[2])],
      sessions: [],
      ui: { range: 'week', recTask: 'all', taskId: null, round: 0 },
    };
  }

  function validSession(s) {
    return (
      s &&
      typeof s === 'object' &&
      Number.isFinite(s.startedAt) &&
      Number.isFinite(s.actualMs) &&
      s.phase === 'focus'
    );
  }

  function loadState() {
    const base = defaultState();
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') return base;

    const settings = Object.assign({}, base.settings, raw.settings && typeof raw.settings === 'object' ? raw.settings : {});
    if (settings.theme !== 'dark' && settings.theme !== 'light') settings.theme = null;
    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks
          .filter((t) => t && typeof t === 'object' && String(t.name || '').trim())
          .map((t) => ({
            id: String(t.id || uid()),
            name: String(t.name).trim().slice(0, 24),
            color: safeColor(t.color),
            createdAt: Number(t.createdAt) || Date.now(),
          }))
      : [];

    return {
      version: 1,
      settings,
      tasks: tasks.length ? tasks : base.tasks,
      sessions: Array.isArray(raw.sessions) ? raw.sessions.filter(validSession).slice(-20000) : [],
      ui: Object.assign({}, base.ui, raw.ui && typeof raw.ui === 'object' ? raw.ui : {}),
    };
  }
  let state = loadState();

  function saveState() {
    try {
      if (state.sessions.length > 20000) state.sessions = state.sessions.slice(-20000);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('保存失败', e);
    }
  }

  /* ==================== 计时器 ==================== */
  const timer = {
    phase: 'focus', // focus | short | long
    timing: 'countdown', // countdown | countup
    taskId: null,
    plannedMs: 0,
    remainingMs: 0,
    elapsedMs: 0,
    deadline: null,
    segmentStart: null,
    running: false,
    round: 0,
    sessionStart: null,
    sessionTaskId: null,
  };

  const PHASE_LABEL = { focus: '专注', short: '短休息', long: '长休息' };

  function phaseMs(phase) {
    const s = state.settings;
    if (phase === 'short') return s.shortMin * MIN_MS;
    if (phase === 'long') return s.longMin * MIN_MS;
    return s.focusMin * MIN_MS;
  }

  function remainingNow() {
    if (timer.running && timer.timing === 'countdown' && timer.deadline != null) {
      return Math.max(0, timer.deadline - Date.now());
    }
    return timer.remainingMs;
  }

  function elapsedNow() {
    if (timer.timing === 'countup') {
      const live = timer.running && timer.segmentStart != null ? Date.now() - timer.segmentStart : 0;
      return timer.elapsedMs + live;
    }
    return Math.max(0, timer.plannedMs - remainingNow());
  }

  function displaySeconds() {
    return timer.timing === 'countdown' ? Math.ceil(remainingNow() / 1000) : Math.floor(elapsedNow() / 1000);
  }

  /* ==================== DOM 引用 ==================== */
  const el = {
    sidebar: $('#sidebar'),
    scrim: $('#scrim'),
    taskList: $('#taskList'),
    taskSelect: $('#taskSelect'),
    taskSelectValue: $('#taskSelectValue'),
    currentTaskDot: $('#currentTaskDot'),
    presets: $('#presets'),
    dialWrap: $('#dialWrap'),
    dialProgress: $('#dialProgress'),
    dialTicks: $('#dialTicks'),
    clock: $('#clock'),
    clockSub: $('#clockSub'),
    phasePill: $('#phasePill'),
    roundDots: $('#roundDots'),
    toggleBtn: $('#toggleBtn'),
    resetBtn: $('#resetBtn'),
    skipBtn: $('#skipBtn'),
    timingSeg: $('#timingSeg'),
    viewTabs: $('#viewTabs'),
    viewTimer: $('#viewTimer'),
    viewStats: $('#viewStats'),
    rangeSeg: $('#rangeSeg'),
    rangeLabel: $('#rangeLabel'),
    kpis: $('#kpis'),
    barChart: $('#barChart'),
    donutChart: $('#donutChart'),
    heatmap: $('#heatmap'),
    insights: $('#insights'),
    recList: $('#recList'),
    recFilter: $('#recFilter'),
    recFilterValue: $('#recFilterValue'),
    recentList: $('#recentList'),
    goalText: $('#goalText'),
    goalBar: $('#goalBar'),
    goalPct: $('#goalPct'),
    streakText: $('#streakText'),
    todayChip: $('#todayChip'),
    todayChipText: $('#todayChipText'),
    statsEmpty: $('#statsEmpty'),
    toasts: $('#toasts'),
    live: $('#liveRegion'),
  };

  const CIRC = 2 * Math.PI * 138;

  /* ==================== 任务辅助 ==================== */
  function currentTask() {
    return state.tasks.find((t) => t.id === timer.taskId) || state.tasks[0] || null;
  }

  function taskColor(id) {
    const t = state.tasks.find((x) => x.id === id);
    return t ? t.color : '#8a94ab';
  }

  function taskName(id, fallback) {
    const t = state.tasks.find((x) => x.id === id);
    return t ? t.name : fallback || '未分类';
  }

  // 记录颜色：任务还在就用任务当前颜色，任务已删除则保留记录里的快照颜色
  function sessionColor(s) {
    const t = state.tasks.find((x) => x.id === s.taskId);
    return safeColor(t ? t.color : s.color);
  }

  function todayFocusMs() {
    const from = startOfDay(Date.now());
    return sum(
      state.sessions.filter((s) => s.phase === 'focus' && s.startedAt >= from),
      (s) => s.actualMs
    );
  }

  function focusSessions() {
    return state.sessions.filter((s) => s.phase === 'focus');
  }

  function computeStreak() {
    const days = new Set(focusSessions().map((s) => dayKey(s.startedAt)));
    let cursor = startOfDay(Date.now());
    if (!days.has(dayKey(cursor))) cursor -= DAY_MS;
    let streak = 0;
    while (days.has(dayKey(cursor)) && streak < 3650) {
      streak += 1;
      cursor -= DAY_MS;
    }
    return streak;
  }

  /* ==================== 渲染：侧栏 ==================== */
  function renderTasks() {
    const from = startOfDay(Date.now());
    const todayMap = new Map();
    state.sessions.forEach((s) => {
      if (s.phase !== 'focus' || s.startedAt < from) return;
      todayMap.set(s.taskId, (todayMap.get(s.taskId) || 0) + s.actualMs);
    });

    el.taskList.innerHTML = state.tasks
      .map((t) => {
        const active = t.id === timer.taskId;
        const ms = todayMap.get(t.id) || 0;
        return `<li class="task-item ${active ? 'is-active' : ''}" data-id="${esc(t.id)}" style="--c:${safeColor(t.color)}">
          <span class="dot"></span>
          <span class="task-name" title="${esc(t.name)}">${esc(t.name)}</span>
          ${ms ? `<span class="task-meta">${fmtHM(ms)}</span>` : ''}
          <button class="task-more" data-more="${esc(t.id)}" title="编辑任务" aria-label="编辑任务">⋯</button>
        </li>`;
      })
      .join('');

    if (!state.tasks.length) {
      el.taskList.innerHTML = '<li class="recent-empty">还没有任务，先新建一个吧</li>';
    }
  }

  function renderTaskSelect() {
    if (!state.tasks.some((t) => t.id === timer.taskId)) {
      timer.taskId = state.tasks[0] ? state.tasks[0].id : null;
    }
    el.taskSelect.innerHTML = state.tasks
      .map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`)
      .join('');
    if (timer.taskId) el.taskSelect.value = timer.taskId;
    el.currentTaskDot.style.setProperty('--c', taskColor(timer.taskId));

    const task = state.tasks.find((t) => t.id === timer.taskId);
    el.taskSelectValue.textContent = task ? task.name : '未分类';
    el.taskSelectValue.title = task ? task.name : '';
  }

  function renderGoal() {
    const goal = state.settings.dailyGoalMin;
    const todayMin = todayFocusMs() / MIN_MS;
    const pct = goal > 0 ? clamp(Math.round((todayMin / goal) * 100), 0, 100) : 0;
    const streak = computeStreak();
    el.goalText.textContent = `${Math.round(todayMin)} / ${goal} 分钟`;
    el.goalBar.style.width = `${pct}%`;
    el.goalPct.textContent = `${pct}%`;
    el.streakText.textContent = streak > 0 ? `连续 ${streak} 天` : '今天开始';
  }

  function renderTodayChip() {
    const todayMin = Math.round(todayFocusMs() / MIN_MS);
    const count = state.sessions.filter(
      (s) => s.phase === 'focus' && s.completed && s.startedAt >= startOfDay(Date.now())
    ).length;
    el.todayChipText.textContent = count
      ? `今日 ${todayMin} 分钟 · ${count} 个番茄`
      : `今日 ${todayMin} 分钟`;
    el.todayChip.classList.toggle('is-live', timer.running);
  }

  /* ==================== 渲染：计时视图 ==================== */
  let dotsKey = '';
  let presetsKey = '';

  function renderTicks() {
    const frag = [];
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      const ang = (i * 6 * Math.PI) / 180;
      const r1 = 152;
      const r2 = major ? 162 : 158;
      const x1 = 180 + r1 * Math.sin(ang);
      const y1 = 180 - r1 * Math.cos(ang);
      const x2 = 180 + r2 * Math.sin(ang);
      const y2 = 180 - r2 * Math.cos(ang);
      frag.push(`<line class="tick${major ? ' major' : ''}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`);
    }
    el.dialTicks.innerHTML = frag.join('');
  }

  function renderPresets() {
    const s = state.settings;
    const key = `${timer.timing}|${timer.phase}|${s.focusMin}|${timer.running}|${timer.sessionStart ? 1 : 0}`;
    if (key === presetsKey) return;
    presetsKey = key;

    if (timer.timing === 'countup') {
      el.presets.innerHTML = '<span class="preset-note">正向计时不限时长，结束时按实际时长记录</span>';
      return;
    }

    const list = Array.from(new Set([15, 25, 45, 60, s.focusMin])).sort((a, b) => a - b);
    const locked = timer.running || !!timer.sessionStart;
    el.presets.innerHTML =
      list
        .map(
          (m) =>
            `<button class="preset ${
              m === s.focusMin && timer.phase === 'focus' ? 'is-active' : ''
            }" data-min="${m}" ${locked ? 'disabled' : ''} title="专注 ${m} 分钟">${m} 分钟</button>`
        )
        .join('') +
      `<button class="preset preset-custom" data-custom="1" ${locked ? 'disabled' : ''} title="自定义专注时长">自定义</button>`;
  }

  function renderRoundDots() {
    const total = clamp(state.settings.longEvery, 2, 10);
    const round = timer.round;
    const filled = round === 0 ? 0 : ((round - 1) % total) + 1;
    const key = `${total}|${filled}`;
    if (key === dotsKey) return;
    dotsKey = key;
    let html = '';
    for (let i = 0; i < total; i++) html += `<i class="${i < filled ? 'on' : ''}"></i>`;
    el.roundDots.innerHTML = html;
    el.roundDots.setAttribute('aria-label', `本轮已完成 ${filled} / ${total} 个番茄`);
  }

  function renderTimer() {
    const secs = displaySeconds();
    const text = fmtClockSecs(secs);
    if (el.clock.textContent !== text) el.clock.textContent = text;

    const phase = timer.phase;
    el.dialWrap.classList.toggle('phase-focus', phase === 'focus');
    el.dialWrap.classList.toggle('phase-short', phase === 'short');
    el.dialWrap.classList.toggle('phase-long', phase === 'long');
    el.dialWrap.classList.toggle('is-running', timer.running);

    el.phasePill.textContent = PHASE_LABEL[phase];

    let sub;
    if (timer.timing === 'countup') {
      sub = '正向计时 · 随时结束并记录';
    } else if (phase === 'focus') {
      sub = `第 ${timer.round + 1} 轮 · 每 ${state.settings.longEvery} 轮长休`;
    } else if (phase === 'short') {
      sub = `休息一下 · 下一轮是第 ${timer.round + 1} 个番茄`;
    } else {
      sub = `长休息 · 本轮已完成 ${timer.round} 个番茄`;
    }
    if (el.clockSub.textContent !== sub) el.clockSub.textContent = sub;

    const progress =
      timer.timing === 'countdown'
        ? timer.plannedMs > 0
          ? clamp((timer.plannedMs - remainingNow()) / timer.plannedMs, 0, 1)
          : 0
        : clamp(elapsedNow() / HOUR_MS, 0, 1);

    el.dialProgress.style.strokeDasharray = String(CIRC);
    el.dialProgress.style.strokeDashoffset = String(CIRC * (1 - progress));
    el.dialProgress.setAttribute('aria-valuenow', String(Math.round(progress * 100)));

    const label = timer.running ? '暂停' : timer.sessionStart ? '继续' : '开始';
    if (el.toggleBtn.textContent !== label) el.toggleBtn.textContent = label;

    const skipLabel = timer.timing === 'countup' ? '结束并记录' : phase === 'focus' ? '跳过' : '结束休息';
    if (el.skipBtn.textContent !== skipLabel) el.skipBtn.textContent = skipLabel;

    el.todayChip.classList.toggle('is-live', timer.running);
    renderPresets();
    renderRoundDots();

    const running = timer.running || !!timer.sessionStart;
    document.title = running
      ? `${text} · ${PHASE_LABEL[phase]} · 番茄钟`
      : '番茄钟 · 专注计时';
  }

  function renderRecent() {
    const from = startOfDay(Date.now());
    const list = state.sessions
      .filter((s) => s.phase === 'focus' && s.startedAt >= from)
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, 6);

    if (!list.length) {
      el.recentList.innerHTML = '<li class="recent-empty">今天还没有记录，开始第一个番茄吧 🍅</li>';
      return;
    }

    el.recentList.innerHTML = list
      .map(
        (s) => `<li class="recent-item">
          <span class="dot" style="--c:${sessionColor(s)}"></span>
          <span class="r-name">${esc(taskName(s.taskId, s.taskName))}</span>
          <span class="r-time">${fmtTime(s.startedAt)}–${fmtTime(s.endedAt)}</span>
          <span class="r-dur">${fmtCompact(s.actualMs)}</span>
        </li>`
      )
      .join('');
  }

  function refreshAll() {
    renderTasks();
    renderGoal();
    renderTodayChip();
    renderRecent();
    renderTimer();
    if (el.viewStats.classList.contains('is-active')) renderStats();
  }

  /* ==================== 计时控制 ==================== */
  let ticker = null;
  let lastSnap = 0;

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(onTick, 200);
  }

  function stopTicker() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function onTick() {
    if (!timer.running) return;
    if (timer.timing === 'countdown' && remainingNow() <= 0) {
      completePhase(true, { auto: true });
      return;
    }
    renderTimer();
    if (Date.now() - lastSnap > 5000) saveSnapshot();
  }

  function resetTimer(phase, opts) {
    stopTicker();
    timer.phase = phase || timer.phase;
    timer.plannedMs = phaseMs(timer.phase);
    timer.remainingMs = timer.plannedMs;
    timer.elapsedMs = 0;
    timer.deadline = null;
    timer.segmentStart = null;
    timer.running = false;
    timer.sessionStart = null;
    timer.sessionTaskId = null;
    if (!opts || opts.save !== false) saveSnapshot();
    renderTimer();
  }

  function startTimer() {
    if (timer.running) return;
    if (timer.timing === 'countdown' && timer.remainingMs <= 0) timer.remainingMs = timer.plannedMs;
    const now = Date.now();
    timer.sessionStart = timer.sessionStart || now;
    timer.sessionTaskId = timer.sessionTaskId || timer.taskId;
    timer.running = true;
    if (timer.timing === 'countdown') {
      timer.deadline = now + timer.remainingMs;
    } else {
      timer.segmentStart = now;
    }
    startTicker();
    renderTimer();
    saveSnapshot();
  }

  function pauseTimer() {
    if (!timer.running) return;
    const now = Date.now();
    if (timer.timing === 'countdown') {
      timer.remainingMs = Math.max(0, (timer.deadline || now) - now);
      timer.deadline = null;
    } else if (timer.segmentStart != null) {
      timer.elapsedMs += now - timer.segmentStart;
      timer.segmentStart = null;
    }
    timer.running = false;
    stopTicker();
    renderTimer();
    saveSnapshot();
  }

  function toggleTimer() {
    if (timer.running) pauseTimer();
    else startTimer();
  }

  function selectTask(id) {
    if (!state.tasks.some((t) => t.id === id)) return;
    timer.taskId = id;
    state.ui.taskId = id;
    saveState();
    renderTasks();
    renderTaskSelect();
    closeSidebar();
  }

  function setTiming(timing) {
    if (timing === timer.timing) return;
    if (timer.running) {
      toast('计时进行中，先暂停再切换模式', 'warn', '⏸');
      return;
    }
    if (timer.sessionStart) {
      toast('请先结束当前计时，再切换模式', 'warn', '·');
      return;
    }
    timer.timing = timing;
    if (timing === 'countup') timer.phase = 'focus';
    resetTimer(timing === 'countup' ? 'focus' : timer.phase);
    $$('#timingSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.timing === timing));
    renderTimer();
  }

  function setFocusMinutes(minutes) {
    if (timer.running || timer.sessionStart) {
      toast('请先结束当前计时，再调整时长', 'warn', '·');
      return;
    }
    state.settings.focusMin = clamp(Math.round(minutes), 1, 180);
    saveState();
    if (timer.phase === 'focus' && timer.timing === 'countdown') {
      timer.plannedMs = phaseMs('focus');
      timer.remainingMs = timer.plannedMs;
      renderTimer();
    }
    renderPresets();
  }

  function recordSession(data) {
    const task = state.tasks.find((t) => t.id === data.taskId);
    state.sessions.push({
      id: uid(),
      taskId: data.taskId || (state.tasks[0] && state.tasks[0].id) || null,
      taskName: task ? task.name : '未分类',
      color: task ? task.color : '#8a94ab',
      phase: 'focus',
      timing: data.timing,
      plannedMs: Math.round(data.plannedMs),
      actualMs: Math.round(data.actualMs),
      completed: !!data.completed,
      startedAt: Math.round(data.startedAt),
      endedAt: Math.round(data.endedAt),
    });
    saveState();
  }

  function completePhase(natural, opts) {
    opts = opts || {};
    const at = Number(opts.at) || Date.now();

    if (timer.running) {
      if (timer.timing === 'countdown') {
        timer.remainingMs = Math.max(0, (timer.deadline || at) - at);
      } else if (timer.segmentStart != null) {
        timer.elapsedMs += at - timer.segmentStart;
      }
    }
    timer.running = false;
    timer.deadline = null;
    timer.segmentStart = null;
    stopTicker();

    const phase = timer.phase;
    const timing = timer.timing;
    const actual =
      timing === 'countdown'
        ? clamp(timer.plannedMs - timer.remainingMs, 0, timer.plannedMs)
        : clamp(timer.elapsedMs, 0, 24 * HOUR_MS);
    const startedAt = timer.sessionStart || Math.max(0, at - actual);
    const taskId = timer.sessionTaskId || timer.taskId;
    const naturalDone = !!natural;

    let recorded = false;
    if (phase === 'focus' && actual >= 30000) {
      recordSession({
        taskId,
        timing,
        plannedMs: timing === 'countdown' ? timer.plannedMs : actual,
        actualMs: actual,
        completed: naturalDone && timing === 'countdown',
        startedAt: Math.min(startedAt, at),
        endedAt: at,
      });
      recorded = true;
    }

    if (phase === 'focus' && (recorded || naturalDone)) timer.round += 1;
    state.ui.round = timer.round;
    saveState();

    if (timing === 'countup') {
      resetTimer('focus');
    } else if (phase === 'focus') {
      const next = timer.round > 0 && timer.round % state.settings.longEvery === 0 ? 'long' : 'short';
      resetTimer(next);
      if (opts.auto !== false && state.settings.autoBreak) startTimer();
    } else {
      resetTimer('focus');
      if (opts.auto !== false && state.settings.autoFocus) startTimer();
    }

    saveSnapshot();
    refreshAll();

    const minutes = Math.max(1, Math.round(actual / MIN_MS));
    if (phase === 'focus') {
      if (naturalDone) {
        chime('done');
        toast(`第 ${timer.round} 个番茄完成 · ${minutes} 分钟`, 'ok', '🍅');
        announce(`专注完成，休息一下吧。已完成 ${timer.round} 个番茄`);
        notify(
          '专注结束',
          `${minutes} 分钟专注完成。${timer.phase === 'long' ? '来一次长休息。' : '休息一下，再战一轮。'}`
        );
      } else if (recorded) {
        toast(`已记录 ${minutes} 分钟专注`, 'ok', '✓');
      } else {
        toast('本次时长不足 30 秒，未记录', 'warn', '·');
      }
    } else if (naturalDone) {
      chime('rest');
      toast('休息结束，准备开始下一轮', 'ok', '☕');
      announce('休息结束，准备开始下一轮');
      notify('休息结束', '回到专注状态吧。');
    }
  }

  function skipPhase() {
    if (timer.running || timer.sessionStart) {
      completePhase(false, { auto: false });
      return;
    }
    if (timer.timing === 'countup') {
      toast('正向计时还没有开始', 'warn', '·');
      return;
    }
    if (timer.phase === 'focus') {
      const next = timer.round > 0 && timer.round % state.settings.longEvery === 0 ? 'long' : 'short';
      resetTimer(next);
      toast('已切换到' + PHASE_LABEL[next], 'ok', '→');
    } else {
      resetTimer('focus');
      toast('已回到专注', 'ok', '→');
    }
    saveSnapshot();
    refreshAll();
  }

  /* ==================== 持久化：运行快照 ==================== */
  function saveSnapshot() {
    lastSnap = Date.now();
    try {
      localStorage.setItem(
        SNAP_KEY,
        JSON.stringify({
          phase: timer.phase,
          timing: timer.timing,
          taskId: timer.taskId,
          plannedMs: timer.plannedMs,
          remainingMs: timer.remainingMs,
          elapsedMs: timer.elapsedMs,
          deadline: timer.deadline,
          segmentStart: timer.segmentStart,
          running: timer.running,
          round: timer.round,
          sessionStart: timer.sessionStart,
          sessionTaskId: timer.sessionTaskId,
          savedAt: lastSnap,
        })
      );
    } catch (e) {
      /* 忽略 */
    }
  }

  function restoreSnapshot() {
    let snap = null;
    try {
      snap = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
    } catch (e) {
      snap = null;
    }
    if (!snap || typeof snap !== 'object') return;
    if (Date.now() - (Number(snap.savedAt) || 0) > 12 * HOUR_MS) {
      localStorage.removeItem(SNAP_KEY);
      return;
    }
    if (!['focus', 'short', 'long'].includes(snap.phase)) return;
    if (!snap.running && !snap.sessionStart) return;

    timer.phase = snap.phase;
    timer.timing = snap.timing === 'countup' ? 'countup' : 'countdown';
    timer.plannedMs = Number(snap.plannedMs) || phaseMs(snap.phase);
    timer.round = Math.max(0, Number(snap.round) || 0);
    timer.elapsedMs = Math.max(0, Number(snap.elapsedMs) || 0);
    timer.remainingMs = Number.isFinite(snap.remainingMs) ? snap.remainingMs : timer.plannedMs;
    timer.sessionStart = Number(snap.sessionStart) || null;
    timer.sessionTaskId = state.tasks.some((t) => t.id === snap.taskId) ? snap.taskId : timer.taskId;
    if (state.tasks.some((t) => t.id === snap.taskId)) timer.taskId = snap.taskId;

    if (snap.running) {
      if (timer.timing === 'countdown') {
        timer.deadline = Number(snap.deadline) || Date.now() + timer.remainingMs;
        timer.running = true;
        if (Date.now() >= timer.deadline) {
          completePhase(true, { auto: false, at: timer.deadline });
          return;
        }
        startTicker();
      } else {
        timer.segmentStart = Number(snap.segmentStart) || Date.now();
        timer.running = true;
        startTicker();
      }
    }
    saveSnapshot();
  }

  /* ==================== 提示 / 声音 / 通知 ==================== */
  function toast(message, kind, icon) {
    const node = document.createElement('div');
    node.className = `toast ${kind === 'warn' ? 'warn' : 'ok'}`;
    node.innerHTML = `<span class="t-ico">${icon || '✓'}</span><span>${esc(message)}</span>`;
    el.toasts.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 260);
    }, 3200);
    while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
  }

  function announce(text) {
    el.live.textContent = text;
  }

  let audioCtx = null;

  function chime(kind) {
    if (!state.settings.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t0 = audioCtx.currentTime + 0.03;
      const notes = kind === 'rest' ? [587.33, 493.88, 440] : [659.25, 830.61, 987.77];
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = t0 + i * 0.17;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.65);
      });
    } catch (e) {
      /* 忽略音频错误 */
    }
  }

  function notify(title, body) {
    if (!state.settings.notify) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body, silent: true });
    } catch (e) {
      /* 忽略 */
    }
  }

  /* ==================== 统计：时间段 ==================== */
  function rangePeriod(range) {
    const now = Date.now();
    const end = now + 1;
    const sod = startOfDay(now);
    // 对比口径：与上一周期“相同已过时长”比较，避免拿半天比整天
    const prevEndFor = (start, prevStart) => prevStart + (now - start) + 1;

    if (range === 'today') {
      const prevStart = sod - DAY_MS;
      return {
        start: sod,
        end,
        prevStart,
        prevEnd: prevEndFor(sod, prevStart),
        label: `今天 · ${longDate(now)}`,
        days: 1,
      };
    }
    if (range === 'week') {
      const start = startOfWeek(now);
      const prevStart = start - 7 * DAY_MS;
      return {
        start,
        end,
        prevStart,
        prevEnd: prevEndFor(start, prevStart),
        label: `本周 · ${md(start)} – ${md(now)}`,
        days: Math.floor((sod - start) / DAY_MS) + 1,
      };
    }
    if (range === 'month') {
      const start = startOfMonth(now);
      const d = new Date(start);
      d.setMonth(d.getMonth() - 1);
      const prevStart = d.getTime();
      return {
        start,
        end,
        prevStart,
        prevEnd: prevEndFor(start, prevStart),
        label: `${new Date(now).getFullYear()} 年 ${new Date(now).getMonth() + 1} 月`,
        days: Math.floor((sod - start) / DAY_MS) + 1,
      };
    }
    const all = focusSessions();
    const first = all.length ? all.reduce((min, s) => Math.min(min, s.startedAt), Infinity) : sod;
    const start = startOfDay(first);
    return {
      start,
      end,
      prevStart: null,
      prevEnd: null,
      label: `全部记录 · 共 ${all.length} 条`,
      days: Math.max(1, Math.floor((sod - start) / DAY_MS) + 1),
    };
  }

  function sessionsIn(period) {
    return focusSessions().filter((s) => s.startedAt >= period.start && s.startedAt < period.end);
  }

  function kpiCard(opts) {
    return `<div class="kpi" style="--kpi-tint:${opts.tint || 'rgba(255,107,94,.14)'}">
      <div class="kpi-label">${opts.label}</div>
      <div class="kpi-value">${opts.value}${opts.unit ? `<span class="unit">${opts.unit}</span>` : ''}</div>
      <div class="kpi-sub">${opts.sub || '&nbsp;'}</div>
    </div>`;
  }

  function renderKpis() {
    const period = rangePeriod(state.ui.range);
    const list = sessionsIn(period);
    const minutes = sum(list, (s) => s.actualMs) / MIN_MS;
    const total = fmtMinutes(minutes);
    const completed = list.filter((s) => s.completed).length;
    const countdownCount = list.filter((s) => s.timing === 'countdown').length;
    const rate = countdownCount ? Math.round((completed / countdownCount) * 100) : 0;
    const avg = list.length ? minutes / list.length : 0;

    const daily = minutes / Math.max(1, period.days);

    const byDay = new Map();
    list.forEach((s) => {
      const k = dayKey(s.startedAt);
      byDay.set(k, (byDay.get(k) || 0) + s.actualMs);
    });
    const goal = state.settings.dailyGoalMin;
    const hitDays = Array.from(byDay.values()).filter((ms) => ms / MIN_MS >= goal).length;

    let deltaHtml = '<span class="muted">较上期 —</span>';
    if (period.prevStart != null) {
      const prevMinutes =
        sum(
          focusSessions().filter((s) => s.startedAt >= period.prevStart && s.startedAt < period.prevEnd),
          (s) => s.actualMs
        ) / MIN_MS;
      if (prevMinutes > 0) {
        const diff = Math.round(((minutes - prevMinutes) / prevMinutes) * 100);
        deltaHtml = `<span class="delta ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${diff}%</span> 较上期`;
      } else if (minutes > 0) {
        deltaHtml = '<span class="delta up">新增</span> 上期无记录';
      }
    }

    el.kpis.innerHTML = [
      kpiCard({
        label: '专注时长',
        value: total.value,
        unit: total.unit,
        sub: deltaHtml,
        tint: 'rgba(255,107,94,.16)',
      }),
      kpiCard({
        label: '完成番茄',
        value: String(completed),
        unit: '个',
        sub: `共 ${list.length} 次专注`,
        tint: 'rgba(70,215,160,.14)',
      }),
      kpiCard({
        label: '完成率',
        value: String(rate),
        unit: '%',
        sub: `平均每轮 ${Math.round(avg)} 分钟`,
        tint: 'rgba(90,169,247,.14)',
      }),
      kpiCard({
        label: '日均专注',
        value: String(Math.round(daily)),
        unit: '分钟',
        sub: `达标 ${hitDays} / ${Math.round(period.days)} 天`,
        tint: 'rgba(167,139,250,.14)',
      }),
    ].join('');
  }

  /* ==================== 统计：图表 ==================== */
  const isLight = () => document.documentElement.dataset.theme === 'light';

  function drawBarChart() {
    const W = 800;
    const H = 248;
    const padL = 38;
    const padR = 12;
    const padT = 24;
    const padB = 30;

    const today = startOfDay(Date.now());
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const ts = today - i * DAY_MS;
      days.push({ ts, key: dayKey(ts), min: 0 });
    }
    const index = new Map(days.map((d, i) => [d.key, i]));
    focusSessions().forEach((s) => {
      const i = index.get(dayKey(s.startedAt));
      if (i !== undefined) days[i].min += s.actualMs / MIN_MS;
    });

    const goal = state.settings.dailyGoalMin;
    const rawMax = Math.max(goal, ...days.map((d) => d.min), 60);
    const max = Math.ceil(rawMax / 30) * 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const band = plotW / days.length;
    const bw = Math.min(30, band * 0.54);
    const y = (v) => padT + plotH - (v / max) * plotH;

    let s = `<defs>
      <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#ff6b5e" stop-opacity=".35" />
        <stop offset="100%" stop-color="#ff8a52" stop-opacity=".95" />
      </linearGradient>
    </defs>`;

    for (let i = 0; i <= 4; i++) {
      const v = (max * i) / 4;
      const yy = y(v);
      s += `<line class="grid-line" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" />`;
      s += `<text class="grid-text" x="${padL - 9}" y="${(yy + 3.4).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`;
    }

    days.forEach((d, i) => {
      const cx = padL + band * i + band / 2;
      const h = (d.min / max) * plotH;
      const isToday = i === days.length - 1;
      const fill = isToday ? '#ff6b5e' : 'url(#barGrad)';
      s += `<rect class="bar" x="${(cx - bw / 2).toFixed(1)}" y="${(padT + plotH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 2).toFixed(1)}" rx="4" fill="${fill}" opacity="${d.min > 0 ? 1 : 0.18}">
        <title>${md(d.ts)} · ${Math.round(d.min)} 分钟</title>
      </rect>`;
      if (d.min >= 1) {
        s += `<text class="bar-value" x="${cx.toFixed(1)}" y="${(padT + plotH - h - 6).toFixed(1)}" text-anchor="middle">${Math.round(d.min)}</text>`;
      }
      s += `<text class="bar-label ${isToday ? 'is-today' : ''}" x="${cx.toFixed(1)}" y="${H - 9}" text-anchor="middle">${md(d.ts)}</text>`;
    });

    s += `<line class="goal-line" x1="${padL}" y1="${y(goal).toFixed(1)}" x2="${W - padR}" y2="${y(goal).toFixed(1)}" />`;

    el.barChart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 14 天每日专注分钟数">${s}</svg>`;
  }

  function drawDonut() {
    const period = rangePeriod(state.ui.range);
    const list = sessionsIn(period);
    if (!list.length) {
      el.donutChart.innerHTML = '<div class="chart-empty">这个时间段还没有记录</div>';
      return;
    }

    const agg = new Map();
    list.forEach((s) => {
      const key = s.taskId || 'none';
      const task = state.tasks.find((t) => t.id === s.taskId);
      const item = agg.get(key) || {
        name: task ? task.name : s.taskName || '未分类',
        color: safeColor(task ? task.color : s.color),
        ms: 0,
      };
      item.ms += s.actualMs;
      agg.set(key, item);
    });

    const all = Array.from(agg.values()).sort((a, b) => b.ms - a.ms);
    let slices = all;
    if (all.length > 5) {
      const rest = all.slice(4);
      slices = all.slice(0, 4).concat([
        { name: '其他', color: '#8a94ab', ms: sum(rest, (x) => x.ms) },
      ]);
    }

    const total = sum(all, (x) => x.ms);
    const R = 64;
    const C = 2 * Math.PI * R;
    const cx = 100;
    const cy = 100;
    let acc = 0;

    let arcs = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="20" opacity=".55" />`;
    slices.forEach((sl) => {
      const frac = total > 0 ? sl.ms / total : 0;
      const len = Math.max(0, frac * C - 2.5);
      const off = -acc * C;
      acc += frac;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${safeColor(sl.color)}" stroke-width="20"
        stroke-linecap="butt"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
        stroke-dashoffset="${off.toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})">
        <title>${esc(sl.name)} · ${fmtCompact(sl.ms)}</title>
      </circle>`;
    });

    const center = fmtMinutes(total / MIN_MS);

    const legend = slices
      .map(
        (sl) => `<li>
          <span class="dot" style="--c:${safeColor(sl.color)}"></span>
          <span class="lg-name">${esc(sl.name)}</span>
          <span class="lg-val">${Math.round((sl.ms / total) * 100)}%</span>
        </li>`
      )
      .join('');

    el.donutChart.innerHTML = `<div class="donut-wrap">
      <svg class="donut-svg" viewBox="0 0 200 200" role="img" aria-label="任务时间分布">
        ${arcs}
        <text class="donut-center-num" x="100" y="99" text-anchor="middle">${center.value}</text>
        <text class="donut-center-lbl" x="100" y="118" text-anchor="middle">${center.unit} · 总计</text>
      </svg>
      <ul class="donut-legend">${legend}</ul>
    </div>`;
  }

  function drawHeatmap() {
    const DAYS = 28;
    const start = startOfDay(Date.now() - (DAYS - 1) * DAY_MS);
    const sums = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const counts = new Array(7).fill(0);

    for (let i = 0; i < DAYS; i++) {
      const d = new Date(start + i * DAY_MS);
      counts[(d.getDay() + 6) % 7] += 1;
    }

    focusSessions().forEach((s) => {
      if (s.startedAt < start) return;
      const d = new Date(s.startedAt);
      sums[(d.getDay() + 6) % 7][d.getHours()] += s.actualMs / MIN_MS;
    });

    const avgs = sums.map((row, r) => row.map((v) => (counts[r] ? v / counts[r] : 0)));
    const maxAvg = Math.max(...avgs.flat(), 1);

    const cell = 24;
    const gap = 3;
    const padL = 36;
    const padT = 22;
    const W = padL + 24 * (cell + gap);
    const H = padT + 7 * (cell + gap) + 4;
    const empty = isLight() ? 'rgba(30,24,16,.06)' : 'rgba(255,255,255,.045)';

    let s = '';
    for (let h = 0; h < 24; h += 3) {
      s += `<text class="heat-label" x="${padL + h * (cell + gap) + cell / 2}" y="${padT - 8}" text-anchor="middle">${h}</text>`;
    }
    for (let r = 0; r < 7; r++) {
      const y = padT + r * (cell + gap);
      s += `<text class="heat-label" x="${padL - 10}" y="${y + cell / 2 + 3.4}" text-anchor="end">${WEEKDAYS[r]}</text>`;
      for (let h = 0; h < 24; h++) {
        const v = avgs[r][h];
        const alpha = v > 0 ? 0.16 + 0.8 * Math.min(1, v / maxAvg) : 0;
        const fill = v > 0 ? `rgba(255,107,94,${alpha.toFixed(2)})` : empty;
        const x = padL + h * (cell + gap);
        const title = `${WEEKDAYS[r]} ${pad(h)}:00–${pad(h)}:59 · 平均 ${v.toFixed(0)} 分钟`;
        s += `<rect class="heat-cell" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="5" fill="${fill}">
          <title>${title}</title>
        </rect>`;
      }
    }

    const steps = [0.18, 0.4, 0.62, 0.84, 1];
    const legend = steps
      .map(
        (a) =>
          `<i style="background:rgba(255,107,94,${(0.12 + 0.82 * a).toFixed(2)})"></i>`
      )
      .join('');

    el.heatmap.innerHTML = `<div class="heat-legend"><span>少</span>${legend}<span>多</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 4 周各星期与小时的平均专注时长">${s}</svg>`;
  }

  /* ==================== 统计：洞察 ==================== */
  function insight(icon, html) {
    return `<div class="insight"><span class="ico">${icon}</span><span>${html}</span></div>`;
  }

  function renderInsights() {
    const all = focusSessions();
    if (!all.length) {
      el.insights.innerHTML =
        '<div class="insights-empty">开始第一个番茄后，这里会根据你的记录生成节奏分析。</div>';
      return;
    }

    const period = rangePeriod(state.ui.range);
    const list = sessionsIn(period);
    const minutes = sum(list, (s) => s.actualMs) / MIN_MS;
    const out = [];

    if (period.prevStart != null && minutes > 0) {
      const prev =
        sum(
          all.filter((s) => s.startedAt >= period.prevStart && s.startedAt < period.prevEnd),
          (s) => s.actualMs
        ) / MIN_MS;
      if (prev > 0) {
        const diff = Math.round(((minutes - prev) / prev) * 100);
        out.push(
          insight(
            diff >= 0 ? '📈' : '📉',
            `本期专注 <b>${fmtCompact(minutes * MIN_MS)}</b>，较上一周期 <b>${diff >= 0 ? '+' : ''}${diff}%</b>`
          )
        );
      } else {
        out.push(insight('📈', `本期专注 <b>${fmtCompact(minutes * MIN_MS)}</b>，上一周期还没有记录`));
      }
    } else if (minutes > 0) {
      out.push(insight('⏱', `这段记录累计专注 <b>${fmtCompact(minutes * MIN_MS)}</b>`));
    }

    const recentFrom = startOfDay(Date.now() - 27 * DAY_MS);
    const recent = all.filter((s) => s.startedAt >= recentFrom);
    if (recent.length) {
      const hourTotals = new Array(24).fill(0);
      recent.forEach((s) => {
        hourTotals[new Date(s.startedAt).getHours()] += s.actualMs;
      });
      let bestHour = 0;
      hourTotals.forEach((v, i) => {
        if (v > hourTotals[bestHour]) bestHour = i;
      });
      if (hourTotals[bestHour] > 0) {
        out.push(
          insight(
            '⏰',
            `黄金时段是 <b>${pad(bestHour)}:00–${pad(bestHour + 1)}:00</b>，近 4 周此时段共 <b>${fmtCompact(
              hourTotals[bestHour]
            )}</b>`
          )
        );
      }

      const dowTotals = new Array(7).fill(0);
      const dowCounts = new Array(7).fill(0);
      for (let i = 0; i < 28; i++) {
        const d = new Date(recentFrom + i * DAY_MS);
        dowCounts[(d.getDay() + 6) % 7] += 1;
      }
      recent.forEach((s) => {
        dowTotals[(new Date(s.startedAt).getDay() + 6) % 7] += s.actualMs;
      });
      let bestDow = -1;
      let bestAvg = 0;
      dowTotals.forEach((v, i) => {
        const a = dowCounts[i] ? v / dowCounts[i] : 0;
        if (a > bestAvg) {
          bestAvg = a;
          bestDow = i;
        }
      });
      if (bestDow >= 0 && bestAvg > 0) {
        out.push(
          insight('🗓', `效率最高的是 <b>${WEEKDAYS[bestDow]}</b>，平均每天 <b>${Math.round(bestAvg / MIN_MS)} 分钟</b>`)
        );
      }
    }

    if (list.length) {
      const byTask = new Map();
      list.forEach((s) => {
        byTask.set(s.taskId, (byTask.get(s.taskId) || 0) + s.actualMs);
      });
      let topId = null;
      let topMs = 0;
      byTask.forEach((v, k) => {
        if (v > topMs) {
          topMs = v;
          topId = k;
        }
      });
      if (topMs > 0) {
        const pct = Math.round((topMs / (minutes * MIN_MS)) * 100);
        out.push(
          insight(
            '🎯',
            `投入最多的是 <b>${esc(taskName(topId, '未分类'))}</b>，占本期 <b>${pct}%</b>（${fmtCompact(topMs)}）`
          )
        );
      }

      const countdowns = list.filter((s) => s.timing === 'countdown');
      const completed = countdowns.filter((s) => s.completed).length;
      const avgMin = Math.round(minutes / list.length);
      out.push(
        insight(
          '🍅',
          `本期完成 <b>${list.length}</b> 次专注，平均 <b>${avgMin} 分钟</b>，完成率 <b>${
            countdowns.length ? Math.round((completed / countdowns.length) * 100) : 0
          }%</b>`
        )
      );
    }

    const streak = computeStreak();
    if (streak >= 2) {
      out.push(insight('🔥', `已连续专注 <b>${streak}</b> 天，保持住这个节奏`));
    }

    el.insights.innerHTML = out.slice(0, 5).join('');
  }

  /* ==================== 统计：记录明细 ==================== */
  function renderRecFilter() {
    const current = state.ui.recTask || 'all';
    el.recFilter.innerHTML =
      '<option value="all">全部任务</option>' +
      state.tasks.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    el.recFilter.value = state.tasks.some((t) => t.id === current) ? current : 'all';
    state.ui.recTask = el.recFilter.value;
    syncRecFilterLabel();
  }

  function syncRecFilterLabel() {
    const opt = el.recFilter.options[el.recFilter.selectedIndex];
    el.recFilterValue.textContent = opt ? opt.textContent : '全部任务';
    el.recFilterValue.title = opt ? opt.textContent : '';
  }

  function renderRecords() {
    const period = rangePeriod(state.ui.range);
    const filter = state.ui.recTask || 'all';
    const list = sessionsIn(period)
      .filter((s) => filter === 'all' || s.taskId === filter)
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, 200);

    if (!list.length) {
      el.recList.innerHTML = '<li class="rec-empty">这个筛选条件下还没有记录</li>';
      return;
    }

    el.recList.innerHTML = list
      .map((s) => {
        const mode = s.timing === 'countdown' ? `倒计时 ${Math.round(s.plannedMs / MIN_MS)}′` : '正向计时';
        return `<li class="rec">
          <span class="rec-time">${md(s.startedAt)} ${fmtTime(s.startedAt)}</span>
          <span class="rec-task"><span class="dot" style="--c:${sessionColor(s)}"></span><span>${esc(
          taskName(s.taskId, s.taskName)
        )}</span></span>
          <span class="rec-mode">${mode}</span>
          <span class="rec-dur">${fmtCompact(s.actualMs)}</span>
          <span class="badge ${s.completed ? 'done' : 'part'}">${s.completed ? '完成' : '中断'}</span>
          <button class="icon-btn rec-del" data-del="${esc(s.id)}" title="删除这条记录" aria-label="删除这条记录">✕</button>
        </li>`;
      })
      .join('');
  }

  function renderEmptyBanner() {
    if (!focusSessions().length) {
      el.statsEmpty.innerHTML = `<div class="empty-banner">
        <div>
          <strong>还没有专注记录</strong>
          <p>先完成一个番茄，或者载入一组示例数据看看统计效果。</p>
        </div>
        <button class="btn btn-soft" id="demoBtn">载入示例数据</button>
      </div>`;
    } else {
      el.statsEmpty.innerHTML = '';
    }
  }

  function renderStats() {
    const period = rangePeriod(state.ui.range);
    el.rangeLabel.textContent = period.label;
    renderKpis();
    drawBarChart();
    drawDonut();
    drawHeatmap();
    renderInsights();
    renderRecords();
    renderEmptyBanner();
  }

  /* ==================== 视图与主题 ==================== */
  function switchView(view) {
    const isTimer = view === 'timer';
    el.viewTimer.classList.toggle('is-active', isTimer);
    el.viewStats.classList.toggle('is-active', !isTimer);
    $$('#viewTabs .tab').forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (!isTimer) renderStats();
    closeSidebar();
  }

  function applyTheme(theme) {
    const resolved = theme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = resolved;
    $('#themeBtn').textContent = resolved === 'dark' ? '☀' : '☾';
    $('#themeBtn').setAttribute('aria-label', resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题');
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    state.settings.theme = next;
    saveState();
    applyTheme(next);
    if (el.viewStats.classList.contains('is-active')) renderStats();
  }

  /* ==================== 弹窗 ==================== */
  const dlgSettings = $('#dlgSettings');
  const dlgTask = $('#dlgTask');
  const dlgConfirm = $('#dlgConfirm');

  function openSettings() {
    const s = state.settings;
    $('#setFocusMin').value = s.focusMin;
    $('#setShortMin').value = s.shortMin;
    $('#setLongMin').value = s.longMin;
    $('#setLongEvery').value = s.longEvery;
    $('#setDailyGoal').value = s.dailyGoalMin;
    $('#setSound').checked = !!s.sound;
    $('#setNotify').checked = !!s.notify;
    $('#setAutoBreak').checked = !!s.autoBreak;
    $('#setAutoFocus').checked = !!s.autoFocus;
    $('#dataSummary').textContent = `共 ${state.tasks.length} 个任务 · ${state.sessions.length} 条记录，数据仅保存在本机浏览器。`;
    dlgSettings.showModal();
  }

  function readNumber(input, fallback, min, max) {
    const v = Number(input.value);
    if (!Number.isFinite(v)) return fallback;
    return clamp(Math.round(v), min, max);
  }

  function saveSettings() {
    const prevFocus = state.settings.focusMin;
    state.settings.focusMin = readNumber($('#setFocusMin'), prevFocus, 1, 180);
    state.settings.shortMin = readNumber($('#setShortMin'), state.settings.shortMin, 1, 60);
    state.settings.longMin = readNumber($('#setLongMin'), state.settings.longMin, 1, 120);
    state.settings.longEvery = readNumber($('#setLongEvery'), state.settings.longEvery, 2, 10);
    state.settings.dailyGoalMin = readNumber($('#setDailyGoal'), state.settings.dailyGoalMin, 10, 960);
    state.settings.sound = $('#setSound').checked;
    state.settings.autoBreak = $('#setAutoBreak').checked;
    state.settings.autoFocus = $('#setAutoFocus').checked;

    const wantNotify = $('#setNotify').checked;
    if (wantNotify && 'Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission().then((perm) => {
        state.settings.notify = perm === 'granted';
        saveState();
        if (perm !== 'granted') toast('浏览器未授予通知权限', 'warn', '!');
      });
    } else {
      state.settings.notify = wantNotify;
    }

    if (!timer.running && !timer.sessionStart) {
      if (timer.phase === 'focus' && timer.timing === 'countdown') {
        timer.plannedMs = phaseMs('focus');
        timer.remainingMs = timer.plannedMs;
      } else if (timer.phase !== 'focus') {
        timer.plannedMs = phaseMs(timer.phase);
        timer.remainingMs = timer.plannedMs;
      }
    }

    presetsKey = '';
    saveState();
    renderGoal();
    renderTimer();
    renderPresets();
    if (el.viewStats.classList.contains('is-active')) renderStats();
    if (prevFocus !== state.settings.focusMin) renderRecent();
    toast('设置已保存', 'ok', '✓');
  }

  let editingTaskId = null;
  let pickedColor = COLORS[0];

  function renderSwatches() {
    $('#swatches').innerHTML = COLORS.map(
      (c) => `<button type="button" class="swatch ${c === pickedColor ? 'is-active' : ''}" data-color="${c}"
        style="--c:${c}" aria-label="颜色 ${c}"></button>`
    ).join('');
  }

  function openTaskDialog(taskId) {
    editingTaskId = taskId || null;
    const task = editingTaskId ? state.tasks.find((t) => t.id === editingTaskId) : null;
    $('#taskDlgTitle').textContent = task ? '编辑任务' : '新建任务';
    $('#taskName').value = task ? task.name : '';
    pickedColor = task ? task.color : COLORS[state.tasks.length % COLORS.length];
    $('#deleteTaskBtn').style.display = task ? '' : 'none';
    renderSwatches();
    dlgTask.showModal();
    setTimeout(() => $('#taskName').focus(), 30);
  }

  function saveTask() {
    const name = $('#taskName').value.trim().slice(0, 24);
    if (!name) {
      toast('请输入任务名称', 'warn', '!');
      return;
    }
    if (editingTaskId) {
      const task = state.tasks.find((t) => t.id === editingTaskId);
      if (task) {
        task.name = name;
        task.color = pickedColor;
      }
    } else {
      const task = makeTask(name, pickedColor);
      state.tasks.push(task);
      timer.taskId = task.id;
      state.ui.taskId = task.id;
    }
    saveState();
    renderTasks();
    renderTaskSelect();
    if (el.viewStats.classList.contains('is-active')) {
      renderRecFilter();
      renderStats();
    }
    dlgTask.close();
  }

  async function deleteTask() {
    if (!editingTaskId) return;
    const task = state.tasks.find((t) => t.id === editingTaskId);
    if (!task) return;
    const ok = await askConfirm(
      '删除任务',
      `确定删除「${task.name}」吗？已有的计时记录会保留，但不再显示该任务名称。`,
      '删除'
    );
    if (!ok) return;
    state.tasks = state.tasks.filter((t) => t.id !== editingTaskId);
    if (!state.tasks.length) state.tasks = defaultState().tasks;
    if (!state.tasks.some((t) => t.id === timer.taskId)) {
      timer.taskId = state.tasks[0].id;
      state.ui.taskId = timer.taskId;
    }
    editingTaskId = null;
    saveState();
    renderTasks();
    renderTaskSelect();
    renderRecFilter();
    if (el.viewStats.classList.contains('is-active')) renderStats();
    dlgTask.close();
    toast('任务已删除', 'ok', '✓');
  }

  function askConfirm(title, message, okText) {
    return new Promise((resolve) => {
      $('#confirmTitle').textContent = title;
      $('#confirmMsg').textContent = message;
      $('#confirmYes').textContent = okText || '确定';
      const yes = $('#confirmYes');
      const no = $('#confirmNo');
      const finish = (value) => {
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click', onNo);
        dlgConfirm.removeEventListener('cancel', onCancel);
        if (dlgConfirm.open) dlgConfirm.close();
        resolve(value);
      };
      const onYes = () => finish(true);
      const onNo = () => finish(false);
      const onCancel = (e) => {
        e.preventDefault();
        finish(false);
      };
      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
      dlgConfirm.addEventListener('cancel', onCancel);
      dlgConfirm.showModal();
    });
  }

  /* ==================== 导入导出 ==================== */
  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function exportJSON() {
    const payload = {
      app: 'pomodoro',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      tasks: state.tasks,
      sessions: state.sessions,
    };
    download(`番茄钟备份-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('已导出 JSON 备份', 'ok', '⇩');
  }

  function exportCSV() {
    const rows = [['日期', '开始', '结束', '任务', '计时方式', '计划(分钟)', '实际(分钟)', '是否完成']];
    focusSessions()
      .sort((a, b) => a.startedAt - b.startedAt)
      .forEach((s) => {
        rows.push([
          dayKey(s.startedAt),
          fmtTime(s.startedAt),
          fmtTime(s.endedAt),
          taskName(s.taskId, s.taskName),
          s.timing === 'countdown' ? '倒计时' : '正向计时',
          Math.round(s.plannedMs / MIN_MS),
          (s.actualMs / MIN_MS).toFixed(1),
          s.completed ? '完成' : '中断',
        ]);
      });
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`番茄钟记录-${stamp()}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
    toast('已导出 CSV', 'ok', '⇩');
  }

  function importJSON(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON 解析失败');
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessions)) throw new Error('文件结构不正确');

    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks
          .filter((t) => t && String(t.name || '').trim())
          .map((t) => ({
            id: String(t.id || uid()),
            name: String(t.name).trim().slice(0, 24),
            color: safeColor(t.color),
            createdAt: Number(t.createdAt) || Date.now(),
          }))
      : [];
    const sessions = raw.sessions.filter(validSession);

    state.tasks = tasks.length ? tasks : defaultState().tasks;
    state.sessions = sessions;
    if (raw.settings && typeof raw.settings === 'object') {
      state.settings = Object.assign({}, defaultSettings(), raw.settings);
    }
    state.ui.taskId = state.tasks[0].id;
    timer.taskId = state.tasks[0].id;
    resetTimer('focus');
    saveState();
    renderAll();
    renderRecFilter();
    applyTheme(state.settings.theme);
    return sessions.length;
  }

  function exportAllData() {
    exportJSON();
  }

  async function clearAllData() {
    const ok = await askConfirm(
      '清空全部数据',
      '将删除所有计时记录，并恢复默认任务。此操作无法撤销，建议先导出备份。',
      '清空'
    );
    if (!ok) return;
    const keepSettings = Object.assign({}, state.settings);
    state = defaultState();
    state.settings = keepSettings;
    state.ui.taskId = state.tasks[0].id;
    timer.taskId = state.tasks[0].id;
    timer.round = 0;
    resetTimer('focus');
    saveState();
    renderAll();
    renderRecFilter();
    dlgSettings.close();
    toast('数据已清空', 'ok', '✓');
  }

  /* ==================== 示例数据 ==================== */
  function seedDemo() {
    if (focusSessions().length) {
      toast('已有记录，未载入示例数据', 'warn', '·');
      return;
    }
    const now = Date.now();
    const tasks = state.tasks.length ? state.tasks : defaultState().tasks;
    const sessions = [];
    const durations = [25, 25, 30, 45, 50];

    for (let d = 13; d >= 0; d--) {
      const base = startOfDay(now - d * DAY_MS);
      const count = 2 + Math.floor(Math.random() * 4);
      let cursor = base + 8.5 * HOUR_MS + Math.random() * 1.5 * HOUR_MS;

      for (let i = 0; i < count; i++) {
        const task = tasks[Math.floor(Math.random() * tasks.length)];
        const planned = durations[Math.floor(Math.random() * durations.length)] * MIN_MS;
        const completed = Math.random() > 0.13;
        const actual = completed ? planned : Math.round(planned * (0.35 + Math.random() * 0.45));
        if (cursor + actual > base + 23 * HOUR_MS) break;
        sessions.push({
          id: uid(),
          taskId: task.id,
          taskName: task.name,
          color: task.color,
          phase: 'focus',
          timing: 'countdown',
          plannedMs: planned,
          actualMs: actual,
          completed,
          startedAt: Math.round(cursor),
          endedAt: Math.round(cursor + actual),
        });
        cursor += actual + (5 + Math.random() * 25) * MIN_MS;
      }
    }

    state.sessions = sessions.sort((a, b) => a.startedAt - b.startedAt);
    saveState();
    renderAll();
    toast(`已载入 ${sessions.length} 条示例记录`, 'ok', '✨');
  }

  /* ==================== 全局渲染 ==================== */
  function renderAll() {
    if (!state.tasks.some((t) => t.id === timer.taskId)) {
      timer.taskId = (state.tasks[0] && state.tasks[0].id) || null;
    }
    presetsKey = '';
    dotsKey = '';
    renderTasks();
    renderTaskSelect();
    renderGoal();
    renderTodayChip();
    renderRecent();
    renderTimer();
    renderRecFilter();
    if (el.viewStats.classList.contains('is-active')) renderStats();
  }

  /* ==================== 事件绑定 ==================== */
  function openSidebar() {
    el.sidebar.classList.add('open');
    el.scrim.hidden = false;
  }

  function closeSidebar() {
    el.sidebar.classList.remove('open');
    el.scrim.hidden = true;
  }

  function bindEvents() {
    el.viewTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) switchView(tab.dataset.view);
    });

    el.timingSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-timing]');
      if (btn) setTiming(btn.dataset.timing);
    });

    el.presets.addEventListener('click', (e) => {
      const custom = e.target.closest('button[data-custom]');
      if (custom) {
        openSettings();
        setTimeout(() => {
          const input = $('#setFocusMin');
          if (input) {
            input.focus();
            input.select();
          }
        }, 80);
        return;
      }
      const btn = e.target.closest('button[data-min]');
      if (btn) setFocusMinutes(Number(btn.dataset.min));
    });

    el.toggleBtn.addEventListener('click', toggleTimer);
    el.resetBtn.addEventListener('click', () => {
      resetTimer(timer.phase);
      toast('计时已重置', 'ok', '↺');
    });
    el.skipBtn.addEventListener('click', skipPhase);

    el.taskSelect.addEventListener('change', () => selectTask(el.taskSelect.value));

    el.taskList.addEventListener('click', (e) => {
      const more = e.target.closest('[data-more]');
      if (more) {
        e.stopPropagation();
        openTaskDialog(more.getAttribute('data-more'));
        return;
      }
      const item = e.target.closest('.task-item');
      if (item) selectTask(item.dataset.id);
    });

    $('#addTaskBtn').addEventListener('click', () => openTaskDialog());
    $('#newTaskBtn').addEventListener('click', () => openTaskDialog());

    $('#settingsBtn').addEventListener('click', openSettings);
    $('#exportBtn').addEventListener('click', exportAllData);
    $('#themeBtn').addEventListener('click', toggleTheme);

    $('#menuBtn').addEventListener('click', openSidebar);
    $('#closeSidebar').addEventListener('click', closeSidebar);
    el.scrim.addEventListener('click', closeSidebar);

    el.rangeSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-range]');
      if (!btn) return;
      state.ui.range = btn.dataset.range;
      saveState();
      $$('#rangeSeg button').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderStats();
    });

    el.recFilter.addEventListener('change', () => {
      state.ui.recTask = el.recFilter.value;
      saveState();
      syncRecFilterLabel();
      renderRecords();
    });

    el.recList.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del]');
      if (!btn) return;
      const id = btn.getAttribute('data-del');
      const ok = await askConfirm('删除记录', '确定删除这条计时记录吗？统计数字会随之更新。', '删除');
      if (!ok) return;
      state.sessions = state.sessions.filter((s) => s.id !== id);
      saveState();
      refreshAll();
      toast('记录已删除', 'ok', '✓');
    });

    $('#exportCsvBtn').addEventListener('click', exportCSV);
    $('#exportCsvBtn2').addEventListener('click', exportCSV);
    $('#exportJsonBtn').addEventListener('click', exportJSON);

    $('#statsEmpty').addEventListener('click', (e) => {
      if (e.target.closest('#demoBtn')) seedDemo();
    });

    $$('[data-goto-stats]').forEach((btn) => btn.addEventListener('click', () => switchView('stats')));

    $('#settingsForm').addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      saveSettings();
      dlgSettings.close();
    });

    $('#taskForm').addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      saveTask();
    });

    $('#swatches').addEventListener('click', (e) => {
      const sw = e.target.closest('[data-color]');
      if (!sw) return;
      pickedColor = sw.dataset.color;
      renderSwatches();
    });

    $('#deleteTaskBtn').addEventListener('click', deleteTask);

    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const ok = await askConfirm(
            '导入数据',
            '导入会覆盖当前的记录和任务，建议先导出备份。继续吗？',
            '导入'
          );
          if (!ok) return;
          const count = importJSON(String(reader.result || ''));
          dlgSettings.close();
          toast(`已导入 ${count} 条记录`, 'ok', '⇧');
        } catch (err) {
          toast(`导入失败：${err.message || '未知错误'}`, 'warn', '!');
        }
      };
      reader.readAsText(file);
    });

    $('#clearDataBtn').addEventListener('click', clearAllData);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) saveSnapshot();
      else if (timer.running) renderTimer();
    });
    window.addEventListener('pagehide', saveSnapshot);

    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('dialog[open]')) return;

      if (e.code === 'Space') {
        e.preventDefault();
        toggleTimer();
      } else if (e.key === 'r' || e.key === 'R') {
        resetTimer(timer.phase);
      } else if (e.key === 's' || e.key === 'S') {
        skipPhase();
      } else if (e.key === '1') {
        setTiming('countdown');
      } else if (e.key === '2') {
        setTiming('countup');
      }
    });

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (!state.settings.theme) {
          applyTheme(null);
          if (el.viewStats.classList.contains('is-active')) renderStats();
        }
      });
    }
  }

  /* ==================== 初始化 ==================== */
  function init() {
    applyTheme(state.settings.theme);
    renderTicks();

    timer.taskId =
      state.ui.taskId && state.tasks.some((t) => t.id === state.ui.taskId)
        ? state.ui.taskId
        : state.tasks[0].id;
    timer.round = clamp(Number(state.ui.round) || 0, 0, 999);

    // 恢复已保存的界面状态
    state.ui.range = ['today', 'week', 'month', 'all'].includes(state.ui.range) ? state.ui.range : 'week';
    $$('#rangeSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.range === state.ui.range));

    resetTimer('focus', { save: false });
    restoreSnapshot();

    bindEvents();
    renderAll();

    // 让页面显示的值与恢复后的状态保持一致
    $$('#timingSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.timing === timer.timing));
    renderTimer();
  }

  init();
})();
