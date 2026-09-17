import type { HomeworkCard } from './types'
import { inspectChaoxingHomework, openChaoxingHomeworkItem, openChaoxingHomeworkList } from './inspect'
import { fillChaoxingHomework, guessChaoxingHomework, saveChaoxingHomework, submitChaoxingHomework } from './fill'
import { pickHomeworkOption } from './pick'

/** 站点作业引擎。新平台实现这份接口，不要复制 chaoxing/homework 目录。 */
export type HomeworkEngine = {
  list: (id: string) => Promise<HomeworkCard>
  open: (id: string, title: string) => Promise<HomeworkCard>
  inspect: (id: string, options?: { vision?: boolean; dump?: boolean }) => Promise<HomeworkCard>
  fill: (id: string, answers: unknown) => Promise<unknown>
  guess: (id: string) => Promise<unknown>
  save: (id: string) => Promise<HomeworkCard>
  submit: (id: string) => Promise<HomeworkCard>
  pick: (id: string, index: number, letter: string) => Promise<unknown>
}

export const chaoxingHomeworkEngine: HomeworkEngine = {
  list: openChaoxingHomeworkList,
  open: openChaoxingHomeworkItem,
  inspect: inspectChaoxingHomework,
  fill: fillChaoxingHomework,
  guess: guessChaoxingHomework,
  save: saveChaoxingHomework,
  submit: submitChaoxingHomework,
  pick: pickHomeworkOption,
}
