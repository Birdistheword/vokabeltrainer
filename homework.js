// ========== HOMEWORK MODULE ==========
// Separate file for all homework-related logic and UI

// ========== ACTIVE ASSIGNMENT STATE INIT ==========
function initHwActive(assignment) {
  const exState = {};
  const dragState = {};
  const orderState = {};

  for (const ex of assignment.exercises) {
    exState[ex.id] = { done: false, correct: false, answer: null, feedback: null };

    if (ex.type === 'drag_to_gap') {
      const gaps = {};
      for (const sent of ex.content.sentences) {
        sent.parts.forEach((p, i) => {
          if (typeof p === 'object' && p.gap !== undefined) {
            gaps[`${sent.id}_${i}`] = null;
          }
        });
      }
      dragState[ex.id] = { selected: null, gaps, available: [...ex.content.wordBank] };
    }

    if (ex.type === 'word_ordering') {
      const sentences = {};
      for (const sent of ex.content.sentences) {
        sentences[sent.id] = { placed: [], remaining: [...sent.scrambled] };
      }
      orderState[ex.id] = { sentences };
    }
  }

  return { assignment, exState, dragState, orderState, submission: null };
}

// ========== DATA FUNCTIONS ==========

async function loadHomework() {
  try {
    if (state.profile?.is_admin) {
      const { data } = await sb.from('homework_assignments')
        .select('*, profiles!student_id(full_name, email)')
        .eq('teacher_id', state.user.id)
        .order('created_at', { ascending: false });
      state.hwAssignments = data || [];
    } else {
      const { data } = await sb.from('homework_assignments')
        .select('*')
        .eq('student_id', state.user.id)
        .order('created_at', { ascending: false });
      state.hwAssignments = data || [];
    }
  } catch (e) {
    console.error('loadHomework error:', e);
    state.hwAssignments = [];
  }
}

async function generateHomework(studentName, lessonNotes) {
  state.hwGenerating = true;
  render();

  try {
    const { data: authData } = await sb.auth.getSession();
    const token = authData?.session?.access_token;
    console.log('Session token available:', !!token);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-homework`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ studentName, lessonNotes })
    });

    const responseText = await response.text();
    console.log('Function response:', response.status, responseText);

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${responseText}`);
    const data = JSON.parse(responseText);
    if (data.error) throw new Error(data.error);
    state.hwPreview = data;
  } catch (e) {
    console.error('Generate homework error:', e);
    showToast('Fehler beim Generieren. Bitte nochmal versuchen.', 'error');
    state.hwPreview = null;
  }

  state.hwGenerating = false;
  render();
}

async function saveHomework() {
  if (!state.hwPreview || !state.hwCreateStudent) return;

  const { error } = await sb.from('homework_assignments').insert({
    student_id: state.hwCreateStudent.id,
    teacher_id: state.user.id,
    title: state.hwPreview.title,
    lesson_notes: state.hwCreateNotes,
    exercises: state.hwPreview.exercises,
    status: 'pending'
  });

  if (error) { showToast('Fehler beim Speichern: ' + error.message, 'error'); return; }

  showToast('Hausaufgaben gespeichert!', 'success');
  state.hwCreating = false;
  state.hwCreateStudent = null;
  state.hwCreateNotes = '';
  state.hwPreview = null;
  await loadHomework();
  render();
}

async function submitHomework() {
  if (!state.hwActive) return;
  const { assignment, exState } = state.hwActive;

  // Calculate score
  let totalPoints = 0;
  let earnedPoints = 0;

  for (const ex of assignment.exercises) {
    const es = exState[ex.id];
    if (!es?.feedback) continue;

    if (ex.type === 'odd_one_out') {
      totalPoints += ex.content.items.length;
      earnedPoints += es.feedback.correct || 0;
    } else {
      totalPoints += es.feedback.total || 0;
      earnedPoints += es.feedback.correct || 0;
    }
  }

  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;

  const { error: subError } = await sb.from('homework_submissions').insert({
    assignment_id: assignment.id,
    student_id: state.user.id,
    answers: exState,
    score
  });

  if (subError) { showToast('Fehler beim Einreichen: ' + subError.message, 'error'); return; }

  await sb.from('homework_assignments')
    .update({ status: 'completed' })
    .eq('id', assignment.id);

  showToast(`Hausaufgaben eingereicht! Ergebnis: ${score}%`, 'success');
  state.hwActive.submission = { score, submitted_at: new Date().toISOString() };
  await loadHomework();
  render();
}

