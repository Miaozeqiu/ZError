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
      name: 'list_campus_papers',
      description: '列出某门校园课下的试卷/文件夹。必须用 course_id 或 course_name。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
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
      name: 'save_campus_questions',
      description: '把题目上传到校园试卷。用户要求上传、收录到校园题库时调用，不要用 save_questions。必须已认证。必须指定课程和试卷。可手写题目，或用本地 question_ids 复制已有本地题。一次最多 20 道。',
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
