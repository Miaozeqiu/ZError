<template>
  <div class="model-settings-container">
    <!-- 左侧平台列表 -->
    <div class="platform-sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title-row">
          <h3 class="sidebar-title">AI 平台管理</h3>
          <button class="icon-action-btn icon-action-btn--ghost icon-action-btn--sm" @click="openModelConfigDocs" title="查看模型配置文档">
            <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M463.99957 784.352211c0 26.509985 21.490445 48.00043 48.00043 48.00043s48.00043-21.490445 48.00043-48.00043c0-26.509985-21.490445-48.00043-48.00043-48.00043S463.99957 757.842226 463.99957 784.352211z" fill="currentColor"></path>
              <path d="M512 960c-247.039484 0-448-200.960516-448-448S264.960516 64 512 64 960 264.960516 960 512 759.039484 960 512 960zM512 128.287273c-211.584464 0-383.712727 172.128262-383.712727 383.712727 0 211.551781 172.128262 383.712727 383.712727 383.712727 211.551781 0 383.712727-172.159226 383.712727-383.712727C895.712727 300.415536 723.551781 128.287273 512 128.287273z" fill="currentColor"></path>
              <path d="M512 673.695256c-17.664722 0-32.00086-14.336138-32.00086-31.99914l0-54.112297c0-52.352533 39.999785-92.352318 75.32751-127.647359 25.887273-25.919957 52.67249-52.67249 52.67249-74.016718 0-53.343368-43.07206-96.735385-95.99914-96.735385-53.823303 0-95.99914 41.535923-95.99914 94.559333 0 17.664722-14.336138 31.99914-32.00086 31.99914s-32.00086-14.336138-32.00086-31.99914c0-87.423948 71.775299-158.559333 160.00086-158.559333s160.00086 72.095256 160.00086 160.735385c0 47.904099-36.32028 84.191695-71.424378 119.295794-27.839699 27.776052-56.575622 56.511974-56.575622 82.3356l0 54.112297C544.00086 659.328155 529.664722 673.695256 512 673.695256z" fill="currentColor"></path>
            </svg>
          </button>
        </div>
        <div class="header-actions">
          <button class="icon-action-btn icon-action-btn--add icon-action-btn--sm" @click="showAddPlatformDialog = true" title="添加平台">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
              <path d="M544.256 480.256h307.2a32.256 32.256 0 0 1 0 64h-307.2v307.2a32.256 32.256 0 0 1-64 0v-307.2h-307.2a32.256 32.256 0 1 1 0-64h307.2v-307.2a32.256 32.256 0 1 1 64 0z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
      
      <div class="platform-list">
        <div 
          v-for="platform in modelConfig.platforms" 
          :key="platform.id"
          class="platform-item"
          :class="{ active: selectedPlatform?.id === platform.id }"
          @click="selectPlatform(platform)"
          @contextmenu="showPlatformMenu($event, platform)"
        >
          <div class="platform-icon">
            <div class="platform-icon-inner" :class="{ 'platform-icon--bg': needsIconBg(platform.icon) }">
              <!-- 如果是emoji，直接显示 -->
              <div
                v-if="platform.icon && isEmoji(platform.icon)"
                class="icon-emoji"
              >
                {{ platform.icon }}
              </div>
              <!-- 如果是图片URL，使用img标签 -->
              <img
                v-else-if="platform.icon && !isEmoji(platform.icon) && !iconLoadErrors[platform.id]"
                :src="platformIconUrls[platform.id]"
                :alt="platform.displayName"
                @error="handleIconError(platform.id)"
                class="icon-image"
              />
              <!-- 否则显示文字回退 -->
              <div
                v-else
                class="icon-fallback"
              >
                {{ getPlatformInitials(platform.displayName) }}
              </div>
            </div>
            <!-- 选中模型数量 badge -->
            <span
              v-if="getPlatformSelectedCount(platform) > 0 && selectedCategory === 'text'"
              class="platform-selected-badge platform-selected-badge--count"
            >{{ getPlatformSelectedCount(platform) }}</span>
            <span
              v-else-if="getPlatformSelectedCount(platform) > 0"
              class="platform-selected-badge"
            ></span>
          </div>
          <div class="platform-info">
            <h4 class="platform-name">{{ platform.displayName }}</h4>
          </div>
          <div class="platform-tags">
            <span v-if="isPlatformSelectedForCategory(platform, 'text')" class="platform-tag">文本</span>
            <span v-if="isPlatformSelectedForCategory(platform, 'vision')" class="platform-tag">视觉</span>
            <span v-if="isPlatformSelectedForCategory(platform, 'summary')" class="platform-tag">总结</span>
          </div>
          <!-- 启用开关已移至详情面板 -->
        </div>
      </div>
    </div>

    <!-- 右侧平台详情 -->
    <div class="platform-detail">
      <div v-if="selectedPlatform" class="detail-scroll-wrap" ref="detailScrollWrap">
        <div class="detail-content" ref="detailContent" @scroll="onDetailScroll">
        <!-- 平台基本信息 -->
        <div class="detail-section">
          <div class="section-header">
            <div class="platform-title-row">
              <h4 class="subsection-title">{{ selectedPlatform.displayName }}</h4>
              <button
                v-if="selectedPlatform.url"
                class="platform-link-btn"
                @click="openPlatformUrl(selectedPlatform.url)"
                title="打开平台官网"
              >
                <svg t="1745846730970" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="11" height="11">
                  <path d="M359.86136 0.00382a51.199909 51.199909 0 0 1 0 102.399818H153.599727a51.199909 51.199909 0 0 0-51.199909 51.199909V870.400273a51.199909 51.199909 0 0 0 51.199909 51.199909h716.796726a51.199909 51.199909 0 0 0 51.199909-51.199909V665.600637a51.199909 51.199909 0 0 1 102.399818 0v204.799636a153.599727 153.599727 0 0 1-153.599727 153.599727H153.599727A153.599727 153.599727 0 0 1 0 870.400273V153.603547A153.599727 153.599727 0 0 1 153.599727 0.00382h206.261633z m620.980897 0.584999h2.193996a29.256948 29.256948 0 0 1 5.119991 1.243998h0.730998a24.209957 24.209957 0 0 1 5.85199 2.559995 56.2469 56.2469 0 0 1 5.85099 3.071995l2.193996 1.315997a27.793951 27.793951 0 0 1 5.851989 5.412991l-0.731998-1.243998 0.731998 0.731999v0.511999l4.387993 4.168992 1.462997 2.193996a84.113851 84.113851 0 0 1 7.314987 13.969976v0.512999c0.730999 2.193996 0.730999 4.460992 1.461997 6.728988v2.119996a25.892954 25.892954 0 0 1 0.731999 7.314987v332.799408a51.199909 51.199909 0 0 1-102.399818 0V174.813509l-373.759336 373.393337a51.199909 51.199909 0 0 1-70.215875 1.900996l-2.193996-1.900996a52.149907 52.149907 0 0 1 0-72.411872l373.758336-373.392336H639.997863a51.199909 51.199909 0 0 1-51.199909-48.639914v-2.559995a51.199909 51.199909 0 0 1 51.199909-51.199909h332.798408a41.105927 41.105927 0 0 1 7.313987 0.584999h0.731999z m0 0" fill="currentColor"/>
                </svg>
              </button>
              <OlTip
                v-if="selectedPlatform.inviteUrl || selectedPlatform.inviteCode || selectedPlatform.inviteText"
                :text="selectedPlatform.inviteCode?.trim() ? '复制并跳转' : ''"
              >
                <button
                  class="platform-link-btn platform-invite-btn"
                  @click="handleInviteButtonClick(selectedPlatform)"
                  :aria-label="selectedPlatform.inviteCode?.trim() ? '复制并跳转' : (selectedPlatform.inviteText || '邀请链接')"
                >
                  <span class="invite-gift-wrap">
                    <!-- 盒身（下半部分） -->
                    <svg class="invite-gift-icon gift-body" t="1774416753013" viewBox="0 0 1132 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
                      <path d="M142.335165 475.823312h848.049308c6.557851 0 11.923365 5.365514 11.923365 11.923365V1012.076635c0 6.557851-5.365514 11.923365-11.923365 11.923365h-848.049308c-6.557851 0-11.923365-5.365514-11.923365-11.923365V487.746677c0-6.557851 5.365514-11.923365 11.923365-11.923365z" fill="#FF6174"/>
                      <path d="M491.83879 479.99649h149.042058v544.00351H491.83879z" fill="#FFB82C"/>
                      <path d="M491.83879 141.521977h149.042058V1024H491.83879z" fill="#FFCA3E"/>
                    </svg>
                    <!-- 盖子（上半部分） -->
                    <svg class="invite-gift-icon gift-lid" t="1774416753013" viewBox="0 0 1132 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
                      <path d="M17.885047 226.624992h1096.949544c9.836776 0 17.885047 8.048271 17.885047 17.885047v213.428226c0 9.836776-8.048271 17.885047-17.885047 17.885047H17.885047c-9.836776 0-17.885047-8.048271-17.885047-17.885047V244.510039c0-9.836776 8.048271-17.885047 17.885047-17.885047z" fill="#FF505D"/>
                      <path d="M258.438928 160.59936S128.474254 135.560294 102.540936 126.617771l45.904953 66.025631L65.578505 225.581697s193.903717 35.919136 402.860682 4.918388L367.835798 184.893215l-109.39687-24.293855zM351.888298 3.359989c-66.025632-11.774323-97.473506 11.178154-97.473506 11.178155l-18.034089 114.017174s46.650164-31.745958 101.944768-18.034089c71.987314 18.034089 162.008717 119.978856 162.008717 119.978856v-77.948996S441.313533 19.307489 351.888298 3.359989zM989.639263 192.643402l46.053996-66.025631c-25.933318 8.942523-155.897992 33.981589-155.897993 33.981589L770.398396 184.893215l-100.603389 45.755912c208.956965 31.000748 402.860682-5.06743 402.860682-5.06743L989.639263 192.643402zM901.704449 128.555318L883.819402 14.687186s-31.447874-22.952477-97.473506-11.178155C696.920662 19.456531 637.900007 152.700131 637.900007 152.700131v77.948996s89.872361-101.944767 161.859674-119.978856c55.145561-13.860911 101.944767 17.885047 101.944768 17.885047z" fill="#FFCA3E"/>
                      <path d="M387.211266 127.959149c-64.982337-37.558599-142.186123-24.890024-150.681521 0.745211-9.38965 28.168949 36.664346 58.126402 103.286146 93.002244 43.818365 22.952477 160.667338 8.942523 160.667339 8.942523s-48.289627-65.280421-113.271964-102.689978zM901.704449 128.555318c-8.495397-25.635234-85.699183-38.303809-150.681521-0.745211s-113.271964 102.689978-113.271963 102.689978 116.998015 14.009953 160.667338-8.942523c66.6218-34.726799 112.675796-64.833295 103.286146-93.002244z" fill="#FFB82C"/>
                    </svg>
                  </span>
                  <span v-if="selectedPlatform.inviteText" class="invite-text">{{ selectedPlatform.inviteText }}</span>
                </button>
              </OlTip>
            </div>
            <Toggle
              v-model="selectedPlatform.enabled"
              variant="platform"
              size="medium"
              @change="updatePlatformEnabled"
            />
          </div>
        </div>

        <!-- API Key 配置 -->
        <div class="detail-section">
          <h4 class="subsection-title">API 配置</h4>
          <div class="form-group">
            <label class="form-label">API Key</label>
            <div class="input-group">
              <div class="input-with-suffix">
                <input 
                  :type="showApiKey ? 'text' : 'password'"
                  v-model="selectedPlatform.apiKey"
                  @input="updatePlatformApiKey"
                  class="form-input api-key-input"
                  placeholder="请输入API Key"
                >
                <button 
                  class="input-suffix-btn"
                  @click="toggleApiKeyVisibility"
                >
                  <svg 
                    v-if="!showApiKey"
                    t="1761195836172" 
                    class="icon" 
                    viewBox="0 0 1024 1024" 
                    version="1.1" 
                    xmlns="http://www.w3.org/2000/svg" 
                    p-id="1305" 
                    width="16" 
                    height="16"
                  >
                    <path d="M512 217.7792c258.0992 0 410.752 223.0784 453.504 295.5008C922.88 585.344 770.9696 806.2464 512 806.2464c-291.5072 0-420.9152-220.8-454.8352-291.4304C99.1488 444.9024 255.2832 217.7792 512 217.7792M512 166.5792c-338.3296 0-512 345.3696-512 345.3696s131.072 345.4976 512 345.4976c344.9856 0 512-344.1408 512-344.1408S855.6544 166.5792 512 166.5792L512 166.5792zM512.0256 396.1856c67.0208 0 115.6864 48.6912 115.6864 115.8144 0 67.1744-48.64 115.8656-115.6864 115.8656-67.0464 0-115.7376-48.6912-115.7376-115.8656C396.288 444.8768 444.9792 396.1856 512.0256 396.1856M512.0256 344.9856c-96.896 0-166.9376 73.0624-166.9376 167.0144 0 94.0032 70.016 167.0656 166.9376 167.0656 96.8704 0 166.8864-73.0624 166.8864-167.0656C678.912 418.0224 608.896 344.9856 512.0256 344.9856L512.0256 344.9856z" fill="currentColor" p-id="1306"></path>
                  </svg>
                  <svg 
                    v-else
                    t="1761195878569" 
                    class="icon" 
                    viewBox="0 0 1024 1024" 
                    version="1.1" 
                    xmlns="http://www.w3.org/2000/svg" 
                    p-id="1455" 
                    width="16" 
                    height="16"
                  >
                    <path d="M962.41027 511.792269 905.058051 443.432345c30.108738-36.255739 55.207369-77.30362 74.140581-122.626875 6.777357-16.22759-0.870834-34.859949-17.098423-41.637306-16.290011-6.797823-34.859949 0.8913-41.637306 17.098423C853.249081 457.180464 696.791703 557.13906 512.148379 557.13906c-186.156794 0-342.67557-100.186793-408.499741-261.452687-6.632047-16.290011-25.181519-24.124444-41.491996-17.450441-16.290011 6.632047-24.103978 25.222451-17.450441 41.49302 19.34765 47.403636 46.134737 90.343611 78.658478 128.121006l-53.6632 63.942311c-11.295254 13.45136-9.534144 33.533744 3.937682 44.850487 5.948479 4.994758 13.223163 7.440459 20.435425 7.440459 9.077749 0 18.114566-3.875261 24.415063-11.378142l49.720402-59.244312c34.487465 30.608112 73.528644 56.220443 115.855658 76.374458l-30.384008 83.471087c-6.031367 16.518209 2.486634 34.777061 19.026332 40.787962 3.585665 1.305739 7.254218 1.927909 10.880815 1.927909 12.994965 0 25.201985-8.020674 29.907147-20.953218l29.694299-81.572854c43.456744 14.417361 89.441055 23.432689 137.125077 26.191522l0 96.624664c0 17.575284 14.258749 31.834033 31.834033 31.834033 17.575284 0 31.834033-14.258749 31.834033-31.834033l0-96.589872c50.570769-2.822278 98.975199-12.387122 144.327106-27.960819l30.326702 83.307358c4.705162 12.932544 16.912182 20.953218 29.907147 20.953218 3.626597 0 7.29515-0.62217 10.880815-1.927909 16.538675-6.009877 25.056676-24.269753 19.026332-40.787962l-31.321356-86.041632c41.663912-20.509103 79.855746-46.515407 113.648386-77.547167l52.844555 62.987566c6.300496 7.502881 15.315824 11.378142 24.415063 11.378142 7.212262 0 14.46648-2.445702 20.435425-7.440459C971.944414 545.326013 973.705524 525.263072 962.41027 511.792269z" fill="currentColor" p-id="1456"></path>
                  </svg>
                </button>
              </div>
            </div>
            <div class="form-tip">
              <a 
                href="https://docs.zerror.cc/docs/get-apiKey" 
                target="_blank" 
                rel="noopener noreferrer" 
                class="api-doc-link"
              >
                如何获取Api Key?
              </a>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Base URL</label>
            <input 
              type="text" 
              v-model="selectedPlatform.baseUrl"
              @input="updatePlatformBaseUrl"
              class="form-input"
              placeholder="API 基础地址"
            >
          </div>
        </div>

        <!-- 模型管理 -->
        <div class="detail-section">
          <div class="section-header">
            <h4 class="subsection-title">模型管理</h4>
            <div class="header-actions">
              <!-- 模型分类筛选 -->
              <ModelCategorySwitch v-model="selectedCategory" />
              <!-- 添加模型按钮 -->
              <button class="icon-action-btn icon-action-btn--add icon-action-btn--model-add" @click="openQuickAdd" title="添加模型">
                <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
                  <path d="M544.256 480.256h307.2a32.256 32.256 0 0 1 0 64h-307.2v307.2a32.256 32.256 0 0 1-64 0v-307.2h-307.2a32.256 32.256 0 1 1 0-64h307.2v-307.2a32.256 32.256 0 1 1 64 0z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>
          
          <div v-if="selectedCategory !== 'vision'" class="model-list-hint">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
            <template v-if="selectedCategory === 'text'">可多选，最多 5 个（已选 {{ currentMultiModels.length }}/5）</template>
            <template v-else-if="selectedCategory === 'summary'">只能选择 1 个（已选 {{ currentMultiModels.length }}/1）</template>
          </div>
          <div class="model-list">
            <div 
              v-for="model in filteredModels" 
              :key="model.id"
              :data-model-id="model.id"
              class="model-item"
              :class="{ 
                active: selectedCategory === 'vision' 
                  ? (currentVisionModel?.id === model.id)
                  : (selectedCategory === 'summary' ? isSummaryModelSelected(model.id) : isTextModelSelected(model.id)),
                'model-item--disabled': isSelectedPlatformDisabled
              }"
              @click="selectModel(model)"
              @contextmenu.prevent="showModelContextMenuHandler($event, model)"
            >
              <div class="model-icon-wrap">
                <img v-if="getModelIcon(model)" :src="getModelIcon(model)" :alt="model.displayName" class="model-icon-img" />
                <div v-else class="model-icon-fallback">{{ (model.displayName || model.name).charAt(0).toUpperCase() }}</div>
              </div>
              <div class="model-info">
                <div class="model-header">
                  <h5 class="model-name">{{ model.displayName }}</h5>
                 
                </div>
                
              </div>
              <div class="model-actions">
                <div 
                  v-if="selectedCategory === 'vision' ? (currentVisionModel && currentVisionModel.id === model.id) : (selectedCategory === 'summary' ? isSummaryModelSelected(model.id) : isTextModelSelected(model.id))" 
                  :class="selectedCategory !== 'vision' ? 'model-selected model-selected--multi' : 'model-selected'"
                >
                  <span class="model-dot"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
        <!-- 自定义滚动条 -->
        <div class="custom-scrollbar" :class="{ 'is-visible': scrollbarVisible }" ref="customScrollbar" @mousedown="onScrollbarMousedown">
          <div class="custom-scrollbar-thumb" ref="customScrollbarThumb"></div>
        </div>
      </div>

      <div v-if="!selectedPlatform" class="empty-state">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          </svg>
        </div>
        <h3>选择一个AI平台</h3>
        <p>从左侧列表中选择一个平台来查看和编辑其配置</p>
      </div>
    </div>

    <!-- 平台配置对话框 -->
    <PlatformConfigDialog 
      :show="showAddPlatformDialog || showEditPlatformDialog"
      :platform="editingPlatform"
      @close="closePlatformDialog"
      @save="savePlatform"
    />

    <!-- 模型配置对话框 -->
    <ModelConfigDialog 
      :show="showModelConfigDialog"
      :model="editingModel"
      :start-in-marketplace="!editingModel"
      @close="closeModelDialog"
      @save="saveModel"
    />

    <!-- 平台右键菜单 -->
    <PlatformContextMenu
      :visible="showPlatformContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :platform="contextMenuPlatform"
      @edit-platform="handleEditPlatform"
      @duplicate-platform="handleDuplicatePlatform"
      @delete-platform="handleDeletePlatform"
    />

    <!-- 模型右键菜单 -->
    <ModelContextMenu
      :visible="showModelContextMenu"
      :x="modelContextMenuX"
      :y="modelContextMenuY"
      :model="contextMenuModel"
      @edit-model="handleEditModel"
      @test-model="handleTestModel"
      @delete-model="handleDeleteModel"
    />

    <!-- 测试弹窗 -->
    <ModelTestDialog
      :visible="showTestDialog"
      :model-name="testDialogModelName"
      :testing="testingModelId !== null"
      :test-result="currentTestResult"
      :test-error="currentTestError"
      :streaming-response="streamingResponse"
      :streaming-reasoning="streamingReasoning"
      @close="handleCloseTestDialog"
      @cancel-test="handleCancelTest"
    />

    <!-- Markdown 演示弹窗 -->
    <MarkdownDemoDialog
      :visible="showMarkdownDemo"
      @close="showMarkdownDemo = false"
    />

    <!-- 删除模型确认弹窗 -->
    <ModelDeleteConfirmDialog
      :visible="showDeleteModelDialog"
      :model-name="deleteModelName"
      @confirm="confirmDeleteModel"
      @cancel="cancelDeleteModel"
    />

    <!-- 删除平台确认弹窗 -->
    <PlatformDeleteConfirmDialog
      :visible="showDeletePlatformDialog"
      :platform-name="deletePlatformName"
      @confirm="confirmDeletePlatform"
      @cancel="cancelDeletePlatform"
    />
  </div>

  <!-- 快速添加模型弹窗 -->
  <ModelQuickAddDialog 
    :show="showQuickAddDialog"
    @close="showQuickAddDialog = false"
    @save="handleQuickAddSave"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { useModelConfig, fetchRemoteModelsCatalog } from '../../services/modelConfig'
