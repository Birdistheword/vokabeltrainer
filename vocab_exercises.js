// ========== VOCAB EXERCISES MODULE ==========
// Exercise types for the review session (Wiederholen mode).
// New words always use flashcards (handled in app.js).
//
// Types: multiple_choice | type_the_word | letter_unscramble | sentence_builder

// ========== STATE INITIALIZER ==========

function initExState(card) {
  if (!card || card.exerciseType === 'flashcard') return null;
  const { vocab, exerciseType } = card;
  const isDE_EN = state.direction === 'de_en';
  // prompt = what the student sees as a clue
  // target = what the student must produce
  const prompt = isDE_EN ? vocab.german : vocab.english;
  const target = isDE_EN ? vocab.english : vocab.german;

  switch (exerciseType) {
    case 'multiple_choice': {
      const allVocab = state.session?.allVocab || [];
      const distractors = allVocab
        .filter(v => v.id !== vocab.id)
        .map(v => (isDE_EN ? v.english : v.german))
        .filter(Boolean);
      shuffle(distractors);
      const options = [target, ...distractors.slice(0, 3)];
      shuffle(options);
      return {
        options: options.map(o => ({ text: o, isCorrect: o === target })),
        selected: null,
        answered: false,
        correct: false,
      };
    }
    case 'type_the_word': {
      return {
        value: '',
        checked: false,
        correct: false,
        target,
      };
    }
    case 'letter_unscramble': {
      const letters = target.split('');
      const remaining = [...letters];
      shuffle(remaining);
      // Make sure scrambled is different from the answer
      let attempts = 0;
      while (remaining.join('') === target && attempts < 10) {
        shuffle(remaining);
        attempts++;
      }
      return {
        arranged: [],
        remaining,
        target,
        checked: false,
        correct: false,
      };
    }
    case 'sentence_builder': {
      const sentence = vocab.example_sentence || '';
      const words = sentence.split(' ').filter(Boolean);
      const remaining = [...words];
      shuffle(remaining);
      return {
        arranged: [],
        remaining,
        sentence,
        checked: false,
        correct: false,
      };
    }
    default:
      return null;
  }
}

// ========== MAIN ROUTER ==========

function buildVocabExercise(card, exState) {
  if (!card || !exState) return '';
  switch (card.exerciseType) {
    case 'multiple_choice':   return buildMultipleChoice(card, exState);
    case 'type_the_word':     return buildTypeTheWord(card, exState);
    case 'letter_unscramble': return buildLetterUnscramble(card, exState);
    case 'sentence_builder':  return buildSentenceBuilder(card, exState);
    default: return '';
  }
}

// ========== SHARED EXERCISE CHROME ==========

function exTypeLabel(type) {
  return {
    multiple_choice:   '🔤 Multiple Choice',
    type_the_word:     '✏️ Schreiben',
    letter_unscramble: '🔀 Buchstaben ordnen',
    sentence_builder:  '📝 Satz bilden',
  }[type] || type;
}

function buildExerciseShell(card, content, bottomBar) {
  const dirLabel = state.direction === 'de_en' ? '🇩🇪 → 🇬🇧' : '🇬🇧 → 🇩🇪';
  return `
    <div class="ex-card" style="width:100%;max-width:560px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <span style="font-size:12px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px">${exTypeLabel(card.exerciseType)}</span>
        <span style="font-size:12px;color:var(--text2)">${dirLabel}</span>
      </div>
      ${content}
      ${bottomBar}
    </div>`;
}

function buildFeedbackResult(correct, correctAnswer) {
  return `
    <div style="margin-top:16px;padding:12px 16px;border-radius:12px;
      background:${correct ? 'rgba(34,192,107,0.1)' : 'rgba(240,74,90,0.08)'};
      border:1.5px solid ${correct ? 'var(--green)' : 'var(--red)'}">
      <div style="font-weight:800;color:${correct ? 'var(--green)' : 'var(--red)'};margin-bottom:${!correct ? '4px' : '0'}">
        ${correct ? '✓ Richtig!' : '✗ Falsch'}
      </div>
      ${!correct ? `<div style="font-size:13px;color:var(--text2)">Richtige Antwort: <strong>${correctAnswer}</strong></div>` : ''}
    </div>`;
}

// ========== 1. MULTIPLE CHOICE ==========

function buildMultipleChoice(card, exState) {
  const { vocab } = card;
  const isDE_EN = state.direction === 'de_en';
  const prompt = isDE_EN ? vocab.german : vocab.english;

  const content = `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:8px">Was bedeutet…</div>
      <div style="font-size:36px;font-weight:900;color:var(--text);letter-spacing:-0.5px">${prompt}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${exState.options.map((opt, i) => {
        let style = '';
        if (exState.answered) {
          if (opt.isCorrect) style = 'background:rgba(34,192,107,0.12);border-color:var(--green);color:var(--green)';
          else if (exState.selected === i) style = 'background:rgba(240,74,90,0.08);border-color:var(--red);color:var(--red)';
          else style = 'opacity:0.5';
        }
        return `<button
          class="mc-option"
          style="${style}"
          data-idx="${i}"
          ${exState.answered ? 'disabled' : 'onclick="exMCSelect(this)"'}>
          ${opt.text}
        </button>`;
      }).join('')}
    </div>`;

  const bottomBar = exState.answered ? `
    <button class="btn btn-primary" style="width:100%;margin-top:20px" onclick="exAdvance()">
      Weiter →
    </button>` : '';

  return buildExerciseShell(card, content, bottomBar);
}

