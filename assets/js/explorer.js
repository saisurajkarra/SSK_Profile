// Project explorer: search + area/tech filters + sort over the project cards.
import { el, debounce } from "./util.js";
import { maturityClass } from "./drawer.js";

export function mountExplorer(root, data, { onOpen, onFilter = () => {} }) {
  const { projects, areas } = data;
  const areaBy = Object.fromEntries(areas.map((a) => [a.n, a]));
  const state = { q: "", areas: new Set(), tech: "", sort: "area" };
  const techCount = {};
  projects.forEach((p) => p.tags.forEach((t) => (techCount[t] = (techCount[t] || 0) + 1)));

  const input = el("input", { type: "search", id: "q", placeholder: `Search ${projects.length} projects · try “Rust”, “landfill”, “MPC”, “OPC-UA”…`, autocomplete: "off", "aria-label": "Search projects", spellcheck: "false" });
  const searchWrap = el("div", { class: "search" },
    el("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, el("circle", { cx: 11, cy: 11, r: 7 }), el("path", { d: "m20 20-3.5-3.5" })), input);

  const chipHost = el("div", { class: "chips", role: "group", "aria-label": "Filter by area" });
  const chips = areas.map((a) => {
    const c = el("button", { class: "chip", type: "button", "aria-pressed": "false", dataset: { n: a.n }, title: a.long }, el("span", { text: String(a.n).padStart(2, "0") + " " }), a.name);
    c.addEventListener("click", () => { state.areas.has(a.n) ? state.areas.delete(a.n) : state.areas.add(a.n); c.setAttribute("aria-pressed", String(state.areas.has(a.n))); apply(); });
    chipHost.append(c); return c;
  });

  const techSel = el("select", { "aria-label": "Filter by technology" }, el("option", { value: "", text: "Any technology" }),
    ...Object.entries(techCount).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]) => el("option", { value: t, text: `${t} (${n})` })));
  const sortSel = el("select", { "aria-label": "Sort projects" },
    el("option", { value: "area", text: "Sort: by area" }), el("option", { value: "size", text: "Sort: most sub-projects" }), el("option", { value: "name", text: "Sort: A–Z" }));
  const count = el("span", { "aria-live": "polite" });
  const clear = el("button", { class: "btn btn--sm", type: "button", text: "Clear filters", style: "display:none" });

  const grid = el("div", { class: "pgrid" });
  const empty = el("div", { class: "empty", hidden: true, text: "Nothing matches. Try fewer filters or a broader word." });

  const cards = projects.map((p) => {
    const a = areaBy[p.n];
    const shown = p.tags.slice(0, 4);
    const c = el("button", { class: "pcard", type: "button", dataset: { id: p.id }, "aria-label": `${p.name}. ${p.tagline}. Open project` },
      el("div", { class: "pc-top" }, el("span", { text: `${String(p.n).padStart(2, "0")} · ${a.name}` }), el("span", { class: "chip " + maturityClass(p.maturity), style: "padding:.1rem .45rem;font-size:10px", text: p.maturity })),
      el("h3", { text: p.name }), el("p", { text: p.tagline }),
      el("div", { class: "pc-tags" }, ...shown.map((t) => el("span", { class: "chip", text: t })), p.tags.length > 4 ? el("span", { class: "chip", text: `+${p.tags.length - 4}` }) : null),
      el("div", { class: "pc-foot" }, el("span", { text: p.subs.length ? `${p.subs.length} sub-project${p.subs.length > 1 ? "s" : ""}` : "stand-alone" }), el("span", { text: "Open project →" })));
    c.addEventListener("click", () => onOpen(p.id));
    c._p = p; c._hay = [p.name, p.tagline, a.name, a.long, p.tags.join(" "), p.what, p.subs.map((s) => s.name).join(" ")].join(" ").toLowerCase();
    return c;
  });
  grid.append(...cards, empty);

  root.replaceChildren(
    el("div", { class: "toolbar" }, searchWrap, chipHost,
      el("div", { class: "toolbar-meta" }, count, el("div", { style: "display:flex;gap:.5rem;flex-wrap:wrap;align-items:center" }, techSel, sortSel, clear))),
    grid);

  function matches(c) {
    const p = c._p;
    if (state.areas.size && !state.areas.has(p.n)) return false;
    if (state.tech && !p.tags.includes(state.tech)) return false;
    if (state.q) { const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean); if (!terms.every((t) => c._hay.includes(t))) return false; }
    return true;
  }
  let visible = projects;
  function apply() {
    const sorters = { area: (a, b) => a._p.n - b._p.n || b._p.subs.length - a._p.subs.length, size: (a, b) => b._p.subs.length - a._p.subs.length || a._p.n - b._p.n, name: (a, b) => a._p.name.localeCompare(b._p.name) };
    const ordered = [...cards].sort(sorters[state.sort]);
    let n = 0; const ids = new Set();
    ordered.forEach((c) => { const ok = matches(c); c.classList.toggle("hidden", !ok); grid.insertBefore(c, empty); if (ok) { n++; ids.add(c._p.id); } });
    visible = ordered.filter((c) => !c.classList.contains("hidden")).map((c) => c._p);
    empty.hidden = n > 0;
    const filtered = n !== projects.length;
    count.textContent = filtered ? `${n} of ${projects.length} projects` : `All ${projects.length} projects`;
    clear.style.display = filtered || state.sort !== "area" ? "" : "none";
    onFilter(filtered ? ids : null, visible);
  }
  input.addEventListener("input", debounce(() => { state.q = input.value.trim(); apply(); }, 90));
  techSel.addEventListener("change", () => { state.tech = techSel.value; apply(); });
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; apply(); });
  clear.addEventListener("click", () => { state.q = ""; input.value = ""; state.areas.clear(); chips.forEach((c) => c.setAttribute("aria-pressed", "false")); state.tech = ""; techSel.value = ""; state.sort = "area"; sortSel.value = "area"; apply(); });
  apply();

  return {
    list: () => visible,
    setTech(t) { state.tech = t; techSel.value = [...techSel.options].some((o) => o.value === t) ? t : ""; if (techSel.value !== t) { state.q = t; input.value = t; } apply(); },
    setAreas(ns) { state.areas = new Set(ns); chips.forEach((c) => c.setAttribute("aria-pressed", String(state.areas.has(+c.dataset.n)))); apply(); },
    setQuery(q) { state.q = q; input.value = q; apply(); },
    focusSearch() { input.focus(); input.select(); },
  };
}
