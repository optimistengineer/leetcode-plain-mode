const { createChromeMock } = require("./chrome-mock");

let chrome;

beforeEach(() => {
  jest.useFakeTimers();
  chrome = createChromeMock();
  global.chrome = chrome;
  // Clear module cache so background.js re-registers listeners
  jest.resetModules();
});

afterEach(() => {
  jest.useRealTimers();
  delete global.chrome;
});

function loadBackground() {
  require("../background.js");
}

// ─── onInstalled ──────────────────────────────────────────────

describe("onInstalled", () => {
  test("sets enabled=true on first install when undefined", () => {
    loadBackground();
    const handler = chrome._listeners.installed[0];
    handler();

    expect(chrome.storage.local.get).toHaveBeenCalledWith("enabled", expect.any(Function));
    // storage.get returns undefined for "enabled" by default
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ enabled: true });
  });

  test("does not overwrite existing enabled=false", () => {
    chrome._storageData.enabled = false;
    loadBackground();
    const handler = chrome._listeners.installed[0];
    handler();

    // set should not be called since enabled is already defined
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test("does not overwrite existing enabled=true", () => {
    chrome._storageData.enabled = true;
    loadBackground();
    const handler = chrome._listeners.installed[0];
    handler();

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ─── PLAIN_OPTIONS / ORIGINAL_OPTIONS ─────────────────────────

describe("option configs", () => {
  test("PLAIN_OPTIONS disables all IDE features", () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/two-sum" }])
    );

    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 1 },
        world: "MAIN",
        args: [
          expect.objectContaining({
            autoClosingBrackets: "never",
            quickSuggestions: false,
            lineNumbers: "off",
            fontFamily: "Consolas, 'Courier New', monospace",
          }),
          true,
          4, // default tabSize
        ],
      })
    );
  });

  test("ORIGINAL_OPTIONS restores IDE features", () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/two-sum" }])
    );

    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: false }, {}, jest.fn());

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          expect.objectContaining({
            autoClosingBrackets: "languageDefined",
            quickSuggestions: true,
            lineNumbers: "on",
          }),
          false,
          4,
        ],
      })
    );
  });
});

// ─── Message handling: toggle ─────────────────────────────────

describe("toggle message", () => {
  test("applies to active leetcode tab", async () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 42, url: "https://leetcode.com/problems/foo" }])
    );

    const sendResponse = jest.fn();
    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, sendResponse);

    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    // sendResponse is now called after await applyToTab — flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  test("uses stored tabSize when toggling", () => {
    chrome._storageData.tabSize = 4;
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 42, url: "https://leetcode.com/problems/foo" }])
    );

    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([4]),
      })
    );
  });

  test("does not apply to non-leetcode tabs", () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 42, url: "https://google.com" }])
    );

    const sendResponse = jest.fn();
    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("does not apply when no tabs returned", () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) => cb([]));

    const sendResponse = jest.fn();
    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, sendResponse);

    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("retries when initial apply fails and enabling", async () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/test" }])
    );
    // First call fails, subsequent succeed
    chrome.scripting.executeScript
      .mockResolvedValueOnce([{ result: { success: false, reason: "no monaco" } }])
      .mockResolvedValue([{ result: { success: true, editorCount: 1 } }]);

    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());

    // Wait for the initial applyToTab to complete
    await Promise.resolve();
    await Promise.resolve();
    // Advance timer for retry
    await jest.advanceTimersByTimeAsync(600);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
  });

  test("does not retry when disabling", async () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/test" }])
    );
    chrome.scripting.executeScript.mockResolvedValue([
      { result: { success: false, reason: "no monaco" } },
    ]);

    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: false }, {}, jest.fn());

    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(5000);
    // Only the initial call, no retries
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
});

// ─── Message handling: reapply ────────────────────────────────

// ─── Message handling: reapply ────────────────────────────────

