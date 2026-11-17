import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classifyBrowserPage } from '../../../src/services/agent/browserLoop'
import { applyMeasuredGraphHeights, courseTabOf, noteCourseTab, resetCourseTab, siteGraphViewFromData, graphCardsOverlap } from '../../../src/services/browser/siteGraph'
import { activeFrameOf, hydrateSite, pageRoleOfNode, parserPageKindOf, siteGraphNodeForUrl, siteGraphUrlFromFrames, type SiteGraphData } from '../../../src/services/browser/siteGraphCore'
import { chaoxingPageRole } from '../../../src/services/platform/chaoxing/nav'

const data = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/services/agent/skills/bundled/chaoxing/site-graph.json'),
    'utf8',
  ),
) as SiteGraphData

describe('site graph space iframe', () => {
  it('我教的课 / 我学的课是空间里的页签，不是单独节点', () => {
    const site = hydrateSite(data)
    expect(site.nodes.map((node) => node.id)).not.toContain('taught')
    expect(site.nodes.map((node) => node.id)).not.toContain('courses')
    const space = site.nodes.find((node) => node.id === 'space')
    expect(space?.frames?.map((item) => item.tab)).toEqual(['我教的课', '我学的课'])
    expect(space?.frame?.name).toBe('#frame_content')
    expect(site.nodes.find((node) => node.id === 'course')?.parserIds).toEqual(['course'])
    expect(site.nodes.find((node) => node.id === 'course')?.sketch?.kind).toBe('host-side')
    expect(site.nodes.find((node) => node.id === 'course')?.sketch?.side).toEqual(['任务', '章节', '作业'])
    expect(site.nodes.find((node) => node.id === 'study')?.sketch?.kind).toBe('nested')
    expect(site.nodes.find((node) => node.id === 'space')?.sketch?.kind).toBe('host-tabs')
    expect(site.nodes.find((node) => node.id === 'space')?.sketch?.pane).toBe('/visit/interaction')
    expect(site.nodes.find((node) => node.id === 'space')?.frames?.[0]?.name).toBe('/visit/interaction')
    expect(site.nodes.find((node) => node.id === 'course')?.frames?.map((item) => item.name)).toEqual([
      'stuActiveList',
      'studentcourse',
      'work/list',
    ])
    expect(site.nodes.map((node) => node.id)).not.toContain('activity')
    expect(site.nodes.map((node) => node.id)).not.toContain('homework-list')
    expect(site.nodes.find((node) => node.id === 'study')?.parserIds).toEqual(['study', 'captcha', 'homework'])
    expect(site.nodes.find((node) => node.id === 'homework-do')?.parserIds).toEqual(['homework'])
  })

  it('侧栏任务 / 作业是课程壳上的框，不是独立顶层节点', () => {
    const site = hydrateSite(data)
    const tasks = siteGraphNodeForUrl('https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&pageHeader=0', site)
    const course = siteGraphNodeForUrl('https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&clazzid=2', site)
    const list = siteGraphNodeForUrl('https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&pageHeader=8', site)
    expect(tasks?.id).toBe('course')
    expect(course?.id).toBe('course')
    expect(list?.id).toBe('course')
    expect(activeFrameOf(list, 'https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&pageHeader=8')?.id).toBe('homework')
    expect(classifyBrowserPage('https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&pageHeader=8')).toBe('homework-list')
    expect(siteGraphNodeForUrl('https://mooc1.chaoxing.com/mooc2/active/stuActiveList?courseId=1', site)?.id).toBe('course')
  })

  it('visit/courses 和空间壳都认成空间，页签跟着框走', () => {
    const site = hydrateSite(data)
    const shell = siteGraphNodeForUrl('https://i.chaoxing.com/base', site)
    const list = siteGraphNodeForUrl('https://mooc1-1.chaoxing.com/visit/courses?s=1', site)
    expect(shell?.id).toBe('space')
    expect(list?.id).toBe('space')
    expect(activeFrameOf(shell, 'https://i.chaoxing.com/base')).toBeNull()
    expect(activeFrameOf(list, 'https://mooc1-1.chaoxing.com/visit/courses?s=1')?.tab).toBe('我学的课')
  })

  it('页面身份跟节点走，播放页挂 homework 能力也不改成题卡', () => {
    expect(pageRoleOfNode({ id: 'study', parserIds: ['homework', 'study', 'captcha'] })).toBe('study')
    expect(pageRoleOfNode({ id: 'homework-do', parserIds: ['homework'] })).toBe('homework')
    expect(pageRoleOfNode({ id: 'login', parserIds: ['login'] })).toBe('login')
    expect(pageRoleOfNode({ id: 'space', parserIds: [] })).toBeNull()
    expect(parserPageKindOf({ id: 'study', parserIds: ['study', 'captcha', 'homework'] })).toBe('study')
    expect(parserPageKindOf({ id: 'homework-do', parserIds: ['homework'] })).toBe('homework')
    expect(parserPageKindOf({ id: 'course', parserIds: ['course'] })).toBe('site')
    expect(parserPageKindOf({ id: 'course-study-plan', parserIds: ['study'] })).toBe('site')
    expect(parserPageKindOf({ id: 'login', parserIds: ['login'] })).toBeNull()
    expect(chaoxingPageRole('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1')).toBe('study')
    expect(chaoxingPageRole('https://mooc1.chaoxing.com/knowledge/cards?clazzid=1')).toBe('study')
    expect(chaoxingPageRole('https://mooc1.chaoxing.com/mooc-ans/work/dowork?workId=1')).toBe('homework')
    expect(chaoxingPageRole('https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&pageHeader=1')).toBe('course')
    expect(classifyBrowserPage('https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&pageHeader=1')).toBe('course')
    resetCourseTab()
    expect(courseTabOf('https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&pageHeader=1')).toBe('章节')
    expect(courseTabOf('https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&pageHeader=8')).toBe('作业')
    expect(courseTabOf('https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1')).toBe('任务')
    noteCourseTab('章节', 'probe', 'https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&pageHeader=0')
    expect(courseTabOf('https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&pageHeader=0')).toBe('章节')
    resetCourseTab()
    const catalog = 'https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&pageHeader=1'
    expect(activeFrameOf(siteGraphNodeForUrl(catalog, hydrateSite(data)), catalog)?.tab).toBe('章节')
    expect(chaoxingPageRole('https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&pageHeader=8')).toBe('homework')
    expect(chaoxingPageRole('https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&pageHeader=0')).toBe('course')
    expect(chaoxingPageRole('https://i.chaoxing.com/base')).toBeNull()
  })

  it('课程中间页里的 work/list 框仍是课程节点，kind 认成作业列表', () => {
    const top = 'https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&clazzid=2'
    const frame = 'https://mooc1.chaoxing.com/mooc2/work/list?courseId=1'
    expect(siteGraphNodeForUrl(top)?.id).toBe('course')
    expect(siteGraphNodeForUrl(frame)?.id).toBe('course')
    expect(classifyBrowserPage(frame)).toBe('homework-list')
    expect(siteGraphUrlFromFrames(top, [frame])).toBe(frame)
  })

  it('学习通图谱卡片互不重叠', () => {
    const view = siteGraphViewFromData(data)
    expect(view.nodes.length).toBeGreaterThan(3)
    for (let i = 0; i < view.nodes.length; i += 1) {
      const a = view.nodes[i]
      expect(a.x).toBeGreaterThanOrEqual(0)
      expect(a.x + a.w).toBeLessThanOrEqual(view.width)
      for (let j = i + 1; j < view.nodes.length; j += 1) {
        const b = view.nodes[j]
        expect(graphCardsOverlap(a, b), `${a.id} overlaps ${b.id}`).toBe(false)
      }
    }
    const study = view.nodes.find((node) => node.id === 'study')
    const work = view.nodes.find((node) => node.id === 'homework-do')
    const course = view.nodes.find((node) => node.id === 'course')
    const space = view.nodes.find((node) => node.id === 'space')
    expect(study && work && course && space).toBeTruthy()
    expect(view.wires.some((wire) => wire.from === wire.to)).toBe(false)
    expect(study?.loops).toEqual(['切节', '切任务点', '验证码', '本节测验'])
    expect(space?.frames?.map((item) => item.tab)).toEqual(['我教的课', '我学的课'])
    const grown = applyMeasuredGraphHeights(view, { course: view.nodes.find((node) => node.id === 'course')!.h + 24 })
    const grownCourse = grown.nodes.find((node) => node.id === 'course')!
    const grownStudy = grown.nodes.find((node) => node.id === 'study')!
    expect(grownCourse.h).toBeGreaterThan(course!.h)
    expect(grownStudy.y).toBeGreaterThan(grownCourse.y + grownCourse.h)
    for (let i = 0; i < grown.nodes.length; i += 1) {
      for (let j = i + 1; j < grown.nodes.length; j += 1) {
        expect(graphCardsOverlap(grown.nodes[i], grown.nodes[j])).toBe(false)
      }
    }
  })
})
