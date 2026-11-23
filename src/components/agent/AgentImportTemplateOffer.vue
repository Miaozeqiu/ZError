<template>
  <section class="template-offer" aria-label="保存导入算法模板" :aria-busy="busy" @contextmenu.stop>
    <template v-if="offer.status === 'pending'">
      <h3>保存这次的导入算法？</h3>
      <label class="offer-name">模板名称<input v-model="name" class="form-input" maxlength="80" :disabled="busy" /></label>
      <p v-if="error" class="offer-error" role="alert">{{ error }}</p>
      <div class="offer-options" role="group" aria-label="模板保存选项">
        <button v-for="(option, index) in options" :key="option.value" type="button" class="offer-option"
          :class="{ 'is-selected': busy && selectedChoice === option.value }"
          :aria-label="option.label" :disabled="busy || (option.value !== 'skip' && !name.trim())"
          @click="respond(option.value)">
          <span class="option-letter" aria-hidden="true">{{ String.fromCharCode(65 + index) }}</span>
          <span class="option-label">{{ option.label }}</span>
        </button>
      </div>
    </template>
    <p v-else class="offer-receipt" role="status">{{ offer.status === 'saved' ? `已保存导入模板「${offer.name}」` : '本次未保存导入模板' }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import type { ImportTemplateOffer } from '../../services/agent/importTemplateTypes'
import { respondImportTemplateOffer } from '../../services/agent/importTemplateOffers'
const props = defineProps<{ sessionId: string; messageId: string; offer: ImportTemplateOffer }>()
type Choice = 'skip' | 'save' | 'always'
const options: { value: Choice; label: string }[] = [
  { value: 'skip', label: '不保存' },
  { value: 'save', label: '保存' },
  { value: 'always', label: '下次不用问我' },
]
const name = ref(props.offer.name), busy = ref(false), error = ref('')
const selectedChoice = ref<Choice | null>(null)
async function respond(choice: Choice) {
  if (busy.value) return
  busy.value = true; error.value = ''; selectedChoice.value = choice
  try { await respondImportTemplateOffer(props.sessionId, props.messageId, props.offer.id, choice, name.value) }
  catch { error.value = '未能保存，请重试；已导入的题目不受影响。' }
  finally { busy.value = false; selectedChoice.value = null }
}
</script>
<style scoped>
.template-offer {
  width: min(100%, 620px);
  box-sizing: border-box;
  margin: 14px 0;
  padding: 18px 12px 12px;
  border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
  border-radius: 24px;
  background: var(--bg-secondary, #fff);
  box-shadow: 0 3px 12px rgb(0 0 0 / 3%);
  color: var(--text-primary);
}
h3 { margin: 0 6px 16px; font-size: 16px; line-height: 1.4; font-weight: 600; }
.offer-name { display: grid; gap: 7px; margin: 0 6px 14px; color: var(--text-secondary); font-size: 12px; }
.form-input { width: 100%; box-sizing: border-box; min-width: 0; padding: 10px 12px; border: 0; border-radius: 10px; background: var(--bg-tertiary); color: var(--text-primary); font: inherit; font-size: 14px; }
.offer-options { display: grid; gap: 4px; }
.offer-option { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 46px; padding: 8px; border: 0; border-radius: 15px; background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
.offer-option:hover:not(:disabled), .offer-option.is-selected { background: var(--bg-tertiary, #f1f1f1); }
.offer-option:focus-visible { outline: 2px solid var(--color-primary, #007aff); outline-offset: -2px; }
.option-letter { display: grid; place-items: center; flex-shrink: 0; width: 27px; height: 27px; box-sizing: border-box; border: 1px solid color-mix(in srgb, var(--text-primary) 9%, transparent); border-radius: 9px; background: color-mix(in srgb, var(--text-primary) 6%, var(--bg-secondary, #fff)); color: var(--text-secondary); font-size: 14px; font-weight: 500; line-height: 1; }
.option-label { min-width: 0; font-size: 14px; font-weight: 500; line-height: 1.45; overflow-wrap: anywhere; }
.offer-option:disabled { cursor: default; }
.offer-option:disabled:not(.is-selected) { opacity: .45; }
.offer-receipt { margin: 0 6px 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.offer-error { margin: 0 6px 10px; color: var(--color-error, #c2410c); font-size: 12px; line-height: 1.5; }
</style>
