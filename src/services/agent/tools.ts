/** Agent 可调用的工具定义（题库对话 / 浏览器对话）。 */
export const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_file_info',
      description: '查看当前对话附带文件的类型和规模。需要阅读文件内容时先调用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径，不传则使用对话附带的文件' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_range',
      description: '按范围读取附带文件。Excel 按行，Word 按段落，PDF 按页，文本按行。下标从 0 开始，包含 end。一次不要读太多。',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'integer' },
          end: { type: 'integer' },
          path: { type: 'string' },
        },
        required: ['start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_folders',
      description: '查看题库文件夹列表，含 Id、名称、父级和题目数量。不确定目标文件夹时先调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_folder_info',
      description: '查看某个文件夹的路径、父级和题目数量。可用 folder_id 或 folder_name。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: '新建文件夹。可指定父文件夹，默认建在最外层（默认文件夹下，parent_id=0）。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '新文件夹名称' },
          parent_id: { type: 'integer', description: '父文件夹 Id，默认 0' },
          parent_name: { type: 'string', description: '父文件夹名称，不知道 Id 时可用' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_folder',
      description: '重命名文件夹。不能改默认文件夹（Id=0）。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string', description: '当前名称，不知道 Id 时可用' },
          new_name: { type: 'string' },
        },
        required: ['new_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_folder',
      description: '把文件夹移到另一个父文件夹下。不能移动默认文件夹，也不能移进自己的子文件夹。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
          parent_id: { type: 'integer', description: '新的父文件夹 Id，0 表示最外层' },
          parent_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_folder',
      description: '删除文件夹。只能在用户明确要求删除时调用。不能删除默认文件夹。delete_questions 为 true 时连题目一起删，否则题目回到默认文件夹。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
          delete_questions: { type: 'boolean', description: '是否同时删除里面的题目，默认 false' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_questions',
      description: '查看某个文件夹里的题目，返回 Id、题干、答案、题型、重要性/掌握度/难度、已关联知识点，以及最近练习摘要。出题、整理题目或改指标前先调用。一次最多 40 道，多的翻页。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
          page: { type: 'integer', description: '页码，从 1 开始，默认 1' },
          page_size: { type: 'integer', description: '每页数量，默认 20，最大 40' },
          include_subfolders: { type: 'boolean', description: '是否包含子文件夹里的题目，默认 false' },
          importance: { type: 'integer', description: '按重要性筛选，0未设置 1低 2中 3高' },
          mastery: { type: 'integer', description: '按掌握程度筛选，0未设置 1未掌握 2一般 3已掌握' },
          difficulty: { type: 'integer', description: '按难度筛选，0未设置 1简单 2中等 3困难' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_questions',
      description: '按题干关键词查找题目。可用 folder_id 或 folder_name 限定范围。移动某几道题时，先搜到 Id 再 move_questions。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '题干关键词' },
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
        },
        required: ['keyword'],
      },
    },
  },
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
  {
    type: 'function',
    function: {
      name: 'link_questions_to_knowledge',
      description: '把题库题目关联到知识图谱节点。用户说整理题目、把题挂到某节、这题考某某时调用。没有对应节点就自动生成。可用 question_ids，或对每道题分别给 node_name / parent_name。',
      parameters: {
        type: 'object',
        properties: {
          question_ids: { type: 'array', items: { type: 'integer' } },
          question_id: { type: 'integer' },
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          node_id: { type: 'integer' },
          node_name: { type: 'string', description: '知识点或节名' },
          knowledge_point: { type: 'string' },
          parent_name: { type: 'string', description: '所属章名' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question_id: { type: 'integer' },
                node_id: { type: 'integer' },
                node_name: { type: 'string' },
                knowledge_point: { type: 'string' },
                parent_name: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_knowledge_questions',
      description: '查看某个知识点关联了哪些题目。出该节的练习或整理题目后可调用。',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'integer' },
          node_name: { type: 'string' },
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_subjects',
      description: '把多个学习科目合成一个大科目。源科目的图谱会作为章节并入目标科目，题目与知识点的关联会保留。源科目随后删除。',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'integer', description: '合并后保留的科目 Id' },
          target_name: { type: 'string' },
          source_ids: { type: 'array', items: { type: 'integer' }, description: '要并进来的科目 Id' },
          source_names: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'split_subject',
      description: '把一个科目拆成新科目。指定要拆出的章/节，它们及其下级会移到新科目。题目关联跟着节点走。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          parts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '新科目名称' },
                description: { type: 'string' },
                node_ids: { type: 'array', items: { type: 'integer' } },
                node_names: { type: 'array', items: { type: 'string' } },
              },
              required: ['name'],
            },
          },
          name: { type: 'string', description: '只拆出一块时的新科目名' },
          node_ids: { type: 'array', items: { type: 'integer' } },
          node_names: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_subjects',
      description: '查看学习页有哪些科目。用户问有哪些科目、列出学习科目时必须调用。科目独立于题库文件夹。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_subject',
      description: '查看某一个学习科目的详情（简介、进度、知识点数量），并在右侧展开它的思维导图。用户说查看某科、打开某科、看看某科时调用。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_subject',
      description: '在学习页新建一个科目，并展开它的思维导图。用户说新建科目、加一个学习科目时必须调用。不要用创建文件夹代替。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_subject',
      description: '重命名学习科目或改简介。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          new_name: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_subject',
      description: '删除学习科目及其知识图谱。必须用户明确要求删除科目时才调用。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attach_study_subject',
      description: '把学习科目挂到当前对话。右上角会显示正在学习，之后讲解、出题、改图谱都默认用这个科目。用户说想学某科时必须调用。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detach_study_subject',
      description: '撤下当前对话的学习状态。只有用户明确说不学了、撤下或取消学习状态时才调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_knowledge_graph',
      description: '查看某科目当前的知识图谱。节点含 forgetting_stage（0–6 复习点）和上次复习时间。章的熟练度由子节点汇总，不要用题目那种掌握度 0–3 理解图谱。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_knowledge_graph',
      description: '整图替换某科目知识图谱，会丢掉已有节点和遗忘进度。仅当用户明确说重画、推倒重来、全部重做，并带 replace=true 时使用。普通绘制、补章、改名一律用 patch_knowledge_graph。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          replace: {
            type: 'boolean',
            description: '必须为 true。表示用户明确要求整图重画。缺省或 false 时拒绝覆盖。',
          },
          mermaid: {
            type: 'string',
            description: 'mermaid flowchart TB 或 mindmap 源码，不要包代码围栏',
          },
          outline: {
            type: 'string',
            description: '教材目录式大纲。例如：\\n劳动需求\\n  短期劳动需求\\n  长期劳动需求\\n劳动供给\\n  收入与闲暇\\n  劳动参与率',
          },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                name: { type: 'string' },
                summary: { type: 'string' },
                parent_key: { type: 'string' },
                mastery: { type: 'integer', description: '不要填。图谱进度用 evaluate_study_progress，不是 0–3 掌握度' },
              },
              required: ['name'],
            },
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from_key: { type: 'string' },
                to_key: { type: 'string' },
                relation: { type: 'string' },
              },
              required: ['from_key', 'to_key'],
            },
          },
        },
        required: ['nodes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_knowledge_graph',
      description: '往知识图谱里添加或修改节点。生成图谱时用这个分批添加，一次 3–8 个。先加章名，再给每章加 2–4 个节名（parent_key 填章的 key 或中文名）。节点名用教材目录口吻，不要定理/论文名。不要用手写 mastery 表示遗忘进度，学完/复习后调用 evaluate_study_progress。可多次调用，每批不同。不要一次塞整张图。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          add: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                name: { type: 'string' },
                summary: { type: 'string' },
                parent_key: { type: 'string' },
              },
              required: ['name'],
            },
          },
          update: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                summary: { type: 'string' },
                parent_id: { type: 'integer' },
              },
              required: ['id'],
            },
          },
          remove_ids: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus_knowledge_graph',
      description: '在右侧知识图谱里聚焦某个章或节，镜头会移到该节点及其子节点。讲解、点名某一章/节，或用户说「看某某」「讲这一块」时必须调用。node_name 用图谱里的中文名。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          node_name: { type: 'string', description: '图谱节点的章名或节名，例如「劳动需求」' },
          node_id: { type: 'integer' },
        },
        required: ['node_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_knowledge_graph',
      description: '展开右侧思维导图。用户说打开图谱、展开思维导图、看知识图谱、打开导图时必须调用。可指定科目，默认用当前学习状态。只要展开整张图，不要用这个聚焦单个节点。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'evaluate_study_progress',
      description: '立刻把学习/复习效果评估交给后台。系统讲完或练完后也会自动评估；用户明确问进度、说学过/忘了/复习过时仍应调用。不要自己打分或改 mastery。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          hint: { type: 'string', description: '这次真正讲到、练到或用户点名的节名（叶子中文名，可多个）。不要写章名，不要写「基础/入门」' },
        },
      },
    },
  },
]

