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
