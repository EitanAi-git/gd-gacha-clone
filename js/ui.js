// EitanGD Gacha: pages (Home, Catalog, Card) for a logged-in player. Data comes from the server
// through Game; pages are built once per visit and their live parts update in place.
window.UI = (function () {
  const D = window.GD_DATA;
  const G = window.Game;
  const CV = window.CardView;
  const P = window.Picker;
  const esc = CV.esc;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const app = $("#app");
  const fmt = G.fmt, big = G.big;
  const rIndex = (r) => D.RARITIES.indexOf(r);
  const toast = (m, k) => window.App.toast(m, k);
  const fail = (e) => toast(e.message || String(e), "bad");

  // ---------- sound (generated, no files) ----------
  let actx = null;
  const muted = () => { try { return localStorage.getItem("eitangd-muted") === "1"; } catch (e) { return false; } };
  function beep(freq, dur, type, vol) {
    if (muted()) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "triangle"; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.08, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* audio unavailable */ }
  }
  function revealSound(rarity) {
    const base = 330 + rIndex(rarity) * 110;
    beep(base, 0.18);
    if (rIndex(rarity) >= 3) setTimeout(() => beep(base * 1.5, 0.3, "sine", 0.1), 90);
    if (rIndex(rarity) >= 4) setTimeout(() => beep(base * 2, 0.45, "sine", 0.1), 200);
  }
  $("#mute").addEventListener("click", () => {
    try { localStorage.setItem("eitangd-muted", muted() ? "0" : "1"); } catch (e) { /* ignore */ }
    renderHeader();
  });
  $("#acct").addEventListener("click", () => window.App.openAccount());
  $("#admin-btn").addEventListener("click", () => window.AdminPanel.open());

  // ---------- header ----------
  function renderHeader() {
    const me = G.me;
    $("#mute").textContent = muted() ? "🔇" : "🔊";
    if (!me) return;
    $("#orb-count").textContent = fmt(me.orbs);
    $("#acct-name").textContent = me.username;
    $("#admin-btn").hidden = me.role !== "admin";
    const route = location.hash.split("?")[0] || "#/";
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === route || (route.startsWith("#/c/") && a.getAttribute("href") === "#/catalog")));
  }

  function blockedBanner() {
    return G.me && G.me.status === "blocked"
      ? `<div class="notice bad">🚫 Your account is blocked by an admin. You can look around, but you can't open packs, sell or claim orbs.</div>` : "";
  }

  // ---------- shared ----------
  function setCounts(owned) {
    const counts = { All: { owned: 0, total: 0 } };
    D.SET_ORDER.forEach((s) => (counts[s] = { owned: 0, total: 0 }));
    G.allCards().forEach((c) => {
      counts[c.set].total++; counts.All.total++;
      if (owned[c.id]) { counts[c.set].owned++; counts.All.owned++; }
    });
    return counts;
  }
  const pct = (a, b) => (b ? Math.floor((a / b) * 100) : 0);
  function tabsHtml(active, counts) {
    return ["All"].concat(D.SET_ORDER).map((s) => {
      const c = counts[s] || { owned: 0, total: 0 };
      return `<button class="tab ${s === active ? "active" : ""}" data-set="${s}">${s === "All" ? "All" : D.SETS[s].label.replace(" Demon", "")} <small>${c.owned}/${c.total}</small></button>`;
    }).join("");
  }
  const rarityItems = (allLabel) => [{ value: "", label: allLabel }].concat(D.RARITIES.map((r) => ({ value: r, label: D.RARITY_INFO[r].label, color: D.RARITY_INFO[r].color })));
  function oddsRow(p) {
    const m = G.catalog.modifiers || {};
    return `<div class="odds">${D.RARITIES.filter((r) => p.odds[r] > 0).map((r) =>
      `<span class="odd" style="--rc:${D.RARITY_INFO[r].color}"><b>${D.RARITY_INFO[r].label}</b>${+Number(p.odds[r]).toFixed(2)}%</span>`).join("")}
      <span class="odd extra"><b>Foil</b>${m.foil ? m.foil.chance : 0}%</span><span class="odd extra"><b>Full art</b>${m.fullArt ? m.fullArt.chance : 0}%</span></div>`;
  }
  function packArt(p) {
    return `<div class="pack-art" style="--p1:${esc(p.colors[0])};--p2:${esc(p.colors[1])}"><span class="pack-shine"></span><span class="pack-name">${esc(p.name)}</span><span class="pack-size">${p.size} cards</span></div>`;
  }
  function filterCards(list, ui) {
    const q = (ui.q || "").trim().toLowerCase();
    return list.filter((c) =>
      (ui.set === "All" || !ui.set || c.set === ui.set) &&
      (!ui.rarity || c.rarity === ui.rarity) &&
      (!q || c.name.toLowerCase().includes(q) || c.creator.toLowerCase().includes(q)));
  }
  function sortCards(list, sort, owned) {
    const setIdx = (c) => D.SET_ORDER.indexOf(c.set);
    const newest = (c) => (owned[c.id] ? Math.max(...owned[c.id].map((x) => new Date(x.at).getTime())) : 0);
    const by = {
      rarest: (a, b) => rIndex(b.rarity) - rIndex(a.rarity) || setIdx(b) - setIdx(a) || a.name.localeCompare(b.name),
      newest: (a, b) => newest(b) - newest(a),
      number: (a, b) => setIdx(a) - setIdx(b) || G.cardNumber(a) - G.cardNumber(b),
      name: (a, b) => a.name.localeCompare(b.name),
      most: (a, b) => { const x = owned[b.id] ? G.rowsCount(owned[b.id]) : 0n, y = owned[a.id] ? G.rowsCount(owned[a.id]) : 0n; return x > y ? 1 : x < y ? -1 : 0; },
    }[sort] || (() => 0);
    return list.slice().sort(by);
  }
  function cardTile(c, owned) {
    const rows = owned[c.id];
    return CV.render(c, rows ? G.bestRow(rows) : {}, { small: true, missing: !rows, count: rows ? G.rowsCount(rows) : 0n, link: true });
  }

  // =====================================================================
  // HOME
  // =====================================================================
  const homeUI = { pack: "demon", set: "All", q: "", rarity: "", sort: "rarest", owned: true };

  function buildHome() {
    app.innerHTML = `
${blockedBanner()}
<section class="home-grid">
  <div class="panel packs-panel">
    <div class="pack-strip" id="pack-strip"></div>
    <div class="pack-detail" id="pack-detail"></div>
  </div>
  <aside class="side">
    <div class="panel wallet" id="wallet"></div>
    <div class="panel recent" id="recent"></div>
  </aside>
</section>
<section class="panel collection">
  <div class="coll-head"><h2>Your collection</h2><span class="muted" id="coll-count"></span>
    <button class="btn small" id="sell-dupes">Sell all duplicates</button></div>
  <div class="tabs" role="tablist" id="coll-tabs"></div>
  <div class="filters">
    <input type="search" id="q" placeholder="Search level or creator" value="${esc(homeUI.q)}" autocomplete="off">
    <div id="sort-pk"></div><div id="rar-pk"></div>
    <div class="seg" id="owned-seg"><button data-owned="1">Owned</button><button data-owned="0">All slots</button></div>
  </div>
  <div class="grid" id="coll-grid"></div>
</section>`;
    const sortPk = P.create({ items: [
      { value: "rarest", label: "Rarest first" }, { value: "newest", label: "Newest first" }, { value: "most", label: "Most copies" },
      { value: "number", label: "Set order" }, { value: "name", label: "Name" }], value: homeUI.sort,
      onChange: (v) => { homeUI.sort = v; updateGrid(); } });
    $("#sort-pk").replaceWith(sortPk.el);
    const rarPk = P.create({ items: rarityItems("All rarities"), value: homeUI.rarity, onChange: (v) => { homeUI.rarity = v; updateGrid(); } });
    $("#rar-pk").replaceWith(rarPk.el);
    $("#q").addEventListener("input", (e) => { homeUI.q = e.target.value; updateGrid(); });
    $$("#owned-seg button").forEach((b) => b.addEventListener("click", () => { homeUI.owned = b.dataset.owned === "1"; updateGrid(); }));
    $("#coll-tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) { homeUI.set = b.dataset.set; updateGrid(); } });
    $("#pack-strip").addEventListener("click", (e) => { const b = e.target.closest(".pack-tile"); if (b) { homeUI.pack = b.dataset.pack; updateHome(); } });
    $("#sell-dupes").addEventListener("click", async () => {
      if (!(await window.App.confirmBox("Sell every duplicate? Your best version of each card is kept.", "Sell"))) return;
      try { const r = await G.sellDuplicates(null); toast(big(r.sold) ? `Sold ${fmt(r.sold)} cards for ${fmt(r.orbs)} orbs` : "No duplicates to sell", big(r.sold) ? "good" : ""); }
      catch (e) { fail(e); }
    });
    updateHome();
  }

  function updateHome() {
    const me = G.me; if (!me) return;
    const packs = G.packs();
    const p = packs.find((x) => x.id === homeUI.pack) || packs[0];
    if (p) homeUI.pack = p.id;
    const orbs = big(me.orbs);
    const blocked = me.status === "blocked";

    $("#pack-strip").innerHTML = packs.map((x) => `<button class="pack-tile ${p && x.id === p.id ? "active" : ""}" data-pack="${esc(x.id)}" style="--p1:${esc(x.colors[0])};--p2:${esc(x.colors[1])}"><span>${esc(x.name)}</span><small>${fmt(x.price)} orbs</small></button>`).join("");
    if (p) {
      const pool = G.packPool(p);
      const price = big(p.price);
      $("#pack-detail").innerHTML = `${packArt(p)}
      <div class="pack-info">
        <h2>${esc(p.name)}</h2>
        <p class="muted">${esc(p.description)} · ${pool.length} cards · <a href="#/catalog?pack=${encodeURIComponent(p.id)}">See all ${pool.length} cards</a></p>
        <div class="pack-actions">
          <button class="btn primary big" id="open1" ${blocked || orbs < price ? "disabled" : ""}>Open · <span class="orb-i"></span>${fmt(p.price)}</button>
          <button class="btn" id="open10" ${blocked || orbs < price * 10n ? "disabled" : ""}>Bulk open ×10 · ${fmt(price * 10n)}</button>
        </div>
        ${oddsRow(p)}
      </div>`;
      $("#open1").addEventListener("click", () => doOpen(p.id, 1));
      $("#open10").addEventListener("click", () => doOpen(p.id, 10));
    } else $("#pack-detail").innerHTML = `<p class="muted">No packs available right now.</p>`;

    const e = G.catalog.economy || {};
    const pend = big(me.pending), cap = big(Math.floor(e.cap || 0));
    $("#wallet").innerHTML = `
      <div class="wallet-row"><span class="orb-i big"></span><div><div class="wallet-bal" title="${esc(me.orbs)}">${fmt(me.orbs)}</div><div class="muted small">Mana orbs</div></div></div>
      <div class="pending">
        <div class="bar"><i style="width:${cap > 0n ? Math.min(100, Number((pend * 100n) / cap)) : 0}%"></i></div>
        <div class="pending-row"><span class="small muted">+${e.perHour || 0}/hour · ${fmt(pend)}/${fmt(cap)}</span>
        <button class="btn small" id="collect" ${blocked || pend < 1n ? "disabled" : ""}>Collect ${fmt(pend)}</button></div>
      </div>
      <button class="btn daily ${me.daily.claimed ? "" : "glow"}" id="daily" ${blocked || me.daily.claimed ? "disabled" : ""}>
        ${me.daily.claimed ? "Daily claimed ✓" : `Claim daily +${fmt(me.daily.amount)}`} <small>🔥 ${me.daily.streak} day streak</small></button>
      <div class="small muted stat-line">Rarity score <b>${fmt(me.score)}</b> · Packs opened <b>${fmt(me.packsOpened)}</b></div>`;
    $("#collect").addEventListener("click", async () => {
      try { const r = await G.collect(); toast(`+${fmt(r.collected)} orbs collected`, "good"); beep(660, 0.2); } catch (er) { fail(er); }
    });
    $("#daily").addEventListener("click", async () => {
      try { const r = await G.claimDaily(); toast(`+${fmt(r.amount)} orbs · ${r.streak} day streak`, "good"); beep(523, 0.15); setTimeout(() => beep(784, 0.25), 120); }
      catch (er) { fail(er); }
    });

    $("#recent").innerHTML = `<h3>Recent pulls</h3>` + (me.recent.length ? `<ul>${me.recent.slice(0, 10).map((r) => {
      const c = G.card(r.card); if (!c) return "";
      return `<li><a href="#/c/${encodeURIComponent(c.id)}"><span class="dot" style="background:${D.RARITY_INFO[c.rarity].color}"></span><span class="rn">${esc(c.name)}<small> by ${esc(c.creator)}</small></span><span class="code">${CV.code(c)}${r.foil ? " ✦" : ""}</span></a></li>`;
    }).join("")}</ul>` : `<p class="muted small">Open a pack to see your pulls here.</p>`);
    updateGrid();
  }

  function updateGrid() {
    if (!$("#coll-grid") || !G.me) return;
    const owned = G.ownedMap();
    const counts = setCounts(owned);
    $("#coll-count").textContent = `${counts.All.owned}/${counts.All.total} cards · ${pct(counts.All.owned, counts.All.total)}% complete`;
    $("#coll-tabs").innerHTML = tabsHtml(homeUI.set, counts);
    $$("#owned-seg button").forEach((b) => b.classList.toggle("active", (b.dataset.owned === "1") === homeUI.owned));
    $("#sell-dupes").disabled = G.me.status === "blocked";
    let list = filterCards(G.catalog.cards.filter((c) => c.enabled !== false || owned[c.id]), homeUI);
    if (homeUI.owned) list = list.filter((c) => owned[c.id]);
    list = sortCards(list, homeUI.sort, owned);
    $("#coll-grid").innerHTML = list.length ? list.map((c) => cardTile(c, owned)).join("")
      : `<p class="empty">${homeUI.owned ? "No cards here yet. Open a pack!" : "No cards match."}</p>`;
  }

  // ---------- pack opening ----------
  let opening = false;
  async function doOpen(packId, count) {
    if (opening) return;
    opening = true;
    $$("#open1, #open10").forEach((b) => (b.disabled = true));
    try {
      const r = await G.openPack(packId, count);
      beep(220, 0.25, "sawtooth", 0.05);
      showOpening(G.pack(packId), r.cards, count);
    } catch (e) {
      fail(e);
      if (/Price changed|Pack unavailable/.test(e.message)) G.loadCatalog().catch(() => {});
    } finally { opening = false; if (!$("#modal").hidden) return; updateHome(); }
  }

  function showOpening(p, cards, count) {
    const modal = $("#modal");
    const bulk = count > 1;
    const val = (c) => G.sellValue(c);
    const best = cards.slice().sort((a, b) => rIndex(G.card(b.card).rarity) - rIndex(G.card(a.card).rarity) || G.rank(b) - G.rank(a))[0];
    const godPack = cards.every((c) => rIndex(G.card(c.card).rarity) >= 2);
    const total = cards.reduce((s, c) => s + val(c), 0n);
    const bc = G.card(best.card);
    modal.innerHTML = `
<div class="modal-box opening">
  <div class="op-head"><h2>${esc(p.name)}${bulk ? ` ×${count}` : ""}</h2>${godPack ? `<span class="god">God pack!</span>` : ""}</div>
  <div class="op-grid ${bulk ? "bulk" : ""}">${cards.map((c, i) => `
    <div class="flip ${bulk ? "flipped" : ""}" data-i="${i}" style="--d:${i * 50}ms">
      <div class="flip-inner">
        <div class="flip-back" style="--p1:${esc(p.colors[0])};--p2:${esc(p.colors[1])}"><span>?</span></div>
        <div class="flip-front">${CV.render(G.card(c.card), c, { isNew: c.isNew })}</div>
      </div>
    </div>`).join("")}</div>
  <div class="op-summary" ${bulk ? "" : "hidden"}>
    <div>Best pull: <b style="color:${D.RARITY_INFO[bc.rarity].color}">${esc(bc.name)}</b> <span class="muted">by ${esc(bc.creator)}</span></div>
    <div class="muted small">${cards.filter((c) => c.isNew).length} new · worth ${fmt(total)} orbs</div>
  </div>
  <div class="op-actions">
    <button class="btn" id="reveal-all" ${bulk ? "hidden" : ""}>Reveal all</button>
    <button class="btn" id="sell-these">Sell duplicates from this pull</button>
    <button class="btn primary" id="again">Open again · ${fmt(big(p.price) * BigInt(count))}</button>
    <button class="btn ghost" id="close-modal">Close</button>
  </div>
  <p class="muted small center">Tap a card to flip it.</p>
</div>`;
    modal.hidden = false;
    let revealed = bulk ? cards.length : 0;
    const done = () => { $(".op-summary", modal).hidden = false; $("#reveal-all").hidden = true; };
    function flip(el) {
      if (el.classList.contains("flipped")) return;
      el.classList.add("flipped");
      revealSound(G.card(cards[+el.dataset.i].card).rarity);
      if (++revealed === cards.length) done();
    }
    $$(".flip", modal).forEach((el) => el.addEventListener("click", () => flip(el)));
    $("#reveal-all").addEventListener("click", () => $$(".flip:not(.flipped)", modal).forEach((el, i) => setTimeout(() => flip(el), i * 150)));
    $("#sell-these").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const r = await G.sellDuplicates([...new Set(cards.map((c) => c.card))]);
        toast(big(r.sold) ? `Sold ${fmt(r.sold)} for ${fmt(r.orbs)} orbs` : "Nothing in this pull is a duplicate", big(r.sold) ? "good" : "");
      } catch (er) { fail(er); e.target.disabled = false; }
    });
    $("#again").addEventListener("click", () => { closeModal(true); doOpen(p.id, count); });
    $("#close-modal").addEventListener("click", () => closeModal());
  }
  function closeModal(silent) {
    const m = $("#modal"); m.hidden = true; m.innerHTML = "";
    if (!silent) refreshPage();
  }
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

  // =====================================================================
  // CATALOG
  // =====================================================================
  const catUI = { set: "All", q: "", rarity: "", show: "all", page: 0, pack: "" };
  const PAGE = 35;

  function buildCatalog(params) {
    if (params.has("pack")) { catUI.pack = params.get("pack"); catUI.set = "All"; catUI.page = 0; }
    app.innerHTML = `
${blockedBanner()}
<section class="cat-tiles" id="cat-tiles"></section>
<section class="cat-layout">
  <aside class="panel cat-side" id="cat-side"></aside>
  <div class="panel cat-main">
    <div class="filters">
      <div class="seg" id="show-seg">${[["all", "All"], ["missing", "Missing"], ["owned", "Owned"], ["fav", "★ Favorites"]].map(([k, l]) => `<button data-show="${k}">${l}</button>`).join("")}</div>
      <input type="search" id="cq" placeholder="Search all sets" value="${esc(catUI.q)}" autocomplete="off">
      <div id="crar-pk"></div>
    </div>
    <p class="muted small" id="cat-note"></p>
    <div class="grid" id="cat-grid"></div>
    <div class="pager"><button class="btn small" id="prev">‹ Prev</button><span id="pg"></span><button class="btn small" id="next">Next ›</button></div>
  </div>
</section>`;
    const rp = P.create({ items: rarityItems("All rarities"), value: catUI.rarity, onChange: (v) => { catUI.rarity = v; catUI.page = 0; updateCatalog(); } });
    $("#crar-pk").replaceWith(rp.el);
    $("#cq").addEventListener("input", (e) => { catUI.q = e.target.value; catUI.page = 0; updateCatalog(); });
    $$("#show-seg button").forEach((b) => b.addEventListener("click", () => { catUI.show = b.dataset.show; catUI.page = 0; updateCatalog(); }));
    $("#prev").addEventListener("click", () => { catUI.page--; updateCatalog(); window.scrollTo(0, 0); });
    $("#next").addEventListener("click", () => { catUI.page++; updateCatalog(); window.scrollTo(0, 0); });
    $("#cat-side").addEventListener("click", (e) => {
      const b = e.target.closest(".side-item"); if (!b) return;
      if (b.dataset.pack) { catUI.pack = b.dataset.pack; catUI.set = "All"; } else { catUI.set = b.dataset.set; catUI.pack = ""; }
      catUI.page = 0;
      if (location.hash !== "#/catalog") history.replaceState(null, "", "#/catalog");
      updateCatalog();
    });
    updateCatalog();
  }

  function updateCatalog() {
    if (!$("#cat-grid") || !G.me) return;
    const owned = G.ownedMap();
    const counts = setCounts(owned);
    const cards = G.allCards();
    const allVariants = cards.length * 4;
    const variantsOwned = Object.entries(owned).filter(([id]) => G.card(id) && G.card(id).enabled !== false)
      .reduce((s, [, rows]) => s + new Set(rows.map((r) => `${r.foil}${r.fullArt}`)).size, 0);
    $("#cat-tiles").innerHTML = `
      <div class="panel tile"><b>${pct(counts.All.owned, counts.All.total)}%</b><span>Levels · ${counts.All.owned}/${counts.All.total}</span></div>
      <div class="panel tile"><b>${pct(variantsOwned, allVariants)}%</b><span>All versions · ${variantsOwned}/${allVariants}</span></div>
      <div class="panel tile"><b>${G.me.favorites.length}</b><span>Favorites</span></div>
      <div class="panel tile"><b>${fmt(G.me.score)}</b><span>Rarity score</span></div>`;
    $("#cat-side").innerHTML = `<h3>Sets</h3>` +
      ["All"].concat(D.SET_ORDER).map((s) => `<button class="side-item ${!catUI.pack && catUI.set === s ? "active" : ""}" data-set="${s}"><span>${s === "All" ? "All sets" : D.SETS[s].label}</span><small>${pct(counts[s].owned, counts[s].total)}%</small></button>`).join("") +
      `<h3>Packs</h3>` + G.packs().map((p) => { const pool = G.packPool(p); const o = pool.filter((c) => owned[c.id]).length;
        return `<button class="side-item ${catUI.pack === p.id ? "active" : ""}" data-pack="${esc(p.id)}"><span>${esc(p.name)}</span><small>${pct(o, pool.length)}%</small></button>`; }).join("");
    $$("#show-seg button").forEach((b) => b.classList.toggle("active", b.dataset.show === catUI.show));

    const packObj = catUI.pack ? G.pack(catUI.pack) : null;
    let list = filterCards(packObj ? G.packPool(packObj) : cards, catUI);
    if (catUI.show === "missing") list = list.filter((c) => !owned[c.id]);
    if (catUI.show === "owned") list = list.filter((c) => owned[c.id]);
    if (catUI.show === "fav") list = list.filter((c) => G.me.favorites.includes(c.id));
    list = sortCards(list, "number", owned);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    catUI.page = Math.max(0, Math.min(catUI.page, pages - 1));
    $("#cat-note").innerHTML = packObj ? `Showing cards in <b>${esc(packObj.name)}</b>.` : "";
    $("#cat-grid").innerHTML = list.slice(catUI.page * PAGE, catUI.page * PAGE + PAGE).map((c) => cardTile(c, owned)).join("") || `<p class="empty">No cards match.</p>`;
    $("#pg").textContent = `Page ${catUI.page + 1} / ${pages}`;
    $("#prev").disabled = catUI.page === 0;
    $("#next").disabled = catUI.page >= pages - 1;
  }

  // =====================================================================
  // CARD DETAIL
  // =====================================================================
  function renderCard(id) {
    const c = G.card(id);
    if (!c) { app.innerHTML = `<div class="panel"><h2>Card not found</h2><a href="#/catalog">Back to catalog</a></div>`; return; }
    const rows = G.ownedMap()[c.id] || [];
    const total = G.rowsCount(rows);
    const best = rows.length ? G.bestRow(rows) : {};
    const fav = G.me.favorites.includes(c.id);
    const rar = D.RARITY_INFO[c.rarity];
    const m = G.catalog.modifiers || {};
    const packsWith = G.packs().filter((p) => p.sets.includes(c.set));
    const blocked = G.me.status === "blocked";
    const sorted = rows.slice().sort((a, b) => G.rank(b) - G.rank(a));
    app.innerHTML = `
${blockedBanner()}
<a class="back" href="#/catalog">‹ Catalog</a>
<section class="detail">
  <div class="detail-card">${CV.render(c, best, { missing: !rows.length })}</div>
  <div class="panel detail-info">
    <h1>${esc(c.name)} <span class="muted">by ${esc(c.creator)}</span></h1>
    <table class="info">
      <tr><th>Set</th><td>${D.SETS[c.set].label}</td></tr>
      <tr><th>Number</th><td>${CV.code(c)}</td></tr>
      <tr><th>Rarity</th><td style="color:${rar.color}">${rar.label}</td></tr>
      <tr><th>Worth</th><td>${fmt(c.sell)} orbs (+${m.foil ? m.foil.bonus : 0} foil, +${m.fullArt ? m.fullArt.bonus : 0} full art)</td></tr>
      <tr><th>Found in</th><td>${c.enabled === false ? "Not in packs right now" : packsWith.map((p) => esc(p.name)).join(", ") || "Admin only"}</td></tr>
      <tr><th>Credit</th><td>Level by ${esc(c.creator)}. Geometry Dash by RobTop Games.${c.custom ? " (custom card)" : ""}</td></tr>
    </table>
    <div class="row">
      <button class="btn" id="fav">${fav ? "★ Favorited" : "☆ Favorite"}</button>
      <button class="btn" id="sell-dupe" ${blocked || total < 2n ? "disabled" : ""}>Sell duplicates (keep 1)</button>
    </div>
    <h3>Your copies (${fmt(total)})</h3>
    ${rows.length ? `<ul class="copies">${sorted.map((r, i) => `<li>
      <span>${r.fullArt ? "Full art " : ""}${r.foil ? "Foil" : ""}${!r.foil && !r.fullArt ? "Normal" : ""} <b>×${fmt(r.qty)}</b></span>
      <span class="muted small">${fmt(G.sellValue(r))} each</span>
      <button class="btn small" data-sell1="${i}" ${blocked ? "disabled" : ""}>Sell 1</button>
      <button class="btn small" data-sellall="${i}" ${blocked ? "disabled" : ""}>Sell all</button></li>`).join("")}</ul>`
      : `<p class="muted">You don't own this card yet.</p>`}
  </div>
</section>`;
    $("#fav").addEventListener("click", () => G.toggleFavorite(c.id).catch(fail));
    $("#sell-dupe").addEventListener("click", async () => {
      try { const r = await G.sellDuplicates([c.id]); toast(`Sold ${fmt(r.sold)} for ${fmt(r.orbs)} orbs`, "good"); } catch (e) { fail(e); }
    });
    const sellRow = async (r, qty) => {
      try { const res = await G.sell([{ card: r.card, foil: r.foil, fullArt: r.fullArt, qty: String(qty) }]); toast(`Sold ${fmt(res.sold)} for ${fmt(res.orbs)} orbs`, "good"); }
      catch (e) { fail(e); }
    };
    $$("[data-sell1]").forEach((b) => b.addEventListener("click", () => sellRow(sorted[+b.dataset.sell1], 1)));
    $$("[data-sellall]").forEach((b) => b.addEventListener("click", async () => {
      const r = sorted[+b.dataset.sellall];
      if (await window.App.confirmBox(`Sell all ${fmt(r.qty)} of this version?`, "Sell")) sellRow(r, r.qty);
    }));
  }

  // =====================================================================
  // ROUTER
  // =====================================================================
  let currentPath = null;
  function parse() {
    const [path, query] = (location.hash.slice(1) || "/").split("?");
    return { path, params: new URLSearchParams(query || "") };
  }
  function route(force) {
    if (!G.me) return;
    const { path, params } = parse();
    renderHeader();
    if (!force && path === currentPath && !params.toString()) return refreshPage();
    currentPath = path;
    window.scrollTo(0, 0);
    if (path === "/catalog") buildCatalog(params);
    else if (path.startsWith("/c/")) renderCard(decodeURIComponent(path.slice(3)));
    else buildHome();
  }
  // Server state changed: update the live parts of the current page.
  function refreshPage() {
    if (!G.me || !$("#modal").hidden) { renderHeader(); return; }
    renderHeader();
    const { path } = parse();
    const hasBanner = !!$(".notice.bad", app);
    if (hasBanner !== (G.me.status === "blocked")) return route(true);
    if (path === "/catalog") updateCatalog();
    else if (path.startsWith("/c/")) { const y = window.scrollY; renderCard(decodeURIComponent(path.slice(3))); window.scrollTo(0, y); }
    else if ($("#coll-grid")) updateHome();
  }
  G.onChange(() => { if (G.me) refreshPage(); });
  window.addEventListener("hashchange", () => route(true));

  return { route, renderHeader, refreshPage };
})();
