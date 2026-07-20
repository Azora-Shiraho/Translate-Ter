import type { ProviderHealth, ProviderSecretInput, UserMessageDescriptor } from '@shared/models';
import type { ScopedLogger } from './logger';

type OpenAICompatibleProviderCheckInput = {
  providerId: string;
  secret?: ProviderSecretInput;
  defaultBaseUrl: string;
  defaultModel?: string;
  logger?: ScopedLogger;
};

const PROVIDER_TEST_TIMEOUT_MS = 8_000;

export async function testOpenAICompatibleProvider(
  input: OpenAICompatibleProviderCheckInput
): Promise<ProviderHealth> {
  const apiKey = input.secret?.apiKey?.trim();
  if (!apiKey) {
    return {
      providerId: input.providerId,
      ok: false,
      status: 'unconfigured',
      message: 'API key is not configured.',
      userMessage: { messageKey: 'runtimeMessage.providerApiKeyMissing' }
    };
  }

  const baseUrl = normalizeBaseUrl(input.secret?.baseUrl, input.defaultBaseUrl);
  const model = normalizeOptionalText(input.secret?.model) ?? input.defaultModel;
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS);

  try {
    input.logger?.info('provider-health.check.start', 'Testing OpenAI-compatible provider.', {
      providerId: input.providerId,
      baseUrl,
      model
    });

    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      const { message, userMessage } = providerHttpErrorMessage(response.status, responseText);
      input.logger?.warn('provider-health.check.failed', message, {
        providerId: input.providerId,
        status: response.status,
        baseUrl
      });
      return {
        providerId: input.providerId,
        ok: false,
        status: providerHealthStatusForHttp(response.status),
        message,
        userMessage
      };
    }

    const payload = (await response.json().catch(() => undefined)) as
      | { data?: Array<{ id?: unknown }> }
      | undefined;
    const availableModelIds = Array.isArray(payload?.data)
      ? payload.data.map((entry) => (typeof entry?.id === 'string' ? entry.id : undefined)).filter(isNonEmptyString)
      : [];

    if (model && availableModelIds.length > 0 && !availableModelIds.includes(model)) {
      const message = `Connected, but model "${model}" is not available.`;
      input.logger?.warn('provider-health.check.model-missing', message, {
        providerId: input.providerId,
        model,
        availableModelCount: availableModelIds.length
      });
      return {
        providerId: input.providerId,
        ok: false,
        status: 'degraded',
        message,
        userMessage: {
          messageKey: 'runtimeMessage.providerModelMissing',
          messageParams: { model },
          technicalMessage: message
        }
      };
    }

    const message = model
      ? `Connected successfully. Model "${model}" is available.`
      : 'Connected successfully. The service is available.';
    input.logger?.info('provider-health.check.ready', message, {
      providerId: input.providerId,
      model,
      availableModelCount: availableModelIds.length
    });
    return {
      providerId: input.providerId,
      ok: true,
      status: 'healthy',
      message,
      userMessage: model
        ? { messageKey: 'runtimeMessage.providerModelReady', messageParams: { model } }
        : { messageKey: 'runtimeMessage.providerReady' }
    };
  } catch (error) {
    const { message, userMessage } = providerNetworkErrorMessage(error);
    input.logger?.warn('provider-health.check.error', message, {
      providerId: input.providerId,
      baseUrl,
      error
    });
    return {
      providerId: input.providerId,
      ok: false,
      status: 'unavailable',
      message,
      userMessage
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createBasicProviderHealth(
  providerId: string,
  result: { ok: boolean; message?: string },
  unhealthyStatus: Exclude<ProviderHealth['status'], 'healthy'> = 'unavailable'
): ProviderHealth {
  return {
    providerId,
    ok: result.ok,
    status: result.ok ? 'healthy' : unhealthyStatus,
    message: result.message
  };
}

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const candidate = normalizeOptionalText(value) ?? fallback;
  return candidate.replace(/\/+$/, '');
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function providerHealthStatusForHttp(status: number): ProviderHealth['status'] {
  if (status === 401 || status === 403) return 'unconfigured';
  if (status === 429) return 'degraded';
  if (status >= 500) return 'unavailable';
  return 'degraded';
}

function providerHttpErrorMessage(
  status: number,
  responseText: string
): { message: string; userMessage: UserMessageDescriptor } {
  const detail = parseProviderErrorDetail(responseText);
  const technicalMessage = detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return {
      message: technicalMessage,
      userMessage: { messageKey: 'runtimeMessage.providerCredentialsRejected', technicalMessage }
    };
  }
  if (status === 404) {
    return {
      message: technicalMessage,
      userMessage: { messageKey: 'runtimeMessage.providerEndpointMissing', technicalMessage }
    };
  }
  if (status === 429) {
    return {
      message: technicalMessage,
      userMessage: { messageKey: 'runtimeMessage.providerRateLimited', technicalMessage }
    };
  }
  if (status >= 500) {
    return {
      message: technicalMessage,
      userMessage: { messageKey: 'runtimeMessage.providerUnavailable', technicalMessage }
    };
  }
  return {
    message: technicalMessage,
    userMessage: {
      messageKey: 'runtimeMessage.providerHttpError',
      messageParams: { status },
      technicalMessage
    }
  };
}

function parseProviderErrorDetail(responseText: string): string | undefined {
  const text = responseText.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    if (parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // ignore json parse errors
  }

  const compact = text.replace(/\s+/g, ' ');
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function providerNetworkErrorMessage(error: unknown): { message: string; userMessage: UserMessageDescriptor } {
  if (error instanceof Error) {
    const technicalMessage = `${error.name}: ${error.message}`;
    if (error.name === 'AbortError') {
      return { message: technicalMessage, userMessage: { messageKey: 'runtimeMessage.providerTimeout', technicalMessage } };
    }
    if (error.message.includes('Failed to parse URL')) {
      return { message: technicalMessage, userMessage: { messageKey: 'runtimeMessage.providerInvalidBaseUrl', technicalMessage } };
    }
    if (error.message.includes('fetch failed')) {
      return { message: technicalMessage, userMessage: { messageKey: 'runtimeMessage.providerConnectionFailed', technicalMessage } };
    }
    return { message: technicalMessage, userMessage: { messageKey: 'runtimeMessage.providerCheckFailed', technicalMessage } };
  }
  const technicalMessage = String(error);
  return { message: technicalMessage, userMessage: { messageKey: 'runtimeMessage.providerCheckFailed', technicalMessage } };
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value && value.trim());
}
