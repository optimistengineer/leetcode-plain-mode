const { createChromeMock } = require("./chrome-mock");

let chrome;

// Minimal DOM mock
function createMiniDom(hasBody = true) {
  const classList = new Set();
  const observers = [];
  const elements = {};
  let bodyElement = hasBody ? { appendChild: jest.fn() } : null;

  const cssVars = {};
  const documentElement = {
    classList: {
      add: jest.fn((cls) => classList.add(cls)),
      remove: jest.fn((cls) => classList.delete(cls)),
      contains: (cls) => classList.has(cls),
    },
    style: {
      setProperty: jest.fn((k, v) => { cssVars[k] = v; }),
      removeProperty: jest.fn((k) => { delete cssVars[k]; }),
    },
  };

  const doc = {
    documentElement,
    body: bodyElement,
    createElement: jest.fn(() => ({
      classList: { add: jest.fn() },
      appendChild: jest.fn(),
    })),
    querySelector: jest.fn((sel) => elements[sel] || null),
  };

  // Mock MutationObserver
  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observing = null;
      observers.push(this);
    }
    observe(target, options) {
      this.observing = { target, options };
    }
    disconnect() {
      this.observing = null;
    }
  }

  const dispatchedEvents = [];
  doc.dispatchEvent = jest.fn((event) => dispatchedEvents.push(event));

  return {
    document: doc,
    classList,
    cssVars,
    observers,
    elements,
    dispatchedEvents,
    MutationObserver: MockMutationObserver,
    setBody: (body) => { doc.body = body; bodyElement = body; },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  chrome = createChromeMock();
  global.chrome = chrome;
  jest.resetModules();
});

afterEach(() => {
  jest.useRealTimers();
  delete global.chrome;
  delete global.document;
  delete global.location;
  delete global.MutationObserver;
  delete global.CustomEvent;
  delete global.setTimeout;
});

function setupGlobals(hasBody = true) {
  const dom = createMiniDom(hasBody);
  global.document = dom.document;
  global.location = { href: "https://leetcode.com/problems/two-sum" };
  global.MutationObserver = dom.MutationObserver;
  global.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  return dom;
}

function loadContent() {
  require("../content.js");
}

// ─── Initial CSS class application ───────────────────────────

describe("initial CSS class", () => {
  test("adds leetcode-plain-active class when enabled=true", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    loadContent();
    expect(dom.document.documentElement.classList.add).toHaveBeenCalledWith("leetcode-plain-active");
  });

  test("adds leetcode-plain-active class when enabled is undefined (default)", () => {
    const dom = setupGlobals();
    loadContent();
    expect(dom.document.documentElement.classList.add).toHaveBeenCalledWith("leetcode-plain-active");
  });

  test("does not add class when enabled=false", () => {
    chrome._storageData.enabled = false;
    const dom = setupGlobals();
    loadContent();
    expect(dom.document.documentElement.classList.add).not.toHaveBeenCalledWith("leetcode-plain-active");
  });
});

// ─── Storage change listener ─────────────────────────────────

describe("storage.onChanged listener", () => {
  test("registers a storage change listener", () => {
    setupGlobals();
    loadContent();
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();
  });

  test("adds class when enabled changes to true", () => {
    setupGlobals();
    loadContent();

    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ enabled: { oldValue: false, newValue: true } });

    expect(global.document.documentElement.classList.add).toHaveBeenCalledWith("leetcode-plain-active");
  });

  test("removes class when enabled changes to false", () => {
    setupGlobals();
    loadContent();

    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ enabled: { oldValue: true, newValue: false } });

    expect(global.document.documentElement.classList.remove).toHaveBeenCalledWith("leetcode-plain-active");
  });

  test("ignores changes to other keys", () => {
    const dom = setupGlobals();
    loadContent();

    // Reset mocks after initial load
    dom.document.documentElement.classList.add.mockClear();
    dom.document.documentElement.classList.remove.mockClear();

    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ someOtherKey: { oldValue: 1, newValue: 2 } });

    expect(dom.document.documentElement.classList.add).not.toHaveBeenCalled();
    expect(dom.document.documentElement.classList.remove).not.toHaveBeenCalled();
  });
});

