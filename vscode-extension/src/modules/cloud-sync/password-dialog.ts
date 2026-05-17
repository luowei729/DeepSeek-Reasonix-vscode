import * as vscode from "vscode";

export interface PasswordRequestOptions {
  purpose: "sync" | "restore" | "unlock";
  confirm: boolean;
}

const WARNING =
  "请牢记你的加密密码。Reasonix VS Code 插件不会保存此密码；忘记密码后，云端备份数据将无法解密，也无法恢复。";

/**
 * Centralizes password prompts so every sync/restore path repeats the same data
 * loss warning and never persists the password by accident.
 */
export async function requestEncryptionPassword(opts: PasswordRequestOptions): Promise<string | undefined> {
  const accepted = await vscode.window.showWarningMessage(WARNING, { modal: true }, "我已理解");
  if (accepted !== "我已理解") return undefined;

  const password = await vscode.window.showInputBox({
    title: opts.purpose === "restore" ? "输入备份加密密码以恢复" : "输入备份加密密码",
    prompt: "此密码只保存在当前 VS Code 运行会话的内存中，不会写入本地或云端。",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.length >= 8 ? undefined : "加密密码至少 8 个字符。"),
  });
  if (!password) return undefined;

  if (!opts.confirm) return password;

  const again = await vscode.window.showInputBox({
    title: "再次输入备份加密密码",
    prompt: "两次输入必须一致。Reasonix 不会保存此密码。",
    password: true,
    ignoreFocusOut: true,
  });
  if (!again) return undefined;
  if (again !== password) {
    vscode.window.showErrorMessage("两次输入的加密密码不一致，已取消操作。");
    return undefined;
  }
  return password;
}
