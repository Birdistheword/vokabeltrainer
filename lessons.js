// ========== LESSONS MODULE ==========

async function loadLessons() {
  const isAdmin = state.profile?.is_admin;
  if (isAdmin) {
    let query = sb.from('lessons')
      .select('id, student_id, date, title, status, created_at')
      .eq('teacher_id', state.user.id)
      .order('date', { ascending: false });
    if (state.lessonStudent) query = query.eq('student_id', state.lessonStudent);
    const { data, error } = await query;
    if (error) { showToast('Fehler beim Laden der Stunden: ' + error.message, 'error'); return; }
    state.lessonsData = data || [];
  } else {
    const { data, error } = await sb.from('lessons')
      .select('id, date, title, status')
      .eq('student_id', state.user.id)
      .order('date', { ascending: false });
    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
    state.lessonsData = data || [];
  }
}

async function loadBlueprints() {
  const { data } = await sb.from('blueprints')
    .select('id, title, created_at')
    .eq('author_id', state.user.id)
    .order('created_at', { ascending: false });
  state.blueprints = data || [];
}

async function loadLessonNotifications() {
  const { data } = await sb.from('blueprint_shares')
    .select('id')
    .eq('to_teacher_id', state.user.id)
    .eq('status', 'pending');
  state.lessonNotifications = data || [];
}

async function loadActiveLesson(lessonId) {
  const [lessonRes, sectionsRes] = await Promise.all([
    sb.from('lessons').select('*').eq('id', lessonId).single(),
    sb.from('lesson_sections').select('*').eq('lesson_id', lessonId).order('sort_order'),
  ]);
  if (lessonRes.error) { showToast('Fehler: ' + lessonRes.error.message, 'error'); return; }
  const sections = sectionsRes.data || [];
  await resolveSignedUrls(sections);
  const lesson = { ...lessonRes.data, sections };
  lesson.personalVocab = await loadPersonalVocabForLesson(lessonId, lesson.student_id);
  state.activeLesson = lesson;
}

async function loadPersonalVocabForLesson(lessonId, studentId) {
  const { data: pvData } = await sb.from('personal_vocab')
    .select('*').eq('lesson_id', lessonId).order('created_at');
  if (!pvData?.length) return [];
  const pvIds = pvData.map(v => v.id);
  const { data: srsData } = await sb.from('srs_progress')
    .select('personal_vocab_id, next_review, ease, review_count')
    .eq('student_id', studentId)
    .in('personal_vocab_id', pvIds);
  const srsMap = {};
  (srsData || []).forEach(s => { srsMap[s.personal_vocab_id] = s; });
  return pvData.map(v => ({ ...v, srs: srsMap[v.id] || null }));
}

async function resolveSignedUrls(sections) {
  const promises = [];
  for (const sec of sections) {
    for (const att of (sec.attachments || [])) {
      if (att.type === 'file' && att.path) {
        promises.push(
          sb.storage.from('lesson-files').createSignedUrl(att.path, 3600)
            .then(({ data }) => { att.url = data?.signedUrl || '#'; })
        );
      }
    }
  }
  await Promise.all(promises);
}

// ========== LIST VIEWS ==========

function buildLessons() {
  if (state.activeLesson) return buildLessonDetail();
  return state.profile?.is_admin ? buildLessonsTeacher() : buildLessonsStudent();
}

function buildLessonsTeacher() {
  const studentOptions = state.students.map(s => {
    const name = s.full_name || s.email || s.id;
    const selected = state.lessonStudent === s.id ? 'selected' : '';
    return `<option value="${s.id}" ${selected}>${name}</option>`;
  });

  const studentSelector = `
    <div class="lessons-student-bar">
      <select class="lessons-student-select" onchange="window.selectLessonStudent(this.value)">
        <option value="">— Schüler wählen —</option>
        ${studentOptions.join('')}
      </select>
      ${state.lessonStudent ? `
        <button class="btn btn-primary btn-sm" onclick="window.newLesson()">+ Neue Stunde</button>
        <button class="btn btn-ghost btn-sm" onclick="window.toggleBlueprintPicker()">📋 Aus Vorlage</button>
      ` : ''}
    </div>
    ${state.lessonStudent && state.blueprintPickerOpen ? buildBlueprintPicker() : ''}`;

  if (!state.lessonStudent) {
    return `
      <h1 class="section-title">Unterricht</h1>
      <p class="section-sub">Stundenpläne verwalten</p>
      ${studentSelector}
      <div class="empty" style="padding:40px 0; text-align:center">
        <div class="empty-icon">🗒️</div>
        <div class="empty-text">Wähle einen Schüler, um die Stunden anzuzeigen</div>
      </div>
      ${buildBlueprintListSection()}`;
  }

  const student = state.students.find(s => s.id === state.lessonStudent);
  const studentName = student?.full_name || student?.email || '';
  const lessonCards = state.lessonsData.length === 0
    ? `<div class="empty" style="padding:40px; text-align:center">
        <div class="empty-icon">📋</div>
        <div class="empty-text">Noch keine Stunden angelegt</div>
       </div>`
    : state.lessonsData.map(l => buildLessonCard(l)).join('');

  return `
    <h1 class="section-title">Unterricht — ${studentName}</h1>
    <p class="section-sub">Stundenverlaufspläne</p>
    ${studentSelector}
    <div class="lessons-list">${lessonCards}</div>
    ${buildBlueprintListSection()}`;
}