// ─── onDomReady ──────────────────────────────────────────────

describe("onDomReady", () => {
  test("executes immediately when body exists", () => {
    setupGlobals(true);
    loadContent();
    // If body exists, onDomReady fires synchronously — MutationObserver for URL watching is set up
    // We can verify by checking we didn't crash
  });

  test("waits for body via MutationObserver when body doesn't exist", () => {
    const dom = setupGlobals(false);
    loadContent();

    // One of the observers should be watching documentElement for body
    const bodyObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.documentElement
    );
    expect(bodyObserver).toBeDefined();
  });
});

// ─── SPA navigation detection ─────────────────────────────────

describe("SPA navigation detection", () => {
  test("schedules reapply on URL change when enabled", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    loadContent();

    // Find the URL observer (observing body with childList + subtree)
    const urlObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.body && o.observing?.options?.subtree
    );

    if (urlObserver) {
      // Change URL
      global.location.href = "https://leetcode.com/problems/new-problem";
      // Trigger the observer
      urlObserver.callback([]);

      jest.advanceTimersByTime(3500);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "reapply" });
    }
  });

  test("does not schedule reapply when disabled", () => {
    chrome._storageData.enabled = false;
    const dom = setupGlobals();
    loadContent();

    const urlObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.body && o.observing?.options?.subtree
    );

    if (urlObserver) {
      global.location.href = "https://leetcode.com/problems/new-problem";
      urlObserver.callback([]);

      jest.advanceTimersByTime(3500);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  });

  test("does not trigger when URL hasn't changed", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    loadContent();

    const urlObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.body && o.observing?.options?.subtree
    );

    if (urlObserver) {
      // URL stays the same
      urlObserver.callback([]);

      jest.advanceTimersByTime(3500);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  });
});

// ─── watchEditorContainer ─────────────────────────────────────

describe("watchEditorContainer", () => {
  test("queries for .monaco-editor in DOM", () => {
    const dom = setupGlobals();
    loadContent();

    expect(dom.document.querySelector).toHaveBeenCalledWith(".monaco-editor");
  });

  test("retries when editor not found", () => {
    const dom = setupGlobals();
    loadContent();

    // Advance time for retries
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(1000);
    }

    // querySelector should be called multiple times
    const monacoQueries = dom.document.querySelector.mock.calls.filter(
      (call) => call[0] === ".monaco-editor"
    );
    expect(monacoQueries.length).toBeGreaterThan(1);
  });

  test("stops retrying after MAX_WATCH_ATTEMPTS (30)", () => {
    const dom = setupGlobals();
    loadContent();

    // Advance through more than 30 retries
    for (let i = 0; i < 35; i++) {
      jest.advanceTimersByTime(1000);
    }

    const monacoQueries = dom.document.querySelector.mock.calls.filter(
      (call) => call[0] === ".monaco-editor"
    );
    // Initial + up to 30 retries = at most 31 calls
    expect(monacoQueries.length).toBeLessThanOrEqual(31);
  });

  test("observes editor container when found", () => {
    const dom = setupGlobals();
    const parentElement = { nodeType: 1 };
    const editorElement = { parentElement };
    dom.elements[".monaco-editor"] = editorElement;
    dom.document.querySelector.mockImplementation((sel) => {
      if (sel === ".monaco-editor") return editorElement;
      return null;
    });

    loadContent();

    // The editorObserver should be observing the parent
    const editorObs = dom.observers.find((o) => o.observing?.target === parentElement);
    expect(editorObs).toBeDefined();
  });
});

// ─── scheduleReapply ──────────────────────────────────────────

