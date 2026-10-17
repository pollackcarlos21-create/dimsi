import { describe, expect, it } from 'vitest';
import { CloudStorageProvider } from '../cloudfunctions/api/src/repositories/cloudStorage';

describe('云存储适配与上传失败', () => {
  it('下载 Buffer 与 Uint8Array，并兼容云存储返回', async () => {
    const buffer = Buffer.from('image-bytes');
    const cloud = {
      downloadFile: async () => ({ fileContent: buffer }),
      deleteFile: async () => ({ fileList: [] }),
    };
    const storage = new CloudStorageProvider(cloud);
    const result = await storage.downloadFile('cloud://env/file.jpg');
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe('image-bytes');

    const uintCloud = {
      downloadFile: async () => ({ fileContent: new Uint8Array([1, 2, 3]) }),
      deleteFile: async () => ({ fileList: [] }),
    };
    const uintResult = await new CloudStorageProvider(uintCloud).downloadFile(
      'cloud://env/file.jpg',
    );
    expect(Array.from(uintResult)).toEqual([1, 2, 3]);
  });

  it('文件不存在时返回 UPLOAD_NOT_FOUND', async () => {
    const cloud = {
      downloadFile: async () => {
        throw new Error('file not found');
      },
      deleteFile: async () => ({ fileList: [] }),
    };
    await expect(
      new CloudStorageProvider(cloud).downloadFile('cloud://env/missing.jpg'),
    ).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND' });
  });

  it('删除一个已不存在的文件视为成功，便于重试和清理', async () => {
    const cloud = {
      downloadFile: async () => ({ fileContent: Buffer.from('x') }),
      deleteFile: async () => {
        throw new Error('file not exist');
      },
    };
    await expect(
      new CloudStorageProvider(cloud).deleteFile('cloud://env/missing.jpg'),
    ).resolves.toBeUndefined();
  });
});
