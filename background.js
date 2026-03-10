// Service worker — uses chrome.scripting to inject into page's MAIN world

function isContestPage(url) {
  return /leetcode\.com\/contest\b/.test(url);
}

const FONT_MAP = {
  "sf-mono": "'SF Mono', Menlo, monospace",
  "consolas": "Consolas, 'Courier New', monospace",
};

function resolveFont(fontKey) {
  return FONT_MAP[fontKey] ?? FONT_MAP["consolas"];
}

// Enable by default on first install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("enabled", (data) => {
    if (data.enabled === undefined) {
      chrome.storage.local.set({ enabled: true });
    }
  });
});

const PLAIN_OPTIONS = {
  // Disable all IDE behaviors
  autoClosingBrackets: "never",
  autoClosingQuotes: "never",
  autoClosingDelete: "never",
  autoIndent: "none",
  autoSurround: "never",
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  acceptSuggestionOnEnter: "off",
  tabCompletion: "off",
  wordBasedSuggestions: "off",
  parameterHints: { enabled: false },
  minimap: { enabled: false },
  lineNumbers: "off",
  folding: false,
  matchBrackets: "never",
  renderLineHighlight: "none",
  occurrencesHighlight: "off",
  selectionHighlight: false,
  links: false,
  hover: { enabled: false },
  contextmenu: false,
  codeLens: false,
  lightbulb: { enabled: false },
  inlayHints: { enabled: false },
  bracketPairColorization: { enabled: false },
  guides: { indentation: false, bracketPairs: false },
  renderWhitespace: "none",
  glyphMargin: false,
  // Plain style: Courier New, thin cursor
  fontFamily: "Consolas, 'Courier New', monospace",
  cursorStyle: "line",
  cursorWidth: 2,
  cursorBlinking: "smooth",
};

const ORIGINAL_OPTIONS = {
  autoClosingBrackets: "languageDefined",
  autoClosingQuotes: "languageDefined",
  autoClosingDelete: "auto",
  autoIndent: "full",
  autoSurround: "languageDefined",
  quickSuggestions: true,
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: "on",
  tabCompletion: "normal",
  wordBasedSuggestions: "currentDocument",
  parameterHints: { enabled: true },
  minimap: { enabled: false },
  lineNumbers: "on",
  folding: true,
  matchBrackets: "always",
  renderLineHighlight: "all",
  occurrencesHighlight: "singleFile",
  selectionHighlight: true,
  links: true,
  hover: { enabled: true },
  contextmenu: true,
  codeLens: true,
  lightbulb: { enabled: true },
  inlayHints: { enabled: true },
  bracketPairColorization: { enabled: true },
  guides: { indentation: false, bracketPairs: false },
  renderWhitespace: "none",
  glyphMargin: false,
  fontFamily: "",
  cursorStyle: "line",
  cursorWidth: 0,
  cursorBlinking: "blink",
};

