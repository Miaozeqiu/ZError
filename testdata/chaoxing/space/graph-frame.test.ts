import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyMeasuredGraphHeights, siteGraphViewFromData, graphCardsOverlap } from '../../../src/services/browser/siteGraph'
import { activeFrameOf, hydrateSite, siteGraphNodeForUrl, siteGraphUrlFromFrames, type SiteGraphData } from '../../../src/services/browser/siteGraphCore'

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
    expect(site.nodes.find((node) => node.id === 'course')?.parserIds).toEqual([])
    expect(site.nodes.find((node) => node.id === 'activity')?.parserIds).toEqual([])
    expect(site.nodes.find((node) => node.id === 'homework-list')?.parserIds).toEqual([])
    expect(site.nodes.find((node) => node.id === 'study')?.parserIds).toEqual(['study', 'captcha'])
    expect(site.nodes.find((node) => node.id === 'homework-do')?.parserIds).toEqual(['homework'])
  })

  it('侧栏任务是活动页，不是课程壳或作业列表', () => {
    const site = hydrateSite(data)
    const activity = siteGraphNodeForUrl('https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&pageHeader=0', site)
    const course = siteGraphNodeForUrl('https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=1&clazzid=2', site)
    const list = siteGraphNodeForUrl('https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&pageHeader=8', site)
    expect(activity?.id).toBe('activity')
    expect(course?.id).toBe('course')
    expect(list?.id).toBe('homework-list')
    expect(siteGraphNodeForUrl('https://mooc1.chaoxing.com/mooc2/active/stuActiveList?courseId=1', site)?.id).toBe('activity')
  })

  it('visit/courses 和空间壳都认成空间，页签跟着变', () => {
    const site = hydrateSite(data)
    const shell = siteGraphNodeForUrl('https://i.chaoxing.com/base', site)
    const list = siteGraphNodeForUrl('https://mooc1-1.chaoxing.com/visit/courses?s=1', site)
    expect(shell?.id).toBe('space')
    expect(list?.id).toBe('space')
    expect(activeFrameOf(shell, 'https://i.chaoxing.com/base')?.tab).toBe('我教的课')
    expect(activeFrameOf(list, 'https://mooc1-1.chaoxing.com/visit/courses?s=1')?.tab).toBe('我学的课')
  })

  it('课程中间页里的 work/list 框盖过外壳，认成作业列表', () => {
    const top = 'https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1&clazzid=2'
    const frame = 'https://mooc1.chaoxing.com/mooc2/work/list?courseId=1'
    expect(siteGraphNodeForUrl(top)?.id).toBe('course')
    expect(siteGraphNodeForUrl(frame)?.id).toBe('homework-list')
    expect(siteGraphUrlFromFrames(top, [frame])).toBe(frame)
  })

  it('学习通图谱卡片互不重叠，且左右列留出间距', () => {
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
    const list = view.nodes.find((node) => node.id === 'homework-list')
    const work = view.nodes.find((node) => node.id === 'homework-do')
    expect(study && list && work).toBeTruthy()
    if (study && list && work) {
      expect(study.x + study.w).toBeLessThanOrEqual(list.x)
      expect(work.x).toBe(list.x)
    }
    expect(view.wires.some((wire) => wire.from === wire.to)).toBe(false)
    const studyNode = view.nodes.find((node) => node.id === 'study')
    expect(studyNode?.loops).toEqual(['切节', '切任务点', '验证码', '本节测验'])
    const course = view.nodes.find((node) => node.id === 'course')
    const space = view.nodes.find((node) => node.id === 'space')
    const activity = view.nodes.find((node) => node.id === 'activity')
    expect(course && space && activity).toBeTruthy()
    if (course && space && activity) {
      expect(space.frames?.map((item) => item.tab)).toEqual(['我教的课', '我学的课'])
      expect(activity.x).toBeGreaterThan(course.x)
      expect(course.h).toBe(space.h)
    }
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
