<template>
  <Transition name="dialog-fade" :duration="180" @after-leave="onDialogAfterLeave">
    <div v-if="show" key="model-config-dialog" class="dialog-overlay dialog-overlay--vue" @click="handleOverlayClick">
      <div class="dialog-panel model-config-panel" :class="{ 'model-config-panel--compact': !showAdvancedCode }" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" type="button" @click="$emit('close')" title="取消">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <span class="dialog-title">{{ dialogTitle }}</span>
        <div class="dialog-header-actions">
          <button
            type="button"
            class="model-test-card"
            :class="modelTestCardClass"
            :disabled="isTestingModel || !canTestModel"
            :title="modelTestTooltip"
            @click="testModelAvailability"
          >
            <span v-if="isTestingModel" class="model-test-spinner" aria-hidden="true" />
            <span class="model-test-title">{{ modelTestTitle }}</span>
            <span v-if="modelTestMeta" class="model-test-meta">{{ modelTestMeta }}</span>
          </button>
          <button class="btn-confirm" type="button" :disabled="!isFormValid" @click="handlePrimaryAction">
            完成
          </button>
        </div>
      </div>
      <div class="dialog-body">
        <div class="split-container" :class="{ 'split-container--compact': !showAdvancedCode }">
          <!-- 左侧：JavaScript 配置代码（高亮 + 语法检查，默认收起） -->
          <div class="editor-panel" :class="{ 'editor-panel--collapsed': !showAdvancedCode }">
            <div class="editor-header">JavaScript 配置代码</div>
          <div class="code-editor">
            <div ref="cmContainerRef" class="cm-container"></div>
          </div>
        </div>

          <!-- 右侧：基本信息与操作按钮 -->
          <form class="form-panel" :class="{ 'form-panel--full': !showAdvancedCode }" @submit.prevent="handleSubmit">
            <div ref="modelDropdownAnchorRef" class="form-group qa-model-id-group">
              <label class="form-label">模型 ID</label>
              <div
                class="qa-model-id-row"
                :class="{ open: showModelDropdown, 'has-dropdown': fetchedModelList.length > 0 }"
              >
                <input
                  ref="modelIdInputRef"
                  v-model="formData.modelId"
                  type="text"
                  class="form-input"
                  :class="{ 'has-arrow': !isRemote && fetchedModelList.length > 0 }"
                  placeholder="例如：gpt-4o-mini"
                  :readonly="isRemote"
                  :disabled="isRemote"
                  @input="handleModelIdInput"
                  @focus="handleModelIdFocus"
                  @click="handleModelIdFocus"
                  @blur="handleModelIdBlur"
                >
                <button
                  v-if="fetchedModelList.length > 0"
                  type="button"
                  class="qa-model-id-arrow"
                  :class="{ open: showModelDropdown }"
                  aria-label="选择模型"
                  @mousedown.prevent
                  @click="toggleModelDropdown"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
            <Teleport to="body">
              <Transition name="dropdown-pop">
                <div
                  v-if="showModelDropdown && fetchedModelList.length > 0"
                  ref="modelDropdownRef"
                  class="qa-dropdown"
                  :style="modelDropdownStyle"
                  @mousedown.prevent
                >
                  <div class="qa-dropdown-list">
                    <template v-if="filteredFetchedModels.length > 0">
                      <div v-for="group in groupedFetchedModels" :key="group.owner" class="qa-dropdown-group">
                        <div class="qa-dropdown-group-title">{{ group.owner }}</div>
                        <div
                          v-for="m in group.models"
                          :key="m.id"
                          class="qa-dropdown-item"
                          @mousedown.prevent="selectFetchedModel(m.id)"
                        >
                          <span class="qa-dropdown-item-id">{{ m.id }}</span>
                        </div>
                      </div>
                    </template>
                    <div v-else class="qa-dropdown-empty">无匹配模型</div>
                  </div>
                </div>
              </Transition>
            </Teleport>

            <div class="form-group">
              <label class="form-label">显示名</label>
              <input
                v-model="formData.displayName"
                type="text"
                class="form-input"
                placeholder="例如：GPT-4 Turbo"
                required
                :readonly="isRemote"
                :disabled="isRemote"
              >
            </div>

            <div class="form-group">
              <label class="form-label form-label--row">
                <span>视觉能力</span>
                <label class="switch-toggle" :class="{ disabled: isRemote }">
                  <input type="checkbox" v-model="formData.hasVision" :disabled="isRemote" />
                  <span class="switch-slider"></span>
                </label>
              </label>
              <p class="form-hint">
                {{ isRemote
                  ? '远程模型的视觉能力由管理员下发，本地不可修改。'
                  : '开启后，该模型会出现在视觉模型列表中，可用于图片理解。' }}
              </p>
            </div>

            <div class="form-group">
              <label class="form-label form-label--row">
                <span>启用思考</span>
                <label class="switch-toggle">
                  <input type="checkbox" v-model="formData.enableThinking" />
                  <span class="switch-slider"></span>
                </label>
              </label>
              <p class="form-hint">
                可在本机开关，同步远控模型时会保留。开启后模型会输出思考过程，响应时间可能明显变长。部分模型不支持。
              </p>

              <!-- 关闭思考：按协议展示可选参数 -->
              <div v-if="!formData.enableThinking" class="thinking-options">
                <p class="thinking-options-title">关闭时发送的参数</p>

                <template v-if="isChatProtocol">
                  <label class="thinking-check">
                    <input type="checkbox" v-model="formData.thinkingOffEnableThinkingFalse" />
                    <code>enable_thinking: false</code>
                  </label>
                  <label class="thinking-check">
                    <input type="checkbox" v-model="formData.thinkingOffThinkingTypeDisabled" />
                    <code>thinking: &#123; type: "disabled" &#125;</code>
                  </label>
                </template>

                <template v-else-if="isResponsesProtocol">
                  <label class="thinking-check" :class="{ disabled: isRemote }">
                    <input
                      type="radio"
                      name="thinking-off-responses-effort"
                      value="none"
                      v-model="formData.thinkingOffResponsesEffort"
                    />
                    <code>reasoning.effort: "none"</code>
                  </label>
                  <label class="thinking-check" :class="{ disabled: isRemote }">
                    <input
                      type="radio"
                      name="thinking-off-responses-effort"
                      value="minimal"
                      v-model="formData.thinkingOffResponsesEffort"
                    />
                    <code>reasoning.effort: "minimal"</code>
                  </label>
                </template>

                <template v-else-if="isMessagesProtocol">
                  <p class="thinking-fixed-param"><code>thinking: &#123; type: "disabled" &#125;</code></p>
                </template>

                <p v-else class="form-hint">自定义协议请在代码中自行控制思考参数。</p>
              </div>

              <!-- 开启思考：选择强度 -->
              <div v-else class="thinking-options">
                <p class="thinking-options-title">
                  思考强度
                  <code v-if="isChatProtocol">reasoning_effort</code>
                  <code v-else>reasoning.effort</code>
                </p>
                <div
                  class="thinking-effort-slider"
                  :class="{ 'is-max': isMaxEffort, 'is-dragging': isDraggingEffort }"
                >
                  <div
                    ref="effortBarRef"
                    class="thinking-effort-bar"
                    role="slider"
                    :aria-valuemin="0"
                    :aria-valuemax="effortMaxIndex"
                    :aria-valuenow="effortIndex"
                    aria-label="思考强度"
                    :tabindex="0"
                    @pointerdown="onEffortPointerDown"
                    @pointermove="onEffortPointerMove"
                    @pointerup="onEffortPointerUp"
                    @pointercancel="onEffortPointerUp"
                    @keydown="onEffortKeydown"
                  >
                    <div class="thinking-effort-fill" :style="{ width: effortFillWidth }">
                      <canvas
                        v-if="isMaxEffort"
                        class="thinking-effort-matrix"
                        aria-hidden="true"
                        :ref="bindEffortMatrix"
                      />
                    </div>
                    <div class="thinking-effort-dots" aria-hidden="true">
                      <span
                        v-for="(opt, index) in thinkingEffortOptions"
                        v-show="index > 0 && index < thinkingEffortOptions.length - 1"
                        :key="opt.value"
                        class="thinking-effort-dot"
                        :class="{ passed: effortSlide >= index }"
                        :style="{ left: effortStopLeft(index) }"
                      />
                    </div>
                    <div class="thinking-effort-thumb" :style="{ left: effortThumbLeft }" />
                  </div>
                  <div class="thinking-effort-labels">
                    <button
                      v-for="(opt, index) in thinkingEffortOptions"
                      :key="opt.value"
                      type="button"
                      class="thinking-effort-label"
                      :class="{ active: formData.thinkingEffort === opt.value }"
                      @click="formData.thinkingEffort = opt.value"
                    >{{ opt.label }}</button>
                  </div>
                </div>
              </div>
            </div>

          </form>
        </div>
      </div>
    </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useModelConfigDialog, Props, Emits } from './useModelConfigDialog'

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const {
  thinkingEffortOptions, effortMatrixRaf, effortMatrixStop, effortMatrixIo, effortMatrixRo, stopEffortMatrixFx, startEffortMatrixFx, bindEffortMatrix, modelDropdownAnchorRef, modelIdInputRef, modelDropdownRef, modelDropdownStyle, isFetchingModels, showModelDropdown, fetchedModelList, formData, isEditing, isRemote, effortMaxIndex, EFFORT_THUMB_PX, effortBarRef, effortSlide, isDraggingEffort, effortIndex, isMaxEffort, effortThumbOffset, effortFillWidth, effortStopLeft, effortThumbLeft, snapEffortValue, applyEffortMagnet, slideEffortFromClientX, suppressEffortSelectStart, lockEffortTextSelect, onEffortPointerDown, onEffortPointerMove, onEffortPointerUp, onEffortKeydown, dialogTitle, requiresModelId, isChatProtocol, isResponsesProtocol, isMessagesProtocol, isFormValid, filteredFetchedModels, groupedFetchedModels, updateModelDropdownPosition, modelDropdownBlurTimer, clearModelDropdownBlurTimer, openModelDropdown, closeModelDropdown, normalizeBaseUrl, modelsCacheByBaseUrl, fetchModelsGeneration, tauriFetchPromise, getTauriFetch, applyFetchedModels, restoreModelsFromCache, handleModelIdFocus, toggleModelDropdown, handleModelIdBlur, handleModelIdInput, handleModelDropdownOutsideClick, handleModelDropdownViewportChange, parseModelsResponse, fetchModels, selectFetchedModel, DEFAULT_JS_CODE, DEFAULT_VISION_JS_CODE, thinkingPresetOptions, buildCurrentPresetJsCode, syncPresetJsCode, EFFORT_VALUES, normalizeEffort, normalizeOffResponsesEffort, createDialogFormData, readEnableThinkingFromJsCode, applyEnableThinkingToJsCode, deriveEnableThinking, showAdvancedCode, applyModelIdToJsCode, onDialogAfterLeave, cmContainerRef, cmView, themeObserver, rebuildEditorWithDoc, jsSyntaxLinter, initCodeMirror, setEditorDoc, handleOverlayClick, handlePrimaryAction, handleSubmit, isTestingModel, modelTestStatus, modelTestMessage, modelTestElapsedMs, modelTestAbort, canTestModel, modelTestCardClass, modelTestTitle, modelTestTooltip, modelTestMeta, resetModelTestState, isAbortError, collectProcessModelOutput, testModelAvailability
} = useModelConfigDialog(props, emit)

