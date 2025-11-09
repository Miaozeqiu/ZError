import { createApp } from "vue";
import "./styles/themes.css";
import App from "./App.vue";
import { initGlobalTheme } from "./composables/useTheme";

// 等待Tauri初始化完成
async function initApp() {
  // 检查是否在Tauri环境中
  if (typeof window !== 'undefined' && window.__TAURI__) {
    // 等待Tauri完全初始化
    await new Promise(resolve => {
      if (window.__TAURI_INTERNALS__) {
        resolve(true);
      } else {
        const checkInterval = setInterval(() => {
          if (window.__TAURI_INTERNALS__) {
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 50);
        
        // 最多等待2秒
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve(true);
        }, 2000);
      }
    });
  }
  
  // 初始化主题系统
  initGlobalTheme().then(() => {
    console.log('Theme system initialized');
  }).catch((error) => {
    console.error('Failed to initialize theme system:', error);
  });

  // 禁用webview默认右键菜单
  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('contextmenu', (e) => {
      // 检查是否点击在自定义右键菜单组件上
      const target = e.target as Element;
      const isCustomMenu = target.closest('.context-menu') || 
                          target.closest('.menu-item') ||
                          target.closest('[data-custom-menu]');
      
      // 如果不是自定义菜单组件，则阻止默认右键菜单
      if (!isCustomMenu) {
        e.preventDefault();
      }
    });
  });
  
  createApp(App).mount("#app");
}

initApp();
