import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import util from 'util';

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

type Status = 'unsupported' | 'error' | 'running' | 'stopped';
type InstallStatus = 'checking' | 'downloading' | 'unsupported' | 'error' | 'installed' | 'not-installed';

export class Haystack {
  private coreFilePath: string;
  private binDir: string;
  private status: Status;
  private installStatus: InstallStatus;
  private downloadZipPath: string;
  private builtinZipPath: string;
  private runningPort: number;
  private haystackVersion: string;
  private HAYSTACK_ZIP_FILE_NAME: string;


  constructor(private context: vscode.ExtensionContext, localServer: boolean) {
    // Use globalStorageUri for persistent storage across extension updates
    this.binDir = this.context.globalStorageUri.fsPath;
    this.coreFilePath = path.join(this.binDir, this.getExecutableName());
    this.downloadZipPath = path.join(this.context.globalStorageUri.fsPath, "download");
    this.builtinZipPath = path.join(this.context.extensionPath, "pkgs"); // We may have builtin zip files
    this.status = 'stopped';
    this.installStatus = 'checking';
    this.runningPort = localServer ? LOCAL_PORT : GLOBAL_PORT;
    this.haystackVersion = "v" + context.extension.packageJSON.haystackVersion;
    this.HAYSTACK_ZIP_FILE_NAME = `haystack-${currentPlatform}-${this.haystackVersion}.zip`;
    this.doInit();
  }

  public async post(uri: string, data: any) {
    if (this.status !== 'running') {
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

  public getStatus(): Status {
    return this.status;
  }

  public getInstallStatus(): InstallStatus {
    return this.installStatus;
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

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err: Error) => {
        file.close();
        fs.unlink(destination, () => {});
        reject(err);
      });

      file.on('error', (err: Error) => {
        file.close();
        fs.unlink(destination, () => {});
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
      this.status = 'stopped';
      console.log("Haystack server stopped.");
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
    try {
      const url = `${this.getUrl()}/health`;
      const response = await axios.get(url);
      if (response.status === 200) {
        console.log("Haystack is already running.");
        this.status = 'running';
        return;
      }
    } catch (error) {
      console.error(`Failed to start Haystack: ${error}`);
    }

    const execPromise = util.promisify(exec);

    // run this.coreFilePath server start to start the server
    try {
      console.log("Starting Haystack server...");
      const command = `${this.coreFilePath} server start`;
      const result = exec(command);
      console.log("Haystack start success: ", result.stdout?.toString() ?? "", result.stderr?.toString() ?? "");
      this.status = 'running';
    } catch (error) {
      console.error(`Failed to start Haystack: ${error}`);
    }
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

}
