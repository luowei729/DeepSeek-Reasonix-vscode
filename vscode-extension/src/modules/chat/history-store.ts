import type { ReasonixExtensionContext } from "../../core/context";

export type ChatRole = "user" | "assistant" | "tool" | "system";

export interface ChatMessageRecord {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
}

export interface ChatSessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  providerName: string;
  model: string;
  messages: ChatMessageRecord[];
}

const CHAT_STATE_KEY = "reasonix.chat.sessions";
const ACTIVE_CHAT_KEY = "reasonix.chat.activeSessionId";

/**
 * Persists VS Code chat sessions in extension state so chat history survives
 * reloads and is included in encrypted Cloud Sync extensionState backups.
 */
export class ChatHistoryStore {
  constructor(private readonly ctx: ReasonixExtensionContext) {}

  list(): ChatSessionRecord[] {
    return this.ctx.configStore
      .get<ChatSessionRecord[]>(CHAT_STATE_KEY, [])
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getActive(): ChatSessionRecord | undefined {
    const activeId = this.ctx.configStore.get<string>(ACTIVE_CHAT_KEY, "");
    return this.list().find((session) => session.id === activeId) ?? this.list()[0];
  }

  async setActive(id: string): Promise<void> {
    await this.ctx.configStore.update(ACTIVE_CHAT_KEY, id);
  }

  async create(providerName: string, model: string, title = "新会话"): Promise<ChatSessionRecord> {
    const now = new Date().toISOString();
    const session: ChatSessionRecord = {
      id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      createdAt: now,
      updatedAt: now,
      providerName,
      model,
      messages: [],
    };
    await this.saveAll([session, ...this.list()]);
    await this.setActive(session.id);
    return session;
  }

  async append(sessionId: string, role: ChatRole, text: string): Promise<ChatMessageRecord> {
    const now = new Date().toISOString();
    const message: ChatMessageRecord = { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role, text, createdAt: now };
    const sessions = this.list().map((session) => {
      if (session.id !== sessionId) return session;
      const title = session.messages.length === 0 && role === "user" ? text.slice(0, 48) || session.title : session.title;
      return { ...session, title, updatedAt: now, messages: [...session.messages, message] };
    });
    await this.saveAll(sessions);
    return message;
  }

  async updateLastAssistant(sessionId: string, delta: string): Promise<void> {
    const sessions = this.list().map((session) => {
      if (session.id !== sessionId) return session;
      const messages = [...session.messages];
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, text: last.text + delta };
      } else {
        messages.push({ id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role: "assistant", text: delta, createdAt: new Date().toISOString() });
      }
      return { ...session, updatedAt: new Date().toISOString(), messages };
    });
    await this.saveAll(sessions);
  }

  async delete(id: string): Promise<void> {
    const next = this.list().filter((session) => session.id !== id);
    await this.saveAll(next);
    if (this.getActive()?.id === id) await this.ctx.configStore.update(ACTIVE_CHAT_KEY, next[0]?.id ?? "");
  }

  private async saveAll(sessions: ChatSessionRecord[]): Promise<void> {
    // Keep history bounded so extension state and encrypted backups remain usable.
    const bounded = sessions.slice(0, 50).map((session) => ({ ...session, messages: session.messages.slice(-200) }));
    await this.ctx.configStore.update(CHAT_STATE_KEY, bounded);
  }
}