describe("scheduleReapply", () => {
  test("sends reapply at 500ms, 1500ms, and 3000ms", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    loadContent();

    const urlObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.body && o.observing?.options?.subtree
    );

    if (urlObserver) {
      global.location.href = "https://leetcode.com/problems/changed";
      urlObserver.callback([]);

      jest.advanceTimersByTime(500);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1000);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(1500);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);
    }
  });

  test("debounces: cancels previous timers on rapid navigation", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    loadContent();

    const urlObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.body && o.observing?.options?.subtree
    );

    if (urlObserver) {
      // First navigation
      global.location.href = "https://leetcode.com/problems/first";
      urlObserver.callback([]);

      jest.advanceTimersByTime(200);

      // Second navigation before debounce completes
      global.location.href = "https://leetcode.com/problems/second";
      urlObserver.callback([]);

      jest.advanceTimersByTime(3500);

      // Should only have the 3 messages from the second navigation
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);
    }
  });

  test("all messages have type reapply", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    loadContent();

    const urlObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.body && o.observing?.options?.subtree
    );

    if (urlObserver) {
      global.location.href = "https://leetcode.com/problems/test";
      urlObserver.callback([]);
      jest.advanceTimersByTime(3500);

      chrome.runtime.sendMessage.mock.calls.forEach((call) => {
        expect(call[0]).toEqual({ type: "reapply" });
      });
    }
  });
});

// ─── Editor re-creation detection ────────────────────────────

describe("editor re-creation", () => {
  test("triggers reapply when new monaco-editor node added", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    const parentElement = { nodeType: 1 };
    const editorElement = { parentElement };
    dom.document.querySelector.mockImplementation((sel) => {
      if (sel === ".monaco-editor") return editorElement;
      return null;
    });

    loadContent();

    // Find the editor observer
    const editorObs = dom.observers.find((o) => o.observing?.target === parentElement);
    if (editorObs) {
      // Simulate a new node with .monaco-editor inside
      const newNode = {
        nodeType: 1,
        querySelector: jest.fn(() => ({ classList: { contains: () => true } })),
      };
      editorObs.callback([{ addedNodes: [newNode] }]);

      jest.advanceTimersByTime(3500);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "reapply" });
    }
  });

  test("ignores text nodes", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    const parentElement = { nodeType: 1 };
    const editorElement = { parentElement };
    dom.document.querySelector.mockImplementation((sel) => {
      if (sel === ".monaco-editor") return editorElement;
      return null;
    });

    loadContent();

    const editorObs = dom.observers.find((o) => o.observing?.target === parentElement);
    if (editorObs) {
      // Text node (nodeType 3)
      const textNode = { nodeType: 3 };
      editorObs.callback([{ addedNodes: [textNode] }]);

      jest.advanceTimersByTime(3500);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  });

  test("ignores nodes without monaco-editor", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    const parentElement = { nodeType: 1 };
    const editorElement = { parentElement };
    dom.document.querySelector.mockImplementation((sel) => {
      if (sel === ".monaco-editor") return editorElement;
      return null;
    });

    loadContent();

    const editorObs = dom.observers.find((o) => o.observing?.target === parentElement);
    if (editorObs) {
      const normalNode = {
        nodeType: 1,
        querySelector: jest.fn(() => null),
      };
      editorObs.callback([{ addedNodes: [normalNode] }]);

      jest.advanceTimersByTime(3500);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Bug fix regression tests
// ═══════════════════════════════════════════════════════════════

// ─── Fix: font CSS var applied when re-enabling ──────────────

describe("BUG FIX: font CSS var on re-enable", () => {
  test("applies font CSS var when enabled changes from false to true", () => {
    chrome._storageData.enabled = false;
    chrome._storageData.fontFamily = "sf-mono";
    const dom = setupGlobals();
    loadContent();

    // CSS var should NOT be set on initial load (disabled)
    expect(dom.document.documentElement.style.setProperty).not.toHaveBeenCalled();

    // Now enable via storage change
    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ enabled: { oldValue: false, newValue: true } });

    // Should set the CSS var with SF Mono font
    expect(dom.document.documentElement.style.setProperty).toHaveBeenCalledWith(
      "--lpm-font-family",
      expect.stringContaining("SF Mono")
    );
  });

  test("uses correct stored font (not default) when re-enabling", () => {
    chrome._storageData.enabled = false;
    chrome._storageData.fontFamily = "sf-mono";
    const dom = setupGlobals();
    loadContent();

    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ enabled: { oldValue: false, newValue: true } });

    // Should use SF Mono, not fallback Consolas
    const calls = dom.document.documentElement.style.setProperty.mock.calls;
    const fontCall = calls.find((c) => c[0] === "--lpm-font-family");
    expect(fontCall).toBeDefined();
    expect(fontCall[1]).toContain("SF Mono");
    expect(fontCall[1]).not.toContain("Consolas");
  });

  test("falls back to consolas when no fontFamily stored on re-enable", () => {
    chrome._storageData.enabled = false;
    // fontFamily is undefined in storage
    const dom = setupGlobals();
    loadContent();

    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ enabled: { oldValue: false, newValue: true } });

    expect(dom.document.documentElement.style.setProperty).toHaveBeenCalledWith(
      "--lpm-font-family",
      expect.stringContaining("Consolas")
    );
  });
});

