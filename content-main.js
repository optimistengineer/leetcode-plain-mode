// Runs in the page's MAIN world — has direct access to window.monaco.
// Listens for CustomEvents dispatched by the ISOLATED world content script.

const FONT_API_MAP = {
  "sf-mono": "'SF Mono', Menlo, monospace",
  "consolas": "Consolas, 'Courier New', monospace",
};

document.addEventListener("__lpm_update_fontfamily", (e) => {
  const fontKey = e.detail;
  const fontFamily = FONT_API_MAP[fontKey] ?? FONT_API_MAP["consolas"];
  const monaco = window.monaco || window.lcMonaco;
  if (!monaco?.editor) return;
  monaco.editor.getEditors().forEach((editor) => {
    try {
      editor.updateOptions({ fontFamily });
    } catch (err) {
      // editor might be disposed
    }
  });
});

document.addEventListener("__lpm_update_tabsize", (e) => {
  const spaces = e.detail;
  const monaco = window.monaco || window.lcMonaco;
  if (!monaco?.editor) return;
  monaco.editor.getEditors().forEach((editor) => {
    try {
      const model = editor.getModel();
      if (model) {
        model.updateOptions({
          tabSize: spaces,
          indentSize: spaces,
          insertSpaces: true,
        });
      }
    } catch (err) {
      // editor might be disposed
    }
  });
});
