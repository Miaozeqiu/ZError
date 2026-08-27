<template>
  <aside class="campus-col campus-sidebar">
    <div class="pane-header">
      <div class="header-title">{{ sidebarTitle }}</div>
      <button
        v-if="isLoggedIn && identity?.campus"
        class="header-action"
        type="button"
        @click="$emit('reload')"
      >刷新</button>
    </div>

    <div v-if="!isLoggedIn" class="list-empty">登录后查看本校课程</div>

    <template v-else-if="!identity?.campus">
      <input
        :value="schoolQuery"
        class="search-input"
        placeholder="搜索学校"
        @input="$emit('update:schoolQuery', ($event.target as HTMLInputElement).value)"
      />
      <div class="item-list">
        <button
          v-for="school in filteredSchools"
          :key="school.id"
          class="list-item"
          type="button"
          :disabled="bindingId != null"
          @click="$emit('choose-school', school)"
        >
          <div class="item-name">{{ school.name }}</div>
        </button>
        <div v-if="!schoolsLoading && !filteredSchools.length" class="list-empty">没有匹配的学校</div>
        <div v-if="schoolsLoading" class="list-empty">加载学校中…</div>
      </div>
    </template>

    <template v-else>
      <div class="item-list">
        <button
          v-for="course in courses"
          :key="course.id"
          class="list-item"
          type="button"
          :class="{ 'is-selected': course.id === selectedCourseId }"
          @click="$emit('select-course', course.id)"
        >
          <div class="item-name">{{ course.name }}</div>
          <div v-if="course.status === 'pending'" class="item-meta">待审核</div>
        </button>
        <div v-if="!coursesLoading && !courses.length" class="list-empty">还没有课程</div>
        <div v-if="coursesLoading" class="list-empty">加载课程中…</div>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import type { CampusCourse, CampusIdentity, CampusSchool } from '../../services/app/campus'

defineProps<{
  sidebarTitle: string
  isLoggedIn: boolean
  identity: CampusIdentity | null
  schoolQuery: string
  filteredSchools: CampusSchool[]
  schoolsLoading: boolean
  bindingId: number | null
  courses: CampusCourse[]
  selectedCourseId: number | null
  coursesLoading: boolean
}>()

defineEmits<{
  reload: []
  'update:schoolQuery': [value: string]
  'choose-school': [school: CampusSchool]
  'select-course': [id: number]
}>()
</script>

<style scoped>
.campus-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
}

.campus-sidebar {
  width: 240px;
  flex-shrink: 0;
}

.pane-header {
  position: relative;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.pane-header::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 1px;
  background: color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
  transform: scaleY(0.5);
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-action {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.header-action:hover:not(:disabled) {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.search-input {
  box-sizing: border-box;
  width: calc(100% - 16px);
  margin: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: inherit;
  font-size: 12px;
}

.item-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.list-item {
  width: 100%;
  display: block;
  text-align: left;
  border: none;
  background: transparent;
  color: inherit;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.list-item:hover,
.list-item.is-selected {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.item-name {
  font-size: 13px;
  line-height: 1.4;
}

.item-meta,
.list-empty {
  font-size: 12px;
  color: var(--text-secondary, #718096);
}

.list-empty {
  padding: 16px 12px;
}
</style>
