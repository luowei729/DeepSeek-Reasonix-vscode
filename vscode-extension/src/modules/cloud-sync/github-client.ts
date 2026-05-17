export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubFile {
  content: string;
  sha: string;
}

export interface GitHubDirectoryEntry {
  name: string;
  path: string;
  type: "file" | "dir" | string;
  sha: string;
}

/**
 * Minimal GitHub Contents API client. It avoids a git binary dependency so a
 * fresh VS Code install can restore backups after the user enters repo + token.
 */
export class GitHubClient {
  readonly repo: GitHubRepoRef;

  constructor(
    repoUrl: string,
    private readonly token: string,
    private readonly branch: string,
  ) {
    this.repo = parseGitHubRepo(repoUrl);
  }

  async testConnection(): Promise<void> {
    const res = await this.request(`https://api.github.com/repos/${this.repo.owner}/${this.repo.repo}`);
    if (!res.ok) throw new Error(`GitHub connection failed: ${res.status} ${await res.text()}`);
  }

  async getText(filePath: string): Promise<GitHubFile | null> {
    const res = await this.request(this.contentsUrl(filePath, true));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read failed for ${filePath}: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { content?: string; sha?: string; encoding?: string };
    if (body.encoding !== "base64" || !body.content || !body.sha) {
      throw new Error(`GitHub returned unsupported content for ${filePath}.`);
    }
    return {
      content: Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8"),
      sha: body.sha,
    };
  }

  async listDirectory(dirPath: string): Promise<GitHubDirectoryEntry[]> {
    const res = await this.request(this.contentsUrl(dirPath, true));
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`GitHub list failed for ${dirPath}: ${res.status} ${await res.text()}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`GitHub path is not a directory: ${dirPath}`);
    return body as GitHubDirectoryEntry[];
  }

  async putText(filePath: string, content: string, message: string): Promise<void> {
    const existing = await this.getText(filePath);
    const payload: Record<string, unknown> = {
      message,
      branch: this.branch,
      content: Buffer.from(content, "utf8").toString("base64"),
    };
    if (existing?.sha) payload.sha = existing.sha;

    const res = await this.request(this.contentsUrl(filePath, false), {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`GitHub write failed for ${filePath}: ${res.status} ${await res.text()}`);
  }

  private contentsUrl(filePath: string, includeRef: boolean): string {
    const encoded = filePath
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join("/");
    const base = `https://api.github.com/repos/${this.repo.owner}/${this.repo.repo}/contents/${encoded}`;
    return includeRef ? `${base}?ref=${encodeURIComponent(this.branch)}` : base;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    });
  }
}

export function parseGitHubRepo(input: string): GitHubRepoRef {
  const trimmed = input.trim().replace(/\.git$/, "");
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };

  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed) && !trimmed.includes(":")) {
    const [owner, repo] = trimmed.split("/");
    return { owner: owner!, repo: repo! };
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com") throw new Error("Only github.com repositories are supported.");
    const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repo) throw new Error("Missing owner or repository name.");
    return { owner, repo };
  } catch (err) {
    throw new Error(`Invalid GitHub repository address: ${err instanceof Error ? err.message : trimmed}`);
  }
}