export const BROWSER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'browser_get_state',
      description: '查看当前浏览器的网址、标题和网站图谱（当前路由、可挂解析器、可跳转）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_page',
      description: '读取当前网页的可见正文、标题和主要链接。操作页面前先调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: '打开指定网址。禁止打开目录/视频 iframe（studentcourse / knowledge/cards / ananas / insert*）。进课中间页 stucoursemiddle、课程壳 mycourse/stu 可以打开。',
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
      description: '点击页面上的元素，selector 用合法 CSS。同域 iframe 里也能点。不要用 :contains()。',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string' } },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click_text',
      description: '按可见文案点击，如「章节」「开始学习」。学习通导航请用这个，不要点「课程门户链接」。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '按钮或链接上的文字，尽量短且精确' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: '向输入框填写文字。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['selector', 'text'],
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
      description: '在当前网页执行一段 JavaScript，并返回结果。用于读取 DOM 或做选择器无法覆盖的操作。',
      parameters: {
        type: 'object',
        properties: { script: { type: 'string' } },
        required: ['script'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_chaoxing_chapters',
      description: '读取后台章节解析器的当前结果（未完成节名、任务点进度）。须在课程章节页。刷课流程里用来确认目录，不要代替点击和播放。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_chaoxing_play',
      description: '学习通播放页点播放。仅 studentstudy 播放页。播放器在 #iframe 再套一层 video iframe，顶层没有 video。成功后会自动开始进度监控。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_chaoxing_watch',
      description: '监控学习通当前视频进度，并显示在 Agent 面板。仅播放页、视频已打开时用。会定时和按进度叫你核对。不要用 browser_wait 空等整节。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_chaoxing_next',
      description: '当前视频播完后先切本章下一个视频，没有了再打开下一节。仅刷课流程里用。资料/PDF 会自动跳过。不要只点「下一节」就停，必须用这个。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_chaoxing_homework',
      description: '学习通作业题卡。必须已在作业相关页才能用：作业列表页用 list/open；作答页（doHomeWork / work）用 inspect/fill/save/submit。空间页、课表、章节页不要调——先点「作业」进作业页。不要 eval、不要 click 选项。一题一题：答出一道立刻 fill（answers 只放一项）。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'open', 'inspect', 'fill', 'save', 'submit'],
            description: 'list/open 仅作业列表页；inspect/fill/save/submit 仅作答页。list 列表，open 打开，inspect 读题卡，fill 填答案，save 暂存，submit 提交',
          },
          title: { type: 'string', description: 'open 时的作业名' },
          answers: {
            type: 'array',
            description: 'fill 时的答案，一次只填一道题（数组只放一项）。每项 id 或 index、type、answer。单选填 A，多选填 AC，填空多空用分号。',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                index: { type: 'integer' },
                type: { type: 'string' },
                answer: { type: 'string' },
              },
            },
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_chaoxing_captcha',
      description: '学习通【9010】图片验证码：把认出的 4 位字母或数字填进 #ucode 并提交。不要问用户。提交后再 study 或 play。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '图中 4 位字母或数字' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait',
      description: '等待若干秒，再继续看页面。学习通视频请用 browser_chaoxing_watch，不要用这个空等整节。',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'integer', description: '等待秒数，1–60，默认 20' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_finish',
      description: '宣告当前用户任务结束。没调用这个工具时，系统不会因为你停嘴就收工。done=已完成；blocked=必须用户动手（滑块/扫码）；watching=已开始监控播放。',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['done', 'blocked', 'watching'],
            description: 'done 完成；blocked 等人；watching 已交监控',
          },
          summary: { type: 'string', description: '一两句说明结果或卡在哪' },
        },
        required: ['status', 'summary'],
      },
    },
  },
]
