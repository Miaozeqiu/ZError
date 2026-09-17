import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const cargoExe = path.join(cargoBin, process.platform === "win32" ? "cargo.exe" : "cargo");
if (!fs.existsSync(cargoExe)) {
  console.error(`[run-tauri] cargo not found at ${cargoExe}`);
  console.error("Install Rust from https://rustup.rs and reopen the terminal.");
  process.exit(1);
}

const extraBins = [
  cargoBin,
  path.join(os.homedir(), "Library/Python/3.9/bin"),
  path.join(os.homedir(), "Library/Python/3.10/bin"),
  path.join(os.homedir(), "Library/Python/3.11/bin"),
  path.join(os.homedir(), "Library/Python/3.12/bin"),
].filter((dir) => fs.existsSync(dir));
process.env.PATH = `${extraBins.join(path.delimiter)}${path.delimiter}${process.env.PATH || ""}`;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const isBuild = args.includes("build");

const cefCodecs = os.platform() === "darwin"
  && fs.existsSync(path.join(os.homedir(), ".local/share/cef/151.3.24/cef_macos_aarch64/.zerror-codecs"));

if (!isBuild) {
  spawn(process.execPath, [path.join(here, "agent-bridge-server.mjs")], {
    stdio: "inherit",
    env: process.env,
    cwd: root,
  });
  if (cefCodecs) {
    console.log("[run-tauri] 已检测到带 H.264 的 CEF，跳过 1430 转码");
  } else {
    spawn(process.execPath, [path.join(here, "cef-h264-shim.mjs")], {
      stdio: "inherit",
      env: process.env,
      cwd: root,
    });
  }
}

if (process.platform === "darwin") {
  process.env.CEF_PATH = process.env.CEF_PATH || path.join(os.homedir(), ".local/share/cef");
  const setup = path.join(here, "setup-cef-macos.sh");
  const setupResult = spawnSync("bash", [setup], { stdio: "inherit", env: process.env, cwd: root });
  if (setupResult.status !== 0) {
    console.warn("[run-tauri] setup-cef-macos.sh 未完成。浏览区需要 Chromium 框架；可稍后重试该脚本。");
  }
}

const child = spawn("tauri", args, {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (process.platform === "darwin" && isBuild && !signal && (code ?? 1) === 0) {
    const bundle = spawnSync("bash", [path.join(here, "bundle-cef-macos.sh")], {
      stdio: "inherit",
      env: process.env,
      cwd: root,
    });
    if (bundle.status !== 0) {
      process.exit(bundle.status ?? 1);
    }
  }
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
