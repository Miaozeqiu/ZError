export const CAMPUS_BANK_PROMPT = `
校园题库：
- 用户问校园题、学校课、试卷、同学分享的题时：先 get_campus_status，再 list_campus_courses → list_campus_papers → list_campus_questions，或 search_campus_questions。
- 有试卷就必须 list_campus_questions，不能只看 paper 数量就说没题。
- list_campus_questions / search_campus_questions 会弹出浏览卡片，只供看题，不是作答。成功后不要再列出选项，也不要 present_quiz，除非用户明确说要练习、做题或订正。
- 练习时 present_quiz 只传 campus_question_ids 或 paper_id 和 title。
- campus_question_id 不是本地题库 Id，不能传给 get_practice_history、move_questions、save_questions。
- 没登录、没绑定学校或 verified=false 时据实说明，不要编造校园题目。
- 用户要求往校园题库上传、收录、新建试卷或改校园题：用 create_campus_paper / save_campus_questions / update_campus_question。先 get_campus_status 确认已登录、已绑定、verified=true。
- 上传必须指定课程和试卷（course_id/course_name + paper_id/paper_name）；试卷不存在且用户要新建时 create_paper=true 或先 create_campus_paper。一次最多 20 道。
- 改题必须用 campus_question_id，不要把本地 question_id 当成校园题 Id。改内容时尽量带上当前 paper_id。
- 上传或改完会弹出浏览卡片，不要再列出选项，也不要 present_quiz，除非用户要练习。
- 用户说把试卷改成学习通、智慧树或其他平台，或改试卷名时，调用 update_campus_paper。先 list_campus_papers 或 list_campus_tags 确认 paper_id 和标签名。不要新建一份再复制，也不要没调用工具就声称已经改好。
- 用户说上传到校园、放到校园试卷、改校园题时，不要用 save_questions（那是本地题库）。
`