async function loadHomeworkResults(assignmentId) {
  const { data } = await sb.from('homework_submissions')
    .select('*')
    .eq('assignment_id', assignmentId)
    .maybeSingle();
  state.hwResults = data;
  state.hwViewResults = assignmentId;
  render();
}

// ========== MAIN UI ROUTER ==========

function buildHomework() {
  if (state.profile?.is_admin) {
    if (state.hwViewResults) return buildHomeworkTeacherResults();
    if (state.hwCreating) return buildHomeworkTeacherCreate();
    return buildHomeworkTeacher();
  }
  if (state.hwActive) return buildHomeworkStudentActive();
  return buildHomeworkStudent();
}

// ========== TEACHER UI ==========

function buildHomeworkTeacher() {
  const assignments = state.hwAssignments || [];
  const students = state.students || [];

  return `
    <h1 class="section-title">Hausaufgaben</h1>

    <div class="card mb-6">
      <h3 style="margin-bottom:16px">Neue Hausaufgaben erstellen</h3>
      ${students.length === 0
        ? `<p class="text-muted text-sm">Noch keine Schüler vorhanden.</p>`
        : students.map(s => `
          <div class="student-row">
            <div class="student-info">
              <div class="student-avatar">${(s.full_name || s.email || '?')[0].toUpperCase()}</div>
              <div>
                <div class="student-name">${s.full_name || '—'}</div>
                <div class="student-email">${s.email}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="hwStartCreate('${s.id}')">
              + Aufgabe erstellen
            </button>
          </div>`).join('')
      }
    </div>

    <div class="card">
      <h3 style="margin-bottom:16px">Bisherige Aufgaben</h3>
      ${assignments.length === 0
        ? `<p class="text-muted text-sm">Noch keine Hausaufgaben erstellt.</p>`
        : assignments.map(a => {
            const studentName = a.profiles?.full_name || a.profiles?.email || 'Unbekannt';
            const date = new Date(a.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
            return `
              <div class="student-row">
                <div class="student-info">
                  <div class="student-avatar" style="background:var(--accent-light);color:var(--accent);font-size:18px">📝</div>
                  <div>
                    <div class="student-name">${a.title}</div>
                    <div class="student-email">${studentName} · ${date}</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                  <span class="chip ${a.status === 'completed' ? 'green' : ''}" style="font-size:11px">
                    ${a.status === 'completed' ? '✓ Eingereicht' : 'Ausstehend'}
                  </span>
                  ${a.status === 'completed'
                    ? `<button class="btn btn-ghost btn-sm" onclick="hwViewResultsBtn('${a.id}')">Ergebnisse</button>`
                    : ''}
                </div>
              </div>`;
          }).join('')
      }
    </div>`;
}

function buildHomeworkTeacherCreate() {
  const student = state.hwCreateStudent;

  return `
    <div style="max-width:640px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
        <button class="btn btn-ghost btn-sm" onclick="hwCancelCreate()">← Zurück</button>
        <div>
          <h1 class="section-title" style="margin:0">Hausaufgaben erstellen</h1>
          <p class="text-muted text-sm">für ${student?.full_name || student?.email || 'Schüler'}</p>
        </div>
      </div>

      ${!state.hwPreview ? `
        <div class="card">
          <h3 style="margin-bottom:8px">Was habt ihr in der Stunde gemacht?</h3>
          <p class="text-muted text-sm" style="margin-bottom:16px">Beschreibe Themen, Grammatik und Vokabeln der Stunde. Die KI generiert dann passende Übungen.</p>
          <div class="form-group">
            <textarea id="hw-lesson-notes" rows="6"
              style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:10px;font-family:inherit;font-size:14px;resize:vertical;background:var(--surface2);color:var(--text)"
              placeholder="z.B. Wir haben Kapitel 3 gemacht — Hotel-Vokabular (Rezeption, Zimmer, Ausstattung) und Akkusativ eingeführt. Der Schüler hat Schwierigkeiten mit trennbaren Verben."
            >${state.hwCreateNotes}</textarea>
          </div>
          <button class="btn btn-primary" style="width:100%;padding:14px"
            ${state.hwGenerating ? 'disabled' : ''}
            onclick="hwGenerate()">
            ${state.hwGenerating
              ? `<span style="display:inline-flex;align-items:center;gap:10px"><span class="hw-spinner"></span>KI generiert Hausaufgaben…</span>`
              : '✨ Hausaufgaben generieren'}
          </button>
        </div>
      ` : `
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
            <div>
              <h3 style="margin:0">${state.hwPreview.title}</h3>
              <p class="text-muted text-sm" style="margin-top:4px">${state.hwPreview.exercises.length} Übungen generiert</p>
            </div>
            <span class="chip blue">${state.hwPreview.exercises.length} Aufgaben</span>
          </div>

          ${state.hwPreview.exercises.map((ex, i) => `
            <div style="padding:14px;background:var(--surface2);border-radius:10px;margin-bottom:10px;display:flex;gap:12px;align-items:flex-start">
              <div style="width:28px;height:28px;border-radius:8px;background:var(--accent-light);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0">${i + 1}</div>
              <div>
                <div style="font-size:11px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${hwExTypeName(ex.type)}</div>
                <div style="font-size:14px;font-weight:600;color:var(--text)">${ex.instruction}</div>
              </div>
            </div>
          `).join('')}

          <div style="display:flex;gap:10px;margin-top:20px">
            <button class="btn btn-ghost" style="flex:1" onclick="hwRegenerateCreate()">↺ Neu generieren</button>
            <button class="btn btn-primary" style="flex:2" onclick="hwSave()">✓ Speichern & senden</button>
          </div>
        </div>
      `}
    </div>`;
}

