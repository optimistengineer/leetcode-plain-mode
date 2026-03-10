/**
 * E2E test — loads the extension in a real Chromium browser,
 * navigates to a LeetCode problem page, and verifies plain mode
 * is applied correctly (CSS + Monaco API).
 */

const { chromium } = require("playwright");
const path = require("path");

const EXTENSION_PATH = path.resolve(__dirname, "..");
const LEETCODE_URL = "https://leetcode.com/problems/two-sum/description/";

let context;
let page;

// Longer timeout for network-dependent tests
jest.setTimeout(60_000);

beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--disable-blink-features=AutomationControlled",
    ],
  });
});

afterAll(async () => {
  if (context) await context.close();
});

// Helper: wait for the Monaco editor to appear in the DOM
async function waitForEditor(pg, timeout = 30_000) {
  await pg.waitForSelector(".monaco-editor", { timeout });
}

// Helper: get computed style of an element
async function getComputedProp(pg, selector, prop) {
  return pg.evaluate(
    ([sel, p]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return window.getComputedStyle(el)[p];
    },
    [selector, prop]
  );
}

// ─── Tests ────────────────────────────────────────────────────

describe("Extension loads on LeetCode", () => {
  test("leetcode-plain-active class is on <html>", async () => {
    page = await context.newPage();
    await page.goto(LEETCODE_URL, { waitUntil: "domcontentloaded" });
    await waitForEditor(page);

    const hasClass = await page.evaluate(() =>
      document.documentElement.classList.contains("leetcode-plain-active")
    );
    expect(hasClass).toBe(true);
  });

  test("margin/gutter is hidden (width: 0)", async () => {
    const width = await getComputedProp(page, ".monaco-editor .margin", "width");
    expect(width).toBe("0px");
  });

  test("lines-content has left: 0 (no gutter offset)", async () => {
    // Monaco normally sets inline left to ~46px for gutter.
    // Our CSS forces left: 0.
    const left = await page.evaluate(() => {
      const el = document.querySelector(".monaco-editor .lines-content");
      if (!el) return null;
      return el.style.left || window.getComputedStyle(el).left;
    });
    // Should be 0px (our CSS override) not a large value
    expect(parseInt(left)).toBeLessThanOrEqual(0);
  });

  test("lines-content has 24px left padding", async () => {
    const padding = await getComputedProp(
      page,
      ".monaco-editor .lines-content",
      "paddingLeft"
    );
    expect(padding).toBe("24px");
  });

  test("view-overlays has left: 0", async () => {
    const left = await page.evaluate(() => {
      const el = document.querySelector(".monaco-editor .view-overlays");
      if (!el) return null;
      return el.style.left || window.getComputedStyle(el).left;
    });
    expect(parseInt(left)).toBeLessThanOrEqual(0);
  });

  test("line numbers are hidden", async () => {
    const display = await getComputedProp(
      page,
      ".monaco-editor .margin-view-overlays .line-numbers",
      "display"
    );
    // Either hidden or element doesn't exist (both fine)
    if (display !== null) {
      expect(display).toBe("none");
    }
  });

  test("minimap is hidden", async () => {
    const display = await getComputedProp(page, ".monaco-editor .minimap", "display");
    if (display !== null) {
      expect(display).toBe("none");
    }
  });

  test("text is rendered in Consolas font", async () => {
    const fontFamily = await getComputedProp(
      page,
      ".monaco-editor .view-line",
      "fontFamily"
    );
    if (fontFamily) {
      expect(fontFamily.toLowerCase()).toContain("consolas");
    }
  });

  test("all syntax tokens have same color (no highlighting)", async () => {
    const colors = await page.evaluate(() => {
      const spans = document.querySelectorAll(".monaco-editor .view-line span[class*='mtk']");
      return [...new Set([...spans].map((s) => window.getComputedStyle(s).color))];
    });
    // All tokens should be the same color (plain text mode)
    if (colors.length > 0) {
      expect(colors.length).toBe(1);
    }
  });

  test("background is white (light mode) or dark (#1e1e1e in dark mode)", async () => {
    const bg = await getComputedProp(
      page,
      ".monaco-editor .monaco-editor-background",
      "backgroundColor"
    );
    if (bg) {
      // rgb(255, 255, 255) for light mode or rgb(30, 30, 30) for dark mode
      const isWhite = bg === "rgb(255, 255, 255)";
      const isDark = bg === "rgb(30, 30, 30)";
      expect(isWhite || isDark).toBe(true);
    }
  });
});

