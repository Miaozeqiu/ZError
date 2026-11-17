/** 知识图谱 / 科目 / 评估 */

export const STUDY_GRAPH_TOOLS = [
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
