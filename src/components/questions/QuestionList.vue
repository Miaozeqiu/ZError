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
          <div v-if="importMenuOpen" class="import-menu">
            <button class="menu-item" @click="importSoftwareExportedFile">导入ZError导出的文件</button>
          </div>

          <!-- 导出按钮 -->
          <div 
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
            <div v-if="exportMenuOpen" class="export-menu" @click.stop>
              <button class="menu-item" @click="exportFile('csv')">导出为 .csv</button>
              <button class="menu-item" @click="exportFile('xlsx')">导出为 .xlsx</button>
              <button class="menu-item" @click="exportFile('docx')">导出为 .docx</button>
              <button class="menu-item" @click="exportFile('pdf')">导出为 .pdf</button>
              <button class="menu-item" @click="exportFile('txt')">导出为 .txt</button>
            </div>
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

      <div v-else-if="questions.length === 0" class="empty-state" @contextmenu.prevent="handleListRightClick">
        <div class="empty-icon">📝</div>
        <div class="empty-text">暂无题目</div>
        <div class="empty-subtext">{{ isPendingCorrectionFolder ? '当前没有待修正题目' : '选择一个文件夹查看题目' }}</div>
      </div>

      <div v-else class="question-table-container" @contextmenu.prevent="handleListRightClick">
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
              <th class="col-time">
                <span class="th-header">
                  <svg class="th-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="14"
                    height="14">
                    <path
                      d="M833 128c0-53-43-96-96-96h-16c-53 0-96 43-96 96H400c0-53-43-96-96-96h-16c-53 0-96 43-96 96H64c-35.3 0-64 28.7-64 64v736c0 35.3 28.7 64 64 64h896c35.3 0 64-28.7 64-64V192c0-35.3-28.7-64-64-64H833zM729 96c22.1 0 40 17.9 40 40v80c0 22.1-17.9 40-40 40s-40-17.9-40-40v-80c0-22.1 17.9-40 40-40z m-433 0c22.1 0 40 17.9 40 40v80c0 22.1-17.9 40-40 40s-40-17.9-40-40v-80c0-22.1 17.9-40 40-40z m632 832H96c-17.7 0-32-14.3-32-32V448h896v448c0 17.7-14.3 32-32 32z m32-544H64V224c0-17.7 14.3-32 32-32h96v32c0 53 43 96 96 96h16c53 0 96-43 96-96v-32h225v24c0 57.4 46.6 104 104 104s104-46.6 104-104v-24h95c17.7 0 32 14.3 32 32v160z"
                      fill="currentColor"></path>
                  </svg>
                  创建时间
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
                <span v-if="question.question_type" class="type-tag">{{ question.question_type }}</span>
                <span v-else class="no-type">-</span>
              </td>
              <td class="col-time">{{ formatTime(question.create_time) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
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

  <!-- 题目右键菜单 -->
  <QuestionContextMenu v-if="contextMenu.visible" :visible="contextMenu.visible" :x="contextMenu.x" :y="contextMenu.y"
    :can-paste="canPaste" :has-selected-question="selectedQuestion !== null" :is-batch-mode="contextMenu.isBatchMode"
    :selected-count="selectedQuestions.size" @copy-question="copyQuestionToClipboard"
    @copy-answer="copyAnswerToClipboard" @copy="copyQuestion" @cut="cutQuestion" @paste="pasteQuestion"
    @batch-copy="batchCopyQuestions" @batch-cut="batchCutQuestions" @delete="deleteQuestion"
    @batch-delete="batchDeleteQuestions" />

  <!-- 题目编辑器 -->
  <QuestionEditor :visible="showAddQuestionModal" :selected-folder-id="selectedFolderId" @close="hideAddQuestionDialog"
    @submit="handleQuestionSubmit" />
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { databaseService, type AIResponse } from '../../services/database';
import { isTauriEnvironment } from '../../services/environmentDetector';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { generateExportData, type ExportFormat } from '../../utils/exporter';
import { parseSoftwareExportedFile } from '../../utils/importer';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import QuestionContextMenu from './QuestionContextMenu.vue';
import QuestionEditor from './QuestionEditor.vue';
import QuestionDetail from './QuestionDetail.vue';

interface Props {
  selectedFolderId?: string | null;
  collapseTrigger?: number;
}

const props = defineProps<Props>();
const PENDING_CORRECTION_FOLDER_ID = '-1';

const emit = defineEmits<{
  'question-select': [question: AIResponse],
  'question-pasted': [],
  'question-added': [],
  'question-updated': [],
  'open-import-dialog': [items: any],
  'refresh': [],
  'folder-path-change': [path: { id: number, name: string }[]]
}>();

const questions = ref<AIResponse[]>([]);
const loading = ref(false);
const selectedQuestionId = ref<number | null>(null);
const selectedQuestionDetails = ref<AIResponse | null>(null);
const showDetailOverlay = ref(false);
const folderPath = ref<{ id: number, name: string }[]>([]);

// folderPath 变化时通知父组件
watch(folderPath, (path) => {
  emit('folder-path-change', path)
}, { deep: true })

// 在切换顶层 tab 时，收起题目详情面板
watch(() => props.collapseTrigger, () => {
  if (showDetailOverlay.value) {
    closeDetail();
  }
});

// 分页相关状态
const currentPage = ref(1);
const pageSize = ref(20); // 每页显示20条题目
const allQuestions = ref<AIResponse[]>([]); // 存储所有题目数据

// 搜索相关状态
const searchTerm = ref('');
const isSearchMode = ref(false);
const searchDebounceTimer = ref<number | null>(null);
const originalQuestions = ref<AIResponse[]>([]); // 保存原始题目列表
const highlightTerms = ref<string[]>([]); // 用于高亮的关键词

// 拖拽相关状态
const isResizing = ref(false);
const overlayWidth = ref(400); // 默认宽度400px
const startX = ref(0);
const startWidth = ref(0);

// 导入菜单
const importMenuOpen = ref(false);
const toggleImportMenu = () => {
  if (exportMenuOpen.value) exportMenuOpen.value = false;
  importMenuOpen.value = !importMenuOpen.value;
};
const importSoftwareExportedFile = async () => {
  if (!isTauriEnvironment()) {
    alert('此功能仅在 Tauri 应用中可用');
    importMenuOpen.value = false;
    return;
  }

  try {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{
        name: 'Supported Files',
        extensions: ['csv', 'xlsx', 'docx', 'txt', 'pdf']
      }]
    });

    if (selected) {
      const path = Array.isArray(selected) ? selected[0] : selected;
      loading.value = true;
      try {
        const items = await parseSoftwareExportedFile(path);
        console.log('Parsed items:', items);
        
        // 触发全局事件打开导入对话框
        await tauriEmit('open-import-dialog', { items });
        
      } catch (e) {
        console.error('解析文件失败:', e);
        alert('解析文件失败: ' + (e as Error).message);
      } finally {
        loading.value = false;
      }
    }
  } catch (e) {
    console.error('打开文件失败:', e);
  }
  
  importMenuOpen.value = false;
};


