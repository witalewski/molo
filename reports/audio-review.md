# Bezpłatny generator i audyt nagrań

Stan: 21 października 2026, po wznowieniu o 02:12 czasu polskiego. **Bank Higgs został wdrożony 21 października 2026 po decyzji użytkownika o zaakceptowaniu opisanych rozbieżności.** Poprzednie pliki audio i próbki testowe zachowano w kopii wskazanej przez `models/audio-backups/latest.json`.

## Wynik

Przygotowano kompletny, jednolity bank **Higgs TTS 3 MLX 6-bit** w `models/higgs-mlx-candidate/`: 32 odsłuchy, 64 warianty tempa, 32 niezależne próbki testowe, wypowiedź negatywna i cisza — 130 WAV-ów. Jeden stały syntetyczny głos, całe wypowiedzi i wspólne ustawienia dla wszystkich zwrotów. Nie ma wyjątków, sklejania słów, ludzkich nagrań ani płatnej usługi.

Pełny test integracji banku: **1024 pary zwrot–próbka i 32 próby niepowiązanej mowy, zero błędów**. Każda z 32 osobno wygenerowanych próbek została zaakceptowana wyłącznie dla swojego zwrotu. Cisza jest zerowa. [Wynik integracji](audio-higgs-mlx-recognition-check.json).

Kontrola surowej transkrypcji: **16/32 nagrań głównych i 63/128 wszystkich próbek** zgodnych po pominięciu spacji i interpunkcji; wszystkie 128 plików zawierają sygnał bez przesterowania. Poprzednia próba OmniVoice: 22/32 i 88/128. Poprzedni bank lekcji: 2/32 i 12/128. To różne kryterium od zaliczania przez porównanie akustyczne: rozpoznawanie nie dostaje tutaj oczekiwanego zwrotu. [Surowy audyt](audio-higgs-mlx-audit.json), [poprzedni bank](audio-baseline.json).

**Nie potwierdzono docelowej jakości fonetycznej.** Higgs poprawił przesiewowy odczyt x w obu głównych uxolo i q w andiqondi, lecz nadal są rozbieżności, m.in. tata → ta da, enkosi → inkosi, ndicela → nditsela, a w osobnej próbce testowej także uxolo → ucolo i andiqondi → andikondi. Modyfikacja tempa tej samej próbki uxolo-tata zmienia odczyt ASR x/c, więc sam transkrypt nie rozstrzyga poprawności mlasku. Nie traktowano zgodności tekstu ani dopasowania do własnych wzorców jako walidacji fonetycznej. Użytkownik porównał zestawy i wybrał wdrożenie mimo tych rozbieżności. Nie zmienia to statusu walidacji fonetycznej; pole `humanPhoneticReview` pozostaje `false`.

| Zwrot | Surowa transkrypcja Higgs MLX | Zgodność tekstu |
| --- | --- | --- |
| Molo! | molo | zgodny |
| Molweni! | mulwini | do odsłuchu |
| Molo, tata! | molo ta da | do odsłuchu |
| Molo, mama! | mo lo mama | zgodny |
| Hamba kakuhle! | hamba kaku hle | zgodny |
| Sala kakuhle! | sala ka kuhle | zgodny |
| Enkosi! | inkosi | do odsłuchu |
| Enkosi kakhulu! | enkosi kakhulu | zgodny |
| Enkosi, tata! | enkosi da da | do odsłuchu |
| Enkosi, mama! | enkosimama | zgodny |
| Uxolo, tata! | uxolo ta da | do odsłuchu |
| Uxolo, mama! | uxolo mama | zgodny |
| Unjani? | unjani | zgodny |
| Ndiphilile, enkosi. | ndiphilile inkosi | do odsłuchu |
| Wena unjani? | we na unjani | zgodny |
| Nam ndiphilile. | nam ndiphilile | zgodny |
| Ninjani? | ninjani | zgodny |
| Siphilile, enkosi. | sifilile inkosi | do odsłuchu |
| Ndicela amanzi. | nditsela amanzi | do odsłuchu |
| Ndicela undincede. | ndicsele undi ncede | do odsłuchu |
| Andiqondi. | andiqondi | zgodny |
| Ndicela uphinde. | ndi csela uphinde | do odsłuchu |
| Ndicela uthethe ungangxami. | ndicsela uthethe ungangame | do odsłuchu |
| Nam ndiyabulela. | nam ndiya bulela | zgodny |
| Molo, bhuti! | malo bhudi | do odsłuchu |
| Molo, sisi! | molo si si | zgodny |
| Molo, tat’omkhulu! | mulo thath omkhulu | do odsłuchu |
| Molo, makhulu! | mulo makhu lu | do odsłuchu |
| Hambani kakuhle! | hambani kakuhle | zgodny |
| Salani kakuhle! | salani kakuhle | zgodny |
| Ulale kamnandi! | ulale kha mnandi | do odsłuchu |
| Hayi, enkosi. | hayi inkosi | do odsłuchu |

## Bezpieczeństwo zasobów i odtwarzalność

