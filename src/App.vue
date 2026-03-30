<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import AppHeader from "./components/AppHeader.vue";
import Sidebar from "./components/Sidebar.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import Home from "./views/Home.vue";
import Settings from "./views/Settings.vue";
import QuestionBank from "./views/QuestionBank.vue";
import UrlContent from "./views/UrlContent.vue";
import FileInfo from "./views/FileInfo.vue";
import FileTree from "./components/questions/FileTree.vue";
import { databaseService } from "./services/database";
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

const isFileInfoPage = computed(() => {
  return window.location.pathname === '/file-info' ||
         window.location.search.includes('name=') ||
         window.location.hash === '#/file-info' ||
         window.location.hash.startsWith('#/file-info')
})

// 当前活跃的页面
const activeTab = ref('home');
// 顶层 tab 切换时用于触发各视图折叠的触发器
const collapseTrigger = ref(0);
const questionBankFocusFolderId = ref<number | null>(null);
const questionBankFocusRequestKey = ref(0);


// 版本更新相关状态
const showUpdateDialog = ref(false);
const updateInfo = ref<VersionInfo | null>(null);
const currentVersion = ref(VersionCheckService.getCurrentVersion());


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

const handleOpenQuestionFolder = (folderId: number) => {
  handleNavigate('questions');
  questionBankFocusFolderId.value = folderId;
  questionBankFocusRequestKey.value++;
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
    import('@tauri-apps/plugin-opener').then((mod: any) => {
      mod.openUrl(downloadUrl);
    }).catch(() => {
      window.open(downloadUrl, '_blank');
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

const showImportDialog = ref(false);
const closeImportDialog = () => {
  showImportDialog.value = false;
};

const importItems = ref<any[]>([]);
const importTreeRef = ref<any>(null);
const selectedImportFolderId = ref<number | null>(null);
const selectedImportFolderName = ref("");
const importing = ref(false);

const normalizeImportItems = (items: any): any[] => {
  const arr = Array.isArray(items) ? items : [];
  return arr.map((x: any) => {
    const q = x?.Question ?? x?.question ?? "";
    const opts = x?.Options ?? x?.options ?? null;
    const ans = x?.Answer ?? x?.answer ?? "";
    const type = x?.QuestionType ?? x?.question_type ?? "";
    return { content: String(q), options: Array.isArray(opts) ? opts : (typeof opts === "string" ? opts : null), answer: String(ans), question_type: String(type) };
  });
};

const handleFolderSelect = (folderId: number, folderName: string) => {
  selectedImportFolderId.value = folderId;
  selectedImportFolderName.value = folderName;
};

  const handleImportConfirm = async () => {
    if (selectedImportFolderId.value === null) return;
    if (!importItems.value || importItems.value.length === 0) return;
    importing.value = true;
    try {
      await databaseService.connect();
      let count = 0;
      for (const item of importItems.value) {
        const content = String(item.content || item.question || "");
        if (!content) continue;
        const optionsStr = Array.isArray(item.options) ? item.options.join("\n") : (typeof item.options === "string" ? item.options : undefined);
        const answerStr = String(item.answer ?? "");
        await databaseService.addQuestion({ content, options: optionsStr, answer: answerStr, folderId: selectedImportFolderId.value });
        count++;
      }
      showImportDialog.value = false;
      
      // 发出全局事件，通知其他组件刷新数据
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit('refresh-data');
      } catch {}

      try { importTreeRef.value?.refreshData?.(); } catch {}
      alert(`成功导入 ${count} 条数据！`);
    } catch (e) {
      console.error('导入失败:', e);
      alert('导入失败: ' + (e as Error).message);
    } finally {
      importing.value = false;
    }
  };

onMounted(async () => {
  const isMainWindow = !isFileInfoPage.value && !isUrlContentPage.value;
  if (isMainWindow) {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await listen('open-import-dialog', async (event: any) => {
        console.log('收到导入事件:', event);
        const payload = event?.payload || {};
        importItems.value = normalizeImportItems(payload.items);
        showImportDialog.value = true;
        
        // 聚焦当前窗口（主窗口）
        try {
          const win = getCurrentWindow()
          await win.setFocus()
        } catch (e) {
          console.error('聚焦窗口失败:', e)
        }
      })
    } catch (error) {
      console.error('监听事件失败:', error);
    }
  }
  (window as any).__appImportDialogReady = isMainWindow;
});

// 应用初始化
onMounted(async () => {
  const isMainWindow = !isFileInfoPage.value && !isUrlContentPage.value;
  if (!isMainWindow) return;
  try {
    console.log('开始应用初始化...');
    await initGlobalTheme();
    console.log('主题系统初始化完成');
    await initializationService.initialize();
    console.log('应用初始化完成');
    await checkForUpdates();
  } catch (error) {
    console.error('应用初始化失败:', error);
  }
});



</script>

<template>
  <!-- URL内容处理页面 -->
  <UrlContent v-if="isUrlContentPage" />
  <FileInfo v-else-if="isFileInfoPage" />
  
  <!-- 主应用界面 -->
  <div v-else class="app-container">
    <!-- 自定义Header -->
    <AppHeader :active-tab="activeTab" />

    
    <!-- 主要内容区域 -->
    <div class="main-content">
      <!-- 侧边导航栏 -->
      <Sidebar :active-tab="activeTab" @navigate="handleNavigate" />
      
      <!-- 内容区域 -->
      <div class="content-area">
        <!-- 首页 -->
        <div v-show="activeTab === 'home'" class="content-view">
          <Home :collapse-trigger="collapseTrigger" @navigate="handleNavigate" />
        </div>
        
        <!-- 题库页面 -->
        <div v-show="activeTab === 'questions'" class="content-view">
          <QuestionBank
            :collapse-trigger="collapseTrigger"
            :focus-folder-id="questionBankFocusFolderId"
            :focus-folder-request-key="questionBankFocusRequestKey"
          />
        </div>
        
        <!-- 设置页面 -->
        <div v-show="activeTab === 'settings'" class="content-view">
          <Settings @open-question-folder="handleOpenQuestionFolder" />
        </div>
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

  <div v-if="!isUrlContentPage && !isFileInfoPage && showImportDialog" class="modal" @click="closeImportDialog">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <span>导入</span>
        <button @click="closeImportDialog">×</button>
      </div>
      <div class="modal-body">
        <FileTree style="border-radius: 6px;" ref="importTreeRef" @folder-select="handleFolderSelect" />
      </div>
      <div class="modal-footer">
        <div class="footer-info">
          <span>目标文件夹：{{ selectedImportFolderName || '未选择' }}</span>
          <span style="margin-left:12px;">待导入：{{ importItems.length }} 条</span>
        </div>
        <div class="footer-actions">
          <button @click="closeImportDialog" :disabled="importing">取消</button>
          <button @click="handleImportConfirm" :disabled="importing || selectedImportFolderId === null || !importItems.length">导入</button>
        </div>
      </div>
    </div>
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
  overflow: hidden;
}

#app {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
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
.content-view {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
}

.content-view > * {
  width: 100%;
  height: 100%;
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

.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-content {
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  width: 600px;
  max-height: 80vh;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #ddd);
}

.modal-header button {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 18px;
  color: var(--text-secondary, #666);
  padding: 4px;
  border-radius: 4px;
}

.modal-body {
  padding: 12px;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-top: 1px solid var(--border-color, #ddd);
}

.footer-actions button {
  margin-left: 8px;
}

</style>