// 导出菜单
const exportMenuOpen = ref(false);
const toggleExportMenu = () => {
  if (importMenuOpen.value) importMenuOpen.value = false;
  exportMenuOpen.value = !exportMenuOpen.value;
};

const exportFile = async (format: 'csv' | 'xlsx' | 'docx' | 'pdf' | 'txt') => {
  exportMenuOpen.value = false;
  
  if (allQuestions.value.length === 0) {
    alert('当前没有题目可导出');
    return;
  }

  if (!isTauriEnvironment()) {
    alert('此功能仅在 Tauri 应用中可用');
    return;
  }

  try {
    // 1. 弹出保存对话框
    const currentDate = new Date().toISOString().split('T')[0];
    let folderName = '题目列表';
    
    // 获取当前文件夹名称
    if (folderPath.value.length > 0) {
      folderName = folderPath.value[folderPath.value.length - 1].name;
    }
    
    const suggestedName = `${folderName}_${currentDate}`;
    const filePath = await save({
      filters: [{
        name: format.toUpperCase() + ' 文件',
        extensions: [format]
      }],
      defaultPath: `${suggestedName}.${format}`
    });

    if (!filePath) return; // 用户取消

    loading.value = true;

    // 2. 生成数据
    const data = await generateExportData(allQuestions.value, format as ExportFormat);

    // 3. 写入文件
    await writeFile(filePath, data);
    
    alert(`导出成功！文件已保存至: ${filePath}`);
    console.log(`导出成功: ${filePath}`);
  } catch (error) {
    console.error('导出失败:', error);
    alert(`导出失败: ${(error as Error).message}`);
  } finally {
    loading.value = false;
  }
};

// 搜索展开/收起
const searchOpen = ref(false);
const searchInputRef = ref<HTMLInputElement | null>(null);
const openSearch = async () => {
  searchOpen.value = true;
  await nextTick();
  searchInputRef.value?.focus();
};
const collapseSearch = () => {
  searchOpen.value = false;
};
// 批量选择相关状态
const selectedQuestions = ref<Set<number>>(new Set());
const isAllSelected = ref(false);
const isIndeterminate = ref(false);

// 右键菜单相关状态
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  isBatchMode: false
});
const selectedQuestion = ref<AIResponse | null>(null);

// 编辑模式相关状态
const isEditMode = ref(false);
const isSavingEdit = ref(false);
const editFormData = ref({
  question: '',
  options: '',
  answer: '',
  question_type: ''
});

const fillEditForm = (question: AIResponse) => {
  editFormData.value = {
    question: question.question || '',
    options: question.options || '',
    answer: question.answer || '',
    question_type: question.question_type || ''
  };
};

const resetEditForm = () => {
  editFormData.value = {
    question: '',
    options: '',
    answer: '',
    question_type: ''
  };
};

interface Part { type: 'text' | 'image'; text?: string; url?: string }

// 模块级持久缓存，组件销毁后仍保留，避免重复请求
const _imageCache = new Map<string, string>()

const imageSrcMap = ref<Record<string, string>>({})
const blackOnlyMap = ref<Record<string, boolean>>({})
const urlRegex = /(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|webp|gif))(?:\b|(?=\s)|$)/gi

const getContentParts = (text: string): Part[] => {
  const parts: Part[] = []
  let lastIndex = 0
  const regex = new RegExp(urlRegex.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    const off = m.index
    if (off > lastIndex) parts.push({ type: 'text', text: text.slice(lastIndex, off) })
    parts.push({ type: 'image', url: m[0] })
    lastIndex = off + m[0].length
  }
  if (lastIndex < text.length) parts.push({ type: 'text', text: text.slice(lastIndex) })
  return parts.length ? parts : [{ type: 'text', text }]
}

const imgSrc = (u: string) => imageSrcMap.value[u]
const invertClass = (u: string) => blackOnlyMap.value[u] ? 'invert-on-dark' : ''

const visibleImageUrls = computed(() => {
  const urls: string[] = []
  for (const q of questions.value) {
    const partsQ = getContentParts(q.question || '')
    for (const p of partsQ) if (p.type === 'image' && p.url) urls.push(p.url)
    const partsO = getContentParts(q.options || '')
    for (const p of partsO) if (p.type === 'image' && p.url) urls.push(p.url)
    const partsA = getContentParts(q.answer || '')
    for (const p of partsA) if (p.type === 'image' && p.url) urls.push(p.url)
  }
  return Array.from(new Set(urls))
})

const fetchImages = async (urls: string[]) => {
  if (!urls.length) { imageSrcMap.value = {}; return }
  for (const url of urls) {
    // 先查模块级缓存
    if (_imageCache.has(url)) {
      if (!imageSrcMap.value[url]) {
        imageSrcMap.value = { ...imageSrcMap.value, [url]: _imageCache.get(url)! }
      }
      continue
    }
    try {
      const dataUrl = await invoke<string>('fetch_image_as_base64', { url })
      _imageCache.set(url, dataUrl)
      imageSrcMap.value = { ...imageSrcMap.value, [url]: dataUrl }
      analyzeImage(url, dataUrl)
    } catch { }
  }
}

