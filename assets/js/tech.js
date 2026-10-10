// Technology map: projects sit in the centre, technologies gather by category; hover to light up connections.
import { el, clamp, tip, onResize, onVisible, reduceMotion } from "./util.js";

const d3 = window.d3;
const CAT_VARS = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7"];

export function mountTech(root, data, { onTech = () => {}, onProject = () => {} } = {}) {
  const { projects, tech, techCats, areas } = data;
  const catColor = (cat) => `var(${CAT_VARS[techCats.indexOf(cat) % CAT_VARS.length]})`;
  const counts = {};
  projects.forEach((p) => p.tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  const techs = Object.entries(counts).filter(([, n]) => n >= 2).map(([name, n]) => ({ id: "t:" + name, kind: "tech", name, n, cat: tech[name] }));
  const keep = new Set(techs.map((t) => t.name));
  const projNodes = projects.filter((p) => p.tags.some((t) => keep.has(t))).map((p) => ({ id: p.id, kind: "proj", name: p.name, p, n: p.n }));
  const links = [];
  projects.forEach((p) => p.tags.filter((t) => keep.has(t)).forEach((t) => links.push({ source: p.id, target: "t:" + t })));
  const nodes = [...techs, ...projNodes];

  let activeCat = null, selected = null, W = 0;
  const host = el("div", { class: "constel" });
  const catLegend = el("div", { class: "cat-legend", role: "group", "aria-label": "Technology categories" },
    ...techCats.map((c) => { const b = el("button", { class: "chip", type: "button", "aria-pressed": "false", dataset: { c } }, el("i", { style: `background:${catColor(c)}` }), c); b.addEventListener("click", () => { activeCat = activeCat === c ? null : c; catLegend.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.c === activeCat))); applyHighlight(); renderBars(); }); return b; }));
  const barsHost = el("div", { class: "panel bars-card" });
  const tableHost = el("div", { class: "tbl-wrap", hidden: true });
  const toggleTable = el("button", { class: "btn btn--sm", type: "button", text: "View as table", "aria-expanded": "false" });
  const note = el("p", { class: "lab-note", text: "Bars show how many projects use each technology. Rust, for example, powers a 175,000-line trading platform." });

  root.replaceChildren(el("div", { class: "tech-grid" },
    el("div", { style: "display:grid;gap:.9rem;min-width:0" }, catLegend, host, el("div", { class: "lab-foot" }, toggleTable), tableHost),
    el("div", { style: "display:grid;gap:1rem;align-content:start;min-width:0" }, barsHost, note)));

  const svg = d3.select(host).append("svg").attr("role", "img").attr("aria-label", "Network of technologies and the projects that use them");
  const gC = svg.append("g"), gL = svg.append("g"), gP = svg.append("g"), gT = svg.append("g");
  let sim, linkSel, projSel, techSel, catLabels, catCenter, dims = { w: 800, h: 660 };

  function build() {
    svg.attr("viewBox", `0 0 ${dims.w} ${dims.h}`);
    const rT = (n) => 7 + Math.sqrt(n) * 3.1;
    nodes.forEach((n) => { n.x = dims.w / 2 + (Math.random() - 0.5) * 80; n.y = dims.h / 2 + (Math.random() - 0.5) * 80; });
    const L = links.map((l) => ({ ...l }));
    linkSel = gL.selectAll("line").data(L).join("line").attr("class", "t-link");
    projSel = gP.selectAll("g").data(projNodes).join("g").attr("class", "t-proj").attr("tabindex", 0).attr("role", "button").attr("aria-label", (d) => `Project ${d.name}`)
      .on("click", (e, d) => onProject(d.id)).on("keydown", (e, d) => { if (e.key === "Enter") onProject(d.id); })
      .on("pointerenter", (e, d) => { hl(d); }).on("pointerleave", () => hl(null))
      .on("pointermove", (e, d) => tip.show(tip.rows(d.name, `${String(d.n).padStart(2, "0")} · ${areas.find((a) => a.n === d.n).name}`, [{ label: "Technologies", value: d.p.tags.filter((t) => keep.has(t)).length }]), e.clientX, e.clientY));
    projSel.append("circle").attr("r", 3.6); projSel.append("circle").attr("r", 9).attr("fill", "transparent").style("fill-opacity", 0);
    techSel = gT.selectAll("g").data(techs).join("g").attr("class", "t-node").attr("tabindex", 0).attr("role", "button").attr("aria-label", (d) => `${d.name}, used in ${d.n} projects`)
      .on("click", (e, d) => { selected = selected === d.name ? null : d.name; applyHighlight(); renderBars(); if (selected) onTech(d.name, false); })
      .on("keydown", (e, d) => { if (e.key === "Enter") { selected = selected === d.name ? null : d.name; applyHighlight(); renderBars(); } })
      .on("pointerenter", (e, d) => hl(d)).on("pointerleave", () => hl(null))
      .on("pointermove", (e, d) => tip.show(tip.rows(d.name, d.cat, [{ label: "Projects", value: d.n }]), e.clientX, e.clientY));
    techSel.append("circle").attr("r", (d) => rT(d.n)).attr("fill", (d) => catColor(d.cat));
    techSel.append("text").attr("dy", (d) => rT(d.n) + 12).attr("text-anchor", "middle").text((d) => d.name).style("display", (d) => (d.n >= 5 || dims.w > 700 && d.n >= 3 ? null : "none")).attr("class", "t-lab");

    sim?.stop();
    // category anchors on an ellipse; technologies gather at their category, projects sit in the middle
    const cx = dims.w / 2, cy = dims.h / 2, rx = dims.w * 0.31, ry = dims.h * 0.29;
    const anchor = Object.fromEntries(techCats.map((c, i) => { const a = -Math.PI / 2 + (i / techCats.length) * Math.PI * 2; return [c, { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, a }]; }));
    catLabels = gC.selectAll("text").data(techCats).join("text").attr("class", "t-cat").text((c) => c.toUpperCase()).style("fill", (c) => catColor(c));
    catCenter = { x: cx, y: cy };
    const lowN = dims.w < 560 ? 6 : 4;
    sim = d3.forceSimulation([...techs, ...projNodes])
      .force("link", d3.forceLink(L).id((d) => d.id).strength(0))
      .force("charge", d3.forceManyBody().strength((d) => (d.kind === "tech" ? -26 : -9)))
      .force("collide", d3.forceCollide((d) => (d.kind === "tech" ? rT(d.n) + 7 : 5.5)).strength(0.9))
      .force("x", d3.forceX((d) => (d.kind === "tech" ? anchor[d.cat].x : cx)).strength((d) => (d.kind === "tech" ? 0.16 : 0.07)))
      .force("y", d3.forceY((d) => (d.kind === "tech" ? anchor[d.cat].y : cy)).strength((d) => (d.kind === "tech" ? 0.16 : 0.07)))
      .alphaDecay(0.025).on("tick", tick);
    techSel.select("text").style("display", (d) => (d.n >= lowN ? null : "none"));
    if (reduceMotion()) { sim.stop(); for (let i = 0; i < 300; i++) sim.tick(); tick(); }
    // drag techs
    techSel.call(d3.drag().on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = clamp(e.x, 20, dims.w - 20); d.fy = clamp(e.y, 20, dims.h - 20); }).on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = d.fy = null; }));
    applyHighlight();
  }
  function tick() {
    const pad = 16;
    nodes.forEach((n) => { n.x = clamp(n.x, pad, dims.w - pad); n.y = clamp(n.y, pad, dims.h - pad); });
    linkSel.attr("x1", (l) => l.source.x).attr("y1", (l) => l.source.y).attr("x2", (l) => l.target.x).attr("y2", (l) => l.target.y);
    projSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    techSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    placeCatLabels();
  }
  function placeCatLabels() {
    if (!catLabels) return;
    catLabels.each(function (c) {
      const mem = techs.filter((t) => t.cat === c); if (!mem.length) return;
      const mx = d3.mean(mem, (t) => t.x), top = d3.min(mem, (t) => t.y - 7 - Math.sqrt(t.n) * 3.1), bot = d3.max(mem, (t) => t.y + 7 + Math.sqrt(t.n) * 3.1 + 14);
      const half = c.length * 4.2 + 6;
      const above = top - 8, below = bot + 12;
      const preferAbove = d3.mean(mem, (t) => t.y) < catCenter.y;
      let ly = preferAbove ? (above >= 16 ? above : below) : (below <= dims.h - 6 ? below : above);
      ly = clamp(ly, 14, dims.h - 6);
      d3.select(this).attr("x", clamp(mx, half, dims.w - half)).attr("y", ly).attr("text-anchor", "middle");
    });
  }

  let hovered = null;
  function hl(d) { hovered = d; applyHighlight(); }
  function applyHighlight() {
    const focus = hovered || (selected ? techs.find((t) => t.name === selected) : null);
    const catOK = (t) => !activeCat || t.cat === activeCat;
    if (!linkSel) return;
    const nb = new Set();
    if (focus) linkSel.each((l) => { if (l.source.id === focus.id || l.target.id === focus.id) { nb.add(l.source.id); nb.add(l.target.id); } });
    linkSel.classed("hl", (l) => !!focus && (l.source.id === focus.id || l.target.id === focus.id))
      .style("opacity", (l) => (focus ? (l.source.id === focus.id || l.target.id === focus.id ? 1 : 0.02) : activeCat ? (catOK(l.target) ? 0.35 : 0.01) : 0.1));
    techSel.classed("t-dim", (d) => (focus ? !nb.has(d.id) && d.id !== focus.id : !catOK(d))).classed("t-hl", (d) => !!focus && (nb.has(d.id) || d.id === focus.id));
    techSel.select("text").style("display", (d) => (focus ? (nb.has(d.id) || d.id === focus.id ? null : "none") : d.n >= (dims.w < 560 ? 6 : 4) ? null : "none"));
    projSel.classed("t-dim", (d) => (focus ? !nb.has(d.id) : activeCat ? !d.p.tags.some((t) => tech[t] === activeCat) : false)).classed("t-hl", (d) => !!focus && nb.has(d.id));
  }

  function renderBars() {
    const rows = techs.filter((t) => !activeCat || t.cat === activeCat).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 16);
    const max = d3.max(rows, (r) => r.n) || 1;
    barsHost.replaceChildren(el("h4", { text: activeCat ? `Top in ${activeCat}` : "Most-used technologies" }),
      ...rows.map((r) => {
        const b = el("button", { class: "bar-row" + (selected === r.name ? " on" : ""), type: "button", "aria-label": `${r.name}: ${r.n} projects` },
          el("span", { class: "nm", text: r.name }), el("span", { class: "tr" }, el("i", { style: `width:${(r.n / max) * 100}%;background:${catColor(r.cat)}` })), el("span", { class: "v", text: r.n }));
        b.addEventListener("click", () => { selected = selected === r.name ? null : r.name; applyHighlight(); renderBars(); if (selected) onTech(r.name, true); });
        b.addEventListener("pointermove", (e) => tip.show(tip.rows(r.name, r.cat, [{ label: "Projects", value: `${r.n} of ${projects.length}` }]), e.clientX, e.clientY));
        b.addEventListener("pointerleave", () => tip.hide());
        return b;
      }));
  }
  function renderTable() {
    const th = (t) => el("th", { text: t });
    tableHost.replaceChildren(el("table", { class: "data" }, el("thead", {}, el("tr", {}, ["Technology", "Category", "Projects"].map(th))),
      el("tbody", {}, Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]) => el("tr", {}, [t, tech[t], n].map((v) => el("td", { text: String(v) })))))));
  }
  toggleTable.addEventListener("click", () => { const show = tableHost.hidden; tableHost.hidden = !show; toggleTable.textContent = show ? "Hide table" : "View as table"; toggleTable.setAttribute("aria-expanded", String(show)); });

  onResize(host, (w) => { W = w; const h = w < 560 ? Math.round(w * 1.1) : Math.round(w * 0.78); if (Math.abs(w - dims.w) > 30 || Math.abs(h - dims.h) > 30 || !sim) { dims = { w, h }; build(); } });
  onVisible(host, (v) => { if (!sim) return; v ? sim.alpha(0.05).restart() : sim.stop(); }, { threshold: 0 });
  renderBars(); renderTable();
  return { select(name) { selected = name; applyHighlight(); renderBars(); } };
}
