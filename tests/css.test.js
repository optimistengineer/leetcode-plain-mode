const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "../plain-mode.css"), "utf-8");

describe("plain-mode.css", () => {
  // ─── Scoping ────────────────────────────────────────────────

  test("all rules are scoped under .leetcode-plain-active", () => {
    // Extract all selectors (lines that end with {)
    const selectorLines = css.split("\n").filter((line) => {
      const trimmed = line.trim();
      return trimmed.endsWith("{") && !trimmed.startsWith("/*") && !trimmed.startsWith("*");
    });

    selectorLines.forEach((line) => {
      const selector = line.trim().replace(/\s*\{$/, "");
      // Each comma-separated selector should start with .leetcode-plain-active
      const parts = selector.split(",").map((s) => s.trim());
      parts.forEach((part) => {
        expect(part).toMatch(/^\.leetcode-plain-active/);
      });
    });
  });

  // ─── Light mode ─────────────────────────────────────────────

  test("sets white background in light mode", () => {
    expect(css).toContain("background-color: #ffffff !important");
  });

  test("sets black text in light mode", () => {
    expect(css).toContain("color: #000000 !important");
  });

  test("uses CSS variable for font family with monospace fallback", () => {
    expect(css).toContain('font-family: var(--lpm-font-family, Consolas, "Courier New", monospace) !important');
  });

  test("sets black cursor in light mode", () => {
    expect(css).toMatch(/\.leetcode-plain-active \.monaco-editor \.cursor[\s\S]*?background-color: #000000/);
  });

  test("sets blue selection color for light mode", () => {
    expect(css).toContain("background-color: #d2e3fc !important");
  });

  // ─── Dark mode ──────────────────────────────────────────────

  test("has dark mode selectors with .dark class", () => {
    expect(css).toContain(".leetcode-plain-active.dark");
  });

  test("sets dark background in dark mode", () => {
    expect(css).toContain("background-color: #1e1e1e !important");
  });

  test("sets light text in dark mode", () => {
    expect(css).toContain("color: #e0e0e0 !important");
  });

  test("sets light cursor in dark mode", () => {
    expect(css).toMatch(/\.leetcode-plain-active\.dark[\s\S]*?\.cursor[\s\S]*?background-color: #e0e0e0/);
  });

  test("sets blue selection in dark mode", () => {
    expect(css).toContain("background-color: rgba(51, 144, 255, 0.25) !important");
  });

  // ─── IDE chrome hidden ──────────────────────────────────────

  test("hides minimap", () => {
    expect(css).toMatch(/\.minimap[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides suggestions widget", () => {
    expect(css).toMatch(/\.suggest-widget[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides parameter hints", () => {
    expect(css).toMatch(/\.parameter-hints-widget[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides line numbers", () => {
    expect(css).toMatch(/\.line-numbers[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides glyph margin", () => {
    expect(css).toMatch(/\.glyph-margin[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides bracket match highlighting", () => {
    expect(css).toMatch(/\.bracket-match[\s\S]*?border:\s*none\s*!important/);
  });

  test("hides indent guides", () => {
    expect(css).toMatch(/\.core-guide[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides current line highlight", () => {
    expect(css).toMatch(/\.current-line[\s\S]*?border:\s*none\s*!important/);
  });

  test("hides code lens", () => {
    expect(css).toMatch(/\.codelens-decoration[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides lightbulb", () => {
    expect(css).toMatch(/\.lightbulb-glyph[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides folding controls", () => {
    expect(css).toMatch(/\.folding[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides hover tooltips", () => {
    expect(css).toMatch(/\.hover-contents[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides context menu", () => {
    expect(css).toMatch(/\.context-view[\s\S]*?display:\s*none\s*!important/);
  });

  test("hides overview ruler", () => {
    expect(css).toMatch(/\.decorationsOverviewRuler[\s\S]*?display:\s*none\s*!important/);
  });

  test("removes word/selection highlights", () => {
    expect(css).toContain(".selectionHighlight");
    expect(css).toContain(".wordHighlight");
    expect(css).toContain(".wordHighlightStrong");
  });

  // ─── Left padding ──────────────────────────────────────────

  test("adds left padding to code content", () => {
    expect(css).toMatch(/\.lines-content[\s\S]*?padding-left:\s*24px\s*!important/);
  });

  test("adds left padding to view overlays", () => {
    expect(css).toMatch(/\.view-overlays[\s\S]*?padding-left:\s*24px\s*!important/);
  });

  test("adds left padding to cursors layer", () => {
    expect(css).toMatch(/\.cursors-layer[\s\S]*?padding-left:\s*24px\s*!important/);
  });

  test("hides margin completely", () => {
    expect(css).toMatch(/\.margin[\s\S]*?width:\s*0\s*!important/);
  });

  // ─── Scrollbar ──────────────────────────────────────────────

  test("styles scrollbar with subtle appearance", () => {
    expect(css).toMatch(/\.scrollbar\s+\.slider[\s\S]*?border-radius:\s*4px/);
  });

  test("has scrollbar hover state", () => {
    expect(css).toMatch(/\.slider:hover/);
  });

  // ─── General CSS quality ────────────────────────────────────

  test("uses !important on all overrides", () => {
    // Every property that's not a comment should use !important
    const propertyLines = css.split("\n").filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.includes(":") &&
        !trimmed.startsWith("/*") &&
        !trimmed.startsWith("*") &&
        !trimmed.endsWith("{") &&
        !trimmed.startsWith("//") &&
        trimmed.length > 0 &&
        !trimmed.startsWith("content:")
      );
    });

    propertyLines.forEach((line) => {
      if (!line.trim().startsWith("content:")) {
        expect(line).toContain("!important");
      }
    });
  });

  test("overrides all mtk classes (syntax highlighting)", () => {
    expect(css).toContain('[class*="mtk"]');
  });
});
