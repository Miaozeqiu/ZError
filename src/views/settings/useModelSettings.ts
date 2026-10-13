/** 模型设置编排。状态 ModelSettings/state.ts；滚动 / 测连通 / 图标 / 平台操作分文件。弹窗逻辑在 useModelConfigDialog.ts。 */
import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useModelConfig, modelHasVision } from '../../services/model/config'
import { bindModelIcons } from './ModelSettings/icons'
import { bindPlatformOps } from './ModelSettings/platform'
import { bindSettingsScroll } from './ModelSettings/scroll'
import { createModelSettingsState } from './ModelSettings/state'
import { bindModelTest } from './ModelSettings/testModel'

export function useModelSettings() {
  const config = useModelConfig()
  const { settings: modelConfig, selectedVisionModel: globalSelectedVisionModel } = config
  const state = createModelSettingsState(config)

  const scrollHooks: { onBeforeDetailScroll?: () => void } = {}
  const scroll = bindSettingsScroll(scrollHooks)
  const icons = bindModelIcons(state, () => modelConfig.platforms)
  const test = bindModelTest(state)
  const platform = bindPlatformOps({ state, config, scroll, test, icons })
  scrollHooks.onBeforeDetailScroll = platform.closePlatformProtocolDropdown

  onMounted(() => {
    document.addEventListener('click', platform.hidePlatformMenu)
    document.addEventListener('click', platform.hideModelMenu)
    document.addEventListener('click', platform.handleAddModelOutsideClick)
    document.addEventListener('click', platform.handlePlatformProtocolOutsideClick)
    window.addEventListener('resize', platform.closePlatformProtocolDropdown)

    icons.loadPlatformIcons()
    icons.loadRemoteModelIconMappings()

    if (modelConfig.platforms.length > 0) {
      state.selectedPlatform.value = modelConfig.platforms[0]
    }

    nextTick(() => {
      scroll.updatePlatformScrollbarThumb()
    })
  })

  onUnmounted(() => {
    test.cancelCurrentTest()
    document.removeEventListener('click', platform.hidePlatformMenu)
    document.removeEventListener('click', platform.hideModelMenu)
    document.removeEventListener('click', platform.handleAddModelOutsideClick)
    document.removeEventListener('click', platform.handlePlatformProtocolOutsideClick)
    window.removeEventListener('resize', platform.closePlatformProtocolDropdown)
    scroll.cleanupScrollTimers()
  })

  watch(state.selectedPlatform, async () => {
    platform.closePlatformProtocolDropdown()
    await nextTick()
    scroll.updateScrollbarThumb()
    scroll.updatePlatformScrollbarThumb()
    scroll.observeDetailResize()
  })

  watch(() => modelConfig.platforms.length, async () => {
    await nextTick()
    scroll.updatePlatformScrollbarThumb()
  })

  watch(globalSelectedVisionModel, (newModel) => {
    console.log('🔄 [DEBUG] globalSelectedVisionModel changed to:', newModel?.displayName || 'null')
    state.currentVisionModel.value = newModel
  }, { immediate: true })

  onMounted(() => {
    state.currentVisionModel.value = globalSelectedVisionModel.value
  })

  watch(() => modelConfig.platforms, (newPlatforms, oldPlatforms) => {
    if (!state.selectedPlatform.value && newPlatforms.length > 0) {
      state.selectedPlatform.value = newPlatforms[0]
    } else if (state.selectedPlatform.value) {
      const latestSelectedPlatform = newPlatforms.find((item) => item.id === state.selectedPlatform.value?.id)
      if (latestSelectedPlatform) {
        state.selectedPlatform.value = latestSelectedPlatform
      }
    }

    if (!oldPlatforms || newPlatforms.length !== oldPlatforms.length) {
      icons.loadPlatformIcons()
    }

    if (oldPlatforms) {
      for (const newPlatform of newPlatforms) {
        const oldPlatform = oldPlatforms.find((item) => item.id === newPlatform.id)
        if (oldPlatform && oldPlatform.icon !== newPlatform.icon) {
          delete state.platformIconUrls.value[newPlatform.id]
          delete state.iconLoadErrors.value[newPlatform.id]
          state.platformIconBackgrounds.value[newPlatform.id] = icons.isSvgIcon(newPlatform.icon)

          if (newPlatform.icon && newPlatform.icon.includes('.')) {
            icons.getPlatformIconUrl(newPlatform.icon).then((url) => {
              state.platformIconUrls.value[newPlatform.id] = url
            }).catch((error) => {
              console.error(`Failed to reload icon for platform ${newPlatform.id}:`, error)
              state.iconLoadErrors.value[newPlatform.id] = true
            })
          }
        }
      }
    }
  }, { deep: true })

  return {
    ...scroll,
    ...state,
    ...icons,
    ...test,
    ...platform,
    modelConfig,
    modelHasVision,
  }
}
