import { z } from 'zod';
import type { ChatModel } from '../../infrastructure/ai/chat-model.interface';
import type { EmbeddingsProvider } from '../../infrastructure/ai/embeddings.interface';
import type { ScreeningResult } from './entities/application.entity';

/** Résumé text beyond this is cut; keeps prompts bounded on very long CVs. */
export const MAX_RESUME_CHARS = 12_000;

export const SCREENING_SYSTEM_PROMPT = `You are an assistant that helps recruiters screen résumés. You compare a résumé against a job's listed requirements and nothing else.

Rules:
- Judge ONLY against the listed requirements and the role description. Do not consider, infer or mention age, gender, ethnicity, nationality, religion, disability, marital or family status, photos, names, or any other protected characteristic. Do not penalise employment gaps or non-traditional backgrounds unless a requirement explicitly needs continuous recent experience.
- Be evidence-based: every strength or gap must point to something in the résumé or to a requirement that is absent from it.
- The fit score is 0–100: 90+ meets every requirement clearly; 70–89 meets most with minor gaps; 40–69 partial; below 40 largely unmatched.
- Your output is advisory. A human recruiter makes decisions.
- Respond with ONLY a JSON object, no prose and no code fences, matching exactly:
{"fitScore": number, "summary": string, "strengths": string[], "gaps": string[], "matchedRequirements": string[], "missingRequirements": string[]}`;

const assessmentSchema = z.object({
  fitScore: z.coerce.number().int().min(0).max(100),
  summary: z.string().min(1).max(1200),
  strengths: z.array(z.string().max(300)).max(10).default([]),
  gaps: z.array(z.string().max(300)).max(10).default([]),
  matchedRequirements: z.array(z.string().max(300)).max(30).default([]),
  missingRequirements: z.array(z.string().max(300)).max(30).default([]),
});

export type Assessment = z.infer<typeof assessmentSchema>;

export class ScreeningParseError extends Error {}

/** Tolerates code fences and leading/trailing chatter around the JSON object. */
export function parseAssessment(raw: string): Assessment {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1)
    throw new ScreeningParseError('Model output contained no JSON object');
  let json: unknown;
  try {
    json = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new ScreeningParseError('Model output was not valid JSON');
  }
  const parsed = assessmentSchema.safeParse(json);
  if (!parsed.success)
    throw new ScreeningParseError(
      `Assessment failed validation: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
    );
  return parsed.data;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : Math.max(0, Math.min(1, dot / d));
}

export interface ScreenInput {
  title: string;
  description: string;
  requirements: string[];
  resumeText: string;
}

/**
 * Runs both signals: embedding similarity (cheap, always available) and the
 * model's requirement-by-requirement assessment (through the fallback chain).
 */
export async function screenResume(
  input: ScreenInput,
  embeddings: EmbeddingsProvider,
  chat: ChatModel,
  maxTokens: number,
): Promise<ScreeningResult> {
  const resume = input.resumeText.slice(0, MAX_RESUME_CHARS);
  const jobText = `${input.title}\n\n${input.description}\n\nRequirements:\n${input.requirements.map((r) => `- ${r}`).join('\n')}`;

  const [jobVec, resumeVec] = await embeddings.embed([jobText, resume]);
  const similarity = Math.round(cosine(jobVec, resumeVec) * 1000) / 1000;

  const response = await chat.complete({
    system: SCREENING_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `JOB: ${input.title}\n\nROLE DESCRIPTION:\n${input.description}\n\nREQUIREMENTS:\n${input.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nRÉSUMÉ:\n${resume}`,
      },
    ],
    maxTokens,
  });
  const a = parseAssessment(response.text);

  return {
    aiAssisted: true,
    fitScore: a.fitScore,
    similarity,
    summary: a.summary,
    strengths: a.strengths,
    gaps: a.gaps,
    matchedRequirements: a.matchedRequirements,
    missingRequirements: a.missingRequirements,
    provider: response.provider,
    model: response.model,
    screenedAt: new Date().toISOString(),
  };
}
