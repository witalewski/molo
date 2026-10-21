# Molo — polski → isiXhosa

Lokalna, responsywna aplikacja do pierwszych rozmów w isiXhosa. React + TypeScript + Vite, serwer Express i lokalny model mowy ONNX. Codzienna nauka działa bez konta i kluczy API.

## Uruchomienie

Projekt korzysta z **mise** (Node 26.7.0, uv 0.13.1) i **uv** (Python 3.12.15, `pyproject.toml`, `uv.lock`).

```sh
mise trust
mise install
mise exec -- npm ci
# Pierwsze przygotowanie na nowym komputerze, około 1,5 GB pobrań:
mise run voice
mise run dev
```

Aplikacja: http://localhost:4173. Nagrania wzorcowe są już w `public/audio/`, model ASR przygotowano w ignorowanym katalogu `models/xhosa-asr/`. `mise run voice` przygotowuje model rozpoznawania mowy i zależności, zachowując nagrania lekcji. Pobieranie modelu wznawia się po przerwaniu i weryfikuje SHA-256.

Po przygotowaniu zależności i modeli nauka działa bez połączenia z zewnętrznymi usługami. Fonty i audio są lokalne. Serwer aplikacji musi działać.

## Telefon w tej samej sieci Wi-Fi

Na tym komputerze wystarczy:

```sh
cd /Users/chris/workspace/xhosa
mise run phone
```

Komenda buduje aktualną aplikację, wykrywa prywatny adres IPv4 Wi-Fi i uruchamia dwa lokalne adresy. Przy obecnej konfiguracji komputera są to:

- **Konfiguracja telefonu:** http://192.168.1.12:4174
- **Aplikacja z mikrofonem:** https://192.168.1.12:8443

Najpierw otwórz adres konfiguracji na telefonie połączonym z tą samą siecią Wi-Fi. Strona zawiera plik certyfikatu oraz instrukcję dla iPhone’a/iPada i Androida. Mikrofon wymaga zaufanego HTTPS — zwykły adres HTTP w sieci lokalnej nie wystarcza.

