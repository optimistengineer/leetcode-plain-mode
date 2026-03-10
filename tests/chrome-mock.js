// Shared Chrome API mock factory for all tests

function createChromeMock() {
  const storageData = {};
  const storageListeners = [];
  const messageListeners = [];
  const installedListeners = [];
  const tabsUpdatedListeners = [];

  const chrome = {
    storage: {
      local: {
        get: jest.fn((key, cb) => {
          if (typeof key === "string") {
            cb({ [key]: storageData[key] });
          } else {
            const result = {};
            for (const k of key) result[k] = storageData[k];
            cb(result);
          }
        }),
        set: jest.fn((obj, cb) => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: storageData[k], newValue: v };
            storageData[k] = v;
          }
          storageListeners.forEach((fn) => fn(changes, "local"));
          if (cb) cb();
        }),
        _data: storageData,
      },
      onChanged: {
        addListener: jest.fn((fn) => storageListeners.push(fn)),
      },
    },
    runtime: {
      id: "mock-extension-id",
      onInstalled: {
        addListener: jest.fn((fn) => installedListeners.push(fn)),
      },
      onMessage: {
        addListener: jest.fn((fn) => messageListeners.push(fn)),
      },
      sendMessage: jest.fn(),
    },
    scripting: {
      executeScript: jest.fn().mockResolvedValue([{ result: { success: true, editorCount: 1 } }]),
    },
    tabs: {
      query: jest.fn((query, cb) => cb([])),
      onUpdated: {
        addListener: jest.fn((fn) => tabsUpdatedListeners.push(fn)),
      },
    },
    _listeners: {
      storage: storageListeners,
      message: messageListeners,
      installed: installedListeners,
      tabsUpdated: tabsUpdatedListeners,
    },
    _storageData: storageData,
  };

  return chrome;
}

module.exports = { createChromeMock };