</script>

<style>
@import '../../../styles/dialog.css';

/* 弹窗进出场：必须用 keyframes。进场 animation:both 会锁住 opacity/transform，CSS transition 关不掉（尤其 WebKit）。 */
.dialog-overlay.dialog-overlay--vue {
  animation: none;
}
.dialog-overlay.dialog-overlay--vue .dialog-panel {
  animation: none;
}
.dialog-overlay.dialog-overlay--vue.dialog-fade-enter-active {
  animation: overlay-fade-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.dialog-overlay.dialog-overlay--vue.dialog-fade-leave-active {
  animation: overlay-fade-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) reverse both;
  pointer-events: none;
}
.dialog-overlay.dialog-overlay--vue.dialog-fade-enter-active .dialog-panel {
  animation: popup-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.dialog-overlay.dialog-overlay--vue.dialog-fade-leave-active .dialog-panel {
  animation: popup-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) reverse both;
}

/* Teleport 到 body 的下拉：用非 scoped，保证进出场动画生效 */
.dropdown-pop-enter-active,
.dropdown-pop-leave-active {
  transition: opacity 0.14s ease, transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: top center;
  will-change: opacity, transform;
}

.dropdown-pop-enter-from,
.dropdown-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

.dropdown-pop-enter-to,
.dropdown-pop-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}
</style>