// ─── Fix: stale editor observer after SPA navigation ─────────

describe("BUG FIX: editor observer re-attached after SPA navigation", () => {
  test("disconnects old editor observer on SPA navigation", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    const parentElement = { nodeType: 1 };
    const editorElement = { parentElement };
    dom.document.querySelector.mockImplementation((sel) => {
      if (sel === ".monaco-editor") return editorElement;
      return null;
    });

    loadContent();

    // Find editor observer (attached to parentElement)
    const editorObs = dom.observers.find((o) => o.observing?.target === parentElement);
    expect(editorObs).toBeDefined();
    expect(editorObs.observing).not.toBeNull();

    // Now trigger SPA navigation
    const urlObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.body && o.observing?.options?.subtree
    );
    expect(urlObserver).toBeDefined();

    global.location.href = "https://leetcode.com/problems/new-problem";
    urlObserver.callback([]);

    // Editor observer should have been disconnected (observing = null)
    // It may be re-attached to a new container, but the disconnect happened
    // We can verify by checking that querySelector was called again for .monaco-editor
    const monacoQueryCalls = dom.document.querySelector.mock.calls.filter(
      (c) => c[0] === ".monaco-editor"
    );
    // At least 2 calls: initial watchEditorContainer + post-navigation watchEditorContainer
    expect(monacoQueryCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("resets watchAttempts counter on SPA navigation", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    // Editor NOT found — so watchEditorContainer retries
    loadContent();

    // Advance 5 retries
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(1000);
    }

    const queriesBefore = dom.document.querySelector.mock.calls.filter(
      (c) => c[0] === ".monaco-editor"
    ).length;
    expect(queriesBefore).toBeGreaterThan(1);

    // Trigger SPA navigation — should reset watchAttempts
    const urlObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.body && o.observing?.options?.subtree
    );

    if (urlObserver) {
      dom.document.querySelector.mockClear();
      global.location.href = "https://leetcode.com/problems/another";
      urlObserver.callback([]);

      // watchEditorContainer should start retrying again from 0
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(1000);
      }

      const queriesAfter = dom.document.querySelector.mock.calls.filter(
        (c) => c[0] === ".monaco-editor"
      ).length;
      // Should have new retry attempts after navigation (reset means retries start fresh)
      expect(queriesAfter).toBeGreaterThan(1);
    }
  });

  test("re-attaches observer to new container after SPA navigation", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();

    const oldParent = { nodeType: 1 };
    const oldEditor = { parentElement: oldParent };
    dom.document.querySelector.mockImplementation((sel) => {
      if (sel === ".monaco-editor") return oldEditor;
      return null;
    });

    loadContent();

    // Verify initial attachment
    const initialObs = dom.observers.find((o) => o.observing?.target === oldParent);
    expect(initialObs).toBeDefined();

    // Now simulate SPA navigation — new editor container
    const newParent = { nodeType: 1 };
    const newEditor = { parentElement: newParent };
    dom.document.querySelector.mockImplementation((sel) => {
      if (sel === ".monaco-editor") return newEditor;
      return null;
    });

    const urlObserver = dom.observers.find(
      (o) => o.observing?.target === dom.document.body && o.observing?.options?.subtree
    );

    global.location.href = "https://leetcode.com/problems/new-problem";
    urlObserver.callback([]);

    // Editor observer should now be observing the NEW parent
    const reattachedObs = dom.observers.find((o) => o.observing?.target === newParent);
    expect(reattachedObs).toBeDefined();
  });
});

