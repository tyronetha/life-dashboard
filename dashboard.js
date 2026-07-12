/*
 * L I F E Dashboard logic — the original Claude Design component, unchanged
 * except save() and componentDidMount(), which now sync through Supabase
 * (window.DB) in addition to the localStorage cache.
 */
class Component extends DCLogic {
  KEY = 'life-dashboard-v1';

  iso(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
  todayISO() { return this.iso(new Date()); }
  tomorrowISO() { const d = new Date(); d.setDate(d.getDate() + 1); return this.iso(d); }
  newId() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('u' + Date.now() + Math.random().toString(16).slice(2)); }
  db() { return (window.DB && window.DB.user) ? window.DB : null; }

  defaultData() {
    const t = this.todayISO();
    return {
      lastGen: '',
      tasks: [ { id: 'seed-notion', title: 'Design out Notion', type: 'One-off', tag: 'Life', done: false, doDate: t, whatToDo: '', archived: false } ],
      routines: [ { id: 'r-leet', name: 'Leetcode', active: true, order: 1, whatToDo: '5 problems' } ],
      apps: [],
      solves: [ { id: 's-twosum', name: 'Two Sum', difficulty: 'Easy', date: t, outcome: 'solved' } ],
      books: [
        { id: 'b1', title: 'System Design Interview — Vol 1', short: 'SDI Vol 1', pct: 0 },
        { id: 'b2', title: 'System Design Interview — Vol 2', short: 'SDI Vol 2', pct: 0 },
        { id: 'b3', title: 'Designing Data-Intensive Applications', short: 'DDIA', pct: 0 },
      ],
      ood: [
        'Design Uber', 'Vending Machine', 'Chess', 'Movie Ticket Booking', 'Logger',
        'Snake & Ladder', 'Tic-Tac-Toe', 'Splitwise', 'Deck of Cards', 'Amazon Locker', 'Library Mgmt',
      ].map((n, i) => ({ id: 'ood' + i, name: n, status: 'Not Started', difficulty: ['Hard','Easy','Medium','Medium','Easy','Easy','Easy','Hard','Easy','Medium','Medium'][i] })),
      events: {},
      goals: [
        { id: 'g1', title: 'Land a software engineering role', pct: 20 },
        { id: 'g2', title: 'Solve 150 LeetCode problems', pct: 1 },
      ],
      weights: [],
      weightUnit: 'kg',
      quotes: [
        '“A line you live by — tap to make it yours.”',
        '“Something to remember on the hard days.”',
        '“Your third quote goes here.”',
      ],
      currently: [
        { icon: '🎧', label: 'listening', value: 'add an album or podcast…' },
        { icon: '📖', label: 'reading', value: 'add a book…' },
        { icon: '🎮', label: 'playing', value: 'add a game…' },
        { icon: '📺', label: 'watching', value: 'add a show…' },
      ],
    };
  }

