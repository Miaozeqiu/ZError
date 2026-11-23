

<div align="center">
  <img src="https://free.picui.cn/free/2026/03/30/69ca3ec05ae5f.ico" alt="ZError Logo" width="128">
  <br>
  <h2>ZError</h3>
  <span>支持OCS网课助手的AI题库管理软件</span>
</div>

## 项目简介

安装版支持 [ZError CLI](docs/cli.md)，可从终端配置模型与网站账号、管理题库、运行 Agent 和调用浏览器工具。安装入口位于「设置 → 常规 → 命令行」。

ZError是一款专为OCS网课助手设计的AI题库软件，可以方便地为OCS网课助手搭建本地AI题库。软件由Tauri架构开发，支持AI平台以及模型的自定义。

![软件首页](https://free.picui.cn/free/2025/11/09/691031b4dd824.png)

## 主要功能

- OCS题库配置
- 自定义AI供应商以及AI模型
- 本地题库管理与缓存

## 题库管理

软件内置题库管理功能，支持题目编辑，文件夹分类。

![题库页面](https://free.picui.cn/free/2025/11/09/691031f9db6f9.png)

## 使用教程

https://www.bilibili.com/video/BV12PSQBLE5G

## 系统要求

- Windows 10/11
- Linux（实验性，AppImage）

## 安装方法

1. 从[官网](https://app.zerror.cc/)下载最新版本
2. 运行安装程序
3. 运行软件

开发时在仓库根跑 `npm run rust:check` / `npm run rust:test`（会补上 pip 的 cmake/ninja 和 `CEF_PATH`）。

## Linux 构建

Linux 默认构建 AppImage。需要提权时通过 Polkit 的 `pkexec` 请求；运行 AppImage 需要 FUSE 2，未安装时可使用 `APPIMAGE_EXTRACT_AND_RUN=1` 启动。

以 Debian/Ubuntu 为例安装构建依赖：

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev patchelf
bun install
bun run tauri:build
```

产物位于 `src-tauri/target/release/bundle/appimage/`。也支持系统 OpenSSL 4.x。

## 许可证

本项目采用MIT许可证

## 上线前回归

运行 `npm run test:release` 检查全部前端、原生及 CLI Skill 安装升级场景。安装包的真实桌面流程使用 `--phase desktop --cli <包内 CLI>`，功能清单、报告及实机验收见 [上线前测试说明](docs/release-testing.md)。发布流水线必须等待当前提交的回归与三平台安装包验证通过。

### npm 命令

- `dev` / `build` / `preview`：前端开发、类型检查与构建、预览构建产物。
- `tauri` / `tauri:dev` / `tauri:build`：原生 CLI 转发、桌面开发、包含平台后处理的桌面打包。
- `tauri:build:win`：Windows 本地 NSIS 打包及更新签名。
- `test` / `test:mcp` / `test:release`：全部前端测试、搜索专项、上线前回归。
- `rust:check` / `rust:test`：本机原生检查与单元测试。

外部 Agent 使用安装后的 `zerror` 命令，不依赖开发仓库的 npm 快捷命令。正式发布通过 GitHub Actions 校验并签署最终更新包。
