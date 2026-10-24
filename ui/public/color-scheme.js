// Light or dark (docs/spec/ui-revisions-9.md item 2), set on <html> before the page first paints so
// a dark-mode reader never sees a white flash. A plain same-origin script: the CSP allows
// script-src 'self' only, so this can't be inline. The choice saved in Settings wins; without one,
// the device's setting does. ui/src/lib/colorScheme.ts keeps it up to date afterwards.
(function () {
  var scheme = null;
  try {
    var saved = window.localStorage.getItem("river:color-scheme");
    if (saved === "light" || saved === "dark") scheme = saved;
  } catch (e) {
    // Storage blocked: fall back to the device's setting.
  }
  if (!scheme) {
    scheme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.scheme = scheme;
})();