- Wyłączono pełny model 4B na MPS. Generator obsługuje wyłącznie przypiętą wersję `whitelabel/mlx-q6-higgs-tts-3-4b@7a91348cfaf6847e3969c00348b09d2c5fc36c06`; wagi i kodek są sprawdzane przez SHA-256 po kawałku, bez wczytywania całego pliku do RAM.
- Limit Metal: 5 GiB; podręczna: 64 MiB. Przed ładowaniem sprawdzany jest zapas co najmniej 6 GiB i 35% pamięci, a między wypowiedziami ponownie kontrolowany jest zapas systemu. Nieczytelny wynik pomiaru lub niebezpieczne ustawienia zatrzymują generowanie. Nie ma automatycznej zmiany silnika ani zwiększania limitu.
- Pełny przebieg osiągnął **4.55 GB szczytowej pamięci Metal**. To pomiar obliczeniowy MLX, nie całkowity RAM wszystkich procesów. Syntezę i rozpoznawanie uruchomiono kolejno.
- Zależności MLX/TTS są przypięte w `pyproject.toml`, `uv.lock` i standardzie. Duże biblioteki Torch i OmniVoice usunięto z domyślnego środowiska.
- Jeden syntetyczny profil `scripts/audio-sources/higgs/voice.json`, źródłowy WAV i sumy SHA-256. Model, profil i wersje zależności są w manifeście każdego banku.
- Wspólne ustawienia: neutralne tempo modelu, temperatura 0,7, top-p 0,95, top-k 50, maks. 180 tokenów. Znacznik wymuszonego spowolnienia pogarszał odczyt uxolo i został usunięty dla **wszystkich** zwrotów. Ziarno główne 1337, niezależne testy 2026.
- Dodatkowe wzorce 0,96× i 1,04× są przekształceniem tego samego źródła, nie nową syntezą. Ich identyfikatory 7331 i 7332 są historycznymi nazwami plików.
- Stała obróbka: -20 LUFS z limitem szczytu -1 dBFS, stałe pauzy, PCM16 mono 16 kHz. Źródłowe WAV-y są niezmienne i sprawdzane przez sumy.
- Odtworzenie offline zachowało bajtowo wszystkie 128 audytowanych WAV-ów; zweryfikowano sumy wszystkich 129 wypowiedzi w manifeście. Ponowna synteza na innym sprzęcie może różnić się numerycznie.
- Generator zapisuje tylko do osobnego katalogu i publikuje manifest dopiero po ukończeniu banku. Domyślne przygotowanie ASR zachowuje nagrania lekcji.

## Dodatkowe porównania po restarcie

Próba 7 zwrotów z poprzednim znacznikiem wolnego tempa zajęła do 4,37 GB Metal, ale oba uxolo dostały odczyt k. Cztery wspólne ustawienia sprawdzono na uxolo-tata, uxolo-mama, ndicela-amanzi i andiqondi. Wariant bez znacznika tempa poprawił odczyt x w obu uxolo i został zastosowany do całego banku. Zachłanne próbkowanie powodowało w jednej krótkiej wypowiedzi przeciągnięcie do limitu długości i zostało odrzucone. Nie dobierano osobnych ustawień dla poszczególnych nagrań.

Sprawdzono też drugi stały profil, syntetycznie utworzony przez OmniVoice, na 10 zwrotach. Ponownie pogorszył uxolo (ukasolo/ukholo) i andiqondi; nie wykorzystano go w banku Higgs. Eksperymenty pozostają w ignorowanym `models/higgs-mlx-trial/`.

## Przeprowadzone porównania

- Simba z domyślnymi ustawieniami, ograniczeniem losowości i zmianą tokenu pustego: zmiany nie rozwiązały problemu. Nie zastosowano podejrzanej zamiany h na _ w aplikacji.
- Sunbird Orpheus: wersje MLX 4 i 8 bitów nadal dawały rozbieżności w krótkich próbkach.
- OmniVoice: poprawienie tekstu profilu głosu wyeliminowało dokańczanie nieistniejącej części referencji. Mieszane partie różnych długości na MPS degradowały krótkie wypowiedzi; wybrano pojedyncze generowanie z osobnym ziarnem dla każdej całej frazy.
- Dwa warianty głosu z korpusu OpenSLR 32 nie rozwiązały rozbieżności w mlaskach. Żadna próbka tego korpusu nie została użyta w gotowym banku.
- Seria ziaren dla uxolo dała pojedyncze lepsze odczyty, ale nie rozwiązała obu zwrotów konsekwentnie. Nie podmieniano po cichu pojedynczych próbek.
- Higgs TTS 3 w pełnej precyzji przeciążył 16 GB RAM i został wyłączony. Po restarcie użyto wyłącznie wersji MLX 6-bitowej z ograniczeniem zasobów.


## Weryfikacja

Sześć testów generatora przeszło: kompletność 130 plików, odtwarzalność bajtowa, SHA-256, jeden profil, osobne źródło testowe, brak ukrytej syntezy, odrzucanie uszkodzeń, blokada zapisu do aplikacji oraz odrzucanie niebezpiecznych limitów i zbyt małego zapasu pamięci. Po wdrożeniu przeszły także: 26 testów jednostkowych aplikacji, 2 testy całego korpusu mowy (1024 pary zwrot–nagranie oraz próby negatywne), kompilacja i wszystkie 64 testy przeglądarkowe na komputerze oraz widoku telefonu, obejmujące odsłuch, mikrofon i ukończenie pięciu lekcji. Sprawdzono sumy wszystkich 96 wzorców w gotowej aplikacji oraz 64 odpowiedzi porównywarki (kopia poprzedniego i nowy zestaw). Testy te nie stanowią oceny fonetycznej przez lektora.

Źródła: [Higgs TTS 3](https://huggingface.co/bosonai/higgs-tts-3-4b), [konwersja MLX 6-bit](https://huggingface.co/whitelabel/mlx-q6-higgs-tts-3-4b), [MLX Audio](https://github.com/Blaizzy/mlx-audio), [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice), [OpenSLR 32](https://www.openslr.org/32/).