describe("reapply message", () => {
  test("applies when enabled is true", async () => {
    chrome._storageData.enabled = true;
    loadBackground();

    const sendResponse = jest.fn();
    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "reapply" }, { tab: { id: 5 } }, sendResponse);

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 5 } })
    );
    // sendResponse is now called after await applyToTab — flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  test("applies when enabled is undefined (default true)", () => {
    // enabled is undefined — should treat as true
    loadBackground();

    const sendResponse = jest.fn();
    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "reapply" }, { tab: { id: 5 } }, sendResponse);

    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  test("uses stored tabSize on reapply", () => {
    chrome._storageData.enabled = true;
    chrome._storageData.tabSize = 2;
    loadBackground();

    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "reapply" }, { tab: { id: 5 } }, jest.fn());

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([2]),
      })
    );
  });

  test("does not apply when enabled is false", () => {
    chrome._storageData.enabled = false;
    loadBackground();

    const sendResponse = jest.fn();
    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "reapply" }, { tab: { id: 5 } }, sendResponse);

    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("does not apply when no sender tab", () => {
    chrome._storageData.enabled = true;
    loadBackground();

    const sendResponse = jest.fn();
    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "reapply" }, {}, sendResponse);

    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

// ─── tabs.onUpdated ───────────────────────────────────────────

