const TTS_PREFIX = 'zhishi-tts-';

function getFileSystem(): WechatMiniprogram.FileSystemManager {
  return wx.getFileSystemManager();
}

function cleanupOldAudio(): void {
  try {
    const files = getFileSystem().readdirSync(wx.env.USER_DATA_PATH) as string[];
    const now = Date.now();
    for (const name of files) {
      if (!name.startsWith(TTS_PREFIX)) continue;
      const match = name.match(/^zhishi-tts-(\d+)\.mp3$/);
      if (!match) continue;
      if (now - Number(match[1]) > 60 * 60 * 1000) {
        try {
          getFileSystem().unlinkSync(`${wx.env.USER_DATA_PATH}/${name}`);
        } catch {
          // 清理失败不影响播放。
        }
      }
    }
  } catch {
    // 某些基础库对 readdir 支持不同，忽略清理失败。
  }
}

export function writeSpeechAudio(base64: string): string {
  cleanupOldAudio();
  const path = `${wx.env.USER_DATA_PATH}/${TTS_PREFIX}${Date.now()}.mp3`;
  getFileSystem().writeFileSync(path, base64, 'base64');
  return path;
}

export function clearSpeechAudio(): void {
  try {
    const files = getFileSystem().readdirSync(wx.env.USER_DATA_PATH) as string[];
    for (const name of files) {
      if (!name.startsWith(TTS_PREFIX)) continue;
      try {
        getFileSystem().unlinkSync(`${wx.env.USER_DATA_PATH}/${name}`);
      } catch {
        // 单个文件清理失败不影响其它清理。
      }
    }
  } catch {
    // ignore
  }
}
