import * as vscode from 'vscode';

export interface TextSearchOptions {
  includePattern?: { [key: string]: boolean };
  excludePattern?: { [key: string]: boolean };
  maxResults?: number;
  maxResultsPerFile?: number;
  includeDeclaration?: boolean;
}

export interface TextSearchResult {
  uri: vscode.Uri;
  range: vscode.Range;
  preview: {
    text: string;
    matches: vscode.Range[];
  };
}

export interface SearchLimit {
  max_results?: number;
  max_results_per_file?: number;
}

export interface SearchFilters {
  path?: string;
  include?: string;
  exclude?: string;
}

export interface SearchContentRequest {
  workspace?: string;
  query: string;
  case_sensitive?: boolean;
  filters?: SearchFilters;
  limit?: SearchLimit;
}

export interface SearchContentLine {
  line_number: number;
  content: string;
  match?: number[];
}

export interface LineMatch {
  before?: SearchContentLine[];
  line: SearchContentLine;
  after?: SearchContentLine[];
}

export interface SearchContentResult {
  file: string;
  lines?: LineMatch[];
  truncate?: boolean;
}

export interface SearchContentResponse {
  code: number;
  message: string;
  data?: {
    results?: SearchContentResult[];
    truncate?: boolean;
  };
}

export interface SearchMessage {
  type: 'search' | 'openFile' | 'focusSearchInput' | 'domLoaded' | 'visibilityChanged';
  query?: string;
  options?: {
    caseSensitive: boolean;
    include: string;
    exclude: string;
    maxResults?: number;
    maxResultsPerFile?: number;
  };
  file?: string;
  line?: number;
  start?: number;
  end?: number;
  isVisible?: boolean;
}
