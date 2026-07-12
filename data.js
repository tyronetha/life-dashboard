/*
 * Data-access layer (window.DB): the Supabase client plus table-backed CRUD and
 * RPC calls for the normalized backend (see supabase/migrations + LIFE Backend
 * Design doc). The dashboard reads everything through loadTables() and persists
 * each change through the small methods below. The `dashboards` jsonb blob is
 * still used (via load/saveBlob) for the free-form bits: leetcode solves, ood,
 * goals, weights, quotes, "currently".
 */
(function () {
  var SB = window.supabase.createClient(window.CONFIG.supabaseUrl, window.CONFIG.supabaseKey);
  window.SB = SB;

  // ---- column <-> UI-shape mappers ----
  function routineIn(r)  { return { id: r.id, name: r.name, active: r.active, order: r.sort_order, whatToDo: r.what_to_do || '' }; }
  function taskIn(t)     { return { id: t.id, title: t.title, type: t.kind === 'daily' ? 'Daily' : 'One-off', tag: t.kind === 'daily' ? 'Work' : 'Life', done: t.done, doDate: t.do_date, whatToDo: t.what_to_do || '', archived: t.archived, routineId: t.routine_id }; }
  function appIn(a)      { return { id: a.id, company: a.company, role: a.role || '', status: a.status, link: a.link || '', location: a.location || '', appliedOn: a.applied_on || '', notes: a.notes || '', sortOrder: a.sort_order }; }
  function bookIn(b, pctById) { return { id: b.id, title: b.title, short: b.short || '', sortOrder: b.sort_order, pct: pctById[b.id] || 0 }; }
  function chapterIn(c)  { return { id: c.id, bookId: c.book_id, number: c.number, title: c.title, status: c.status, sortOrder: c.sort_order }; }
  function eventIn(e)    { return { id: e.id, title: e.title, date: e.event_date, startMin: e.start_min, endMin: e.end_min, color: e.color, recurs: e.recurs, weekdays: e.weekdays, recurUntil: e.recur_until, source: e.source }; }

  function taskOut(uid, r) { return { id: r.id, user_id: uid, title: r.title, kind: r.type === 'Daily' ? 'daily' : 'oneoff', routine_id: r.routineId || null, do_date: r.doDate, done: !!r.done, what_to_do: r.whatToDo || null, archived: !!r.archived }; }

  var DB = {
    user: null,

    // ---------- jsonb blob (backup + free-form bits) ----------
    async load() {
      if (!this.user) return null;
      var res = await SB.from('dashboards').select('data').eq('user_id', this.user.id).maybeSingle();
      if (res.error) { console.error('blob load', res.error); return null; }
      return res.data ? res.data.data : null;
    },
    _t: null,
    save(payload) {
      if (!this.user) return;
      clearTimeout(this._t);
      var self = this;
      this._t = setTimeout(async function () {
        var res = await SB.from('dashboards').upsert({ user_id: self.user.id, data: payload, updated_at: new Date().toISOString() });
        if (res.error) console.error('blob save', res.error);
      }, 700);
    },

    // ---------- server-side daily generation (idempotent) ----------
    async generateDay() {
      var res = await SB.rpc('generate_day');
      if (res.error) console.error('generate_day', res.error);
    },

    // ---------- bulk load of all normalized tables ----------
    async loadTables() {
      var r = await Promise.all([
        SB.from('routines').select('*').order('sort_order'),
        SB.from('tasks').select('*'),
        SB.from('applications').select('*').order('sort_order'),
        SB.from('books').select('*').order('sort_order'),
        SB.from('book_progress').select('*'),
        SB.from('book_chapters').select('*').order('number', { nullsFirst: true }).order('sort_order'),
        SB.from('events').select('*'),
        SB.from('event_exceptions').select('*'),
      ]);
      for (var i = 0; i < r.length; i++) if (r[i].error) console.error('loadTables', r[i].error);
      var pctById = {};
      (r[4].data || []).forEach(function (p) { pctById[p.id] = p.pct; });
      return {
        routines:   (r[0].data || []).map(routineIn),
        tasks:      (r[1].data || []).map(taskIn),
        apps:       (r[2].data || []).map(appIn),
        books:      (r[3].data || []).map(function (b) { return bookIn(b, pctById); }),
        chapters:   (r[5].data || []).map(chapterIn),
        calEvents:  (r[6].data || []).map(eventIn),
        calExceptions: (r[7].data || []).map(function (e) { return { eventId: e.event_id, date: e.skip_date }; }),
      };
    },

    // ---------- tasks ----------
    insertTask(row)      { return SB.from('tasks').insert(taskOut(this.user.id, row)).then(logErr('insertTask')); },
    setTaskDone(id, done){ return SB.from('tasks').update({ done: done, done_at: done ? new Date().toISOString() : null }).eq('id', id).then(logErr('setTaskDone')); },
    setTaskDate(id, date){ return SB.from('tasks').update({ do_date: date }).eq('id', id).then(logErr('setTaskDate')); },
    deleteTask(id)       { return SB.from('tasks').delete().eq('id', id).then(logErr('deleteTask')); },

    // ---------- routines ----------
    insertRoutine(r)     { return SB.from('routines').insert({ id: r.id, user_id: this.user.id, name: r.name, what_to_do: r.whatToDo || null, active: r.active !== false, sort_order: r.order || 0 }).then(logErr('insertRoutine')); },
    setRoutineActive(id, active) { return SB.from('routines').update({ active: active }).eq('id', id).then(logErr('setRoutineActive')); },
    deleteRoutine(id)    { return SB.from('routines').delete().eq('id', id).then(logErr('deleteRoutine')); },

    // ---------- applications ----------
    insertApp(a)         { return SB.from('applications').insert({ id: a.id, user_id: this.user.id, company: a.company, role: a.role || null, status: a.status || 'Wishlist', sort_order: a.sortOrder || 0 }).then(logErr('insertApp')); },
    setAppStatus(id, status) { return SB.from('applications').update({ status: status, updated_at: new Date().toISOString() }).eq('id', id).then(logErr('setAppStatus')); },
    deleteApp(id)        { return SB.from('applications').delete().eq('id', id).then(logErr('deleteApp')); },
    upsertApps(rows) {
      var out = rows.map(function (a) {
        return { id: a.id, company: a.company, role: a.role || null, status: a.status || 'Wishlist',
                 link: a.link || null, location: a.location || null,
                 applied_on: a.appliedOn ? a.appliedOn : null, notes: a.notes || null,
                 sort_order: a.sortOrder || 0 };
      }).filter(function (a) { return (a.company || '').trim() !== ''; });
      return SB.rpc('upsert_applications', { rows: out }).then(logErr('upsertApps'));
    },

    // ---------- books / chapters ----------
    insertChapter(c)     { return SB.from('book_chapters').insert({ id: c.id, book_id: c.bookId, user_id: this.user.id, number: c.number, title: c.title, status: c.status || 'todo', sort_order: c.sortOrder || 0 }).then(logErr('insertChapter')); },
    setChapterStatus(id, status) { return SB.from('book_chapters').update({ status: status }).eq('id', id).then(logErr('setChapterStatus')); },
    deleteChapter(id)    { return SB.from('book_chapters').delete().eq('id', id).then(logErr('deleteChapter')); },

    // ---------- events ----------
    insertEvent(e) {
      return SB.from('events').insert({ id: e.id, user_id: this.user.id, title: e.title, event_date: e.date,
        start_min: e.startMin, end_min: e.endMin, color: e.color || null, recurs: e.recurs || null,
        weekdays: e.weekdays || null, recur_until: e.recurUntil || null, source: e.source || 'user' }).then(logErr('insertEvent'));
    },
    insertEventsBulk(list) {
      var uid = this.user.id;
      var rows = list.map(function (e) { return { id: e.id, user_id: uid, title: e.title, event_date: e.date,
        start_min: e.startMin, end_min: e.endMin, color: e.color || null, recurs: e.recurs || null,
        weekdays: e.weekdays || null, recur_until: e.recurUntil || null, source: e.source || 'user' }; });
      return SB.from('events').insert(rows).then(logErr('insertEventsBulk'));
    },
    deleteEvent(id)      { return SB.from('events').delete().eq('id', id).then(logErr('deleteEvent')); },
    addException(ex)     { return SB.from('event_exceptions').insert({ id: ex.id, user_id: this.user.id, event_id: ex.eventId, skip_date: ex.date }).then(logErr('addException')); },
  };

  function logErr(where) { return function (res) { if (res && res.error) console.error(where, res.error); return res; }; }

  window.DB = DB;
})();
