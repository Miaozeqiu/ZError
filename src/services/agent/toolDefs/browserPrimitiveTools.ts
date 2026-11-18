/** 通用浏览器原语。页面身份看网站地图，进度监控用 browser_watch。 */
import { WEBSITE_ICON_TOOL } from './websiteTools'
import { HISTORY_TOOLS } from './historyTools'
import {
  LIST_AGENT_SKILLS_TOOL,
  READ_AGENT_SKILL_FILE_TOOL,
  READ_AGENT_SKILL_TOOL,
  RESET_AGENT_SKILL_FILE_TOOL,
  WRITE_AGENT_SKILL_FILE_TOOL,
} from '../skillTools'

const homeworkQuestionRange = {
  type: 'object', description: '用户指定的网页题号范围（含起止），如第 1–5 题传 {"start":1,"end":5}。只处理一题时两个值相同。',
  properties: { start: { type: 'integer', minimum: 1 }, end: { type: 'integer', minimum: 1 } }, required: ['start', 'end'],
}
const chapterQuizTarget = {
  chapter_key: { type: 'string', description: '章节测验使用 needs_quiz 或 browser_review_chapter 返回的 chapterKey。' },
  quiz_job_id: { type: 'string', description: '章节测验任务点标识，使用返回的 quiz_job_id。同页有多个测验时必填。' },
}
const chapterDiscussionTarget = {
  chapter_key: { type: 'string', description: '章节工具返回的 chapterKey。' },
  tab: { type: 'integer', minimum: 1, description: '讨论所在的章节页签编号。' },
  discussion_id: { type: 'string', description: '章节工具返回的 discussion_id。' },
}

