if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
      // The site remains fully usable if a browser blocks service workers.
    });
  }, { once: true });
}
