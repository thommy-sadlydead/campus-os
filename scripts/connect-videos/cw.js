// Connect walkthrough videos: one template, four LMSs. Every scene is drawn
// from a time t (seconds) by CW.seek(t), so frames render deterministically.
// LMS scenes are simplified drawings of the screens in each LMS's own help
// guide; the Campus OS scene runs on the real connect page (injected).
(function () {
  const W = 390, H = 844;
  const C = {
    bg: "#f6f7f9", surface: "#ffffff", s2: "#f1f3f6", ink: "#0f1218", soft: "#596273", faint: "#8a93a3",
    border: "#e2e5eb", accent: "#ea6a12", accentInk: "#b8500a", accentSoft: "#fff1e6", ok: "#15803d", okSoft: "#e9f7ee",
    from: "#4c7dff", to: "#ff7a2f",
  };
  const FONT = `"Geist", var(--font-geist), -apple-system, system-ui, sans-serif`;

  // ---------- timing ----------
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const prog = (t, a, b, e = easeIO) => e(clamp01((t - a) / (b - a)));
  const window01 = (t, a, b, fade = 0.2) => Math.min(prog(t, a, a + fade), 1 - prog(t, b - fade, b));

  // ---------- dom helpers ----------
  function h(tag, style = {}, html = "") {
    const el = document.createElement(tag);
    Object.assign(el.style, style);
    if (html) el.innerHTML = html;
    return el;
  }
  const rectIn = (el, root) => {
    const a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height, cx: a.left - b.left + a.width / 2, cy: a.top - b.top + a.height / 2 };
  };
  const label = (s) =>
    `<b style="font-weight:650;color:${C.accentInk};background:${C.accentSoft};padding:0 5px;border-radius:6px;white-space:nowrap">${s}</b>`;
  const blurBar = (w = 150) =>
    `<span style="display:inline-block;vertical-align:middle;width:${w}px;height:12px;border-radius:6px;background:repeating-linear-gradient(90deg,#9aa3b2 0 9px,#c4cad4 9px 15px);filter:blur(2.5px)"></span>`;
  const icon = {
    globe: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
    lock: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
    gear: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M5.2 18.8l2.1-2.1M16.7 7.3l2.1-2.1"/></svg>`,
    plus: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>`,
    cal: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`,
    chev: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>`,
    x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
    check: `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
    tick: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
    star: `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`,
    print: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 9V3h10v6M7 18H4v-7h16v7h-3M7 14h10v7H7z"/></svg>`,
    nav: (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`,
  };
  const logoMark = (size) => `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:${size * 0.3}px;color:#fff;background:linear-gradient(135deg,${C.from},${C.to});box-shadow:0 6px 18px rgba(76,125,255,.25)">
    <svg viewBox="0 0 24 24" width="${size * 0.64}" height="${size * 0.64}" fill="currentColor"><path d="M12 5 2.5 9.2 12 13.4l9.5-4.2z"/><path d="M6.5 11.3v3.4c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-3.4L12 13.8z"/><path d="M20.2 9.8v4.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg></span>`;

  // ---------- shared overlay: taps, callouts, caption, fades ----------
  function makeOverlay(root) {
    const layer = h("div", { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "50", fontFamily: FONT });
    root.appendChild(layer);
    const taps = [];
    const highlights = [];
    const callouts = [];
    const api = {
      layer,
      // A touch: the dot appears, presses at `at`, ripples and fades.
      tap(getPoint, at, { hold = 0 } = {}) {
        const dot = h("div", { position: "absolute", width: "46px", height: "46px", marginLeft: "-23px", marginTop: "-23px", borderRadius: "50%",
          background: "rgba(15,18,24,.22)", border: "2.5px solid rgba(255,255,255,.95)", boxShadow: "0 4px 14px rgba(0,0,0,.18)", opacity: "0" });
        const ring = h("div", { position: "absolute", width: "46px", height: "46px", marginLeft: "-23px", marginTop: "-23px", borderRadius: "50%",
          border: `3px solid ${C.accent}`, opacity: "0" });
        layer.append(ring, dot);
        taps.push({ dot, ring, getPoint, at, hold });
      },
      highlight(el, a, b, radius = 10) {
        const box = h("div", { position: "absolute", borderRadius: radius + "px", boxShadow: `0 0 0 3px ${C.accent}, 0 0 0 9px rgba(234,106,18,.18)`, opacity: "0" });
        layer.appendChild(box);
        highlights.push({ box, el, a, b });
      },
      // iOS-style edit menu bubble ("Copy" / "Paste") above a point.
      callout(text, getPoint, a, b) {
        const el = h("div", { position: "absolute", transform: "translate(-50%,-100%)", background: "rgba(30,32,38,.96)", color: "#fff",
          fontSize: "15px", fontWeight: "500", padding: "9px 16px", borderRadius: "12px", boxShadow: "0 8px 24px rgba(0,0,0,.25)", opacity: "0", whiteSpace: "nowrap" }, text);
        const nub = h("div", { position: "absolute", left: "50%", bottom: "-6px", width: "12px", height: "12px", marginLeft: "-6px", background: "rgba(30,32,38,.96)", transform: "rotate(45deg)" });
        el.appendChild(nub);
        layer.appendChild(el);
        callouts.push({ el, getPoint, a, b });
        return el;
      },
      update(t) {
        for (const { dot, ring, getPoint, at, hold } of taps) {
          const p = getPoint();
          for (const el of [dot, ring]) { el.style.left = p.x + "px"; el.style.top = p.y + "px"; }
          const end = at + hold;
          const vis = window01(t, at - 0.45, end + 0.45, 0.2);
          const press = t >= at && t <= end + 0.14 ? 0.82 : 1;
          dot.style.opacity = String(vis);
          dot.style.transform = `scale(${press})`;
          const r = clamp01((t - end) / 0.55);
          ring.style.opacity = t >= end && r < 1 ? String(0.9 * (1 - r)) : "0";
          ring.style.transform = `scale(${1 + r * 1.1})`;
        }
        for (const { box, el, a, b } of highlights) {
          const r = rectIn(el, root);
          Object.assign(box.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
          box.style.opacity = String(window01(t, a, b, 0.25));
        }
        for (const { el, getPoint, a, b } of callouts) {
          const p = getPoint();
          el.style.left = p.x + "px"; el.style.top = p.y + "px";
          const v = window01(t, a, b, 0.15);
          el.style.opacity = String(v);
          el.style.transform = `translate(-50%,-100%) scale(${0.92 + 0.08 * v})`;
        }
      },
    };
    return api;
  }

  function makeCaption(root, step, total, html) {
    const card = h("div", { position: "absolute", left: "14px", right: "14px", bottom: "16px", zIndex: "60", background: C.surface, borderRadius: "22px",
      padding: "16px 18px 18px", boxShadow: "0 10px 30px rgba(15,18,24,.12), 0 0 0 1px rgba(15,18,24,.05)", fontFamily: FONT });
    const dots = Array.from({ length: total }, (_, i) =>
      `<span style="width:${i + 1 === step ? 18 : 6}px;height:6px;border-radius:3px;background:${i + 1 <= step ? C.accent : C.border}"></span>`).join("");
    card.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
        <span style="font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.faint}">Step ${step} of ${total}</span>
        <span style="display:flex;gap:4px">${dots}</span></div>
      <div style="font-size:19px;line-height:1.38;font-weight:500;color:${C.ink};letter-spacing:-.005em">${html}</div>`;
    root.appendChild(card);
    return (t) => {
      const v = prog(t, 0.05, 0.45, easeOut);
      card.style.opacity = String(v);
      card.style.transform = `translateY(${(1 - v) * 14}px)`;
    };
  }

  function makeFade(root, color, { fadeIn = true, fadeOut = true, dur }) {
    const veil = h("div", { position: "absolute", inset: "0", background: color, zIndex: "80", pointerEvents: "none" });
    root.appendChild(veil);
    return (t) => {
      const a = fadeIn ? 1 - prog(t, 0, 0.32) : 0;
      const b = fadeOut ? prog(t, dur - 0.32, dur) : 0;
      veil.style.opacity = String(Math.max(a, b));
    };
  }

  // A browser page card for LMS scenes: address bar + page body.
  function pageCard(stage, { where, domain, body, bodyStyle = {} }) {
    stage.appendChild(h("div", { position: "absolute", left: "16px", top: "20px", display: "flex", alignItems: "center", gap: "7px",
      fontSize: "13.5px", fontWeight: "600", color: C.soft, fontFamily: FONT }, `${icon.globe}<span>${where}</span>`));
    const card = h("div", { position: "absolute", left: "14px", right: "14px", top: "52px", bottom: "214px", background: C.surface, borderRadius: "22px",
      overflow: "hidden", boxShadow: "0 10px 30px rgba(15,18,24,.10), 0 0 0 1px rgba(15,18,24,.06)" });
    const bar = h("div", { height: "38px", background: "#eef0f3", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
      fontSize: "13px", color: "#3b4250", fontFamily: "-apple-system, system-ui, sans-serif", borderBottom: "1px solid #e3e6ea" },
      `<span style="color:#6b7280">${icon.lock}</span><span class="cw-domain">${domain}</span>`);
    const viewport = h("div", { position: "absolute", top: "38px", left: "0", right: "0", bottom: "0", overflow: "hidden", fontFamily: "Lato, 'Helvetica Neue', Arial, sans-serif", ...bodyStyle });
    viewport.innerHTML = body;
    card.append(bar, viewport);
    stage.appendChild(card);
    return { card, viewport, bar, q: (s) => viewport.querySelector(s), domainEl: bar.querySelector(".cw-domain") };
  }

  const typed = (el, text, t, a, b) => {
    const n = Math.round(clamp01((t - a) / (b - a)) * text.length);
    el.textContent = text.slice(0, n);
  };
  const show = (el, v) => { el.style.opacity = String(v); };

  // ---------- title and end cards ----------
  function titleScene(name, sub) {
    return { dur: 1.8, fadeIn: false, build(stage) {
      const wrap = h("div", { position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "0 34px", fontFamily: FONT });
      wrap.innerHTML = `<div class="m">${logoMark(76)}</div>
        <div class="t" style="margin-top:28px;font-size:36px;line-height:1.1;font-weight:650;letter-spacing:-.025em;color:${C.ink}">Connect ${name}</div>
        <div class="s" style="margin-top:14px;font-size:18px;line-height:1.45;color:${C.soft}">${sub}</div>`;
      stage.appendChild(wrap);
      const [m, tt, s] = [wrap.querySelector(".m"), wrap.querySelector(".t"), wrap.querySelector(".s")];
      return (t) => {
        // Fully drawn at t=0 so the first frame works as the poster.
        void m; void tt; void s;
      };
    } };
  }
  function endScene(title, html) {
    return { dur: 3.6, fadeOut: false, build(stage) {
      const wrap = h("div", { position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "0 32px", fontFamily: FONT });
      wrap.innerHTML = `<div class="m" style="width:84px;height:84px;border-radius:50%;background:${C.okSoft};color:${C.ok};display:flex;align-items:center;justify-content:center">${icon.check}</div>
        <div style="margin-top:26px;font-size:30px;line-height:1.15;font-weight:650;letter-spacing:-.02em;color:${C.ink}">${title}</div>
        <div style="margin-top:14px;font-size:18px;line-height:1.5;color:${C.soft}">${html}</div>`;
      stage.appendChild(wrap);
      const m = wrap.querySelector(".m");
      return (t) => {
        const v = prog(t, 0.2, 0.75, easeOut);
        m.style.transform = `scale(${0.6 + 0.4 * v})`;
        m.style.opacity = String(v);
      };
    } };
  }

  // ---------- the Campus OS scene, run on the real connect page ----------
  // fields: [{ sel, text, paste?, blurText? }], button: text of the button to tap.
  function liveScene(path, { step, total, caption, fields, button, dur }) {
    return { dur, live: path, build(stage, ov) {
      const style = document.createElement("style");
      style.textContent = `*{transition:none!important;animation:none!important;caret-color:transparent!important} nextjs-portal{display:none!important}
        .cw-blur{color:transparent!important;text-shadow:0 0 7px rgba(15,18,24,.55)!important}`;
      document.head.appendChild(style);
      document.querySelectorAll("nextjs-portal").forEach((e) => e.remove());
      const setVal = (el, v) => {
        if (el.value === v) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      // Schedule: each field gets a tap, then typing or a long-press + Paste.
      let at = 0.55;
      const plan = fields.map((f) => {
        const el = document.querySelector(f.sel);
        if (f.blurText) el.classList.add("cw-blur");
        const pt = () => { const r = rectIn(el, stage); return { x: r.x + Math.min(r.w * 0.5, 150), y: r.cy }; };
        const p = { el, f, tapAt: at };
        if (f.paste) {
          ov.tap(pt, at, { hold: 0.5 });
          ov.callout("Paste", () => { const r = rectIn(el, stage); return { x: r.x + Math.min(r.w * 0.5, 150), y: r.y - 6 }; }, at + 0.55, at + 1.25);
          ov.tap(() => { const r = rectIn(el, stage); return { x: r.x + Math.min(r.w * 0.5, 150), y: r.y - 26 }; }, at + 1.05);
          p.fillAt = at + 1.1; p.typeEnd = p.fillAt;
          at += 1.75;
        } else {
          ov.tap(pt, at);
          p.fillAt = at + 0.25; p.typeEnd = p.fillAt + Math.min(1.5, f.text.length * 0.055);
          at = p.typeEnd + 0.45;
        }
        return p;
      });
      const btn = [...document.querySelectorAll("main button")].find((b) => b.textContent.trim() === button);
      const btnAt = at + 0.55;
      ov.highlight(btn, at, btnAt + 0.6, 12);
      ov.tap(() => { const r = rectIn(btn, stage); return { x: r.cx, y: r.cy }; }, btnAt);
      const cap = makeCaption(stage, step, total, caption);
      return (t) => {
        let focused = null;
        for (const p of plan) {
          if (t >= p.tapAt) focused = p.el;
          const v = t < p.fillAt ? "" : p.f.paste ? p.f.text : p.f.text.slice(0, Math.round(clamp01((t - p.fillAt) / (p.typeEnd - p.fillAt)) * p.f.text.length));
          setVal(p.el, v);
        }
        if (t >= btnAt - 0.2) focused = null;
        if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
        if (!focused && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        btn.style.transform = t >= btnAt && t <= btnAt + 0.16 ? "scale(.97)" : "";
        window.scrollTo(0, 0);
        cap(t);
      };
    } };
  }

  // ---------- the four walkthroughs ----------
  const CANVAS_BLUE = "#0374B5";
  const NAV = [
    ["Account", `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`],
    ["Dashboard", `<path d="M4 15a8 8 0 1 1 16 0"/><path d="m12 15 4-4"/>`],
    ["Courses", `<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>`],
    ["Groups", `<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 20a4.5 4.5 0 0 1 7 0"/>`],
    ["Calendar", `<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`],
    ["Inbox", `<path d="M4 5h16v14H4z"/><path d="M4 13h5l1.5 2h3L15 13h5"/>`],
    ["History", `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`],
    ["Help", `<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.7M12 17h.01"/>`],
  ];

  const WALKTHROUGHS = {
    canvas: {
      name: "Canvas",
      scenes: [
        titleScene("Canvas", "Make an access token in Canvas, then paste it into Campus OS."),
        { dur: 4.2, build(stage, ov) {
          const pc = pageCard(stage, { where: "Canvas, in your web browser", domain: "yourschool.instructure.com", body: `
            <div style="display:flex;height:100%">
              <div style="width:76px;background:#394B58;color:#fff;display:flex;flex-direction:column;align-items:center;padding-top:14px;gap:13px">
                <div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.12);margin-bottom:6px"></div>
                ${NAV.map(([n, d], i) => `<div class="nav-${i}" style="display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11.5px;width:72px;padding:4px 0;border-radius:6px">${i === 0
                  ? `<div style="width:24px;height:24px;border-radius:50%;background:#c7cdd1"></div>` : icon.nav(d)}<span>${n}</span></div>`).join("")}
              </div>
              <div style="flex:1;position:relative;background:#fff">
                <div style="padding:22px 20px;color:#c7cdd1"><div style="height:16px;width:60%;background:#eef0f2;border-radius:4px"></div>
                  <div style="height:10px;width:85%;background:#f3f4f6;border-radius:4px;margin-top:16px"></div><div style="height:10px;width:70%;background:#f3f4f6;border-radius:4px;margin-top:10px"></div></div>
                <div class="tray" style="position:absolute;inset:0;background:#fff;box-shadow:6px 0 18px rgba(0,0,0,.12);padding:18px 18px">
                  <div style="display:flex;flex-direction:column;align-items:center">
                    <div style="width:58px;height:58px;border-radius:50%;background:#c7cdd1"></div>
                    <div style="margin-top:9px;height:14px;width:110px;border-radius:4px;background:#dfe3e7"></div>
                    <div style="margin-top:12px;border:1px solid #c7cdd1;border-radius:4px;padding:4px 10px;font-size:12.5px;color:#2d3b45;background:#f5f5f5">Logout</div>
                  </div>
                  <div style="border-top:1px solid #e5e7eb;margin:16px 0 8px"></div>
                  ${["Notifications", "Files", "Settings", "ePortfolios", "QR for Mobile Login", "Global Announcements"].map((s) =>
                    `<div class="link-${s.replace(/\W/g, "")}" style="display:inline-block;color:#2B7ABC;font-size:15px;padding:7px 4px;margin:0 -4px;border-radius:6px">${s}</div><br>`).join("")}
                </div>
              </div>
            </div>` });
          const account = pc.q(".nav-0"), tray = pc.q(".tray"), settings = pc.q(".link-Settings");
          ov.tap(() => { const r = rectIn(account, stage); return { x: r.cx, y: r.cy }; }, 0.75);
          ov.highlight(settings, 2.0, 3.3, 6);
          ov.tap(() => { const r = rectIn(settings, stage); return { x: r.cx, y: r.cy }; }, 2.75);
          const cap = makeCaption(stage, 1, 5, `Open Canvas in your web browser and go to ${label("Account")} → ${label("Settings")}.`);
          return (t) => {
            const v = prog(t, 0.85, 1.35);
            tray.style.transform = `translateX(${(1 - v) * -105}%)`;
            account.style.background = t > 0.75 ? "rgba(255,255,255,.14)" : "";
            account.style.color = t > 0.75 ? "#fff" : "";
            settings.style.background = t > 2.75 ? "#e8f1f8" : "";
            cap(t);
          };
        } },
        { dur: 3.9, build(stage, ov) {
          const pc = pageCard(stage, { where: "Canvas, in your web browser", domain: "yourschool.instructure.com", body: `
            <div style="padding:10px 0 0;background:#fff">
              <div style="display:flex;align-items:center;gap:10px;padding:4px 16px 12px;border-bottom:1px solid #e5e7eb;color:#2d3b45;font-size:14px">
                <span style="font-size:20px;color:#2B7ABC">☰</span><span>Settings</span></div>
              <div class="scroller" style="padding:0 16px">
                <div style="font-size:22px;color:#2d3b45;margin:18px 0 10px">Ways to Log In</div>
                <div style="height:10px;width:90%;background:#f1f3f5;border-radius:4px;margin:10px 0"></div><div style="height:10px;width:75%;background:#f1f3f5;border-radius:4px;margin:10px 0"></div>
                <div style="font-size:22px;color:#2d3b45;margin:26px 0 10px">Web Services</div>
                <div style="height:10px;width:92%;background:#f1f3f5;border-radius:4px;margin:10px 0"></div><div style="height:10px;width:60%;background:#f1f3f5;border-radius:4px;margin:10px 0"></div>
                <div style="height:10px;width:80%;background:#f1f3f5;border-radius:4px;margin:10px 0 0"></div>
                <div style="font-size:22px;color:#2d3b45;margin:30px 0 8px">Approved Integrations:</div>
                <div style="font-size:13.5px;line-height:1.45;color:#2d3b45">These are the third-party applications you have authorized to access the Canvas site on your behalf:</div>
                <div style="display:flex;gap:12px;font-size:12.5px;font-weight:700;color:#2d3b45;border-bottom:1px solid #c7cdd1;padding:12px 0 6px;margin-top:6px">
                  <span style="flex:1">App</span><span>Status</span><span>Purpose</span><span>Dates</span></div>
                <div style="display:flex;gap:12px;align-items:center;border-bottom:1px solid #e5e7eb;padding:12px 0">
                  <span style="flex:1;height:10px;background:#f1f3f5;border-radius:4px"></span><span style="width:40px;height:10px;background:#f1f3f5;border-radius:4px"></span><span style="width:70px;height:10px;background:#f1f3f5;border-radius:4px"></span></div>
                <div class="newtok" style="display:inline-flex;align-items:center;gap:6px;margin-top:14px;background:${CANVAS_BLUE};color:#fff;font-size:14.5px;padding:9px 14px;border-radius:5px">+ New Access Token</div>
                <div style="height:160px"></div>
              </div>
            </div>` });
          const scroller = pc.q(".scroller"), btn = pc.q(".newtok");
          ov.highlight(btn, 1.7, 3.2, 6);
          ov.tap(() => { const r = rectIn(btn, stage); return { x: r.cx, y: r.cy }; }, 2.55);
          const cap = makeCaption(stage, 2, 5, `Scroll down to ${label("Approved Integrations")} and tap ${label("+ New Access Token")}.`);
          return (t) => {
            scroller.style.transform = `translateY(${-prog(t, 0.35, 1.45) * 205}px)`;
            btn.style.filter = t > 2.55 && t < 2.75 ? "brightness(.85)" : "";
            cap(t);
          };
        } },
        { dur: 6.2, build(stage, ov) {
          const field = (cls, lab, extra = "") => `<div style="font-size:13.5px;font-weight:700;color:#2d3b45;margin:12px 0 5px">${lab} *</div>
            <div class="${cls}" style="position:relative;height:36px;border:1px solid #9ca3af;border-radius:5px;display:flex;align-items:center;padding:0 10px;font-size:14.5px;color:#2d3b45;background:#fff"><span class="v"></span>${extra}</div>`;
          const pc = pageCard(stage, { where: "Canvas, in your web browser", domain: "yourschool.instructure.com", body: `
            <div style="position:absolute;inset:0;background:rgba(45,59,69,.45)"></div>
            <div class="dlg" style="position:absolute;left:10px;right:10px;top:16px;background:#fff;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.25)">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e5e7eb">
                <span style="font-size:21px;color:#2d3b45">New Access Token</span><span style="color:#2d3b45">${icon.x}</span></div>
              <div style="padding:6px 16px 14px">
                <div style="font-size:12.5px;line-height:1.45;color:#2d3b45;margin-top:6px">Access tokens are what allow third-party applications to access Canvas resources on your behalf.</div>
                ${field("purpose", "Purpose")}
                ${field("date", "Expiration date", `<span style="position:absolute;right:10px;color:#2d3b45">${icon.cal}</span>`)}
                <div style="font-size:12px;color:#2d3b45;margin-top:5px">Maximum expiration is 30 days.</div>
                ${field("time", "Expiration time", `<span style="position:absolute;right:10px;color:#2d3b45">${icon.chev}</span>`)}
              </div>
              <div style="display:flex;justify-content:flex-end;gap:8px;padding:11px 16px;background:#f5f5f5;border-top:1px solid #e5e7eb;border-radius:0 0 6px 6px">
                <span style="border:1px solid #c7cdd1;background:#f5f5f5;border-radius:5px;padding:8px 13px;font-size:14px;color:#2d3b45">Cancel</span>
                <span class="gen" style="background:${CANVAS_BLUE};color:#fff;border-radius:5px;padding:8px 13px;font-size:14px">Generate Token</span></div>
            </div>` });
          const [purpose, date, time, gen] = [pc.q(".purpose"), pc.q(".date"), pc.q(".time"), pc.q(".gen")];
          const at = (el, dx = 0.35) => () => { const r = rectIn(el, stage); return { x: r.x + r.w * dx, y: r.cy }; };
          ov.tap(at(purpose), 0.6);
          ov.tap(at(date), 2.1);
          ov.tap(at(time), 3.0);
          ov.highlight(gen, 3.7, 4.9, 6);
          ov.tap(() => { const r = rectIn(gen, stage); return { x: r.cx, y: r.cy }; }, 4.45);
          const cap = makeCaption(stage, 3, 5, `Type ${label("Campus OS")} as the purpose, pick an expiration date and time (30 days at most), then tap ${label("Generate Token")}.`);
          const focus = (el, on) => { el.style.borderColor = on ? CANVAS_BLUE : "#9ca3af"; el.style.boxShadow = on ? `0 0 0 2px rgba(3,116,181,.25)` : ""; };
          return (t) => {
            typed(purpose.querySelector(".v"), "Campus OS", t, 0.85, 1.6);
            date.querySelector(".v").textContent = t >= 2.35 ? "Nov 22, 2026" : "";
            time.querySelector(".v").textContent = t >= 3.25 ? "11:00 PM" : "";
            focus(purpose, t >= 0.6 && t < 2.1); focus(date, t >= 2.1 && t < 3.0); focus(time, t >= 3.0 && t < 3.6);
            gen.style.filter = t > 4.45 && t < 4.65 ? "brightness(.85)" : "";
            cap(t);
          };
        } },
        { dur: 4.6, build(stage, ov) {
          const row = (k, v) => `<div style="display:flex;gap:10px;border-top:1px solid #e5e7eb;padding:9px 0;font-size:13.5px;color:#2d3b45"><b style="width:66px;flex:none">${k}</b><span style="flex:1">${v}</span></div>`;
          const pc = pageCard(stage, { where: "Canvas, in your web browser", domain: "yourschool.instructure.com", body: `
            <div style="position:absolute;inset:0;background:rgba(45,59,69,.45)"></div>
            <div style="position:absolute;left:10px;right:10px;top:16px;background:#fff;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.25)">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e5e7eb">
                <span style="font-size:21px;color:#2d3b45">Access Token Details</span><span style="color:#2d3b45">${icon.x}</span></div>
              <div style="padding:6px 16px 14px">
                <div style="display:flex;gap:10px;padding:9px 0;font-size:13.5px;color:#2d3b45"><b style="width:66px;flex:none">Token:</b>
                  <span style="flex:1"><span class="tok" style="display:inline-block;position:relative;padding:3px 2px;border-radius:3px">${blurBar(170)}</span>
                  <div style="font-size:12px;line-height:1.45;margin-top:7px"><b>Copy this token down now.</b> Once you leave this page you won't be able to retrieve the full token anymore.</div></span></div>
                ${row("App:", "User-Generated")}${row("Purpose:", "Campus OS")}
                <div style="margin-top:8px;display:inline-block;border:1px solid #c7cdd1;background:#f5f5f5;border-radius:5px;padding:7px 12px;font-size:13.5px;color:#2d3b45">Regenerate Token</div>
              </div>
            </div>` });
          const tok = pc.q(".tok");
          const sel = h("div", { position: "absolute", inset: "0", background: "rgba(0,122,255,.22)", borderRadius: "3px", opacity: "0" });
          tok.appendChild(sel);
          const tp = () => { const r = rectIn(tok, stage); return { x: r.cx, y: r.cy }; };
          ov.highlight(tok, 0.3, 1.0, 4);
          ov.tap(tp, 0.85, { hold: 0.55 });
          ov.callout("Copy", () => { const r = rectIn(tok, stage); return { x: r.cx, y: r.y - 8 }; }, 1.45, 2.85);
          ov.tap(() => { const r = rectIn(tok, stage); return { x: r.cx, y: r.y - 28 }; }, 2.35);
          const cap = makeCaption(stage, 4, 5, `Copy the token now. Canvas only shows it once.`);
          return (t) => { show(sel, t >= 1.4 && t < 2.6 ? 1 : 0); cap(t); };
        } },
        liveScene("/connect/canvas", { step: 5, total: 5, dur: 7.4,
          caption: `In Campus OS, type your Canvas address, paste the token, and tap ${label("Connect Canvas")}.`,
          fields: [{ sel: "#baseUrl", text: "yourschool.instructure.com" }, { sel: "#accessToken", text: "x".repeat(69), paste: true }],
          button: "Connect Canvas" }),
        endScene("Canvas is connected", `Your classes and due dates come in. Canvas makes student tokens expire within 30 days: when yours does, tap ${label("Disconnect")} on this page and connect again with a new token.`),
      ],
    },

    schoology: {
      name: "Schoology",
      scenes: [
        titleScene("Schoology", "Get your API key and secret from Schoology, then paste them into Campus OS."),
        { dur: 4.0, build(stage, ov) {
          const pc = pageCard(stage, { where: "Schoology, in your web browser", domain: "yourschool.schoology.com", body: `
            <div style="height:46px;background:#0677BA"></div>
            <div style="padding:20px 18px"><div style="height:16px;width:55%;background:#eef0f2;border-radius:4px"></div>
              <div style="height:10px;width:85%;background:#f3f4f6;border-radius:4px;margin-top:18px"></div><div style="height:10px;width:70%;background:#f3f4f6;border-radius:4px;margin-top:10px"></div>
              <div style="height:10px;width:78%;background:#f3f4f6;border-radius:4px;margin-top:10px"></div></div>` });
          const dom = pc.domainEl;
          const suffix = h("span", { color: C.ink, fontWeight: "600" });
          dom.after(suffix);
          ov.highlight(pc.bar, 0.6, 2.9, 0);
          ov.tap(() => { const r = rectIn(pc.bar, stage); return { x: r.cx, y: r.cy }; }, 0.7);
          const cap = makeCaption(stage, 1, 4, `Sign in to Schoology in your web browser, then add ${label("/api")} to the end of the address.`);
          return (t) => { typed(suffix, "/api", t, 1.2, 1.9); cap(t); };
        } },
        { dur: 3.4, build(stage, ov) {
          const pc = pageCard(stage, { where: "Schoology, in your web browser", domain: "yourschool.schoology.com/api", body: `
            <div style="height:46px;background:#0677BA"></div>
            <div style="padding:22px 18px">
              <div style="height:16px;width:40%;background:#eef0f2;border-radius:4px"></div>
              <div style="height:10px;width:88%;background:#f3f4f6;border-radius:4px;margin-top:18px"></div><div style="height:10px;width:64%;background:#f3f4f6;border-radius:4px;margin-top:10px"></div>
              <div class="req" style="display:inline-block;margin-top:22px;background:#0677BA;color:#fff;font-size:15px;font-weight:600;padding:10px 16px;border-radius:5px">Request API Keys</div>
            </div>` });
          const req = pc.q(".req");
          ov.highlight(req, 0.5, 2.4, 6);
          ov.tap(() => { const r = rectIn(req, stage); return { x: r.cx, y: r.cy }; }, 1.7);
          const cap = makeCaption(stage, 2, 4, `If you don't have keys yet, tap ${label("Request API Keys")}.`);
          return (t) => { req.style.filter = t > 1.7 && t < 1.9 ? "brightness(.85)" : ""; cap(t); };
        } },
        { dur: 4.4, build(stage, ov) {
          const kv = (cls, k) => `<div style="margin-top:18px"><div style="font-size:14px;font-weight:700;color:#333">${k}</div>
            <span class="${cls}" style="display:inline-block;position:relative;margin-top:7px;padding:4px 2px;border-radius:3px">${blurBar(200)}</span></div>`;
          const pc = pageCard(stage, { where: "Schoology, in your web browser", domain: "yourschool.schoology.com/api", body: `
            <div style="height:46px;background:#0677BA"></div>
            <div style="padding:22px 18px">
              <div style="height:16px;width:40%;background:#eef0f2;border-radius:4px"></div>
              ${kv("key", "Consumer Key")}${kv("secret", "Consumer Secret")}
            </div>` });
          const key = pc.q(".key"), secret = pc.q(".secret");
          ov.highlight(key, 0.4, 1.7, 4);
          ov.highlight(secret, 2.2, 3.5, 4);
          ov.tap(() => { const r = rectIn(key, stage); return { x: r.cx, y: r.cy }; }, 0.9, { hold: 0.45 });
          ov.callout("Copy", () => { const r = rectIn(key, stage); return { x: r.cx, y: r.y - 8 }; }, 1.4, 2.0);
          ov.tap(() => { const r = rectIn(secret, stage); return { x: r.cx, y: r.cy }; }, 2.6, { hold: 0.45 });
          ov.callout("Copy", () => { const r = rectIn(secret, stage); return { x: r.cx, y: r.y - 8 }; }, 3.1, 3.8);
          const cap = makeCaption(stage, 3, 4, `Copy your ${label("Consumer Key")} and ${label("Consumer Secret")}.`);
          return (t) => cap(t);
        } },
        liveScene("/connect/schoology", { step: 4, total: 4, dur: 8.6,
          caption: `In Campus OS, type your Schoology address, paste the key and secret, and tap ${label("Connect Schoology")}.`,
          fields: [{ sel: "#domain", text: "yourschool.schoology.com" }, { sel: "#consumerKey", text: "a3f9c2e17b6d40c8e95f1a2b7c3d", paste: true, blurText: true },
            { sel: "#consumerSecret", text: "x".repeat(32), paste: true }],
          button: "Connect Schoology" }),
        endScene("Schoology is connected", `Your classes and due dates come in. If the /api page says you don't have access, your school has turned off API keys for students.`),
      ],
    },

    brightspace: {
      name: "Brightspace",
      scenes: [
        titleScene("Brightspace", "Copy your Brightspace calendar link, then paste it into Campus OS."),
        ...(() => {
          const header = `<div style="height:44px;background:#fff;border-bottom:1px solid #e3e5e8;display:flex;align-items:center;justify-content:flex-end;gap:14px;padding:0 14px;color:#6e7376">
              <span style="width:16px;height:16px;border:2px solid #9ea3a6;border-radius:3px"></span><span style="width:18px;height:14px;border:2px solid #9ea3a6;border-radius:3px"></span>
              <span style="width:26px;height:26px;border-radius:50%;background:#d6d9dc"></span></div>
            <div style="height:34px;background:#494C4E"></div>`;
          const toolbar = (sub) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 12px;border-bottom:1px solid #e3e5e8">
              <div style="display:flex;border:1px solid #d3d9e3;border-radius:5px;overflow:hidden;font-size:11.5px;color:#494c4e">${["Agenda", "Day", "Week", "Month"].map((s, i) =>
                `<span style="padding:6px 7px;${i === 0 ? "background:#565a5c;color:#fff;font-weight:700" : "background:#f9fbff"}">${s}</span>`).join("")}</div>
              <div style="display:flex;gap:11px;font-size:12.5px;color:#006FBF;align-items:center">
                <span style="display:flex;gap:3px;align-items:center">${icon.print}Print</span>
                <span class="settings" style="display:flex;gap:3px;align-items:center;padding:3px 2px;border-radius:4px">${icon.gear}Settings</span>
                ${sub ? `<span class="subscribe" style="display:flex;gap:3px;align-items:center;padding:3px 2px;border-radius:4px">${icon.star}Subscribe</span>` : ""}</div></div>
            <div style="padding:16px 14px;font-size:19px;color:#202122">Today and tomorrow</div>
            <div style="padding:0 14px"><div style="height:10px;width:80%;background:#f1f3f5;border-radius:4px"></div><div style="height:10px;width:60%;background:#f1f3f5;border-radius:4px;margin-top:10px"></div></div>`;
          const where = "Brightspace, in your web browser", domain = "yourschool.brightspace.com";
          return [
            { dur: 3.6, build(stage, ov) {
              const pc = pageCard(stage, { where, domain, body: header + toolbar(false) });
              const s = pc.q(".settings");
              ov.highlight(s, 0.7, 2.6, 5);
              ov.tap(() => { const r = rectIn(s, stage); return { x: r.cx, y: r.cy }; }, 1.9);
              const cap = makeCaption(stage, 1, 5, `Open Brightspace in your web browser, go to ${label("Calendar")} and tap ${label("Settings")}.`);
              return (t) => cap(t);
            } },
            { dur: 4.4, build(stage, ov) {
              const sel = (w, v) => `<span style="display:inline-flex;align-items:center;justify-content:space-between;width:${w}px;border:1px solid #cdd5dc;border-radius:5px;padding:6px 8px;font-size:12.5px">${v} ${icon.chev}</span>`;
              const pc = pageCard(stage, { where, domain, body: header + toolbar(false) + `
                <div style="position:absolute;inset:0;background:rgba(0,0,0,.35)"></div>
                <div style="position:absolute;left:10px;right:10px;top:14px;background:#fff;border-radius:7px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:14px 16px 16px;color:#202122">
                  <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:13.5px;font-weight:700">Settings</span>${icon.x}</div>
                  <div style="font-size:21px;margin-top:4px">Calendar Options</div>
                  <div style="font-size:12px;font-weight:700;margin-top:12px">Core Hours</div>
                  <div style="display:flex;align-items:center;gap:8px;margin-top:6px">${sel(92, "8:00 AM")}<span style="font-size:12.5px">to</span>${sel(92, "5:00 PM")}</div>
                  <div style="font-size:12px;font-weight:700;margin-top:14px">Calendar Feeds</div>
                  <div class="feeds" style="display:inline-flex;align-items:center;gap:8px;margin-top:6px;font-size:14px;padding:4px 6px 4px 2px;border-radius:5px">
                    <span class="box" style="width:17px;height:17px;border:2px solid #868c8f;border-radius:4px;display:flex;align-items:center;justify-content:center"></span>Enable Calendar Feeds</div>
                  <div style="font-size:11.5px;line-height:1.4;color:#565a5c;margin-top:4px">This enables a private address that can be used to subscribe to your calendars via an iCal feed</div>
                  <div style="border-top:1px solid #e3e5e8;margin:14px 0 10px"></div>
                  <div style="font-size:21px">Tasks Options</div>
                  <div style="font-size:12px;font-weight:700;margin-top:10px">Completed Tasks</div>
                  <div style="margin-top:6px">${sel(170, "Hide completed tasks")}</div>
                  <div style="margin-top:18px;display:flex;gap:8px"><span class="save" style="background:#006FBF;color:#fff;font-size:13.5px;font-weight:700;padding:8px 18px;border-radius:5px">Save</span>
                    <span style="border:1px solid #d3d9e3;background:#f9fbff;color:#494c4e;font-size:13.5px;padding:8px 14px;border-radius:5px">Cancel</span></div>
                </div>` });
              const feeds = pc.q(".feeds"), box = pc.q(".box"), save = pc.q(".save");
              ov.highlight(feeds, 0.5, 2.0, 6);
              ov.tap(() => { const r = rectIn(box, stage); return { x: r.cx, y: r.cy }; }, 1.3);
              ov.highlight(save, 2.3, 3.6, 6);
              ov.tap(() => { const r = rectIn(save, stage); return { x: r.cx, y: r.cy }; }, 3.1);
              const cap = makeCaption(stage, 2, 5, `Tick ${label("Enable Calendar Feeds")} and tap ${label("Save")}.`);
              return (t) => {
                const on = t >= 1.3;
                box.style.background = on ? "#006FBF" : ""; box.style.borderColor = on ? "#006FBF" : "#868c8f"; box.innerHTML = on ? icon.tick : "";
                cap(t);
              };
            } },
            { dur: 3.2, build(stage, ov) {
              const pc = pageCard(stage, { where, domain, body: header + toolbar(true) });
              const s = pc.q(".subscribe");
              ov.highlight(s, 0.5, 2.2, 5);
              ov.tap(() => { const r = rectIn(s, stage); return { x: r.cx, y: r.cy }; }, 1.6);
              const cap = makeCaption(stage, 3, 5, `Back in Calendar, tap ${label("Subscribe")}.`);
              return (t) => cap(t);
            } },
            { dur: 4.6, build(stage, ov) {
              const pc = pageCard(stage, { where, domain, body: header + toolbar(true) + `
                <div style="position:absolute;inset:0;background:rgba(0,0,0,.35)"></div>
                <div style="position:absolute;left:10px;right:10px;top:22px;background:#fff;border-radius:7px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:16px 16px 14px;color:#202122">
                  <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:17px;font-weight:700">Calendar Subscriptions</span>${icon.x}</div>
                  <div style="margin-top:12px;border:1px solid #cdd5dc;border-radius:5px;display:flex;align-items:center;justify-content:space-between;padding:7px 10px;font-size:13.5px">All Calendars and Tasks ${icon.chev}</div>
                  <div style="font-size:13px;line-height:1.45;margin-top:11px">Copy and paste the following URL into any external calendar application to subscribe to events for the selected calendar(s).</div>
                  <div style="margin-top:10px;border:1px solid #e3e5e8;border-radius:5px;padding:10px">
                    <span class="url" style="position:relative;display:inline;font-size:13.5px;font-weight:700;line-height:1.5;word-break:break-all;border-radius:3px">https://yourschool.brightspace.com/d2l/le/calendar/feed/user/feed.ics?token=${blurBar(80)}</span></div>
                  <div style="display:flex;gap:8px;margin-top:11px">${["Download", "Reset"].map((s) => `<span style="border:1px solid #d3d9e3;background:#f9fbff;font-size:13px;padding:7px 13px;border-radius:5px">${s}</span>`).join("")}</div>
                  <div style="margin-top:12px"><span style="border:1px solid #d3d9e3;background:#f9fbff;font-size:13px;padding:7px 13px;border-radius:5px">Close</span></div>
                </div>` });
              const url = pc.q(".url");
              const sel = h("span", { position: "absolute", inset: "-2px", background: "rgba(0,122,255,.22)", borderRadius: "3px", opacity: "0" });
              url.appendChild(sel);
              const pt = () => { const r = rectIn(url, stage); return { x: r.cx, y: r.cy }; };
              ov.tap(pt, 0.8, { hold: 0.55 });
              ov.callout("Copy", () => { const r = rectIn(url, stage); return { x: r.cx, y: r.y - 6 }; }, 1.4, 2.8);
              ov.tap(() => { const r = rectIn(url, stage); return { x: r.cx, y: r.y - 26 }; }, 2.3);
              const cap = makeCaption(stage, 4, 5, `Keep ${label("All Calendars and Tasks")} and copy the link.`);
              return (t) => { show(sel, t >= 1.35 && t < 2.55 ? 1 : 0); cap(t); };
            } },
          ];
        })(),
        liveScene("/connect/brightspace", { step: 5, total: 5, dur: 5.0,
          caption: `In Campus OS, paste the link and tap ${label("Next")}.`,
          fields: [{ sel: "#feed-url-0", text: "https://yourschool.brightspace.com/d2l/le/calendar/feed/user/feed.ics?token=••••••••", paste: true }],
          button: "Next" }),
        endScene("Almost done", `Campus OS shows the classes it found in your calendar. Rename any you like, then tap ${label("Connect Brightspace")}.`),
      ],
    },

    blackboard: {
      name: "Blackboard",
      scenes: [
        titleScene("Blackboard", "Copy your Blackboard calendar link, then paste it into Campus OS."),
        ...(() => {
          const where = "Blackboard, in your web browser", domain = "yourschool.blackboard.com";
          const calPage = `<div style="padding:16px 16px 0;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e5e5;padding-bottom:14px">
              <span style="font-family:Georgia,serif;font-size:25px;color:#262626">Calendar</span>
              <span style="display:flex;gap:14px;color:#262626">${icon.plus}<span class="gear" style="display:flex;padding:3px;border-radius:6px">${icon.gear.replace('width="16" height="16"', 'width="20" height="20"')}</span></span></div>
            <div style="padding:16px"><div style="display:inline-flex;font-size:12.5px;border:1px solid #262626;border-radius:3px;overflow:hidden"><span style="background:#262626;color:#fff;padding:6px 10px">Schedule</span><span style="padding:6px 10px">Due Dates</span></div>
              <div style="display:flex;justify-content:space-between;margin-top:20px;font-size:13px;color:#262626">${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span>${d}</span>`).join("")}</div>
              <div style="height:44px;border:1px solid #e5e5e5;border-left:4px solid #8a8a8a;border-radius:3px;margin-top:22px"></div>
              <div style="height:44px;border:1px solid #e5e5e5;border-left:4px solid #8a8a8a;border-radius:3px;margin-top:10px"></div></div>`;
          return [
            { dur: 3.6, build(stage, ov) {
              const items = ["Activity Stream", "Courses", "Organizations", "Calendar", "Messages", "Grades", "Tools", "Sign Out"];
              const pc = pageCard(stage, { where, domain, bodyStyle: { background: "#262626" }, body: `
                <div style="padding:14px 0;color:#fff;font-family:'Open Sans',Arial,sans-serif">
                  <div style="display:flex;align-items:center;gap:12px;padding:10px 20px"><span style="width:26px;height:26px;border-radius:50%;background:#5a5a5a"></span><span style="height:12px;width:110px;background:#4a4a4a;border-radius:4px"></span></div>
                  ${items.map((s) => `<div class="it-${s.replace(/\W/g, "")}" style="padding:12px 20px;font-size:16px">${s}</div>`).join("")}
                </div>` });
              const cal = pc.q(".it-Calendar");
              ov.highlight(cal, 0.7, 2.4, 4);
              ov.tap(() => { const r = rectIn(cal, stage); return { x: r.x + 70, y: r.cy }; }, 1.8);
              const cap = makeCaption(stage, 1, 5, `Open Blackboard in your web browser and tap ${label("Calendar")} in the menu.`);
              return (t) => { cal.style.background = t >= 1.8 ? "#000" : ""; cap(t); };
            } },
            { dur: 3.0, build(stage, ov) {
              const pc = pageCard(stage, { where, domain, body: calPage });
              const g = pc.q(".gear");
              ov.highlight(g, 0.5, 2.2, 8);
              ov.tap(() => { const r = rectIn(g, stage); return { x: r.cx, y: r.cy }; }, 1.6);
              const cap = makeCaption(stage, 2, 5, `Tap the ${label("Calendar Settings")} gear at the top.`);
              return (t) => cap(t);
            } },
            { dur: 4.0, build(stage, ov) {
              const pc = pageCard(stage, { where, domain, body: calPage + `
                <div style="position:absolute;inset:0;background:#fff;padding:16px 16px">
                  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e5e5;padding-bottom:14px">
                    <span style="font-family:Georgia,serif;font-size:24px;color:#262626">Calendar Settings</span>
                    <span class="dots" style="font-size:20px;letter-spacing:1px;color:#262626;padding:0 6px;border-radius:6px;font-weight:700">•••</span></div>
                  <div class="menu" style="position:absolute;right:16px;top:58px;background:#fff;border:1px solid #e0e0e0;box-shadow:0 4px 14px rgba(0,0,0,.15);border-radius:3px;font-size:14px;color:#262626">
                    <div style="padding:10px 14px">Add Calendar</div><div class="share" style="padding:10px 14px">Share Calendar</div></div>
                  <div style="font-size:14px;color:#262626;margin-top:16px">Select the calendars you want to display:</div>
                  <div style="font-size:17px;color:#262626;margin-top:16px">Calendars</div>
                  ${["", "", ""].map(() => `<div style="display:flex;align-items:center;gap:10px;margin-top:12px"><span style="width:16px;height:16px;border-radius:3px;background:#2e7d32"></span><span style="height:10px;width:130px;background:#eee;border-radius:4px"></span></div>`).join("")}
                </div>` });
              const dots = pc.q(".dots"), menu = pc.q(".menu"), share = pc.q(".share");
              ov.highlight(dots, 0.4, 1.5, 6);
              ov.tap(() => { const r = rectIn(dots, stage); return { x: r.cx, y: r.cy }; }, 1.1);
              ov.highlight(share, 1.9, 3.3, 3);
              ov.tap(() => { const r = rectIn(share, stage); return { x: r.cx, y: r.cy }; }, 2.75);
              const cap = makeCaption(stage, 3, 5, `Open the ${label("•••")} menu next to Calendar Settings and tap ${label("Share Calendar")}.`);
              return (t) => { show(menu, t >= 1.15 ? 1 : 0); share.style.background = t >= 2.75 ? "#f0f0f0" : ""; cap(t); };
            } },
            { dur: 3.8, build(stage, ov) {
              const pc = pageCard(stage, { where, domain, body: calPage + `
                <div style="position:absolute;inset:0;background:rgba(0,0,0,.35)"></div>
                <div style="position:absolute;left:10px;right:10px;top:26px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25);color:#262626">
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 16px 6px"><span style="font-size:20px">Share Calendar Link</span>${icon.x}</div>
                  <div style="padding:0 16px;font-size:13px;line-height:1.5">To view all events in one place, copy the link and add it to an external calendar. Events appear one year in the past and into the future. Only share this link with trusted sources.</div>
                  <div style="margin:14px 16px 0;display:flex;border:1px solid #cdcdcd;border-radius:2px;overflow:hidden">
                    <span style="flex:1;padding:9px 10px;background:#f5f5f5;font-size:13px;color:#6b6b6b;white-space:nowrap;overflow:hidden">https://${blurBar(150)}</span>
                    <span class="copy" style="padding:9px 12px;background:#e5e5e5;font-size:13.5px">Copy</span></div>
                  <div style="display:flex;justify-content:flex-end;gap:8px;padding:16px;margin-top:10px;border-top:1px solid #e5e5e5">
                    <span style="background:#cdcdcd;padding:9px 14px;font-size:13.5px;border-radius:3px">Cancel</span>
                    <span style="background:#262626;color:#fff;padding:9px 14px;font-size:13.5px;border-radius:3px">Regenerate Link</span></div>
                </div>` });
              const copy = pc.q(".copy");
              ov.highlight(copy, 0.5, 2.2, 2);
              ov.tap(() => { const r = rectIn(copy, stage); return { x: r.cx, y: r.cy }; }, 1.6);
              const cap = makeCaption(stage, 4, 5, `Tap ${label("Copy")} to copy the calendar link.`);
              return (t) => { copy.style.background = t >= 1.6 && t < 1.85 ? "#cfcfcf" : "#e5e5e5"; cap(t); };
            } },
          ];
        })(),
        liveScene("/connect/blackboard", { step: 5, total: 5, dur: 5.0,
          caption: `In Campus OS, paste the link and tap ${label("Next")}.`,
          fields: [{ sel: "#feed-url-0", text: "https://yourschool.blackboard.com/webapps/calendar/calendarFeed/••••••••/learn.ics", paste: true }],
          button: "Next" }),
        endScene("Almost done", `Campus OS shows the classes it found in your calendar. Rename any you like, then tap ${label("Connect Blackboard")}.`),
      ],
    },
  };

  // ---------- entry points ----------
  let update = null;
  window.CW = {
    meta(lms) {
      return WALKTHROUGHS[lms].scenes.map((s) => ({ dur: s.dur, live: s.live || null }));
    },
    // Builds scene i of an LMS walkthrough into this document.
    init(lms, i) {
      const scenes = WALKTHROUGHS[lms].scenes;
      const scene = scenes[i];
      let stage;
      if (scene.live) {
        stage = h("div", { position: "fixed", left: "0", top: "0", width: W + "px", height: H + "px", pointerEvents: "none", zIndex: "9999" });
        document.body.appendChild(stage);
      } else {
        stage = document.getElementById("stage");
        stage.innerHTML = "";
      }
      const ov = makeOverlay(stage);
      const draw = scene.build(stage, ov);
      const fade = makeFade(stage, C.bg, { fadeIn: scene.fadeIn !== false && i > 0, fadeOut: scene.fadeOut !== false && i < scenes.length - 1, dur: scene.dur });
      update = (t) => { draw(t); ov.update(t); fade(t); };
      update(0);
      return true;
    },
    seek(t) {
      update(t);
      return true;
    },
  };
})();