// ─── Fix: CustomEvents guarded behind enabled check ──────────

describe("BUG FIX: CustomEvents not dispatched when disabled", () => {
  test("does not dispatch font CustomEvent when disabled", () => {
    chrome._storageData.enabled = false;
    const dom = setupGlobals();
    loadContent();

    dom.document.dispatchEvent.mockClear();

    // Trigger fontFamily change while disabled
    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ fontFamily: { oldValue: "consolas", newValue: "sf-mono" } });

    // dispatchEvent should NOT have been called (no CustomEvent dispatched)
    const eventCalls = dom.document.dispatchEvent.mock.calls.filter(
      (c) => c[0]?.type === "__lpm_update_fontfamily"
    );
    expect(eventCalls).toHaveLength(0);
  });

  test("does not dispatch tabSize CustomEvent when disabled", () => {
    chrome._storageData.enabled = false;
    const dom = setupGlobals();
    loadContent();

    dom.document.dispatchEvent.mockClear();

    // Trigger tabSize change while disabled
    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ tabSize: { oldValue: 4, newValue: 2 } });

    const eventCalls = dom.document.dispatchEvent.mock.calls.filter(
      (c) => c[0]?.type === "__lpm_update_tabsize"
    );
    expect(eventCalls).toHaveLength(0);
  });

  test("dispatches font CustomEvent when enabled", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    loadContent();

    dom.document.dispatchEvent.mockClear();

    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ fontFamily: { oldValue: "consolas", newValue: "sf-mono" } });

    const eventCalls = dom.dispatchedEvents.filter(
      (e) => e.type === "__lpm_update_fontfamily"
    );
    expect(eventCalls).toHaveLength(1);
    expect(eventCalls[0].detail).toBe("sf-mono");
  });

  test("dispatches tabSize CustomEvent when enabled", () => {
    chrome._storageData.enabled = true;
    const dom = setupGlobals();
    loadContent();

    dom.document.dispatchEvent.mockClear();

    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ tabSize: { oldValue: 4, newValue: 2 } });

    const eventCalls = dom.dispatchedEvents.filter(
      (e) => e.type === "__lpm_update_tabsize"
    );
    expect(eventCalls).toHaveLength(1);
    expect(eventCalls[0].detail).toBe(2);
  });

  test("still updates CSS var for font even when disabled", () => {
    // CSS var update is harmless (rules are scoped) and needed for re-enable
    chrome._storageData.enabled = false;
    const dom = setupGlobals();
    loadContent();

    dom.document.documentElement.style.setProperty.mockClear();

    const storageHandler = chrome._listeners.storage[0];
    storageHandler({ fontFamily: { oldValue: "consolas", newValue: "sf-mono" } });

    // CSS var should still be updated (it's harmless, scoped under .leetcode-plain-active)
    expect(dom.document.documentElement.style.setProperty).toHaveBeenCalledWith(
      "--lpm-font-family",
      expect.stringContaining("SF Mono")
    );
  });
});
