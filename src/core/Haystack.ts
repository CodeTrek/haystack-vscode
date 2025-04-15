import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import util from 'util';
import { EventEmitter } from 'events';
import { time } from 'console';

const supportedPlatforms = {
  "linux-amd64": true,
  "linux-arm64": true,
  "darwin-amd64": true,
  "darwin-arm64": true,
  "windows-amd64": true,
  "windows-arm64": true,
}

// Haystack ports
const LOCAL_PORT= 13135;
const GLOBAL_PORT= 13134;

// Haystack config
const haystackConfig= (context: vscode.ExtensionContext) => `
global:
  data_path: ${path.join(context.globalStorageUri.fsPath, 'data')}
  port: ${LOCAL_PORT}
client:
  default_limit:
    max_results: 500
    max_results_per_file: 50
`

const platform = () => {
  if (process.platform === 'win32') {
    return 'windows';
  }
  return process.platform;
}

const arch = () => {
  if (process.arch === 'x64') {
    return 'amd64';
  }
  return process.arch;
}

// Get the appropriate host based on the environment
function getHaystackHost(): string {
  // If we're in a remote environment, use the remote host
  if (vscode.env.remoteName) {
      // In remote environment, we can safely use localhost
      return 'localhost';
  }

  // In local environment, prefer 127.0.0.1 for better compatibility
  return '127.0.0.1';
}

const currentPlatform = `${platform()}-${arch()}`;
const isHaystackSupported = supportedPlatforms[currentPlatform as keyof typeof supportedPlatforms] || false;
const HAYSTACK_DOWNLOAD_URL = 'https://github.com/CodeTrek/haystack/releases/download/';
const HAYSTACK_DOWNLOAD_URL_FALLBACK = 'https://haystack.codetrek.cn/download/';

type Status =
  'initializing'|
  'starting'|
  'running'|
  'unsupported'|
  'error';

type InstallStatus =
  'initializing'|
  'downloading'|
  'unsupported'|
  'error'|
  'installed'|
  'not-installed';

export type HaystackEvent =
  'status-change' |
  'install-status-change' |
  'download-progress' |
  'error';

type DownloadProgress = {
  url: string;
  totalSize: number;
  downloadedSize: number;
  percent: number;
}

export class Haystack extends EventEmitter {
  private coreFilePath: string;
  private binDir: string;
  private _status: Status;
  private _installStatus: InstallStatus;
  private downloadZipPath: string;
  private builtinZipPath: string;
  private runningPort: number;
  private haystackVersion: string;
  private HAYSTACK_ZIP_FILE_NAME: string;
  private _downloadProgress: DownloadProgress;
  private _startRetry: number;

  constructor(private context: vscode.ExtensionContext, localServer: boolean) {
    super();
    // Use globalStorageUri for persistent storage across extension updates
    this.binDir = this.context.globalStorageUri.fsPath;
    this.coreFilePath = path.join(this.binDir, this.getExecutableName());
    this.downloadZipPath = path.join(this.context.globalStorageUri.fsPath, "download");
    this.builtinZipPath = path.join(this.context.extensionPath, "pkgs"); // We may have builtin zip files
    this._status = 'initializing';
    this._installStatus = 'initializing';
    this.runningPort = localServer ? LOCAL_PORT : GLOBAL_PORT;
    this.haystackVersion = "v" + context.extension.packageJSON.haystackVersion;
    this.HAYSTACK_ZIP_FILE_NAME = `haystack-${currentPlatform}-${this.haystackVersion}.zip`;
    this._startRetry = 0;
    this._downloadProgress = {
      url: '',
      totalSize: 0,
      downloadedSize: 0,
      percent: 0
    };
    this.doInit();
  }

  public async post(uri: string, data: any) {
    if (this._status !== 'running') {
      throw new Error('Haystack is not running');
    }

    const url = `${this.getUrl()}${uri}`;
    const response = await axios.post(url, data);
    return response;
  }

  public isRunningLocally() {
    return this.runningPort === LOCAL_PORT;
  }

  public getUrl(): string {
    return `http://${getHaystackHost()}:${this.runningPort}`;
  }

  public getIsSupported(): boolean {
    return isHaystackSupported;
  }

  public getCurrentPlatform(): string {
    return currentPlatform;
  }

  // Gets the current status
  public getStatus(): Status {
    return this._status;
  }

  public getDownloadProgress(): DownloadProgress {
    return this._downloadProgress;
  }

  // Sets the status and emits a status-change event
  private set status(newStatus: Status) {
    if (this._status !== newStatus) {
      const oldStatus = this._status;
      this._status = newStatus;
      this.emit('status-change', {
        oldStatus,
        newStatus
      });
      if (newStatus === 'error') {
        this.emit('error', { message: 'Haystack status changed to error state' });
      }
    }
  }

