/** 通用浏览器原语。页面身份看网站地图，进度监控用 browser_watch。 */
import {
  LIST_AGENT_SKILLS_TOOL,
  READ_AGENT_SKILL_FILE_TOOL,
  READ_AGENT_SKILL_TOOL,
  RESET_AGENT_SKILL_FILE_TOOL,
  WRITE_AGENT_SKILL_FILE_TOOL,
} from '../skillTools'

export const BROWSER_PRIMITIVE_TOOLS = [
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
      description: '查看或增量修改当前网站图谱。新站点 upsert_site，再 upsert_node/upsert_edge。每次增改会自动保存。整张图用这个工具一条条改。',
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
          structure: { type: 'string', description: '页内结构：入口、iframe、这页能不能挂解析器' },
          frame: {
            type: 'object',
            description: '页内框外壳，如 #frame_content',
            properties: {
              name: { type: 'string', description: '框名，如 #frame_content' },
              title: { type: 'string', description: '框里是什么' },
              open: { type: 'string', enum: ['top', 'stay'] },
            },
          },
          frames: {
            type: 'array',
            description: '同一 iframe 里的页签（如空间的「我教的课 / 我学的课」），不要为此再建节点',
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
          parserIds: {
            type: 'array',
            items: { type: 'string' },
            description: '本站解析包角色：学习通 homework / study；其它站 parsers/<role> 的角色名。login / captcha 可以只当角色、没有包。',
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
      description: '点击页面元素。快照编号用 ref=e3；CSS 用 selector=#loginBtn。不要把 CSS 放进 ref。同文案多个用 nth（从 1）；在某个 iframe 里用 frame。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: '快照编号，如 e3。不要放 CSS。' },
          selector: { type: 'string', description: 'CSS，如 #loginBtn。登录按钮用这个。' },
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
      description: '向输入框填写文字，不会按回车，走 CDP。必须用快照里的 textbox ref，例如 ref=e14。不要先 eval 查 input id，也不要用脚本改 value。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: '快照里的 textbox 编号，如 e14。填表用这个。' },
          selector: { type: 'string', description: '没有 ref 时才用的 CSS。不要为了找选择器去 eval。' },
          text: { type: 'string' },
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
        '快照里没有的结构才用。先看 video 行和 [done]/[current] 标记。播放页不能用脚本 click 或 play。填写用 browser_type。',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string' },
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
      description: '拍摄当前页可视区域，并自动附上页内验证码原图（若有）。认验证码看较小的那张，不要只看整页。',
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
          response: { type: 'string', description: 'until=response 时匹配的请求 URL 子串，如 /api/login' },
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
      description: '维护当前任务清单。多步任务必须先 set 写出具体步骤，做完一项就 check。清单是行动许可，没勾完不能 finish(done)。',
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
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_task',
      description: '派出 explore 或 execute 子 Agent。改站点经验用 write_agent_skill_file，不要派去写解析器。',
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
      description: '宣告当前用户任务结束。summary 必须你自己写、概括实际结果。done=做完；blocked=必须用户动手；watching=已交播放监控。',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['done', 'blocked', 'watching'],
            description: 'done 完成；blocked 等人；watching 已交监控',
          },
          summary: { type: 'string', description: '你自己写的一两句真实结果，禁止套话' },
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

