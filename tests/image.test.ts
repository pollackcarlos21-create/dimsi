import { describe, expect, it } from 'vitest';
import { inspectImage } from '../cloudfunctions/api/src/lib/image';
import { AppError } from '../cloudfunctions/api/src/lib/errors';
import { jpegFixture, pngFixture } from './fixtures';

describe('图片安全校验', () => {
  it('能读取 PNG 尺寸', () => {
    const result = inspectImage(pngFixture(500, 400), 'image/png', 5 * 1024 * 1024);
    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(500);
    expect(result.height).toBe(400);
  });

  it('能读取 JPEG 尺寸', () => {
    const result = inspectImage(jpegFixture(640, 480), 'image/jpeg', 5 * 1024 * 1024);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });

  it('声明格式与真实格式不一致时拒绝', () => {
    expect(() => inspectImage(pngFixture(), 'image/jpeg', 5 * 1024 * 1024)).toThrowError(
      AppError,
    );
  });

  it('拒绝非图片或伪装文件', () => {
    const buffer = Buffer.alloc(1024, 0x41);
    try {
      inspectImage(buffer, 'image/jpeg', 5 * 1024 * 1024);
      throw new Error('should_not_reach');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_IMAGE');
    }
  });

  it('拒绝过小图片和超大文件', () => {
    expect(() =>
      inspectImage(pngFixture(50, 50, 800), 'image/png', 5 * 1024 * 1024),
    ).toThrowError(AppError);
    expect(() =>
      inspectImage(pngFixture(400, 300, 2048), 'image/png', 1024),
    ).toThrowError(AppError);
  });
});
