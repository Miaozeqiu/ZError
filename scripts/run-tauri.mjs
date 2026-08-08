import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const cargoExe = path.join(cargoBin, process.platform === "win32" ? "cargo.exe" : "cargo");
if (!fs.existsSync(cargoExe)) {
  console.error(`[run-tauri] cargo not found at ${cargoExe}`);
  console.error("Install Rust from https://rustup.rs and reopen the terminal.");
  process.exit(1);
}

process.env.PATH = `${cargoBin}${path.delimiter}${process.env.PATH || ""}`;

const args = process.argv.slice(2);
const child = spawn("tauri", args, {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});