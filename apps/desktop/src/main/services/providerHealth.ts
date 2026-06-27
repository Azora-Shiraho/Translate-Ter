import type { ProviderHealth, ProviderSecretInput } from '@shared/models';
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
      message: '请先填写 API Key。'
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
      const message = providerHttpErrorMessage(response.status, responseText);
      input.logger?.warn('provider-health.check.failed', message, {
        providerId: input.providerId,
        status: response.status,
        baseUrl
      });
      return {
        providerId: input.providerId,
        ok: false,
        status: providerHealthStatusForHttp(response.status),
        message
      };
    }

    const payload = (await response.json().catch(() => undefined)) as
      | { data?: Array<{ id?: unknown }> }
      | undefined;
    const availableModelIds = Array.isArray(payload?.data)
      ? payload.data.map((entry) => (typeof entry?.id === 'string' ? entry.id : undefined)).filter(isNonEmptyString)
      : [];

    if (model && availableModelIds.length > 0 && !availableModelIds.includes(model)) {
      const message = `连接成功，但当前服务里没有模型“${model}”。`;
      input.logger?.warn('provider-health.check.model-missing', message, {
        providerId: input.providerId,
        model,
        availableModelCount: availableModelIds.length
      });
      return {
        providerId: input.providerId,
        ok: false,
        status: 'degraded',
        message
      };
    }

    const message = model
      ? `连接成功，当前可以访问模型“${model}”。`
      : '连接成功，服务可用。';
    input.logger?.info('provider-health.check.ready', message, {
      providerId: input.providerId,
      model,
      availableModelCount: availableModelIds.length
    });
    return {
      providerId: input.providerId,
      ok: true,
      status: 'healthy',
      message
    };
  } catch (error) {
    const message = providerNetworkErrorMessage(error);
    input.logger?.warn('provider-health.check.error', message, {
      providerId: input.providerId,
      baseUrl,
      error
    });
    return {
      providerId: input.providerId,
      ok: false,
      status: 'unavailable',
      message
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

function providerHttpErrorMessage(status: number, responseText: string): string {
  const detail = parseProviderErrorDetail(responseText);
  if (status === 401 || status === 403) {
    return detail
      ? `服务拒绝了这组凭据：${detail}`
      : '服务拒绝了这组凭据。请检查 API Key。';
  }
  if (status === 404) {
    return detail
      ? `服务地址可访问，但没有找到对应接口：${detail}`
      : '服务地址可访问，但没有找到模型列表接口。请检查 Base URL。';
  }
  if (status === 429) {
    return detail ? `服务暂时限流：${detail}` : '服务暂时限流，当前无法完成测试。';
  }
  if (status >= 500) {
    return detail ? `服务暂时不可用：${detail}` : '服务暂时不可用，请稍后再试。';
  }
  return detail ? `服务返回异常：${detail}` : `服务返回异常（HTTP ${status}）。`;
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

function providerNetworkErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return '连接服务超时。请检查 Base URL 是否正确，或稍后再试。';
    }
    if (error.message.includes('Failed to parse URL')) {
      return 'Base URL 格式不正确。';
    }
    if (error.message.includes('fetch failed')) {
      return '无法连接到这个服务地址。请检查 Base URL、网络，或确认服务已经启动。';
    }
    return `测试连接失败：${error.message}`;
  }
  return '测试连接失败。';
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value && value.trim());
}