import type { AIPlatform, AIModel, RemoteModelIconMapping } from '../../services/modelConfig'
import { environmentDetector } from '../../services/environmentDetector'
import { getPlatformIconDisplayUrl, resolvePlatformIconUrl } from '../../services/iconCache'
import PlatformConfigDialog from '../PlatformConfigDialog.vue'
import ModelConfigDialog from '../ModelConfigDialog.vue'
import PlatformContextMenu from '../PlatformContextMenu.vue'
import ModelContextMenu from '../ModelContextMenu.vue'
import ModelTestDialog from '../ModelTestDialog.vue'
import MarkdownDemoDialog from '../MarkdownDemoDialog.vue'
import ModelDeleteConfirmDialog from '../ModelDeleteConfirmDialog.vue'
import PlatformDeleteConfirmDialog from '../PlatformDeleteConfirmDialog.vue'
import Toggle from '../Toggle.vue'
import ModelCategorySwitch from '../ModelCategorySwitch.vue'
import ModelQuickAddDialog from '../ModelQuickAddDialog.vue'
import OlTip from './OlTip.vue'

const detailScrollWrap = ref<HTMLElement | null>(null)
const detailContent = ref<HTMLElement | null>(null)
const customScrollbar = ref<HTMLElement | null>(null)
const customScrollbarThumb = ref<HTMLElement | null>(null)

