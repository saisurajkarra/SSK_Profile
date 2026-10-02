// Distillation lab — McCabe–Thiele stage stepping for a binary N2/O2 column with constant relative volatility.
// A teaching model: the production simulators this portfolio describes use rigorous stage-by-stage MESH solves
// with real-fluid properties; here α is constant so the geometry is visible.
import { el, clamp, fmt, tip, onResize, rafThrottle, hashParams, setHash, shareURL, copyText, exportPNG, paintRange, reduceMotion } from "./util.js";

const d3 = window.d3;
const MAXN = 250;
const DEFAULTS = { a: 3, z: 0.79, q: 0, d: 0.99, b: 0.62, r: 1.3 };
const PRESETS = {
  hp:   { label: "ASU high-pressure column", v: { a: 3, z: 0.79, q: 0, d: 0.99, b: 0.62, r: 1.3 } },
  pure: { label: "Ultra-pure N₂ top", v: { a: 3, z: 0.79, q: 0, d: 0.9995, b: 0.62, r: 1.3 } },
  hard: { label: "Hard split (α = 1.4)", v: { a: 1.4, z: 0.5, q: 1, d: 0.95, b: 0.05, r: 1.3 } },
  tall: { label: "Tall & cheap (R = 1.05 × min)", v: { a: 3, z: 0.79, q: 0, d: 0.99, b: 0.62, r: 1.05 } },
};

const eqY = (x, a) => (a * x) / (1 + (a - 1) * x);
const eqX = (y, a) => y / (a - (a - 1) * y);

function design({ a, z, q, d: xD, b: xB, r: rr }) {
  // keep the problem well-posed: xB < zF < xD
  xB = Math.min(xB, z - 0.02); xD = Math.max(xD, z + 0.02);
  // q-line / equilibrium pinch
  let xq, yq;
  if (q >= 0.999) { xq = z; yq = eqY(xq, a); }
  else {
    const m = q / (q - 1), c = -z / (q - 1);
    const f = (x) => m * x + c - eqY(x, a);
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; (f(lo) * f(mid) <= 0) ? (hi = mid) : (lo = mid); }
    xq = (lo + hi) / 2; yq = eqY(xq, a);
  }
  const Rmin = Math.max(0.01, (xD - yq) / (yq - xq));
  const R = Rmin * rr;
  const rect = (x) => (R / (R + 1)) * x + xD / (R + 1);
  // rectifying ∩ q-line
  let xi, yi;
  if (q >= 0.999) { xi = z; yi = rect(xi); }
  else { const m = q / (q - 1), c = -z / (q - 1); xi = (c - xD / (R + 1)) / (R / (R + 1) - m); yi = rect(xi); }
  const sl = (yi - xB) / (xi - xB);
  const strip = (x) => xB + sl * (x - xB);
  // stage stepping from the top
  const pts = [[xD, xD]]; const stages = []; let y = xD, n = 0, feed = null, converged = false, Nfrac = Infinity;
  while (n < MAXN) {
    n++;
    const x = eqX(y, a); stages.push({ n, x, y }); pts.push([x, y]);
    if (feed == null && x <= xi) feed = n;
    if (x <= xB) { converged = true; const xp = n > 1 ? stages[n - 2].x : xD; Nfrac = n - 1 + (xp - xB) / Math.max(1e-12, xp - x); break; }
    const ny = x > xi ? rect(x) : strip(x);
    pts.push([x, ny]); y = ny;
    if (ny <= x + 1e-9) break; // pinched
  }
  const Nmin = Math.log((xD / (1 - xD)) * ((1 - xB) / xB)) / Math.log(a);
  const D = (z - xB) / (xD - xB);       // distillate / feed
  const V = (R + 1) * D;                 // rectifying-section vapour per mole feed (energy proxy)
  return { xB, xD, xq, yq, Rmin, R, xi, yi, sl, rect, strip, pts, stages, N: converged ? n : Infinity, Nfrac, feed, Nmin, D, V, converged };
}

const stagesAt = (p, rr) => design({ ...p, r: rr }).Nfrac;

