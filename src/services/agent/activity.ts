import type { ImportTaskStep } from '../app/importTasks'
import { resolveQuizTitle } from '../../utils/question/quizPractice'

export const describeActivity = (name: string, args: any, status: ImportTaskStep['status'], extra?: any) => {
  const browserLabels: Record<string, [string, string, string]> = {
    browser_get_state: ['正在查看网页', '查看网页失败', '查看了当前网页'],
    browser_get_page: ['正在读取网页', '读取网页失败', '读取了当前网页'],
    browser_navigate: ['正在打开网页', '打开网页失败', extra?.url || args?.url ? `打开了 ${extra?.url || args?.url}` : '打开了网页'],
    browser_reload: ['正在刷新', '刷新失败', '刷新了网页'],
    browser_go_back: ['正在后退', '后退失败', '后退了一页'],
    browser_go_forward: ['正在前进', '前进失败', '前进了一页'],
    browser_click: ['正在点击', '点击失败', args?.selector ? `点击了 ${args.selector}` : '点击了元素'],
    browser_click_text: ['正在点击', '点击失败', args?.text ? `点击了「${args.text}」` : '点击了文案'],
    browser_type: ['正在填写', '填写失败', args?.selector ? `填写了 ${args.selector}` : '填写了输入框'],
    browser_scroll: ['正在滚动', '滚动失败', '滚动了页面'],
    browser_eval: ['正在执行脚本', '执行脚本失败', '在网页上执行了脚本'],
    browser_wait: ['正在等待', '等待失败', args?.seconds ? `等了 ${args.seconds} 秒` : '等待了一会儿'],
    browser_todo: [
      args?.action === 'check' ? '正在勾选任务' : args?.action === 'add' ? '正在追加任务' : '正在整理任务清单',
      '更新任务清单失败',
      args?.action === 'check'
        ? '勾选了任务项'
        : args?.action === 'add'
          ? '追加了任务项'
          : args?.action === 'clear'
            ? '清空了任务清单'
            : Array.isArray(args?.items)
              ? `写下了 ${args.items.length} 步任务`
              : '更新了任务清单',
    ],
    browser_site_graph: [
      args?.action === 'list' || args?.action === 'get'
        ? '正在查看网站图谱'
        : args?.action === 'reset'
          ? '正在重置网站图谱'
          : '正在修改网站图谱',
      '网站图谱操作失败',
      args?.action === 'upsert_node'
        ? (args?.title ? `更新了图谱节点「${args.title}」` : '更新了图谱节点')
        : args?.action === 'upsert_edge'
          ? `更新了图谱边 ${args?.from || ''}→${args?.to || ''}`
          : args?.action === 'remove_node'
            ? `删除了图谱节点 ${args?.id || ''}`
            : args?.action === 'remove_edge'
              ? `删除了图谱边 ${args?.from || ''}→${args?.to || ''}`
              : args?.action === 'reset'
                ? '重置了网站图谱'
                : args?.action === 'set_notes'
                  ? '更新了图谱备注'
                  : '查看了网站图谱',
    ],
    browser_chaoxing_chapters: ['正在读取章节', '读取章节失败', '读取了章节目录'],
    browser_chaoxing_play: ['正在播放视频', '播放失败', '点了学习通播放'],
    browser_chaoxing_watch: ['正在监控进度', '监控失败', '开始监控视频进度'],
    browser_chaoxing_next: ['正在打开下一节', '打开下一节失败', '打开了下一节视频'],
    browser_chaoxing_homework: [
      args?.action === 'inspect'
        ? '正在读题卡'
        : args?.action === 'list'
          ? '正在查看作业列表'
          : args?.action === 'open'
            ? '正在打开作业'
            : args?.action === 'fill'
              ? '正在填写答案'
              : args?.action === 'guess'
                ? '正在随机选题'
                : '正在操作作业',
      '作业操作失败',
      extra?.questionCount
        ? `读到 ${extra.questionCount} 道题`
        : extra?.pendingCount
          ? `待做 ${extra.pendingCount} 份`
          : extra?.guessed
            ? `随机填了 ${extra.guessed} 道`
            : extra?.title || args?.title
              ? `处理了作业「${extra?.title || args?.title}」`
              : '处理了学习通作业',
    ],
    browser_chaoxing_captcha: ['正在填写验证码', '验证码提交失败', '已提交验证码'],
    browser_finish: [
      args?.status === 'blocked' ? '正在等待用户' : args?.status === 'watching' ? '正在交给监控' : '正在收尾',
      '收尾失败',
      args?.summary
        ? String(args.summary).slice(0, 80)
        : args?.status === 'blocked'
          ? '需要用户处理'
          : args?.status === 'watching'
            ? '已交给后台监控'
            : '任务已完成',
    ],
  }
  if (browserLabels[name]) {
    const [running, failed, done] = browserLabels[name]
    return {
      target: extra?.url || args?.url || args?.selector || '网页',
      label: status === 'running' ? running : status === 'failed' ? failed : done,
    }
  }
  if (name === 'get_file_info') {
    const summary = extra?.type ? `${extra.type}，共 ${extra.total} ${extra.unit}` : ''
    return {
      target: summary || '文件概况',
      label:
        status === 'running'
          ? '正在查看文件概况'
          : status === 'failed'
            ? '查看文件概况失败'
            : summary
              ? `查看了文件概况，${summary}`
              : '查看了文件概况',
    }
  }
  if (name === 'read_range') {
    const unit = extra?.unit || '段'
    const start = extra?.start ?? Number(args?.start ?? 0)
    const end = extra?.end ?? Number(args?.end ?? start)
    const target = `第 ${start}–${end} ${unit}`
    return {
      target,
      label:
        status === 'running'
          ? `正在阅读${target}`
          : status === 'failed'
            ? `阅读${target}失败`
            : `阅读了${target}`,
    }
  }
  if (name === 'list_folders') {
    const count = Array.isArray(extra?.folders) ? extra.folders.length : 0
    return {
      target: '文件夹',
      label:
        status === 'running'
          ? '正在查看文件夹'
          : status === 'failed'
            ? '查看文件夹失败'
            : count
              ? `查看了 ${count} 个文件夹`
              : '查看了文件夹',
    }
  }
  if (name === 'get_folder_info') {
    const folder = extra?.name || args?.folder_name || '文件夹'
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在查看「${folder}」`
          : status === 'failed'
            ? `查看「${folder}」失败`
            : `查看了「${folder}」`,
    }
  }
  if (name === 'create_folder') {
    const folder = extra?.name || args?.name || '文件夹'
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在创建「${folder}」`
          : status === 'failed'
            ? `创建「${folder}」失败`
            : `创建了「${folder}」`,
    }
  }
  if (name === 'rename_folder') {
    const from = extra?.oldName || args?.folder_name || '文件夹'
    const to = extra?.name || args?.new_name || ''
    return {
      target: to || from,
      label:
        status === 'running'
          ? `正在重命名「${from}」`
          : status === 'failed'
            ? `重命名「${from}」失败`
            : to
              ? `把「${from}」改成了「${to}」`
              : `重命名了「${from}」`,
    }
  }
  if (name === 'move_folder') {
    const folder = extra?.name || args?.folder_name || '文件夹'
    const parent = extra?.parentName || args?.parent_name || '最外层'
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在移动「${folder}」`
          : status === 'failed'
            ? `移动「${folder}」失败`
            : `把「${folder}」移到了「${parent}」`,
    }
  }
  if (name === 'delete_folder') {
    const folder = extra?.name || args?.folder_name || '文件夹'
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在删除「${folder}」`
          : status === 'failed'
            ? `删除「${folder}」失败`
            : `删除了「${folder}」`,
    }
  }
  if (name === 'list_questions') {
    const folder = extra?.folderName || args?.folder_name || '文件夹'
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在查看「${folder}」里的题目`
          : status === 'failed'
            ? `查看「${folder}」题目失败`
            : count != null
              ? `查看了「${folder}」里的 ${count} 道题目`
              : `查看了「${folder}」里的题目`,
    }
  }
  if (name === 'search_questions') {
    const keyword = extra?.keyword || args?.keyword || '题目'
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: keyword,
      label:
        status === 'running'
          ? `正在搜索「${keyword}」`
          : status === 'failed'
            ? `搜索「${keyword}」失败`
            : count != null
              ? `找到 ${count} 道与「${keyword}」相关的题目`
              : `搜索了「${keyword}」`,
    }
  }
  if (name === 'get_campus_status') {
    const school = extra?.campus || extra?.name || '校园题库'
    return {
      target: school,
      label:
        status === 'running'
          ? '正在查看校园账号'
          : status === 'failed'
            ? '查看校园账号失败'
            : extra?.loggedIn === false
              ? '还没有登录校园账号'
              : extra?.campus
                ? `查看了校园账号「${school}」`
                : '查看了校园账号',
    }
  }
  if (name === 'list_campus_courses') {
    const count = extra?.count ?? extra?.courses?.length
    const school = extra?.campus || '校园'
    return {
      target: school,
      label:
        status === 'running'
          ? '正在查看校园课程'
          : status === 'failed'
            ? '查看校园课程失败'
            : count != null
              ? `查看了 ${count} 门校园课`
              : '查看了校园课程',
    }
  }
  if (name === 'list_campus_papers') {
    const course = extra?.course || args?.course_name || '课程'
    const count = extra?.count ?? extra?.papers?.length
    return {
      target: course,
      label:
        status === 'running'
          ? `正在查看「${course}」的试卷`
          : status === 'failed'
            ? `查看「${course}」试卷失败`
            : count != null
              ? `查看了「${course}」的 ${count} 份试卷`
              : `查看了「${course}」的试卷`,
    }
  }
  if (name === 'list_campus_questions') {
    const paper = extra?.paper || args?.paper_name || '试卷'
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: paper,
      label:
        status === 'running'
          ? `正在查看校园试卷「${paper}」`
          : status === 'failed'
            ? `查看校园试卷「${paper}」失败`
            : count != null
              ? `查看了「${paper}」里的 ${count} 道校园题`
              : `查看了「${paper}」里的校园题`,
    }
  }
  if (name === 'search_campus_questions') {
    const keyword = extra?.keyword || args?.keyword || '校园题'
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: keyword,
      label:
        status === 'running'
          ? `正在搜索校园题「${keyword}」`
          : status === 'failed'
            ? `搜索校园题失败`
            : count != null
              ? `找到 ${count} 道校园题`
              : `搜索了校园题「${keyword}」`,
    }
  }
  if (name === 'list_campus_tags') {
    const count = extra?.count ?? extra?.tags?.length
    return {
      target: '平台标签',
      label:
        status === 'running'
          ? '正在查看校园平台标签'
          : status === 'failed'
            ? '查看校园平台标签失败'
            : count != null
              ? `查看了 ${count} 个校园平台标签`
              : '查看了校园平台标签',
    }
  }
  if (name === 'update_campus_paper') {
    const paper = extra?.paper || args?.paper_name || args?.name || '试卷'
    const tag = extra?.tag || args?.tag || args?.platform || args?.tag_name
    return {
      target: paper,
      label:
        status === 'running'
          ? `正在修改校园试卷「${paper}」`
          : status === 'failed'
            ? `修改校园试卷失败`
            : tag
              ? `把「${paper}」改成了「${tag}」`
              : `修改了校园试卷「${paper}」`,
    }
  }
  if (name === 'create_campus_paper') {
    const paper = extra?.paper || extra?.name || args?.name || '试卷'
    return {
      target: paper,
      label:
        status === 'running'
          ? `正在创建校园试卷「${paper}」`
          : status === 'failed'
            ? `创建校园试卷失败`
            : extra?.already
              ? `校园试卷「${paper}」已存在`
              : `创建了校园试卷「${paper}」`,
    }
  }
  if (name === 'save_campus_questions') {
    const count = extra?.saved ?? extra?.count ?? (Array.isArray(args?.questions) ? args.questions.length : 0)
    const paper = extra?.paper || args?.paper_name || '校园试卷'
    const target = count ? `${count} 道题目` : '题目'
    return {
      target,
      label:
        status === 'running'
          ? `正在上传${target}到「${paper}」`
          : status === 'failed'
            ? `上传校园题失败`
            : `上传了${target}到「${paper}」`,
    }
  }
  if (name === 'update_campus_question') {
    const count = extra?.updated ?? extra?.count ?? (Array.isArray(args?.questions) ? args.questions.length : args?.campus_question_id ? 1 : 0)
    return {
      target: count ? `${count} 道校园题` : '校园题',
      label:
        status === 'running'
          ? '正在修改校园题'
          : status === 'failed'
            ? '修改校园题失败'
            : `修改了 ${count || 0} 道校园题`,
    }
  }
  if (name === 'move_questions') {
    const count = extra?.moved ?? (Array.isArray(args?.question_ids) ? args.question_ids.length : args?.question_id ? 1 : 0)
    const folder = extra?.targetName || args?.folder_name || '文件夹'
    const target = count ? `${count} 道题目` : '题目'
    return {
      target,
      label:
        status === 'running'
          ? `正在移动${target}`
          : status === 'failed'
            ? `移动${target}失败`
            : `把${target}移到了「${folder}」`,
    }
  }
  if (name === 'save_questions') {
    const count = extra?.saved ?? (Array.isArray(args?.questions) ? args.questions.length : 0)
    const folder = extra?.folderName || args?.folder_name || '题库'
    const target = count ? `${count} 道题目` : '题目'
    return {
      target,
      label:
        status === 'running'
          ? `正在写入${target}`
          : status === 'failed'
            ? `写入${target}失败`
            : `写入了${target}到「${folder}」`,
    }
  }
  if (name === 'update_question_metrics') {
    const count = extra?.updated ?? (Array.isArray(args?.question_ids) ? args.question_ids.length : args?.question_id ? 1 : 0)
    return {
      target: count ? `${count} 道题目` : '题目指标',
      label:
        status === 'running'
          ? '正在更新题目指标'
          : status === 'failed'
            ? '更新题目指标失败'
            : `更新了 ${count || 0} 道题目的指标`,
    }
  }
  if (name === 'list_recent_wrong_questions') {
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: extra?.scope || '错题',
      label:
        status === 'running'
          ? '正在查看最近错题'
          : status === 'failed'
            ? '查看最近错题失败'
            : count != null
              ? `查看了 ${count} 道最近错题`
              : '查看了最近错题',
    }
  }
  if (name === 'get_practice_history') {
    const count = extra?.count ?? extra?.records?.length
    return {
      target: args?.question_id ? `题目 ${args.question_id}` : '练习记录',
      label:
        status === 'running'
          ? '正在查看练习记录'
          : status === 'failed'
            ? '查看练习记录失败'
            : count != null
              ? `查看了 ${count} 条练习记录`
              : '查看了练习记录',
    }
  }
  if (name === 'add_practice_note') {
    return {
      target: args?.question_id ? `题目 ${args.question_id}` : '备注',
      label:
        status === 'running'
          ? '正在写入备注'
          : status === 'failed'
            ? '写入备注失败'
            : '记下了一条练习备注',
    }
  }
  if (name === 'present_quiz') {
    const count = extra?.presented ?? (Array.isArray(args?.questions) ? args.questions.length : 0)
    const title = resolveQuizTitle(args) || extra?.title
    return {
      target: title && title !== '练习' ? title : (count ? `${count} 道练习` : '练习'),
      label:
        status === 'running'
          ? title && title !== '练习' ? `正在出「${title}」` : '正在出题'
          : status === 'failed'
            ? title && title !== '练习' ? `「${title}」出题失败` : '出题失败'
            : title && title !== '练习'
              ? `出示了「${title}」${count} 道可点选练习`
              : `出示了 ${count} 道可点选练习`,
    }
  }
  if (name === 'link_questions_to_knowledge') {
    const count = extra?.linked ?? (Array.isArray(args?.question_ids) ? args.question_ids.length : args?.question_id ? 1 : 0)
    return {
      target: count ? `${count} 道题目` : '题目',
      label:
        status === 'running'
          ? '正在关联知识点'
          : status === 'failed'
            ? '关联知识点失败'
            : `关联了 ${count || 0} 道题目的知识点`,
    }
  }
  if (name === 'list_knowledge_questions') {
    const title = extra?.node_name || args?.node_name || '知识点'
    return {
      target: title,
      label:
        status === 'running'
          ? `正在查看「${title}」的题目`
          : status === 'failed'
            ? '查看知识点题目失败'
            : `查看了「${title}」的相关题目`,
    }
  }
  if (name === 'merge_subjects') {
    return {
      target: extra?.name || args?.target_name || '科目',
      label:
        status === 'running'
          ? '正在合并科目'
          : status === 'failed'
            ? '合并科目失败'
            : extra?.message || '合并了学习科目',
    }
  }
  if (name === 'split_subject') {
    return {
      target: extra?.name || args?.name || '科目',
      label:
        status === 'running'
          ? '正在拆分科目'
          : status === 'failed'
            ? '拆分科目失败'
            : extra?.message || '拆分了学习科目',
    }
  }
  if (name === 'list_subjects') {
    return {
      target: '学习科目',
      label: status === 'running' ? '正在查看科目' : status === 'failed' ? '查看科目失败' : '查看了学习科目',
    }
  }
  if (name === 'get_subject') {
    const title = extra?.name || args?.subject_name || '科目'
    return {
      target: title,
      label: status === 'running' ? `正在查看「${title}」` : status === 'failed' ? `查看「${title}」失败` : `查看了「${title}」`,
    }
  }
  if (name === 'open_knowledge_graph') {
    const title = extra?.name || args?.subject_name || '思维导图'
    return {
      target: title,
      label: status === 'running' ? '正在展开思维导图' : status === 'failed' ? '展开思维导图失败' : `展开了「${title}」的思维导图`,
    }
  }
  if (name === 'evaluate_study_progress') {
    const title = extra?.name || args?.subject_name || '掌握度'
    const count = extra?.updated
    return {
      target: title,
      label: status === 'running'
        ? '正在评估掌握度'
        : status === 'failed'
          ? '评估掌握度失败'
          : extra?.started && count == null
            ? '正在后台评估学习效果'
            : count
              ? `评估完这次的学习效果，更新了 ${count} 个知识点`
              : extra?.message || '完成了学习效果评估',
    }
  }
  if (name === 'create_subject') {
    return {
      target: args?.name || extra?.name || '科目',
      label: status === 'running' ? '正在创建科目' : status === 'failed' ? '创建科目失败' : `创建了科目「${args?.name || extra?.name || ''}」`,
    }
  }
  if (name === 'rename_subject') {
    return {
      target: args?.new_name || '科目',
      label: status === 'running' ? '正在重命名科目' : status === 'failed' ? '重命名科目失败' : '重命名了科目',
    }
  }
  if (name === 'delete_subject') {
    return {
      target: args?.subject_name || '科目',
      label: status === 'running' ? '正在删除科目' : status === 'failed' ? '删除科目失败' : '删除了学习科目',
    }
  }
  if (name === 'attach_study_subject') {
    const title = extra?.name || args?.subject_name || '科目'
    return {
      target: title,
      label: status === 'running' ? '正在挂上学习状态' : status === 'failed' ? '挂上学习状态失败' : `挂上了「${title}」`,
    }
  }
  if (name === 'detach_study_subject') {
    return {
      target: extra?.name || '学习状态',
      label: status === 'running' ? '正在撤下学习状态' : status === 'failed' ? '撤下学习状态失败' : '撤下了学习状态',
    }
  }
  if (name === 'get_knowledge_graph') {
    const missed = extra?.found === false
    return {
      target: extra?.subject?.name || args?.subject_name || '知识图谱',
      label:
        status === 'running'
          ? '正在查看知识图谱'
          : status === 'failed'
            ? '查看知识图谱失败'
            : missed
              ? '未匹配到知识图谱'
              : '查看了知识图谱',
    }
  }
  if (name === 'set_knowledge_graph') {
    const count = extra?.subject?.node_count ?? extra?.nodes?.length ?? extra?.node_count ?? args?.nodes?.length
    return {
      target: extra?.subject?.name || args?.subject_name || '知识图谱',
      label:
        status === 'running'
          ? '正在绘制知识图谱'
          : status === 'failed'
            ? '绘制知识图谱失败'
            : `写入了 ${count || 0} 个知识点`,
    }
  }
  if (name === 'patch_knowledge_graph') {
    const count = extra?.added ?? (Array.isArray(args?.add) ? args.add.length : 0)
    return {
      target: extra?.subject?.name || args?.subject_name || '知识图谱',
      label:
        status === 'running'
          ? '正在添加知识点'
          : status === 'failed'
            ? '添加知识点失败'
            : count
              ? `添加了 ${count} 个知识点`
              : '更新了知识图谱',
    }
  }
  if (name === 'focus_knowledge_graph') {
    const title = extra?.node?.name || args?.node_name || '节点'
    return {
      target: extra?.subject?.name || args?.subject_name || '知识图谱',
      label:
        status === 'running'
          ? `正在聚焦「${title}」`
          : status === 'failed'
            ? `聚焦「${title}」失败`
            : `聚焦了「${title}」`,
    }
  }
  return { target: name, label: name || '未知动作' }
}
