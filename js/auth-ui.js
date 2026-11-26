// EitanGD Gacha: app lifecycle, login/signup, 2FA, account settings, real-time account events,
// admin popups, impersonation bar and theme.
window.App = (function () {
  const A = window.API;
  const G = window.Game;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const C = window.APP_CONFIG || {};
  const ADMIN_RETURN = "eitangd-admin-return";

  // ---------------- theme ----------------
  const THEMES = ["auto", "light", "dark"];
  function getTheme() { try { return localStorage.getItem("eitangd-theme") || "auto"; } catch (e) { return "auto"; } }
  function applyTheme(t) {
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    const b = $("#theme");
    if (b) { b.textContent = t === "light" ? "☀️" : t === "dark" ? "🌙" : "🌓"; b.title = "Theme: " + t; }
  }
  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
    try { localStorage.setItem("eitangd-theme", next); } catch (e) { /* ignore */ }
    applyTheme(next);
    toast("Theme: " + next);
  }

  // ---------------- toast & dialogs ----------------
  function toast(msg, kind) {
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.classList.add("out"), 2800);
    setTimeout(() => t.remove(), 3300);
  }

  // Generic dialog: returns {el, close}
  function dialog(html, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "dialog-wrap " + (opts.wrapClass || "");
    wrap.innerHTML = `<div class="dialog ${opts.className || ""}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    const close = () => { wrap.remove(); if (opts.onClose) opts.onClose(); };
    if (opts.dismissable !== false) {
      wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
      wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    }
    $$("[data-close]", wrap).forEach((b) => b.addEventListener("click", close));
    const first = $("input, button:not([data-close])", wrap);
    if (first) setTimeout(() => first.focus(), 30);
    return { el: wrap, close };
  }

  function confirmBox(text, okLabel, danger) {
    return new Promise((resolve) => {
      const d = dialog(`<p>${esc(text)}</p><div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? "danger-solid" : "primary"}" id="cf-ok">${esc(okLabel || "OK")}</button></div>`,
        { className: "small-dialog", onClose: () => resolve(false) });
      $("#cf-ok", d.el).addEventListener("click", () => { d.el.remove(); resolve(true); });
    });
  }

  // ---------------- captcha ----------------
  let captchaToken = null, captchaId = null;
  function mountCaptcha(container) {
    captchaToken = null; captchaId = null;
    if (window.API_MOCK) { captchaToken = "mock"; container.innerHTML = `<p class="muted small">Captcha (test mode)</p>`; return; }
    const tryRender = (n) => {
      if (window.turnstile && C.TURNSTILE_SITE_KEY) {
        captchaId = window.turnstile.render(container, {
          sitekey: C.TURNSTILE_SITE_KEY, theme: document.documentElement.getAttribute("data-theme") || "auto",
          callback: (t) => (captchaToken = t), "expired-callback": () => (captchaToken = null),
          "error-callback": () => (captchaToken = null),
        });
      } else if (n < 40) setTimeout(() => tryRender(n + 1), 150);
      else container.innerHTML = `<p class="err">The captcha could not load. Check your connection or ad blocker.</p>`;
    };
    tryRender(0);
  }
  function resetCaptcha() {
    if (window.API_MOCK) return;
    captchaToken = null;
    try { if (window.turnstile && captchaId !== null) window.turnstile.reset(captchaId); } catch (e) { /* ignore */ }
  }

  // ---------------- password strength ----------------
  function strength(pw, user) {
    let s = 0;
    if (pw.length >= 10) s++;
    if (pw.length >= 14) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    if (user && pw.toLowerCase().includes(user.toLowerCase())) s = 0;
    if (pw.length < 10) s = Math.min(s, 1);
    return Math.min(4, s);
  }
  const STRENGTH = ["Too weak", "Weak", "OK", "Strong", "Very strong"];

  // ---------------- screens ----------------
  function setLoggedOutChrome(on) {
    document.body.classList.toggle("logged-out", on);
  }

  function showSetup() {
    setLoggedOutChrome(true);
    $("#app").innerHTML = `<section class="panel auth-box">
      <h1>Almost there</h1>
      <p>The game needs its server before anyone can play. Follow <b>SETUP.md</b> in the repository, then fill in <code>js/config.js</code>.</p>
      <p class="muted small">This message shows because <code>js/config.js</code> still has placeholder values.</p></section>`;
  }

  let authTab = "login";
  let pendingChallenge = null;

  function showAuth(message) {
    A.unsubscribe();
    stopHeartbeat();
    G.clear();
    setLoggedOutChrome(true);
    hideImpBar();
    if (pendingChallenge) return showTwofa(pendingChallenge);
    $("#app").innerHTML = `
<section class="auth-box panel">
  <div class="auth-logo"><img src="img/icon.svg" alt="" width="54" height="54"><h1>EitanGD <b>Gacha</b></h1></div>
  ${message ? `<div class="notice">${esc(message)}</div>` : ""}
  <div class="seg auth-tabs" role="tablist">
    <button role="tab" data-tab="login" class="${authTab === "login" ? "active" : ""}">Log in</button>
    <button role="tab" data-tab="signup" class="${authTab === "signup" ? "active" : ""}">Create account</button>
  </div>
  <form id="auth-form" autocomplete="on" novalidate>
    <label>Username<input name="username" id="f-user" autocomplete="username" required maxlength="20" spellcheck="false" autocapitalize="off"></label>
    <label>Password
      <span class="pw-wrap"><input name="password" id="f-pw" type="password" autocomplete="${authTab === "login" ? "current-password" : "new-password"}" required maxlength="128">
      <button type="button" class="pw-eye" aria-label="Show password">👁</button></span>
    </label>
    ${authTab === "signup" ? `
      <div class="meter"><i id="pw-bar"></i></div><div class="small muted" id="pw-label">At least 10 characters</div>
      <label>Confirm password<input id="f-pw2" type="password" autocomplete="new-password" required maxlength="128"></label>
      <p class="small muted">Usernames: 3–20 letters, numbers or _. Passwords found in data breaches are refused.</p>` : ""}
    <div id="captcha" class="captcha"></div>
    <div class="err" id="auth-err" role="alert"></div>
    <button class="btn primary big wide" id="auth-go">${authTab === "login" ? "Log in" : "Create account"}</button>
  </form>
  <p class="muted small center">Forgot your password? Ask the admin to reset it.</p>
</section>`;
    mountCaptcha($("#captcha"));
    $$(".auth-tabs button").forEach((b) => b.addEventListener("click", () => { authTab = b.dataset.tab; showAuth(); }));
    $(".pw-eye").addEventListener("click", () => { const i = $("#f-pw"); i.type = i.type === "password" ? "text" : "password"; });
    if (authTab === "signup") {
      $("#f-pw").addEventListener("input", () => {
        const s = strength($("#f-pw").value, $("#f-user").value);
        $("#pw-bar").style.width = (s + 1) * 20 + "%";
        $("#pw-bar").dataset.s = s;
        $("#pw-label").textContent = $("#f-pw").value ? STRENGTH[s] : "At least 10 characters";
      });
    }
    $("#auth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#auth-err"); err.textContent = "";
      const username = $("#f-user").value.trim(), password = $("#f-pw").value;
      if (!username || !password) { err.textContent = "Enter your username and password"; return; }
      if (authTab === "signup") {
        if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) { err.textContent = "Username: 3–20 letters, numbers or _"; return; }
        if (password.length < 10) { err.textContent = "Password must be at least 10 characters"; return; }
        if (password !== $("#f-pw2").value) { err.textContent = "Passwords do not match"; return; }
      }
      if (!captchaToken) { err.textContent = "Please complete the captcha"; return; }
      const btn = $("#auth-go"); btn.disabled = true; btn.textContent = "Please wait…";
      try {
        const r = await A.fn(authTab, { username, password, captcha: captchaToken });
        if (r.twofa) { pendingChallenge = { id: r.challenge }; return showTwofa(pendingChallenge); }
        await A.setSession(r.session);
        await start();
        if (r.needsTwofa) toast("Admin: turn on 2FA in Account to unlock the admin panel", "bad");
      } catch (ex) {
        if (ex.extra && ex.extra.banned) err.textContent = banText(ex.extra.reason, ex.extra.until);
        else err.textContent = ex.message;
        resetCaptcha();
        btn.disabled = false; btn.textContent = authTab === "login" ? "Log in" : "Create account";
      }
    });
  }

  function showTwofa(ch) {
    setLoggedOutChrome(true);
    $("#app").innerHTML = `
<section class="auth-box panel">
  <div class="center" style="font-size:2.4rem">📱</div>
  <h1 class="center">Enter your 2FA code</h1>
  <p class="center">Open your authenticator app and type the 6-digit code for <b>EitanGD Gacha</b>.</p>
  <form id="tf-form" novalidate>
    <input id="tf-code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" placeholder="000000" aria-label="6-digit code">
    <div class="err" id="tf-err" role="alert"></div>
    <button class="btn primary big wide" id="tf-go">Verify</button>
  </form>
  <button class="btn ghost wide" id="tf-back">Back to log in</button>
</section>`;
    $("#tf-code").focus();
    $("#tf-code").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
    $("#tf-back").addEventListener("click", () => { pendingChallenge = null; showAuth(); });
    $("#tf-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = $("#tf-code").value;
      if (code.length !== 6) { $("#tf-err").textContent = "Enter the 6-digit code"; return; }
      $("#tf-go").disabled = true;
      try {
        const r = await A.fn("verify2fa", { challenge: ch.id, code });
        pendingChallenge = null;
        await A.setSession(r.session);
        await start();
      } catch (ex) {
        $("#tf-err").textContent = ex.message;
        $("#tf-go").disabled = false;
        if (/expired/i.test(ex.message)) { pendingChallenge = null; setTimeout(() => showAuth(ex.message), 1500); }
      }
    });
  }

  function banText(reason, until) {
    return "This account is banned" + (reason ? ": " + reason : "") + (until ? " (until " + new Date(until).toLocaleString() + ")" : "") + ".";
  }

  // Full-screen stop screen used when the server ends the session.
  let lostShown = false;
  async function lost(kind, row) {
    if (lostShown) return;
    lostShown = true;
    A.unsubscribe();
    stopHeartbeat();
    $$(".dialog-wrap, .admin-wrap").forEach((d) => d.remove());
    const m = $("#modal"); m.hidden = true; m.innerHTML = "";
    const title = kind === "banned" ? "You have been banned" : kind === "kicked" ? "You were logged out" : kind === "password" ? "Password changed" : "Session ended";
    const text = kind === "banned" ? banText(row && row.ban_reason, row && row.ban_until)
      : kind === "kicked" ? "An admin ended your session."
      : kind === "password" ? "Log in again with your new password."
      : "Your session is no longer valid. Please log in again.";
    try { sessionStorage.removeItem(ADMIN_RETURN); } catch (e) { /* ignore */ }
    await A.signOutLocal();
    G.clear();
    hideImpBar();
    setLoggedOutChrome(true);
    $("#app").innerHTML = `<section class="auth-box panel stop">
      <div class="stop-icon">${kind === "banned" ? "⛔" : "🔒"}</div>
      <h1>${esc(title)}</h1><p>${esc(text)}</p>
      <button class="btn primary big wide" id="relog">Log in</button></section>`;
    $("#relog").addEventListener("click", () => { lostShown = false; showAuth(); });
  }

  // ---------------- popups from the admin ----------------
  const popupQueue = [];
  let popupOpen = false;
  function showPopup(n) {
    popupQueue.push(n);
    if (!popupOpen) nextPopup();
  }
  function nextPopup() {
    const n = popupQueue.shift();
    if (!n) { popupOpen = false; return; }
    popupOpen = true;
    dialog(`<div class="popup-msg"><div class="popup-icon">📣</div>
      ${n.title ? `<h2>${esc(n.title)}</h2>` : ""}<p>${esc(n.body).replace(/\n/g, "<br>")}</p>
      <button class="btn primary wide" data-close>OK</button></div>`, { className: "popup-dialog", onClose: nextPopup });
  }

  // ---------------- impersonation bar ----------------
  function showImpBar() {
    const bar = $("#imp-bar");
    bar.hidden = false;
    bar.innerHTML = `<span>👁 Admin view: you are logged in as <b>${esc(G.me.username)}</b>. Everything you do happens to their account.</span>
      <button class="btn small" id="imp-return">Return to admin</button>`;
    $("#imp-return").addEventListener("click", returnToAdmin);
  }
  function hideImpBar() { const b = $("#imp-bar"); if (b) { b.hidden = true; b.innerHTML = ""; } }

  async function impersonate(userId) {
    const s = await A.session();
    const r = await A.fn("impersonate", { userId });
    try { sessionStorage.setItem(ADMIN_RETURN, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token })); } catch (e) { /* ignore */ }
    $$(".admin-wrap").forEach((d) => d.remove());
    await A.setSession(r.session);
    await start();
    toast("Logged in as " + G.me.username);
  }
  async function returnToAdmin() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(ADMIN_RETURN) || "null"); } catch (e) { /* ignore */ }
    try { await A.fn("logout", {}); } catch (e) { /* ignore */ }
    try { sessionStorage.removeItem(ADMIN_RETURN); } catch (e) { /* ignore */ }
    if (!saved) { await A.signOutLocal(); return showAuth("Logged out of the player's account."); }
    try {
      await A.setSession(saved);
      await start();
      window.AdminPanel && window.AdminPanel.open();
    } catch (e) {
      await A.signOutLocal();
      showAuth("Your admin session expired. Log in again.");
    }
  }

  // ---------------- account settings ----------------
  function openAccount() {
    const me = G.me;
    const d = dialog(`
      <div class="dlg-head"><h2>Account</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="acct">
        <section>
          <h3>Profile</h3>
          <p>Username: <b>${esc(me.username)}</b>${me.role === "admin" ? ` <span class="chip admin">admin</span>` : ""}</p>
        </section>
        <section>
          <h3>Two-factor login (2FA)</h3>
          <div id="tf-area"></div>
        </section>
        <section>
          <h3>Change password</h3>
          <form id="cp-form" class="stack" novalidate>
            <input type="password" id="cp-cur" placeholder="Current password" autocomplete="current-password">
            <input type="password" id="cp-new" placeholder="New password (10+ characters)" autocomplete="new-password">
            <input type="password" id="cp-new2" placeholder="Confirm new password" autocomplete="new-password">
            <div class="err" id="cp-err"></div>
            <button class="btn">Change password</button>
            <p class="small muted">This logs you out on every device.</p>
          </form>
        </section>
        <section><button class="btn danger wide" id="logout">Log out</button></section>
      </div>`, { className: "acct-dialog" });
    const area = $("#tf-area", d.el);

    function renderTf() {
      if (G.me.twofaEnabled) {
        area.innerHTML = `<p>✅ On. Logging in asks for a code from your authenticator app.</p>
          ${G.me.role === "admin" ? `<p class="small muted">Admins must keep 2FA on. If you lose your phone, see "Lost your phone" in SETUP.md.</p>` :
          `<form id="tf-off" class="row"><input type="password" id="tf-off-pw" placeholder="Password to turn off" autocomplete="current-password"><button class="btn small">Turn off</button></form><div class="err" id="tf-off-err"></div>`}`;
        const off = $("#tf-off", area);
        if (off) off.addEventListener("submit", async (e) => {
          e.preventDefault();
          try { await A.fn("twofaDisable", { password: $("#tf-off-pw", area).value }); await G.refresh(); renderTf(); toast("2FA turned off"); }
          catch (ex) { $("#tf-off-err", area).textContent = ex.message; }
        });
        return;
      }
      area.innerHTML = `<p class="small muted">${G.me.role === "admin" ? "Required to use the admin panel." : "Optional. Logging in will also need a code from your phone."}
          You need an authenticator app such as Google Authenticator, Microsoft Authenticator, Authy or 2FAS.</p>
        <button class="btn small primary" id="tf-begin">Set up 2FA</button><div class="err" id="tf-err2"></div>`;
      $("#tf-begin", area).addEventListener("click", async (e) => {
        e.target.disabled = true;
        try {
          const r = await A.fn("twofaStart", {});
          let qr = "";
          try { const q = window.qrcode(0, "M"); q.addData(r.uri); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 3, scalable: true }); } catch (er) { /* show the key only */ }
          area.innerHTML = `
            <ol class="tf-steps">
              <li>In your authenticator app, tap <b>+</b> and <b>scan this QR code</b>:</li>
            </ol>
            <div class="qr">${qr}</div>
            <p class="small muted center">Can't scan? Choose "enter a setup key" and type:<br><code class="secret">${esc(r.secret.replace(/(.{4})/g, "$1 ").trim())}</code></p>
            <ol class="tf-steps" start="2"><li>Type the 6-digit code the app shows:</li></ol>
            <form id="tf-conf" class="row"><input id="tf-c" class="code-input sm" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" aria-label="6-digit code"><button class="btn small primary">Turn on 2FA</button></form>
            <div class="err" id="tf-err3"></div>`;
          $("#tf-c", area).focus();
          $("#tf-c", area).addEventListener("input", (ev) => { ev.target.value = ev.target.value.replace(/\D/g, "").slice(0, 6); });
          $("#tf-conf", area).addEventListener("submit", async (ev) => {
            ev.preventDefault();
            try {
              await A.fn("twofaConfirm", { code: $("#tf-c", area).value.trim() });
              await G.refresh(); renderTf(); toast("2FA is on", "good");
            } catch (ex) { $("#tf-err3", area).textContent = ex.message; }
          });
        } catch (ex) { $("#tf-err2", area).textContent = ex.message; e.target.disabled = false; }
      });
    }
    renderTf();

    $("#cp-form", d.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      const cur = $("#cp-cur", d.el).value, pw = $("#cp-new", d.el).value;
      if (pw !== $("#cp-new2", d.el).value) { $("#cp-err", d.el).textContent = "Passwords do not match"; return; }
      try { await A.fn("changePassword", { current: cur, password: pw }); d.close(); lost("password"); }
      catch (ex) { $("#cp-err", d.el).textContent = ex.message; }
    });
    $("#logout", d.el).addEventListener("click", async () => { d.close(); await logout(); });
  }

  async function logout() {
    if (G.me && G.me.session && G.me.session.impersonatedBy) return returnToAdmin();
    try { await A.fn("logout", {}); } catch (e) { /* ignore */ }
    await A.signOutLocal();
    showAuth("You logged out.");
  }

  // Popups are fetched from the server (and marked seen there), so offline messages show on login too.
  async function fetchNotes() {
    try { (await A.rpc("get_notifications")).forEach(showPopup); } catch (e) { /* ignore */ }
  }

  // ---------------- real time + heartbeat ----------------
  let hb = null, refreshT = null;
  function stopHeartbeat() { if (hb) clearInterval(hb); hb = null; }
  function softRefresh() {
    clearTimeout(refreshT);
    refreshT = setTimeout(() => G.refresh().catch(() => {}), 350);
  }
  function watch() {
    const me = G.me;
    A.subscribe(me.id, {
      profile(row) {
        const cur = G.me;
        if (!cur) return;
        if (row.status === "banned") return lost("banned", row);
        if (row.kick_epoch > cur.kickEpoch) return lost("kicked", row);
        if (row.wipe_epoch > cur.wipeEpoch) toast("An admin reset your account", "bad");
        if (row.status === "blocked" && cur.status !== "blocked") toast("Your account was blocked by an admin", "bad");
        if (row.status === "ok" && cur.status === "blocked") toast("Your account was unblocked", "good");
        softRefresh();
      },
      notification() { fetchNotes(); },
    });
    stopHeartbeat();
    hb = setInterval(() => { if (document.visibilityState === "visible") G.refresh().catch(() => {}); }, 20000);
  }

  // ---------------- start ----------------
  async function start() {
    lostShown = false;
    await G.refresh();
    setLoggedOutChrome(false);
    if (G.me.session && G.me.session.impersonatedBy) showImpBar(); else hideImpBar();
    watch();
    window.UI.route(true);
    if (!(G.me.session && G.me.session.impersonatedBy)) fetchNotes();
  }

  async function boot() {
    applyTheme(getTheme());
    $("#theme").addEventListener("click", cycleTheme);
    if (!A.configured) return showSetup();
    A.onSessionLost((kind) => { if (G.me) lost(kind === "banned" ? "banned" : "signedout"); });
    try { await G.loadCatalog(); } catch (e) {
      $("#app").innerHTML = `<section class="auth-box panel"><h1>Can't reach the server</h1><p>${esc(e.message)}</p><button class="btn primary" id="retry">Retry</button></section>`;
      $("#retry").addEventListener("click", () => location.reload());
      return;
    }
    const s = await A.session();
    if (!s) return showAuth();
    try { await start(); } catch (e) { await A.signOutLocal(); showAuth(); }
  }

  return { boot, toast, dialog, confirmBox, openAccount, logout, impersonate, returnToAdmin, esc, cycleTheme };
})();