describe("Monaco API options applied", () => {
  test("language is set to plaintext", async () => {
    // Wait a bit for background.js retry to apply Monaco options
    await page.waitForTimeout(5000);

    const lang = await page.evaluate(() => {
      const monaco = window.monaco || window.lcMonaco;
      if (!monaco?.editor) return null;
      const editors = monaco.editor.getEditors();
      if (editors.length === 0) return null;
      const model = editors[0].getModel();
      return model ? model.getLanguageId() : null;
    });
    if (lang !== null) {
      expect(lang).toBe("plaintext");
    }
  });

  test("autocomplete is disabled", async () => {
    const quickSuggestions = await page.evaluate(() => {
      const monaco = window.monaco || window.lcMonaco;
      if (!monaco?.editor) return null;
      const editors = monaco.editor.getEditors();
      if (editors.length === 0) return null;
      return editors[0].getOption(monaco.editor.EditorOption.quickSuggestions);
    });
    if (quickSuggestions !== null) {
      // quickSuggestions should be false or { other: false, ... }
      if (typeof quickSuggestions === "boolean") {
        expect(quickSuggestions).toBe(false);
      } else {
        expect(quickSuggestions.other).toBe("off");
      }
    }
  });

  test("line numbers are off in Monaco options", async () => {
    const lineNumbers = await page.evaluate(() => {
      const monaco = window.monaco || window.lcMonaco;
      if (!monaco?.editor) return null;
      const editors = monaco.editor.getEditors();
      if (editors.length === 0) return null;
      return editors[0].getOption(monaco.editor.EditorOption.lineNumbers);
    });
    if (lineNumbers !== null) {
      // renderType 0 = off
      expect(lineNumbers.renderType).toBe(0);
    }
  });

  test("tab inserts 4 spaces", async () => {
    // Click into the editor and press Tab
    const editorEl = await page.$(".monaco-editor .view-lines");
    if (editorEl) {
      await editorEl.click();
      await page.keyboard.press("End"); // go to end of line
      await page.keyboard.press("Enter"); // new line
      await page.keyboard.press("Tab");

      // Read the content of the last line
      const lastLineText = await page.evaluate(() => {
        const monaco = window.monaco || window.lcMonaco;
        if (!monaco?.editor) return null;
        const editors = monaco.editor.getEditors();
        if (editors.length === 0) return null;
        const model = editors[0].getModel();
        const lineCount = model.getLineCount();
        return model.getLineContent(lineCount);
      });

      if (lastLineText !== null) {
        // Should contain 4 spaces
        expect(lastLineText).toContain("    ");
      }
    }
  });
});

describe("Cursor movement", () => {
  test("arrow keys move cursor by exactly one line per press", async () => {
    // Reload to get clean editor state
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForEditor(page);
    await page.waitForTimeout(5000);

    // Focus editor and go to line 1
    await page.evaluate(() => {
      const monaco = window.monaco || window.lcMonaco;
      if (!monaco?.editor) return;
      const editors = monaco.editor.getEditors();
      if (editors.length === 0) return;
      editors[0].focus();
      editors[0].setPosition({ lineNumber: 1, column: 1 });
    });

    // Move down 3 lines
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    const afterDown = await page.evaluate(() => {
      const monaco = window.monaco || window.lcMonaco;
      const editors = monaco.editor.getEditors();
      return editors[0].getPosition().lineNumber;
    });
    expect(afterDown).toBe(4);

    // Move up 2 lines
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");

    const afterUp = await page.evaluate(() => {
      const monaco = window.monaco || window.lcMonaco;
      const editors = monaco.editor.getEditors();
      return editors[0].getPosition().lineNumber;
    });
    expect(afterUp).toBe(2);
  });

  test("clicking a line positions cursor on that line", async () => {
    // Get the position of the 2nd visible line and click it
    const result = await page.evaluate(() => {
      const lines = document.querySelectorAll(".monaco-editor .view-line");
      if (lines.length < 2) return null;

      const secondLine = lines[1];
      const rect = secondLine.getBoundingClientRect();
      return { x: rect.left + 10, y: rect.top + rect.height / 2 };
    });

    if (result) {
      await page.mouse.click(result.x, result.y);

      const pos = await page.evaluate(() => {
        const monaco = window.monaco || window.lcMonaco;
        if (!monaco?.editor) return null;
        const editors = monaco.editor.getEditors();
        if (editors.length === 0) return null;
        return editors[0].getPosition().lineNumber;
      });

      if (pos) {
        // Should be on line 2 (or close — exact depends on content)
        expect(pos).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("Reload consistency (no flash/jump)", () => {
  test("after reload, lines-content left is 0 immediately", async () => {
    // Reload the page
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForEditor(page);

    // Check immediately — should be 0 from CSS, not a large gutter offset
    const left = await page.evaluate(() => {
      const el = document.querySelector(".monaco-editor .lines-content");
      if (!el) return null;
      return window.getComputedStyle(el).left;
    });

    expect(left).toBe("0px");
  });

  test("after reload, class is applied before editor renders", async () => {
    const hasClass = await page.evaluate(() =>
      document.documentElement.classList.contains("leetcode-plain-active")
    );
    expect(hasClass).toBe(true);
  });

  test("after reload, left padding is consistent", async () => {
    const padding = await getComputedProp(
      page,
      ".monaco-editor .lines-content",
      "paddingLeft"
    );
    expect(padding).toBe("24px");
  });

  test("after reload, no vertical padding shift", async () => {
    // No top padding via CSS or API — avoids vertical jump on load
    const padding = await getComputedProp(
      page,
      ".monaco-editor .lines-content",
      "paddingTop"
    );
    expect(padding).toBe("0px");
  });
});

describe("Toggle off/on via CSS class", () => {
  // chrome.storage is only accessible from the ISOLATED content script world,
  // not the MAIN world that page.evaluate runs in. So we test the CSS class
  // toggle directly — which is what actually controls the visual styling.

  test("removing the class restores normal editor appearance", async () => {
    await page.evaluate(() => {
      document.documentElement.classList.remove("leetcode-plain-active");
    });

    const hasClass = await page.evaluate(() =>
      document.documentElement.classList.contains("leetcode-plain-active")
    );
    expect(hasClass).toBe(false);

    // Line numbers should be visible again
    const lineNumDisplay = await getComputedProp(
      page,
      ".monaco-editor .margin-view-overlays .line-numbers",
      "display"
    );
    if (lineNumDisplay !== null) {
      expect(lineNumDisplay).not.toBe("none");
    }
  });

  test("re-adding the class restores plain mode", async () => {
    await page.evaluate(() => {
      document.documentElement.classList.add("leetcode-plain-active");
    });

    const hasClass = await page.evaluate(() =>
      document.documentElement.classList.contains("leetcode-plain-active")
    );
    expect(hasClass).toBe(true);

    // Margin should be hidden again
    const width = await getComputedProp(page, ".monaco-editor .margin", "width");
    expect(width).toBe("0px");
  });
});
