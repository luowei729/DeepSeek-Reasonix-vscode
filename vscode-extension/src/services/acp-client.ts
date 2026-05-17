import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: P;
}

export interface JsonRpcResponse<R = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: R;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: P;
}

export type AcpUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: { type: "text"; text: string } }
  | { sessionUpdate: "agent_thought_chunk"; content: { type: "text"; text: string } }
  | { sessionUpdate: "tool_call"; toolCallId: string; title?: string; kind?: string; status?: string; rawInput?: unknown }
  | { sessionUpdate: "tool_call_update"; toolCallId: string; status?: string; content?: Array<{ type: "content"; content: { type: "text"; text: string } }> }
  | { sessionUpdate: "plan"; entries: Array<{ content: string; priority: string; status: string }> };

export interface AcpPermissionParams {
  sessionId: string;
  toolCall: { toolCallId: string; title?: string; kind?: string; rawInput?: unknown };
  options: Array<{ optionId: string; name: string; kind: string }>;
}

export interface AcpClientOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onUpdate?: (params: { sessionId: string; update: AcpUpdate }) => void | Promise<void>;
  onPermission?: (params: AcpPermissionParams) => Promise<{ outcome: { outcome: "selected"; optionId: string } } | { outcome: { outcome: "cancelled" } }>;
  onStderr?: (line: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * JSON-RPC over newline-delimited stdio for `reasonix acp`. It is intentionally
 * generic so Chat, future Agent Manager, or tests can reuse the same transport.
 */
export class AcpClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<string | number, PendingRequest>();

  constructor(private readonly opts: AcpClientOptions) {}

  start(): void {
    if (this.child) return;
    this.child = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd,
      env: { ...process.env, ...this.opts.env },
      stdio: "pipe",
    });

    const stdout = createInterface({ input: this.child.stdout });
    stdout.on("line", (line) => this.handleLine(line));

    const stderr = createInterface({ input: this.child.stderr });
    stderr.on("line", (line) => this.opts.onStderr?.(line));

    this.child.on("exit", (code, signal) => {
      const err = new Error(`reasonix acp exited (${signal ?? code ?? "unknown"})`);
      for (const pending of this.pending.values()) pending.reject(err);
      this.pending.clear();
      this.child = undefined;
    });
  }

  async initialize(): Promise<unknown> {
    return this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "reasonix-vscode", title: "Reasonix VS Code", version: "0.1.0" },
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });
  }

  async newSession(cwd?: string): Promise<{ sessionId: string }> {
    return this.request("session/new", { cwd });
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    return this.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
  }

  cancel(sessionId: string): void {
    this.notify("session/cancel", { sessionId });
  }

  close(): void {
    if (!this.child) return;
    this.child.stdin.end();
    this.child.kill(process.platform === "win32" ? undefined : "SIGTERM");
    this.child = undefined;
  }

  private request<R>(method: string, params: unknown): Promise<R> {
    this.start();
    const id = this.nextId++;
    const message: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.write(message);
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    if (!this.child) throw new Error("reasonix acp process is not running.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
    try {
      message = JSON.parse(trimmed);
    } catch {
      this.opts.onStderr?.(`[acp stdout non-json] ${trimmed}`);
      return;
    }

    if ("id" in message && ("result" in message || "error" in message)) {
      this.handleResponse(message as JsonRpcResponse);
      return;
    }

    if ("id" in message && "method" in message) {
      void this.handleServerRequest(message as JsonRpcRequest);
      return;
    }

    if ("method" in message) this.handleNotification(message as JsonRpcNotification);
  }

  private handleResponse(message: JsonRpcResponse): void {
    if (message.id === null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  private handleNotification(message: JsonRpcNotification): void {
    if (message.method !== "session/update") return;
    void this.opts.onUpdate?.(message.params as { sessionId: string; update: AcpUpdate });
  }

  private async handleServerRequest(message: JsonRpcRequest): Promise<void> {
    if (message.method !== "session/request_permission") {
      this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unknown method: ${message.method}` } });
      return;
    }

    try {
      const result = this.opts.onPermission
        ? await this.opts.onPermission(message.params as AcpPermissionParams)
        : { outcome: { outcome: "cancelled" as const } };
      this.write({ jsonrpc: "2.0", id: message.id, result });
    } catch (err) {
      this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } });
    }
  }
}
