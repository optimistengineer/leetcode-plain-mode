const fs = require("fs");
const path = require("path");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf-8")
);

describe("manifest.json", () => {
  test("uses manifest version 3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  test("has required extension metadata", () => {
    expect(manifest.name).toBe("LeetCode Plain Mode");
    expect(manifest.version).toBeDefined();
    expect(manifest.description).toBeDefined();
    expect(manifest.description.length).toBeLessThanOrEqual(132); // Chrome Web Store limit
  });

  test("has required permissions", () => {
    expect(manifest.permissions).toContain("storage");
    expect(manifest.permissions).toContain("scripting");
    expect(manifest.permissions).toContain("activeTab");
  });

  test("has no unnecessary permissions", () => {
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.permissions).not.toContain("webRequest");
    expect(manifest.permissions).not.toContain("<all_urls>");
  });

  test("host_permissions limited to leetcode.com", () => {
    expect(manifest.host_permissions).toEqual(["https://leetcode.com/*"]);
  });

  test("has popup action configured", () => {
    expect(manifest.action).toBeDefined();
    expect(manifest.action.default_popup).toBe("popup.html");
    expect(manifest.action.default_icon).toBeDefined();
  });

  test("has background service worker", () => {
    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBe("background.js");
  });

  test("content scripts target leetcode.com only", () => {
    expect(manifest.content_scripts).toHaveLength(2);
    manifest.content_scripts.forEach((cs) => {
      expect(cs.matches).toEqual(["https://leetcode.com/*"]);
    });
  });

  test("content scripts inject CSS and JS", () => {
    const cs = manifest.content_scripts[0];
    expect(cs.css).toEqual(["plain-mode.css"]);
    expect(cs.js).toEqual(["content.js"]);
  });

  test("MAIN world content script is registered", () => {
    const mainCs = manifest.content_scripts[1];
    expect(mainCs.js).toEqual(["content-main.js"]);
    expect(mainCs.world).toBe("MAIN");
  });

  test("content scripts run at document_start", () => {
    const cs = manifest.content_scripts[0];
    expect(cs.run_at).toBe("document_start");
  });

  test("icon file exists", () => {
    const iconPath = manifest.action.default_icon["48"];
    const fullPath = path.join(__dirname, "..", iconPath);
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("all referenced files exist", () => {
    const files = [
      manifest.action.default_popup,
      manifest.background.service_worker,
      ...manifest.content_scripts[0].css,
      ...manifest.content_scripts[0].js,
    ];
    files.forEach((file) => {
      const fullPath = path.join(__dirname, "..", file);
      expect(fs.existsSync(fullPath)).toBe(true);
    });
  });
});
