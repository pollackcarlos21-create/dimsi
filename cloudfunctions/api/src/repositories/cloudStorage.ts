import type { StorageProvider } from '../domain/types';
import { AppError } from '../lib/errors';

/* eslint-disable @typescript-eslint/no-explicit-any */
export class CloudStorageProvider implements StorageProvider {
  constructor(private readonly cloud: any) {}

  async downloadFile(fileID: string): Promise<Buffer> {
    try {
      const result = await this.cloud.downloadFile({ fileID });
      const content = result?.fileContent;
      if (Buffer.isBuffer(content)) return content;
      if (content instanceof Uint8Array) return Buffer.from(content);
      throw new Error('cloud_download_missing_content');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|not exist|does not exist|no such file/i.test(message)) {
        throw new AppError('UPLOAD_NOT_FOUND', { retryable: false });
      }
      throw error;
    }
  }

  async deleteFile(fileID: string): Promise<void> {
    try {
      await this.cloud.deleteFile({ fileList: [fileID] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|not exist|does not exist/i.test(message)) return;
      throw error;
    }
  }
}
