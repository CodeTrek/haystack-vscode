import * as vscode from 'vscode';
import { HaystackProvider } from '../core/HaystackProvider';
import { getSearchTemplate } from './components/searchTemplate';
import { SearchHandlers } from './components/searchHandlers';
import { SearchContentResult, SearchMessage } from '../types/search';

export class SearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'haystackSearch';

  // Store the webview view reference
  private _view?: vscode.WebviewView;
  private readonly _searchHandlers: SearchHandlers;
  private _statusBarItem: vscode.StatusBarItem;
  private _statusUpdateInterval: NodeJS.Timeout | null = null;
  private readonly _isHaystackSupported: boolean;
  private _pendingSearchText?: string;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _haystackProvider: HaystackProvider,
    isHaystackSupported: boolean
  ) {
    this._searchHandlers = new SearchHandlers(_haystackProvider);
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this._isHaystackSupported = isHaystackSupported;
    // Start status updates immediately when the provider is created
    this.startStatusUpdates();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    // Store the webview reference
    this._view = webviewView;

    // Configure webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'resources'),
        vscode.Uri.joinPath(this._extensionUri, 'dist'),
        vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')
      ]
    };

    // Set HTML content only if it hasn't been set before
    if (!webviewView.webview.html) {
      webviewView.webview.html = getSearchTemplate(webviewView.webview, this._extensionUri, this._isHaystackSupported);
    }

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data: SearchMessage) => {
      switch (data.type) {
        case 'search':
          await this._searchHandlers.handleSearch(webviewView.webview, data.query!, data.options!);
          break;
        case 'openFile':
          await this._searchHandlers.handleOpenFile(data.file!, data.line!, data.start, data.end);
          break;
        case 'focusSearchInput':
          this._searchHandlers.handleFocusSearchInput(webviewView.webview);
          break;
        case 'domLoaded':
          console.log('Search view DOM loaded');
          this._searchHandlers.handleDomLoaded();
          break;
      }
    });

    // Clean up when the view is disposed
    webviewView.onDidDispose(() => {
      this.stopStatusUpdates();
    });

    // Handle visibility changes
    webviewView.onDidChangeVisibility(() => {
      this._searchHandlers.handleVisibilityChange(webviewView.webview, webviewView.visible);
    });

    if (this._pendingSearchText) {
      const pendingText = this._pendingSearchText;
      this._pendingSearchText = undefined;

      // Let UI initialize first
      setTimeout(() => {
        this.searchText(pendingText);
      }, 100);
    }
  }

  /**
   * Initiates a search with the provided text in the search view
   * @param text The text to search for
   */
  public searchText(text: string): void {
    if (!this._view) {
      // Store the search text to use when the view becomes available
      // and trigger the focus command to create the view
      console.log('Search view not available, creating it first');
      this._pendingSearchText = text;
      vscode.commands.executeCommand('haystackSearch.focus')
      return;
    }

    // Send a message to the webview to update the search input
    this._view.webview.postMessage({
      type: 'setSearchText',
      text: text
    });

    // Directly trigger search using the search handlers with default options
    const defaultOptions = {
      caseSensitive: false,
      include: '',
      exclude: ''
    };

    // Use the search handlers to perform the search immediately
    this._searchHandlers.handleSearch(this._view.webview, text, defaultOptions);
  }

  /**
   * Focuses the search input in the search view
   */
  public focusSearchInput(): void {
    if (!this._view) {
      // View is not available, trigger the focus command to create the view
      console.log('Search view not available, creating it first');
      vscode.commands.executeCommand('haystackSearch.focus');
      return;
    }

    // Focus the search input in the webview
    this._searchHandlers.handleFocusSearchInput(this._view.webview);
  }

  public async updateStatusbar() {
    try {
      if (!this._haystackProvider || !this._haystackProvider.getHaystack()) {
        this._statusBarItem.text = `$(error) Haystack: (Not installed)`;
        this._statusBarItem.tooltip = `Haystack is not installed`;
        this._statusBarItem.show();
        return;
      }

      if (this._haystackProvider.getHaystack()?.getStatus() === 'unsupported') {
        this._statusBarItem.text = `$(error) Haystack: (Unsupported)`;
        this._statusBarItem.tooltip = `Haystack is not supported on your platform`;
        this._statusBarItem.show();
        return;
      }

      if (this._haystackProvider.getHaystack()?.getStatus() === 'error') {
        this._statusBarItem.text = `$(error) Haystack: (Error)`;
        this._statusBarItem.tooltip = `Error active haystack server`;
        this._statusBarItem.show();
        return;
      }

      if (this._haystackProvider.getHaystack()?.getStatus() === 'stopped') {
        this._statusBarItem.text = `$(error) Haystack: (${this._haystackProvider.getHaystack()?.getInstallStatus()})`;
        this._statusBarItem.tooltip = `Haystack server is stopped`;
        this._statusBarItem.show();
        return;
      }

      const status = await this._haystackProvider.getWorkspaceStatus();
      if (status.error) {
        this._statusBarItem.text = `$(error) Haystack: (Error)`;
        this._statusBarItem.tooltip = `Error: ${status.error}`;
        this._statusBarItem.show();
      } else if (status.indexing) {
        this._statusBarItem.text = `$(sync~spin) Haystack (indexing)`;
        this._statusBarItem.tooltip = `Indexing workspace:\n• Indexed: ${status.totalFiles} files\nYou can search now, but the results may not be accurate`;
        this._statusBarItem.show();
      } else {
        this._statusBarItem.text = `$(check) Haystack (Ready)`;
        this._statusBarItem.tooltip = `Haystack search is ready\n• Total indexed files: ${status.totalFiles}\n• Status: Ready for search`;
        this._statusBarItem.show();
      }
    } catch (error) {
      console.error(`Failed to update workspace status: ${error}`);
    }
  }

  private startStatusUpdates() {
    // Clear existing interval if any
    if (this._statusUpdateInterval) {
      clearInterval(this._statusUpdateInterval);
    }

    this.updateStatusbar();

    // Set up new interval (3 seconds)
    this._statusUpdateInterval = setInterval(async () => {
      await this.updateStatusbar();
    }, 3000);
  }

  private stopStatusUpdates() {
    if (this._statusUpdateInterval) {
      clearInterval(this._statusUpdateInterval);
      this._statusUpdateInterval = null;
    }
    this._statusBarItem.hide();
  }

  dispose() {
    this.stopStatusUpdates();
    this._statusBarItem.dispose();
  }
}
