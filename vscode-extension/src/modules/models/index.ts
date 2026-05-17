import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { ProviderStore } from "../providers/provider-store";

export const ModelsModule: ReasonixModule = {
  id: "models",
  activate(ctx: ReasonixExtensionContext) {
    ctx.vscodeContext.subscriptions.push(
      vscode.commands.registerCommand("reasonix.models.select", () => selectModel(ctx)),
      vscode.commands.registerCommand("reasonix.models.selectMode", () => selectMode(ctx)),
    );
  },
};

/** Model picker — fetches /models or shows fallbacks, supports manual input. */
async function selectModel(ctx: ReasonixExtensionContext): Promise<void> {
  const store = new ProviderStore(ctx);
  const active = store.activeProvider();
  const models = await store.listModels(active);
  const picked = await vscode.window.showQuickPick(
    [
      ...models.map((model) => ({ label: model, model })),
      { label: "$(edit) 手动输入模型 ID", model: "__manual__" },
    ],
    { title: `选择模型 · ${active.name}` },
  );
  if (!picked) return;

  const model =
    picked.model === "__manual__"
      ? await vscode.window.showInputBox({ title: "模型 ID", value: active.model, ignoreFocusOut: true })
      : picked.model;
  if (!model) return;

  await store.updateActiveModel(model);
  await ctx.eventBus.emit("model.changed", { providerId: active.id, model });
  await ctx.eventBus.emit("provider.changed", store.activeProvider());
  vscode.window.showInformationMessage(`Reasonix 当前模型：${model}`);
}

/** Model mode selector — reasoning effort (high/max) and thinking toggle. */
async function selectMode(ctx: ReasonixExtensionContext): Promise<void> {
  const store = new ProviderStore(ctx);
  const active = store.activeProvider();
  const meta = store.modelMeta(active.model);

  // Expose all mode controls from VS Code because custom OpenAI-compatible
  // endpoints may support DeepSeek's flags even when the model id is unknown.
  const current = active.reasoningEffort;
  const items: vscode.QuickPickItem[] = [
    { label: "$(symbol-number) 推理深度：默认", description: current === "default" ? "当前" : meta.reasoningEffort ? "模型支持" : "可能被端点忽略" },
    { label: "$(zap) 推理深度：high", description: current === "high" ? "当前" : meta.reasoningEffort ? "模型支持" : "可能被端点忽略" },
    { label: "$(rocket) 推理深度：max", description: current === "max" ? "当前" : meta.reasoningEffort ? "模型支持" : "可能被端点忽略" },
    {
      label: `$(symbol-event) 思考链：${active.thinking === "enabled" ? "关闭 (disabled)" : "开启 (enabled)"}`,
      description: `当前：${active.thinking}${meta.thinking ? " · 模型支持" : " · 可能被端点忽略"}`,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, { title: `模型模式 · ${active.model}` });
  if (!picked) return;

  if (picked.label.includes("推理深度：默认")) await store.updateActiveReasoningEffort("default");
  else if (picked.label.includes("推理深度：high")) await store.updateActiveReasoningEffort("high");
  else if (picked.label.includes("推理深度：max")) await store.updateActiveReasoningEffort("max");
  else if (picked.label.includes("思考链：开启")) await store.updateActiveThinking("enabled");
  else if (picked.label.includes("思考链：关闭")) await store.updateActiveThinking("disabled");

  await ctx.eventBus.emit("provider.changed", store.activeProvider());
  vscode.window.showInformationMessage(`Reasonix 模型模式已更新：${store.activeProvider().model} / reasoningEffort=${store.activeProvider().reasoningEffort} / thinking=${store.activeProvider().thinking}`);
}