let isDraggingScrollbar = false
let dragStartY = 0
let dragStartScrollTop = 0
let scrollHideTimer: ReturnType<typeof setTimeout> | null = null
const scrollbarVisible = ref(false)

const showScrollbar = () => {
  scrollbarVisible.value = true
  if (scrollHideTimer) clearTimeout(scrollHideTimer)
  scrollHideTimer = setTimeout(() => {
    scrollbarVisible.value = false
  }, 1500)
}

const updateScrollbarThumb = () => {
  const content = detailContent.value
  const thumb = customScrollbarThumb.value
  const bar = customScrollbar.value
  if (!content || !thumb || !bar) return

  const ratio = content.clientHeight / content.scrollHeight
  if (ratio >= 1) return

  const thumbHeight = Math.max(ratio * bar.clientHeight, 32)
  const thumbTop = (content.scrollTop / (content.scrollHeight - content.clientHeight)) * (bar.clientHeight - thumbHeight)
  thumb.style.height = `${thumbHeight}px`
  thumb.style.transform = `translateY(${thumbTop}px)`
}

const onDetailScroll = () => {
  updateScrollbarThumb()
  showScrollbar()
}

const onScrollbarMousedown = (e: MouseEvent) => {
  const thumb = customScrollbarThumb.value
  const content = detailContent.value
  const bar = customScrollbar.value
  if (!thumb || !content || !bar) return

  isDraggingScrollbar = true
  dragStartY = e.clientY
  dragStartScrollTop = content.scrollTop

  const onMousemove = (e: MouseEvent) => {
    if (!isDraggingScrollbar) return
    const thumbHeight = thumb.clientHeight
    const barHeight = bar.clientHeight
    const delta = e.clientY - dragStartY
    const scrollRatio = delta / (barHeight - thumbHeight)
    content.scrollTop = dragStartScrollTop + scrollRatio * (content.scrollHeight - content.clientHeight)
  }

  const onMouseup = () => {
    isDraggingScrollbar = false
    document.removeEventListener('mousemove', onMousemove)
    document.removeEventListener('mouseup', onMouseup)
  }

  document.addEventListener('mousemove', onMousemove)
  document.addEventListener('mouseup', onMouseup)
  e.preventDefault()
}
const {
  settings: modelConfig,
  addPlatform,
  updatePlatform,
  removePlatform,
  addModelToPlatform,
  updateModel,
  removeModel,
  setSelectedModel: setCurrentModel,
  setSelectedTextModel,
  setSelectedVisionModel,
  toggleSelectedTextModel,
  toggleSelectedSummaryModel,
  isTextModelSelected,
  isSummaryModelSelected,
  selectedModel: globalSelectedModel,
  selectedTextModel: globalSelectedTextModel,
  selectedTextModels: globalSelectedTextModels,
  selectedSummaryModel: globalSelectedSummaryModel,
  selectedSummaryModels: globalSelectedSummaryModels,
  selectedVisionModel: globalSelectedVisionModel,
} = useModelConfig()

// 对话框状态
const showAddPlatformDialog = ref(false)
const showEditPlatformDialog = ref(false)
const editingPlatform = ref<AIPlatform | null>(null)

// 模型配置对话框状态
const showModelConfigDialog = ref(false)
const editingModel = ref<AIModel | null>(null)

// 模型设置相关状态
const selectedPlatform = ref<AIPlatform | null>(null)
const selectedModel = ref<AIModel | null>(null)
const currentVisionModel = ref<AIModel | null>(null)
const showApiKey = ref(false)

