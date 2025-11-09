<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import AppHeader from "./components/AppHeader.vue";
import Sidebar from "./components/Sidebar.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import Home from "./views/Home.vue";
import Settings from "./views/Settings.vue";
import QuestionBank from "./views/QuestionBank.vue";
import UrlContent from "./views/UrlContent.vue";
import { initializationService } from "./services/initialization";
import { initGlobalTheme } from "./composables/useTheme";
import { VersionCheckService } from "./services/versionCheck";
import type { VersionInfo } from "./services/versionCheck";

// 检查是否是URL内容页面
const isUrlContentPage = computed(() => {
  return window.location.pathname === '/url-content' || 
         window.location.search.includes('question=') ||
         window.location.hash === '#/url-content' ||
         window.location.hash.startsWith('#/url-content')
})

// 当前活跃的页面
const activeTab = ref('home');
// 顶层 tab 切换时用于触发各视图折叠的触发器
const collapseTrigger = ref(0);

// 版本更新相关状态
const showUpdateDialog = ref(false);
const updateInfo = ref<VersionInfo | null>(null);
const currentVersion = ref('2.0.0'); // 当前版本，可以从package.json或其他配置文件读取

// 导航处理函数
const handleNavigate = (tab: string) => {
  // 仅在实际切换到不同 tab 时触发折叠
  if (activeTab.value !== tab) {
    activeTab.value = tab;
    // 增加触发器版本，通知子视图收缩详情面板
    collapseTrigger.value++;
  } else {
    activeTab.value = tab;
  }
};

// 版本检查
const checkForUpdates = async () => {
  try {
    // 检查是否设置了一周后提醒
    const updateRemindTime = localStorage.getItem('updateRemindTime');
    if (updateRemindTime) {
      const remindTime = new Date(updateRemindTime);
      const currentTime = new Date();
      
      if (currentTime < remindTime) {
        console.log(`用户选择一周后提醒，提醒时间: ${remindTime.toLocaleString()}，当前时间: ${currentTime.toLocaleString()}`);
        return; // 还没到提醒时间，不显示更新对话框
      } else {
        // 已经到了提醒时间，清除提醒设置
        localStorage.removeItem('updateRemindTime');
        console.log('已到提醒时间，清除提醒设置');
      }
    }
    
    const latestVersion = await VersionCheckService.getLatestVersion();
    
    if (latestVersion && VersionCheckService.compareVersions(currentVersion.value, latestVersion.version)) {
      updateInfo.value = latestVersion;
      showUpdateDialog.value = true;
      console.log(`发现新版本: ${latestVersion.version}`);
    } else {
      console.log('当前已是最新版本');
    }
  } catch (error) {
    console.error('版本检查失败:', error);
  }
};

// 处理升级对话框事件
const handleUpdateDialogClose = () => {
  showUpdateDialog.value = false;
};

const handleDownload = (downloadUrl: string) => {
  // 在Tauri环境中打开下载链接
  if (window.__TAURI_INTERNALS__) {
    import('@tauri-apps/plugin-opener').then(({ open }) => {
      open(downloadUrl);
    });
  } else {
    // 在浏览器环境中打开链接
    window.open(downloadUrl, '_blank');
  }
  showUpdateDialog.value = false;
};

const handleLater = () => {
  showUpdateDialog.value = false;
  // 可以在这里设置稍后提醒的逻辑，比如存储到localStorage
  console.log('用户选择稍后更新');
};

const handleWeekLater = () => {
  showUpdateDialog.value = false;
  // 设置一周后提醒的逻辑
  const oneWeekLater = new Date();
  oneWeekLater.setDate(oneWeekLater.getDate() + 7);
  localStorage.setItem('updateRemindTime', oneWeekLater.toISOString());
  console.log('用户选择一周后更新，提醒时间:', oneWeekLater.toISOString());
};

