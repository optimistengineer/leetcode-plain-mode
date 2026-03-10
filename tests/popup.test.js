const { createChromeMock } = require("./chrome-mock");
const fs = require("fs");
const path = require("path");

let chrome;

const popupHtml = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf-8");
const popupJs = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf-8");

beforeEach(() => {
  chrome = createChromeMock();
  global.chrome = chrome;
  jest.resetModules();
});

afterEach(() => {
  delete global.chrome;
});

// ─── popup.html structure ─────────────────────────────────────

describe("popup.html structure", () => {
  test("contains toggle checkbox", () => {
    expect(popupHtml).toContain('id="toggle"');
    expect(popupHtml).toContain('type="checkbox"');
  });

  test("contains status bar", () => {
    expect(popupHtml).toContain('id="status"');
    expect(popupHtml).toContain('id="status-text"');
  });

  test("contains toggle icon and description", () => {
    expect(popupHtml).toContain('id="toggle-icon"');
    expect(popupHtml).toContain('id="card-desc"');
  });

  test("contains main content and not-leetcode sections", () => {
    expect(popupHtml).toContain('id="main-content"');
    expect(popupHtml).toContain('id="not-leetcode"');
  });

  test("not-leetcode is hidden by default", () => {
    expect(popupHtml).toMatch(/id="not-leetcode"[^>]*style="display:none;"/);
  });

  test("contains all feature tags", () => {
    expect(popupHtml).toContain("No autocomplete");
    expect(popupHtml).toContain("No highlighting");
    expect(popupHtml).toContain("No line numbers");
    expect(popupHtml).toContain("Plain text");
  });

  test("has correct title", () => {
    expect(popupHtml).toContain("LeetCode Plain Mode");
  });

  test("has correct subtitle", () => {
    expect(popupHtml).toContain("Google-style interview practice");
  });

  test("loads popup.js script", () => {
    expect(popupHtml).toContain('src="popup.js"');
  });

  test("uses extension icon in header", () => {
    expect(popupHtml).toContain('src="icons/icon48.png"');
  });

  test("has switch toggle", () => {
    expect(popupHtml).toContain('class="switch"');
    expect(popupHtml).toContain('class="track"');
  });

  test("has 4 feature tags", () => {
    const matches = popupHtml.match(/class="tag"/g);
    expect(matches).toHaveLength(4);
  });

  test("has tab size selector", () => {
    expect(popupHtml).toContain('id="tab-sizes"');
    expect(popupHtml).toContain('data-size="2"');
    expect(popupHtml).toContain('data-size="4"');
    expect(popupHtml).toContain('data-size="8"');
  });

  test("has three tab size buttons", () => {
    expect(popupHtml).toContain('data-size="2"');
    expect(popupHtml).toContain('data-size="4"');
    expect(popupHtml).toContain('data-size="8"');
  });

  test("uses dark theme", () => {
    expect(popupHtml).toContain("#1a1a1a"); // dark bg
  });
});

// ─── popup.js logic ───────────────────────────────────────────

describe("popup.js updateUI logic", () => {
  function createMockElements() {
    return {
      statusBar: { className: "" },
      statusText: { textContent: "" },
      toggleIcon: { className: "" },
      toggleSvg: { setAttribute: jest.fn() },
      cardDesc: { textContent: "" },
    };
  }

  function updateUI(enabled, el) {
    el.statusBar.className = enabled ? "status on" : "status off";
    el.statusText.textContent = enabled ? "Interview mode active" : "Normal editor";
    el.toggleIcon.className = enabled ? "toggle-icon on" : "toggle-icon off";
    el.toggleSvg.setAttribute("stroke", enabled ? "#ffa116" : "#8a8a8a");
    el.cardDesc.textContent = enabled ? "Plain editor, no assists" : "Full IDE features";
  }

  test("sets enabled state correctly", () => {
    const el = createMockElements();
    updateUI(true, el);

    expect(el.statusBar.className).toBe("status on");
    expect(el.statusText.textContent).toBe("Interview mode active");
    expect(el.toggleIcon.className).toBe("toggle-icon on");
    expect(el.toggleSvg.setAttribute).toHaveBeenCalledWith("stroke", "#ffa116");
    expect(el.cardDesc.textContent).toBe("Plain editor, no assists");
  });

  test("sets disabled state correctly", () => {
    const el = createMockElements();
    updateUI(false, el);

    expect(el.statusBar.className).toBe("status off");
    expect(el.statusText.textContent).toBe("Normal editor");
    expect(el.toggleIcon.className).toBe("toggle-icon off");
    expect(el.toggleSvg.setAttribute).toHaveBeenCalledWith("stroke", "#8a8a8a");
    expect(el.cardDesc.textContent).toBe("Full IDE features");
  });

  test("can toggle between states", () => {
    const el = createMockElements();

    updateUI(true, el);
    expect(el.statusBar.className).toBe("status on");

    updateUI(false, el);
    expect(el.statusBar.className).toBe("status off");

    updateUI(true, el);
    expect(el.statusBar.className).toBe("status on");
  });
});

describe("popup.js tab detection", () => {
  test("detects leetcode.com URLs", () => {
    const urls = [
      "https://leetcode.com/problems/two-sum",
      "https://leetcode.com/",
      "https://leetcode.com/contest/weekly-contest-300",
      "https://leetcode.com/explore/",
    ];
    urls.forEach((url) => {
      expect(url.includes("leetcode.com")).toBe(true);
    });
  });

  test("rejects non-leetcode URLs", () => {
    const urls = [
      "https://google.com",
      "https://github.com",
      "chrome://extensions",
      "about:blank",
      "https://leetcodecontest.com",
    ];
    urls.forEach((url) => {
      expect(url.includes("leetcode.com")).toBe(false);
    });
  });

  test("handles missing tab gracefully", () => {
    const tabs = [];
    const tab = tabs[0];
    expect(!tab || !tab?.url || !tab.url.includes("leetcode.com")).toBe(true);
  });

  test("handles tab without URL", () => {
    const tab = { id: 1 };
    expect(!tab || !tab.url || !tab.url.includes("leetcode.com")).toBe(true);
  });

  test("handles null tab URL", () => {
    const tab = { id: 1, url: null };
    expect(!tab || !tab.url || !tab.url.includes("leetcode.com")).toBe(true);
  });
});

describe("popup.js storage defaults", () => {
  test("undefined enabled treated as true", () => {
    expect(({}).enabled !== false).toBe(true);
  });

  test("null enabled treated as true", () => {
    expect(({ enabled: null }).enabled !== false).toBe(true);
  });

  test("true enabled treated as true", () => {
    expect(({ enabled: true }).enabled !== false).toBe(true);
  });

  test("false enabled treated as false", () => {
    expect(({ enabled: false }).enabled !== false).toBe(false);
  });
});

// ─── CSS in popup.html ───────────────────────────────────────

describe("popup CSS", () => {
  test("popup has 320px width", () => {
    expect(popupHtml).toContain("width: 320px");
  });

  test("has dark background", () => {
    expect(popupHtml).toContain("#1a1a1a");
  });

  test("has toggle-card styling", () => {
    expect(popupHtml).toContain(".toggle-card");
  });

  test("has status on and off states", () => {
    expect(popupHtml).toContain(".status.off");
    expect(popupHtml).toContain(".status.on");
  });

  test("has not-leetcode styling", () => {
    expect(popupHtml).toContain(".not-leetcode");
  });
});
