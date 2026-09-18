"use strict";

/**
 * Reveal on scroll, with two guarantees that matter more than the effect:
 * anything already on screen shows immediately, and everything shows
 * unconditionally after a short delay. Content must never be stuck invisible
 * because an observer did not fire — a hidden tab alone is enough to stop one.
 */
(() => {
  const targets = [...document.querySelectorAll(".r")];
  if (!targets.length) return;

  const show = (el, delay = 0) => {
    if (el.classList.contains("in")) return;
    if (delay) setTimeout(() => el.classList.add("in"), delay);
    else el.classList.add("in");
  };

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("IntersectionObserver" in window)) {
    targets.forEach((el) => show(el));
    return;
  }

  // Above the fold at load: no reason to make anyone wait.
  targets.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight * 0.9) show(el);
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      show(entry.target, Number(entry.target.dataset.d || 0));
      io.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });

  targets.forEach((el) => { if (!el.classList.contains("in")) io.observe(el); });

  // Backstop. Whatever happened, nothing stays invisible.
  setTimeout(() => targets.forEach((el) => show(el)), 2200);
})();

/**
 * Count up on reveal. Numbers that arrive read as measured; numbers that are
 * simply printed read as claimed.
 */
(() => {
  const nums = [...document.querySelectorAll("[data-count]")];
  if (!nums.length) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const render = (el, v) => {
    const dp = Number(el.dataset.dp || 0);
    const unit = el.querySelector(".unit");
    el.textContent = v.toFixed(dp);
    if (unit) el.appendChild(unit);
  };

  /** Write the true value with no animation. The backstop must never leave a
   *  counter showing 0, which would be a wrong number rather than a missing one. */
  const settle = (el) => {
    el.dataset.done = "1";
    render(el, Number(el.dataset.count));
  };

  const run = (el) => {
    if (el.dataset.done) return;
    el.dataset.done = "1";
    const target = Number(el.dataset.count);
    if (reduced || target === 0 || typeof requestAnimationFrame !== "function") return render(el, target);

    const dur = 900, t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      // ease-out cubic: fast arrival, settled landing
      render(el, target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
      else render(el, target);
    };
    requestAnimationFrame(tick);
    // If rAF never runs (hidden tab, throttled), land on the real number anyway.
    setTimeout(() => render(el, target), dur + 400);
  };

  if (!("IntersectionObserver" in window)) return nums.forEach(run);
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } });
  }, { threshold: 0.4 });
  nums.forEach((el) => io.observe(el));
  setTimeout(() => nums.forEach((el) => (el.dataset.done ? render(el, Number(el.dataset.count)) : settle(el))), 2600);
})();