const analyzeImage = (url: string, src: string) => {
  try {
    const img = new Image()
    img.onload = () => {
      const w = 32
      const h = 32
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data
      let nonTransparent = 0
      let hasNonBlack = false
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3]
        if (a < 10) continue
        nonTransparent++
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const bright = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if (bright > 30) { hasNonBlack = true; break }
      }
      blackOnlyMap.value = { ...blackOnlyMap.value, [url]: nonTransparent > 0 && !hasNonBlack }
    }
    img.src = src
  } catch { }
}

watch(questions, async () => {
  imageSrcMap.value = {}
  await fetchImages(visibleImageUrls.value)
}, { immediate: true })

// 计算属性
const isEditFormValid = computed(() => {
  return editFormData.value.question.trim() !== '' && editFormData.value.answer.trim() !== '';
});

// 剪贴板相关状态
const clipboard = ref<{
  question?: AIResponse | null;
  questions?: AIResponse[];
  operation: 'copy' | 'cut' | null;
}>({
  question: null,
  questions: [],
  operation: null
});

// 添加题目对话框相关状态
const showAddQuestionModal = ref(false);

const canPaste = computed(() => {
  return !!(clipboard.value.question !== null || (clipboard.value.questions && clipboard.value.questions.length > 0));
});

const isPendingCorrectionFolder = computed(() => props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID);

// 分页相关计算属性
const totalQuestions = computed(() => allQuestions.value.length);
const totalPages = computed(() => Math.ceil(totalQuestions.value / pageSize.value));

// 当前页显示的题目
const paginatedQuestions = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return allQuestions.value.slice(start, end);
});

// 监听分页数据变化，更新显示的题目
watch(paginatedQuestions, (newQuestions) => {
  questions.value = newQuestions;
}, { immediate: true });

// 分页控制方法
const goToPreviousPage = () => {
  if (currentPage.value > 1) {
    currentPage.value--;
  }
};

const goToNextPage = () => {
  if (currentPage.value < totalPages.value) {
    currentPage.value++;
  }
};

const goToPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page;
  }
};





const loadQuestions = async (folderId?: string | null) => {
  try {
    loading.value = true;

    console.log('QuestionList: loadQuestions 被调用', { folderId, type: typeof folderId });

    // 清除搜索状态
    if (isSearchMode.value) {
      searchTerm.value = '';
      isSearchMode.value = false;
      originalQuestions.value = [];
    }

    // 重置分页到第一页
    currentPage.value = 1;
    
    // 切换文件夹时清空选择状态
    selectedQuestions.value.clear();
    updateSelectAllState();

    if (folderId === PENDING_CORRECTION_FOLDER_ID) {
      console.log('QuestionList: 加载待修正题目');
      folderPath.value = [{ id: -1, name: '待修正' }];
      allQuestions.value = await databaseService.getPendingCorrectionQuestions();
    } else if (folderId && folderId !== 'error') {
      const folderIdNum = parseInt(folderId);
      console.log('QuestionList: 解析文件夹ID', { original: folderId, parsed: folderIdNum });

      // 获取文件夹路径
      try {
        folderPath.value = await databaseService.getFolderPath(folderIdNum);
        console.log('获取文件夹路径:', folderPath.value);
      } catch (error) {
        console.error('获取文件夹路径失败:', error);
        folderPath.value = [];
      }

      // 使用新的方法获取文件夹及其所有子文件夹的题目
      allQuestions.value = await databaseService.getQuestionsFromFolderAndSubfolders(folderIdNum);
    } else {
      console.log('QuestionList: 获取所有题目');
      folderPath.value = [];
      // 如果没有选择文件夹，显示所有题目
      allQuestions.value = await databaseService.getAIResponses();
    }

    console.log('题目加载成功:', allQuestions.value.length);
  } catch (error) {
    console.error('加载题目失败:', error);
    allQuestions.value = [];
    folderPath.value = [];
  } finally {
    loading.value = false;
  }
};

// 刷新当前分页数据（不重置页码），并暴露给父组件调用
const refreshData = async () => {
  try {
    loading.value = true;

    // 如果处于搜索模式，重新执行一次搜索以刷新结果
    if (isSearchMode.value && searchTerm.value.trim()) {
      await performSearch();
      return;
    }

    const savedPage = currentPage.value;

    if (props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID) {
      folderPath.value = [{ id: -1, name: '待修正' }];
      allQuestions.value = await databaseService.getPendingCorrectionQuestions();
    } else if (props.selectedFolderId && props.selectedFolderId !== 'error') {
      const folderIdNum = parseInt(props.selectedFolderId);
      try {
        folderPath.value = await databaseService.getFolderPath(folderIdNum);
      } catch (error) {
        console.error('获取文件夹路径失败:', error);
        folderPath.value = [];
      }
      allQuestions.value = await databaseService.getQuestionsFromFolderAndSubfolders(folderIdNum);
    } else {
      folderPath.value = [];
      allQuestions.value = await databaseService.getAIResponses();
    }

    // 恢复到刷新前的页码（若超出范围则回退到最后一页）
    const pages = Math.max(1, Math.ceil(allQuestions.value.length / pageSize.value));
    currentPage.value = Math.min(savedPage, pages);
  } catch (error) {
    console.error('刷新题目失败:', error);
  } finally {
    loading.value = false;
  }
};

defineExpose({
  refreshData
});

const questionHasImages = (question: AIResponse) => {
  return [question.question, question.options, question.answer].some(text =>
    getContentParts(text || '').some(part => part.type === 'image')
  );
};

const applyQuestionSelection = (question: AIResponse, startInEditMode = false) => {
  selectedQuestionId.value = question.id;
  selectedQuestionDetails.value = question;

  if (startInEditMode) {
    fillEditForm(question);
    isEditMode.value = true;
    return;
  }

  isEditMode.value = false;
  resetEditForm();
};