  load() { try { const raw = localStorage.getItem(this.KEY); if (raw) return { ...this.defaultData(), ...JSON.parse(raw) }; } catch (e) {} return this.defaultData(); }
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.state.data)); } catch (e) {}
    if (window.DB && window.DB.save) window.DB.save(this.state.data);
  }

  state = { data: null, view: 'home', weekOffset: 0 };

  async componentDidMount() {
    let data = this.load();                       // blob: free-form bits + backup
    const DB = this.db();
    if (DB) {
      try {
        const remote = await DB.load();           // pull free-form bits (solves/goals/weights/quotes/currently)
        if (remote && Object.keys(remote).length) data = { ...this.defaultData(), ...remote };
        await DB.generateDay();                   // server-side daily gen + one-off rollover (idempotent)
        const t = await DB.loadTables();          // tables are the source of truth for the normalized entities
        data = { ...data, routines: t.routines, tasks: t.tasks, apps: t.apps,
                 books: t.books, chapters: t.chapters, calEvents: t.calEvents, calExceptions: t.calExceptions };
        this.setState({ data }, () => this.save());
        await this.ensureSeedCalendar(data);      // first run: seed the weekday routine as recurring events
        return;
      } catch (e) { console.error('table load failed, using local', e); }
    }
    data = this.runDailyGen(data);                // offline fallback
    data.chapters = data.chapters || []; data.calEvents = data.calEvents || []; data.calExceptions = data.calExceptions || [];
    this.setState({ data }, () => this.save());
  }

  // Seed the fixed weekday routine into the events table once, so the calendar
  // starts populated but is now editable/persistent (recurrence rules).
  async ensureSeedCalendar(data) {
    const DB = this.db();
    if (!DB || (data.calEvents && data.calEvents.length) || data._seededCal) return;
    const move = 'oklch(0.6 0.08 245)', work = 'oklch(0.55 0.08 55)', meal = 'oklch(0.58 0.09 150)', career = 'oklch(0.6 0.1 200)', read = 'oklch(0.56 0.11 300)';
    const wk = [1, 2, 3, 4, 5], all = [0, 1, 2, 3, 4, 5, 6];
    const defs = [
      { title: 'Wake → 15m', startMin: 510, endMin: 525, color: move, weekdays: wk },
      { title: 'Workout', startMin: 525, endMin: 570, color: move, weekdays: [1, 3, 5] },
      { title: 'HIIT', startMin: 525, endMin: 570, color: move, weekdays: [2, 4] },
      { title: 'Work', startMin: 570, endMin: 1020, color: work, weekdays: wk },
      { title: 'Leetcode', startMin: 1020, endMin: 1050, color: career, weekdays: wk },
      { title: 'Job App', startMin: 1050, endMin: 1080, color: career, weekdays: wk },
      { title: 'Dinner', startMin: 1080, endMin: 1110, color: meal, weekdays: all },
      { title: 'Treadmill Walk', startMin: 1110, endMin: 1170, color: move, weekdays: wk },
      { title: 'Shower / Chill', startMin: 1170, endMin: 1290, color: move, weekdays: wk },
      { title: 'Casein shake', startMin: 1290, endMin: 1305, color: move, weekdays: wk },
      { title: 'Book reading', startMin: 1320, endMin: 1365, color: read, weekdays: all },
    ].map((e) => ({ ...e, id: this.newId(), date: this.todayISO(), recurs: 'weekly', source: 'routine' }));
    await DB.insertEventsBulk(defs);
    this.setState((s) => { const d = JSON.parse(JSON.stringify(s.data)); d.calEvents = defs; d._seededCal = true; return { data: d }; });
  }

  runDailyGen(data) {
    const today = this.todayISO();
    if (data.lastGen === today) return data;
    const d = JSON.parse(JSON.stringify(data));
    d.tasks.forEach((t) => { if (t.type === 'One-off' && !t.done && !t.archived && t.doDate && t.doDate < today) t.archived = true; });
    d.tasks.forEach((t) => { if (t.type === 'One-off' && !t.archived && !t.doDate) t.doDate = this.tomorrowISO(); });
    d.routines.filter((r) => r.active).sort((a, b) => a.order - b.order).forEach((r) => {
      const exists = d.tasks.some((t) => t.type === 'Daily' && t.doDate === today && t.title === r.name && !t.archived);
      if (!exists) d.tasks.push({ id: 'd-' + r.id + '-' + today, title: r.name, type: 'Daily', tag: r.tag || 'Work', done: false, doDate: today, whatToDo: r.whatToDo || '', archived: false });
    });
    d.lastGen = today;
    return d;
  }

  mutate(fn) { this.setState((s) => { const d = JSON.parse(JSON.stringify(s.data)); fn(d); return { data: d }; }, () => this.save()); }
  setView = (v) => this.setState({ view: v });
  shiftWeek = (delta) => this.setState((s) => ({ weekOffset: (s.weekOffset || 0) + delta }));
  thisWeek = () => this.setState({ weekOffset: 0 });

  toggleTask = (id) => {
    const t = this.state.data.tasks.find((x) => x.id === id); if (!t) return;
    const done = !t.done;
    this.mutate((d) => { const x = d.tasks.find((y) => y.id === id); if (x) x.done = done; });
    const DB = this.db(); if (DB) DB.setTaskDone(id, done);
  };
  removeTask = (id) => { this.mutate((d) => { d.tasks = d.tasks.filter((x) => x.id !== id); }); const DB = this.db(); if (DB) DB.deleteTask(id); };
  addTaskToday = (title) => {
    const row = { id: this.newId(), title, type: 'One-off', tag: 'Life', done: false, doDate: this.todayISO(), whatToDo: '', archived: false };
    this.mutate((d) => { d.tasks.push(row); }); const DB = this.db(); if (DB) DB.insertTask(row);
  };
  addOneOff = (title) => {
    const row = { id: this.newId(), title, type: 'One-off', tag: 'Life', done: false, doDate: this.tomorrowISO(), whatToDo: '', archived: false };
    this.mutate((d) => { d.tasks.push(row); }); const DB = this.db(); if (DB) DB.insertTask(row);
  };
  addRoutine = (name) => {
    const row = { id: this.newId(), name, active: true, order: this.state.data.routines.length + 1, whatToDo: '' };
    this.mutate((d) => { d.routines.push(row); }); const DB = this.db(); if (DB) DB.insertRoutine(row);
  };
  toggleRoutine = (id) => {
    const r = this.state.data.routines.find((x) => x.id === id); if (!r) return;
    const active = !r.active;
    this.mutate((d) => { const x = d.routines.find((y) => y.id === id); if (x) x.active = active; });
    const DB = this.db(); if (DB) DB.setRoutineActive(id, active);
  };
  removeRoutine = (id) => { this.mutate((d) => { d.routines = d.routines.filter((x) => x.id !== id); }); const DB = this.db(); if (DB) DB.deleteRoutine(id); };

  addApp = (company, role) => {
    const row = { id: this.newId(), company, role: role || '', status: 'Wishlist', link: '', location: '', appliedOn: '', notes: '', sortOrder: this.state.data.apps.length };
    this.mutate((d) => { d.apps.push(row); }); const DB = this.db(); if (DB) DB.insertApp(row);
  };
  removeApp = (id) => { this.mutate((d) => { d.apps = d.apps.filter((x) => x.id !== id); }); const DB = this.db(); if (DB) DB.deleteApp(id); };
  cycleApp = (id) => {
    const order = ['Wishlist', 'Applied', 'OA', 'Phone Screen', 'Onsite', 'Offer', 'Rejected'];
    const a = this.state.data.apps.find((x) => x.id === id); if (!a) return;
    const status = order[(order.indexOf(a.status) + 1) % order.length];
    this.mutate((d) => { const x = d.apps.find((y) => y.id === id); if (x) x.status = status; });
    const DB = this.db(); if (DB) DB.setAppStatus(id, status);
  };
  // applications grid: edit a cell locally; persist the whole grid via batch upsert
  editApp = (id, field, value) => { this.mutate((d) => { const a = d.apps.find((x) => x.id === id); if (a) a[field] = value; }); };
  saveApps = () => { const DB = this.db(); if (DB) DB.upsertApps(this.state.data.apps); };
  importApps = (text) => {
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const c = line.split(/\t|,/).map((s) => s.trim());
      return { id: this.newId(), company: c[0] || '', role: c[1] || '', status: c[2] || 'Wishlist',
               link: c[3] || '', location: c[4] || '', appliedOn: '', notes: c[5] || '', sortOrder: 0 };
    }).filter((r) => r.company);
    if (!rows.length) return;
    this.mutate((d) => { rows.forEach((r, i) => { r.sortOrder = d.apps.length + i; d.apps.push(r); }); });
    const DB = this.db(); if (DB) DB.upsertApps(this.state.data.apps);
  };

  // ---------- prep: book chapters ----------
  addChapter = (bookId, title) => {
    const chs = (this.state.data.chapters || []).filter((c) => c.bookId === bookId);
    const row = { id: this.newId(), bookId, number: chs.length + 1, title, status: 'todo', sortOrder: chs.length + 1 };
    this.mutate((d) => { (d.chapters = d.chapters || []).push(row); }); const DB = this.db(); if (DB) DB.insertChapter(row);
  };
  cycleChapter = (id) => {
    const order = ['todo', 'reading', 'done'];
    const c = (this.state.data.chapters || []).find((x) => x.id === id); if (!c) return;
    const status = order[(order.indexOf(c.status) + 1) % order.length];
    this.mutate((d) => { const x = d.chapters.find((y) => y.id === id); if (x) x.status = status; });
    const DB = this.db(); if (DB) DB.setChapterStatus(id, status);
  };
  removeChapter = (id) => { this.mutate((d) => { d.chapters = (d.chapters || []).filter((x) => x.id !== id); }); const DB = this.db(); if (DB) DB.deleteChapter(id); };

  // ---------- calendar events ----------
  addEvent = (title, date, startMin, endMin) => {
    const row = { id: this.newId(), title, date, startMin, endMin, color: 'oklch(0.6 0.1 200)', recurs: null, source: 'user' };
    this.mutate((d) => { (d.calEvents = d.calEvents || []).push(row); }); const DB = this.db(); if (DB) DB.insertEvent(row);
  };
  removeEventOccurrence = (id, date, recurring) => {
    const DB = this.db();
    if (recurring) {
      const ex = { id: this.newId(), eventId: id, date };
      this.mutate((d) => { (d.calExceptions = d.calExceptions || []).push({ eventId: id, date }); });
      if (DB) DB.addException(ex);
    } else {
      this.mutate((d) => { d.calEvents = (d.calEvents || []).filter((x) => x.id !== id); });
      if (DB) DB.deleteEvent(id);
    }
  };

  addSolve = (name, difficulty, outcome, note) => this.mutate((d) => { d.solves.push({ id: 's' + Date.now(), name: name || 'Untitled', difficulty, date: this.todayISO(), outcome: outcome || 'solved', note: note || '' }); });
  removeSolve = (id) => this.mutate((d) => { d.solves = d.solves.filter((x) => x.id !== id); });
  setSolveNote = (id, text) => this.mutate((d) => { const s = d.solves.find((x) => x.id === id); if (s) s.note = text; });
  cycleOod = (id) => this.mutate((d) => { const order = ['Not Started', 'In Progress', 'Done']; const p = d.ood.find((x) => x.id === id); if (p) p.status = order[(order.indexOf(p.status) + 1) % order.length]; });

  addGoal = (title) => this.mutate((d) => { d.goals.push({ id: 'g' + Date.now(), title, pct: 0 }); });
  setGoal = (id, delta) => this.mutate((d) => { const g = d.goals.find((x) => x.id === id); if (g) g.pct = Math.max(0, Math.min(100, g.pct + delta)); });
  removeGoal = (id) => this.mutate((d) => { d.goals = d.goals.filter((x) => x.id !== id); });
  addWeight = (val) => this.mutate((d) => { const t = this.todayISO(); d.weights = d.weights.filter((w) => w.date !== t); d.weights.push({ date: t, v: val }); });

  // recurring weekday routine → timed calendar blocks
  templateFor(dow) {
    const move = 'oklch(0.6 0.08 245)', work = 'oklch(0.55 0.08 55)', meal = 'oklch(0.58 0.09 150)', career = 'oklch(0.6 0.1 200)', read = 'oklch(0.56 0.11 300)';
    if (dow >= 1 && dow <= 5) {
      const workout = (dow % 2 === 1) ? 'Workout' : 'HIIT';
      return [
        { title: 'Wake → 15m', start: 510, end: 525, color: move },
        { title: workout, start: 525, end: 570, color: move },
        { title: 'Work', start: 570, end: 1020, color: work },
        { title: 'Leetcode', start: 1020, end: 1050, color: career },
        { title: 'Job App', start: 1050, end: 1080, color: career },
        { title: 'Dinner', start: 1080, end: 1110, color: meal },
        { title: 'Treadmill Walk', start: 1110, end: 1170, color: move },
        { title: 'Shower / Chill', start: 1170, end: 1290, color: move },
        { title: 'Casein shake', start: 1290, end: 1305, color: move },
        { title: 'Book reading', start: 1320, end: 1365, color: read },
      ];
    }
    return [
      { title: 'Dinner', start: 1080, end: 1110, color: meal },
      { title: 'Book reading', start: 1320, end: 1365, color: read },
    ];
  }
  minLabel(m) { let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? 'PM' : 'AM'; let hh = h % 12; if (hh === 0) hh = 12; return `${hh}:${String(mm).padStart(2, '0')} ${ap}`; }

  renderVals() {
    const d = this.state.data;
    const name = this.props.name ?? 'Tyrone';
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const mAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const todayLabel = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
    const view = this.state.view;
    const base = {
      name, greeting, todayLabel,
      isHome: view === 'home', isCal: view === 'calendar', isDaily: view === 'daily', isLeet: view === 'leetcode', isApps: view === 'applications', isPrep: view === 'prep',
      navSide: [
        { emoji: '🍀', label: 'Home', v: 'home' },
        { emoji: '🌱', label: 'Calendar', v: 'calendar' },
        { emoji: '🍃', label: 'Daily', v: 'daily' },
        { emoji: '✦', label: 'LeetCode', v: 'leetcode' },
        { emoji: '🌾', label: 'Applications', v: 'applications' },
        { emoji: '🪴', label: 'Prep', v: 'prep' },
      ].map((n) => ({ ...n, go: () => this.setView(n.v), color: view === n.v ? 'oklch(0.2 0.05 160)' : 'oklch(0.95 0.02 150)', bg: view === n.v ? 'oklch(0.86 0.13 168)' : 'transparent' })),
    };
    if (!d) return { ...base, doneLabel: '—' };

    const today = this.todayISO();

    const decorate = (t) => ({
      ...t,
      toggle: () => this.toggleTask(t.id), remove: () => this.removeTask(t.id),
      check: t.done ? '✓' : '',
      boxBg: t.done ? 'oklch(0.62 0.13 160)' : 'transparent',
      boxBorder: t.done ? 'oklch(0.62 0.13 160)' : 'oklch(0.75 0.04 158)',
      textColor: t.done ? 'oklch(0.62 0.03 158)' : 'oklch(0.3 0.035 158)',
      strike: t.done ? 'line-through' : 'none',
      tagBg: t.type === 'Daily' ? 'oklch(0.86 0.09 165)' : 'oklch(0.88 0.07 205)',
      tagColor: t.type === 'Daily' ? 'oklch(0.3 0.08 160)' : 'oklch(0.3 0.07 205)',
      dateLabel: t.doDate === today ? 'today' : t.doDate === this.tomorrowISO() ? 'tomorrow' : (t.doDate || ''),
    });
    const todayTasks = d.tasks.filter((t) => !t.archived && t.doDate === today).map(decorate);
    const doneN = todayTasks.filter((t) => t.done).length;
    const doneLabel = `${doneN}/${todayTasks.length}`;
    const noTasks = todayTasks.length === 0;
    const todayDailyTasks = todayTasks.filter((t) => t.type === 'Daily');
    const todayOneoffTasks = todayTasks.filter((t) => t.type === 'One-off');
    const noDailyToday = todayDailyTasks.length === 0;
    const noOneoffToday = todayOneoffTasks.length === 0;
    const dailyDoneLabel = `${todayDailyTasks.filter((t) => t.done).length}/${todayDailyTasks.length}`;
    const oneoffDoneLabel = `${todayOneoffTasks.filter((t) => t.done).length}/${todayOneoffTasks.length}`;
    const oneOffs = d.tasks.filter((t) => t.type === 'One-off' && !t.archived && !t.done).map(decorate);
    const noOneOffs = oneOffs.length === 0;
    const archive = d.tasks.filter((t) => t.archived || (t.done && t.doDate < today)).slice(-40).reverse().map((t) => ({
      title: t.title, strike: t.done ? 'line-through' : 'none', outcome: t.done ? 'done' : 'missed',
      dot: t.done ? 'oklch(0.66 0.12 160)' : 'oklch(0.7 0.08 40)', dateLabel: t.doDate || '',
    }));
    const noArchive = archive.length === 0;
    const archiveCount = archive.length;

    // ---- calendar week grid ----
    const HSTART = 6, HEND = 23, ROW = 54;
    const gridHeight = (HEND - HSTART) * ROW;
    const gridHeightPx = `${gridHeight}px`;
    const hourLines = [];
    for (let h = HSTART; h <= HEND - 1; h++) { hourLines.push({ label: this.minLabel(h * 60).replace(':00', ''), top: `${(h - HSTART) * ROW}px` }); }
    const wkOff = this.state.weekOffset || 0;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + wkOff * 7);
    const tasksByIso = {}; d.tasks.filter((t) => !t.archived).forEach((t) => { (tasksByIso[t.doDate] = tasksByIso[t.doDate] || []).push(t); });
    const calEvents = d.calEvents || [];
    const calEx = d.calExceptions || [];
    const excepted = (id, ciso) => calEx.some((x) => x.eventId === id && x.date === ciso);
    const appliesOn = (ev, dow, ciso) => {
      if (ev.recurs === 'weekly') return (ev.weekdays || []).includes(dow) && !excepted(ev.id, ciso) && (!ev.recurUntil || ciso <= ev.recurUntil);
      return ev.date === ciso && !excepted(ev.id, ciso);
    };
    const weekDays = [], dayColumns = [], calDays = [];
    for (let i = 0; i < 7; i++) {
      const cd = new Date(weekStart); cd.setDate(weekStart.getDate() + i);
      const ciso = this.iso(cd); const isTod = ciso === today; const dow = cd.getDay();
      weekDays.push({ dow: dows[dow], num: cd.getDate(), numColor: isTod ? '#fff' : 'oklch(0.34 0.05 158)', numBg: isTod ? 'oklch(0.6 0.14 25)' : 'transparent' });
      calDays.push({ iso: ciso, label: `${dows[dow]} ${cd.getDate()}` });
      const events = calEvents.filter((ev) => ev.startMin != null && appliesOn(ev, dow, ciso)).map((ev) => ({
        title: ev.title, color: ev.color || 'oklch(0.6 0.1 200)',
        top: `${((ev.startMin - HSTART * 60) / 60) * ROW}px`,
        height: `${Math.max(16, ((ev.endMin - ev.startMin) / 60) * ROW - 2)}px`,
        timeLabel: this.minLabel(ev.startMin),
        remove: () => this.removeEventOccurrence(ev.id, ciso, ev.recurs === 'weekly'),
      }));
      const allday = [];
      (tasksByIso[ciso] || []).forEach((t) => allday.push({ text: t.title, bg: t.type === 'Daily' ? 'oklch(0.9 0.05 165)' : 'oklch(0.9 0.05 205)', color: t.type === 'Daily' ? 'oklch(0.32 0.07 160)' : 'oklch(0.32 0.07 210)', canRemove: false, remove: () => {} }));
      calEvents.filter((ev) => ev.startMin == null && appliesOn(ev, dow, ciso)).forEach((ev) => allday.push({ text: ev.title, bg: 'oklch(0.9 0.05 150)', color: 'oklch(0.32 0.06 150)', canRemove: true, remove: () => this.removeEventOccurrence(ev.id, ciso, ev.recurs === 'weekly') }));
      dayColumns.push({ iso: ciso, events, allday, todayTint: isTod ? 'oklch(0.97 0.02 150)' : 'transparent' });
    }
    const midWeek = new Date(weekStart); midWeek.setDate(weekStart.getDate() + 3);
    const calMonthName = months[midWeek.getMonth()];
    const calYear = midWeek.getFullYear();
    const prevWeek = () => this.shiftWeek(-1);
    const nextWeek = () => this.shiftWeek(1);
    const thisWeek = this.thisWeek;
    const onAddEvent = () => {
      const t = document.querySelector('[data-ev-title]'), day = document.querySelector('[data-ev-day]');
      const s = document.querySelector('[data-ev-start]'), e2 = document.querySelector('[data-ev-end]');
      if (!t || !t.value.trim()) return;
      const toMin = (v) => { if (!v) return null; const p = v.split(':'); return (+p[0]) * 60 + (+(p[1] || 0)); };
      let sm = toMin(s && s.value), em = toMin(e2 && e2.value);
      if (sm == null) sm = 540; if (em == null || em <= sm) em = sm + 60;
      this.addEvent(t.value.trim(), (day && day.value) || today, sm, em);
      if (t) t.value = '';
    };

    // ---- leetcode ----
    const cE = 'oklch(0.8 0.13 165)', cM = 'oklch(0.72 0.12 205)', cH = 'oklch(0.5 0.11 158)';
    const solvedSolves = d.solves.filter((s) => s.outcome !== 'failed');
    const failedSolves = d.solves.filter((s) => s.outcome === 'failed');
    const leet = { Easy: 0, Medium: 0, Hard: 0 };
    solvedSolves.forEach((s) => { if (leet[s.difficulty] != null) leet[s.difficulty]++; });
    const leetTotal = solvedSolves.length;
    const failedCount = failedSolves.length;
    const attempted = leetTotal + failedCount;
    const successLabel = `${attempted ? Math.round((leetTotal / attempted) * 100) : 0}%`;
    const denom = leetTotal || 1;
    const p1 = (leet.Easy / denom) * 100, p2 = ((leet.Easy + leet.Medium) / denom) * 100;
    const donutBg = leetTotal === 0 ? 'oklch(0.92 0.02 152)' : `conic-gradient(${cE} 0 ${p1}%, ${cM} 0 ${p2}%, ${cH} 0 100%)`;
    const leetLegend = [{ label: 'Easy', count: leet.Easy, color: cE }, { label: 'Medium', count: leet.Medium, color: cM }, { label: 'Hard', count: leet.Hard, color: cH }];
    const leetToday = solvedSolves.filter((s) => s.date === today).length;
    const leetTodayLabel = leetToday > 0 ? `${leetToday} solved today ✦` : 'none solved today yet';
    const diffColor = { Easy: cE, Medium: cM, Hard: cH };
    const readLeetForm = () => { const inp = document.querySelector('[data-leet-input]'); const nt = document.querySelector('[data-leet-note]'); return { name: inp ? inp.value.trim() : '', note: nt ? nt.value.trim() : '', clear: () => { if (inp) inp.value = ''; if (nt) nt.value = ''; } }; };
    const leetSolvedBtns = [{ label: 'Easy', color: cE }, { label: 'Medium', color: cM }, { label: 'Hard', color: cH }].map((b) => ({ ...b, add: () => { const f = readLeetForm(); if (!f.name) return; this.addSolve(f.name, b.label, 'solved', f.note); f.clear(); } }));
    const leetFailedBtns = [{ label: 'Easy', color: cE }, { label: 'Medium', color: cM }, { label: 'Hard', color: cH }].map((b) => ({ ...b, add: () => { const f = readLeetForm(); if (!f.name) return; this.addSolve(f.name, b.label, 'failed', f.note); f.clear(); } }));
    const onLeetCancel = () => { const f = readLeetForm(); f.clear(); };
    const onLeetKey = () => {};
    const mapSolve = (s) => { const dd = new Date(s.date + 'T00:00:00'); return { name: s.name, difficulty: s.difficulty, color: diffColor[s.difficulty] || cE, dateLabel: `${mAbbr[dd.getMonth()]} ${dd.getDate()}`, note: s.note || '', onNote: (e) => this.setSolveNote(s.id, e.target.value), remove: () => this.removeSolve(s.id) }; };
    const solvedList = [...solvedSolves].reverse().map(mapSolve);
    const failedList = [...failedSolves].reverse().map(mapSolve);
    const noSolves = solvedList.length === 0;
    const noFailed = failedList.length === 0;

    // ---- prep: books with chapter-derived progress ----
    const chaptersAll = d.chapters || [];
    const bookPct = (b) => { const chs = chaptersAll.filter((c) => c.bookId === b.id); const done = chs.filter((c) => c.status === 'done').length; return chs.length ? Math.round((done / chs.length) * 100) : 0; };
    const chapColor = { todo: 'oklch(0.72 0.02 158)', reading: 'oklch(0.72 0.13 205)', done: 'oklch(0.62 0.14 150)' };
    const chapBg = { todo: 'oklch(0.975 0.01 150)', reading: 'oklch(0.95 0.04 205)', done: 'oklch(0.94 0.05 150)' };
    const chapShort = { todo: 'todo', reading: 'reading', done: 'done' };
    const sysBooks = d.books.map((b) => {
      const chs = chaptersAll.filter((c) => c.bookId === b.id).sort((a, z) => (a.number || 0) - (z.number || 0) || (a.sortOrder || 0) - (z.sortOrder || 0));
      const pct = bookPct(b);
      return {
        ...b, pct, pctLabel: `${pct}%`,
        chapCount: chs.length, doneLabel: `${chs.filter((c) => c.status === 'done').length}/${chs.length}`,
        noChapters: chs.length === 0,
        chapters: chs.map((c) => ({ id: c.id, title: c.title, numLabel: c.number ? `${c.number}.` : '•', statusShort: chapShort[c.status], statusColor: chapColor[c.status], bg: chapBg[c.status], cycle: () => this.cycleChapter(c.id), remove: () => this.removeChapter(c.id) })),
        onAddChapter: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { this.addChapter(b.id, e.target.value.trim()); e.target.value = ''; } },
      };
    });

    const oodStatusColor = { 'Not Started': 'oklch(0.72 0.02 158)', 'In Progress': 'oklch(0.72 0.13 205)', 'Done': 'oklch(0.62 0.14 150)' };
    const oodStatusShort = { 'Not Started': 'todo', 'In Progress': 'wip', 'Done': 'done' };
    const oodBg = { 'Not Started': 'oklch(0.975 0.01 150)', 'In Progress': 'oklch(0.95 0.04 205)', 'Done': 'oklch(0.94 0.05 150)' };
    const oodBorder = { 'Not Started': 'oklch(0.92 0.016 152)', 'In Progress': 'oklch(0.86 0.06 205)', 'Done': 'oklch(0.82 0.09 150)' };
    const ood = d.ood.map((p) => ({ ...p, cycle: () => this.cycleOod(p.id), statusColor: oodStatusColor[p.status], statusShort: oodStatusShort[p.status], bg: oodBg[p.status], border: oodBorder[p.status] }));
    const oodDone = d.ood.filter((p) => p.status === 'Done').length;
    const oodPctLabel = `${Math.round((oodDone / d.ood.length) * 100)}%`;
    const oodFrac = `${oodDone}/${d.ood.length}`;

    const stageDefs = [
      { name: 'Wishlist', full: 'Wishlist', color: 'oklch(0.72 0.03 158)' },
      { name: 'Applied', full: 'Applied', color: 'oklch(0.72 0.13 205)' },
      { name: 'OA', full: 'OA', color: 'oklch(0.78 0.13 175)' },
      { name: 'Phone', full: 'Phone Screen', color: 'oklch(0.72 0.13 165)' },
      { name: 'Onsite', full: 'Onsite', color: 'oklch(0.64 0.14 152)' },
      { name: 'Offer', full: 'Offer', color: 'oklch(0.62 0.15 145)' },
    ];
    const colorFor = (status) => (stageDefs.find((s) => s.full === status) || { color: 'oklch(0.7 0.08 40)' }).color;
    const appRows = d.apps.map((a) => ({
      ...a, color: colorFor(a.status), cycle: () => this.cycleApp(a.id), remove: () => this.removeApp(a.id),
      onCompany: (e) => this.editApp(a.id, 'company', e.target.value),
      onRole: (e) => this.editApp(a.id, 'role', e.target.value),
      onLink: (e) => this.editApp(a.id, 'link', e.target.value),
      onLocation: (e) => this.editApp(a.id, 'location', e.target.value),
      onApplied: (e) => this.editApp(a.id, 'appliedOn', e.target.value),
      onNotes: (e) => this.editApp(a.id, 'notes', e.target.value),
    }));
    const noApps = appRows.length === 0;
    const saveApps = () => this.saveApps();
    const onImportApps = () => { const ta = document.querySelector('[data-app-import]'); if (ta && ta.value.trim()) { this.importApps(ta.value); ta.value = ''; } };
    const stageCounts = stageDefs.map((s) => d.apps.filter((a) => a.status === s.full).length);
    const maxStage = Math.max(1, ...stageCounts);
    const pipeline = stageDefs.map((s, i) => ({ name: s.name, color: s.color, count: stageCounts[i], barH: `${Math.round((stageCounts[i] / maxStage) * 100)}%` }));
    const appsTotal = d.apps.length;
    const appsActive = d.apps.filter((a) => ['OA', 'Phone Screen', 'Onsite'].includes(a.status)).length;
    const appsOffers = d.apps.filter((a) => a.status === 'Offer').length;
    const booksAvg = d.books.length ? Math.round(d.books.reduce((s, b) => s + bookPct(b), 0) / d.books.length) : 0;
    const booksAvgLabel = `${booksAvg}%`;
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6);
    const weekAgoIso = this.iso(weekAgo);
    const leetWeek = solvedSolves.filter((s) => s.date >= weekAgoIso).length;
    const leetWeekLabel = `${leetWeek} solved this week`;

    const routines = d.routines.map((r) => ({ ...r, toggle: () => this.toggleRoutine(r.id), remove: () => this.removeRoutine(r.id), check: r.active ? '✓' : '', boxBg: r.active ? 'oklch(0.62 0.13 160)' : 'transparent', boxBorder: r.active ? 'oklch(0.62 0.13 160)' : 'oklch(0.75 0.04 158)', nameColor: r.active ? 'oklch(0.3 0.035 158)' : 'oklch(0.6 0.03 158)' }));

    // ---- goals / weight / quotes / currently ----
    const goals = d.goals.map((g) => ({ ...g, pctLabel: `${g.pct}%`, inc: () => this.setGoal(g.id, 10), dec: () => this.setGoal(g.id, -10), remove: () => this.removeGoal(g.id) }));
    const noGoals = goals.length === 0;
    const weightUnit = d.weightUnit || 'kg';
    const wsorted = [...d.weights].sort((a, b) => (a.date < b.date ? -1 : 1));
    const hasWeight = wsorted.length > 0;
    const weightLatest = hasWeight ? wsorted[wsorted.length - 1].v : '—';
    let weightDelta = '', weightDeltaColor = 'oklch(0.56 0.03 158)';
    if (wsorted.length >= 2) {
      const diff = +(wsorted[wsorted.length - 1].v - wsorted[wsorted.length - 2].v).toFixed(1);
      weightDelta = diff === 0 ? '±0' : (diff > 0 ? `▲ ${diff}` : `▼ ${Math.abs(diff)}`);
      weightDeltaColor = diff > 0 ? 'oklch(0.6 0.12 40)' : diff < 0 ? 'oklch(0.6 0.13 158)' : 'oklch(0.56 0.03 158)';
    }
    let weightLine = '', weightHasLine = false;
    if (wsorted.length >= 2) {
      const vals = wsorted.map((w) => +w.v); const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1; const W = 240, H = 56, pad = 6;
      weightLine = wsorted.map((w, i) => { const x = (i / (wsorted.length - 1)) * W; const yy = H - pad - ((+w.v - mn) / rng) * (H - 2 * pad); return `${x.toFixed(1)},${yy.toFixed(1)}`; }).join(' ');
      weightHasLine = true;
    }
    const onAddWeight = (e) => { if (e.key === 'Enter') { const v = parseFloat(e.target.value); if (!isNaN(v)) { this.addWeight(v); e.target.value = ''; } } };
    const onAddGoal = (e) => { if (e.key === 'Enter' && e.target.value.trim()) { this.addGoal(e.target.value.trim()); e.target.value = ''; } };
    const quotes = d.quotes.map((text) => ({ text }));
    const currently = d.currently;

    const enter = (fn) => (e) => { if (e.key === 'Enter' && e.target.value.trim()) { fn(e.target.value.trim()); e.target.value = ''; } };
    const onAddTaskToday = enter(this.addTaskToday);
    const onAddOneOff = enter(this.addOneOff);
    const onAddRoutine = enter(this.addRoutine);
    const onAddApp = (e) => { if (e.key === 'Enter' && e.target.value.trim()) { const parts = e.target.value.split('—').length > 1 ? e.target.value.split('—') : e.target.value.split('-'); this.addApp(parts[0].trim(), (parts[1] || '').trim()); e.target.value = ''; } };

    return {
      ...base,
      todayTasks, doneLabel, noTasks, todayDailyTasks, todayOneoffTasks, noDailyToday, noOneoffToday, dailyDoneLabel, oneoffDoneLabel, oneOffs, noOneOffs, archive, noArchive, archiveCount,
      gridHeightPx, hourLines, weekDays, dayColumns, calMonthName, calYear, prevWeek, nextWeek, thisWeek, calDays, onAddEvent,
      donutBg, leetTotal, leetLegend, leetTodayLabel, leetSolvedBtns, leetFailedBtns, onLeetKey, onLeetCancel, solvedList, noSolves, failedList, noFailed, failedCount, successLabel,
      sysBooks, ood, oodPctLabel, oodFrac,
      appRows, noApps, pipeline, routines, saveApps, onImportApps,
      appsTotal, appsActive, appsOffers, booksAvgLabel, leetWeekLabel,
      goals, noGoals, onAddGoal,
      weightUnit, weightLatest, weightDelta, weightDeltaColor, weightLine, weightHasLine, hasWeight, onAddWeight,
      quotes, currently,
      onAddTaskToday, onAddOneOff, onAddRoutine, onAddApp,
    };
  }
}

window.Component = Component;
