/** Node.js 模块加载器，用于模拟 Obsidian 桌面运行时 */
const Module = require("node:module");
/** 原始模块加载函数，用于转发非 Obsidian 依赖 */
const originalLoad = Module._load;

/** 为最小发布包提供 Obsidian 与 Electron 的轻量测试替身 */
Module._load = function loadReleaseDependency(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      FileSystemAdapter: class FileSystemAdapter {},
      Modal: class Modal {},
      Notice: class Notice {},
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
    };
  }
  if (request === "electron") {
    return { shell: { openExternal: async () => undefined } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

/** 仅依赖 main.js 的生产插件入口 */
const PluginEntry = require("./main.js");
if (typeof PluginEntry !== "function") {
  throw new Error("main.js 未导出有效的 Obsidian 插件类");
}

console.log("Minimal release entry loaded successfully.");