const handleQuestionClick = (question: AIResponse) => {
  console.log('点击题目，开始动画');

  const startInEditMode = !questionHasImages(question);

  // 如果已经有详情面板显示，直接更新内容，不触发动画
  if (selectedQuestionDetails.value) {
    applyQuestionSelection(question, startInEditMode);
  } else {
    // 如果没有详情面板，显示面板并触发动画
    applyQuestionSelection(question, startInEditMode);
    showDetailOverlay.value = false; // 先设置为 false
    // 使用 nextTick 确保 DOM 元素创建后再触发动画
    nextTick(() => {
      console.log('DOM 更新完成，触发动画');
      // 再使用 setTimeout 确保浏览器渲染了初始状态
      setTimeout(() => {
        showDetailOverlay.value = true;
      }, 10);
    });
  }

  emit('question-select', question);
};

const closeDetail = () => {
  showDetailOverlay.value = false;
  isEditMode.value = false; // 关闭详情时退出编辑模式
  // 等待动画完成后再清除数据
  setTimeout(() => {
    selectedQuestionId.value = null;
    selectedQuestionDetails.value = null;
  }, 300); // 与 CSS transition 时间一致
};

// 编辑模式相关方法
const toggleEditMode = () => {
  if (!selectedQuestionDetails.value) return;

  if (!isEditMode.value) {
    fillEditForm(selectedQuestionDetails.value);
    isEditMode.value = true;
  } else {
    isEditMode.value = false;
  }
};

const cancelEdit = () => {
  isEditMode.value = false;
  resetEditForm();
};

const replaceQuestionInList = (list: AIResponse[], updatedQuestion: AIResponse) => {
  const questionIndex = list.findIndex(q => q.id === updatedQuestion.id);
  if (questionIndex !== -1) {
    list.splice(questionIndex, 1, updatedQuestion);
  }
};

const updateQuestionLocally = (updatedQuestion: AIResponse) => {
  replaceQuestionInList(questions.value, updatedQuestion);
  replaceQuestionInList(allQuestions.value, updatedQuestion);
  replaceQuestionInList(originalQuestions.value, updatedQuestion);

  if (selectedQuestion.value?.id === updatedQuestion.id) {
    selectedQuestion.value = updatedQuestion;
  }

  selectedQuestionDetails.value = updatedQuestion;
};

const removeQuestionLocally = (questionId: number) => {
  const removeFromList = (list: AIResponse[]) => {
    const questionIndex = list.findIndex(q => q.id === questionId);
    if (questionIndex !== -1) {
      list.splice(questionIndex, 1);
    }
  };

  removeFromList(questions.value);
  removeFromList(allQuestions.value);
  removeFromList(originalQuestions.value);
  selectedQuestions.value.delete(questionId);
  updateSelectAllState();

  if (selectedQuestionId.value === questionId) {
    closeDetail();
  }
};

const saveEdit = async () => {
  if (!selectedQuestionDetails.value || !isEditFormValid.value || isSavingEdit.value) return;

  try {
    isSavingEdit.value = true;

    const wasPendingCorrection = !!selectedQuestionDetails.value.is_pending_correction;
    const updatedQuestion = {
      ...selectedQuestionDetails.value,
      question: editFormData.value.question.trim(),
      options: editFormData.value.options.trim(),
      answer: editFormData.value.answer.trim(),
      question_type: editFormData.value.question_type.trim(),
      is_pending_correction: false
    };

    await databaseService.updateQuestion(updatedQuestion.id, {
      question: updatedQuestion.question,
      options: updatedQuestion.options || null,
      answer: updatedQuestion.answer,
      question_type: updatedQuestion.question_type
    });

    if (isPendingCorrectionFolder.value) {
      removeQuestionLocally(updatedQuestion.id);
      isEditMode.value = false;
    } else {
      updateQuestionLocally(updatedQuestion);
      isEditMode.value = false;
    }

    if (wasPendingCorrection) {
      emit('question-updated');
    }

    console.log('题目更新成功');
  } catch (error) {
    console.error('更新题目失败:', error);
  } finally {
    isSavingEdit.value = false;
  }
};

const formatTime = (timeStr?: string): string => {
  if (!timeStr) return '';
  try {
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (error) {
    console.error('时间格式化错误:', error);
    return timeStr;
  }
};

// 批量选择相关方法
const handleQuestionSelect = (questionId: number, event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.checked) {
    selectedQuestions.value.add(questionId);
  } else {
    selectedQuestions.value.delete(questionId);
  }
  updateSelectAllState();
};

const handleSelectAll = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.checked) {
    // 全选 - 仅选择当前页的题目
    questions.value.forEach(question => {
      selectedQuestions.value.add(question.id);
    });
  } else {
    // 取消全选 - 仅取消当前页的题目
    questions.value.forEach(question => {
      selectedQuestions.value.delete(question.id);
    });
  }
  updateSelectAllState();
};

const updateSelectAllState = () => {
  const currentQuestions = questions.value;
  if (currentQuestions.length === 0) {
    isAllSelected.value = false;
    isIndeterminate.value = false;
    return;
  }

  // 计算当前页选中的题目数量
  let selectedCountInCurrentPage = 0;
  for (const q of currentQuestions) {
    if (selectedQuestions.value.has(q.id)) {
      selectedCountInCurrentPage++;
    }
  }

  if (selectedCountInCurrentPage === 0) {
    isAllSelected.value = false;
    isIndeterminate.value = false;
  } else if (selectedCountInCurrentPage === currentQuestions.length) {
    isAllSelected.value = true;
    isIndeterminate.value = false;
  } else {
    isAllSelected.value = false;
    isIndeterminate.value = true;
  }
};

// 监听题目列表变化，更新选择状态
watch(questions, () => {
  // 清除不存在的题目选择状态
  const existingIds = new Set(questions.value.map(q => q.id));
  const toRemove: number[] = [];
  selectedQuestions.value.forEach(id => {
    if (!existingIds.has(id)) {
      toRemove.push(id);
    }
  });
  toRemove.forEach(id => selectedQuestions.value.delete(id));

  updateSelectAllState();
});

// 拖拽相关方法
const startResize = (e: MouseEvent) => {
  isResizing.value = true;
  startX.value = e.clientX;
  startWidth.value = overlayWidth.value;

  // 添加全局事件监听
  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);

  // 添加拖拽时的全局样式
  document.body.classList.add('resizing');

  // 防止文本选择
  e.preventDefault();
};

