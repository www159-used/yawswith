import { randomBytes } from 'node:crypto';

/** The shell loads once. Project data arrives over the typed message channel. */
export function getHtml(scriptUri: string, styleUri: string, cspSource: string): string {
  const nonce = randomBytes(16).toString('hex');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(cspSource)}; script-src 'nonce-${nonce}'; img-src data:;">
  <link rel="stylesheet" href="${escapeHtml(styleUri)}">
  <title>Yawswith Projects</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${escapeHtml(scriptUri)}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
