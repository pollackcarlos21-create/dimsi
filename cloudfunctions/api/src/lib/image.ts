import { AppError } from './errors';

export interface ImageInspection {
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: number;
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((value, index) => bytes[index] === value);
}

function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  const maxOffset = bytes.length - 8;
  while (offset < maxOffset) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      if (segmentLength < 7 || offset + 7 > bytes.length) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const chunkLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8);
  const chunkType = String.fromCharCode(...bytes.slice(12, 16));
  if (chunkLength !== 13 || chunkType !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function inspectImage(
  buffer: Buffer,
  declaredMimeType: string,
  maxBytes: number,
): ImageInspection {
  if (buffer.length === 0) {
    throw new AppError('INVALID_IMAGE', { message: '图片内容为空，请重新选择照片。' });
  }
  if (buffer.length > maxBytes) {
    throw new AppError('IMAGE_TOO_LARGE');
  }
  if (buffer.length < 512) {
    throw new AppError('INVALID_IMAGE', { message: '图片文件太小，可能已损坏。' });
  }

  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let mimeType: 'image/jpeg' | 'image/png';
  let dimensions: { width: number; height: number } | null;

  if (startsWith(bytes, JPEG_MAGIC)) {
    mimeType = 'image/jpeg';
    dimensions = readJpegSize(bytes);
  } else if (startsWith(bytes, PNG_MAGIC)) {
    mimeType = 'image/png';
    dimensions = readPngSize(bytes);
  } else {
    throw new AppError('INVALID_IMAGE', {
      message: '目前支持 JPG 或 PNG 食物照片，请换一张试试。',
    });
  }

  if (declaredMimeType && declaredMimeType !== mimeType) {
    throw new AppError('INVALID_IMAGE', {
      message: '图片格式与文件内容不一致，请重新选择。',
    });
  }
  if (!dimensions) {
    throw new AppError('INVALID_IMAGE', { message: '无法读取图片尺寸，请重新拍一张。' });
  }

  const { width, height } = dimensions;
  if (width < 160 || height < 160) {
    throw new AppError('INVALID_IMAGE', { message: '图片太小了，请选择更清晰的照片。' });
  }
  if (width > 6000 || height > 6000 || width * height > 24_000_000) {
    throw new AppError('INVALID_IMAGE', {
      message: '图片尺寸过大，请选择压缩后的照片。',
    });
  }

  return {
    mimeType,
    width,
    height,
    bytes: buffer.length,
  };
}

export function extensionForMimeType(mimeType: string): 'jpg' | 'png' {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  throw new AppError('INVALID_IMAGE');
}