describe("tabs.onUpdated", () => {
  test("applies on complete for leetcode tabs when enabled", () => {
    chrome._storageData.enabled = true;
    loadBackground();

    const handler = chrome._listeners.tabsUpdated[0];
    handler(10, { status: "complete" }, { url: "https://leetcode.com/problems/test" });

    // Should call storage.get then applyWithRetry
    expect(chrome.storage.local.get).toHaveBeenCalledWith(["enabled", "tabSize", "fontFamily"], expect.any(Function));
  });

  test("applies when enabled is undefined (default true)", async () => {
    // enabled is undefined
    loadBackground();

    const handler = chrome._listeners.tabsUpdated[0];
    handler(10, { status: "complete" }, { url: "https://leetcode.com/problems/test" });

    await jest.advanceTimersByTimeAsync(600);
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  test("does not apply when enabled is false", async () => {
    chrome._storageData.enabled = false;
    loadBackground();

    const handler = chrome._listeners.tabsUpdated[0];
    handler(10, { status: "complete" }, { url: "https://leetcode.com/problems/test" });

    await jest.advanceTimersByTimeAsync(5000);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("ignores non-complete status", async () => {
    chrome._storageData.enabled = true;
    loadBackground();

    const handler = chrome._listeners.tabsUpdated[0];
    handler(10, { status: "loading" }, { url: "https://leetcode.com/problems/test" });

    await jest.advanceTimersByTimeAsync(5000);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("ignores non-leetcode URLs", async () => {
    chrome._storageData.enabled = true;
    loadBackground();

    const handler = chrome._listeners.tabsUpdated[0];
    handler(10, { status: "complete" }, { url: "https://github.com" });

    await jest.advanceTimersByTimeAsync(5000);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("ignores tabs without URL", async () => {
    chrome._storageData.enabled = true;
    loadBackground();

    const handler = chrome._listeners.tabsUpdated[0];
    handler(10, { status: "complete" }, {});

    await jest.advanceTimersByTimeAsync(5000);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

// ─── applyToTab error handling ────────────────────────────────

describe("applyToTab error handling", () => {
  test("returns false when executeScript throws", async () => {
    loadBackground();
    chrome.scripting.executeScript.mockRejectedValue(new Error("tab closed"));
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/test" }])
    );

    const msgHandler = chrome._listeners.message[0];
    const sendResponse = jest.fn();
    msgHandler({ type: "toggle", enabled: true }, {}, sendResponse);

    // Wait for the async apply
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(600);
    // Should not crash — the try/catch handles it
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  test("returns false when result is null", async () => {
    loadBackground();
    chrome.scripting.executeScript.mockResolvedValue(null);
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/test" }])
    );

    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: false }, {}, jest.fn());

    await Promise.resolve();
    // Should not crash
  });

  test("returns false when results array is empty", async () => {
    loadBackground();
    chrome.scripting.executeScript.mockResolvedValue([]);
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/test" }])
    );

    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());

    await Promise.resolve();
  });
});

// ─── applyWithRetry ───────────────────────────────────────────

describe("applyWithRetry", () => {
  test("stops retrying after success", async () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/test" }])
    );
    chrome.scripting.executeScript
      .mockResolvedValueOnce([{ result: { success: false } }]) // initial call
      .mockResolvedValueOnce([{ result: { success: false } }]) // retry 1
      .mockResolvedValueOnce([{ result: { success: true, editorCount: 1 } }]); // retry 2

    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());

    // Wait for initial apply to fail
    await Promise.resolve();
    // Advance through retries
    await jest.advanceTimersByTimeAsync(10000);

    // Initial + 2 retries = 3 calls
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3);
  });

  test("gives up after max attempts", async () => {
    loadBackground();
    chrome._storageData.enabled = true;

    chrome.scripting.executeScript.mockResolvedValue([
      { result: { success: false, reason: "no monaco" } },
    ]);

    const handler = chrome._listeners.tabsUpdated[0];
    handler(1, { status: "complete" }, { url: "https://leetcode.com/problems/test" });

    // Advance through all 8 retries (each up to 4s max)
    await jest.advanceTimersByTimeAsync(40000);

    // Should have tried 8 times
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(8);
  });
});

// ─── Injected function logic ──────────────────────────────────

describe("injected function (Monaco manipulation)", () => {
  // We extract and test the function that gets injected via executeScript
  // by capturing it from the executeScript call args

  function getInjectedFunc() {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/test" }])
    );
    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());

    const call = chrome.scripting.executeScript.mock.calls[0][0];
    return call.func;
  }

  test("returns failure when no monaco", () => {
    const func = getInjectedFunc();
    // Simulate no window.monaco
    const origWindow = global.window;
    global.window = {};
    const result = func({}, true, 8);
    expect(result).toEqual({ success: false, reason: "no monaco" });
    global.window = origWindow;
  });

  test("returns failure when no editors", () => {
    const func = getInjectedFunc();
    global.window = {
      monaco: {
        editor: {
          getEditors: () => [],
        },
      },
    };
    const result = func({}, true, 8);
    expect(result).toEqual({ success: false, reason: "no editors" });
    delete global.window;
  });

  test("enables plain mode on editor", () => {
    const func = getInjectedFunc();
    const mockModel = {
      getLanguageId: () => "javascript",
      getOptions: () => ({ tabSize: 4, indentSize: 4, insertSpaces: true }),
      updateOptions: jest.fn(),
    };
    const mockEditor = {
      getModel: () => mockModel,
      updateOptions: jest.fn(),
    };
    global.window = {
      monaco: {
        editor: {
          getEditors: () => [mockEditor],
          setModelLanguage: jest.fn(),
        },
      },
    };

    const opts = { lineNumbers: "off" };
    const result = func(opts, true, 8);

    expect(result).toEqual({ success: true, editorCount: 1 });
    expect(window.monaco.editor.setModelLanguage).toHaveBeenCalledWith(mockModel, "plaintext");
    expect(mockModel.updateOptions).toHaveBeenCalledWith({ tabSize: 8, indentSize: 8, insertSpaces: true });
    expect(mockEditor.updateOptions).toHaveBeenCalledWith(opts);
    expect(mockEditor.__originalLang).toBe("javascript");
    expect(mockEditor.__originalTabSize).toBe(4);
    expect(mockEditor.__originalIndentSize).toBe(4);
    expect(mockEditor.__originalInsertSpaces).toBe(true);

    delete global.window;
  });

  test("uses custom tab size in model options", () => {
    const func = getInjectedFunc();
    const mockModel = {
      getLanguageId: () => "javascript",
      getOptions: () => ({ tabSize: 4, indentSize: 4, insertSpaces: true }),
      updateOptions: jest.fn(),
    };
    const mockEditor = {
      getModel: () => mockModel,
      updateOptions: jest.fn(),
    };
    global.window = {
      monaco: {
        editor: {
          getEditors: () => [mockEditor],
          setModelLanguage: jest.fn(),
        },
      },
    };

    func({}, true, 2);
    expect(mockModel.updateOptions).toHaveBeenCalledWith({ tabSize: 2, indentSize: 2, insertSpaces: true });

    delete global.window;
  });

  test("does not overwrite original values on re-apply (tab size change)", () => {
    const func = getInjectedFunc();
    const mockModel = {
      getLanguageId: () => "plaintext",
      getOptions: () => ({ tabSize: 8, indentSize: 8, insertSpaces: true }),
      updateOptions: jest.fn(),
    };
    const mockEditor = {
      getModel: () => mockModel,
      updateOptions: jest.fn(),
      // Already has originals saved from first apply
      __originalLang: "javascript",
      __originalTabSize: 4,
      __originalIndentSize: 4,
      __originalInsertSpaces: true,
    };
    global.window = {
      monaco: {
        editor: {
          getEditors: () => [mockEditor],
          setModelLanguage: jest.fn(),
        },
      },
    };

    // Re-apply with new tab size
    func({}, true, 2);

    // Original values should NOT be overwritten
    expect(mockEditor.__originalTabSize).toBe(4);
    expect(mockEditor.__originalIndentSize).toBe(4);
    expect(mockEditor.__originalInsertSpaces).toBe(true);
    // But model should get the new tab size
    expect(mockModel.updateOptions).toHaveBeenCalledWith({ tabSize: 2, indentSize: 2, insertSpaces: true });

    delete global.window;
  });

  test("does not overwrite __originalLang if already plaintext", () => {
    const func = getInjectedFunc();
    const mockModel = {
      getLanguageId: () => "plaintext",
      getOptions: () => ({ tabSize: 4, insertSpaces: true }),
      updateOptions: jest.fn(),
    };
    const mockEditor = {
      getModel: () => mockModel,
      updateOptions: jest.fn(),
    };
    global.window = {
      monaco: {
        editor: {
          getEditors: () => [mockEditor],
          setModelLanguage: jest.fn(),
        },
      },
    };

    func({}, true, 8);
    expect(mockEditor.__originalLang).toBeUndefined();

    delete global.window;
  });

  test("disables plain mode and restores originals", () => {
    const func = getInjectedFunc();
    const mockModel = {
      getLanguageId: () => "plaintext",
      getOptions: () => ({ tabSize: 8, indentSize: 8, insertSpaces: true }),
      updateOptions: jest.fn(),
    };
    const mockEditor = {
      getModel: () => mockModel,
      updateOptions: jest.fn(),
      __originalLang: "python",
      __originalTabSize: 2,
      __originalIndentSize: 2,
      __originalInsertSpaces: false,
    };
    global.window = {
      monaco: {
        editor: {
          getEditors: () => [mockEditor],
          setModelLanguage: jest.fn(),
        },
      },
    };

    const opts = { lineNumbers: "on" };
    const result = func(opts, false, 8);

    expect(result).toEqual({ success: true, editorCount: 1 });
    expect(window.monaco.editor.setModelLanguage).toHaveBeenCalledWith(mockModel, "python");
    expect(mockModel.updateOptions).toHaveBeenCalledWith({ tabSize: 2, indentSize: 2, insertSpaces: false });
    expect(mockEditor.__originalLang).toBeUndefined();
    expect(mockEditor.__originalTabSize).toBeUndefined();
    expect(mockEditor.__originalIndentSize).toBeUndefined();
    expect(mockEditor.__originalInsertSpaces).toBeUndefined();
    expect(mockEditor.updateOptions).toHaveBeenCalledWith(opts);

    delete global.window;
  });

  test("uses defaults when no originals saved", () => {
    const func = getInjectedFunc();
    const mockModel = {
      getLanguageId: () => "plaintext",
      getOptions: () => ({ tabSize: 8, insertSpaces: true }),
      updateOptions: jest.fn(),
    };
    const mockEditor = {
      getModel: () => mockModel,
      updateOptions: jest.fn(),
      // No __originalLang, __originalTabSize, __originalInsertSpaces
    };
    global.window = {
      monaco: {
        editor: {
          getEditors: () => [mockEditor],
          setModelLanguage: jest.fn(),
        },
      },
    };

    func({}, false, 8);

    // Should not call setModelLanguage since __originalLang is not set
    expect(window.monaco.editor.setModelLanguage).not.toHaveBeenCalled();
    // Should use defaults for tabSize (4), indentSize (4), and insertSpaces (true)
    expect(mockModel.updateOptions).toHaveBeenCalledWith({ tabSize: 4, indentSize: 4, insertSpaces: true });

    delete global.window;
  });

  test("handles editor with null model gracefully", () => {
    const func = getInjectedFunc();
    const mockEditor = {
      getModel: () => null,
      updateOptions: jest.fn(),
    };
    global.window = {
      monaco: {
        editor: {
          getEditors: () => [mockEditor],
          setModelLanguage: jest.fn(),
        },
      },
    };

    // Should not crash
    const result = func({}, true, 8);
    expect(result).toEqual({ success: true, editorCount: 1 });
    expect(window.monaco.editor.setModelLanguage).not.toHaveBeenCalled();
    expect(mockEditor.updateOptions).toHaveBeenCalled();

    delete global.window;
  });

  test("handles multiple editors", () => {
    const func = getInjectedFunc();
    const createMockEditor = () => ({
      getModel: () => ({
        getLanguageId: () => "cpp",
        getOptions: () => ({ tabSize: 2, insertSpaces: true }),
        updateOptions: jest.fn(),
      }),
      updateOptions: jest.fn(),
    });
    const editor1 = createMockEditor();
    const editor2 = createMockEditor();

    global.window = {
      monaco: {
        editor: {
          getEditors: () => [editor1, editor2],
          setModelLanguage: jest.fn(),
        },
      },
    };

    const result = func({}, true, 8);
    expect(result).toEqual({ success: true, editorCount: 2 });
    expect(editor1.updateOptions).toHaveBeenCalled();
    expect(editor2.updateOptions).toHaveBeenCalled();

    delete global.window;
  });

  test("survives editor error without crashing other editors", () => {
    const func = getInjectedFunc();
    const badEditor = {
      getModel: () => {
        throw new Error("editor disposed");
      },
      updateOptions: jest.fn(),
    };
    const goodEditor = {
      getModel: () => ({
        getLanguageId: () => "java",
        getOptions: () => ({ tabSize: 4, insertSpaces: true }),
        updateOptions: jest.fn(),
      }),
      updateOptions: jest.fn(),
    };

    // Spy on console.warn
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    global.window = {
      monaco: {
        editor: {
          getEditors: () => [badEditor, goodEditor],
          setModelLanguage: jest.fn(),
        },
      },
    };

    const result = func({}, true, 8);
    expect(result).toEqual({ success: true, editorCount: 2 });
    // Good editor should still be updated
    expect(goodEditor.updateOptions).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    delete global.window;
  });

  test("checks window.lcMonaco as fallback", () => {
    const func = getInjectedFunc();
    const mockEditor = {
      getModel: () => null,
      updateOptions: jest.fn(),
    };
    global.window = {
      lcMonaco: {
        editor: {
          getEditors: () => [mockEditor],
          setModelLanguage: jest.fn(),
        },
      },
    };

    const result = func({}, true, 8);
    expect(result).toEqual({ success: true, editorCount: 1 });

    delete global.window;
  });
});

// ═══════════════════════════════════════════════════════════════
// Bug fix regression tests
// ═══════════════════════════════════════════════════════════════

// ─── Fix: stale toggle retries cancelled via generation ──────

describe("BUG FIX: toggle generation (stale retry cancellation)", () => {
  test("rapid toggle OFF cancels pending enable retries", async () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/test" }])
    );
    // All calls fail — retries will keep firing if not cancelled
    chrome.scripting.executeScript.mockResolvedValue([
      { result: { success: false, reason: "no monaco" } },
    ]);

    const msgHandler = chrome._listeners.message[0];

    // Toggle ON — starts retries in background
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());

    // Wait for initial applyToTab + applyWithRetry's first immediate attempt
    await Promise.resolve();
    await Promise.resolve();

    // 2 calls: toggle handler's applyToTab + applyWithRetry's first attempt (attempt-first ordering)
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);

    // Quickly toggle OFF — should cancel the stale enable retries
    msgHandler({ type: "toggle", enabled: false }, {}, jest.fn());

    // Wait for the disable's applyToTab
    await Promise.resolve();
    await Promise.resolve();

    // 3 calls: +1 for the disable toggle's applyToTab
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3);

    // Advance timers way past the entire retry schedule
    // Old behavior: retries from the enable would keep firing
    await jest.advanceTimersByTimeAsync(40000);

    // No additional calls — stale enable retries were cancelled by generation check
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3);
  });

  test("second enable cancels first enable's retries", async () => {
    loadBackground();
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 1, url: "https://leetcode.com/problems/test" }])
    );

    let callCount = 0;
    chrome.scripting.executeScript.mockImplementation(() => {
      callCount++;
      return Promise.resolve([{ result: { success: false } }]);
    });

    const msgHandler = chrome._listeners.message[0];

    // First toggle ON (gen=1): handler's applyToTab + applyWithRetry's 1st attempt = 2 calls
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(callCount).toBe(2);

    // Second toggle ON (gen=2): +2 more calls (handler's applyToTab + applyWithRetry's 1st attempt)
    // First toggle's applyWithRetry is now stale (gen=1 !== toggleGeneration=2)
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(callCount).toBe(4);

    // Advance through full retry schedule
    await jest.advanceTimersByTimeAsync(40000);

    // Should have: 4 calls so far + at most 7 more retries from second toggle = 11
    // WITHOUT the fix: first toggle's retries would also continue = 4 + 7 + 7 = 18
    expect(callCount).toBeLessThanOrEqual(12);
    // Also verify it's not the broken behavior with double retries
    expect(callCount).toBeLessThan(18);
  });

  test("onUpdated retries are not affected by toggle generation", async () => {
    loadBackground();
    chrome._storageData.enabled = true;
    chrome.scripting.executeScript
      .mockResolvedValueOnce([{ result: { success: false } }])
      .mockResolvedValue([{ result: { success: true, editorCount: 1 } }]);

    // Trigger via onUpdated (no generation — should not be cancelled by toggles)
    const handler = chrome._listeners.tabsUpdated[0];
    handler(1, { status: "complete" }, { url: "https://leetcode.com/problems/test" });

    // Now toggle — this increments toggleGeneration
    chrome.tabs.query.mockImplementation((q, cb) =>
      cb([{ id: 2, url: "https://leetcode.com/problems/other" }])
    );
    const msgHandler = chrome._listeners.message[0];
    msgHandler({ type: "toggle", enabled: true }, {}, jest.fn());

    // Advance timers — onUpdated's retry should still succeed
    await jest.advanceTimersByTimeAsync(5000);

    // Both the onUpdated retry and the toggle should have called executeScript
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3); // 1 fail + 1 retry success (onUpdated) + 1 toggle
  });
});

