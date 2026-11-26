// EitanGD Gacha: card rendering. Art is generated in SVG from the card id (original, not copied).
window.CardView = (function () {
  const D = window.GD_DATA;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function rng(seed) {
    let s = seed || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  const artCache = {};
  function art(c) {
    if (artCache[c.id]) return artCache[c.id];
    const r = rng(hash(c.id));
    const h1 = Math.floor(r() * 360);
    const h2 = (h1 + 40 + Math.floor(r() * 120)) % 360;
    const gid = "g" + hash(c.id).toString(36);
    let shapes = "";
    // background pulse rings
    for (let i = 0; i < 3; i++) {
      const cx = Math.floor(r() * 200), cy = Math.floor(r() * 90);
      shapes += `<circle cx="${cx}" cy="${cy}" r="${20 + Math.floor(r() * 40)}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"/>`;
    }
    // obstacles on the ground line
    let x = 60;
    while (x < 190) {
      const kind = r();
      if (kind < 0.55) {
        shapes += `<polygon points="${x},110 ${x + 7},96 ${x + 14},110" fill="rgba(10,10,20,.85)" stroke="rgba(255,255,255,.55)" stroke-width="1"/>`;
        x += 16 + Math.floor(r() * 18);
      } else {
        const hgt = 12 + Math.floor(r() * 3) * 12;
        shapes += `<rect x="${x}" y="${110 - hgt}" width="12" height="${hgt}" fill="rgba(10,10,20,.8)" stroke="rgba(255,255,255,.5)" stroke-width="1"/>`;
        x += 20 + Math.floor(r() * 18);
      }
    }
    // player cube, mid jump
    const py = 70 + Math.floor(r() * 20);
    shapes += `<g transform="translate(28 ${py}) rotate(${Math.floor(r() * 4) * 22})"><rect x="-9" y="-9" width="18" height="18" rx="2" fill="hsl(${(h1 + 180) % 360} 90% 60%)" stroke="#fff" stroke-width="1.5"/><rect x="-4" y="-4" width="8" height="8" fill="rgba(0,0,0,.35)"/></g>`;
    const svg = `<svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1} 70% 45%)"/><stop offset="1" stop-color="hsl(${h2} 75% 22%)"/></linearGradient></defs>
<rect width="200" height="120" fill="url(#${gid})"/>${shapes}
<rect y="110" width="200" height="10" fill="rgba(0,0,0,.45)"/><line x1="0" y1="110" x2="200" y2="110" stroke="rgba(255,255,255,.7)" stroke-width="1"/>
</svg>`;
    artCache[c.id] = svg;
    return svg;
  }

  function code(c) {
    const n = window.Game.cardNumber(c);
    return D.SETS[c.set].code + " " + String(n).padStart(3, "0");
  }

  // copy: optional {foil, fullArt, uid}. opts: {small, missing, count, isNew, link}
  function render(c, copy, opts) {
    copy = copy || {};
    opts = opts || {};
    const set = D.SETS[c.set];
    const rar = D.RARITY_INFO[c.rarity];
    const cls = [
      "card", "r-" + c.rarity,
      copy.foil ? "foil" : "", copy.fullArt ? "full-art" : "",
      opts.small ? "small" : "", opts.missing ? "missing" : "",
    ].join(" ");
    const tags = [];
    if (copy.foil) tags.push('<span class="tag tag-foil">Foil</span>');
    if (copy.fullArt) tags.push('<span class="tag tag-full">Full art</span>');
    if (opts.isNew) tags.push('<span class="tag tag-new">New</span>');
    const tagName = opts.link ? "a" : "div";
    const href = opts.link ? ` href="#/c/${encodeURIComponent(c.id)}"` : "";
    return `<${tagName} class="${cls}"${href} style="--rc:${rar.color};--sc:${set.color}" data-card="${esc(c.id)}"${copy.uid ? ` data-uid="${copy.uid}"` : ""}>
  <div class="card-head">
    <div class="card-title"><span class="card-name">${esc(c.name)}</span><span class="card-by">by ${esc(c.creator)}</span></div>
    <span class="diff" title="${esc(set.label)}">${set.code}</span>
  </div>
  <div class="card-art">${art(c)}<span class="art-credit">Level © ${esc(c.creator)} · GD © RobTop</span>${tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}${opts.count > 1 ? `<span class="count">×${opts.count}</span>` : ""}</div>
  <div class="card-foot"><span class="code">${code(c)}</span><span class="rar">${rar.label}</span></div>
</${tagName}>`;
  }

  return { render, esc, code, art };
})();
