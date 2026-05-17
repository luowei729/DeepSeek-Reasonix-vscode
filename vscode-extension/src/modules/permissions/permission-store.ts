import type { ReasonixExtensionContext } from "../../core/context";
import type { AcpPermissionParams } from "../../services/acp-client";

export interface PermissionRule {
  id: string;
  pattern: string;
  kind: string;
  decision: "allow" | "reject";
  optionId: string;
  createdAt: string;
  hits: number;
}

const PERMISSION_RULES_KEY = "reasonix.permissions.rules";

/**
 * Plugin-level permission rules. ACP still receives the normal optionId so the
 * upstream Reasonix gate remains authoritative; this store only remembers user
 * choices from VS Code UI to avoid repeated prompts.
 */
export class PermissionStore {
  constructor(private readonly ctx: ReasonixExtensionContext) {}

  list(): PermissionRule[] {
    return this.ctx.configStore.get<PermissionRule[]>(PERMISSION_RULES_KEY, []);
  }

  match(params: AcpPermissionParams): PermissionRule | undefined {
    const target = permissionTarget(params);
    const rule = this.list().find((item) => item.kind === (params.toolCall.kind ?? "other") && target.includes(item.pattern));
    if (rule) void this.recordHit(rule.id);
    return rule;
  }

  async addRuleFromPermission(params: AcpPermissionParams, optionId: string, decision: "allow" | "reject"): Promise<void> {
    const pattern = bestPattern(params);
    await this.addRule({
      id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      pattern,
      kind: params.toolCall.kind ?? "other",
      decision,
      optionId,
      createdAt: new Date().toISOString(),
      hits: 0,
    });
  }

  async addRule(rule: PermissionRule): Promise<void> {
    await this.ctx.configStore.update(PERMISSION_RULES_KEY, [rule, ...this.list().filter((item) => item.id !== rule.id)]);
  }

  async deleteRule(id: string): Promise<void> {
    await this.ctx.configStore.update(PERMISSION_RULES_KEY, this.list().filter((item) => item.id !== id));
  }

  async clear(): Promise<void> {
    await this.ctx.configStore.update(PERMISSION_RULES_KEY, []);
  }

  private async recordHit(id: string): Promise<void> {
    await this.ctx.configStore.update(
      PERMISSION_RULES_KEY,
      this.list().map((item) => (item.id === id ? { ...item, hits: item.hits + 1 } : item)),
    );
  }
}

function permissionTarget(params: AcpPermissionParams): string {
  return `${params.toolCall.title ?? ""}\n${JSON.stringify(params.toolCall.rawInput ?? {})}`;
}

function bestPattern(params: AcpPermissionParams): string {
  const raw = params.toolCall.rawInput;
  if (raw && typeof raw === "object") {
    const command = (raw as { command?: unknown }).command;
    const path = (raw as { path?: unknown }).path ?? (raw as { file?: unknown }).file;
    if (typeof command === "string" && command.trim()) return command.trim().slice(0, 160);
    if (typeof path === "string" && path.trim()) return path.trim().slice(0, 160);
  }
  return (params.toolCall.title ?? params.toolCall.toolCallId ?? params.toolCall.kind ?? "permission").slice(0, 160);
}
