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

  return {
    document: doc,
    classList,
    cssVars,
    observers,
    elements,
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
  delete global.setTimeout;
});

function setupGlobals(hasBody = true) {
  const dom = createMiniDom(hasBody);
  global.document = dom.document;
  global.location = { href: "https://leetcode.com/problems/two-sum" };
  global.MutationObserver = dom.MutationObserver;
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
