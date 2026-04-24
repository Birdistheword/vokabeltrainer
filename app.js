  // HIER DEINE SUPABASE ZUGANGSDATEN EINTRAGEN:
  const SUPABASE_URL = 'https://caaujaknoenoswrxaqpa.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_7VrFnwHgcKDWAZU6ONnvrw_6Yx3neGM';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== STATE ==========
let state = {
  user: null,
  profile: null,
  view: 'login',        // login | set-password | student | admin
  adminTab: 'students', // students | vocab | stats
  studentTab: 'learn',  // learn | chapters
  selectedLevel: null,
  selectedChapter: null,
  // Dashboard
  dashboard: null,
  // Flashcard session
  session: null,
  currentCard: null,
  direction: 'en_de',
  showBack: false,
  waitingUntil: null,
  sessionActive: false,
  // Admin
  students: [],
  teachers: [],
  vocabulary: [],
  vocabLevels: [],
  selectedStudent: null,
  unlockedForStudent: [],
  allChaptersByLevel: {},
  // Vocab detail
  viewingVocab: null,
  // Vocab list
  learnedVocab: [],
  // Progress page
  progressData: null,
  // Stats
  statsStudent: null,
  statsData: null,
  // Module system
  activeModule: 'vocab',  // vocab | homework | lessons
  // Lessons
  lessonsData: [],
  lessonStudent: null,
  activeLesson: null,
  lessonNotifications: [],
  lessonSidebar: null,
  blueprints: [],
  blueprintPickerOpen: false,
  // Homework
  hwAssignments: [],
  hwActive: null,
  hwCreating: false,
  hwCreateStudent: null,
  hwCreateNotes: '',
  hwGenerating: false,
  hwPreview: null,
  hwViewResults: null,
  hwResults: null,
  hwStudentView: null,
  hwSubmissions: {},
  // Sentence generation
  sentenceGenProgress: null, // { done, total, status }
  // Personal vocab (student view)
  personalVocab: [],
  // Exercise state (per-card, reset on each new card)
  exState: null,
};

// ========== INTERVALS (Minuten) ==========
const RATING_INTERVALS = { 1: 1, 2: 5, 3: 120, 4: 4320 }; // 4320 = 3 Tage
const RATING_LABELS = {
  1: { label: 'Kenne ich nicht' },
  2: { label: 'Ich kann mich kaum erinnern' },
  3: { label: 'Ich kann mich schnell erinnern' },
  4: { label: 'Ich kann mich sofort erinnern' }
};
const NEW_PER_DAY = 10;

// ========== UTILS ==========
function el(id) { return document.getElementById(id); }
function isSuperAdmin() { return state.user?.email === 'riccardo@flow-heroes.com'; }
function pwField(inputId, placeholder) {
  return `
    <div class="pw-wrap">
      <input type="password" id="${inputId}" placeholder="${placeholder}" class="pw-input"
        onkeydown="if(event.key==='Enter') event.target.closest('form,div')?.querySelector('.btn-primary')?.click()">
      <button type="button" class="pw-eye" data-visible="false"
        onclick="window.togglePwVisibility('${inputId}',this)" tabindex="-1" aria-label="Passwort anzeigen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
          <line class="eye-slash" x1="2" y1="2" x2="22" y2="22"/>
        </svg>
      </button>
    </div>`;
}
function now() { return new Date(); }
function minutesFromNow(m) { return new Date(Date.now() + m * 60000); }
function animateReviewBtn() {
  const btn = document.getElementById('btn-review');
  if (!btn) return;

  const w = btn.offsetWidth;
  const h = btn.offsetHeight;
  const rx = 16;
  const perimeter = 2 * (w + h - 4 * rx) + 2 * Math.PI * rx;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.style.cssText = `position:absolute;inset:-2px;width:${w+4}px;height:${h+4}px;pointer-events:none;z-index:10;overflow:visible`;

  const rect = document.createElementNS(svgNS, 'rect');
  rect.setAttribute('x', '2'); rect.setAttribute('y', '2');
  rect.setAttribute('width', w); rect.setAttribute('height', h);
  rect.setAttribute('rx', rx); rect.setAttribute('ry', rx);
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#22c06b');
  rect.setAttribute('stroke-width', '3');
  rect.setAttribute('stroke-dasharray', perimeter);
  rect.setAttribute('stroke-dashoffset', perimeter);
  svg.appendChild(rect);

  btn.style.position = 'relative';
  btn.appendChild(svg);

  // Border läuft einmal rum (600ms) dann fade out
  const duration = 650;
  let start = null;
  (function animate(ts) {
    if (!start) start = ts;
    const p = Math.min((ts - start) / duration, 1);
    rect.setAttribute('stroke-dashoffset', perimeter * (1 - p));
    if (p < 1) { requestAnimationFrame(animate); }
    else { svg.style.transition = 'opacity 0.3s'; svg.style.opacity = '0'; setTimeout(() => svg.remove(), 300); }
  })(performance.now());

  // Kurze Scale-Animation
  btn.style.transition = 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1)';
  btn.style.transform = 'scale(1.05)';
  setTimeout(() => { btn.style.transform = ''; }, 200);
}

