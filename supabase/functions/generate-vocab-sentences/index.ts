import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `You are a German language teacher creating example sentences for A1-level vocabulary.

For each vocabulary word given, write ONE short, natural German sentence that:
- Uses the word naturally in context
- Is appropriate for A1 level (simple grammar, common words)
- Is 5-10 words long
- Helps the student understand how the word is used
- Does NOT translate or explain the word — just use it in a sentence

You will receive a JSON array of vocabulary items. Return ONLY a JSON array of objects with "id" and "sentence" fields.
Example input: [{"id": "123", "german": "der Hund", "english": "the dog"}]
Example output: [{"id": "123", "sentence": "Der Hund spielt gerne im Garten."}]

IMPORTANT: Return ONLY the JSON array. No markdown, no explanation, just the array.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify caller is an authenticated user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

    const { vocab } = await req.json()
    if (!vocab || !Array.isArray(vocab) || vocab.length === 0) {
      throw new Error('vocab array is required')
    }

    const batch = vocab.slice(0, 30)

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: JSON.stringify(batch.map(v => ({ id: v.id, german: v.german, english: v.english }))),
          },
        ],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      throw new Error(`Anthropic API error: ${anthropicRes.status} — ${errText}`)
    }

    const anthropicData = await anthropicRes.json()
    let raw = anthropicData.content?.[0]?.text?.trim() || '[]'

    if (raw.startsWith('```')) {
      raw = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
    }

    const sentences = JSON.parse(raw)

    return new Response(JSON.stringify({ sentences }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
