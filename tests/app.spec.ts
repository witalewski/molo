import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { installAudioInput } from "./microphone";
import course from "../src/course.json" with { type: "json" };
import { answerModuleTest } from "./module-helpers";
const fixture = (id: string) => path.resolve(`tests/fixtures/${id}.wav`);
const next = (page: Page) =>
  page.getByRole("button", { name: "Dalej", exact: true });
async function go(page: Page) {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Molo, odkrywco!" }),
  ).toBeVisible();
}
async function ready(page: Page) {
  await expect
    .poll(
      async () => {
        const r = await page.request.get("/api/health");
        return (await r.json()).status;
      },
      { timeout: 90000, message: "The real Xhosa ASR model must be loaded" },
    )
    .toBe("ready");
}
async function playToEnd(page: Page) {
  await page
    .getByRole("button", { name: "Odtwórz frazę", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".exercise-main > audio")
        .evaluate((a: HTMLAudioElement) => a.ended),
    )
    .toBe(true);
}
const skip = (page: Page) =>
  page.getByRole("button", { name: "Pomiń ćwiczenie", exact: true });
async function expectSkipInView(page: Page) {
  const original = page.viewportSize()!;
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(skip(page)).toBeInViewport({ ratio: 1 });
    const metrics = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(metrics.scroll, `Skip action at ${width}px`).toBeLessThanOrEqual(
      metrics.width + 1,
    );
  }
  await page.setViewportSize(original);
}
async function failSpeech(page: Page) {
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/evaluate/") && r.request().method() === "POST",
  );
  const input = page.getByLabel("Wybierz nagranie swojej wypowiedzi");
  await input.setInputFiles(fixture("wrong-phrase"));
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect((await response.json()).passed).toBe(false);
  await expect(page.locator(".speech-result.retry")).toBeVisible();
  await expect(input).toBeEnabled();
}
async function resumeSpeech(
  page: Page,
  lessonIndex = 0,
  step = 2,
  mistakes = 0,
) {
  await go(page);
  await page.evaluate(
    ({ lessonId, previousIds, step, mistakes }) => {
      localStorage.setItem(
        "molo.session",
        JSON.stringify({ lessonId, step, mistakes }),
      );
      localStorage.setItem(
        "molo.progress",
        JSON.stringify({
          completed: Object.fromEntries(
            previousIds.map((id) => [
              id,
              { date: "2026-10-19", accuracy: 100 },
            ]),
          ),
          days: [],
        }),
      );
      localStorage.setItem(
        "molo.preferences",
        JSON.stringify({ autoplay: false }),
      );
    },
    {
      lessonId: course[lessonIndex].id,
      previousIds: course.slice(0, lessonIndex).map((l) => l.id),
      step,
      mistakes,
    },
  );
  await page.reload();
  await ready(page);
  await page
    .getByRole("button", { name: "Kontynuuj lekcję", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Teraz twoja kolej.", exact: true }),
  ).toBeVisible();
}

test("speaking skip requires three failures, survives reload and resets for the next phrase", async ({
  page,
}, testInfo) => {
  // Earlier listening mistakes and legacy saves must not unlock speech skipping.
  await resumeSpeech(page, 0, 2, 3);
  await expect(skip(page)).toHaveCount(0);
  for (let attempt = 0; attempt < 2; attempt++) {
    await failSpeech(page);
    await expect(skip(page)).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Wyjdź z lekcji" }).click();
  await page
    .getByRole("button", { name: "Zapisz i wyjdź", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Kontynuuj lekcję", exact: true })
    .click();
  await expect(skip(page)).toHaveCount(0);
  await failSpeech(page);
  await expect(skip(page)).toBeEnabled();
  await expect(next(page)).toBeDisabled();
  await expectSkipInView(page);
  await page.screenshot({
    path: testInfo.outputPath("speaking-skip.png"),
    fullPage: true,
  });

  // The newly available action must not interrupt another analysis in flight.
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/evaluate/molo", async (route) => {
    await hold;
    await route.continue();
  });
  const attempt = failSpeech(page);
  await expect(skip(page)).toBeDisabled();
  release();
  await attempt;
  await page.unroute("**/api/evaluate/molo");
  await expect(skip(page)).toBeEnabled();
  await skip(page).click();
  await expect(
    page.getByRole("heading", { name: "Molweni!", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "3",
  );
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("molo.session")!)),
    )
    .toMatchObject({
      step: 3,
      mistakes: 7,
      failedSpeechAttempts: 0,
      skipped: ["molo"],
    });
  await playToEnd(page);
  await next(page).click();
  await page
    .getByRole("group", { name: "Wybierz znaczenie" })
    .getByRole("button", { name: course[0].phrases[1].pl, exact: false })
    .click();
  await next(page).click();
  await expect(skip(page)).toHaveCount(0);
  await failSpeech(page);
  await expect(skip(page)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("molo.session")!)
            .failedSpeechAttempts,
      ),
    )
    .toBe(1);
});

