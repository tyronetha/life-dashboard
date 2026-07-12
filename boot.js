/*
 * Boot: wires up Supabase auth + persistence, shows the magic-link login
 * gate, and mounts the dashboard once the user is signed in.
 */
(function () {
  var SB = window.supabase.createClient(window.CONFIG.supabaseUrl, window.CONFIG.supabaseKey);

  // ---- persistence layer used by dashboard.js (window.DB) ----
  var DB = {
    user: null,
    async load() {
      if (!this.user) return null;
      var res = await SB.from('dashboards').select('data').eq('user_id', this.user.id).maybeSingle();
      if (res.error) { console.error('load error', res.error); return null; }
      return res.data ? res.data.data : null;
    },
    _t: null,
    save(payload) {
      if (!this.user) return;
      clearTimeout(this._t);
      var self = this;
      this._t = setTimeout(async function () {
        var res = await SB.from('dashboards').upsert({
          user_id: self.user.id,
          data: payload,
          updated_at: new Date().toISOString(),
        });
        if (res.error) console.error('save error', res.error);
      }, 600);
    },
  };
  window.DB = DB;

  // ---- DOM handles ----
  var loginEl = document.getElementById('login');
  var appWrap = document.getElementById('app-wrap');
  var appEl = document.getElementById('app');
  var tpl = document.getElementById('app-template');
  var emailInput = document.getElementById('login-email');
  var loginBtn = document.getElementById('login-btn');
  var loginMsg = document.getElementById('login-msg');
  var userPill = document.getElementById('user-pill');
  var userEmail = document.getElementById('user-email');
  var signoutBtn = document.getElementById('signout-btn');

  var mounted = false;
  var instance = null;

  function redirectTo() { return location.origin + location.pathname; }

  function showLogin() {
    DB.user = null;
    mounted = false;
    instance = null;
    appWrap.style.display = 'none';
    userPill.style.display = 'none';
    loginEl.style.display = 'flex';
  }

  function showApp(user) {
    DB.user = user;
    loginEl.style.display = 'none';
    appWrap.style.display = 'block';
    userEmail.textContent = user.email || '';
    userPill.style.display = 'flex';
    if (!mounted) {
      mounted = true;
      instance = new window.Component({ name: 'Tyrone' });
      instance.$mount(tpl.content, appEl);
    }
  }

  // ---- login form ----
  async function sendMagicLink() {
    var email = (emailInput.value || '').trim();
    if (!email) { loginMsg.textContent = 'Enter your email first.'; return; }
    loginBtn.disabled = true;
    loginMsg.textContent = 'Sending…';
    var res = await SB.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: true },
    });
    loginBtn.disabled = false;
    if (res.error) { loginMsg.textContent = res.error.message; return; }
    loginMsg.textContent = 'Check your email for a sign-in link ✦';
  }
  loginBtn.addEventListener('click', sendMagicLink);
  emailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMagicLink(); });
  signoutBtn.addEventListener('click', function () { SB.auth.signOut(); });

  // ---- session lifecycle ----
  SB.auth.getSession().then(function (r) {
    var session = r.data.session;
    if (session) showApp(session.user); else showLogin();
  });
  SB.auth.onAuthStateChange(function (_event, session) {
    if (session) showApp(session.user); else showLogin();
  });
})();
