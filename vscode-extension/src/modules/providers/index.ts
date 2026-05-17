import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { makeProviderId, ProviderStore, type ProviderConfig, type ReasoningEffort, type ThinkingMode } from "./provider-store";

export const ProvidersModule: ReasonixModule = {
  id: "providers",
  activate(ctx: ReasonixExtensionContext) {
    ctx.vscodeContext.subscriptions.push(
      vscode.commands.registerCommand("reasonix.providers.configure", () => configureProvider(ctx)),
      vscode.commands.registerCommand("reasonix.providers.select", () => selectProvider(ctx)),
      // Handler for inline webview settings form submission
      ctx.eventBus.on("providers.saveFromWebview", (data: any) => saveFromWebview(ctx, data as ProviderConfig & { apiKey?: string })),
    );
  },
};

/** Top-bar configure flow (fallback when webview settings are unavailable). */
async function configureProvider(ctx: ReasonixExtensionContext): Promise<void> {
  const store = new ProviderStore(ctx);
  const active = store.activeProvider();

  const name = await vscode.window.showInputBox({
    title: "供应商名称",
    value: active.name,
    prompt: "例如 DeepSeek、自建 OpenAI-Compatible。",
    ignoreFocusOut: true,
  });
  if (!name) return;

  const baseUrl = await vscode.window.showInputBox({
    title: "API Base URL",
    value: active.baseUrl,
    prompt: "OpenAI-Compatible 地址，例如 https://api.deepseek.com。",
    ignoreFocusOut: true,
  });
  if (!baseUrl) return;

  const model = await vscode.window.showInputBox({
    title: "默认模型 ID",
    value: active.model,
    prompt: "例如 deepseek-v4-flash、deepseek-chat。",
    ignoreFocusOut: true,
  });
  if (!model) return;

  const apiKey = await vscode.window.showInputBox({
    title: "API Key / Token",
    value: await store.activeApiKey(),
    password: true,
    prompt: "Token 存 VS Code SecretStorage；Cloud Sync 加密同步。",
    ignoreFocusOut: true,
  });
  if (apiKey === undefined) return;

  const provider: ProviderConfig = {
    id: active.name === name ? active.id : makeProviderId(name),
    name,
    baseUrl,
    model,
    reasoningEffort: active.reasoningEffort,
    thinking: active.thinking,
  };
  await store.saveProvider(provider, apiKey);
  await ctx.eventBus.emit("provider.changed", provider);
  vscode.window.showInformationMessage(`Reasonix 供应商已保存：${name} / ${model}`);
}

/** Select from saved providers via QuickPick. */
async function selectProvider(ctx: ReasonixExtensionContext): Promise<void> {
  const store = new ProviderStore(ctx);
  const state = store.getState();
  const picked = await vscode.window.showQuickPick(
    state.providers.map((provider) => ({ label: provider.name, description: `${provider.model} · ${provider.reasoningEffort}`, provider })),
    { title: "选择 Reasonix API 供应商" },
  );
  if (!picked) return;
  await store.selectProvider(picked.provider.id);
  await ctx.eventBus.emit("provider.changed", picked.provider);
}

/** Save provider config from inline webview settings form, bypassing the
 *  multi-step top-bar dialog when users fill out the settings page directly. */
async function saveFromWebview(ctx: ReasonixExtensionContext, data: ProviderConfig & { apiKey?: string }): Promise<void> {
  const store = new ProviderStore(ctx);
  await store.saveProvider({
    id: data.id || makeProviderId(data.name),
    name: data.name,
    baseUrl: data.baseUrl,
    model: data.model,
    reasoningEffort: data.reasoningEffort || "default",
    thinking: data.thinking || "enabled",
  }, data.apiKey);
  await ctx.eventBus.emit("provider.changed", store.activeProvider());
  vscode.window.showInformationMessage(`Reasonix 供应商已保存：${data.name} / ${data.model}`);
}
