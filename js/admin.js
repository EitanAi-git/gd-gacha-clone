// EitanGD Gacha: admin panel (popup). Every action runs on the server and requires an admin
// session with 2FA (authenticator app). Inputs are bound to an in-memory draft store, so values survive
// saves, refreshes and switching categories.
window.AdminPanel = (function () {
  const A = window.API;
  const G = window.Game;
  const D = window.GD_DATA;
  const P = window.Picker;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const toast = (m, k) => window.App.toast(m, k);
  const MAX = "9223372036854775807";

  const drafts = {};        // key -> value, kept for the whole visit
  const views = {};         // section id -> container element (built once per open)
  let wrap = null;
  let current = "players";
  let players = [];
  let selected = null;      // player id
  let detail = null;

  const SECTIONS = [
    { id: "players",  icon: "👥", label: "Players" },
    { id: "cards",    icon: "🃏", label: "Cards" },
    { id: "packs",    icon: "📦", label: "Packs" },
    { id: "economy",  icon: "💰", label: "Economy & values" },
    { id: "popups",   icon: "📣", label: "Popups" },
    { id: "security", icon: "🛡️", label: "Security" },
    { id: "logs",     icon: "📜", label: "Logs" },
  ];

  // ---------- helpers ----------
  function draft(key, def) { return Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : def; }
  function bind(root) {
    $$("[data-d]", root).forEach((el) => {
      const key = el.dataset.d;
      if (el.type === "checkbox") {
        el.checked = !!draft(key, el.checked);
        el.addEventListener("change", () => (drafts[key] = el.checked));
      } else {
        el.value = draft(key, el.value);
        el.addEventListener("input", () => (drafts[key] = el.value));
      }
    });
  }
  function picker(mount, key, items, def, onChange) {
    const p = P.create({ items, value: draft(key, def), onChange: (v) => { drafts[key] = v; if (onChange) onChange(v); } });
    mount.replaceWith(p.el);
    return p;
  }
  async function call(name, args, okMsg, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await A.rpc(name, args);
      if (okMsg) toast(okMsg, "good");
      return r;
    } catch (e) {
      toast(e.message, "bad");
      throw e;
    } finally { if (btn) btn.disabled = false; }
  }
  const ago = (t) => {
    if (!t) return "never";
    const s = Math.round((Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  };
  const when = (t) => (t ? new Date(t).toLocaleString() : "—");
  const cardItems = () => G.catalog.cards.map((c) => ({
    value: c.id, label: c.name, color: D.RARITY_INFO[c.rarity].color,
    sub: `by ${c.creator} · ${D.SETS[c.set].code} ${String(G.cardNumber(c)).padStart(3, "0")} · ${D.RARITY_INFO[c.rarity].label}${c.enabled === false ? " · disabled" : ""}`,
  }));
  const rarityItems = () => D.RARITIES.map((r) => ({ value: r, label: D.RARITY_INFO[r].label, color: D.RARITY_INFO[r].color }));
  const setItems = () => D.SET_ORDER.map((s) => ({ value: s, label: D.SETS[s].label, color: D.SETS[s].color }));
  const cardName = (id) => (G.card(id) ? G.card(id).name : id);
  const isWhole = (v) => /^\d{1,19}$/.test(String(v).trim());

  // ---------- shell ----------
  const narrow = () => window.innerWidth < 700;   // on phones the sidebar overlays the content, so it starts closed
  function sidebarOpen() {
    if (narrow()) return false;
    try { return localStorage.getItem("eitangd-admin-sidebar") !== "closed"; } catch (e) { return true; }
  }
  function setSidebar(open) {
    if (!narrow()) { try { localStorage.setItem("eitangd-admin-sidebar", open ? "open" : "closed"); } catch (e) { /* ignore */ } }
    $(".admin-panel", wrap).classList.toggle("collapsed", !open);
    $("#ap-toggle", wrap).setAttribute("aria-expanded", String(open));
  }

  function open(section) {
    if (!G.me || G.me.role !== "admin") return;
    if (wrap) wrap.remove();
    Object.keys(views).forEach((k) => delete views[k]);
    wrap = document.createElement("div");
    wrap.className = "admin-wrap";
    wrap.innerHTML = `
<div class="admin-panel ${sidebarOpen() ? "" : "collapsed"}" role="dialog" aria-modal="true" aria-label="Admin panel">
  <header class="ap-head">
    <button class="icon-btn" id="ap-toggle" aria-label="Show or hide categories" aria-expanded="${sidebarOpen()}" title="Show/hide categories">☰</button>
    <h2>Admin <span class="muted" id="ap-title"></span></h2>
    <button class="icon-btn" id="ap-close" aria-label="Close admin panel">✕</button>
  </header>
  <nav class="ap-side">${SECTIONS.map((s) => `<button data-sec="${s.id}"><span class="ap-ico">${s.icon}</span><span class="ap-lbl">${s.label}</span></button>`).join("")}</nav>
  <main class="ap-main"></main>
</div>`;
    document.body.appendChild(wrap);
    $("#ap-close", wrap).addEventListener("click", close);
    $("#ap-toggle", wrap).addEventListener("click", () => setSidebar($(".admin-panel", wrap).classList.contains("collapsed")));
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$(".picker.open", wrap) && !$(".dialog-wrap")) close(); });
    $$(".ap-side button", wrap).forEach((b) => b.addEventListener("click", () => {
      show(b.dataset.sec);
      if (narrow()) setSidebar(false);
    }));
    if (!G.me.adminReady) {
      $(".ap-main", wrap).innerHTML = `<div class="ap-gate"><h3>Admin tools are locked</h3>
        <p>Admins must use 2FA (an authenticator app). Turn it on in <b>Account</b>. Then the admin panel unlocks.</p>
        <button class="btn primary" id="ap-acct">Open Account</button></div>`;
      $("#ap-acct", wrap).addEventListener("click", () => { close(); window.App.openAccount(); });
      return;
    }
    show(section || current);
  }
  function close() { if (wrap) wrap.remove(); wrap = null; }

  function show(id) {
    current = id;
    $$(".ap-side button", wrap).forEach((b) => b.classList.toggle("active", b.dataset.sec === id));
    $("#ap-title", wrap).textContent = "· " + SECTIONS.find((s) => s.id === id).label;
    const main = $(".ap-main", wrap);
    Object.values(views).forEach((v) => (v.hidden = true));
    if (!views[id]) {
      const v = document.createElement("div");
      v.className = "ap-view";
      main.appendChild(v);
      views[id] = v;
      BUILD[id](v);
    } else views[id].hidden = false;
    main.scrollTop = 0;
  }

  // =====================================================================
  // PLAYERS
  // =====================================================================
  function buildPlayers(v) {
    v.innerHTML = `
<div class="ap-players">
  <div class="ap-plist">
    <div class="row"><input type="search" id="pl-q" placeholder="Search players" data-d="pl-q" autocomplete="off"><button class="btn small" id="pl-ref" title="Refresh">↻</button></div>
    <div class="pl-items" id="pl-items"><p class="muted small">Loading…</p></div>
  </div>
  <div class="ap-pdetail" id="pd"><div class="empty">Choose a player on the left.</div></div>
</div>`;
    bind(v);
    let t = null;
    $("#pl-q", v).addEventListener("input", () => { clearTimeout(t); t = setTimeout(loadPlayers, 250); });
    $("#pl-ref", v).addEventListener("click", loadPlayers);
    loadPlayers();
    if (selected) selectPlayer(selected);
  }

  async function loadPlayers() {
    const v = views.players; if (!v) return;
    try { players = await A.rpc("admin_list_players", { p_q: draft("pl-q", "") }); }
    catch (e) { $("#pl-items", v).innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    $("#pl-items", v).innerHTML = players.length ? players.map((p) => `
      <button class="pl-item ${p.id === selected ? "active" : ""}" data-id="${p.id}">
        <span class="pl-name"><i class="dot ${p.online ? "on" : ""}"></i>${esc(p.username)}${p.role === "admin" ? ` <span class="chip admin">admin</span>` : ""}${p.status !== "ok" ? ` <span class="chip ${p.status}">${p.status}</span>` : ""}</span>
        <span class="pl-sub">${G.fmt(p.orbs)} orbs · ${G.fmt(p.cards)} cards · ${ago(p.lastSeen)}</span>
      </button>`).join("") : `<p class="muted small">No players found.</p>`;
    $$(".pl-item", v).forEach((b) => b.addEventListener("click", () => selectPlayer(b.dataset.id)));
  }

  async function selectPlayer(id) {
    const v = views.players;
    const changed = selected !== id;
    selected = id;
    $$(".pl-item", v).forEach((b) => b.classList.toggle("active", b.dataset.id === id));
    if (changed || !$("#pd-actions", v)) buildDetailShell();
    await loadDetail();
  }

  function buildDetailShell() {
    const pd = $("#pd", views.players);
    pd.innerHTML = `
<div id="pd-info"><p class="muted small">Loading…</p></div>
<div id="pd-actions" class="pd-actions">
  <section class="pa">
    <h4>Orbs</h4>
    <div class="row"><input id="o-amt" data-d="o-amt" value="1000" inputmode="numeric" placeholder="Amount">
      <button class="btn small" data-orbs="set">Set</button><button class="btn small" data-orbs="add">Add</button><button class="btn small" data-orbs="sub">Remove</button></div>
    <div class="row"><button class="btn small ghost" data-quick="1000">+1K</button><button class="btn small ghost" data-quick="1000000">+1M</button><button class="btn small ghost" data-quick="1000000000000">+1T</button><button class="btn small ghost" data-maxorbs>Max</button></div>
  </section>
  <section class="pa">
    <h4>Give a card</h4>
    <div class="field"><span>Card</span><div id="g-card"></div></div>
    <div class="row">
      <label class="check"><input type="checkbox" data-d="g-foil"> Foil</label>
      <label class="check"><input type="checkbox" data-d="g-full"> Full art</label>
    </div>
    <div class="row"><input id="g-qty" data-d="g-qty" value="1" inputmode="numeric" placeholder="How many (no limit)" aria-label="Quantity">
      <button class="btn small ghost" id="g-max" title="Biggest number allowed">∞ Max</button>
      <button class="btn small primary" id="g-go">Give</button></div>
    <button class="btn small" id="g-all">Give one of every card</button>
  </section>
  <section class="pa">
    <h4>Moderation</h4>
    <div class="row wrap">
      <button class="btn small" data-act="kick" title="Log them out everywhere now">Kick</button>
      <button class="btn small" data-act="block" title="Can log in, cannot play">Block</button>
      <button class="btn small" data-act="unblock">Unblock</button>
      <button class="btn small" data-act="unban">Unban</button>
    </div>
    <div class="row"><input id="m-reason" data-d="m-reason" placeholder="Reason (shown to them)" maxlength="200"></div>
    <div class="row"><div id="m-dur"></div><button class="btn small danger-solid" data-act="ban">Ban</button></div>
    <div class="row wrap">
      <button class="btn small danger" data-act="wipe" title="Delete all cards and orbs">Wipe</button>
      <button class="btn small danger" data-act="reset" title="Reset daily, streak, stats, favorites">Reset progress</button>
      <button class="btn small" data-act="reset_2fa">Reset 2FA</button>
      <button class="btn small" data-act="promote">Make admin</button>
      <button class="btn small" data-act="demote">Remove admin</button>
    </div>
  </section>
  <section class="pa">
    <h4>Password & access</h4>
    <div class="row"><input id="pw-new" data-d="pw-new" type="text" placeholder="New password (8+)" autocomplete="off" maxlength="128"><button class="btn small" id="pw-go">Set password</button></div>
    <button class="btn small primary" id="imp-go">👁 Log in as this player</button>
  </section>
  <section class="pa">
    <h4>Send popup</h4>
    <input id="pp-title" data-d="pp-title" placeholder="Title (optional)" maxlength="120">
    <textarea id="pp-body" data-d="pp-body" rows="2" placeholder="Message" maxlength="2000"></textarea>
    <div class="row wrap">${presetChips()}</div>
    <button class="btn small primary" id="pp-go">Send popup</button>
  </section>
</div>
<div class="pd-tabs">
  <div class="seg" id="pd-tabsel">${["collection", "pulls", "sessions", "logins"].map((t) => `<button data-tab="${t}" class="${draft("pd-tab", "collection") === t ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
  <div id="pd-tab"></div>
</div>`;
    const pd2 = pd;
    bind(pd2);
    picker($("#g-card", pd2), "g-card", cardItems(), G.catalog.cards[0] && G.catalog.cards[0].id);
    picker($("#m-dur", pd2), "m-dur", [
      { value: "0", label: "Forever" }, { value: "10", label: "10 minutes" }, { value: "60", label: "1 hour" },
      { value: "1440", label: "1 day" }, { value: "10080", label: "7 days" }, { value: "43200", label: "30 days" },
    ], "0");
    wirePresets(pd2, "pp-title", "pp-body");

    $$("[data-orbs]", pd2).forEach((b) => b.addEventListener("click", async () => {
      const amt = String(draft("o-amt", "")).trim();
      if (!isWhole(amt)) return toast("Amount must be a whole number", "bad");
      const mode = b.dataset.orbs;
      await call("admin_set_orbs", { p_id: selected, p_amount: mode === "sub" ? "-" + amt : amt, p_mode: mode === "set" ? "set" : "add" },
        mode === "set" ? "Orbs set" : mode === "add" ? "Orbs added" : "Orbs removed", b).catch(() => {});
      loadDetail(); loadPlayers();
    }));
    $$("[data-quick]", pd2).forEach((b) => b.addEventListener("click", async () => {
      await call("admin_set_orbs", { p_id: selected, p_amount: b.dataset.quick, p_mode: "add" }, "Orbs added", b).catch(() => {});
      loadDetail(); loadPlayers();
    }));
    $("[data-maxorbs]", pd2).addEventListener("click", async (e) => {
      await call("admin_set_orbs", { p_id: selected, p_amount: MAX, p_mode: "set" }, "Orbs set to max", e.target).catch(() => {});
      loadDetail(); loadPlayers();
    });
    $("#g-max", pd2).addEventListener("click", () => { drafts["g-qty"] = MAX; $("#g-qty", pd2).value = MAX; });
    $("#g-go", pd2).addEventListener("click", async (e) => {
      const qty = String(draft("g-qty", "1")).trim();
      if (!isWhole(qty) || qty === "0" || BigInt(qty) > BigInt(MAX)) return toast("Quantity must be a whole number from 1 up to " + G.fmt(MAX), "bad");
      const card = draft("g-card", G.catalog.cards[0].id);
      await call("admin_grant", { p_id: selected, p_card: card, p_foil: !!draft("g-foil", false), p_full: !!draft("g-full", false), p_qty: qty },
        `Gave ${G.fmt(qty)} × ${cardName(card)}`, e.target).catch(() => {});
      loadDetail(); loadPlayers();
    });
    $("#g-all", pd2).addEventListener("click", async (e) => {
      const qty = String(draft("g-qty", "1")).trim();
      if (!isWhole(qty) || qty === "0") return toast("Quantity must be a whole number", "bad");
      await call("admin_grant_all", { p_id: selected, p_qty: qty }, `Gave ${G.fmt(qty)} of every card`, e.target).catch(() => {});
      loadDetail(); loadPlayers();
    });
    $$("[data-act]", pd2).forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.act;
      const name = detail ? detail.profile.username : "this player";
      const risky = { wipe: `Wipe ${name}? All their cards and orbs are deleted.`, reset: `Reset ${name}'s progress?`,
        ban: `Ban ${name}? They are logged out right away.`, promote: `Make ${name} an admin?`, demote: `Remove admin from ${name}?` };
      if (risky[act] && !(await window.App.confirmBox(risky[act], act === "wipe" ? "Wipe" : "Confirm", act === "wipe" || act === "ban"))) return;
      const minutes = act === "ban" ? parseInt(draft("m-dur", "0"), 10) || null : null;
      await call("admin_action", { p_id: selected, p_action: act, p_reason: draft("m-reason", "") || null, p_minutes: minutes },
        { kick: "Kicked", ban: "Banned", unban: "Unbanned", block: "Blocked", unblock: "Unblocked", wipe: "Wiped", reset: "Progress reset",
          reset_2fa: "2FA reset", promote: "Now an admin", demote: "No longer admin" }[act], b).catch(() => {});
      loadDetail(); loadPlayers();
    }));
    $("#pw-go", pd2).addEventListener("click", async (e) => {
      const pw = String(draft("pw-new", ""));
      if (pw.length < 8) return toast("Password must be at least 8 characters", "bad");
      e.target.disabled = true;
      try { await A.fn("adminSetPassword", { userId: selected, password: pw }); toast("Password set. They were logged out.", "good"); drafts["pw-new"] = ""; $("#pw-new", pd2).value = ""; }
      catch (ex) { toast(ex.message, "bad"); }
      e.target.disabled = false;
      loadDetail();
    });
    $("#imp-go", pd2).addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await window.App.impersonate(selected); } catch (ex) { toast(ex.message, "bad"); e.target.disabled = false; }
    });
    $("#pp-go", pd2).addEventListener("click", async (e) => {
      const body = String(draft("pp-body", "")).trim();
      if (!body) return toast("Write a message first", "bad");
      await call("admin_popup", { p_id: selected, p_title: draft("pp-title", "") || null, p_body: body }, "Popup sent", e.target).catch(() => {});
    });
    $$("#pd-tabsel button", pd2).forEach((b) => b.addEventListener("click", () => {
      drafts["pd-tab"] = b.dataset.tab;
      $$("#pd-tabsel button", pd2).forEach((x) => x.classList.toggle("active", x === b));
      renderTab();
    }));
  }

  async function loadDetail() {
    const v = views.players; if (!v || !selected) return;
    const id = selected;
    try { detail = await A.rpc("admin_player_detail", { p_id: id }); }
    catch (e) { $("#pd-info", v).innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    if (id !== selected) return;
    const p = detail.profile;
    const online = detail.sessions.length > 0;
    $("#pd-info", v).innerHTML = `
<div class="pd-head">
  <h3>${esc(p.username)} ${p.role === "admin" ? `<span class="chip admin">admin</span>` : ""} <span class="chip ${p.status}">${p.status}</span> <span class="chip ${online ? "on" : ""}">${online ? "online" : "offline"}</span></h3>
  ${p.ban_reason ? `<p class="small">Reason: ${esc(p.ban_reason)}${p.ban_until ? ` · until ${when(p.ban_until)}` : ""}</p>` : ""}
</div>
<dl class="pd-grid">
  <div><dt>Orbs</dt><dd>${G.fmt(p.orbs)}</dd></div>
  <div><dt>Passive waiting</dt><dd>${G.fmt(p.pending)}</dd></div>
  <div><dt>Collection value</dt><dd>${G.fmt(detail.value)}</dd></div>
  <div><dt>Packs opened</dt><dd>${G.fmt(p.packs_opened)}</dd></div>
  <div><dt>Daily streak</dt><dd>${p.daily_streak}${p.daily && p.daily.claimed ? " (claimed today)" : ""}</dd></div>
  <div><dt>2FA</dt><dd>${p.twofa_enabled ? "on (app)" : "off"}</dd></div>
  <div><dt>Joined</dt><dd>${when(p.created_at)}</dd></div>
  <div><dt>Last seen</dt><dd>${when(p.last_seen)}</dd></div>
  <div><dt>Favorites</dt><dd>${p.favorites.length ? p.favorites.map((f) => esc(cardName(f))).join(", ") : "—"}</dd></div>
  <div class="wide"><dt>User ID</dt><dd class="mono">${esc(p.id)}</dd></div>
</dl>`;
    renderTab();
  }

  function renderTab() {
    const v = views.players; if (!v || !detail) return;
    const tab = draft("pd-tab", "collection");
    const el = $("#pd-tab", v);
    if (tab === "collection") {
      el.innerHTML = detail.collection.length ? `<table class="ap-table"><thead><tr><th>Card</th><th>Version</th><th>Qty</th><th>Last got</th><th></th></tr></thead><tbody>${
        detail.collection.map((r, i) => `<tr><td>${esc(cardName(r.card))}</td><td>${r.fullArt ? "Full art " : ""}${r.foil ? "Foil" : ""}${!r.foil && !r.fullArt ? "Normal" : ""}</td>
          <td class="mono">${G.fmt(r.qty)}</td><td>${ago(r.lastAt)}</td><td><button class="btn tiny danger" data-take="${i}">Remove</button></td></tr>`).join("")}</tbody></table>`
        : `<p class="muted small">No cards.</p>`;
      $$("[data-take]", el).forEach((b) => b.addEventListener("click", async () => {
        const r = detail.collection[+b.dataset.take];
        await call("admin_take", { p_id: selected, p_card: r.card, p_foil: r.foil, p_full: r.fullArt }, "Removed", b).catch(() => {});
        loadDetail();
      }));
    } else if (tab === "pulls") {
      el.innerHTML = detail.pulls.length ? `<table class="ap-table"><thead><tr><th>When</th><th>Card</th><th>Version</th><th>From</th></tr></thead><tbody>${
        detail.pulls.map((r) => `<tr><td>${when(r.at)}</td><td>${esc(cardName(r.card))}</td><td>${r.fullArt ? "Full art " : ""}${r.foil ? "Foil" : ""}</td><td>${esc(r.pack || "")}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted small">No pulls yet.</p>`;
    } else if (tab === "sessions") {
      el.innerHTML = detail.sessions.length ? `<table class="ap-table"><thead><tr><th>Started</th><th>IP</th><th>Device</th><th>2FA</th><th>By admin</th></tr></thead><tbody>${
        detail.sessions.map((s) => `<tr><td>${when(s.at)}</td><td class="mono">${esc(s.ip || "")}</td><td class="ua">${esc(s.ua || "")}</td><td>${s.twofa ? "yes" : "no"}</td><td>${s.impersonatedBy ? "yes" : ""}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted small">Not logged in anywhere.</p>`;
    } else {
      el.innerHTML = detail.logins.length ? `<table class="ap-table"><thead><tr><th>When</th><th>Result</th><th>IP</th><th>Device</th></tr></thead><tbody>${
        detail.logins.map((l) => `<tr><td>${when(l.at)}</td><td>${l.ok ? "✅ " : "❌ "}${esc(l.reason || "")}</td><td class="mono">${esc(l.ip || "")}</td><td class="ua">${esc(l.ua || "")}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted small">No logins recorded.</p>`;
    }
  }

  const PRESETS = ["i am here just to annoy you", "Hello! 👋", "Please follow the rules.", "Server maintenance soon.", "Congrats, you won a prize! 🎉"];
  function presetChips() { return PRESETS.map((t, i) => `<button class="chip-btn" data-preset="${i}">${esc(t)}</button>`).join(""); }
  function wirePresets(root, titleKey, bodyKey) {
    $$("[data-preset]", root).forEach((b) => b.addEventListener("click", () => {
      drafts[bodyKey] = PRESETS[+b.dataset.preset];
      const ta = $(`[data-d="${bodyKey}"]`, root); if (ta) ta.value = drafts[bodyKey];
    }));
  }

  // =====================================================================
  // CARDS
  // =====================================================================
  let adminCards = [];
  function buildCards(v) {
    v.innerHTML = `
<section class="pa">
  <h4>Add a card</h4>
  <div class="form-grid">
    <label>Level name<input data-d="nc-name" maxlength="80"></label>
    <label>Creator<input data-d="nc-creator" maxlength="60"></label>
    <div class="field"><span>Set</span><div id="nc-set"></div></div>
    <div class="field"><span>Rarity</span><div id="nc-rarity"></div></div>
    <label>Worth (orbs, empty = rarity default)<input data-d="nc-worth" inputmode="numeric"></label>
  </div>
  <button class="btn small primary" id="nc-go">Add card</button>
</section>
<section class="pa">
  <div class="row between"><h4>All cards</h4><span class="muted small" id="ac-count"></span></div>
  <div class="row wrap"><input type="search" data-d="ac-q" id="ac-q" placeholder="Search cards" autocomplete="off"><div id="ac-set"></div><div id="ac-rar"></div></div>
  <div id="ac-list" class="ac-list"><p class="muted small">Loading…</p></div>
</section>`;
    bind(v);
    picker($("#nc-set", v), "nc-set", setItems(), "Extreme");
    picker($("#nc-rarity", v), "nc-rarity", rarityItems(), "common");
    picker($("#ac-set", v), "ac-set", [{ value: "", label: "All sets" }].concat(setItems()), "", renderCardList);
    picker($("#ac-rar", v), "ac-rar", [{ value: "", label: "All rarities" }].concat(rarityItems()), "", renderCardList);
    $("#ac-q", v).addEventListener("input", renderCardList);
    $("#nc-go", v).addEventListener("click", async (e) => {
      const worth = String(draft("nc-worth", "")).trim();
      if (worth && !isWhole(worth)) return toast("Worth must be a whole number", "bad");
      await call("admin_save_card", { p_card: { name: draft("nc-name", ""), creator: draft("nc-creator", ""), set: draft("nc-set", "Extreme"),
        rarity: draft("nc-rarity", "common"), sellOverride: worth, enabled: true } }, "Card added", e.target).catch(() => null);
      await reloadCatalog();
      loadCards();
    });
    loadCards();
  }

  async function reloadCatalog() { try { await G.loadCatalog(); } catch (e) { /* ignore */ } }

  async function loadCards() {
    try { adminCards = await A.rpc("admin_list_cards"); } catch (e) { $("#ac-list", views.cards).innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    renderCardList();
  }

  function renderCardList() {
    const v = views.cards; if (!v) return;
    const q = String(draft("ac-q", "")).toLowerCase().trim();
    const fs = draft("ac-set", ""), fr = draft("ac-rar", "");
    const list = adminCards.filter((c) => (!fs || c.set === fs) && (!fr || c.rarity === fr) &&
      (!q || (c.name + " " + c.creator).toLowerCase().includes(q)));
    $("#ac-count", v).textContent = `${list.length} of ${adminCards.length}`;
    const el = $("#ac-list", v);
    el.innerHTML = list.map((c) => `
      <div class="ac-row ${c.enabled ? "" : "off"}" data-id="${esc(c.id)}">
        <input data-d="c:${esc(c.id)}:name" value="${esc(c.name)}" aria-label="Name" maxlength="80">
        <input data-d="c:${esc(c.id)}:creator" value="${esc(c.creator)}" aria-label="Creator" maxlength="60">
        <div class="pk-set"></div><div class="pk-rar"></div>
        <input data-d="c:${esc(c.id)}:worth" value="${esc(c.sellOverride || "")}" placeholder="${esc(c.value)} (default)" inputmode="numeric" aria-label="Worth in orbs" title="Worth in orbs">
        <label class="check" title="Can be pulled / shown"><input type="checkbox" data-d="c:${esc(c.id)}:enabled" ${c.enabled ? "checked" : ""}> On</label>
        <button class="btn tiny primary" data-save>Save</button>
        ${c.custom ? `<button class="btn tiny danger" data-del>Delete</button>` : ""}
      </div>`).join("") || `<p class="muted small">No cards match.</p>`;
    bind(el);
    $$(".ac-row", el).forEach((row) => {
      const id = row.dataset.id;
      const c = adminCards.find((x) => x.id === id);
      picker($(".pk-set", row), `c:${id}:set`, setItems(), c.set);
      picker($(".pk-rar", row), `c:${id}:rarity`, rarityItems(), c.rarity);
      $("[data-save]", row).addEventListener("click", async (e) => {
        const worth = String(draft(`c:${id}:worth`, c.sellOverride || "")).trim();
        if (worth && !isWhole(worth)) return toast("Worth must be a whole number", "bad");
        await call("admin_save_card", { p_card: { id, name: draft(`c:${id}:name`, c.name), creator: draft(`c:${id}:creator`, c.creator),
          set: draft(`c:${id}:set`, c.set), rarity: draft(`c:${id}:rarity`, c.rarity), sellOverride: worth,
          enabled: !!draft(`c:${id}:enabled`, c.enabled) } }, "Saved " + draft(`c:${id}:name`, c.name), e.target).catch(() => {});
        await reloadCatalog();
        const fresh = await A.rpc("admin_list_cards").catch(() => null);
        if (fresh) { adminCards = fresh; const f = fresh.find((x) => x.id === id); if (f) { row.classList.toggle("off", !f.enabled); $(`[data-d="c:${id}:worth"]`, row).placeholder = f.value + " (default)"; } }
      });
      const del = $("[data-del]", row);
      if (del) del.addEventListener("click", async () => {
        if (!(await window.App.confirmBox(`Delete ${c.name}? Every copy players own is removed too.`, "Delete", true))) return;
        await call("admin_delete_card", { p_id: id }, "Deleted", del).catch(() => {});
        await reloadCatalog(); loadCards();
      });
    });
  }

  // =====================================================================
  // PACKS
  // =====================================================================
  let adminPacks = [];
  function buildPacks(v) {
    v.innerHTML = `<div class="row between"><p class="muted small">Odds are weights in %. Players see them on the home page.</p><button class="btn small" id="pk-new">+ New pack</button></div><div id="pk-list" class="pk-list"><p class="muted small">Loading…</p></div>`;
    $("#pk-new", v).addEventListener("click", () => {
      adminPacks.push({ id: "", name: "New Pack", description: "", size: 5, price: "100", colors: ["#3ee8ff", "#7a3cff"], sets: ["Extreme"],
        odds: { common: 52, uncommon: 29, rare: 14.5, epic: 4, legendary: 0.4, mythic: 0.1 }, enabled: true, sort: 100, _new: Date.now() });
      renderPacks();
    });
    loadPacks();
  }
  async function loadPacks() {
    try { adminPacks = await A.rpc("admin_list_packs"); } catch (e) { $("#pk-list", views.packs).innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    renderPacks();
  }
  function renderPacks() {
    const el = $("#pk-list", views.packs);
    el.innerHTML = adminPacks.map((p, i) => {
      const k = "p:" + (p.id || "new" + p._new) + ":";
      return `<section class="pa pk" data-i="${i}" data-k="${esc(k)}">
        <div class="pk-preview" style="--p1:${esc(p.colors[0])};--p2:${esc(p.colors[1])}"><b>${esc(p.name)}</b></div>
        <div class="form-grid">
          <label>Name<input data-d="${k}name" value="${esc(p.name)}" maxlength="60"></label>
          <label>Description<input data-d="${k}desc" value="${esc(p.description)}" maxlength="140"></label>
          <label>Price (orbs)<input data-d="${k}price" value="${esc(p.price)}" inputmode="numeric"></label>
          <label>Cards per pack<input data-d="${k}size" value="${p.size}" type="number" min="1" max="20"></label>
          <label>Colour 1<input type="color" data-d="${k}c1" value="${esc(p.colors[0])}"></label>
          <label>Colour 2<input type="color" data-d="${k}c2" value="${esc(p.colors[1])}"></label>
          <label>Order<input data-d="${k}sort" value="${p.sort}" type="number"></label>
          <label class="check"><input type="checkbox" data-d="${k}enabled" ${p.enabled ? "checked" : ""}> Available</label>
        </div>
        <div class="field"><span>Sets in this pack</span><div class="row wrap">${D.SET_ORDER.map((s) => `<label class="check chip-check"><input type="checkbox" data-d="${k}set:${s}" ${p.sets.includes(s) ? "checked" : ""}> ${D.SETS[s].label}</label>`).join("")}</div></div>
        <div class="field"><span>Odds % <i class="muted" data-total></i></span><div class="odds-grid">${D.RARITIES.map((r) => `<label style="--rc:${D.RARITY_INFO[r].color}">${D.RARITY_INFO[r].label}<input data-d="${k}odd:${r}" value="${p.odds[r] ?? 0}" type="number" step="0.01" min="0"></label>`).join("")}</div></div>
        <button class="btn small primary" data-save>${p.id ? "Save pack" : "Create pack"}</button>
      </section>`;
    }).join("");
    bind(el);
    $$(".pk", el).forEach((sec) => {
      const p = adminPacks[+sec.dataset.i];
      const k = sec.dataset.k;
      const total = () => {
        const t = D.RARITIES.reduce((s, r) => s + (parseFloat(draft(k + "odd:" + r, p.odds[r] ?? 0)) || 0), 0);
        $("[data-total]", sec).textContent = `(total ${+t.toFixed(3)}%${Math.abs(t - 100) > 0.001 ? ", will be scaled" : ""})`;
      };
      total();
      $$("[data-d*='odd:']", sec).forEach((i) => i.addEventListener("input", total));
      $$("input[type=color]", sec).forEach((i) => i.addEventListener("input", () => {
        $(".pk-preview", sec).style.setProperty("--p1", draft(k + "c1", p.colors[0]));
        $(".pk-preview", sec).style.setProperty("--p2", draft(k + "c2", p.colors[1]));
      }));
      $("[data-save]", sec).addEventListener("click", async (e) => {
        const price = String(draft(k + "price", p.price)).trim();
        if (!isWhole(price)) return toast("Price must be a whole number", "bad");
        const sets = D.SET_ORDER.filter((s) => draft(k + "set:" + s, p.sets.includes(s)));
        if (!sets.length) return toast("Choose at least one set", "bad");
        const odds = {};
        D.RARITIES.forEach((r) => (odds[r] = Math.max(0, parseFloat(draft(k + "odd:" + r, p.odds[r] ?? 0)) || 0)));
        const res = await call("admin_save_pack", { p_pack: { id: p.id || null, name: draft(k + "name", p.name), description: draft(k + "desc", p.description),
          price, size: parseInt(draft(k + "size", p.size), 10) || 5, colors: [draft(k + "c1", p.colors[0]), draft(k + "c2", p.colors[1])],
          sets, odds, enabled: !!draft(k + "enabled", p.enabled), sort: parseInt(draft(k + "sort", p.sort), 10) || 0 } },
          p.id ? "Pack saved" : "Pack created", e.target).catch(() => null);
        if (res) {
          await reloadCatalog();
          if (!p.id) { // move drafts to the new id so nothing resets
            const nk = "p:" + res.id + ":";
            Object.keys(drafts).filter((d) => d.startsWith(k)).forEach((d) => { drafts[nk + d.slice(k.length)] = drafts[d]; delete drafts[d]; });
            loadPacks();
          } else {
            $(".pk-preview b", sec).textContent = draft(k + "name", p.name);
          }
        }
      });
    });
  }

  // =====================================================================
  // ECONOMY & VALUES
  // =====================================================================
  function buildEconomy(v) {
    const cat = G.catalog;
    const rs = cat.raritySell || {}, m = cat.modifiers || {}, e = cat.economy || {};
    v.innerHTML = `
<section class="pa"><h4>What each rarity is worth (orbs when sold)</h4>
  <div class="odds-grid">${D.RARITIES.map((r) => `<label style="--rc:${D.RARITY_INFO[r].color}">${D.RARITY_INFO[r].label}<input data-d="rs:${r}" value="${rs[r] ?? 0}" inputmode="numeric"></label>`).join("")}</div>
  <p class="small muted">Give single cards their own worth under <b>Cards</b>.</p>
  <button class="btn small primary" id="rs-go">Save worth</button></section>
<section class="pa"><h4>Foil & full art</h4>
  <div class="form-grid">
    <label>Foil chance %<input data-d="m:foil:chance" value="${m.foil ? m.foil.chance : 8}" type="number" step="0.01" min="0" max="100"></label>
    <label>Foil extra worth<input data-d="m:foil:bonus" value="${m.foil ? m.foil.bonus : 4}" inputmode="numeric"></label>
    <label>Full art chance %<input data-d="m:full:chance" value="${m.fullArt ? m.fullArt.chance : 6}" type="number" step="0.01" min="0" max="100"></label>
    <label>Full art extra worth<input data-d="m:full:bonus" value="${m.fullArt ? m.fullArt.bonus : 5}" inputmode="numeric"></label>
  </div>
  <button class="btn small primary" id="m-go">Save</button></section>
<section class="pa"><h4>Orb economy</h4>
  <div class="form-grid">
    <label>Starting orbs (new + wiped)<input data-d="e:startOrbs" value="${e.startOrbs ?? 500}" inputmode="numeric"></label>
    <label>Passive orbs per hour<input data-d="e:perHour" value="${e.perHour ?? 60}" type="number" step="any" min="0"></label>
    <label>Passive cap<input data-d="e:cap" value="${e.cap ?? 600}" inputmode="numeric"></label>
    <label>Daily base<input data-d="e:dailyBase" value="${e.dailyBase ?? 100}" inputmode="numeric"></label>
    <label>Daily bonus per streak day<input data-d="e:dailyPerStreak" value="${e.dailyPerStreak ?? 20}" inputmode="numeric"></label>
    <label>Daily max<input data-d="e:dailyMax" value="${e.dailyMax ?? 300}" inputmode="numeric"></label>
  </div>
  <button class="btn small primary" id="e-go">Save economy</button></section>`;
    bind(v);
    $("#rs-go", v).addEventListener("click", async (ev) => {
      const val = {};
      for (const r of D.RARITIES) {
        const x = String(draft("rs:" + r, rs[r])).trim();
        if (!/^\d{1,18}$/.test(x)) return toast(D.RARITY_INFO[r].label + " worth must be a whole number", "bad");
        val[r] = Number(x);
      }
      await call("admin_set_config", { p_key: "rarity_sell", p_value: val }, "Worth saved", ev.target).catch(() => {});
      reloadCatalog();
    });
    $("#m-go", v).addEventListener("click", async (ev) => {
      const val = {
        foil: { chance: parseFloat(draft("m:foil:chance", 8)) || 0, bonus: parseInt(draft("m:foil:bonus", 4), 10) || 0 },
        fullArt: { chance: parseFloat(draft("m:full:chance", 6)) || 0, bonus: parseInt(draft("m:full:bonus", 5), 10) || 0 },
      };
      await call("admin_set_config", { p_key: "modifiers", p_value: val }, "Saved", ev.target).catch(() => {});
      reloadCatalog();
    });
    $("#e-go", v).addEventListener("click", async (ev) => {
      const val = {};
      for (const k of ["startOrbs", "perHour", "cap", "dailyBase", "dailyPerStreak", "dailyMax"]) {
        const x = parseFloat(draft("e:" + k, e[k]));
        if (!(x >= 0)) return toast(k + " must be a number", "bad");
        val[k] = x;
      }
      await call("admin_set_config", { p_key: "economy", p_value: val }, "Economy saved", ev.target).catch(() => {});
      reloadCatalog();
    });
  }

  // =====================================================================
  // POPUPS
  // =====================================================================
  function buildPopups(v) {
    v.innerHTML = `
<section class="pa"><h4>Send a popup</h4>
  <div class="field"><span>Send to</span><div id="bp-to"></div></div>
  <input data-d="bp-title" placeholder="Title (optional)" maxlength="120">
  <textarea data-d="bp-body" rows="3" placeholder="Message" maxlength="2000"></textarea>
  <div class="row wrap">${presetChips()}</div>
  <button class="btn primary" id="bp-go">Send</button>
  <p class="small muted">It pops up right away for anyone online, and shows the next time others log in. Only players can read their own popups.</p>
</section>`;
    bind(v);
    wirePresets(v, "bp-title", "bp-body");
    const to = picker($("#bp-to", v), "bp-to", [{ value: "*", label: "Everyone", sub: "all players" }], "*");
    A.rpc("admin_list_players", { p_q: "" }).then((list) => {
      to.setItems([{ value: "*", label: "Everyone", sub: "all players" }].concat(list.map((p) => ({ value: p.id, label: p.username, sub: p.status }))));
    }).catch(() => {});
    $("#bp-go", v).addEventListener("click", async (e) => {
      const body = String(draft("bp-body", "")).trim();
      if (!body) return toast("Write a message first", "bad");
      const target = draft("bp-to", "*");
      const r = await call("admin_popup", { p_id: target === "*" ? null : target, p_title: draft("bp-title", "") || null, p_body: body }, null, e.target).catch(() => null);
      if (r) toast(`Popup sent to ${r.sent} player${r.sent === 1 ? "" : "s"}`, "good");
    });
  }

  // =====================================================================
  // SECURITY
  // =====================================================================
  function buildSecurity(v) {
    v.innerHTML = `<div class="row between"><h4>Locked logins</h4><div class="row"><button class="btn small" id="sec-ref">↻ Refresh</button><button class="btn small" id="sec-all">Unlock all</button></div></div>
      <div id="sec-locks"></div><h4>Login history</h4><div id="sec-events"></div>`;
    $("#sec-ref", v).addEventListener("click", loadSecurity);
    $("#sec-all", v).addEventListener("click", async (e) => { await call("admin_unlock", { p_key: "*" }, "Unlocked everything", e.target).catch(() => {}); loadSecurity(); });
    loadSecurity();
  }
  async function loadSecurity() {
    const v = views.security; if (!v) return;
    let s;
    try { s = await A.rpc("admin_security"); } catch (e) { $("#sec-locks", v).innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    $("#sec-locks", v).innerHTML = s.locks.length ? `<table class="ap-table"><thead><tr><th>Who</th><th>Failures</th><th>Locked until</th><th>Last try</th><th></th></tr></thead><tbody>${
      s.locks.map((l) => `<tr><td class="mono">${esc(l.key)}</td><td>${l.failures}</td><td>${l.locked_until && new Date(l.locked_until) > new Date() ? when(l.locked_until) : "—"}</td><td>${ago(l.last_attempt)}</td>
        <td><button class="btn tiny" data-unlock="${esc(l.key)}">Unlock</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted small">Nothing is locked.</p>`;
    $$("[data-unlock]", v).forEach((b) => b.addEventListener("click", async () => { await call("admin_unlock", { p_key: b.dataset.unlock }, "Unlocked", b).catch(() => {}); loadSecurity(); }));
    $("#sec-events", v).innerHTML = s.events.length ? `<table class="ap-table"><thead><tr><th>When</th><th>Username</th><th>Result</th><th>IP</th><th>Device</th></tr></thead><tbody>${
      s.events.map((l) => `<tr><td>${when(l.at)}</td><td>${esc(l.username || "")}</td><td>${l.ok ? "✅ " : "❌ "}${esc(l.reason || "")}</td><td class="mono">${esc(l.ip || "")}</td><td class="ua">${esc(l.ua || "")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted small">No logins yet.</p>`;
  }

  // =====================================================================
  // LOGS
  // =====================================================================
  function buildLogs(v) {
    v.innerHTML = `<div class="row between"><h4>Admin actions</h4><button class="btn small" id="lg-ref">↻ Refresh</button></div><div id="lg"></div>`;
    $("#lg-ref", v).addEventListener("click", loadLogs);
    loadLogs();
  }
  async function loadLogs() {
    const v = views.logs; if (!v) return;
    let rows;
    try { rows = await A.rpc("admin_logs"); } catch (e) { $("#lg", v).innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    $("#lg", v).innerHTML = rows.length ? `<table class="ap-table"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Player</th><th>Details</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${when(r.at)}</td><td>${esc(r.admin || "")}</td><td>${esc(r.action)}</td><td>${esc(r.target || "")}</td><td class="ua mono">${esc(r.details ? JSON.stringify(r.details) : "")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted small">No actions yet.</p>`;
  }

  const BUILD = { players: buildPlayers, cards: buildCards, packs: buildPacks, economy: buildEconomy, popups: buildPopups, security: buildSecurity, logs: buildLogs };

  return { open, close, get isOpen() { return !!wrap; } };
})();