// ─── Fix: retry attempts before delay (not delay-first) ──────

describe("BUG FIX: retry attempts before delay", () => {
  test("applyWithRetry calls executeScript immediately without delay", async () => {
    loadBackground();
    chrome._storageData.enabled = true;
    chrome.scripting.executeScript.mockResolvedValue([
      { result: { success: false } },
    ]);

    const handler = chrome._listeners.tabsUpdated[0];
    handler(1, { status: "complete" }, { url: "https://leetcode.com/problems/test" });

    // With attempt-first ordering, executeScript is called immediately
    // (no 500ms delay before first try)
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  test("delay occurs between failed attempts, not before first", async () => {
    loadBackground();
    chrome._storageData.enabled = true;
    chrome.scripting.executeScript.mockResolvedValue([
      { result: { success: false } },
    ]);

    const handler = chrome._listeners.tabsUpdated[0];
    handler(1, { status: "complete" }, { url: "https://leetcode.com/problems/test" });

    // 1st attempt: immediate
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Wait 200ms — not yet enough for retry delay (500ms)
    await jest.advanceTimersByTimeAsync(200);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Wait past the first delay (500ms total)
    await jest.advanceTimersByTimeAsync(400);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);

    // Wait past the second delay (~750ms after 2nd attempt)
    await jest.advanceTimersByTimeAsync(800);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3);
  });

  test("succeeds on first attempt with zero wasted time", async () => {
    loadBackground();
    chrome._storageData.enabled = true;
    chrome.scripting.executeScript.mockResolvedValue([
      { result: { success: true, editorCount: 1 } },
    ]);

    const handler = chrome._listeners.tabsUpdated[0];
    handler(1, { status: "complete" }, { url: "https://leetcode.com/problems/test" });

    // Should succeed immediately — no timer needed
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);

    // Advance a long time — no additional calls
    await jest.advanceTimersByTimeAsync(40000);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
});
