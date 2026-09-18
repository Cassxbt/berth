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

/**
 * Autoplay. Each slide holds for as long as its narration needs, so a screen
 * recording of this is the pitch itself rather than a slideshow someone has to
 * drive. Durations are seconds and are tuned to the script, not to a constant.
 */
const HOLD = [7, 11, 10, 14, 12, 13, 14, 13, 11, 13, 12, 13, 9];

let timer = null, raf = null, playing = false;
const playBtn = document.getElementById("play");

function stop() {
  playing = false;
  clearTimeout(timer); cancelAnimationFrame(raf);
  document.body.classList.remove("presenting");
  playBtn.classList.remove("on");
  playBtn.textContent = "Play";
  const t = document.querySelector(".slide-timer i");
  if (t) t.style.width = "0";
}

function holdThenAdvance() {
  const ms = (HOLD[i] ?? 11) * 1000;
  const t = document.querySelector(".slide-timer i");
  const t0 = performance.now();

  const tick = (now) => {
    const p = Math.min((now - t0) / ms, 1);
    if (t) t.style.width = `${p * 100}%`;
    if (p < 1 && playing) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  timer = setTimeout(() => {
    if (!playing) return;
    if (i >= slides.length - 1) return stop();
    show(i + 1);
    holdThenAdvance();
  }, ms);
}

function play() {
  playing = true;
  document.body.classList.add("presenting");
  playBtn.classList.add("on");
  playBtn.textContent = "Pause";
  holdThenAdvance();
}

playBtn.addEventListener("click", () => (playing ? stop() : play()));

// Any manual navigation cancels autoplay rather than fighting it.
["next", "prev"].forEach((id) => document.getElementById(id).addEventListener("click", stop));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") stop();
  else if (e.key.toLowerCase() === "p") { e.preventDefault(); playing ? stop() : play(); }
  else if (playing && ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", " "].includes(e.key)) stop();
});

setTimeout(() => hint && (hint.style.opacity = "0"), 4200);
show(Number(location.hash.slice(1)) - 1 || 0);

// ?play=1 starts presenting immediately, which is what the screen recorder uses.
if (new URLSearchParams(location.search).get("play") === "1") {
  document.documentElement.requestFullscreen?.().catch(() => {});
  setTimeout(play, 900);
}