function showToast(msg, type = '') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const icons = { success: '✓', error: '✕', '': 'ℹ' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type] ?? 'ℹ'}</span><span>${msg}</span>`;
  wrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 200);
  }, 3200);
}
function render() { document.getElementById('app').innerHTML = buildApp(); attachEvents(); }

// ========== AUTH ==========
async function init() {
  const isInviteLink = window.location.hash.includes('type=invite');
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    if (isInviteLink) {
      state.user = session.user;
      state.view = 'set-password';
    } else {
      await loadProfile(session.user);
    }
  }
  render();
}

async function loadProfile(user) {
  state.user = user;
  // Use maybeSingle to avoid 406 errors, and bypass RLS by selecting only own row
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) console.error('Profile load error:', error);
  state.profile = data;
  state.view = data?.is_admin ? 'admin' : 'student';
}

async function login(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
  const { data: { user } } = await sb.auth.getUser();
  await loadProfile(user);
  render();
}

async function loadTeachers() {
  const { data } = await sb.from('profiles').select('id, full_name').eq('is_admin', true).order('full_name');
  state.teachers = data || [];
}


async function logout() {
  await sb.auth.signOut();
  state = { ...state, user: null, profile: null, view: 'login', session: null, currentCard: null };
  render();
}

// ========== STUDENT: CHAPTERS ==========
async function loadStudentChapters() {
  const { data: unlocked } = await sb.from('unlocked_chapters')
    .select('level, chapter')
    .eq('student_id', state.user.id);

  const { data: vocab } = await sb.from('vocabulary').select('level, chapter');

  // Gruppe nach level/chapter
  const chapters = {};
  vocab?.forEach(v => {
    const key = `${v.level}||${v.chapter}`;
    if (!chapters[key]) chapters[key] = { level: v.level, chapter: v.chapter, count: 0 };
    chapters[key].count++;
  });

  const unlockedSet = new Set(unlocked?.map(u => `${u.level}||${u.chapter}`) || []);
  state.studentChapters = Object.values(chapters).map(c => ({
    ...c,
    unlocked: unlockedSet.has(`${c.level}||${c.chapter}`)
  }));
  state.studentLevels = [...new Set(Object.values(chapters).map(c => c.level))].sort();
  if (!state.selectedLevel && state.studentLevels.length) {
    state.selectedLevel = state.studentLevels[0];
  }
}

// ========== STUDENT: VOCAB LIST ==========
async function loadLearnedVocab() {
  const [regularRes, personalRes] = await Promise.all([
    sb.from('srs_progress')
      .select('*, vocabulary(german, english, level, chapter)')
      .eq('student_id', state.user.id)
      .order('ease', { ascending: true }),
    sb.from('personal_vocab')
      .select('*')
      .eq('student_id', state.user.id)
      .order('created_at', { ascending: false }),
  ]);
  state.learnedVocab = (regularRes.data || []).filter(p => p.vocabulary);

  const pvData = personalRes.data || [];
  if (pvData.length) {
    const pvIds = pvData.map(v => v.id);
    const { data: srsData } = await sb.from('srs_progress')
      .select('personal_vocab_id, next_review, ease, review_count')
      .eq('student_id', state.user.id)
      .in('personal_vocab_id', pvIds);
    const srsMap = {};
    (srsData || []).forEach(s => { srsMap[s.personal_vocab_id] = s; });
    state.personalVocab = pvData.map(v => ({ ...v, srs: srsMap[v.id] || null }));
  } else {
    state.personalVocab = [];
  }
}

// ========== STUDENT: PROGRESS ==========
async function loadProgressData() {
  await loadStudentChapters();

  const { data: sessions } = await sb.from('learning_sessions')
    .select('started_at')
    .eq('student_id', state.user.id)
    .not('ended_at', 'is', null);

  const badgeCount = new Set(
    (sessions || []).map(s => new Date(s.started_at).toISOString().split('T')[0])
  ).size;

  const { data: srsData } = await sb.from('srs_progress')
    .select('vocabulary(level, chapter)')
    .eq('student_id', state.user.id);

  const learnedByChapter = {};
  (srsData || []).forEach(p => {
    if (p.vocabulary) {
      const key = `${p.vocabulary.level}||${p.vocabulary.chapter}`;
      learnedByChapter[key] = (learnedByChapter[key] || 0) + 1;
    }
  });

  state.progressData = { badgeCount, learnedByChapter };
  render();
}

// ========== STUDENT: DASHBOARD ==========
async function loadDashboard() {
  try {
    const { data: unlocked } = await sb.from('unlocked_chapters').select('level, chapter').eq('student_id', state.user.id);
    if (!unlocked?.length) { state.dashboard = { dueCount: 0, newAvailable: 0, totalLearned: 0 }; render(); return; }

    const unlockedSet = new Set(unlocked.map(u => `${u.level}||${u.chapter}`));
    const { data: allVocab } = await sb.from('vocabulary').select('id, level, chapter');
    const vocab = (allVocab || []).filter(v => unlockedSet.has(`${v.level}||${v.chapter}`));
    const vocabIds = new Set(vocab.map(v => v.id));

    // Alle Progress-Rows laden (Student hat nur eigene)
    const { data: progress } = await sb.from('srs_progress')
      .select('vocabulary_id, next_review, first_seen_at')
      .eq('student_id', state.user.id);

    const progressMap = {};
    (progress || []).forEach(p => { progressMap[p.vocabulary_id] = p; });

    // Nur Vocab aus freigeschalteten Kapiteln betrachten
    const myVocabProgress = (progress || []).filter(p => vocabIds.has(p.vocabulary_id));
    const progressSet = new Set(myVocabProgress.map(p => p.vocabulary_id));
    const dueCount = myVocabProgress.filter(p => new Date(p.next_review) <= Date.now() + 15 * 60 * 1000).length;

    // Neue heute: UTC-Tagesdatum aus gespeicherten first_seen_at ermitteln
    // → timezone-unabhängig, konsistent mit startSession
    const todayUTC = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
    const newTodayCount = (progress || []).filter(p =>
      p.first_seen_at && new Date(p.first_seen_at).toISOString().startsWith(todayUTC)
    ).length;

    const remainingNew = Math.max(0, NEW_PER_DAY - newTodayCount);
    const newAvailable = Math.min(remainingNew, vocab.filter(v => !progressSet.has(v.id)).length);

    const { data: pvSrs } = await sb.from('srs_progress')
      .select('next_review').eq('student_id', state.user.id).not('personal_vocab_id', 'is', null);
    const personalDue = (pvSrs || []).filter(p => new Date(p.next_review) <= Date.now() + 15 * 60 * 1000).length;

    state.dashboard = { dueCount, newAvailable, totalLearned: progressSet.size, personalDue };
  } catch (e) {
    console.error('loadDashboard error:', e);
    state.dashboard = { dueCount: 0, newAvailable: 0, totalLearned: 0 };
  }
  render();
}

// ========== STUDENT: LEARNING SESSION ==========
// mode: 'new' | 'review'
async function startSession(mode) {
  state.studentTab = 'learn';
  state.sessionActive = true;
  state.showBack = false;
  state.waitingUntil = null;
  state.exState = null;

  const { data: unlocked } = await sb.from('unlocked_chapters')
    .select('level, chapter')
    .eq('student_id', state.user.id);

  if (!unlocked || unlocked.length === 0) {
    showToast('Noch keine Kapitel freigeschaltet.', 'error');
    state.sessionActive = false;
    render();
    return;
  }

  const unlockedSet = new Set(unlocked.map(u => `${u.level}||${u.chapter}`));
  const { data: allVocabData } = await sb.from('vocabulary').select('*');
  const vocab = (allVocabData || []).filter(v => unlockedSet.has(`${v.level}||${v.chapter}`));

  const { data: progress } = await sb.from('srs_progress')
    .select('*')
    .eq('student_id', state.user.id);

  const progressMap = {};
  (progress || []).forEach(p => { progressMap[p.vocabulary_id] = p; });

  const todayUTC = new Date().toISOString().split('T')[0];
  const newTodayCount = (progress || []).filter(p =>
    p.first_seen_at && new Date(p.first_seen_at).toISOString().startsWith(todayUTC)
  ).length;
  const remainingNew = Math.max(0, NEW_PER_DAY - newTodayCount);

  let cards = [];

  if (mode === 'new') {
    const newCards = vocab
      .filter(v => !progressMap[v.id])
      .map(v => ({ vocab: v, progress: null, exerciseType: 'flashcard' }));
    shuffle(newCards);
    cards = newCards.slice(0, remainingNew);

    if (cards.length === 0) {
      const msg = remainingNew === 0
        ? 'Du hast heute dein Limit von 10 neuen Wörtern erreicht!'
        : 'Keine neuen Vokabeln mehr – alle wurden bereits gelernt!';
      showToast(msg, 'success');
      state.sessionActive = false;
      render();
      return;
    }
  } else {
    // review: only due cards with mixed exercise types
    const EXERCISE_POOL = ['flashcard', 'multiple_choice', 'type_the_word', 'letter_unscramble', 'sentence_builder'];
    const dueCards = vocab
      .filter(v => {
        const p = progressMap[v.id];
        return p && new Date(p.next_review) <= Date.now() + 15 * 60 * 1000;
      })
      .map(v => {
        const available = EXERCISE_POOL.filter(t =>
          t !== 'sentence_builder' || !!v.example_sentence
        );
        const exerciseType = available[Math.floor(Math.random() * available.length)];
        return { vocab: v, progress: progressMap[v.id], exerciseType };
      });

    shuffle(dueCards);
    cards = dueCards;

    if (cards.length === 0) {
      showToast('Keine Karten fällig – komm später wieder!', 'success');
      state.sessionActive = false;
      render();
      return;
    }
  }

  const { data: sess, error: sessError } = await sb.from('learning_sessions')
    .insert({ student_id: state.user.id })
    .select().single();
  if (sessError) console.error('Session-Erstellung fehlgeschlagen:', sessError);

  state.session = {
    id: sess?.id || null,
    mode,
    activeQueue: cards,
    pendingQueue: [],
    reviewed: 0,
    correct: 0,
    wrong: 0,
    total: cards.length,
    allVocab: vocab,
    newToday: newTodayCount,
    remainingNew
  };

  state.currentCard = state.session.activeQueue.shift() || null;
  state.exState = initExState(state.currentCard);
  render();
}

async function startPersonalSession() {
  state.studentTab = 'learn';
  state.sessionActive = true;
  state.showBack = false;
  state.waitingUntil = null;
  state.exState = null;

  const { data: pvData } = await sb.from('personal_vocab').select('*').eq('student_id', state.user.id);
  if (!pvData?.length) {
    showToast('Noch keine eigenen Wörter vorhanden.', 'error');
    state.sessionActive = false; render(); return;
  }
  const pvIds = pvData.map(v => v.id);
  const { data: progress } = await sb.from('srs_progress')
    .select('*').eq('student_id', state.user.id).in('personal_vocab_id', pvIds);

  const srsMap = {};
  (progress || []).forEach(p => { srsMap[p.personal_vocab_id] = p; });

  const dueCards = pvData
    .filter(v => {
      const p = srsMap[v.id];
      return p && new Date(p.next_review) <= Date.now() + 15 * 60 * 1000;
    })
    .map(v => ({ vocab: v, progress: srsMap[v.id], exerciseType: 'flashcard', isPersonal: true }));

  shuffle(dueCards);
  if (dueCards.length === 0) {
    showToast('Keine eigenen Wörter fällig!', 'success');
    state.sessionActive = false; render(); return;
  }

  const { data: sess } = await sb.from('learning_sessions')
    .insert({ student_id: state.user.id }).select().single();

  state.session = {
    id: sess?.id || null,
    mode: 'personal',
    activeQueue: dueCards,
    pendingQueue: [],
    reviewed: 0, correct: 0, wrong: 0,
    total: dueCards.length,
    allVocab: pvData,
  };
  state.currentCard = state.session.activeQueue.shift();
  state.exState = initExState(state.currentCard);
  render();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function rateCard(rating) {
  if (!state.currentCard) return;
  const card = state.currentCard;
  const intervalMin = RATING_INTERVALS[rating];
  const nextReview = minutesFromNow(intervalMin);
  const vocabId = card.vocab.id;

  // Fortschritt speichern
  let srsError;
  if (card.isPersonal) {
    const updatedProgress = {
      next_review: nextReview.toISOString(),
      interval_minutes: intervalMin,
      ease: rating,
      review_count: (card.progress?.review_count || 0) + 1,
      last_seen_at: new Date().toISOString(),
    };
    const { error } = await sb.from('srs_progress')
      .update(updatedProgress)
      .eq('student_id', state.user.id)
      .eq('personal_vocab_id', card.vocab.id);
    srsError = error;
    if (!error) card.progress = { ...card.progress, ...updatedProgress };
  } else {
    const updatedProgress = {
      student_id: state.user.id,
      vocabulary_id: vocabId,
      next_review: nextReview.toISOString(),
      interval_minutes: intervalMin,
      ease: rating,
      review_count: (card.progress?.review_count || 0) + 1,
      first_seen_at: card.progress?.first_seen_at || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    };
    const { error } = await sb.from('srs_progress')
      .upsert(updatedProgress, { onConflict: 'student_id,vocabulary_id' });
    srsError = error;
    if (!error) card.progress = updatedProgress;
    if (!error) {
      await sb.from('reviews').insert({
        student_id: state.user.id,
        vocabulary_id: vocabId,
        session_id: state.session?.id || null,
        rating,
        direction: state.direction,
      });
    }
  }

  if (srsError) {
    showToast('Fehler beim Speichern — bitte nochmal versuchen.', 'error');
    return;
  }

  // Session-Statistik
  state.session.reviewed++;
  if (rating >= 3) state.session.correct++;
  else state.session.wrong++;

  // Wenn schlecht/okay: Karte später wieder einreihen
  if (rating <= 2) {
    state.session.pendingQueue.push({
      ...card, // card.progress ist bereits oben aktualisiert
      showAfter: nextReview
    });
  }

  // Nächste Karte bestimmen
  const rightNow = now();

  // Karten die jetzt oder in den nächsten 15 Min fällig sind sofort einreihen
  const bundleUntil = Date.now() + 15 * 60 * 1000;
  const readyPending = state.session.pendingQueue.filter(c => new Date(c.showAfter) <= bundleUntil);
  state.session.pendingQueue = state.session.pendingQueue.filter(c => new Date(c.showAfter) > bundleUntil);

  // Kombiniere aktive + fällige pending
  const available = [...state.session.activeQueue, ...readyPending];

  if (available.length > 0) {
    shuffle(available);
    state.currentCard = available.shift();
    state.session.activeQueue = available;
  } else if (state.session.pendingQueue.length > 0) {
    // Warte auf die nächste pending Karte
    const next = state.session.pendingQueue.reduce((a, b) =>
      new Date(a.showAfter) < new Date(b.showAfter) ? a : b
    );
    state.waitingUntil = new Date(next.showAfter);
    state.currentCard = null;
  } else {
    // Session fertig
    state.currentCard = null;
    state.waitingUntil = null;
    await sb.from('learning_sessions').update({
      ended_at: new Date().toISOString(),
      cards_reviewed: state.session.reviewed,
      correct_count: state.session.correct,
      wrong_count: state.session.wrong
    }).eq('id', state.session.id);
  }

  state.showBack = false;
  state.exState = initExState(state.currentCard);
  render();
}

// ========== ADMIN FUNCTIONS ==========
async function loadStudents() {
  const { data } = await sb.from('profiles')
    .select('*')
    .eq('is_admin', false)
    .eq('teacher_id', state.user.id)
    .order('created_at');
  state.students = data || [];
}

async function loadVocabMeta() {
  const { data } = await sb.from('vocabulary').select('level, chapter');
  const byLevel = {};
  data?.forEach(v => {
    if (!byLevel[v.level]) byLevel[v.level] = new Set();
    byLevel[v.level].add(v.chapter);
  });
  Object.keys(byLevel).forEach(l => {
    byLevel[l] = [...byLevel[l]].sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
    });
  });
  state.allChaptersByLevel = byLevel;
  state.vocabLevels = Object.keys(byLevel).sort();
}

async function loadUnlockedForStudent(studentId) {
  const { data } = await sb.from('unlocked_chapters')
    .select('*').eq('student_id', studentId);
  state.unlockedForStudent = data || [];
}

async function toggleChapterUnlock(studentId, level, chapter) {
  const exists = state.unlockedForStudent.find(u => u.level === level && u.chapter === chapter);
  if (exists) {
    await sb.from('unlocked_chapters').delete().eq('id', exists.id);
  } else {
    await sb.from('unlocked_chapters').insert({ student_id: studentId, level, chapter });
  }
  await loadUnlockedForStudent(studentId);
  render();
}

async function uploadCSV(file, level) {
  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());
  // CSV format: Kapitel,Kategorie,Deutsch,Englisch
  const rows = lines.slice(1).map(line => {
    const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    return { level, chapter: parts[0], german: parts[2], english: parts[3] };
  }).filter(r => r.chapter && r.german && r.english);

  const { error } = await sb.from('vocabulary').insert(rows);
  if (error) { showToast('Fehler beim Import: ' + error.message, 'error'); return; }
  showToast(`${rows.length} Vokabeln importiert!`, 'success');
  await loadVocabMeta();
  render();
}

async function loadStats(studentId) {
  state.statsStudent = state.students.find(s => s.id === studentId);

  const [sessions, reviews, progress] = await Promise.all([
    sb.from('learning_sessions').select('*').eq('student_id', studentId).order('started_at', { ascending: false }).limit(20),
    sb.from('reviews').select('*, vocabulary(id, german, english, level, chapter)').eq('student_id', studentId).order('created_at', { ascending: false }).limit(2000),
    sb.from('srs_progress').select('vocabulary_id, next_review, interval_minutes, ease, review_count').eq('student_id', studentId)
  ]);

  const rawSessions = (sessions.data || []).slice().sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  const reviewData = reviews.data || [];
  const progressData = progress.data || [];

  // Merge sessions that start within 60 min of the previous one ending/starting
  const sessionData = [];
  for (const sess of rawSessions) {
    const prev = sessionData[sessionData.length - 1];
    const prevEnd = prev ? new Date(prev._lastEnd || prev.started_at) : null;
    const gap = prev ? (new Date(sess.started_at) - prevEnd) : Infinity;
    if (prev && gap <= 60 * 60 * 1000) {
      // Merge into previous group
      prev.cards_reviewed = (prev.cards_reviewed || 0) + (sess.cards_reviewed || 0);
      prev.correct_count  = (prev.correct_count  || 0) + (sess.correct_count  || 0);
      prev.wrong_count    = (prev.wrong_count    || 0) + (sess.wrong_count    || 0);
      prev.ended_at = sess.ended_at || prev.ended_at;
      prev._lastEnd = sess.ended_at || sess.started_at;
    } else {
      sessionData.push({ ...sess, _lastEnd: sess.ended_at || sess.started_at });
    }
  }
  // Sort descending for display
  sessionData.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  // Build per-vocab aggregation (iterate chronologically = oldest first → history is oldest→newest)
  const vocabMap = {};
  [...reviewData].reverse().forEach(r => {
    const id = r.vocabulary_id;
    if (!vocabMap[id]) {
      vocabMap[id] = { vocab: r.vocabulary, count: 0, ratings: {1:0, 2:0, 3:0, 4:0}, history: [] };
    }
    vocabMap[id].count++;
    if (r.rating >= 1 && r.rating <= 4) vocabMap[id].ratings[r.rating]++;
    if (vocabMap[id].history.length < 8) vocabMap[id].history.push(r.rating);
  });

  const progressMap = {};
  progressData.forEach(p => { progressMap[p.vocabulary_id] = p; });

  const vocabStats = Object.entries(vocabMap)
    .map(([id, v]) => ({ ...v, progress: progressMap[id] || null }))
    .sort((a, b) => b.count - a.count);

  const totalReviewed = sessionData.reduce((s, r) => s + (r.cards_reviewed || 0), 0);
  const totalCorrect = sessionData.reduce((s, r) => s + (r.correct_count || 0), 0);
  const totalWrong = sessionData.reduce((s, r) => s + (r.wrong_count || 0), 0);
  const totalTime = sessionData.reduce((s, r) => {
    if (!r.ended_at) return s;
    return s + (new Date(r.ended_at) - new Date(r.started_at));
  }, 0);

  state.statsData = {
    sessions: sessionData,
    reviews: reviewData,
    vocabStats,
    totalReviewed, totalCorrect, totalWrong,
    totalTimeMin: Math.round(totalTime / 60000),
    accuracy: totalReviewed > 0 ? Math.round((totalCorrect / totalReviewed) * 100) : 0
  };
  render();
}

// ========== BUILD HTML ==========
const MODULES = [
  { id: 'vocab',      icon: '📚', label: 'Vokabeltrainer' },
  { id: 'homework',   icon: '📝', label: 'Hausaufgaben' },
  { id: 'lessons',    icon: '🗒️', label: 'Unterricht' },
  { id: 'superadmin', icon: '⚙️', label: 'Verwaltung' },
];

function buildApp() {
  if (state.view === 'login') return buildLogin();
  if (state.view === 'set-password') return buildSetPassword();

  const isAdmin = state.profile?.is_admin;

  // Context-sensitive sub-tabs (only shown for vocab module)
  let subTabs = '';
  if (state.activeModule === 'vocab') {
    if (isAdmin) {
      subTabs = `
        <button class="nav-tab ${state.adminTab === 'students' ? 'active' : ''}" onclick="switchAdminTab('students')">Schüler</button>
        <button class="nav-tab ${state.adminTab === 'vocab' ? 'active' : ''}" onclick="switchAdminTab('vocab')">Vokabeln</button>`;
    } else {
      subTabs = `
        <button class="nav-tab ${state.studentTab === 'learn' ? 'active' : ''}" onclick="switchStudentTab('learn')">Lernen</button>
        <button class="nav-tab ${state.studentTab === 'chapters' ? 'active' : ''}" onclick="switchStudentTab('chapters')">Fortschritt</button>
        <button class="nav-tab ${state.studentTab === 'vocab' ? 'active' : ''}" onclick="switchStudentTab('vocab')">Vokabeln</button>`;
    }
  }

  const bellBadge = isAdmin && state.lessonNotifications.length > 0
    ? `<span class="topbar-bell-badge">${state.lessonNotifications.length}</span>` : '';
  const bell = isAdmin ? `
    <button class="topbar-bell ${state.lessonNotifications.length > 0 ? 'has-notifications' : ''}"
      onclick="window.switchModule('lessons')" title="Benachrichtigungen">
      🔔${bellBadge}
    </button>` : '';

  const topbar = `
    <div class="topbar">
      <div class="topbar-logo">✦ <span>Lern</span>portal</div>
      <div class="topbar-right">
        ${bell}
        <span class="text-sm text-muted">${state.profile?.full_name || state.profile?.email || ''}</span>
        <button class="btn btn-ghost btn-sm" onclick="logout()">Abmelden</button>
      </div>
    </div>`;

  const visibleModules = MODULES.filter(m => m.id !== 'superadmin' || isSuperAdmin());
  const moduleBar = `
    <div class="module-bar">
      <div class="module-tabs">
        ${visibleModules.map(m => `
          <button class="module-tab ${state.activeModule === m.id ? 'active' : ''} ${m.comingSoon ? 'coming-soon' : ''}"
            onclick="switchModule('${m.id}')">
            ${m.icon} ${m.label}
            ${m.comingSoon ? '<span class="module-coming-badge">bald</span>' : ''}
          </button>`).join('')}
      </div>
      ${subTabs ? `<div class="nav-tabs">${subTabs}</div>` : ''}
    </div>`;

  const content = isAdmin ? buildAdmin() : buildStudent();
  const sidebar = state.lessonSidebar ? buildLessonSidebar() : '';
  return `${topbar}${moduleBar}<div class="main">${content}</div>${sidebar}`;
}

function buildLogin() {
  return `
  <div id="login-view">
    <div class="login-wrap">
      <div class="login-hero">
        <h1 class="login-hero-title">Vokabeln lernen,<br>die <em>wirklich</em> bleiben.</h1>
        <p class="login-hero-sub">Mit dem Spaced-Repetition-System lernst du Deutsch und Englisch so effizient wie möglich.</p>
        <div class="login-features">
          <div class="login-feature"><div class="login-feature-icon" style="background:#eef0ff">🧠</div> Intelligente Wiederholung</div>
          <div class="login-feature"><div class="login-feature-icon" style="background:#e8faf1">📊</div> Lernfortschritt verfolgen</div>
          <div class="login-feature"><div class="login-feature-icon" style="background:#fff4ec">🔁</div> DE ↔ EN in beide Richtungen</div>
        </div>
      </div>
      <div class="login-box">
        <h1 class="login-title">Willkommen 👋</h1>
        <p class="login-sub">Melde dich mit deinen Zugangsdaten an.</p>
        <div class="form-group">
          <label>E-Mail</label>
          <input type="email" id="login-email" placeholder="name@example.com"
            onkeydown="if(event.key==='Enter') document.getElementById('login-password')?.focus()">
        </div>
        <div class="form-group">
          <label>Passwort</label>
          ${pwField('login-password', '••••••••')}
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:4px" onclick="handleLogin()">Einloggen →</button>
      </div>
    </div>
  </div>`;
}

function buildSetPassword() {
  return `
  <div id="login-view">
    <div class="login-wrap">
      <div class="login-hero">
        <h1 class="login-hero-title">Konto einrichten</h1>
        <p class="login-hero-sub">Du wurdest eingeladen. Wähle ein Passwort, um dein Konto zu aktivieren.</p>
      </div>
      <div class="login-box">
        <h1 class="login-title">Passwort festlegen</h1>
        <p class="login-sub">Wähle ein sicheres Passwort für dein neues Konto.</p>
        <div class="form-group">
          <label>Name</label>
          <input type="text" id="set-pw-name" placeholder="Dein vollständiger Name">
        </div>
        <div class="form-group">
          <label>Passwort</label>
          ${pwField('set-pw-password', 'Mindestens 6 Zeichen')}
        </div>
        <div class="form-group">
          <label>Passwort bestätigen</label>
          ${pwField('set-pw-confirm', 'Passwort wiederholen')}
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:4px" onclick="handleSetPassword()">Konto aktivieren →</button>
      </div>
    </div>
  </div>`;
}

function buildSuperAdmin() {
  return `
    <h1 class="section-title">Verwaltung</h1>
    <p class="section-sub">Einladungen verschicken und Konten verwalten</p>
    <div class="card" style="max-width:480px">
      <h2 style="font-size:16px;font-weight:700;margin-bottom:16px">Neue Person einladen</h2>
      <div class="form-group">
        <label>E-Mail-Adresse</label>
        <input type="email" id="invite-email" placeholder="name@example.com">
      </div>
      <div class="form-group">
        <label>Rolle</label>
        <div style="display:flex;gap:12px;margin-top:4px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:500">
            <input type="radio" name="invite-role" value="student" checked> Schüler
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:500">
            <input type="radio" name="invite-role" value="teacher"> Lehrer
          </label>
        </div>
      </div>
      <button class="btn btn-primary" onclick="handleSendInvite()" style="margin-top:4px">Einladung senden →</button>
    </div>`;
}

function buildStudent() {
  if (state.activeModule === 'homework') return buildHomework();
  if (state.activeModule === 'lessons') return buildLessons();
  if (state.studentTab === 'chapters') return buildProgressView();
  if (state.studentTab === 'vocab') return buildVocabList();
  return buildLearnView();
}


function getBadgeSVG(tier, size) {
  const s = size || 64;
  const defs = [
    // tier 0: no badge yet
    `<svg width="${s}" height="${s}" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" fill="#F3F4F6" stroke="#D1D5DB" stroke-width="2" stroke-dasharray="5 3"/><circle cx="32" cy="32" r="12" fill="#E5E7EB"/><path d="M27 32l4 4 6-6" stroke="#9CA3AF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    // tier 1: bronze star (1-9)
    `<svg width="${s}" height="${s}" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" fill="#EA7C2B"/><circle cx="32" cy="32" r="25" fill="#F97316" opacity="0.7"/><path d="M32 14l4 12h13l-10.5 7.5 4 12L32 38l-10.5 7.5 4-12L15 26h13z" fill="#FFD700" stroke="#F59E0B" stroke-width="0.8"/><circle cx="32" cy="10" r="2.5" fill="#FFD700" opacity="0.5"/></svg>`,
    // tier 2: silver shield (10-19)
    `<svg width="${s}" height="${s}" viewBox="0 0 64 64" fill="none"><path d="M32 4L54 13v20q0 18-22 27Q10 51 10 33V13z" fill="#94A3B8"/><path d="M32 10l18 7v16q0 14-18 21Q14 47 14 33V17z" fill="#CBD5E1"/><path d="M32 11l14 5.5V32q0 11-14 17Q18 43 18 32V16.5z" fill="#E2E8F0"/><path d="M23 32l7 7 11-11" stroke="#64748B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="32" cy="9" r="3.5" fill="#E2E8F0" stroke="#94A3B8" stroke-width="1.5"/></svg>`,
    // tier 3: gold crown (20-29)
    `<svg width="${s}" height="${s}" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" fill="#FEF3C7"/><circle cx="32" cy="32" r="28" fill="#FDE68A" opacity="0.5"/><path d="M11 46V24l11 13 10-17 10 17 11-13v22z" fill="#F59E0B"/><path d="M11 46V24l11 13 10-17 10 17 11-13v22z" fill="#FFD700" opacity="0.6"/><rect x="11" y="44" width="42" height="6" rx="3" fill="#D97706"/><circle cx="32" cy="20" r="4" fill="#EF4444" stroke="#DC2626" stroke-width="1"/><circle cx="11" cy="24" r="3" fill="#3B82F6"/><circle cx="53" cy="24" r="3" fill="#3B82F6"/><circle cx="32" cy="50" r="2" fill="#FEF3C7"/><circle cx="23" cy="50" r="2" fill="#FEF3C7"/><circle cx="41" cy="50" r="2" fill="#FEF3C7"/></svg>`,
    // tier 4: purple gem (30-39)
    `<svg width="${s}" height="${s}" viewBox="0 0 64 64" fill="none"><polygon points="32,4 58,20 58,44 32,60 6,44 6,20" fill="#6D28D9"/><polygon points="32,10 52,22 52,42 32,56 12,42 12,22" fill="#8B5CF6"/><polygon points="32,10 52,22 32,18" fill="rgba(255,255,255,0.45)"/><polygon points="52,22 58,26 54,34" fill="rgba(255,255,255,0.2)"/><polygon points="32,24 40,32 32,40 24,32" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><polygon points="32,10 44,18 36,14" fill="rgba(255,255,255,0.3)"/></svg>`,
    // tier 5: legendary (40+)
    `<svg width="${s}" height="${s}" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" fill="#92400E"/><circle cx="32" cy="32" r="26" fill="#B45309"/><circle cx="32" cy="32" r="22" fill="#D97706"/><path d="M32 2l1.5 8h-3zM32 62l1.5-8h-3zM2 32l8 1.5v-3zM62 32l-8 1.5v-3zM10.5 10.5l6 5.5-2-2zM53.5 10.5l-6 5.5 2-2zM10.5 53.5l6-5.5-2 2zM53.5 53.5l-6-5.5 2 2z" fill="#FCD34D"/><circle cx="32" cy="32" r="16" fill="#F59E0B"/><circle cx="32" cy="32" r="12" fill="#FCD34D"/><path d="M32 20l3 9h9l-7.5 5.5 3 9L32 38l-7.5 5.5 3-9L20 29h9z" fill="#92400E"/><path d="M32 20l3 9h9l-7.5 5.5 3 9L32 38l-7.5 5.5 3-9L20 29h9z" fill="#FCD34D" opacity="0.5"/></svg>`,
  ];
  return defs[Math.min(tier, 5)];
}