  private get status(): Status {
    return this._status;
  }

  // Gets the current installation status
  public getInstallStatus(): InstallStatus {
    return this._installStatus;
  }

  // Sets the installation status and emits an install-status-change event
  private set installStatus(newStatus: InstallStatus) {
    if (this._installStatus !== newStatus) {
      const oldStatus = this._installStatus;
      this._installStatus = newStatus;
      this.emit('install-status-change', {
        oldStatus,
        newStatus
      });

      if (newStatus === 'error') {
        this.emit('error', { message: 'Haystack installation error' });
      }
    }
  }

  private get installStatus(): InstallStatus {
    return this._installStatus;
  }

  private getExecutableName(): string {
    return platform() === 'windows' ? 'haystack.exe' : 'haystack';
  }

  /**
   * Checks if the Haystack Core executable exists in the designated binary directory.
   * It first ensures the binary directory exists.
   * @returns True if the core executable exists, false otherwise.
   */
  private async doInit(): Promise<void> {
    if (!this.getIsSupported()) {
      this.status = 'unsupported';
      this.installStatus = 'unsupported';
      return;
    }

    if (!this.isRunningLocally()) {
      // Always set status to running if not run local server
      this.status = 'running';
      return;
    }

    try {
      // Ensure the target directory exists, creating it if necessary.
      await fs.promises.mkdir(this.binDir, { recursive: true });
      // Check for the existence of the core executable file.
      await fs.promises.access(this.coreFilePath, fs.constants.F_OK);
      console.log(`Haystack Core found at: ${this.coreFilePath}`);
      this.installStatus = 'installed';
    } catch (error) {
      // Log if the core executable is not found.
      console.log(`Haystack Core not found or accessible at: ${this.coreFilePath}.`);
      this.installStatus = 'not-installed';
    }

    if (this.installStatus === 'installed') {
      // We have to check if installed or running a compatible version
      await this.checkIsCompatibleVersion();
    }

    if (this.installStatus === 'not-installed') {
      await this.install();
    }

    console.log(`Install status: ${this.installStatus}, status: ${this.status}`);

    if (this.installStatus !== 'installed') {
      this.status = 'error';
      return
    }

    if (this.status !== 'running') {
      this.status = 'starting';
      this._startRetry = 0;
      await this.start();
    }
  }

  private async install(): Promise<void> {
    try {
      await fs.promises.mkdir(this.downloadZipPath, { recursive: true });

      const downloadedZipPath = path.join(this.downloadZipPath, this.HAYSTACK_ZIP_FILE_NAME);
      const builtinZipFilePath = path.join(this.builtinZipPath, this.HAYSTACK_ZIP_FILE_NAME);

      // Step 1: Check if zip already exists in download directory
      try {
        await this.checkExistingZip(downloadedZipPath, true);
        console.log('Found downloaded zip file');
        await this.extractZip(downloadedZipPath);
        await this.writeVersionAndConf(this.haystackVersion);
        console.log(`Installed from downloaded zip file: ${downloadedZipPath}`);
        this.installStatus = 'installed';
        return;
      } catch (error) {
        console.log('No downloaded zip file found');
      }

      // Step 2: Check if zip exists in builtin directory
      try {
        await this.checkExistingZip(builtinZipFilePath, false);
        console.log('Found builtin zip file');
        await this.extractZip(builtinZipFilePath);
        await this.writeVersionAndConf(this.haystackVersion);
        this.installStatus = 'installed';
        console.log(`Installed from builtin zip file: ${builtinZipFilePath}`);
        return;
      } catch (error) {
        console.log('No builtin zip file found');
      }

      // Step 3: Try downloading from primary URL
      this.installStatus = 'downloading';
      try {
        const primaryUrl = `${HAYSTACK_DOWNLOAD_URL}${this.haystackVersion}/${this.HAYSTACK_ZIP_FILE_NAME}`;
        console.log(`Downloading from primary URL: ${primaryUrl}`);
        await this.downloadFile(primaryUrl, downloadedZipPath);
        await this.extractZip(downloadedZipPath);
        await this.writeVersionAndConf(this.haystackVersion);
        this.installStatus = 'installed';
        console.log(`Downloaded from primary URL: ${primaryUrl}`);
        return;
      } catch (error) {
        console.log(`Failed to download from primary URL: ${error}`);
      }

      // Step 4: Try downloading from fallback URL
      try {
        const fallbackUrl = `${HAYSTACK_DOWNLOAD_URL_FALLBACK}${this.haystackVersion}/${this.HAYSTACK_ZIP_FILE_NAME}`;
        console.log(`Downloading from fallback URL: ${fallbackUrl}`);
        await this.downloadFile(fallbackUrl, downloadedZipPath);
        await this.extractZip(downloadedZipPath);
        await this.writeVersionAndConf(this.haystackVersion);
        this.installStatus = 'installed';
        console.log(`Downloaded from fallback URL: ${fallbackUrl}`);
        return;
      } catch (error) {
        console.log(`Failed to download from fallback URL: ${error}`);
        this.installStatus = 'error';
      }
    } catch (error) {
      console.error(`Installation failed: ${error}`);
      this.installStatus = 'error';
    }
  }