// ========== 2. TYPE THE WORD ==========

function buildTypeTheWord(card, exState) {
  const { vocab } = card;
  const isDE_EN = state.direction === 'de_en';
  const prompt = isDE_EN ? vocab.german : vocab.english;
  const targetLang = isDE_EN ? 'Englisch' : 'Deutsch';

  const content = `
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:8px">Schreibe auf ${targetLang}:</div>
      <div style="font-size:36px;font-weight:900;color:var(--text);letter-spacing:-0.5px">${prompt}</div>
    </div>
    <input
      id="ex-type-input"
      type="text"
      autocomplete="off"
      autocorrect="off"
      spellcheck="false"
      placeholder="Antwort eingeben…"
      value="${exState.value.replace(/"/g, '&quot;')}"
      ${exState.checked ? 'disabled' : 'oninput="exTypeInput(this)" onkeydown="exTypeKeydown(event)"'}
      style="width:100%;padding:14px 16px;font-size:18px;font-weight:700;text-align:center;
        border:2px solid ${exState.checked ? (exState.correct ? 'var(--green)' : 'var(--red)') : 'var(--border)'};
        border-radius:12px;background:var(--surface2);color:var(--text);
        font-family:'Nunito',sans-serif;outline:none;box-sizing:border-box"
    />
    ${exState.checked ? buildFeedbackResult(exState.correct, exState.target) : ''}`;

  const bottomBar = !exState.checked
    ? `<button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="exTypeCheck()">Überprüfen</button>`
    : `<button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="exAdvance()">Weiter →</button>`;

  return buildExerciseShell(card, content, bottomBar);
}

// ========== 3. LETTER UNSCRAMBLE ==========

function buildLetterUnscramble(card, exState) {
  const { vocab } = card;
  const isDE_EN = state.direction === 'de_en';
  const prompt = isDE_EN ? vocab.german : vocab.english;
  const targetLang = isDE_EN ? 'Englisch' : 'Deutsch';

  const content = `
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:8px">Wie heißt das auf ${targetLang}?</div>
      <div style="font-size:36px;font-weight:900;color:var(--text);letter-spacing:-0.5px">${prompt}</div>
    </div>

    <!-- Arranged letters (answer zone) -->
    <div style="min-height:52px;border:2px dashed ${exState.checked ? (exState.correct ? 'var(--green)' : 'var(--red)') : 'var(--border)'};
      border-radius:12px;padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;
      background:${exState.checked ? (exState.correct ? 'rgba(34,192,107,0.06)' : 'rgba(240,74,90,0.04)') : 'var(--surface2)'};
      margin-bottom:12px;cursor:${exState.checked ? 'default' : 'default'}">
      ${exState.arranged.length === 0
        ? `<span style="color:var(--text3);font-size:13px">Buchstaben hier einordnen…</span>`
        : exState.arranged.map((l, i) => `
          <button class="letter-chip placed"
            data-idx="${i}"
            ${exState.checked ? 'disabled' : 'onclick="exLetterRemove(this)"'}>
            ${l}
          </button>`).join('')
      }
    </div>

    <!-- Remaining letters -->
    ${!exState.checked ? `
      <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:4px">
        ${exState.remaining.map((l, i) => `
          <button class="letter-chip"
            data-idx="${i}"
            onclick="exLetterAdd(this)">
            ${l}
          </button>`).join('')}
      </div>` : buildFeedbackResult(exState.correct, exState.target)
    }`;

  const bottomBar = !exState.checked
    ? `<div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-ghost" style="flex:1" onclick="exLetterClear()">Zurücksetzen</button>
        <button class="btn btn-primary" style="flex:2" onclick="exLetterCheck()"
          ${exState.arranged.length === 0 ? 'disabled' : ''}>Überprüfen</button>
      </div>`
    : `<button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="exAdvance()">Weiter →</button>`;

  return buildExerciseShell(card, content, bottomBar);
}

// ========== 4. SENTENCE BUILDER ==========

