import * as vscode from 'vscode';
import axios from 'axios';
import {
  SearchContentRequest,
  SearchContentResponse,
  SearchContentResult
} from '../types/search';
import { Haystack } from './Haystack';

// Haystack API URLs
const HAYSTACK_API_VERSION = `/api/v1`;
const WORKSPACE_CREATE_URL = `${HAYSTACK_API_VERSION}/workspace/create`;
const WORKSPACE_GET_URL = `${HAYSTACK_API_VERSION}/workspace/get`;
const WORKSPACE_SYNC_URL = `${HAYSTACK_API_VERSION}/workspace/sync`;
const DOCUMENT_UPDATE_URL = `${HAYSTACK_API_VERSION}/document/update`;
const DOCUMENT_DELETE_URL = `${HAYSTACK_API_VERSION}/document/delete`;
const SEARCH_CONTENT_URL = `${HAYSTACK_API_VERSION}/search/content`;

export class HaystackProvider {
  private workspaceRoot: string;
  private updateTimeouts: Map<string, NodeJS.Timeout>;
  private periodicTaskInterval: NodeJS.Timeout | null;
  private statusUpdateInterval: NodeJS.Timeout | null;
  private haystack: Haystack;

  constructor(haystack: Haystack) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    this.workspaceRoot = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
    this.updateTimeouts = new Map();
    this.periodicTaskInterval = null;
    this.statusUpdateInterval = null;
    this.haystack = haystack;
    // Start periodic workspace creation task
    this.startPeriodicTask();

