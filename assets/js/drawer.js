// Project details drawer: accessible dialog (focus trap, Esc, scrim) rendering one project card.
import { el, $, $$ } from "./util.js";

// Status tags: In production · Working system · Prototype · Demo · Design · Reference
export const maturityClass = (m) => (/production|working system/i.test(m) ? "chip--status" : /prototype/i.test(m) ? "chip--pilot" : "chip--demo");

// "Label: sentence." -> [label, sentence]
function splitMove(s) {
  const i = s.indexOf(": ");
  return i > 0 && i < 60 ? [s.slice(0, i), s.slice(i + 2)] : ["", s];
}
const moveItem = (m) => { const [a, b] = splitMove(m); return el("li", {}, a ? el("b", { text: a + ". " }) : null, b); };

export function createDrawer(data, { onTag = () => {}, getList = () => data.projects } = {}) {
  const areaBy = Object.fromEntries(data.areas.map((a) => [a.n, a]));
  const scrim = el("div", { class: "scrim", "aria-hidden": "true" });
  const body = el("div", { class: "drawer-body", tabindex: "-1" });
  const prev = el("button", { class: "icon-btn", type: "button", "aria-label": "Previous project" }, "←");
  const next = el("button", { class: "icon-btn", type: "button", "aria-label": "Next project" }, "→");
  const share = el("button", { class: "icon-btn", type: "button", "aria-label": "Copy link to this project" }, "Link");
  const close = el("button", { class: "icon-btn", type: "button", "aria-label": "Close project details" }, "Close ✕");
  const crumb = el("span", { class: "mono", style: "font-size:11px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase" });
  const dlg = el("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Project details", "aria-hidden": "true" },
    el("div", { class: "drawer-head" }, el("div", { class: "nav-btns" }, prev, next), crumb, el("div", { class: "nav-btns" }, share, close)), body);
  document.body.append(scrim, dlg);

  let current = null, opener = null;

  function render(p, subId) {
    const a = areaBy[p.n];
    const kids = [];
    kids.push(el("div", { class: "d-eyebrow" },
      el("span", { class: "chip", text: `${String(p.n).padStart(2, "0")} · ${a.name}` }),
      el("span", { class: "chip " + maturityClass(p.maturity), text: p.maturity })));
    kids.push(el("h2", { text: p.name }), el("p", { class: "d-tag", text: p.tagline }));
    kids.push(sec("What it is", el("p", { text: p.what })));
    kids.push(sec("What it solves", el("p", { text: p.solves })));
    kids.push(sec("How it compares", el("div", { class: "vs" },
      el("div", { class: "inc" }, el("b", { text: "Alternatives" }), ...p.versus.incumbents.split(/,\s*(?![^()]*\))/).map((t) => el("span", { class: "chip", text: t.trim() }))),
      el("p", { text: p.versus.edge }))));
    if (p.moves?.length) kids.push(sec("How it was built · the engineering moves", el("ol", { class: "moves" }, ...p.moves.map(moveItem))));
    if (p.proof?.length) kids.push(sec("By the numbers", el("div", { class: "proofs" }, ...p.proof.map((t) => el("span", { class: "chip", text: t })))));
    if (p.tags?.length) kids.push(sec("Tech stack", el("div", { class: "chips" }, ...p.tags.map((t) => el("button", { class: "chip", type: "button", text: t, title: `Show every project using ${t}`, onclick: () => { api.close(); onTag(t); } })))));
    if (p.subs?.length) {
      kids.push(sec(`Sub-projects · ${p.subs.length}`, el("div", { class: "subs" }, ...p.subs.map((s) => {
        const d = el("details", { class: "sub", id: "sub-" + s.id, open: s.id === subId },
          el("summary", {}, el("span", { text: s.name })),
          el("div", { class: "sb" },
            el("div", {}, el("b", { text: "What it is" }), s.what),
            el("div", {}, el("b", { text: "What it solves" }), s.solves),
            el("div", {}, el("b", { text: "Versus what exists" }), s.edge),
            s.moves?.length ? el("div", {}, el("b", { text: "Engineering moves" }), el("ul", {}, ...s.moves.map((m) => { const [x, y] = splitMove(m); return el("li", {}, x ? el("strong", { text: x + ". " }) : null, y); }))) : null));
        return d;
      }))));
    }
    body.replaceChildren(...kids);
    body.scrollTop = 0;
    if (subId) requestAnimationFrame(() => document.getElementById("sub-" + subId)?.scrollIntoView({ block: "start" }));
    const list = getList(), i = list.findIndex((x) => x.id === p.id);
    crumb.textContent = i >= 0 ? `${i + 1} / ${list.length}` : "";
    prev.disabled = next.disabled = i < 0 || list.length < 2;
  }
  const sec = (title, ...c) => el("section", { class: "d-sec" }, el("h3", { text: title }), ...c);

  const api = {
    get current() { return current; },
    open(id, subId) {
      const p = data.projects.find((x) => x.id === id); if (!p) return false;
      if (!current) opener = document.activeElement;
      current = p; render(p, subId);
      scrim.classList.add("on"); dlg.classList.add("on"); dlg.setAttribute("aria-hidden", "false");
      document.documentElement.style.overflow = "hidden";
      history.replaceState(null, "", "#project/" + id);
      requestAnimationFrame(() => body.focus({ preventScroll: true }));
      return true;
    },
    close() {
      if (!current) return;
      current = null;
      scrim.classList.remove("on"); dlg.classList.remove("on"); dlg.setAttribute("aria-hidden", "true");
      document.documentElement.style.overflow = "";
      if (location.hash.startsWith("#project/")) history.replaceState(null, "", location.pathname + location.search + "#projects");
      opener?.focus?.({ preventScroll: true }); opener = null;
    },
    step(d) {
      const list = getList(); if (!current || list.length < 2) return;
      const i = list.findIndex((x) => x.id === current.id);
      api.open(list[(i + d + list.length) % list.length].id);
    },
  };
  close.addEventListener("click", api.close); scrim.addEventListener("click", api.close);
  prev.addEventListener("click", () => api.step(-1)); next.addEventListener("click", () => api.step(1));
  share.addEventListener("click", async () => { const { copyText } = await import("./util.js"); copyText(location.origin + location.pathname + "#project/" + current.id); });
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); api.close(); }
    else if (e.key === "ArrowLeft" && e.altKey) api.step(-1);
    else if (e.key === "ArrowRight" && e.altKey) api.step(1);
    else if (e.key === "Tab") {   // focus trap
      const f = $$("button:not([disabled]),summary,a[href],[tabindex]:not([tabindex='-1'])", dlg).filter((n) => n.offsetParent !== null);
      if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === body)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  return api;
}
