(function restoreGameGardenTheme() {
  try {
    var savedTheme = window.localStorage.getItem("game-garden-theme");
    var themeColors = { classic: "#e60012", sakura: "#e4316b", gold: "#c89216" };
    var activeTheme = savedTheme === "sakura" || savedTheme === "gold" ? savedTheme : "classic";
    var themeColor = document.getElementById("game-garden-theme-color") || document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", themeColors[activeTheme]);
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
