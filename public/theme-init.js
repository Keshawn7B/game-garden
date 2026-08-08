(function restoreGameGardenTheme() {
  try {
    var savedTheme = window.localStorage.getItem("game-garden-theme");
    if (savedTheme === "sakura" || savedTheme === "gold") {
      document.documentElement.dataset.theme = savedTheme;
    } else {
      delete document.documentElement.dataset.theme;
    }
    if (window.localStorage.getItem("game-garden-blossom-addon") === "enabled") {
      document.documentElement.dataset.addon = "blossom";
    } else {
      delete document.documentElement.dataset.addon;
    }
  } catch {
    // The default red theme remains active when device storage is unavailable.
  }
})();
