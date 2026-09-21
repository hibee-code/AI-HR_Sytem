import type {
  ChatModel,
  ChatRequest,
  ChatResponse,
} from './chat-model.interface';

/** Test/offline model: echoes the first context snippet so RAG plumbing can be asserted. */
export class FakeChatAdapter implements ChatModel {
  readonly provider = 'fake';
  failNext = 0;

  isConfigured(): boolean {
    return true;
  }

  async complete(req: ChatRequest): Promise<ChatResponse> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('fake provider failure');
    }
    const lastUser =
      [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (req.system.includes('"fitScore"')) return this.screening(lastUser);
    const firstSource = /\[(\d+)\]/.exec(req.system)?.[1] ?? '1';
    return {
      text: `Based on the company policy [${firstSource}], here is what applies to "${lastUser}".`,
      provider: this.provider,
      model: 'fake',
      usage: { inputTokens: req.system.length / 4, outputTokens: 20 },
    };
  }

  /** Deterministic screening: score = share of requirement keywords found in the résumé. */
  private screening(prompt: string): ChatResponse {
    const reqBlock =
      /REQUIREMENTS:\n([\s\S]*?)\n\nRÉSUMÉ:/.exec(prompt)?.[1] ?? '';
    const resume = (
      /RÉSUMÉ:\n([\s\S]*)$/.exec(prompt)?.[1] ?? ''
    ).toLowerCase();
    const requirements = reqBlock
      .split('\n')
      .map((l) => l.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);
    const matched = requirements.filter((r) =>
      r
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3)
        .some((w) => resume.includes(w)),
    );
    const missing = requirements.filter((r) => !matched.includes(r));
    const fitScore = requirements.length
      ? Math.round((matched.length / requirements.length) * 100)
      : 0;
    return {
      text: JSON.stringify({
        fitScore,
        summary: `Matches ${matched.length} of ${requirements.length} requirements.`,
        strengths: matched.map((r) => `Evidence for: ${r}`),
        gaps: missing.map((r) => `No evidence for: ${r}`),
        matchedRequirements: matched,
        missingRequirements: missing,
      }),
      provider: this.provider,
      model: 'fake',
    };
  }
}
