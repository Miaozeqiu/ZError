import { authUser, isLoggedIn } from '../../app/auth'
import {
  campusApiType,
  campusQuestionTypeLabel,
  createCampusCourse,
  createCampusPaper,
  createCampusQuestion,
  encodeCampusAnswer,
  encodeCampusOptions,
  getCampusCourse,
  getUserCampus,
  listCampusCourses,
  listCampusTags,
  listFolderQuestions,
  listUncategorizedQuestions,
  parseCampusOptions,
  renameCampusCourse,
  reorderCampusPaperQuestions,
  searchCampusQuestions,
  searchCampusQuestionsExact,
  setCampusPaperArchived,
  updateCampusPaper,
  updateCampusQuestion,
  withFolderQuestionCounts,
  type CampusFolder,
  type CampusQuestion,
} from '../../app/campus'
import { databaseService } from '../../app/database'
import {
  campusFail,
  campusTagArg,
  loadCampusContext,
  parseCampusDrafts,
  resolveCampusCourse,
  resolveCampusPaper,
  resolveCampusTagId,
  summarizeCampusCourse,
  summarizeCampusPaper,
} from '../campusResolve'
import {
  campusCacheOf,
  parseCampusQuestionIds,
  publishCampusQuestionCards,
  rememberCampusPapers,
  rememberCampusQuestions,
  resolveCampusWriteTarget,
} from '../campusSession'
import { assertCampusWriteAllowed, campusWriteDenial } from '../campusPolicy'
import type { ChatToolHandler } from '../toolContext'
import { clipToolResult, notifyCampusUpdated, parseQuestionIds } from '../toolShared'

const isCampusId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const compactQuestionText = (text: string) => text.replace(/\s+/gu, '').toLowerCase()

