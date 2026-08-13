(function initializeClipplaneTheme() {
  const storageKey = "clipplane.appearance";
  const options = new Set(["system", "light", "dark"]);
  const root = document.documentElement;
  let currentPreference = "system";

  function readPreference() {
    try {
      const value = localStorage.getItem(storageKey);
      return options.has(value) ? value : "system";
    } catch {
      return "system";
    }
  }

  function updateControls(preference) {
    for (const control of document.querySelectorAll("[data-theme-option]")) {
      const active = control.dataset.themeOption === preference;
      control.classList.toggle("is-active", active);
      control.setAttribute("aria-pressed", String(active));
    }
  }

  function applyPreference(preference, persist = false) {
    const nextPreference = options.has(preference) ? preference : "system";
    currentPreference = nextPreference;
    if (nextPreference === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.dataset.theme = nextPreference;
    }

    if (persist) {
      try {
        localStorage.setItem(storageKey, nextPreference);
      } catch {
        // The system theme still works when extension storage is unavailable.
      }
    }

    updateControls(nextPreference);
    return nextPreference;
  }

  applyPreference(readPreference());

  function bindControls() {
    updateControls(currentPreference);
    for (const control of document.querySelectorAll("[data-theme-option]")) {
      control.addEventListener("click", () => {
        applyPreference(control.dataset.themeOption, true);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindControls, { once: true });
  } else {
    bindControls();
  }

  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) {
      applyPreference(readPreference());
    }
  });

  window.ClipplaneTheme = Object.freeze({
    getPreference: readPreference,
    setPreference: (nextPreference) => applyPreference(nextPreference, true)
  });
})();