const handleResize = (e: MouseEvent) => {
  if (!isResizing.value) return;

  const deltaX = startX.value - e.clientX; // 向左拖拽为正值
  const newWidth = startWidth.value + deltaX;

  // 设置最小和最大宽度限制
  const minWidth = 300;
  const maxWidth = window.innerWidth * 0.8;

  overlayWidth.value = Math.max(minWidth, Math.min(maxWidth, newWidth));
};

const stopResize = () => {
  isResizing.value = false;

  // 移除全局事件监听
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);

  // 移除拖拽时的全局样式
  document.body.classList.remove('resizing');
  document.body.style.cursor = '';
};

const showResizeCursor = () => {
  if (!isResizing.value) {
    document.body.style.cursor = 'ew-resize';
  }
};

const hideResizeCursor = () => {
  if (!isResizing.value) {
    document.body.style.cursor = '';
  }
};

// 监听选中的文件夹变化
watch(() => props.selectedFolderId, (newFolderId) => {
  loadQuestions(newFolderId);
}, { immediate: true });

// 搜索相关方法
const handleSearch = () => {
  // 清除之前的防抖定时器
  if (searchDebounceTimer.value) {
    clearTimeout(searchDebounceTimer.value);
  }

  // 设置新的防抖定时器
  searchDebounceTimer.value = setTimeout(() => {
    performSearch();
  }, 300) as unknown as number;
};

const performSearch = async () => {
  if (!searchTerm.value.trim()) {
    clearSearch();
    return;
  }

  try {
    loading.value = true;
    isSearchMode.value = true;

    // 如果还没有保存原始数据，先保存
    if (originalQuestions.value.length === 0 && questions.value.length > 0) {
      originalQuestions.value = [...questions.value];
    }

    // 获取当前选中的文件夹ID
    const currentFolderId =
      props.selectedFolderId && props.selectedFolderId !== PENDING_CORRECTION_FOLDER_ID
        ? parseInt(props.selectedFolderId)
        : undefined;

    // 获取用于高亮的关键词（进行分词）
    try {
      const segments = await invoke<string[]>('segment_text', { text: searchTerm.value.trim() });
      if (segments && segments.length > 0) {
        highlightTerms.value = segments;
        console.log('获取分词关键词:', segments);
      } else {
        highlightTerms.value = searchTerm.value.trim().split(/\s+/).filter(t => t.length > 0);
      }
    } catch (error) {
      console.warn('获取分词关键词失败:', error);
      highlightTerms.value = searchTerm.value.trim().split(/\s+/).filter(t => t.length > 0);
    }

    // 执行搜索
    if (props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID) {
      const keyword = searchTerm.value.trim().toLowerCase();
      questions.value = allQuestions.value.filter(question =>
        question.question.toLowerCase().includes(keyword)
      );
    } else {
      questions.value = await databaseService.searchQuestionsByTitle(searchTerm.value.trim(), currentFolderId);
    }

    console.log(`搜索"${searchTerm.value}"找到 ${questions.value.length} 条结果`);
  } catch (error) {
    console.error('搜索失败:', error);
  } finally {
    loading.value = false;
  }
};

const clearSearch = () => {
  searchTerm.value = '';
  isSearchMode.value = false;
  highlightTerms.value = [];

  // 清除防抖定时器
  if (searchDebounceTimer.value) {
    clearTimeout(searchDebounceTimer.value);
    searchDebounceTimer.value = null;
  }

  // 恢复原始题目列表
  if (originalQuestions.value.length > 0) {
    questions.value = [...originalQuestions.value];
    originalQuestions.value = [];
  } else {
    // 如果没有原始数据，重新加载
    loadQuestions(props.selectedFolderId);
  }
};

// 高亮搜索关键词
const highlightSearchTerm = (text: string): string => {
  if (!searchTerm.value.trim()) {
    return text;
  }

  // Use highlightTerms if available, otherwise split searchTerm
  let terms = highlightTerms.value;
  if (terms.length === 0) {
    terms = searchTerm.value.trim().split(/\s+/).filter(t => t.length > 0);
  }
  
  if (terms.length === 0) return text;

  // Escape special regex characters in terms
  const escapedTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
};

// 右键菜单处理函数
const handleRightClick = (event: MouseEvent, question: AIResponse) => {
  event.preventDefault();

  // 如果有批量选中的题目，显示批量操作菜单
  if (selectedQuestions.value.size > 0) {
    // 如果右键的题目不在选中列表中，将其添加到选中列表
    if (!selectedQuestions.value.has(question.id)) {
      selectedQuestions.value.add(question.id);
      updateSelectAllState();
    }

    // 显示批量操作菜单
    selectedQuestion.value = null; // 清除单个选择
    contextMenu.value = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      isBatchMode: true
    };
  } else {
    // 单个题目右键菜单
    selectedQuestion.value = question;
    contextMenu.value = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      isBatchMode: false
    };
  }
};

// 处理列表空白处的右键菜单
const handleListRightClick = (event: MouseEvent) => {
  event.preventDefault();
  // 在空白处右键时，不选择任何题目
  selectedQuestion.value = null;
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    isBatchMode: false
  };
};

// 复制题目到剪贴板
const copyQuestionToClipboard = async () => {
  if (selectedQuestion.value) {
    try {
      await navigator.clipboard.writeText(selectedQuestion.value.question);
      console.log('题目已复制到剪贴板');
    } catch (error) {
      console.error('复制题目失败:', error);
    }
  }
  hideContextMenu();
};

// 复制答案到剪贴板
const copyAnswerToClipboard = async () => {
  if (selectedQuestion.value) {
    try {
      const answer = selectedQuestion.value.answer || '暂无答案';
      await navigator.clipboard.writeText(answer);
      console.log('答案已复制到剪贴板');
    } catch (error) {
      console.error('复制答案失败:', error);
    }
  }
  hideContextMenu();
};

