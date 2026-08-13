(function runGameGardenStartup() {
  var root = document.documentElement;
  var loader = document.getElementById("game-garden-startup");
  var startedAt = Date.now();
  var finished = false;
  var minimumDisplayMs = 220;
  var exitTransitionMs = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
  root.classList.add("startup-controller-ready");

  if (!loader) {
    root.classList.remove("startup-active");
    return;
  }

  var progressLabel = loader.querySelector("[data-startup-progress]");

  function setProgress(value) {
    var bounded = Math.max(8, Math.min(100, value));
    loader.style.setProperty("--startup-progress", bounded + "%");
    if (progressLabel) progressLabel.textContent = String(Math.round(bounded)).padStart(2, "0") + "%";
  }

  function exitLoader() {
    if (finished) return;
    finished = true;
    var remaining = Math.max(0, minimumDisplayMs - (Date.now() - startedAt));
    window.setTimeout(function completeStartup() {
      setProgress(100);
      loader.classList.add("startup-loader-complete");
      loader.setAttribute("aria-label", "Game Garden ready");
      window.setTimeout(function hideStartup() {
        root.classList.remove("startup-active");
        root.classList.remove("startup-controller-ready");
        loader.setAttribute("aria-hidden", "true");
      }, exitTransitionMs);
    }, remaining);
  }

  setProgress(24);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function onContentReady() {
      setProgress(58);
    }, { once: true });
  } else {
    setProgress(58);
  }

  window.addEventListener("load", function onWindowLoad() {
    setProgress(86);
    exitLoader();
  }, { once: true });

  document.addEventListener("game-garden:ready", function onGardenReady() {
    setProgress(94);
    exitLoader();
  }, { once: true });

  window.setTimeout(exitLoader, 2500);
})();
