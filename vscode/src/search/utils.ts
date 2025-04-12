import * as vscode from 'vscode';

interface TextSearchResult {
  uri: vscode.Uri;
  range: vscode.Range;
  preview: {
    text: string;
    matches: vscode.Range[];
  };
}

interface TextSearchOptions {
  includePattern: { [key: string]: boolean };
  excludePattern: { [key: string]: boolean };
}

export function parseSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function formatSearchResults(results: TextSearchResult[]): TextSearchResult[] {
  return results;
}

export function getSearchOptions(): TextSearchOptions {
  return {
    includePattern: { '**/*': true },
    excludePattern: { '**/node_modules/**': true }
  };
}