function buildHomeworkTeacherResults() {
  const assignmentId = state.hwViewResults;
  const assignment = state.hwAssignments.find(a => a.id === assignmentId);
  const submission = state.hwResults;

  if (!assignment) return `<button class="btn btn-ghost" onclick="hwCloseResults()">← Zurück</button>`;

  const studentName = assignment.profiles?.full_name || assignment.profiles?.email || 'Schüler';

  return `
    <div style="max-width:700px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
        <button class="btn btn-ghost btn-sm" onclick="hwCloseResults()">← Zurück</button>
        <div>
          <h1 class="section-title" style="margin:0">${assignment.title}</h1>
          <p class="text-muted text-sm">${studentName} · ${new Date(assignment.created_at).toLocaleDateString('de-DE')}</p>
        </div>
      </div>

      ${!submission ? `
        <div class="card" style="text-align:center;padding:48px">
          <div style="font-size:48px;margin-bottom:16px">⏳</div>
          <h3 style="margin-bottom:8px">Noch nicht eingereicht</h3>
          <p class="text-muted text-sm">Der Schüler hat die Hausaufgaben noch nicht abgeschlossen.</p>
        </div>
      ` : `
        <div class="card mb-4" style="background:var(--accent-light);border-color:var(--accent)">
          <div style="display:flex;align-items:center;gap:20px">
            <div style="font-size:48px;font-weight:900;color:var(--accent);font-family:'Lora',serif">${submission.score}%</div>
            <div>
              <div style="font-weight:800;font-size:18px">Ergebnis</div>
              <div class="text-muted text-sm">${new Date(submission.submitted_at).toLocaleString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
            </div>
          </div>
        </div>

        ${assignment.exercises.map((ex, i) => `
          <div class="card mb-3">
            <div style="font-size:11px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
              Aufgabe ${i + 1} · ${hwExTypeName(ex.type)}
            </div>
            <div style="font-weight:600;margin-bottom:14px;color:var(--text)">${ex.instruction}</div>
            ${buildExerciseResultsView(ex, submission.answers?.[ex.id])}
          </div>
        `).join('')}
      `}
    </div>`;
}

function buildExerciseResultsView(ex, exState) {
  if (!exState) return `<p class="text-muted text-sm">Keine Antwort abgegeben.</p>`;

  if (ex.type === 'type_in_gap' || ex.type === 'drag_to_gap') {
    return ex.content.sentences.map(sent => {
      const answers = exState.answer?.[sent.id] || {};
      return `<div style="margin-bottom:10px;padding:10px 14px;background:var(--surface2);border-radius:8px;line-height:2.2">
        ${sent.parts.map((p, i) => {
          if (typeof p === 'string') return `<span>${p}</span>`;
          const key = `${sent.id}_${i}`;
          const given = answers[key] || '—';
          const correct = given.trim().toLowerCase() === p.gap.toLowerCase();
          return `<span style="display:inline-flex;align-items:center;gap:4px;background:${correct ? 'rgba(34,192,107,0.15)' : 'rgba(240,74,90,0.1)'};border:1.5px solid ${correct ? 'var(--green)' : 'var(--red)'};border-radius:6px;padding:2px 10px;font-weight:700;color:${correct ? 'var(--green)' : 'var(--red)'};font-size:13px;margin:0 2px">
            ${given}${!correct ? ` <span style="font-size:11px;opacity:0.7">(→ ${p.gap})</span>` : ' ✓'}
          </span>`;
        }).join('')}
      </div>`;
    }).join('');
  }

  if (ex.type === 'word_ordering') {
    return ex.content.sentences.map(sent => {
      const placed = exState.answer?.[sent.id] || [];
      const correct = JSON.stringify(placed) === JSON.stringify(sent.correct);
      return `<div style="padding:10px 14px;background:${correct ? 'rgba(34,192,107,0.08)' : 'rgba(240,74,90,0.05)'};border:1.5px solid ${correct ? 'var(--green)' : 'var(--red)'};border-radius:8px;margin-bottom:8px">
        <div style="font-weight:700;color:${correct ? 'var(--green)' : 'var(--red)'}">${placed.join(' ') || '—'} ${correct ? '✓' : '✗'}</div>
        ${!correct ? `<div style="font-size:12px;color:var(--text2);margin-top:4px">Richtig: ${sent.correct.join(' ')}</div>` : ''}
      </div>`;
    }).join('');
  }

  if (ex.type === 'odd_one_out') {
    return ex.content.items.map(item => {
      const given = exState.answer?.[item.id];
      const correct = given === item.correct;
      return `<div style="margin-bottom:12px">
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
          ${item.words.map(w => `
            <span style="padding:5px 14px;border-radius:20px;font-size:13px;font-weight:700;
              background:${w === given ? (correct ? 'rgba(34,192,107,0.15)' : 'rgba(240,74,90,0.1)') : (w === item.correct && !correct ? 'rgba(34,192,107,0.08)' : 'var(--surface2)')};
              border:1.5px solid ${w === given ? (correct ? 'var(--green)' : 'var(--red)') : (w === item.correct && !correct ? 'var(--green)' : 'var(--border)')};
              color:${w === given ? (correct ? 'var(--green)' : 'var(--red)') : 'var(--text)'}">
              ${w}
            </span>`).join('')}
        </div>
        <div style="font-size:12px;color:var(--text2)">${correct ? '✓ Richtig' : '✗ Falsch'} — ${item.explanation}</div>
      </div>`;
    }).join('');
  }

  return '';
}

// ========== STUDENT UI ==========

function buildHomeworkStudent() {
  const assignments = state.hwAssignments || [];

  if (assignments.length === 0) {
    return `
      <div style="display:flex;flex-direction:column;align-items:center;padding:80px 24px;text-align:center">
        <div style="width:88px;height:88px;border-radius:24px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:40px;margin-bottom:24px;border:1.5px solid var(--border)">📝</div>
        <h2 style="font-size:24px;margin-bottom:10px">Keine Hausaufgaben</h2>
        <p class="text-muted" style="max-width:360px;line-height:1.8;font-size:15px">
          Du hast zurzeit keine Hausaufgaben. Dein Lehrer wird dir bald welche zuweisen.
        </p>
      </div>`;
  }

  const pending = assignments.filter(a => a.status === 'pending');
  const completed = assignments.filter(a => a.status === 'completed');

  return `
    <h1 class="section-title">Hausaufgaben</h1>

    ${pending.length > 0 ? `
      <p class="section-sub" style="margin-bottom:12px">${pending.length} ausstehend</p>
      ${pending.map(a => `
        <div class="card mb-3 hw-assignment-card" onclick="hwOpenAssignment('${a.id}')">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-weight:800;font-size:16px;margin-bottom:4px">${a.title}</div>
              <div class="text-muted text-sm">${new Date(a.created_at).toLocaleDateString('de-DE')} · ${a.exercises?.length || 0} Übungen</div>
            </div>
            <div style="color:var(--accent);font-size:22px;font-weight:800">→</div>
          </div>
        </div>
      `).join('')}
    ` : ''}

    ${completed.length > 0 ? `
      <p class="section-sub" style="margin-top:${pending.length > 0 ? 24 : 0}px;margin-bottom:12px">Abgeschlossen</p>
      ${completed.map(a => `
        <div class="card mb-3 hw-assignment-card" onclick="hwOpenAssignment('${a.id}')">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-weight:700;font-size:15px;color:var(--text2);margin-bottom:4px">${a.title}</div>
              <div class="text-muted text-sm">${new Date(a.created_at).toLocaleDateString('de-DE')}</div>
            </div>
            <span class="chip green">✓ Erledigt</span>
          </div>
        </div>
      `).join('')}
    ` : ''}`;
}

function buildHomeworkStudentActive() {
  const { assignment, exState, dragState, orderState, submission } = state.hwActive;
  const allDone = assignment.exercises.every(ex => exState[ex.id]?.done);
  const doneCount = Object.values(exState).filter(e => e.done).length;

  return `
    <div style="max-width:640px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <button class="btn btn-ghost btn-sm" onclick="hwCloseAssignment()">← Zurück</button>
        <div style="flex:1">
          <h1 class="section-title" style="margin:0">${assignment.title}</h1>
          <p class="text-muted text-sm">${assignment.exercises.length} Übungen</p>
        </div>
        ${!submission ? `<span class="chip">${doneCount}/${assignment.exercises.length} fertig</span>` : ''}
      </div>

      ${submission ? `
        <div class="card mb-6" style="background:rgba(34,192,107,0.08);border-color:var(--green);text-align:center;padding:32px">
          <div style="font-size:48px;margin-bottom:12px">🎉</div>
          <div style="font-size:36px;font-weight:900;color:var(--green);font-family:'Lora',serif">${submission.score}%</div>
          <div style="font-weight:700;margin-top:8px;font-size:16px">Hausaufgaben eingereicht!</div>
        </div>
      ` : ''}

      ${assignment.exercises.map((ex, i) => `
        <div style="margin-bottom:24px">
          <div style="font-size:11px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;padding-left:4px;display:flex;align-items:center;gap:8px">
            <span>Aufgabe ${i + 1} · ${hwExTypeName(ex.type)}</span>
            ${exState[ex.id]?.done ? `<span style="color:var(--green);font-size:14px">✓</span>` : ''}
          </div>
          ${buildExercise(ex, exState[ex.id], dragState[ex.id], orderState[ex.id])}
        </div>
      `).join('')}

      ${!submission && allDone ? `
        <div style="padding:20px 0 40px">
          <button class="btn btn-primary" style="width:100%;padding:16px;font-size:16px;border-radius:14px" onclick="hwSubmit()">
            Hausaufgaben einreichen ✓
          </button>
        </div>
      ` : !submission && !allDone ? `
        <div style="padding:12px 4px 40px">
          <p class="text-muted text-sm">Bearbeite alle Aufgaben um einzureichen.</p>
        </div>
      ` : ''}
    </div>`;
}

// ========== EXERCISE RENDERERS ==========

function buildExercise(ex, es, ds, os) {
  switch (ex.type) {
    case 'type_in_gap':   return buildTypeInGap(ex, es);
    case 'drag_to_gap':   return buildDragToGap(ex, es, ds);
    case 'word_ordering': return buildWordOrdering(ex, es, os);
    case 'odd_one_out':   return buildOddOneOut(ex, es);
    default: return `<div class="card"><p class="text-muted text-sm">Unbekannter Aufgabentyp: ${ex.type}</p></div>`;
  }
}

function buildTypeInGap(ex, es) {
  const done = es?.done;
  const feedback = es?.feedback;

  return `
    <div class="card exercise-card">
      <p class="ex-instruction">${ex.instruction}</p>
      ${ex.content.sentences.map(sent => `
        <div class="ex-sentence">
          ${sent.parts.map((p, i) => {
            if (typeof p === 'string') return `<span>${p}</span>`;
            const key = `${sent.id}_${i}`;
            const fb = feedback?.items?.[key];
            const val = done ? (es.answer?.[sent.id]?.[key] || '') : '';
            return `<input
              type="text"
              id="tig-${ex.id}-${key}"
              class="gap-input${done ? (fb ? ' correct' : ' wrong') : ''}"
              ${done ? 'disabled' : ''}
              placeholder="___"
              value="${val.replace(/"/g, '&quot;')}"
              style="width:${Math.max(72, p.gap.length * 11)}px"
            />`;
          }).join('')}
        </div>
      `).join('')}
      ${!done
        ? `<button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="hwCheckTypeInGap('${ex.id}')">Überprüfen</button>`
        : `<div class="ex-feedback ${feedback?.allCorrect ? 'correct' : 'partial'}">
            ${feedback?.allCorrect ? '✓ Alles richtig!' : `${feedback?.correct} von ${feedback?.total} richtig`}
          </div>`
      }
    </div>`;
}

function buildDragToGap(ex, es, ds) {
  const done = es?.done;
  const feedback = es?.feedback;
  const selected = ds?.selected;
  const gaps = ds?.gaps || {};
  const available = ds?.available || [];

  return `
    <div class="card exercise-card">
      <p class="ex-instruction">${ex.instruction}</p>
      ${ex.content.sentences.map(sent => `
        <div class="ex-sentence">
          ${sent.parts.map((p, i) => {
            if (typeof p === 'string') return `<span>${p}</span>`;
            const key = `${sent.id}_${i}`;
            const placed = gaps[key];
            const fb = feedback?.items?.[key];
            if (placed) {
              return `<span class="gap-slot filled${done ? (fb ? ' correct' : ' wrong') : ''}"
                onclick="${done ? '' : `hwRemoveFromGap('${ex.id}', '${key}')`}"
                style="cursor:${done ? 'default' : 'pointer'}">
                ${placed}${!done ? ' <span style="font-size:11px;opacity:0.5">×</span>' : ''}
                ${done && !fb ? `<span style="font-size:11px;opacity:0.7"> (→ ${p.gap})</span>` : ''}
              </span>`;
            }
            return `<span class="gap-slot empty${!done && selected ? ' ready' : ''}"
              onclick="${done ? '' : `hwPlaceWord('${ex.id}', '${key}')`}"
              style="cursor:${done || !selected ? 'default' : 'pointer'}">___</span>`;
          }).join('')}
        </div>
      `).join('')}
      ${!done ? `
        <div class="word-bank">
          ${available.map(w => `
            <button class="word-chip${selected === w ? ' selected' : ''}"
              onclick="hwSelectWord('${ex.id}', ${JSON.stringify(w)})">
              ${w}
            </button>`).join('')}
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="hwCheckDragToGap('${ex.id}')">Überprüfen</button>
      ` : `
        <div class="ex-feedback ${feedback?.allCorrect ? 'correct' : 'partial'}">
          ${feedback?.allCorrect ? '✓ Alles richtig!' : `${feedback?.correct} von ${feedback?.total} richtig`}
        </div>`
      }
    </div>`;
}

function buildWordOrdering(ex, es, os) {
  const done = es?.done;
  const feedback = es?.feedback;

  return `
    <div class="card exercise-card">
      <p class="ex-instruction">${ex.instruction}</p>
      ${ex.content.sentences.map((sent, si) => {
        const sentState = os?.sentences?.[sent.id] || { placed: [], remaining: [...sent.scrambled] };
        const fb = feedback?.items?.[sent.id];
        return `
          <div style="margin-bottom:${si < ex.content.sentences.length - 1 ? '20px' : '0'}">
            <div class="order-target${done ? (fb ? ' correct' : ' wrong') : ''}">
              ${sentState.placed.length === 0
                ? `<span style="color:var(--text3);font-size:13px;align-self:center">Wörter hier einordnen…</span>`
                : sentState.placed.map((w, idx) => `
                  <button class="word-chip placed"
                    ${done ? 'disabled' : `onclick="hwOrderRemove('${ex.id}', '${sent.id}', ${idx})"`}>
                    ${w}
                  </button>`).join('')
              }
            </div>
            ${!done ? `
              <div class="word-bank" style="margin-top:8px">
                ${sentState.remaining.map(w => `
                  <button class="word-chip"
                    onclick="hwOrderAdd('${ex.id}', '${sent.id}', ${JSON.stringify(w)})">
                    ${w}
                  </button>`).join('')}
              </div>
            ` : done && !fb ? `
              <div style="font-size:12px;color:var(--text2);margin-top:6px;padding-left:4px">Richtig: ${sent.correct.join(' ')}</div>
            ` : ''}
          </div>`;
      }).join('')}
      ${!done
        ? `<button class="btn btn-primary btn-sm" style="margin-top:16px" onclick="hwCheckWordOrdering('${ex.id}')">Überprüfen</button>`
        : `<div class="ex-feedback ${feedback?.allCorrect ? 'correct' : 'partial'}" style="margin-top:12px">
            ${feedback?.allCorrect ? '✓ Alles richtig!' : `${feedback?.correct} von ${feedback?.total} richtig`}
          </div>`
      }
    </div>`;
}

function buildOddOneOut(ex, es) {
  return `
    <div class="card exercise-card">
      <p class="ex-instruction">${ex.instruction}</p>
      ${ex.content.items.map((item, ii) => {
        const given = es?.answer?.[item.id];
        const answered = given !== undefined;
        const correct = given === item.correct;
        return `
          <div style="margin-bottom:${ii < ex.content.items.length - 1 ? '20px' : '0'}">
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
              ${item.words.map(w => {
                let btnStyle = 'background:var(--surface2);border-color:var(--border);color:var(--text)';
                if (answered) {
                  if (w === item.correct) {
                    btnStyle = 'background:rgba(34,192,107,0.15);border-color:var(--green);color:var(--green)';
                  } else if (w === given && !correct) {
                    btnStyle = 'background:rgba(240,74,90,0.1);border-color:var(--red);color:var(--red)';
                  }
                }
                return `<button class="word-chip"
                  style="${btnStyle};padding:8px 18px;font-size:14px;font-weight:700"
                  ${answered ? 'disabled' : `onclick="hwOddSelect('${ex.id}', '${item.id}', ${JSON.stringify(w)})"`}>
                  ${w}
                </button>`;
              }).join('')}
            </div>
            ${answered ? `
              <div class="ex-feedback ${correct ? 'correct' : 'partial'}" style="margin-top:4px">
                ${correct ? '✓ Richtig! — ' : '✗ Falsch — '}
                <span style="font-weight:600">${item.explanation}</span>
              </div>
            ` : ''}
          </div>`;
      }).join('')}
    </div>`;
}

// ========== INTERACTION HANDLERS ==========

window.hwCheckTypeInGap = (exId) => {
  const ex = state.hwActive.assignment.exercises.find(e => e.id === exId);
  if (!ex) return;

  let total = 0, correct = 0;
  const answer = {};
  const items = {};

  for (const sent of ex.content.sentences) {
    answer[sent.id] = {};
    sent.parts.forEach((p, i) => {
      if (typeof p !== 'object') return;
      const key = `${sent.id}_${i}`;
      const input = document.getElementById(`tig-${exId}-${key}`);
      const val = input?.value?.trim() || '';
      answer[sent.id][key] = val;
      const isCorrect = val.toLowerCase() === p.gap.toLowerCase();
      items[key] = isCorrect;
      total++;
      if (isCorrect) correct++;
    });
  }

  state.hwActive.exState[exId] = {
    done: true, answer,
    feedback: { allCorrect: correct === total, correct, total, items }
  };
  render();
};

window.hwSelectWord = (exId, word) => {
  const ds = state.hwActive.dragState[exId];
  if (!ds) return;
  ds.selected = ds.selected === word ? null : word;
  render();
};

window.hwPlaceWord = (exId, gapKey) => {
  const ds = state.hwActive.dragState[exId];
  if (!ds || !ds.selected) return;
  ds.gaps[gapKey] = ds.selected;
  ds.available = ds.available.filter(w => w !== ds.selected);
  ds.selected = null;
  render();
};

window.hwRemoveFromGap = (exId, gapKey) => {
  const ds = state.hwActive.dragState[exId];
  if (!ds) return;
  const word = ds.gaps[gapKey];
  if (word) { ds.gaps[gapKey] = null; ds.available.push(word); }
  render();
};

window.hwCheckDragToGap = (exId) => {
  const ex = state.hwActive.assignment.exercises.find(e => e.id === exId);
  const ds = state.hwActive.dragState[exId];
  if (!ex || !ds) return;

  let total = 0, correct = 0;
  const answer = {};
  const items = {};

  for (const sent of ex.content.sentences) {
    answer[sent.id] = {};
    sent.parts.forEach((p, i) => {
      if (typeof p !== 'object') return;
      const key = `${sent.id}_${i}`;
      const placed = ds.gaps[key] || '';
      answer[sent.id][key] = placed;
      const isCorrect = placed.toLowerCase() === p.gap.toLowerCase();
      items[key] = isCorrect;
      total++;
      if (isCorrect) correct++;
    });
  }

  state.hwActive.exState[exId] = {
    done: true, answer,
    feedback: { allCorrect: correct === total, correct, total, items }
  };
  render();
};

window.hwOrderAdd = (exId, sentId, word) => {
  const os = state.hwActive.orderState[exId];
  if (!os) return;
  const sentState = os.sentences[sentId];
  if (!sentState) return;
  const idx = sentState.remaining.indexOf(word);
  if (idx !== -1) sentState.remaining.splice(idx, 1);
  sentState.placed.push(word);
  render();
};

window.hwOrderRemove = (exId, sentId, placedIdx) => {
  const os = state.hwActive.orderState[exId];
  if (!os) return;
  const sentState = os.sentences[sentId];
  if (!sentState) return;
  const word = sentState.placed.splice(placedIdx, 1)[0];
  sentState.remaining.push(word);
  render();
};

window.hwCheckWordOrdering = (exId) => {
  const ex = state.hwActive.assignment.exercises.find(e => e.id === exId);
  const os = state.hwActive.orderState[exId];
  if (!ex || !os) return;

  let total = 0, correct = 0;
  const answer = {};
  const items = {};

  for (const sent of ex.content.sentences) {
    const placed = os.sentences[sent.id]?.placed || [];
    answer[sent.id] = placed;
    const isCorrect = JSON.stringify(placed) === JSON.stringify(sent.correct);
    items[sent.id] = isCorrect;
    total++;
    if (isCorrect) correct++;
  }

  state.hwActive.exState[exId] = {
    done: true, answer,
    feedback: { allCorrect: correct === total, correct, total, items }
  };
  render();
};

window.hwOddSelect = (exId, itemId, word) => {
  const ex = state.hwActive.assignment.exercises.find(e => e.id === exId);
  if (!ex) return;
  const es = state.hwActive.exState[exId];
  if (!es.answer) es.answer = {};
  es.answer[itemId] = word;

  const allAnswered = ex.content.items.every(item => es.answer?.[item.id] !== undefined);
  if (allAnswered) {
    const total = ex.content.items.length;
    const correct = ex.content.items.filter(item => es.answer[item.id] === item.correct).length;
    es.done = true;
    es.feedback = { allCorrect: correct === total, correct, total };
  }
  render();
};

window.hwOpenAssignment = async (assignmentId) => {
  const assignment = state.hwAssignments.find(a => a.id === assignmentId);
  if (!assignment) return;

  const { data: submission } = await sb.from('homework_submissions')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', state.user.id)
    .maybeSingle();

  state.hwActive = initHwActive(assignment);
  if (submission) {
    state.hwActive.submission = submission;
    state.hwActive.exState = submission.answers || {};
  }
  render();
};

window.hwCloseAssignment = () => { state.hwActive = null; render(); };
window.hwSubmit = submitHomework;

window.hwStartCreate = (studentId) => {
  const student = state.students.find(s => s.id === studentId) || { id: studentId };
  state.hwCreating = true;
  state.hwCreateStudent = student;
  state.hwCreateNotes = '';
  state.hwPreview = null;
  render();
};

window.hwCancelCreate = () => {
  state.hwCreating = false;
  state.hwCreateStudent = null;
  state.hwCreateNotes = '';
  state.hwPreview = null;
  state.hwGenerating = false;
  render();
};

window.hwGenerate = async () => {
  const notes = document.getElementById('hw-lesson-notes')?.value || '';
  state.hwCreateNotes = notes;
  if (!notes.trim()) { showToast('Bitte beschreibe erst den Stundeninhalt.', 'error'); return; }
  await generateHomework(state.hwCreateStudent?.full_name || 'Schüler', notes);
};

window.hwRegenerateCreate = async () => {
  state.hwPreview = null;
  await generateHomework(state.hwCreateStudent?.full_name || 'Schüler', state.hwCreateNotes);
};

window.hwSave = saveHomework;

window.hwViewResultsBtn = async (assignmentId) => {
  await loadHomeworkResults(assignmentId);
};

window.hwCloseResults = () => {
  state.hwViewResults = null;
  state.hwResults = null;
  render();
};

// ========== HELPER ==========

function hwExTypeName(type) {
  return { type_in_gap: 'Lückentext', drag_to_gap: 'Wörter einordnen', word_ordering: 'Sätze ordnen', odd_one_out: 'Welches passt nicht?' }[type] || type;
}
