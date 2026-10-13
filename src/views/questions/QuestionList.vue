<template>
  <div class="question-list">
    <div class="list-header">
      <!-- 搜索框 -->
      <div class="search-container">
        <!-- 题目数量 + 分页，显示在搜索栏最左侧 -->
        <div class="search-left-info">
          <div class="question-count-info">
            共 {{ totalQuestions }} 道题目
          </div>
          <div class="pagination-container" v-if="totalQuestions > 0">
            <div class="pagination">
              <button class="pagination-btn prev-btn" :disabled="currentPage <= 1" @click="goToPreviousPage">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="15,18 9,12 15,6"></polyline>
                </svg>
              </button>
              <span class="page-info">
                {{ currentPage }} / {{ Math.max(totalPages, 1) }}
              </span>
              <button class="pagination-btn next-btn" :disabled="currentPage >= totalPages" @click="goToNextPage">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9,6 15,12 9,18"></polyline>
                </svg>
              </button>
            </div>
          </div>
          <div v-if="isSearchMode" class="search-info">
            搜索结果：{{ questions.length }} 条
          </div>
        </div>
        <div class="search-box">
          <!-- 刷新按钮 -->
          <div
            class="refresh-icon-button"
            role="button"
            tabindex="0"
            title="刷新"
            @click="emit('refresh')"
            @keydown.enter.prevent="emit('refresh')"
          >
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
              <path d="M379.392 870.4c-92.672-44.828-171.918-143.19-198.03-245.76-24.576-96.484-6.258-200.932 50.517-288.54 48.81-75.208 117.191-125.896 217.316-161.11 24.69-8.704 44.942-18.375 44.942-21.56 0-3.13-10.923-16.612-24.292-29.924-27.306-27.193-29.582-36.921-12.401-54.272 19.91-20.139 36.58-16.327 71.68 16.327 16.839 15.644 46.592 41.301 66.104 57.003 38.23 30.72 47.616 44.6 42.895 63.601-2.674 10.468-57.856 82.774-98.816 129.48-19.229 21.902-32.086 27.59-46.82 20.82a44.373 44.373 0 0 1-17.75-16.497c-7.11-13.54-0.682-27.762 28.787-63.374 10.808-13.085 19.74-25.6 19.74-27.705 0-7.794-25.657-10.013-54.955-4.722-51.257 9.216-96.825 34.987-141.994 80.213-22.528 22.585-45.227 50.745-52.167 64.683-48.925 98.361-46.536 211.797 6.371 302.763 24.462 41.927 81.237 95.858 122.937 116.622 96.825 48.242 204.345 45.397 294.684-7.737C806.4 737.166 867.556 601.26 842.183 480.825c-8.704-41.529-34.36-98.247-59.278-131.3-22.699-30.037-28.274-43.235-24.633-58.026 3.925-15.759 26.34-24.406 42.382-16.27 28.445 14.279 82.375 99.669 99.84 157.98 13.938 46.364 12.686 155.079-2.275 203.947-13.085 42.666-46.251 108.373-69.632 138.069-24.178 30.72-78.507 75.207-116.054 95.232-59.164 31.403-143.417 46.08-213.56 37.205-46.308-5.86-70.145-13.312-119.581-37.262z" fill="currentColor"/>
            </svg>
          </div>
          <div 
            ref="importButtonRef"
            class="import-icon-button" 
            :class="{ 'active': importMenuOpen }"
            role="button" 
            tabindex="0" 
            aria-label="导入"
            title="导入"
            @click="toggleImportMenu"
            @keydown.enter.prevent="toggleImportMenu"
            @keydown.space.prevent="toggleImportMenu"
          >
            <svg class="import-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
              <path fill="currentColor"
                d="M960 672v128c0 89.6-70.4 160-160 160h-576C134.4 960 64 889.6 64 800v-576C64 134.4 134.4 64 224 64h128c19.2 0 32 12.8 32 32s-12.8 32-32 32h-128C172.8 128 128 172.8 128 224v576c0 51.2 44.8 96 96 96h576c51.2 0 96-44.8 96-96v-128c0-19.2 12.8-32 32-32s32 12.8 32 32zM800 576c19.2 0 32-12.8 32-32s-12.8-32-32-32H556.8l326.4-326.4c12.8-12.8 12.8-32 0-44.8s-32-12.8-44.8 0L512 467.2V224c0-19.2-12.8-32-32-32s-32 12.8-32 32V576h352z">
              </path>
            </svg>
          </div>

          <!-- 导出按钮 -->
          <div 
            ref="exportButtonRef"
            class="export-icon-button" 
            :class="{ 'active': exportMenuOpen }"
            role="button" 
            tabindex="0" 
            aria-label="导出"
            title="导出"
            @click="toggleExportMenu"
            @keydown.enter.prevent="toggleExportMenu"
            @keydown.space.prevent="toggleExportMenu"
          >
            <svg t="1764405170226" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
              p-id="1485" width="16" height="16">
              <path
                d="M960 672v128c0 89.6-70.4 160-160 160h-576C134.4 960 64 889.6 64 800v-576C64 134.4 134.4 64 224 64h128c19.2 0 32 12.8 32 32s-12.8 32-32 32h-128C172.8 128 128 172.8 128 224v576c0 51.2 44.8 96 96 96h576c51.2 0 96-44.8 96-96v-128c0-19.2 12.8-32 32-32s32 12.8 32 32zM608 128h243.2L358.4 614.4c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 12.8 6.4 25.6 6.4s19.2 0 25.6-6.4L896 172.8v243.2c0 19.2 12.8 32 32 32 19.2-6.4 32-12.8 32-32V64H608c-19.2 0-32 12.8-32 32s12.8 32 32 32z"
                fill="currentColor" p-id="1486"></path>
            </svg>
          </div>
          <div class="search-icon-button" role="button" tabindex="0" aria-label="搜索" @click="openSearch"
            @keydown.enter.prevent="openSearch" @keydown.space.prevent="openSearch">
            <svg aria-hidden="true" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"
              class="magnifying-glass-small" width="16" height="16">
              <path fill="currentColor"
                d="M7.1 1.975a5.125 5.125 0 1 0 3.155 9.164l3.107 3.107a.625.625 0 1 0 .884-.884l-3.107-3.107A5.125 5.125 0 0 0 7.1 1.975M3.225 7.1a3.875 3.875 0 1 1 7.75 0 3.875 3.875 0 0 1-7.75 0">
              </path>
            </svg>
          </div>

          <transition name="search-expand">
            <input v-if="searchOpen" ref="searchInputRef" type="text" v-model="searchTerm" @input="handleSearch"
              @keyup.enter="performSearch" @blur="collapseSearch" placeholder="搜索题目标题..." class="search-input" />
          </transition>
          <button v-if="searchOpen && searchTerm" @mousedown.prevent.stop="clearSearch" class="clear-button">
            ✕
          </button>
          <button @click="showAddQuestionDialog" class="add-question-button" title="添加题目">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
              <path d="M544.256 480.256h307.2a32.256 32.256 0 0 1 0 64h-307.2v307.2a32.256 32.256 0 0 1-64 0v-307.2h-307.2a32.256 32.256 0 1 1 0-64h307.2v-307.2a32.256 32.256 0 1 1 64 0z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div class="list-content" @contextmenu.prevent="handleListRightClick">
      <div v-if="loading" class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">加载中...</div>
      </div>

      <transition v-else :name="listTransitionName" mode="out-in">
        <div v-if="!hasLoaded" key="boot" class="list-placeholder"></div>
        <div v-else-if="questions.length === 0" key="empty" class="empty-state" @contextmenu.prevent="handleListRightClick">
          <div class="empty-icon">📝</div>
          <div class="empty-text">暂无题目</div>
          <div class="empty-subtext">{{ isPendingCorrectionFolder ? '当前没有待修正题目' : '选择一个文件夹查看题目' }}</div>
        </div>
        <div v-else :key="listContentKey" class="question-table-container" @contextmenu.prevent="handleListRightClick">
        <table class="question-table">
          <thead>
            <tr>
              <th class="col-checkbox">
                <input type="checkbox" :checked="isAllSelected" :indeterminate="isIndeterminate"
                  @change="handleSelectAll" class="select-all-checkbox" />
              </th>
              <th class="col-question">
                <span class="th-header">
                  <svg class="th-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="14"
                    height="14">
                    <path
                      d="M568.263111 96.028444c25.429333 0 49.834667 10.069333 67.868445 28.103112l199.736888 199.736888c18.033778 18.033778 28.16 42.439111 28.16 67.868445v408.234667a128 128 0 0 1-128 128H287.914667a128 128 0 0 1-128-128V224.028444a128 128 0 0 1 128-128H568.32z m0.398222 71.964445H287.971556a55.978667 55.978667 0 0 0-55.978667 55.068444v576.967111c0 30.606222 24.576 55.466667 55.068444 55.978667h448.910223a55.978667 55.978667 0 0 0 56.035555-55.068444V391.736889a24.007111 24.007111 0 0 0-6.712889-16.611556l-200.078222-200.078222a24.007111 24.007111 0 0 0-16.497778-7.054222z m-28.728889 500.053333a36.010667 36.010667 0 0 1 0 71.964445H355.953778a36.010667 36.010667 0 1 1 0-72.021334H539.875556z m39.480889-331.036444a36.010667 36.010667 0 0 1 0 50.915555l-190.407111 190.407111a1.991111 1.991111 0 0 1-1.251555 0.568889l-48.696889 3.356445a1.991111 1.991111 0 0 1-2.161778-1.877334v-0.170666l0.682667-51.427556c0-0.568889 0.227556-1.024 0.568889-1.422222L528.497778 337.009778a36.010667 36.010667 0 0 1 50.915555 0z"
                      fill="currentColor"></path>
                  </svg>
                  题目内容
                </span>
              </th>
              <th class="col-options">
                <span class="th-header">
                  <svg class="th-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="14"
                    height="14">
                    <path
                      d="M51.2 102.4a51.2 51.2 0 1 1-51.2 51.2 51.2 51.2 0 0 1 51.2-51.2z m204.8 0h716.8a51.2 51.2 0 0 1 0 102.4H256a51.2 51.2 0 0 1 0-102.4zM51.2 460.8a51.2 51.2 0 1 1-51.2 51.2 51.2 51.2 0 0 1 51.2-51.2z m204.8 0h716.8a51.2 51.2 0 0 1 0 102.4H256a51.2 51.2 0 0 1 0-102.4z m-204.8 358.4a51.2 51.2 0 1 1-51.2 51.2 51.2 51.2 0 0 1 51.2-51.2z m204.8 0h716.8a51.2 51.2 0 0 1 0 102.4H256a51.2 51.2 0 0 1 0-102.4z"
                      fill="currentColor"></path>
                  </svg>
                  选项
                </span>
              </th>
              <th class="col-answer">
                <span class="th-header">
                  <svg class="th-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="14"
                    height="14">
                    <path
                      d="M547.498667 562.346667a128 128 0 1 0 181.034666 180.992 128 128 0 0 0-181.034666-181.034667z m0-301.738667a42.666667 42.666667 0 0 1 0 60.373333l-90.453334 90.496L396.629333 351.146667l90.496-90.538667a42.666667 42.666667 0 0 1 60.330667 0z m241.365333 241.365333a213.333333 213.333333 0 1 1-328.832 33.194667L185.472 260.608a42.666667 42.666667 0 0 1 60.330667-60.330667l30.165333 30.165334 60.373333-60.330667a42.666667 42.666667 0 0 1 60.330667 60.330667L336.341333 290.816l184.021334 184.021333a213.418667 213.418667 0 0 1 268.501333 27.136z"
                      fill="currentColor"></path>
                  </svg>
                  答案
                </span>
              </th>
              <th class="col-type">
                <span class="th-header">
                  <svg class="th-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="14"
                    height="14">
                    <path
                      d="M452.29 475.94H230.57c-106.78 0-193.67-86.88-193.67-193.66v-28.07c0-106.78 86.89-193.66 193.67-193.66h28.07c106.78 0 193.65 86.88 193.65 193.66v221.73zM230.57 137.88c-64.16 0-116.35 52.18-116.35 116.33v28.07c0 64.15 52.18 116.33 116.35 116.33h144.39v-144.4c0-64.15-52.18-116.33-116.32-116.33h-28.07zM794.33 475.94H572.61V254.22c0-106.78 86.89-193.66 193.67-193.66h28.04C901.11 60.56 988 147.44 988 254.22v28.07c0 106.77-86.89 193.65-193.67 193.65z m-144.39-77.32h144.39c64.16 0 116.35-52.18 116.35-116.33v-28.07c0-64.15-52.18-116.33-116.35-116.33h-28.04c-64.16 0-116.35 52.18-116.35 116.33v144.4zM258.64 982.29h-28.07c-106.78 0-193.67-86.88-193.67-193.67v-28.05c0-106.78 86.89-193.66 193.67-193.66h221.72v221.72c0 106.78-86.87 193.66-193.65 193.66z m-28.07-338.06c-64.16 0-116.35 52.18-116.35 116.33v28.05c0 64.15 52.18 116.35 116.35 116.35h28.07c64.14 0 116.32-52.19 116.32-116.35V644.23H230.57zM794.33 982.29h-28.04c-106.78 0-193.67-86.88-193.67-193.67V566.9h221.72C901.11 566.9 988 653.78 988 760.56v28.05c0 106.8-86.89 193.68-193.67 193.68zM649.94 644.23v144.39c0 64.15 52.18 116.35 116.35 116.35h28.04c64.16 0 116.35-52.19 116.35-116.35v-28.05c0-64.15-52.18-116.33-116.35-116.33H649.94v-0.01z"
                      fill="currentColor"></path>
                  </svg>
                  类型
                </span>
              </th>
              <th class="col-time sortable" @click="toggleCreateTimeSort">
                <span class="th-header">
                  <svg class="th-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="14"
                    height="14">
                    <path
                      d="M833 128c0-53-43-96-96-96h-16c-53 0-96 43-96 96H400c0-53-43-96-96-96h-16c-53 0-96 43-96 96H64c-35.3 0-64 28.7-64 64v736c0 35.3 28.7 64 64 64h896c35.3 0 64-28.7 64-64V192c0-35.3-28.7-64-64-64H833zM729 96c22.1 0 40 17.9 40 40v80c0 22.1-17.9 40-40 40s-40-17.9-40-40v-80c0-22.1 17.9-40 40-40z m-433 0c22.1 0 40 17.9 40 40v80c0 22.1-17.9 40-40 40s-40-17.9-40-40v-80c0-22.1 17.9-40 40-40z m632 832H96c-17.7 0-32-14.3-32-32V448h896v448c0 17.7-14.3 32-32 32z m32-544H64V224c0-17.7 14.3-32 32-32h96v32c0 53 43 96 96 96h16c53 0 96-43 96-96v-32h225v24c0 57.4 46.6 104 104 104s104-46.6 104-104v-24h95c17.7 0 32 14.3 32 32v160z"
                      fill="currentColor"></path>
                  </svg>
                  创建时间
                  <span class="sort-indicator" :class="`sort-indicator--${createTimeSortOrder}`" aria-hidden="true">
                    <svg class="sort-indicator-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M512 330.666667c14.933333 0 29.866667 4.266667 40.533333 14.933333l277.33333399 234.666667c27.733333 23.466667 29.866667 64 8.53333301 89.6-23.466667 27.733333-64 29.866667-89.6 8.53333299L512 477.866667l-236.8 200.53333299c-27.733333 23.466667-68.266667 19.19999999-89.6-8.53333299-23.466667-27.733333-19.19999999-68.266667 8.53333301-89.6l277.33333399-234.666667c10.666667-10.666667 25.6-14.933333 40.533333-14.933333z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="question in questions" :key="question.id" class="question-row"
              :class="{ active: selectedQuestionId === question.id, selected: selectedQuestions.has(question.id) }"
              @click="handleQuestionClick(question)" @contextmenu.prevent.stop="handleRightClick($event, question)">
              <td class="col-checkbox" @click.stop>
                <input type="checkbox" :checked="selectedQuestions.has(question.id)"
                  @change="handleQuestionSelect(question.id, $event)" class="question-checkbox" />
              </td>
              <td class="col-question">
                <div class="cell-question">
                  <template v-if="isSearchMode && searchTerm">
                    <span v-html="highlightSearchTerm(question.question)"></span>
                  </template>
                  <template v-else>
                    <template v-for="(part, i) in getContentParts(question.question)" :key="question.id + '-' + i">
                      <span v-if="part.type === 'text'">{{ part.text }}</span>
                      <img v-else-if="imgSrc(part.url as string)" :src="imgSrc(part.url as string)"
                        :class="['list-image', invertClass(part.url as string)]" />
                      <span v-else class="image-loading">[图片加载中]</span>
                    </template>
                  </template>
                </div>
                <div v-if="knowledgeFor(question.id).length" class="knowledge-tags">
                  <button
                    v-for="link in knowledgeFor(question.id)"
                    :key="link.node_id"
                    class="knowledge-tag"
                    type="button"
                    :title="`${link.subject_name} · ${link.node_name}`"
                    @click.stop="openKnowledge(link)"
                  >{{ link.node_name }}</button>
                </div>
              </td>
              <td class="col-options">
                <div class="cell-question">
                  <template v-for="(part, i) in getContentParts(question.options || '')"
                    :key="'opt-' + question.id + '-' + i">
                    <span v-if="part.type === 'text'">{{ part.text }}</span>
                    <img v-else-if="imgSrc(part.url as string)" :src="imgSrc(part.url as string)"
                      :class="['list-image', invertClass(part.url as string)]" />
                    <span v-else class="image-loading">[图片加载中]</span>
                  </template>
                </div>
              </td>
              <td class="col-answer">
                <span v-if="!question.answer">暂无答案</span>
                <div v-else class="cell-answer">
                  <template v-for="(part, i) in getContentParts(question.answer)" :key="'ans-' + question.id + '-' + i">
                    <span
                      v-if="part.type === 'text' && isSearchMode && searchTerm"
                      v-html="highlightSearchTerm(part.text || '')"
                    ></span>
                    <span v-else-if="part.type === 'text'">{{ part.text }}</span>
                    <img v-else-if="imgSrc(part.url as string)" :src="imgSrc(part.url as string)"
                      :class="['list-image', invertClass(part.url as string)]" />
                    <span v-else class="image-loading">[图片加载中]</span>
                  </template>
                </div>
              </td>
              <td class="col-type">
                <span
                  v-if="question.question_type"
                  class="type-tag"
                  :class="`type-tag--${typeTagKind(question.question_type)}`"
                >{{ question.question_type }}</span>
                <span v-else class="no-type">-</span>
              </td>
              <td class="col-time">{{ formatTime(question.create_time) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      </transition>
    </div>

    <QuestionDetail v-if="selectedQuestionDetails" :question="selectedQuestionDetails" :show="showDetailOverlay"
      :width="overlayWidth" :is-edit-mode="isEditMode" :edit-question="editFormData.question"
      :edit-options="editFormData.options" :edit-answer="editFormData.answer" :edit-type="editFormData.question_type"
      :is-edit-form-valid="isEditFormValid" :is-saving-edit="isSavingEdit" :is-resizing="isResizing" :format-time="formatTime" @close="closeDetail"
      @toggle-edit="toggleEditMode" @cancel-edit="cancelEdit" @save-edit="saveEdit"
      @update:editQuestion="(v) => editFormData.question = v" @update:editOptions="(v) => editFormData.options = v"
      @update:editAnswer="(v) => editFormData.answer = v" @update:editType="(v) => editFormData.question_type = v"
      @resize-start="startResize" @resize-over="showResizeCursor" @resize-leave="hideResizeCursor" />
  </div>

  <UnifiedContextMenu
    :visible="importMenuOpen"
    :x="importMenuPos.x"
    :y="importMenuPos.y"
    :menu-items="importMenuItems"
    exclusive-key="question-import-menu"
    @item-click="handleImportMenuClick"
    @close="importMenuOpen = false"
  />
  <UnifiedContextMenu
    :visible="exportMenuOpen"
    :x="exportMenuPos.x"
    :y="exportMenuPos.y"
    :menu-items="exportMenuItems"
    exclusive-key="question-export-menu"
    @item-click="handleExportMenuClick"
    @close="exportMenuOpen = false"
  />

  <!-- 题目右键菜单 -->
  <QuestionContextMenu :visible="contextMenu.visible" :x="contextMenu.x" :y="contextMenu.y"
    :can-paste="canPaste" :has-selected-question="selectedQuestion !== null" :is-batch-mode="contextMenu.isBatchMode"
    :selected-count="selectedQuestions.size" @copy-question="copyQuestionToClipboard"
    @copy-answer="copyAnswerToClipboard" @copy="copyQuestion" @cut="cutQuestion" @paste="pasteQuestion"
    @batch-copy="batchCopyQuestions" @batch-cut="batchCutQuestions" @delete="deleteQuestion"
    @batch-delete="batchDeleteQuestions" @close="hideContextMenu" />

  <QuestionBatchDeleteConfirmDialog
    :visible="batchDeleteDialog.visible"
    :count="batchDeleteDialog.count"
    :loading="batchDeleteDialog.loading"
    @confirm="confirmBatchDeleteQuestions"
    @cancel="cancelBatchDeleteQuestions"
  />

  <FolderPickerDialog
    :visible="agentImportPickerVisible"
    :initial-folder-id="agentImportInitialFolderId"
    selection-mode="all"
    @cancel="cancelAgentImportFolder"
    @confirm="confirmAgentImportFolder"
  />

  <!-- 题目编辑器 -->
  <QuestionEditor :visible="showAddQuestionModal" :selected-folder-id="selectedFolderId" @close="hideAddQuestionDialog"
    @submit="handleQuestionSubmit" />
</template>

<script setup lang="ts">
import QuestionContextMenu from './QuestionContextMenu.vue';
import QuestionBatchDeleteConfirmDialog from './QuestionBatchDeleteConfirmDialog.vue';
import QuestionEditor from './QuestionEditor.vue';
import QuestionDetail from './QuestionDetail.vue';
import UnifiedContextMenu, { type MenuItem } from '../../components/ui/UnifiedContextMenu.vue';
import FolderPickerDialog from '../../components/ui/FolderPickerDialog.vue';
import type { AIResponse } from '../../services/app/database'
import { useQuestionList, type Props } from './useQuestionList'

const props = defineProps<Props>();
const emit = defineEmits<{
  'question-select': [question: AIResponse],
  'question-pasted': [],
  'question-added': [],
  'question-updated': [],
  'open-import-dialog': [items: any],
  'refresh': [],
  'folder-path-change': [path: { id: number, name: string }[]]
}>();

const {
  PENDING_CORRECTION_FOLDER_ID, questions, knowledgeByQuestion, loading, hasLoaded, listTransitionName, selectedQuestionId, selectedQuestionDetails, showDetailOverlay, folderPath, knowledgeFor, openKnowledge, loadKnowledgeLinks, currentPage, pageSize, totalQuestions, pageBeforeSearch, searchTerm, isSearchMode, searchDebounceTimer, highlightTerms, createTimeSortOrder, listContentKey, loadGeneration, hasSelectedFolder, parseFolderId, isResizing, overlayWidth, startX, startWidth, importButtonRef, exportButtonRef, importMenuOpen, exportMenuOpen, importMenuPos, exportMenuPos, importMenuItems, exportMenuItems, placeDropdownMenu, toggleImportMenu, handleImportMenuClick, agentImportPickerVisible, pendingAgentImportPath, agentImportInitialFolderId, importOtherFileWithAgent, cancelAgentImportFolder, confirmAgentImportFolder, importSoftwareExportedFile, toggleExportMenu, handleExportMenuClick, getExportQuestions, exportFile, searchOpen, searchInputRef, openSearch, collapseSearch, selectedQuestions, batchDeleteDialog, isAllSelected, isIndeterminate, contextMenu, selectedQuestion, isEditMode, isSavingEdit, editFormData, fillEditForm, resetEditForm, _imageCache, imageSrcMap, blackOnlyMap, getContentParts, imgSrc, invertClass, visibleImageUrls, fetchImages, analyzeImage, isEditFormValid, clipboard, showAddQuestionModal, canPaste, isPendingCorrectionFolder, totalPages, getQuestionCreateTime, sortQuestionListByCreateTime, applyCreateTimeSort, goToPreviousPage, goToNextPage, goToPage, toggleCreateTimeSort, fetchQuestionPage, loadQuestions, refreshData, questionHasImages, applyQuestionSelection, handleQuestionClick, closeDetail, toggleEditMode, cancelEdit, replaceQuestionInList, updateQuestionLocally, removeQuestionLocally, saveEdit, typeTagKind, formatTime, handleQuestionSelect, handleSelectAll, updateSelectAllState, startResize, handleResize, stopResize, showResizeCursor, hideResizeCursor, handleSearch, performSearch, clearSearch, highlightSearchTerm, handleRightClick, handleListRightClick, copyQuestionToClipboard, copyAnswerToClipboard, batchCopyQuestions, batchCutQuestions, deleteQuestion, batchDeleteQuestions, confirmBatchDeleteQuestions, cancelBatchDeleteQuestions, copyQuestion, cutQuestion, pasteQuestion, hideContextMenu, handleClickOutside, showAddQuestionDialog, hideAddQuestionDialog, handleQuestionSubmit, onKnowledgeUpdated
} = useQuestionList(props, emit)

defineExpose({
  refreshData
});

</script>

<style scoped src="./QuestionList.css"></style>