export function mountColumnLab(root, { hashId = "lab-column" } = {}) {
  let st = { ...DEFAULTS };
  const ps = hashParams(hashId);
  if (ps) for (const k of Object.keys(DEFAULTS)) if (ps[k] != null && !isNaN(+ps[k])) st[k] = +ps[k];
  let m = null, W1 = 0, W2 = 0, shown = Infinity, anim = null;

  const slider = (key, label, min, max, step, f, hint) => {
    const input = el("input", { type: "range", id: `${hashId}-${key}`, min, max, step, value: st[key] });
    const out = el("output", { for: input.id });
    const sync = () => { out.textContent = f(+input.value); paintRange(input); };
    input.addEventListener("input", () => { st[key] = +input.value; sync(); update(); });
    sync();
    return { node: el("div", { class: "ctl" }, el("label", { for: input.id }, label, out), input, hint ? el("small", { text: hint }) : null), input, sync, key };
  };
  const S = [
    slider("a", "Relative volatility α", 1.2, 6, 0.05, (v) => v.toFixed(2), "How easily N₂ boils off versus O₂. ≈3 in a high-pressure column, higher at low pressure."),
    slider("z", "Feed N₂ fraction z", 0.3, 0.9, 0.01, (v) => v.toFixed(2), "Air is ≈0.79 N₂ on an O₂/N₂ basis."),
    slider("q", "Feed condition q", 0, 1, 0.05, (v) => (v === 0 ? "0 · vapour" : v === 1 ? "1 · liquid" : v.toFixed(2)), "0 = saturated vapour, 1 = saturated liquid."),
    slider("d", "Top purity x_D", 0.9, 0.9995, 0.0005, (v) => (v * 100).toFixed(2) + " %", "N₂ purity at the top. Watch the stage count explode near 99.99 %."),
    slider("b", "Bottoms N₂ x_B", 0.05, 0.7, 0.01, (v) => v.toFixed(2), "Rich-liquid composition leaving the bottom."),
    slider("r", "Reflux R / R_min", 1.01, 4, 0.01, (v) => v.toFixed(2) + " ×", "The knob that trades columns' height against energy."),
  ];
  const presetBtns = Object.entries(PRESETS).map(([k, v]) => el("button", { class: "chip", type: "button", dataset: { p: k }, "aria-pressed": "false", text: v.label }));
  const kpiHost = el("div", { class: "kpis" });
  const h1 = el("div", { class: "chart-host" }), h2 = el("div", { class: "chart-host" });
  const tableHost = el("div", { class: "tbl-wrap" });
  const whatif = el("div", { class: "whatif" });
  const stepBtn = el("button", { class: "btn btn--sm", type: "button", text: "▶ Step through stages" });
  const shareBtn = el("button", { class: "btn btn--sm", type: "button", text: "Copy link" });
  const pngBtn = el("button", { class: "btn btn--sm", type: "button", text: "Download PNG" });
  const resetBtn = el("button", { class: "btn btn--sm", type: "button", text: "Reset" });
  const legend = el("div", { class: "legend" },
    el("span", {}, el("i", { style: "background:var(--accent)" }), "Equilibrium"),
    el("span", {}, el("i", { style: "background:var(--c2)" }), "Operating lines"),
    el("span", {}, el("i", { style: "background:var(--c4)" }), "q-line"),
    el("span", {}, el("i", { style: "background:var(--ink)" }), "Stage steps"));

  root.replaceChildren(el("div", { class: "lab-grid" },
    kpiHost,
    el("div", { class: "chart-pair" },
      el("div", { class: "chart-card" },
        el("div", { class: "scenario-bar" }, el("div", { class: "seg", role: "group", "aria-label": "Presets" }, ...presetBtns)),
        el("div", { class: "chart-title" }, el("h4", { text: "McCabe–Thiele diagram" }), el("span", { text: "N₂ in liquid (x) vs vapour (y)" })), legend, h1),
      el("div", { class: "chart-card" },
        el("div", { class: "chart-title" }, el("h4", { text: "The trade-off: stages vs reflux" }), el("span", { text: "More reflux = fewer stages, more energy" })), h2, whatif)),
    el("div", { class: "panel controls" }, el("h4", { text: "Column" }), ...S.map((s) => s.node),
      el("p", { class: "lab-note", text: "Simplified model: constant α, binary N₂/O₂, total condenser. The full simulators solve every stage with real-fluid properties." })),
    el("div", { class: "lab-foot" }, stepBtn, shareBtn, pngBtn, resetBtn),
    el("details", { class: "how" }, el("summary", { text: "How it works" }), el("div", { class: "body" },
      el("p", {}, "Equilibrium: ", el("span", { class: "code", text: "y = αx / (1 + (α−1)x)" }), ". Rectifying line: ", el("span", { class: "code", text: "y = R/(R+1)·x + x_D/(R+1)" }),
        ". The q-line meets the equilibrium curve at the pinch, which fixes the minimum reflux R_min = (x_D − y*) / (y* − x*)."),
      el("p", {}, "Stages are stepped from the top: from (x_D, x_D) go across to the equilibrium curve, then down to the operating line, and repeat until x ≤ x_B. The feed stage is where the steps cross the q-line intersection, which is the best place to switch operating lines. N_min comes from the Fenske equation at total reflux."),
      el("p", {}, "V/F is vapour traffic per mole of feed, a stand-in for reboiler and condenser energy. Raising R/R_min cuts the number of stages with diminishing returns while energy keeps climbing, which is why real designs sit near 1.1–1.5 × R_min."))),
    el("details", { class: "how" }, el("summary", { text: "View stages as a table" }), el("div", { class: "body" }, tableHost))));

  const g1 = d3.select(h1).append("svg").attr("role", "img").attr("aria-label", "McCabe–Thiele diagram with equilibrium curve, operating lines and stage steps");
  const g2 = d3.select(h2).append("svg").attr("role", "img").attr("aria-label", "Number of theoretical stages versus reflux ratio");

  function renderDiagram() {
    if (!W1 || !m) return;
    const side = Math.min(W1, 620), mg = { l: 44, r: 12, t: 10, b: 40 }, H = side + 4;
    g1.attr("width", W1).attr("height", H).attr("viewBox", `0 0 ${W1} ${H}`); g1.selectAll("*").remove();
    const pw = Math.min(W1, 620) - mg.l - mg.r, ph = H - mg.t - mg.b;
    const ox = Math.round((W1 - side) / 2);
    const x = d3.scaleLinear().domain([0, 1]).range([ox + mg.l, ox + mg.l + pw]);
    const y = d3.scaleLinear().domain([0, 1]).range([mg.t + ph, mg.t]);
    const ticks = d3.range(0, 1.01, 0.2);
    g1.append("g").attr("class", "ax gridl").attr("transform", `translate(${x(0)},0)`).call(d3.axisLeft(y).tickValues(ticks).tickSize(-pw).tickFormat(""));
    g1.append("g").attr("class", "ax gridl").attr("transform", `translate(0,${y(0)})`).call(d3.axisBottom(x).tickValues(ticks).tickSize(-ph).tickFormat(""));
    g1.append("g").attr("class", "ax noline").attr("transform", `translate(${x(0)},0)`).call(d3.axisLeft(y).tickValues(ticks).tickSize(0).tickPadding(8).tickFormat(d3.format(".1f"))).select(".domain").remove();
    g1.append("g").attr("class", "ax noline").attr("transform", `translate(0,${y(0)})`).call(d3.axisBottom(x).tickValues(ticks).tickSize(0).tickPadding(8).tickFormat(d3.format(".1f"))).select(".domain").remove();
    g1.append("text").attr("class", "ax-title").attr("x", x(0.5)).attr("y", H - 4).attr("text-anchor", "middle").text("x · N₂ mole fraction in liquid");
    g1.append("text").attr("class", "ax-title").attr("transform", `translate(11,${y(0.5)}) rotate(-90)`).attr("text-anchor", "middle").text("y · in vapour");
    const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));
    const { a } = st;
    // diagonal + equilibrium
    g1.append("path").attr("d", line([[0, 0], [1, 1]])).attr("stroke", "var(--chart-axis)").attr("stroke-width", 1).attr("fill", "none");
    g1.append("path").attr("d", line(d3.range(0, 1.0001, 0.01).map((v) => [v, eqY(v, a)]))).attr("stroke", "var(--accent)").attr("stroke-width", 2).attr("fill", "none");
    // q-line
    g1.append("path").attr("d", line(st.q >= 0.999 ? [[st.z, st.z], [st.z, eqY(st.z, a)]] : [[st.z, st.z], [m.xq, m.yq]])).attr("stroke", "var(--c4)").attr("stroke-width", 2).attr("fill", "none");
    // operating lines
    g1.append("path").attr("d", line([[m.xi, m.yi], [m.xD, m.xD]])).attr("stroke", "var(--c2)").attr("stroke-width", 2).attr("fill", "none");
    g1.append("path").attr("d", line([[m.xB, m.xB], [m.xi, m.yi]])).attr("stroke", "var(--c2)").attr("stroke-width", 2).attr("fill", "none");
    // composition markers on the diagonal
    [["x_B", m.xB], ["z", st.z], ["x_D", m.xD]].forEach(([l, v]) => {
      g1.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", y(v)).attr("y2", y(0)).attr("stroke", "var(--muted)").attr("stroke-opacity", 0.55).attr("stroke-width", 1);
      g1.append("circle").attr("cx", x(v)).attr("cy", y(v)).attr("r", 3.5).attr("fill", "var(--muted)");
      g1.append("text").attr("class", "ax-title").attr("x", x(v)).attr("y", y(0) - 6).attr("text-anchor", "middle").text(l);
    });
    // direct labels
    g1.append("text").attr("class", "ax-title").attr("x", x(0.04)).attr("y", y(Math.min(0.95, eqY(0.04, a) + 0.07))).attr("fill", "var(--accent-ink)").text("equilibrium");
    const mid = (p1, p2) => [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const mr = mid([m.xi, m.yi], [m.xD, m.xD]), ms = mid([m.xB, m.xB], [m.xi, m.yi]);
    g1.append("text").attr("class", "ax-title").attr("x", x(mr[0]) - 10).attr("y", y(mr[1]) - 10).attr("text-anchor", "end").text("rectifying");
    g1.append("text").attr("class", "ax-title").attr("x", x(ms[0]) + 10).attr("y", y(ms[1]) + 4).text("stripping");
    // pinch & intersection marker
    g1.append("circle").attr("cx", x(m.xi)).attr("cy", y(m.yi)).attr("r", 4).attr("fill", "var(--surface)").attr("stroke", "var(--c2)").attr("stroke-width", 2);
    // staircase
    const path = m.pts.slice(0, Math.min(m.pts.length, shown === Infinity ? m.pts.length : shown));
    g1.append("path").attr("class", "stairs").attr("d", line(path)).attr("stroke", "var(--ink)").attr("stroke-width", 2).attr("fill", "none").attr("stroke-linejoin", "round");
    const stagePts = m.stages.slice(0, shown === Infinity ? undefined : Math.ceil(shown / 2));
    g1.append("g").selectAll("g").data(stagePts).join("g").attr("transform", (s) => `translate(${x(s.x)},${y(s.y)})`)
      .each(function (s) {
        const gg = d3.select(this);
        gg.append("circle").attr("r", 3.2).attr("fill", s.n === m.feed ? "var(--c2)" : "var(--ink)").attr("stroke", "var(--surface)").attr("stroke-width", 1.5);
        gg.append("circle").attr("r", 12).attr("fill", "transparent").style("cursor", "crosshair")
          .on("pointermove", (e) => tip.show(tip.rows(`Stage ${s.n}${s.n === m.feed ? " · feed stage" : ""}`, "Equilibrium point", [{ label: "Liquid x", value: s.x.toFixed(4) }, { label: "Vapour y", value: s.y.toFixed(4) }]), e.clientX, e.clientY))
          .on("pointerleave", () => tip.hide());
      });
  }

  function renderTrade() {
    if (!W2 || !m) return;
    const H = (W1 && W2 && W1 !== W2 && W1 > 380 && matchMedia('(min-width:860px)').matches) ? Math.min(W1, 620) + 4 : 300, mg = { l: 44, r: 14, t: 30, b: 40 };
    g2.attr("width", W2).attr("height", H).attr("viewBox", `0 0 ${W2} ${H}`); g2.selectAll("*").remove();
    const rrs = d3.range(1.02, 4.001, 0.02);
    const data = rrs.map((r) => ({ r, n: stagesAt(st, r) })).filter((d) => isFinite(d.n));
    const cap = Math.min(150, Math.max(12, Math.ceil(((stagesAt(st, 1.15) || 30) * 1.15) / 5) * 5));
    const x = d3.scaleLinear().domain([1, 4]).range([mg.l, W2 - mg.r]);
    const y = d3.scaleLinear().domain([0, cap]).range([H - mg.b, mg.t]);
    g2.append("rect").attr("x", x(1.1)).attr("width", x(1.5) - x(1.1)).attr("y", mg.t).attr("height", H - mg.b - mg.t).attr("fill", "var(--accent)").attr("fill-opacity", 0.08);
    g2.append("text").attr("class", "ax-title").attr("x", (x(1.1) + x(1.5)) / 2).attr("y", H - mg.b - 8).attr("text-anchor", "middle").text("typical");
    g2.append("g").attr("class", "ax gridl").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W2 - mg.l - mg.r)).tickFormat(""));
    g2.append("g").attr("class", "ax noline").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8)).select(".domain").remove();
    g2.append("g").attr("class", "ax").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(W2 < 420 ? 4 : 7).tickSize(4).tickFormat((v) => v + "×")).select(".domain").attr("stroke", "var(--chart-axis)");
    g2.append("text").attr("class", "ax-title").attr("x", x(2.5)).attr("y", H - 4).attr("text-anchor", "middle").text("R / R_min");
    g2.append("text").attr("class", "ax-title").attr("x", mg.l).attr("y", mg.t - 14).text("THEORETICAL STAGES · shaded: typical 1.1–1.5×");
    if (m.Nmin < cap) {
      g2.append("line").attr("x1", mg.l).attr("x2", W2 - mg.r).attr("y1", y(m.Nmin)).attr("y2", y(m.Nmin)).attr("stroke", "var(--muted)").attr("stroke-width", 1);
      g2.append("text").attr("class", "ax-title").attr("x", W2 - mg.r).attr("y", y(m.Nmin) + 13).attr("text-anchor", "end").text(`N_min ≈ ${m.Nmin.toFixed(1)} at total reflux`);
    }
    const ln = d3.line().x((d) => x(d.r)).y((d) => y(Math.min(cap, d.n)));
    g2.append("path").attr("d", d3.area().x((d) => x(d.r)).y0(y(0)).y1((d) => y(Math.min(cap, d.n)))(data)).attr("fill", "var(--accent)").attr("fill-opacity", 0.1);
    g2.append("path").attr("d", ln(data)).attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 2).attr("stroke-linejoin", "round");
    // current point
    if (isFinite(m.N) && m.Nfrac <= cap) {
      g2.append("line").attr("x1", x(st.r)).attr("x2", x(st.r)).attr("y1", y(m.Nfrac)).attr("y2", y(0)).attr("stroke", "var(--ink-2)").attr("stroke-width", 1);
      g2.append("circle").attr("cx", x(st.r)).attr("cy", y(m.Nfrac)).attr("r", 6).attr("fill", "var(--c2)").attr("stroke", "var(--surface)").attr("stroke-width", 2);
      g2.append("text").attr("class", "ax-title").attr("x", x(st.r) + (st.r > 2.4 ? -10 : 10)).attr("y", y(m.Nfrac) - 12).attr("text-anchor", st.r > 2.4 ? "end" : "start").attr("fill", "var(--ink)").text(`${m.N} stages (${m.Nfrac.toFixed(1)} fractional)`);
    }
    // hover
    const ov = g2.append("rect").attr("x", mg.l).attr("width", W2 - mg.l - mg.r).attr("y", mg.t).attr("height", H - mg.t - mg.b).attr("fill", "transparent").style("cursor", "crosshair");
    const xh = g2.append("line").attr("class", "xhair").attr("y1", mg.t).attr("y2", H - mg.b).style("display", "none");
    ov.on("pointermove", (e) => {
      const rx = clamp(x.invert(e.offsetX ?? e.clientX - ov.node().getBoundingClientRect().left + mg.l), 1.02, 4);
      const dd = design({ ...st, r: rx }), n = dd.N;
      xh.style("display", null).attr("x1", x(rx)).attr("x2", x(rx));
      tip.show(tip.rows(`R = ${(dd.R).toFixed(2)} (${rx.toFixed(2)} × R_min)`, "Reflux", [{ label: "Stages", value: isFinite(n) ? n : "∞" }, { label: "Vapour per feed V/F", value: dd.V.toFixed(2) }]), e.clientX, e.clientY);
    }).on("pointerleave", () => { xh.style("display", "none"); tip.hide(); });
  }

  function renderKpis() {
    const k = (cls, lab, val, small) => el("div", { class: "kpi " + cls }, el("span", { text: lab }), el("b", { text: String(val) }), el("small", { text: small }));
    kpiHost.replaceChildren(
      k("", "Minimum reflux", m.Rmin.toFixed(2), `pinch at x = ${m.xq.toFixed(3)}, y = ${m.yq.toFixed(3)}`),
      k("", "Operating reflux", m.R.toFixed(2), `${st.r.toFixed(2)} × minimum`),
      k(m.converged ? "" : "bad", "Stages", m.converged ? m.N : "∞", m.converged ? `feed on stage ${m.feed} · N_min ${m.Nmin.toFixed(1)} at total reflux` : "Below the pinch the column never reaches the target"),
      k("", "Vapour per feed V/F", m.V.toFixed(2), `distillate is ${(m.D * 100).toFixed(0)} % of feed · energy proxy`));
  }
  function renderWhatIf() {
    const rows = [1.05, st.r, 2].filter((v, i, a) => a.findIndex((u) => Math.abs(u - v) < 0.005) === i).sort((a, b) => a - b);
    const base = design({ ...st, r: st.r });
    whatif.replaceChildren(el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["R / R_min", "Stages", "V/F", "Energy vs now"].map((t) => el("th", { text: t })))),
      el("tbody", {}, rows.map((r) => { const d = design({ ...st, r }); const now = Math.abs(r - st.r) < 0.005;
        return el("tr", { style: now ? "font-weight:650;background:var(--accent-wash)" : "" }, [r.toFixed(2) + "×" + (now ? " (now)" : ""), isFinite(d.N) ? d.N : "∞", d.V.toFixed(2), now ? "—" : ((d.V / base.V - 1) * 100 >= 0 ? "+" : "") + ((d.V / base.V - 1) * 100).toFixed(0) + " %"].map((v) => el("td", { text: String(v) }))); }))));
  }
  function renderTable() {
    const th = (t) => el("th", { text: t });
    tableHost.replaceChildren(el("table", { class: "data" }, el("thead", {}, el("tr", {}, ["Stage", "x (liquid)", "y (vapour)", "Section"].map(th))),
      el("tbody", {}, m.stages.slice(0, 60).map((s) => el("tr", {}, [s.n, s.x.toFixed(4), s.y.toFixed(4), s.n < m.feed ? "rectifying" : s.n === m.feed ? "feed" : "stripping"].map((v) => el("td", { text: String(v) })))))));
  }

  const persist = rafThrottle(() => setHash(hashId, st));
  function update() {
    if (anim) { clearTimeout(anim); anim = null; }
    shown = Infinity; stepBtn.textContent = "▶ Step through stages";
    m = design(st); renderKpis(); renderDiagram(); renderTrade(); renderWhatIf(); renderTable(); persist();
    presetBtns.forEach((b) => { const v = PRESETS[b.dataset.p].v; b.setAttribute("aria-pressed", String(Object.keys(v).every((k) => Math.abs(v[k] - st[k]) < 1e-9))); });
  }
  presetBtns.forEach((b) => b.addEventListener("click", () => { Object.assign(st, PRESETS[b.dataset.p].v); S.forEach((s) => { s.input.value = st[s.key]; s.sync(); }); update(); }));
  resetBtn.addEventListener("click", () => { st = { ...DEFAULTS }; S.forEach((s) => { s.input.value = st[s.key]; s.sync(); }); update(); });
  shareBtn.addEventListener("click", () => copyText(shareURL(hashId, st)));
  pngBtn.addEventListener("click", () => exportPNG(g1.node(), { title: "McCabe–Thiele column design", sub: `α ${st.a} · z ${st.z} · x_D ${(m.xD * 100).toFixed(2)}% · R = ${st.r}×R_min → ${m.N} stages`, filename: "mccabe-thiele.png" }));
  stepBtn.addEventListener("click", () => {
    if (reduceMotion()) { shown = Infinity; renderDiagram(); return; }
    if (anim) { clearTimeout(anim); anim = null; shown = Infinity; stepBtn.textContent = "▶ Step through stages"; renderDiagram(); return; }
    shown = 1; stepBtn.textContent = "■ Stop";
    const tick = () => { renderDiagram(); if (shown >= m.pts.length) { shown = Infinity; anim = null; stepBtn.textContent = "▶ Step through stages"; renderDiagram(); return; } shown++; anim = setTimeout(tick, Math.max(40, Math.min(220, 2600 / m.pts.length))); };
    tick();
  });
  onResize(h1, (w) => { W1 = w; renderDiagram(); });
  onResize(h2, (w) => { W2 = w; renderTrade(); });
  update();
}
