import { databaseService } from '../app/database'
import { emitStudyGraphStream } from '../study/graphStream'
import { clampForgettingStage, forgettingStageLabel, retentionScore } from '../../utils/study/studyForgetting'
import { graphFromPayload, graphToMermaid } from '../../utils/study/studyGraph'

export const pickSubjectRef = (args: Record<string, unknown> | any) => {
  const id = Number(args?.subject_id ?? args?.subjectId ?? args?.id)
  const name = String(args?.subject_name ?? args?.subjectName ?? args?.name ?? '').trim()
  return {
    id: Number.isFinite(id) && id > 0 ? id : undefined,
    name: name || undefined,
  }
}

export const lastStudyFocus = new Map<number, { nodeName: string; nodeId?: number }>()

export const rememberStudyFocus = (subjectId: number, nodeName?: string, nodeId?: number) => {
  const name = String(nodeName || '').trim()
  if (!(Number.isFinite(subjectId) && subjectId > 0) || !name) return
  lastStudyFocus.set(subjectId, {
    nodeName: name,
    nodeId: Number(nodeId) > 0 ? Number(nodeId) : undefined,
  })
}

export const openStudyGraphPane = (subjectId: number, nodeName?: string, nodeId?: number) => {
  if (!Number.isFinite(subjectId) || subjectId <= 0) return
  rememberStudyFocus(subjectId, nodeName, nodeId)
  window.dispatchEvent(new CustomEvent('open-study-graph', {
    detail: {
      subjectId,
      expand: true,
      ...(String(nodeName || '').trim() ? { nodeName: String(nodeName).trim() } : {}),
      ...(Number(nodeId) > 0 ? { nodeId: Number(nodeId) } : {}),
    },
  }))
}

export const WRITE_GRAPH_HINT = '图谱是空的，请调用 patch_knowledge_graph，用 add 传入 3–8 个节点。第一批只写章名；之后给章补节，parent_key 填章的中文名。不要传空参数，不要一次塞整张 mermaid，不要加定理或论文名叶子。'

export const KEEP_GRAPH_HINT = '已有图谱。先看现有节点再 patch 增删改，不要 set_knowledge_graph，不要清空重画。只有用户明确说重画、推倒重来、全部重做时才整图替换。'

export const GRAPH_QUALITY = `用 patch_knowledge_graph 分批改图，不要一次写整张 mermaid。图谱必须像教材目录，不要像散落考点云。
- 三层：科目 → 章（8–12 个章名）→ 节（每章 2–4 个节名）。到节为止
- 已有图谱时：先 get_knowledge_graph，只补缺的章/节或按用户点名增删改，保留已有节点和遗忘进度
- 空图才从零画：第一批只加章；之后每批给 1–2 章补节，parent_key 填章名；每批 3–8 个，大约 28–45 个
- 节点名用教材目录口吻，例如「劳动需求」「短期劳动需求」「人力资本」
- 禁止空泛桶：学科基础、核心概念、方法与应用、基础知识、综合应用、概述、其他
- 禁止把定理、模型、公式、论文平铺成叶子，例如不要单独列出「保留工资定理」「明瑟方程」「Oaxaca-Blinder」「Card-Krueger」`

export const graphSubjectHint = (name: string) => {
  if (/英语|CET|四级|六级|考研英语/i.test(name)) {
    return `「${name}」按应试教材目录展开（章=题型，节=技能），必须画到这一细度（可增删，不能更粗）：
听力 → 场景与身份 / 数字与时间 / 建议与请求 / 转折与否定 / 主旨把握 / 细节定位 / 态度与语气 / 讲座结构
阅读 → 主旨大意 / 事实细节 / 推理判断 / 词义猜测 / 段落匹配 / 词性判断 / 搭配与衔接
词汇语法 → 词缀词根 / 近义辨析 / 短语动词 / 定语从句 / 状语从句 / 非谓语动词 / 虚拟语气 / 时态语态
翻译 → 文化负载词 / 无主句处理 / 定语后置 / 被动与使役
写作 → 现象解释 / 观点论证 / 书信通知或图表描述 / 逻辑衔接词`
  }
  if (/劳动经济|人力资源经济|劳动和人力/i.test(name)) {
    return `「${name}」按本科劳动经济学教材目录展开，不要按考研/论文考点平铺。先写 8–12 个章，再给每章 2–4 个节。章应覆盖这类主题（用教材章名，不要照抄成论文关键词）：导论、劳动力市场的基本图景与概念、劳动需求、劳动供给、人力资本与教育、内部劳动力市场与薪酬、劳动力流动与工作搜寻、失业、工会与劳动关系、收入分配与公共政策。节名用小节口吻，例如「短期劳动需求」「收入与闲暇」「劳动参与率」「工作搜寻」，不要把定理、方程、分解方法、经典论文名做成叶子。`
  }
  if (/经济|金融|会计|管理|社会学|政治/i.test(name)) {
    return `「${name}」按该学科本科教材目录展开：8–12 个章名，每章 2–4 个节名。叶子是节标题，不是模型名、公式名或论文名。不要「基础 / 核心 / 应用」三大块。`
  }
  return `「${name}」按该学科真实教材目录展开：先写章，再写节。叶子是节标题，不是定理名、公式名或论文名。不要「基础 / 核心 / 应用」三大块。`
}

