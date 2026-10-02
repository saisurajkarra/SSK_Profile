// Motion layer: GSAP + ScrollTrigger for choreography, Lenis for smooth scrolling.
// Every helper is a no-op (content stays visible and static) when the libraries are missing,
// the visitor prefers reduced motion, or the device has a coarse pointer where relevant.
const gsap = window.gsap, ST = window.ScrollTrigger;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
if (gsap && ST) gsap.registerPlugin(ST);
export const motionOK = () => !!gsap && !reduced();

let lenis = null;
const PREVENT = "[data-lenis-prevent], .drawer, .cmdk-box, .tbl-wrap, .agent-log, .brief-sheet, textarea, select";

/* ---------- smooth scrolling ---------- */
export function initSmoothScroll() {
  if (!window.Lenis || reduced() || !fine()) return null;
  lenis = new window.Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    anchors: { offset: -72 },
    prevent: (node) => !!node.closest?.(PREVENT),
  });
  if (gsap && ST) {
    lenis.on("scroll", ST.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    const loop = (t) => { lenis.raf(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  return lenis;
}
export function lockScroll(on) {
  if (lenis) on ? lenis.stop() : lenis.start();
  document.documentElement.style.overflow = on ? "hidden" : "";
}
export function scrollToEl(target, offset = -72) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { offset, duration: 1.2 });
  else el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
}

/* ---------- text split: wraps each word so it can slide up from a mask ---------- */
export function splitWords(node) {
  const walk = (n) => {
    [...n.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        const frag = document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(part); return; }
          const o = document.createElement("span"); o.className = "w";
          const i = document.createElement("span"); i.className = "wi"; i.textContent = part;
          o.append(i); frag.append(o);
        });
        n.replaceChild(frag, c);
      } else if (c.nodeType === 1) walk(c);
    });
  };
  walk(node);
  return node.querySelectorAll(".wi");
}

/* ---------- count-up: tweens every number inside an element's text ---------- */
export function countUp(node, { duration = 1.6, once = true } = {}) {
  if (!motionOK() || !ST) return;
  const original = node.textContent;
  const nums = [...original.matchAll(/\d+(?:\.\d+)?/g)];
  if (!nums.length) return;
  const render = (p) => {
    let i = 0;
    node.textContent = original.replace(/\d+(?:\.\d+)?/g, (m) => {
      const target = parseFloat(nums[i++][0]); const dec = (m.split(".")[1] || "").length;
      return (target * p).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    });
  };
  render(0);
  const o = { p: 0 };
  ST.create({ trigger: node, start: "top 100%", once, onEnter: () => gsap.to(o, { p: 1, duration, ease: "power3.out", onUpdate: () => render(o.p), onComplete: () => (node.textContent = original) }) });
}

/* ---------- scroll reveals (batched so siblings stagger) ---------- */
export function revealOnScroll(selector = ".reveal", { y = 28, stagger = 0.09 } = {}) {
  const items = [...document.querySelectorAll(selector)];
  if (!items.length) return;
  if (!motionOK() || !ST) { items.forEach((n) => n.classList.add("in")); return; }
  document.documentElement.classList.add("gsap-on");
  gsap.set(items, { opacity: 0, y });
  ST.batch(items, {
    start: "top 90%", once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.85, ease: "power3.out", stagger, overwrite: true, clearProps: "transform" }),
  });
}

/* ---------- hero intro timeline ---------- */
export function heroIntro({ kicker, title, lede, actions, stats, visual }) {
  if (!motionOK()) return;
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  const words = title ? splitWords(title) : [];
  if (kicker) tl.from(kicker, { opacity: 0, y: 14, duration: 0.6 }, 0);
  if (words.length) tl.from(words, { yPercent: 115, duration: 0.9, stagger: 0.045 }, 0.1);
  if (lede) tl.from(lede, { opacity: 0, y: 18, duration: 0.8 }, 0.55);
  if (actions) tl.from(actions, { opacity: 0, y: 14, duration: 0.6, stagger: 0.08 }, 0.7);
  if (stats) tl.from(stats, { opacity: 0, y: 16, duration: 0.6, stagger: 0.07 }, 0.85);
  if (visual) tl.from(visual, { opacity: 0, scale: 0.965, y: 24, duration: 1.1, ease: "power2.out" }, 0.25);
  return tl;
}

/* ---------- magnetic buttons (fine pointers only) ---------- */
export function magnetic(selector = ".btn--primary", strength = 0.28) {
  if (!motionOK() || !fine()) return;
  document.querySelectorAll(selector).forEach((b) => {
    const x = gsap.quickTo(b, "x", { duration: 0.4, ease: "power3.out" }), y = gsap.quickTo(b, "y", { duration: 0.4, ease: "power3.out" });
    b.addEventListener("pointermove", (e) => { const r = b.getBoundingClientRect(); x((e.clientX - (r.left + r.width / 2)) * strength); y((e.clientY - (r.top + r.height / 2)) * strength); });
    b.addEventListener("pointerleave", () => { x(0); y(0); });
  });
}

/* ---------- pointer-follow glow for a section ---------- */
export function pointerGlow(section) {
  if (!section || !fine() || reduced()) return;
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
  const loop = () => { x += (tx - x) * 0.08; y += (ty - y) * 0.08; section.style.setProperty("--mx", x + "px"); section.style.setProperty("--my", y + "px"); raf = requestAnimationFrame(loop); };
  section.addEventListener("pointerenter", () => { if (!raf) raf = requestAnimationFrame(loop); });
  section.addEventListener("pointermove", (e) => { const r = section.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top; });
  section.addEventListener("pointerleave", () => { cancelAnimationFrame(raf); raf = 0; });
}

/* ---------- reading progress bar ---------- */
export function scrollProgress(bar) {
  if (!bar || !motionOK() || !ST) return;
  gsap.set(bar, { scaleX: 0, transformOrigin: "0 50%" });
  gsap.to(bar, { scaleX: 1, ease: "none", scrollTrigger: { trigger: document.documentElement, start: "top top", end: "bottom bottom", scrub: 0.2 } });
}

/* ---------- slide a panel in when swapping steps/tabs ---------- */
export function swapIn(node, { y = 16, duration = 0.5 } = {}) {
  if (!motionOK()) return;
  gsap.fromTo(node, { opacity: 0, y }, { opacity: 1, y: 0, duration, ease: "power3.out", clearProps: "transform" });
}

/* ---------- tween a number inside a node when it changes (for calculators) ---------- */
const tweens = new WeakMap();
export function tweenNumber(node, value, format = (v) => Math.round(v).toLocaleString("en-US"), duration = 0.5) {
  if (!motionOK()) { node.textContent = format(value); return; }
  const prev = tweens.get(node) ?? { v: 0 };
  tweens.set(node, prev);
  gsap.to(prev, { v: value, duration, ease: "power2.out", overwrite: true, onUpdate: () => (node.textContent = format(prev.v)) });
}

export { gsap, ST };
