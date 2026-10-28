/** 图谱落盘与 Agent 回包：宿主写文件，模型只提交增量补丁。 */
import {
  cloneGraph,
  type SiteGraphData,
  type SiteGraphPatchResult,
} from './siteGraphCore'
import { websitePrimaryHost, websiteIdentityForHost, websiteAccountId, websiteHostPattern } from '../agent/websiteIdentity'

const GRAPH_FILE_RE = /(^|\/)site-graph\.json$/i

export const siteGraphWriteBlocked = (path: string) => {
  const rel = String(path || '').replace(/\\/g, '/').trim()
  if (!GRAPH_FILE_RE.test(rel)) return ''
  return '图谱用 browser_site_graph 一条条改（upsert_site / upsert_node / upsert_edge）。宿主会增量保存到 site-graph.json。'
}

export const siteGraphSkillTarget = (site: { id?: string; host?: string }) => {
  const id = String(site.id || '').trim()
  const host = websitePrimaryHost(String(site.host || '').trim())
  if (id === 'chaoxing' && host && host !== 'chaoxing.com') throw new Error('其他网站的图谱不能保存到学习通')
  if ((id === 'chaoxing' && !host) || host === 'chaoxing.com') {
    return { skillId: 'chaoxing', path: 'site-graph.json' }
  }
  const folder = host || id
  if (!folder) return { skillId: 'site-learn', path: '' }
  return { skillId: 'site-learn', path: `sites/${folder}/site-graph.json` }
}

export const serializeSiteGraph = (site: SiteGraphData): SiteGraphData => {
  const data = cloneGraph(site)
  const identity = websiteIdentityForHost(data.host)
  if (identity?.loginHosts.length) {
    data.id = websiteAccountId(identity.host)
    data.host = identity.host
    data.hostPattern = websiteHostPattern(identity.host)
  }
  return {
    id: data.id,
    name: data.name,
    host: data.host,
    hostPattern: data.hostPattern,
    notes: [...(data.notes || [])],
    nodes: data.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      path: node.path,
      summary: node.summary,
      ...(node.structure ? { structure: node.structure } : {}),
      ...(node.frame ? { frame: node.frame } : {}),
      ...(node.frames?.length ? { frames: node.frames } : {}),
      ...(node.sketch ? { sketch: node.sketch } : {}),
      row: node.row,
      col: node.col,
      patterns: [...(node.patterns || [])],
      parserIds: [...(node.parserIds || [])],
    })),
    edges: data.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      ...(edge.kind ? { kind: edge.kind } : {}),
    })),
  }
}

export const persistSiteGraph = async (site: SiteGraphData) => {
  const target = siteGraphSkillTarget(site)
  if (!target.path) throw new Error('图谱缺少 host，无法保存')
  const text = `${JSON.stringify(serializeSiteGraph(site), null, 2)}\n`
  const { saveSkillFileContent } = await import('../agent/agentSkills')
  await saveSkillFileContent(target.skillId, target.path, text)
  return target
}

const siteDigest = (site: SiteGraphData) => ({
  id: site.id,
  name: site.name,
  host: site.host,
  nodes: site.nodes.map((node) => node.id),
  edges: site.edges.map((edge) => ({ from: edge.from, to: edge.to, label: edge.label })),
})

const READ_ACTIONS = new Set(['list', 'get'])

export const presentSiteGraphPatch = (
  result: SiteGraphPatchResult,
  extra?: {
    action?: string
    saved?: { skillId: string; path: string }
    saveError?: string
  },
) => {
  const action = String(extra?.action || '').trim()
  const savedHint = extra?.saved
    ? `已保存到 ${extra.saved.skillId} / ${extra.saved.path}。`
    : extra?.saveError
      ? `内存已改，落盘失败：${extra.saveError}。可再 browser_site_graph action=save。`
      : ''
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      hint: result.hint,
    }
  }
  if (READ_ACTIONS.has(action) || !result.persist) {
    return {
      ...result,
      hint: [result.hint, '改节点/边用 upsert_*，每次自动保存。不要 write_agent_skill_file 写 site-graph.json。'].filter(Boolean).join(' '),
    }
  }
  return {
    ok: true,
    saved: Boolean(extra?.saved) && !extra?.saveError,
    skillId: extra?.saved?.skillId,
    path: extra?.saved?.path,
    error: extra?.saveError,
    changed: result.changed,
    site: result.site ? siteDigest(result.site) : undefined,
    hint: [result.hint, savedHint, '不要再整文件写 site-graph.json。'].filter(Boolean).join(' '),
  }
}
