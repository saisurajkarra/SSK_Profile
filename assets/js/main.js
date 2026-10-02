import { el, $, $$, copyText, onVisible, reduceMotion, fmt, setHash } from "./util.js";
import { initSmoothScroll, scrollToEl, revealOnScroll, heroIntro, countUp, magnetic, pointerGlow, scrollProgress, swapIn } from "./motion.js";
import { mountGalaxy } from "./galaxy.js";
import { createDrawer } from "./drawer.js";
import { mountExplorer } from "./explorer.js";

const d3 = window.d3;
const MAIL = ["karra.saisuraj", "gmail.com"];
const mail = () => MAIL.join("@");

/* ---------- theme ---------- */
const root = document.documentElement;
const themeBtn = $("#theme-btn");
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>';
const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
function paintTheme() { $("#theme-icon").innerHTML = isDark() ? SUN : MOON; themeBtn.setAttribute("aria-label", isDark() ? "Switch to light theme" : "Switch to dark theme"); }
themeBtn.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark"; root.dataset.theme = next;
  try { localStorage.setItem("ssk-theme", next); } catch {}
  paintTheme();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintTheme);
paintTheme();
if (/Mac|iPhone|iPad/.test(navigator.platform)) $("#kbd-hint").textContent = "⌘ K";

/* ---------- mobile menu, topbar shadow ---------- */
const menu = $("#mobile-menu"), menuBtn = $("#menu-btn");
const setMenu = (open) => { menu.classList.toggle("open", open); menuBtn.setAttribute("aria-expanded", String(open)); };
menuBtn.addEventListener("click", () => setMenu(!menu.classList.contains("open")));
menu.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
const topbar = $(".topbar");
addEventListener("scroll", () => topbar.classList.toggle("scrolled", scrollY > 8), { passive: true });

/* ---------- contact ---------- */
$$("[data-mail]").forEach((a) => { a.href = "mailto:" + mail() + "?subject=" + encodeURIComponent("Hello from your portfolio"); });
const mt = $("[data-mail-text]"); if (mt) mt.textContent = mail();
$("#copy-mail")?.addEventListener("click", () => copyText(mail()).then(() => {}));

/* ---------- motion: smooth scroll, reveals, hero intro ---------- */
initSmoothScroll();
scrollProgress($("#progress"));
revealOnScroll(".reveal");
heroIntro({ kicker: $(".hero .kicker"), title: $("#h1"), lede: $(".hero .lede"), actions: $$(".hero .cta-row .btn"), stats: $$(".hero .stat"), visual: $(".galaxy-card") });
$$(".hero .stat b").forEach((n) => countUp(n));
magnetic(".btn--primary");
pointerGlow($(".hero"));

/* ---------- scrollspy ---------- */
const links = $$(".nav a");
const spy = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + e.target.id))); }), { rootMargin: "-45% 0px -50% 0px" });
$$("main section[id]").forEach((s) => spy.observe(s));

/* ---------- labs (lazy) ---------- */
const LABS = {
  "lab-asu": { root: "#lab-asu-root", load: () => import("./lab-asu.js").then((m) => m.mountAsuLab) },
  "lab-column": { root: "#lab-column-root", load: () => import("./lab-column.js").then((m) => m.mountColumnLab) },
  "lab-landfill": { root: "#lab-landfill-root", load: () => import("./lab-landfill.js").then((m) => m.mountLandfillLab) },
};
const mounted = new Set();
async function mountLab(id) {
  if (mounted.has(id)) return; mounted.add(id);
  const mount = await LABS[id].load(); mount($(LABS[id].root), { hashId: id });
}
function showLab(id, { updateHash = true } = {}) {
  $$(".tab").forEach((t) => { const on = t.dataset.lab === id; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
  $$(".lab").forEach((p) => { const on = p.id === id; p.classList.toggle("active", on); p.hidden = !on; });
  mountLab(id);
  swapIn($("#" + id), { y: 14 });
  if (updateHash && mounted.has(id)) setHash(id, {});
}
$$(".tab").forEach((t) => {
  t.addEventListener("click", () => { showLab(t.dataset.lab); window.dispatchEvent(new Event("resize")); });
  t.addEventListener("keydown", (e) => {
    const tabs = $$(".tab"), i = tabs.indexOf(t);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const n = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); n.click(); e.preventDefault(); }
  });
});
$("#lab-asu").classList.add("active");
onVisible($("#labs"), (v) => { if (v && !mounted.has("lab-asu") && !location.hash.startsWith("#lab-")) mountLab("lab-asu"); }, { threshold: 0, rootMargin: "300px" });