<style scoped>
.model-config-panel {
  width: 92vw;           /* 随主窗口变化的宽度 */
  max-width: 1400px;     /* 合理的最大宽度限制 */
  max-height: 90vh;      /* 与 dialog-panel 一致，确保内部可滚动 */
  display: flex;
  flex-direction: column;
  transition: max-width 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* 隐藏 JavaScript 代码时收窄弹窗，避免表单两侧留大块空白 */
.model-config-panel--compact {
  max-width: 580px;
}

.model-config-panel > .dialog-body {
  padding: 24px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 由内部表单/编辑器各自滚动 */
}

/* 分栏布局 */
.split-container {
  display: flex;
  gap: 16px;
  flex: 1 1 auto;
  min-height: 0;  /* 允许子项根据可用空间收缩 */
  min-width: 0;   /* 防止子项溢出导致布局错位 */
  transition: gap 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* 编辑器收起时去掉间距，让表单居中无偏移 */
.split-container--compact {
  gap: 0;
}

.editor-panel {
  flex: 1 1 auto;         /* 占据除右侧表单外的剩余宽度 */
  display: flex;
  flex-direction: column;
  min-height: 0;          /* 让编辑器按高度自适应 */
  min-width: 0;           /* 允许内容在窄屏时收缩 */
  max-height: none;
  max-width: 100%;        /* 展开时不超出容器 */
  overflow: hidden;       /* 收起过程中裁剪内部编辑器 */
  opacity: 1;
  transition: max-width 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
              max-height 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
              opacity 0.24s cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* 收起：宽度归零 + 淡出，配合 overflow:hidden 实现平滑过渡 */
.editor-panel--collapsed {
  flex: 0 0 0;
  max-width: 0;
  max-height: 0;
  opacity: 0;
  pointer-events: none;
}

.form-panel {
  flex: 0 0 360px;        /* 固定宽度 */
  max-width: 380px;       /* 限制最大宽度以防样式抖动 */
  min-height: 0;          /* 允许在弹窗高度受限时收缩并滚动 */
  overflow-x: hidden;
  overflow-y: auto;       /* 底部被遮挡时可滑动查看 */
  padding-right: 4px;
  padding-bottom: 8px;
  transition: flex-basis 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
              max-width 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* 编辑器收起时，表单占满可用宽度并居中，避免左侧留大块空白 */
.form-panel--full {
  flex: 0 0 520px;        /* 用具体 flex-basis 以便过渡动画 */
  max-width: 520px;
  margin: 0 auto;
  align-self: stretch;
}

.form-hint code {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  background: var(--bg-tertiary, #f1f5f9);
  color: var(--text-primary, #2d3748);
  padding: 1px 5px;
  border-radius: 4px;
}

.editor-header {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
  margin-bottom: 8px;
}

.code-editor {
  position: relative;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  background: var(--bg-primary, #ffffff);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  min-height: 240px;
  overflow: hidden; /* 容器不要出现第二个滚动条 */
  flex: 1;           /* 填满可用高度，底部距离固定 */
  display: flex;     /* 让内部 contenteditable 高度100%生效 */
}

/* CodeMirror 容器与内部样式 */
.cm-container {
  position: relative;
  width: 100%;
  height: 100%;
}
.code-editor :deep(.cm-editor) {
  height: 100%;
}
.code-editor :deep(.cm-content) {
  padding: 12px;
  font-family: 'Consolas','Monaco','Courier New',monospace;
  font-size: 13px;
  line-height: 20px;
}
.code-editor :deep(.cm-gutters) {
  border-right: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-primary, #ffffff);
}

.code-hl {
  position: absolute;
  inset: 0;
  padding: 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden; /* 高亮层不显示滚动条 */
  pointer-events: none;
  z-index: 0;
  font-size: 13px;
}

.code-input {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 12px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: transparent; /* 通过高亮层显示文本 */
  caret-color: var(--text-primary, #2d3748);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  line-height: 1.4;
  overflow: auto; /* 仅 textarea 保留滚动条 */
  box-sizing: border-box;
  white-space: pre-wrap; /* 尽可能与高亮层换行一致 */
  tab-size: 2;
  z-index: 1; /* 保证光标在高亮层之上显示 */
}

/* 已移除 lint 状态区样式 */

/* 高亮配色（轻量） */
.hl-comment { color: #718096; }
.hl-string  { color: #38a169; }
.hl-keyword { color: #6366f1; font-weight: 600; }
.hl-number  { color: #d69e2e; }
.hl-constant{ color: #e11d48; font-weight: 600; }
.hl-operator{ color: #f97316; }
.hl-punc    { color: #64748b; }

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #2d3748);
  margin-bottom: 6px;
}

.qa-model-id-row {
  position: relative;
  display: flex;
  align-items: center;
}

.qa-model-id-row .form-input {
  flex: 1;
  width: 100%;
}

.qa-model-id-row .form-input.has-arrow {
  padding-right: 40px;
}

.qa-model-id-arrow {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #718096);
  cursor: pointer;
  transition: transform 0.2s ease, color 0.2s ease;
}

.qa-model-id-arrow:hover {
  color: var(--text-primary, #2d3748);
}

.qa-model-id-arrow.open {
  transform: translateY(-50%) rotate(180deg);
}

.qa-dropdown {
  position: fixed;
  box-sizing: border-box;
  background: var(--context-menu-bg, rgba(255, 255, 255, 0.4));
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--context-menu-border, rgba(255, 255, 255, 0.55));
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.12), inset 0 0.5px 0 rgba(255, 255, 255, 0.5);
  max-height: 320px;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px;
  font-size: 14px;
}

.qa-dropdown-list {
  flex: 1;
  overflow-y: auto;
  max-height: 240px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qa-dropdown-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qa-dropdown-group-title {
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.qa-dropdown-item {
  box-sizing: border-box;
  padding: 4px 8px;
  min-height: 32px;
  border-radius: 8px;
  cursor: pointer;
  background: transparent;
  color: var(--context-menu-item-text, #2d3748);
  font-size: 14px;
  display: flex;
  align-items: center;
  transition: background-color 0.2s ease;
}

.qa-dropdown-item:hover {
  background-color: var(--context-menu-item-hover-bg, rgba(0, 0, 0, 0.06));
}

.qa-dropdown-item-id {
  display: block;
  line-height: 1.4;
}

.qa-dropdown-empty {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
}

@media (prefers-reduced-transparency: reduce) {
  .qa-dropdown {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: #ffffff;
  }
}

.qa-form-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.qa-form-row .form-label {
  margin-bottom: 0;
}

.qa-category-switch {
  flex: 1;
  display: flex;
  justify-content: flex-end;
}


.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 图标相关样式 */
.icon-section {
  margin-bottom: 20px;
}

.icon-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.icon-display {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--border-color, #e2e8f0);
  background: var(--bg-tertiary, #f7fafc);
}

.icon-image {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 4px;
}

.icon-emoji {
  font-size: 24px;
}

.icon-fallback {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary, #667eea);
}

.icon-preview-text {
  font-size: 14px;
  color: var(--text-secondary, #718096);
}

.icon-input-group {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.icon-input {
  flex: 1;
}

.btn-icon {
  padding: 10px 16px;
  background: var(--bg-tertiary, #f7fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--text-primary, #2d3748);
}

.btn-icon:hover {
  background: var(--hover-bg, #edf2f7);
}

.icon-picker {
  position: relative;
}

.icon-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-secondary, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  z-index: 1001;
  max-height: 300px;
  overflow-y: auto;
}

.icon-section-title {
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
  background: var(--bg-tertiary, #f7fafc);
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
  gap: 8px;
  padding: 12px;
}

.icon-option {
  width: 50px;
  height: 50px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--bg-secondary, #ffffff);
}

.icon-option:hover {
  border-color: var(--primary, #667eea);
  background: var(--bg-tertiary, #f7fafc);
}

.icon-option img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.icon-option .emoji {
  font-size: 20px;
}


</style>

<style scoped>
/* 切换开关样式 */
.form-label--row {
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.form-hint {
  font-size: 12px;
  color: var(--text-secondary, #718096);
  margin: 4px 0 0 0;
  line-height: 1.4;
}

.switch-toggle {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

.switch-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--bg-tertiary, #cbd5e0);
  border-radius: 22px;
  transition: 0.3s;
}

.switch-slider::before {
  content: "";
  position: absolute;
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: 0.3s;
}

.switch-toggle input:checked + .switch-slider {
  background-color: var(--color-primary, #667eea);
}

.switch-toggle input:checked + .switch-slider::before {
  transform: translateX(18px);
}

.thinking-options {
  margin-top: 12px;
  padding: 12px;
  border-radius: 10px;
  background: var(--form-input-bg, #F7F7F7);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.thinking-options-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
}

.thinking-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}

.thinking-check.disabled,
.switch-toggle.disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.thinking-check.disabled,
.thinking-check.disabled input,
.switch-toggle.disabled {
  cursor: not-allowed;
}

.thinking-check input {
  width: 15px;
  height: 15px;
  accent-color: var(--color-primary, #667eea);
  cursor: pointer;
}

.thinking-check-note {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary, #718096);
  white-space: nowrap;
}

.thinking-fixed-param {
  margin: 0;
  font-size: 13px;
  color: var(--text-primary);
}

.thinking-options-title code {
  margin-left: 6px;
  font-weight: 500;
}

.thinking-check code,
.thinking-options .form-hint code,
.thinking-options-title code,
.thinking-fixed-param code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.05);
}

.thinking-effort-slider {
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: none;
  -webkit-user-select: none;
}

.thinking-effort-slider.disabled {
  opacity: 0.65;
}

.thinking-effort-bar {
  position: relative;
  height: 28px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
  overflow: visible;
  cursor: grab;
  touch-action: none;
  outline: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
}

.thinking-effort-bar:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary, #667eea) 35%, transparent);
}

.thinking-effort-slider.is-dragging .thinking-effort-bar,
.thinking-effort-bar:active {
  cursor: grabbing;
}

.thinking-effort-slider.disabled .thinking-effort-bar {
  cursor: not-allowed;
}

.thinking-effort-fill {
  position: relative;
  height: 100%;
  min-width: 0;
  border-radius: 8px;
  background: #e8c57a;
  overflow: hidden;
  transition: background-color 180ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.thinking-effort-slider.is-max .thinking-effort-fill {
  background: #f5bc58;
}

.thinking-effort-matrix {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}

.thinking-effort-dots {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.thinking-effort-dot {
  position: absolute;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 28%, transparent);
  transform: translate(-50%, -50%);
  opacity: 1;
  transition: opacity 140ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.thinking-effort-dot.passed {
  opacity: 0;
}

.thinking-effort-thumb {
  position: absolute;
  top: 0;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.16);
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 3;
  transition: transform 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.thinking-effort-slider.is-dragging .thinking-effort-thumb {
  transform: translateX(-50%) scale(0.86);
}

.thinking-effort-labels {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

.thinking-effort-label {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  color: var(--text-secondary, #718096);
  font: inherit;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  cursor: pointer;
}

.thinking-effort-label:hover:not(:disabled) {
  color: var(--text-primary);
}

.thinking-effort-label.active {
  color: var(--text-primary);
  font-weight: 600;
}

.thinking-effort-label:disabled {
  cursor: not-allowed;
}

.model-config-panel > .dialog-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
}

.model-config-panel > .dialog-header .btn-back {
  justify-self: start;
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--platform-config-toggle-button-border, #e2e8f0);
  border-radius: 50%;
  background: var(--form-input-bg, #F7F7F7);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  color: #979797;
  transition:
    color 180ms cubic-bezier(0.2, 0.7, 0.2, 1),
    background-color 180ms cubic-bezier(0.2, 0.7, 0.2, 1),
    border-color 180ms cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow 180ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.model-config-panel > .dialog-header .btn-back:hover {
  color: var(--platform-config-dialog-title-text, #2d3748);
  background: var(--form-input-bg, #F7F7F7);
  border-color: var(--platform-config-toggle-button-hover-border, #cbd5e0);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.1);
}

.model-config-panel > .dialog-header .btn-back svg {
  width: 14px;
  height: 14px;
}

.model-config-panel > .dialog-header .dialog-title {
  justify-self: center;
  font-weight: 400;
}

.dialog-header-actions {
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.dialog-header-actions .btn-confirm,
.model-test-card {
  box-sizing: border-box;
  height: 32px;
  padding: 0 14px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.dialog-header-actions .btn-confirm {
  border: 1px solid color-mix(in srgb, #000 14%, #F8B62B);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
  transition:
    opacity 0.15s ease,
    border-color 180ms cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow 180ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.dialog-header-actions .btn-confirm:hover:not(:disabled) {
  opacity: 1;
  border-color: color-mix(in srgb, #000 22%, #F8B62B);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.12);
}

.model-test-card {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--platform-config-toggle-button-border, #e2e8f0);
  background: var(--form-input-bg, #F7F7F7);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  color: var(--text-primary, #2d3748);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  gap: 6px;
  cursor: pointer;
  transition:
    background-color 180ms cubic-bezier(0.2, 0.7, 0.2, 1),
    border-color 180ms cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow 180ms cubic-bezier(0.2, 0.7, 0.2, 1),
    color 180ms cubic-bezier(0.2, 0.7, 0.2, 1),
    transform 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.model-test-card:hover:not(:disabled) {
  border-color: var(--platform-config-toggle-button-hover-border, #cbd5e0);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.1);
}

.model-test-card:active:not(:disabled) {
  transform: scale(0.97);
  box-shadow: 0 1px 1px rgba(15, 23, 42, 0.05);
}

.model-test-card:disabled {
  cursor: default;
}

.model-test-card:disabled:not(.testing) {
  opacity: 0.5;
}

.model-test-card.testing {
  cursor: wait;
}

.model-test-card.success {
  color: var(--color-success, #34c759);
  background: color-mix(in srgb, var(--color-success, #34c759) 12%, var(--form-input-bg, #F7F7F7));
  border-color: color-mix(in srgb, var(--color-success, #34c759) 38%, transparent);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--color-success, #34c759) 18%, transparent);
}

.model-test-card.success:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-success, #34c759) 12%, var(--form-input-bg, #F7F7F7));
  border-color: color-mix(in srgb, var(--color-success, #34c759) 52%, transparent);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--color-success, #34c759) 22%, transparent);
}

.model-test-card.error {
  color: var(--color-error, #ff3b30);
  background: color-mix(in srgb, var(--color-error, #ff3b30) 12%, var(--form-input-bg, #F7F7F7));
  border-color: color-mix(in srgb, var(--color-error, #ff3b30) 38%, transparent);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--color-error, #ff3b30) 18%, transparent);
}

.model-test-card.error:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-error, #ff3b30) 12%, var(--form-input-bg, #F7F7F7));
  border-color: color-mix(in srgb, var(--color-error, #ff3b30) 52%, transparent);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--color-error, #ff3b30) 22%, transparent);
}

.model-test-title {
  line-height: 1;
  white-space: nowrap;
}

.model-test-spinner {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  border: 1.5px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: model-test-spin 700ms linear infinite;
}

.model-test-meta {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.8;
  white-space: nowrap;
}

@keyframes model-test-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .thinking-effort-fill {
    transition: none;
  }

  .thinking-effort-thumb {
    transition: none;
  }

  .model-test-card {
    transition: none;
  }

  .model-test-card:active:not(:disabled) {
    transform: none;
  }

  .model-test-spinner {
    animation: none;
    opacity: 0.55;
  }
}

</style>