function buildLessonsStudent() {
  const lessonCards = state.lessonsData.length === 0
    ? `<div class="empty" style="padding:40px; text-align:center">
        <div class="empty-icon">📋</div>
        <div class="empty-text">Noch keine Stunden vorhanden</div>
       </div>`
    : state.lessonsData.map(l => buildLessonCard(l, true)).join('');

  return `
    <h1 class="section-title">Meine Stunden</h1>
    <p class="section-sub">Stundenpläne deiner Lehrerin</p>
    <div class="lessons-list">${lessonCards}</div>`;
}

function buildLessonCard(lesson, studentView = false) {
  const d = lesson.date ? new Date(lesson.date + 'T12:00:00') : null;
  const dateStr = d
    ? d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';
  const statusBadge = lesson.status === 'done'
    ? `<span class="lesson-badge lesson-badge-done">✓ Fertig</span>`
    : `<span class="lesson-badge lesson-badge-draft">Entwurf</span>`;
  const title = lesson.title || `Stunde vom ${dateStr}`;
  return `
    <div class="lesson-card">
      <div class="lesson-card-left">
        <div class="lesson-card-date">${dateStr}</div>
        <div class="lesson-card-title">${title}</div>
      </div>
      <div class="lesson-card-right">
        ${statusBadge}
        <button class="btn btn-ghost btn-sm" data-lessonid="${lesson.id}"
          onclick="window.openLesson(this.dataset.lessonid)">
          ${studentView ? 'Ansehen →' : 'Öffnen →'}
        </button>
      </div>
    </div>`;
}

// ========== LESSON DETAIL ==========

const SECTION_META = {
  lernziel:    { icon: '🎯', label: 'Lernziel' },
  recap:       { icon: '🔄', label: 'Rückblick' },
  einfuehrung: { icon: '💡', label: 'Einführung' },
  hauptteil:   { icon: '📖', label: 'Hauptteil' },
  sicherung:   { icon: '✅', label: 'Sicherung' },
};
const SECTION_ORDER = ['lernziel', 'recap', 'einfuehrung', 'hauptteil', 'sicherung'];

function buildLessonDetail() {
  const lesson = state.activeLesson;
  const isAdmin = state.profile?.is_admin;
  const d = lesson.date ? new Date(lesson.date + 'T12:00:00') : null;
  const dateStr = d ? d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '—';

  const sectionsHtml = SECTION_ORDER.map(type => buildLessonSectionBlock(type, lesson, isAdmin)).join('');

  const titleInput = isAdmin
    ? `<input class="lesson-detail-title-input" type="text" value="${escHtml(lesson.title || '')}"
         placeholder="Stundentitel…" onblur="window.saveLessonTitle(this.value)">`
    : `<h2 class="lesson-detail-title">${escHtml(lesson.title || dateStr)}</h2>`;

  const dateInput = isAdmin
    ? `<input class="lesson-detail-date-input" type="date" value="${lesson.date || ''}"
         onchange="window.saveLessonDate(this.value)">`
    : ``;

  const statusToggle = isAdmin ? `
    <button class="btn btn-sm ${lesson.status === 'done' ? 'btn-success' : 'btn-outline'}"
      onclick="window.toggleLessonStatus()">
      ${lesson.status === 'done' ? '✓ Fertig' : 'Als fertig markieren'}
    </button>` : '';

  const blueprintBtns = isAdmin ? `
    <button class="btn btn-ghost btn-sm" onclick="window.saveLessonAsBlueprint()" title="Als Vorlage speichern">💾 Vorlage</button>
    ${state.blueprints.length > 0 ? `<button class="btn btn-ghost btn-sm" onclick="window.applyBlueprintToLesson()" title="Vorlage anwenden">📋 Anwenden</button>` : ''}
    <button class="btn btn-danger btn-sm" onclick="window.deleteLesson()">Löschen</button>
  ` : '';

  return `
    <div class="session-header">
      <button class="btn btn-ghost btn-sm" onclick="window.closeLesson()">← Zurück</button>
      <span class="session-header-label">${dateStr}</span>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${blueprintBtns}${statusToggle}</div>
    </div>
    <div class="lesson-detail">
      <div class="lesson-detail-top">
        ${titleInput}
        ${dateInput}
      </div>
      <div class="lesson-sections">${sectionsHtml}</div>
      ${isAdmin ? `<div id="pv-panel">${buildPersonalVocabPanel()}</div>` : ''}
    </div>`;
}

