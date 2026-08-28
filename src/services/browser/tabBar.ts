import { ref, shallowRef } from 'vue'
import type { AppBrowser } from './appBrowser'

export const liveBrowserTabs = ref<AppBrowser[]>([])
export const liveBrowserTabId = ref('')

export type BrowserTabHandlers = {
  selectTab: (id: string) => void
  closeTab: (id: string) => void | Promise<void>
  newTab: () => void
  tabLabel: (item: AppBrowser) => string
}

export const browserTabHandlers = shallowRef<BrowserTabHandlers | null>(null)

export const syncBrowserTabBar = (tabs: AppBrowser[], selectedId: string) => {
  liveBrowserTabs.value = tabs
  liveBrowserTabId.value = selectedId
}
