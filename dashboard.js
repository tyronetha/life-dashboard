/*
 * L I F E Dashboard logic — the original Claude Design component, unchanged
 * except save() and componentDidMount(), which now sync through Supabase
 * (window.DB) in addition to the localStorage cache.
 */
class Component extends DCLogic {
  KEY = 'life-dashboard-v1';

  iso(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
  // The working day is normally the device date — but if the server has already
  // generated daily instances for a later date (nightly job ran ahead of this
  // device's midnight), follow the server so the fresh day shows immediately.
  todayISO() {
    const deviceToday = this.iso(new Date());
    const d = this.state && this.state.data;
    if (d && d.tasks) {
      const latestDaily = d.tasks.filter((t) => t.type === 'Daily' && !t.archived).map((t) => t.doDate).sort().pop();
      if (latestDaily && latestDaily > deviceToday) return latestDaily;
    }
    return deviceToday;
  }
  tomorrowISO() { const d = new Date(this.todayISO() + 'T12:00:00'); d.setDate(d.getDate() + 1); return this.iso(d); }
  newId() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('u' + Date.now() + Math.random().toString(16).slice(2)); }
  db() { return (window.DB && window.DB.user) ? window.DB : null; }

  defaultData() {
    const t = this.todayISO();
    return {
      lastGen: '',
      tasks: [ { id: 'seed-notion', title: 'Design out Notion', type: 'One-off', tag: 'Life', done: false, doDate: t, whatToDo: '', archived: false } ],
      routines: [
        { id: 'r-leet', name: 'Leetcode', active: true, order: 1, whatToDo: '5 questions' },
        { id: 'r-sysd', name: 'System design', active: true, order: 2, whatToDo: '1 chapter' },
        { id: 'r-walk', name: 'Walking', active: true, order: 3, whatToDo: '1 hour @ 3 mph' },
      ],
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
      weightUnit: 'lb',
      counter: 0,
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

  state = { data: null, view: 'home', weekOffset: 0, calDraft: null, leetDiff: 'Easy', leetOutcome: 'solved', flipped: null };

  // One-time normalization: the app is lb-only now. Any state still carrying kg
  // (old localStorage cache or a stale blob) gets its values converted so a stale
  // tab can never write kg back over the database.
  normalizeUnits(data) {
    if (data.weightUnit === 'kg') {
      data.weights = (data.weights || []).map((w) => ({ ...w, v: +((+w.v) * 2.20462).toFixed(1) }));
      data.weightUnit = 'lb';
    }
    return data;
  }

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
        data = this.normalizeUnits(data);
        this.setState({ data }, () => this.save());
        await this.ensureFirstRun(data);          // first run: seed default books + habit into empty tables
        await this.ensureSeedCalendar(data);      // first run: seed the weekday routine as recurring events
        return;
      } catch (e) { console.error('table load failed, using local', e); }
    }
    data = this.runDailyGen(data);                // offline fallback
    data.chapters = data.chapters || []; data.calEvents = data.calEvents || []; data.calExceptions = data.calExceptions || [];
    data = this.normalizeUnits(data);
    this.setState({ data }, () => this.save());
  }

  // First run for a brand-new account (empty tables): seed the default books and
  // the Leetcode habit so it matches the design's starting state.
  async ensureFirstRun(data) {
    const DB = this.db();
    if (!DB || data._seededTables) return;
    if ((data.routines || []).length || (data.books || []).length || (data.tasks || []).length) return;
    const routines = [
      { id: this.newId(), name: 'Leetcode', active: true, order: 1, whatToDo: '5 questions' },
      { id: this.newId(), name: 'System design', active: true, order: 2, whatToDo: '1 chapter' },
      { id: this.newId(), name: 'Walking', active: true, order: 3, whatToDo: '1 hour @ 3 mph' },
    ];
    const books = [
      { id: this.newId(), title: 'System Design Interview — Vol 1', short: 'SDI Vol 1', sortOrder: 1 },
      { id: this.newId(), title: 'System Design Interview — Vol 2', short: 'SDI Vol 2', sortOrder: 2 },
      { id: this.newId(), title: 'Designing Data-Intensive Applications', short: 'DDIA', sortOrder: 3 },
    ];
    for (const r of routines) await DB.insertRoutine(r);
    await DB.insertBooksBulk(books);
    await DB.generateDay();                        // materialize today's daily for the new habit
    const t = await DB.loadTables();
    this.setState((s) => ({ data: { ...s.data, routines: t.routines, tasks: t.tasks, books: t.books, chapters: t.chapters, _seededTables: true } }), () => this.save());
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
  addRoutine = (name, detail) => {
    const row = { id: this.newId(), name, active: true, order: this.state.data.routines.length + 1, whatToDo: detail || '' };
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
  // applications grid: edit a cell locally, then autosave (debounced batch upsert)
  editApp = (id, field, value) => {
    this.mutate((d) => { const a = d.apps.find((x) => x.id === id); if (a) a[field] = value; });
    clearTimeout(this._appsT);
    this._appsT = setTimeout(() => this.saveApps(true), 900);
  };
  // Save button: also ingest any un-submitted quick-add text, then upsert the grid.
  // Shows "Saving… / Saved ✓ / Save failed" on the button itself.
  saveApps = async (auto) => {
    const DB = this.db(); if (!DB) return;
    clearTimeout(this._appsT);
    if (!auto) {
      const c = document.querySelector('[data-app-company]');
      const r = document.querySelector('[data-app-role]');
      if (c && c.value.trim()) {
        const row = { id: this.newId(), company: c.value.trim(), role: r ? r.value.trim() : '', status: 'Wishlist', link: '', location: '', appliedOn: '', notes: '', sortOrder: this.state.data.apps.length };
        this.mutate((d) => { d.apps.push(row); });
        c.value = ''; if (r) r.value = '';
      }
      this.setState({ saveState: 'saving' });
    }
    const res = await DB.upsertApps(this.state.data.apps);
    if (!auto) {
      this.setState({ saveState: (res && res.error) ? 'error' : 'saved' });
      clearTimeout(this._saveMsgT);
      this._saveMsgT = setTimeout(() => this.setState({ saveState: null }), 2200);
    } else if (res && res.error) {
      this.setState({ saveState: 'error' });
    }
  };
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
  // Set how many chapters a book has: auto-creates/removes numbered chapter rows.
  setBookTotal = (bookId, total) => {
    const cur = (this.state.data.chapters || []).filter((c) => c.bookId === bookId);
    const maxN = cur.length;
    const DB = this.db();
    if (total > maxN) {
      const rows = [];
      for (let n = maxN + 1; n <= total; n++) rows.push({ id: this.newId(), bookId, number: n, title: 'Chapter ' + n, status: 'todo', sortOrder: n });
      this.mutate((d) => { d.chapters = (d.chapters || []).concat(rows); });
      if (DB) DB.insertChaptersBulk(rows);
    } else if (total < maxN) {
      this.mutate((d) => { d.chapters = d.chapters.filter((c) => !(c.bookId === bookId && c.number > total)); });
      if (DB) DB.deleteChaptersAbove(bookId, total);
    }
  };
  // Slider drag: chapters 1..k read. Local state live, DB persisted debounced.
  setBookRead = (bookId, k) => {
    this.mutate((d) => { d.chapters.forEach((c) => { if (c.bookId === bookId) c.status = (c.number <= k) ? 'done' : 'todo'; }); });
    this._readT = this._readT || {};
    clearTimeout(this._readT[bookId]);
    this._readT[bookId] = setTimeout(() => { const DB = this.db(); if (DB) DB.setChaptersRead(bookId, k); }, 700);
  };

  // ---------- calendar events ----------
  addEvent = (title, date, startMin, endMin, color) => {
    const row = { id: this.newId(), title, date, startMin, endMin, color: color || 'oklch(0.6 0.1 200)', recurs: null, source: 'user' };
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
  bumpCounter = (delta) => this.mutate((d) => { d.counter = (d.counter || 0) + delta; });
  resetCounter = () => this.mutate((d) => { d.counter = 0; });

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

  // Hand-drawn nav icons from the updated design — SVG strings (the runtime
  // turns a bound "<svg…" string into a real element).
  icons() {
    const wrap = (inner) => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;">${inner}</svg>`;
    return {
      home: wrap('<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>'),
      calendar: wrap('<path d="M12 21v-8"/><path d="M12 13c0-3.2-2.2-5.2-6.2-5.2C5.8 11 8 13 12 13Z"/><path d="M12 12c0-3.2 2.2-5.2 6.2-5.2C18.2 10 16 12 12 12Z"/>'),
      daily: wrap('<path d="M4 20c0-8.5 6-14.5 16.5-16.5C18.5 12 12.5 18 4 20Z"/><path d="M4.5 19.5C8.5 14.5 12.5 11.5 17.5 9.5"/>'),
      leetcode: wrap('<path d="M12 4c.5 4.7 1.3 5.5 6 6-4.7.5-5.5 1.3-6 6-.5-4.7-1.3-5.5-6-6 4.7-.5 5.5-1.3 6-6Z"/>'),
      applications: wrap('<path d="M12 21V8"/><path d="M12 12.5c-2.6 0-4.2-1.6-4.2-4.2 2.6 0 4.2 1.6 4.2 4.2Z"/><path d="M12 12.5c2.6 0 4.2-1.6 4.2-4.2-2.6 0-4.2 1.6-4.2 4.2Z"/><path d="M12 17c-2.6 0-4.2-1.6-4.2-4.2 2.6 0 4.2 1.6 4.2 4.2Z"/><path d="M12 17c2.6 0 4.2-1.6 4.2-4.2-2.6 0-4.2 1.6-4.2 4.2Z"/>'),
      prep: wrap('<path d="M6.5 13.5h11l-1.2 6.5H7.7Z"/><path d="M12 13.5c0-3.4-1.8-5.4-5.4-5.4 0 3.2 2.1 5.4 5.4 5.4Z"/><path d="M12 13.5c0-4 2.1-6.2 5.6-6.2 0 3.6-2.3 6.2-5.6 6.2Z"/>'),
    };
  }

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
    const wd = new Date(this.todayISO() + 'T12:00:00');
    const todayLabel = `${days[wd.getDay()]}, ${months[wd.getMonth()]} ${wd.getDate()}`;
    const view = this.state.view;
    const ic = this.icons();
    const base = {
      name, greeting, todayLabel,
      isHome: view === 'home', isCal: view === 'calendar', isDaily: view === 'daily', isLeet: view === 'leetcode', isApps: view === 'applications', isPrep: view === 'prep',
      navSide: [
        { key: 'home', label: 'Home', v: 'home' },
        { key: 'calendar', label: 'Calendar', v: 'calendar' },
        { key: 'daily', label: 'Daily', v: 'daily' },
        { key: 'leetcode', label: 'LeetCode', v: 'leetcode' },
        { key: 'applications', label: 'Applications', v: 'applications' },
        { key: 'prep', label: 'Prep', v: 'prep' },
      ].map((n) => ({ ...n, icon: ic[n.key], go: () => this.setView(n.v), color: view === n.v ? 'oklch(0.26 0.06 150)' : 'oklch(0.95 0.02 150)', bg: view === n.v ? 'oklch(0.86 0.14 88)' : 'transparent' })),
    };
    if (!d) return { ...base, doneLabel: '—', donePctLabel: '—', homeCounterBg: 'oklch(0.9 0.03 152)', counterValue: 0, counterInc: () => {}, counterDec: () => {}, counterReset: () => {} };

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
    const CAL_COLORS = ['oklch(0.6 0.1 200)', 'oklch(0.58 0.09 150)', 'oklch(0.62 0.13 25)', 'oklch(0.56 0.11 300)', 'oklch(0.6 0.1 55)'];
    // click an empty slot -> open the quick-add popover snapped to 30-min steps
    const makeGridClick = (iso) => (e) => {
      if (e.target.closest && e.target.closest('[data-cal-ev]')) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      let mins = HSTART * 60 + Math.round(((y / ROW) * 60) / 30) * 30;
      mins = Math.max(HSTART * 60, Math.min(HEND * 60 - 30, mins));
      this.setState({ calDraft: { iso, start: mins, end: mins + 60, color: CAL_COLORS[0], x: e.clientX, y: e.clientY } }, () => { const i = document.querySelector('[data-cal-title]'); if (i) i.focus(); });
    };
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
        rmDisplay: 'block',
        remove: (e) => { if (e && e.stopPropagation) e.stopPropagation(); this.removeEventOccurrence(ev.id, ciso, ev.recurs === 'weekly'); },
      }));
      const allday = [];
      (tasksByIso[ciso] || []).forEach((t) => allday.push({ text: t.title, bg: t.type === 'Daily' ? 'oklch(0.9 0.05 165)' : 'oklch(0.9 0.05 205)', color: t.type === 'Daily' ? 'oklch(0.32 0.07 160)' : 'oklch(0.32 0.07 210)', canRemove: false, remove: () => {} }));
      calEvents.filter((ev) => ev.startMin == null && appliesOn(ev, dow, ciso)).forEach((ev) => allday.push({ text: ev.title, bg: 'oklch(0.9 0.05 150)', color: 'oklch(0.32 0.06 150)', canRemove: true, remove: () => this.removeEventOccurrence(ev.id, ciso, ev.recurs === 'weekly') }));
      dayColumns.push({ iso: ciso, events, allday, todayTint: isTod ? 'oklch(0.97 0.02 150)' : 'transparent', onGridClick: makeGridClick(ciso) });
    }
    const midWeek = new Date(weekStart); midWeek.setDate(weekStart.getDate() + 3);
    const calMonthName = months[midWeek.getMonth()];
    const calYear = midWeek.getFullYear();
    const prevWeek = () => this.shiftWeek(-1);
    const nextWeek = () => this.shiftWeek(1);
    const thisWeek = this.thisWeek;
    // ---- calendar quick-add popover (persists via addEvent -> events table) ----
    const draft = this.state.calDraft;
    let calDraftOpen = false, calDraft = null;
    if (draft) {
      calDraftOpen = true;
      const dd = new Date(draft.iso + 'T00:00:00');
      const durMins = Math.max(5, draft.end - draft.start);
      const commit = () => { const i = document.querySelector('[data-cal-title]'); const title = i ? i.value.trim() : ''; if (!title) { this.setState({ calDraft: null }); return; } const end = draft.end > draft.start ? draft.end : draft.start + 30; this.addEvent(title, draft.iso, draft.start, end, draft.color); this.setState({ calDraft: null }); };
      const cancel = () => this.setState({ calDraft: null });
      const setDur = (mins) => this.setState((s) => ({ calDraft: { ...s.calDraft, end: s.calDraft.start + Math.max(0, mins) } }));
      const durText = (m) => { const h = Math.floor(m / 60), mm = m % 60; return (h ? `${h}h` : '') + (mm ? ` ${mm}m` : '') || '0m'; };
      const vw = (typeof window !== 'undefined' ? window.innerWidth : 1200), vh = (typeof window !== 'undefined' ? window.innerHeight : 800);
      calDraft = {
        whenLabel: `${days[dd.getDay()]} · ${this.minLabel(draft.start)} – ${this.minLabel(draft.end)}`,
        left: `${Math.max(12, Math.min(draft.x + 8, vw - 262))}px`,
        top: `${Math.max(12, Math.min(draft.y, vh - 340))}px`,
        durH: Math.floor(durMins / 60), durM: durMins % 60, durLabel: durText(durMins),
        onDurH: (e) => { const h = Math.max(0, Math.min(18, parseInt(e.target.value, 10) || 0)); const mm = (draft.end - draft.start) % 60; setDur(h * 60 + mm); },
        onDurM: (e) => { const mm = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)); const h = Math.floor((draft.end - draft.start) / 60); setDur(h * 60 + mm); },
        durChips: [30, 60, 90, 120].map((m) => ({ label: m < 60 ? `${m}m` : (m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`), bg: (draft.end - draft.start) === m ? 'oklch(0.55 0.13 160)' : 'oklch(0.94 0.02 152)', color: (draft.end - draft.start) === m ? '#fff' : 'oklch(0.42 0.05 158)', set: () => setDur(m) })),
        colorDots: CAL_COLORS.map((c) => ({ color: c, ring: draft.color === c ? `0 0 0 2px oklch(0.99 0.006 150), 0 0 0 4px ${c}` : 'none', set: () => this.setState((s) => ({ calDraft: { ...s.calDraft, color: c } })) })),
        onKey: (e) => { if (e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); commit(); } else if (e.key === 'Escape') { cancel(); } },
        commit, cancel,
      };
    }

    // ---- leetcode ----
    const cE = 'oklch(0.8 0.13 130)', cM = 'oklch(0.75 0.12 90)', cH = 'oklch(0.55 0.11 150)';
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

    // ---- leetcode flip cards (tap to flip; note editor on the back) ----
    const makeCard = (s) => {
      const flipped = this.state.flipped === s.id;
      const isFail = s.outcome === 'failed';
      const dd = new Date(s.date + 'T00:00:00');
      const hasNote = !!(s.note && s.note.trim());
      return {
        id: s.id, name: s.name, difficulty: s.difficulty,
        dateLabel: `${mAbbr[dd.getMonth()]} ${dd.getDate()}`,
        note: s.note || '', notePlaceholder: isFail ? '💡 what to remember next time…' : '💡 best way to solve… (hash map, two pointers, DP)',
        hint: hasNote ? 'tap for approach' : 'tap to add approach',
        badgeColor: diffColor[s.difficulty] || cE,
        frontBg: isFail ? 'oklch(0.975 0.025 40)' : 'oklch(0.975 0.02 150)',
        frontBorder: isFail ? 'oklch(0.9 0.05 40)' : 'oklch(0.9 0.03 152)',
        accent: isFail ? 'oklch(0.58 0.14 35)' : 'oklch(0.52 0.12 155)',
        frontOpacity: flipped ? '0' : '1', frontTransform: flipped ? 'rotateY(85deg)' : 'rotateY(0deg)', frontPE: flipped ? 'none' : 'auto',
        backOpacity: flipped ? '1' : '0', backTransform: flipped ? 'rotateY(0deg)' : 'rotateY(-85deg)', backPE: flipped ? 'auto' : 'none',
        toggle: () => this.setState((st) => ({ flipped: st.flipped === s.id ? null : s.id })),
        onNote: (e) => this.setSolveNote(s.id, e.target.value),
        stop: (e) => { if (e && e.stopPropagation) e.stopPropagation(); },
        remove: (e) => { if (e && e.stopPropagation) e.stopPropagation(); this.removeSolve(s.id); },
      };
    };
    const solvedCards = [...solvedSolves].reverse().map(makeCard);
    const failedCards = [...failedSolves].reverse().map(makeCard);

    // ---- prep: books with chapter-derived progress ----
    const chaptersAll = d.chapters || [];
    const bookPct = (b) => { const chs = chaptersAll.filter((c) => c.bookId === b.id); const done = chs.filter((c) => c.status === 'done').length; return chs.length ? Math.round((done / chs.length) * 100) : 0; };
    const sysBooks = d.books.map((b) => {
      const chs = chaptersAll.filter((c) => c.bookId === b.id);
      const total = chs.length;
      const read = chs.filter((c) => c.status === 'done').length;
      const pct = bookPct(b);
      return {
        ...b, pct, pctLabel: `${pct}%`,
        chapCount: total, doneLabel: `${read}/${total}`,
        readCount: read, readLabel: total ? `${read} / ${total} read` : 'set chapter count →',
        noChapters: total === 0,
        onTotal: (e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n >= 0 && n <= 300) this.setBookTotal(b.id, n); },
        onRead: (e) => { const k = parseInt(e.target.value, 10); if (!isNaN(k)) this.setBookRead(b.id, k); },
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
    const sv = this.state.saveState;
    const saveBtnLabel = sv === 'saving' ? 'Saving…' : sv === 'saved' ? 'Saved ✓' : sv === 'error' ? 'Save failed — retry' : 'Save changes';
    const saveBtnBg = sv === 'error' ? 'oklch(0.6 0.14 30)' : sv === 'saved' ? 'oklch(0.7 0.14 155)' : 'oklch(0.86 0.13 168)';
    const saveBtnColor = sv === 'error' || sv === 'saved' ? '#fff' : 'oklch(0.2 0.05 160)';
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
    const weightUnit = d.weightUnit || 'lb';
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

    // ---- habit quick-add (name + detail + suggestion chips) ----
    const readHabitForm = () => { const n = document.querySelector('[data-habit-name]'); const dt = document.querySelector('[data-habit-detail]'); return { name: n ? n.value.trim() : '', detail: dt ? dt.value.trim() : '', clear: () => { if (n) n.value = ''; if (dt) dt.value = ''; if (n) n.focus(); } }; };
    const addHabitFromForm = () => { const f = readHabitForm(); if (!f.name) return; this.addRoutine(f.name, f.detail); f.clear(); };
    const onHabitKey = (e) => { if (e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); addHabitFromForm(); } };
    const habitSuggestions = [
      { label: 'Workout', detail: '45 min' }, { label: 'Read', detail: '20 pages' }, { label: 'Meditate', detail: '10 min' },
      { label: 'Water', detail: '2 L' }, { label: 'Journal', detail: '1 entry' }, { label: 'Walk', detail: '8k steps' }, { label: 'LeetCode', detail: '2 problems' },
    ].map((h) => ({ label: h.label, add: () => this.addRoutine(h.label, h.detail) }));

    // ---- application quick-add (two fields) ----
    const addAppFromForm = () => { const c = document.querySelector('[data-app-company]'); const r = document.querySelector('[data-app-role]'); const company = c ? c.value.trim() : ''; if (!company) return; this.addApp(company, r ? r.value.trim() : ''); if (c) c.value = ''; if (r) r.value = ''; if (c) c.focus(); };
    const onAppKey = (e) => { if (e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); addAppFromForm(); } };

    // ---- leetcode segmented quick-add ----
    const curDiff = this.state.leetDiff || 'Easy';
    const curOutcome = this.state.leetOutcome || 'solved';
    const leetDiffPicker = ['Easy', 'Medium', 'Hard'].map((dn) => ({ label: dn, bg: curDiff === dn ? diffColor[dn] : 'oklch(0.955 0.02 152)', textColor: curDiff === dn ? '#fff' : 'oklch(0.44 0.05 158)', set: () => this.setState({ leetDiff: dn }) }));
    const leetOutcomePicker = [{ key: 'solved', label: '✓ Solved' }, { key: 'failed', label: '✕ Failed · review' }].map((o) => ({ label: o.label, bg: curOutcome === o.key ? (o.key === 'solved' ? 'oklch(0.55 0.11 155)' : 'oklch(0.58 0.14 35)') : 'oklch(0.955 0.02 152)', textColor: curOutcome === o.key ? '#fff' : 'oklch(0.44 0.05 158)', set: () => this.setState({ leetOutcome: o.key }) }));
    const addLeetFromForm = () => { const f = readLeetForm(); if (!f.name) return; this.addSolve(f.name, curDiff, curOutcome, f.note); f.clear(); const i = document.querySelector('[data-leet-input]'); if (i) i.focus(); };
    const onLeetKey2 = (e) => { if (e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); addLeetFromForm(); } };
    const leetAddBtnBg = curOutcome === 'solved' ? 'oklch(0.55 0.13 160)' : 'oklch(0.58 0.14 35)';
    const leetAddBtnLabel = curOutcome === 'solved' ? 'Add solve' : 'Add to review';

    // ---- home counter ring ----
    const donePctNum = todayTasks.length ? Math.round((doneN / todayTasks.length) * 100) : 0;
    const donePctLabel = `${donePctNum}%`;
    const homeCounterBg = `conic-gradient(oklch(0.62 0.14 150) 0 ${donePctNum}%, oklch(0.9 0.03 152) 0 100%)`;

    // ---- basic header counter (persisted in the blob) ----
    const counterValue = d.counter || 0;
    const counterInc = () => this.bumpCounter(1);
    const counterDec = () => this.bumpCounter(-1);
    const counterReset = () => this.resetCounter();

    return {
      ...base,
      todayTasks, doneLabel, noTasks, todayDailyTasks, todayOneoffTasks, noDailyToday, noOneoffToday, dailyDoneLabel, oneoffDoneLabel, oneOffs, noOneOffs, archive, noArchive, archiveCount,
      gridHeightPx, hourLines, weekDays, dayColumns, calMonthName, calYear, prevWeek, nextWeek, thisWeek, calDraftOpen, calDraft,
      donutBg, leetTotal, leetLegend, leetTodayLabel, leetSolvedBtns, leetFailedBtns, onLeetKey, onLeetCancel, solvedList, noSolves, failedList, noFailed, failedCount, successLabel, solvedCards, failedCards,
      sysBooks, ood, oodPctLabel, oodFrac,
      appRows, noApps, pipeline, routines, saveApps, onImportApps, saveBtnLabel, saveBtnBg, saveBtnColor,
      appsTotal, appsActive, appsOffers, booksAvgLabel, leetWeekLabel,
      goals, noGoals, onAddGoal,
      weightUnit, weightLatest, weightDelta, weightDeltaColor, weightLine, weightHasLine, hasWeight, onAddWeight,
      quotes, currently,
      onAddTaskToday, onAddOneOff, onAddRoutine, onAddApp,
      addHabitFromForm, onHabitKey, habitSuggestions,
      addAppFromForm, onAppKey,
      leetDiffPicker, leetOutcomePicker, addLeetFromForm, onLeetKey2, leetAddBtnBg, leetAddBtnLabel,
      donePctLabel, homeCounterBg,
      counterValue, counterInc, counterDec, counterReset,
    };
  }
}

window.Component = Component;
