// Content script — runs at document_start (before page renders).
// Adds CSS class instantly to prevent syntax highlighting flash,
// then watches for SPA navigations and editor re-creation.
// Disabled on contest pages so you get full IDE during timed contests.

function isContestPage() {
  return /leetcode\.com\/contest\b/.test(location.href);
}

const FONT_CSS_MAP = {
  "sf-mono": '"SF Mono", Menlo, monospace',
  "consolas": 'Consolas, "Courier New", monospace',
};

function applyFontCssVar(fontKey) {
  const val = FONT_CSS_MAP[fontKey] || FONT_CSS_MAP["consolas"];
  document.documentElement.style.setProperty("--lpm-font-family", val);
}

// MutationObservers are DOM-level and keep firing after an extension
// reload/update even though chrome.* APIs are no longer valid.
// This guard lets us detect that and tear down gracefully.
function contextValid() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

// Apply CSS class immediately (document.documentElement exists at document_start)
// Default to enabled (enabled !== false means on)
chrome.storage.local.get(["enabled", "fontFamily"], (data) => {
  if (data.enabled !== false && !isContestPage()) {
    document.documentElement.classList.add("leetcode-plain-active");
    applyFontCssVar(data.fontFamily || "consolas");
  }
});

// Listen for storage changes from popup
chrome.storage.onChanged.addListener((changes) => {
  if (!contextValid()) return;
  if (changes.enabled) {
    if (changes.enabled.newValue !== false && !isContestPage()) {
      document.documentElement.classList.add("leetcode-plain-active");
      chrome.storage.local.get("fontFamily", (data) => {
        applyFontCssVar(data.fontFamily || "consolas");
      });
    } else {
      document.documentElement.classList.remove("leetcode-plain-active");
    }
  }
  // Forward font changes to the MAIN world content script via CustomEvent
  if (changes.fontFamily && changes.fontFamily.newValue != null && !isContestPage()) {
    applyFontCssVar(changes.fontFamily.newValue);
    chrome.storage.local.get("enabled", (data) => {
      if (data.enabled !== false) {
        document.dispatchEvent(
          new CustomEvent("__lpm_update_fontfamily", {
            detail: changes.fontFamily.newValue,
          })
        );
      }
    });
  }
  // Forward tab-size changes to the MAIN world content script via CustomEvent
  if (changes.tabSize && changes.tabSize.newValue != null && !isContestPage()) {
    chrome.storage.local.get("enabled", (data) => {
      if (data.enabled !== false) {
        document.dispatchEvent(
          new CustomEvent("__lpm_update_tabsize", {
            detail: changes.tabSize.newValue,
          })
        );
      }
    });
  }
});

// --- SPA navigation and editor re-creation detection ---
// These need DOM to be ready, so wait for it.
function onDomReady(fn) {
  if (document.body) return fn();
  const obs = new MutationObserver(() => {
    try {
      if (!contextValid()) { obs.disconnect(); return; }
      if (document.body) {
        obs.disconnect();
        fn();
      }
    } catch {
      obs.disconnect();
    }
  });
  obs.observe(document.documentElement, { childList: true });
}

onDomReady(() => {
  let lastUrl = location.href;

  // Detect SPA navigation (LeetCode uses pushState/replaceState)
  const urlObserver = new MutationObserver(() => {
    if (!contextValid()) {
      urlObserver.disconnect();
      editorObserver.disconnect();
      return;
    }
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Re-attach editor observer for the new page
      editorObserver.disconnect();
      watchAttempts = 0;
      if (isContestPage()) {
        document.documentElement.classList.remove("leetcode-plain-active");
        return;
      }
      watchEditorContainer();
      chrome.storage.local.get(["enabled", "fontFamily"], (data) => {
        if (data.enabled !== false) {
          document.documentElement.classList.add("leetcode-plain-active");
          applyFontCssVar(data.fontFamily || "consolas");
          scheduleReapply();
        }
      });
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // Watch for Monaco editor DOM re-creation (language switch etc.)
  const editorObserver = new MutationObserver((mutations) => {
    if (!contextValid()) {
      urlObserver.disconnect();
      editorObserver.disconnect();
      return;
    }
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.querySelector?.(".monaco-editor")) {
          chrome.storage.local.get("enabled", (data) => {
            if (data.enabled !== false) scheduleReapply();
          });
          return;
        }
      }
    }
  });

  let watchAttempts = 0;
  const MAX_WATCH_ATTEMPTS = 30;
  function watchEditorContainer() {
    if (!contextValid()) return;
    const container =
      document.querySelector(".monaco-editor")?.parentElement;
    if (container) {
      editorObserver.observe(container, { childList: true, subtree: true });
    } else if (++watchAttempts < MAX_WATCH_ATTEMPTS) {
      setTimeout(watchEditorContainer, 1000);
    }
  }
  watchEditorContainer();

  // Debounced re-apply for Monaco API options
  let reapplyTimers = [];
  function scheduleReapply() {
    reapplyTimers.forEach(clearTimeout);
    reapplyTimers = [500, 1500, 3000].map((delay) =>
      setTimeout(() => {
        if (!contextValid()) return;
        chrome.runtime.sendMessage({ type: "reapply" });
      }, delay)
    );
  }
});