function buildLessonSectionBlock(type, lesson, isAdmin) {
  const meta = SECTION_META[type];
  const section = lesson.sections.find(s => s.section_type === type);
  const content = section?.content || '';
  const sectionId = section?.id || null;

  if (!isAdmin && !content && !(section?.attachments?.length) && !(section?.recap_refs?.length)) return '';

  if (isAdmin) {
    return `
      <div class="lesson-section-block" data-type="${type}">
        <div class="lesson-section-header">
          <span class="lesson-section-icon">${meta.icon}</span>
          <span class="lesson-section-label">${meta.label}</span>
        </div>
        <textarea class="lesson-section-textarea" rows="4"
          placeholder="${meta.label} eingeben…"
          data-type="${type}"
          data-sectionid="${sectionId || ''}"
          onblur="window.saveLessonSection(this)"
        >${escHtml(content)}</textarea>
        <div id="attach-area-${sectionId}">${buildAttachArea(section, type, isAdmin)}</div>
      </div>`;
  } else {
    return `
      <div class="lesson-section-block">
        <div class="lesson-section-header">
          <span class="lesson-section-icon">${meta.icon}</span>
          <span class="lesson-section-label">${meta.label}</span>
        </div>
        ${content ? `<div class="lesson-section-content">${escHtml(content)}</div>` : ''}
        <div>${buildAttachArea(section, type, false)}</div>
      </div>`;
  }
}

// Builds the mutable attachment area (re-rendered in-place to preserve textarea)
function buildAttachArea(section, type, isAdmin) {
  const sectionId = section?.id || null;
  const attachments = section?.attachments || [];
  const recapRefs = section?.recap_refs || [];
  const lessonId = state.activeLesson?.id;
  const otherLessons = state.lessonsData.filter(l => l.id !== lessonId);

  const recapChips = recapRefs.map((ref, i) => `
    <div class="recap-ref-chip">
      <button class="recap-ref-open" data-lid="${ref.lesson_id}"
        onclick="window.openLessonSidebar(this.dataset.lid)">
        📌 ${escHtml(ref.date)} — ${escHtml(ref.title)}
      </button>
      ${isAdmin ? `<button class="attachment-remove" data-sid="${sectionId}" data-idx="${i}"
        onclick="window.removeRecapRef(this.dataset.sid, parseInt(this.dataset.idx))">×</button>` : ''}
    </div>`).join('');

  const attachChips = attachments.map((a, i) => `
    <a class="attachment-chip" href="${escHtml(a.url)}" target="_blank" rel="noopener">
      ${a.type === 'file' ? '📎' : '🔗'} ${escHtml(a.label || a.name || a.url)}
    </a>
    ${isAdmin ? `<button class="attachment-remove" data-sid="${sectionId}" data-idx="${i}"
      onclick="window.removeLessonAttachment(this.dataset.sid, parseInt(this.dataset.idx))">×</button>` : ''}`).join('');

  const hasContent = recapRefs.length > 0 || attachments.length > 0;

  const chips = hasContent ? `
    <div class="section-attachments">
      ${recapChips}
      ${attachChips ? `<div class="attachment-chips">${attachChips}</div>` : ''}
    </div>` : '';

  if (!isAdmin || !sectionId) return chips;

  const recapPicker = type === 'recap' ? `
    <div class="recap-picker" id="recap-picker-${sectionId}" style="display:none">
      <div class="recap-picker-title">Stunde verlinken:</div>
      ${otherLessons.length === 0
        ? `<div class="text-muted text-sm" style="padding:8px 12px">Keine anderen Stunden vorhanden</div>`
        : otherLessons.map(l => {
            const ld = l.date ? new Date(l.date + 'T12:00:00') : null;
            const ldate = ld ? ld.toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
            const ltitle = l.title || `Stunde vom ${ldate}`;
            return `<button class="recap-option"
              data-sid="${sectionId}" data-lid="${l.id}"
              data-ldate="${escHtml(ldate)}" data-ltitle="${escHtml(ltitle)}"
              onclick="window.addRecapRef(this.dataset.sid,this.dataset.lid,this.dataset.ldate,this.dataset.ltitle)">
              ${escHtml(ldate)} — ${escHtml(ltitle)}
            </button>`;
          }).join('')}
    </div>` : '';

  const linkForm = `
    <div class="link-form" id="link-form-${sectionId}" style="display:none">
      <input class="link-form-input" id="link-url-${sectionId}" type="url" placeholder="URL (https://…)">
      <input class="link-form-input" id="link-label-${sectionId}" type="text" placeholder="Beschriftung (optional)">
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-primary btn-xs" data-sid="${sectionId}"
          onclick="window.saveLessonLink(this.dataset.sid)">Hinzufügen</button>
        <button class="btn btn-ghost btn-xs" data-sid="${sectionId}"
          onclick="window.hideLinkForm(this.dataset.sid)">Abbrechen</button>
      </div>
    </div>`;

  const toolbar = `
    <div class="section-attach-bar">
      <button class="btn btn-ghost btn-xs" data-sid="${sectionId}"
        onclick="window.showLinkForm(this.dataset.sid)">🔗 Link</button>
      <button class="btn btn-ghost btn-xs"
        onclick="document.getElementById('file-${sectionId}').click()">📎 Datei</button>
      <input type="file" id="file-${sectionId}" style="display:none"
        data-sid="${sectionId}" data-lid="${lessonId}"
        onchange="window.uploadLessonFile(this.dataset.sid, this.dataset.lid, this)">
      ${type === 'recap' ? `<button class="btn btn-ghost btn-xs" data-sid="${sectionId}"
        onclick="window.toggleRecapPicker(this.dataset.sid)">📌 Vorherige Stunde</button>` : ''}
    </div>
    ${linkForm}
    ${recapPicker}`;

  return chips + toolbar;
}

