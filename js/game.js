// EitanGD Gacha: game state and rules. Everything is saved in this browser.
window.Game = (function () {
  const D = window.GD_DATA;
  const KEY = "eitangd-gacha-save-v1";
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;

  function freshState() {
    return {
      v: 1,
      orbs: D.ECONOMY.startOrbs,
      pending: 0,
      lastTick: Date.now(),
      daily: { last: 0, streak: 0 },
      copies: [],          // {uid, cardId, foil, fullArt, at, pack}
      recent: [],          // last pulls: {cardId, foil, fullArt, at}
      favorites: [],
      customCards: [],     // admin-added cards
      packOverrides: {},   // id -> {price, size, odds}
      economy: {},         // admin overrides of ECONOMY
      nextUid: 1,
      stats: { opened: 0 },
      muted: false,
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(freshState(), JSON.parse(raw));
    } catch (e) { /* storage blocked or corrupt */ }
    return freshState();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    listeners.forEach((fn) => fn());
  }

  const listeners = [];
  function onChange(fn) { listeners.push(fn); }

  // ---------- data access ----------
  function economy() { return Object.assign({}, D.ECONOMY, state.economy); }

  function allCards() { return D.CARDS.concat(state.customCards); }

  let cardIndex = null, cardIndexSize = -1;
  function card(id) {
    const all = allCards();
    if (!cardIndex || cardIndexSize !== all.length) {
      cardIndex = {};
      all.forEach((c) => (cardIndex[c.id] = c));
      cardIndexSize = all.length;
    }
    return cardIndex[id];
  }

  function cardNumber(c) {
    const inSet = allCards().filter((x) => x.set === c.set);
    return inSet.findIndex((x) => x.id === c.id) + 1;
  }

  function packs() {
    return D.PACKS.map((p) => {
      const o = state.packOverrides[p.id] || {};
      return Object.assign({}, p, o, { odds: Object.assign({}, p.odds, o.odds || {}) });
    });
  }
  function pack(id) { return packs().find((p) => p.id === id); }

  function packPool(p) { return allCards().filter((c) => p.sets.includes(c.set)); }

  // ---------- wallet ----------
  function tick() {
    const now = Date.now();
    const e = economy();
    const gained = ((now - state.lastTick) / HOUR) * e.perHour;
    state.pending = Math.min(e.cap, state.pending + gained);
    state.lastTick = now;
  }

  function collect() {
    tick();
    const n = Math.floor(state.pending);
    state.orbs += n;
    state.pending -= n;
    save();
    return n;
  }

  function dailyStatus() {
    const now = Date.now();
    const claimedToday = state.daily.last && sameDay(state.daily.last, now);
    const broken = state.daily.last && now - state.daily.last > 2 * DAY;
    const streak = broken ? 0 : state.daily.streak;
    const e = economy();
    const amount = Math.min(e.dailyMax, e.dailyBase + e.dailyPerStreak * streak);
    return { claimed: !!claimedToday, streak, amount };
  }

  function claimDaily() {
    const s = dailyStatus();
    if (s.claimed) return { error: "Already claimed today" };
    state.orbs += s.amount;
    state.daily = { last: Date.now(), streak: s.streak + 1 };
    save();
    return { amount: s.amount, streak: s.streak + 1 };
  }

  function sameDay(a, b) {
    const x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  // ---------- pulls ----------
  function rollRarity(odds) {
    const total = D.RARITIES.reduce((s, r) => s + (odds[r] || 0), 0);
    let x = Math.random() * total;
    for (const r of D.RARITIES) {
      x -= odds[r] || 0;
      if (x < 0) return r;
    }
    return "common";
  }

  function pickCard(pool, rarity) {
    // Use the rolled rarity; if the pack has none, step down, then up.
    const idx = D.RARITIES.indexOf(rarity);
    const order = [];
    for (let i = idx; i >= 0; i--) order.push(D.RARITIES[i]);
    for (let i = idx + 1; i < D.RARITIES.length; i++) order.push(D.RARITIES[i]);
    for (const r of order) {
      const list = pool.filter((c) => c.rarity === r);
      if (list.length) return list[Math.floor(Math.random() * list.length)];
    }
    return null;
  }

  function makeCopy(cardId, mods, packId) {
    const copy = {
      uid: state.nextUid++,
      cardId,
      foil: !!mods.foil,
      fullArt: !!mods.fullArt,
      at: Date.now(),
      pack: packId || null,
    };
    state.copies.push(copy);
    state.recent.unshift({ cardId, foil: copy.foil, fullArt: copy.fullArt, at: copy.at });
    state.recent = state.recent.slice(0, 20);
    return copy;
  }

  function openPack(packId, count) {
    count = Math.max(1, Math.min(50, count || 1));
    const p = pack(packId);
    if (!p) return { error: "Pack unavailable" };
    const pool = packPool(p);
    if (!pool.length) return { error: "This pack has no cards" };
    const cost = p.price * count;
    tick();
    if (state.orbs < cost) return { error: "Not enough orbs", need: cost - state.orbs };
    state.orbs -= cost;
    const owned = new Set(state.copies.map((c) => c.cardId));
    const cards = [];
    for (let n = 0; n < count; n++) {
      for (let i = 0; i < p.size; i++) {
        const c = pickCard(pool, rollRarity(p.odds));
        const mods = {
          foil: Math.random() * 100 < D.MODIFIERS.foil.chance,
          fullArt: Math.random() * 100 < D.MODIFIERS.fullArt.chance,
        };
        const copy = makeCopy(c.id, mods, p.id);
        cards.push(Object.assign({ isNew: !owned.has(c.id) }, copy));
        owned.add(c.id);
      }
    }
    state.stats.opened += count;
    save();
    return { cards };
  }

  // ---------- selling ----------
  function sellValue(copy) {
    const c = card(copy.cardId);
    if (!c) return 0;
    let v = D.RARITY_INFO[c.rarity].sell;
    if (copy.foil) v += D.MODIFIERS.foil.sellBonus;
    if (copy.fullArt) v += D.MODIFIERS.fullArt.sellBonus;
    return v;
  }

  function sell(uids) {
    const set = new Set(uids);
    let total = 0;
    state.copies = state.copies.filter((c) => {
      if (!set.has(c.uid)) return true;
      total += sellValue(c);
      return false;
    });
    state.orbs += total;
    save();
    return total;
  }

  // Duplicates: everything except the best copy of each card.
  function duplicateUids(onlyUids) {
    const best = {};
    const score = (c) => (c.fullArt ? 2 : 0) + (c.foil ? 1 : 0);
    state.copies.forEach((c) => {
      const b = best[c.cardId];
      if (!b || score(c) > score(b) || (score(c) === score(b) && c.uid < b.uid)) best[c.cardId] = c;
    });
    return state.copies
      .filter((c) => best[c.cardId].uid !== c.uid)
      .filter((c) => !onlyUids || onlyUids.includes(c.uid))
      .map((c) => c.uid);
  }

  function copiesOf(cardId) { return state.copies.filter((c) => c.cardId === cardId); }

  function toggleFavorite(cardId) {
    const i = state.favorites.indexOf(cardId);
    if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(cardId);
    save();
  }

  function score() {
    // Rarity score: sum of sell values of unique cards owned (best copy).
    const seen = {};
    state.copies.forEach((c) => { seen[c.cardId] = Math.max(seen[c.cardId] || 0, sellValue(c)); });
    return Object.values(seen).reduce((a, b) => a + b, 0);
  }

  // ---------- admin ----------
  const admin = {
    setOrbs(n) { state.orbs = Math.max(0, Math.floor(n)); save(); },
    addOrbs(n) { state.orbs = Math.max(0, state.orbs + Math.floor(n)); save(); },
    grant(cardId, mods, count) {
      if (!card(cardId)) return false;
      for (let i = 0; i < (count || 1); i++) makeCopy(cardId, mods || {}, "admin");
      save();
      return true;
    },
    grantAll() { allCards().forEach((c) => makeCopy(c.id, {}, "admin")); save(); },
    setPack(id, values) {
      state.packOverrides[id] = Object.assign({}, state.packOverrides[id], values);
      save();
    },
    resetPack(id) { delete state.packOverrides[id]; save(); },
    setEconomy(values) { state.economy = Object.assign({}, state.economy, values); save(); },
    fillPending() { state.pending = economy().cap; state.lastTick = Date.now(); save(); },
    resetDaily() { state.daily = { last: 0, streak: state.daily.streak }; save(); },
    setStreak(n) { state.daily.streak = Math.max(0, Math.floor(n)); save(); },
    addCustomCard(c) {
      const id = "custom-" + c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
      state.customCards.push({ id, name: c.name, creator: c.creator, set: c.set, rarity: c.rarity, custom: true });
      save();
      return id;
    },
    removeCustomCard(id) {
      state.customCards = state.customCards.filter((c) => c.id !== id);
      state.copies = state.copies.filter((c) => c.cardId !== id);
      save();
    },
    clearCollection() { state.copies = []; state.recent = []; save(); },
    wipe() { state = freshState(); save(); },
    exportSave() { return JSON.stringify(state, null, 2); },
    importSave(json) {
      const data = JSON.parse(json);
      if (typeof data !== "object" || !Array.isArray(data.copies)) throw new Error("Not a save file");
      state = Object.assign(freshState(), data);
      save();
    },
  };

  function setMuted(m) { state.muted = !!m; save(); }

  return {
    get state() { tick(); return state; },
    onChange, save, economy, allCards, card, cardNumber, packs, pack, packPool,
    collect, dailyStatus, claimDaily, openPack, sellValue, sell, duplicateUids,
    copiesOf, toggleFavorite, score, admin, setMuted,
  };
})();