export const campusToolHandlers: Record<string, ChatToolHandler> = {
  get_campus_status: async () => {
    if (!isLoggedIn.value) {
      return JSON.stringify({
        loggedIn: false,
        campus: null,
        message: '还没有登录校园账号。请先在顶栏用微信登录，再到校园题库页绑定学校。',
      })
    }
    try {
      const identity = await getUserCampus()
      return JSON.stringify({
        loggedIn: true,
        campus: identity.campus?.name || null,
        campus_id: identity.campus?.id || null,
        enrollment_year: identity.enrollment_year || null,
        class_name: identity.class_name || null,
        verified: identity.status === 'verified',
        message: identity.campus
          ? identity.status === 'verified'
            ? `当前学校「${identity.campus.name}」，已认证。用 list_campus_courses 看课，save_campus_questions 上传，update_campus_question 改题。`
            : `当前学校「${identity.campus.name}」。可以看题；上传或改题需要先完成校园认证。`
          : '已登录，但还没有绑定学校。请先打开校园题库页选择学校。',
      })
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '读取校园账号失败') })
    }
  },

  list_campus_courses: async ({ args }) => {
    const ctx = await loadCampusContext()
    if ('error' in ctx) return JSON.stringify(ctx)
    try {
      const keyword = String(args.name || '').trim()
      const courses = await listCampusCourses(ctx.identity.campus!.id, keyword)
      return clipToolResult(JSON.stringify({
        campus: ctx.identity.campus!.name,
        campus_id: ctx.identity.campus!.id,
        count: courses.length,
        courses: courses.map(summarizeCampusCourse),
        message: courses.length
          ? '用 course_id 调用 list_campus_papers 查看试卷。不要根据课程上的数量判断有没有试卷或题目。'
          : keyword
            ? `没有找到名称包含「${keyword}」的课程。`
            : '这所学校还没有课程。',
      }))
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '查看校园课程失败') })
    }
  },

  create_campus_course: async ({ args, ctx }) => {
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (!name) return JSON.stringify({ error: '请先向用户询问课程名称。' })
    const campus = await loadCampusContext({ requireVerified: true })
    if ('error' in campus) return JSON.stringify(campus)
    ctx.abort.throwIfAborted()
    try {
      assertCampusWriteAllowed('create_campus_course')
      const course = await createCampusCourse(campus.identity.campus!.id, name, ctx.abort)
      notifyCampusUpdated({ courseListChanged: true })
      return JSON.stringify({
        ...summarizeCampusCourse(course),
        status: course.status,
        message: course.status === 'pending'
          ? `课程「${course.name}」已提交审核。`
          : `课程「${course.name}」已创建。`,
      })
    } catch (err) {
      ctx.abort.throwIfAborted()
      return JSON.stringify({ error: campusFail(err, '创建校园课程失败') })
    }
  },

  rename_campus_course: async ({ args, ctx }) => {
    const { course_id: courseId } = args
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (!isCampusId(courseId) || !name) return JSON.stringify({ error: '请确认课程 ID 和新课名。' })
    const campus = await loadCampusContext({ requireVerified: true })
    if ('error' in campus) return JSON.stringify(campus)
    try {
      assertCampusWriteAllowed('rename_campus_course')
      const course = await renameCampusCourse(courseId, name, ctx.abort)
      notifyCampusUpdated({ courseListChanged: true })
      return JSON.stringify({
        course_id: courseId,
        name: course.name,
        status: course.status,
        message: course.status === 'pending'
          ? `已提交课程改名申请，新名称「${course.name}」待审核。`
          : `课程已改名为「${course.name}」。`,
      })
    } catch (err) {
      ctx.abort.throwIfAborted()
      return JSON.stringify({ error: campusFail(err, '校园课程改名失败') })
    }
  },

  list_campus_papers: async ({ args, ctx }) => {
    const campus = await loadCampusContext()
    if ('error' in campus) return JSON.stringify(campus)
    try {
      const course = await resolveCampusCourse(
        campus.identity.campus!.id,
        Number(args.course_id) || undefined,
        String(args.course_name || '').trim() || undefined,
      )
      if (!course) return JSON.stringify({ error: '请提供 course_id 或 course_name' })
      const detail = await getCampusCourse(course.id)
      const papers = await withFolderQuestionCounts(
        detail.folders.filter(item => args.include_archived === true || !item.archived),
      )
      rememberCampusPapers(ctx.sessionId, papers.map((item) => ({
        id: item.id,
        name: item.name,
        courseName: course.name,
        courseId: course.id,
      })))
      return clipToolResult(JSON.stringify({
        campus: campus.identity.campus!.name,
        course: course.name,
        course_id: course.id,
        count: papers.length,
        papers: papers.map(summarizeCampusPaper),
        message: papers.length
          ? '用 paper_id 调用 list_campus_questions 查看题目。改平台或改名用 update_campus_paper，不要新建一份再复制。campus_question_id 不是本地题库 Id。'
          : '这门课还没有试卷。',
      }))
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '查看校园试卷失败') })
    }
  },

  list_campus_uncategorized_questions: async ({ call, args, ctx }) => {
    const campus = await loadCampusContext()
    if ('error' in campus) return JSON.stringify(campus)
    try {
      const course = await resolveCampusCourse(
        campus.identity.campus!.id,
        Number(args.course_id) || undefined,
        String(args.course_name || '').trim() || undefined,
      )
      if (!course) return JSON.stringify({ error: '请提供 course_id 或 course_name。' })
      const page = Number.isSafeInteger(args.page) ? Math.max(1, args.page) : 1
      const pageSize = Number.isSafeInteger(args.page_size) ? Math.min(40, Math.max(1, args.page_size)) : 20
      const questions = await listUncategorizedQuestions(course.id, page, pageSize)
      rememberCampusQuestions(ctx.sessionId, questions)
      const title = `${course.name} · 未分类题目`
      const cards = publishCampusQuestionCards(call.id, questions, title)
      return JSON.stringify({
        course: course.name,
        course_id: course.id,
        page,
        page_size: pageSize,
        next_page: questions.length === pageSize ? page + 1 : undefined,
        count: questions.length,
        title: cards.length ? title : undefined,
        questions: questions.map(item => ({
          campus_question_id: item.id,
          question: item.content.slice(0, 80),
          question_type: campusQuestionTypeLabel(item.type),
        })),
        message: cards.length ? `已在右侧显示 ${cards.length} 道题的预览。` : '这一页没有未分类题目。',
      })
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '查看未分类题目失败') })
    }
  },

  list_campus_questions: async ({ call, args, ctx }) => {
    const campus = await loadCampusContext()
    if ('error' in campus) return JSON.stringify(campus)
    try {
      const paperId = Number(args.paper_id ?? args.folder_id)
      const paperName = String(args.paper_name || args.folder_name || '').trim()
      let paper: CampusFolder | null = null
      let courseName = ''
      let courseId = 0
      if (Number.isFinite(paperId) && paperId > 0) {
        const known = campusCacheOf(ctx.sessionId).papers.find((item) => item.id === paperId)
        paper = { id: paperId, name: paperName || known?.name || `试卷 ${paperId}` }
        courseName = known?.courseName || ''
        courseId = known?.courseId || 0
      } else {
        const course = await resolveCampusCourse(
          campus.identity.campus!.id,
          Number(args.course_id) || undefined,
          String(args.course_name || '').trim() || undefined,
        )
        if (!course) return JSON.stringify({ error: '请提供 paper_id，或同时提供课程和试卷名' })
        const resolved = await resolveCampusPaper(course.id, undefined, paperName || undefined)
        paper = resolved.paper
        courseName = resolved.course.name
        courseId = resolved.course.id
        if (!paper) {
          return JSON.stringify({
            error: paperName ? `没有找到试卷「${paperName}」` : '请提供 paper_id 或 paper_name',
            course: course.name,
            course_id: course.id,
            papers: resolved.papers.map(summarizeCampusPaper),
          })
        }
      }
      const all = await listFolderQuestions(paper.id)
      rememberCampusQuestions(ctx.sessionId, all, {
        id: paper.id,
        name: paper.name,
        courseName,
        courseId: courseId || undefined,
      })
      const page = Math.max(1, Number(args.page) || 1)
      const pageSize = Math.min(40, Math.max(1, Number(args.page_size) || 20))
      const start = (page - 1) * pageSize
      const items = all.slice(start, start + pageSize)
      const title = paper.name || '校园题'
      publishCampusQuestionCards(call.id, items, title)
      return clipToolResult(JSON.stringify({
        campus: campus.identity.campus!.name,
        course: courseName || undefined,
        paper: paper.name,
        paper_id: paper.id,
        title,
        page,
        pageSize,
        total: all.length,
        count: items.length,
        hasMore: start + items.length < all.length,
        questions: items.map((item) => ({
          campus_question_id: item.id,
          question: String(item.content || '').slice(0, 80),
          question_type: campusQuestionTypeLabel(item.type),
        })),
        message: `已在右侧弹出「${title}」${items.length} 道浏览卡片，只供看题。不要再列出选项。用户没说练习就不要 present_quiz。`,
      }))
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '查看校园题目失败') })
    }
  },

  search_campus_questions: async ({ call, args, ctx }) => {
    const campus = await loadCampusContext()
    if ('error' in campus) return JSON.stringify(campus)
    const keyword = String(args.keyword || '').trim()
    if (!keyword) return JSON.stringify({ error: '关键词不能为空' })
    try {
      const page = Math.max(1, Number(args.page) || 1)
      const pageSize = Math.min(40, Math.max(1, Number(args.page_size) || 20))
      const items = await searchCampusQuestions(keyword, page, pageSize)
      rememberCampusQuestions(ctx.sessionId, items)
      const title = `搜索「${keyword}」`
      if (items.length) publishCampusQuestionCards(call.id, items, title)
      return clipToolResult(JSON.stringify({
        campus: campus.identity.campus!.name,
        keyword,
        title: items.length ? title : undefined,
        page,
        pageSize,
        count: items.length,
        questions: items.map((item) => ({
          campus_question_id: item.id,
          question: String(item.content || '').slice(0, 80),
          question_type: campusQuestionTypeLabel(item.type),
        })),
        message: items.length
          ? `已在右侧弹出「${title}」${items.length} 道浏览卡片，只供看题。不要再列出选项。用户没说练习就不要 present_quiz。`
          : `校园题库里没有找到「${keyword}」。`,
      }))
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '搜索校园题失败') })
    }
  },

  check_campus_question_duplicate: async ({ args, ctx }) => {
    const question = typeof args.question === 'string' ? args.question.trim() : ''
    if (!question) return JSON.stringify({ error: '请提供完整题干。' })
    const campus = await loadCampusContext()
    if ('error' in campus) return JSON.stringify(campus)
    try {
      const options = parseCampusOptions(args.options).map(compactQuestionText)
      const matches = await searchCampusQuestionsExact(question)
      const stem = compactQuestionText(question)
      const sameStem = matches.filter(item => compactQuestionText(item.content) === stem)
      const duplicates = options.length ? sameStem.filter(item => {
        const existing = parseCampusOptions(item.options).map(compactQuestionText)
        return existing.length === options.length && existing.every((option, index) => option === options[index])
      }) : sameStem
      rememberCampusQuestions(ctx.sessionId, duplicates)
      return JSON.stringify({
        found: duplicates.length > 0,
        compared_options: options.length > 0,
        count: duplicates.length,
        same_stem_count: sameStem.length,
        questions: duplicates.map(item => ({
          campus_question_id: item.id,
          question: item.content.slice(0, 160),
          course: item.course_name,
          paper: item.paper_name,
          paper_id: item.question_bank_id,
        })),
        message: duplicates.length
          ? options.length ? '查到题干及选项顺序一致的题目。' : '查到题干一致的题目，选项尚未核对。'
          : '本次返回的候选中未找到一致的题目。',
      })
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '校园题目查重失败') })
    }
  },

  list_campus_tags: async () => {
    try {
      const tags = await listCampusTags()
      return JSON.stringify({
        count: tags.length,
        tags: tags.map((item) => ({ tag_id: item.id, name: item.name })),
        message: '改平台用 update_campus_paper，传 tag 或 tag_id。不要新建试卷再复制。',
      })
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '查看校园平台标签失败') })
    }
  },

  update_campus_paper: async ({ args, ctx }) => {
    const campus = await loadCampusContext({ requireVerified: true })
    if ('error' in campus) return JSON.stringify(campus)
    try {
      const target = await resolveCampusWriteTarget(ctx.sessionId, campus.identity.campus!.id, args, {
        createPaper: false,
      })
      if ('error' in target) return JSON.stringify(target)
      const nextName = String(args.name || '').trim() || target.paper.name
      const tagName = campusTagArg(args)
      const tagId = await resolveCampusTagId(Number(args.tag_id) || undefined, tagName || undefined)
      if (!String(args.name || '').trim() && tagId == null) {
        return JSON.stringify({ error: '请提供要改的试卷名 name，或平台 tag（如智慧树、学习通）' })
      }
      assertCampusWriteAllowed('update_campus_paper')
      const paper = await updateCampusPaper(target.paper.id, {
        name: nextName,
        tag_id: tagId,
      })
      rememberCampusPapers(ctx.sessionId, [{
        id: paper.id,
        name: paper.name,
        courseName: target.course.name,
        courseId: target.course.id,
      }])
      notifyCampusUpdated({ courseId: target.course.id, paperId: paper.id })
      const tag = paper.tag_name || tagName || undefined
      return JSON.stringify({
        campus: campus.identity.campus!.name,
        course: target.course.name,
        course_id: target.course.id,
        paper: paper.name,
        paper_id: paper.id,
        tag,
        message: tag
          ? `已把「${paper.name}」的平台改为「${tag}」。不要再新建试卷。`
          : `已把试卷改名为「${paper.name}」。`,
      })
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '修改校园试卷失败') })
    }
  },

  create_campus_paper: async ({ args, ctx }) => {
    const campus = await loadCampusContext({ requireVerified: true })
    if ('error' in campus) return JSON.stringify(campus)
    const name = String(args.name || args.paper_name || '').trim()
    if (!name) return JSON.stringify({ error: '请提供试卷名称 name' })
    try {
      const course = await resolveCampusCourse(
        campus.identity.campus!.id,
        Number(args.course_id) || undefined,
        String(args.course_name || '').trim() || undefined,
      )
      if (!course) return JSON.stringify({ error: '请提供 course_id 或 course_name' })
      try {
        const resolved = await resolveCampusPaper(course.id, undefined, name)
        if (resolved.paper) {
          rememberCampusPapers(ctx.sessionId, [{
            id: resolved.paper.id,
            name: resolved.paper.name,
            courseName: course.name,
            courseId: course.id,
          }])
          return JSON.stringify({
            already: true,
            campus: campus.identity.campus!.name,
            course: course.name,
            course_id: course.id,
            paper: resolved.paper.name,
            paper_id: resolved.paper.id,
            message: `试卷「${resolved.paper.name}」已存在，paper_id=${resolved.paper.id}。上传题目用 save_campus_questions。`,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (/有多/.test(msg)) return JSON.stringify({ error: msg })
      }
      const tagId = await resolveCampusTagId(
        Number(args.tag_id) || undefined,
        campusTagArg(args) || undefined,
      )
      assertCampusWriteAllowed('create_campus_paper')
      const paper = await createCampusPaper(course.id, name, tagId)
      rememberCampusPapers(ctx.sessionId, [{
        id: paper.id,
        name: paper.name,
        courseName: course.name,
        courseId: course.id,
      }])
      notifyCampusUpdated({ courseId: course.id, paperId: paper.id })
      return JSON.stringify({
        campus: campus.identity.campus!.name,
        course: course.name,
        course_id: course.id,
        paper: paper.name,
        paper_id: paper.id,
        tag: paper.tag_name || undefined,
        message: `已创建试卷「${paper.name}」，paper_id=${paper.id}。接下来用 save_campus_questions 上传题目。`,
      })
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '创建校园试卷失败') })
    }
  },

  set_campus_paper_archived: async ({ args, ctx }) => {
    const { course_id: courseId, paper_id: paperId, archived } = args
    if (!isCampusId(courseId) || !isCampusId(paperId) || typeof archived !== 'boolean') {
      return JSON.stringify({ error: '请确认 course_id、paper_id 和归档状态 archived。' })
    }
    const campus = await loadCampusContext({ requireVerified: true })
    if ('error' in campus) return JSON.stringify(campus)
    const action = archived ? '归档' : '取消归档'
    try {
      const { paper } = await resolveCampusPaper(courseId, paperId, undefined, true)
      if (Boolean(paper.archived) === archived) {
        return JSON.stringify({ paper_id: paperId, paper: paper.name, archived, already: true, message: `试卷已是所请求的${action}状态。` })
      }
      const isCreator = paper.creator_id != null && paper.creator_id === Number(authUser.value?.id)
      const canChangeDirectly = campus.identity.is_trusted || isCreator
      if (!canChangeDirectly && args.allow_vote !== true) {
        return JSON.stringify({ error: `无法直接${action}，需要发起投票。请先征求用户同意。`, requires_vote: true })
      }
      assertCampusWriteAllowed('set_campus_paper_archived')
      const result = await setCampusPaperArchived(paperId, archived, String(args.remark || '').trim(), ctx.abort)
      if (!result.voteStarted) notifyCampusUpdated({ courseId })
      return JSON.stringify({
        paper_id: paperId,
        paper: paper.name,
        archived: result.voteStarted ? Boolean(paper.archived) : archived,
        vote_started: result.voteStarted,
        vote_id: result.voteId || undefined,
        message: result.voteStarted ? `已发起${action}投票，等待投票结果。` : `已${action}试卷「${paper.name}」。`,
      })
    } catch (err) {
      ctx.abort.throwIfAborted()
      return JSON.stringify({ error: campusFail(err, `${action}试卷失败`) })
    }
  },

  reorder_campus_paper_questions: async ({ args, ctx }) => {
    const { course_id: courseId, paper_id: paperId, campus_question_ids: ids } = args
    if (!isCampusId(courseId) || !isCampusId(paperId) || !Array.isArray(ids)
      || !ids.length || !ids.every(isCampusId) || new Set(ids).size !== ids.length) {
      return JSON.stringify({ error: '请提供课程 ID、试卷 ID，以及无重复的校园题 ID 顺序。' })
    }
    const campus = await loadCampusContext({ requireVerified: true })
    if ('error' in campus) return JSON.stringify(campus)
    try {
      const { paper } = await resolveCampusPaper(courseId, paperId)
      const questions = await listFolderQuestions(paperId)
      const current = questions.filter(item => !item.parent_id).map(item => item.id)
      const members = new Set(current)
      if (ids.length !== current.length || !ids.every(id => members.has(id))) {
        return JSON.stringify({ error: '题目顺序必须包含这份试卷的全部顶层题目，每题一次。请重新读取所有分页。', expected_count: current.length })
      }
      const already = ids.every((id, index) => id === current[index])
      if (!already) {
        assertCampusWriteAllowed('reorder_campus_paper_questions')
        await reorderCampusPaperQuestions(paperId, ids, ctx.abort)
        notifyCampusUpdated({ courseId })
        const saved = await listFolderQuestions(paperId).catch(() => null)
        if (!saved) return JSON.stringify({ error: '排序已提交，暂时无法核对结果。请先刷新试卷。' })
        const savedOrder = saved.filter(item => !item.parent_id).map(item => item.id)
        if (savedOrder.length !== ids.length || ids.some((id, index) => id !== savedOrder[index])) {
          return JSON.stringify({ error: '排序已提交，但读取到的顺序与请求不一致。请先刷新试卷核对。' })
        }
      }
      return JSON.stringify({ paper_id: paperId, paper: paper.name, count: ids.length, already, message: already ? '试卷题目已是所请求的顺序。' : `已保存 ${ids.length} 道题的顺序。` })
    } catch (err) {
      ctx.abort.throwIfAborted()
      return JSON.stringify({ error: campusFail(err, '校园试卷题目排序失败') })
    }
  },

  save_campus_questions: async ({ call, args, ctx }) => {
    const campus = await loadCampusContext({ requireVerified: true })
    if ('error' in campus) return JSON.stringify(campus)
    try {
      const localIds = parseQuestionIds(args)
      const fromLocal = localIds.length ? await databaseService.getQuestionsByIds(localIds) : []
      const drafts = [
        ...fromLocal.map((item) => ({
          question: String(item.question || '').trim(),
          options: item.options,
          answer: String(item.answer || '').trim(),
          question_type: String(item.question_type || '').trim(),
        })),
        ...parseCampusDrafts(args.questions),
      ].filter((item) => item.question && item.answer)
      if (!drafts.length) {
        return JSON.stringify({ error: '没有有效题目。请提供 questions，或本地 question_ids。每道需要题干和答案。' })
      }
      const pending = drafts.slice(0, 20)
      const target = await resolveCampusWriteTarget(ctx.sessionId, campus.identity.campus!.id, args, {
        createPaper: args.create_paper !== false,
      })
      if ('error' in target) return JSON.stringify(target)
      const created: CampusQuestion[] = []
      const failed: Array<{ question: string; error: string }> = []
      for (const item of pending) {
        const denied = campusWriteDenial('save_campus_questions')
        if (denied) {
          failed.push({ question: item.question.slice(0, 80), error: denied })
          break
        }
        const type = campusApiType(item.question_type, item.options)
        const options = encodeCampusOptions(item.options)
        const answer = encodeCampusAnswer(item.answer, item.options, type)
        if (!answer) {
          failed.push({ question: item.question.slice(0, 80), error: '答案为空' })
          continue
        }
        try {
          created.push(await createCampusQuestion(target.course.id, {
            type,
            content: item.question,
            options,
            answer,
            question_bank_id: target.paper.id,
          }))
        } catch (err) {
          const message = campusFail(err, '上传失败')
          failed.push({ question: item.question.slice(0, 80), error: message })
          if (/认证|登录已失效/.test(message)) break
        }
      }
      rememberCampusQuestions(ctx.sessionId, created, {
        id: target.paper.id,
        name: target.paper.name,
        courseName: target.course.name,
        courseId: target.course.id,
      })
      const title = target.paper.name || '校园题'
      if (created.length) publishCampusQuestionCards(call.id, created, title)
      if (created.length || target.createdPaper) {
        notifyCampusUpdated({ courseId: target.course.id, paperId: target.paper.id })
      }
      return clipToolResult(JSON.stringify({
        campus: campus.identity.campus!.name,
        course: target.course.name,
        course_id: target.course.id,
        paper: target.paper.name,
        paper_id: target.paper.id,
        created_paper: target.createdPaper || undefined,
        title: created.length ? title : undefined,
        saved: created.length,
        failed: failed.length || undefined,
        errors: failed.length ? failed.slice(0, 8) : undefined,
        skipped: drafts.length > pending.length ? drafts.length - pending.length : undefined,
        questions: created.map((item) => ({
          campus_question_id: item.id,
          question: String(item.content || '').slice(0, 80),
          question_type: campusQuestionTypeLabel(item.type),
        })),
        message: created.length
          ? `已上传 ${created.length} 道到「${target.paper.name}」，并弹出浏览卡片。不要再列出选项。用户没说练习就不要 present_quiz。`
          : failed[0]?.error || '没有成功上传的题目',
      }))
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '上传校园题失败') })
    }
  },

  update_campus_question: async ({ call, args, ctx }) => {
    const campus = await loadCampusContext({ requireVerified: true })
    if ('error' in campus) return JSON.stringify(campus)
    try {
      const shared = {
        question: args.question,
        options: args.options,
        answer: args.answer,
        question_type: args.question_type,
        paper_id: args.paper_id,
      }
      const patches = Array.isArray(args.questions) && args.questions.length
        ? args.questions
        : parseCampusQuestionIds({ ...args, questions: undefined }).map((id) => ({
          campus_question_id: id,
          ...shared,
        }))
      const items = patches.slice(0, 10).map((item: any) => ({
        campus_question_id: Number(Array.isArray(item?.campus_question_id) ? item.campus_question_id[0] : item?.campus_question_id),
        question: item?.question != null ? String(item.question).trim() : undefined,
        options: item?.options,
        answer: item?.answer != null ? String(item.answer).trim() : undefined,
        question_type: item?.question_type != null ? String(item.question_type).trim() : undefined,
        paper_id: Number(item?.paper_id || args.paper_id) || 0,
      })).filter((item: { campus_question_id: number }) => Number.isFinite(item.campus_question_id) && item.campus_question_id > 0)
      if (!items.length) {
        return JSON.stringify({ error: '请提供 campus_question_id。这是校园题 Id，不是本地题库 Id。先 list_campus_questions 或 search_campus_questions。' })
      }
      const cache = campusCacheOf(ctx.sessionId)
      const updated: CampusQuestion[] = []
      const failed: Array<{ campus_question_id: number; error: string }> = []
      for (const item of items) {
        let current = cache.questions.find((question) => question.id === item.campus_question_id) || null
        const paperId = item.paper_id || current?.question_bank_id || 0
        if (!current && paperId) {
          try {
            const listed = await listFolderQuestions(paperId)
            rememberCampusQuestions(ctx.sessionId, listed, { id: paperId, name: `试卷 ${paperId}` })
            current = listed.find((question) => question.id === item.campus_question_id) || null
          } catch {
            // keep going
          }
        }
        if (!paperId) {
          failed.push({ campus_question_id: item.campus_question_id, error: '改题必须带上 paper_id，或先 list_campus_questions 再改，以免题目被移出试卷' })
          continue
        }
        const nextType = item.question_type
          ? campusApiType(item.question_type, item.options ?? current?.options)
          : undefined
        const nextOptions = item.options != null ? encodeCampusOptions(item.options) : undefined
        const nextAnswer = item.answer
          ? encodeCampusAnswer(item.answer, item.options ?? current?.options, nextType || current?.type)
          : undefined
        if (!item.question && !nextOptions && !nextAnswer && !nextType && paperId === current?.question_bank_id) {
          failed.push({ campus_question_id: item.campus_question_id, error: '没有要改的字段' })
          continue
        }
        const denied = campusWriteDenial('update_campus_question')
        if (denied) {
          failed.push({ campus_question_id: item.campus_question_id, error: denied })
          break
        }
        try {
          const saved = await updateCampusQuestion(item.campus_question_id, {
            type: nextType,
            content: item.question,
            options: nextOptions,
            answer: nextAnswer,
            question_bank_id: paperId,
          })
          const next = saved || {
            id: item.campus_question_id,
            type: nextType || current?.type || 'short_answer',
            content: item.question || current?.content || `题目 ${item.campus_question_id}`,
            options: nextOptions || current?.options || '',
            answer: nextAnswer || current?.answer || '',
            question_bank_id: paperId,
          }
          updated.push(next)
          rememberCampusQuestions(ctx.sessionId, [next], {
            id: paperId,
            name: cache.papers.find((paper) => paper.id === paperId)?.name || `试卷 ${paperId}`,
            courseId: cache.papers.find((paper) => paper.id === paperId)?.courseId,
            courseName: cache.papers.find((paper) => paper.id === paperId)?.courseName,
          })
        } catch (err) {
          const message = campusFail(err, '修改失败')
          failed.push({ campus_question_id: item.campus_question_id, error: message })
          if (/认证|登录已失效/.test(message)) break
        }
      }
      const title = '已修改的校园题'
      if (updated.length) publishCampusQuestionCards(call.id, updated, title)
      return clipToolResult(JSON.stringify({
        campus: campus.identity.campus!.name,
        updated: updated.length,
        failed: failed.length || undefined,
        errors: failed.length ? failed.slice(0, 8) : undefined,
        title: updated.length ? title : undefined,
        questions: updated.map((item) => ({
          campus_question_id: item.id,
          question: String(item.content || '').slice(0, 80),
          question_type: campusQuestionTypeLabel(item.type),
        })),
        message: updated.length
          ? `已修改 ${updated.length} 道校园题，并弹出浏览卡片。不要再列出选项。用户没说练习就不要 present_quiz。`
          : failed[0]?.error || '没有改成功的题目',
      }))
    } catch (err) {
      return JSON.stringify({ error: campusFail(err, '修改校园题失败') })
    }
  },
}
