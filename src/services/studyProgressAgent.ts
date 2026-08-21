import { databaseService, type StudyGraphNodeRow } from './database'
import { runTextModel, type ModelToolCall } from './modelRunner'
import { filterProgressUpdates } from '../utils/studyProgressEvidence'
import {
  clampForgettingStage,
  daysSinceReviewed,
  forgettingStageLabel,
  retentionScore,
  reviewedAtFromDaysAgo,
} from '../utils/studyForgetting'

export type StudyProgressEvalResult = {
  updated: number
  subject_id: number
  name?: string
  stages?: { name: string; stage: number; mastery: number }[]
  message: string
  error?: string
}

const running = new Map<number, AbortController>()

const EVAL_SYSTEM = `你是学习掌握度评估助手，只根据对话证据给知识图谱叶子节点标定艾宾浩斯遗忘阶段。不要和用户聊天。

遗忘曲线是多阶段锯齿，不是掌握度 0–3。
阶段（stage 0–6）是复习点，不是分数：
0 刚学（约半天）
1 第 1 天
2 第 2 天
3 第 4 天
4 第 7 天
5 第 15 天
6 第 30 天

每次有效复习：stage 最多 +1（上限 6），days_ago=0。曲线会再抬起，下一段掉得更慢。
days_ago 是距「这次有效学习」的天数，刚学或刚复习都是 0。

规则：
1. 未评估（last=无）且这次刚接触：stage=0，days_ago=0。
2. 已有阶段，这次又讲、又练、用户说复习过/还记得：这是中间复习。stage=min(6, 当前+1)，days_ago=0。禁止打回 0。
3. 用户说以前学过但很久没碰、还大致记得：可维持或 +1；days_ago 用他描述的间隔，说不清就 3–7。
4. 用户说忘了、不会、答错：未评估则 stage=0、days_ago=0；已有阶段则最多降 1，days_ago=0。不要无故升到 4–6。
5. 只更新节（叶子）。章/父节点熟练度由子节点汇总，不要给父节点打 stage。
6. 只评估这次真正讲到、练到、或用户点名的节。画图谱、列出目录、说「基础/入门」、focus 某一章，都不是整章已学。不要把兄弟节、同章其他节、下一章一起标上。没有节名或考点对得上就跳过。一次最多 8 个，宁少勿多。
7. 只调用 apply_study_progress。不要写 mastery。不要输出长文。`

const applyTool = {
  type: 'function',
  function: {
    name: 'apply_study_progress',
    description: '把评估结果写入对应知识点的遗忘阶段。只更新这次能判断的叶子节点，不要整章推断。',
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
              forgetting_stage: { type: 'integer', description: '0–6，复习点。已学过再讲应 +1，不要打回 0' },
              days_ago: { type: 'number', description: '距这次有效学习的天数。刚学或刚复习为 0' },
              reason: { type: 'string' },
            },
            required: ['forgetting_stage'],
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
      '只评估这段文字里真正讲到或练到的叶子。不要按「基础」或同章关系推断。调用 apply_study_progress。',
    ].filter(Boolean).join('\n')

    let applied = 0
    let stages: StudyProgressEvalResult['stages'] = []

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
          last_reviewed_at: reviewedAtFromDaysAgo(Number(item.days_ago)),
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
          .map((node) => ({
            name: node.name,
            stage: clampForgettingStage(node.forgetting_stage),
            mastery: node.mastery,
          }))
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
