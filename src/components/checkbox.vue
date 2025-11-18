<style scoped>
  .custom-checkbox {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    line-height: 1;
  }

  .custom-checkbox input {
    display: none;
  }

  .custom-checkbox svg {
    overflow: visible;
    display: inline-block;
    vertical-align: middle;
  }

  .custom-checkbox__path {
    fill: none;
    stroke: currentColor;
    stroke-width: 6;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease;
    stroke-dasharray: 241 9999999;
    stroke-dashoffset: 0;
  }

  .custom-checkbox input:checked ~ svg .custom-checkbox__path {
    stroke-dasharray: 70.5096664428711 9999999;
    stroke-dashoffset: -262.2723388671875;
  }
</style>

<template>
  <label class="custom-checkbox">
    <input type="checkbox" :checked="modelValue" @change="onChange">
    <svg viewBox="0 0 64 64" height="1.25em" width="1.25em">
      <path d="M 0 16 V 56 A 8 8 90 0 0 8 64 H 56 A 8 8 90 0 0 64 56 V 8 A 8 8 90 0 0 56 0 H 8 A 8 8 90 0 0 0 8 V 16 L 32 48 L 64 16 V 8 A 8 8 90 0 0 56 0 H 8 A 8 8 90 0 0 0 8 V 56 A 8 8 90 0 0 8 64 H 56 A 8 8 90 0 0 64 56 V 16" pathLength="575.0541381835938" class="custom-checkbox__path"></path>
    </svg>
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
const onChange = (e: Event) => {
  emit('update:modelValue', (e.target as HTMLInputElement).checked)
}
</script>