for (const [lessonIndex, lesson] of course.entries()) {
  test(`skipping the final speaking task completes lesson ${lesson.number} and records a review item`, async ({
    page,
  }, testInfo) => {
    await resumeSpeech(page, lessonIndex, lesson.phrases.length * 3 - 1);
    for (let attempt = 0; attempt < 3; attempt++) await failSpeech(page);
    await expect(skip(page)).toBeEnabled();
    await expectSkipInView(page);
    await expect(
      page.getByRole("button", { name: "Zakończ lekcję", exact: true }),
    ).toBeDisabled();
    await skip(page).click();
    await expect(
      page.getByText(`LEKCJA ${lesson.number} UKOŃCZONA`, { exact: true }),
    ).toBeVisible();
    const review = page.getByRole("note", { name: "Zwroty do powtórki" });
    await expect(review).toContainText("Do powtórki: 1");
    await expect(review).toContainText(lesson.phrases.at(-1)!.xh);
    await expect(
      page
        .locator(".result-stats > div")
        .filter({ hasText: "zaliczone ćwiczenia mowy" })
        .locator("strong"),
    ).toHaveText(String(lesson.phrases.length - 1));
    await expect(
      page.getByText(
        `${Math.round(((lesson.phrases.length * 2 - 1) / (lesson.phrases.length * 2 + 2)) * 100)}%`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText("+120", { exact: true })).toBeVisible();
    await expect(page.locator(".speech-result.success")).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("skipped-completion.png"),
      fullPage: true,
    });
    await page.reload();
    await page.getByRole("button", { name: "Postępy", exact: true }).click();
    await expect(
      page.locator(".progress-row").filter({ hasText: lesson.title }),
    ).toContainText("Do powtórki: 1");
    await expect(
      page
        .locator(".stat-card")
        .filter({ hasText: "poznanych zwrotów" })
        .locator("strong"),
    ).toHaveText(
      String(
        course
          .slice(0, lessonIndex + 1)
          .reduce((sum, l) => sum + l.phrases.length, 0) - 1,
      ),
    );
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            JSON.parse(localStorage.getItem("molo.progress")!).completed[id]
              .skipped,
          lesson.id,
        ),
      )
      .toEqual([lesson.phrases.at(-1)!.id]);
    if (lessonIndex < course.length - 1) {
      await page.getByRole("button", { name: "Nauka", exact: true }).click();
      await expect(
        page.getByRole("button", {
          name: `Rozpocznij lekcję ${lesson.number + 1}`,
          exact: true,
        }),
      ).toBeEnabled();
    }
  });
}

test("skipping free voice practice preserves the unfinished lesson and gives no XP", async ({
  page,
}) => {
  await resumeSpeech(page);
  await failSpeech(page);
  await page.getByRole("button", { name: "Wyjdź z lekcji" }).click();
  await page
    .getByRole("button", { name: "Zapisz i wyjdź", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rozgrzej głos", exact: true })
    .click();
  await expect(skip(page)).toHaveCount(0);
  for (let attempt = 0; attempt < 3; attempt++) await failSpeech(page);
  await expectSkipInView(page);
  await skip(page).click();
  await expect(
    page.getByText(
      "Ćwiczenie pominięte. Wróć do tego zwrotu, kiedy zechcesz.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Postępy", exact: true }).click();
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "punktów XP" })
      .locator("strong"),
  ).toHaveText("0");
  await page.getByRole("button", { name: "Nauka", exact: true }).click();
  await page
    .getByRole("button", { name: "Kontynuuj lekcję", exact: true })
    .click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await expect(skip(page)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("molo.session")!)
            .failedSpeechAttempts,
      ),
    )
    .toBe(1);
});

