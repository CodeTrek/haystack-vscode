import * as vscode from 'vscode';
import { HaystackProvider } from '../../core/HaystackProvider';
import { SearchContentResult, SearchContentRequest } from '../../types/search';

export class SearchHandlers {
  constructor(private readonly haystackProvider: HaystackProvider) {}

  async handleSearch(webview: vscode.Webview, query: string, options: {
    caseSensitive: boolean;
    include: string;
    exclude: string;
    maxResults?: number;
    maxResultsPerFile?: number;
  }) {
    try {
      // Get configuration values
      const config = vscode.workspace.getConfiguration('haystack.search');
      const maxResults = options.maxResults || config.get<number>('maxResults', 200);
      const maxResultsPerFile = options.maxResultsPerFile || config.get<number>('maxResultsPerFile', 50);

      const searchResult = await this.haystackProvider.search(query, {
        caseSensitive: options.caseSensitive,
        include: options.include,
        exclude: options.exclude,
        maxResults: maxResults,
        maxResultsPerFile: maxResultsPerFile
      });

      webview.postMessage({
        type: 'searchResults',
        results: searchResult.results || [],
        truncated: searchResult.truncated
      });
    } catch (error) {
      console.log(`Search error: ${error}`);
      webview.postMessage({
        type: 'searchResults',
        results: [],
        truncated: false
      });
    }
  }

  async handleOpenFile(file: string, line: number, start?: number, end?: number) {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('No workspace folder found');
      }

      const fullPath = file.startsWith(workspaceRoot)
        ? file
        : vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), file).fsPath;

      const uri = vscode.Uri.file(fullPath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);

      const position = new vscode.Position(line - 1, 0);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

      if (start !== undefined && end !== undefined) {
        const startPos = new vscode.Position(line - 1, start);
        const endPos = new vscode.Position(line - 1, end);
        editor.selection = new vscode.Selection(startPos, endPos);
      } else {
        editor.selection = new vscode.Selection(position, position);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }

  handleFocusSearchInput(webview: vscode.Webview) {
    webview.postMessage({
      type: 'focusSearchInput'
    });
  }

  handleDomLoaded() {
    console.log('WebView DOM has been loaded');
  }

  handleVisibilityChange(webview: vscode.Webview, isVisible: boolean) {
    console.log(`Search view visibility changed: ${isVisible ? 'visible' : 'hidden'}`);

    webview.postMessage({
      type: 'visibilityChanged',
      isVisible: isVisible
    });

    if (isVisible) {
      this.handleFocusSearchInput(webview);
    }
  }
}