function buildSentenceBuilder(card, exState) {
  const { vocab } = card;

  const content = `
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:6px">Bilde einen Satz mit:</div>
      <div style="font-size:28px;font-weight:900;color:var(--accent)">${vocab.german}</div>
      ${vocab.english ? `<div style="font-size:14px;color:var(--text2);margin-top:4px">(${vocab.english})</div>` : ''}
    </div>

    <!-- Arranged words (answer zone) -->
    <div style="min-height:56px;border:2px dashed ${exState.checked ? (exState.correct ? 'var(--green)' : 'var(--red)') : 'var(--border)'};
      border-radius:12px;padding:10px 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;
      background:${exState.checked ? (exState.correct ? 'rgba(34,192,107,0.06)' : 'rgba(240,74,90,0.04)') : 'var(--surface2)'};
      margin-bottom:12px">
      ${exState.arranged.length === 0
        ? `<span style="color:var(--text3);font-size:13px">Wörter hier einordnen…</span>`
        : exState.arranged.map((w, i) => `
          <button class="word-chip placed"
            data-idx="${i}"
            ${exState.checked ? 'disabled' : 'onclick="exWordRemove(this)"'}>
            ${w}
          </button>`).join('')
      }
    </div>

    <!-- Remaining words -->
    ${!exState.checked ? `
      <div class="word-bank">
        ${exState.remaining.map((w, i) => `
          <button class="word-chip"
            data-idx="${i}"
            data-word="${w.replace(/"/g, '&quot;')}"
            onclick="exWordAdd(this)">
            ${w}
          </button>`).join('')}
      </div>` : buildFeedbackResult(exState.correct, exState.sentence)
    }`;

  const bottomBar = !exState.checked
    ? `<div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-ghost" style="flex:1" onclick="exWordClear()">Zurücksetzen</button>
        <button class="btn btn-primary" style="flex:2" onclick="exWordCheck()"
          ${exState.arranged.length === 0 ? 'disabled' : ''}>Überprüfen</button>
      </div>`
    : `<button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="exAdvance()">Weiter →</button>`;

  return buildExerciseShell(card, content, bottomBar);
}

// ========== INTERACTION HANDLERS ==========

// Advance to next card after exercise answered (auto-rates based on correct/wrong)
window.exAdvance = () => {
  const correct = state.exState?.correct ?? false;
  rateCard(correct ? 3 : 1);
};

// --- Multiple choice ---
window.exMCSelect = (btn) => {
  const idx = parseInt(btn.dataset.idx);
  const exState = state.exState;
  if (!exState || exState.answered) return;
  const correct = exState.options[idx].isCorrect;
  exState.selected = idx;
  exState.answered = true;
  exState.correct = correct;
  render();
};

// --- Type the word ---
window.exTypeInput = (input) => {
  if (state.exState) state.exState.value = input.value;
};

window.exTypeKeydown = (event) => {
  if (event.key === 'Enter') window.exTypeCheck();
};

window.exTypeCheck = () => {
  const exState = state.exState;
  if (!exState || exState.checked) return;
  const input = document.getElementById('ex-type-input');
  const value = (input?.value || exState.value).trim();
  exState.value = value;
  exState.correct = value.toLowerCase() === exState.target.toLowerCase();
  exState.checked = true;
  render();
};

// --- Letter unscramble ---
window.exLetterAdd = (btn) => {
  const exState = state.exState;
  if (!exState || exState.checked) return;
  const idx = parseInt(btn.dataset.idx);
  const letter = exState.remaining[idx];
  exState.remaining.splice(idx, 1);
  exState.arranged.push(letter);
  render();
};

window.exLetterRemove = (btn) => {
  const exState = state.exState;
  if (!exState || exState.checked) return;
  const idx = parseInt(btn.dataset.idx);
  const letter = exState.arranged.splice(idx, 1)[0];
  exState.remaining.push(letter);
  render();
};

window.exLetterClear = () => {
  const exState = state.exState;
  if (!exState || exState.checked) return;
  exState.remaining.push(...exState.arranged);
  exState.arranged = [];
  render();
};

window.exLetterCheck = () => {
  const exState = state.exState;
  if (!exState || exState.checked || exState.arranged.length === 0) return;
  const answer = exState.arranged.join('');
  exState.correct = answer.toLowerCase() === exState.target.toLowerCase();
  exState.checked = true;
  render();
};

// --- Sentence builder ---
window.exWordAdd = (btn) => {
  const exState = state.exState;
  if (!exState || exState.checked) return;
  const idx = parseInt(btn.dataset.idx);
  const word = exState.remaining[idx];
  exState.remaining.splice(idx, 1);
  exState.arranged.push(word);
  render();
};

window.exWordRemove = (btn) => {
  const exState = state.exState;
  if (!exState || exState.checked) return;
  const idx = parseInt(btn.dataset.idx);
  const word = exState.arranged.splice(idx, 1)[0];
  exState.remaining.push(word);
  render();
};

window.exWordClear = () => {
  const exState = state.exState;
  if (!exState || exState.checked) return;
  exState.remaining.push(...exState.arranged);
  exState.arranged = [];
  render();
};

window.exWordCheck = () => {
  const exState = state.exState;
  if (!exState || exState.checked || exState.arranged.length === 0) return;
  const answer = exState.arranged.join(' ');
  // Case-insensitive comparison, also ignore trailing punctuation differences
  exState.correct = answer.trim().toLowerCase() === exState.sentence.trim().toLowerCase();
  exState.checked = true;
  render();
};