// 选中列表（根据当前分类动态切换）
const currentMultiModels = computed(() => {
  if (selectedCategory.value === 'text') return globalSelectedTextModels.value
  if (selectedCategory.value === 'summary') return globalSelectedSummaryModels.value
  return []
})

// 计算某平台下被选中的模型数量（用于 badge）
const getPlatformSelectedCount = (platform: AIPlatform): number => {
  if (selectedCategory.value === 'vision') {
    return globalSelectedVisionModel.value?.platformId === platform.id ? 1 : 0
  }
  const ids = currentMultiModels.value.map(m => m.id)
  return platform.models.filter(m => (m.category === 'text' || m.category === 'summary') && ids.includes(m.id)).length
}

// 模型分类筛选状态
const selectedCategory = ref<'summary' | 'text' | 'vision'>('text')

// 检查平台是否有模型被选中（针对特定分类）
const isPlatformSelectedForCategory = (platform: AIPlatform, category: 'summary' | 'text' | 'vision') => {
  if (category === 'text') {
    return globalSelectedTextModels.value.some(m => m.platformId === platform.id)
  }
  if (category === 'summary') {
    return globalSelectedSummaryModels.value.some(m => m.platformId === platform.id)
  }
  if (category === 'vision') {
    return globalSelectedVisionModel.value?.platformId === platform.id
  }
  return false
}

// 计算属性：根据分类筛选模型
const filteredModels = computed(() => {
  if (!selectedPlatform.value) return []
  
  const models = selectedPlatform.value.models || []
  
  // 'summary' 和 'text' 都显示文本模型
  if (selectedCategory.value === 'summary' || selectedCategory.value === 'text') {
    return models.filter(model => model.category === 'text')
  }
  
  return models.filter(model => model.category === 'vision')
})

const isSelectedPlatformDisabled = computed(() => selectedPlatform.value?.enabled === false)

// 计算属性：当前选中的模型（根据分类，文本分类返回第一个选中模型用于兼容）
const currentModel = computed(() => {
  if (selectedCategory.value === 'text') {
    return globalSelectedTextModel.value
  } else if (selectedCategory.value === 'summary') {
    return globalSelectedSummaryModel.value
  } else {
    return currentVisionModel.value
  }
})
const testingModelId = ref<string | null>(null)
const testResults = ref<{[key: string]: any}>({})
const testErrors = ref<{[key: string]: string}>({})
const testAbortController = ref<AbortController | null>(null)

// 测试弹窗状态
const showTestDialog = ref(false)
const testDialogModelName = ref('')
const currentTestResult = ref<any>(null)
const currentTestError = ref('')
const streamingResponse = ref('')
const streamingReasoning = ref('')

const showMarkdownDemo = ref(false)

const extractNumericTokenValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const readTokenRateFromPayload = (payload: any): number | null => {
  if (!payload || typeof payload !== 'object') return null
  const candidates = [
    payload.tokenRate,
    payload.token_rate,
    payload.tokensPerSecond,
    payload.tokens_per_second,
    payload.averageTokensPerSecond,
    payload.average_tokens_per_second,
    payload.generationSpeed,
    payload.generation_speed,
    payload.usage?.tokenRate,
    payload.usage?.token_rate,
    payload.usage?.tokensPerSecond,
    payload.usage?.tokens_per_second,
    payload.usage?.averageTokensPerSecond,
    payload.usage?.average_tokens_per_second
  ]

  for (const candidate of candidates) {
    const normalized = extractNumericTokenValue(candidate)
    if (normalized !== null) return normalized
  }

  return null
}

const readOutputTokenCountFromPayload = (payload: any): number | null => {
  if (!payload || typeof payload !== 'object') return null
  const candidates = [
    payload.outputTokens,
    payload.output_tokens,
    payload.completionTokens,
    payload.completion_tokens,
    payload.generatedTokens,
    payload.generated_tokens,
    payload.usage?.outputTokens,
    payload.usage?.output_tokens,
    payload.usage?.completionTokens,
    payload.usage?.completion_tokens,
    payload.usage?.generatedTokens,
    payload.usage?.generated_tokens,
    payload.usage?.totalTokens,
    payload.usage?.total_tokens
  ]

  for (const candidate of candidates) {
    const normalized = extractNumericTokenValue(candidate)
    if (normalized !== null) return normalized
  }

  return null
}

const estimateTextTokens = (text: string): number => {
  const normalized = text.trim()
  if (!normalized) return 0

  const cjkCount = (normalized.match(/[\u3400-\u9fff]/g) || []).length
  const wordCount = (normalized.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length
  const numberCount = (normalized.match(/\d+(?:\.\d+)?/g) || []).length
  const symbolCount = (normalized.match(/[^\sA-Za-z0-9\u3400-\u9fff]/g) || []).length

  return Math.max(1, Math.round(cjkCount + wordCount * 1.3 + numberCount + symbolCount * 0.3))
}

const resolveTokenRate = (payload: any, response: string, reasoning = '', durationMs = 0): number | null => {
  const explicitRate = readTokenRateFromPayload(payload)
  if (explicitRate !== null) return Number(explicitRate.toFixed(1))

  const elapsedSeconds = durationMs > 0 ? durationMs / 1000 : 0
  if (elapsedSeconds <= 0) return null

  const explicitOutputTokens = readOutputTokenCountFromPayload(payload)
  const estimatedOutputTokens = estimateTextTokens(`${reasoning}\n${response}`.trim())
  const outputTokens = explicitOutputTokens ?? estimatedOutputTokens

  if (!outputTokens) return null
  return Number((outputTokens / elapsedSeconds).toFixed(1))
}

const hasVisibleOutputContent = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  return value.replace(/```[\s\S]*?```/g, '').trim().length > 0
}

// 删除模型弹窗状态
const showDeleteModelDialog = ref(false)
const deleteModelName = ref('')
const deleteModelId = ref('')

// 删除平台弹窗状态
const showDeletePlatformDialog = ref(false)
const deletePlatformName = ref('')
const deletePlatformId = ref('')

// 图标加载错误状态
const iconLoadErrors = ref<{[key: string]: boolean}>({})
const platformIconUrls = ref<Record<string, string>>({})
const remoteModelIconMappings = ref<RemoteModelIconMapping[]>([])
const PROD_REMOTE_MODEL_ICON_BASE_URL = 'https://app.zerror.cc/models/'
const DEV_REMOTE_MODEL_ICON_BASE_URL = 'http://localhost:5175/models/'

const getRemoteModelIconBaseUrl = (): string => {
  const isTauriDev = import.meta.env.DEV && typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)
  return isTauriDev ? DEV_REMOTE_MODEL_ICON_BASE_URL : PROD_REMOTE_MODEL_ICON_BASE_URL
}

