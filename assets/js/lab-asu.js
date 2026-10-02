// ASU agent lab — illustrative load-shifting of a liquid-producing air separation plant.
// The optimiser is real (finite-horizon dynamic programming over tank level × previous load),
// but every number here is SYNTHETIC: prices are made-up curves, plant parameters are generic.
import { el, $, clamp, fmt, tip, onResize, rafThrottle, hashParams, setHash, shareURL, copyText, exportPNG, paintRange } from "./util.js";

const d3 = window.d3;
const H = 24;
const Q_NOM = 22;        // t/h of liquid product at 100 % load
const P_NOM = 20;        // MW at 100 % load
const OVERHEAD = 0.12;   // share of nominal power drawn regardless of load (turn-down penalty)
const E_T = P_NOM / Q_NOM; // MWh per tonne at full load
const VENT_PEN = 60;     // $/t of product vented when the tank is full
const UNMET_PEN = 600;   // $/t of demand not served
const NS = 61;           // tank grid points
const power = (L) => P_NOM * (OVERHEAD + (1 - OVERHEAD) * L);

const curve = (pts) => { const s = d3.scaleLinear().domain(pts.map((p) => p[0])).range(pts.map((p) => p[1])); return Array.from({ length: H }, (_, h) => Math.round(s(h) * 10) / 10); };
const PRESETS = {
  weekday: { label: "Typical weekday", pts: [[0, 26], [4, 22], [6, 32], [8, 52], [10, 42], [14, 38], [16, 48], [19, 92], [21, 64], [23, 34]] },
  duck:    { label: "Solar duck curve", pts: [[0, 34], [5, 30], [7, 42], [9, 24], [11, 10], [13, 6], [15, 14], [17, 52], [19, 118], [21, 86], [23, 48]] },
  wind:    { label: "Wind surplus night", pts: [[0, -4], [2, -12], [5, 2], [7, 38], [10, 46], [14, 40], [18, 70], [21, 56], [23, 20]] },
  heat:    { label: "Heat-wave spike", pts: [[0, 40], [6, 46], [10, 70], [13, 140], [16, 260], [18, 210], [20, 110], [23, 54]] },
};
const SHAPE = [0.88, 0.86, 0.85, 0.85, 0.87, 0.92, 1.0, 1.08, 1.1, 1.08, 1.05, 1.02, 1.0, 1.0, 1.02, 1.05, 1.08, 1.1, 1.08, 1.04, 1.0, 0.96, 0.92, 0.9];
const SHAPE_MEAN = d3.mean(SHAPE);
const DEFAULTS = { p: "duck", tank: 6, min: 65, dem: 82, ramp: 40, ev: "" };

