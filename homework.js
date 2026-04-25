// ========== HOMEWORK MODULE ==========

let _hwDragExId = null;
let _hwDragWord = null;

// ========== STATE INIT ==========

function initHwActive(assignment) {
  const exState = {}, dragState = {}, orderState = {};
  for (const ex of assignment.exercises) {
    exState[ex.id] = { done: false, answer: null, feedback: null };
    if (ex.type === 'drag_to_gap') {
      const gaps = {};
      for (const sent of ex.content.sentences)
        sent.parts.forEach((p, i) => { if (typeof p === 'object' && p.gap !== undefined) gaps[`${sent.id}_${i}`] = null; });
      dragState[ex.id] = { selected: null, gaps, available: [...ex.content.wordBank] };
    }
    if (ex.type === 'word_ordering') {
      const sentences = {};
      for (const sent of ex.content.sentences) sentences[sent.id] = { placed: [], remaining: [...sent.scrambled] };
      orderState[ex.id] = { sentences };
    }
  }
  return { assignment, exState, dragState, orderState, submission: null };
}

// ========== DATA FUNCTIONS ==========

async function loadHomework() {
  try {
    if (state.profile?.is_admin) {
      const { data: assignments, error } = await sb.from('homework_assignments')
        .select('id, title, student_id, teacher_id, instructions, due_date, status, created_at')
        .eq('teacher_id', state.user.id).order('created_at', { ascending: false });
      if (error) throw error;
      const studentIds    = [...new Set((assignments || []).map(a => a.student_id))];
      const assignmentIds = (assignments || []).map(a => a.id);
      let profileMap = {};
      if (studentIds.length)    { const { data: p } = await sb.from('profiles').select('id, full_name, email').in('id', studentIds); (p||[]).forEach(x => { profileMap[x.id] = x; }); }
      let submissionsMap = {};
      if (assignmentIds.length) { const { data: s } = await sb.from('homework_submissions').select('assignment_id, submitted_at').in('assignment_id', assignmentIds); (s||[]).forEach(x => { submissionsMap[x.assignment_id] = x; }); }
      let exerciseCounts = {};
      if (assignmentIds.length) { const { data: ae } = await sb.from('assignment_exercises').select('assignment_id').in('assignment_id', assignmentIds); (ae||[]).forEach(ae => { exerciseCounts[ae.assignment_id] = (exerciseCounts[ae.assignment_id]||0)+1; }); }
      state.hwAssignments = (assignments||[]).map(a => ({ ...a, studentProfile: profileMap[a.student_id]||null, exercise_count: exerciseCounts[a.id]||0 }));
      state.hwSubmissions = submissionsMap;
    } else {
      const { data: assignments } = await sb.from('homework_assignments')
        .select('id, title, student_id, teacher_id, instructions, status, created_at')
        .eq('student_id', state.user.id).order('created_at', { ascending: false });
      const assignmentIds = (assignments||[]).map(a => a.id);
      let exerciseCounts = {};
      if (assignmentIds.length) { const { data: ae } = await sb.from('assignment_exercises').select('assignment_id').in('assignment_id', assignmentIds); (ae||[]).forEach(ae => { exerciseCounts[ae.assignment_id] = (exerciseCounts[ae.assignment_id]||0)+1; }); }
      state.hwAssignments = (assignments||[]).map(a => ({ ...a, exercise_count: exerciseCounts[a.id]||0 }));
    }
  } catch (e) { console.error('loadHomework error:', e); state.hwAssignments = []; }
}

