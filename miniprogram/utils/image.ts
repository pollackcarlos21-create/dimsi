import { appConfig } from '../config';
import { ApiRequestError, UserCancelledError } from './errors';

export interface PreparedImage {
  path: string;
  sizeBytes: number;
  width: number;
  height: number;
  compressed: boolean;
  mimeType: 'image/jpeg' | 'image/png';
  compressionMs: number;
}

type SourceType = 'camera' | 'album';

function chooseMedia(source: SourceType): Promise<WechatMiniprogram.MediaFile> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      camera: 'back',
      success(result) {
        const file = result.tempFiles[0];
        if (!file) {
          reject(new UserCancelledError());
          return;
        }
        resolve(file);
      },
      fail(error) {
        if (/cancel/i.test(error.errMsg || '')) {
          reject(new UserCancelledError());
          return;
        }
        reject(
          new ApiRequestError({
            code: 'INVALID_IMAGE',
            message: /privacy|隐私|112/i.test(error.errMsg || '')
              ? '需要先同意隐私保护指引，才能使用相机或相册。请返回后重试。'
              : /auth|permission|deny/i.test(error.errMsg || '')
                ? '没有获得相机或相册权限，可以到微信设置中开启。'
                : '暂时无法打开相机或相册，请稍后再试。',
            retryable: true,
          }),
        );
      },
    });
  });
}

function compressImage(
  src: string,
  info: { width: number; height: number },
): Promise<string> {
  return new Promise((resolve) => {
    const options: WechatMiniprogram.CompressImageOption = {
      src,
      quality: appConfig.compressQuality,
    };
    if (info.width > 1280 || info.height > 1280) {
      if (info.height > info.width) {
        options.compressedHeight = 1280;
      } else {
        options.compressedWidth = 1280;
      }
    }
    wx.compressImage({
      ...options,
      success(result) {
        resolve(result.tempFilePath);
      },
      fail() {
        // 某些机型不支持压缩参数时，保留 chooseMedia 的压缩结果。
        resolve(src);
      },
    });
  });
}

function getImageInfo(
  src: string,
): Promise<{ width: number; height: number; type: string }> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success(result) {
        resolve({ width: result.width, height: result.height, type: result.type });
      },
      fail() {
        reject(
          new ApiRequestError({
            code: 'INVALID_IMAGE',
            message: '无法读取这张照片，请重新选择。',
            retryable: false,
          }),
        );
      },
    });
  });
}

function getFileSize(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath: path,
      success(result) {
        resolve(result.size);
      },
      fail() {
        reject(
          new ApiRequestError({
            code: 'INVALID_IMAGE',
            message: '无法读取照片大小，请重新选择。',
            retryable: true,
          }),
        );
      },
    });
  });
}

export async function chooseAndPrepareImage(source: SourceType): Promise<PreparedImage> {
  const file = await chooseMedia(source);
  const info = await getImageInfo(file.tempFilePath);
  let path = file.tempFilePath;
  let compressed = false;
  let compressionMs = 0;

  if (
    file.size > appConfig.compressThresholdBytes ||
    info.width > 1440 ||
    info.height > 1440
  ) {
    const compressStarted = Date.now();
    path = await compressImage(path, info);
    compressionMs = Date.now() - compressStarted;
    compressed = path !== file.tempFilePath;
  }

  const [sizeBytes, finalInfo] = await Promise.all([getFileSize(path), getImageInfo(path)]);
  if (sizeBytes > appConfig.maxImageBytes) {
    throw new ApiRequestError({
      code: 'IMAGE_TOO_LARGE',
      message: '这张照片压缩后仍然偏大，请重新拍一张或选择较小的图片。',
      retryable: true,
    });
  }
  if (finalInfo.width < 160 || finalInfo.height < 160) {
    throw new ApiRequestError({
      code: 'INVALID_IMAGE',
      message: '这张照片太小了，请选择更清楚的图片。',
      retryable: true,
    });
  }
  const mimeType = resolveImageMimeType(finalInfo.type, path);
  if (!mimeType) {
    throw new ApiRequestError({
      code: 'INVALID_IMAGE',
      message: '目前支持 JPG 或 PNG 食物照片，请换一张试试。',
      retryable: true,
    });
  }

  return {
    path,
    sizeBytes,
    width: finalInfo.width,
    height: finalInfo.height,
    compressed,
    mimeType,
    compressionMs,
  };
}

function resolveImageMimeType(
  type: string,
  path: string,
): 'image/jpeg' | 'image/png' | null {
  if (type === 'png') return 'image/png';
  if (type === 'jpeg') return 'image/jpeg';
  // 部分 Android 机型对临时文件返回 unknown，按扩展名兜底；服务端仍会校验真实文件头。
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  return null;
}

export async function getLocalFileSize(path: string): Promise<number> {
  return getFileSize(path);
}

export function showPermissionGuidance(): void {
  wx.showModal({
    title: '需要相机或相册权限',
    content: '请在微信的“设置”中允许知食使用相机和照片，然后再回来试试。',
    confirmText: '去设置',
    cancelText: '稍后',
    success(result) {
      if (result.confirm) {
        wx.openSetting({});
      }
    },
  });
}
