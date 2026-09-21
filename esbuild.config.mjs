import * as esbuild from "esbuild";

/** 当前是否执行生产构建 */
const production = process.argv[2] === "production";

/** JoySpace Publisher 的单文件构建配置 */
const buildOptions = {
  entryPoints: ["src/main.js"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  platform: "node",
  target: "es2022",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: false,
  logLevel: "info",
};

if (production) {
  await esbuild.build(buildOptions);
} else {
  /** 开发模式下持续监听源码并重建插件产物 */
  const context = await esbuild.context(buildOptions);
  await context.watch();
}