Na iPhonie pobierz profil w Safari, zainstaluj go w Ustawieniach, a następnie włącz zaufanie do **Molo Local Wi-Fi CA** w Ogólne → To urządzenie → Ustawienia zaufania certyfikatów. Na Androidzie pobierz plik certyfikatu i w ustawieniach zainstaluj go jako certyfikat CA, po czym otwórz aplikację w Chrome. Szczegóły: [Apple](https://support.apple.com/pl-pl/102390), [Google](https://support.google.com/pixelphone/answer/2844832?hl=pl), [wymaganie HTTPS dla mikrofonu](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Instalacja i zaufanie na telefonie wymagają Twojej decyzji. Skrypt nie zmienia systemowych magazynów certyfikatów. Klucze prywatne zostają w ignorowanym katalogu `.certs/` z ograniczonymi uprawnieniami; strona konfiguracji udostępnia tylko publiczny certyfikat i profil. Profil można usunąć po zakończeniu testów. Odcisk certyfikatu jest wypisywany w terminalu i na stronie konfiguracji.

Komputer musi pozostać włączony, a terminal z aplikacją otwarty. Jeśli macOS poprosi o połączenia przychodzące dla Node, zezwól na nie. Sieć gościnna z izolacją urządzeń może blokować dostęp. Po zmianie IP komenda wypisze nowe adresy i odnowi certyfikat serwera z użyciem tego samego CA, więc ponowna instalacja CA nie jest potrzebna. Opcjonalne ustawienia: `MOLO_LAN_IP`, `MOLO_PHONE_PORT` (8443), `MOLO_SETUP_PORT` (4174).

## Moduł 1 — Pierwsze rozmowy

1. **Pierwsze molo**: Molo!, Molweni!, Molo, tata!, Molo, mama!, Hamba kakuhle!, Sala kakuhle!.
2. **Małe słowa, dużo szacunku**: Enkosi!, Enkosi kakhulu!, Enkosi, tata!, Enkosi, mama!, Uxolo, tata!, Uxolo, mama!.
3. **Co u ciebie?**: Unjani?, Ndiphilile, enkosi., Wena unjani?, Nam ndiphilile., Ninjani?, Siphilile, enkosi. — pełna wymiana powitania z jedną osobą i grupą.
4. **Poproszę, dziękuję**: Ndicela amanzi., Ndicela undincede., Andiqondi., Ndicela uphinde., Ndicela uthethe ungangxami., Nam ndiyabulela. — prośby o wodę, pomoc, powtórzenie i wolniejsze tempo oraz odpowiedź na podziękowanie.
5. **Do kogo mówisz?**: Molo, bhuti!, Molo, sisi!, Molo, tat’omkhulu!, Molo, makhulu!, Hambani kakuhle!, Salani kakuhle!, Ulale kamnandi!, Hayi, enkosi. — rówieśnicy, starsi rozmówcy, grupy, dobranoc i uprzejma odmowa.

To jeden moduł z **5 lekcjami i 32 zwrotami**. Każdy zwrot ma trzy kroki: odsłuch i kontekst po polsku, rozpoznanie znaczenia ze słuchu i wypowiedź. To **96 ćwiczeń, w tym 32 ćwiczenia mówienia**. Lekcje odblokowują się kolejno; po ukończeniu dwóch dotychczasowych lekcji od razu dostępna jest trzecia. Dotychczasowy zapis postępu pozostaje zgodny. Postęp pojedynczego kroku, ukończone lekcje, seria dni i ustawienia zapisują się w localStorage. Pierwsze ukończenie każdej lekcji daje 120 XP (łącznie 600 XP); powtarzanie nie dodaje punktów.

Po pięciu lekcjach odblokowuje się **test 12 sytuacji**: wybór powitania, formy szacunku, prośby, podziękowania i pożegnania zależnie od rozmówcy i sytuacji. Pierwszy wybór w pytaniu jest ostateczny, a po nim pokazujemy wyjaśnienie. Zaliczenie wymaga **10/12** poprawnych odpowiedzi (próg 80%, zaokrąglany w górę do pełnego pytania). Wynik zapisuje się po zakończeniu całego testu; wyjście w trakcie nie zapisuje częściowego wyniku. Podsumowanie pokazuje błędy z poprawnymi odpowiedziami. Test można powtarzać bez dodatkowych XP, a ścieżka i postępy pokazują ostatni wynik. Zaliczenie testu oznacza ukończenie modułu. Wyzerowanie postępów usuwa też wynik testu. Obecnie kurs zawiera wyłącznie pierwszy moduł.

Po **trzech nieudanych próbach nagrania lub oceny wypowiedzi dla bieżącego zwrotu** pojawia się przycisk „Pomiń ćwiczenie”. Liczą się zarówno negatywne oceny wymowy, jak i błędy mikrofonu, pliku, połączenia lub analizy, w tym przekroczenie czasu oczekiwania. Można nadal próbować albo od razu przejść dalej, także z ostatniego zadania do podsumowania i kolejnej lekcji. Pominięcie nie jest poprawną odpowiedzią: podsumowanie i postępy pokazują pominięte zwroty jako „do powtórki”, a licznik zaliczonych ćwiczeń mowy je pomija. Trafność to udział poprawnych odpowiedzi w ocenionych próbach; błędy techniczne nie są oceną wymowy i nie obniżają trafności. Licznik nieudanych prób zapisuje się z przerwaną lekcją i zeruje dla kolejnego zwrotu. Opcja działa też w swobodnym treningu, bez przyznawania XP.

Słowniczek umożliwia wyszukiwanie po polsku i w isiXhosa, filtrowanie lekcji, odsłuch normalny i 0,8× oraz osobny trening mówienia.

**Kontekst kulturowy:** tata i mama są formami szacunku wobec pokolenia rodziców, tat’omkhulu i makhulu wobec pokolenia dziadków, a bhuti i sisi odnoszą się do osób w podobnym wieku. Mogą dotyczyć osób spoza rodziny; uwzględniaj preferencje rozmówcy i sposób przedstawienia się w sytuacji oficjalnej. Nie stanowią dosłownego odpowiednika polskich form pan/pani w każdym kontekście. Molo pasuje o każdej porze dnia. Hamba kakuhle kierujemy do jednej osoby odchodzącej, Sala kakuhle do pozostającej; do grup odpowiednio Hambani i Salani kakuhle. Ndicela wprowadza prośbę; odpowiedzią na podziękowanie może być Nam ndiyabulela. Wyjaśnienia i przykłady są przy zwrotach oraz w rozwijanej wskazówce modułu.

## Bezpłatny, jednolity bank audio

Domyślny generator `scripts/generate-uniform-audio.py` tworzy nagrania lokalnie na Apple Silicon, używając **Higgs TTS 3 w wersji MLX 6-bitowej**. Model `whitelabel/mlx-q6-higgs-tts-3-4b`, jego wersja, sumy kontrolne wag, zależności i ustawienia są przypięte w `scripts/audio-standard.json` oraz `uv.lock`. Nie potrzeba konta ani płatnego API. Model jest przeznaczony do prywatnej nauki i innych zastosowań niekomercyjnych na licencji Boson Higgs TTS 3; pełny tekst jest w `scripts/audio-sources/higgs/`.

Każdy zwrot powstaje w całości z jednym stałym, syntetycznym profilem głosu, bez nagrań lektora, sklejania słów i wyjątków dla konkretnych fraz. Główne nagrania używają ziarna 1337, niezależne próbki testowe 2026. Warianty 0,96× i 1,04× to przekształcenia tempa głównego nagrania, a historyczne numery 7331 i 7332 są identyfikatorami plików. Wygenerowane źródła i sumy SHA-256 zostają w lokalnej, niezmiennej pamięci podręcznej.

**Zestaw Higgs został wdrożony do wszystkich lekcji 21 października 2026, po decyzji użytkownika o zaakceptowaniu znanych rozbieżności.** Pochodzenie i sumy plików są w `public/audio/provenance.json`. Poprzedni bank zachowano w lokalnej kopii pod `models/audio-backups/`; jej lokalizację wskazuje `latest.json`.

**Kolejne generowanie nie zastępuje automatycznie nagrań aplikacji.** Zapisuje do `models/higgs-mlx-candidate/`, osobno od plików używanych przez lekcje. Zestaw obejmuje 32 odsłuchy, 64 warianty referencyjne, 32 niezależne próbki testowe, wypowiedź negatywną i ciszę. Manifest ukończonego zestawu powstaje dopiero po wygenerowaniu wszystkich plików. Wyniki porównań i status jakości opisuje [raport](reports/audio-review.md). Poprzednia próba OmniVoice pozostaje w `models/audio-candidate/`.

```sh
npm run audio:plan
# Pierwsza generacja: pobranie przypiętego modelu około 3,7 GB:
npm run audio:generate -- --download-model
# Powtórna obróbka zapisanych źródeł bez sieci i ładowania modelu:
uv run --locked python scripts/generate-uniform-audio.py
# Niezależna kontrola treści, bez podmiany wyniku na oczekiwany zwrot:
npm run audit:audio -- --audio-dir models/higgs-mlx-candidate/audio --fixtures-dir models/higgs-mlx-candidate/fixtures --output models/higgs-mlx-candidate/audit.json
# Porównanie starych i nowych nagrań: http://127.0.0.1:4175
npm run audio:review -- --bank models/higgs-mlx-candidate
npm run test:audio-generation
```

Próba pełnego modelu przekroczyła możliwości komputera z 16 GB RAM. Generator korzysta teraz wyłącznie ze sprawdzonej wersji 6-bitowej, ogranicza pamięć obliczeniową Metal do 5 GiB i podręczną do 64 MiB, sprawdza zapas pamięci przed załadowaniem i nie przełącza się na pełny model ani inny silnik. Próbki generuje pojedynczo. Rozpoznawanie i syntezę podczas kontroli uruchamiamy kolejno.

Stała obróbka obejmuje głośność -20 LUFS z limitem szczytu -1 dBFS, marginesy ciszy oraz PCM16 mono 16 kHz. Odtworzenie tych samych zapisanych źródeł jest identyczne bajtowo; nowa synteza na innym sprzęcie może różnić się numerycznie. Brak źródła bez `--generate`, niezgodna suma lub wersja zatrzymują przebieg. Starszy ukończony bank można odtworzyć bez modelu, wskazując jego manifest przez `--standard` i osobny katalog przez `--output`.

## Tryb głosowy i jego granice

- Wszystkie 32 odsłuchy i 64 warianty wzorcowe generuje ten sam model **Higgs TTS 3 MLX 6-bit**, z jednym syntetycznym profilem i wspólnymi ustawieniami. Nie ma naturalnych fragmentów ani wyjątków dla uxolo. Każda fraza ma główne nagranie oraz dwa warianty tempa do dopasowania mowy. Wersja, ustawienia, pochodzenie i SHA-256 każdego pliku są w `public/audio/provenance.json`. Pełna licencja Boson Higgs TTS 3 jest obok nagrań. `scripts/generate-audio.py` jest teraz zgodnym punktem wejścia do tego samego generatora; nie odtwarza starszej mieszanej metody.
- Mikrofon korzysta z `getUserMedia` i prawdziwego `MediaRecorder`. Przeglądarka dekoduje nagranie i przelicza je na WAV mono PCM 16 bit / 16 kHz. Można również przesłać nagranie z pliku.
- Lokalny model **OpenVoiceOS / misterkissi-w2v2-lg-xls-r-300m-xhosa-onnx** analizuje audio. Zwykła transkrypcja krótkich słów Xhosa jest zawodna, dlatego używamy także **porównania fonetycznych rozkładów CTC ze wszystkimi 32 zwrotami przez dynamic time warping**. Dla każdego zwrotu porównujemy trzy warianty i wybieramy najbliższy. Ranking obejmuje różne zwroty, dzięki czemu dwa warianty tego samego zwrotu nie konkurują ze sobą o przewagę. Wzorzec wybierany jest niezależnie od oczekiwanej odpowiedzi. Wymagamy dostatecznego podobieństwa i przewagi nad drugim zwrotem. Pełna zgodna transkrypcja z wysoką pewnością także zalicza wypowiedź.
- Wynik jest **orientacyjną oceną zgodności i podobieństwa dźwięków**. Nie jest zwalidowaną oceną fonemów, akcentu, tonów ani poprawności każdego mlasku. Nie zastępuje konsultacji z nauczycielem/native speakerem. Wersja jest prototypem; przed użyciem jako źródło normatywnej wymowy potrzebna jest walidacja lektorska i badanie na nagraniach różnych osób.
- Automatyczne testy dodatnie korzystają z odrębnie wygenerowanych całych wypowiedzi (ziarno 2026; główne wzorce 1337). Dodatkowe wzorce 7331 i 7332 to warianty tempa tej samej syntezy. Test sprawdza pochodzenie wszystkich plików z jednego modelu i profilu oraz odrębność źródeł testowych. Nie zastępuje to oceny fonetycznej przez lektora. Test mikrofonu podaje plik do rzeczywistego MediaStream tworzonego przez Web Audio. To prawdziwy przepływ MediaRecorder i analizy, ale nie badanie skuteczności na ludzkich akcentach. Natywny wirtualny mikrofon Chromium na tym środowisku macOS zawieszał się również poza aplikacją; deterministyczny strumień Web Audio jest świadomym adapterem testowym. Zgoda systemowa i fizyczny mikrofon wymagają osobnej próby użytkownika.
- Cisza, inne zwroty, zamienione formy tata/mama, błędy serwera i odmowa mikrofonu nie zaliczają ćwiczenia.
- Audio ucznia jest przetwarzane w pamięci i nie jest zapisywane na dysku ani wysyłane do zewnętrznego API. Mikrofon zamyka wszystkie ścieżki po zatrzymaniu, błędzie lub opuszczeniu ćwiczenia. Limit nagrywania: 11 s; wejścia analizy: 0,35–12 s.

Mikrofon działa na `localhost` lub przez HTTPS. Dostęp z fizycznego telefonu wymaga poprawnego HTTPS oraz świadomego udostępnienia serwera; domyślnie nasłuchuje on tylko na interfejsie 127.0.0.1.

## Testy

```sh
mise exec -- npx playwright install chromium
mise run test
# osobno:
mise exec -- npm test
mise exec -- npm run build
mise exec -- npm run test:voice
mise exec -- npm run test:e2e
```

Przed wymianą banku ręczna próba API na czterech naturalnych nagraniach UNISA (Molo, Molweni, Hamba kakuhle, Sala kakuhle) dała cztery poprawne rozpoznania. Nie stanowi to pełnej walidacji lektorskiej wszystkich wzorców.

Playwright sprawdza desktop Chromium i mobilny Chromium 390×844. Pełny przebieg kończy wszystkie pięć lekcji przez rzeczywisty odsłuch i analizę audio oraz test modułu, następnie sprawdza XP i zapis po przeładowaniu. Obejmuje też zachowanie starego postępu, kolejne blokady, brak dodatkowych XP przy powtarzaniu, pomijanie po trzech próbach w każdej lekcji, słowniczek i filtry pięciu lekcji, wolniejszy odsłuch, błędne odpowiedzi, pauzę/wznowienie, ustawienia, dialogi, responsywność 320–1440 px, dostępność, mikrofon, zwalnianie ścieżek audio, ciszę, mylone formy wieku i liczby oraz błędy. Test modułu ma osobne sprawdzenia wyniku 9/12 i progu 10/12, ponawiania, zapisu, błędu zapisu, wyjścia w trakcie i resetu. Testy jednostkowe weryfikują spójność modułu, komplet i odrębność nagrań wzorcowych i testowych, zależności lekcji oraz punktację testu.

Przed testami przeglądarkowymi `test:all` uruchamia też `test:voice`: rzeczywisty model analizuje niezależne nagranie każdego z 32 zwrotów. Sprawdzamy **wszystkie 32 × 32 pary nagranie–oczekiwany zwrot**: każde nagranie ma zaliczać wyłącznie własne zadanie. Osobno cisza i niepowiązana wypowiedź muszą zostać odrzucone dla każdego zwrotu. Silna transkrypcja pełnego znanego zwrotu ma pierwszeństwo przed dopasowaniem akustycznym, co zapobiega np. zaliczeniu „Hamba kakuhle” w zadaniu wymagającym „Hambani kakuhle”.

Raport HTML: `playwright-report/index.html`. Wyniki maszynowe: `test-results/results.json`. Ślady i zrzuty błędów: `test-results/`. Testy uruchamiają własny serwer, jeśli żaden nie działa. Pracują pojedynczo ze względu na model i deterministyczne ograniczenie równoległej analizy.

## Struktura

- `src/course.json` — dane lekcji, polskie znaczenia, kontekst i wskazówki;
- `src/modules.json`, `src/lib/course.ts` — skład pierwszego modułu, źródła, scenariusze testowe, odblokowanie lekcji i punktacja;
- `src/ModuleTest.tsx` — test sytuacyjny z wyjaśnieniami i podsumowaniem;
- `src/App.tsx`, `src/styles.css` — interfejs i kroki ćwiczeń;
- `src/lib/audio.ts` — nagrywanie, konwersja i sprzątanie mikrofonu;
- `src/lib/progress.ts` — zapis postępu i seria dni;
- `server/speech.mjs`, `server/acoustic.mjs` — model, analiza i dopasowanie dźwięków;
- `server/index.mjs` — API i udostępnianie aplikacji;
- `scripts/setup-voice.mjs`, `scripts/generate-audio.py` — powtarzalne przygotowanie głosu;
- `tests/` — testy oraz próbki audio.

Produkcja lokalna: `mise exec -- npm run build`, potem `mise exec -- npm start`. Nie wystarczy statyczny hosting samego `dist/`: ocena mowy wymaga serwera Node i modelu ONNX (około 1,3 GB na dysku, kilka GB RAM).

## Źródła i licencje

- Treść i kontekst: [University of South Africa — Greetings and Courtesies](https://www.unisa.ac.za/static/corporate_web/Content/UnisaOpen/freeOnlineCourse/Xhosa/Xhosa1.html). Polskie objaśnienia opracowano dla tego kursu.
- Nowe zwroty: [UNISA — Greetings and Courtesies, PDF](https://www.unisa.ac.za/static/corporate_web/Content/UnisaOpen/freeOnlineCourse/PDF/Xhosa/Learn%20online%20Xhosa%20-%20Theme%201.pdf), [UNISA — Asking for Help](https://www.unisa.ac.za/static/corporate_web/Content/UnisaOpen/freeOnlineCourse/Xhosa/Xhosa2.html), [IsiXhosa.click — cela](https://isixhosa.click/word/1407). Sytuacje i polskie wyjaśnienia przygotowano dla tego modułu.
- Wzorce mowy i generator: [Boson Higgs TTS 3](https://huggingface.co/bosonai/higgs-tts-3-4b), [wersja MLX 6-bitowa](https://huggingface.co/whitelabel/mlx-q6-higgs-tts-3-4b), licencja Boson Higgs TTS 3 Research and Non-Commercial License; [MLX Audio](https://github.com/Blaizzy/mlx-audio), MIT. Syntetyczny profil i pełny tekst licencji są w `scripts/audio-sources/higgs/`. Poprzednia próba [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice) używa osobnej licencji CC-BY-NC według karty modelu i syntetycznego profilu `scripts/audio-sources/omnivoice/voice.json`.
- ASR: [OpenVoiceOS/misterkissi-w2v2-lg-xls-r-300m-xhosa-onnx](https://huggingface.co/OpenVoiceOS/misterkissi-w2v2-lg-xls-r-300m-xhosa-onnx), Emmanuel Kissi / OpenVoiceOS, **CC BY-NC-SA 4.0**, z ograniczeniem użycia komercyjnego. Model nie jest częścią repozytorium.
- Ikony: Lucide (ISC). Fonty: DM Sans i Manrope, pakiety Fontsource (SIL OFL 1.1).
