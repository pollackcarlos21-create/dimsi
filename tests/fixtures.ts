export interface MemoryWx {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
}

export function installMemoryWx(): { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const wx = {
    getStorageSync(key: string) {
      return store.has(key) ? structuredClone(store.get(key)) : '';
    },
    setStorageSync(key: string, value: unknown) {
      store.set(key, structuredClone(value));
    },
    removeStorageSync(key: string) {
      store.delete(key);
    },
  };
  (globalThis as unknown as { wx: MemoryWx }).wx = wx;
  return { store };
}

export function pngFixture(width = 400, height = 300, bytes = 800): Buffer {
  const buffer = Buffer.alloc(bytes, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

export function jpegFixture(width = 400, height = 300, bytes = 800): Buffer {
  const buffer = Buffer.alloc(bytes, 0);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xe0;
  buffer.writeUInt16BE(16, 4);
  buffer[20] = 0xff;
  buffer[21] = 0xc0;
  buffer.writeUInt16BE(17, 22);
  buffer[24] = 8;
  buffer.writeUInt16BE(height, 25);
  buffer.writeUInt16BE(width, 27);
  return buffer;
}

export function sampleRecognition() {
  return {
    mealName: '青椒肉丝配米饭',
    foods: [
      {
        name: '米饭',
        category: 'staple' as const,
        portionG: 150,
        portionLowG: 120,
        portionHighG: 180,
        confidence: 'medium' as const,
        preparation: 'steamed' as const,
      },
      {
        name: '青椒肉丝',
        category: 'mixed' as const,
        portionG: 160,
        portionLowG: 130,
        portionHighG: 190,
        confidence: 'medium' as const,
        preparation: 'stir_fried' as const,
      },
    ],
    oiliness: 'medium' as const,
    saltinessRisk: 'medium' as const,
  };
}
