// Landfill gas lab — first-order decay (the equation behind EPA's LandGEM) on monthly waste cohorts.
//   Q(t) = Σ_cohorts  k · L0 · m_i · exp(−k · age_i)        [m³ CH4 / yr]
// Defaults are generic, not any specific site. Recovery = collection efficiency × generation.
import { el, clamp, fmt, tip, onResize, rafThrottle, hashParams, setHash, shareURL, copyText, exportPNG, paintRange } from "./util.js";

const d3 = window.d3;
const YEARS = 60, MONTHS = YEARS * 12;
const SCFM = 35.3147 / 525600;   // m³/yr → ft³/min
const MMBTU_PER_M3 = 0.0357;     // higher heating value of methane per m³
const CH4_SHARE = 0.5;           // landfill gas is ~50 % methane
const DEFAULTS = { A: 150, Y: 30, k: 0.05, L: 100, e: 75 };
const CLIMATES = [["Arid", 0.02], ["Moderate", 0.05], ["Wet", 0.09]];

function model({ A, Y, k, L, e }) {
  const tons = (A * 1000) / 12;                 // Mg per monthly cohort
  const n = Math.min(MONTHS, Y * 12);
  const gen = new Float64Array(MONTHS + 1);     // m³ CH4/yr at the start of month t
  for (let t = 0; t <= MONTHS; t++) {
    let s = 0;
    const last = Math.min(t, n - 1);
    for (let i = 0; i <= last; i++) s += Math.exp((-k * (t - i + 0.5)) / 12);
    gen[t] = k * L * tons * s;
  }
  const rows = [];
  let cum = 0;
  for (let y = 0; y <= YEARS; y++) {
    const g = gen[Math.min(MONTHS, y * 12)];
    const rec = g * (e / 100);
    rows.push({ y, g, rec, lfg: (g / CH4_SHARE) * SCFM, lfgRec: (rec / CH4_SHARE) * SCFM, mm: rec * MMBTU_PER_M3, cum });
    cum += rec * MMBTU_PER_M3;                  // annual step (yr y → y+1)
  }
  rows.forEach((r, i) => { r.cum = d3.sum(rows.slice(0, i), (q) => q.mm); });
  const peak = d3.greatest(rows, (r) => r.g);
  return { rows, peak, total: d3.sum(rows.slice(0, YEARS), (r) => r.mm), n };
}

