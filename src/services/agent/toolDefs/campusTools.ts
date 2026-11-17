/** 校园题库 */

export const CAMPUS_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_campus_status',
      description: '查看校园题库登录和学校绑定。用户问校园题、学校课、试卷或同学分享的题时先调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_campus_courses',
      description: '列出当前学校的校园课程。可用 name 按课名筛选。看校园题前先调用。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '课程名关键词，可省略' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_campus_course',
      description: '用应用内校园题库接口为当前绑定学校新建课程。用户明确要求新建课程时使用。未提供课名时先询问，不自行命名。需要登录、绑定学校并完成认证。接口报错时说明原因，不改用浏览器。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '用户提供或确认的课程名称' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_campus_course',
      description: '通过校园题库改课程名称。先确认现有 course_id 和用户指定的新名称。若结果待审核，说明改名申请已提交。',
      parameters: {
        type: 'object',
        properties: { course_id: { type: 'integer' }, name: { type: 'string', description: '新的课程名称' } },
        required: ['course_id', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_campus_papers',
      description: '列出某门校园课下的试卷/文件夹。必须用 course_id 或 course_name。include_archived=true 时同时列出已归档试卷。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          include_archived: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_campus_uncategorized_questions',
      description: '按页查看校园课程下尚未放进试卷的题目。用 course_id 或 course_name。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          page: { type: 'integer', description: '页码，从 1 开始' },
          page_size: { type: 'integer', description: '每页数量，默认 20，最多 40' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_campus_questions',
      description: '查看某份校园试卷里的题目。必须用 paper_id / folder_id，或同时提供课程和试卷名。返回 campus_question_id，不是本地题库 Id。一次最多 40 道，多的翻页。',
      parameters: {
        type: 'object',
        properties: {
          paper_id: { type: 'integer', description: '试卷/文件夹 Id' },
          folder_id: { type: 'integer' },
          paper_name: { type: 'string' },
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          page: { type: 'integer', description: '页码，从 1 开始，默认 1' },
          page_size: { type: 'integer', description: '每页数量，默认 20，最大 40' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_campus_questions',
      description: '在当前学校的校园题库里按题干搜索。返回 campus_question_id，不是本地题库 Id。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '题干关键词' },
          page: { type: 'integer' },
          page_size: { type: 'integer' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_campus_question_duplicate',
      description: '按完整题干查重。忽略大小写与空白。选择题有选项时一并提供；只给题干只能判断题干是否一致，不能保证整题相同。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '完整题干' },
          options: { type: 'array', items: { type: 'string' }, description: '可选。按原顺序提供选项' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_campus_tags',
      description: '列出校园试卷可用的平台/标签，如学习通、智慧树。改平台或新建试卷前可调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_campus_paper',
      description: '在校园课下新建试卷/文件夹。必须已登录、绑定学校并完成校园认证。必须用 course_id 或 course_name，以及试卷名 name。平台用 tag（学习通、智慧树等）。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          name: { type: 'string', description: '试卷名称' },
          tag: { type: 'string', description: '平台/标签名，如学习通、智慧树' },
          tag_name: { type: 'string' },
          platform: { type: 'string', description: '与 tag 相同，学习通/智慧树等' },
          tag_id: { type: 'integer' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_campus_paper',
      description: '修改已有校园试卷的名称或平台标签（学习通、智慧树等）。用户说把试卷改成某平台、改试卷名时必须调用，不要新建一份再复制题目。只能改自己创建的试卷。',
      parameters: {
        type: 'object',
        properties: {
          paper_id: { type: 'integer' },
          folder_id: { type: 'integer' },
          paper_name: { type: 'string' },
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          name: { type: 'string', description: '新的试卷名，不改名可省略' },
          tag: { type: 'string', description: '平台/标签名，如智慧树、学习通' },
          tag_name: { type: 'string' },
          platform: { type: 'string', description: '与 tag 相同' },
          tag_id: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_campus_paper_archived',
      description: '归档或取消归档指定校园试卷。先从 list_campus_papers 获取 course_id 和 paper_id；找已归档试卷时用 include_archived=true。只有用户明确同意发起投票时才传 allow_vote=true。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          paper_id: { type: 'integer' },
          archived: { type: 'boolean', description: 'true 归档，false 取消归档' },
          allow_vote: { type: 'boolean', description: '是否获用户明确同意，在无法直接修改时发起投票' },
          remark: { type: 'string', description: '用户提供的投票理由，可省略' },
        },
        required: ['course_id', 'paper_id', 'archived'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reorder_campus_paper_questions',
      description: '保存校园试卷顶层题目的完整新顺序。先读完 list_campus_questions 的所有分页，只传该试卷的 campus_question_id，每道题恰好一次。子题顺序保持原样。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          paper_id: { type: 'integer' },
          campus_question_ids: { type: 'array', items: { type: 'integer' }, description: '按新顺序列出全部顶层校园题 ID' },
        },
        required: ['course_id', 'paper_id', 'campus_question_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_campus_questions',
      description: '把题目上传到校园试卷。用户要求上传、收录到校园题库时调用，不要用 save_questions。必须已认证并开启上传权限。必须指定课程和试卷。新建试卷还需开启修改权限。可手写题目，或用本地 question_ids 复制已有本地题。一次最多 20 道。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          paper_id: { type: 'integer', description: '校园试卷 Id' },
          folder_id: { type: 'integer' },
          paper_name: { type: 'string', description: '试卷名，没有就按 create_paper 决定是否新建' },
          folder_name: { type: 'string' },
          create_paper: { type: 'boolean', description: '试卷不存在时是否新建，默认 true' },
          tag: { type: 'string', description: '新建试卷时的标签名' },
          tag_name: { type: 'string' },
          tag_id: { type: 'integer' },
          question_ids: { type: 'array', items: { type: 'integer' }, description: '本地题库 Id，会按原文复制到校园试卷' },
          question_id: { type: 'integer' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: { description: '选项，写成 "A. xx\\nB. xx" 或字符串数组' },
                answer: { type: 'string', description: '选择题优先写 A/B/C/D，判断写 T/F 或对/错' },
                question_type: { type: 'string', description: '单选/多选/判断/填空/简答，或 single_choice 等' },
              },
              required: ['question', 'answer'],
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_campus_question',
      description: '修改已有校园题的题干、选项、答案、题型，或移到另一份试卷。必须用 campus_question_id（来自 list/search/save），不是本地 question_id。必须已认证。一次最多 10 道。',
      parameters: {
        type: 'object',
        properties: {
          campus_question_id: { type: 'integer' },
          campus_question_ids: { type: 'array', items: { type: 'integer' } },
          question: { type: 'string' },
          options: { description: '选项，写成 "A. xx\\nB. xx" 或字符串数组' },
          answer: { type: 'string' },
          question_type: { type: 'string' },
          paper_id: { type: 'integer', description: '要移到的试卷 Id；改内容时也尽量带上当前试卷，避免题目被移出试卷' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                campus_question_id: { type: 'integer' },
                question: { type: 'string' },
                options: { description: '选项' },
                answer: { type: 'string' },
                question_type: { type: 'string' },
                paper_id: { type: 'integer' },
              },
              required: ['campus_question_id'],
            },
          },
        },
      },
    },
  },
]
