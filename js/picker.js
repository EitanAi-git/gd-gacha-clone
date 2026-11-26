// EitanGD Gacha: custom searchable dropdown that replaces native <select>.
// Picker.create({ items:[{value,label,sub,color}], value, placeholder, onChange, search:true }) -> element
window.Picker = (function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let openOne = null;
  let uid = 0;

  document.addEventListener("mousedown", (e) => {
    if (openOne && !openOne.el.contains(e.target)) openOne.close();
  });

  function create(opts) {
    const id = "pk" + ++uid;
    let items = opts.items || [];
    let value = opts.value;
    let filtered = items;
    let active = 0;
    const search = opts.search !== false && items.length > 7;

    const el = document.createElement("div");
    el.className = "picker" + (opts.className ? " " + opts.className : "");
    el.innerHTML = `
      <button type="button" class="picker-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list">
        <span class="picker-val"></span><span class="picker-caret" aria-hidden="true">▾</span>
      </button>
      <div class="picker-pop" hidden>
        ${search ? `<input class="picker-search" type="search" placeholder="Search…" aria-label="Search" autocomplete="off">` : ""}
        <ul class="picker-list" id="${id}-list" role="listbox" tabindex="-1"></ul>
      </div>`;
    const btn = el.querySelector(".picker-btn");
    const pop = el.querySelector(".picker-pop");
    const input = el.querySelector(".picker-search");
    const list = el.querySelector(".picker-list");

    function label() {
      const it = items.find((i) => i.value === value);
      el.querySelector(".picker-val").innerHTML = it
        ? `${it.color ? `<i class="dot" style="background:${esc(it.color)}"></i>` : ""}${esc(it.label)}`
        : `<span class="muted">${esc(opts.placeholder || "Choose…")}</span>`;
    }
    function renderList() {
      const q = input ? input.value.trim().toLowerCase() : "";
      filtered = q ? items.filter((i) => (i.label + " " + (i.sub || "")).toLowerCase().includes(q)) : items;
      active = Math.max(0, Math.min(active, filtered.length - 1));
      const shown = filtered.slice(0, 300);
      list.innerHTML = shown.length ? shown.map((it, i) => `
        <li role="option" data-i="${i}" aria-selected="${it.value === value}" class="${i === active ? "active" : ""} ${it.value === value ? "sel" : ""}">
          ${it.color ? `<i class="dot" style="background:${esc(it.color)}"></i>` : ""}
          <span class="pl">${esc(it.label)}</span>${it.sub ? `<span class="ps">${esc(it.sub)}</span>` : ""}
        </li>`).join("") + (filtered.length > 300 ? `<li class="more">${filtered.length - 300} more, so type to narrow</li>` : "")
        : `<li class="none">No matches</li>`;
    }
    function scrollActive() {
      const a = list.querySelector("li.active");
      if (a) a.scrollIntoView({ block: "nearest" });
    }
    function open() {
      if (openOne && openOne !== api) openOne.close();
      openOne = api;
      pop.hidden = false;
      el.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      active = Math.max(0, items.findIndex((i) => i.value === value));
      if (input) input.value = "";
      renderList();
      (input || list).focus();
      scrollActive();
    }
    function close() {
      pop.hidden = true;
      el.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      if (openOne === api) openOne = null;
    }
    function choose(it) {
      if (!it) return;
      value = it.value;
      label();
      close();
      btn.focus();
      if (opts.onChange) opts.onChange(value, it);
    }

    btn.addEventListener("click", () => (pop.hidden ? open() : close()));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    if (input) input.addEventListener("input", () => { active = 0; renderList(); });
    (input || list).addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(filtered.length - 1, active + 1); renderList(); scrollActive(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); renderList(); scrollActive(); }
      else if (e.key === "Enter") { e.preventDefault(); choose(filtered[active]); }
      else if (e.key === "Escape") { e.preventDefault(); close(); btn.focus(); }
      else if (e.key === "Tab") close();
    });
    list.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) choose(filtered[+li.dataset.i]);
    });

    const api = {
      el, open, close,
      get value() { return value; },
      set value(v) { value = v; label(); },
      setItems(next) { items = next || []; label(); if (!pop.hidden) renderList(); },
    };
    label();
    return api;
  }

  return { create };
})();
