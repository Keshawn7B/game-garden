(function restoreGameGardenTheme() {
  try {
    var savedTheme = window.localStorage.getItem("game-garden-theme");
    if (savedTheme === "sakura" || savedTheme === "gold") {
      document.documentElement.dataset.theme = savedTheme;
    } else {
      delete document.documentElement.dataset.theme;
    }
  } catch {
    // The default red theme remains active when device storage is unavailable.
  }
})();
