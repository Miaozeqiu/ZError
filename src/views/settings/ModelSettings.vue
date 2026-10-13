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
      
      <div class="platform-list-scroll-wrap" ref="platformListScrollWrap">
        <div class="platform-list-scroll" ref="platformListScroll" @scroll="onPlatformListScroll">
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
                <div class="platform-icon-inner" :class="{ 'platform-icon-inner--with-bg': shouldUsePlatformIconBackground(platform) }">
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
                    @load="handlePlatformIconLoad(platform, $event)"
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
                <span v-if="isPlatformSelectedForCategory(platform, 'agent')" class="platform-tag">agent</span>
              </div>
              <!-- 启用开关已移至详情面板 -->
            </div>
          </div>
        </div>
        <div class="custom-scrollbar" :class="{ 'is-visible': platformScrollbarVisible }" ref="platformScrollbar" @mousedown="onPlatformScrollbarMousedown">
          <div 
            class="custom-scrollbar-thumb"
            ref="platformScrollbarThumb"
          ></div>
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
                v-if="platformHasInvite(selectedPlatform)"
                :text="inviteField(selectedPlatform.inviteCode) ? '复制并跳转' : ''"
              >
                <button
                  class="platform-link-btn platform-invite-btn"
                  @click="handleInviteButtonClick(selectedPlatform)"
                  :aria-label="inviteField(selectedPlatform.inviteCode) ? '复制并跳转' : (inviteField(selectedPlatform.inviteText) || '邀请链接')"
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
                  <span v-if="inviteField(selectedPlatform.inviteText)" class="invite-text">{{ selectedPlatform.inviteText }}</span>
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
            <div class="form-label-row">
              <label class="form-label">API Key</label>
              <a
                href="https://docs.zerror.cc/get-apiKey"
                target="_blank"
                rel="noopener noreferrer"
                class="api-doc-link"
              >
                如何获取Api Key?
              </a>
            </div>
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
          </div>
          <div class="form-group">
            <label class="form-label">Base URL</label>
            <div class="base-url-row">
              <input
                type="text"
                v-model="selectedPlatform.baseUrl"
                @input="updatePlatformBaseUrl"
                class="form-input"
                placeholder="API 基础地址"
              >
              <div class="protocol-select-wrap">
                <button
                  ref="platformProtocolTriggerRef"
                  type="button"
                  class="protocol-select-trigger"
                  :class="{ open: showPlatformProtocolDropdown }"
                  :disabled="selectedPlatform.isRemote"
                  :title="selectedPlatform.isRemote ? '远程平台协议由管理员下发' : '该平台下所有模型共用此协议'"
                  aria-haspopup="listbox"
                  :aria-expanded="showPlatformProtocolDropdown"
                  @click="togglePlatformProtocolDropdown"
                >
                  <span class="protocol-select-path">{{ currentPlatformProtocolPath }}</span>
                  <svg class="protocol-select-arrow" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06z" fill="currentColor"/>
                  </svg>
                </button>
                <Teleport to="body">
                  <Transition name="dropdown-pop">
                    <div
                      v-if="showPlatformProtocolDropdown"
                      ref="platformProtocolDropdownRef"
                      class="protocol-dropdown"
                      :style="platformProtocolDropdownStyle"
                      role="listbox"
                      aria-label="API 协议"
                    >
                      <button
                        v-for="opt in platformProtocolOptions"
                        :key="opt.value"
                        type="button"
                        class="protocol-dropdown-item"
                        :class="{ active: (selectedPlatform.apiProtocol || 'openai-chat') === opt.value }"
                        role="option"
                        :aria-selected="(selectedPlatform.apiProtocol || 'openai-chat') === opt.value"
                        @click="selectPlatformProtocol(opt.value)"
                      >
                        <span class="protocol-dropdown-path">{{ opt.endpoint }}</span>
                        <span class="protocol-dropdown-label">{{ opt.label }}</span>
                      </button>
                    </div>
                  </Transition>
                </Teleport>
              </div>
            </div>
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
          
          <div v-if="selectedCategory === 'text' || selectedCategory === 'summary' || selectedCategory === 'vision' || selectedCategory === 'agent'" class="model-list-hint">
            <template v-if="selectedCategory === 'text'">可多选，最多 5 个（已选 {{ currentMultiModels.length }}/5）</template>
            <template v-else-if="selectedCategory === 'agent'">单选，显示全部模型，再点一次可取消选择</template>
            <template v-else>单选，再点一次可取消选择</template>
          </div>
          <div class="model-list">
            <div 
              v-for="model in filteredModels" 
              :key="model.id"
              :data-model-id="model.id"
              class="model-item"
              :class="{ 
                active: isCurrentCategoryModelSelected(model),
                'model-item--disabled': isSelectedPlatformDisabled,
                'model-item--no-vision': isVisionUnavailable(model)
              }"
              @click="selectModel(model)"
              @contextmenu.prevent="showModelContextMenuHandler($event, model)"
            >
              <div class="model-icon-wrap">
                <img v-if="getModelIcon(model)" :src="getModelIcon(model)" :alt="model.displayName" class="model-icon-img" />
                <div v-else class="model-icon-fallback">{{ (model.displayName || model.id).charAt(0).toUpperCase() }}</div>
              </div>
              <div class="model-info">
                <div class="model-header">
                  <h5 class="model-name">{{ model.displayName }}</h5>
                  <span v-if="modelHasVision(model)" class="model-kind-tag">视觉</span>
                </div>
                
              </div>
              <div class="model-actions">
                <div
                  class="model-selected"
                  :class="{ 'model-selected--multi': selectedCategory === 'text' }"
                >
                  <span v-if="isCurrentCategoryModelSelected(model)" class="model-dot"></span>
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


    <PlatformConfigDialog
      :show="showAddPlatformDialog || showEditPlatformDialog"
      :platform="editingPlatform"
      @close="closePlatformDialog"
      @save="savePlatform"
    />

    <!-- 平台右键菜单 -->
    <PlatformContextMenu
      :visible="showPlatformContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :platform="contextMenuPlatform"
      @edit-platform="handleEditPlatform"
      @delete-platform="handleDeletePlatform"
      @close="hidePlatformMenu"
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
      @close="hideModelMenu"
    />

    <ModelConfigDialog
      :show="showModelConfigDialog"
      :model="editingModel"
      :platform-base-url="selectedPlatform?.baseUrl"
      :platform-api-key="selectedPlatform?.apiKey"
      :platform-api-protocol="selectedPlatform?.apiProtocol"
      @close="closeModelDialog"
      @after-leave="onModelConfigAfterLeave"
      @save="saveModel"
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
      @start-test="handleStartTest"
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

