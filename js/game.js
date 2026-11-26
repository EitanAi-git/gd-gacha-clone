// EitanGD Gacha: client-side cache of server state. Nothing here is trusted. The server
// checks every action, and this file only remembers what the server last said.
window.Game = (function () {
  const D = window.GD_DATA;
  const A = window.API;
  let catalog = { cards: [], packs: [], raritySell: {}, modifiers: {}, economy: {} };
  let me = null;
  let cardIndex = {};
  let numbers = {};
  const listeners = [];

  function emit() { listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }
  function onChange(fn) { listeners.push(fn); }

  function indexCards() {
    cardIndex = {}; numbers = {};
    const perSet = {};
    catalog.cards.forEach((c) => {
      cardIndex[c.id] = c;
      perSet[c.set] = (perSet[c.set] || 0) + 1;
      numbers[c.id] = perSet[c.set];
    });
  }

  async function loadCatalog() {
    catalog = await A.rpc("get_catalog");
    indexCards();
    emit();
  }
  async function refresh() {
    me = await A.rpc("get_state");
    emit();
    return me;
  }
  function clear() { me = null; emit(); }

  // ---------- BigInt helpers (orbs and quantities can exceed JS number precision) ----------
  const big = (v) => { try { return BigInt(v || 0); } catch (e) { return 0n; } };
  const fmt = (v) => big(v).toLocaleString("en-US");

  // ---------- reads ----------
  const allCards = () => catalog.cards.filter((c) => c.enabled !== false);
  const card = (id) => cardIndex[id];
  const cardNumber = (c) => numbers[c.id] || 0;
  const packs = () => catalog.packs;
  const pack = (id) => catalog.packs.find((p) => p.id === id);
  const packPool = (p) => allCards().filter((c) => p.sets.includes(c.set));

  function sellValue(row) {
    const c = card(row.card);
    if (!c) return 0n;
    let v = big(c.sell);
    const m = catalog.modifiers || {};
    if (row.foil) v += big(m.foil && m.foil.bonus);
    if (row.fullArt) v += big(m.fullArt && m.fullArt.bonus);
    return v;
  }

  // card id -> [{card, foil, fullArt, qty, at}]
  function ownedMap() {
    const map = {};
    (me ? me.collection : []).forEach((r) => { (map[r.card] = map[r.card] || []).push(r); });
    return map;
  }
  const rowsCount = (rows) => rows.reduce((s, r) => s + big(r.qty), 0n);
  const rank = (r) => (r.fullArt ? 2 : 0) + (r.foil ? 1 : 0);
  const bestRow = (rows) => rows.slice().sort((a, b) => rank(b) - rank(a))[0];

  // ---------- actions (all server-side) ----------
  async function act(name, args) {
    const r = await A.rpc(name, args);
    await refresh();
    return r;
  }
  const openPack = async (packId, count) => {
    const p = pack(packId);
    const r = await A.rpc("open_pack", { p_pack: packId, p_count: count, p_expected_price: p.price });
    await refresh();
    return r;
  };
  const collect = () => act("collect_orbs");
  const claimDaily = () => act("claim_daily");
  const sell = (items) => act("sell", { p_items: items });
  const sellDuplicates = (cards) => act("sell_duplicates", { p_cards: cards || null });
  const toggleFavorite = (id) => act("toggle_favorite", { p_card: id });

  return {
    get catalog() { return catalog; }, get me() { return me; },
    set me(v) { me = v; emit(); },
    onChange, emit, loadCatalog, refresh, clear,
    big, fmt, allCards, card, cardNumber, packs, pack, packPool, sellValue, ownedMap, rowsCount, bestRow, rank,
    openPack, collect, claimDaily, sell, sellDuplicates, toggleFavorite,
    D,
  };
})();
