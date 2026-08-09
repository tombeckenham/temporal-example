import { chat } from '@tanstack/ai'
import { grokText } from '@tanstack/ai-grok'
import { xaiClientConfig } from './xaiConfig.ts'

/**
 * Activity: polish a raw user prompt into a stronger video-generation brief.
 * Runs outside the Temporal workflow sandbox (can use Node + HTTP).
 */
export async function enhancePrompt(prompt: string): Promise<string> {
  const enhanced = await chat({
    adapter: grokText('grok-4.3', xaiClientConfig()),
    stream: false,
    systemPrompts: [
      `You rewrite user prompts for AI video generation (Grok Imagine).
Return ONLY the improved prompt — no quotes, no preamble, no explanation.
Keep the user's intent. Add cinematic detail: lighting, camera motion, mood, subject action.
Stay under 400 characters.`,
    ],
    messages: [{ role: 'user', content: prompt }],
  })

  const text = enhanced.trim()
  if (!text) {
    throw new Error('Prompt enhancement returned empty text')
  }
  return text
}