/* ---------- agents ring ---------- */
function agentsRing() {
  const svg = d3.select("#agents-ring"); if (svg.empty()) return;
  const N = 18, R = 108, c = 150;
  const pts = d3.range(N).map((i) => { const a = (i / N) * Math.PI * 2 - Math.PI / 2; return { i, x: c + Math.cos(a) * R, y: c + Math.sin(a) * R }; });
  svg.append("circle").attr("cx", c).attr("cy", c).attr("r", R).attr("fill", "none").attr("stroke", "var(--rule)");
  svg.selectAll("line").data(pts).join("line").attr("class", "a-link").attr("x1", (d) => d.x).attr("y1", (d) => d.y).attr("x2", c).attr("y2", c);
  const nodes = svg.selectAll("circle.a-node").data(pts).join("circle").attr("class", "a-node").attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", 7.5);
  svg.append("circle").attr("class", "gate").attr("cx", c).attr("cy", c).attr("r", 36);
  svg.append("text").attr("class", "gate-t").attr("x", c).attr("y", c - 3).attr("text-anchor", "middle").text("HUMAN");
  svg.append("text").attr("class", "gate-t").attr("x", c).attr("y", c + 9).attr("text-anchor", "middle").text("APPROVES");
  svg.append("text").attr("x", c).attr("y", 292).text("18 agents · prices · demand · plant state");
  if (reduceMotion()) return;
  let visible = true; onVisible(svg.node(), (v) => (visible = v));
  setInterval(() => {
    if (!visible || document.hidden) return;
    const d = pts[Math.floor(Math.random() * N)];
    nodes.filter((n) => n.i === d.i).classed("fire", false).each(function () { void this.getBBox(); }).classed("fire", true);
    const p = svg.insert("circle", ".gate").attr("class", "pkt").attr("r", 3).attr("cx", d.x).attr("cy", d.y);
    p.transition().duration(850).ease(d3.easeCubicIn).attr("cx", c).attr("cy", c).attr("r", 1.5).remove();
  }, 520);
}
agentsRing();

/* ---------- data-driven parts ---------- */
const data = await fetch("assets/data/projects.json").then((r) => r.json());
$$("[data-count]").forEach((n) => { n.textContent = data.meta[n.dataset.count]; });

let explorer, galaxy, tech;
const drawer = createDrawer(data, { onTag: (t) => filterTech(t), getList: () => explorer?.list() ?? data.projects });
const openProject = (id, sub) => { drawer.open(id, sub); galaxy?.select(id); };

function filterTech(t) { explorer.setTech(t); history.replaceState(null, "", "#projects"); scrollToEl($("#projects")); }

explorer = mountExplorer($("#explorer-root"), data, { onOpen: (id) => openProject(id), onFilter: (ids) => galaxy?.highlight(ids) });

/* galaxy + legend */
const legend = $("#galaxy-legend"), resetBtn = $("#galaxy-reset");
let focusedArea = null;
galaxy = mountGalaxy($("#galaxy-host"), data, {
  onSelect: (id) => openProject(id),
  onFocus: (n) => {
    focusedArea = n;
    resetBtn.classList.toggle("show", n != null);
    $$(".chip", legend).forEach((c) => c.setAttribute("aria-pressed", String(+c.dataset.n === n)));
  },
});
data.areas.forEach((a) => {
  const c = el("button", { class: "chip", type: "button", "aria-pressed": "false", dataset: { n: a.n }, title: a.long }, el("i", { text: String(a.n).padStart(2, "0") }), a.name);
  c.addEventListener("click", () => galaxy.focus(focusedArea === a.n ? null : a.n));
  legend.append(c);
});
resetBtn.addEventListener("click", () => galaxy.focus(null));

/* theme tiles filter the index */
$$("#themes .theme").forEach((b) => b.addEventListener("click", () => {
  explorer.setAreas([]); explorer.setQuery("");
  if (b.dataset.areas) explorer.setAreas(b.dataset.areas.split(",").map(Number)); else explorer.setQuery(b.dataset.q);
  scrollToEl($("#explorer-root"));
}));

/* tech constellation (lazy) */
let techMounted = false;
onVisible($("#stack"), async (v) => {
  if (!v || techMounted) return; techMounted = true;
  const { mountTech } = await import("./tech.js");
  tech = mountTech($("#tech-root"), data, { onTech: (t, fromBar) => { if (!fromBar) return; }, onProject: (id) => openProject(id) });
  window.__tech = tech;
}, { threshold: 0, rootMargin: "400px" });