// 批量复制题目
const batchCopyQuestions = () => {
  if (selectedQuestions.value.size > 0) {
    const selectedQuestionsList = questions.value.filter(q => selectedQuestions.value.has(q.id));
    clipboard.value = {
      questions: selectedQuestionsList,
      operation: 'copy'
    };
    console.log(`已复制 ${selectedQuestionsList.length} 个题目，可以粘贴到其他文件夹`);
  }
  hideContextMenu();
};

// 批量剪切题目
const batchCutQuestions = () => {
  if (selectedQuestions.value.size > 0) {
    const selectedQuestionsList = questions.value.filter(q => selectedQuestions.value.has(q.id));
    clipboard.value = {
      questions: selectedQuestionsList,
      operation: 'cut'
    };
    console.log(`已剪切 ${selectedQuestionsList.length} 个题目，可以移动到其他文件夹`);
  }
  hideContextMenu();
};

// 删除单个题目
const deleteQuestion = async () => {
  if (!selectedQuestion.value) {
    hideContextMenu();
    return;
  }

  try {
    await databaseService.deleteQuestion(selectedQuestion.value.id);
    console.log('题目删除成功');
    // 重新加载题目列表
    await loadQuestions();
  } catch (error) {
    console.error('删除题目失败:', error);
    alert('删除题目失败: ' + (error as Error).message);
  }
  hideContextMenu();
};

// 批量删除题目
const batchDeleteQuestions = async () => {
  if (selectedQuestions.value.size === 0) {
    hideContextMenu();
    return;
  }

  const selectedQuestionsList = questions.value.filter(q => selectedQuestions.value.has(q.id));
  const questionIds = selectedQuestionsList.map(q => q.id);

  if (confirm(`确定要删除选中的 ${questionIds.length} 个题目吗？此操作不可撤销。`)) {
    try {
      await databaseService.deleteQuestions(questionIds);
      console.log(`成功删除 ${questionIds.length} 个题目`);
      // 清空选中状态
      selectedQuestions.value.clear();
      // 重新加载题目列表
      await loadQuestions();
    } catch (error) {
      console.error('批量删除题目失败:', error);
      alert('批量删除题目失败: ' + (error as Error).message);
    }
  }
  hideContextMenu();
};

// 复制题目（用于粘贴到其他文件夹）
const copyQuestion = () => {
  if (selectedQuestion.value) {
    clipboard.value = {
      question: selectedQuestion.value,
      operation: 'copy'
    };
    console.log('题目已复制，可以粘贴到其他文件夹');
  }
  hideContextMenu();
};

// 剪切题目（用于移动到其他文件夹）
const cutQuestion = () => {
  if (selectedQuestion.value) {
    clipboard.value = {
      question: selectedQuestion.value,
      operation: 'cut'
    };
    console.log('题目已剪切，可以移动到其他文件夹');
  }
  hideContextMenu();
};

// 粘贴题目到当前文件夹
const pasteQuestion = async () => {
  if ((!clipboard.value.question && (!clipboard.value.questions || clipboard.value.questions.length === 0)) || !props.selectedFolderId) {
    hideContextMenu();
    return;
  }

  if (props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID) {
    alert('待修正文件夹仅用于查看已标记题目，不能直接粘贴到这里');
    hideContextMenu();
    return;
  }

  try {
    const targetFolderId = parseInt(props.selectedFolderId);

    // 处理批量粘贴
    if (clipboard.value.questions && clipboard.value.questions.length > 0) {
      if (clipboard.value.operation === 'copy') {
        // 批量复制操作
        for (const question of clipboard.value.questions) {
          await databaseService.copyQuestionToFolder(question.id, targetFolderId);
        }
        console.log(`已复制 ${clipboard.value.questions.length} 个题目到当前文件夹`);
      } else if (clipboard.value.operation === 'cut') {
        // 批量剪切操作
        for (const question of clipboard.value.questions) {
          await databaseService.moveQuestionToFolder(question.id, targetFolderId);
        }
        console.log(`已移动 ${clipboard.value.questions.length} 个题目到当前文件夹`);
        // 剪切后清空剪贴板
        clipboard.value = { question: null, questions: [], operation: null };
      }
    }
    // 处理单个粘贴
    else if (clipboard.value.question) {
      if (clipboard.value.operation === 'copy') {
        // 复制操作：创建新题目
        await databaseService.copyQuestionToFolder(clipboard.value.question.id, targetFolderId);
        console.log('题目已复制到当前文件夹');
      } else if (clipboard.value.operation === 'cut') {
        // 剪切操作：移动题目
        await databaseService.moveQuestionToFolder(clipboard.value.question.id, targetFolderId);
        console.log('题目已移动到当前文件夹');
        // 剪切后清空剪贴板
        clipboard.value = { question: null, questions: [], operation: null };
      }
    }

    // 清除选中状态
    selectedQuestions.value.clear();
    updateSelectAllState();

    // 使用nextTick确保DOM更新完成后再刷新
    await nextTick();
    await loadQuestions(props.selectedFolderId);

    // 发射事件通知父组件刷新文件夹数据
    emit('question-pasted');
  } catch (error) {
    console.error('粘贴题目失败:', error);
  }

  hideContextMenu();
};

// 隐藏右键菜单
const hideContextMenu = () => {
  contextMenu.value.visible = false;
  selectedQuestion.value = null;
};

// 点击其他地方隐藏右键菜单
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as Element;
  if (contextMenu.value.visible) {
    const menuElement = document.querySelector('.context-menu');
    if (menuElement && menuElement.contains(target)) {
      return;
    }
    hideContextMenu();
  }
  if (importMenuOpen.value) {
    const importBtn = document.querySelector('.import-icon-button');
    const importMenu = document.querySelector('.import-menu');
    if ((importBtn && importBtn.contains(target)) || (importMenu && importMenu.contains(target))) {
      return;
    }
    importMenuOpen.value = false;
  }
  if (exportMenuOpen.value) {
    const exportBtn = document.querySelector('.export-icon-button');
    const exportMenu = document.querySelector('.export-menu');
    if ((exportBtn && exportBtn.contains(target)) || (exportMenu && exportMenu.contains(target))) {
      return;
    }
    exportMenuOpen.value = false;
  }
};

