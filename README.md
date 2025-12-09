

<div align="center">
  <img src="https://free.picui.cn/free/2025/04/14/67fd2249779d0.png" alt="ZError Logo" width="128">
  <br>
  <h2>ZError - Linux Support</h2>
  <span>支持OCS网课助手的AI题库管理软件（Linux 复刻版）</span>
  <br><br>
  <a href="https://github.com/Kaurisss/ZError/releases">
    <img src="https://img.shields.io/badge/platform-Linux-blue?style=flat-square" alt="Platform">
  </a>
</div>

> ⚠️ **注意：** 本项目是 [ZError](https://app.zerror.cc) 的 **Linux 平台复刻版本**，添加了对 Linux 系统的支持。

## 项目简介

ZError是一个功能强大的AI题库软件，支持多种AI平台接口，提供本地缓存和管理功能，可以为OCS网课助手提供题库支持。项目采用Tauri+Vue3开发，数据库使用SQLite3。软件支持AI平台与AI模型的完全自定义，用户可以通过编写一个JS函数将AI接口标准化，从而实现调用任意AI。当然软件也内置了常见的平台（硅基流动，阿里云百炼，DeepSeek）以及模型。

**本版本添加了 Linux 平台支持。**

![软件首页](https://free.picui.cn/free/2025/11/09/691031b4dd824.png)

## 主要功能

- OCS题库配置
- 支持自定义AI供应商以及AI模型
- 本地题库管理与缓存
- Linux 平台原生支持

## 题库管理

软件内置题库管理功能，支持题目编辑，文件夹分类。

![题库页面](https://free.picui.cn/free/2025/11/09/691031f9db6f9.png)

## 使用教程

https://www.bilibili.com/video/BV1TPoFY8E4V

## 系统要求

- **Fedora / RHEL** 系列 (x86_64)
- **Debian / Ubuntu** 系列 (amd64)

## 下载

| 发行版 | 文件名 |
|--------|--------|
| Fedora/RHEL | `ZError-2.0.2-1.x86_64.rpm` |
| Ubuntu/Debian | `ZError_2.0.2_amd64.deb` |

前往 [Releases](https://github.com/Kaurisss/ZError/releases) 页面下载最新版本。

## 安装方法

### Fedora / RHEL

```bash
sudo dnf install ./ZError-2.0.2-1.x86_64.rpm
```

### Debian / Ubuntu

```bash
sudo apt install ./ZError_2.0.2_amd64.deb
```

## 配置说明

首次运行时，请在设置页面配置相应的API密钥：

1. DeepSeek API密钥
2. 阿里云百炼API密钥
3. 硅基流动API密钥

## 官方网站

- **原版 (Windows):** [app.zerror.cc](https://app.zerror.cc)
- **Linux 复刻版:** [GitHub Releases](https://github.com/Kaurisss/ZError/releases)

## 许可证

本项目采用 MIT 许可证