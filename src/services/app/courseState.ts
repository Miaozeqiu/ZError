import { reactive } from 'vue';

export interface CourseQuestion {
  id: string;
  content: string;
  status: 'pending' | 'answering' | 'completed' | 'error' | string;
}

export const courseState = reactive({
  platform: '',
  activeSkill: '',
  questions: [] as CourseQuestion[],
  currentQuestionId: ''
});

export const updateCourseState = (data: Partial<typeof courseState>) => {
  if (data.platform !== undefined) courseState.platform = data.platform;
  if (data.activeSkill !== undefined) courseState.activeSkill = data.activeSkill;
  if (data.questions !== undefined) courseState.questions = data.questions;
  if (data.currentQuestionId !== undefined) courseState.currentQuestionId = data.currentQuestionId;
};

export const clearCourseState = () => {
  courseState.platform = '';
  courseState.activeSkill = '';
  courseState.questions = [];
  courseState.currentQuestionId = '';
};
