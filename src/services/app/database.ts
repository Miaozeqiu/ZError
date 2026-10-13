/** 前端 DB 门面。实现按域在 ./database/：questions / practice / studyGraph。 */
export type {
  Folder,
  AIResponse,
  QuestionMetricBucket,
  PaginatedAIResponses,
  PracticeRecord,
  PracticeSummary,
  PracticeMarks,
  QuestionPracticeStats,
  RecentWrongQuestion,
  StudySubject,
  StudyGraphNodeRow,
  StudyGraphEdgeRow,
  StudyGraphPayload,
  StudyGraphNodeInput,
  StudyGraphNodePatch,
  StudyProgressUpdate,
  QuestionKnowledgeLink,
  StudyActivity,
  StudyTimelineSummary,
  SplitSubjectPart,
} from './database/types'

import * as questions from './database/questions'
import * as practice from './database/practice'
import * as studyGraph from './database/studyGraph'

export const databaseService = {
  ...questions,
  ...practice,
  ...studyGraph,
}