export const notifyStudyGraph = (subjectId?: number) => {
  window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId } }))
}

export const publishGraph = (
  payload: Awaited<ReturnType<typeof databaseService.getStudyGraph>>,
  markDrawing?: () => void,
  streaming = true,
) => {
  markDrawing?.()
  emitStudyGraphStream({
    subjectId: payload.subject.id,
    mermaid: graphToMermaid(graphFromPayload(payload)),
    streaming,
  })
  notifyStudyGraph(payload.subject.id)
}

export const resolveSubject = async (id?: number, name?: string, fallbackSingle = false) => {
  const subjects = await databaseService.listStudySubjects()
  if (Number.isFinite(id) && Number(id) > 0) {
    const found = subjects.find((item) => Number(item.id) === Number(id))
    if (found) return found
  }
  const keyword = String(name || '').trim()
  if (keyword) {
    const exact = subjects.filter((item) => item.name === keyword)
    if (exact.length === 1) return exact[0]
    if (exact.length > 1) throw new Error(`有多个同名科目「${keyword}」，请改用 subject_id`)
    const fuzzy = subjects.filter((item) => item.name.includes(keyword))
    if (fuzzy.length === 1) return fuzzy[0]
    if (fuzzy.length > 1) throw new Error(`有多个科目名称包含「${keyword}」，请改用 subject_id`)
  }
  if (fallbackSingle && subjects.length === 1) return subjects[0]
  return null
}

export const summarizeSubjects = (subjects: Awaited<ReturnType<typeof databaseService.listStudySubjects>>) =>
  subjects.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    node_count: item.node_count,
    progress: Math.round((item.progress || 0) * 100),
  }))

export const summarizeGraph = (payload: Awaited<ReturnType<typeof databaseService.getStudyGraph>>) => {
  const parentIds = new Set(
    payload.nodes.map((item) => item.parent_id).filter((id): id is number => id != null),
  )
  return {
    subject: payload.subject,
    node_count: payload.nodes.length,
    note: 'forgetting_stage 是 0–6 复习点。父节点熟练度由子节点汇总。',
    nodes: payload.nodes.map((item) => {
      const stage = clampForgettingStage(item.forgetting_stage)
      const retention = retentionScore(item)
      return {
        id: item.id,
        key: item.node_key,
        name: item.name,
        summary: String(item.summary || '').slice(0, 80),
        forgetting_stage: stage,
        stage_label: forgettingStageLabel(stage),
        retention: retention == null ? null : Math.round(retention * 100),
        last_reviewed_at: item.last_reviewed_at || null,
        parent_id: item.parent_id || null,
        leaf: !parentIds.has(item.id),
      }
    }),
  }
}

const SCATTERED_LEAF = /定理|方程|分解|Card-?Krueger|Oaxaca|Blinder|CES|生产函数|明瑟|保留工资|弹性系数/

export const graphBuildMessage = (
  payload: Awaited<ReturnType<typeof databaseService.getStudyGraph>>,
  added: number,
) => {
  const nodes = payload.nodes
  const roots = nodes.filter((item) => !item.parent_id)
  const bareChapters = roots.filter((root) => !nodes.some((item) => item.parent_id === root.id))
  const scattered = nodes.filter((item) => SCATTERED_LEAF.test(item.name))
  if (scattered.length >= 4) {
    return `已添加 ${added} 个，当前共 ${nodes.length} 个，但有不少定理/论文名叶子，图谱会散落。请停止再加这类叶子，改为按教材目录给缺节的章补 2–4 个节名。`
  }
  if (roots.length < 8 && nodes.length < 20) {
    return `已添加 ${added} 个，当前共 ${nodes.length} 个。请先把章写全（目标 8–12 个章名），再给每章补节。继续 patch_knowledge_graph，不要停。`
  }
  if (bareChapters.length) {
    const names = bareChapters.slice(0, 6).map((item) => item.name).join('、')
    return `已添加 ${added} 个，当前共 ${nodes.length} 个。这些章还没有节：${names}。请继续给它们各加 2–4 个节名，不要加定理或论文名。`
  }
  if (nodes.length < 28 && added >= 3) {
    return `已添加 ${added} 个，当前共 ${nodes.length} 个。若用户是从零画图，继续给尚未展开的章补 2–4 个节；若只是补某几处，现在可以停。`
  }
  return `已添加 ${added} 个，当前共 ${nodes.length} 个。不要整图重画。用一两句话说明改了什么。`
}

export const resolveSubjectFromArgs = async (
  raw: Record<string, unknown> | any,
  attachedId?: number,
) => {
  const ref = pickSubjectRef(raw)
  let subject = await resolveSubject(ref.id, ref.name, true)
  if (!subject && attachedId && attachedId > 0) {
    subject = await resolveSubject(attachedId)
  }
  return subject
}
