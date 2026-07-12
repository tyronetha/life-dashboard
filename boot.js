/*
 * Boot: Supabase auth (magic link), the login gate, and mounting the dashboard
 * once signed in. Data access lives in data.js (window.DB / window.SB).
 */
(function () {
  var SB = window.SB;
  var DB = window.DB;

  var loginEl = document.getElementById('login');
  var appWrap = document.getElementById('app-wrap');
  var appEl = document.getElementById('app');
  var tpl = document.getElementById('app-template');
  var userInput = document.getElementById('login-username');
  var pwInput = document.getElementById('login-password');
  var loginBtn = document.getElementById('login-btn');
  var loginMsg = document.getElementById('login-msg');
  var userPill = document.getElementById('user-pill');
  var userEmail = document.getElementById('user-email');
  var signoutBtn = document.getElementById('signout-btn');

  var mounted = false;
  var instance = null;

  // Usernames map to an internal email so Supabase's email/password auth can be
  // used without exposing a real inbox (e.g. "admin" -> "admin@titan.local").
  function usernameToEmail(u) { return u.indexOf('@') !== -1 ? u : (u + '@titan.local'); }

  function showLogin() {
    DB.user = null; mounted = false; instance = null;
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

  async function signIn() {
    var u = (userInput.value || '').trim();
    var p = pwInput.value || '';
    if (!u || !p) { loginMsg.textContent = 'Enter your username and password.'; return; }
    loginBtn.disabled = true;
    loginMsg.textContent = 'Signing in…';
    var res = await SB.auth.signInWithPassword({ email: usernameToEmail(u), password: p });
    loginBtn.disabled = false;
    if (res.error) { loginMsg.textContent = 'Wrong username or password.'; return; }
    loginMsg.textContent = '';
  }
  loginBtn.addEventListener('click', signIn);
  userInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') pwInput.focus(); });
  pwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') signIn(); });
  signoutBtn.addEventListener('click', function () { SB.auth.signOut(); });

  SB.auth.getSession().then(function (r) {
    var session = r.data.session;
    if (session) showApp(session.user); else showLogin();
  });
  SB.auth.onAuthStateChange(function (_event, session) {
    if (session) showApp(session.user); else showLogin();
  });
})();
