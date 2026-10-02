// Shared helpers: safe DOM building, tooltip, hash state, resize, PNG export.
// All text is inserted with textContent — dataset strings are never parsed as HTML.

export const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function el(tag, attrs = {}, ...kids) {
  const n = tag === "svg" || tag === "g" || tag === "path" || tag === "circle" || tag === "line" || tag === "text" || tag === "rect"
    ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.setAttribute("class", v);
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const rafThrottle = (fn) => { let q = false, last; return (...a) => { last = a; if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...last); }); }; };

export const fmt = {
  usd: (v) => (v < 0 ? "−" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US"),
  usdK: (v) => { const a = Math.abs(v); return (v < 0 ? "−" : "") + "$" + (a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "k" : a.toFixed(0)); },
  n0: (v) => Math.round(v).toLocaleString("en-US"),
  n1: (v) => (Math.round(v * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  pct: (v, d = 0) => (v * 100).toFixed(d) + "%",
  si: (v) => { const a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(2) + "B" : a >= 1e6 ? (v / 1e6).toFixed(2) + "M" : a >= 1e3 ? (v / 1e3).toFixed(1) + "k" : v.toFixed(0); },
  hh: (h) => String(Math.floor(h) % 24).padStart(2, "0") + ":00",
};

/* ---------- tooltip (one instance) ---------- */
let tipEl;
function ensureTip() {
  if (!tipEl) { tipEl = el("div", { class: "tip", role: "tooltip", "aria-hidden": "true" }); document.body.append(tipEl); }
  return tipEl;
}
export const tip = {
  show(content, x, y) {
    const t = ensureTip();
    t.replaceChildren(...[].concat(content));
    t.classList.add("on");
    const pad = 14, r = t.getBoundingClientRect();
    let lx = x + pad, ly = y + pad;
    if (lx + r.width > innerWidth - 8) lx = x - r.width - pad;
    if (ly + r.height > innerHeight - 8) ly = y - r.height - pad;
    t.style.left = Math.max(8, lx) + "px";
    t.style.top = Math.max(8, ly) + "px";
  },
  hide() { if (tipEl) tipEl.classList.remove("on"); },
  rows(title, sub, rows) {
    return [
      sub ? el("span", { class: "t-sub", text: sub }) : null,
      title ? el("b", { text: title }) : null,
      ...(rows || []).map((r) => el("div", { class: "t-row" },
        el("span", {}, r.color ? el("i", { style: `background:${r.color}` }) : null, r.label),
        el("strong", { text: r.value }))),
    ];
  },
};

/* ---------- toast ---------- */
let toastEl, toastT;
export function toast(msg) {
  if (!toastEl) { toastEl = el("div", { class: "toast", role: "status", "aria-live": "polite" }); document.body.append(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2200);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Link copied"); return true; }
  catch { const ta = el("textarea", { style: "position:fixed;opacity:0" }); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand("copy"); toast("Link copied"); } catch { toast("Copy failed — select the address bar"); } ta.remove(); }
}

/* ---------- observe size / visibility ---------- */
export function onResize(node, fn) {
  let w = 0;
  const ro = new ResizeObserver(rafThrottle(() => { const nw = Math.round(node.clientWidth); if (nw && nw !== w) { w = nw; fn(nw); } }));
  ro.observe(node);
  return () => ro.disconnect();
}
export function onVisible(node, fn, opts = { threshold: 0.15 }) {
  const io = new IntersectionObserver((es) => es.forEach((e) => fn(e.isIntersecting)), opts);
  io.observe(node); return () => io.disconnect();
}

/* ---------- shareable state in the URL hash:  #lab-asu?tank=12&p=duck ---------- */
export function hashParams(prefix) {
  const h = decodeURIComponent(location.hash.slice(1));
  const [id, q] = h.split("?");
  if (prefix && id !== prefix) return null;
  return Object.fromEntries(new URLSearchParams(q || ""));
}
export function setHash(id, params) {
  const q = new URLSearchParams(params).toString();
  history.replaceState(null, "", `#${id}${q ? "?" + q : ""}`);
}
export function shareURL(id, params) {
  const u = new URL(location.href); u.hash = `${id}?${new URLSearchParams(params).toString()}`; return u.toString();
}

/* ---------- theme colours (for exports) ---------- */
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- PNG export of an SVG chart ---------- */
const STYLE_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "opacity", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "letter-spacing", "paint-order", "display", "visibility"];
function inlineStyles(src, dst) {
  const cs = getComputedStyle(src);
  let s = "";
  for (const p of STYLE_PROPS) s += `${p}:${cs.getPropertyValue(p)};`;
  dst.setAttribute("style", s);
  for (let i = 0; i < src.children.length; i++) if (dst.children[i]) inlineStyles(src.children[i], dst.children[i]);
}
let fontCss;
async function embeddedFonts() {
  if (fontCss !== undefined) return fontCss;
  const files = [["Archivo", "400 900", "archivo-latin-wght-normal.woff2"], ["IBM Plex Mono", "400", "ibm-plex-mono-latin-400-normal.woff2"]];
  try {
    const base = new URL("../fonts/", import.meta.url);
    const parts = await Promise.all(files.map(async ([fam, wt, f]) => {
      const buf = await (await fetch(new URL(f, base))).arrayBuffer();
      let bin = ""; new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
      return `@font-face{font-family:"${fam}";font-weight:${wt};src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2")}`;
    }));
    fontCss = parts.join("");
  } catch { fontCss = ""; }
  return fontCss;
}
export async function exportPNG(svg, { title = "", sub = "", filename = "chart.png", credit = "Sai Suraj Karra · interactive lab" } = {}) {
  const w = Math.round(svg.getBoundingClientRect().width), h = Math.round(svg.getBoundingClientRect().height);
  const clone = svg.cloneNode(true);
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", w); clone.setAttribute("height", h);
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
  clone.querySelectorAll(".pt-handle,.hit,.xhair").forEach((n) => n.remove());
  const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
  styleEl.textContent = await embeddedFonts();
  clone.insertBefore(styleEl, clone.firstChild);
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  const img = new Image(); img.src = url; await img.decode();
  const sc = 2, pad = 28, head = title ? 74 : 12, foot = 38;
  const cv = el("canvas"); cv.width = (w + pad * 2) * sc; cv.height = (h + head + foot + pad) * sc;
  const g = cv.getContext("2d"); g.scale(sc, sc);
  g.fillStyle = cssVar("--surface") || "#fff"; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = cssVar("--ink"); g.textBaseline = "alphabetic";
  if (title) { g.font = '650 22px Archivo, system-ui, sans-serif'; g.fillText(title, pad, 38);
    g.font = '400 13px Archivo, system-ui, sans-serif'; g.fillStyle = cssVar("--muted"); g.fillText(sub, pad, 60); }
  g.drawImage(img, pad, head, w, h);
  g.font = '500 11px "IBM Plex Mono", ui-monospace, monospace'; g.fillStyle = cssVar("--muted"); g.fillText(credit, pad, h + head + 24);
  cv.toBlob((b) => { const a = el("a", { href: URL.createObjectURL(b), download: filename }); document.body.append(a); a.click(); a.remove(); toast("PNG saved"); }, "image/png");
}

/* ---------- slider fill ---------- */
export function paintRange(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty("--pct", p + "%");
}

export function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
