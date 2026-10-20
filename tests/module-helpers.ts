import { expect, type Page } from "@playwright/test";
import course from "../src/course.json" with { type: "json" };
import modules from "../src/modules.json" with { type: "json" };

export async function seedCompleted(page: Page, count = course.length) {
  await page.goto("/");
  await page.evaluate(
    (lessons) => {
      localStorage.setItem(
        "molo.progress",
        JSON.stringify({
          completed: Object.fromEntries(
            lessons.map((l) => [l.id, { date: "2026-10-19", accuracy: 100 }]),
          ),
          days: ["2026-10-19"],
        }),
      );
      localStorage.setItem("molo.session", "null");
      localStorage.setItem(
        "molo.preferences",
        JSON.stringify({ autoplay: false }),
      );
    },
    course.slice(0, count),
  );
  await page.reload();
}

export async function answerModuleTest(page: Page, mistakes = 0) {
  for (const [index, question] of modules[0].questions.entries()) {
    await expect(
      page.getByRole("heading", { name: question.prompt, exact: true }),
    ).toBeVisible();
    const id =
      index < mistakes
        ? question.options.find(
            (option) => option !== question.correctPhraseId,
          )!
        : question.correctPhraseId;
    const phrase = course.flatMap((l) => l.phrases).find((p) => p.id === id)!;
    await page
      .getByRole("group", { name: "Wybierz zwrot do sytuacji" })
      .getByRole("button")
      .filter({ hasText: phrase.xh })
      .click();
    await expect(page.getByRole("status")).toContainText(question.explanation);
    await page
      .getByRole("button", {
        name:
          index + 1 === modules[0].questions.length
            ? "Zakończ test"
            : "Następne pytanie",
        exact: true,
      })
      .click();
  }
}
