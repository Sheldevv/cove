const vscode = require('vscode');
const path = require('node:path');
const {
  LanguageClient,
} = require('vscode-languageclient/node');

/** @type {LanguageClient | undefined} */
let client;

async function activate(context) {
  const config = vscode.workspace.getConfiguration('cove');
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    vscode.window.showErrorMessage(
      'Cove: Open a workspace folder before opening a .cove file.'
    );
    return;
  }

  const configuredCwd = config.get('server.cwd', '');
  const cwd = configuredCwd
    ? path.resolve(workspaceFolder.uri.fsPath, configuredCwd)
    : workspaceFolder.uri.fsPath;
  const command = config.get('server.command', 'npm');
  const args = config.get('server.args', ['run', '--silent', 'lsp']);

  const serverOptions = {
    command,
    args,
    options: { cwd, shell: process.platform === 'win32' },
  };

  const clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'cove' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.cove'),
    },
    outputChannelName: 'Cove Language Server',
  };

  client = new LanguageClient(
    'cove',
    'Cove Language Server',
    serverOptions,
    clientOptions
  );

  context.subscriptions.push(client);
  try {
    await client.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Cove language server failed to start: ${message}`);
    throw error;
  }
}

async function deactivate() {
  if (client) {
    await client.stop();
    client = undefined;
  }
}

module.exports = { activate, deactivate };