// Surgical update of one section's attachment area
function refreshAttachArea(sectionId) {
  if (!state.activeLesson) return;
  const section = state.activeLesson.sections.find(s => s.id === sectionId);
  const el = document.getElementById('attach-area-' + sectionId);
  if (!el || !section) return;
  const type = section.section_type;
  el.innerHTML = buildAttachArea(section, type, state.profile?.is_admin);
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ========== ACTIONS — NAVIGATION ==========

window.selectLessonStudent = async (studentId) => {
  state.lessonStudent = studentId || null;
  state.lessonsData = [];
  if (state.lessonStudent) await loadLessons();
  render();
};

window.newLesson = async () => {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await sb.from('lessons').insert({
    teacher_id: state.user.id,
    student_id: state.lessonStudent,
    date: today,
    status: 'draft',
  }).select().single();
  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
  const sections = SECTION_ORDER.map((type, i) => ({
    lesson_id: data.id, section_type: type, content: '', sort_order: i,
  }));
  await sb.from('lesson_sections').insert(sections);
  await loadActiveLesson(data.id);
  render();
};

window.openLesson = async (lessonId) => {
  await loadActiveLesson(lessonId);
  render();
};

window.closeLesson = () => {
  state.activeLesson = null;
  state.lessonSidebar = null;
  render();
};

// ========== ACTIONS — LESSON METADATA ==========

window.saveLessonTitle = async (title) => {
  if (!state.activeLesson) return;
  await sb.from('lessons').update({ title }).eq('id', state.activeLesson.id);
  state.activeLesson.title = title;
  // Update in list too
  const lm = state.lessonsData.find(l => l.id === state.activeLesson.id);
  if (lm) lm.title = title;
};

window.saveLessonDate = async (date) => {
  if (!state.activeLesson) return;
  await sb.from('lessons').update({ date }).eq('id', state.activeLesson.id);
  state.activeLesson.date = date;
  const lm = state.lessonsData.find(l => l.id === state.activeLesson.id);
  if (lm) lm.date = date;
  // Re-render just the header label
  const label = document.querySelector('.session-header-label');
  if (label && date) {
    const d = new Date(date + 'T12:00:00');
    label.textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }
};

window.deleteLesson = async () => {
  const lesson = state.activeLesson;
  if (!lesson) return;
  if (!confirm('Stundenplan löschen? Das kann nicht rückgängig gemacht werden.')) return;

  // Delete uploaded files from storage
  const filePaths = lesson.sections.flatMap(s =>
    (s.attachments || []).filter(a => a.type === 'file' && a.path).map(a => a.path)
  );
  if (filePaths.length) await sb.storage.from('lesson-files').remove(filePaths);

  await sb.from('lessons').delete().eq('id', lesson.id);
  state.activeLesson = null;
  state.lessonSidebar = null;
  state.lessonsData = state.lessonsData.filter(l => l.id !== lesson.id);
  render();
};

window.toggleLessonStatus = async () => {
  if (!state.activeLesson) return;
  const newStatus = state.activeLesson.status === 'done' ? 'draft' : 'done';
  await sb.from('lessons').update({ status: newStatus }).eq('id', state.activeLesson.id);
  state.activeLesson.status = newStatus;
  render();
};

// ========== PERSONAL VOCAB PANEL ==========

function buildPersonalVocabPanel() {
  const lesson = state.activeLesson;
  const pv = lesson?.personalVocab || [];

  const rows = pv.map(v => {
    const inSrs = !!v.srs;
    const srsIndicator = inSrs ? `<span class="pv-srs-badge">✓ SRS</span>` : '';
    const sentenceHtml = v.example_sentence
      ? `<div class="pv-sentence">${escHtml(v.example_sentence)}</div>`
      : `<div class="pv-sentence pv-sentence-loading">Satz wird generiert…</div>`;
    return `
      <div class="pv-row" id="pv-row-${v.id}">
        <div class="pv-words">
          <span class="pv-german">${escHtml(v.german)}</span>
          <span class="pv-sep">·</span>
          <span class="pv-english">${escHtml(v.english || '—')}</span>
          ${srsIndicator}
        </div>
        ${sentenceHtml}
        <div class="pv-actions">
          <button class="btn btn-ghost btn-xs" data-pvid="${v.id}"
            onclick="window.removePersonalVocab(this.dataset.pvid)">×</button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="pv-panel">
      <div class="pv-header">
        <span class="pv-header-icon">📝</span>
        <span class="pv-header-label">Eigene Wörter dieser Stunde</span>
        <span class="pv-count">${pv.length}</span>
        ${pv.length > 0 ? `<button class="btn btn-success btn-xs" onclick="window.addAllVocabToSrs()">Alle Wörter hinzufügen</button>` : ''}
      </div>
      <div class="pv-list">${rows}</div>
      <div class="pv-add-form">
        <input class="pv-input" id="pv-german" type="text" placeholder="Deutsch (z.B. der Bahnhof)"
          onkeydown="if(event.key==='Enter')window.addPersonalVocab()">
        <input class="pv-input" id="pv-english" type="text" placeholder="Englisch (z.B. the station)"
          onkeydown="if(event.key==='Enter')window.addPersonalVocab()">
        <button class="btn btn-primary btn-sm" onclick="window.addPersonalVocab()">Hinzufügen</button>
      </div>
    </div>`;
}

function refreshPvPanel() {
  const el = document.getElementById('pv-panel');
  if (el) el.innerHTML = buildPersonalVocabPanel();
}

window.addPersonalVocab = async () => {
  const lesson = state.activeLesson;
  if (!lesson) return;
  const germanEl = document.getElementById('pv-german');
  const englishEl = document.getElementById('pv-english');
  const german = germanEl?.value?.trim();
  const english = englishEl?.value?.trim();
  if (!german) { showToast('Bitte deutsches Wort eingeben', 'error'); return; }

  const { data, error } = await sb.from('personal_vocab').insert({
    student_id: lesson.student_id,
    teacher_id: state.user.id,
    lesson_id: lesson.id,
    german,
    english: english || null,
  }).select().single();
  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }

  lesson.personalVocab = [...(lesson.personalVocab || []), { ...data, srs: null }];
  if (germanEl) germanEl.value = '';
  if (englishEl) englishEl.value = '';
  refreshPvPanel();

  // Auto-generate sentence in background
  _generatePvSentence(data.id, german, english);
};

async function _generatePvSentence(pvId, german, english) {
  const { data, error } = await sb.functions.invoke('generate-vocab-sentences', {
    body: { vocab: [{ id: pvId, german, english }] },
    headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (error) {
    const body = await error.context?.json?.().catch(() => null);
    console.error('Sentence gen error:', error.message, body);
    const rowEl = document.getElementById('pv-row-' + pvId);
    if (rowEl) {
      const sentEl = rowEl.querySelector('.pv-sentence');
      if (sentEl) { sentEl.textContent = '—'; sentEl.classList.remove('pv-sentence-loading'); }
    }
    return;
  }
  const sentence = data?.sentences?.[0]?.sentence;
  if (!sentence) return;
  await sb.from('personal_vocab').update({ example_sentence: sentence }).eq('id', pvId);
  const item = state.activeLesson?.personalVocab?.find(v => v.id === pvId);
  if (item) {
    item.example_sentence = sentence;
    const rowEl = document.getElementById('pv-row-' + pvId);
    if (rowEl) {
      const sentEl = rowEl.querySelector('.pv-sentence');
      if (sentEl) { sentEl.textContent = sentence; sentEl.classList.remove('pv-sentence-loading'); }
    }
  }
}

window.removePersonalVocab = async (pvId) => {
  const lesson = state.activeLesson;
  if (!lesson) return;
  await sb.from('personal_vocab').delete().eq('id', pvId);
  lesson.personalVocab = (lesson.personalVocab || []).filter(v => v.id !== pvId);
  refreshPvPanel();
};

// ========== BLUEPRINTS ==========

function buildBlueprintPicker() {
  if (!state.blueprints.length) return '';
  const options = state.blueprints.map(bp => `
    <button class="blueprint-option" data-bpid="${bp.id}" data-bptitle="${escHtml(bp.title)}"
      onclick="window.newLessonFromBlueprint(this.dataset.bpid, this.dataset.bptitle)">
      <span class="blueprint-option-icon">📋</span>
      <span class="blueprint-option-title">${escHtml(bp.title)}</span>
      <span class="blueprint-option-date">${new Date(bp.created_at).toLocaleDateString('de-DE')}</span>
    </button>`).join('');
  return `
    <div class="blueprint-picker">
      <div class="blueprint-picker-header">
        <span>Vorlage wählen:</span>
        <button class="btn btn-ghost btn-xs" onclick="window.toggleBlueprintPicker()">✕</button>
      </div>
      ${options}
    </div>`;
}

function buildBlueprintListSection() {
  if (!state.blueprints.length) return '';
  const rows = state.blueprints.map(bp => `
    <div class="blueprint-row">
      <div class="blueprint-row-info">
        <span class="blueprint-row-icon">📋</span>
        <span class="blueprint-row-title">${escHtml(bp.title)}</span>
        <span class="blueprint-row-date">${new Date(bp.created_at).toLocaleDateString('de-DE')}</span>
      </div>
      <button class="btn btn-ghost btn-xs" data-bpid="${bp.id}"
        onclick="window.deleteBlueprint(this.dataset.bpid)">Löschen</button>
    </div>`).join('');
  return `
    <div class="blueprint-list-section">
      <div class="blueprint-list-header">📋 Meine Vorlagen</div>
      ${rows}
    </div>`;
}

window.toggleBlueprintPicker = () => {
  state.blueprintPickerOpen = !state.blueprintPickerOpen;
  render();
};

window.saveLessonAsBlueprint = async () => {
  const lesson = state.activeLesson;
  if (!lesson) return;
  const title = prompt('Name der Vorlage:', lesson.title || 'Neue Vorlage');
  if (!title?.trim()) return;

  const { data: bp, error } = await sb.from('blueprints').insert({
    author_id: state.user.id,
    title: title.trim(),
  }).select().single();
  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }

  const bpSections = SECTION_ORDER.map((type, i) => {
    const sec = lesson.sections.find(s => s.section_type === type);
    return { blueprint_id: bp.id, section_type: type, content: sec?.content || '', sort_order: i };
  });
  await sb.from('blueprint_sections').insert(bpSections);

  state.blueprints = [{ id: bp.id, title: bp.title, created_at: bp.created_at }, ...state.blueprints];
  showToast('Vorlage gespeichert!', 'success');
};

window.applyBlueprintToLesson = async () => {
  const lesson = state.activeLesson;
  if (!state.blueprints.length || !lesson) return;

  const options = state.blueprints.map((bp, i) => `${i + 1}. ${bp.title}`).join('\n');
  const choice = prompt(`Welche Vorlage anwenden?\n\n${options}\n\nNummer eingeben:`);
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= state.blueprints.length) return;

  const bp = state.blueprints[idx];
  if (!confirm(`Vorlage "${bp.title}" anwenden? Bestehende Texte werden überschrieben.`)) return;

  const { data: bpSections } = await sb.from('blueprint_sections')
    .select('*').eq('blueprint_id', bp.id);
  if (!bpSections?.length) { showToast('Vorlage ist leer', 'error'); return; }

  for (const bpSec of bpSections) {
    const lessonSec = lesson.sections.find(s => s.section_type === bpSec.section_type);
    if (lessonSec) {
      await sb.from('lesson_sections').update({ content: bpSec.content }).eq('id', lessonSec.id);
      lessonSec.content = bpSec.content;
    }
  }
  showToast('Vorlage angewendet!', 'success');
  render();
};

window.newLessonFromBlueprint = async (blueprintId, blueprintTitle) => {
  if (!state.lessonStudent) return;
  state.blueprintPickerOpen = false;

  const today = new Date().toISOString().split('T')[0];
  const { data: lesson, error } = await sb.from('lessons').insert({
    teacher_id: state.user.id,
    student_id: state.lessonStudent,
    date: today,
    status: 'draft',
    blueprint_id: blueprintId,
  }).select().single();
  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }

  const { data: bpSections } = await sb.from('blueprint_sections')
    .select('*').eq('blueprint_id', blueprintId).order('sort_order');

  const sections = SECTION_ORDER.map((type, i) => {
    const bpSec = (bpSections || []).find(s => s.section_type === type);
    return { lesson_id: lesson.id, section_type: type, content: bpSec?.content || '', sort_order: i };
  });
  await sb.from('lesson_sections').insert(sections);

  await loadActiveLesson(lesson.id);
  render();
};

window.deleteBlueprint = async (bpId) => {
  if (!confirm('Vorlage löschen?')) return;
  await sb.from('blueprints').delete().eq('id', bpId);
  state.blueprints = state.blueprints.filter(bp => bp.id !== bpId);
  render();
};

// ========== LESSON SIDEBAR ==========

function buildLessonSidebar() {
  const lesson = state.lessonSidebar;
  const d = lesson.date ? new Date(lesson.date + 'T12:00:00') : null;
  const dateStr = d ? d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const title = lesson.title || `Stunde vom ${dateStr}`;

  const sectionsHtml = SECTION_ORDER.map(type => {
    const meta = SECTION_META[type];
    const sec = (lesson.sections || []).find(s => s.section_type === type);
    if (!sec?.content) return '';
    return `
      <div class="sidebar-section">
        <div class="sidebar-section-header">
          <span>${meta.icon}</span>
          <span>${meta.label}</span>
        </div>
        <div class="sidebar-section-content">${escHtml(sec.content)}</div>
      </div>`;
  }).filter(Boolean).join('');

  return `
    <div class="lesson-sidebar-overlay" onclick="window.closeLessonSidebar()"></div>
    <div class="lesson-sidebar">
      <div class="lesson-sidebar-header">
        <div>
          <div class="lesson-sidebar-date">${dateStr}</div>
          <div class="lesson-sidebar-title">${escHtml(title)}</div>
        </div>
        <button class="lesson-sidebar-close" onclick="window.closeLessonSidebar()">✕</button>
      </div>
      <div class="lesson-sidebar-body">
        ${sectionsHtml || '<div style="padding:24px;color:var(--text3);text-align:center">Keine Inhalte</div>'}
      </div>
    </div>`;
}

window.openLessonSidebar = async (lessonId) => {
  const { data: lessonRes } = await sb.from('lessons').select('*').eq('id', lessonId).single();
  const { data: sections } = await sb.from('lesson_sections').select('*').eq('lesson_id', lessonId).order('sort_order');
  state.lessonSidebar = { ...lessonRes, sections: sections || [] };
  render();
};

window.closeLessonSidebar = () => {
  state.lessonSidebar = null;
  render();
};

window.addAllVocabToSrs = async () => {
  const lesson = state.activeLesson;
  if (!lesson) return;
  const pending = (lesson.personalVocab || []).filter(v => !v.srs);
  if (!pending.length) { showToast('Alle Wörter sind bereits im SRS', 'error'); return; }

  const now = new Date().toISOString();
  const rows = pending.map(v => ({
    student_id: lesson.student_id,
    personal_vocab_id: v.id,
    next_review: now,
    interval_minutes: 1,
    ease: 1,
    review_count: 0,
    first_seen_at: now,
    last_seen_at: now,
  }));
  const { error } = await sb.from('srs_progress').insert(rows);
  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }

  const srsEntry = { next_review: now, ease: 1, review_count: 0 };
  pending.forEach(v => { v.srs = srsEntry; });
  showToast(`${pending.length} Wörter ins SRS hinzugefügt!`, 'success');
  refreshPvPanel();
};