</template>

<script setup lang="ts">
import PlatformConfigDialog from './ModelSettings/PlatformConfigDialog.vue'
import PlatformContextMenu from './ModelSettings/PlatformContextMenu.vue'
import ModelContextMenu from './ModelSettings/ModelContextMenu.vue'
import ModelConfigDialog from './ModelSettings/ModelConfigDialog.vue'
import ModelTestDialog from './ModelSettings/ModelTestDialog.vue'
import ModelDeleteConfirmDialog from './ModelSettings/ModelDeleteConfirmDialog.vue'
import PlatformDeleteConfirmDialog from './ModelSettings/PlatformDeleteConfirmDialog.vue'
import Toggle from '../../components/ui/Toggle.vue'
import ModelCategorySwitch from './ModelSettings/ModelCategorySwitch.vue'
import OlTip from './OlTip.vue'
import { useModelSettings } from './useModelSettings'

const {
  detailScrollWrap, detailContent, customScrollbar, customScrollbarThumb, platformListScrollWrap, platformListScroll, platformScrollbar, platformScrollbarThumb, isDraggingScrollbar, dragStartY, dragStartScrollTop, scrollHideTimer, scrollbarVisible, isDraggingPlatformScrollbar, platformDragStartY, platformDragStartScrollTop, platformScrollHideTimer, platformScrollbarVisible, showScrollbar, updateScrollbarThumb, onDetailScroll, onScrollbarMousedown, showPlatformScrollbar, updatePlatformScrollbarThumb, onPlatformListScroll, onPlatformScrollbarMousedown, showAddPlatformDialog, showEditPlatformDialog, editingPlatform, showModelConfigDialog, editingModel, selectedPlatform, selectedModel, currentVisionModel, showApiKey, currentMultiModels, getPlatformSelectedCount, selectedCategory, isPlatformSelectedForCategory, isCurrentCategoryModelSelected, filteredModels, isVisionUnavailable, isSelectedPlatformDisabled, currentModel, testingModelId, testResults, testErrors, testAbortController, showTestDialog, testDialogModelName, currentTestResult, currentTestError, streamingResponse, streamingReasoning, isAbortedTestError, cancelCurrentTest, showMarkdownDemo, extractNumericTokenValue, readTokenRateFromPayload, readOutputTokenCountFromPayload, estimateTextTokens, resolveTokenRate, hasVisibleOutputContent, showDeleteModelDialog, deleteModelName, deleteModelId, showDeletePlatformDialog, deletePlatformName, deletePlatformId, iconLoadErrors, platformIconUrls, platformIconBackgrounds, remoteModelIconMappings, PROD_REMOTE_MODEL_ICON_BASE_URL, DEV_REMOTE_MODEL_ICON_BASE_URL, getRemoteModelIconBaseUrl, resolveModelIconUrl, loadRemoteModelIconMappings, loadPlatformIcons, showPlatformContextMenu, contextMenuX, contextMenuY, contextMenuPlatform, showModelContextMenu, modelContextMenuX, modelContextMenuY, contextMenuModel, modelToTest, editPlatform, deletePlatform, confirmDeletePlatform, cancelDeletePlatform, closePlatformDialog, savePlatform, selectPlatform, revealModelInList, selectModel, getPlatformIconUrl, getPlatformInitials, isEmoji, isSvgIcon, shouldUsePlatformIconBackground, detectTransparentChannel, handlePlatformIconLoad, handleIconError, getModelIcon, showPlatformMenu, hidePlatformMenu, showModelContextMenuHandler, hideModelMenu, handleEditPlatform, handleDeletePlatform, handleEditModel, handleTestModel, handleStartTest, handleDeleteModel, toggleApiKeyVisibility, updatePlatformApiKey, updatePlatformEnabled, updatePlatformBaseUrl, platformProtocolOptions, currentPlatformProtocolPath, showPlatformProtocolDropdown, platformProtocolTriggerRef, platformProtocolDropdownRef, platformProtocolDropdownStyle, updatePlatformProtocolDropdownPosition, closePlatformProtocolDropdown, togglePlatformProtocolDropdown, selectPlatformProtocol, handlePlatformProtocolOutsideClick, updatePlatformApiProtocol, showAddModelDropdown, addModelDropdownRef, openAddModelDropdown, closeAddModelDropdown, openTemplate, openQuickAdd, handleAddModelOutsideClick, addNewModel, editModel, closeModelDialog, onModelConfigAfterLeave, saveModel, deleteModel, confirmDeleteModel, cancelDeleteModel, openModelConfigDocs, openPlatformUrl, copyTextToClipboard, inviteField, platformHasInvite, handleInviteButtonClick, createCookieEnabledFetch, addModel, testModel,   handleCloseTestDialog, handleCancelTest, modelConfig, modelHasVision
} = useModelSettings()

</script>

<style scoped src="./ModelSettings.css"></style>
