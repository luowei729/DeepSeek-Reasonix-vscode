import type { ReasonixExtensionContext } from "../../core/context";

export type ReasoningEffort = "default" | "high" | "max";
export type ThinkingMode = "enabled" | "disabled";

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** DeepSeek reasoning_effort: high/max controls chain-of-thought depth. "default" lets server decide. */
  reasoningEffort: ReasoningEffort;
  /** thinking=true enables reasoning_content stream; some third-party endpoints may not support it. */
  thinking: ThinkingMode;
}

export interface ProviderState {
  activeProviderId: string;
  providers: ProviderConfig[];
}

const PROVIDER_STATE_KEY = "reasonix.providers.state";
const DEFAULT_PROVIDER: ProviderConfig = {
  id: "deepseek-default",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  reasoningEffort: "default",
  thinking: "enabled",
};

/** Known models and their default capabilities for the mode selector UI. */
export const MODEL_META: Record<string, { thinking: boolean; reasoningEffort: boolean; label: string }> = {
  "deepseek-v4-flash": { thinking: true, reasoningEffort: true, label: "DeepSeek V4 Flash" },
  "deepseek-v4-pro": { thinking: true, reasoningEffort: true, label: "DeepSeek V4 Pro" },
  "deepseek-chat": { thinking: false, reasoningEffort: false, label: "DeepSeek V3 Chat" },
  "deepseek-reasoner": { thinking: true, reasoningEffort: false, label: "DeepSeek R1 Reasoner" },
};

/**
 * Provider settings are plugin-owned state, stored separately from upstream
 * Reasonix config so fork syncs do not touch src/config.ts. Tokens are kept in
 * SecretStorage and included in Cloud Sync only after encryption.
 */
export class ProviderStore {
  constructor(private readonly ctx: ReasonixExtensionContext) {}

  getState(): ProviderState {
    const state = this.ctx.configStore.get<ProviderState>(PROVIDER_STATE_KEY, {
      activeProviderId: DEFAULT_PROVIDER.id,
      providers: [DEFAULT_PROVIDER],
    });
    // Normalize older Cloud Sync / extension-state payloads so newly added mode
    // fields always exist before webviews render or ACP env vars are built.
    const providers = (state.providers?.length ? state.providers : [DEFAULT_PROVIDER]).map(normalizeProvider);
    const activeProviderId = providers.some((provider) => provider.id === state.activeProviderId)
      ? state.activeProviderId
      : providers[0]!.id;
    return { activeProviderId, providers };
  }

  async saveProvider(provider: ProviderConfig, apiKey?: string): Promise<void> {
    const state = this.getState();
    const normalized = normalizeProvider(provider);
    const providers = [...state.providers.filter((item) => item.id !== normalized.id), normalized].sort((a, b) => a.name.localeCompare(b.name));
    await this.ctx.configStore.update(PROVIDER_STATE_KEY, { activeProviderId: normalized.id, providers });
    if (apiKey !== undefined) await this.ctx.secretStore.store(secretKey(normalized.id), apiKey, true);
  }

  async selectProvider(id: string): Promise<void> {
    const state = this.getState();
    await this.ctx.configStore.update(PROVIDER_STATE_KEY, { ...state, activeProviderId: id });
  }

  async updateActiveModel(model: string): Promise<void> {
    const state = this.getState();
    const providers = state.providers.map((provider) =>
      provider.id === state.activeProviderId ? { ...provider, model } : provider,
    );
    await this.ctx.configStore.update(PROVIDER_STATE_KEY, { ...state, providers });
  }

  async updateActiveReasoningEffort(reasoningEffort: ReasoningEffort): Promise<void> {
    const state = this.getState();
    const providers = state.providers.map((provider) =>
      provider.id === state.activeProviderId ? { ...provider, reasoningEffort } : provider,
    );
    await this.ctx.configStore.update(PROVIDER_STATE_KEY, { ...state, providers });
  }

  async updateActiveThinking(thinking: ThinkingMode): Promise<void> {
    const state = this.getState();
    const providers = state.providers.map((provider) =>
      provider.id === state.activeProviderId ? { ...provider, thinking } : provider,
    );
    await this.ctx.configStore.update(PROVIDER_STATE_KEY, { ...state, providers });
  }

  activeProvider(): ProviderConfig {
    const state = this.getState();
    return state.providers.find((item) => item.id === state.activeProviderId) ?? state.providers[0] ?? DEFAULT_PROVIDER;
  }

  async activeApiKey(): Promise<string | undefined> {
    return this.ctx.secretStore.get(secretKey(this.activeProvider().id));
  }

  /** Build environment variables the child process expects. reasoning_effort
   *  only takes effect for models that support it; it is harmless for others. */
  async environment(): Promise<NodeJS.ProcessEnv> {
    const provider = this.activeProvider();
    const apiKey = await this.activeApiKey();
    const env: NodeJS.ProcessEnv = {
      DEEPSEEK_BASE_URL: provider.baseUrl,
      ...(apiKey ? { DEEPSEEK_API_KEY: apiKey } : {}),
    };
    // The VS Code extension injects per-session model mode without rewriting
    // ~/.reasonix/config.json; the bundled CLI reads these env overrides.
    if (provider.reasoningEffort !== "default") env.REASONIX_REASONING_EFFORT = provider.reasoningEffort;
    env.REASONIX_THINKING = provider.thinking;
    return env;
  }

  async listModels(provider = this.activeProvider()): Promise<string[]> {
    const apiKey = await this.ctx.secretStore.get(secretKey(provider.id));
    const fallback = fallbackModels(provider.model);
    if (!apiKey) return fallback;

    try {
      const res = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return fallback;
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (body.data ?? []).map((item) => item.id).filter((id): id is string => !!id);
      return ids.length ? Array.from(new Set([...ids, ...fallback])) : fallback;
    } catch {
      return fallback;
    }
  }

  modelMeta(model = this.activeProvider().model) {
    return MODEL_META[model] ?? { thinking: false, reasoningEffort: false, label: model };
  }
}

export function makeProviderId(name: string): string {
  return `provider-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || Date.now()}`;
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === "high" || value === "max" ? value : "default";
}

export function normalizeThinkingMode(value: unknown): ThinkingMode {
  return value === "disabled" ? "disabled" : "enabled";
}

function normalizeProvider(provider: Partial<ProviderConfig>): ProviderConfig {
  const id = provider.id?.trim() || makeProviderId(provider.name || DEFAULT_PROVIDER.name);
  const name = provider.name?.trim() || DEFAULT_PROVIDER.name;
  return {
    id,
    name,
    baseUrl: provider.baseUrl?.trim() || DEFAULT_PROVIDER.baseUrl,
    model: provider.model?.trim() || DEFAULT_PROVIDER.model,
    reasoningEffort: normalizeReasoningEffort(provider.reasoningEffort),
    thinking: normalizeThinkingMode(provider.thinking),
  };
}

function secretKey(providerId: string): string {
  return `reasonix.provider.${providerId}.apiKey`;
}

function fallbackModels(current: string): string[] {
  return Array.from(new Set([current, "deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"].filter(Boolean)));
}