test("@ui new learner sees module one with five lessons and sequential locks", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await go(page);
  await expect(
    page.getByRole("heading", { name: "Pierwsze molo", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Małe słowa, dużo szacunku",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Lekcja 2 zablokowana/ }),
  ).toBeDisabled();
  await expect(page.getByText("MODUŁ 01", { exact: true })).toBeVisible();
  await expect(page.getByText("0/5 lekcji", { exact: true })).toBeVisible();
  for (const lesson of course.slice(2)) {
    await expect(
      page.getByRole("heading", { name: lesson.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `Lekcja ${lesson.number} zablokowana — ukończ lekcję 1`,
        exact: true,
      }),
    ).toBeDisabled();
  }
  await expect(
    page.getByRole("button", { name: "Rozpocznij test modułu", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("home.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("@ui dictionary searches Polish and Xhosa, filters, and plays slow audio", async ({
  page,
}) => {
  await go(page);
  await page.getByRole("button", { name: "Słowniczek", exact: true }).click();
  await expect(page.locator(".word-card")).toHaveCount(32);
  await page.getByRole("button", { name: "Lekcja 2", exact: true }).click();
  await expect(page.locator(".word-card")).toHaveCount(6);
  await page.getByRole("button", { name: "Wszystkie", exact: true }).click();
  await page.getByRole("textbox", { name: "Szukaj zwrotu" }).fill("panią");
  await expect(page.locator(".word-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Uxolo, mama!", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Odtwórz wolniej: Uxolo, mama!", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Odtwórz: Uxolo, mama!", exact: true }),
  ).toHaveClass(/playing/);
  await page.getByRole("textbox", { name: "Szukaj zwrotu" }).fill("mOlWeNi");
  await expect(page.locator(".word-card")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Szukaj zwrotu" }).fill("zzzzzzzz");
  await expect(
    page.getByText("Jeszcze nie znamy tego zwrotu.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Wyczyść wyszukiwanie" }).click();
  await expect(page.locator(".word-card")).toHaveCount(32);
  for (const lesson of course.slice(2)) {
    await page
      .getByRole("button", { name: `Lekcja ${lesson.number}`, exact: true })
      .click();
    await expect(page.locator(".word-card")).toHaveCount(lesson.phrases.length);
  }
});

test("@ui automatic read setting persists and disabling it prevents autoplay", async ({
  page,
}) => {
  await go(page);
  await page.getByRole("button", { name: "Ustawienia", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Automatyczny odsłuch" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Ustawienia", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("button", { name: "Nauka", exact: true }).click();
  await page
    .getByRole("button", { name: "Zacznij naukę", exact: true })
    .click();
  await expect(page.locator(".exercise-main > audio")).toHaveJSProperty(
    "paused",
    true,
  );
  await expect(next(page)).toBeDisabled();
  await playToEnd(page);
  await expect(next(page)).toBeEnabled();
});

test("@ui lesson progress survives exit and reload; incorrect listening answers cannot advance", async ({
  page,
}) => {
  await go(page);
  await page
    .getByRole("button", { name: "Zacznij naukę", exact: true })
    .click();
  await playToEnd(page);
  await next(page).click();
  await expect(
    page.getByRole("heading", { name: "Co słyszysz?", exact: true }),
  ).toBeVisible();
  const group = page.getByRole("group", { name: "Wybierz znaczenie" });
  await group
    .getByRole("button")
    .filter({ hasNotText: "Cześć!" })
    .first()
    .click();
  await expect(next(page)).toBeDisabled();
  await expect(
    page.getByText("Posłuchaj jeszcze raz.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Wyjdź z lekcji" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Zapisz i wyjdź", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Kontynuuj lekcję", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Co słyszysz?", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
});

test("@ui modal supports escape and reset requires confirmation", async ({
  page,
}) => {
  await go(page);
  await page
    .getByRole("button", { name: "Jak ćwiczyć wymowę?", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/nie jest dokładną oceną akcentu/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Ustawienia", exact: true }).click();
  await page
    .getByRole("button", { name: "Wyzeruj postępy", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Zachowaj postępy", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ustawienia", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Wyzeruj postępy", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tak, wyzeruj postępy", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Molo, odkrywco!" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Lekcja 2 zablokowana/ }),
  ).toBeDisabled();
});

test("@ui responsive layouts have no horizontal overflow and all navigation works", async ({
  page,
}) => {
  await go(page);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const item of ["Nauka", "Słowniczek", "Postępy", "Ustawienia"]) {
      await page.getByRole("button", { name: item, exact: true }).click();
      const metrics = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(metrics.scroll, `${item} at ${width}px`).toBeLessThanOrEqual(
        metrics.width + 1,
      );
      await expect(
        page.getByRole("button", { name: item, exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
  }
});

test("complete all five lessons and module test through real playback, listening and Xhosa recognition; persist XP and unlocks", async ({
  page,
}, testInfo) => {
  test.setTimeout(600000);
  await go(page);
  await ready(page);
  await page
    .getByRole("button", { name: "Zacznij naukę", exact: true })
    .click();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const lesson of course) {
    for (const phrase of lesson.phrases) {
      await expect(
        page.getByRole("heading", { name: phrase.xh, exact: true }),
      ).toBeVisible();
      await playToEnd(page);
      await next(page).click();
      await expect(
        page.getByRole("heading", { name: "Co słyszysz?", exact: true }),
      ).toBeVisible();
      await playToEnd(page);
      await page
        .getByRole("group", { name: "Wybierz znaczenie" })
        .getByRole("button")
        .filter({ hasText: phrase.pl })
        .click();
      await next(page).click();
      await expect(
        page.getByRole("heading", { name: "Teraz twoja kolej.", exact: true }),
      ).toBeVisible();
      await expect(
        next(page).or(
          page.getByRole("button", { name: "Zakończ lekcję", exact: true }),
        ),
      ).toBeDisabled();
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/evaluate/${phrase.id}`) &&
          r.request().method() === "POST",
      );
      await page
        .getByLabel("Wybierz nagranie swojej wypowiedzi")
        .setInputFiles(fixture(phrase.id));
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(
        result.passed,
        `${phrase.xh}: recognized ${result.transcript}, score ${result.score}`,
      ).toBe(true);
      await expect(
        page.getByText("Fraza rozpoznana. Dobra robota!", { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Twoje nagranie")).toBeVisible();
      await page
        .getByRole("button", { name: /^(Dalej|Zakończ lekcję)$/ })
        .click();
    }
    await expect(
      page.getByText(`LEKCJA ${lesson.number} UKOŃCZONA`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("+120", { exact: true })).toBeVisible();
    if (lesson.number < course.length)
      await page
        .getByRole("button", {
          name: `Przejdź do lekcji ${lesson.number + 1}`,
          exact: true,
        })
        .click();
  }
  await page.screenshot({
    path: testInfo.outputPath("five-lessons-completed.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Rozpocznij test modułu", exact: true })
    .click();
  await answerModuleTest(page);
  await expect(
    page.getByRole("heading", { name: "Moduł ukończony!", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Wróć do modułu", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Postępy", exact: true }).click();
  await expect(
    page.locator(".stat-card").filter({ hasText: "punktów XP" }),
  ).toContainText("600");
  await expect(
    page.locator(".stat-card").filter({ hasText: "poznanych zwrotów" }),
  ).toContainText("32");
  await page.reload();
  await page.getByRole("button", { name: "Postępy", exact: true }).click();
  await expect(
    page.locator(".stat-card").filter({ hasText: "punktów XP" }),
  ).toContainText("600");
  await expect(page.locator(".module-test-progress")).toContainText(
    "12/12 · zaliczony",
  );
  await page.getByRole("button", { name: "Nauka", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Powtórz lekcję 5", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("real speech engine rejects silence, unrelated speech and swapped forms of address", async ({
  page,
}) => {
  await ready(page);
  const cases = [
    { id: "molo", file: "silence", reason: "silence" },
    { id: "molo", file: "wrong-phrase", reason: "mismatch" },
    { id: "enkosi-tata", file: "enkosi-mama", reason: "mismatch" },
    { id: "hamba-kakuhle", file: "sala-kakuhle", reason: "mismatch" },
    { id: "ninjani", file: "unjani", reason: "mismatch" },
    { id: "siphilile-enkosi", file: "ndiphilile-enkosi", reason: "mismatch" },
    { id: "molo-tatomkhulu", file: "molo-tata", reason: "mismatch" },
    { id: "molo-sisi", file: "molo-bhuti", reason: "mismatch" },
    { id: "hambani-kakuhle", file: "hamba-kakuhle", reason: "mismatch" },
    { id: "salani-kakuhle", file: "hambani-kakuhle", reason: "mismatch" },
    { id: "ndicela-uphinde", file: "ndicela-undincede", reason: "mismatch" },
  ];
  for (const item of cases) {
    const response = await page.request.post(`/api/evaluate/${item.id}`, {
      headers: { "Content-Type": "audio/wav" },
      data: await import("node:fs").then((fs) =>
        fs.readFileSync(fixture(item.file)),
      ),
    });
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.passed, JSON.stringify(result)).toBe(false);
    expect(result.reason).toBe(item.reason);
  }
});

test("invalid recordings and unknown phrase IDs fail with explicit errors", async ({
  page,
}) => {
  await ready(page);
  const invalid = await page.request.post("/api/evaluate/molo", {
    headers: { "Content-Type": "audio/wav" },
    data: Buffer.from("not a wave"),
  });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toContain("WAV");
  const missing = await page.request.post("/api/evaluate/missing", {
    headers: { "Content-Type": "audio/wav" },
    data: Buffer.from("not a wave"),
  });
  expect(missing.status()).toBe(404);
});

test("incorrect speech gives feedback and cannot complete the speaking exercise", async ({
  page,
}) => {
  await go(page);
  await ready(page);
  await page
    .getByRole("button", { name: "Rozgrzej głos", exact: true })
    .click();
  await page
    .getByLabel("Wybierz nagranie swojej wypowiedzi")
    .setInputFiles(fixture("wrong-phrase"));
  await expect(
    page.getByText("Jeszcze jedna próba?", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(
    page.getByRole("button", { name: "Zakończ trening", exact: true }),
  ).toBeDisabled();
  await expect(skip(page)).toHaveCount(0);
  await failSpeech(page);
  await failSpeech(page);
  await expect(skip(page)).toBeEnabled();
  await page
    .getByLabel("Wybierz nagranie swojej wypowiedzi")
    .setInputFiles(fixture("molo"));
  await expect(
    page.getByText("Fraza rozpoznana. Dobra robota!", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(skip(page)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Zakończ trening", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Molo, odkrywco!" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Postępy", exact: true }).click();
  await expect(
    page.locator(".stat-card").filter({ hasText: "punktów XP" }),
  ).toContainText("0");
});

test("microphone uses real MediaRecorder, receives audio and releases every track", async ({
  page,
}) => {
  await installAudioInput(page, fixture("molo"));
  await go(page);
  await ready(page);
  await page
    .getByRole("button", { name: "Rozgrzej głos", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Nagraj swoją wypowiedź", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Zakończ nagranie", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(2700);
  await page
    .getByRole("button", { name: "Zakończ nagranie", exact: true })
    .click();
  await expect(
    page.getByText("Fraza rozpoznana. Dobra robota!", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__streams.flatMap((s: MediaStream) =>
          s.getTracks().map((t) => t.readyState),
        ),
      ),
    )
    .toEqual(["ended"]);
});

test("denied microphone and network errors allow skipping without a successful answer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException(
        "Denied for error handling test",
        "NotAllowedError",
      );
    };
  });
  await go(page);
  await ready(page);
  await page
    .getByRole("button", { name: "Rozgrzej głos", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Nagraj swoją wypowiedź", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Dostęp do mikrofonu został zablokowany",
  );
  await expect(
    page.getByRole("button", { name: "Zakończ trening", exact: true }),
  ).toBeDisabled();
  await page.route("**/api/evaluate/**", (route) => route.abort("failed"));
  for (let attempt = 0; attempt < 3; attempt++) {
    const failedRequest = page.waitForEvent("requestfailed", (request) =>
      request.url().includes("/api/evaluate/"),
    );
    await page
      .getByLabel("Wybierz nagranie swojej wypowiedzi")
      .setInputFiles(fixture("molo"));
    await failedRequest;
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByLabel("Wybierz nagranie swojej wypowiedzi"),
    ).toBeEnabled();
  }
  await expect(skip(page)).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Zakończ trening", exact: true }),
  ).toBeDisabled();
});

for (const failure of ["microphone", "network", "short audio"] as const) {
  test(`three ${failure} failures unlock skipping and survive a lesson reload`, async ({
    page,
  }) => {
    if (failure === "microphone") {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException("Denied", "NotAllowedError");
        };
      });
    }
    await resumeSpeech(page);
    if (failure === "network")
      await page.route("**/api/evaluate/**", (route) => route.abort("failed"));

    // A valid WAV containing only 0.1s exercises validation before the API call.
    const shortAudio = Buffer.alloc(44 + 1600 * 2);
    shortAudio.write("RIFF");
    shortAudio.writeUInt32LE(shortAudio.length - 8, 4);
    shortAudio.write("WAVEfmt ", 8);
    shortAudio.writeUInt32LE(16, 16);
    shortAudio.writeUInt16LE(1, 20);
    shortAudio.writeUInt16LE(1, 22);
    shortAudio.writeUInt32LE(16000, 24);
    shortAudio.writeUInt32LE(32000, 28);
    shortAudio.writeUInt16LE(2, 32);
    shortAudio.writeUInt16LE(16, 34);
    shortAudio.write("data", 36);
    shortAudio.writeUInt32LE(shortAudio.length - 44, 40);

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (failure === "microphone") {
        await page
          .getByRole("button", { name: "Nagraj swoją wypowiedź", exact: true })
          .click();
        await expect(page.getByRole("alert")).toContainText(
          "Dostęp do mikrofonu został zablokowany",
        );
      } else {
        await page
          .getByLabel("Wybierz nagranie swojej wypowiedzi")
          .setInputFiles(
            failure === "short audio"
              ? { name: "short.wav", mimeType: "audio/wav", buffer: shortAudio }
              : fixture("molo"),
          );
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(
          page.getByLabel("Wybierz nagranie swojej wypowiedzi"),
        ).toBeEnabled();
      }
      await expect
        .poll(() =>
          page.evaluate(() =>
            JSON.parse(localStorage.getItem("molo.session")!),
          ),
        )
        .toMatchObject({ failedSpeechAttempts: attempt, mistakes: 0 });
      if (attempt < 3) await expect(skip(page)).toHaveCount(0);
    }
    await expect(skip(page)).toBeEnabled();
    await expect(next(page)).toBeDisabled();
    await page.reload();
    await page
      .getByRole("button", { name: "Kontynuuj lekcję", exact: true })
      .click();
    await expect(skip(page)).toBeEnabled();
    await skip(page).click();
    await expect(
      page.getByRole("heading", { name: "Molweni!", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem("molo.session")!)),
      )
      .toMatchObject({
        step: 3,
        failedSpeechAttempts: 0,
        mistakes: 0,
        skipped: ["molo"],
      });
  });
}

test("@ui leaving a lesson stops its reference audio", async ({ page }) => {
  await go(page);
  await page
    .getByRole("button", { name: "Zacznij naukę", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Odtwórz wolniej", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).__referenceAudio = document.querySelector(
      ".exercise-main > audio",
    );
  });
  await page
    .getByRole("button", { name: "Wyjdź z lekcji", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Zapisz i wyjdź", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__referenceAudio.paused))
    .toBe(true);
});

test("@ui core pages meet automated accessibility checks", async ({ page }) => {
  await go(page);
  const violations = [];
  for (const name of ["Nauka", "Słowniczek", "Postępy", "Ustawienia"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    violations.push(
      ...result.violations.map((v) => ({
        page: name,
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    );
  }
  expect(violations).toEqual([]);
});

test("@ui voice warmup preserves an unfinished lesson", async ({ page }) => {
  await go(page);
  await page
    .getByRole("button", { name: "Zacznij naukę", exact: true })
    .click();
  await playToEnd(page);
  await next(page).click();
  await page.getByRole("button", { name: "Wyjdź z lekcji" }).click();
  await page
    .getByRole("button", { name: "Zapisz i wyjdź", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rozgrzej głos", exact: true })
    .click();
  await page.getByRole("button", { name: "Wyjdź z lekcji" }).click();
  await page
    .getByRole("button", { name: "Zapisz i wyjdź", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Kontynuuj lekcję", exact: true })
    .click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
});
