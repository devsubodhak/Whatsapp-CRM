// ------------------------------------------------------------
// Gemini client for the `ai_reply` automation step.
//
// Thin wrapper over the Gemini REST `generateContent` endpoint — no
// SDK dependency. Given an inbound customer message, a knowledge base,
// and (optionally) recent conversation history, it asks the model to
// draft a reply *in the same language the customer used*: English,
// Sinhala (Unicode script), or Singlish (Sinhala romanized in Latin
// letters).
//
// Why prompt-stuffing and not embeddings/RAG: a single account's price
// list / FAQ comfortably fits in the model context window, so we hand
// the whole knowledge base over each call. Simpler and more accurate
// than chunk-retrieval for this size of data.
// ------------------------------------------------------------

const DEFAULT_MODEL = 'gemini-2.5-flash'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/** A prior message in the conversation, oldest-first. */
export interface HistoryTurn {
  /** 'customer' maps to the user role; 'agent'/'bot' map to the model role. */
  role: 'customer' | 'agent' | 'bot'
  text: string
}

export interface GenerateReplyInput {
  /** The inbound message we're replying to. */
  message: string
  /** Knowledge base text/markdown (prices, product details, FAQ…). */
  knowledge?: string
  /** Persona / tone instructions from the step config. */
  systemPrompt?: string
  /** Recent conversation, oldest-first. Omitted when history is off. */
  history?: HistoryTurn[]
  /** Gemini model id; falls back to DEFAULT_MODEL. */
  model?: string
}

/**
 * Sinhala occupies the Unicode block U+0D80–U+0DFF. Detecting the
 * script is trivial and reliable; we pass the result to the model as a
 * hint. Singlish (romanized Sinhala) has no rule-based detector — that
 * judgement is left to the model, which is far better at it.
 */
export function detectScriptHint(text: string): 'sinhala-script' | 'latin' {
  return /[඀-෿]/.test(text) ? 'sinhala-script' : 'latin'
}

const LANGUAGE_RULES = `You are replying to a customer on WhatsApp. Detect which language and script the customer wrote in and reply in the EXACT same one:
- English — reply in English.
- Sinhala script (අ, ක, ම …) — reply in Sinhala script.
- Singlish (Sinhala typed in English/Latin letters, e.g. "mokakda price eka?", "ow", "naha", "mata one") — reply in Singlish, matching their romanized style. Do NOT switch to Sinhala script for a Singlish message.
Never mix languages in one reply. Keep replies short and natural for chat.`

const ACCURACY_RULES = `ACCURACY — these are real paying customers, so correctness matters more than sounding helpful:
1. Answer ONLY with facts that are written in the knowledge base below. Do not use outside knowledge or assumptions.
2. NEVER invent or estimate prices, model numbers, capacities, dimensions, delivery times, warranty terms, or any specific figure. If a number is not in the knowledge base, do not state one.
3. If the customer asks something the knowledge base does not answer (e.g. a price that isn't listed), say you don't have that exact detail on hand and give them the contact phone number / offer to connect them with the team. Use the phone number or email exactly as written in the knowledge base.
4. When the knowledge base DOES contain the answer, give it fully and specifically — don't be vague.
5. Stay on the topic of this company and its products. Politely decline unrelated requests.
6. Quote names, prices, and contact details verbatim from the knowledge base — do not paraphrase numbers.`

function buildSystemInstruction(input: GenerateReplyInput): string {
  const parts: string[] = []
  if (input.systemPrompt?.trim()) parts.push(input.systemPrompt.trim())
  parts.push(LANGUAGE_RULES)
  parts.push(ACCURACY_RULES)
  parts.push(`Detected script of the latest message: ${detectScriptHint(input.message)} (a hint — trust the message itself).`)
  if (input.knowledge?.trim()) {
    parts.push(`--- KNOWLEDGE BASE START ---\n${input.knowledge.trim()}\n--- KNOWLEDGE BASE END ---`)
  } else {
    parts.push('(No knowledge base was provided. Be honest about not having details and offer to connect a team member — do not answer product questions from general knowledge.)')
  }
  return parts.join('\n\n')
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: { text: string }[]
}

function buildContents(input: GenerateReplyInput): GeminiContent[] {
  const contents: GeminiContent[] = []
  for (const turn of input.history ?? []) {
    if (!turn.text?.trim()) continue
    contents.push({
      role: turn.role === 'customer' ? 'user' : 'model',
      parts: [{ text: turn.text }],
    })
  }
  // The message we're actually replying to goes last.
  contents.push({ role: 'user', parts: [{ text: input.message }] })
  return contents
}

/**
 * Call Gemini and return the drafted reply text. Throws on missing API
 * key, transport failure, a non-2xx response, or an empty/blocked
 * completion — the engine catches and falls back to `fallback_text`.
 */
export async function generateReply(input: GenerateReplyInput): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  if (!input.message?.trim()) throw new Error('ai_reply: empty inbound message')

  const model = input.model?.trim() || DEFAULT_MODEL
  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  // gemini-2.5-flash is a *reasoning* model: it spends hidden "thinking"
  // tokens before answering, and those count against maxOutputTokens.
  // For a short customer-support reply that reasoning is wasted budget —
  // worse, on token-heavy scripts like Sinhala it can consume the whole
  // ceiling and the visible answer gets cut off mid-sentence
  // (finishReason=MAX_TOKENS). Disabling thinking makes replies complete,
  // faster, and cheaper. Only the 2.5-flash family accepts a 0 budget
  // (2.5-pro requires a minimum; 2.0-flash has no thinking at all), so
  // guard on the model name to avoid a 400 on those.
  const generationConfig: Record<string, unknown> = {
    // Low temperature: these are customer-facing answers, so we want
    // factual, consistent replies grounded in the knowledge base rather
    // than creative variation.
    temperature: 0.2,
    // Generous ceiling — Sinhala/Singlish tokenize heavily, so a "short"
    // reply can still run a few hundred tokens.
    maxOutputTokens: 2048,
  }
  if (/2\.5-flash/.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildSystemInstruction(input) }] },
      contents: buildContents(input),
      generationConfig,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
  }

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`)
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason
    throw new Error(`Gemini returned no text${reason ? ` (finishReason=${reason})` : ''}`)
  }
  return text
}
