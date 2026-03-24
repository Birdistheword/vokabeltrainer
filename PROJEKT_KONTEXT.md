# Vokabeltrainer – Projektkontext für Claude Code

## Was ist das?
Eine Single-File Web-App (`vokabeltrainer.html`) für Deutsch-Englisch Vokabeltraining mit Spaced Repetition System (SRS), ähnlich wie Anki. Gebaut für Deutschlehrer und ihre Schüler.

## Tech Stack
- **Frontend:** Reines HTML/CSS/JS — alles in einer einzigen Datei (`vokabeltrainer.html`)
- **Backend/DB:** Supabase (Postgres + Auth + RLS)
- **Hosting:** Netlify (auto-deploy via GitHub)
- **Fonts:** Nunito + Lora (Google Fonts)

## Supabase Zugangsdaten
```js
const SUPABASE_URL = 'https://caaujaknoenoswrxaqpa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_7VrFnwHgcKDWAZU6ONnvrw_6Yx3neGM';
```
→ Diese immer in der HTML-Datei drin lassen.

## Datenbank Schema (Supabase)

### Tabellen:
- **profiles** — Nutzerprofile (id, email, full_name, is_admin, teacher_id)
  - `is_admin = true` → Admin/Lehrer
  - `teacher_id` → UUID des zugewiesenen Lehrers (für Schüler)
- **vocabulary** — Vokabeln (id, level, chapter, german, english)
- **unlocked_chapters** — Freigeschaltete Kapitel pro Schüler (student_id, level, chapter)
- **srs_progress** — Lernfortschritt pro Vokabel pro Schüler (student_id, vocabulary_id, next_review, interval_minutes, ease, review_count)
- **learning_sessions** — Lerneinheiten (student_id, started_at, ended_at, cards_reviewed, correct_count, wrong_count)
- **reviews** — Einzelne Bewertungen (student_id, vocabulary_id, session_id, rating, direction)

## SRS Logik (Spaced Repetition)
Schüler bewertet jede Karte auf 4 Stufen:
| Bewertung | Intervall |
|-----------|-----------|
| 😕 Schlecht | 1 Minute |
| 😐 Okay | 5 Minuten |
| 🙂 Gut | 2 Stunden |
| 😄 Sehr gut | 3 Tage |

- Max. **10 neue Vokabeln** pro Lerntag
- Karten mit Rating 1-2 kommen in eine `pendingQueue` und tauchen nach Timer wieder auf
- Karten mit Rating 3-4 kommen erst nach dem Intervall wieder

## App-Struktur (Views)

### Login-Seite
- Anmelden / Registrieren Tabs
- Bei Registrierung: Dropdown "Mein Lehrer" (lädt alle Admin-Profile aus DB)

### Schüler-Ansicht
- **Lernen-Tab:** Flashcard-Session mit Flip-Animation, Fortschrittsbalken, Rating-Buttons
- **Kapitel-Tab:** Übersicht freigeschalteter Kapitel nach Level (A1, A2 etc.)

### Admin-Ansicht
- **Schüler-Tab:** Liste eigener Schüler (gefiltert nach teacher_id), Kapitel freischalten per Modal, Statistiken anzeigen
- **Vokabeln-Tab:** CSV-Import (Format: `kapitel,deutsch,englisch`), Übersicht vorhandener Kapitel

## Multi-Lehrer System
- Jeder Admin sieht nur seine eigenen Schüler (`teacher_id = auth.uid()`)
- Schüler wählen beim Registrieren ihren Lehrer aus Dropdown
- Aktuell 2 Admins: **Riccardo** und **Ben** (Ben muss noch per SQL zum Admin gemacht werden)
- Gemeinsamer Vokabelpool für alle Admins

## Bekannte offene Punkte
- Ben's Admin-Account muss noch angelegt werden:
  `UPDATE public.profiles SET is_admin = true WHERE email = 'bens@email.de';`
- RLS Policy für anonyme Lehrer-Abfrage beim Registrieren:
  `CREATE POLICY "Admins öffentlich lesbar" ON public.profiles FOR SELECT USING (is_admin = true);`
  (Damit das Lehrer-Dropdown auch ohne Login funktioniert)

## Design
- Helles, freundliches E-Learning Theme
- Farben: Blau-Indigo `#4f6ef7` als Akzent, `#f5f7ff` Hintergrund
- Fonts: Nunito (UI) + Lora (Vokabelkarten)
- Weiche Schatten, runde Ecken, hover-Animationen

## Workflow
1. Änderungen an `vokabeltrainer.html` vornehmen
2. Git commit & push zu GitHub
3. Netlify deployed automatisch (ca. 30 Sekunden)