export const BROWSER_PRIMITIVE_TOOLS = [
  ...HISTORY_TOOLS,
  WEBSITE_ICON_TOOL,
  { type: 'function', function: { name: 'browser_home_shortcuts', description: '管理 ZError 浏览器「导航」首页的本地快捷入口。按用户要求查看、新增、改名、改网址或删除。必要时先打开导航页。', parameters: {
    type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'add', 'update', 'remove'] },
      target: { type: 'string', description: '更新或删除时填写已有入口的 ID、完整名称或完整网址。' },
      name: { type: 'string', description: '新增必填。更新时仅在需要改名时填写。' },
      url: { type: 'string', description: '新增必填。更新时仅在需要换地址时填写。使用完整 HTTP 或 HTTPS URL。' },
    }, required: ['action'], additionalProperties: false,
  } } },
  { type: 'function', function: { name: 'browser_answer_zjooc', description: '在浙学作业或测验：自动登录提示、匹配或生成答案、逐题填写并回读。每批五题，按 nextOffset 和 assignment_id 继续；单题模式按用户范围点下一题。needs_review 需核对，保留已有作答，不交卷。', parameters: {
    type: 'object', properties: { assignment_id: { type: 'string' }, offset: { type: 'integer', minimum: 0 },
      question_range: { type: 'object', properties: { start: { type: 'integer', minimum: 1 }, end: { type: 'integer', minimum: 1 } }, required: ['start', 'end'], additionalProperties: false } }, additionalProperties: false,
  } } },
  { type: 'function', function: { name: 'browser_play_zjooc', description: '在浙学小节播放页。默认启动当前视频并监控；title 精确指定本节一条视频；mode=section 按页签顺序播完本小节所有未完成视频。连续播放时一次调用即可。',
    parameters: { type: 'object', properties: {
      mode: { type: 'string', enum: ['current', 'section'] },
      title: { type: 'string', description: '仅限 current 模式，填页面显示的视频全名。' },
    }, additionalProperties: false },
  } },
  { type: 'function', function: { name: 'browser_request_credentials', description: '当前 HTTPS 登录页需要账号密码时，在聊天中显示安全输入表单。已配置时直接返回本站引用。用 browser_type 的 secret_ref 填写；用户取消时停止登录。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  } },
  { type: 'function', function: { name: 'browser_login_zjooc', description: '安全登录在浙学。先不传参数检查登录态或获取验证码图片。看清验证码后传 captcha_id 和 captcha_code，宿主负责提交并核对是否登录。看不清时等待用户验证。账号密码由宿主管理。',
    parameters: { type: 'object', properties: {
      captcha_id: { type: 'string', description: '本轮登录工具回执中的验证码图片标识。' },
      captcha_code: { type: 'string', description: '当前图片上看到的 5 位字母或数字，保留大小写。' },
      wait_for_verification: { type: 'boolean', description: '无法看清图片时设为 true，等待用户在网页完成验证。' },
    }, additionalProperties: false },
  } },
  { type: 'function', function: { name: 'browser_login_chaoxing', description: '登录学习通或确认已有登录态。软件使用已保存的学习通凭据，核对空间页才返回 loggedIn=true。出现验证码或滑块时返回人工处理提示。无需传参。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  } },
  { type: 'function', function: { name: 'browser_list_courses', description: '用学习通网站脚本打开「我学的课」并列出学生课程。可按课名过滤，nextOffset 可翻看已采集的下一批。', parameters: {
    type: 'object', properties: { course_name: { type: 'string', description: '可选的课程名称筛选' }, offset: { type: 'integer', minimum: 0 } },
  } } },
  { type: 'function', function: { name: 'browser_open_course', description: '根据用户指定的名称直接进入学习通学生课程。打开唯一匹配后核对落地页，并返回可用的页面快照与 ref。重名时返回候选，请用户确认。', parameters: {
    type: 'object', properties: { course_name: { type: 'string', description: '用户提供的学习通课程名' }, teacher: { type: 'string', description: '用户提供的授课教师，可用于区分重名课程' } }, required: ['course_name'],
  } } },
  { type: 'function', function: { name: 'browser_list_homework', description: '读取学习通学生课程的作业列表与状态，自动处理网页分页。可筛选作业名；未给课名时使用当前课程。nextOffset 用于继续查看结果。', parameters: {
    type: 'object', properties: { course_name: { type: 'string' }, teacher: { type: 'string' }, homework_name: { type: 'string' }, offset: { type: 'integer', minimum: 0 } },
  } } },
  { type: 'function', function: { name: 'browser_open_homework', description: '根据用户指定的作业名在当前学习通课程中直接打开作业。可同时传课名；匹配唯一后返回落地页快照和 ref。仅打开页面。', parameters: {
    type: 'object', properties: { course_name: { type: 'string' }, teacher: { type: 'string' }, homework_name: { type: 'string' },
      homework_url: { type: 'string', description: '本地经验中与指定课程、作业唯一匹配的已核对顶层 HTTPS 地址。传完整作业名；失效时省略此参数并按课名查找。' },
    }, required: ['homework_name'],
  } } },
  { type: 'function', function: { name: 'browser_answer_homework', description: '逐批填写并回读学习通课程作业或章节测验，每批最多八题。章节测验须传 chapter_key，并沿用 quiz_job_id。使用本地题库精确答案，核实后可用 answers 补填。保留已有冲突答案。不保存、不交卷。', parameters: {
    type: 'object', properties: {
      assignment_id: { type: 'string', description: '同一作业续批或补填时，使用前次填答或复核返回的值；补填必填' },
      question_range: homeworkQuestionRange,
      ...chapterQuizTarget,
      offset: { type: 'integer', minimum: 0, description: '当前范围的分页游标，首批省略；后续传 nextOffset 并保留同一范围。' },
      answers: { type: 'array', minItems: 1, maxItems: 8, description: '仅提交已核实的漏题答案；传入后只补填这些题',
        items: { type: 'object', required: ['question_id'], properties: {
          question_id: { type: 'string' }, choices: { type: 'array', items: { type: 'string' }, description: '当前页面选项字母；单选、判断传一个' },
          blanks: { type: 'array', items: { type: 'string' }, description: '按当前页面填空次序提供每空的正文' },
        } } },
    },
  } } },
  { type: 'function', function: { name: 'browser_review_homework', description: '只读查看和复核学习通课程作业或章节测验的题干、选项、实际作答、空白项。用 question_range 限定题号；有 nextOffset 时沿用同一目标和范围继续。', parameters: {
    type: 'object', properties: { assignment_id: { type: 'string' }, ...chapterQuizTarget, question_range: homeworkQuestionRange, offset: { type: 'integer', minimum: 0 } },
  } } },
  { type: 'function', function: { name: 'browser_review_chapter_discussion', description: '读取当前学习通章节讨论的题目和少量匿名回复样本，或复核先前回复的发布与任务点状态。', parameters: {
    type: 'object', properties: chapterDiscussionTarget, required: ['chapter_key', 'tab', 'discussion_id'], additionalProperties: false,
  } } },
  { type: 'function', function: { name: 'browser_reply_chapter_discussion', description: '将 Agent 根据题目和已有回复写出的原创正文发送到当前学习通章节话题，并回读网页确认。使用 needs_discussion 返回的章、页签和话题标识。用户授权时调用一次。', parameters: {
    type: 'object', properties: { ...chapterDiscussionTarget, reply: { type: 'string', minLength: 1, maxLength: 4000, description: '实际要发到课程里的纯文本正文。' } },
    required: ['chapter_key', 'tab', 'discussion_id', 'reply'], additionalProperties: false,
  } } },
  { type: 'function', function: {
    name: 'browser_start_chapter_tasks',
    description: '启动学习通章节工作流。宿主打开课程，按顺序处理视频、课件、已授权的测验，并在遇到讨论时直接返回题目和已有回复。核对当前任务点后继续原工作流。只完成当前小节时传 current_only=true；继续同一课程可省略 course_name。',
    parameters: { type: 'object', properties: {
      course_name: { type: 'string', description: '用户提供的课程名，支持唯一匹配' },
      teacher: { type: 'string', description: '重名时用户提供的授课教师' },
      current_only: { type: 'boolean', description: '用户只指定当前小节时使用，不与 course_name 同时传入' },
      video_only: { type: 'boolean', description: '用户只要求视频任务时传 true' },
    } },
  } },
  { type: 'function', function: { name: 'browser_open_pending_chapter', description: '用户要求完成学习通整门课的章节任务或按目录继续时，在已确认是目标学生课程的「章节」目录或小节调用。从目录直接找出尚有待完成任务点的小节并打开。当前小节未完成时返回当前小节。无需逐个探查目录或手工建立整课计划。指定某几个小节时按用户点名定位。', parameters: {
    type: 'object', properties: {},
  } } },
  { type: 'function', function: { name: 'browser_review_chapter', description: '在学习通学生端章节学习页只读核对当前小节、任务点、可用页签及目录待完成数。返回 chapterKey，完成本章时先用这个工具确认目标。', parameters: {
    type: 'object', properties: { chapter_key: { type: 'string', description: '可选。用上一次返回的 chapterKey 核对仍在同一个章节' }, video_mid: { type: 'string', description: '核对已有回执中原视频的标识' } },
  } } },
  { type: 'function', function: { name: 'browser_complete_chapter', description: '学习通学生端完成当前章节的专用工具。每次处理一个任务点或切换同章页签。视频成功播放后主 Agent 自动等待事件。返回 video_event 时重新复核，仍返回 watching=true 时用 browser_finish(watching)。测验、文档和讨论返回当前任务与后续操作。依据平台标记核对章节完成。', parameters: {
    type: 'object', properties: {
      chapter_key: { type: 'string', description: 'browser_review_chapter 刚核对的 chapterKey' },
      video_only: { type: 'boolean', description: '用户只要求处理视频时传 true' },
      video_mid: { type: 'string', description: '继续已有播放回执中的原视频时传入，限定为该视频' },
      tab: { type: 'integer', minimum: 1, description: '可选。当需要核对其他页签时，传复核返回的页签编号。省略时按任务点和页签顺序处理。' },
    }, required: ['chapter_key'],
  } } },
  { type: 'function', function: { name: 'browser_select_tab', description: '切换到当前对话拥有的已有标签，不新建或导航。browser_run_status 返回 tabs ID；切换后重新读取页面，不复用旧 ref。', parameters: { type: 'object', properties: { browser_id: { type: 'string' } }, required: ['browser_id'] } } },
  { type: 'function', function: { name: 'browser_run_status', description: '查看当前运行状态、预算、故障码和不含敏感正文的诊断轨迹。', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'browser_verify_operation', description: '网页操作返回结果不确定时，先在原标签读取新页面或截图，核对实际回执后登记结果。不能用旧快照，也不能以点击成功代替提交成功。', parameters: {
    type: 'object', properties: { operation_id: { type: 'string' }, observation_id: { type: 'string' }, outcome: { type: 'string', enum: ['completed', 'not_completed'] }, evidence: { type: 'string', description: '新页面中证明已完成或未完成的具体状态；不写账号密码。' } }, required: ['operation_id', 'observation_id', 'outcome', 'evidence'],
  } } },
  {
    type: 'function',
    function: {
      name: 'browser_decode_chaoxing_font',
      description: '学习通题干或选项出现字体混淆时，按 OCS 的字形匹配读取各 iframe 中的原文；匹配不可靠时返回当前截图供视觉核验。结合页面快照核对题目、选项及控件，不要凭乱码猜测。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_set_checked',
      description: '将复选框或单选框设为指定状态，已符合状态的不重复点击。使用控件 ref，或目标容器内唯一的 selector；勿用全页 nth 猜控件。批量顺序处理，失败立即停止。仅验证 checked 状态，不保存或提交表单；用于答题时也不验证答案内容。',
      parameters: {
        type: 'object', properties: {
          items: { type: 'array', minItems: 1, maxItems: 40, items: {
            type: 'object', properties: {
              ref: { type: 'string' }, selector: { type: 'string' },
              nth: { type: 'integer', minimum: 1 }, frame: { type: 'string' }, checked: { type: 'boolean' },
            }, required: ['checked'],
          } },
        }, required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_state',
      description: '查看当前网址、标题、图谱节点和本站经验。看元素、点元素都用快照里的 ref。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_site_graph',
      description: '查看网站图谱。应用内自建网站的图谱可增量修改，upsert_site 后用 upsert_node/upsert_edge 自动保存。仓库或自定义 HTTP 接口的图谱只读，导航补充写入本站本地经验。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'get', 'upsert_site', 'upsert_node', 'remove_node', 'upsert_edge', 'remove_edge', 'set_notes', 'save', 'reset'],
            description: 'list/get 查看；upsert_site 建站；upsert_node/edge 增改节点边（自动保存）；save 把内存图谱落盘；reset 从文件恢复',
          },
          siteId: { type: 'string', description: '站点 id，学习通默认 chaoxing；新站点用主机名' },
          host: { type: 'string', description: 'upsert_site 的主机，如 example.com' },
          hostPattern: { type: 'string', description: '站点 URL 正则，默认按 host 转义' },
          name: { type: 'string', description: '站点显示名' },
          id: { type: 'string', description: '节点 id，如 homework-quiz' },
          title: { type: 'string', description: '节点标题' },
          path: { type: 'string', description: '路径说明，给用户看' },
          summary: { type: 'string', description: '节点短说明' },
          structure: { type: 'string', description: '页内结构：入口、iframe 与主要控件' },
          frame: {
            type: 'object',
            description: '页面中已确认的 iframe 外壳标识',
            properties: {
              name: { type: 'string', description: '页面中实际观察到的 iframe 名称或标识' },
              title: { type: 'string', description: '框里是什么' },
              open: { type: 'string', enum: ['top', 'stay'] },
            },
          },
          frames: {
            type: 'array',
            description: '同一 iframe 中实际观察到的页签，通常作为当前节点的子视图记录',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                tab: { type: 'string' },
                name: { type: 'string' },
                title: { type: 'string' },
                open: { type: 'string', enum: ['top', 'stay'] },
                patterns: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          patterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'URL 正则数组，命中任一即认为当前在此节点',
          },
          row: { type: 'integer', description: '布局行，0 起' },
          col: { type: 'integer', description: '布局列：-1 左 / 0 中 / 1 右' },
          from: { type: 'string', description: '边起点节点 id' },
          to: { type: 'string', description: '边终点节点 id' },
          label: { type: 'string', description: '边标签' },
          kind: { type: 'string', enum: ['forward', 'back', 'loop'], description: '边类型' },
          notes: { type: 'array', items: { type: 'string' }, description: '站点备注' },
          note: { type: 'string', description: '单条备注（等价 notes=[note]）' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_page',
      description: '读取当前网页的无障碍快照（role / name / ref，含 iframe 分段）。看页面、点元素、填框都用这份快照里的 ref。快照够用就用 ref。要搜某一句用 browser_find。要读 id / aria 再用只读 eval。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_find',
      description: '在上一份快照里搜索文案或正则，返回命中行、前后文和 ref。缓存超过约 4 秒才重新采集。用来避免把整页快照再读一遍。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要找的文案。regex 为真时是正则。' },
          regex: { type: 'boolean', description: '把 query 当正则。可用 /pattern/i。' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: '打开 http/https 网址。',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'http/https 网址' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_reload',
      description: '刷新当前网页。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_go_back',
      description: '后退到上一页。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_go_forward',
      description: '前进到下一页。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: '优先点击最新快照中的 ref，也接受已观察到的 selector 或可见文字 text（文字与 browser_click_text 相同）。ref 已包含节点身份，不要自行加 nth。CSS nth 从 1 开始，计入隐藏节点；按 frame 限定 iframe。成功表示点击已执行，是否跳转或提交须核对后续页面。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: '快照编号，如 e3。不要放 CSS。' },
          selector: { type: 'string', description: '目标控件的 CSS 选择器，使用已在页面中核实的选择器。' },
          text: { type: 'string', description: '没有 ref/selector 时按可见文字定位，优先使用快照中唯一的精确匹配。' },
          nth: { type: 'integer', description: '第几个匹配，从 1 开始。' },
          frame: { type: 'string', description: 'iframe 的 id / mid / src 子串。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click_text',
      description: '按可见文案点击按钮或链接。同文案多个用 nth（从 1）；在某个 iframe 里用 frame。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '按钮或链接上的文字，尽量短且精确' },
          nth: { type: 'integer', description: '第几个匹配，从 1 开始。' },
          frame: { type: 'string', description: 'iframe 的 id / mid / src 子串。' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: '填写输入框，不自动提交或按回车。优先使用最新 textbox ref；搜索框填好后如需回车，用 browser_press Enter 并核对结果。不要用脚本改 value。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: '快照里的 textbox 编号，如 e14。填表用这个。' },
          selector: { type: 'string', description: '没有 ref 时才用的 CSS。不要为了找选择器去 eval。' },
          text: { type: 'string', description: '普通文字。账号密码使用 secret_ref，不得传真实值。' },
          secret_ref: { type: 'string', description: 'protect_credentials 返回的完整 {{secret:...}} 变量，与 text 互斥。' },
          nth: { type: 'integer', description: '第几个匹配，从 1 开始。' },
          frame: { type: 'string', description: 'iframe 的 id / mid / src 子串。' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_press',
      description: '向当前焦点发送按键。输入框填好后可按 Enter 搜索或提交；Escape 可关闭弹窗。使用前确认焦点和页面上下文，按键后核对实际变化。',
      parameters: { type: 'object', properties: {
        key: { type: 'string', enum: ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'] },
      }, required: ['key'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: '滚动页面。正数向下，负数向上。',
      parameters: {
        type: 'object',
        properties: { amount: { type: 'integer', description: '像素，默认 600' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_eval',
      description:
        '只读检查快照缺失的结构、题干与选项关联或实际控件状态。读取子框时，先用 browser_get_page 找到 frames 中对应的 frameId 和 loaderId，再作为工具参数传入。脚本直接读取目标框的 document，禁止使用 iframe.contentDocument 或 contentWindow；frame 仅作兼容定位，all 默认 false。框失效时重新读取快照。按需一次返回结构化结果；有序内容按 DOM 顺序返回数组，每项绑定页面显示序号、原文和元素 ID/ref，不能按数字键排序推断题号。仅读取已渲染页面，不改值、勾选、点击、播放或调用隐藏接口。',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string' },
          frameId: { type: 'string', description: '快照中的精确 frameId，优先使用；不要填 iframe 的 HTML id 或框路径。' },
          loaderId: { type: 'string', description: '与 frameId 同一份快照中的 loaderId，文档更换后必须重新读取。' },
          frame: { type: 'string', description: 'iframe 的 id / mid / src 子串。' },
          all: { type: 'boolean', description: '扫全部 frame。默认 false。' },
        },
        required: ['script'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: '拍摄当前页可视区域，保留已有 ref，不自动更新快照。用于布局、遮挡或验证码识图；题干与选项优先用快照/只读结构提取。验证码同时附原图（若有）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_watch',
      description: '挂上当前页视频进度监控。可以传快照里的 video ref。播完会叫醒。挂上之后 finish(watching)，不要用脚本盯进度。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '当前任务点标题，可选' },
          ref: { type: 'string', description: '快照里的 video / audio ref，如 e12' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait',
      description: '等待条件成立或超时。有监控或课程计划在跑时，fn 和 selector 超过 20 秒会直接拒绝，应 finish(watching)。',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'integer', description: '最长等待秒数。panel 默认 180，其它默认 30。' },
          until: {
            type: 'string',
            enum: ['panel', 'url', 'selector', 'idle', 'fn', 'response'],
            description: 'panel=解析面板；url=网址；selector=CSS；fn=脚本为真；response=网络响应；idle=页面稳定',
          },
          url: { type: 'string', description: 'until=url 时的子串或正则' },
          selector: { type: 'string', description: 'until=selector 时的 CSS' },
          fn: { type: 'string', description: 'until=fn 时的 JS，返回真值即结束。默认顶层。' },
          response: { type: 'string', description: 'until=response 时匹配的请求 URL 子串，使用当前页面已观察到的请求路径' },
          frame: { type: 'string', description: 'fn / selector 所在 iframe 的 id / mid / src 子串。' },
          idleMs: { type: 'integer', description: 'until=idle 时稳定毫秒，默认 800' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_course_plan',
      description: '把一门课交给宿主循环。from_snapshot 用快照里的目录和 [done]/[current] 建计划，不用写 CSS。start 会自己点一条来验证下一节。视频和文档宿主自己做，测验和作业做不了时只叫醒这一条。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['set', 'from_host', 'from_snapshot', 'save_recipe', 'start', 'resume', 'status', 'set_kind', 'skip', 'stop'],
          },
          items: {
            type: 'array',
            description: '清单。每条有 label、kind（video/quiz/homework/doc/other），可选 ref、frame、doneText',
            items: { type: 'object' },
          },
          skips: {
            type: 'object',
            description: 'quiz/homework: skip|save|ask；doc: skip|read',
          },
          recipe: { type: 'object', description: '导航配方，字段只有 item、current、done、next、nextButton、inner' },
          label: { type: 'string' },
          kind: { type: 'string', enum: ['video', 'quiz', 'homework', 'doc', 'other'] },
          host: { type: 'string' },
          courseId: { type: 'string' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_todo',
      description: '记录多步任务进度，set 写具体步骤，实际完成后 check。清单不是用户授权，也不能证明操作成功；有未完成步骤时不要 finish(done)。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['set', 'add', 'check', 'clear'],
            description: 'set 整表重写；add 追加；check 勾选/改状态；clear 清空',
          },
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'set 时的步骤文案，3–8 条为宜，用你自己的话写清楚要做什么',
          },
          text: { type: 'string', description: 'add 的文案；check 也可传步骤原文来勾选' },
          id: { type: 'string', description: 'check 时的项 id' },
          index: { type: 'integer', description: 'check 时的序号，从 1 起。都不传就勾第一项未完成' },
          status: {
            type: 'string',
            enum: ['done', 'pending', 'cancelled'],
            description: 'check 目标状态，默认 done',
          },
          reason: { type: 'string', description: '取消步骤、替换或清空未完成清单时必填，说明用户目标或计划为何调整。任务受阻不能假装取消。' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_task',
      description: '派出 explore 或 execute 子 Agent。站点经验使用 write_agent_skill_file 记录。',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['explore', 'execute'],
            description: 'explore 只看页；execute 按目标点页面',
          },
          goal: { type: 'string', description: '子任务目标，必填' },
          todoId: { type: 'string', description: '对应清单项 id，子成功则自动 check' },
          maxRounds: {
            type: 'integer',
            description: '子循环上限。explore 默认 24，execute 默认 40',
          },
        },
        required: ['kind', 'goal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_finish',
      description: 'done/blocked 最终收尾；watching 仅进入当前任务的视频事件等待，视频播完或异常后会返回并继续原任务，不能提前输出最终结果。done 前检查本轮站点经验并填写 learning；新方法先读原 Skill、有增量才写入，实际保存成功才能填 updated。summary 概括实际状态。',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['done', 'blocked', 'watching'],
            description: 'done 任务实际完成；blocked 需要用户处理；watching 保持当前任务等待视频事件',
          },
          summary: { type: 'string', description: '你自己写的一两句真实结果，禁止套话' },
          completion: {
            type: 'object', description: '仅用户明确指定编号章节时：用最新 get_page/screenshot 核对所有目标完成标记，引用其 observation_id。整门课不能用此缩小范围。',
            properties: {
              observation_id: { type: 'string', description: '最近一次真实页面或截图返回的 observation_id；eval、清单和 summary 不算。' },
              targets: { type: 'array', items: { type: 'string' }, description: '用户指定的全部章节编号，如 ["2.1","2.2"]，不能遗漏或新增。' },
              evidence: { type: 'string', description: '具体页面可见标记、提交回执等证据，不能只写已完成；保留实际分数，不把完成等同满分。' },
            }, required: ['observation_id', 'targets', 'evidence'],
          },
          learning: {
            type: 'object', description: '多步网页任务收尾检查；只复用旧步骤可 no_new，covered 必须读过本站 Skill，updated 必须先读后成功写入，deferred 需权限禁止/写入失败证据。',
            properties: {
              decision: { type: 'string', enum: ['updated', 'covered', 'no_new', 'deferred'] },
              reason: { type: 'string', description: '具体的新经验、已有覆盖位置或不保存理由；不要把勾选成功当答案正确。' },
            }, required: ['decision', 'reason'],
          },
        },
        required: ['status', 'summary'],
      },
    },
  },
  LIST_AGENT_SKILLS_TOOL,
  READ_AGENT_SKILL_TOOL,
  READ_AGENT_SKILL_FILE_TOOL,
  WRITE_AGENT_SKILL_FILE_TOOL,
  RESET_AGENT_SKILL_FILE_TOOL,
]

