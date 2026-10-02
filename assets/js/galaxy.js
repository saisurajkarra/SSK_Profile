// Project Galaxy — force-directed map of the project portfolio.
// Air separation sits at the centre; each area is a numbered "instrument bubble" on a ring; projects orbit their area.
import { el, clamp, tip, reduceMotion, onResize, onVisible } from "./util.js";

const d3 = window.d3;
const VW = 1000, VH = 920, CX = VW / 2, CY = VH / 2;
const RING_ORDER = [11, 6, 7, 8, 5, 4, 3, 9, 10];          // clockwise from the top
const short = (s, n = 26) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export function mountGalaxy(host, data, { onSelect = () => {}, onFocus = () => {} } = {}) {
  const { areas, projects } = data;
  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${VW} ${VH}`).attr("role", "group")
    .attr("aria-label", `Map of ${projects.length} projects in ${areas.length} areas, with air separation at the centre`);
  const root = svg.append("g").attr("class", "g-root");
  const gGuides = root.append("g"), gSpokes = root.append("g"), gHulls = root.append("g"), gLinks = root.append("g"),
    gSubs = root.append("g").attr("class", "g-subs"), gNodes = root.append("g"), gHubs = root.append("g"), gLabels = root.append("g").style("pointer-events", "none");

  // ----- hub positions -----
  const hubs = areas.map((a) => {
    let x = CX, y = CY;
    if (a.n === 2) { x = CX + 175; y = CY - 120; }
    else if (a.n !== 1) {
      const i = RING_ORDER.indexOf(a.n), ang = -Math.PI / 2 + (i / RING_ORDER.length) * Math.PI * 2;
      x = CX + Math.cos(ang) * 350; y = CY + Math.sin(ang) * 330;
    }
    return { ...a, x, y, count: 0 };
  });
  const hubBy = Object.fromEntries(hubs.map((h) => [h.n, h]));

  // ----- nodes -----
  const maxSubs = d3.max(projects, (p) => 1 + p.subs.length);
  let rScale = 1;
  const rOf = (p) => (5 + 8.5 * Math.sqrt((1 + p.subs.length) / maxSubs)) * rScale;
  const nodes = projects.map((p) => { const h = hubBy[p.n]; h.count++; return { ...p, hub: h, r: 0, x: CX + (Math.random() - 0.5) * 20, y: CY + (Math.random() - 0.5) * 20 }; });
  const ASU = nodes.find((n) => n.n === 1);

  // sub-project satellites for the central ASU twin
  const subs = ASU ? ASU.subs.map((s, i, arr) => ({ ...s, ang: (i / arr.length) * Math.PI * 2 - Math.PI / 2 })) : [];

  // ----- static layers -----
  gGuides.append("ellipse").attr("cx", CX).attr("cy", CY).attr("rx", 350).attr("ry", 330).attr("fill", "none").attr("stroke", "var(--rule)").attr("stroke-width", 1);
  gGuides.append("circle").attr("cx", CX).attr("cy", CY).attr("r", 205).attr("fill", "none").attr("stroke", "var(--rule)").attr("stroke-width", 1);
  hubs.filter((h) => h.n !== 1).forEach((h) => {
    const mx = (CX + h.x) / 2, my = (CY + h.y) / 2, nx = -(h.y - CY), ny = h.x - CX, nl = Math.hypot(nx, ny) || 1;
    const bend = h.n === 2 ? 0 : 38;
    gSpokes.append("path").attr("class", "g-spoke").attr("d", `M${CX},${CY} Q${mx + (nx / nl) * bend},${my + (ny / nl) * bend} ${h.x},${h.y}`);
  });

  const hullG = gHulls.selectAll("path").data(hubs.filter((h) => h.n !== 1)).join("path").attr("class", "g-hull");
  const linkSel = gLinks.selectAll("line").data(nodes.filter((n) => n.n !== 1)).join("line").attr("class", "g-link");
  const subSel = gSubs.selectAll("g").data(subs).join("g").attr("class", "g-sub");
  subSel.append("line").attr("stroke", "var(--accent)").attr("stroke-opacity", 0.25);
  subSel.append("circle").attr("r", 3.2).attr("fill", "var(--accent)").attr("fill-opacity", 0.7).attr("stroke", "var(--surface)").attr("stroke-width", 1);
  subSel.append("circle").attr("r", 10).attr("fill", "transparent").style("cursor", "pointer")
    .on("pointermove", (e, s) => { if (e.pointerType !== "touch") tip.show(tip.rows(s.name, "Sub-project · ASU Digital Twin", []), e.clientX, e.clientY); })
    .on("pointerleave", () => tip.hide())
    .on("click", () => { tip.hide(); onSelect(ASU.id); });

  const nodeSel = gNodes.selectAll("g").data(nodes).join("g").attr("class", (d) => "g-node" + (d.n <= 2 ? " core" : ""))
    .attr("tabindex", 0).attr("role", "button").attr("aria-label", (d) => `${d.name}, ${d.hub.name}. Open project`)
    .on("keydown", (e, d) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(d.id); } })
    .on("click", (e, d) => { tip.hide(); onSelect(d.id); })
    .on("pointerenter", (e, d) => { if (e.pointerType !== "touch") spotlight(d.n); })
    .on("pointermove", (e, d) => { if (e.pointerType !== "touch") showTip(e, d); })
    .on("pointerleave", () => { tip.hide(); spotlight(null); })
    .on("focus", (e, d) => { const b = e.target.getBoundingClientRect(); tip.show(tipContent(d), b.left + b.width / 2, b.top); spotlight(d.n); })
    .on("blur", () => { tip.hide(); spotlight(null); });
  nodeSel.append("circle").attr("class", "dot");
  nodeSel.append("circle").attr("class", "hit").attr("fill", "transparent");

  const hubSel = gHubs.selectAll("g").data(hubs).join("g").attr("class", (d) => "g-hub" + (d.n === 1 ? " core" : ""))
    .attr("tabindex", 0).attr("role", "button").attr("aria-label", (d) => `Area ${d.n}: ${d.name}, ${d.count} project${d.count > 1 ? "s" : ""}. Zoom in`)
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .on("click", (e, d) => focus(focused === d.n ? null : d.n))
    .on("keydown", (e, d) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focus(focused === d.n ? null : d.n); } })
    .on("pointerenter", (e, d) => { if (e.pointerType !== "touch") { tip.show(tip.rows(d.name, `Area ${String(d.n).padStart(2, "0")}`, [{ label: "Projects", value: d.count }]), e.clientX, e.clientY); spotlight(d.n); } })
    .on("pointermove", (e, d) => { if (e.pointerType !== "touch") tip.show(tip.rows(d.name, `Area ${String(d.n).padStart(2, "0")}`, [{ label: "Projects", value: d.count }]), e.clientX, e.clientY); })
    .on("pointerleave", () => { tip.hide(); spotlight(null); });
  hubSel.append("circle").attr("class", "ring").attr("r", (d) => (d.n === 1 ? 30 : 17));
  hubSel.filter((d) => d.n === 1).append("circle").attr("class", "badge").attr("cy", -30).attr("r", 12);
  hubSel.append("text").text((d) => String(d.n).padStart(2, "0")).attr("y", (d) => (d.n === 1 ? -30 : 0)).style("font-size", "11px");
  const labelSel = gLabels.selectAll("text").data(hubs).join("text").attr("class", "g-label").text((d) => (d.n === 1 ? "AIR SEPARATION" : d.n === 2 ? "" : short(d.name, 30)));

  // ----- tooltips -----
  const tipContent = (d) => tip.rows(d.name, `${String(d.n).padStart(2, "0")} · ${d.hub.name}`, [{ label: d.maturity, value: "" }]).concat([el("span", { style: "display:block;margin-top:.3rem;opacity:.85", text: d.tagline })]);
  const showTip = (e, d) => tip.show(tipContent(d), e.clientX, e.clientY);

  // ----- simulation -----
  const sim = d3.forceSimulation(nodes).alphaDecay(0.018).velocityDecay(0.3)
    .force("x", d3.forceX((d) => (d.n === 1 ? CX : d.hub.x)).strength((d) => (d.n === 1 ? 0.3 : 0.22)))
    .force("y", d3.forceY((d) => (d.n === 1 ? CY : d.hub.y)).strength((d) => (d.n === 1 ? 0.3 : 0.22)))
    .force("collide", d3.forceCollide((d) => d.r + 2.4).strength(0.9))
    .force("charge", d3.forceManyBody().strength(-6))
    .force("pointer", pointerForce())
    .on("tick", paint);

  let pointer = null;
  function pointerForce() {
    const f = (alpha) => {
      if (!pointer) return;
      for (const n of nodes) {
        const dx = n.x - pointer[0], dy = n.y - pointer[1], d2 = dx * dx + dy * dy, R = 90;
        if (d2 < R * R && d2 > 0.01) { const d = Math.sqrt(d2), k = ((R - d) / R) * 3.2; n.vx += (dx / d) * k; n.vy += (dy / d) * k; }
      }
    };
    f.initialize = () => {};
    return f;
  }

  function setRadii() {
    nodes.forEach((n) => (n.r = rOf(n)));
    nodeSel.select(".dot").attr("r", (d) => d.r);
    nodeSel.select(".hit").attr("r", (d) => Math.max(d.r + 6, 13 * rScale));
    sim.force("collide").initialize(nodes);
  }

  function paint() {
    // hub-to-project links
    linkSel.attr("x1", (d) => d.hub.x).attr("y1", (d) => d.hub.y).attr("x2", (d) => d.x).attr("y2", (d) => d.y);
    nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    // hulls
    hullG.attr("d", (h) => {
      const pts = nodes.filter((n) => n.n === h.n).flatMap((n) => d3.range(8).map((i) => [n.x + Math.cos((i / 8) * 6.283) * (n.r + 14), n.y + Math.sin((i / 8) * 6.283) * (n.r + 14)]));
      const hull = d3.polygonHull(pts.concat([[h.x + 22, h.y], [h.x - 22, h.y], [h.x, h.y + 22], [h.x, h.y - 22]]));
      return hull ? d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6))(hull) : null;
    });
    paintSubs();
    labelSel.attr("x", (d) => d.x).attr("y", (d) => d.y + (d.n === 1 ? 46 : d.y < CY ? -28 : 34))
      .attr("text-anchor", "middle").style("font-size", labelSize + "px").style("font-weight", (d) => (d.n === 1 ? 650 : 500));
  }

  function paintSubs() {
    // ASU satellites orbit the central node
    if (ASU) {
      const t = performance.now() / 1000, rot = reduceMotion() ? 0 : t * 0.045, orb = ASU.r + 34;
      subSel.each(function (s) {
        const a = s.ang + rot, sx = ASU.x + Math.cos(a) * orb, sy = ASU.y + Math.sin(a) * orb;
        const g = d3.select(this); g.attr("transform", `translate(${sx},${sy})`);
        g.select("line").attr("x1", ASU.x - sx).attr("y1", ASU.y - sy).attr("x2", 0).attr("y2", 0);
      });
    }
  }

  // keep satellites moving while idle (cheap: only transforms)
  let raf = 0, visible = true;
  function idle() { if (visible && !reduceMotion() && sim.alpha() < sim.alphaMin() + 0.001) paintSubs(); raf = requestAnimationFrame(idle); }

  // ----- focus / zoom -----
  let focused = null, labelSize = 12, pxW = VW, k = 1;
  const tf = { x: 0, y: 0, k: 1 };
  function applyTransform(animate) {
    const sel = animate && !reduceMotion() ? root.transition().duration(850).ease(d3.easeCubicInOut) : root;
    sel.attr("transform", `translate(${tf.x},${tf.y}) scale(${tf.k})`);
    k = tf.k;
    labelSize = (11.5 * (VW / pxW)) / k;
    nodeSel.select(".dot").attr("stroke-width", 1.5 / k);
    svg.classed("zoomed", k > 1.2);
    gLabels.selectAll(".p-label").remove();
    if (focused != null && k > 1.2) {
      const fs = (10.5 * (VW / pxW)) / k;
      gLabels.selectAll(".p-label").data(nodes.filter((n) => n.n === focused)).join("text").attr("class", "g-label p-label")
        .attr("x", (d) => d.x).attr("y", (d) => d.y + d.r + fs + 2).attr("text-anchor", "middle").style("font-size", fs + "px").text((d) => short(d.name, 22));
    }
    paint();
  }
  function focus(n) {
    focused = n; tip.hide();
    hubSel.classed("active", (d) => d.n === n);
    if (n == null) { tf.x = 0; tf.y = 0; tf.k = 1; }
    else {
      const mem = nodes.filter((d) => d.n === n), h = hubBy[n];
      const xs = mem.map((d) => d.x).concat([h.x]), ys = mem.map((d) => d.y).concat([h.y]);
      const pad = 90, x0 = d3.min(xs) - pad, x1 = d3.max(xs) + pad, y0 = d3.min(ys) - pad, y1 = d3.max(ys) + pad;
      const kk = clamp(Math.min(VW / (x1 - x0), VH / (y1 - y0)), 1, 3.4);
      tf.k = kk; tf.x = VW / 2 - ((x0 + x1) / 2) * kk; tf.y = VH / 2 - ((y0 + y1) / 2) * kk;
    }
    applyTransform(true);
    // re-add project labels after the transition begins so they land with the zoom
    onFocus(n);
  }
  function spotlight(n) {
    const hold = focused ?? n;
    nodeSel.classed("dim", (d) => hold != null && d.n !== hold);
    linkSel.style("opacity", (d) => (hold != null && d.n !== hold ? 0.15 : null));
    hullG.style("opacity", (h) => (hold != null && h.n !== hold ? 0.3 : null));
  }
  function highlight(ids) {
    nodeSel.classed("dim", (d) => ids != null && !ids.has(d.id));
  }
  function select(id) { nodeSel.classed("sel", (d) => d.id === id); }

  // ----- pointer force (desktop only) -----
  svg.on("pointermove", (e) => {
    if (e.pointerType === "touch" || reduceMotion() || focused != null) return;
    const r = svg.node().getBoundingClientRect(), sx = VW / r.width;
    pointer = [(e.clientX - r.left) * sx, (e.clientY - r.top) * sx];
    sim.alphaTarget(0.18).restart();
  }).on("pointerleave", () => { pointer = null; sim.alphaTarget(0); });
  svg.on("click", (e) => { if (e.target === svg.node()) focus(null); });

  // ----- sizing / lifecycle -----
  const off = onResize(host, (w) => {
    pxW = w; const ns = clamp(560 / w, 1, 1.9);
    if (Math.abs(ns - rScale) > 0.05) { rScale = ns; setRadii(); sim.alpha(0.6).restart(); }
    labelSize = (11.5 * (VW / pxW)) / k; paint();
  });
  const offV = onVisible(host, (v) => { visible = v; if (!v) sim.stop(); else if (!reduceMotion()) sim.alpha(0.05).restart(); }, { threshold: 0 });
  rScale = clamp(560 / (host.clientWidth || 560), 1, 1.9); setRadii(); paint();
  if (reduceMotion()) { sim.stop(); for (let i = 0; i < 320; i++) sim.tick(); paint(); }
  else raf = requestAnimationFrame(idle);

  return { focus, highlight, select, areas: hubs, destroy() { cancelAnimationFrame(raf); sim.stop(); off(); offV(); svg.remove(); } };
}