  private async downloadFile(url: string, destination: string): Promise<void> {
    const https = require('https');
    const http = require('http');

    this._downloadProgress = {
      url,
      totalSize: 0,
      downloadedSize: 0,
      percent: 0
    };
    this.emit('download-progress', this._downloadProgress);

    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destination);

      client.get(url, (response: any) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          // Handle redirects
          fs.unlink(destination, () => {
            this.downloadFile(response.headers.location, destination)
              .then(resolve)
              .catch(reject);
          });
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destination, () => {});
          reject(new Error(`Failed to download, status code: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        console.log(`Total size: ${totalSize} bytes`);
        let downloadedSize = 0;
        let lastReportedPercent = 0;

        const percent = 0;
        this._downloadProgress = {
          url,
          totalSize,
          downloadedSize,
          percent,
        };
        this.emit('download-progress', this._downloadProgress);

        response.on('data', (chunk: Buffer) => {
          downloadedSize += chunk.length;

          // Report progress at most every 5% to avoid excessive events
          if (totalSize > 0) {
            const percent = Math.floor((downloadedSize / totalSize) * 100);
            this._downloadProgress = {
              url,
              totalSize,
              downloadedSize,
              percent
            };
          }

          if (this._downloadProgress.percent >= lastReportedPercent + 5 ||
            this._downloadProgress.percent === 100) {
            // Emit download progress event
            this.emit('download-progress', this._downloadProgress);
            lastReportedPercent = this._downloadProgress.percent;
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          this._downloadProgress = {
            url,
            totalSize,
            downloadedSize,
            percent: 100
          };
          // Ensure we emit 100% at the end
          this.emit('download-progress', this._downloadProgress);
          resolve();
        });
      }).on('error', (err: Error) => {
        file.close();
        fs.unlink(destination, () => {});
        this.emit('error', {
          message: `Download failed: ${err.message}`,
          error: err
        });
        reject(err);
      });

      file.on('error', (err: Error) => {
        file.close();
        fs.unlink(destination, () => {});
        this.emit('error', {
          message: `File write error: ${err.message}`,
          error: err
        });
        reject(err);
      });
    });
  }

  private async checkExistingZip(zipFilePath: string, deleteIfSmall: boolean = false): Promise<void> {
    try {
      // Check if file exists
      await fs.promises.access(zipFilePath, fs.constants.F_OK);

      // Check file size
      const stats = await fs.promises.stat(zipFilePath);
      const minSizeBytes = 1024 * 1024; // 1MB in bytes

      if (stats.size < minSizeBytes) {
        if (deleteIfSmall) {
          await fs.promises.unlink(zipFilePath);
          console.log(`Deleted small zip file: ${zipFilePath}`);
        }

        throw new Error(`Zip file exists but is too small (${stats.size} bytes, minimum: ${minSizeBytes} bytes)`);
      }

      console.log(`Verified zip file: ${zipFilePath}`);
    } catch (error) {
      if (error instanceof Error) {
        throw error; // Re-throw existing errors
      } else {
        throw new Error(`Zip file does not exist or cannot be accessed: ${zipFilePath}`);
      }
    }
  }

  private async extractZip(zipFilePath: string): Promise<void> {
    // Use a zip extraction method compatible with your environment
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipFilePath);

    console.log(`Extracting zip file: ${zipFilePath}`);
    return new Promise((resolve, reject) => {
      try {
        zip.extractAllTo(this.binDir, true);

        // Make the executable file runnable on non-Windows platforms
        if (platform() !== 'windows') {
          fs.chmodSync(this.coreFilePath, 0o755);
        }

        console.log(`Extracted zip file: ${zipFilePath}`);
        resolve();
      } catch (error) {
        console.log(`Extraction failed: ${error}`);
        reject(error);
      }
    });
  }

  private async writeVersionAndConf(version: string): Promise<void> {
    const versionFilePath = path.join(this.binDir, 'version.txt');
    await fs.promises.writeFile(versionFilePath, version);

    const confFilePath = path.join(this.binDir, 'config.yaml');
    await fs.promises.writeFile(confFilePath, haystackConfig(this.context));
  }

  private async checkIsCompatibleVersion(): Promise<void> {
    try {
      const version = await fs.promises.readFile(path.join(this.binDir, 'version.txt'), 'utf8');
      if (this.isVersionCompatible(version)) {
        return
      }
      fs.promises.unlink(this.coreFilePath);
      this.installStatus = 'not-installed';
      console.log("The installed Haystack is not compatible.");
      return
    } catch (error) {
    }

    // shutdown the Haystack server and try to unlink the core file again
    await this.shutdown();

    try {
      fs.promises.unlink(this.coreFilePath);
      this.installStatus = 'not-installed';
    } catch (error) {
      console.error(`Failed to unlink Haystack core file: ${error}`);
    }
  }

  private async shutdown(): Promise<void> {
    try {
      const url = `${this.getUrl()}/api/v1/server/stop`;
      console.log("Shutting down Haystack server...");
      await axios.post(url);
      await this.waitingForShutdown();
      this.status = 'initializing';
      console.log("Haystack server stopped for upgrade.");
    } catch (error) {}
  }

  private async waitingForShutdown(): Promise<void> {
    const start = Date.now();
    try {
      for (;;) {
        const elapsedSeconds = (Date.now() - start) / 1000;
        if (elapsedSeconds > 20) {
          console.log("Haystack server shutdown timeout.");
          return
        }

        const url = `${this.getUrl()}/api/v1/server/status`;
        const response = await axios.get(url);
        if (response.status !== 200) {
          return
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
    }
  }

  private async start(): Promise<void> {
    // Check if Haystack is running
    if (await this.isRunning()) {
      console.log("Haystack is already running.");
      this.status = 'running';
      return;
    }

    this._startRetry += 1;
    if (this._startRetry > 10) {
      this._startRetry = 0;
      console.error("Haystack server start failed.");
      this.status = 'error';
      return;
    }

    await this.startServer()
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (await this.isRunning()) {
      this.status = 'running';
      console.log("Haystack server started.");
      return;
    }

    setTimeout(()=>this.start(), 3000);
  }

  private async isRunning(): Promise<boolean> {
      // Check if Haystack is running
      try {
        const url = `${this.getUrl()}/health`;
        const response = await axios.get(url);
        if (response.status === 200) {
          return true;
        }
      } catch (error) {}

      return false;
  }

 private async startServer(): Promise<boolean> {
    // run this.coreFilePath server start to start the server
    try {
      console.log("Starting Haystack server...");
      const command = `${this.coreFilePath} server start`;
      const result = exec(command);
      console.log("Haystack start success: ", result.stdout?.toString() ?? "", result.stderr?.toString() ?? "");
      return true
    } catch (error) {
      console.error(`Failed to start Haystack: ${error}`);
    }

    return false;
  }

  private isVersionCompatible(version: string): boolean {
    // Remove 'v' prefix if exists
    const currentVersion = version.replace('v', '');
    const requiredVersion = this.haystackVersion.replace('v', '');

    const currentParts = currentVersion.split('.').map(Number);
    const requiredParts = requiredVersion.split('.').map(Number);

    // Compare major, minor, and patch versions
    for (let i = 0; i < 3; i++) {
      if (currentParts[i] > requiredParts[i]) {
        return true;
      }
      if (currentParts[i] < requiredParts[i]) {
        return false;
      }
    }
    return true; // Versions are equal
  }

  /**
   * Subscribe to Haystack events.
   * @param event The event type to subscribe to
   * @param listener The callback function to be called when the event is emitted
   * @returns The Haystack instance for chaining
   */
  public on(event: HaystackEvent, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  /**
   * Subscribe to Haystack events for one-time execution.
   * @param event The event type to subscribe to
   * @param listener The callback function to be called when the event is emitted
   * @returns The Haystack instance for chaining
   */
  public once(event: HaystackEvent, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  /**
   * Unsubscribe from Haystack events.
   * @param event The event type to unsubscribe from
   * @param listener The callback function to be removed
   * @returns The Haystack instance for chaining
   */
  public off(event: HaystackEvent, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  /**
   * Remove all listeners for an event, or all events.
   * @param event Optional. The event to remove listeners for. If not provided, all listeners are removed.
   * @returns The Haystack instance for chaining
   */
  public removeAllListeners(event?: HaystackEvent): this {
    return super.removeAllListeners(event);
  }

}
