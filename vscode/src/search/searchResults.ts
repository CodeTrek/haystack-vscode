import * as vscode from 'vscode';

interface TextSearchResult {
  uri: vscode.Uri;
  range: vscode.Range;
  preview: {
    text: string;
    matches: vscode.Range[];
  };
}

export class SearchResult {
  filePath: string;
  lineContent: string;
  lineNumber: number;
  lineRange: vscode.Range;
  score: number;
  matchRanges: vscode.Range[];

  constructor(filePath: string, lineContent: string, lineNumber: number, matchRanges: vscode.Range[] = [], score: number = 0) {
    this.filePath = filePath;
    this.lineContent = lineContent;
    this.lineNumber = lineNumber;
    this.score = score;
    this.matchRanges = matchRanges;
    this.lineRange = new vscode.Range(
      new vscode.Position(lineNumber, 0),
      new vscode.Position(lineNumber, lineContent.length)
    );
  }

  formatResult(): string {
    return `${this.filePath}:${this.lineNumber} ${this.lineContent}`;
  }

  toTextSearchResult(): TextSearchResult {
    return {
      uri: vscode.Uri.file(this.filePath),
      range: this.lineRange,
      preview: {
        text: this.lineContent,
        matches: this.matchRanges
      }
    };
  }
}
