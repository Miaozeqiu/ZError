/** 文件 / 文件夹 / 读题 */

export const FOLDER_QUESTION_TOOLS = [
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
]
