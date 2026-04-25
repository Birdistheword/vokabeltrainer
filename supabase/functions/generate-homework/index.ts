const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a German language homework generator for A1–B1 students.

You will receive:
- A list of exercise slots the teacher configured, each with a type and optional parameters
- The student's recently reviewed vocabulary (recentVocab)
- Upcoming new vocabulary not yet studied (upcomingVocab)

Use the vocabulary lists to make exercises feel personalised and relevant.
Prioritise recentVocab for practice, use upcomingVocab to introduce new words naturally.

CRITICAL RULES:
- All exercise instructions must be in German
- NEVER include explanations of why an answer is right or wrong — the teacher will explain verbally
- If grammarFocus is specified for a slot, every sentence/item in that exercise must practise exactly that grammar structure
- For type_in_gap: every gap must have exactly ONE unambiguous correct answer
- For drag_to_gap: wordBank must contain 4–6 words total (correct answers + plausible distractors from same semantic field)
- For word_ordering: sentences must be 4–8 words; illustrate a grammar rule
- For odd_one_out: 4 words per item, exactly one does not belong — no explanation field
- For conjugation_table: always use all 6 standard pronouns: ich / du / er\\/sie\\/es / wir / ihr / Sie\\/sie
- For error_correction: each sentence contains exactly ONE grammatical error; answer is the complete corrected sentence
- For sentence_transformation: answer is the complete transformed sentence
- For mini_dialogue: hints for student turns are short phrases in English describing what to say
- For word_association: just topic + count, no correct answers

OUTPUT FORMAT — return ONLY valid JSON, no markdown, no explanation:
{
  "title": "Short homework title in German",
  "exercises": [ ...one object per slot, in order... ]
}

EXERCISE SCHEMAS:

type_in_gap:
{
  "id": "ex_1", "type": "type_in_gap",
  "instruction": "Ergänzen Sie die Lücken.",
  "content": {
    "sentences": [
      { "id": "s1", "parts": ["Ich ", {"gap": "komme"}, " aus Deutschland."] }
    ]
  }
}

drag_to_gap:
{
  "id": "ex_2", "type": "drag_to_gap",
  "instruction": "Wählen Sie das passende Wort.",
  "content": {
    "sentences": [
      { "id": "s1", "parts": ["Mein ", {"gap": "Drucker"}, " ist kaputt."] }
    ],
    "wordBank": ["Drucker", "Sofa", "Badewanne", "Herd", "Lampe"]
  }
}

word_ordering:
{
  "id": "ex_3", "type": "word_ordering",
  "instruction": "Bringen Sie die Wörter in die richtige Reihenfolge.",
  "content": {
    "sentences": [
      { "id": "s1", "scrambled": ["spielen", "kann", "Fußball", "Ich"], "correct": ["Ich", "kann", "Fußball", "spielen"] }
    ]
  }
}

odd_one_out:
{
  "id": "ex_4", "type": "odd_one_out",
  "instruction": "Welches Wort passt nicht?",
  "content": {
    "items": [
      { "id": "i1", "words": ["Apfel", "Birne", "Traube", "Gurke"], "correct": "Gurke" }
    ]
  }
}

conjugation_table:
{
  "id": "ex_5", "type": "conjugation_table",
  "instruction": "Konjugieren Sie das Verb im Präsens.",
  "content": {
    "verb": "fahren",
    "tense": "Präsens",
    "rows": [
      {"pronoun": "ich",        "answer": "fahre"},
      {"pronoun": "du",         "answer": "fährst"},
      {"pronoun": "er/sie/es",  "answer": "fährt"},
      {"pronoun": "wir",        "answer": "fahren"},
      {"pronoun": "ihr",        "answer": "fahrt"},
      {"pronoun": "Sie/sie",    "answer": "fahren"}
    ]
  }
}

error_correction:
{
  "id": "ex_6", "type": "error_correction",
  "instruction": "Finden Sie den Fehler und schreiben Sie den Satz richtig.",
  "content": {
    "sentences": [
      { "id": "s1", "text": "Ich habe gestern ins Kino gegangen.", "answer": "Ich bin gestern ins Kino gegangen." }
    ]
  }
}

sentence_transformation:
{
  "id": "ex_7", "type": "sentence_transformation",
  "instruction": "Schreiben Sie die Sätze im Perfekt.",
  "content": {
    "transformation": "Präsens → Perfekt",
    "sentences": [
      { "id": "s1", "original": "Ich esse einen Apfel.", "answer": "Ich habe einen Apfel gegessen." }
    ]
  }
}

mini_dialogue:
{
  "id": "ex_8", "type": "mini_dialogue",
  "instruction": "Ergänzen Sie Ihre Seite des Gesprächs.",
  "content": {
    "context": "Sie sind im Restaurant.",
    "turns": [
      {"speaker": "other",   "name": "Kellner", "text": "Guten Abend! Was möchten Sie trinken?"},
      {"speaker": "student", "hint": "Order a mineral water."},
      {"speaker": "other",   "name": "Kellner", "text": "Und was essen Sie?"},
      {"speaker": "student", "hint": "Order soup and a salad."}
    ]
  }
}

word_association:
{
  "id": "ex_9", "type": "word_association",
  "instruction": "Schreiben Sie 5 Wörter zum Thema 'Reisen'.",
  "content": { "topic": "Reisen", "count": 5 }
}

IMPORTANT: Return ONLY the JSON object. No markdown. No explanation text.`

// ──────────────────────────────────────────────────────────────────────────────
// HANDLER
// ──────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { studentName, exercises, recentVocab = [], upcomingVocab = [] } = await req.json()

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build the user message with structured exercise specs + real vocab
    const recentVocabText = recentVocab.length > 0
      ? `RECENTLY STUDIED VOCABULARY (prioritise these):\n${recentVocab.map((v: {german:string,english:string}) => `  ${v.german} — ${v.english}`).join('\n')}`
      : 'RECENTLY STUDIED VOCABULARY: none yet'

    const upcomingVocabText = upcomingVocab.length > 0
      ? `UPCOMING NEW VOCABULARY (introduce naturally where appropriate):\n${upcomingVocab.map((v: {german:string,english:string}) => `  ${v.german} — ${v.english}`).join('\n')}`
      : 'UPCOMING NEW VOCABULARY: none'

    const exerciseSpecsText = exercises.map((ex: any, i: number) => {
      const parts = [`Slot ${i + 1}: type=${ex.type}`]
      if (ex.grammarFocus)       parts.push(`grammarFocus="${ex.grammarFocus}"`)
      if (ex.theme)              parts.push(`theme="${ex.theme}"`)
      if (ex.vocabSource)        parts.push(`vocabSource=${ex.vocabSource}`)
      if (ex.count)              parts.push(`count=${ex.count}`)
      if (ex.customInstruction)  parts.push(`instruction="${ex.customInstruction}"`)
      return parts.join(', ')
    }).join('\n')

    const userMessage = `Student: ${studentName}

${recentVocabText}

${upcomingVocabText}

EXERCISE SLOTS TO GENERATE:
${exerciseSpecsText}

Generate exactly ${exercises.length} exercise(s) in the order listed. Return only JSON.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Anthropic API error: ${response.status} — ${err}`)
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''

    let homework
    try {
      homework = JSON.parse(text)
    } catch {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/)
      if (!match) throw new Error('No valid JSON found in AI response')
      homework = JSON.parse(match[1] || match[0])
    }

    return new Response(JSON.stringify(homework), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('Edge function error:', e)
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