async function generateHomework() {
  state.hwGenerating = true; render();
  try {
    const studentId = state.hwCreateStudent.id;
    // Fetch recently reviewed vocab (last 30 days)
    const since = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    const { data: recentReviews } = await sb.from('reviews')
      .select('vocabulary_id, vocabulary(german, english)').eq('student_id', studentId).gte('created_at', since);
    const seenIds = new Set();
    const recentVocab = [];
    for (const r of (recentReviews||[])) {
      if (r.vocabulary && !seenIds.has(r.vocabulary_id)) { seenIds.add(r.vocabulary_id); recentVocab.push({ german: r.vocabulary.german, english: r.vocabulary.english }); }
    }
    // Fetch upcoming vocab (unlocked but not yet studied)
    const { data: progressRows } = await sb.from('srs_progress').select('vocabulary_id').eq('student_id', studentId);
    const learnedIds = new Set((progressRows||[]).map(p => p.vocabulary_id));
    const { data: unlockedSets } = await sb.from('unlocked_sets').select('set_id').eq('student_id', studentId);
    const setIds = (unlockedSets||[]).map(u => u.set_id);
    let upcomingVocab = [];
    if (setIds.length) {
      const { data: allVocab } = await sb.from('vocabulary').select('id, german, english').in('set_id', setIds).limit(60);
      upcomingVocab = (allVocab||[]).filter(v => !learnedIds.has(v.id)).slice(0,20).map(v => ({ german: v.german, english: v.english }));
    }
    // Only send AI-generatable slots (not vocab_session)
    const aiSlots = state.hwExerciseSlots.filter(s => s.type !== 'vocab_session');
    const { data, error } = await sb.functions.invoke('generate-homework', {
      body: { studentName: state.hwCreateStudent?.full_name || 'Schüler', exercises: aiSlots, recentVocab, upcomingVocab }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    // Merge AI exercises with manually-added vocab_session slots
    const vocabSessions = state.hwExerciseSlots.filter(s => s.type === 'vocab_session').map((s, i) => ({
      id: `vs_${i}`, type: 'vocab_session',
      instruction: `Lernen Sie die Vokabeln aus "${s.setName || 'dem Lernset'}"`,
      content: { set_id: s.setId, set_name: s.setName, min_cards: 10 }
    }));
    state.hwPreview = { title: data?.title || `Hausaufgaben – ${state.hwCreateStudent?.full_name||'Schüler'}`, exercises: [...(data?.exercises||[]), ...vocabSessions] };
  } catch (e) {
    console.error('Generate homework error:', e);
    showToast('Fehler beim Generieren. Bitte nochmal versuchen.', 'error');
    state.hwPreview = null;
  }
  state.hwGenerating = false; render();
}

async function saveHomework() {
  if (!state.hwPreview || !state.hwCreateStudent) return;
  const { data: newAssignment, error } = await sb.from('homework_assignments').insert({
    student_id: state.hwCreateStudent.id, teacher_id: state.user.id,
    title: state.hwPreview.title, instructions: state.hwCreateNotes||'', status: 'pending',
  }).select().single();
  if (error) { showToast('Fehler beim Speichern: ' + error.message, 'error'); return; }
  for (const [i, ex] of state.hwPreview.exercises.entries()) {
    const { data: newEx, error: exErr } = await sb.from('exercises').insert({
      created_by: state.user.id, exercise_type: ex.type, title: ex.instruction||'', content: ex.content||{},
    }).select().single();
    if (exErr) { console.error('Exercise insert error:', exErr); continue; }
    await sb.from('assignment_exercises').insert({ assignment_id: newAssignment.id, exercise_id: newEx.id, order_index: i });
  }
  showToast('Hausaufgaben gespeichert!', 'success');
  state.hwCreating = false; state.hwCreateStudent = null; state.hwCreateNotes = ''; state.hwPreview = null; state.hwExerciseSlots = []; state.hwEditIdx = null;
  await loadHomework(); render();
}

async function submitHomework() {
  if (!state.hwActive) return;
  const { assignment, exState } = state.hwActive;
  const { data: submission, error: subError } = await sb.from('homework_submissions').insert({
    assignment_id: assignment.id, student_id: state.user.id,
  }).select().single();
  if (subError) { showToast('Fehler beim Einreichen: ' + subError.message, 'error'); return; }
  const responseRows = assignment.exercises.map(ex => ({
    submission_id: submission.id, exercise_id: ex.id,
    response: exState[ex.id] || {},
    is_correct: exState[ex.id]?.feedback?.allCorrect ?? null,
  }));
  if (responseRows.length) await sb.from('exercise_responses').insert(responseRows);
  const { error: statusError } = await sb.from('homework_assignments').update({ status: 'submitted' }).eq('id', assignment.id);
  if (statusError) { showToast('Fehler beim Status-Update: ' + statusError.message, 'error'); return; }
  showToast('Hausaufgaben eingereicht!', 'success');
  state.hwActive.submission = { submitted_at: new Date().toISOString() };
  await loadHomework(); render();
}

async function loadHomeworkResults(assignmentId) {
  const { data: submission } = await sb.from('homework_submissions')
    .select('id, submitted_at, feedback').eq('assignment_id', assignmentId).maybeSingle();
  let fullSubmission = null;
  if (submission) {
    const { data: responses } = await sb.from('exercise_responses')
      .select('id, exercise_id, response, is_correct, teacher_correct').eq('submission_id', submission.id);
    const answers = {}, corrections = {};
    (responses||[]).forEach(r => {
      answers[r.exercise_id] = r.response;
      corrections[r.exercise_id] = { id: r.id, is_correct: r.is_correct, teacher_correct: r.teacher_correct };
    });
    fullSubmission = { ...submission, answers, corrections };
  }
  const { data: aeRows } = await sb.from('assignment_exercises')
    .select('order_index, exercises(*)').eq('assignment_id', assignmentId).order('order_index');
  const exercises = (aeRows||[]).map(ae => ({ id: ae.exercises.id, type: ae.exercises.exercise_type, instruction: ae.exercises.title, content: ae.exercises.content }));
  const assignment = state.hwAssignments.find(a => a.id === assignmentId);
  if (assignment) assignment.exercises = exercises;
  state.hwResults = fullSubmission;
  state.hwViewResults = assignmentId;
  state.hwCorrections = {};
  if (fullSubmission) {
    Object.entries(fullSubmission.corrections).forEach(([exId, c]) => {
      state.hwCorrections[exId] = c.teacher_correct !== null ? c.teacher_correct : c.is_correct;
    });
  }
  render();
}

async function saveCorrections() {
  const assignmentId = state.hwViewResults;
  const corrections = state.hwCorrections || {};
  const responses = state.hwResults?.corrections || {};
  for (const [exId, isCorrect] of Object.entries(corrections)) {
    const resp = responses[exId];
    if (resp?.id) await sb.from('exercise_responses').update({ teacher_correct: isCorrect }).eq('id', resp.id);
  }
  await sb.from('homework_assignments').update({ status: 'corrected' }).eq('id', assignmentId);
  showToast('Hausaufgaben korrigiert!', 'success');
  state.hwViewResults = null; state.hwResults = null; state.hwCorrections = {};
  await loadHomework(); render();
}

// ========== MAIN ROUTER ==========

function buildHomework() {
  if (state.profile?.is_admin) {
    if (state.hwViewResults)  return buildHomeworkTeacherCorrect();
    if (state.hwCreating)     return buildHomeworkTeacherCreate();
    if (state.hwStudentView)  return buildHomeworkTeacherStudentView();
    return buildHomeworkTeacher();
  }
  if (state.hwStudentResultView && state.hwViewResults) return buildHomeworkStudentCorrectedResult();
  if (state.hwActive) return buildHomeworkStudentActive();
  return buildHomeworkStudent();
}

// ========== HELPERS ==========

function hwExTypeColor(type) {
  return { type_in_gap:'var(--accent)', drag_to_gap:'#7c3aed', word_ordering:'var(--orange)', odd_one_out:'var(--green)', conjugation_table:'#0891b2', error_correction:'var(--red)', sentence_transformation:'#6366f1', mini_dialogue:'#ec4899', word_association:'#f59e0b', vocab_session:'var(--green)' }[type]||'var(--accent)';
}
function hwExTypeIcon(type) {
  return { type_in_gap:'✏️', drag_to_gap:'🧩', word_ordering:'🔀', odd_one_out:'🔍', conjugation_table:'📊', error_correction:'✗', sentence_transformation:'🔄', mini_dialogue:'💬', word_association:'💡', vocab_session:'📚' }[type]||'📝';
}
function hwExTypeName(type) {
  return { type_in_gap:'Lückentext', drag_to_gap:'Wörter einordnen', word_ordering:'Sätze ordnen', odd_one_out:'Welches passt nicht?', conjugation_table:'Konjugation', error_correction:'Fehlerkorrektur', sentence_transformation:'Satztransformation', mini_dialogue:'Mini-Dialog', word_association:'Wortassoziationen', vocab_session:'Vokabeln lernen' }[type]||type;
}
function hwExTypeAutoGraded(type) {
  return ['type_in_gap','drag_to_gap','word_ordering','odd_one_out','conjugation_table','error_correction','sentence_transformation'].includes(type);
}

function buildExerciseHeader(ex, idx, es) {
  const color = hwExTypeColor(ex.type), icon = hwExTypeIcon(ex.type), name = hwExTypeName(ex.type);
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-left:2px">
    <span style="font-size:15px">${icon}</span>
    <span style="font-size:11px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:0.6px">Aufgabe ${(idx??0)+1} · ${name}</span>
    ${es?.done ? `<span style="color:var(--green);font-size:13px;margin-left:auto">✓ Fertig</span>` : ''}
  </div>`;
}

function buildFeedbackBar(feedback) {
  if (!feedback) return '';
  return `<div class="ex-feedback ${feedback.allCorrect?'correct':'partial'}" style="margin-top:14px">
    ${feedback.allCorrect ? '🎉 Alles richtig!' : `${feedback.correct} von ${feedback.total} richtig`}
  </div>`;
}

// ========== TEACHER OVERVIEW ==========

function buildHomeworkTeacher() {
  const students = state.students||[], assignments = state.hwAssignments||[];
  const statsMap = {};
  for (const a of assignments) {
    if (!statsMap[a.student_id]) statsMap[a.student_id] = { pending:0, submitted:0, corrected:0 };
    if (a.status==='corrected') statsMap[a.student_id].corrected++;
    else if (a.status==='submitted') statsMap[a.student_id].submitted++;
    else statsMap[a.student_id].pending++;
  }
  if (!students.length) return `<div class="page-header"><div><div class="page-title">Hausaufgaben</div><div class="page-sub">Aufgaben erstellen und Abgaben einsehen</div></div></div><div class="card" style="text-align:center;padding:56px"><div style="font-size:40px;margin-bottom:12px">👥</div><p style="color:var(--text2)">Noch keine Schüler vorhanden.</p></div>`;
  const COLS = '1fr 90px 90px 90px 180px';
  return `<div class="page-header"><div><div class="page-title">Hausaufgaben</div><div class="page-sub">Aufgaben erstellen und Abgaben einsehen</div></div>
    <button class="btn btn-ghost btn-sm" onclick="hwRefresh()" style="display:flex;align-items:center;gap:6px">↻ Aktualisieren</button>
  </div>
  <div class="l-table">
    <div class="l-thead" style="grid-template-columns:${COLS}"><div class="l-th">Schüler</div><div class="l-th" style="text-align:center">Offen</div><div class="l-th" style="text-align:center">Eingereicht</div><div class="l-th" style="text-align:center">Korrigiert</div><div class="l-th"></div></div>
    ${students.map((s,i)=>{
      const st = statsMap[s.id]||{pending:0,submitted:0,corrected:0};
      const total = st.pending+st.submitted+st.corrected;
      const initials=(s.full_name||s.email||'?').slice(0,2).toUpperCase();
      const avatarBg=['var(--accent)','var(--green)','var(--orange)'][i%3];
      const rowColor=['c-blue','c-green','c-orange'][i%3];
      return `<div class="l-row ${rowColor}" style="grid-template-columns:${COLS}">
        <div class="l-cell" style="display:flex;align-items:center;gap:12px">
          <div style="width:34px;height:34px;border-radius:50%;background:${avatarBg};color:white;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${initials}</div>
          <div><div style="font-size:14px;font-weight:700">${escHtml(s.full_name||'—')}</div><div style="font-size:12px;color:var(--text3)">${escHtml(s.email||'')}</div></div>
        </div>
        <div class="l-cell" style="text-align:center"><span style="font-size:18px;font-weight:900;color:${st.pending>0?'var(--orange)':'var(--text3)'}">${st.pending}</span></div>
        <div class="l-cell" style="text-align:center"><span style="font-size:18px;font-weight:900;color:${st.submitted>0?'var(--accent)':'var(--text3)'}">${st.submitted}</span></div>
        <div class="l-cell" style="text-align:center"><span style="font-size:18px;font-weight:900;color:${st.corrected>0?'var(--green)':'var(--text3)'}">${st.corrected}</span></div>
        <div class="l-cell" style="display:flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="hwStudentViewBtn('${s.id}')">Aufgaben${total>0?` (${total})`:''} →</button>
          <button class="btn btn-primary btn-sm" onclick="hwStartCreate('${s.id}')">+ Erstellen</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function buildHomeworkTeacherStudentView() {
  const studentId = state.hwStudentView;
  const student = (state.students||[]).find(s=>s.id===studentId);
  const assignments = (state.hwAssignments||[]).filter(a=>a.student_id===studentId);
  const studentName = student?.full_name||student?.email||'Schüler';
  const statusLabel = a => ({ pending:'Ausstehend', submitted:'Eingereicht', corrected:'✓ Korrigiert' }[a.status]||a.status);
  const statusChipClass = a => ({ submitted:'blue', corrected:'green' }[a.status]||'');
  return `<div style="max-width:700px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
      <button class="btn btn-ghost btn-sm" onclick="hwStudentViewBack()">← Zurück</button>
      <div style="flex:1"><h1 class="section-title" style="margin:0">Hausaufgaben</h1><p class="text-muted text-sm">${studentName}</p></div>
      <button class="btn btn-primary btn-sm" onclick="hwStartCreate('${studentId}')">+ Erstellen</button>
    </div>
    ${!assignments.length ? `<div class="card" style="text-align:center;padding:48px"><div style="font-size:40px;margin-bottom:16px">📭</div><p class="text-muted">Noch keine Hausaufgaben für ${studentName}.</p></div>`
    : assignments.map(a=>{
      const date = new Date(a.created_at).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
      const sub = (state.hwSubmissions||{})[a.id];
      return `<div class="card mb-3" style="display:flex;align-items:center;gap:16px;padding:16px 20px">
        <div style="width:42px;height:42px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📝</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:15px;margin-bottom:3px">${a.title}</div>
          <div class="text-muted text-sm">${date} · ${a.exercise_count||0} Übungen${sub?.submitted_at?' · Eingereicht am '+new Date(sub.submitted_at).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}):''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <span class="chip ${statusChipClass(a)}" style="font-size:11px">${statusLabel(a)}</span>
          ${a.status==='submitted'||a.status==='corrected' ? `<button class="btn btn-ghost btn-sm" onclick="hwViewResultsBtn('${a.id}')">${a.status==='submitted'?'Korrigieren':'Details'}</button>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ========== TEACHER CREATION ==========

function buildHomeworkTeacherCreate() {
  const student = state.hwCreateStudent;
  const slots = state.hwExerciseSlots||[];
  const editIdx = state.hwEditIdx;

  // If we're editing an exercise in the preview
  if (state.hwPreview && editIdx !== null) return buildHwInlineEditor(editIdx);

  return `<div style="max-width:680px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
      <button class="btn btn-ghost btn-sm" onclick="hwCancelCreate()">← Zurück</button>
      <div><h1 class="section-title" style="margin:0">Hausaufgaben erstellen</h1><p class="text-muted text-sm">für ${escHtml(student?.full_name||student?.email||'Schüler')}</p></div>
    </div>

    ${!state.hwPreview ? `
      <!-- SLOT BUILDER -->
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-bottom:4px">Aufgaben konfigurieren</h3>
        <p class="text-muted text-sm" style="margin-bottom:20px">Lege fest welche Übungen generiert werden sollen.</p>

        ${slots.length===0 ? `<p class="text-muted text-sm" style="text-align:center;padding:20px 0">Noch keine Aufgaben. Füge eine hinzu.</p>` : ''}

        ${slots.map((slot, i) => buildHwSlotRow(slot, i)).join('')}

        <button class="btn btn-ghost btn-sm" style="margin-top:12px;width:100%" onclick="hwAddSlot()">+ Aufgabe hinzufügen</button>
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-bottom:8px">Notizen für diese Stunde (optional)</h3>
        <textarea id="hw-lesson-notes" rows="3"
          style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:10px;font-family:inherit;font-size:14px;resize:vertical;background:var(--surface2);color:var(--text)"
          placeholder="z.B. Wir haben Perfekt geübt, Schüler hatte Schwierigkeiten mit Hilfsverb sein."
        >${escHtml(state.hwCreateNotes||'')}</textarea>
      </div>

      <button class="btn btn-primary" style="width:100%;padding:14px"
        ${state.hwGenerating||!slots.filter(s=>s.type!=='vocab_session').length ? 'disabled' : ''}
        onclick="hwGenerate()">
        ${state.hwGenerating
          ? `<span style="display:inline-flex;align-items:center;gap:10px"><span class="hw-spinner"></span>KI generiert Übungen…</span>`
          : '✨ Übungen generieren'}
      </button>

    ` : `
      <!-- PREVIEW + EDIT -->
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div>
            <h3 style="margin:0">${escHtml(state.hwPreview.title)}</h3>
            <p class="text-muted text-sm" style="margin-top:4px">${state.hwPreview.exercises.length} Übungen generiert</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="hwRegenerateCreate()">↺ Neu generieren</button>
        </div>

        ${state.hwPreview.exercises.map((ex, i) => `
          <div style="margin-bottom:12px;border:1.5px solid var(--border);border-radius:12px;overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--surface2);border-bottom:1.5px solid var(--border)">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:15px">${hwExTypeIcon(ex.type)}</span>
                <span style="font-size:11px;font-weight:800;color:${hwExTypeColor(ex.type)};text-transform:uppercase;letter-spacing:0.5px">${hwExTypeName(ex.type)}</span>
              </div>
              <button class="btn btn-ghost btn-sm" onclick="hwOpenEdit(${i})">Bearbeiten ✏️</button>
            </div>
            <div style="padding:12px 14px">
              <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">${escHtml(ex.instruction)}</div>
              ${buildExercisePreviewSummary(ex)}
            </div>
          </div>
        `).join('')}
      </div>

      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" style="flex:1" onclick="hwCancelPreview()">← Zurück</button>
        <button class="btn btn-primary" style="flex:2" onclick="hwSave()">✓ Speichern & senden</button>
      </div>
    `}
  </div>`;
}

function buildHwSlotRow(slot, i) {
  const allTypes = ['type_in_gap','drag_to_gap','word_ordering','odd_one_out','conjugation_table','error_correction','sentence_transformation','mini_dialogue','word_association','vocab_session'];
  const isVocabSession = slot.type === 'vocab_session';
  const unlockedSets = state.unlockedForStudent||[];

  return `<div style="border:1.5px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;background:var(--surface)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:${isVocabSession?'8':'10'}px;flex-wrap:wrap">
      <select style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)"
        onchange="hwUpdateSlot(${i},'type',this.value)">
        ${allTypes.map(t=>`<option value="${t}" ${slot.type===t?'selected':''}>${hwExTypeIcon(t)} ${hwExTypeName(t)}</option>`).join('')}
      </select>
      ${!isVocabSession ? `
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <input type="range" min="1" max="20" value="${slot.count||4}"
            style="width:90px;accent-color:var(--accent);cursor:pointer"
            oninput="hwUpdateSlot(${i},'count',parseInt(this.value),true);this.nextElementSibling.textContent=this.value"
            onchange="hwUpdateSlot(${i},'count',parseInt(this.value))">
          <span style="font-size:12px;font-weight:700;color:var(--accent);min-width:18px;text-align:center">${slot.count||4}</span>
        </div>
      ` : ''}
      <button class="btn btn-ghost btn-sm" style="margin-left:auto;color:var(--red);opacity:0.7" onclick="hwRemoveSlot(${i})">✕</button>
    </div>
    ${isVocabSession ? `
      <select style="width:100%;padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)"
        onchange="hwUpdateSlotVocab(${i},this.value,this.options[this.selectedIndex].text)">
        <option value="">— Lernset wählen —</option>
        ${unlockedSets.map(s=>`<option value="${s.set_id||s.id}" ${(slot.setId===s.set_id||slot.setId===s.id)?'selected':''}>${s.level} – ${s.chapter||s.name}</option>`).join('')}
      </select>
    ` : `
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input type="text" value="${escHtml(slot.grammarFocus||'')}" placeholder="Grammatik (z.B. Perfekt mit sein)"
          style="flex:2;min-width:140px;padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)"
          oninput="hwUpdateSlot(${i},'grammarFocus',this.value,true)" onblur="render()">
        <input type="text" value="${escHtml(slot.theme||'')}" placeholder="Thema (z.B. Restaurant)"
          style="flex:1;min-width:100px;padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)"
          oninput="hwUpdateSlot(${i},'theme',this.value,true)" onblur="render()">
        <select style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)"
          onchange="hwUpdateSlot(${i},'vocabSource',this.value)">
          <option value="recent_30d" ${slot.vocabSource==='recent_30d'?'selected':''}>Letzte 30 Tage</option>
          <option value="recent_14d" ${slot.vocabSource==='recent_14d'?'selected':''}>Letzte 14 Tage</option>
          <option value="upcoming"   ${slot.vocabSource==='upcoming'  ?'selected':''}>Neue Vokabeln</option>
          <option value="all"        ${slot.vocabSource==='all'       ?'selected':''}>Alle</option>
          <option value="none"       ${slot.vocabSource==='none'      ?'selected':''}>Keine</option>
        </select>
      </div>
    `}
  </div>`;
}

function buildExercisePreviewSummary(ex) {
  if (ex.type === 'type_in_gap' || ex.type === 'drag_to_gap') {
    return `<div style="font-size:12px;color:var(--text2)">${ex.content.sentences?.length||0} Sätze</div>`;
  }
  if (ex.type === 'word_ordering') return `<div style="font-size:12px;color:var(--text2)">${ex.content.sentences?.length||0} Sätze</div>`;
  if (ex.type === 'odd_one_out')   return `<div style="font-size:12px;color:var(--text2)">${ex.content.items?.length||0} Gruppen</div>`;
  if (ex.type === 'conjugation_table') return `<div style="font-size:12px;color:var(--text2)">${escHtml(ex.content.verb||'')} — ${escHtml(ex.content.tense||'')}</div>`;
  if (ex.type === 'error_correction') return `<div style="font-size:12px;color:var(--text2)">${ex.content.sentences?.length||0} Sätze</div>`;
  if (ex.type === 'sentence_transformation') return `<div style="font-size:12px;color:var(--text2)">${escHtml(ex.content.transformation||'')} · ${ex.content.sentences?.length||0} Sätze</div>`;
  if (ex.type === 'mini_dialogue') return `<div style="font-size:12px;color:var(--text2)">${escHtml(ex.content.context||'')} · ${ex.content.turns?.filter(t=>t.speaker==='student').length||0} Schülerzeilen</div>`;
  if (ex.type === 'word_association') return `<div style="font-size:12px;color:var(--text2)">Thema: ${escHtml(ex.content.topic||'')} · ${ex.content.count||5} Wörter</div>`;
  if (ex.type === 'vocab_session') return `<div style="font-size:12px;color:var(--text2)">${escHtml(ex.content.set_name||'')}</div>`;
  return '';
}

// ========== INLINE EDITOR ==========

function buildHwInlineEditor(idx) {
  const ex = state.hwPreview.exercises[idx];
  const student = state.hwCreateStudent;
  return `<div style="max-width:680px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
      <button class="btn btn-ghost btn-sm" onclick="hwCloseEdit()">← Zurück zur Vorschau</button>
      <div>
        <h1 class="section-title" style="margin:0">${hwExTypeIcon(ex.type)} ${hwExTypeName(ex.type)} bearbeiten</h1>
        <p class="text-muted text-sm">für ${escHtml(student?.full_name||student?.email||'Schüler')}</p>
      </div>
    </div>
    <div class="card">
      <div class="form-group" style="margin-bottom:16px">
        <label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Anweisung</label>
        <input id="edit-instruction" type="text" value="${escHtml(ex.instruction)}"
          style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text)">
      </div>
      ${buildEditorBody(ex, idx)}
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn btn-ghost" style="flex:1" onclick="hwCloseEdit()">Abbrechen</button>
        <button class="btn btn-primary" style="flex:2" onclick="hwApplyEdit(${idx})">✓ Übernehmen</button>
      </div>
    </div>
  </div>`;
}

function buildEditorBody(ex, idx) {
  if (ex.type === 'type_in_gap' || ex.type === 'drag_to_gap') {
    const wb = ex.type === 'drag_to_gap' ? `
      <div class="form-group" style="margin-bottom:16px">
        <label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Wortkasten (kommagetrennt)</label>
        <input id="edit-wordbank" type="text" value="${escHtml((ex.content.wordBank||[]).join(', '))}"
          style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text)">
      </div>` : '';
    return `${wb}<label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">Sätze</label>
      <p class="text-muted text-sm" style="margin-bottom:10px">Text in normalen Feldern, Lückenwort im grünen Feld daneben.</p>
      ${(ex.content.sentences||[]).map((sent,si)=>`
        <div style="border:1.5px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Satz ${si+1} (ID: ${sent.id})</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
            ${(sent.parts||[]).map((p,pi)=>typeof p==='string'
              ? `<input type="text" class="edit-part-text" data-si="${si}" data-pi="${pi}" value="${escHtml(p)}"
                  style="width:${Math.max(40,p.length*8)}px;min-width:40px;padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)">`
              : `<span style="display:inline-flex;align-items:center;gap:3px"><span style="font-size:10px;color:var(--green);font-weight:700">LÜCKE:</span>
                  <input type="text" class="edit-part-gap" data-si="${si}" data-pi="${pi}" value="${escHtml(p.gap)}"
                    style="width:${Math.max(60,p.gap.length*9)}px;min-width:60px;padding:4px 6px;border:2px solid var(--green);border-radius:6px;font-family:inherit;font-size:13px;background:rgba(34,192,107,0.06);color:var(--text)"></span>`
            ).join('')}
          </div>
        </div>
      `).join('')}`;
  }
  if (ex.type === 'word_ordering') {
    return `<label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">Sätze</label>
      ${(ex.content.sentences||[]).map((sent,si)=>`
        <div style="border:1.5px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Satz ${si+1}</div>
          <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Richtige Reihenfolge (Wörter durch Leerzeichen getrennt)</label>
          <input type="text" class="edit-order-correct" data-si="${si}" value="${escHtml((sent.correct||[]).join(' '))}"
            style="width:100%;padding:8px 10px;border:1.5px solid var(--green);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)">
        </div>
      `).join('')}`;
  }
  if (ex.type === 'odd_one_out') {
    return `<label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">Gruppen</label>
      ${(ex.content.items||[]).map((item,ii)=>`
        <div style="border:1.5px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Gruppe ${ii+1}</div>
          <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Wörter (kommagetrennt)</label>
          <input type="text" class="edit-ooo-words" data-ii="${ii}" value="${escHtml((item.words||[]).join(', '))}"
            style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text);margin-bottom:6px">
          <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Das falsche Wort (Antwort)</label>
          <input type="text" class="edit-ooo-correct" data-ii="${ii}" value="${escHtml(item.correct||'')}"
            style="width:100%;padding:8px 10px;border:2px solid var(--green);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)">
        </div>
      `).join('')}`;
  }
  if (ex.type === 'conjugation_table') {
    return `<div style="display:flex;gap:10px;margin-bottom:16px">
        <div style="flex:1"><label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Verb</label>
          <input id="edit-verb" type="text" value="${escHtml(ex.content.verb||'')}" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text)"></div>
        <div style="flex:1"><label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Zeitform</label>
          <input id="edit-tense" type="text" value="${escHtml(ex.content.tense||'')}" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text)"></div>
      </div>
      <label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">Konjugationsformen</label>
      ${(ex.content.rows||[]).map((row,ri)=>`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:13px;font-weight:700;color:var(--text2);min-width:80px">${escHtml(row.pronoun)}</span>
          <input type="text" class="edit-conj-answer" data-ri="${ri}" value="${escHtml(row.answer||'')}"
            style="flex:1;padding:7px 10px;border:2px solid var(--green);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)">
        </div>
      `).join('')}`;
  }
  if (ex.type === 'error_correction') {
    return `<label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">Sätze</label>
      ${(ex.content.sentences||[]).map((sent,si)=>`
        <div style="border:1.5px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Satz ${si+1}</div>
          <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Falscher Satz (mit Fehler)</label>
          <input type="text" class="edit-ec-text" data-si="${si}" value="${escHtml(sent.text||'')}"
            style="width:100%;padding:8px 10px;border:1.5px solid var(--red);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text);margin-bottom:6px">
          <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Richtige Antwort</label>
          <input type="text" class="edit-ec-answer" data-si="${si}" value="${escHtml(sent.answer||'')}"
            style="width:100%;padding:8px 10px;border:2px solid var(--green);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)">
        </div>
      `).join('')}`;
  }
  if (ex.type === 'sentence_transformation') {
    return `<div class="form-group" style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Transformationsregel</label>
        <input id="edit-transformation" type="text" value="${escHtml(ex.content.transformation||'')}"
          style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text)">
      </div>
      <label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">Sätze</label>
      ${(ex.content.sentences||[]).map((sent,si)=>`
        <div style="border:1.5px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Satz ${si+1}</div>
          <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Originalsatz</label>
          <input type="text" class="edit-st-original" data-si="${si}" value="${escHtml(sent.original||'')}"
            style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text);margin-bottom:6px">
          <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Richtige Antwort</label>
          <input type="text" class="edit-st-answer" data-si="${si}" value="${escHtml(sent.answer||'')}"
            style="width:100%;padding:8px 10px;border:2px solid var(--green);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)">
        </div>
      `).join('')}`;
  }
  if (ex.type === 'mini_dialogue') {
    return `<div class="form-group" style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Kontext</label>
        <input id="edit-context" type="text" value="${escHtml(ex.content.context||'')}"
          style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text)">
      </div>
      <label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">Gesprächszeilen</label>
      ${(ex.content.turns||[]).map((turn,ti)=>`
        <div style="border:1.5px solid ${turn.speaker==='student'?'var(--accent)':'var(--border)'};border-radius:8px;padding:10px;margin-bottom:6px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">${turn.speaker==='student'?'👤 Schüler':'💬 '+escHtml(turn.name||'')}</div>
          ${turn.speaker==='student'
            ? `<input type="text" class="edit-turn-hint" data-ti="${ti}" value="${escHtml(turn.hint||'')}" placeholder="Hinweis auf Englisch"
                style="width:100%;padding:7px 10px;border:1.5px solid var(--accent);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)">`
            : `<input type="text" class="edit-turn-text" data-ti="${ti}" value="${escHtml(turn.text||'')}"
                style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface2);color:var(--text)">`}
        </div>
      `).join('')}`;
  }
  if (ex.type === 'word_association') {
    return `<div style="display:flex;gap:10px">
      <div style="flex:2"><label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Thema</label>
        <input id="edit-topic" type="text" value="${escHtml(ex.content.topic||'')}"
          style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text)"></div>
      <div style="flex:1"><label style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Anzahl Wörter</label>
        <input id="edit-count" type="number" min="3" max="10" value="${ex.content.count||5}"
          style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text)"></div>
    </div>`;
  }
  if (ex.type === 'vocab_session') {
    return `<div style="padding:12px;background:var(--surface2);border-radius:8px;font-size:14px;color:var(--text2)">
      Vokabeln-Lernset: <strong>${escHtml(ex.content.set_name||'')}</strong><br>
      <span style="font-size:12px">Dieses Lernset kann nur im Slot-Konfigurator geändert werden.</span></div>`;
  }
  return '';
}

// ========== TEACHER CORRECTION ==========

function buildHomeworkTeacherCorrect() {
  const assignmentId = state.hwViewResults;
  const assignment = state.hwAssignments.find(a=>a.id===assignmentId);
  const submission = state.hwResults;
  if (!assignment) return `<button class="btn btn-ghost" onclick="hwCloseResults()">← Zurück</button>`;
  const studentName = assignment.studentProfile?.full_name || assignment.studentProfile?.email || 'Schüler';
  const corrections = state.hwCorrections||{};
  return `<div style="max-width:700px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
      <button class="btn btn-ghost btn-sm" onclick="hwCloseResults()">← Zurück</button>
      <div><h1 class="section-title" style="margin:0">${escHtml(assignment.title)}</h1>
        <p class="text-muted text-sm">${studentName} · ${new Date(assignment.created_at).toLocaleDateString('de-DE')}</p></div>
    </div>
    ${!submission ? `<div class="card" style="text-align:center;padding:48px">
        <div style="font-size:48px;margin-bottom:16px">⏳</div>
        <h3>Noch nicht eingereicht</h3>
        <p class="text-muted text-sm">Der Schüler hat die Hausaufgaben noch nicht abgeschlossen.</p>
      </div>`
    : `
      ${(assignment.exercises||[]).map((ex,i)=>{
        const exState = submission.answers?.[ex.id];
        const corrItem = submission.corrections?.[ex.id];
        const overrideVal = corrections.hasOwnProperty(ex.id) ? corrections[ex.id] : (corrItem?.teacher_correct !== null && corrItem?.teacher_correct !== undefined ? corrItem.teacher_correct : corrItem?.is_correct);
        const isAutoGraded = hwExTypeAutoGraded(ex.type);
        const hasResponse = !!exState;
        return `<div class="card mb-3" style="border-top:3px solid ${hwExTypeColor(ex.type)}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:15px">${hwExTypeIcon(ex.type)}</span>
              <span style="font-size:11px;font-weight:800;color:${hwExTypeColor(ex.type)};text-transform:uppercase;letter-spacing:0.5px">Aufgabe ${i+1} · ${hwExTypeName(ex.type)}</span>
              ${isAutoGraded && corrItem?.is_correct !== null && corrItem?.is_correct !== undefined
                ? `<span style="font-size:11px;color:var(--text2);background:var(--surface2);padding:2px 8px;border-radius:20px">Auto: ${corrItem.is_correct?'✓':'✗'}</span>` : ''}
            </div>
            ${hasResponse ? `<div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:12px;color:var(--text2)">Korrektur:</span>
              <button onclick="hwToggleCorrection('${ex.id}', true)"
                style="padding:4px 12px;border-radius:6px;font-size:13px;font-weight:700;border:2px solid ${overrideVal===true?'var(--green)':'var(--border)'};background:${overrideVal===true?'rgba(34,192,107,0.12)':'transparent'};color:${overrideVal===true?'var(--green)':'var(--text2)'};cursor:pointer">✓</button>
              <button onclick="hwToggleCorrection('${ex.id}', false)"
                style="padding:4px 12px;border-radius:6px;font-size:13px;font-weight:700;border:2px solid ${overrideVal===false?'var(--red)':'var(--border)'};background:${overrideVal===false?'rgba(240,74,90,0.1)':'transparent'};color:${overrideVal===false?'var(--red)':'var(--text2)'};cursor:pointer">✗</button>
            </div>` : ''}
          </div>
          <div style="font-weight:600;margin-bottom:12px;color:var(--text)">${escHtml(ex.instruction)}</div>
          ${!hasResponse ? `<p class="text-muted text-sm">Keine Antwort abgegeben.</p>` : buildExerciseResultsView(ex, exState)}
        </div>`;
      }).join('')}
      <div style="padding:20px 0">
        <button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px" onclick="hwSaveCorrections()">
          ✓ Als korrigiert markieren & speichern
        </button>
      </div>
    `}
  </div>`;
}

// ========== STUDENT CORRECTED RESULT VIEW ==========

function buildHomeworkStudentCorrectedResult() {
  const assignmentId = state.hwViewResults;
  const assignment = state.hwAssignments.find(a=>a.id===assignmentId);
  const submission = state.hwResults;
  if (!assignment || !submission) return `<button class="btn btn-ghost" onclick="hwCloseResults()">← Zurück</button>`;
  const exercises = assignment.exercises||[];
  let correct=0, total=0;
  for (const ex of exercises) {
    if (!hwExTypeAutoGraded(ex.type) && ex.type!=='vocab_session') continue;
    const corrItem = submission.corrections?.[ex.id];
    const finalResult = corrItem?.teacher_correct !== null && corrItem?.teacher_correct !== undefined ? corrItem.teacher_correct : corrItem?.is_correct;
    if (finalResult !== null && finalResult !== undefined) { total++; if (finalResult) correct++; }
  }
  return `<div style="max-width:700px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
      <button class="btn btn-ghost btn-sm" onclick="hwCloseResults()">← Zurück</button>
      <div><h1 class="section-title" style="margin:0">${escHtml(assignment.title)}</h1>
        <p class="text-muted text-sm">${new Date(assignment.created_at).toLocaleDateString('de-DE')} · Korrigiert</p></div>
    </div>
    ${total>0?`<div class="card mb-3" style="text-align:center;padding:24px">
      <div style="font-size:36px;font-weight:800;color:${correct/total>=0.8?'var(--green)':correct/total>=0.5?'var(--orange)':'var(--red)'}">${correct}/${total}</div>
      <p class="text-muted text-sm" style="margin:4px 0 0">richtige Aufgaben</p>
    </div>`:''}
    ${submission.feedback?`<div class="card mb-3" style="background:rgba(34,192,107,0.05);border-left:3px solid var(--green)">
      <p style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text2);margin:0 0 6px">Kommentar der Lehrkraft</p>
      <p style="margin:0">${escHtml(submission.feedback)}</p>
    </div>`:''}
    ${exercises.map((ex,i)=>{
      const exState = submission.answers?.[ex.id];
      const corrItem = submission.corrections?.[ex.id];
      const finalResult = corrItem?.teacher_correct !== null && corrItem?.teacher_correct !== undefined ? corrItem.teacher_correct : corrItem?.is_correct;
      const isAutoGraded = hwExTypeAutoGraded(ex.type);
      const hasResponse = !!exState;
      return `<div class="card mb-3" style="border-top:3px solid ${finalResult===true?'var(--green)':finalResult===false?'var(--red)':hwExTypeColor(ex.type)}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:15px">${hwExTypeIcon(ex.type)}</span>
            <span style="font-size:11px;font-weight:800;color:${hwExTypeColor(ex.type)};text-transform:uppercase;letter-spacing:0.5px">Aufgabe ${i+1} · ${hwExTypeName(ex.type)}</span>
          </div>
          ${finalResult===true?`<span style="color:var(--green);font-weight:700;font-size:14px">✓ Richtig</span>`:finalResult===false?`<span style="color:var(--red);font-weight:700;font-size:14px">✗ Falsch</span>`:`<span style="color:var(--text2);font-size:12px">— Keine Beurteilung</span>`}
        </div>
        <div style="font-weight:600;margin-bottom:12px;color:var(--text)">${escHtml(ex.instruction)}</div>
        ${!hasResponse?`<p class="text-muted text-sm">Keine Antwort abgegeben.</p>`:buildExerciseResultsView(ex,exState)}
      </div>`;
    }).join('')}
  </div>`;
}

// ========== STUDENT UI ==========

function buildHomeworkStudent() {
  const assignments = state.hwAssignments||[];
  if (!assignments.length) return `<div style="display:flex;flex-direction:column;align-items:center;padding:80px 24px;text-align:center">
    <div style="width:88px;height:88px;border-radius:24px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:40px;margin-bottom:24px;border:1.5px solid var(--border)">📝</div>
    <h2 style="font-size:24px;margin-bottom:10px">Keine Hausaufgaben</h2>
    <p class="text-muted" style="max-width:360px;line-height:1.8">Du hast zurzeit keine Hausaufgaben. Dein Lehrer wird dir bald welche zuweisen.</p>
  </div>`;
  const pending   = assignments.filter(a=>a.status==='pending');
  const submitted = assignments.filter(a=>a.status==='submitted');
  const corrected = assignments.filter(a=>a.status==='corrected');
  const assignmentCard = (a, clickable, badge) => `
    <div class="card mb-3 hw-assignment-card" ${clickable?`onclick="${clickable}"`:''} style="${!clickable?'opacity:0.8;cursor:default':''}">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:16px;margin-bottom:4px">${escHtml(a.title)}</div>
          <div class="text-muted text-sm">${new Date(a.created_at).toLocaleDateString('de-DE')} · ${a.exercise_count||0} Übungen</div>
        </div>
        ${badge}
      </div>
    </div>`;
  return `<h1 class="section-title">Hausaufgaben</h1>
    ${pending.length?`<p class="section-sub" style="margin-bottom:12px">${pending.length} ausstehend</p>
      ${pending.map(a=>assignmentCard(a,`hwOpenAssignment('${a.id}')`,`<div style="color:var(--accent);font-size:22px;font-weight:800;margin-left:12px">→</div>`)).join('')}`:``}
    ${submitted.length?`<p class="section-sub" style="margin-top:${pending.length?24:0}px;margin-bottom:12px">Eingereicht</p>
      ${submitted.map(a=>assignmentCard(a,null,`<span class="chip blue" style="font-size:11px">⏳ Wird korrigiert</span>`)).join('')}`:``}
    ${corrected.length?`<p class="section-sub" style="margin-top:${(pending.length||submitted.length)?24:0}px;margin-bottom:12px">Korrigiert</p>
      ${corrected.map(a=>assignmentCard(a,`hwOpenCorrectedResult('${a.id}')`,`<span class="chip green" style="font-size:11px">✓ Korrigiert</span>`)).join('')}`:``}`;
}

function buildHomeworkStudentActive() {
  const { assignment, exState, dragState, orderState, submission } = state.hwActive;
  const allDone = assignment.exercises.every(ex=>exState[ex.id]?.done);
  const doneCount = Object.values(exState).filter(e=>e.done).length;
  const total = assignment.exercises.length;
  const progressPct = Math.round((doneCount/total)*100);
  return `<div style="max-width:640px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button class="btn btn-ghost btn-sm" onclick="hwCloseAssignment()">← Zurück</button>
      <h1 class="section-title" style="margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(assignment.title)}</h1>
    </div>
    ${!submission?`<div style="margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span class="text-muted text-sm">${doneCount} von ${total} Aufgaben fertig</span>
        <span style="font-size:12px;font-weight:700;color:var(--accent)">${progressPct}%</span>
      </div>
      <div style="height:6px;background:var(--surface2);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${progressPct}%;background:var(--accent);border-radius:4px;transition:width 0.4s ease"></div>
      </div>
    </div>`:''}
    ${submission?`<div class="card mb-6" style="background:rgba(34,192,107,0.08);border-color:var(--green);text-align:center;padding:32px">
      <div style="font-size:48px;margin-bottom:12px">🎉</div>
      <div style="font-weight:700;font-size:18px">Hausaufgaben eingereicht!</div>
      <div class="text-muted text-sm" style="margin-top:6px">Dein Lehrer wird sie bald korrigieren.</div>
    </div>`:''}
    ${assignment.exercises.map((ex,i)=>`<div style="margin-bottom:24px">${buildExercise(ex,exState[ex.id],dragState[ex.id],orderState[ex.id],i)}</div>`).join('')}
    ${!submission&&allDone?`<div style="padding:20px 0 40px">
      <button class="btn btn-primary" style="width:100%;padding:16px;font-size:16px;border-radius:14px" onclick="hwSubmit()">Hausaufgaben einreichen ✓</button>
    </div>`:''}
    ${!submission&&!allDone?`<div style="padding:12px 4px 40px"><p class="text-muted text-sm">Bearbeite alle Aufgaben um einzureichen.</p></div>`:''}
  </div>`;
}

// ========== EXERCISE RENDERERS ==========

function buildExercise(ex, es, ds, os, idx) {
  switch(ex.type) {
    case 'type_in_gap':             return buildTypeInGap(ex, es, idx);
    case 'drag_to_gap':             return buildDragToGap(ex, es, ds, idx);
    case 'word_ordering':           return buildWordOrdering(ex, es, os, idx);
    case 'odd_one_out':             return buildOddOneOut(ex, es, idx);
    case 'conjugation_table':       return buildConjugationTable(ex, es, idx);
    case 'error_correction':        return buildErrorCorrection(ex, es, idx);
    case 'sentence_transformation': return buildSentenceTransformation(ex, es, idx);
    case 'mini_dialogue':           return buildMiniDialogue(ex, es, idx);
    case 'word_association':        return buildWordAssociation(ex, es, idx);
    case 'vocab_session':           return buildVocabSession(ex, es, idx);
    default: return `<div class="card"><p class="text-muted text-sm">Unbekannter Aufgabentyp: ${ex.type}</p></div>`;
  }
}

function buildTypeInGap(ex, es, idx) {
  const done=es?.done, feedback=es?.feedback, color=hwExTypeColor(ex.type);
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <p class="ex-instruction">${escHtml(ex.instruction)}</p>
    ${ex.content.sentences.map(sent=>`<div class="ex-sentence">
      ${sent.parts.map((p,i)=>{
        if(typeof p==='string') return `<span>${escHtml(p)}</span>`;
        const key=`${sent.id}_${i}`, fb=feedback?.items?.[key], val=done?(es.answer?.[sent.id]?.[key]||''):'';
        return `<input type="text" id="tig-${ex.id}-${key}" class="gap-input${done?(fb?' correct':' wrong'):''}" ${done?'disabled':''} placeholder="___" value="${val.replace(/"/g,'&quot;')}" style="width:${Math.max(72,p.gap.length*11)}px">`;
      }).join('')}
    </div>`).join('')}
    ${!done?`<button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="hwCheckTypeInGap('${ex.id}')">Überprüfen</button>`:buildFeedbackBar(feedback)}
  </div>`;
}

function buildDragToGap(ex, es, ds, idx) {
  const done=es?.done, feedback=es?.feedback, selected=ds?.selected, gaps=ds?.gaps||{}, available=ds?.available||[], color=hwExTypeColor(ex.type);
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <p class="ex-instruction">${escHtml(ex.instruction)}</p>
    ${ex.content.sentences.map(sent=>`<div class="ex-sentence">
      ${sent.parts.map((p,i)=>{
        if(typeof p==='string') return `<span>${escHtml(p)}</span>`;
        const key=`${sent.id}_${i}`, placed=gaps[key], fb=feedback?.items?.[key];
        if(placed) return `<span class="gap-slot filled${done?(fb?' correct':' wrong'):''}" onclick="${done?'':(`hwRemoveFromGap('${ex.id}','${key}')`)}" style="cursor:${done?'default':'pointer'}">${escHtml(placed)}${!done?' <span style="font-size:10px;opacity:0.4">×</span>':''}${done&&!fb?` <span style="font-size:11px;opacity:0.7">(→ ${escHtml(p.gap)})</span>`:''}</span>`;
        return `<span class="gap-slot empty${!done&&selected?' ready':''}" onclick="${done?'':(`hwPlaceWord('${ex.id}','${key}')`)}" ondragover="${done?'':'event.preventDefault();this.classList.add(\'drag-over\')'}" ondragleave="${done?'':'this.classList.remove(\'drag-over\')'}" ondrop="${done?'':(`hwDrop(this,'${ex.id}','${key}')`)}">___</span>`;
      }).join('')}
    </div>`).join('')}
    ${!done?`<div class="word-bank" style="margin-top:14px">${available.map(w=>`<button class="word-chip${selected===w?' selected':''}" draggable="true" ondragstart="hwDragStart(this)" ondragend="hwDragEnd(this)" data-exid="${ex.id}" data-word="${w.replace(/"/g,'&quot;')}" onclick="hwSelectWordBtn(this)">${escHtml(w)}</button>`).join('')}</div>
      <button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="hwCheckDragToGap('${ex.id}')">Überprüfen</button>`
    :buildFeedbackBar(feedback)}
  </div>`;
}

function buildWordOrdering(ex, es, os, idx) {
  const done=es?.done, feedback=es?.feedback, color=hwExTypeColor(ex.type);
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <p class="ex-instruction">${escHtml(ex.instruction)}</p>
    ${ex.content.sentences.map((sent,si)=>{
      const sentState=os?.sentences?.[sent.id]||{placed:[],remaining:[...sent.scrambled]}, fb=feedback?.items?.[sent.id];
      return `<div style="margin-bottom:${si<ex.content.sentences.length-1?'20px':'0'}">
        <div class="order-target${done?(fb?' correct':' wrong'):''}">
          ${sentState.placed.length===0?`<span style="color:var(--text3);font-size:13px;align-self:center">Wörter hier einordnen…</span>`
          :sentState.placed.map((w,pidx)=>`<button class="word-chip placed" data-exid="${ex.id}" data-sentid="${sent.id}" data-idx="${pidx}" ${done?'disabled':'onclick="hwOrderRemoveBtn(this)"'}>${escHtml(w)}</button>`).join('')}
        </div>
        ${!done?`<div class="word-bank" style="margin-top:8px">${sentState.remaining.map(w=>`<button class="word-chip" data-exid="${ex.id}" data-sentid="${sent.id}" data-word="${w.replace(/"/g,'&quot;')}" onclick="hwOrderAddBtn(this)">${escHtml(w)}</button>`).join('')}</div>`
        :done&&!fb?`<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-left:4px">Richtig: ${escHtml(sent.correct.join(' '))}</div>`:''}
      </div>`;
    }).join('')}
    ${!done?`<button class="btn btn-primary btn-sm" style="margin-top:16px" onclick="hwCheckWordOrdering('${ex.id}')">Überprüfen</button>`:buildFeedbackBar(feedback)}
  </div>`;
}

function buildOddOneOut(ex, es, idx) {
  const done=es?.done, feedback=es?.feedback, color=hwExTypeColor(ex.type);
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <p class="ex-instruction">${escHtml(ex.instruction)}</p>
    ${ex.content.items.map((item,ii)=>{
      const given=es?.answer?.[item.id], answered=given!==undefined, correct=given===item.correct;
      return `<div style="margin-bottom:${ii<ex.content.items.length-1?'20px':'0'}">
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          ${item.words.map(w=>{
            let extraStyle='';
            if(answered){if(w===item.correct)extraStyle='background:rgba(34,192,107,0.15);border-color:var(--green);color:var(--green)';else if(w===given&&!correct)extraStyle='background:rgba(240,74,90,0.1);border-color:var(--red);color:var(--red)';}
            return `<button class="word-chip" data-exid="${ex.id}" data-itemid="${item.id}" data-word="${w.replace(/"/g,'&quot;')}" style="padding:8px 18px;font-size:14px;font-weight:700;${extraStyle}" ${answered?'disabled':'onclick="hwOddSelectBtn(this)"'}>${escHtml(w)}</button>`;
          }).join('')}
        </div>
        ${answered?`<div class="ex-feedback ${correct?'correct':'partial'}" style="margin-top:4px">${correct?'✓ Richtig!':'✗ Falsch'}</div>`:''}
      </div>`;
    }).join('')}
    ${done?buildFeedbackBar(feedback):''}
  </div>`;
}

function buildConjugationTable(ex, es, idx) {
  const done=es?.done, feedback=es?.feedback, color=hwExTypeColor(ex.type);
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <p class="ex-instruction">${escHtml(ex.instruction)}</p>
    <div style="font-size:20px;font-weight:900;color:var(--accent);text-align:center;margin-bottom:16px">${escHtml(ex.content.verb||'')} <span style="font-size:13px;font-weight:600;color:var(--text2)">${escHtml(ex.content.tense||'')}</span></div>
    <div style="max-width:320px;margin:0 auto">
      ${(ex.content.rows||[]).map(row=>{
        const fb=feedback?.items?.[row.pronoun], val=done?(es.answer?.[row.pronoun]||''):'';
        return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <span style="font-weight:700;color:var(--text2);min-width:80px;font-size:14px">${escHtml(row.pronoun)}</span>
          <input type="text" id="conj-${ex.id}-${row.pronoun.replace(/\//g,'_')}" class="gap-input${done?(fb!==undefined?(fb?' correct':' wrong'):''):''}" ${done?'disabled':''} placeholder="…" value="${val.replace(/"/g,'&quot;')}" style="flex:1;padding:8px 12px">
          ${done&&fb===false?`<span style="font-size:12px;color:var(--green)">(${escHtml(row.answer)})</span>`:''}
        </div>`;
      }).join('')}
    </div>
    ${!done?`<button class="btn btn-primary btn-sm" style="margin-top:16px" onclick="hwCheckConjugation('${ex.id}')">Überprüfen</button>`:buildFeedbackBar(feedback)}
  </div>`;
}

function buildErrorCorrection(ex, es, idx) {
  const done=es?.done, feedback=es?.feedback, color=hwExTypeColor(ex.type);
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <p class="ex-instruction">${escHtml(ex.instruction)}</p>
    ${(ex.content.sentences||[]).map((sent,si)=>{
      const fb=feedback?.items?.[sent.id], val=done?(es.answer?.[sent.id]||''):'';
      return `<div style="margin-bottom:${si<ex.content.sentences.length-1?'16px':'0'}">
        <div style="padding:10px 14px;background:rgba(240,74,90,0.06);border:1.5px solid var(--red);border-radius:8px;margin-bottom:8px;font-size:14px;color:var(--text2)">${escHtml(sent.text)}</div>
        <input type="text" id="ec-${ex.id}-${sent.id}" class="gap-input${done?(fb!==undefined?(fb?' correct':' wrong'):''):''}" ${done?'disabled':''} placeholder="Richtiger Satz…" value="${val.replace(/"/g,'&quot;')}" style="width:100%;padding:10px 12px;font-size:14px">
        ${done&&fb===false?`<div style="font-size:12px;color:var(--green);margin-top:4px;padding-left:4px">Richtig: ${escHtml(sent.answer)}</div>`:''}
      </div>`;
    }).join('')}
    ${!done?`<button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="hwCheckErrorCorrection('${ex.id}')">Überprüfen</button>`:buildFeedbackBar(feedback)}
  </div>`;
}

function buildSentenceTransformation(ex, es, idx) {
  const done=es?.done, feedback=es?.feedback, color=hwExTypeColor(ex.type);
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <p class="ex-instruction">${escHtml(ex.instruction)}</p>
    ${ex.content.transformation?`<div style="font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px">${escHtml(ex.content.transformation)}</div>`:''}
    ${(ex.content.sentences||[]).map((sent,si)=>{
      const fb=feedback?.items?.[sent.id], val=done?(es.answer?.[sent.id]||''):'';
      return `<div style="margin-bottom:${si<ex.content.sentences.length-1?'16px':'0'}">
        <div style="padding:10px 14px;background:var(--surface2);border:1.5px solid var(--border);border-radius:8px;margin-bottom:8px;font-size:14px">${escHtml(sent.original)}</div>
        <input type="text" id="st-${ex.id}-${sent.id}" class="gap-input${done?(fb!==undefined?(fb?' correct':' wrong'):''):''}" ${done?'disabled':''} placeholder="Umgeschriebener Satz…" value="${val.replace(/"/g,'&quot;')}" style="width:100%;padding:10px 12px;font-size:14px">
        ${done&&fb===false?`<div style="font-size:12px;color:var(--green);margin-top:4px;padding-left:4px">Richtig: ${escHtml(sent.answer)}</div>`:''}
      </div>`;
    }).join('')}
    ${!done?`<button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="hwCheckSentenceTransformation('${ex.id}')">Überprüfen</button>`:buildFeedbackBar(feedback)}
  </div>`;
}

function buildMiniDialogue(ex, es, idx) {
  const done=es?.done, color=hwExTypeColor(ex.type);
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <p class="ex-instruction">${escHtml(ex.instruction)}</p>
    ${ex.content.context?`<div style="font-size:13px;color:var(--text2);background:var(--surface2);padding:8px 12px;border-radius:8px;margin-bottom:14px;font-style:italic">${escHtml(ex.content.context)}</div>`:''}
    ${(ex.content.turns||[]).map((turn,ti)=>{
      if(turn.speaker==='other') return `<div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-start">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--surface2);border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">💬</div>
        <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:0 12px 12px 12px;padding:8px 12px;font-size:14px;max-width:80%">${escHtml(turn.text||'')}</div>
      </div>`;
      const val=done?(es.answer?.[ti]||''):'';
      return `<div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-start;flex-direction:row-reverse">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--accent);color:white;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">👤</div>
        <div style="flex:1">
          ${turn.hint?`<div style="font-size:11px;color:var(--text3);margin-bottom:4px;text-align:right">${escHtml(turn.hint)}</div>`:''}
          <input type="text" id="dial-${ex.id}-${ti}" ${done?'disabled':''} placeholder="Ihre Antwort…" value="${val.replace(/"/g,'&quot;')}"
            style="width:100%;padding:8px 12px;border:1.5px solid var(--accent);border-radius:12px 0 12px 12px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text);text-align:right;box-sizing:border-box">
        </div>
      </div>`;
    }).join('')}
    ${!done?`<button class="btn btn-primary btn-sm" style="margin-top:8px;width:100%" onclick="hwCheckMiniDialogue('${ex.id}')">Fertig</button>`
    :`<div class="ex-feedback correct" style="margin-top:14px">✓ Eingereicht — dein Lehrer schaut es sich an.</div>`}
  </div>`;
}

function buildWordAssociation(ex, es, idx) {
  const done=es?.done, color=hwExTypeColor(ex.type);
  const count=ex.content.count||5;
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <p class="ex-instruction">${escHtml(ex.instruction)}</p>
    <div style="font-size:24px;font-weight:900;color:${color};text-align:center;margin:12px 0 20px">${escHtml(ex.content.topic||'')}</div>
    ${Array.from({length:count},(_,i)=>{
      const val=done?(es.answer?.[i]||''):'';
      return `<input type="text" id="wa-${ex.id}-${i}" ${done?'disabled':''} placeholder="Wort ${i+1}…" value="${val.replace(/"/g,'&quot;')}"
        style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface2);color:var(--text);margin-bottom:8px;box-sizing:border-box">`;
    }).join('')}
    ${!done?`<button class="btn btn-primary btn-sm" style="margin-top:8px;width:100%" onclick="hwCheckWordAssociation('${ex.id}')">Fertig</button>`
    :`<div class="ex-feedback correct" style="margin-top:8px">✓ Eingereicht.</div>`}
  </div>`;
}

function buildVocabSession(ex, es, idx) {
  const done=es?.done, color=hwExTypeColor(ex.type);
  return `<div class="card exercise-card" style="border-top:3px solid ${color}">
    ${buildExerciseHeader(ex,idx,es)}
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:40px;margin-bottom:12px">📚</div>
      <div style="font-size:18px;font-weight:800;margin-bottom:4px">${escHtml(ex.content.set_name||'Vokabeln lernen')}</div>
      <p class="text-muted text-sm" style="margin-bottom:20px">${escHtml(ex.instruction)}</p>
      ${!done
        ? `<div style="display:flex;gap:10px;justify-content:center">
            <button class="btn btn-ghost" onclick="hwGoLearnVocab('${ex.content.set_id}')">📖 Jetzt lernen</button>
            <button class="btn btn-primary" onclick="hwMarkVocabDone('${ex.id}')">✓ Als erledigt markieren</button>
          </div>`
        : `<div class="ex-feedback correct">✓ Erledigt!</div>`}
    </div>
  </div>`;
}

// ========== RESULTS VIEW (teacher + student post-correction) ==========

function buildExerciseResultsView(ex, exState) {
  if (!exState) return `<p class="text-muted text-sm">Keine Antwort abgegeben.</p>`;
  if (ex.type==='type_in_gap'||ex.type==='drag_to_gap') {
    return ex.content.sentences.map(sent=>{
      const answers=exState.answer?.[sent.id]||{};
      return `<div style="margin-bottom:10px;padding:10px 14px;background:var(--surface2);border-radius:8px;line-height:2.5">
        ${sent.parts.map((p,i)=>{
          if(typeof p==='string') return `<span>${escHtml(p)}</span>`;
          const key=`${sent.id}_${i}`, given=answers[key]||'—', correct=given.trim().toLowerCase()===p.gap.toLowerCase();
          return `<span style="display:inline-flex;align-items:center;gap:4px;background:${correct?'rgba(34,192,107,0.15)':'rgba(240,74,90,0.1)'};border:1.5px solid ${correct?'var(--green)':'var(--red)'};border-radius:6px;padding:2px 10px;font-weight:700;color:${correct?'var(--green)':'var(--red)'};font-size:13px;margin:0 2px">${escHtml(given)}${!correct?` <span style="font-size:11px;opacity:0.7">(→ ${escHtml(p.gap)})</span>`:' ✓'}</span>`;
        }).join('')}
      </div>`;
    }).join('');
  }
  if (ex.type==='word_ordering') {
    return ex.content.sentences.map(sent=>{
      const placed=exState.answer?.[sent.id]||[], correct=placed.map(w=>w.toLowerCase()).join(' ')===sent.correct.map(w=>w.toLowerCase()).join(' ');
      return `<div style="padding:10px 14px;background:${correct?'rgba(34,192,107,0.08)':'rgba(240,74,90,0.05)'};border:1.5px solid ${correct?'var(--green)':'var(--red)'};border-radius:8px;margin-bottom:8px">
        <div style="font-weight:700;color:${correct?'var(--green)':'var(--red)'}">${escHtml(placed.join(' '))||'—'} ${correct?'✓':'✗'}</div>
        ${!correct?`<div style="font-size:12px;color:var(--text2);margin-top:4px">Richtig: ${escHtml(sent.correct.join(' '))}</div>`:''}
      </div>`;
    }).join('');
  }
  if (ex.type==='odd_one_out') {
    return ex.content.items.map(item=>{
      const given=exState.answer?.[item.id], correct=given===item.correct;
      return `<div style="margin-bottom:12px">
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${item.words.map(w=>`<span style="padding:5px 14px;border-radius:20px;font-size:13px;font-weight:700;
            background:${w===given?(correct?'rgba(34,192,107,0.15)':'rgba(240,74,90,0.1)'):(w===item.correct&&!correct?'rgba(34,192,107,0.08)':'var(--surface2)')};
            border:1.5px solid ${w===given?(correct?'var(--green)':'var(--red)'):(w===item.correct&&!correct?'var(--green)':'var(--border)')};
            color:${w===given?(correct?'var(--green)':'var(--red)'):'var(--text)'}">${escHtml(w)}</span>`).join('')}
        </div>
        <div style="font-size:12px;color:var(--text2);margin-top:4px">${correct?'✓ Richtig':'✗ Falsch'}</div>
      </div>`;
    }).join('');
  }
  if (ex.type==='conjugation_table') {
    return `<div style="max-width:320px">
      ${(ex.content.rows||[]).map(row=>{
        const given=exState.answer?.[row.pronoun]||'—', correct=given.trim().toLowerCase()===row.answer.toLowerCase();
        return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
          <span style="font-weight:700;color:var(--text2);min-width:80px;font-size:13px">${escHtml(row.pronoun)}</span>
          <span style="padding:4px 10px;border-radius:6px;font-size:13px;font-weight:700;background:${correct?'rgba(34,192,107,0.12)':'rgba(240,74,90,0.08)'};border:1.5px solid ${correct?'var(--green)':'var(--red)'};color:${correct?'var(--green)':'var(--red)'}">${escHtml(given)} ${correct?'✓':'✗'}</span>
          ${!correct?`<span style="font-size:12px;color:var(--text2)">${escHtml(row.answer)}</span>`:''}
        </div>`;
      }).join('')}
    </div>`;
  }
  if (ex.type==='error_correction') {
    return (ex.content.sentences||[]).map(sent=>{
      const given=exState.answer?.[sent.id]||'—', correct=given.trim().toLowerCase()===sent.answer.trim().toLowerCase();
      return `<div style="margin-bottom:10px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px">Original: ${escHtml(sent.text)}</div>
        <div style="padding:8px 12px;border-radius:8px;background:${correct?'rgba(34,192,107,0.08)':'rgba(240,74,90,0.05)'};border:1.5px solid ${correct?'var(--green)':'var(--red)'};font-size:14px;font-weight:600;color:${correct?'var(--green)':'var(--red)'}">
          ${escHtml(given)} ${correct?'✓':'✗'}
        </div>
        ${!correct?`<div style="font-size:12px;color:var(--text2);margin-top:4px">Richtig: ${escHtml(sent.answer)}</div>`:''}
      </div>`;
    }).join('');
  }
  if (ex.type==='sentence_transformation') {
    return (ex.content.sentences||[]).map(sent=>{
      const given=exState.answer?.[sent.id]||'—', correct=given.trim().toLowerCase()===sent.answer.trim().toLowerCase();
      return `<div style="margin-bottom:10px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px">Original: ${escHtml(sent.original)}</div>
        <div style="padding:8px 12px;border-radius:8px;background:${correct?'rgba(34,192,107,0.08)':'rgba(240,74,90,0.05)'};border:1.5px solid ${correct?'var(--green)':'var(--red)'};font-size:14px;font-weight:600;color:${correct?'var(--green)':'var(--red)'}">
          ${escHtml(given)} ${correct?'✓':'✗'}
        </div>
        ${!correct?`<div style="font-size:12px;color:var(--text2);margin-top:4px">Richtig: ${escHtml(sent.answer)}</div>`:''}
      </div>`;
    }).join('');
  }
  if (ex.type==='mini_dialogue') {
    const turns=ex.content.turns||[];
    return turns.filter(t=>t.speaker==='student').map((_,ti)=>{
      const studentTurnIdx=turns.reduce((acc,t,i)=>{if(t.speaker==='student')acc.push(i);return acc;},[]);
      const idx=studentTurnIdx[ti];
      const given=exState.answer?.[idx]||'—';
      return `<div style="padding:8px 12px;background:var(--surface2);border-radius:8px;margin-bottom:6px;font-size:14px">
        <span style="font-size:11px;color:var(--text2)">Zeile ${ti+1}: </span>${escHtml(given)}
      </div>`;
    }).join('');
  }
  if (ex.type==='word_association') {
    const words=Object.values(exState.answer||{}).filter(Boolean);
    return `<div style="display:flex;flex-wrap:wrap;gap:6px">
      ${words.map(w=>`<span style="padding:5px 14px;border-radius:20px;font-size:13px;font-weight:700;background:var(--surface2);border:1.5px solid var(--border)">${escHtml(w)}</span>`).join('')}
    </div>`;
  }
  if (ex.type==='vocab_session') {
    return `<div style="font-size:14px;color:var(--green)">✓ Vokabeln gelernt</div>`;
  }
  return '';
}

// ========== INTERACTION HANDLERS ==========

window.hwCheckTypeInGap = (exId) => {
  const ex=state.hwActive.assignment.exercises.find(e=>e.id===exId); if(!ex) return;
  let total=0,correct=0; const answer={},items={};
  for(const sent of ex.content.sentences){ answer[sent.id]={};
    sent.parts.forEach((p,i)=>{ if(typeof p!=='object')return; const key=`${sent.id}_${i}`;
      const val=document.getElementById(`tig-${exId}-${key}`)?.value?.trim()||''; answer[sent.id][key]=val;
      const ok=val.toLowerCase()===p.gap.toLowerCase(); items[key]=ok; total++; if(ok)correct++;
    });
  }
  state.hwActive.exState[exId]={done:true,answer,feedback:{allCorrect:correct===total,correct,total,items}}; render();
};

window.hwSelectWordBtn=(btn)=>hwSelectWord(btn.dataset.exid,btn.dataset.word);
window.hwSelectWord=(exId,word)=>{ const ds=state.hwActive.dragState[exId]; if(!ds)return; ds.selected=ds.selected===word?null:word; render(); };
window.hwPlaceWord=(exId,gapKey,wordOverride)=>{ const ds=state.hwActive.dragState[exId]; if(!ds)return; const word=wordOverride!==undefined?wordOverride:ds.selected; if(!word)return; if(ds.gaps[gapKey])ds.available.push(ds.gaps[gapKey]); ds.gaps[gapKey]=word; ds.available=ds.available.filter(w=>w!==word); ds.selected=null; render(); };
window.hwRemoveFromGap=(exId,gapKey)=>{ const ds=state.hwActive.dragState[exId]; if(!ds)return; const word=ds.gaps[gapKey]; if(word){ds.gaps[gapKey]=null;ds.available.push(word);} render(); };
window.hwDragStart=(chip)=>{ _hwDragExId=chip.dataset.exid; _hwDragWord=chip.dataset.word; chip.style.opacity='0.5'; };
window.hwDragEnd=(chip)=>{ chip.style.opacity=''; _hwDragExId=null; _hwDragWord=null; };
window.hwDrop=(slot,exId,gapKey)=>{ slot.classList.remove('drag-over'); if(!_hwDragWord)return; hwPlaceWord(exId,gapKey,_hwDragWord); _hwDragExId=null; _hwDragWord=null; };

window.hwCheckDragToGap=(exId)=>{
  const ex=state.hwActive.assignment.exercises.find(e=>e.id===exId),ds=state.hwActive.dragState[exId]; if(!ex||!ds)return;
  let total=0,correct=0; const answer={},items={};
  for(const sent of ex.content.sentences){ answer[sent.id]={};
    sent.parts.forEach((p,i)=>{ if(typeof p!=='object')return; const key=`${sent.id}_${i}`;
      const placed=ds.gaps[key]||''; answer[sent.id][key]=placed;
      const ok=placed.toLowerCase()===p.gap.toLowerCase(); items[key]=ok; total++; if(ok)correct++;
    });
  }
  state.hwActive.exState[exId]={done:true,answer,feedback:{allCorrect:correct===total,correct,total,items}}; render();
};

window.hwOrderAddBtn=(btn)=>hwOrderAdd(btn.dataset.exid,btn.dataset.sentid,btn.dataset.word);
window.hwOrderRemoveBtn=(btn)=>hwOrderRemove(btn.dataset.exid,btn.dataset.sentid,parseInt(btn.dataset.idx));
window.hwOrderAdd=(exId,sentId,word)=>{ const os=state.hwActive.orderState[exId]; if(!os)return; const s=os.sentences[sentId]; if(!s)return; const i=s.remaining.indexOf(word); if(i!==-1)s.remaining.splice(i,1); s.placed.push(word); render(); };
window.hwOrderRemove=(exId,sentId,placedIdx)=>{ const os=state.hwActive.orderState[exId]; if(!os)return; const s=os.sentences[sentId]; if(!s)return; const word=s.placed.splice(placedIdx,1)[0]; s.remaining.push(word); render(); };

window.hwCheckWordOrdering=(exId)=>{
  const ex=state.hwActive.assignment.exercises.find(e=>e.id===exId),os=state.hwActive.orderState[exId]; if(!ex||!os)return;
  let total=0,correct=0; const answer={},items={};
  for(const sent of ex.content.sentences){ const placed=os.sentences[sent.id]?.placed||[]; answer[sent.id]=placed;
    const ok=placed.map(w=>w.toLowerCase()).join(' ')===sent.correct.map(w=>w.toLowerCase()).join(' '); items[sent.id]=ok; total++; if(ok)correct++;
  }
  state.hwActive.exState[exId]={done:true,answer,feedback:{allCorrect:correct===total,correct,total,items}}; render();
};

window.hwOddSelectBtn=(btn)=>hwOddSelect(btn.dataset.exid,btn.dataset.itemid,btn.dataset.word);
window.hwOddSelect=(exId,itemId,word)=>{
  const ex=state.hwActive.assignment.exercises.find(e=>e.id===exId); if(!ex)return;
  const es=state.hwActive.exState[exId]; if(!es.answer)es.answer={};
  es.answer[itemId]=word;
  const allAnswered=ex.content.items.every(item=>es.answer?.[item.id]!==undefined);
  if(allAnswered){const total=ex.content.items.length,correct=ex.content.items.filter(item=>es.answer[item.id]===item.correct).length; es.done=true; es.feedback={allCorrect:correct===total,correct,total};}
  render();
};

window.hwCheckConjugation=(exId)=>{
  const ex=state.hwActive.assignment.exercises.find(e=>e.id===exId); if(!ex)return;
  let total=0,correct=0; const answer={},items={};
  for(const row of ex.content.rows){
    const input=document.getElementById(`conj-${exId}-${row.pronoun.replace(/\//g,'_')}`);
    const val=input?.value?.trim()||''; answer[row.pronoun]=val;
    const ok=val.toLowerCase()===row.answer.toLowerCase(); items[row.pronoun]=ok; total++; if(ok)correct++;
  }
  state.hwActive.exState[exId]={done:true,answer,feedback:{allCorrect:correct===total,correct,total,items}}; render();
};

window.hwCheckErrorCorrection=(exId)=>{
  const ex=state.hwActive.assignment.exercises.find(e=>e.id===exId); if(!ex)return;
  let total=0,correct=0; const answer={},items={};
  for(const sent of ex.content.sentences){
    const val=document.getElementById(`ec-${exId}-${sent.id}`)?.value?.trim()||''; answer[sent.id]=val;
    const ok=val.toLowerCase()===sent.answer.trim().toLowerCase(); items[sent.id]=ok; total++; if(ok)correct++;
  }
  state.hwActive.exState[exId]={done:true,answer,feedback:{allCorrect:correct===total,correct,total,items}}; render();
};

window.hwCheckSentenceTransformation=(exId)=>{
  const ex=state.hwActive.assignment.exercises.find(e=>e.id===exId); if(!ex)return;
  let total=0,correct=0; const answer={},items={};
  for(const sent of ex.content.sentences){
    const val=document.getElementById(`st-${exId}-${sent.id}`)?.value?.trim()||''; answer[sent.id]=val;
    const ok=val.toLowerCase()===sent.answer.trim().toLowerCase(); items[sent.id]=ok; total++; if(ok)correct++;
  }
  state.hwActive.exState[exId]={done:true,answer,feedback:{allCorrect:correct===total,correct,total,items}}; render();
};

window.hwCheckMiniDialogue=(exId)=>{
  const ex=state.hwActive.assignment.exercises.find(e=>e.id===exId); if(!ex)return;
  const answer={};
  (ex.content.turns||[]).forEach((turn,ti)=>{ if(turn.speaker==='student'){ const val=document.getElementById(`dial-${exId}-${ti}`)?.value?.trim()||''; answer[ti]=val; }});
  state.hwActive.exState[exId]={done:true,answer,feedback:{allCorrect:true,correct:1,total:1}}; render();
};

window.hwCheckWordAssociation=(exId)=>{
  const ex=state.hwActive.assignment.exercises.find(e=>e.id===exId); if(!ex)return;
  const count=ex.content.count||5; const answer={};
  for(let i=0;i<count;i++){ const val=document.getElementById(`wa-${exId}-${i}`)?.value?.trim()||''; if(val)answer[i]=val; }
  state.hwActive.exState[exId]={done:true,answer,feedback:{allCorrect:true,correct:1,total:1}}; render();
};

window.hwMarkVocabDone=(exId)=>{
  state.hwActive.exState[exId]={done:true,answer:{completed:true},feedback:{allCorrect:true,correct:1,total:1}}; render();
};

window.hwGoLearnVocab=(setId)=>{ showToast('Geh zum Lernen-Tab und komm danach zurück!','success'); };

// Navigation handlers
window.hwOpenAssignment=async(assignmentId)=>{
  const assignment=state.hwAssignments.find(a=>a.id===assignmentId); if(!assignment)return;
  const {data:aeRows}=await sb.from('assignment_exercises').select('order_index, exercises(*)').eq('assignment_id',assignmentId).order('order_index');
  const exercises=(aeRows||[]).map(ae=>({id:ae.exercises.id,type:ae.exercises.exercise_type,instruction:ae.exercises.title,content:ae.exercises.content}));
  const fullAssignment={...assignment,exercises};
  const {data:submission}=await sb.from('homework_submissions').select('id,submitted_at,feedback').eq('assignment_id',assignmentId).eq('student_id',state.user.id).maybeSingle();
  state.hwActive=initHwActive(fullAssignment);
  if(submission){ const {data:responses}=await sb.from('exercise_responses').select('exercise_id,response,is_correct').eq('submission_id',submission.id); const answers={}; (responses||[]).forEach(r=>{answers[r.exercise_id]=r.response;}); state.hwActive.submission={...submission,answers}; }
  render();
};

window.hwOpenCorrectedResult=async(assignmentId)=>{
  const assignment=state.hwAssignments.find(a=>a.id===assignmentId); if(!assignment)return;
  const {data:aeRows}=await sb.from('assignment_exercises').select('order_index, exercises(*)').eq('assignment_id',assignmentId).order('order_index');
  const exercises=(aeRows||[]).map(ae=>({id:ae.exercises.id,type:ae.exercises.exercise_type,instruction:ae.exercises.title,content:ae.exercises.content}));
  if(assignment)assignment.exercises=exercises;
  const {data:submission}=await sb.from('homework_submissions').select('id,submitted_at,feedback').eq('assignment_id',assignmentId).eq('student_id',state.user.id).maybeSingle();
  if(!submission){showToast('Keine Einreichung gefunden.','error');return;}
  const {data:responses}=await sb.from('exercise_responses').select('exercise_id,response,is_correct,teacher_correct').eq('submission_id',submission.id);
  const answers={},corrections={};
  (responses||[]).forEach(r=>{ answers[r.exercise_id]=r.response; corrections[r.exercise_id]={is_correct:r.is_correct,teacher_correct:r.teacher_correct}; });
  state.hwViewResults=assignmentId; state.hwResults={...submission,answers,corrections};
  state.hwStudentResultView=true;
  render();
};

window.hwCloseAssignment=()=>{state.hwActive=null;render();};
window.hwSubmit=submitHomework;
window.hwStartCreate=async(studentId)=>{
  const student=state.students.find(s=>s.id===studentId)||{id:studentId};
  state.hwCreating=true; state.hwCreateStudent=student; state.hwCreateNotes=''; state.hwPreview=null; state.hwExerciseSlots=[]; state.hwEditIdx=null;
  await loadUnlockedForStudent(studentId);
  render();
};
window.hwCancelCreate=()=>{ state.hwCreating=false; state.hwCreateStudent=null; state.hwCreateNotes=''; state.hwPreview=null; state.hwExerciseSlots=[]; state.hwEditIdx=null; state.hwGenerating=false; render(); };
window.hwCancelPreview=()=>{ state.hwPreview=null; state.hwEditIdx=null; render(); };
window.hwGenerate=async()=>{ const notes=document.getElementById('hw-lesson-notes')?.value||''; state.hwCreateNotes=notes; await generateHomework(); };
window.hwRegenerateCreate=async()=>{ state.hwPreview=null; state.hwEditIdx=null; await generateHomework(); };
window.hwSave=saveHomework;
window.hwViewResultsBtn=async(assignmentId)=>{ await loadHomeworkResults(assignmentId); };
window.hwCloseResults=()=>{ state.hwViewResults=null; state.hwResults=null; state.hwCorrections={}; state.hwStudentResultView=false; render(); };
window.hwRefresh=async()=>{ await loadHomework(); render(); };
window.hwStudentViewBtn=(studentId)=>{state.hwStudentView=studentId;render();};
window.hwStudentViewBack=()=>{state.hwStudentView=null;render();};
window.hwSaveCorrections=saveCorrections;
window.hwToggleCorrection=(exId,value)=>{ if(!state.hwCorrections)state.hwCorrections={}; state.hwCorrections[exId]=value; render(); };

// Slot management
window.hwAddSlot=()=>{ state.hwExerciseSlots.push({type:'type_in_gap',grammarFocus:'',theme:'',vocabSource:'recent_30d',count:4,customInstruction:'',setId:null,setName:null}); render(); };
window.hwRemoveSlot=(i)=>{ state.hwExerciseSlots.splice(i,1); render(); };
window.hwUpdateSlot=(i,field,value,silent)=>{ state.hwExerciseSlots[i][field]=value; if(!silent) render(); };
window.hwUpdateSlotVocab=(i,setId,setName)=>{ state.hwExerciseSlots[i].setId=setId; state.hwExerciseSlots[i].setName=setName.replace(/^[^–—-]*[–—-]\s*/,''); render(); };

// Inline editor
window.hwOpenEdit=(idx)=>{ state.hwEditIdx=idx; render(); };
window.hwCloseEdit=()=>{ state.hwEditIdx=null; render(); };
window.hwApplyEdit=(idx)=>{
  const ex=state.hwPreview.exercises[idx];
  const instrEl=document.getElementById('edit-instruction'); if(instrEl)ex.instruction=instrEl.value;
  if(ex.type==='type_in_gap'||ex.type==='drag_to_gap'){
    if(ex.type==='drag_to_gap'){const wb=document.getElementById('edit-wordbank'); if(wb)ex.content.wordBank=wb.value.split(',').map(s=>s.trim()).filter(Boolean);}
    document.querySelectorAll('.edit-part-text').forEach(el=>{const si=parseInt(el.dataset.si),pi=parseInt(el.dataset.pi); ex.content.sentences[si].parts[pi]=el.value;});
    document.querySelectorAll('.edit-part-gap').forEach(el=>{const si=parseInt(el.dataset.si),pi=parseInt(el.dataset.pi); ex.content.sentences[si].parts[pi]={gap:el.value};});
  }
  if(ex.type==='word_ordering'){
    document.querySelectorAll('.edit-order-correct').forEach(el=>{const si=parseInt(el.dataset.si);const words=el.value.split(' ').filter(Boolean); ex.content.sentences[si].correct=words; ex.content.sentences[si].scrambled=[...words].sort(()=>Math.random()-0.5);});
  }
  if(ex.type==='odd_one_out'){
    document.querySelectorAll('.edit-ooo-words').forEach(el=>{const ii=parseInt(el.dataset.ii);ex.content.items[ii].words=el.value.split(',').map(s=>s.trim()).filter(Boolean);});
    document.querySelectorAll('.edit-ooo-correct').forEach(el=>{const ii=parseInt(el.dataset.ii);ex.content.items[ii].correct=el.value.trim();});
  }
  if(ex.type==='conjugation_table'){
    const v=document.getElementById('edit-verb'),t=document.getElementById('edit-tense'); if(v)ex.content.verb=v.value; if(t)ex.content.tense=t.value;
    document.querySelectorAll('.edit-conj-answer').forEach(el=>{const ri=parseInt(el.dataset.ri);ex.content.rows[ri].answer=el.value.trim();});
  }
  if(ex.type==='error_correction'){
    document.querySelectorAll('.edit-ec-text').forEach(el=>{const si=parseInt(el.dataset.si);ex.content.sentences[si].text=el.value;});
    document.querySelectorAll('.edit-ec-answer').forEach(el=>{const si=parseInt(el.dataset.si);ex.content.sentences[si].answer=el.value;});
  }
  if(ex.type==='sentence_transformation'){
    const tr=document.getElementById('edit-transformation'); if(tr)ex.content.transformation=tr.value;
    document.querySelectorAll('.edit-st-original').forEach(el=>{const si=parseInt(el.dataset.si);ex.content.sentences[si].original=el.value;});
    document.querySelectorAll('.edit-st-answer').forEach(el=>{const si=parseInt(el.dataset.si);ex.content.sentences[si].answer=el.value;});
  }
  if(ex.type==='mini_dialogue'){
    const ctx=document.getElementById('edit-context'); if(ctx)ex.content.context=ctx.value;
    document.querySelectorAll('.edit-turn-text').forEach(el=>{const ti=parseInt(el.dataset.ti);ex.content.turns[ti].text=el.value;});
    document.querySelectorAll('.edit-turn-hint').forEach(el=>{const ti=parseInt(el.dataset.ti);ex.content.turns[ti].hint=el.value;});
  }
  if(ex.type==='word_association'){
    const tp=document.getElementById('edit-topic'),ct=document.getElementById('edit-count'); if(tp)ex.content.topic=tp.value; if(ct)ex.content.count=parseInt(ct.value)||5;
  }
  state.hwEditIdx=null; render();
};
