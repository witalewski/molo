export type Progress = {
  completed: Record<
    string,
    { date: string; accuracy: number; skipped?: string[] }
  >;
  days: string[];
  moduleTests?: Record<
    string,
    { correct: number; total: number; date: string }
  >;
};
export type Preferences = { autoplay: boolean };
export const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
export function saveStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function loadProgress(): Progress {
  const p = readStorage<Progress>("molo.progress", { completed: {}, days: [] });
  if (
    !p ||
    typeof p.completed !== "object" ||
    p.completed === null ||
    !Array.isArray(p.days)
  )
    return { completed: {}, days: [] };
  return p;
}
export function streak(days: string[]) {
  const set = new Set(days),
    date = new Date();
  if (!set.has(today())) date.setDate(date.getDate() - 1);
  let result = 0;
  for (let i = 0; i < 36600; i++) {
    const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (!set.has(d)) break;
    result++;
    date.setDate(date.getDate() - 1);
  }
  return result;
}
