const toggle = document.getElementById("toggle");
const statusBar = document.getElementById("status");
const statusText = document.getElementById("status-text");
const toggleIcon = document.getElementById("toggle-icon");
const toggleSvg = document.getElementById("toggle-svg");
const cardDesc = document.getElementById("card-desc");
const mainContent = document.getElementById("main-content");
const notLeetcode = document.getElementById("not-leetcode");
const contestMode = document.getElementById("contest-mode");
const tabBtns = document.querySelectorAll(".tab-btn");
const fontSelect = document.getElementById("font-select");

function updateUI(enabled) {
  statusBar.className = enabled ? "status on" : "status off";
  statusText.textContent = enabled ? "Interview mode active" : "Normal editor";
  toggleIcon.className = enabled ? "toggle-icon on" : "toggle-icon off";
  toggleSvg.setAttribute("stroke", enabled ? "#ffa116" : "#8a8a8a");
  cardDesc.textContent = enabled ? "Plain editor, no assists" : "Full IDE features";
}

function setActiveTabBtn(size) {
  tabBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.size === String(size));
  });
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab || !tab.url || !tab.url.includes("leetcode.com")) {
    mainContent.style.display = "none";
    notLeetcode.style.display = "block";
    return;
  }

  if (/leetcode\.com\/contest\b/.test(tab.url)) {
    mainContent.style.display = "none";
    contestMode.style.display = "block";
    return;
  }

  // Register listeners before loading state to avoid races
  toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ enabled });
    updateUI(enabled);
    chrome.runtime.sendMessage({ type: "toggle", enabled });
  });

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const size = Number(btn.dataset.size);
      setActiveTabBtn(size);
      // Saving to storage triggers content.js → storage.onChanged →
      // CustomEvent → content-main.js updates Monaco directly.
      chrome.storage.local.set({ tabSize: size });
    });
  });

  fontSelect.addEventListener("change", () => {
    chrome.storage.local.set({ fontFamily: fontSelect.value });
  });

  // Load saved state and update UI (after listeners are in place)
  chrome.storage.local.get(["enabled", "tabSize", "fontFamily"], (data) => {
    const isEnabled = data.enabled !== false; // default true
    toggle.checked = isEnabled;
    updateUI(isEnabled);
    setActiveTabBtn(data.tabSize || 4);
    fontSelect.value = data.fontFamily || "consolas";
    // Show content now that state is loaded (avoids flicker)
    mainContent.style.visibility = "visible";
    // Prevent popup from auto-focusing interactive elements
    document.activeElement?.blur();
  });
});