// ========== ACTIONS — SECTION TEXT ==========

window.saveLessonSection = async (textarea) => {
  if (!state.activeLesson) return;
  const type = textarea.dataset.type;
  const sectionId = textarea.dataset.sectionid;
  const content = textarea.value;
  if (sectionId) {
    await sb.from('lesson_sections').update({ content }).eq('id', sectionId);
    const sec = state.activeLesson.sections.find(s => s.id === sectionId);
    if (sec) sec.content = content;
  } else {
    const idx = SECTION_ORDER.indexOf(type);
    const { data } = await sb.from('lesson_sections').insert({
      lesson_id: state.activeLesson.id, section_type: type, content, sort_order: idx,
    }).select().single();
    if (data) {
      state.activeLesson.sections.push(data);
      textarea.dataset.sectionid = data.id;
    }
  }
};

// ========== ACTIONS — ATTACHMENTS ==========

window.showLinkForm = (sectionId) => {
  const form = document.getElementById('link-form-' + sectionId);
  if (form) { form.style.display = form.style.display === 'none' ? 'block' : 'none'; }
};

window.hideLinkForm = (sectionId) => {
  const form = document.getElementById('link-form-' + sectionId);
  if (form) form.style.display = 'none';
};

window.saveLessonLink = async (sectionId) => {
  const urlEl = document.getElementById('link-url-' + sectionId);
  const labelEl = document.getElementById('link-label-' + sectionId);
  const url = urlEl?.value?.trim();
  if (!url) { showToast('Bitte URL eingeben', 'error'); return; }
  const label = labelEl?.value?.trim() || url;
  await _appendAttachment(sectionId, { type: 'link', url, label });
  window.hideLinkForm(sectionId);
};