    // Listen for file save events
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.uri.scheme === 'file') {
        try {
          // Convert absolute path to relative path
          const relativePath = vscode.workspace.asRelativePath(document.uri);

          // Clear existing timeout if any
          const existingTimeout = this.updateTimeouts.get(relativePath);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          // Set new timeout
          const timeout = setTimeout(async () => {
            await this.updateDocument(relativePath);
            this.updateTimeouts.delete(relativePath);
          }, 500);

          this.updateTimeouts.set(relativePath, timeout);
        } catch (error) {
          console.error(`Failed to update document: ${error}`);
        }
      }
    });

    // Listen for file delete events
    vscode.workspace.onDidDeleteFiles(async (event) => {
      for (const uri of event.files) {
        if (uri.scheme === 'file') {
          try {
            const relativePath = vscode.workspace.asRelativePath(uri);
            await this.deleteDocument(relativePath);
          } catch (error) {
            console.error(`Failed to delete document: ${error}`);
          }
        }
      }
    });

    // Listen for file restore events
    vscode.workspace.onDidCreateFiles(async (event) => {
      for (const uri of event.files) {
        if (uri.scheme === 'file') {
          try {
            const relativePath = vscode.workspace.asRelativePath(uri);
            await this.updateDocument(relativePath);
          } catch (error) {
            console.error(`Failed to update restored document: ${error}`);
          }
        }
      }
    });
  }

  public getHaystack() {
    return this.haystack;
  }

  private async post(uri: string, data: any) {
    if (!this.haystack || this.haystack.getStatus() !== 'running') {
      throw new Error('Haystack is not running');
    }

    return await this.haystack.post(uri, data);
  }

  private startPeriodicTask() {
    // Clear existing interval if any
    if (this.periodicTaskInterval) {
      clearInterval(this.periodicTaskInterval);
    }

    // Set up new interval (24 hours in milliseconds)
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    this.periodicTaskInterval = setInterval(async () => {
      try {
        await this.createWorkspace();
      } catch (error) {
        console.error(`Failed to create workspace in periodic task: ${error}`);
      }
    }, TWENTY_FOUR_HOURS);
  }

  async createWorkspace(): Promise<void> {
    if (!this.workspaceRoot) {
      throw new Error('No workspace folder is opened');
    }

    try {
      const response = await this.post(WORKSPACE_CREATE_URL, {
        workspace: this.workspaceRoot
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to create workspace');
      }
    } catch (error) {
      throw new Error(`Failed to create workspace: ${error}`);
    }
  }

  async updateDocument(filePath: string): Promise<void> {
    if (!this.workspaceRoot) {
      throw new Error('No workspace folder is opened');
    }

    try {
      const response = await this.post(DOCUMENT_UPDATE_URL, {
        workspace: this.workspaceRoot,
        path: filePath
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to update document');
      }
    } catch (error) {
      throw new Error(`Failed to update document: ${error}`);
    }
  }

  async deleteDocument(filePath: string): Promise<void> {
    if (!this.workspaceRoot) {
      throw new Error('No workspace folder is opened');
    }

    try {
      const response = await this.post(DOCUMENT_DELETE_URL, {
        workspace: this.workspaceRoot,
        path: filePath
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to delete document');
      }
    } catch (error) {
      throw new Error(`Failed to delete document: ${error}`);
    }
  }

  async search(query: string, options: {
    caseSensitive?: boolean;
    include?: string;
    exclude?: string;
    maxResults?: number;
    maxResultsPerFile?: number;
  }): Promise<{ results: SearchContentResult[]; truncated: boolean }> {
    const searchRequest: SearchContentRequest = {
      workspace: this.workspaceRoot,
      query: query,
      case_sensitive: options.caseSensitive,
      filters: {
        include: options.include,
        exclude: options.exclude
      },
      limit: {
        max_results: options.maxResults,
        max_results_per_file: options.maxResultsPerFile
      }
    };

    try {
      const response = await this.post(SEARCH_CONTENT_URL, searchRequest);
      if (response.data.code === 0) {
        return {
          results: response.data.data?.results || [],
          truncated: response.data.data?.truncate || false
        };
      } else {
        console.log(`Search returned no results: ${response.data.message || 'Unknown reason'}`);
        return { results: [], truncated: false };
      }
    } catch (error) {
      throw new Error(`Failed to connect to Haystack server: ${error}`);
    }
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  async getWorkspaceStatus(): Promise<{ indexing: boolean; totalFiles: number; indexedFiles: number; error?: string }> {
    if (!this.workspaceRoot) {
      return {
        indexing: false,
        totalFiles: 0,
        indexedFiles: 0,
        error: 'No workspace folder is opened'
      };
    }

    try {
      const response = await this.post(WORKSPACE_GET_URL, {
        workspace: this.workspaceRoot
      });

      if (response.data.code === 1) {
        // Workspace not found, try to create it
        console.log(`Haystack: Workspace '${this.workspaceRoot}' not found. Attempting to create...`);
        try {
          await this.createWorkspace();
          console.log(`Haystack: Workspace '${this.workspaceRoot}' created successfully. Initial sync triggered.`);
          // Return status indicating indexing has started
          return {
            indexing: true,
            totalFiles: 0, // Total files unknown until first sync completes
            indexedFiles: 0
          };
        } catch (creationError: any) {
          const errorMessage = creationError.message || String(creationError);
          if (errorMessage.includes('Workspace already exists')) {
            console.warn(`Haystack: Workspace '${this.workspaceRoot}' was created concurrently.`);
            // Workspace created by another process, status will update shortly
            return {
              indexing: false,
              totalFiles: 0,
              indexedFiles: 0,
              error: 'Workspace status update pending after concurrent creation'
            };
          } else {
            console.error(`Haystack: Failed to automatically create workspace '${this.workspaceRoot}': ${errorMessage}`);
            return {
              indexing: false,
              totalFiles: 0,
              indexedFiles: 0,
              error: `Failed to create workspace: ${errorMessage}`
            };
          }
        }
      } else if (response.data.code === 0) {
        // Successfully fetched status
        const statusData = response.data.data;
        return {
          indexing: statusData.indexing || false,
          totalFiles: statusData.total_files || 0,
          indexedFiles: statusData.indexed_files || 0
        };
      } else {
        // Handle other non-zero error codes
        console.error(`Haystack: Error getting workspace status for '${this.workspaceRoot}': ${response.data.message || 'Unknown error'}`);
        return {
          indexing: false,
          totalFiles: 0,
          indexedFiles: 0,
          error: `Error fetching workspace status: ${response.data.message || 'Unknown error'}`
        };
      }
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || String(error);
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('Failed to connect')) {
        console.error(`Haystack: Failed to connect to Haystack server. Ensure it's running.`);
        return {
          indexing: false,
          totalFiles: 0,
          indexedFiles: 0,
          error: 'Haystack server is not running or unreachable.'
        };
      }
      console.error(`Haystack: Unexpected error getting workspace status for '${this.workspaceRoot}': ${errorMessage}`);
      return {
        indexing: false,
        totalFiles: 0,
        indexedFiles: 0,
        error: `Unexpected error fetching status: ${errorMessage}`
      };
    }
  }

  async syncWorkspace(): Promise<void> {
    if (!this.workspaceRoot) {
      // No workspace folder is opened
      return
    }

    try {
      const response = await this.post(WORKSPACE_SYNC_URL, {
        workspace: this.workspaceRoot
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to sync workspace');
      }
    } catch (error) {
      throw new Error(`Failed to sync workspace: ${error}`);
    }
  }

  startStatusUpdates(callback: (status: { indexing: boolean; totalFiles: number; indexedFiles: number; error?: string }) => void) {
    // Clear existing interval if any
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
    }

    // Define the update function
    const updateStatus = async () => {
      const status = await this.getWorkspaceStatus();
      callback(status);
    };

    // Call immediately and then set interval
    updateStatus();
    this.statusUpdateInterval = setInterval(updateStatus, 5000); // Update every 5 seconds
  }

  stopStatusUpdates() {
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
      this.statusUpdateInterval = null;
    }
  }

  dispose() {
    // Clear timeouts and intervals
    this.updateTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.updateTimeouts.clear();
    if (this.periodicTaskInterval) {
      clearInterval(this.periodicTaskInterval);
      this.periodicTaskInterval = null;
    }
    this.stopStatusUpdates();
  }
}
