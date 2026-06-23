import * as vscode from "vscode";

export interface WebviewStyleUris {
  designSystemCss: string;
  codiconsCss: string;
}

/**
 * 统一生成 Webview 静态样式资源地址。
 * 原因：VSIX 会排除 src/**，构建脚本会把 CSS 复制到 dist/webview/styles，
 * 所以所有 Webview 都必须通过 dist 下的 asWebviewUri 读取样式。
 */
export function webviewStyleRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [vscode.Uri.joinPath(extensionUri, "dist", "webview")];
}

/**
 * 为当前 Webview 生成可访问的设计系统和 Codicons 样式 URI。
 * 原因：每个 Webview 的资源 URI 都和自身隔离，不能复用另一个面板生成的 URI。
 */
export function webviewStyleUris(webview: vscode.Webview, extensionUri: vscode.Uri): WebviewStyleUris {
  const stylesRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview", "styles");
  return {
    designSystemCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesRoot, "design-system.css")).toString(),
    codiconsCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesRoot, "codicons.css")).toString(),
  };
}