window.uploadLessonFile = async (sectionId, lessonId, input) => {
  const file = input.files?.[0];
  if (!file) return;
  showToast('Datei wird hochgeladen…', 'info');
  const path = `${state.user.id}/${lessonId}/${Date.now()}_${file.name}`;
  const { error } = await sb.storage.from('lesson-files').upload(path, file);
  if (error) { showToast('Upload-Fehler: ' + error.message, 'error'); input.value = ''; return; }
  const { data: signedData } = await sb.storage.from('lesson-files').createSignedUrl(path, 3600);
  await _appendAttachment(sectionId, { type: 'file', name: file.name, path, url: signedData?.signedUrl || '#' });
  input.value = '';
  showToast('Datei hochgeladen', 'success');
};

window.removeLessonAttachment = async (sectionId, idx) => {
  const sec = state.activeLesson?.sections.find(s => s.id === sectionId);
  if (!sec) return;
  const attachments = [...(sec.attachments || [])];
  const removed = attachments.splice(idx, 1)[0];
  await sb.from('lesson_sections').update({ attachments }).eq('id', sectionId);
  sec.attachments = attachments;
  if (removed?.type === 'file' && removed.path) {
    await sb.storage.from('lesson-files').remove([removed.path]);
  }
  refreshAttachArea(sectionId);
};