async function applyToTab(tabId, enabled, tabSize = 4, fontFamily = "Consolas, 'Courier New', monospace") {
  const options = enabled ? { ...PLAIN_OPTIONS, fontFamily } : ORIGINAL_OPTIONS;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (opts, shouldEnable, spaces) => {
        const monaco = window.monaco || window.lcMonaco;
        if (!monaco?.editor) return { success: false, reason: "no monaco" };

        const editors = monaco.editor.getEditors();
        if (editors.length === 0)
          return { success: false, reason: "no editors" };

        editors.forEach((editor) => {
          try {
            const model = editor.getModel();
            if (shouldEnable) {
              if (model) {
                const lang = model.getLanguageId();
                if (lang !== "plaintext") {
                  editor.__originalLang = lang;
                }
                const modelOpts = model.getOptions();
                if (!editor.__originalTabSize) {
                  editor.__originalTabSize = modelOpts.tabSize;
                  editor.__originalIndentSize = modelOpts.indentSize;
                  editor.__originalInsertSpaces = modelOpts.insertSpaces;
                }
                monaco.editor.setModelLanguage(model, "plaintext");
                model.updateOptions({ tabSize: spaces, indentSize: spaces, insertSpaces: true });
              }

            } else {
              if (model) {
                if (editor.__originalLang) {
                  monaco.editor.setModelLanguage(model, editor.__originalLang);
                  delete editor.__originalLang;
                }
                model.updateOptions({
                  tabSize: editor.__originalTabSize ?? 4,
                  indentSize: editor.__originalIndentSize ?? editor.__originalTabSize ?? 4,
                  insertSpaces: editor.__originalInsertSpaces ?? true,
                });
                delete editor.__originalTabSize;
                delete editor.__originalIndentSize;
                delete editor.__originalInsertSpaces;
              }

            }
            editor.updateOptions(opts);
          } catch (editorErr) {
            console.warn("[LeetCode Plain Mode] Error updating editor:", editorErr);
          }
        });

        console.log(
          "[LeetCode Plain Mode]",
          shouldEnable ? "Enabled" : "Disabled",
          "on",
          editors.length,
          "editor(s)"
        );
        return { success: true, editorCount: editors.length };
      },
      args: [options, enabled, tabSize],
    });

    const result = results?.[0]?.result;
    return result?.success || false;
  } catch (e) {
    // Tab might have been closed or navigated away
    return false;
  }
}

// Smart retry — keeps trying until Monaco editors are found or max attempts
async function applyWithRetry(tabId, enabled, tabSize = 4, fontFamily = "Consolas, 'Courier New', monospace", maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    const delay = Math.min(500 * Math.pow(1.5, i), 4000); // 500ms, 750ms, 1125ms, ... up to 4s
    await new Promise((r) => setTimeout(r, delay));

    const success = await applyToTab(tabId, enabled, tabSize, fontFamily);
    if (success) return true;
  }
  return false;
}

// Listen for messages from popup and content script
// Each handler returns true to keep the message channel open (and the service
// worker alive) until the async work finishes and sendResponse is called.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "toggle") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (tab?.url?.includes("leetcode.com") && !isContestPage(tab.url)) {
        // CSS class is toggled instantly by content.js listening to storage.onChanged.
        // Here we just handle the Monaco API behavioral changes.
        chrome.storage.local.get(["tabSize", "fontFamily"], async (data) => {
          const tabSize = data.tabSize || 4;
          const font = resolveFont(data.fontFamily);
          const success = await applyToTab(tab.id, msg.enabled, tabSize, font);
          if (!success && msg.enabled) {
            applyWithRetry(tab.id, msg.enabled, tabSize, font);
          }
          sendResponse({ ok: true });
        });
      } else {
        sendResponse({ ok: true });
      }
    });
    return true;
  }

  if (msg.type === "reapply") {
    // Content script detected SPA navigation or editor re-creation
    if (sender.tab?.id && !isContestPage(sender.tab.url || "")) {
      chrome.storage.local.get(["enabled", "tabSize", "fontFamily"], async (data) => {
        if (data.enabled !== false) {
          await applyToTab(sender.tab.id, true, data.tabSize || 4, resolveFont(data.fontFamily));
        }
        sendResponse({ ok: true });
      });
    } else {
      sendResponse({ ok: true });
    }
    return true;
  }
});

// When a LeetCode tab finishes loading, apply Monaco API options.
// CSS class is already applied by content.js at document_start (instant, no flash).
// This only handles the behavioral side (auto-close brackets etc.)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url?.includes("leetcode.com") &&
    !isContestPage(tab.url)
  ) {
    chrome.storage.local.get(["enabled", "tabSize", "fontFamily"], (data) => {
      if (data.enabled !== false) {
        applyWithRetry(tabId, true, data.tabSize || 4, resolveFont(data.fontFamily));
      }
    });
  }
});
