import { NextRequest, NextResponse } from 'next/server'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set. Add it to your environment before starting the server.')
}

type SuggestionField = 'currentFinancialSituation' | 'employmentCircumstances' | 'reasonForApplying'

type RequestBody = {
  field: SuggestionField
  language: 'en' | 'ar'
  existingText?: string
  applicantDetails?: string
}

const fieldFocus: Record<SuggestionField, string> = {
  currentFinancialSituation:
    'current income sources, essential expenses, debts, and concrete examples of financial strain or recent hardship',
  employmentCircumstances:
    'employment status, hours or income level, stability of work, caregiving or health barriers, and any recent changes affecting employment',
  reasonForApplying:
    'specific reasons for seeking support now, the type of assistance needed, and how it will help meet urgent household needs'
}

const fieldGuidance: Record<SuggestionField, string> = {
  currentFinancialSituation:
    'Begin with the main financial pressure (for example rising bills, debt, or reduced income). Mention amounts when they help explain the strain. Avoid greetings or introductions.',
  employmentCircumstances:
    'Start by describing the current work situation or lack of work. Include hours worked, pay level, or caregiving/health limits if relevant. Avoid greetings or introductions.',
  reasonForApplying:
    'Lead with the immediate need for assistance and connect it to day-to-day realities. Highlight how support would be used. Avoid greetings or introductions.'
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}

const withCors = (response: NextResponse) => {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  return response
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }))
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody

    if (!body?.field || !body?.language) {
      return withCors(NextResponse.json({ error: 'Missing required fields.' }, { status: 400 }))
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are assisting with drafting a government social support application. Write in the applicant's first-person voice as if they are typing their own paragraph. Keep the tone sincere, respectful, and grounded in practical details. Never use greetings, introductions, or phrases like "Hello" or "My name is". Do not repeat names, ID numbers, phone numbers, or other personal identifiers. Focus tightly on ${fieldFocus[body.field]}. Limit the response to one paragraph under 120 words, avoid bullet lists, and never refer to yourself as an assistant or AI.`
          },
          {
            role: 'user',
            content: [
              `Write the paragraph in ${body.language === 'ar' ? 'Arabic' : 'English'}.`,
              'Sound like a real person describing lived experience in a warm but direct way. Do not start with a greeting.',
              fieldGuidance[body.field],
              body.applicantDetails ? `Applicant context: ${body.applicantDetails}.` : '',
              body.existingText ? `Applicant notes: ${body.existingText}` : ''
            ]
              .filter(Boolean)
              .join(' ')
          }
        ],
        temperature: 0.6
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}))
      const message =
        typeof errorPayload?.error?.message === 'string'
          ? errorPayload.error.message
          : 'Unable to generate suggestion.'
      return withCors(NextResponse.json({ error: message }, { status: response.status }))
    }

    const data = await response.json()
    const content: string | undefined = data?.choices?.[0]?.message?.content

    if (!content) {
      return withCors(NextResponse.json({ error: 'No suggestion received.' }, { status: 500 }))
    }

    return withCors(NextResponse.json({ suggestion: content.trim() }))
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return withCors(NextResponse.json({ error: 'The request timed out.' }, { status: 504 }))
    }
    return withCors(
      NextResponse.json({ error: (error as Error).message ?? 'Unable to generate suggestion.' }, { status: 500 })
    )
  }
}