function buildProgressView() {
  const chapters = state.studentChapters || [];
  const pd = state.progressData;
  const badgeCount = pd?.badgeCount ?? 0;
  const learnedByChapter = pd?.learnedByChapter ?? {};
  const levels = [...new Set(chapters.map(c => c.level))].sort();

  const tier = badgeCount === 0 ? 0 : Math.min(Math.floor((badgeCount - 1) / 10) + 1, 5);
  const tierNames = ['Noch kein Badge', 'Anfänger', 'Lernender', 'Fortgeschritten', 'Experte', 'Meister'];
  const toNext = tier < 5 ? (tier * 10 + 10) - badgeCount : 0;
  const pctToNext = tier < 5 ? ((badgeCount % 10) / 10) * 100 : 100;

  const badgeGrid = badgeCount > 0 ? Array.from({length: badgeCount}, (_, i) => {
    const bTier = Math.min(Math.floor(i / 10) + 1, 5);
    const isMilestone = (i + 1) % 10 === 0;
    return `<span title="Tag ${i+1}" style="display:inline-block;${isMilestone ? 'transform:scale(1.3);margin:0 3px' : ''}">${getBadgeSVG(bTier, isMilestone ? 32 : 24)}</span>`;
  }).join('') : '';

  const chapterPath = levels.map(level => {
    const lChapters = chapters.filter(c => c.level === level).sort((a,b) => a.chapter - b.chapter);
    return `
      <div style="margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding-left:22px">
          <span style="font-size:11px;font-weight:800;color:var(--text2);letter-spacing:0.8px;text-transform:uppercase">Level ${level}</span>
          <div style="flex:1;height:1px;background:var(--border)"></div>
        </div>
        ${lChapters.map((c, i) => {
          const learned = learnedByChapter[`${c.level}||${c.chapter}`] || 0;
          const pct = c.count > 0 ? Math.round((learned / c.count) * 100) : 0;
          const done = pct === 100;
          const isLast = i === lChapters.length - 1;
          return `
            <div style="display:flex;gap:0;align-items:stretch;margin-bottom:0">
              <div style="display:flex;flex-direction:column;align-items:center;width:44px;flex-shrink:0">
                <div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;
                  background:${c.unlocked ? (done ? 'var(--green)' : 'var(--accent)') : 'var(--surface2)'};
                  border:2.5px solid ${c.unlocked ? (done ? 'var(--green)' : 'var(--accent)') : 'var(--border)'};
                  box-shadow:${c.unlocked ? `0 4px 14px rgba(${done ? '34,192,107' : '79,110,247'},0.35)` : 'none'};
                  font-size:14px;font-weight:900;color:${c.unlocked ? '#fff' : 'var(--text3)'}">
                  ${c.unlocked ? (done ? `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9l5 5 7-7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` : c.chapter) : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="4" y="7" width="8" height="7" rx="1.5" stroke="var(--text3)" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="var(--text3)" stroke-width="1.5" stroke-linecap="round"/></svg>`}
                </div>
                ${!isLast ? `<div style="width:2.5px;flex:1;min-height:24px;background:${c.unlocked ? (done ? 'var(--green)' : 'var(--accent)') : 'var(--border)'};opacity:${c.unlocked ? '0.35' : '0.25'};margin:4px 0"></div>` : ''}
              </div>
              <div style="flex:1;padding-bottom:${isLast ? '0' : '16px'};padding-left:12px;padding-top:4px">
                <div style="background:${c.unlocked ? 'var(--surface)' : 'var(--surface2)'};border:1.5px solid ${c.unlocked ? (done ? 'rgba(34,192,107,0.3)' : 'var(--border)') : 'var(--border)'};border-radius:14px;padding:14px 18px;${!c.unlocked ? 'opacity:0.6' : ''}">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${c.unlocked ? '10px' : '0'}">
                    <div>
                      <div style="font-size:15px;font-weight:800;color:${c.unlocked ? 'var(--text)' : 'var(--text3)'}">Kapitel ${c.chapter}</div>
                      <div style="font-size:12px;color:var(--text2);font-weight:600;margin-top:1px">${c.count} Vokabeln</div>
                    </div>
                    ${c.unlocked ? `<span class="chip ${done ? 'green' : 'blue'}" style="font-size:11px">${done ? 'Fertig' : `${learned} / ${c.count}`}</span>` : `<span class="chip" style="font-size:11px">Gesperrt</span>`}
                  </div>
                  ${c.unlocked ? `<div style="background:var(--surface2);border-radius:6px;height:5px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${done ? 'var(--green)' : 'var(--accent)'};border-radius:6px"></div></div>` : ''}
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }).join('');

  return `
    <h1 class="section-title">Fortschritt</h1>

    <div class="card mb-6">
      <div style="display:flex;align-items:center;gap:20px;margin-bottom:${badgeCount > 0 ? '20px' : '0'}">
        ${getBadgeSVG(tier, 72)}
        <div style="flex:1;min-width:0">
          <div style="font-size:20px;font-weight:900;color:var(--text);margin-bottom:2px">${tierNames[tier]}</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:${tier < 5 ? '10px' : '4px'}">${badgeCount} Lerntage abgeschlossen</div>
          ${tier < 5 ? `
            <div style="font-size:11px;color:var(--text2);font-weight:700;margin-bottom:6px">Noch ${toNext} Tag${toNext === 1 ? '' : 'e'} bis <em>${tierNames[tier + 1]}</em></div>
            <div style="background:var(--surface2);border-radius:6px;height:6px;overflow:hidden">
              <div style="height:100%;width:${pctToNext}%;background:var(--accent);border-radius:6px;transition:width 0.4s"></div>
            </div>` : `<div style="font-size:13px;color:var(--green);font-weight:800">Höchste Stufe erreicht!</div>`}
        </div>
      </div>
      ${badgeCount > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding-top:4px;border-top:1px solid var(--border)">${badgeGrid}</div>` : `<p class="text-muted text-sm" style="margin:0">Schließe deine erste Lerneinheit ab um deinen ersten Badge zu verdienen!</p>`}
    </div>

    ${chapterPath}`;
}

function buildVocabList() {
  const vocab = state.learnedVocab || [];
  const pv = state.personalVocab || [];
  const ratingLabel = { 1: '😕', 2: '😐', 3: '🙂', 4: '😄' };
  const ratingColor = { 1: 'red', 2: '', 3: 'blue', 4: 'green' };

  // Gruppiere nach Kapitel
  const byChapter = {};
  vocab.forEach(p => {
    const key = `${p.vocabulary.level} · Kapitel ${p.vocabulary.chapter}`;
    if (!byChapter[key]) byChapter[key] = [];
    byChapter[key].push(p);
  });

  const pvSection = pv.length === 0 ? '' : `
    <div class="card mb-4" style="border-top:3px solid var(--green)">
      <div class="flex items-center gap-2" style="margin-bottom:12px">
        <strong>📝 Eigene Wörter</strong>
        <span class="chip green">${pv.length} Wörter</span>
      </div>
      <table style="width:100%">
        <thead><tr>
          <th style="text-align:left;padding:6px 4px;border-bottom:1.5px solid var(--border);font-size:12px">Deutsch</th>
          <th style="text-align:left;padding:6px 4px;border-bottom:1.5px solid var(--border);font-size:12px">Englisch</th>
          <th style="text-align:left;padding:6px 4px;border-bottom:1.5px solid var(--border);font-size:12px">Beispielsatz</th>
          <th style="text-align:center;padding:6px 4px;border-bottom:1.5px solid var(--border);font-size:12px">SRS</th>
        </tr></thead>
        <tbody>
          ${pv.map(v => `<tr>
            <td style="padding:6px 4px;border-bottom:1px solid var(--border);font-family:'Lora',serif;font-size:14px">${v.german}</td>
            <td style="padding:6px 4px;border-bottom:1px solid var(--border);font-family:'Lora',serif;font-size:14px">${v.english || '—'}</td>
            <td style="padding:6px 4px;border-bottom:1px solid var(--border);font-size:13px;color:var(--text2);font-style:italic">${v.example_sentence || '—'}</td>
            <td style="padding:6px 4px;border-bottom:1px solid var(--border);text-align:center">
              ${v.srs ? `<span class="chip green">${ratingLabel[v.srs.ease] || '🆕'}</span>` : '<span class="chip">—</span>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  return `
    <h1 class="section-title">Meine Vokabeln</h1>
    <p class="section-sub">${vocab.length} Vokabeln gelernt · ${pv.length} eigene Wörter</p>
    ${pvSection}
    ${vocab.length === 0 ? `
      <div class="card"><p class="text-muted text-sm">Noch keine Vokabeln gelernt. Starte eine Lernsession!</p></div>` :
      Object.entries(byChapter).sort().map(([chapter, items]) => `
        <div class="card mb-4">
          <div class="flex items-center gap-2" style="margin-bottom:12px">
            <strong>${chapter}</strong>
            <span class="chip">${items.length} Vokabeln</span>
          </div>
          <table style="width:100%">
            <thead><tr>
              <th style="text-align:left;padding:6px 4px;border-bottom:1.5px solid var(--border);font-size:12px">Englisch</th>
              <th style="text-align:left;padding:6px 4px;border-bottom:1.5px solid var(--border);font-size:12px">Deutsch</th>
              <th style="text-align:center;padding:6px 4px;border-bottom:1.5px solid var(--border);font-size:12px">Bewertung</th>
              <th style="text-align:center;padding:6px 4px;border-bottom:1.5px solid var(--border);font-size:12px">Abfragen</th>
            </tr></thead>
            <tbody>
              ${items.map(p => `<tr>
                <td style="padding:6px 4px;border-bottom:1px solid var(--border);font-family:'Lora',serif;font-size:14px">${p.vocabulary.english}</td>
                <td style="padding:6px 4px;border-bottom:1px solid var(--border);font-family:'Lora',serif;font-size:14px">${p.vocabulary.german}</td>
                <td style="padding:6px 4px;border-bottom:1px solid var(--border);text-align:center">
                  <span class="chip ${ratingColor[p.ease] || ''}">${ratingLabel[p.ease] || '—'}</span>
                </td>
                <td style="padding:6px 4px;border-bottom:1px solid var(--border);text-align:center;font-size:13px;color:var(--text2)">${p.review_count}×</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `).join('')
    }`;
}

function buildLearnView() {
  if (!state.sessionActive) {
    const d = state.dashboard;
    const firstName = (state.profile?.full_name || '').split(' ')[0] || 'Hey';
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Guten Morgen' : hour < 17 ? 'Hallo' : 'Guten Abend';
    const dueCount = d?.dueCount ?? '…';
    const newAvailable = d?.newAvailable ?? '…';
    const totalLearned = d?.totalLearned ?? '…';

    return `
      <div style="max-width:600px;margin:0 auto;padding:0 4px">

        <!-- Greeting -->
        <div style="margin-bottom:32px;padding-top:8px">
          <p style="font-size:13px;font-weight:700;color:var(--text2);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px">${greeting},</p>
          <h1 style="font-size:32px;font-weight:900;color:var(--text);margin:0;letter-spacing:-0.5px">${firstName}! 👋</h1>
        </div>

        <!-- Stats row -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:32px">
          <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:16px;text-align:center;box-shadow:0 2px 8px rgba(26,29,53,0.05)">
            <div style="font-size:26px;font-weight:900;color:var(--accent)">${dueCount}</div>
            <div style="font-size:11px;font-weight:700;color:var(--text2);margin-top:2px;text-transform:uppercase;letter-spacing:0.3px">Wiederholungen</div>
          </div>
          <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:16px;text-align:center;box-shadow:0 2px 8px rgba(26,29,53,0.05)">
            <div style="font-size:26px;font-weight:900;color:var(--green)">${totalLearned}</div>
            <div style="font-size:11px;font-weight:700;color:var(--text2);margin-top:2px;text-transform:uppercase;letter-spacing:0.3px">Gelernt</div>
          </div>
          <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:16px;text-align:center;box-shadow:0 2px 8px rgba(26,29,53,0.05)">
            <div style="font-size:26px;font-weight:900;color:var(--orange)">${newAvailable}</div>
            <div style="font-size:11px;font-weight:700;color:var(--text2);margin-top:2px;text-transform:uppercase;letter-spacing:0.3px">Neu heute</div>
          </div>
        </div>

        <!-- Mode cards -->
        <p style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:12px">Lernmodus wählen</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">

          <button id="btn-new-vocab" onclick="startSession('new')" style="
            background:var(--accent);color:#fff;border:none;border-radius:18px;
            padding:28px 18px 24px;cursor:pointer;text-align:center;position:relative;overflow:hidden;
            box-shadow:0 8px 28px rgba(79,110,247,0.35);
            transition:transform 0.15s,box-shadow 0.15s;font-family:'Nunito',sans-serif;
          " onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 14px 36px rgba(79,110,247,0.45)'"
             onmouseout="this.style.transform='';this.style.boxShadow='0 8px 28px rgba(79,110,247,0.35)'">
            <div style="position:absolute;top:-18px;right:-18px;width:80px;height:80px;background:rgba(255,255,255,0.08);border-radius:50%"></div>
            <div style="margin-bottom:14px">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                <circle cx="22" cy="22" r="22" fill="rgba(255,255,255,0.15)"/>
                <path d="M13 22h18M27 16l6 6-6 6" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                <rect x="14" y="14" width="12" height="9" rx="1.5" stroke="#fff" stroke-width="1.8" fill="none" opacity="0.6"/>
              </svg>
            </div>
            <div style="font-size:16px;font-weight:800;margin-bottom:4px">Neue Wörter</div>
            <div style="font-size:11px;opacity:0.8;font-weight:600;margin-bottom:14px;line-height:1.5">Heute ${newAvailable > 0 ? `+${newAvailable} neue` : 'keine neuen mehr'}</div>
            <div style="background:rgba(255,255,255,0.18);border-radius:20px;padding:6px 12px;display:inline-block;font-size:13px;font-weight:800">
              ${newAvailable} Karten
            </div>
          </button>

          <button id="btn-review" onclick="startSession('review')" style="
            background:var(--surface);color:var(--text);
            border:2px solid var(--border);border-radius:18px;
            padding:28px 18px 24px;cursor:pointer;text-align:center;position:relative;overflow:hidden;
            box-shadow:0 4px 16px rgba(26,29,53,0.07);
            transition:transform 0.15s,box-shadow 0.15s,border-color 0.15s;font-family:'Nunito',sans-serif;
          " onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 10px 28px rgba(26,29,53,0.13)';this.style.borderColor='var(--accent)'"
             onmouseout="this.style.transform='';this.style.boxShadow='0 4px 16px rgba(26,29,53,0.07)';this.style.borderColor='var(--border)'">
            <div style="position:absolute;top:-18px;right:-18px;width:80px;height:80px;background:var(--accent-light);border-radius:50%"></div>
            <div style="margin-bottom:14px">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                <circle cx="22" cy="22" r="22" fill="var(--accent-light)"/>
                <path d="M28 17a8 8 0 11-10.93 10.93" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"/>
                <path d="M14 22l-2 4 4-1" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M19 22h6M19 26h4" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" opacity="0.5"/>
              </svg>
            </div>
            <div style="font-size:16px;font-weight:800;margin-bottom:4px;color:var(--text)">Wiederholen</div>
            <div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:14px;line-height:1.5">Gelernte Wörter üben</div>
            <div style="background:var(--accent-light);border-radius:20px;padding:6px 12px;display:inline-block;font-size:13px;font-weight:800;color:var(--accent)">
              ${dueCount} Karten
            </div>
          </button>

        </div>

        ${(d?.personalDue > 0) ? `
        <div style="margin-top:14px">
          <button onclick="startPersonalSession()" style="
            width:100%;background:var(--green-light);color:var(--green);
            border:2px solid var(--green);border-radius:14px;
            padding:14px 18px;cursor:pointer;text-align:left;
            display:flex;align-items:center;justify-content:space-between;
            font-family:'Nunito',sans-serif;font-size:15px;font-weight:800;
            transition:background 0.15s,transform 0.15s;
          " onmouseover="this.style.background='var(--green)';this.style.color='#fff';this.style.transform='translateY(-2px)'"
             onmouseout="this.style.background='var(--green-light)';this.style.color='var(--green)';this.style.transform=''">
            <span>📝 Eigene Wörter üben</span>
            <span style="background:var(--green);color:#fff;border-radius:20px;padding:4px 12px;font-size:13px">${d.personalDue} fällig</span>
          </button>
        </div>` : ''}

      </div>`;
  }

  const s = state.session;

  // Warten-Screen
  if (!state.currentCard && state.waitingUntil) {
    const secsLeft = Math.max(0, Math.ceil((state.waitingUntil - now()) / 1000));
    return `
      <div class="queue-waiting">
        <div class="wait-icon">⏳</div>
        <div class="wait-label">Nächste Karte kommt in</div>
        <div class="wait-timer" id="wait-countdown">${formatSeconds(secsLeft)}</div>
        <div class="text-muted text-sm">Kurze Pause — gleich geht's weiter!</div>
      </div>`;
  }

  // Done-Screen
  if (!state.currentCard && s.pendingQueue?.length === 0) {
    const accuracy = s.reviewed > 0 ? Math.round((s.correct / s.reviewed) * 100) : 0;
    return `
      <div class="done-screen">
        <div class="done-icon">🎉</div>
        <h2 class="done-title">Lerneinheit abgeschlossen!</h2>
        <p class="text-muted" style="margin-bottom:24px">Gut gemacht, ${state.profile?.full_name?.split(' ')[0] || ''}!</p>
        <div class="admin-grid" style="max-width:400px;margin:0 auto 28px">
          <div class="stat-card"><div class="stat-big">${s.reviewed}</div><div class="stat-label">Karten gelernt</div></div>
          <div class="stat-card"><div class="stat-big">${accuracy}%</div><div class="stat-label">Trefferquote</div></div>
        </div>
        <div class="flex gap-3 items-center" style="justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="startSession('${s.mode || 'review'}')">Nochmal lernen</button>
        </div>
      </div>`;
  }

  const card = state.currentCard;
  const vocab = card?.vocab;
  const progressPct = Math.round((s.reviewed / Math.max(s.total, 1)) * 100);

  // Session header (shared across all exercise types)
  const sessionHeader = `
    <div style="width:100%;max-width:560px">
      <div class="flex justify-between items-center mb-4">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn btn-ghost btn-sm" onclick="exitSession()">← Zurück</button>
          <span class="text-sm text-muted">${s.reviewed}/${s.total} · ${s.correct} ✓ ${s.wrong} ✗</span>
        </div>
        <div class="direction-toggle">
          <button class="toggle-btn ${state.direction === 'de_en' ? 'active' : ''}" onclick="setDirection('de_en')">DE→EN</button>
          <button class="toggle-btn ${state.direction === 'en_de' ? 'active' : ''}" onclick="setDirection('en_de')">EN→DE</button>
        </div>
      </div>
      <div class="progress-bar-outer">
        <div class="progress-bar-inner" style="width:${progressPct}%"></div>
      </div>
    </div>`;

  // Route to exercise type
  const exerciseType = card?.exerciseType || 'flashcard';
  if (exerciseType !== 'flashcard') {
    return `<div class="flashcard-wrapper">${sessionHeader}${buildVocabExercise(card, state.exState)}</div>`;
  }

  // Default: flashcard
  const front = state.direction === 'de_en' ? vocab?.german : vocab?.english;
  const back = state.direction === 'de_en' ? vocab?.english : vocab?.german;

  return `
    <div class="flashcard-wrapper">
      ${sessionHeader}
      <div class="flashcard ${state.showBack ? 'flipped' : ''}" onclick="${state.showBack ? '' : 'flipCard()'}">
        <div class="flashcard-inner">
          <div class="flashcard-front">
            <span class="card-direction-badge">${state.direction === 'de_en' ? '🇩🇪 → 🇬🇧' : '🇬🇧 → 🇩🇪'}</span>
            <div class="card-word">${front}</div>
            <div class="card-hint">Klicke um die Antwort zu sehen</div>
          </div>
          <div class="flashcard-back">
            <div class="card-translation">${back}</div>
            <div class="card-hint" style="margin-top:12px">Wie gut wusstest du es?</div>
          </div>
        </div>
      </div>

      ${state.showBack ? `
      <div class="rating-buttons">
        ${[1,2,3,4].map(r => `
          <button class="rating-btn r${r}" onclick="rateCard(${r})">
            <span class="r-label">${RATING_LABELS[r].label}</span>
          </button>
        `).join('')}
      </div>` : `
      <button class="btn btn-ghost" onclick="flipCard()">Antwort anzeigen</button>
      `}
    </div>`;
}

function buildAdmin() {
  if (state.activeModule === 'homework') return buildHomework();
  if (state.activeModule === 'lessons') return buildLessons();
  if (state.activeModule === 'superadmin') return buildSuperAdmin();
  if (state.statsData) return buildStatsView();
  if (state.adminTab === 'vocab') return buildVocabAdmin();
  return buildStudentsAdmin();
}

function buildStudentsAdmin() {
  const modalHtml = state.selectedStudent ? buildChapterModal() : '';
  return `
    <h1 class="section-title">Schüler</h1>
    <p class="section-sub">Verwalte Konten und schalte Kapitel frei</p>
    <div class="card">
      ${state.students.length === 0 ? `
        <div class="empty" style="padding:40px">
          <div class="empty-icon">👥</div>
          <h3 class="empty-title">Noch keine Schüler</h3>
          <p class="text-muted text-sm">Schüler registrieren sich selbst über den Anmeldebereich</p>
        </div>` :
        state.students.map(s => `
          <div class="student-row">
            <div class="student-info">
              <div class="student-avatar">${(s.full_name || s.email || '?')[0].toUpperCase()}</div>
              <div>
                <div class="student-name">${s.full_name || '—'}</div>
                <div class="student-email">${s.email}</div>
              </div>
            </div>
            <div class="student-actions">
              <button class="btn btn-ghost btn-sm" onclick="openChapterModal('${s.id}')">Kapitel verwalten</button>
              <button class="btn btn-ghost btn-sm" onclick="openStats('${s.id}')">Statistiken</button>
              <button class="btn btn-ghost btn-sm" style="color:var(--orange);border-color:var(--orange)" onclick="resetSrsNow('${s.id}')" title="Alle Vokabeln sofort fällig setzen">⟳ Sofort fällig</button>
            </div>
          </div>
        `).join('')
      }
    </div>
    ${modalHtml}`;
}

function buildChapterModal() {
  const s = state.selectedStudent;
  const levels = state.vocabLevels;

  return `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal">
        <h2 class="modal-title">Kapitel freischalten — ${s.full_name || s.email}</h2>
        ${levels.map(level => {
          const chapters = state.allChaptersByLevel[level] || [];
          return `
            <div style="margin-bottom:20px">
              <div class="flex items-center justify-between mb-4">
                <strong>${level}</strong>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:8px">
                ${chapters.map(ch => {
                  const unlocked = state.unlockedForStudent.some(u => u.level === level && u.chapter === ch);
                  return `<button class="chip ${unlocked ? 'green' : ''}"
                    style="cursor:pointer;padding:6px 12px;font-size:13px"
                    onclick="toggleChapterUnlock('${s.id}', '${level}', '${ch}')">
                    ${unlocked ? '✓ ' : ''}Kap. ${ch}
                  </button>`;
                }).join('')}
              </div>
            </div>`;
        }).join('')}
        <div class="divider"></div>
        <button class="btn btn-ghost" onclick="closeModal()">Schließen</button>
      </div>
    </div>`;
}

function buildVocabAdmin() {
  const levels = state.vocabLevels;
  return `
    <h1 class="section-title">Vokabeln</h1>
    <p class="section-sub">Importiere Vokabellisten als CSV-Datei</p>

    <div class="card mb-6">
      <h3 style="margin-bottom:8px">Beispielsätze generieren</h3>
      <p class="text-sm text-muted" style="margin-bottom:16px">Generiert für jede Vokabel ohne Beispielsatz einen kurzen deutschen Satz mit Claude AI. Wird einmalig ausgeführt und dauert je nach Anzahl einige Minuten.</p>
      ${state.sentenceGenProgress ? `
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span class="text-sm">${state.sentenceGenProgress.status}</span>
            <span class="text-sm font-bold">${state.sentenceGenProgress.done} / ${state.sentenceGenProgress.total}</span>
          </div>
          <div style="height:6px;background:var(--surface2);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${state.sentenceGenProgress.total > 0 ? Math.round((state.sentenceGenProgress.done / state.sentenceGenProgress.total) * 100) : 0}%;background:var(--accent);border-radius:4px;transition:width 0.3s"></div>
          </div>
        </div>
        ${state.sentenceGenProgress.done >= state.sentenceGenProgress.total ? `<span class="chip green">✓ Fertig</span>` : `<span class="text-sm text-muted">Läuft…</span>`}
      ` : `
        <button class="btn btn-primary btn-sm" onclick="generateAllSentences()">✨ Sätze generieren</button>
      `}
    </div>

    <div class="card mb-6">
      <h3 style="margin-bottom:12px">CSV importieren</h3>
      <p class="text-sm text-muted" style="margin-bottom:16px">Format: <code style="background:var(--surface2);padding:2px 6px;border-radius:4px">Kapitel,Kategorie,Deutsch,Englisch</code> (erste Zeile = Überschrift, Kapitel wird automatisch aufgeteilt)</p>
      <div class="form-group">
        <label>Sprachlevel</label>
        <select id="import-level">
          <option value="A1">A1</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
          <option value="C1">C1</option>
        </select>
      </div>
      <div class="upload-zone" onclick="el('csv-file').click()">
        <input type="file" id="csv-file" accept=".csv" onchange="handleCSV(this)">
        <div style="font-size:32px;margin-bottom:8px">📁</div>
        <div style="font-weight:500">CSV-Datei auswählen</div>
        <div class="text-sm text-muted">oder hier hereinziehen</div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-bottom:16px">Vorhandene Kapitel</h3>
      ${levels.length === 0 ? `<p class="text-muted text-sm">Noch keine Vokabeln importiert</p>` :
        levels.map(level => `
          <div style="margin-bottom:16px">
            <div class="flex items-center gap-2 mb-4">
              <strong>${level}</strong>
              <span class="chip">${(state.allChaptersByLevel[level] || []).length} Kapitel</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${(state.allChaptersByLevel[level] || []).map(ch => `
                <button class="chip" style="font-size:13px;padding:5px 10px;cursor:pointer;border:none;font-family:inherit"
                  onclick="openChapterVocab('${level}', '${ch}')">Kap. ${ch}</button>
              `).join('')}
            </div>
          </div>
        `).join('')
      }
    </div>
    ${state.viewingVocab ? buildVocabModal() : ''}`;
}

function buildVocabModal() {
  const { level, chapter, items } = state.viewingVocab;
  return `
    <div class="modal-overlay" onclick="closeVocabModal(event)">
      <div class="modal" style="max-width:600px;max-height:80vh;display:flex;flex-direction:column">
        <div class="flex items-center justify-between" style="margin-bottom:16px">
          <h2 class="modal-title" style="margin:0">${level} — Kapitel ${chapter}</h2>
          <span class="chip">${items.length} Vokabeln</span>
        </div>
        <div style="overflow-y:auto;flex:1">
          <table style="width:100%">
            <thead><tr>
              <th style="text-align:left;padding:8px 4px;border-bottom:1.5px solid var(--border)">Deutsch</th>
              <th style="text-align:left;padding:8px 4px;border-bottom:1.5px solid var(--border)">Englisch</th>
            </tr></thead>
            <tbody>
              ${items.map(v => `<tr>
                <td style="padding:7px 4px;border-bottom:1px solid var(--border);font-family:'Lora',serif">${v.german}</td>
                <td style="padding:7px 4px;border-bottom:1px solid var(--border);font-family:'Lora',serif">${v.english}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="divider"></div>
        <button class="btn btn-ghost" onclick="closeVocabModal()">Schließen</button>
      </div>
    </div>`;
}

function buildStatsView() {
  const d = state.statsData;
  const s = state.statsStudent;
  return `
    <div class="flex items-center gap-3 mb-6">
      <button class="btn btn-ghost btn-sm" onclick="closeStats()">← Zurück</button>
      <div>
        <h1 class="section-title" style="margin-bottom:0">${s?.full_name || s?.email}</h1>
        <p class="text-muted text-sm">${s?.email}</p>
      </div>
    </div>

    <div class="admin-grid mb-6">
      <div class="stat-card"><div class="stat-big">${d.totalReviewed}</div><div class="stat-label">Karten gelernt</div></div>
      <div class="stat-card"><div class="stat-big">${d.accuracy}%</div><div class="stat-label">Trefferquote</div></div>
      <div class="stat-card"><div class="stat-big">${d.totalTimeMin}</div><div class="stat-label">Minuten gelernt</div></div>
      <div class="stat-card"><div class="stat-big">${d.sessions.length}</div><div class="stat-label">Lerneinheiten</div></div>
    </div>

    <div class="card mb-4">
      <h3 style="margin-bottom:16px">Lerneinheiten</h3>
      ${d.sessions.length === 0 ? `<p class="text-muted text-sm">Noch keine Sessions</p>` : `
      <table>
        <thead><tr>
          <th>Datum</th><th>Dauer</th><th>Karten</th><th>Richtig</th><th>Falsch</th><th>Quote</th>
        </tr></thead>
        <tbody>
          ${d.sessions.slice(0,10).map(sess => {
            const dur = sess.ended_at ? Math.round((new Date(sess.ended_at) - new Date(sess.started_at)) / 60000) : '—';
            const acc = sess.cards_reviewed > 0 ? Math.round((sess.correct_count / sess.cards_reviewed) * 100) : 0;
            return `<tr>
              <td>${new Date(sess.started_at).toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
              <td>${dur} Min</td>
              <td>${sess.cards_reviewed || 0}</td>
              <td><span class="chip green">${sess.correct_count || 0}</span></td>
              <td><span class="chip red">${sess.wrong_count || 0}</span></td>
              <td style="font-weight:700;color:${acc >= 70 ? 'var(--green)' : acc >= 40 ? 'var(--orange)' : 'var(--red)'}">${acc}%</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`}
    </div>

    <div class="card">
      <div class="flex items-center justify-between mb-6">
        <h3 style="margin:0">Vokabeln im Detail</h3>
        <span class="chip">${(d.vocabStats || []).length} Wörter</span>
      </div>
      ${!d.vocabStats?.length ? `<p class="text-muted text-sm">Noch keine Daten</p>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Deutsch</th>
          <th>Englisch</th>
          <th>Kapitel</th>
          <th style="text-align:center">Abfragen</th>
          <th style="text-align:center" title="Schlecht">😕</th>
          <th style="text-align:center" title="Okay">😐</th>
          <th style="text-align:center" title="Gut">🙂</th>
          <th style="text-align:center" title="Sehr gut">😄</th>
          <th>Verlauf</th>
          <th>Nächste WH</th>
        </tr></thead>
        <tbody>
          ${d.vocabStats.map(v => {
            const p = v.progress;
            const nextReview = p?.next_review ? new Date(p.next_review) : null;
            const isOverdue = nextReview && nextReview <= new Date();
            const nextStr = nextReview
              ? (isOverdue ? '<span style="color:var(--red)">⚠ Fällig</span>' : nextReview.toLocaleDateString('de-DE'))
              : '<span style="color:var(--text3)">—</span>';
            const totalR = v.ratings[1] + v.ratings[2] + v.ratings[3] + v.ratings[4];
            const goodPct = totalR > 0 ? Math.round(((v.ratings[3] + v.ratings[4]) / totalR) * 100) : 0;
            return `<tr>
              <td style="font-family:'Lora',serif;font-weight:600">${v.vocab?.german || '—'}</td>
              <td style="font-family:'Lora',serif">${v.vocab?.english || '—'}</td>
              <td><span class="chip" style="font-size:11px">${v.vocab?.level || ''} Kap.${v.vocab?.chapter || ''}</span></td>
              <td style="text-align:center">
                <strong>${v.count}</strong>
                <div style="font-size:11px;color:${goodPct >= 70 ? 'var(--green)' : goodPct >= 40 ? 'var(--orange)' : 'var(--red)'};font-weight:700">${goodPct}% gut</div>
              </td>
              <td style="text-align:center;color:var(--red);font-weight:700">${v.ratings[1] || 0}</td>
              <td style="text-align:center;color:var(--orange);font-weight:700">${v.ratings[2] || 0}</td>
              <td style="text-align:center;color:var(--blue);font-weight:700">${v.ratings[3] || 0}</td>
              <td style="text-align:center;color:var(--green);font-weight:700">${v.ratings[4] || 0}</td>
              <td style="font-size:17px;letter-spacing:1px;white-space:nowrap">${v.history.map(r => ['','😕','😐','🙂','😄'][r] || '').join('')}</td>
              <td style="font-size:12px;white-space:nowrap">${nextStr}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

// ========== EVENTS ==========
function attachEvents() {
  // Countdown timer für Warte-Screen
  if (state.waitingUntil && el('wait-countdown')) {
    const interval = setInterval(() => {
      const secsLeft = Math.max(0, Math.ceil((state.waitingUntil - now()) / 1000));
      const el2 = el('wait-countdown');
      if (!el2) { clearInterval(interval); return; }
      el2.textContent = formatSeconds(secsLeft);
      if (secsLeft <= 0) {
        clearInterval(interval);
        // Karte aus pending in activeQueue verschieben
        const ready = state.session.pendingQueue.filter(c => new Date(c.showAfter) <= now());
        state.session.pendingQueue = state.session.pendingQueue.filter(c => new Date(c.showAfter) > now());
        if (ready.length > 0) {
          state.currentCard = ready.shift();
          state.session.activeQueue.push(...ready);
          state.waitingUntil = null;
        } else if (state.session.pendingQueue.length > 0) {
          const next = state.session.pendingQueue.reduce((a, b) =>
            new Date(a.showAfter) < new Date(b.showAfter) ? a : b);
          state.waitingUntil = new Date(next.showAfter);
        }
        state.showBack = false;
        render();
      }
    }, 1000);
  }

  // Drag and drop for CSV
  const zone = document.querySelector('.upload-zone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (file) handleCSVFile(file);
    });
  }
}

function formatSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2,'0')}` : `${sec}s`;
}

// ========== GLOBAL HANDLERS ==========
window.handleLogin = async () => {
  const email = el('login-email')?.value;
  const pw = el('login-password')?.value;
  if (!email || !pw) { showToast('Bitte alle Felder ausfüllen', 'error'); return; }
  await login(email, pw);
};

window.togglePwVisibility = (inputId, btn) => {
  const input = document.getElementById(inputId);
  if (!input) return;
  const nowVisible = input.type === 'text';
  input.type = nowVisible ? 'password' : 'text';
  btn.dataset.visible = (!nowVisible).toString();
};

window.handleSetPassword = async () => {
  const name = el('set-pw-name')?.value?.trim();
  const pw = el('set-pw-password')?.value;
  const confirm = el('set-pw-confirm')?.value;
  if (!name) { showToast('Bitte gib deinen Namen ein.', 'error'); return; }
  if (!pw || pw.length < 6) { showToast('Passwort muss mindestens 6 Zeichen haben.', 'error'); return; }
  if (pw !== confirm) { showToast('Passwörter stimmen nicht überein.', 'error'); return; }
  const { error } = await sb.auth.updateUser({ password: pw, data: { full_name: name } });
  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
  await sb.from('profiles').update({ full_name: name }).eq('id', state.user.id);
  const { data: { session } } = await sb.auth.getSession();
  await loadProfile(session.user);
  showToast('Konto aktiviert! Willkommen.', 'success');
  render();
};

window.handleSendInvite = async () => {
  const email = el('invite-email')?.value?.trim();
  const roleEl = document.querySelector('input[name="invite-role"]:checked');
  const role = roleEl?.value || 'student';
  if (!email) { showToast('Bitte E-Mail eingeben.', 'error'); return; }
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) { showToast('Nicht eingeloggt.', 'error'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ email, is_admin: role === 'teacher' })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Fehler');
    showToast(`Einladung an ${email} gesendet!`, 'success');
    el('invite-email').value = '';
  } catch (e) {
    showToast('Fehler: ' + e.message, 'error');
  }
};

window.logout = logout;
window.flipCard = () => { state.showBack = true; render(); };
window.rateCard = rateCard;
window.setDirection = (d) => { state.direction = d; render(); };
window.startSession = startSession;
window.exitSession = async () => {
  const s = state.session;
  if (s?.id) {
    if (s.reviewed > 0) {
      // Save whatever was completed before exit
      await sb.from('learning_sessions').update({
        ended_at: new Date().toISOString(),
        cards_reviewed: s.reviewed,
        correct_count: s.correct,
        wrong_count: s.wrong
      }).eq('id', s.id);
    } else {
      // Zero-card session (user exited immediately) — delete it
      await sb.from('learning_sessions').delete().eq('id', s.id);
    }
  }
  state.sessionActive = false;
  state.currentCard = null;
  state.session = null;
  state.exState = null;
  state.showBack = false;
  state.waitingUntil = null;
  await loadDashboard();
  render();
};
window.resetSrsNow = async (studentId) => {
  const { error } = await sb.from('srs_progress')
    .update({ next_review: new Date().toISOString() })
    .eq('student_id', studentId);
  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
  showToast('Alle Vokabeln sind jetzt sofort fällig.', 'success');
};
window.selectLevel = (l) => { state.selectedLevel = l; render(); };

window.switchModule = async (moduleId) => {
  state.activeModule = moduleId;
  state.statsData = null;
  state.hwActive = null;
  state.activeLesson = null;
  if (moduleId === 'homework') {
    if (state.profile?.is_admin) await loadStudents();
    await loadHomework();
  }
  if (moduleId === 'lessons') {
    if (state.profile?.is_admin) {
      await loadStudents();
      if (state.lessonStudent) await loadLessons();
      await Promise.all([loadLessonNotifications(), loadBlueprints()]);
    } else {
      await loadLessons();
    }
  }
  render();
};

window.switchAdminTab = async (tab) => {
  state.adminTab = tab;
  state.statsData = null;
  if (tab === 'students') await loadStudents();
  if (tab === 'vocab') await loadVocabMeta();
  render();
};

window.switchStudentTab = async (tab) => {
  state.studentTab = tab;
  if (tab === 'learn') { state.sessionActive = false; await loadDashboard(); }
  if (tab === 'chapters') { state.sessionActive = false; await loadProgressData(); }
  if (tab === 'vocab') await loadLearnedVocab();
  render();
};

window.openChapterVocab = async (level, chapter) => {
  const { data } = await sb.from('vocabulary').select('german, english').eq('level', level).eq('chapter', chapter).order('german');
  state.viewingVocab = { level, chapter, items: data || [] };
  render();
};

window.generateAllSentences = async () => {
  // Load all vocab without a sentence
  const { data: allVocab, error } = await sb.from('vocabulary')
    .select('id, german, english')
    .is('example_sentence', null);

  if (error) { showToast('Fehler beim Laden: ' + error.message, 'error'); return; }
  if (!allVocab || allVocab.length === 0) {
    showToast('Alle Vokabeln haben bereits einen Beispielsatz!', 'success');
    return;
  }

  const BATCH = 30;
  state.sentenceGenProgress = { done: 0, total: allVocab.length, status: 'Generiere Sätze…' };
  render();

  for (let i = 0; i < allVocab.length; i += BATCH) {
    const batch = allVocab.slice(i, i + BATCH);
    try {
      const { data, error: fnError } = await sb.functions.invoke('generate-vocab-sentences', {
        body: { vocab: batch },
        headers: { Authorization: `Bearer ${(await sb.auth.getSession()).data.session?.access_token}` },
      });
      if (fnError) throw fnError;

      const sentences = data?.sentences || [];
      if (sentences.length > 0) {
        // Upsert each sentence back into vocabulary table
        for (const { id, sentence } of sentences) {
          await sb.from('vocabulary').update({ example_sentence: sentence }).eq('id', id);
        }
      }
    } catch (e) {
      console.error('Batch error:', e);
      state.sentenceGenProgress.status = `Fehler bei Batch ${Math.floor(i / BATCH) + 1} — fahre fort…`;
    }

    state.sentenceGenProgress.done = Math.min(i + BATCH, allVocab.length);
    state.sentenceGenProgress.status = state.sentenceGenProgress.done >= allVocab.length
      ? 'Fertig!'
      : `Generiere Sätze… (${state.sentenceGenProgress.done} von ${allVocab.length})`;
    render();

    // Small delay between batches to avoid rate limiting
    if (i + BATCH < allVocab.length) await new Promise(r => setTimeout(r, 500));
  }
};

window.closeVocabModal = (event) => {
  if (!event || event.target.classList.contains('modal-overlay')) {
    state.viewingVocab = null;
    render();
  }
};

window.openChapterModal = async (studentId) => {
  const student = state.students.find(s => s.id === studentId);
  state.selectedStudent = student;
  await Promise.all([loadVocabMeta(), loadUnlockedForStudent(studentId)]);
  render();
};

window.toggleChapterUnlock = toggleChapterUnlock;

window.closeModal = (event) => {
  if (!event || event.target.classList.contains('modal-overlay')) {
    state.selectedStudent = null;
    render();
  }
};

window.openStats = async (studentId) => {
  await loadStudents();
  await loadStats(studentId);
};

window.closeStats = () => {
  state.statsData = null;
  state.statsStudent = null;
  render();
};

window.handleCSV = (input) => {
  if (input.files[0]) handleCSVFile(input.files[0]);
};

async function handleCSVFile(file) {
  const level = el('import-level')?.value || 'A1';
  await uploadCSV(file, level);
}

// ========== INIT ==========
(async () => {
  await init();
  if (state.view === 'admin') {
    await loadStudents();
    await loadVocabMeta();
  } else if (state.view === 'student') {
    await loadStudentChapters();
    if (!state.studentChapters?.some(c => c.unlocked)) {
      state.studentTab = 'chapters';
      await loadProgressData();
    } else {
      await loadDashboard();
    }
  }
  render();
})();