export function mountAsuLab(root, { hashId = "lab-asu" } = {}) {
  let st = { ...DEFAULTS };
  let prices = curve(PRESETS[st.p].pts);
  let custom = false;
  const rejected = new Set();   // proposal keys the human rejected
  let model = null;
  let hoverH = null, drag = null;

  /* ---------- URL state ---------- */
  const ps = hashParams(hashId);
  if (ps && Object.keys(ps).length) {
    for (const k of ["tank", "min", "dem", "ramp"]) if (ps[k] != null && !isNaN(+ps[k])) st[k] = +ps[k];
    if (ps.p && (PRESETS[ps.p] || ps.p === "custom")) st.p = ps.p;
    if (ps.ev != null) st.ev = ps.ev;
    if (ps.pr) { const a = ps.pr.split(",").map(Number); if (a.length === H && a.every((x) => isFinite(x))) { prices = a; custom = true; st.p = "custom"; } }
    else if (PRESETS[st.p]) prices = curve(PRESETS[st.p].pts);
    if (ps.rej) ps.rej.split(",").filter(Boolean).forEach((k) => rejected.add(k));
  }

  /* ---------- model ---------- */
  function params() {
    const S = st.tank * Q_NOM;
    const minL = st.min / 100;
    const shape = SHAPE.map((s, h) => s / SHAPE_MEAN);
    const surge = st.ev.includes("s"), derate = st.ev.includes("d");
    const dem = shape.map((s, h) => Q_NOM * (st.dem / 100) * s * (surge && h >= 9 && h < 15 ? 1.25 : 1));
    const maxL = Array.from({ length: H }, (_, h) => (derate && h >= 12 && h < 20 ? Math.max(minL, 0.8) : 1));
    const meanDem = d3.mean(dem);
    const b = clamp(meanDem / Q_NOM, minL, 1);
    // $/t charged for ending the day below the starting tank level (surplus earns no credit)
    const lam = 1.25 * E_T * Math.max(50, d3.max(prices));
    return { S, minL, dem, maxL, b, ramp: st.ramp / 100, surge, derate, lam };
  }

  function simulate(sched, P) {
    let s = 0.5 * P.S; const tank = [s]; const pw = [], cost = []; let vent = 0, unmet = 0, c = 0;
    for (let t = 0; t < H; t++) {
      const L = sched[t]; pw.push(power(L));
      s += Q_NOM * L - P.dem[t];
      if (s > P.S) { vent += s - P.S; s = P.S; }
      if (s < 0) { unmet += -s; s = 0; }
      tank.push(s); cost.push(prices[t] * pw[t]); c += cost[t];
    }
    const deficit = Math.max(0, tank[0] - tank[H]);
    return { tank, pw, cost, energy: c, vent, unmet, deficit, total: c + vent * VENT_PEN + unmet * UNMET_PEN + deficit * P.lam };
  }

  function solve(P) {
    const t0 = performance.now();
    const NLg = 9;
    const lv = d3.range(NLg).map((i) => P.minL + (1 - P.minL) * (i / (NLg - 1)));
    lv.push(P.b); lv.sort((a, b) => a - b);
    const L = lv.filter((v, i) => i === 0 || Math.abs(v - lv[i - 1]) > 1e-6);
    const NL = L.length, ds = P.S / (NS - 1);
    const s0 = 0.5 * P.S;
    const lam = P.lam;
    const V = new Float64Array((H + 1) * NS * NL);
    const idx = (t, s, l) => (t * NS + s) * NL + l;
    for (let s = 0; s < NS; s++) for (let l = 0; l < NL; l++) V[idx(H, s, l)] = lam * Math.max(0, s0 - s * ds);
    const interp = (t, pos, l) => { const i0 = Math.min(NS - 2, Math.max(0, Math.floor(pos))); const f = Math.min(1, Math.max(0, pos - i0)); return V[idx(t, i0, l)] * (1 - f) + V[idx(t, i0 + 1, l)] * f; };
    const stepCost = (t, s, li) => {
      let ns = s + Q_NOM * L[li] - P.dem[t], vent = 0, unmet = 0;
      if (ns > P.S) { vent = ns - P.S; ns = P.S; } if (ns < 0) { unmet = -ns; ns = 0; }
      return { ns, c: prices[t] * power(L[li]) + vent * VENT_PEN + unmet * UNMET_PEN };
    };
    const allowed = (t, lp) => { const out = []; for (let li = 0; li < NL; li++) if (L[li] <= P.maxL[t] + 1e-9 && Math.abs(L[li] - L[lp]) <= P.ramp + 1e-9) out.push(li); return out.length ? out : [0]; };
    for (let t = H - 1; t >= 0; t--) {
      for (let lp = 0; lp < NL; lp++) {
        const al = allowed(t, lp);
        for (let si = 0; si < NS; si++) {
          let best = Infinity;
          for (const li of al) { const r = stepCost(t, si * ds, li); const v = r.c + interp(t + 1, r.ns / ds, li); if (v < best) best = v; }
          V[idx(t, si, lp)] = best;
        }
      }
    }
    // forward pass
    let s = s0, lp = L.reduce((bi, v, i) => (Math.abs(v - P.b) < Math.abs(L[bi] - P.b) ? i : bi), 0);
    const opt = [];
    for (let t = 0; t < H; t++) {
      let best = Infinity, bl = 0;
      for (const li of allowed(t, lp)) { const r = stepCost(t, s, li); const v = r.c + interp(t + 1, r.ns / ds, li); if (v < best) { best = v; bl = li; } }
      opt.push(L[bl]); s = stepCost(t, s, bl).ns; lp = bl;
    }
    return { opt, ms: performance.now() - t0, states: H * NS * NL * NL, levels: NL };
  }

  function proposals(base, opt) {
    const out = []; let cur = null;
    for (let t = 0; t < H; t++) {
      const d = opt[t] - base[t]; const sign = Math.abs(d) < 0.01 ? 0 : Math.sign(d);
      if (sign && cur && cur.sign === sign && cur.to === t) { cur.to = t + 1; cur.d.push(d); }
      else if (sign) { cur = { sign, from: t, to: t + 1, d: [d] }; out.push(cur); }
      else cur = null;
    }
    return out.map((p) => ({ ...p, key: p.from + "-" + p.to }));
  }

  function compute() {
    const P = params();
    const base = P.maxL.map((m) => Math.min(P.b, m));
    const sol = solve(P);
    const props = proposals(base, sol.opt);
    const approved = (p) => !rejected.has(p.key);
    const schedule = (rej) => base.map((b, t) => { const p = props.find((q) => t >= q.from && t < q.to); return p && !rej(p) ? sol.opt[t] : b; });
    const applied = schedule((p) => !approved(p));
    const sBase = simulate(base, P), sApp = simulate(applied, P), sOpt = simulate(sol.opt, P);
    props.forEach((p) => {   // value of approving p vs rejecting it, holding every other decision fixed
      const asApproved = simulate(schedule((q) => (q.key === p.key ? false : !approved(q))), P);
      const asRejected = simulate(schedule((q) => (q.key === p.key ? true : !approved(q))), P);
      p.value = asRejected.total - asApproved.total;
      p.shortIfRejected = asRejected.unmet > asApproved.unmet + 0.05 || asRejected.deficit > asApproved.deficit + 0.5;
      p.avgDelta = d3.mean(p.d);
      p.price = d3.mean(prices.slice(p.from, p.to));
      p.mwh = d3.sum(sol.opt.slice(p.from, p.to).map((v, i) => power(v) - power(base[p.from + i])));
    });
    model = { P, base, opt: sol.opt, applied, sBase, sApp, sOpt, props, sol };
  }

  /* ---------- DOM ---------- */
  const ids = (n) => `${hashId}-${n}`;
  const slider = (key, label, min, max, step, unit, hint) => {
    const input = el("input", { type: "range", id: ids(key), min, max, step, value: st[key] });
    const out = el("output", { for: ids(key) });
    const sync = () => { out.textContent = input.value + unit; paintRange(input); };
    input.addEventListener("input", () => { st[key] = +input.value; sync(); rejected.clear(); update(); });
    sync();
    return { node: el("div", { class: "ctl" }, el("label", { for: ids(key) }, label, out), input, hint ? el("small", { text: hint }) : null), input, sync };
  };
  const sl = {
    tank: slider("tank", "Liquid storage", 2, 36, 1, " h", "Hours of full-rate output the tank can hold. More storage = more freedom to shift."),
    min: slider("min", "Minimum turn-down", 40, 90, 1, " %", "Lowest stable load. Lower = more room to ride out expensive hours."),
    dem: slider("dem", "Product demand", 70, 95, 1, " %", "Average customer pull as a share of nominal capacity."),
    ramp: slider("ramp", "Ramp limit", 10, 100, 5, " %/h", "Largest load change allowed between hours."),
  };
  const presetBtns = Object.entries(PRESETS).map(([k, v]) => el("button", { class: "chip", type: "button", "aria-pressed": String(st.p === k), dataset: { p: k }, text: v.label }));
  const evBtns = [["s", "Medical O₂ surge · 09–15h"], ["d", "Derate cap 80% · 12–20h"]].map(([k, t]) =>
    el("button", { class: "chip", type: "button", "aria-pressed": String(st.ev.includes(k)), dataset: { ev: k }, text: t }));

  const svgHost = el("div", { class: "chart-host" });
  const kpiHost = el("div", { class: "kpis" });
  const propHost = el("div", { class: "proposals" });
  const logHost = el("div", { class: "agent-log", role: "log", "aria-live": "polite" });
  const tableHost = el("div", { class: "tbl-wrap" });
  const approveAll = el("button", { class: "btn btn--sm", type: "button", text: "Approve all" });
  const rejectAll = el("button", { class: "btn btn--sm", type: "button", text: "Reject all" });
  const resetBtn = el("button", { class: "btn btn--sm", type: "button", text: "Reset prices" });
  const shareBtn = el("button", { class: "btn btn--sm", type: "button", text: "Copy scenario link" });
  const pngBtn = el("button", { class: "btn btn--sm", type: "button", text: "Download PNG" });

  const legend = el("div", { class: "legend" },
    el("span", {}, el("i", { style: "background:var(--c2)" }), "Price (drag the dots)"),
    el("span", {}, el("i", { style: "background:var(--muted)" }), "Baseline: runs flat, ignores price"),
    el("span", {}, el("i", { style: "background:var(--accent)" }), "Applied plan (what you approved)"),
    el("span", {}, el("i", { class: "fill", style: "background:var(--accent);opacity:.35" }), "Extra output"),
    el("span", {}, el("i", { class: "fill", style: "background:var(--brass);opacity:.45" }), "Turned down"));

  root.replaceChildren(
    el("div", { class: "lab-grid" },
      kpiHost,
      el("div", { class: "chart-card" },
        el("div", { class: "scenario-bar" },
          el("div", { class: "seg", role: "group", "aria-label": "Price scenario" }, ...presetBtns),
          el("div", { class: "seg", role: "group", "aria-label": "Events" }, ...evBtns)),
        el("div", { class: "chart-title" }, el("h4", { text: "One day, hour by hour" }), el("span", { text: "Hover for values · drag the orange dots to rewrite the market" })),
        legend, svgHost),
      el("div", { class: "panel controls" },
        el("h4", {}, "Plant"),
        sl.tank.node, sl.min.node, sl.dem.node, sl.ramp.node,
        el("p", { class: "lab-note", text: "A simplified model: a 20 MW liquid-producing plant (22 t/h at full load) running on sample prices, built to show the method." })),
      el("div", { class: "panel" },
        el("h4", {}, el("span", { text: "Agent proposals · a human decides" }), el("span", { class: "btn-row" }, approveAll, rejectAll)),
        el("p", { class: "lab-note", style: "margin-bottom:.7rem", text: "Proposals are linked through the storage tank, so their values add up to more than the total saving: rejecting a charging block can make a later cut unsafe. Try it." }),
        propHost),
      el("div", { class: "panel" }, el("h4", { text: "Agent log (computed live)" }), logHost),
      el("div", { class: "lab-foot" }, shareBtn, pngBtn, resetBtn,
        el("span", { class: "note", text: "The same dynamic-programming idea scales from this toy to a fleet; real plants add compressor maps, purity, argon and customer logistics." })),
      el("details", { class: "how" }, el("summary", { text: "How the optimiser works" }),
        el("div", { class: "body" },
          el("p", {}, "State = (tank level, previous load). For each hour, working backward from midnight, every state picks the load that minimises ",
            el("span", { class: "code", text: "price × power(load) + penalties + cost-to-go" }), ", with the tank level interpolated between 61 grid points. A forward pass then reads off the schedule."),
          el("p", {}, "Constraints: minimum turn-down, an hourly ramp limit, an optional derate cap, tank bounds (venting and unmet demand carry heavy penalties) and a refill target with a steep penalty. Power draw is ",
            el("span", { class: "code", text: "20 MW × (0.12 + 0.88 × load)" }), ", so running at low load is less efficient per tonne — that is why shifting is not free."),
          el("p", {}, "The tank must end the day at least as full as it started; surplus earns no credit, so savings cannot come from borrowing against tomorrow. Rejecting a proposal removes just that block and the tank is re-simulated, so you see what each human decision costs or protects."))),
      el("details", { class: "how" }, el("summary", { text: "View as table" }), el("div", { class: "body" }, tableHost))));

  /* ---------- rendering ---------- */
  let W = 0;
  const svg = d3.select(svgHost).append("svg").attr("role", "img").attr("tabindex", 0);
  const svgNode = svg.node();
  let sc = null;

  function layout(w) {
    const narrow = w < 560;
    const m = { l: narrow ? 38 : 46, r: narrow ? 8 : 14 };
    const hs = narrow ? [118, 104, 90] : [150, 128, 112];
    const gap = 30, top = 22, axisH = 24;
    const ys = [top]; ys.push(ys[0] + hs[0] + gap); ys.push(ys[1] + hs[1] + gap);
    return { m, hs, ys, h: ys[2] + hs[2] + axisH + 6, x: d3.scaleLinear().domain([0, 24]).range([m.l, w - m.r]) };
  }

  function render() {
    if (!W || !model) return;
    const { P, base, opt, applied, sBase, sApp, props } = model;
    const g = layout(W); sc = g;
    svg.attr("width", W).attr("height", g.h).attr("viewBox", `0 0 ${W} ${g.h}`);
    svg.selectAll("*").remove();
    const x = g.x;
    const pMin = Math.min(0, d3.min(prices) - 5), pMax = Math.max(60, d3.max(prices) * 1.12);
    const yP = d3.scaleLinear().domain([pMin, pMax]).range([g.ys[0] + g.hs[0], g.ys[0]]);
    const yL = d3.scaleLinear().domain([P.minL * 100 - 8 < 30 ? 30 : Math.floor((P.minL * 100 - 8) / 5) * 5, 105]).range([g.ys[1] + g.hs[1], g.ys[1]]);
    const yT = d3.scaleLinear().domain([0, 100]).range([g.ys[2] + g.hs[2], g.ys[2]]);
    sc.yP = yP; sc.yL = yL; sc.yT = yT;

    const panel = (y0, hh, scale, ticks, title, fmtTick) => {
      svg.append("g").attr("class", "ax gridl").attr("transform", `translate(${g.m.l},0)`)
        .call(d3.axisLeft(scale).tickValues(ticks).tickSize(-(W - g.m.l - g.m.r)).tickFormat(""));
      svg.append("g").attr("class", "ax noline").attr("transform", `translate(${g.m.l},0)`).call(d3.axisLeft(scale).tickValues(ticks).tickSize(0).tickPadding(8).tickFormat(fmtTick)).select(".domain").remove();
      svg.append("text").attr("class", "ax-title").attr("x", g.m.l).attr("y", y0 - 9).text(title);
    };
    const nice = (s, n) => s.ticks(n);
    panel(g.ys[0], g.hs[0], yP, nice(yP, 4), `DAY-AHEAD PRICE · $/MWh · thin line = day average $${d3.mean(prices).toFixed(0)}`, (v) => v);
    panel(g.ys[1], g.hs[1], yL, [yL.domain()[0] < 50 ? 50 : yL.domain()[0], 75, 100].filter((v, i, a) => a.indexOf(v) === i && v >= yL.domain()[0]), "PLANT LOAD · % of nominal", (v) => v);
    panel(g.ys[2], g.hs[2], yT, [0, 50, 100], "LIQUID STORAGE · % full", (v) => v);

    // x axis
    const step = W < 560 ? 6 : 3;
    svg.append("g").attr("class", "ax").attr("transform", `translate(0,${g.ys[2] + g.hs[2]})`)
      .call(d3.axisBottom(x).tickValues(d3.range(0, 25, step)).tickSize(4).tickFormat((h) => fmt.hh(h))).select(".domain").attr("stroke", "var(--chart-axis)");
    // light vertical hour guides on all panels
    svg.append("g").selectAll("line").data(d3.range(0, 25, step)).join("line").attr("x1", (h) => x(h)).attr("x2", (h) => x(h)).attr("y1", g.ys[0]).attr("y2", g.ys[2] + g.hs[2]).attr("stroke", "var(--chart-grid)").attr("opacity", 0.5);

    // price: avg rule + step line + area wash
    const avgP = d3.mean(prices);
    svg.append("line").attr("x1", g.m.l).attr("x2", W - g.m.r).attr("y1", yP(avgP)).attr("y2", yP(avgP)).attr("stroke", "var(--c2)").attr("stroke-opacity", 0.35).attr("stroke-width", 1);
    const stepLine = d3.line().x((d) => x(d[0])).y((d) => d[1]).curve(d3.curveStepAfter);
    const pPts = prices.map((p, h) => [h, yP(p)]).concat([[24, yP(prices[H - 1])]]);
    svg.append("path").attr("d", d3.area().x((d) => x(d[0])).y0(yP(Math.max(pMin, 0))).y1((d) => d[1]).curve(d3.curveStepAfter)(pPts)).attr("fill", "var(--c2)").attr("fill-opacity", 0.1);
    svg.append("path").attr("d", stepLine(pPts)).attr("fill", "none").attr("stroke", "var(--c2)").attr("stroke-width", 2).attr("stroke-linejoin", "round");
    if (pMin < 0) svg.append("line").attr("x1", g.m.l).attr("x2", W - g.m.r).attr("y1", yP(0)).attr("y2", yP(0)).attr("stroke", "var(--chart-axis)");

    // load: wash rects, ghost, baseline, applied
    const lw = (v) => yL(v * 100);
    d3.range(H).forEach((h) => {
      const a = applied[h], b = base[h]; if (Math.abs(a - b) < 1e-4) return;
      svg.append("rect").attr("x", x(h)).attr("width", x(h + 1) - x(h)).attr("y", Math.min(lw(a), lw(b))).attr("height", Math.abs(lw(a) - lw(b)))
        .attr("fill", a > b ? "var(--accent)" : "var(--brass)").attr("fill-opacity", a > b ? 0.22 : 0.3);
    });
    const loadLine = (arr) => d3.line().x((d) => x(d[0])).y((d) => lw(d[1])).curve(d3.curveStepAfter)(arr.map((v, h) => [h, v]).concat([[24, arr[H - 1]]]));
    if (rejected.size) svg.append("path").attr("d", loadLine(opt)).attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-opacity", 0.35).attr("stroke-width", 1.5);
    svg.append("path").attr("d", loadLine(base)).attr("fill", "none").attr("stroke", "var(--muted)").attr("stroke-width", 2);
    svg.append("path").attr("d", loadLine(applied)).attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 2).attr("stroke-linejoin", "round");
    svg.append("text").attr("class", "ax-title").attr("x", W - g.m.r).attr("y", lw(1) - 5).attr("text-anchor", "end").text("100 %");

    // tank
    const tl = (arr) => d3.line().x((d, i) => x(i)).y((d) => yT((d / P.S) * 100))(arr);
    svg.append("rect").attr("x", g.m.l).attr("width", W - g.m.l - g.m.r).attr("y", yT(10)).attr("height", yT(0) - yT(10)).attr("fill", "var(--crit)").attr("fill-opacity", 0.06);
    svg.append("path").attr("d", tl(sBase.tank)).attr("fill", "none").attr("stroke", "var(--muted)").attr("stroke-width", 2);
    svg.append("path").attr("d", tl(sApp.tank)).attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 2).attr("stroke-linejoin", "round");
    svg.append("text").attr("class", "ax-title").attr("x", W - g.m.r).attr("y", yT(10) - 4).attr("text-anchor", "end").text("low-level zone");

    // price handles (drawn last so they sit on top)
    const hg = svg.append("g").attr("class", "handles");
    prices.forEach((p, h) => {
      const gx = x(h + 0.5), gy = yP(p);
      const n = hg.append("g").attr("class", "pt-handle" + (drag === h ? " drag" : "")).attr("transform", `translate(${gx},${gy})`).attr("data-h", h)
        .attr("role", "slider").attr("aria-label", `Price at ${fmt.hh(h)}`).attr("aria-valuenow", Math.round(p));
      n.append("circle").attr("class", "hit").attr("r", 16).style("touch-action", "none");
      n.append("circle").attr("class", "vis").attr("r", drag === h ? 7 : 4.5);
    });

    // hover layer
    const hov = svg.append("g").attr("class", "hover").style("pointer-events", "none");
    hov.append("line").attr("class", "xhair hl").attr("y1", g.ys[0]).attr("y2", g.ys[2] + g.hs[2]).style("display", "none");
    svg.append("title").text("Hourly price, plant load and storage level for one day");
    updateHover();
  }

  const hourAt = (clientX) => {
    const r = svgNode.getBoundingClientRect(); const px = clientX - r.left;
    return clamp(Math.floor(sc.x.invert(px)), 0, H - 1);
  };
  function updateHover(ev) {
    if (!sc) return;
    const line = svg.select(".xhair");
    if (hoverH == null) { line.style("display", "none"); tip.hide(); return; }
    const h = hoverH, xm = sc.x(h + 0.5);
    line.style("display", null).attr("x1", xm).attr("x2", xm);
    const { sBase, sApp, applied, base, P } = model;
    const pos = ev ? [ev.clientX, ev.clientY] : (() => { const r = svgNode.getBoundingClientRect(); return [r.left + xm, r.top + 40]; })();
    tip.show(tip.rows(`${fmt.hh(h)} – ${fmt.hh(h + 1)}`, "Hour", [
      { color: "var(--c2)", label: "Price", value: "$" + prices[h].toFixed(0) + "/MWh" },
      { color: "var(--muted)", label: "Baseline load", value: (base[h] * 100).toFixed(0) + " %" },
      { color: "var(--accent)", label: "Applied load", value: (applied[h] * 100).toFixed(0) + " %" },
      { color: "var(--muted)", label: "Tank · baseline", value: ((sBase.tank[h + 1] / P.S) * 100).toFixed(0) + " %" },
      { color: "var(--accent)", label: "Tank · applied", value: ((sApp.tank[h + 1] / P.S) * 100).toFixed(0) + " %" },
    ]), ...pos);
  }

  /* pointer handling: hover + drag price dots */
  const move = rafThrottle((e) => {
    if (drag != null) {
      const r = svgNode.getBoundingClientRect(); const py = e.clientY - r.top;
      prices[drag] = Math.round(clamp(sc.yP.invert(py), -60, 420) * 2) / 2;
      st.p = "custom"; custom = true; rejected.clear(); syncPresets(); update(true); return;
    }
    hoverH = hourAt(e.clientX); updateHover(e);
  });
  svgNode.addEventListener("pointerdown", (e) => {
    const hnd = e.target.closest?.(".pt-handle"); if (!hnd) return;
    drag = +hnd.dataset.h; svgNode.setPointerCapture(e.pointerId); e.preventDefault(); tip.hide(); hoverH = null;
  });
  svgNode.addEventListener("pointermove", move);
  const endDrag = () => { if (drag != null) { drag = null; update(); } };
  svgNode.addEventListener("pointerup", endDrag); svgNode.addEventListener("pointercancel", endDrag);
  svgNode.addEventListener("pointerleave", () => { if (drag == null) { hoverH = null; updateHover(); } });
  svgNode.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { hoverH = clamp((hoverH ?? 0) + (e.key === "ArrowRight" ? 1 : -1), 0, H - 1); updateHover(); e.preventDefault(); }
    if (e.key === "Escape") { hoverH = null; updateHover(); }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && hoverH != null) { prices[hoverH] += e.key === "ArrowUp" ? 5 : -5; st.p = "custom"; custom = true; rejected.clear(); syncPresets(); update(true); e.preventDefault(); }
  });

  /* ---------- panels ---------- */
  function renderKpis() {
    const { sBase, sApp, sOpt, P } = model;
    const save = sBase.total - sApp.total, pct = sBase.total > 0 ? save / sBase.total : 0;
    const bad = sApp.unmet > 0.05 || sApp.deficit > 0.5;
    const avg = (s) => s.energy / d3.sum(s.pw);
    const k = (cls, lab, val, small) => el("div", { class: "kpi " + cls }, el("span", { text: lab }), el("b", { class: val.length > 12 ? "txt" : "", text: val }), el("small", { text: small }));
    kpiHost.replaceChildren(
      k("", "Baseline day", fmt.usd(sBase.total), `avg paid $${avg(sBase).toFixed(1)}/MWh · ${fmt.n0(d3.sum(sBase.pw))} MWh`),
      k("", "With approved plan", fmt.usd(sApp.total), `avg paid $${avg(sApp).toFixed(1)}/MWh · ${fmt.n0(d3.sum(sApp.pw))} MWh`),
      k(save >= 0 ? "good" : "bad", "Saved", (save >= 0 ? "" : "−") + fmt.usd(Math.abs(save)), `${(pct * 100).toFixed(1)}% of baseline · agent's full proposal: ${fmt.usd(sBase.total - sOpt.total)}`),
      k(bad ? "bad" : "good", "Service", sApp.unmet > 0.05 ? `${sApp.unmet.toFixed(1)} t unmet` : sApp.deficit > 0.5 ? `Ends ${sApp.deficit.toFixed(0)} t short` : "All demand served", bad ? "A rejected step breaks the plan: the tank runs short or ends the day empty." : `Tank stays within ${(Math.min(...sApp.tank) / P.S * 100).toFixed(0)}–${(Math.max(...sApp.tank) / P.S * 100).toFixed(0)} %`));
  }

  const key2label = (p) => `${fmt.hh(p.from)}–${fmt.hh(p.to)}`;
  function renderProps() {
    const { props } = model;
    if (!props.length) { propHost.replaceChildren(el("p", { class: "lab-note", text: "The optimiser found nothing worth changing for this scenario: the price curve is too flat, or storage is too small to shift anything. Try a spikier preset or more storage." })); return; }
    propHost.replaceChildren(...props.map((p) => {
      const ok = !rejected.has(p.key);
      const up = p.sign > 0;
      const target = (model.opt[p.from] * 100).toFixed(0);
      const what = `${up ? "Raise" : "Cut"} load to ~${target} % (${up ? "+" : "−"}${Math.abs(p.avgDelta * 100).toFixed(0)} pts)`;
      const worth = Math.abs(p.value) < 5 ? "about $0" : (p.value < 0 ? "−" : "") + fmt.usd(Math.abs(p.value));
      const why = `$${p.price.toFixed(0)}/MWh here (day avg $${d3.mean(prices).toFixed(0)}) · ${p.mwh >= 0 ? "+" : "−"}${Math.abs(p.mwh).toFixed(0)} MWh · worth ${worth} to approve, given your other decisions${p.shortIfRejected ? " · without it the tank runs short" : ""}`;
      const row = el("div", { class: "prop " + (ok ? "ok" : "no") },
        el("div", { class: "hrs", text: key2label(p) }),
        el("div", { class: "what", text: what }),
        el("div", { class: "gate", role: "group", "aria-label": "Human decision " + key2label(p) },
          el("button", { type: "button", "aria-pressed": String(ok), text: "Approve", onclick: () => { rejected.delete(p.key); update(); } }),
          el("button", { type: "button", class: "rej", "aria-pressed": String(!ok), text: "Reject", onclick: () => { rejected.add(p.key); update(); } })),
        el("div", { class: "why", text: why }));
      return row;
    }));
  }

  function renderLog() {
    const { P, sol, props, sApp } = model;
    const pr = prices.map((v, h) => [v, h]);
    const lo = d3.least(pr, (d) => d[0]), hi = d3.greatest(pr, (d) => d[0]);
    const dMax = d3.greatest(P.dem.map((v, h) => [v, h]), (d) => d[0]);
    const ap = props.filter((p) => !rejected.has(p.key)).length;
    const row = (who, msg, cls) => el("div", { class: cls || "" }, el("b", { text: who }), el("span", { text: msg }));
    const lines = [
      row("PriceWatcher", `curve loaded: low $${lo[0].toFixed(0)} at ${fmt.hh(lo[1])}, high $${hi[0].toFixed(0)} at ${fmt.hh(hi[1])}, spread $${(hi[0] - lo[0]).toFixed(0)}/MWh${custom ? " (edited by you)" : ""}`),
      row("DemandForecaster", `average pull ${d3.mean(P.dem).toFixed(1)} t/h, peak ${dMax[0].toFixed(1)} t/h at ${fmt.hh(dMax[1])}${P.surge ? " · medical O₂ surge injected" : ""}`),
      row("PlantGuard", `turn-down ≥ ${(P.minL * 100).toFixed(0)} %, ramp ≤ ${(P.ramp * 100).toFixed(0)} %/h, tank ${P.S.toFixed(0)} t${P.derate ? ", derate cap 80 % 12–20h" : ""}`),
      row("Optimiser", `${fmt.n0(sol.states)} state-action pairs solved by dynamic programming in ${sol.ms.toFixed(1)} ms`),
    ];
    if (sApp.unmet > 0.05) lines.push(row("PlantGuard", `ALERT ${sApp.unmet.toFixed(1)} t of demand would go unserved under the approved plan`, "warn"));
    if (sApp.vent > 0.05) lines.push(row("PlantGuard", `${sApp.vent.toFixed(1)} t would be vented (tank full)`, "warn"));
    lines.push(row("Governance", props.length ? `${props.length} change${props.length > 1 ? "s" : ""} proposed · ${ap} approved · ${props.length - ap} rejected. Nothing runs without a human decision.` : "no changes proposed", "gate-l"));
    logHost.replaceChildren(...lines);
  }

  function renderTable() {
    const { base, applied, sBase, sApp, P } = model;
    const th = (t) => el("th", { text: t });
    tableHost.replaceChildren(el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["Hour", "Price $/MWh", "Baseline load %", "Applied load %", "Tank base %", "Tank applied %"].map(th))),
      el("tbody", {}, d3.range(H).map((h) => el("tr", {}, [fmt.hh(h), prices[h].toFixed(1), (base[h] * 100).toFixed(0), (applied[h] * 100).toFixed(0), (sBase.tank[h + 1] / P.S * 100).toFixed(0), (sApp.tank[h + 1] / P.S * 100).toFixed(0)].map((v) => el("td", { text: v })))))));
  }

  function syncPresets() { presetBtns.forEach((b) => b.setAttribute("aria-pressed", String(st.p === b.dataset.p))); }
  const stateParams = () => {
    const o = { p: st.p, tank: st.tank, min: st.min, dem: st.dem, ramp: st.ramp };
    if (st.ev) o.ev = st.ev; if (st.p === "custom") o.pr = prices.map((v) => Math.round(v * 2) / 2).join(","); if (rejected.size) o.rej = [...rejected].join(",");
    return o;
  };
  const persist = rafThrottle(() => setHash(hashId, stateParams()));

  function update(fast) {
    compute(); render(); renderKpis(); if (!fast) { renderProps(); renderLog(); renderTable(); } else { renderProps(); renderLog(); }
    persist();
  }

  presetBtns.forEach((b) => b.addEventListener("click", () => { st.p = b.dataset.p; prices = curve(PRESETS[st.p].pts); custom = false; rejected.clear(); syncPresets(); update(); }));
  evBtns.forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.ev; st.ev = st.ev.includes(k) ? st.ev.replace(k, "") : st.ev + k; b.setAttribute("aria-pressed", String(st.ev.includes(k))); rejected.clear(); update();
  }));
  approveAll.addEventListener("click", () => { rejected.clear(); update(); });
  rejectAll.addEventListener("click", () => { model.props.forEach((p) => rejected.add(p.key)); update(); });
  resetBtn.addEventListener("click", () => { st = { ...DEFAULTS }; Object.values(sl).forEach((s) => { s.input.value = st[s.input.id.replace(hashId + "-", "")]; s.sync(); }); prices = curve(PRESETS[st.p].pts); custom = false; rejected.clear(); evBtns.forEach((b) => b.setAttribute("aria-pressed", "false")); syncPresets(); update(); });
  shareBtn.addEventListener("click", () => copyText(shareURL(hashId, stateParams())));
  pngBtn.addEventListener("click", () => exportPNG(svgNode, { title: "ASU load-shifting · one synthetic day", sub: `${PRESETS[st.p]?.label || "Custom prices"} · storage ${st.tank} h · turn-down ${st.min}% · saved ${fmt.usd(model.sBase.total - model.sApp.total)} (${((model.sBase.total - model.sApp.total) / model.sBase.total * 100).toFixed(1)}%)`, filename: "asu-load-shifting.png" }));

  onResize(svgHost, (w) => { W = w; render(); });
  update();
  return { refresh: () => { W = svgHost.clientWidth; render(); } };
}
