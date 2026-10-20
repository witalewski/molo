import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { answerModuleTest, seedCompleted } from "./module-helpers";
import course from "../src/course.json" with { type: "json" };
import modules from "../src/modules.json" with { type: "json" };

test("@ui existing two-lesson progress is preserved and unlocks only lesson three", async ({
  page,
}) => {
  await seedCompleted(page, 2);
  await expect(page.getByText("2/5 lekcji", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rozpocznij lekcję 3", exact: true }),
  ).toBeEnabled();
  for (const number of [4, 5])
    await expect(
      page.getByRole("button", {
        name: `Lekcja ${number} zablokowana — ukończ lekcję 3`,
        exact: true,
      }),
    ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Rozpocznij test modułu", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Postępy", exact: true }).click();
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "punktów XP" })
      .locator("strong"),
  ).toHaveText("240");
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "poznanych zwrotów" })
      .locator("strong"),
  ).toHaveText("12");
  await page.getByRole("button", { name: "Nauka", exact: true }).click();
  await page
    .getByRole("button", { name: "Rozpocznij lekcję 3", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unjani?", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Wyjdź z lekcji", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Zapisz i wyjdź", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Kontynuuj lekcję", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unjani?", exact: true }),
  ).toBeVisible();
});

test("@ui a partial module test gives no result and answers cannot be changed after feedback", async ({
  page,
}) => {
  await seedCompleted(page);
  await page
    .getByRole("button", { name: "Rozpocznij test modułu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Następne pytanie", exact: true }),
  ).toBeDisabled();
  const group = page.getByRole("group", { name: "Wybierz zwrot do sytuacji" });
  await group.getByRole("button").first().click();
  for (const button of await group.getByRole("button").all())
    await expect(button).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    modules[0].questions[0].explanation,
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  }
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Wróć do modułu", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("molo.progress")!).moduleTests ??
          null,
      ),
    )
    .toBeNull();
  await page
    .getByRole("button", { name: "Rozpocznij test modułu", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Postęp testu" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(
    page.getByRole("button", { name: "Następne pytanie", exact: true }),
  ).toBeDisabled();
});

test("@ui module test distinguishes failing and passing results, persists, can be repeated and resets with progress", async ({
  page,
}, testInfo) => {
  await seedCompleted(page);
  await page
    .getByRole("button", { name: "Rozpocznij test modułu", exact: true })
    .click();
  await answerModuleTest(page, 3);
  await expect(
    page.getByRole("heading", {
      name: "Jeszcze trochę praktyki.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("9/12 poprawnych odpowiedzi", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".test-review")).toHaveCount(3);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Test modułu 1" }),
  ).toContainText("Ostatni wynik: 9/12 · spróbuj ponownie");
  await page
    .getByRole("button", { name: "Powtórz test modułu", exact: true })
    .click();
  // The exact passing boundary is 10/12, not a rounded percentage.
  await answerModuleTest(page, 2);
  await expect(
    page.getByRole("heading", { name: "Moduł ukończony!", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("10/12 poprawnych odpowiedzi", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".test-review")).toHaveCount(2);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("module-test-result.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Powtórz test", exact: true }).click();
  await expect(
    page.getByRole("progressbar", { name: "Postęp testu" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await answerModuleTest(page);
  await expect(
    page.getByText("12/12 poprawnych odpowiedzi", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Wróć do modułu", exact: true })
    .last()
    .click();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Test modułu 1" }),
  ).toContainText("Ostatni wynik: 12/12 · test zaliczony");
  await page.getByRole("button", { name: "Postępy", exact: true }).click();
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "punktów XP" })
      .locator("strong"),
  ).toHaveText("600");
  await expect(page.locator(".module-test-progress")).toContainText(
    "12/12 · zaliczony",
  );
  await page.getByRole("button", { name: "Ustawienia", exact: true }).click();
  await page
    .getByRole("button", { name: "Wyzeruj postępy", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tak, wyzeruj postępy", exact: true })
    .click();
  await expect(page.getByText("0/5 lekcji", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rozpocznij test modułu", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("molo.progress")!).moduleTests ??
          null,
      ),
    )
    .toBeNull();
});

test("@ui module test reports a storage failure and does not pretend the result persisted", async ({
  page,
}) => {
  await seedCompleted(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "molo.progress")
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page
    .getByRole("button", { name: "Rozpocznij test modułu", exact: true })
    .click();
  await answerModuleTest(page);
  await expect(page.getByRole("alert")).toContainText(
    "Nie udało się zapisać wyniku testu na urządzeniu.",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("molo.progress")!).moduleTests ??
          null,
      ),
    )
    .toBeNull();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Rozpocznij test modułu", exact: true }),
  ).toBeEnabled();
});

test("repeating a lesson awards no extra XP and preserves the module test result", async ({
  page,
}) => {
  await seedCompleted(page);
  await page.evaluate(
    ({ moduleId, lessonId }) => {
      const progress = JSON.parse(localStorage.getItem("molo.progress")!);
      progress.moduleTests = {
        [moduleId]: { correct: 12, total: 12, date: "2026-10-19" },
      };
      localStorage.setItem("molo.progress", JSON.stringify(progress));
      localStorage.setItem(
        "molo.session",
        JSON.stringify({ lessonId, step: 17, mistakes: 0 }),
      );
    },
    { moduleId: modules[0].id, lessonId: course[0].id },
  );
  await page.reload();
  await expect
    .poll(
      async () => (await (await page.request.get("/api/health")).json()).status,
      { timeout: 90000 },
    )
    .toBe("ready");
  await page
    .getByRole("button", { name: "Kontynuuj lekcję", exact: true })
    .click();
  await page
    .getByLabel("Wybierz nagranie swojej wypowiedzi")
    .setInputFiles("tests/fixtures/sala-kakuhle.wav");
  await expect(
    page.getByRole("button", { name: "Zakończ lekcję", exact: true }),
  ).toBeEnabled({ timeout: 45000 });
  await page
    .getByRole("button", { name: "Zakończ lekcję", exact: true })
    .click();
  await expect(page.getByText("+0", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Wróć do ścieżki nauki", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Test modułu 1" }),
  ).toContainText("Ostatni wynik: 12/12 · test zaliczony");
  await page.getByRole("button", { name: "Postępy", exact: true }).click();
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "punktów XP" })
      .locator("strong"),
  ).toHaveText("600");
});