async function _appendAttachment(sectionId, item) {
  const sec = state.activeLesson?.sections.find(s => s.id === sectionId);
  if (!sec) return;
  // Strip ephemeral signed URL before persisting — only path is stored
  const { url: _url, ...dbItem } = item;
  const dbAttachments = [...(sec.attachments || []).map(({ url: _u, ...a }) => a), dbItem];
  await sb.from('lesson_sections').update({ attachments: dbAttachments }).eq('id', sectionId);
  // Keep url in memory for immediate display
  sec.attachments = [...(sec.attachments || []), item];
  refreshAttachArea(sectionId);
}

// ========== ACTIONS — RECAP REFS ==========

window.toggleRecapPicker = (sectionId) => {
  const picker = document.getElementById('recap-picker-' + sectionId);
  if (picker) picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
};

window.addRecapRef = async (sectionId, lessonId, date, title) => {
  const sec = state.activeLesson?.sections.find(s => s.id === sectionId);
  if (!sec) return;
  if ((sec.recap_refs || []).some(r => r.lesson_id === lessonId)) {
    showToast('Diese Stunde ist bereits verlinkt', 'error'); return;
  }
  const recap_refs = [...(sec.recap_refs || []), { lesson_id: lessonId, date, title }];
  await sb.from('lesson_sections').update({ recap_refs }).eq('id', sectionId);
  sec.recap_refs = recap_refs;
  refreshAttachArea(sectionId);
};

window.removeRecapRef = async (sectionId, idx) => {
  const sec = state.activeLesson?.sections.find(s => s.id === sectionId);
  if (!sec) return;
  const recap_refs = [...(sec.recap_refs || [])];
  recap_refs.splice(idx, 1);
  await sb.from('lesson_sections').update({ recap_refs }).eq('id', sectionId);
  sec.recap_refs = recap_refs;
  refreshAttachArea(sectionId);
};