// 显示添加题目对话框
const showAddQuestionDialog = () => {
  if (props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID) {
    alert('待修正文件夹仅用于查看已标记题目，不能直接新增题目');
    return;
  }

  showAddQuestionModal.value = true;
};

// 隐藏添加题目对话框
const hideAddQuestionDialog = () => {
  showAddQuestionModal.value = false;
};

// 处理题目提交
const handleQuestionSubmit = async (questionData: any) => {
  try {
    console.log('提交题目数据:', questionData);

    // 调用数据库服务保存题目
    await databaseService.addQuestion(questionData);

    // 关闭对话框
    hideAddQuestionDialog();

    // 重新加载题目列表
    await loadQuestions(props.selectedFolderId);

    // 发出事件通知父组件刷新文件夹统计
    emit('question-added');

    console.log('题目添加成功');
  } catch (error) {
    console.error('添加题目失败:', error);
  }
};

// 生命周期钩子
onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.question-list {
  height: 100%;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* border-left: 1px solid #e5e5e5; */
}

.list-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
  background-color: var(--bg-secondary);
}

/* 分页控制器样式 */
.pagination-container {
  display: flex;
  align-items: center;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 8px;
  /* background-color: var(--bg-primary); */
  /* border: 1px solid var(--border-color); */
  border-radius: 6px;
  /* padding: 4px; */
}

.pagination-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 2px;
}

.pagination-btn:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.pagination-btn:disabled {
  color: var(--text-disabled);
  cursor: not-allowed;
  opacity: 0.5;
}

.page-info {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
  min-width: 40px;
  text-align: center;
  padding: 0 4px;
}

.question-count-info {
  font-size: 12px;
  color: var(--ql-count-info-text);
  white-space: nowrap;
  /* margin-left: 16px; */
}

/* 搜索框样式 */
.search-container {
  /* margin-top: 12px; */
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.search-left-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.search-input {
  width: var(--search-input-width, 180px);
  flex: 0 0 auto;
  padding: 8px 0px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  background-color: transparent;
  transition: border-color 0.2s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--border-color);
  box-shadow: 0 0 0 3px var(--shadow-input);
}

.search-input::placeholder {
  color: var(--question-detail-search-placeholder);
}

.search-expand-enter-active,
.search-expand-leave-active {
  transition: width 150ms ease, opacity 150ms ease;
}

.search-expand-enter-from,
.search-expand-leave-to {
  width: 0;
  opacity: 0;
}

.search-expand-enter-to,
.search-expand-leave-from {
  width: var(--search-input-width, 180px);
  opacity: 1;
}

.clear-button {
  padding: 6px 8px;
  background-color: var(--question-detail-clear-btn-bg);
  color: var(--question-detail-clear-btn-text);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background-color 0.2s ease;
  min-width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-button:hover {
  background-color: var(--question-detail-clear-btn-hover-bg);
  color: var(--question-detail-clear-btn-hover-text);
}

.add-question-button {
  padding: 6px;
  width: 30px;
  height: 30px;
  background-color: var(--add-btn-icon-bg);
  color: var(--add-btn-icon-color);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.add-question-button svg {
  width: 16px;
  height: 16px;
}

.add-question-button:hover {
  background-color: var(--add-btn-icon-hover-bg);
}

/* 搜索图标按钮 */
.search-icon-button {
  user-select: none;
  transition: background 20ms ease-in;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0px;
  height: 28px;
  width: 28px;
  padding: 0px;
  border-radius: 6px;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  color: var(--ql-th-text);
  flex-shrink: 0;
}

.search-icon-button:hover {
  background: var(--hover-bg);
}

.search-icon-button:focus {
  outline: none;
  /* box-shadow: 0 0 0 2px var(--border-focus); */
}

.magnifying-glass-small {
  width: 16px;
  height: 16px;
  display: block;
  fill: currentColor;
  flex-shrink: 0;
}

.import-icon-button,
.refresh-icon-button {
  user-select: none;
  transition: background 20ms ease-in;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0px;
  height: 28px;
  width: 28px;
  padding: 0px;
  border-radius: 6px;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  color: var(--ql-th-text);
  flex-shrink: 0;
  position: relative;
}

.import-icon {
  width: 16px;
  height: 16px;
  display: block;
  fill: currentColor;
  flex-shrink: 0;
}

.import-icon-button:hover,
.import-icon-button.active,
.refresh-icon-button:hover {
  background: var(--hover-bg);
}

.import-icon-button:hover::after {
  content: '导入';
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  z-index: 1000;
}

/* 当菜单打开时，隐藏 tooltip */
.import-icon-button.active::after {
  display: none;
}

.import-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  z-index: 1000;
  padding: 6px 0;
  min-width: 160px;
}

.import-menu .menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  cursor: pointer;
}

.import-menu .menu-item:hover {
  background: var(--hover-bg);
}

.export-icon-button {
  user-select: none;
  transition: background 20ms ease-in;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0px;
  height: 28px;
  width: 28px;
  padding: 0px;
  border-radius: 6px;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  color: var(--ql-th-text);
  flex-shrink: 0;
  position: relative;
}

.export-icon-button:hover,
.export-icon-button.active {
  background: var(--hover-bg);
}

.export-icon-button:hover::after {
  content: '导出';
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  z-index: 1000;
}

/* 当菜单打开时，隐藏 tooltip */
.export-icon-button.active::after {
  display: none;
}

.export-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  z-index: 1000;
  padding: 6px 0;
  min-width: 160px;
}

.export-menu .menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  cursor: pointer;
}

.export-menu .menu-item:hover {
  background: var(--hover-bg);
}

.search-info {
  margin-top: 0;
  font-size: 12px;
  color: var(--question-detail-search-info-text);
  font-style: italic;
  white-space: nowrap;
}

/* 搜索高亮样式 */
.search-highlight {
  background-color: var(--question-detail-search-highlight-bg);
  color: var(--question-detail-search-highlight-text);
  padding: 1px 2px;
  border-radius: 2px;
  font-weight: 600;
}

