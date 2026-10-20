import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RotateCcw,
  Trophy,
  X,
} from "lucide-react";
import {
  gradeModule,
  phrases,
  requiredCorrect,
  type CourseModule,
} from "./lib/course";

export default function ModuleTest({
  module,
  onClose,
  onComplete,
  saveError,
}: {
  module: CourseModule;
  onClose: () => void;
  onComplete: (result: { correct: number; total: number }) => void;
  saveError: string;
}) {
  const [answers, setAnswers] = useState<string[]>([]);
  const [selection, setSelection] = useState("");
  const [finished, setFinished] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const question = module.questions[answers.length];
  const result = gradeModule(module, answers);
  useEffect(() => {
    heading.current?.focus();
  }, [answers.length, finished]);
  function advance() {
    if (!selection) return;
    const next = [...answers, selection];
    setAnswers(next);
    setSelection("");
    if (next.length === module.questions.length) {
      setFinished(true);
      onComplete(gradeModule(module, next));
    }
    window.scrollTo(0, 0);
  }
  return (
    <div className="exercise-shell module-test">
      <header className="exercise-header">
        <button
          className="icon-button"
          aria-label="Wróć do modułu"
          onClick={onClose}
        >
          <ArrowLeft />
        </button>
        <div className="exercise-progress">
          <div className="progress-label">
            <span>MODUŁ {module.number} · TEST SYTUACYJNY</span>
            <span>
              {finished ? module.questions.length : answers.length + 1} /{" "}
              {module.questions.length}
            </span>
          </div>
          <div
            className="exercise-track"
            role="progressbar"
            aria-label="Postęp testu"
            aria-valuemin={0}
            aria-valuemax={module.questions.length}
            aria-valuenow={answers.length}
          >
            <span
              style={{
                width: `${(answers.length / module.questions.length) * 100}%`,
              }}
            />
          </div>
        </div>
      </header>
      <main className="exercise-main">
        {finished ? (
          <>
            <Trophy className="test-trophy" size={48} />
            <p className="eyebrow">
              MODUŁ {module.number} · {module.title.toUpperCase()}
            </p>
            <h1 ref={heading} tabIndex={-1}>
              {result.passed ? "Moduł ukończony!" : "Jeszcze trochę praktyki."}
            </h1>
            <p className="test-score">
              {result.correct}/{result.total} poprawnych odpowiedzi
            </p>
            <p className="exercise-intro">
              Próg zaliczenia: {requiredCorrect(module)}/{result.total}.{" "}
              {result.passed
                ? "Potrafisz dobrać zwroty do codziennych sytuacji."
                : "Przejrzyj wyjaśnienia, wróć do zwrotów i spróbuj ponownie."}{" "}
              Test możesz powtarzać; nie przyznaje dodatkowych XP.
            </p>
            {saveError && (
              <p className="audio-error" role="alert">
                {saveError}
              </p>
            )}
            {module.questions.map(
              (item, index) =>
                answers[index] !== item.correctPhraseId && (
                  <div className="test-review" key={item.id}>
                    <h2>{item.prompt}</h2>
                    <p>
                      Twoja odpowiedź:{" "}
                      <span lang="xh">
                        {phrases.find((p) => p.id === answers[index])?.xh}
                      </span>
                    </p>
                    <p>
                      Poprawna odpowiedź:{" "}
                      <strong lang="xh">
                        {phrases.find((p) => p.id === item.correctPhraseId)!.xh}
                      </strong>
                    </p>
                    <p>{item.explanation}</p>
                  </div>
                ),
            )}
            <div className="test-actions">
              <button className="button primary" onClick={onClose}>
                Wróć do modułu
                <ArrowRight size={18} />
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setAnswers([]);
                  setSelection("");
                  setFinished(false);
                }}
              >
                <RotateCcw size={18} />
                Powtórz test
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">WYBIERZ ZWROT DO SYTUACJI</p>
            <h1 ref={heading} tabIndex={-1}>
              {question.prompt}
            </h1>
            <p className="exercise-intro">
              Wybierz jedną odpowiedź. Pierwszy wybór liczy się do wyniku.
              Zaliczenie: {requiredCorrect(module)}/{module.questions.length}.
            </p>
            <div
              className="answer-options"
              role="group"
              aria-label="Wybierz zwrot do sytuacji"
            >
              {question.options.map((id, index) => (
                <button
                  key={id}
                  className={`answer-option ${selection === id ? (selection === question.correctPhraseId ? "correct" : "incorrect") : ""}`}
                  disabled={!!selection}
                  aria-pressed={selection === id}
                  onClick={() => setSelection(id)}
                >
                  <span className="option-number">{index + 1}</span>
                  <span lang="xh">{phrases.find((p) => p.id === id)!.xh}</span>
                  <span className="option-mark">
                    {selection === id &&
                      (id === question.correctPhraseId ? (
                        <Check size={19} />
                      ) : (
                        <X size={19} />
                      ))}
                  </span>
                </button>
              ))}
            </div>
            {selection && (
              <div
                className={`test-feedback ${selection === question.correctPhraseId ? "correct" : "incorrect"}`}
                role="status"
              >
                <strong>
                  {selection === question.correctPhraseId
                    ? "Dobrze!"
                    : "Zapamiętaj na następną rozmowę."}
                </strong>
                <p>{question.explanation}</p>
              </div>
            )}
            <div className="test-actions">
              <button
                className="button primary"
                disabled={!selection}
                onClick={advance}
              >
                {answers.length + 1 === module.questions.length
                  ? "Zakończ test"
                  : "Następne pytanie"}
                <ArrowRight size={18} />
              </button>
            </div>
            <p className="test-footnote">
              Możesz wrócić do modułu w dowolnym momencie. Wynik zapisze się po
              odpowiedzi na wszystkie pytania.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
