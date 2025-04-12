import * as vscode from 'vscode';
import { SearchViewProvider } from './search/SearchViewProvider';
import { HaystackProvider } from './core/HaystackProvider';
import { Haystack } from './core/Haystack';

// Constants
const isDev = () => process.env.VSCODE_DEBUG_MODE === 'true' || process.env.IS_DEV === 'true' || __dirname.includes('.vscode');
const getStateKey = (key: string) => `${isDev() ? 'dev.' : ''}${key}`;

// Global state
let haystackProvider: HaystackProvider | undefined;
let searchViewProvider: SearchViewProvider | undefined;
let haystack: Haystack | undefined;

/**
 * This function is called when your extension is activated
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log(`haystack is running in ${isDev() ? 'dev' : 'prod'} mode`);
    // Simple activation logging without version checks
    console.log('Haystack extension activated');

    // Initialize Haystack Core Manager and check installation
    haystack = new Haystack(context, true);
    console.log(`haystack is supported on ${haystack.getCurrentPlatform()}? ${haystack.getIsSupported() ? 'yes' : 'no'}`);

    // Pass necessary info to HaystackProvider if needed
    // Example: haystackProvider = new HaystackProvider(haystackCoreManager.getCorePath());
    haystackProvider = new HaystackProvider(haystack);
    searchViewProvider = new SearchViewProvider(context.extensionUri, haystackProvider, haystack.getIsSupported());

    // Register search view
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SearchViewProvider.viewType,
            searchViewProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // Register command to search selected text
    context.subscriptions.push(
        vscode.commands.registerCommand('haystack.searchSelectedText', async () => {
            const editor = vscode.window.activeTextEditor;

            if (!editor) {
                // No active editor, just focus the view
                await vscode.commands.executeCommand('haystackSearch.focus');
                return;
            }

            let searchText = '';
            const selection = editor.selection;

            if (!selection.isEmpty) {
                // Use selected text if available
                searchText = editor.document.getText(selection);
            } else {
                // No selection, try word at cursor
                const wordRange = editor.document.getWordRangeAtPosition(selection.active);
                if (wordRange) {
                    searchText = editor.document.getText(wordRange);
                }
            }

            // Perform search if we found text and the provider exists
            if (searchText && searchViewProvider) {
                searchViewProvider.searchText(searchText);
            }
            // If no text was found (no selection, no word at cursor),
            // the view is already focused, so nothing more to do.
        })
    );

    // Register command to focus the search input
    context.subscriptions.push(
        vscode.commands.registerCommand('haystack.focusSearchInput', () => {
            if (searchViewProvider) {
                searchViewProvider.focusSearchInput();
            }
        })
    );

    // Register command to sync the workspace index
    context.subscriptions.push(
        vscode.commands.registerCommand('haystack.syncWorkspace', async () => {
            try {
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Refreshing Haystack index...",
                    cancellable: false
                }, async (progress) => {
                    progress.report({ increment: 0 });

                    try {
                        // Call the sync API
                        await haystackProvider?.syncWorkspace();

                        progress.report({ increment: 100 });
                        vscode.window.showInformationMessage('Haystack index refreshed successfully.');
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to refresh Haystack index: ${error}`);
                    }
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Error during Haystack index refresh: ${error}`);
            }
        })
    );

    // Delay workspace creation
    setTimeout(async () => {
        try {
            await haystackProvider?.createWorkspace();
        } catch (error) {
            // Silent fail
        }
    }, 1000);

    // Listen for workspace folder changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
            if (event.added.length > 0) {
                try {
                    await haystackProvider?.createWorkspace();
                } catch (error) {
                    // Silent fail
                }
            }
        })
    );

    // Add provider to subscriptions for proper cleanup
    context.subscriptions.push({
        dispose: () => {
            if (haystackProvider) {
                haystackProvider.dispose();
                haystackProvider = undefined;
            }
            if (searchViewProvider) {
                searchViewProvider.dispose();
                searchViewProvider = undefined;
            }
            // No explicit dispose needed for HaystackCoreManager currently
            haystack = undefined;
        }
    });
}

export function deactivate() {
    if (haystackProvider) {
        haystackProvider.dispose();
        haystackProvider = undefined;
    }
    if (searchViewProvider) {
        searchViewProvider.dispose();
        searchViewProvider = undefined;
    }
    // No explicit deactivate needed for HaystackCoreManager currently
    haystack = undefined;
}