/* ---------- command palette ---------- */
const cmd = { box: $("#cmdk"), input: $("#cmdk-input"), list: $("#cmdk-list"), items: [], sel: 0 };
const staticItems = [
  ["Work — what I've built", "Section", () => go("#work")], ["Labs — three models you can break", "Section", () => go("#labs")],
  ["Lab 01 · ASU agents & power prices", "Lab", () => go("#labs", "lab-asu")], ["Lab 02 · Distillation column", "Lab", () => go("#labs", "lab-column")], ["Lab 03 · Landfill gas forecast", "Lab", () => go("#labs", "lab-landfill")],
  ["Projects — everything else I've built", "Section", () => go("#projects")], ["Technology constellation", "Section", () => go("#stack")], ["How I can help", "Section", () => go("#help")],
  ["About & background", "Section", () => go("#about")], ["Contact", "Section", () => go("#contact")], ["Toggle light / dark theme", "Action", () => themeBtn.click()],
  ["Copy email address", "Action", () => copyText(mail())],
];
function go(sel, lab) { if (lab) { showLab(lab); } scrollToEl($(sel)); }
const all = () => staticItems.concat(data.projects.map((p) => [p.name, "Project · " + data.areas[p.n - 1].name, () => openProject(p.id), p.tagline + " " + p.tags.join(" ")]));
function renderCmd(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = all().map((it) => { const h = (it[0] + " " + (it[3] || "")).toLowerCase(); if (!terms.every((t) => h.includes(t))) return null; return [it, (it[0].toLowerCase().includes(terms[0] || "") ? 0 : 1) + (it[1].startsWith("Project") ? 1 : 0)]; })
    .filter(Boolean).sort((a, b) => a[1] - b[1]).slice(0, 40).map((x) => x[0]);
  cmd.items = scored; cmd.sel = 0;
  cmd.list.replaceChildren(...scored.map((it, i) => el("li", { role: "option", "aria-selected": String(i === 0), onclick: () => runCmd(i) }, el("span", { text: it[0] }), el("small", { text: it[1] }))));
  if (!scored.length) cmd.list.replaceChildren(el("li", { text: "No matches", style: "color:var(--muted);cursor:default" }));
}
function moveCmd(d) { const lis = $$("li[role=option]", cmd.list); if (!lis.length) return; lis[cmd.sel]?.setAttribute("aria-selected", "false"); cmd.sel = (cmd.sel + d + lis.length) % lis.length; lis[cmd.sel].setAttribute("aria-selected", "true"); lis[cmd.sel].scrollIntoView({ block: "nearest" }); }
function runCmd(i) { const it = cmd.items[i]; if (!it) return; closeCmd(); it[2](); }
let cmdOpener;
function openCmd() { cmdOpener = document.activeElement; cmd.box.classList.add("on"); cmd.box.setAttribute("aria-hidden", "false"); cmd.input.value = ""; renderCmd(""); cmd.input.focus(); }
function closeCmd() { cmd.box.classList.remove("on"); cmd.box.setAttribute("aria-hidden", "true"); cmdOpener?.focus?.(); }
$("#open-cmdk").addEventListener("click", openCmd);
cmd.input.addEventListener("input", () => renderCmd(cmd.input.value));
cmd.input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { moveCmd(1); e.preventDefault(); } else if (e.key === "ArrowUp") { moveCmd(-1); e.preventDefault(); } else if (e.key === "Enter") runCmd(cmd.sel); else if (e.key === "Escape") closeCmd(); });
cmd.box.addEventListener("click", (e) => { if (e.target === cmd.box) closeCmd(); });
addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); cmd.box.classList.contains("on") ? closeCmd() : openCmd(); }
  else if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !drawer.current) { e.preventDefault(); openCmd(); }
});

/* ---------- deep links ---------- */
function route() {
  const h = decodeURIComponent(location.hash.slice(1)), id = h.split("?")[0];
  if (id.startsWith("project/")) { const pid = id.slice(8); if (data.projects.some((p) => p.id === pid)) { openProject(pid); } return; }
  if (LABS[id]) { showLab(id, { updateHash: false }); requestAnimationFrame(() => scrollToEl($("#labs"))); }
}
addEventListener("hashchange", () => { if (!drawer.current || !location.hash.startsWith("#project/")) route(); });
route();
