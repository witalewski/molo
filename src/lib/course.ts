import courseData from "../course.json" with { type: "json" };
import modulesData from "../modules.json" with { type: "json" };

export const course = courseData;
export const modules = modulesData;
export const phrases = course.flatMap((lesson) => lesson.phrases);
export type Lesson = (typeof course)[number];
export type Phrase = Lesson["phrases"][number];
export type CourseModule = (typeof modules)[number];

export function isLessonUnlocked(
  id: string,
  completed: Record<string, unknown>,
) {
  const module = modules.find((item) => item.lessonIds.includes(id));
  if (!module) return false;
  const index = module.lessonIds.indexOf(id);
  return module.lessonIds
    .slice(0, index)
    .every((previous) => !!completed[previous]);
}

export function isModuleReady(
  module: CourseModule,
  completed: Record<string, unknown>,
) {
  return module.lessonIds.every((id) => !!completed[id]);
}

export function requiredCorrect(module: CourseModule) {
  return Math.ceil((module.questions.length * module.passPercent) / 100);
}

export function gradeModule(module: CourseModule, answers: string[]) {
  const correct = module.questions.filter(
    (question, index) => answers[index] === question.correctPhraseId,
  ).length;
  return {
    correct,
    total: module.questions.length,
    passed:
      answers.length === module.questions.length &&
      correct >= requiredCorrect(module),
  };
}
