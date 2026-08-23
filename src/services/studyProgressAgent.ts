import { databaseService, type StudyGraphNodeRow } from './database'
import { runTextModel, type ModelToolCall } from './modelRunner'
import { filterProgressUpdates } from '../utils/studyProgressEvidence'
import {
  clampForgettingStage,
  daysSinceReviewed,
  forgettingStageLabel,
  parseStudyKind,
  parseStudyQuality,
  retentionScore,
  type StudyEvalKind,
  type StudyEvalQuality,
} from '../utils/studyForgetting'

export type StudyProgressEvalStage = {
  name: string
  stage: number
  mastery: number
  kind?: StudyEvalKind
  quality?: StudyEvalQuality
  retention?: number | null
}

export type StudyProgressEvalResult = {
  updated: number
  subject_id: number
  name?: string
  stages?: StudyProgressEvalStage[]
  message: string
  error?: string
}

const running = new Map<number, AbortController>()

const EVAL_SYSTEM = `你是学习效果评估助手，只根据对话证据给知识图谱叶子节点打分。不要和用户聊天。

遗忘曲线是多阶段指数衰减，不是掌握度 0–3。
阶段（stage 0–6）是当前记忆稳定性：
0 刚学（约半天）
1 第 1 天
2 第 2 天
3 第 4 天
4 第 7 天
5 第 15 天
6 第 30 天

系统会按间隔决定是否晋级，不要自己连跳阶段。
- 同一天反复复习：稳定性不变
- 隔天还记得：可以 +1
- 已经忘了再学：stage -1

每次必须标 kind 和 quality，用来表示这次学习/复习的效果。复习经常达不到 100%。
kind:
- learn：第一次接触、新讲、刚建这个节
- review：再讲、再练、用户说复习/以前学过
quality:
- good：讲清楚且用户跟上、答对、明确说记得 → 保持率从约 100% 起步
- fair：讲了但吃力、半对半错、有印象但不稳 → 从约 70% 起步
- poor：答错、说忘了、完全不会 → 降阶段，从约 40% 起步

规则：
1. 未评估（last=无）且这次刚接触：kind=learn，stage=0。效果好 good，吃力 fair。
2. 已有阶段，这次又讲、又练、用户说还记得：kind=review，stage=min(6, 当前+1)。效果按答题和反馈定。禁止连跳、禁止无故打回 0。
3. 用户说以前学过但很久没碰、还大致记得：kind=review；stage 维持或 +1；days_ago 用他描述的间隔，说不清就 3–7。
4. 用户说忘了、不会、答错：quality=poor。未评估则 kind=learn、stage=0；已有阶段则 kind=review、stage=当前-1。
5. 只更新节（叶子）。章/父节点熟练度由子节点汇总，不要给父节点打 stage。
6. 只评估这次真正讲到、练到、或用户点名的节。画图谱、列出目录、说「基础/入门」、focus 某一章，都不是整章已学。不要把兄弟节、同章其他节、下一章一起标上。没有节名或考点对得上就跳过。一次最多 8 个，宁少勿多。
7. 只调用 apply_study_progress。不要写 mastery。不要输出长文。`

const applyTool = {
  type: 'function',
  function: {
    name: 'apply_study_progress',
    description: '写入这次新学或复习的效果。只更新有直接证据的叶子，不要整章推断。',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              node_id: { type: 'integer' },
              node_name: { type: 'string' },
              kind: { type: 'string', enum: ['learn', 'review'], description: 'learn=首次学习，review=复习' },
              quality: { type: 'string', enum: ['good', 'fair', 'poor'], description: '这次学习/复习的效果' },
              forgetting_stage: { type: 'integer', description: '0–6。记得则当前+1，忘了则当前-1，系统再按间隔决定是否晋级' },
              days_ago: { type: 'number', description: '仅当用户说很久以前学过时填写间隔天数；这次刚学/刚练不要填' },
              reason: { type: 'string' },
            },
            required: ['forgetting_stage', 'kind', 'quality'],
          },
        },
      },
      required: ['updates'],
    },
  },
}

