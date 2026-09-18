"use strict";

const slides = [...document.querySelectorAll(".slide")];
const bar = document.getElementById("deckbar");
const num = document.getElementById("num");
const hint = document.getElementById("hint");
let i = 0;

function show(n) {
  i = Math.max(0, Math.min(slides.length - 1, n));
  slides.forEach((s, k) => s.classList.toggle("on", k === i));
  bar.style.width = `${((i + 1) / slides.length) * 100}%`;
  num.textContent = `${i + 1} / ${slides.length}`;
  history.replaceState(null, "", `#${i + 1}`);
}

const next = () => show(i + 1);
const prev = () => show(i - 1);

document.addEventListener("keydown", (e) => {
  if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(e.key)) { e.preventDefault(); next(); }
  else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); prev(); }
  else if (e.key === "Home") show(0);
  else if (e.key === "End") show(slides.length - 1);
  else if (e.key.toLowerCase() === "f") {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  }
});

document.getElementById("next").addEventListener("click", next);
document.getElementById("prev").addEventListener("click", prev);

// Advance on click, but never when the click was a link or a control.
document.getElementById("deck").addEventListener("click", (e) => {
  if (e.target.closest("a, button")) return;
  next();
});

// Touch: horizontal swipe only, so vertical scrolling inside a code block still works.
let x0 = null;
addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
addEventListener("touchend", (e) => {
  if (x0 === null) return;
  const dx = e.changedTouches[0].clientX - x0;
  if (Math.abs(dx) > 55) (dx < 0 ? next : prev)();
  x0 = null;
}, { passive: true });

setTimeout(() => hint && (hint.style.opacity = "0"), 4200);
show(Number(location.hash.slice(1)) - 1 || 0);