export function mountLandfillLab(root, { hashId = "lab-landfill" } = {}) {
  let st = { ...DEFAULTS };
  const ps = hashParams(hashId);
  if (ps) for (const k of Object.keys(DEFAULTS)) if (ps[k] != null && !isNaN(+ps[k])) st[k] = +ps[k];
  let m = model(st), pinned = null, W = 0, hoverY = null, dragging = false, sc = null;

  const slider = (key, label, min, max, step, f, hint) => {
    const input = el("input", { type: "range", id: `${hashId}-${key}`, min, max, step, value: st[key] });
    const out = el("output", { for: input.id });
    const sync = () => { out.textContent = f(+input.value); paintRange(input); };
    input.addEventListener("input", () => { st[key] = +input.value; sync(); update(); });
    sync();
    return { node: el("div", { class: "ctl" }, el("label", { for: input.id }, label, out), input, hint ? el("small", { text: hint }) : null), input, sync, key };
  };
  const S = [
    slider("A", "Waste accepted per year", 20, 500, 10, (v) => v + "k Mg", "Annual tonnage while the landfill is open."),
    slider("Y", "Years open to waste", 5, 50, 1, (v) => v + " yr", "Drag the closure line on the chart, or use this slider."),
    slider("k", "Decay rate k", 0.01, 0.3, 0.005, (v) => v.toFixed(3) + " /yr", "How fast waste breaks down. Wetter climate = faster, earlier peak."),
    slider("L", "Methane potential L₀", 50, 200, 5, (v) => v + " m³/Mg", "Methane a tonne of waste can generate in total."),
    slider("e", "Gas collection efficiency", 50, 95, 1, (v) => v + " %", "Share of generated gas the wellfield captures."),
  ];
  const climateBtns = CLIMATES.map(([l, k]) => el("button", { class: "chip", type: "button", dataset: { k }, "aria-pressed": "false", text: `${l} · k ${k}` }));
  const pinBtn = el("button", { class: "btn btn--sm", type: "button", text: "Pin this curve to compare" });
  const shareBtn = el("button", { class: "btn btn--sm", type: "button", text: "Copy link" });
  const pngBtn = el("button", { class: "btn btn--sm", type: "button", text: "Download PNG" });
  const resetBtn = el("button", { class: "btn btn--sm", type: "button", text: "Reset" });
  const kpiHost = el("div", { class: "kpis" });
  const host = el("div", { class: "chart-host" });
  const tableHost = el("div", { class: "tbl-wrap" });
  const legend = el("div", { class: "legend" },
    el("span", {}, el("i", { class: "fill", style: "background:var(--accent)" }), "Recovered gas"),
    el("span", {}, el("i", { class: "fill", style: "background:var(--brass);opacity:.6" }), "Not collected"),
    el("span", {}, el("i", { style: "background:var(--muted)" }), "Pinned scenario"));

  root.replaceChildren(el("div", { class: "lab-grid" },
    kpiHost,
    el("div", { class: "chart-card" },
      el("div", { class: "scenario-bar" }, el("div", { class: "seg", role: "group", "aria-label": "Climate" }, ...climateBtns)),
      el("div", { class: "chart-title" }, el("h4", { text: "Landfill gas over 60 years" }), el("span", { text: "Hover for values · drag the closure line" })), legend, host),
    el("div", { class: "panel controls" }, el("h4", { text: "Landfill" }), ...S.map((s) => s.node),
      el("p", { class: "lab-note", text: "A generic landfill at 50 % methane (0.0357 MMBtu per m³ CH₄), using the EPA first-order-decay method." })),
    el("div", { class: "lab-foot" }, pinBtn, shareBtn, pngBtn, resetBtn,
      el("span", { class: "note", text: "Peak output arrives at closure, then decays at e^(−k·t). That tail is the business case for RNG and the reason timing matters." })),
    el("details", { class: "how" }, el("summary", { text: "How it works" }), el("div", { class: "body" },
      el("p", {}, "Every month's waste is a cohort that starts generating methane the moment it is buried and decays exponentially: ", el("span", { class: "code", text: "Q = Σ k · L₀ · M · e^(−k·age)" }),
        ". Summing 720 monthly cohorts over 60 years (the portfolio's EPA-model forecaster does the same, vectorised) gives the curve."),
      el("p", {}, "Gas generation climbs while waste is still arriving and peaks at closure; afterwards it falls with a half-life of ", el("span", { class: "code", text: "ln 2 / k" }), " years. Collection efficiency turns generation into recoverable gas, and a conversion factor turns that into energy."))),
    el("details", { class: "how" }, el("summary", { text: "View as table (every 5 years)" }), el("div", { class: "body" }, tableHost))));

  const svg = d3.select(host).append("svg").attr("role", "img").attr("aria-label", "Landfill gas generation by year, split into recovered and uncollected");
  const node = svg.node();

  function render() {
    if (!W) return;
    const narrow = W < 560, mg = { l: narrow ? 46 : 58, r: 14, t: 26, b: 38 }, H = narrow ? 300 : 380;
    svg.attr("width", W).attr("height", H).attr("viewBox", `0 0 ${W} ${H}`); svg.selectAll("*").remove();
    const rows = m.rows;
    const ymax = Math.max(d3.max(rows, (r) => r.lfg), pinned ? d3.max(pinned.rows, (r) => r.lfg) : 0) * 1.12 || 1;
    const x = d3.scaleLinear().domain([0, YEARS]).range([mg.l, W - mg.r]);
    const y = d3.scaleLinear().domain([0, ymax]).nice().range([H - mg.b, mg.t]);
    sc = { x, y, mg, H };
    svg.append("g").attr("class", "ax gridl").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - mg.l - mg.r)).tickFormat(""));
    svg.append("g").attr("class", "ax noline").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8).tickFormat(d3.format(","))).select(".domain").remove();
    svg.append("g").attr("class", "ax").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(narrow ? 6 : 12).tickSize(4)).select(".domain").attr("stroke", "var(--chart-axis)");
    svg.append("text").attr("class", "ax-title").attr("x", mg.l).attr("y", mg.t - 12).text("LANDFILL GAS · scfm (50 % CH₄)");
    svg.append("text").attr("class", "ax-title").attr("x", W - mg.r).attr("y", H - 4).attr("text-anchor", "end").text("years since opening");
    // closure shading
    svg.append("rect").attr("x", x(0)).attr("width", x(Math.min(m.n / 12, YEARS)) - x(0)).attr("y", mg.t).attr("height", H - mg.b - mg.t).attr("fill", "var(--accent)").attr("fill-opacity", 0.04);
    // stacked areas: recovered (bottom) + uncollected (top), 2px surface gap between
    const area = d3.area().x((r) => x(r.y)).curve(d3.curveMonotoneX);
    svg.append("path").attr("d", area.y0(y(0)).y1((r) => y(r.lfgRec))(rows)).attr("fill", "var(--accent)").attr("fill-opacity", 0.78);
    svg.append("path").attr("d", area.y0((r) => y(r.lfgRec) - 2).y1((r) => y(r.lfg))(rows)).attr("fill", "var(--brass)").attr("fill-opacity", 0.5);
    svg.append("path").attr("d", d3.line().x((r) => x(r.y)).y((r) => y(r.lfg)).curve(d3.curveMonotoneX)(rows)).attr("fill", "none").attr("stroke", "var(--brass)").attr("stroke-width", 2);
    if (pinned) svg.append("path").attr("d", d3.line().x((r) => x(r.y)).y((r) => y(r.lfg)).curve(d3.curveMonotoneX)(pinned.rows)).attr("fill", "none").attr("stroke", "var(--muted)").attr("stroke-width", 2).attr("stroke-opacity", 0.9);
    // peak annotation
    const pk = m.peak, px = x(pk.y), py = y(pk.g / CH4_SHARE * SCFM);
    svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", "var(--brass)").attr("stroke", "var(--surface)").attr("stroke-width", 2);
    svg.append("text").attr("class", "ax-title").attr("x", px + (pk.y > YEARS * 0.7 ? -10 : 10)).attr("y", py - 10).attr("text-anchor", pk.y > YEARS * 0.7 ? "end" : "start").attr("fill", "var(--ink)").text(`peak ${fmt.n0(pk.g / CH4_SHARE * SCFM)} scfm · year ${pk.y}`);
    // closure handle
    const cx = x(Math.min(st.Y, YEARS));
    const hnd = svg.append("g").attr("class", "closure").style("cursor", "ew-resize").style("touch-action", "none");
    hnd.append("line").attr("x1", cx).attr("x2", cx).attr("y1", mg.t).attr("y2", H - mg.b).attr("stroke", "var(--ink-2)").attr("stroke-width", 1.5);
    hnd.append("rect").attr("x", cx - 38).attr("y", H - mg.b - 24).attr("width", 76).attr("height", 20).attr("rx", 10).attr("fill", "var(--ink)");
    hnd.append("text").attr("x", cx).attr("y", H - mg.b - 10).attr("text-anchor", "middle").attr("fill", "var(--bg)").style("font", "500 10.5px var(--mono)").style("stroke", "none").style("paint-order", "normal").text(`closure ${st.Y}y`);
    hnd.append("rect").attr("class", "hit").attr("x", cx - 16).attr("width", 32).attr("y", mg.t).attr("height", H - mg.b - mg.t).attr("fill", "transparent");
    // hover
    const hov = svg.append("g").style("pointer-events", "none");
    hov.append("line").attr("class", "xhair hl").style("display", "none").attr("y1", mg.t).attr("y2", H - mg.b);
    updateHover();
  }

  function updateHover(ev) {
    if (!sc) return;
    const line = svg.select(".xhair");
    if (hoverY == null || dragging) { line.style("display", "none"); tip.hide(); return; }
    const r = m.rows[hoverY], xm = sc.x(hoverY);
    line.style("display", null).attr("x1", xm).attr("x2", xm);
    const pos = ev ? [ev.clientX, ev.clientY] : (() => { const b = node.getBoundingClientRect(); return [b.left + xm, b.top + 60]; })();
    const phase = hoverY * 12 < m.n ? "accepting waste" : `${(hoverY - m.n / 12).toFixed(0)} yr after closure`;
    tip.show(tip.rows(`Year ${hoverY}`, phase, [
      { color: "var(--brass)", label: "Landfill gas", value: fmt.n0(r.lfg) + " scfm" },
      { color: "var(--accent)", label: "Recovered", value: fmt.n0(r.lfgRec) + " scfm" },
      { color: "var(--muted)", label: "CH₄ generated", value: fmt.si(r.g) + " m³/yr" },
      { color: "var(--accent)", label: "Energy recovered", value: fmt.si(r.mm) + " MMBtu/yr" },
      { color: "var(--muted)", label: "Cumulative recovered", value: fmt.si(r.cum) + " MMBtu" },
    ].concat(pinned ? [{ color: "var(--muted)", label: "Pinned scenario", value: fmt.n0(pinned.rows[hoverY].lfg) + " scfm" }] : [])), ...pos);
  }
  const yearAt = (cx) => clamp(Math.round(sc.x.invert(cx - node.getBoundingClientRect().left)), 0, YEARS);
  node.addEventListener("pointerdown", (e) => { if (e.target.closest?.(".closure")) { dragging = true; node.setPointerCapture(e.pointerId); e.preventDefault(); tip.hide(); } });
  node.addEventListener("pointermove", rafThrottle((e) => {
    if (dragging) { const y = clamp(yearAt(e.clientX), 5, 50); if (y !== st.Y) { st.Y = y; S[1].input.value = y; S[1].sync(); update(true); } return; }
    hoverY = yearAt(e.clientX); updateHover(e);
  }));
  const end = () => { if (dragging) { dragging = false; update(); } };
  node.addEventListener("pointerup", end); node.addEventListener("pointercancel", end);
  node.addEventListener("pointerleave", () => { if (!dragging) { hoverY = null; updateHover(); } });

  function renderKpis() {
    const closeY = st.Y, after = m.rows[Math.min(YEARS, closeY + 10)], pk = m.peak;
    const k = (cls, lab, val, small) => el("div", { class: "kpi " + cls }, el("span", { text: lab }), el("b", { text: val }), el("small", { text: small }));
    kpiHost.replaceChildren(
      k("", "Peak landfill gas", fmt.n0(pk.g / CH4_SHARE * SCFM) + " scfm", `year ${pk.y} · ${fmt.si(pk.g)} m³ CH₄/yr`),
      k("", "Recoverable at peak", fmt.n0(pk.rec / CH4_SHARE * SCFM) + " scfm", `${fmt.si(pk.mm)} MMBtu/yr at ${st.e} % capture`),
      k("", "Ten years after closure", closeY + 10 <= YEARS ? fmt.n0(after.lfg) + " scfm" : "beyond 60 yr", closeY + 10 <= YEARS ? `${(after.g / pk.g * 100).toFixed(0)} % of peak · half-life ${(Math.LN2 / st.k).toFixed(0)} yr` : `half-life ${(Math.LN2 / st.k).toFixed(0)} yr`),
      k("good", "Energy recovered, 60 yr", fmt.si(m.total) + " MMBtu", `from ${fmt.si(st.A * 1000 * closeY)} Mg of waste`));
  }
  function renderTable() {
    const th = (t) => el("th", { text: t });
    tableHost.replaceChildren(el("table", { class: "data" }, el("thead", {}, el("tr", {}, ["Year", "LFG scfm", "Recovered scfm", "CH₄ m³/yr", "Cumulative MMBtu"].map(th))),
      el("tbody", {}, m.rows.filter((r) => r.y % 5 === 0).map((r) => el("tr", {}, [r.y, fmt.n0(r.lfg), fmt.n0(r.lfgRec), fmt.si(r.g), fmt.si(r.cum)].map((v) => el("td", { text: String(v) })))))));
  }
  const persist = rafThrottle(() => setHash(hashId, st));
  function update(fast) {
    m = model(st); render(); renderKpis(); if (!fast) renderTable(); persist();
    climateBtns.forEach((b) => b.setAttribute("aria-pressed", String(Math.abs(+b.dataset.k - st.k) < 1e-9)));
  }
  climateBtns.forEach((b) => b.addEventListener("click", () => { st.k = +b.dataset.k; S[2].input.value = st.k; S[2].sync(); update(); }));
  pinBtn.addEventListener("click", () => { if (pinned) { pinned = null; pinBtn.textContent = "Pin this curve to compare"; } else { pinned = m; pinBtn.textContent = "Clear pinned curve"; } render(); });
  resetBtn.addEventListener("click", () => { st = { ...DEFAULTS }; pinned = null; pinBtn.textContent = "Pin this curve to compare"; S.forEach((s) => { s.input.value = st[s.key]; s.sync(); }); update(); });
  shareBtn.addEventListener("click", () => copyText(shareURL(hashId, st)));
  pngBtn.addEventListener("click", () => exportPNG(node, { title: "Landfill gas forecast · 60 years", sub: `${st.A}k Mg/yr for ${st.Y} yr · k ${st.k} · L₀ ${st.L} · ${st.e}% capture · peak ${fmt.n0(m.peak.g / CH4_SHARE * SCFM)} scfm`, filename: "landfill-gas-forecast.png" }));
  onResize(host, (w) => { W = w; render(); });
  update();
}