const resolveModelIconUrl = (icon?: string): string => {
  if (!icon) return ''
  if (/^data:/i.test(icon)) return icon
  if (/^https?:\/\//i.test(icon)) return icon

  const normalizedIcon = icon
    .trim()
    .replace(/^\/+/, '')
    .replace(/^assets\/images\/models\//i, '')
    .replace(/^models\//i, '')

  if (!normalizedIcon) return ''
  return new URL(normalizedIcon, getRemoteModelIconBaseUrl()).toString()
}

const loadRemoteModelIconMappings = async () => {
  try {
    const catalog = await fetchRemoteModelsCatalog()
    remoteModelIconMappings.value = catalog.modelIconMappings || []
  } catch (error) {
    console.warn('加载远程模型图标映射失败:', error)
    remoteModelIconMappings.value = []
  }
}

// 预加载平台图标
const loadPlatformIcons = async () => {
  for (const platform of modelConfig.platforms) {
    if (platform.icon && platform.icon.includes('.')) {
      try {
        platformIconUrls.value[platform.id] = await getPlatformIconUrl(platform.icon)
      } catch (error) {
        console.error(`Failed to load icon for platform ${platform.id}:`, error)
      }
    }
  }
}

// 右键菜单状态
const showPlatformContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuPlatform = ref<AIPlatform | null>(null)

// 模型右键菜单状态
const showModelContextMenu = ref(false)
const modelContextMenuX = ref(0)
const modelContextMenuY = ref(0)
const contextMenuModel = ref<AIModel | null>(null)

// 平台管理方法
const editPlatform = (platform: AIPlatform) => {
  editingPlatform.value = { ...platform }
  showEditPlatformDialog.value = true
}

const deletePlatform = async (platformId: string) => {
  await removePlatform(platformId)
}

// 确认删除平台
const confirmDeletePlatform = async () => {
  if (deletePlatformId.value) {
    await deletePlatform(deletePlatformId.value)
  }
  showDeletePlatformDialog.value = false
  deletePlatformName.value = ''
  deletePlatformId.value = ''
}

// 取消删除平台
const cancelDeletePlatform = () => {
  showDeletePlatformDialog.value = false
  deletePlatformName.value = ''
  deletePlatformId.value = ''
}

const closePlatformDialog = () => {
  showAddPlatformDialog.value = false
  showEditPlatformDialog.value = false
  editingPlatform.value = null
}

const savePlatform = async (platformData: Omit<AIPlatform, 'id' | 'isBuiltIn'>) => {
  try {
    if (editingPlatform.value) {
      // 编辑现有平台
      await updatePlatform(editingPlatform.value.id, platformData)
      
      // 如果图标发生了变化，清除缓存并重新加载
      if (platformData.icon !== editingPlatform.value.icon) {
        // 清除旧的图标缓存
        delete platformIconUrls.value[editingPlatform.value.id]
        delete iconLoadErrors.value[editingPlatform.value.id]
        
        // 重新加载该平台的图标
        if (platformData.icon && platformData.icon.includes('.')) {
          try {
            platformIconUrls.value[editingPlatform.value.id] = await getPlatformIconUrl(platformData.icon)
          } catch (error) {
            console.error(`Failed to load updated icon for platform ${editingPlatform.value.id}:`, error)
            iconLoadErrors.value[editingPlatform.value.id] = true
          }
        }
      }
    } else {
      // 添加新平台
      const newPlatformId = await addPlatform(platformData)
      
      // 为新平台加载图标
      if (platformData.icon && platformData.icon.includes('.')) {
        try {
          platformIconUrls.value[newPlatformId] = await getPlatformIconUrl(platformData.icon)
        } catch (error) {
          console.error(`Failed to load icon for new platform ${newPlatformId}:`, error)
          iconLoadErrors.value[newPlatformId] = true
        }
      }
    }
    closePlatformDialog()
  } catch (error) {
    console.error('保存平台配置失败:', error)
    alert('保存失败，请检查配置信息')
  }
}

// 模型设置相关方法
const selectPlatform = (platform: AIPlatform) => {
  selectedPlatform.value = platform
  selectedModel.value = null
}

const revealModelInList = async (platformId: string, modelId: string, category: AIModel['category']) => {
  const latestPlatform = modelConfig.platforms.find(platform => platform.id === platformId)
  if (latestPlatform) {
    selectedPlatform.value = latestPlatform
    selectedModel.value = latestPlatform.models.find(model => model.id === modelId) || null
  }

  selectedCategory.value = category === 'vision' ? 'vision' : (category === 'summary' ? 'summary' : 'text')

  await nextTick()
  updateScrollbarThumb()

  const modelElements = Array.from(detailContent.value?.querySelectorAll('.model-item[data-model-id]') || []) as HTMLElement[]
  const targetElement = modelElements.find(element => element.dataset.modelId === modelId)
  targetElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

const selectModel = (model: AIModel) => {
  if (isSelectedPlatformDisabled.value) {
    return
  }

  if (selectedCategory.value === 'text') {
    toggleSelectedTextModel(model.id)
  } else if (selectedCategory.value === 'summary') {
    toggleSelectedSummaryModel(model.id)
  } else if (selectedCategory.value === 'vision') {
    currentVisionModel.value = model
    setSelectedVisionModel(model.id)
  }
}

// 图标相关方法
const getPlatformIconUrl = async (icon: string) => {
  console.log('🔍 [DEBUG] getPlatformIconUrl called with icon:', icon)

  const displayUrl = getPlatformIconDisplayUrl(icon)
  if (!displayUrl) {
    console.log('📝 [DEBUG] Icon is not a file, returning empty string for:', icon)
    return ''
  }

  console.log('✅ [DEBUG] Using provider path:', displayUrl)

  try {
    return await resolvePlatformIconUrl(icon)
  } catch (error) {
    console.warn('⚠️ [DEBUG] Resolve provider icon failed, fallback to display URL:', icon, error)
    return displayUrl
  }
}

const getPlatformInitials = (name: string) => {
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .join('')
    .substring(0, 2)
}

// 判断是否为emoji
const isEmoji = (str: string) => {
  if (!str) return false
  
  // 简单的emoji检测：检查是否包含emoji字符
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
  
  // 或者检查是否是单个字符且不包含文件扩展名或URL特征
  const isSingleChar = str.length <= 4 && !str.includes('.') && !str.includes('/') && !str.includes('http')
  
  return emojiRegex.test(str) || isSingleChar
}

const handleIconError = (platformId: string) => {
  iconLoadErrors.value[platformId] = true
}

// 判断图标是否需要背景（svg/png/emoji 需要，jpg/webp 等不需要）
const needsIconBg = (icon?: string): boolean => {
  if (!icon) return true  // 无图标（文字回退）加背景
  if (isEmoji(icon)) return true
  const lower = icon.toLowerCase()
  return lower.endsWith('.svg') || lower.endsWith('.png')
}

const getModelIcon = (model: AIModel): string => {
  if (model.icon) {
    return resolveModelIconUrl(model.icon)
  }

  const searchStr = `${model.displayName || ''} ${model.name || ''}`.toLowerCase()
  const matchedMapping = remoteModelIconMappings.value.find(mapping =>
    mapping.models.some(keyword => searchStr.includes(keyword.toLowerCase()))
  )

  return resolveModelIconUrl(matchedMapping?.icon)
}


const showPlatformMenu = (event: MouseEvent, platform: AIPlatform) => {
  event.preventDefault()
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuPlatform.value = platform
  showPlatformContextMenu.value = true
}

const hidePlatformMenu = () => {
  showPlatformContextMenu.value = false
  contextMenuPlatform.value = null
}

const showModelContextMenuHandler = (event: MouseEvent, model: AIModel) => {
  event.preventDefault()
  modelContextMenuX.value = event.clientX
  modelContextMenuY.value = event.clientY
  contextMenuModel.value = model
  showModelContextMenu.value = true
}

const hideModelMenu = () => {
  showModelContextMenu.value = false
  contextMenuModel.value = null
}

const handleEditPlatform = () => {
  if (contextMenuPlatform.value && !contextMenuPlatform.value.isRemote) {
    editPlatform(contextMenuPlatform.value)
  }
  hidePlatformMenu()
}

const handleDuplicatePlatform = async () => {
  if (contextMenuPlatform.value) {
    // 复制模型列表并生成新 ID
    const newModels = (contextMenuPlatform.value.models || []).map(m => ({
      ...m,
      id: `${m.name}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      isRemote: false
    }))

    const duplicatedPlatform = {
      ...contextMenuPlatform.value,
      displayName: `${contextMenuPlatform.value.displayName} (副本)`,
      id: undefined,
      isBuiltIn: false,
      isRemote: false,
      models: newModels
    }
    // @ts-ignore
    delete duplicatedPlatform.id
    await addPlatform(duplicatedPlatform)
  }
  hidePlatformMenu()
}

const handleDeletePlatform = async () => {
  if (contextMenuPlatform.value && !contextMenuPlatform.value.isRemote) {
    deletePlatformName.value = contextMenuPlatform.value.name
    deletePlatformId.value = contextMenuPlatform.value.id
    showDeletePlatformDialog.value = true
  }
  hidePlatformMenu()
}

const handleEditModel = () => {
  if (contextMenuModel.value && !contextMenuModel.value.isRemote) {
    editModel(contextMenuModel.value)
  }
  hideModelMenu()
}

const handleTestModel = async () => {
  if (contextMenuModel.value) {
    await testModel(contextMenuModel.value)
  }
  hideModelMenu()
}

const handleDeleteModel = async () => {
  if (contextMenuModel.value && !contextMenuModel.value.isRemote) {
    deleteModelName.value = contextMenuModel.value.displayName || contextMenuModel.value.name
    deleteModelId.value = contextMenuModel.value.id
    showDeleteModelDialog.value = true
  }
  hideModelMenu()
}

const toggleApiKeyVisibility = () => {
  showApiKey.value = !showApiKey.value
}

const updatePlatformApiKey = async () => {
  if (selectedPlatform.value) {
    try {
      await updatePlatform(selectedPlatform.value.id, {
        apiKey: selectedPlatform.value.apiKey
      })
    } catch (error) {
      console.error('更新API Key失败:', error)
    }
  }
}

const updatePlatformEnabled = async () => {
  if (selectedPlatform.value) {
    try {
      await updatePlatform(selectedPlatform.value.id, {
        enabled: selectedPlatform.value.enabled
      })
    } catch (error) {
      console.error('更新平台启用状态失败:', error)
    }
  }
}

const updatePlatformBaseUrl = async () => {
  if (selectedPlatform.value) {
    try {
      await updatePlatform(selectedPlatform.value.id, {
        baseUrl: selectedPlatform.value.baseUrl
      })
    } catch (error) {
      console.error('更新Base URL失败:', error)
    }
  }
}

// -------- 添加模型下拉 --------
const showAddModelDropdown = ref(false)
const addModelDropdownRef = ref<HTMLElement | null>(null)

const openAddModelDropdown = () => {
  showAddModelDropdown.value = !showAddModelDropdown.value
}

const closeAddModelDropdown = () => {
  showAddModelDropdown.value = false
}

const openTemplate = () => {
  closeAddModelDropdown()
  addNewModel()
}

// -------- 快速添加（OpenAI 兼容）--------
const showQuickAddDialog = ref(false)

const openQuickAdd = () => {
  closeAddModelDropdown()
  showQuickAddDialog.value = true
}

const handleQuickAddSave = async (newModel: any) => {
  if (!selectedPlatform.value) return

  const platformId = selectedPlatform.value.id
  const modelId = await addModelToPlatform(platformId, newModel)

  showQuickAddDialog.value = false
  await revealModelInList(platformId, modelId, newModel.category || 'text')
}


// 点击外部关闭下拉
const handleAddModelOutsideClick = (e: MouseEvent) => {
  if (addModelDropdownRef.value && !addModelDropdownRef.value.contains(e.target as Node)) {
    closeAddModelDropdown()
  }
}

const addNewModel = () => {
  if (selectedPlatform.value) {
    editingModel.value = null
    showModelConfigDialog.value = true
  }
}

const editModel = (model: AIModel) => {
  editingModel.value = { ...model }
  showModelConfigDialog.value = true
}

const closeModelDialog = () => {
  showModelConfigDialog.value = false
  editingModel.value = null
}

const saveModel = async (modelData: Partial<AIModel>) => {
  if (!selectedPlatform.value) return

  try {
    const platformId = selectedPlatform.value.id
    let newModelId: string | null = null
    let newModelCategory: AIModel['category'] | null = null

    if (editingModel.value) {
      // 使用 ModelConfigManager 的 updateModel 以确保正确保存
      await updateModel(editingModel.value.id, {
        displayName: modelData.displayName,
        jsCode: modelData.jsCode,
        category: modelData.category
      })
    } else {
      // 使用 addModelToPlatform 自动生成 ID 并保存
      const newModelData = {
        name: modelData.displayName || '新模型',
        displayName: modelData.displayName || '新模型',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 1.0,
        enabled: true,
        jsCode: modelData.jsCode || '',
        category: modelData.category || 'text' as const
      }
      newModelCategory = newModelData.category
      newModelId = await addModelToPlatform(platformId, newModelData)
    }
    
    closeModelDialog()

    if (newModelId && newModelCategory) {
      await revealModelInList(platformId, newModelId, newModelCategory)
    }
  } catch (error) {
    console.error('保存模型失败:', error)
    alert('保存失败，请检查模型配置')
  }
}

const deleteModel = async (modelId: string) => {
  if (selectedPlatform.value) {
    // 使用 ModelConfigManager 的 removeModel 以确保清理选中状态
    await removeModel(modelId)
    if (selectedModel.value?.id === modelId) {
      selectedModel.value = null
    }
  }
}

// 确认删除模型
const confirmDeleteModel = async () => {
  if (deleteModelId.value) {
    await deleteModel(deleteModelId.value)
  }
  showDeleteModelDialog.value = false
  deleteModelName.value = ''
  deleteModelId.value = ''
}

// 取消删除模型
const cancelDeleteModel = () => {
  showDeleteModelDialog.value = false
  deleteModelName.value = ''
  deleteModelId.value = ''
}

const openModelConfigDocs = async () => {
  const url = 'https://docs.zerror.cc/docs/local/modelConfig'
  await openPlatformUrl(url)
}

const openPlatformUrl = async (url: string) => {
  if (environmentDetector.isTauriEnvironment) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    } catch (error) {
      window.open(url, '_blank')
    }
  } else {
    window.open(url, '_blank')
  }
}

const copyTextToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

const handleInviteButtonClick = async (platform: AIPlatform) => {
  const inviteCode = platform.inviteCode?.trim()
  const inviteUrl = platform.inviteUrl?.trim()

  if (inviteCode) {
    await copyTextToClipboard(inviteCode)
  }

  if (inviteUrl) {
    await openPlatformUrl(inviteUrl)
  }
}

const addModel = async (platformId: string, model: AIModel) => {
  if (selectedPlatform.value && selectedPlatform.value.id === platformId) {
    selectedPlatform.value.models.push(model)
    await updatePlatform(selectedPlatform.value.id, selectedPlatform.value)
  }
}

// 测试模型功能
const testModel = async (model: AIModel) => {
  if (!selectedPlatform.value) return
  
  // 创建AbortController用于取消请求
  testAbortController.value = new AbortController()
  
  // 显示测试弹窗
  testDialogModelName.value = model.name
  showTestDialog.value = true
  testingModelId.value = model.id
  currentTestResult.value = null
  currentTestError.value = ''
  streamingResponse.value = '' // 重置流式响应
  streamingReasoning.value = '' // 重置流式思考过程
  
  try {
    // 根据模型类型构建不同的测试输入数据
    let testInput
    
    if (model.category === 'vision') {
      // 视觉模型测试：使用图片输入
      // 将图片转换为base64格式
      let imageBase64 = ''
      try {
        // 使用与getPlatformIconUrl相同的环境检测逻辑
        const isTauriEnv = typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)
        console.log('🔍 [DEBUG] Environment detection for test image - isTauriEnv:', isTauriEnv)
        
        let imageUrl = ''
        
        if (isTauriEnv) {
          // 检查是否在开发环境
          const isDev = import.meta.env.DEV
          console.log('🔍 [DEBUG] import.meta.env.DEV:', isDev)
          
          if (isDev) {
            // 开发环境：使用 Vite 开发服务器路径
            imageUrl = '/assets/images/vlm_test/vlm_test.png'
            console.log('✅ [DEBUG] Using development path for test image:', imageUrl)
          } else {
            // 生产环境：使用 frontendDist 管理的静态资源路径
            console.log('🚀 [DEBUG] Production environment detected for test image')
            
            try {
              // 方法1：使用 public 目录中的资源（通过 frontendDist 管理）
              imageUrl = '/assets/images/vlm_test/vlm_test.png'
              console.log('✅ [DEBUG] Using frontendDist managed path for test image:', imageUrl)
            } catch (error) {
              console.error('❌ [DEBUG] frontendDist path failed for test image:', error)
              
              // 方法2：尝试使用 Tauri 资源解析
              try {
                console.log('🔍 [DEBUG] Attempting Tauri resource resolution for test image')
                const { convertFileSrc } = await import('@tauri-apps/api/core')
                const resourcePath = 'assets/images/vlm_test/vlm_test.png'
                imageUrl = convertFileSrc(resourcePath)
                console.log('✅ [DEBUG] Tauri converted URL for test image:', imageUrl)
              } catch (tauriError) {
                console.error('❌ [DEBUG] Tauri resource resolution failed for test image:', tauriError)
                
                // 方法3：回退到相对路径
                imageUrl = '/assets/images/vlm_test/vlm_test.png'
                console.log('⚠️ [DEBUG] Using fallback path for test image:', imageUrl)
              }
            }
          }
        } else {
          // 在浏览器环境中使用 public 目录路径
          imageUrl = '/assets/images/vlm_test/vlm_test.png'
          console.log('🌐 [DEBUG] Using browser path for test image:', imageUrl)
        }
        
        // 使用确定的URL获取图片
        const response = await fetch(imageUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
        }
        
        const blob = await response.blob()
        
        // 转换为base64
        const reader = new FileReader()
        imageBase64 = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        
        console.log('✅ 成功加载测试图片，base64长度:', imageBase64.length)
      } catch (error) {
        console.error('图片转换失败:', error)
        // 使用备用的简单测试图片
        const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77zgAAAABJRU5ErkJggg=='
        imageBase64 = `data:image/png;base64,${testImageBase64}`
        console.log('⚠️ 使用备用测试图片')
      }
      
      testInput = {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64,
                  detail: 'low'
                }
              },
              {
                type: 'text',
                text: '请解答题目中的问题'
              }
            ]
          }
        ],
        model: model.id,
        stream: true
      }
    } else {
      // 文本模型测试：使用纯文本输入
      testInput = {
        messages: [
          {
            role: 'user',
            content: '你好，这是一个测试消息，请简单回复确认收到。'
          }
        ],
        model: model.id,
        stream: true
      }
    }
    
    // 构建配置对象
    const config = {
      apiKey: selectedPlatform.value.apiKey,
      baseUrl: selectedPlatform.value.baseUrl,
      model: model.id,
      ...model
    }
    
    // 动态导入Tauri HTTP插件
    let tauriFetch
    try {
      const tauriHttp = await import('@tauri-apps/plugin-http')
      tauriFetch = tauriHttp.fetch
    } catch (importError) {
      console.warn('Tauri HTTP插件不可用，使用浏览器fetch:', importError)
      tauriFetch = fetch
    }
    
    // 执行JavaScript配置代码
    if (model.jsCode) {
      try {
        // 创建一个安全的执行环境
        let executableCode = model.jsCode.trim()
        let processModel
        
        if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
          // 如果是完整的函数声明，使用eval在安全环境中执行
          const safeEval = new Function('input', 'config', 'fetch', 'abortSignal', `
            ${executableCode}
            return processModel;
          `)
          processModel = safeEval(testInput, config, tauriFetch, testAbortController.value?.signal)
        } else {
          // 如果是函数体，包装为async函数
          const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
            return (async function processModel(input, config) {
              ${executableCode}
            });
          `)
          processModel = wrapperFunction(testInput, config, tauriFetch, testAbortController.value?.signal)
        }
        
        // 执行测试
        const testStartedAt = performance.now()
        const result = await processModel(testInput, config)
        
        if (result) {
          // 如果返回的是生成器或异步迭代器，收集结果
          if (result[Symbol.asyncIterator]) {
            let fullResponse = ''
            let fullReasoning = ''
            let lastUsagePayload: any = null
            streamingResponse.value = '' // 重置流式响应
            streamingReasoning.value = '' // 重置流式思考过程

            for await (const chunk of result) {
              if (chunk.content) {
                fullResponse += chunk.content
                streamingResponse.value = fullResponse // 实时更新流式响应
              }
              // 兼容新的思考过程字段
              if (chunk.reasoning_content) {
                fullReasoning += chunk.reasoning_content
                streamingReasoning.value = fullReasoning // 实时更新流式思考过程
              }
              if (readTokenRateFromPayload(chunk) !== null || readOutputTokenCountFromPayload(chunk) !== null) {
                lastUsagePayload = chunk
              }
            }

            if (!hasVisibleOutputContent(fullResponse)) {
              currentTestResult.value = null
              currentTestError.value = '测试失败：模型未返回任何输出内容'
            } else {
              const tokenRate = resolveTokenRate(lastUsagePayload, fullResponse, fullReasoning, performance.now() - testStartedAt)

              currentTestResult.value = {
                success: true,
                response: fullResponse,
                reasoning_content: fullReasoning,
                tokenRate: tokenRate ?? undefined,
                timestamp: new Date().toLocaleString(),
                modelType: model.category,
                testType: model.category === 'vision' ? '图像理解测试' : '文本对话测试'
              }
            }
          } else {
            // 非流式返回：兼容对象格式与字符串格式
            let finalResponse = ''
            let finalReasoning = ''
            let usagePayload: any = null
            if (typeof result === 'string') {
              finalResponse = result
            } else if (result && typeof result === 'object') {
              finalResponse = (result.content ?? result.response ?? '')
              // 兼容新的思考过程字段
              finalReasoning = (result.reasoning_content ?? '')
              usagePayload = result
            }

            if (!hasVisibleOutputContent(finalResponse)) {
              currentTestResult.value = null
              currentTestError.value = '测试失败：模型未返回任何输出内容'
            } else {
              const tokenRate = resolveTokenRate(usagePayload, finalResponse, finalReasoning, performance.now() - testStartedAt)

              currentTestResult.value = {
                success: true,
                response: finalResponse,
                reasoning_content: finalReasoning,
                tokenRate: tokenRate ?? undefined,
                timestamp: new Date().toLocaleString(),
                modelType: model.category,
                testType: model.category === 'vision' ? '图像理解测试' : '文本对话测试'
              }
            }
          }
        } else {
          currentTestError.value = '模型配置代码未返回有效结果'
        }
      } catch (codeError) {
        console.error('执行模型配置代码失败:', codeError)
        currentTestError.value = `代码执行错误: ${codeError.message}`
      }
    } else {
      currentTestError.value = '模型未配置JavaScript代码'
    }
  } catch (error) {
    console.error('测试模型失败:', error)
    currentTestError.value = `测试失败: ${error.message}`
  } finally {
    testingModelId.value = null
    testAbortController.value = null
    // 测试完成后，如果有错误则清空流式响应
  if (currentTestError.value) {
    streamingResponse.value = ''
    streamingReasoning.value = ''
  }
}
}

// 处理测试弹窗关闭
const handleCloseTestDialog = () => {
  showTestDialog.value = false
}

// 处理取消测试
const handleCancelTest = () => {
  if (testAbortController.value) {
    testAbortController.value.abort()
    currentTestError.value = '测试已被用户取消'
    streamingResponse.value = ''
  }
}

onMounted(() => {
  // 添加全局点击事件监听，用于隐藏右键菜单
  document.addEventListener('click', hidePlatformMenu)
  document.addEventListener('click', hideModelMenu)
  document.addEventListener('click', handleAddModelOutsideClick)
  
  // 预加载平台图标
  loadPlatformIcons()
  loadRemoteModelIconMappings()

  if (modelConfig.platforms.length > 0) {
    selectedPlatform.value = modelConfig.platforms[0]
  }
})

onUnmounted(() => {
  document.removeEventListener('click', hidePlatformMenu)
  document.removeEventListener('click', hideModelMenu)
  document.removeEventListener('click', handleAddModelOutsideClick)
})

// 视觉模型：监听全局变化同步本地状态
// 文本模型通过 currentTextModel computed 自动同步

watch(selectedPlatform, async () => {
  await nextTick()
  updateScrollbarThumb()
  // 重新注册 ResizeObserver
  if (detailContent.value) {
    const ro = new ResizeObserver(updateScrollbarThumb)
    ro.observe(detailContent.value)
  }
})

watch(globalSelectedVisionModel, (newModel) => {
  console.log('🔄 [DEBUG] globalSelectedVisionModel changed to:', newModel?.displayName || 'null')
  currentVisionModel.value = newModel
}, { immediate: true })

// 初始化本地状态
onMounted(() => {
  currentVisionModel.value = globalSelectedVisionModel.value
})

// 监听平台数据变化，重新加载图标
watch(() => modelConfig.platforms, (newPlatforms, oldPlatforms) => {
  if (!selectedPlatform.value && newPlatforms.length > 0) {
    selectedPlatform.value = newPlatforms[0]
  } else if (selectedPlatform.value) {
    const latestSelectedPlatform = newPlatforms.find(platform => platform.id === selectedPlatform.value?.id)
    if (latestSelectedPlatform) {
      selectedPlatform.value = latestSelectedPlatform
    }
  }

  if (!oldPlatforms || newPlatforms.length !== oldPlatforms.length) {
    loadPlatformIcons()
  }

  // 检查是否有平台的图标发生了变化
  if (oldPlatforms) {
    for (const newPlatform of newPlatforms) {
      const oldPlatform = oldPlatforms.find(p => p.id === newPlatform.id)
      if (oldPlatform && oldPlatform.icon !== newPlatform.icon) {
        // 图标发生了变化，清除缓存并重新加载
        delete platformIconUrls.value[newPlatform.id]
        delete iconLoadErrors.value[newPlatform.id]
        
        if (newPlatform.icon && newPlatform.icon.includes('.')) {
          getPlatformIconUrl(newPlatform.icon).then(url => {
            platformIconUrls.value[newPlatform.id] = url
          }).catch(error => {
            console.error(`Failed to reload icon for platform ${newPlatform.id}:`, error)
            iconLoadErrors.value[newPlatform.id] = true
          })
        }
      }
    }
  }
}, { deep: true })

onUnmounted(() => {
  // 移除全局点击事件监听
  document.removeEventListener('click', hidePlatformMenu)
  document.removeEventListener('click', hideModelMenu)
})
</script>

<style scoped>
/* 模型设置布局样式 */
.model-settings-container {
  background-color: var(--bg-primary, #f4f4f4);
  gap: 4px;
  display: flex;
  height: 100%;
}

.platform-sidebar {
  width: 300px;
  background: var(--bg-secondary, #ffffff);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-primary, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary, #2d3748);
  margin: 0;
}

.sidebar-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.platform-list {
  display: flex;
  align-items: center;
  width: 100%;
  flex: 1;
  padding: 12px;
  overflow-y: none;
  box-sizing: border-box;
  scrollbar-gutter: stable;
}

.platform-item {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid var(--platform-item-border);
  background-color: var(--platform-item-bg);
  color: var(--platform-item-text);
}

.platform-item:hover {
  background-color: var(--platform-item-hover-bg);
  border-color: var(--platform-item-hover-border);
  color: var(--platform-item-hover-text);
}

.platform-item.active {
  background-color: var(--platform-item-active-bg);
  border-color: var(--platform-item-active-border);
  color: var(--platform-item-active-text);
  box-shadow: var(--model-item-active-shadow);
}

.platform-icon {
  width: 32px;
  height: 32px;
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
}

.platform-icon-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background-color: transparent;
  border: 1px solid transparent;
  box-sizing: border-box;
  overflow: hidden;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.platform-icon--bg {
  background-color: var(--platform-item-icon-bg);
  border-color: var(--platform-config-dialog-header-border);
}


.platform-selected-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  background-color: #f8bd40;
  border-radius: 999px;
  pointer-events: none;
  box-shadow: 0 0 0 2px var(--platform-item-bg);
  animation: dot-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.platform-item:hover .platform-selected-badge {
  box-shadow: 0 0 0 2px var(--platform-item-hover-bg);
}

.platform-item.active .platform-selected-badge {
  box-shadow: 0 0 0 2px var(--platform-item-active-bg);
}

.platform-selected-badge--count {
  width: auto;
  height: 14px;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  line-height: 14px;
  text-align: center;
  top: -6px;
  right: -6px;
}


.icon-emoji {
  font-size: 18px;
}

.icon-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}

.icon-fallback {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
}

.platform-info {
  flex: 1;
  min-width: 0;
}

.platform-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #2d3748);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.platform-tags {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
  margin-left: auto;
  margin-top: 0;
}

.platform-tag {
  font-size: 10px;
  padding: 0px 4px;
  border-radius: 4px;
  background-color: var(--platform-config-icon-section-title-bg);
  color: var(--text-secondary, #718096);
  border: 1px solid var(--platform-config-dialog-header-border);
  line-height: 1.4;
  white-space: nowrap;
}

.platform-item.active .platform-tag {
  background-color: var(--platform-config-icon-section-title-bg);
  color: var(--text-secondary);
  border-color: var(--platform-config-dialog-header-border);
}

.platform-detail {
  flex: 1;
  border-radius: 5px;
  background: var(--platform-detail-bg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.detail-scroll-wrap {
  position: relative;
  flex: 1;
  display: flex;
  overflow: hidden;
}

.detail-content {
  padding: 24px;
  overflow-y: scroll;
  flex: 1;
  background: var(--platform-detail-content-bg);
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.detail-content::-webkit-scrollbar {
  display: none;
}

.detail-content::-webkit-scrollbar-button {
  display: none;
}

.custom-scrollbar {
  position: absolute;
  right: 3px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
}

.custom-scrollbar.is-visible {
  opacity: 1;
}

.custom-scrollbar-thumb {
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.custom-scrollbar-thumb:hover {
  background: var(--custom-scrollbar-thumb-hover);
}

.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--text-tertiary);
}

.detail-section {
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border-primary);
}

.detail-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.platform-title-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.platform-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
  font-size: 12px;
}

.platform-link-btn:first-of-type {
  margin-right: 8px;
}

.platform-link-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.platform-invite-btn {
  color: #FF505D;
}

.platform-invite-btn:hover {
  background: rgba(255, 80, 93, 0.08);
  color: #FF505D;
}

.invite-text {
  font-size: 12px;
  white-space: nowrap;
  color: #ff8c00;
}

.invite-gift-wrap {
  position: relative;
  display: inline-flex;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  transform: rotate(-15deg);
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  filter: drop-shadow(0 0 3px rgba(255, 80, 93, 0.6));
  animation: gift-glow 2s ease-in-out infinite;
}

.platform-invite-btn:hover .invite-gift-wrap {
  animation: none;
  filter: none;
}

.invite-gift-icon {
  position: absolute;
  top: 0;
  left: 0;
}

.gift-lid {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.platform-invite-btn:hover .gift-lid {
  transform: translateY(-6px) rotate(-20deg);
  filter: drop-shadow(0 0 5px rgba(255, 160, 50, 0.9));
}

@keyframes gift-glow {
  0%, 100% { filter: drop-shadow(0 0 3px rgba(255, 80, 93, 0.6)); }
  50%       { filter: drop-shadow(0 0 7px rgba(255, 160, 50, 0.9)); }
}

.subsection-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--platform-detail-header-text);
}

.platform-description {
  color: var(--platform-detail-description-text);
  margin: 8px 0 0 0;
  line-height: 1.5;
}

/* 表单样式 */
.form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--platform-detail-form-label-text);
  margin-bottom: 6px;
}

.form-input {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-primary);
  background-color: var(--form-input-bg, #F7F7F7);
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.form-input:hover {
  background-color: var(--form-input-hover-bg, #f0f0f0);
  border-color: var(--form-input-hover-border, transparent);
}

.form-input:focus {
  outline: none;
  background-color: var(--form-input-bg, #F7F7F7);
  border-color: var(--form-input-focus-border, #e3e3e3);
  box-shadow: none;
}

.form-tip {
  margin-top: 6px;
}

.api-doc-link {
  font-size: 12px;
  color: var(--text-accent, #3182ce);
  text-decoration: none;
}

.api-doc-link:hover {
  color: var(--text-accent-hover, #ffbf84);
}

.input-group {
  position: relative;
}

.input-with-suffix {
  position: relative;
  display: flex;
  align-items: center;
}

.api-key-input {
  padding-right: 40px;
}

input[type="password"].api-key-input::-webkit-toggle-password {
  -webkit-appearance: none!important;
  display: none!important;
}
input[type="password"].api-key-input::-moz-ui-password {
  -moz-appearance: none!important;
  display: none!important;
}
input[type="password"].api-key-input::-ms-reveal {
  display: none!important;
}

.input-suffix-btn {
  position: absolute;
  right: 8px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-secondary, #718096);
  transition: color 0.2s ease;
}

.input-suffix-btn:hover {
  color: var(--text-primary, #2d3748);
}

/* 模型列表样式 */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--model-item-border);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--model-item-bg);
  color: var(--model-item-text);
}

.model-item:hover {
  background-color: var(--model-item-hover-bg);
  border-color: var(--model-item-hover-border);
  color: var(--model-item-hover-text);
}

.model-item--disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.model-item--disabled:hover {
  background: var(--model-item-bg);
  border-color: var(--model-item-border);
  color: var(--model-item-text);
}

.model-item.active {
  background-color: var(--model-item-active-bg);
  border-color: var(--model-item-active-border);
  color: var(--model-item-active-text);
  box-shadow: var(--model-item-active-shadow);
}

.model-info {
  flex: 1;
}

.model-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--model-item-name-text);
  margin: 0;
}

.model-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-selected {
  display: flex;
  align-items: center;
  justify-content: center;
}

.model-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f8bd40;
  display: block;
  animation: dot-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes dot-pop {
  from { transform: scale(0); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

/* 多选模型选中状态 */
.model-item.active {
  background-color: var(--model-item-active-bg);
  border-color: var(--model-item-active-border);
  color: var(--model-item-active-text);
  box-shadow: var(--model-item-active-shadow);
}

/* 空状态样式 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 40px;
}

.empty-icon {
  margin-bottom: 16px;
  color: var(--text-secondary, #a0aec0);
}

.empty-state h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  margin: 0 0 8px 0;
}

.empty-state p {
  color: var(--text-secondary, #718096);
  margin: 0;
}

/* 按钮样式 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  text-decoration: none;
}

.btn-small {
  padding: 6px 12px;
  font-size: 12px;
}

.btn-primary {
  background-color: var(--btn-primary, #3182ce);
  color: white;
}

.btn-primary:hover {
  background-color: var(--btn-primary-hover, #2c5aa0);
}

.header-actions{
  display: flex;
  gap: 10px;
}

/* 图标操作按钮（与 add-question-button 风格一致） */
.icon-action-btn {
  padding: 6px;
  width: 33px;
  height: 33px;
  background-color: var(--platform-config-toggle-button-bg);
  color: var(--text-secondary);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon-action-btn:hover {
  background-color: var(--platform-config-toggle-button-hover-bg);
  color: var(--text-primary);
}

.icon-action-btn--ghost {
  background-color: transparent;
}

.icon-action-btn--ghost:hover {
  background-color: var(--platform-config-toggle-button-hover-bg);
}

.icon-action-btn--sm {
  width: 26px;
  height: 26px;
  padding: 4px;
  border-radius: 5px;
}

.icon-action-btn--model-add {
  border-radius: 8px;
}

.icon-action-btn--add {
  background-color: var(--add-btn-icon-bg);
  color: var(--add-btn-icon-color);
}

.icon-action-btn--add:hover {
  background-color: var(--add-btn-icon-hover-bg);
  color: var(--add-btn-icon-color);
}


/* 添加模型下拉按钮 */
.add-model-dropdown-wrap {
  position: relative;
}

.add-model-main {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.dropdown-arrow {
  transition: transform 0.18s;
  margin-left: 2px;
}
.dropdown-arrow.open {
  transform: rotate(180deg);
}

.add-model-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 180px;
  background: var(--bg-secondary, #fff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  z-index: 200;
  overflow: hidden;
}

.add-model-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  text-align: left;
}
.add-model-menu-item:hover {
  background: var(--hover-bg, rgba(0,0,0,0.05));
}

/* 模型列表多选提示 */
.model-list-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-secondary, #718096);
  padding: 4px 4px 8px;
  user-select: none;
}

/* 多选模型选中状态 */
.model-item.active {
  background-color: var(--model-item-active-bg);
  border-color: var(--model-item-active-border);
  color: var(--model-item-active-text);
  box-shadow: var(--model-item-active-shadow);
}

/* 模型图标 */
.model-icon-wrap {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 4px;
}
.model-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 6px;
}
.model-icon-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-accent-light, rgba(49,130,206,0.1));
  color: var(--btn-primary, #3182ce);
  font-size: 12px;
  font-weight: 700;
  border-radius: 6px;
}
</style>