import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Flame,
  Headphones,
  House,
  Info,
  Leaf,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  Mic,
  Play,
  RotateCcw,
  Search,
  Settings,
  Square,
  Star,
  Trophy,
  Upload,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import ModuleTest from "./ModuleTest";
import {
  course,
  modules,
  phrases,
  isLessonUnlocked,
  isModuleReady,
  requiredCorrect,
  type Phrase,
  type Lesson,
} from "./lib/course";
import { micError, startRecording, toWav, type Recording } from "./lib/audio";
import {
  loadProgress,
  readStorage,
  saveStorage,
  streak,
  today,
  type Preferences,
  type Progress,
} from "./lib/progress";

type Nav = "learn" | "words" | "stats" | "settings";
type Session = {
  lessonId: string;
  step: number;
  mistakes: number;
  failedSpeechAttempts?: number;
  skipped?: string[];
  practice?: string;
};
type Result = {
  transcript: string;
  score: number;
  passed: boolean;
  reason: string;
  words: { word: string; matched: boolean }[];
};
type Health = { status: string; audioReady: boolean; error?: string };
const firstModule = modules[0];
const speechSkipThreshold = 3;
function skippedPhrases(lesson: Lesson, ids: unknown): Phrase[] {
  return Array.isArray(ids)
    ? lesson.phrases.filter((phrase) => ids.includes(phrase.id))
    : [];
}
const navItems = [
  { id: "learn" as Nav, label: "Nauka", icon: House },
  { id: "words" as Nav, label: "Słowniczek", icon: BookOpen },
  { id: "stats" as Nav, label: "Postępy", icon: BarChart3 },
  { id: "settings" as Nav, label: "Ustawienia", icon: Settings },
];
function readSession(progress: Progress): Session | null {
  const s = readStorage<Session | null>("molo.session", null);
  if (
    !s ||
    !Number.isInteger(s.step) ||
    s.step < 0 ||
    !Number.isFinite(s.mistakes) ||
    s.mistakes < 0
  )
    return null;
  const index = course.findIndex((l) => l.id === s.lessonId);
  if (
    index < 0 ||
    s.step >= course[index].phrases.length * 3 ||
    !isLessonUnlocked(s.lessonId, progress.completed)
  )
    return null;
  if (s.practice && !phrases.some((p) => p.id === s.practice)) return null;
  return {
    ...s,
    failedSpeechAttempts:
      Number.isInteger(s.failedSpeechAttempts) && s.failedSpeechAttempts! >= 0
        ? s.failedSpeechAttempts
        : 0,
    skipped: skippedPhrases(course[index], s.skipped).map((p) => p.id),
  };
}
function Logo() {
  return (
    <span className="brand">
      <img src="/favicon.svg" alt="" />
      <span>
        molo<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
function SoundBars({ active = false }: { active?: boolean }) {
  return (
    <span className={`sound-bars ${active ? "active" : ""}`} aria-hidden="true">
      {[12, 23, 36, 21, 43, 29, 17, 36, 23, 12, 27, 17].map((height, i) => (
        <i key={i} style={{ height, animationDelay: `${i * 75}ms` }} />
      ))}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <button
        className="icon-button modal-close"
        aria-label="Zamknij okno"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}

export default function App() {
  const [progress, setProgress] = useState(loadProgress);
  const [saved, setSaved] = useState<Session | null>(() =>
    readSession(loadProgress()),
  );
  const [preferences, setPreferences] = useState<Preferences>(() => {
    const v = readStorage<Preferences>("molo.preferences", { autoplay: true });
    return { autoplay: typeof v?.autoplay === "boolean" ? v.autoplay : true };
  });
  const [nav, setNav] = useState<Nav>("learn"),
    [session, setSession] = useState<Session | null>(null);
  const [testing, setTesting] = useState(false);
  const [moduleTestError, setModuleTestError] = useState("");
  const [summary, setSummary] = useState<{
    lessonId: string;
    accuracy: number;
    earned: number;
    skipped: string[];
  } | null>(null);
  const [modal, setModal] = useState<"info" | "exit" | "reset" | null>(null),
    [notice, setNotice] = useState("");
  const [health, setHealth] = useState<Health>({
    status: "loading",
    audioReady: false,
  });
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [playingId, setPlayingId] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const completed = course.filter((l) => progress.completed[l.id]).length,
    xp = completed * 120,
    dayStreak = streak(progress.days),
    skippedCount = course.reduce(
      (count, lesson) =>
        count +
        skippedPhrases(lesson, progress.completed[lesson.id]?.skipped).length,
      0,
    );
  const currentLesson =
    course.find((l) => !progress.completed[l.id]) ?? course[0];
  const moduleReady = isModuleReady(firstModule, progress.completed);
  const storedTest = progress.moduleTests?.[firstModule.id];
  const moduleTest =
    moduleReady &&
    storedTest &&
    Number.isInteger(storedTest.correct) &&
    storedTest.correct >= 0 &&
    storedTest.correct <= firstModule.questions.length &&
    storedTest.total === firstModule.questions.length
      ? storedTest
      : null;
  const modulePassed =
    !!moduleTest && moduleTest.correct >= requiredCorrect(firstModule);
  const knownPhrases =
    course.reduce(
      (total, lesson) =>
        total + (progress.completed[lesson.id] ? lesson.phrases.length : 0),
      0,
    ) - skippedCount;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const check = async () => {
      try {
        const r = await fetch("/api/health", { signal: controller.signal });
        if (!r.ok) throw Error();
        const v = await r.json();
        if (active) setHealth(v);
      } catch (e) {
        if (active && !controller.signal.aborted)
          setHealth({ status: "unavailable", audioReady: false });
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (session && !session.practice) {
      if (!saveStorage("molo.session", session))
        setNotice(
          "Przeglądarka nie pozwala zapisać postępu. Pozostanie on dostępny do zamknięcia strony.",
        );
      setSaved(session);
    }
  }, [session]);
  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );
  function navigate(value: Nav) {
    audioRef.current?.pause();
    setPlayingId("");
    setNav(value);
    setNotice("");
    window.scrollTo(0, 0);
  }
  function begin(id: string) {
    audioRef.current?.pause();
    setPlayingId("");
    const index = course.findIndex((l) => l.id === id);
    if (index < 0 || !isLessonUnlocked(id, progress.completed)) return;
    setSummary(null);
    setSession(
      saved?.lessonId === id && !saved.practice
        ? saved
        : { lessonId: id, step: 0, mistakes: 0 },
    );
    window.scrollTo(0, 0);
  }
  function practice(phrase: Phrase) {
    audioRef.current?.pause();
    setPlayingId("");
    setSession({
      lessonId: course.find((l) => l.phrases.some((p) => p.id === phrase.id))!
        .id,
      step: 0,
      mistakes: 0,
      practice: phrase.id,
    });
  }
  function advance(skipping = false) {
    if (!session) return;
    if (
      skipping &&
      ((!session.practice && session.step % 3 !== 2) ||
        (session.failedSpeechAttempts ?? 0) < speechSkipThreshold)
    )
      return;
    if (session.practice) {
      setSession(null);
      setNotice(
        skipping
          ? "Ćwiczenie pominięte. Wróć do tego zwrotu, kiedy zechcesz."
          : "Dobra robota! Kolejny zwrot czeka w słowniczku.",
      );
      return;
    }
    const lesson = course.find((l) => l.id === session.lessonId)!;
    const skipped = Array.from(
      new Set([
        ...(session.skipped ?? []),
        ...(skipping ? [lesson.phrases[Math.floor(session.step / 3)].id] : []),
      ]),
    );
    if (session.step + 1 < lesson.phrases.length * 3) {
      setSession({
        ...session,
        step: session.step + 1,
        failedSpeechAttempts: 0,
        skipped,
      });
      return;
    }
    const correct = lesson.phrases.length * 2 - skipped.length,
      accuracy = Math.round((correct / (correct + session.mistakes)) * 100),
      earned = progress.completed[lesson.id] ? 0 : 120;
    const next = {
      ...progress,
      completed: {
        ...progress.completed,
        [lesson.id]: { date: today(), accuracy, skipped },
      },
      days: Array.from(new Set([...progress.days, today()])),
    };
    setProgress(next);
    if (!saveStorage("molo.progress", next))
      setNotice("Nie udało się zapisać postępu na urządzeniu.");
    saveStorage("molo.session", null);
    setSaved(null);
    setSession(null);
    setSummary({ lessonId: lesson.id, accuracy, earned, skipped });
  }
  async function listenTo(phrase: Phrase, slow = false) {
    audioRef.current?.pause();
    const audio = new Audio(`/audio/${phrase.id}.wav`);
    audioRef.current = audio;
    audio.playbackRate = slow ? 0.8 : 1;
    audio.onended = () => setPlayingId("");
    audio.onerror = () => {
      setPlayingId("");
      setNotice("Nie udało się odtworzyć wzorca. Spróbuj ponownie.");
    };
    try {
      setPlayingId(phrase.id);
      await audio.play();
    } catch {
      setPlayingId("");
      setNotice("Dotknij przycisku odsłuchu ponownie, aby włączyć dźwięk.");
    }
  }
  const info = (
    <>
      <p>
        Najpierw posłuchaj wzorca w isiXhosa, potem powtórz go do mikrofonu.
        Możesz też odsłuchać wolniej i porównać własne nagranie.
      </p>
      <div className="info-note">
        <Mic size={22} />
        <p>
          Porównujemy dźwięki z {phrases.length} wzorcami zwrotów i rozpoznajemy
          treść wypowiedzi. Wynik jest orientacyjny: nie jest dokładną oceną
          akcentu ani każdego mlasku.
        </p>
      </div>
      <p>
        Wzorce są generowane modelem mowy przeznaczonym dla Xhosa. Nagranie
        ucznia przetwarza lokalny serwer Molo w pamięci, bez zapisywania go na
        dysku.
      </p>
      <button className="button primary full" onClick={() => setModal(null)}>
        Rozumiem
      </button>
    </>
  );
  if (testing && moduleReady)
    return (
      <ModuleTest
        module={firstModule}
        saveError={moduleTestError}
        onClose={() => {
          setTesting(false);
          setModuleTestError("");
          navigate("learn");
        }}
        onComplete={({ correct, total }) => {
          const updated = {
            ...progress,
            moduleTests: {
              ...progress.moduleTests,
              [firstModule.id]: { correct, total, date: today() },
            },
          };
          setProgress(updated);
          setModuleTestError(
            saveStorage("molo.progress", updated)
              ? ""
              : "Nie udało się zapisać wyniku testu na urządzeniu. Pozostanie dostępny do zamknięcia lub odświeżenia strony.",
          );
        }}
      />
    );
  if (session) {
    const lesson = course.find((l) => l.id === session.lessonId)!,
      phrase = session.practice
        ? phrases.find((p) => p.id === session.practice)!
        : lesson.phrases[Math.floor(session.step / 3)];
    return (
      <>
        <Exercise
          key={`${session.lessonId}-${session.step}-${session.practice ?? ""}`}
          lesson={lesson}
          phrase={phrase}
          step={session.step}
          practiceMode={!!session.practice}
          autoplay={preferences.autoplay}
          ready={health.status === "ready"}
          failedSpeechAttempts={session.failedSpeechAttempts ?? 0}
          onExit={() => setModal("exit")}
          onAdvance={() => advance()}
          onSkip={() => advance(true)}
          onMistake={() =>
            setSession((s) => (s ? { ...s, mistakes: s.mistakes + 1 } : null))
          }
          onSpeechFailure={() =>
            setSession((s) =>
              s
                ? {
                    ...s,
                    mistakes: s.mistakes + 1,
                    failedSpeechAttempts: (s.failedSpeechAttempts ?? 0) + 1,
                  }
                : null,
            )
          }
          onInfo={() => setModal("info")}
        />
        {modal === "exit" && (
          <Modal title="Przerwa na oddech?" onClose={() => setModal(null)}>
            <p>Zapamiętamy ten krok. Wrócisz do niego, kiedy zechcesz.</p>
            <button
              className="button primary full"
              onClick={() => {
                setSession(null);
                setModal(null);
              }}
            >
              Zapisz i wyjdź
            </button>
            <button
              className="button secondary full"
              onClick={() => setModal(null)}
            >
              Wracam do nauki
            </button>
          </Modal>
        )}
        {modal === "info" && (
          <Modal
            title="Jak działa trening głosowy?"
            onClose={() => setModal(null)}
          >
            {info}
          </Modal>
        )}
      </>
    );
  }
  if (summary) {
    const lesson = course.find((l) => l.id === summary.lessonId)!,
      next = course.find((l) => !progress.completed[l.id]);
    return (
      <main className="completion">
        <div className="completion-spark">
          <Trophy size={55} />
          <Star className="spark a" size={22} />
          <Star className="spark b" size={16} />
        </div>
        <p className="eyebrow">LEKCJA {lesson.number} UKOŃCZONA</p>
        <h1>
          Rozmowa zaczyna się
          <br />
          od małego kroku.
        </h1>
        <p>
          {summary.skipped.length
            ? "Lekcja ukończona! Do trudniejszych zwrotów wrócisz we własnym tempie."
            : `Świetna praca! Przećwiczono ${lesson.phrases.length} zwrotów w isiXhosa.`}
        </p>
        <div className="result-stats">
          <div>
            <Zap />
            <strong>+{summary.earned}</strong>
            <span>punktów XP</span>
          </div>
          <div>
            <Mic />
            <strong>{lesson.phrases.length - summary.skipped.length}</strong>
            <span>zaliczone ćwiczenia mowy</span>
          </div>
          <div>
            <CheckCircle2 />
            <strong>{summary.accuracy}%</strong>
            <span>trafności prób</span>
          </div>
        </div>
        {summary.skipped.length > 0 && (
          <div
            className="skipped-summary"
            role="note"
            aria-label="Zwroty do powtórki"
          >
            <RotateCcw size={21} />
            <div>
              <strong>Do powtórki: {summary.skipped.length}</strong>
              <p>
                {skippedPhrases(lesson, summary.skipped).map((p) => (
                  <span lang="xh" key={p.id}>
                    {p.xh}{" "}
                  </span>
                ))}
              </p>
              <span>Pominięte ćwiczenia możesz przećwiczyć w słowniczku.</span>
            </div>
          </div>
        )}
        <button
          className="button primary"
          onClick={() => {
            setSummary(null);
            if (next) begin(next.id);
            else {
              setTesting(true);
              window.scrollTo(0, 0);
            }
          }}
        >
          {next ? `Przejdź do lekcji ${next.number}` : "Rozpocznij test modułu"}
          <ArrowRight size={18} />
        </button>
        <button
          className="text-button"
          onClick={() => {
            setSummary(null);
            navigate("learn");
          }}
        >
          Wróć do ścieżki nauki
        </button>
      </main>
    );
  }
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <a
          className="logo-link"
          href="#"
          aria-label="Molo — strona główna"
          onClick={(e) => {
            e.preventDefault();
            navigate("learn");
          }}
        >
          <Logo />
        </a>
        <div className="course-badge">
          <span className="flag-sa" aria-hidden="true">
            🇿🇦
          </span>
          <div>
            <strong>isiXhosa</strong>
            <span>Uczę się po polsku</span>
          </div>
          <ChevronRight size={16} />
        </div>
        <nav aria-label="Nawigacja główna">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${nav === item.id ? "selected" : ""}`}
              aria-current={nav === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
              {nav === item.id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="small-plant">
            <Leaf size={28} />
          </div>
          <p>
            Małe kroki.
            <br />
            <strong>Prawdziwe rozmowy.</strong>
          </p>
          <span>POLSKI → ISIXHOSA</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-logo">
            <Logo />
          </div>
          <span className="desktop-label">Twoja podróż językowa</span>
          <div className="topbar-stats">
            <span title="Seria dni nauki">
              <Flame size={20} />
              <strong>{dayStreak}</strong>
              <span className="stat-label">dni</span>
            </span>
            <span title="Zdobyte punkty">
              <Zap size={20} />
              <strong>{xp}</strong>
              <span className="stat-label">XP</span>
            </span>
            <span className="avatar" aria-label="Twój profil">
              TY
            </span>
          </div>
        </header>
        <main className="page">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {nav === "learn"
                  ? "WITAJ W ŚWIECIE ISIXHOSA"
                  : nav === "words"
                    ? "SŁOWA, KTÓRE ŁĄCZĄ"
                    : nav === "stats"
                      ? "KAŻDY KROK SIĘ LICZY"
                      : "PO TWOJEMU"}
              </p>
              <h1>
                {nav === "learn"
                  ? "Molo, odkrywco!"
                  : nav === "words"
                    ? "Twój słowniczek"
                    : nav === "stats"
                      ? "Rośniesz z każdą lekcją."
                      : "Ustawienia"}
              </h1>
              <p>
                {nav === "learn"
                  ? "Nowy język zaczyna się od pierwszego „cześć”."
                  : nav === "words"
                    ? "Posłuchaj, przypomnij sobie, powiedz na głos."
                    : nav === "stats"
                      ? "Zobacz, ile rozmów jest już w twoim zasięgu."
                      : "Małe zmiany, wygodniejsza nauka."}
              </p>
            </div>
            {nav === "learn" && (
              <span className="level-pill">
                <span />
                Od podstaw · A0
              </span>
            )}
          </div>
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button
                className="icon-button"
                aria-label="Zamknij powiadomienie"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {nav === "learn" && (
            <>
              <section className="hero">
                <div className="hero-content">
                  <span className="hero-label">
                    <Headphones size={15} />
                    SŁUCHAJ. POWTARZAJ. ROZMAWIAJ.
                  </span>
                  <h2>
                    Najpierw posłuchaj.
                    <br />
                    Potem powiedz <em>molo.</em>
                  </h2>
                  <p>
                    Oswój nowe dźwięki. Naucz się podstaw
                    <br className="desktop-break" /> isiXhosa w swoim rytmie —
                    po polsku.
                  </p>
                  <button
                    className="button primary"
                    onClick={() =>
                      begin(
                        saved && !saved.practice
                          ? saved.lessonId
                          : currentLesson.id,
                      )
                    }
                  >
                    {saved && !saved.practice
                      ? "Kontynuuj lekcję"
                      : completed === course.length
                        ? "Powtórz pierwszą lekcję"
                        : "Zacznij naukę"}
                    <ArrowRight size={19} />
                  </button>
                  <span className="hero-meta">
                    {currentLesson.phrases.length} zwrotów · około{" "}
                    {Math.ceil(currentLesson.phrases.length * 1.2)} minut · twój
                    głos
                  </span>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-orbit" />
                  <div className="art-leaf leaf-one" />
                  <div className="art-leaf leaf-two" />
                  <span className="art-star">✦</span>
                  <div className="speech-card">
                    <div className="speech-card-top">
                      <span>isiXhosa</span>
                      <Volume2 size={20} />
                    </div>
                    <strong>Molo!</strong>
                    <SoundBars />
                    <span className="speech-caption">
                      małe słowo, wielki początek
                    </span>
                  </div>
                  <div className="translation-bubble">
                    Cześć!<span>👋</span>
                  </div>
                  <div className="art-dots">···</div>
                </div>
              </section>
              <div className="content-columns">
                <section className="learning-path">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">
                        MODUŁ {firstModule.number.toString().padStart(2, "0")}
                      </span>
                      <h2>{firstModule.title}</h2>
                    </div>
                    <span className="count-pill">
                      {completed}/{course.length} lekcji
                    </span>
                  </div>
                  <div className="module-intro">
                    <p>{firstModule.description}</p>
                    <details>
                      <summary>Jak okazać szacunek w rozmowie?</summary>
                      <p>{firstModule.cultureNote}</p>
                    </details>
                  </div>
                  <div className="lesson-list">
                    {course.map((lesson, index) => {
                      const done = !!progress.completed[lesson.id],
                        locked = !isLessonUnlocked(
                          lesson.id,
                          progress.completed,
                        );
                      const prerequisite = course
                        .slice(0, index)
                        .find((l) => !progress.completed[l.id]);
                      return (
                        <article
                          key={lesson.id}
                          className={`lesson-card ${lesson.color} ${locked ? "locked" : ""}`}
                        >
                          <div className="lesson-number">
                            {done ? (
                              <Check size={24} />
                            ) : locked ? (
                              <LockKeyhole size={23} />
                            ) : (
                              <span>0{lesson.number}</span>
                            )}
                          </div>
                          <div className="lesson-copy">
                            <span className="lesson-kicker">
                              LEKCJA {lesson.number}
                              {done ? " · UKOŃCZONA" : ""}
                            </span>
                            <h3>{lesson.title}</h3>
                            <p>{lesson.subtitle}</p>
                            <span className="lesson-meta">
                              <Headphones size={13} />
                              {lesson.phrases.length} zwrotów<span>·</span>
                              <Mic size={13} />
                              Trening mowy
                            </span>
                          </div>
                          <button
                            className={`lesson-action ${done ? "done" : ""}`}
                            disabled={locked}
                            aria-label={
                              locked
                                ? `Lekcja ${lesson.number} zablokowana — ukończ lekcję ${prerequisite!.number}`
                                : `${done ? "Powtórz" : "Rozpocznij"} lekcję ${lesson.number}`
                            }
                            onClick={() => begin(lesson.id)}
                          >
                            {done ? (
                              <RotateCcw size={20} />
                            ) : locked ? (
                              <LockKeyhole size={18} />
                            ) : (
                              <ArrowRight size={21} />
                            )}
                          </button>
                          {locked && (
                            <div className="lock-note">
                              Ukończ lekcję {prerequisite!.number}, aby
                              odblokować
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                  <section
                    className="module-test-card"
                    aria-label="Test modułu 1"
                  >
                    <Trophy size={25} />
                    <div>
                      <h3>
                        {modulePassed
                          ? "Moduł 1 ukończony!"
                          : "Sprawdź się w rozmowie"}
                      </h3>
                      <p>
                        {firstModule.questions.length} sytuacji · zaliczenie od{" "}
                        {requiredCorrect(firstModule)} poprawnych odpowiedzi
                      </p>
                      <p>
                        {moduleTest
                          ? `Ostatni wynik: ${moduleTest.correct}/${moduleTest.total} · ${modulePassed ? "test zaliczony" : "spróbuj ponownie"}`
                          : moduleReady
                            ? "Wszystkie lekcje ukończone. Czas na test!"
                            : "Ukończ wszystkie lekcje modułu, aby rozpocząć test."}
                      </p>
                      <button
                        className="button primary"
                        disabled={!moduleReady}
                        onClick={() => {
                          setTesting(true);
                          window.scrollTo(0, 0);
                        }}
                      >
                        {moduleTest
                          ? "Powtórz test modułu"
                          : "Rozpocznij test modułu"}
                        <ArrowRight size={17} />
                      </button>
                    </div>
                  </section>
                  <div className="path-footer">
                    <span className="path-seed">
                      <Leaf size={19} />
                    </span>
                    <p>
                      Nie musisz znać wszystkich słów.
                      <br />
                      <strong>Wystarczy zacząć od jednego.</strong>
                    </p>
                  </div>
                </section>
                <aside className="right-rail">
                  <section className="daily-card">
                    <div className="daily-title">
                      <span className="daily-icon">
                        <Zap size={19} />
                      </span>
                      <h3>Twój dzienny cel</h3>
                      <span>
                        {progress.days.includes(today()) ? "1/1" : "0/1"}
                      </span>
                    </div>
                    <p>Jedna lekcja. Nowa pewność siebie.</p>
                    <div className="goal-track">
                      <span
                        style={{
                          width: progress.days.includes(today())
                            ? "100%"
                            : "0%",
                        }}
                      />
                    </div>
                    <small>
                      {progress.days.includes(today())
                        ? "Cel osiągnięty. Enkosi za dzisiaj!"
                        : "Zrób dziś miejsce na mały krok."}
                    </small>
                  </section>
                  <section className="voice-card">
                    <span className="voice-icon">
                      <AudioLines size={25} />
                    </span>
                    <h3>Twój głos ma znaczenie.</h3>
                    <p>
                      Słuchaj wzorca i powtarzaj. Oswajaj nowe brzmienie, jedną
                      frazą naraz.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => practice(phrases[0])}
                    >
                      Rozgrzej głos
                      <ArrowRight size={16} />
                    </button>
                    <button
                      className="voice-status"
                      onClick={() => setModal("info")}
                    >
                      <span
                        className={
                          health.status === "ready" && health.audioReady
                            ? "ready-dot"
                            : "pending-dot"
                        }
                      />
                      {health.status === "ready" && health.audioReady
                        ? "Tryb głosowy gotowy"
                        : health.status === "loading"
                          ? "Uruchamiamy model Xhosa…"
                          : "Sprawdź dostępność trybu głosowego"}
                      <Info size={13} />
                    </button>
                  </section>
                  <button className="tip-link" onClick={() => setModal("info")}>
                    <Lightbulb size={18} />
                    <span>Jak ćwiczyć wymowę?</span>
                    <ChevronRight size={16} />
                  </button>
                </aside>
              </div>
            </>
          )}
          {nav === "words" && (
            <>
              <div className="dictionary-toolbar">
                <label className="search-field">
                  <Search size={20} />
                  <input
                    aria-label="Szukaj zwrotu"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Szukaj po polsku lub w isiXhosa…"
                  />
                  {search && (
                    <button
                      className="icon-button"
                      aria-label="Wyczyść wyszukiwanie"
                      onClick={() => setSearch("")}
                    >
                      <X size={16} />
                    </button>
                  )}
                </label>
                <div className="filter-tabs" aria-label="Filtr lekcji">
                  {[
                    { id: "all", label: "Wszystkie" },
                    ...course.map((l) => ({
                      id: l.id,
                      label: `Lekcja ${l.number}`,
                    })),
                  ].map((f) => (
                    <button
                      key={f.id}
                      className={filter === f.id ? "selected" : ""}
                      aria-pressed={filter === f.id}
                      onClick={() => setFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="dictionary-count">
                {
                  phrases.filter(
                    (p) =>
                      (filter === "all" ||
                        course
                          .find((l) => l.id === filter)!
                          .phrases.some((item) => item.id === p.id)) &&
                      `${p.xh} ${p.pl}`
                        .toLocaleLowerCase("pl")
                        .includes(search.toLocaleLowerCase("pl")),
                  ).length
                }{" "}
                zwrotów · dotknij głośnika i posłuchaj
              </p>
              <div className="dictionary-grid">
                {phrases
                  .filter(
                    (p) =>
                      (filter === "all" ||
                        course
                          .find((l) => l.id === filter)!
                          .phrases.some((item) => item.id === p.id)) &&
                      `${p.xh} ${p.pl}`
                        .toLocaleLowerCase("pl")
                        .includes(search.toLocaleLowerCase("pl")),
                  )
                  .map((p) => (
                    <article className="word-card" key={p.id}>
                      <div className="word-top">
                        <span className="word-lesson">
                          LEKCJA{" "}
                          {
                            course.find((l) =>
                              l.phrases.some((item) => item.id === p.id),
                            )!.number
                          }
                        </span>
                        <button
                          className={`word-audio ${playingId === p.id ? "playing" : ""}`}
                          aria-label={`Odtwórz: ${p.xh}`}
                          onClick={() => void listenTo(p)}
                        >
                          <Volume2 size={20} />
                        </button>
                      </div>
                      <h2 lang="xh">{p.xh}</h2>
                      <strong className="word-translation">{p.pl}</strong>
                      <p>{p.context}</p>
                      <div className="word-bottom">
                        <button
                          className="text-button"
                          aria-label={`Odtwórz wolniej: ${p.xh}`}
                          onClick={() => void listenTo(p, true)}
                        >
                          0,8×
                          <Volume2 size={14} />
                        </button>
                        <button
                          className="text-button"
                          aria-label={`Ćwicz wymowę: ${p.xh}`}
                          onClick={() => practice(p)}
                        >
                          <Mic size={15} />
                          Powtórz
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!phrases.some(
                (p) =>
                  (filter === "all" ||
                    course
                      .find((l) => l.id === filter)!
                      .phrases.some((item) => item.id === p.id)) &&
                  `${p.xh} ${p.pl}`
                    .toLocaleLowerCase("pl")
                    .includes(search.toLocaleLowerCase("pl")),
              ) && (
                <div className="empty-state">
                  <Search size={36} />
                  <h2>Jeszcze nie znamy tego zwrotu.</h2>
                  <p>Spróbuj krótszego słowa albo zmień filtr lekcji.</p>
                </div>
              )}
            </>
          )}
          {nav === "stats" && (
            <>
              <div className="stats-grid">
                <StatCard icon={<Zap />} value={xp} label="punktów XP" />
                <StatCard
                  icon={<BookOpen />}
                  value={`${completed}/${course.length}`}
                  label="ukończone lekcje"
                />
                <StatCard
                  icon={<Mic />}
                  value={knownPhrases}
                  label="poznanych zwrotów"
                />
                <StatCard
                  icon={<Flame />}
                  value={dayStreak}
                  label="dni w serii"
                />
              </div>
              <section className="progress-section">
                <h2>
                  Moduł {firstModule.number}: {firstModule.title}
                </h2>
                {course.map((l) => (
                  <div className="progress-row" key={l.id}>
                    <span
                      className={`progress-round ${progress.completed[l.id] ? "checked" : ""}`}
                    >
                      {progress.completed[l.id] ? (
                        <Check size={21} />
                      ) : (
                        l.number
                      )}
                    </span>
                    <div>
                      <h3>{l.title}</h3>
                      <p>
                        {progress.completed[l.id]
                          ? `Ukończono ${new Date(progress.completed[l.id].date + "T12:00:00").toLocaleDateString("pl-PL")} · trafność prób ${progress.completed[l.id].accuracy}%`
                          : "Ta rozmowa dopiero przed tobą."}
                      </p>
                      {skippedPhrases(l, progress.completed[l.id]?.skipped)
                        .length > 0 && (
                        <p className="skipped-progress">
                          Do powtórki:{" "}
                          {
                            skippedPhrases(l, progress.completed[l.id]?.skipped)
                              .length
                          }{" "}
                          · pominięte ćwiczenia mowy
                        </p>
                      )}
                    </div>
                    <span>{progress.completed[l.id] ? "+120 XP" : "0 XP"}</span>
                  </div>
                ))}
                <div className="progress-row module-test-progress">
                  <span
                    className={`progress-round ${modulePassed ? "checked" : ""}`}
                  >
                    <Trophy size={21} />
                  </span>
                  <div>
                    <h3>Test sytuacyjny</h3>
                    <p>
                      {moduleTest
                        ? `${moduleTest.correct}/${moduleTest.total} · ${modulePassed ? "zaliczony" : "do powtórki"}`
                        : moduleReady
                          ? "Test jest już dostępny."
                          : "Dostępny po pięciu lekcjach."}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    disabled={!moduleReady}
                    onClick={() => setTesting(true)}
                  >
                    {moduleTest ? "Powtórz test" : "Rozpocznij test"}
                  </button>
                </div>
              </section>
              <div className="progress-encouragement">
                <Leaf size={34} />
                <div>
                  <h3>
                    {skippedCount > 0
                      ? "Wróć do pominiętych zwrotów."
                      : modulePassed
                        ? "Pierwszy moduł za tobą."
                        : completed === course.length
                          ? "Sprawdź zwroty w codziennych sytuacjach."
                          : "Regularność wygrywa z pośpiechem."}
                  </h3>
                  <p>
                    {completed === course.length
                      ? modulePassed
                        ? "Wróć do słowniczka i utrwal poznane słowa na głos."
                        : "Test sytuacyjny czeka. Zaliczenie wymaga 10 z 12 poprawnych odpowiedzi."
                      : "Wystarczy jedna krótka lekcja, żeby ruszyć do przodu."}
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() =>
                    completed === course.length
                      ? modulePassed
                        ? navigate("words")
                        : setTesting(true)
                      : begin(currentLesson.id)
                  }
                >
                  {completed === course.length
                    ? modulePassed
                      ? "Powtórz zwroty"
                      : "Rozpocznij test modułu"
                    : "Ucz się dalej"}
                  <ArrowRight size={17} />
                </button>
              </div>
            </>
          )}
          {nav === "settings" && (
            <div className="settings-panel">
              <section>
                <h2>Dźwięk i nauka</h2>
                <div className="setting-row">
                  <div>
                    <h3>Automatyczny odsłuch</h3>
                    <p>Czytaj każdą frazę po przejściu do nowego ćwiczenia.</p>
                  </div>
                  <button
                    className={`toggle ${preferences.autoplay ? "on" : ""}`}
                    role="switch"
                    aria-label="Automatyczny odsłuch"
                    aria-checked={preferences.autoplay}
                    onClick={() => {
                      const next = { autoplay: !preferences.autoplay };
                      setPreferences(next);
                      saveStorage("molo.preferences", next);
                    }}
                  >
                    <span />
                  </button>
                </div>
                <p className="setting-footnote">
                  Przeglądarka może poprosić o pierwsze dotknięcie przycisku
                  odsłuchu. Wszystkie frazy mają też przycisk odtwarzania.
                </p>
              </section>
              <section>
                <h2>Trening głosowy</h2>
                <div className="engine-status">
                  <span
                    className={
                      health.status === "ready" ? "ready-dot" : "pending-dot"
                    }
                  />
                  <strong>
                    {health.status === "ready"
                      ? "Rozpoznawanie Xhosa jest gotowe"
                      : health.status === "loading"
                        ? "Trwa uruchamianie modelu Xhosa"
                        : "Model Xhosa jest niedostępny"}
                  </strong>
                </div>
                <p>
                  Odsłuch ma dwa tempa. Mikrofon włącza się dopiero po
                  dotknięciu przycisku nagrywania i wyłącza po zakończeniu
                  nagrania.
                </p>
                <button
                  className="text-button"
                  onClick={() => setModal("info")}
                >
                  Jak działa ocena wypowiedzi?
                  <ArrowRight size={16} />
                </button>
              </section>
              <section>
                <h2>Twoje dane</h2>
                <p>
                  Postępy zapisujemy w tej przeglądarce. Nagrania są analizowane
                  w pamięci lokalnego serwera i nie są zachowywane.
                </p>
                <button
                  className="text-button danger"
                  onClick={() => setModal("reset")}
                >
                  <RotateCcw size={16} />
                  Wyzeruj postępy
                </button>
              </section>
              <section className="source-section">
                <h2>O języku i źródłach</h2>
                <p>
                  „Tata” i „mama” to formy szacunku wobec starszych osób. Nie są
                  uniwersalnym, dosłownym odpowiednikiem polskiego „pan” i
                  „pani” w każdej sytuacji.
                </p>
                <a
                  href="https://www.unisa.ac.za/static/corporate_web/Content/UnisaOpen/freeOnlineCourse/Xhosa/Xhosa1.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  Materiały językowe: University of South Africa ↗
                </a>
                {firstModule.sources.map((source) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.title} ↗
                  </a>
                ))}
                <a
                  href="https://huggingface.co/UBC-NLP/Simba-TTS-xho"
                  target="_blank"
                  rel="noreferrer"
                >
                  Wzorce mowy: UBC-NLP / Simba-TTS-xho · CC BY 4.0 ↗
                </a>
                <a
                  href="https://huggingface.co/OpenVoiceOS/misterkissi-w2v2-lg-xls-r-300m-xhosa-onnx"
                  target="_blank"
                  rel="noreferrer"
                >
                  Rozpoznawanie: OpenVoiceOS / Emmanuel Kissi · CC BY-NC-SA 4.0
                  ↗
                </a>
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>
              molo. <span>Małe kroki, nowe rozmowy.</span>
            </span>
            <span>
              Stworzone z ciekawości do języka <Leaf size={13} />
            </span>
          </footer>
        </main>
      </div>
      {modal === "info" && (
        <Modal
          title="Jak działa trening głosowy?"
          onClose={() => setModal(null)}
        >
          {info}
        </Modal>
      )}
      {modal === "reset" && (
        <Modal
          title="Zacząć od pierwszego molo?"
          onClose={() => setModal(null)}
        >
          <p>
            Usuniesz ukończone lekcje, wynik testu modułu, punkty XP, serię dni
            i zapisane ćwiczenie z tej przeglądarki.
          </p>
          <button
            className="button danger-button full"
            onClick={() => {
              const empty = { completed: {}, days: [] };
              setProgress(empty);
              saveStorage("molo.progress", empty);
              saveStorage("molo.session", null);
              setSaved(null);
              setModal(null);
              navigate("learn");
            }}
          >
            Tak, wyzeruj postępy
          </button>
          <button
            className="button secondary full"
            onClick={() => setModal(null)}
          >
            Zachowaj postępy
          </button>
        </Modal>
      )}
    </div>
  );
}
function StatCard({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
      <strong>{value}</strong>
      <p>{label}</p>
    </div>
  );
}

function Exercise({
  lesson,
  phrase,
  step,
  practiceMode,
  autoplay,
  ready,
  failedSpeechAttempts,
  onExit,
  onAdvance,
  onSkip,
  onMistake,
  onSpeechFailure,
  onInfo,
}: {
  lesson: Lesson;
  phrase: Phrase;
  step: number;
  practiceMode: boolean;
  autoplay: boolean;
  ready: boolean;
  failedSpeechAttempts: number;
  onExit: () => void;
  onAdvance: () => void;
  onSkip: () => void;
  onMistake: () => void;
  onSpeechFailure: () => void;
  onInfo: () => void;
}) {
  const mode = practiceMode ? 2 : step % 3,
    total = lesson.phrases.length * 3;
  const [heard, setHeard] = useState(false),
    [playing, setPlaying] = useState(false),
    [audioError, setAudioError] = useState("");
  const [selection, setSelection] = useState(""),
    [answerCorrect, setAnswerCorrect] = useState(false);
  const [state, setState] = useState<
      "idle" | "permission" | "recording" | "evaluating"
    >("idle"),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [recordedUrl, setRecordedUrl] = useState("");
  const audio = useRef<HTMLAudioElement>(null),
    recorded = useRef<HTMLAudioElement>(null),
    recording = useRef<Recording | null>(null),
    request = useRef<AbortController | null>(null),
    active = useRef(true),
    url = useRef("");
  const options = [
    phrase,
    ...phrases
      .filter((p) => p.id !== phrase.id && p.pl !== phrase.pl)
      .sort(
        (a, b) =>
          Math.abs(a.pl.length - phrase.pl.length) -
          Math.abs(b.pl.length - phrase.pl.length),
      )
      .slice(0, 3),
  ].sort((a, b) => a.id.localeCompare(b.id));
  useEffect(() => {
    active.current = true;
    const player = audio.current;
    if (autoplay) void play(1);
    return () => {
      active.current = false;
      player?.pause();
      recording.current?.cancel();
      request.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  useEffect(() => {
    const review = recorded.current;
    return () => review?.pause();
  }, [recordedUrl]);
  async function play(rate: number) {
    if (!audio.current) return;
    try {
      setAudioError("");
      recorded.current?.pause();
      audio.current.pause();
      audio.current.currentTime = 0;
      audio.current.playbackRate = rate;
      await audio.current.play();
    } catch (e) {
      if (!active.current || (e as Error).name === "AbortError") return;
      setPlaying(false);
      setAudioError("Dotknij odsłuchu, aby włączyć dźwięk.");
    }
  }
  async function assess(blob: Blob) {
    if (!active.current) return;
    setState("evaluating");
    setError("");
    setResult(null);
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(blob);
    setRecordedUrl(url.current);
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const wav = await toWav(blob);
      if (!active.current) return;
      const response = await fetch(`/api/evaluate/${phrase.id}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || "Nie udało się sprawdzić nagrania.");
      if (active.current) {
        setResult(data);
        if (!data.passed) onSpeechFailure();
      }
    } catch (e) {
      if (active.current)
        setError(
          (e as Error).name === "AbortError"
            ? "Analiza trwała zbyt długo. Spróbuj ponownie."
            : (e as Error).message ||
                "Sprawdź połączenie z serwerem i spróbuj ponownie.",
        );
    } finally {
      clearTimeout(timeout);
      if (active.current) setState("idle");
    }
  }
  async function record() {
    audio.current?.pause();
    recorded.current?.pause();
    setPlaying(false);
    setResult(null);
    setError("");
    setState("permission");
    try {
      const value = await startRecording(
        (blob) => {
          recording.current = null;
          void assess(blob);
        },
        (message) => {
          if (active.current) {
            setState("idle");
            setError(message);
          }
        },
      );
      if (!active.current) {
        value.cancel();
        return;
      }
      recording.current = value;
      setState("recording");
    } catch (e) {
      if (active.current) {
        setState("idle");
        setError(micError(e));
      }
    }
  }
  const canAdvance =
    mode === 0 ? heard : mode === 1 ? answerCorrect : result?.passed;
  const canSkip =
    mode === 2 &&
    failedSpeechAttempts >= speechSkipThreshold &&
    !result?.passed;
  return (
    <div className="exercise-shell">
      <header className="exercise-header">
        <button
          className="icon-button exit-button"
          aria-label="Wyjdź z lekcji"
          onClick={onExit}
        >
          <X size={25} />
        </button>
        <div className="exercise-progress">
          <div className="progress-label">
            <span>
              {practiceMode
                ? "SWOBODNY TRENING"
                : `LEKCJA ${lesson.number} · ${lesson.subtitle.toUpperCase()}`}
            </span>
            <span>{practiceMode ? "Twój głos" : `${step + 1} / ${total}`}</span>
          </div>
          <div
            className="exercise-track"
            role="progressbar"
            aria-label="Postęp lekcji"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={step}
          >
            <span
              style={{ width: `${practiceMode ? 100 : (step / total) * 100}%` }}
            />
          </div>
        </div>
        <span className="exercise-xp">
          <Zap size={21} />
          {practiceMode ? "TRENING" : "+120 XP"}
        </span>
      </header>
      <main className="exercise-main">
        <div className="exercise-type">
          <span>
            {mode === 0 ? (
              <BookOpen size={16} />
            ) : mode === 1 ? (
              <Headphones size={16} />
            ) : (
              <Mic size={16} />
            )}
          </span>
          {mode === 0 ? "POZNAJ" : mode === 1 ? "POSŁUCHAJ" : "POWIEDZ"}
          <i />
          {practiceMode
            ? "Praktyka bez pośpiechu"
            : `Zwrot ${Math.floor(step / 3) + 1} z ${lesson.phrases.length}`}
        </div>
        <h1>
          {mode === 0
            ? "Małe słowo. Nowa rozmowa."
            : mode === 1
              ? "Co słyszysz?"
              : "Teraz twoja kolej."}
        </h1>
        <p className="exercise-intro">
          {mode === 0
            ? "Posłuchaj, jak brzmi ten zwrot w isiXhosa."
            : mode === 1
              ? "Posłuchaj nagrania i wybierz polskie znaczenie."
              : "Posłuchaj wzorca, a potem powtórz zwrot na głos."}
        </p>
        <audio
          ref={audio}
          src={`/audio/${phrase.id}.wav`}
          preload="auto"
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setHeard(true);
          }}
          onError={() => {
            setPlaying(false);
            setAudioError(
              "Brakuje nagrania wzorcowego. Spróbuj ponownie za chwilę.",
            );
          }}
        />
        <div className={`phrase-panel ${mode === 1 ? "listening-panel" : ""}`}>
          <span className="phrase-language">
            ISIXHOSA · {mode === 1 ? "POSŁUCHAJ UWAŻNIE" : "NOWE BRZMIENIE"}
          </span>
          {mode === 1 ? (
            <div className="listening-wave">
              <Headphones size={38} />
              <SoundBars active={playing} />
            </div>
          ) : (
            <>
              <h2 lang="xh">{phrase.xh}</h2>
              <p>{phrase.pl}</p>
            </>
          )}
          <div className="audio-controls">
            <button
              className="button audio-button"
              aria-label="Odtwórz frazę"
              disabled={state === "recording" || state === "permission"}
              onClick={() => void play(1)}
            >
              {playing ? <AudioLines size={20} /> : <Volume2 size={20} />}
              Odsłuchaj
            </button>
            <button
              className="slow-button"
              aria-label="Odtwórz wolniej"
              disabled={state === "recording" || state === "permission"}
              onClick={() => void play(0.8)}
            >
              <Play size={15} />
              0,8×
            </button>
          </div>
          {audioError && (
            <p className="audio-error" role="status">
              {audioError}
            </p>
          )}
        </div>
        {mode === 0 && (
          <div className="context-note">
            <span>
              <Lightbulb size={20} />
            </span>
            <div>
              <strong>Kiedy tego użyjesz?</strong>
              <p>{phrase.context}</p>
            </div>
          </div>
        )}
        {mode === 1 && (
          <div
            className="answer-options"
            role="group"
            aria-label="Wybierz znaczenie"
          >
            {options.map((option, i) => (
              <button
                key={option.id}
                className={`answer-option ${selection === option.id ? (answerCorrect ? "correct" : "incorrect") : ""}`}
                disabled={answerCorrect}
                onClick={() => {
                  setSelection(option.id);
                  const correct = option.id === phrase.id;
                  setAnswerCorrect(correct);
                  if (!correct) onMistake();
                }}
              >
                <span className="option-number">{i + 1}</span>
                {option.pl}
                <span className="option-mark">
                  {selection === option.id &&
                    (answerCorrect ? <Check size={19} /> : <X size={19} />)}
                </span>
              </button>
            ))}
          </div>
        )}
        {mode === 2 && (
          <div className="speaking-section">
            <button
              className={`mic-button ${state === "recording" ? "recording" : ""}`}
              disabled={
                !ready ||
                state === "permission" ||
                state === "evaluating" ||
                !!result?.passed
              }
              aria-label={
                state === "recording"
                  ? "Zakończ nagranie"
                  : "Nagraj swoją wypowiedź"
              }
              onClick={() => {
                if (state === "recording") {
                  recording.current?.stop();
                } else void record();
              }}
            >
              {state === "recording" ? (
                <Square size={27} fill="currentColor" />
              ) : state === "evaluating" || state === "permission" ? (
                <LoaderCircle size={29} className="spin" />
              ) : (
                <Mic size={31} />
              )}
            </button>
            <strong className="record-status" role="status">
              {state === "recording"
                ? "Mów teraz… Dotknij, aby zakończyć."
                : state === "evaluating"
                  ? "Słuchamy twojej wypowiedzi…"
                  : state === "permission"
                    ? "Czekamy na dostęp do mikrofonu…"
                    : !ready
                      ? "Model Xhosa jeszcze nie jest gotowy."
                      : result?.passed
                        ? "Dobra robota!"
                        : result
                          ? "Możesz spróbować ponownie."
                          : "Dotknij mikrofonu i powiedz frazę."}
            </strong>
            <span className="record-hint">
              {state === "recording"
                ? "Nagrywanie zakończy się automatycznie po 11 sekundach."
                : "Najlepiej w cichym miejscu, blisko mikrofonu."}
            </span>
            <label
              className={`upload-link ${state !== "idle" ? "disabled" : ""}`}
            >
              <Upload size={14} />
              Użyj nagrania z pliku
              <input
                type="file"
                accept="audio/*"
                aria-label="Wybierz nagranie swojej wypowiedzi"
                disabled={!ready || state !== "idle" || !!result?.passed}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) {
                    if (file.size > 8 * 1024 * 1024)
                      setError(
                        "Plik jest za duży. Wybierz krótkie nagranie do 12 sekund.",
                      );
                    else void assess(file);
                  }
                }}
              />
            </label>
            {recordedUrl && (
              <audio
                ref={recorded}
                onPlay={() => audio.current?.pause()}
                className="recorded-audio"
                aria-label="Twoje nagranie"
                controls
                src={recordedUrl}
                preload="metadata"
              />
            )}
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            {result && (
              <div
                className={`speech-result ${result.passed ? "success" : "retry"}`}
                role="status"
              >
                <div className="speech-result-heading">
                  {result.passed ? (
                    <CheckCircle2 size={22} />
                  ) : (
                    <RotateCcw size={22} />
                  )}
                  <strong>
                    {result.passed
                      ? "Fraza rozpoznana. Dobra robota!"
                      : result.reason === "silence"
                        ? "Nie słychać wypowiedzi."
                        : "Jeszcze jedna próba?"}
                  </strong>
                  <span>{result.score}%</span>
                </div>
                <p>
                  {result.reason === "silence" ? (
                    "Sprawdź mikrofon i powiedz całą frazę wyraźnie."
                  ) : (
                    <>
                      Usłyszeliśmy:{" "}
                      <strong lang="xh">{result.transcript || "—"}</strong>
                    </>
                  )}
                </p>
                <div className="word-feedback" aria-label="Rozpoznane słowa">
                  {result.words.map((word, i) => (
                    <span
                      key={i}
                      className={word.matched ? "matched" : "unmatched"}
                      lang="xh"
                    >
                      {word.matched ? (
                        <Check size={13} />
                      ) : (
                        <RotateCcw size={13} />
                      )}{" "}
                      {word.word}
                    </span>
                  ))}
                </div>
                <small>
                  Podobieństwo do wzorca; ocena orientacyjna, bez szczegółowej
                  analizy akcentu.
                </small>
              </div>
            )}
            <details className="pronunciation-tip">
              <summary>
                <Lightbulb size={17} />
                Wskazówka wymowy
                <ChevronRight size={15} />
              </summary>
              <p>{phrase.tip}</p>
            </details>
          </div>
        )}
      </main>
      <footer className={`exercise-bottom ${canAdvance ? "has-success" : ""}`}>
        <div className="exercise-bottom-inner">
          <div className="bottom-feedback">
            {canAdvance ? (
              <>
                <span className="feedback-check">
                  <Check size={22} />
                </span>
                <div>
                  <strong>
                    {mode === 0
                      ? "Masz już pierwsze brzmienie."
                      : "Tak jest! Mały krok do przodu."}
                  </strong>
                  <span>
                    {mode === 0
                      ? "Teraz sprawdźmy twój słuch."
                      : mode === 1
                        ? "Za chwilę powiesz to samodzielnie."
                        : "Każda próba buduje pewność siebie."}
                  </span>
                </div>
              </>
            ) : canSkip ? (
              <>
                <span className="feedback-retry">
                  <RotateCcw size={23} />
                </span>
                <div>
                  <strong>Możesz wrócić do tego zwrotu później.</strong>
                  <span>Pominięcie nie zalicza wymowy.</span>
                </div>
              </>
            ) : selection && !answerCorrect ? (
              <>
                <span className="feedback-retry">
                  <RotateCcw size={23} />
                </span>
                <div>
                  <strong>Posłuchaj jeszcze raz.</strong>
                  <span>Wybierz inne znaczenie i spróbuj ponownie.</span>
                </div>
              </>
            ) : (
              <>
                <button
                  className="icon-button"
                  aria-label="Jak działa ocena wypowiedzi"
                  onClick={onInfo}
                >
                  <Info size={20} />
                </button>
                <span>
                  {mode === 0
                    ? "Odsłuchaj frazę do końca, aby przejść dalej."
                    : mode === 1
                      ? "Wybierz odpowiedź po polsku."
                      : "Mów śmiało. Możesz próbować wiele razy."}
                </span>
              </>
            )}
          </div>
          <div className="exercise-actions">
            {canSkip && (
              <button
                className="button secondary skip-button"
                disabled={state !== "idle"}
                onClick={onSkip}
              >
                Pomiń ćwiczenie
              </button>
            )}
            <button
              className="button primary next-button"
              disabled={
                !canAdvance || state === "evaluating" || state === "recording"
              }
              onClick={onAdvance}
            >
              {practiceMode
                ? "Zakończ trening"
                : step === total - 1
                  ? "Zakończ lekcję"
                  : "Dalej"}
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