const parseArgs = (raw: string) => {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

const formatNodes = (nodes: StudyGraphNodeRow[]) => {
  const parents = new Set(nodes.map((item) => item.parent_id).filter((id): id is number => id != null))
  return nodes
    .filter((item) => item.parent_id)
    .concat(nodes.filter((item) => !item.parent_id))
    .slice(0, 80)
    .map((item) => {
      const stage = clampForgettingStage(item.forgetting_stage)
      const retention = retentionScore(item)
      const days = item.last_reviewed_at ? daysSinceReviewed(item.last_reviewed_at) : null
      const parent = parents.has(item.id)
      return `- ${item.name} (id=${item.id}${parent ? ', 父节点/勿打分' : ', 叶子'}, stage=${stage} ${forgettingStageLabel(stage)}, 保持=${retention == null ? '未评估' : `${Math.round(retention * 100)}%`}, last=${days == null ? '无' : `${days.toFixed(1)}天前`})`
    })
    .join('\n')
}

const qualityLabel = (quality?: StudyEvalQuality) => {
  if (quality === 'poor') return '效果较弱'
  if (quality === 'fair') return '效果一般'
  return '效果不错'
}

export const formatEvalNotice = (result: StudyProgressEvalResult) => {
  if (result.error) return `掌握度评估没完成：${result.error}`
  const items = (result.stages || []).slice(0, 6)
  if (!result.updated || !items.length) {
    return result.message || '这次讲解或练习里还没有足够证据更新进度。'
  }
  const bits = items.map((item) => {
    const kind = item.kind === 'review' ? '复习' : '新学'
    const retention = item.retention == null ? '' : `，保持约 ${Math.round(item.retention * 100)}%`
    return `${item.name}（${kind}，${qualityLabel(item.quality)}，${forgettingStageLabel(item.stage)}${retention}）`
  })
  const more = result.updated > items.length ? `等 ${result.updated} 个` : ''
  return `已经评估完这次的学习效果：${bits.join('；')}${more}。`
}

export const runStudyProgressEvaluation = async (input: {
  subjectId: number
  hint?: string
  recentTurns?: string
}): Promise<StudyProgressEvalResult> => {
  const subjectId = Number(input.subjectId)
  if (!Number.isFinite(subjectId) || subjectId <= 0) {
    return { updated: 0, subject_id: subjectId, message: '缺少科目', error: '缺少科目' }
  }

  running.get(subjectId)?.abort()
  const abort = new AbortController()
  running.set(subjectId, abort)

  try {
    const payload = await databaseService.getStudyGraph(subjectId)
    if (!payload.nodes.length) {
      return {
        updated: 0,
        subject_id: subjectId,
        name: payload.subject.name,
        message: '这个科目还没有图谱，无法评估。',
      }
    }

    const evidence = [input.hint, input.recentTurns].filter(Boolean).join('\n')
    const prompt = [
      `科目：${payload.subject.name}（subject_id=${subjectId}）`,
      input.hint ? `主助手提示：${String(input.hint).slice(0, 400)}` : '',
      '当前节点：',
      formatNodes(payload.nodes),
      '',
      '最近讲解/练习（画图谱、目录列举不算已学）：',
      String(input.recentTurns || '').trim().slice(0, 4000) || '（无）',
      '',
      '只评估这段文字里真正讲到或练到的叶子。给每个节点标 kind（learn/review）和 quality（good/fair/poor）。不要按「基础」或同章关系推断。调用 apply_study_progress。',
    ].filter(Boolean).join('\n')

    let applied = 0
    let stages: StudyProgressEvalStage[] = []

    await runTextModel(prompt, () => undefined, {
      timeoutMs: 90 * 1000,
      tools: [applyTool],
      systemPrompt: EVAL_SYSTEM,
      useAgentModel: true,
      signal: abort.signal,
      maxRounds: 3,
      executeTool: async (call: ModelToolCall) => {
        if (call.name !== 'apply_study_progress') {
          return JSON.stringify({ error: '只能调用 apply_study_progress' })
        }
        const args = parseArgs(call.arguments)
        const raw = Array.isArray(args.updates) ? args.updates : []
        const updates = raw.slice(0, 16).map((item: any) => ({
          id: Number(item.node_id || item.id) || undefined,
          name: String(item.node_name || item.name || '').trim() || undefined,
          forgetting_stage: clampForgettingStage(item.forgetting_stage ?? item.stage),
          quality: parseStudyQuality(item.quality),
          kind: parseStudyKind(item.kind || item.type),
          days_ago: Number.isFinite(Number(item.days_ago)) ? Number(item.days_ago) : undefined,
          remembered: parseStudyQuality(item.quality) !== 'poor',
        })).filter((item) => item.id || item.name)
        if (!updates.length) return JSON.stringify({ error: 'updates 不能为空' })
        const { allowed, rejected } = filterProgressUpdates(payload.nodes, updates, evidence)
        if (!allowed.length) {
          return JSON.stringify({
            updated: 0,
            rejected,
            message: '这些节点在讲解/练习里没有直接证据。只提交真正讲到或练到的节名（叶子），不要按「基础」或目录推断整章。',
          })
        }
        const next = await databaseService.applyStudyProgress(subjectId, allowed)
        applied = allowed.length
        stages = next.nodes
          .filter((node) => allowed.some((item) => item.id === node.id || item.name === node.name))
          .slice(0, 8)
          .map((node) => {
            const update = allowed.find((item) => item.id === node.id || item.name === node.name)
            return {
              name: node.name,
              stage: clampForgettingStage(node.forgetting_stage),
              mastery: node.mastery,
              kind: update?.kind ? parseStudyKind(update.kind) : undefined,
              quality: update?.quality ? parseStudyQuality(update.quality) : undefined,
              retention: retentionScore(node),
            }
          })
        return JSON.stringify({
          updated: applied,
          rejected,
          subject: next.subject.name,
          nodes: stages,
        })
      },
    })

    if (abort.signal.aborted) {
      return { updated: 0, subject_id: subjectId, name: payload.subject.name, message: '评估已取消', error: '已取消' }
    }

    window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId } }))
    return {
      updated: applied,
      subject_id: subjectId,
      name: payload.subject.name,
      stages,
      message: applied
        ? `已按遗忘曲线更新 ${applied} 个知识点。`
        : '这次对话里没有足够证据更新掌握度。',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { updated: 0, subject_id: subjectId, message, error: message }
  } finally {
    if (running.get(subjectId) === abort) running.delete(subjectId)
  }
}
