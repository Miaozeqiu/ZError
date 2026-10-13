/** 对着真实抓下来的播放页 fixture 读目录和任务点。 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'
import { chaptersFromHtml, jobsFromHtml } from '../../../src/services/chaoxing/host/catalog'
import { locatorsForChapter, locatorsForStudyStep } from '../../../src/services/chaoxing/host/selectors'

const fixtures = new URL('../../../src/services/agent/skills/bundled/chaoxing/fixtures/', import.meta.url)
const mainHtml = readFileSync(new URL('studentstudy.html', fixtures), 'utf8')
const cardsHtml = readFileSync(new URL('studentstudy-cards.html', fixtures), 'utf8')

beforeAll(() => {
  globalThis.DOMParser = new JSDOM('<!doctype html><html></html>').window.DOMParser as unknown as typeof DOMParser
})

describe('学习通播放页 fixture · 主框架目录', () => {
  it('读出整本目录：54 行，章标题行单独标出来', () => {
    const chapters = chaptersFromHtml(mainHtml)
    expect(chapters.length).toBe(54)
    const folders = chapters.filter((item) => item.folder)
    expect(folders.length).toBeGreaterThan(0)
    expect(folders[0].title).toBe('1 第1章 函数、极限与连续')
  })

  it('当前节 / 未完成角标 / 节 id 都从 DOM 读到', () => {
    const chapters = chaptersFromHtml(mainHtml)
    const active = chapters.find((item) => item.active)
    expect(active).toMatchObject({ title: '高阶导数', id: '1065429967', pending: 1 })
    const unfinished = chapters.filter((item) => item.pending > 0).map((item) => item.title)
    expect(unfinished).toContain('高阶导数')
    expect(unfinished.length).toBe(45)
    expect(chapters[1]).toMatchObject({ title: '函数（一）', id: '1065429912', pending: 1 })
  })

  it('切章选择器能命中这一节', () => {
    const doc = new JSDOM(mainHtml).window.document
    const queries = locatorsForChapter('函数的微分', '1065429974')
    const hits = queries.map((query) => (
      query.by === 'css' ? doc.querySelectorAll(query.value).length : 0
    ))
    expect(hits[0]).toBeGreaterThan(0)
    expect(queries.some((query) => query.by === 'text' && query.value === '函数的微分')).toBe(true)
  })
})

describe('学习通播放页 fixture · cards 帧任务点', () => {
  it('叠着的任务点盒：两条视频按 mid 区分，测验带 jobid', () => {
    const jobs = jobsFromHtml(cardsHtml)
    expect(jobs.map((row) => ({ label: row.label, kind: row.kind, id: row.id, jobid: row.jobid }))).toEqual([
      { label: '视频1', kind: 'video', id: '2288751884001591094233845', jobid: '1591094234685588' },
      { label: '文档', kind: 'doc', id: '', jobid: '' },
      { label: '测验', kind: 'quiz', id: '', jobid: 'work-8612e18d3a9d446d890cbcf468d3f5e6' },
      { label: '视频2', kind: 'video', id: '4702620551661617160801835', jobid: '1617160802594124' },
    ])
  })

  it('切任务点选择器按 mid 找到那条 iframe', () => {
    const doc = new JSDOM(cardsHtml).window.document
    const queries = locatorsForStudyStep({ mid: '4702620551661617160801835', videoIndex: 2 })
    expect(queries[0].by).toBe('css')
    expect(queries[0].value).toContain('4702620551661617160801835')
    expect(doc.querySelectorAll(queries[0].value).length).toBe(1)
  })

  it('jobsFromHtml 静态 HTML 也能出任务点行', () => {
    const rows = jobsFromHtml(cardsHtml)
    expect(rows.map((row) => [row.label, row.kind, row.video, row.quiz, row.id])).toEqual([
      ['视频1', 'video', true, false, '2288751884001591094233845'],
      ['文档', 'doc', false, false, ''],
      ['测验', 'quiz', false, true, ''],
      ['视频2', 'video', true, false, '4702620551661617160801835'],
    ])
    expect(rows.every((row) => row.done === false && row.active === false)).toBe(true)
  })
})