.list-content {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--ql-empty-text);
  margin-bottom: 8px;
}

.empty-subtext {
  font-size: 14px;
  color: var(--ql-empty-subtext);
}

.question-table-container {
  width: 100%;
  overflow-x: auto;
}

.question-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  position: relative;
  table-layout: fixed;
}

.question-table thead {
  background-color: var(--ql-th-bg);
  border-bottom: 2px solid var(--border-primary);
}

.question-table th {
  padding: 12px 8px;
  text-align: left;
  font-weight: 500;
  color: var(--ql-th-text);
  border-bottom: 1px solid var(--border-primary);
  white-space: nowrap;
  position: relative;
}

.question-table th .th-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.question-table th .th-header .th-icon {
  width: 14px;
  height: 14px;
  fill: currentColor;
  color: var(--ql-th-icon);
  flex-shrink: 0;
}

/* 放大题目内容与答案列的图标尺寸 */
.question-table th.col-question .th-header .th-icon,
.question-table th.col-answer .th-header .th-icon {
  width: 16px;
  height: 16px;
}

/* 表头复选框列居中 */
.question-table th.col-checkbox {
  text-align: center;
  vertical-align: middle;
}

/* 表头的树形分割线 */
.question-table th:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 20%;
  bottom: 20%;
  width: 1px;
  background: var(--ql-divider);
}

.question-table tbody tr {
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: background-color 0.2s ease;
  position: relative;
}

.question-table tbody tr:hover {
  background-color: var(--ql-row-hover-bg);
}

.question-table tbody tr.active {
  background-color: var(--ql-row-active-bg);
  border-color: var(--ql-row-active-border);
}

.question-table tbody tr.selected {
  background-color: var(--ql-row-selected-bg);
}

.question-table td {
  padding: 12px 8px;
  vertical-align: middle;
  border-bottom: 1px solid var(--border-primary);
  position: relative;
}

/* 表格数据行的树形分割线 */
.question-table tbody tr td:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--ql-table-divider);
  opacity: 0.6;
}

/* 悬停时的分割线效果 */
.question-table tbody tr:hover td:not(:last-child)::after {
  background: var(--ql-table-divider-hover);
  opacity: 0.8;
}

/* 选中行的分割线效果 */
.question-table tbody tr.active td:not(:last-child)::after {
  background: var(--ql-table-divider-active);
  opacity: 1;
}

/* 多选行的分割线效果 */
.question-table tbody tr.selected td:not(:last-child)::after {
  background: var(--ql-table-divider-selected);
  opacity: 0.9;
}

.col-id {
  width: 80px;
  font-weight: 600;
  color: var(--ql-id-text);
}

.col-question {
  min-width: 200px;
  max-width: 250px;
  word-break: break-word;
  line-height: 1.4;
}

.col-options {
  min-width: 200px;
  max-width: 250px;
  word-break: break-word;
  line-height: 1.4;
}

.col-question span {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.col-answer {
  min-width: 250px;
  max-width: 400px;
}

.col-answer > span {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.cell-question,
.cell-answer {
  white-space: pre-wrap;
}

.cell-question span,
.cell-answer span {
  display: inline;
  white-space: pre-wrap;
  overflow: visible;
  text-overflow: clip;
}

.list-image {
  display: inline;
  max-width: 100%;
  border-radius: 6px;
  margin: 0 4px;
  vertical-align: middle;
}

.image-loading {
  display: inline;
  color: var(--text-secondary);
  margin: 0 4px;
  vertical-align: middle;
}

:root[data-theme="dark"] .list-image.invert-on-dark {
  filter: invert(1) brightness(1.8) contrast(1.05);
}

.col-type {
  width: 100px;
}

.col-type span {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.col-time {
  width: 140px;
  font-size: 12px;
  color: var(--ql-time-text);
}

.type-tag {
  padding: 3px 8px;
  background-color: var(--ql-type-tag-bg);
  color: var(--ql-type-tag-text);
  border: 1px solid var(--ql-type-tag-border);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
  box-sizing: border-box;
}

.col-type .type-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  max-width: 100%;
}

.no-type {
  color: var(--ql-no-type-text);
  font-style: italic;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--ql-loading-spinner-track);
  border-top: 3px solid var(--ql-loading-spinner-head);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.loading-text {
  font-size: 14px;
  color: var(--ql-loading-text);
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

/* 题目详情覆盖层样式 */

/* 复选框列样式 */
.col-checkbox {
  width: 40px;
  min-width: 40px;
  max-width: 40px;
  text-align: center;
  padding: 8px !important;
}

/* 复选框样式 */
.col-checkbox input[type="checkbox"] {
  width: 16px !important;
  height: 16px !important;
  min-width: 16px !important;
  min-height: 16px !important;
  max-width: 16px !important;
  max-height: 16px !important;
  background-color: var(--ql-checkbox-bg);
  border: 1px solid var(--ql-checkbox-border);
  border-radius: 4px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  position: relative;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
  box-sizing: border-box;
  flex-shrink: 0;
  display: inline-block;
  vertical-align: middle;
  margin: 0;
  padding: 0;
}

.col-checkbox input[type="checkbox"]:hover {
  background-color: var(--ql-checkbox-hover-bg);
  border-color: var(--ql-checkbox-hover-border);
}

.col-checkbox input[type="checkbox"]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--ql-checkbox-focus-ring);
}

.col-checkbox input[type="checkbox"]:checked,
.col-checkbox input[type="checkbox"]:indeterminate {
  background-color: var(--ql-checkbox-checked-bg);
  border-color: var(--ql-checkbox-checked-border);
}

.col-checkbox input[type="checkbox"]:checked::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -56%);
  color: var(--ql-checkbox-checkmark);
  font-size: 11px;
  font-weight: 700;
}

.col-checkbox input[type="checkbox"]:indeterminate::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 2px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background-color: var(--ql-checkbox-checkmark);
}

/* 使表头 SVG 颜色与文字一致 */
.question-table th .th-header .th-icon {
  color: var(--ql-th-text);
}
</style>
