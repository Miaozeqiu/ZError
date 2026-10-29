/** 通用浏览器原语。页面身份看网站地图，进度监控用 browser_watch。 */
import { WEBSITE_ICON_TOOL } from './websiteTools'
import {
  LIST_AGENT_SKILLS_TOOL,
  READ_AGENT_SKILL_FILE_TOOL,
  READ_AGENT_SKILL_TOOL,
  RESET_AGENT_SKILL_FILE_TOOL,
  WRITE_AGENT_SKILL_FILE_TOOL,
} from '../skillTools'

export const BROWSER_PRIMITIVE_TOOLS = [
  WEBSITE_ICON_TOOL,
  {
    type: 'function',
    function: {
      name: 'browser_tabs',
      description: '列出当前对话标签，或关闭已完成、已核对且不再需要的临时页。先 list 核对 id，再 close；关闭当前页会优先返回来源页。保留播放监控、未保存表单、待核对结果和最后一个入口页，不能关闭其他对话的页面。',
      parameters: { type: 'object', properties: {
        action: { type: 'string', enum: ['list', 'close'] },
        id: { type: 'string', description: 'close 时必填，使用本对话 list 返回的标签 id' },
      }, required: ['action'] },
    },
  },
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
        '只读检查快照缺失的结构、题干与选项关联或实际控件状态；按需一次返回结构化结果，避免反复探测同一结构。仅读取已渲染页面，不用它改值、勾选、点击、播放或调用隐藏接口。嵌套 iframe 优先传快照中的 frameId 和 loaderId；frame 仅作兼容定位。定位失败先读新快照，不能原样重试。all 默认 false。',
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

