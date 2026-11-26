// EitanGD Gacha: pages and interaction.
(function () {
  const D = window.GD_DATA;
  const G = window.Game;
  const CV = window.CardView;
  const esc = CV.esc;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const app = $("#app");
  const fmt = (n) => Math.floor(n).toLocaleString("en-US");
  const rIndex = (r) => D.RARITIES.indexOf(r);

  // ---------- sound (generated, no files) ----------
  let actx = null;
  function beep(freq, dur, type, vol) {
    if (G.state.muted) return;
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

  // ---------- toast ----------
  function toast(msg, kind) {
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.classList.add("out"), 2400);
    setTimeout(() => t.remove(), 2900);
  }

  // ---------- header ----------
  function renderHeader() {
    $("#orb-count").textContent = fmt(G.state.orbs);
    $("#mute").textContent = G.state.muted ? "🔇" : "🔊";
    const route = location.hash.split("?")[0] || "#/";
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === route || (route.startsWith("#/c/") && a.getAttribute("href") === "#/catalog")));
  }
  $("#mute").addEventListener("click", () => G.setMuted(!G.state.muted));

  // ---------- shared helpers ----------
  function ownedMap() {
    const m = {};
    G.state.copies.forEach((c) => { (m[c.cardId] = m[c.cardId] || []).push(c); });
    return m;
  }
  function bestCopy(list) {
    return list.slice().sort((a, b) => (b.fullArt * 2 + b.foil) - (a.fullArt * 2 + a.foil))[0];
  }
  function setTabs(active, counts) {
    const sets = ["All"].concat(D.SET_ORDER);
    return `<div class="tabs" role="tablist">${sets.map((s) => {
      const c = counts[s] || { owned: 0, total: 0 };
      return `<button class="tab ${s === active ? "active" : ""}" data-set="${s}">${s === "All" ? "All" : D.SETS[s].label.replace(" Demon", "")} <small>${c.owned}/${c.total}</small></button>`;
    }).join("")}</div>`;
  }
  function setCounts(owned) {
    const counts = { All: { owned: 0, total: 0 } };
    D.SET_ORDER.forEach((s) => (counts[s] = { owned: 0, total: 0 }));
    G.allCards().forEach((c) => {
      counts[c.set].total++; counts.All.total++;
      if (owned[c.id]) { counts[c.set].owned++; counts.All.owned++; }
    });
    return counts;
  }
  function rarityOptions(sel) {
    return `<option value="">All rarities</option>` + D.RARITIES.map((r) => `<option value="${r}" ${sel === r ? "selected" : ""}>${D.RARITY_INFO[r].label}</option>`).join("");
  }
  function oddsRow(p) {
    return `<div class="odds">${D.RARITIES.filter((r) => p.odds[r] > 0).map((r) =>
      `<span class="odd" style="--rc:${D.RARITY_INFO[r].color}"><b>${D.RARITY_INFO[r].label}</b>${+p.odds[r].toFixed(2)}%</span>`).join("")}
      <span class="odd extra"><b>Foil</b>${D.MODIFIERS.foil.chance}%</span><span class="odd extra"><b>Full art</b>${D.MODIFIERS.fullArt.chance}%</span></div>`;
  }
  function packArt(p) {
    return `<div class="pack-art" style="--p1:${p.colors[0]};--p2:${p.colors[1]}"><span class="pack-shine"></span><span class="pack-name">${esc(p.name)}</span><span class="pack-size">${p.size} cards</span></div>`;
  }

  // ---------- HOME ----------
  const homeUI = { pack: "demon", set: "All", q: "", rarity: "", sort: "rarest", owned: true };

  function renderHome() {
    const st = G.state;
    const packs = G.packs();
    const p = packs.find((x) => x.id === homeUI.pack) || packs[0];
    const pool = G.packPool(p);
    const e = G.economy();
    const daily = G.dailyStatus();
    const owned = ownedMap();
    const counts = setCounts(owned);

    app.innerHTML = `
<section class="home-grid">
  <div class="panel packs-panel">
    <div class="pack-strip">${packs.map((x) => `<button class="pack-tile ${x.id === p.id ? "active" : ""}" data-pack="${x.id}" style="--p1:${x.colors[0]};--p2:${x.colors[1]}"><span>${esc(x.name)}</span><small>${fmt(x.price)} orbs</small></button>`).join("")}</div>
    <div class="pack-detail">
      ${packArt(p)}
      <div class="pack-info">
        <h2>${esc(p.name)}</h2>
        <p class="muted">${esc(p.description)} · ${pool.length} cards · <a href="#/catalog?pack=${p.id}">See all ${pool.length} cards</a></p>
        <div class="pack-actions">
          <button class="btn primary big" id="open1" ${st.orbs < p.price ? "disabled" : ""}>Open · <span class="orb-i"></span>${fmt(p.price)}</button>
          <button class="btn" id="open10" ${st.orbs < p.price * 10 ? "disabled" : ""}>Bulk open ×10 · ${fmt(p.price * 10)}</button>
        </div>
        ${oddsRow(p)}
      </div>
    </div>
  </div>

  <aside class="side">
    <div class="panel wallet">
      <div class="wallet-row"><span class="orb-i big"></span><div><div class="wallet-bal">${fmt(st.orbs)}</div><div class="muted small">Mana orbs</div></div></div>
      <div class="pending">
        <div class="bar"><i style="width:${Math.min(100, (st.pending / e.cap) * 100)}%"></i></div>
        <div class="pending-row"><span class="small muted">+${e.perHour}/hour · ${fmt(st.pending)}/${fmt(e.cap)}</span>
        <button class="btn small" id="collect" ${st.pending < 1 ? "disabled" : ""}>Collect ${fmt(st.pending)}</button></div>
      </div>
      <button class="btn daily ${daily.claimed ? "" : "glow"}" id="daily" ${daily.claimed ? "disabled" : ""}>
        ${daily.claimed ? "Daily claimed ✓" : `Claim daily +${daily.amount}`} <small>🔥 ${daily.claimed ? st.daily.streak : daily.streak} day streak</small></button>
      <div class="small muted stat-line">Rarity score <b>${fmt(G.score())}</b> · Packs opened <b>${fmt(st.stats.opened)}</b></div>
    </div>
    <div class="panel recent">
      <h3>Recent pulls</h3>
      ${st.recent.length ? `<ul>${st.recent.slice(0, 10).map((r) => {
        const c = G.card(r.cardId); if (!c) return "";
        return `<li><a href="#/c/${encodeURIComponent(c.id)}"><span class="dot" style="background:${D.RARITY_INFO[c.rarity].color}"></span><span class="rn">${esc(c.name)}<small> by ${esc(c.creator)}</small></span><span class="code">${CV.code(c)}${r.foil ? " ✦" : ""}</span></a></li>`;
      }).join("")}</ul>` : `<p class="muted small">Open a pack to see your pulls here.</p>`}
    </div>
  </aside>
</section>

<section class="panel collection">
  <div class="coll-head"><h2>Your collection</h2><span class="muted">${counts.All.owned}/${counts.All.total} cards · ${counts.All.total ? Math.floor((counts.All.owned / counts.All.total) * 100) : 0}% complete</span>
    <button class="btn small" id="sell-dupes">Sell all duplicates</button></div>
  ${setTabs(homeUI.set, counts)}
  <div class="filters">
    <input type="search" id="q" placeholder="Search level or creator" value="${esc(homeUI.q)}">
    <select id="sort"><option value="rarest">Rarest first</option><option value="newest">Newest first</option><option value="number">Set order</option><option value="name">Name</option></select>
    <select id="rarity">${rarityOptions(homeUI.rarity)}</select>
    <div class="seg"><button data-owned="1" class="${homeUI.owned ? "active" : ""}">Owned</button><button data-owned="0" class="${homeUI.owned ? "" : "active"}">All slots</button></div>
  </div>
  <div class="grid" id="coll-grid"></div>
</section>`;
    $("#sort").value = homeUI.sort;
    renderCollectionGrid(owned);

    $$(".pack-tile").forEach((b) => b.addEventListener("click", () => { homeUI.pack = b.dataset.pack; renderHome(); }));
    $("#open1").addEventListener("click", () => doOpen(p.id, 1));
    $("#open10").addEventListener("click", () => doOpen(p.id, 10));
    $("#collect").addEventListener("click", () => { const n = G.collect(); toast(`+${n} orbs collected`, "good"); beep(660, 0.2); });
    $("#daily").addEventListener("click", () => {
      const r = G.claimDaily();
      if (r.error) toast(r.error, "bad"); else { toast(`+${r.amount} orbs · ${r.streak} day streak`, "good"); beep(523, 0.15); setTimeout(() => beep(784, 0.25), 120); }
    });
    $("#sell-dupes").addEventListener("click", () => {
      const uids = G.duplicateUids();
      if (!uids.length) return toast("No duplicates to sell");
      const value = uids.reduce((s, u) => s + G.sellValue(G.state.copies.find((c) => c.uid === u)), 0);
      if (!confirm(`Sell ${uids.length} duplicate cards for ${fmt(value)} orbs? Your best copy of each card is kept.`)) return;
      toast(`Sold ${uids.length} cards for ${fmt(G.sell(uids))} orbs`, "good");
    });
    $$(".tab").forEach((b) => b.addEventListener("click", () => { homeUI.set = b.dataset.set; renderHome(); }));
    $("#q").addEventListener("input", (ev) => { homeUI.q = ev.target.value; renderCollectionGrid(ownedMap()); });
    $("#sort").addEventListener("change", (ev) => { homeUI.sort = ev.target.value; renderCollectionGrid(ownedMap()); });
    $("#rarity").addEventListener("change", (ev) => { homeUI.rarity = ev.target.value; renderCollectionGrid(ownedMap()); });
    $$(".seg button[data-owned]").forEach((b) => b.addEventListener("click", () => { homeUI.owned = b.dataset.owned === "1"; renderHome(); }));
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
    const newest = (c) => (owned[c.id] ? Math.max(...owned[c.id].map((x) => x.at)) : 0);
    const by = {
      rarest: (a, b) => rIndex(b.rarity) - rIndex(a.rarity) || setIdx(b) - setIdx(a) || a.name.localeCompare(b.name),
      newest: (a, b) => newest(b) - newest(a),
      number: (a, b) => setIdx(a) - setIdx(b) || G.cardNumber(a) - G.cardNumber(b),
      name: (a, b) => a.name.localeCompare(b.name),
    }[sort] || (() => 0);
    return list.slice().sort(by);
  }

  function renderCollectionGrid(owned) {
    let list = filterCards(G.allCards(), homeUI);
    if (homeUI.owned) list = list.filter((c) => owned[c.id]);
    list = sortCards(list, homeUI.sort, owned);
    const grid = $("#coll-grid");
    if (!list.length) {
      grid.innerHTML = `<p class="empty">${homeUI.owned ? "No cards here yet. Open a pack!" : "No cards match."}</p>`;
      return;
    }
    grid.innerHTML = list.map((c) => {
      const copies = owned[c.id];
      return CV.render(c, copies ? bestCopy(copies) : {}, { small: true, missing: !copies, count: copies ? copies.length : 0, link: true });
    }).join("");
  }

  // ---------- PACK OPENING ----------
  function doOpen(packId, count) {
    const r = G.openPack(packId, count);
    if (r.error) { toast(r.error + (r.need ? ` (need ${fmt(r.need)} more)` : ""), "bad"); return; }
    beep(220, 0.25, "sawtooth", 0.05);
    showOpening(G.pack(packId), r.cards, count);
  }

  function showOpening(p, cards, count) {
    const modal = $("#modal");
    const bulk = count > 1;
    const best = cards.slice().sort((a, b) => rIndex(G.card(b.cardId).rarity) - rIndex(G.card(a.cardId).rarity) || (b.fullArt + b.foil) - (a.fullArt + a.foil))[0];
    const godPack = cards.every((c) => rIndex(G.card(c.cardId).rarity) >= 2);
    modal.innerHTML = `
<div class="modal-box opening">
  <div class="op-head"><h2>${esc(p.name)}${bulk ? ` ×${count}` : ""}</h2>${godPack ? `<span class="god">God pack!</span>` : ""}</div>
  <div class="op-grid ${bulk ? "bulk" : ""}">${cards.map((c, i) => `
    <div class="flip ${bulk ? "flipped" : ""}" data-i="${i}" style="--d:${i * 60}ms">
      <div class="flip-inner">
        <div class="flip-back" style="--p1:${p.colors[0]};--p2:${p.colors[1]}"><span>?</span></div>
        <div class="flip-front">${CV.render(G.card(c.cardId), c, { isNew: c.isNew })}</div>
      </div>
    </div>`).join("")}</div>
  <div class="op-summary" ${bulk ? "" : "hidden"}>
    <div>Best pull: <b style="color:${D.RARITY_INFO[G.card(best.cardId).rarity].color}">${esc(G.card(best.cardId).name)}</b> <span class="muted">by ${esc(G.card(best.cardId).creator)}</span></div>
    <div class="muted small">${cards.filter((c) => c.isNew).length} new · value ${fmt(cards.reduce((s, c) => s + G.sellValue(c), 0))} orbs</div>
  </div>
  <div class="op-actions">
    <button class="btn" id="reveal-all" ${bulk ? "hidden" : ""}>Reveal all</button>
    <button class="btn" id="sell-these">Sell duplicates from this pull</button>
    <button class="btn primary" id="again">Open again · ${fmt(p.price * count)}</button>
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
      revealSound(G.card(cards[+el.dataset.i].cardId).rarity);
      if (++revealed === cards.length) done();
    }
    $$(".flip", modal).forEach((el) => el.addEventListener("click", () => flip(el)));
    $("#reveal-all").addEventListener("click", () => $$(".flip:not(.flipped)", modal).forEach((el, i) => setTimeout(() => flip(el), i * 150)));
    $("#sell-these").addEventListener("click", () => {
      const uids = G.duplicateUids(cards.map((c) => c.uid));
      if (!uids.length) return toast("Nothing in this pull is a duplicate");
      toast(`Sold ${uids.length} for ${fmt(G.sell(uids))} orbs`, "good");
      $("#sell-these").disabled = true;
    });
    $("#again").addEventListener("click", () => { closeModal(); doOpen(p.id, count); });
    $("#close-modal").addEventListener("click", closeModal);
  }
  function closeModal() { const m = $("#modal"); m.hidden = true; m.innerHTML = ""; route(); }
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

  // ---------- CATALOG ----------
  const catUI = { set: "All", q: "", rarity: "", show: "all", page: 0, pack: "" };
  const PAGE = 35;

  function renderCatalog(params) {
    if (params.has("pack")) { catUI.pack = params.get("pack"); catUI.page = 0; }
    const owned = ownedMap();
    const counts = setCounts(owned);
    const allVariants = G.allCards().length * 4;
    const variantsOwned = Object.values(owned).reduce((s, list) => s + new Set(list.map((c) => `${c.foil}${c.fullArt}`)).size, 0);
    const packObj = catUI.pack ? G.pack(catUI.pack) : null;

    let list = filterCards(packObj ? G.packPool(packObj) : G.allCards(), catUI);
    if (catUI.show === "missing") list = list.filter((c) => !owned[c.id]);
    if (catUI.show === "owned") list = list.filter((c) => owned[c.id]);
    if (catUI.show === "fav") list = list.filter((c) => G.state.favorites.includes(c.id));
    list = sortCards(list, "number", owned);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    catUI.page = Math.min(catUI.page, pages - 1);
    const slice = list.slice(catUI.page * PAGE, catUI.page * PAGE + PAGE);

    app.innerHTML = `
<section class="cat-tiles">
  <div class="panel tile"><b>${counts.All.total ? Math.floor((counts.All.owned / counts.All.total) * 100) : 0}%</b><span>Levels · ${counts.All.owned}/${counts.All.total}</span></div>
  <div class="panel tile"><b>${Math.floor((variantsOwned / allVariants) * 100)}%</b><span>All versions · ${variantsOwned}/${allVariants}</span></div>
  <div class="panel tile"><b>${G.state.favorites.length}</b><span>Favorites</span></div>
  <div class="panel tile"><b>${fmt(G.score())}</b><span>Rarity score</span></div>
</section>
<section class="cat-layout">
  <aside class="panel cat-side">
    <h3>Sets</h3>
    ${["All"].concat(D.SET_ORDER).map((s) => { const c = counts[s]; return `<button class="side-item ${!catUI.pack && catUI.set === s ? "active" : ""}" data-set="${s}"><span>${s === "All" ? "All sets" : D.SETS[s].label}</span><small>${c.total ? Math.floor((c.owned / c.total) * 100) : 0}%</small></button>`; }).join("")}
    <h3>Packs</h3>
    ${G.packs().map((p) => { const pool = G.packPool(p); const o = pool.filter((c) => owned[c.id]).length; return `<button class="side-item ${catUI.pack === p.id ? "active" : ""}" data-pack="${p.id}"><span>${esc(p.name)}</span><small>${pool.length ? Math.floor((o / pool.length) * 100) : 0}%</small></button>`; }).join("")}
  </aside>
  <div class="panel cat-main">
    <div class="filters">
      <div class="seg">${[["all", "All"], ["missing", "Missing"], ["owned", "Owned"], ["fav", "★ Favorites"]].map(([k, l]) => `<button data-show="${k}" class="${catUI.show === k ? "active" : ""}">${l}</button>`).join("")}</div>
      <input type="search" id="cq" placeholder="Search all sets" value="${esc(catUI.q)}">
      <select id="crarity">${rarityOptions(catUI.rarity)}</select>
    </div>
    ${packObj ? `<p class="muted small">Showing cards in <b>${esc(packObj.name)}</b>.</p>` : ""}
    <div class="grid">${slice.map((c) => CV.render(c, owned[c.id] ? bestCopy(owned[c.id]) : {}, { small: true, missing: !owned[c.id], count: owned[c.id] ? owned[c.id].length : 0, link: true })).join("") || `<p class="empty">No cards match.</p>`}</div>
    <div class="pager"><button class="btn small" id="prev" ${catUI.page === 0 ? "disabled" : ""}>‹ Prev</button><span>Page ${catUI.page + 1} / ${pages}</span><button class="btn small" id="next" ${catUI.page >= pages - 1 ? "disabled" : ""}>Next ›</button></div>
  </div>
</section>`;
    $$(".side-item[data-set]").forEach((b) => b.addEventListener("click", () => { catUI.set = b.dataset.set; catUI.pack = ""; catUI.page = 0; go("#/catalog"); }));
    $$(".side-item[data-pack]").forEach((b) => b.addEventListener("click", () => { catUI.pack = b.dataset.pack; catUI.set = "All"; catUI.page = 0; go("#/catalog"); }));
    $$(".seg button[data-show]").forEach((b) => b.addEventListener("click", () => { catUI.show = b.dataset.show; catUI.page = 0; renderCatalog(new URLSearchParams()); }));
    $("#cq").addEventListener("change", (e) => { catUI.q = e.target.value; catUI.page = 0; renderCatalog(new URLSearchParams()); });
    $("#crarity").addEventListener("change", (e) => { catUI.rarity = e.target.value; catUI.page = 0; renderCatalog(new URLSearchParams()); });
    $("#prev").addEventListener("click", () => { catUI.page--; renderCatalog(new URLSearchParams()); });
    $("#next").addEventListener("click", () => { catUI.page++; renderCatalog(new URLSearchParams()); });
  }

  // ---------- CARD DETAIL ----------
  function renderCard(id) {
    const c = G.card(id);
    if (!c) { app.innerHTML = `<div class="panel"><h2>Card not found</h2><a href="#/catalog">Back to catalog</a></div>`; return; }
    const copies = G.copiesOf(c.id);
    const best = copies.length ? bestCopy(copies) : {};
    const fav = G.state.favorites.includes(c.id);
    const rar = D.RARITY_INFO[c.rarity];
    const dupes = G.duplicateUids(copies.map((x) => x.uid));
    const packsWith = G.packs().filter((p) => p.sets.includes(c.set));
    app.innerHTML = `
<a class="back" href="#/catalog">‹ Catalog</a>
<section class="detail">
  <div class="detail-card">${CV.render(c, best, { missing: !copies.length })}</div>
  <div class="panel detail-info">
    <h1>${esc(c.name)} <span class="muted">by ${esc(c.creator)}</span></h1>
    <table class="info">
      <tr><th>Set</th><td>${D.SETS[c.set].label}</td></tr>
      <tr><th>Number</th><td>${CV.code(c)}</td></tr>
      <tr><th>Rarity</th><td style="color:${rar.color}">${rar.label}</td></tr>
      <tr><th>Sell value</th><td>${rar.sell} orbs (+${D.MODIFIERS.foil.sellBonus} foil, +${D.MODIFIERS.fullArt.sellBonus} full art)</td></tr>
      <tr><th>Found in</th><td>${packsWith.map((p) => esc(p.name)).join(", ") || "Admin only"}</td></tr>
      <tr><th>Credit</th><td>Level by ${esc(c.creator)}. Geometry Dash by RobTop Games.${c.custom ? " (custom card)" : ""}</td></tr>
    </table>
    <div class="row">
      <button class="btn" id="fav">${fav ? "★ Favorited" : "☆ Favorite"}</button>
      <button class="btn" id="sell-dupe" ${dupes.length ? "" : "disabled"}>Sell ${dupes.length} duplicate${dupes.length === 1 ? "" : "s"}</button>
    </div>
    <h3>Your copies (${copies.length})</h3>
    ${copies.length ? `<ul class="copies">${copies.map((x) => `<li><span>#${x.uid}${x.foil ? " · Foil" : ""}${x.fullArt ? " · Full art" : ""}</span><span class="muted small">${new Date(x.at).toLocaleString()}</span><button class="btn small" data-sell="${x.uid}">Sell ${G.sellValue(x)}</button></li>`).join("")}</ul>` : `<p class="muted">You don't own this card yet.</p>`}
  </div>
</section>`;
    $("#fav").addEventListener("click", () => G.toggleFavorite(c.id));
    $("#sell-dupe").addEventListener("click", () => toast(`Sold for ${G.sell(dupes)} orbs`, "good"));
    $$("[data-sell]").forEach((b) => b.addEventListener("click", () => toast(`Sold for ${G.sell([+b.dataset.sell])} orbs`, "good")));
  }

  // ---------- ADMIN ----------
  function renderAdmin() {
    const st = G.state;
    const e = G.economy();
    const cards = G.allCards().slice().sort((a, b) => a.name.localeCompare(b.name));
    app.innerHTML = `
<h1>Admin <span class="muted small">changes apply only to this browser</span></h1>
<section class="admin-grid">
  <div class="panel">
    <h3>Orbs</h3>
    <p>Balance: <b>${fmt(st.orbs)}</b></p>
    <div class="row"><input type="number" id="orb-val" value="10000" min="0"><button class="btn" id="orb-set">Set</button><button class="btn" id="orb-add">Add</button></div>
    <div class="row"><button class="btn small" data-quick="1000">+1k</button><button class="btn small" data-quick="100000">+100k</button><button class="btn small" data-quick="10000000">+10M</button><button class="btn small" id="fill-pending">Fill passive</button></div>
  </div>
  <div class="panel">
    <h3>Daily & economy</h3>
    <div class="row"><button class="btn" id="reset-daily">Reset daily claim</button></div>
    <div class="row"><label>Streak <input type="number" id="streak" value="${st.daily.streak}" min="0"></label><button class="btn small" id="set-streak">Set</button></div>
    <div class="form">
      ${["perHour", "cap", "dailyBase", "dailyPerStreak", "dailyMax"].map((k) => `<label>${k}<input type="number" data-eco="${k}" value="${e[k]}" min="0"></label>`).join("")}
    </div>
    <button class="btn small" id="save-eco">Save economy</button>
  </div>
  <div class="panel">
    <h3>Grant card</h3>
    <div class="form">
      <label>Card<select id="grant-card">${cards.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.creator)} (${D.RARITY_INFO[c.rarity].label})</option>`).join("")}</select></label>
      <label>Count<input type="number" id="grant-n" value="1" min="1" max="100"></label>
      <label class="check"><input type="checkbox" id="grant-foil"> Foil</label>
      <label class="check"><input type="checkbox" id="grant-full"> Full art</label>
    </div>
    <div class="row"><button class="btn primary" id="grant">Grant</button><button class="btn" id="grant-all">Grant one of every card</button></div>
  </div>
  <div class="panel">
    <h3>Add custom card</h3>
    <div class="form">
      <label>Level name<input id="cc-name" placeholder="My Level"></label>
      <label>Creator<input id="cc-creator" placeholder="EitanAi"></label>
      <label>Set<select id="cc-set">${D.SET_ORDER.map((s) => `<option>${s}</option>`).join("")}</select></label>
      <label>Rarity<select id="cc-rarity">${D.RARITIES.map((r) => `<option value="${r}">${D.RARITY_INFO[r].label}</option>`).join("")}</select></label>
    </div>
    <button class="btn primary" id="cc-add">Add card</button>
    ${st.customCards.length ? `<ul class="copies">${st.customCards.map((c) => `<li><span>${esc(c.name)} <span class="muted">by ${esc(c.creator)} · ${c.set} · ${c.rarity}</span></span><button class="btn small" data-rm="${esc(c.id)}">Remove</button></li>`).join("")}</ul>` : ""}
  </div>
  <div class="panel wide">
    <h3>Packs</h3>
    <div class="pack-edit">${G.packs().map((p) => `
      <div class="pe" data-pe="${p.id}">
        <b>${esc(p.name)}</b>
        <label>Price<input type="number" data-k="price" value="${p.price}" min="0"></label>
        <label>Size<input type="number" data-k="size" value="${p.size}" min="1" max="20"></label>
        ${D.RARITIES.map((r) => `<label>${D.RARITY_INFO[r].label} %<input type="number" step="0.01" data-odd="${r}" value="${p.odds[r]}" min="0"></label>`).join("")}
        <div class="row"><button class="btn small primary" data-save-pack="${p.id}">Save</button><button class="btn small" data-reset-pack="${p.id}">Reset</button></div>
      </div>`).join("")}</div>
  </div>
  <div class="panel wide">
    <h3>Save data</h3>
    <div class="row"><button class="btn" id="export">Export save</button><button class="btn" id="import">Import save</button><button class="btn danger" id="clear-coll">Clear collection</button><button class="btn danger" id="wipe">Wipe everything</button></div>
    <textarea id="save-box" rows="6" placeholder="Exported save JSON appears here. Paste a save here and press Import."></textarea>
  </div>
</section>`;
    const num = (id) => +$(id).value || 0;
    $("#orb-set").addEventListener("click", () => { G.admin.setOrbs(num("#orb-val")); toast("Orbs set", "good"); });
    $("#orb-add").addEventListener("click", () => { G.admin.addOrbs(num("#orb-val")); toast("Orbs added", "good"); });
    $$("[data-quick]").forEach((b) => b.addEventListener("click", () => G.admin.addOrbs(+b.dataset.quick)));
    $("#fill-pending").addEventListener("click", () => { G.admin.fillPending(); toast("Passive orbs filled"); });
    $("#reset-daily").addEventListener("click", () => { G.admin.resetDaily(); toast("Daily can be claimed again", "good"); });
    $("#set-streak").addEventListener("click", () => { G.admin.setStreak(num("#streak")); toast("Streak set"); });
    $("#save-eco").addEventListener("click", () => {
      const v = {}; $$("[data-eco]").forEach((i) => (v[i.dataset.eco] = +i.value || 0));
      G.admin.setEconomy(v); toast("Economy saved", "good");
    });
    $("#grant").addEventListener("click", () => {
      const ok = G.admin.grant($("#grant-card").value, { foil: $("#grant-foil").checked, fullArt: $("#grant-full").checked }, Math.min(100, Math.max(1, num("#grant-n"))));
      toast(ok ? "Card granted" : "Unknown card", ok ? "good" : "bad");
    });
    $("#grant-all").addEventListener("click", () => { G.admin.grantAll(); toast("Granted every card", "good"); });
    $("#cc-add").addEventListener("click", () => {
      const name = $("#cc-name").value.trim(), creator = $("#cc-creator").value.trim();
      if (!name || !creator) return toast("Name and creator are required", "bad");
      G.admin.addCustomCard({ name, creator, set: $("#cc-set").value, rarity: $("#cc-rarity").value });
      toast("Card added", "good");
    });
    $$("[data-rm]").forEach((b) => b.addEventListener("click", () => { if (confirm("Remove this card and all copies?")) G.admin.removeCustomCard(b.dataset.rm); }));
    $$("[data-save-pack]").forEach((b) => b.addEventListener("click", () => {
      const box = $(`[data-pe="${b.dataset.savePack}"]`);
      const odds = {}; $$("[data-odd]", box).forEach((i) => (odds[i.dataset.odd] = Math.max(0, +i.value || 0)));
      G.admin.setPack(b.dataset.savePack, { price: Math.max(0, +$('[data-k="price"]', box).value || 0), size: Math.min(20, Math.max(1, +$('[data-k="size"]', box).value || 1)), odds });
      toast("Pack saved", "good");
    }));
    $$("[data-reset-pack]").forEach((b) => b.addEventListener("click", () => { G.admin.resetPack(b.dataset.resetPack); toast("Pack reset"); }));
    $("#export").addEventListener("click", () => { $("#save-box").value = G.admin.exportSave(); $("#save-box").select(); });
    $("#import").addEventListener("click", () => {
      try { G.admin.importSave($("#save-box").value); toast("Save imported", "good"); } catch (err) { toast("Import failed: " + err.message, "bad"); }
    });
    $("#clear-coll").addEventListener("click", () => { if (confirm("Delete every card you own?")) G.admin.clearCollection(); });
    $("#wipe").addEventListener("click", () => { if (confirm("Wipe the whole save and start over?")) G.admin.wipe(); });
  }

  // ---------- router ----------
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  function route() {
    const [path, query] = (location.hash.slice(1) || "/").split("?");
    const params = new URLSearchParams(query || "");
    renderHeader();
    if (!$("#modal").hidden) return; // don't redraw under the pack opening
    window.scrollTo(0, 0);
    if (path === "/catalog") renderCatalog(params);
    else if (path === "/admin") renderAdmin();
    else if (path.startsWith("/c/")) renderCard(decodeURIComponent(path.slice(3)));
    else renderHome();
  }

  // Re-render on state change, keeping scroll and focus where possible.
  G.onChange(() => {
    renderHeader();
    if (!$("#modal").hidden) return;
    const y = window.scrollY;
    const focusId = document.activeElement && document.activeElement.id;
    const [path] = (location.hash.slice(1) || "/").split("?");
    if (path === "/catalog") renderCatalog(new URLSearchParams());
    else if (path === "/admin") renderAdmin();
    else if (path.startsWith("/c/")) renderCard(decodeURIComponent(path.slice(3)));
    else renderHome();
    window.scrollTo(0, y);
    if (focusId && $("#" + focusId)) $("#" + focusId).focus();
  });

  window.addEventListener("hashchange", route);
  // Refresh the passive orb meter every 30 s on the home page.
  setInterval(() => {
    const [path] = (location.hash.slice(1) || "/").split("?");
    if ((path === "/" || path === "") && $("#modal").hidden && !document.activeElement.matches("input,select,textarea")) G.save();
  }, 30000);
  route();
})();