// 应用初始化
onMounted(async () => {
  try {
    console.log('开始应用初始化...');
    
    // 初始化主题系统
    await initGlobalTheme();
    console.log('主题系统初始化完成');
    
    // 初始化其他服务
    await initializationService.initialize();
    console.log('应用初始化完成');
    
    // 检查版本更新
    await checkForUpdates();
  } catch (error) {
    console.error('应用初始化失败:', error);
    // 可以在这里显示错误提示给用户
  }
});
</script>

<template>
  <!-- URL内容处理页面 -->
  <UrlContent v-if="isUrlContentPage" />
  
  <!-- 主应用界面 -->
  <div v-else class="app-container">
    <!-- 自定义Header -->
    <AppHeader />
    
    <!-- 主要内容区域 -->
    <div class="main-content">
      <!-- 侧边导航栏 -->
      <Sidebar :active-tab="activeTab" @navigate="handleNavigate" />
      
      <!-- 内容区域 -->
      <div class="content-area">
        <!-- 首页 -->
        <Home v-show="activeTab === 'home'" :collapse-trigger="collapseTrigger" @navigate="handleNavigate" />
        
        <!-- 题库页面 -->
        <QuestionBank v-show="activeTab === 'questions'" :collapse-trigger="collapseTrigger" />
        
        <!-- 设置页面 -->
        <Settings v-show="activeTab === 'settings'" />
      </div>
    </div>
    
    <!-- 版本更新对话框 -->
    <UpdateDialog
      :visible="showUpdateDialog"
      :version-info="updateInfo"
      :current-version="currentVersion"
      @close="handleUpdateDialogClose"
      @download="handleDownload"
      @later="handleLater"
      @week-later="handleWeekLater"
    />
  </div>
</template>

<style scoped>
.logo.vite:hover {
  filter: drop-shadow(0 0 2em #747bff);
}

.logo.vue:hover {
  filter: drop-shadow(0 0 2em #249b73);
}

</style>
<style>




body {
  margin: 0;
  padding: 0;
  background-color: var(--bg-tertiary, #f4f4f4);
  color: var(--text-primary, #2d3748);
}

#app {
  height: 100vh;
  width: 100vw;
  background-color: var(--bg-tertiary, #f4f4f4);
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: var(--bg-tertiary, #f4f4f4);
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
  width: 100%;
}

.content-area {
  margin-bottom: 100px;
  width: 100%;
  height: 100%;
  flex: 1;
  overflow: hidden;
  background-color: var(--bg-primary, #f4f4f4);
  position: relative;
}

/* 确保所有页面组件占满容器并正确定位 */
.content-area > * {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
}

:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;

  color: var(--text-primary, #0f0f0f);
  background-color: var(--bg-tertiary, #f6f6f6);

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

.container {
  margin: 0;
  padding-top: 10vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
}

.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: 0.75s;
}

.logo.tauri:hover {
  filter: drop-shadow(0 0 2em #24c8db);
}

.row {
  display: flex;
  justify-content: center;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}

a:hover {
  color: #535bf2;
}

h1 {
  text-align: center;
}

input,
button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  color: var(--text-primary, #0f0f0f);
  background-color: var(--bg-primary, #ffffff);
  transition: border-color 0.25s;
  /* box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2); */
}

button {
  cursor: pointer;
}

button:hover {
  border-color: var(--color-primary, #396cd8);
}
button:active {
  border-color: var(--color-primary, #396cd8);
  background-color: var(--active-bg, #e8e8e8);
}

input,
button {
  outline: none;
}

#greet-input {
  margin-right: 5px;
}

@media (prefers-color-scheme: dark) {
  :root {
    color: var(--text-primary, #f6f6f6);
    background-color: var(--bg-secondary, #2f2f2f);
  }

  a:hover {
    color: var(--color-info, #24c8db);
  }

  input,
  button {
    color: var(--text-primary, #ffffff);
    background-color: var(--bg-secondary, #0f0f0f98);
  }
  button:active {
    background-color: var(--active-bg, #0f0f0f69);
  }
}

</style>