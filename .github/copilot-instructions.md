# GitHub Copilot Instructions

## User Authority

The user is the ultimate authority on what changes should be made to their code. Your suggestions must align with their instructions and preferences.

## Haystack VS Code Extension Project Context

- **Extension Purpose**: A VS Code extension that integrates Haystack for advanced code search capabilities
- **Key Components**:
  - `HaystackProvider`: Core API communication with Haystack backend
  - `SearchViewProvider`: WebView-based UI for search functionality
  - `Haystack`: Core manager for the Haystack binary
- **Architecture Pattern**: WebView-based UI with TypeScript backend
- **Main Features**:
  - Code search with context-aware results
  - SearchView in the activity bar
  - Workspace indexing for faster searches
  - Search selected text with keyboard shortcuts
- **Command Structure**:
  - `haystack.searchSelectedText`: Search currently selected text
  - `haystack.syncWorkspace`: Refresh the search index
  - `haystack.openSettings`: Open Haystack settings
- **Development Tasks**:
  - `compile`: Build the extension
  - `watch`: Watch for changes during development
  - `test`: Run extension tests
