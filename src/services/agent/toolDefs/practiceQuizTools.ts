/** 写题 / 练习 / 出题 */

export const PRACTICE_QUIZ_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'move_questions',
      description: '把指定题目移到另一个文件夹。必须用 question_ids（来自 list_questions / search_questions），或用 keyword 在源文件夹里匹配。不要用这个工具移动整个文件夹，移动文件夹请用 move_folder。一次最多 50 道。',
      parameters: {
        type: 'object',
        properties: {
          question_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: '要移动的题目 Id 列表',
          },
          question_id: { type: 'integer', description: '只移一道时可用' },
          keyword: { type: 'string', description: '按题干匹配源文件夹中的题目' },
          source_folder_id: { type: 'integer' },
          source_folder_name: { type: 'string' },
          folder_id: { type: 'integer', description: '目标文件夹 Id' },
          folder_name: { type: 'string', description: '目标文件夹名称' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_questions',
      description: '把题目写入指定文件夹。用户要求保存、收录、导入题目时必须调用。一次不要超过 20 道，多的分批写入。不要编造用户没确认过的题目。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer', description: '文件夹 Id，默认 0' },
          folder_name: { type: 'string', description: '文件夹名称，不知道 Id 时可用' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: { type: 'string' },
                answer: { type: 'string' },
                question_type: { type: 'string' },
                importance: { type: 'integer', description: '0未设置 1低 2中 3高' },
                mastery: { type: 'integer', description: '0未设置 1未掌握 2一般 3已掌握' },
                difficulty: { type: 'integer', description: '0未设置 1简单 2中等 3困难' },
                knowledge_point: { type: 'string', description: '对应知识点或节名' },
                node_name: { type: 'string', description: '图谱节点名，可与 knowledge_point 相同' },
                node_id: { type: 'integer', description: '已有知识点 Id' },
                parent_name: { type: 'string', description: '所属章名，没有对应节点时用来挂到该章下' },
                subject_id: { type: 'integer' },
              },
              required: ['question', 'answer'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_question_metrics',
      description: '更新题库题目的重要性、掌握程度或难度。必须用 list_questions / search_questions 拿到的 question_ids。取值 0–3，也可写低/中/高、未掌握/一般/已掌握、简单/中等/困难。',
      parameters: {
        type: 'object',
        properties: {
          question_ids: { type: 'array', items: { type: 'integer' } },
          question_id: { type: 'integer' },
          importance: { description: '重要性' },
          mastery: { description: '掌握程度' },
          difficulty: { description: '难度' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_wrong_questions',
      description: '查看最近答错的题目。用户问错题、要订正、复习刚错过的题时调用。可按科目、知识点或文件夹筛选，返回题干、上次错选、错了几次、最近 5 次对错。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer', description: '学习科目 Id，挂着学习状态时可省略' },
          subject_name: { type: 'string' },
          node_id: { type: 'integer', description: '只看某个知识点及其子节点' },
          node_name: { type: 'string' },
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
          days: { type: 'integer', description: '最近几天，默认 30' },
          limit: { type: 'integer', description: '最多返回多少道，默认 20，最大 40' },
          unresolved_only: { type: 'boolean', description: '只看最后一次仍是错的题，默认 false' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_practice_history',
      description: '查看某道题的历史作答和备注，出题或讲评前可调用，避免重复出刚错过的题或忽略用户备注。',
      parameters: {
        type: 'object',
        properties: {
          question_id: { type: 'integer' },
          limit: { type: 'integer', description: '默认 10，最多 30' },
        },
        required: ['question_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_practice_note',
      description: '给某道题追加一条备注，供以后出题和讲解参考。用户要求记下易错点、口诀或复习提示时使用。',
      parameters: {
        type: 'object',
        properties: {
          question_id: { type: 'integer' },
          note: { type: 'string' },
        },
        required: ['question_id', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'present_quiz',
      description: '向用户出示可点选的练习题。选择题必须用这个工具，不要把选项写成普通 Markdown。必须用 title 给这次练习起短名字。本地题用 question_ids；校园题用 campus_question_ids 或 paper_id，系统会按校园题库原文出题，不要抄选项。订正错题时先 list_recent_wrong_questions。也可以只传 count，从未掌握的本地题里抽。一次最多 10 道。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '这次练习的短标题，例如「考试1」「劳动需求 错题订正」。会显示在练习卡片上，不要只用「练习」。' },
          question_ids: { type: 'array', items: { type: 'integer' }, description: '本地题库题目 Id 列表' },
          campus_question_ids: { type: 'array', items: { type: 'integer' }, description: '校园题 Id，来自 list_campus_questions。系统按原文出题。' },
          paper_id: { type: 'integer', description: '校园试卷 Id，出示这份试卷里的题' },
          paper_name: { type: 'string' },
          count: { type: 'integer', description: '未指定题目时自动抽取的数量，默认 5' },
          folder_id: { type: 'integer' },
          node_id: { type: 'integer', description: '这批题默认挂到的知识点 Id' },
          node_name: { type: 'string', description: '这批题默认挂到的知识点或节名' },
          knowledge_point: { type: 'string' },
          parent_name: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question_id: { type: 'integer', description: '本地题库题目 Id' },
                campus_question_id: { type: 'integer', description: '校园题 Id，有这个就不要再手写 options' },
                question: { type: 'string' },
                options: { type: 'string', description: 'A. ...\\nB. ...。校园题不要填这个字段' },
                answer: { type: 'string' },
                question_type: { type: 'string', description: '单选/多选/判断/填空' },
                explanation: { type: 'string' },
                knowledge_point: { type: 'string', description: '对应知识点或节名' },
                node_name: { type: 'string' },
                node_id: { type: 'integer' },
                parent_name: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
]
