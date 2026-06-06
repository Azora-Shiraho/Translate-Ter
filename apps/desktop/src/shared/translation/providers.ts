import type {
  ProviderCapabilities,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProvider
} from './types';
import { ProviderError } from './types';

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  maxSegmentsPerBatch: 12,
  maxCharactersPerBatch: 4000,
  supportsGlossary: true,
  supportsTone: true
};

export class MockTranslationProvider implements TranslationProvider {
  readonly id = 'mock.local';
  readonly kind = 'mock';
  readonly priority = 100;

  capabilities(): ProviderCapabilities {
    return DEFAULT_CAPABILITIES;
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true };
  }

  async translateBatch(request: TranslationBatchRequest): Promise<TranslationBatchResult> {
    return {
      providerId: this.id,
      modelId: 'mock-echo',
      translations: request.segments.map((segment) => ({
        id: segment.id,
        translatedText: `[${request.targetLanguage}] ${segment.sourceText}`
      }))
    };
  }
}

export type OpenAICompatibleProviderConfig = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  priority: number;
  rpm?: number;
  tokenBudgetPerMinute?: number;
  maxSegmentsPerBatch?: number;
  maxCharactersPerBatch?: number;
};

export class OpenAICompatibleTranslationProvider implements TranslationProvider {
  readonly id: string;
  readonly kind = 'llm';
  readonly priority: number;

  constructor(private readonly config: OpenAICompatibleProviderConfig) {
    this.id = config.id;
    this.priority = config.priority;
  }

  capabilities(): ProviderCapabilities {
    return {
      ...DEFAULT_CAPABILITIES,
      maxSegmentsPerBatch: this.config.maxSegmentsPerBatch ?? DEFAULT_CAPABILITIES.maxSegmentsPerBatch,
      maxCharactersPerBatch: this.config.maxCharactersPerBatch ?? DEFAULT_CAPABILITIES.maxCharactersPerBatch
    };
  }

  rateLimits(): { rpm?: number; tokenBudgetPerMinute?: number } {
    return {
      rpm: this.config.rpm,
      tokenBudgetPerMinute: this.config.tokenBudgetPerMinute
    };
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    if (!this.config.apiKey) {
      return { ok: false, message: 'API key is not configured.' };
    }
    return { ok: true };
  }

  async translateBatch(request: TranslationBatchRequest): Promise<TranslationBatchResult> {
    if (!this.config.apiKey) {
      throw new ProviderError('OpenAI-compatible provider is missing an API key.', {
        code: 'ProviderUnconfigured',
        retryable: false
      });
    }

    const prompt = buildJsonTranslationPrompt(request);
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Translate subtitle segments. Return strict JSON: {"segments":[{"id":"...","translatedText":"..."}]}. Preserve one output per input id.'
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      throw new ProviderError(`Provider request failed with HTTP ${response.status}.`, {
        code: response.status === 429 ? 'RateLimited' : 'ProviderUnavailable',
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined
      });
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError('Provider returned an empty response.', {
        code: 'MalformedResponse',
        retryable: true
      });
    }

    const parsed = parseProviderJson(content, request);
    return {
      providerId: this.id,
      modelId: this.config.model,
      translations: parsed,
      tokenUsage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0
      }
    };
  }
}

export function buildJsonTranslationPrompt(request: TranslationBatchRequest): string {
  return JSON.stringify(
    {
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      tone: request.tone,
      glossary: request.glossary ?? {},
      requirements: [
        'Do not change timestamps.',
        'Return one translatedText for every segment id.',
        'Do not merge, split, omit, or invent segment ids.'
      ],
      segments: request.segments
    },
    null,
    2
  );
}

function parseProviderJson(content: string, request: TranslationBatchRequest): TranslationBatchResult['translations'] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    try {
      parsed = JSON.parse(repairProviderJsonContent(content));
    } catch {
      throw new ProviderError('Provider returned malformed JSON.', {
        code: 'MalformedJson',
        retryable: true
      });
    }
  }

  const segments = (parsed as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) {
    throw new ProviderError('Provider JSON did not contain a segments array.', {
      code: 'MalformedJson',
      retryable: true
    });
  }

  const expectedIds = new Set(request.segments.map((segment) => segment.id));
  const seen = new Set<string>();
  const translations = segments.map((segment) => {
    const candidate = segment as { id?: unknown; translatedText?: unknown };
    if (typeof candidate.id !== 'string' || typeof candidate.translatedText !== 'string') {
      throw new ProviderError('Provider segment shape is invalid.', {
        code: 'MalformedJson',
        retryable: true
      });
    }
    if (!expectedIds.has(candidate.id) || seen.has(candidate.id)) {
      throw new ProviderError('Provider segment ids do not match the request.', {
        code: 'SegmentAlignmentError',
        retryable: true
      });
    }
    seen.add(candidate.id);
    return { id: candidate.id, translatedText: candidate.translatedText };
  });

  if (seen.size !== expectedIds.size) {
    throw new ProviderError('Provider omitted one or more segment ids.', {
      code: 'SegmentAlignmentError',
      retryable: true
    });
  }

  return translations;
}

function repairProviderJsonContent(content: string): string {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  const objectOnly = firstBrace >= 0 && lastBrace > firstBrace ? withoutFence.slice(firstBrace, lastBrace + 1) : withoutFence;
  return objectOnly.replace(/,\s*([}\]])/g, '$1');
}
