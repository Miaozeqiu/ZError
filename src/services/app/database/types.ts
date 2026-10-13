export interface Folder {
  id: number;
  name: string;
  parent_id?: number | null;
  created_at?: string;
}

export interface AIResponse {
  id: number;
  question: string;
  options?: string;
  answer?: string;
  question_type: string;
  folder_id: number;
  folder_name?: string;
  create_time: string;
  is_ai?: boolean;
  is_pending_correction?: boolean;
  importance?: number;
  mastery?: number;
  difficulty?: number;
}

export interface QuestionMetricBucket {
  importance: number;
  mastery: number;
  difficulty: number;
  count: number;
}

export interface PaginatedAIResponses {
  items: AIResponse[];
  total: number;
}

export interface PracticeRecord {
  id: number;
  question_id: number;
  user_answer: string;
  is_correct: boolean;
  note: string;
  source: string;
  create_time?: string;
}

export interface PracticeSummary {
  question_id: number;
  count: number;
  last_answer: string;
  last_correct: boolean;
  last_note: string;
  last_time?: string;
}

export interface PracticeMarks {
  question_id: number;
  results: boolean[];
}

export interface QuestionPracticeStats {
  question_id: number;
  attempted: number;
  last_correct: boolean;
  ever_wrong: boolean;
}

export interface RecentWrongQuestion {
  question_id: number;
  last_wrong_answer: string;
  last_wrong_note: string;
  last_wrong_time?: string;
  wrong_count: number;
}

export interface StudySubject {
  id: number
  name: string
  description: string
  create_time?: string
  node_count: number
  progress: number
}

export interface StudyGraphNodeRow {
  id: number
  subject_id: number
  node_key: string
  name: string
  summary: string
  mastery: number
  importance?: number
  parent_id?: number | null
  sort_order: number
  forgetting_stage?: number
  last_reviewed_at?: string | null
}

export interface StudyGraphEdgeRow {
  id: number
  subject_id: number
  from_id: number
  to_id: number
  relation: string
}

export interface StudyGraphPayload {
  subject: StudySubject
  nodes: StudyGraphNodeRow[]
  edges: StudyGraphEdgeRow[]
}

export interface StudyGraphNodeInput {
  key?: string
  name: string
  summary?: string
  parent_key?: string
  mastery?: number
}

export interface StudyGraphNodePatch {
  id: number
  name?: string
  summary?: string
  mastery?: number
  parent_id?: number
  forgetting_stage?: number
  last_reviewed_at?: string | null
}

export interface StudyProgressUpdate {
  id?: number
  name?: string
  forgetting_stage?: number
  last_reviewed_at?: string
  mastery?: number
  days_ago?: number
  quality?: string
  kind?: string
  remembered?: boolean
}

export interface QuestionKnowledgeLink {
  question_id: number
  node_id: number
  node_name: string
  subject_id: number
  subject_name: string
}

export interface StudyActivity {
  id: number
  subject_id: number
  kind: 'learn' | 'review' | 'practice' | string
  names: string[]
  question_count: number
  correct_count: number
  create_time: string
}

export interface StudyTimelineSummary {
  id: number
  subject_id: number
  text: string
  start_time: string
  end_time: string
  covered_through_id: number
  activity_count: number
  create_time: string
}

export interface SplitSubjectPart {
  name: string
  description?: string
  node_ids: number[]
}
