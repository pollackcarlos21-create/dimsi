import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');
const exists = (relative: string) => existsSync(path.join(root, relative));

const REQUIRED_PAGES = [
  'pages/home/index',
  'pages/capture/index',
  'pages/result/index',
  'pages/chat/index',
  'pages/meals/index',
  'pages/settings/index',
];

function collectFiles(dir: string, extension: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(root, dir))) {
    const relative = path.join(dir, entry);
    const stats = statSync(path.join(root, relative));
    if (stats.isDirectory()) {
      files.push(...collectFiles(relative, extension));
    } else if (relative.endsWith(extension)) {
      files.push(relative);
    }
  }
  return files;
}

describe('项目结构与 UI 接线', () => {
  it('六个 MVP 页面齐全，且每个页面都有四件套', () => {
    const appConfig = JSON.parse(read('miniprogram/app.json'));
    for (const page of REQUIRED_PAGES) {
      expect(appConfig.pages).toContain(page);
      for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
        expect(exists(`miniprogram/${page}${ext}`), `${page}${ext}`).toBe(true);
      }
    }
  });

  it('TabBar 页面与图标存在', () => {
    const appConfig = JSON.parse(read('miniprogram/app.json'));
    expect(appConfig.tabBar.list).toHaveLength(4);
    for (const item of appConfig.tabBar.list) {
      expect(appConfig.pages).toContain(item.pagePath);
      expect(exists(`miniprogram/${item.iconPath}`), item.iconPath).toBe(true);
      expect(exists(`miniprogram/${item.selectedIconPath}`), item.selectedIconPath).toBe(true);
    }
  });

  it('页面/组件 JSON 中的 usingComponents 均存在', () => {
    const jsonFiles = [
      ...collectFiles('miniprogram/pages', '.json'),
      ...collectFiles('miniprogram/components', '.json'),
    ];
    for (const file of jsonFiles) {
      const config = JSON.parse(read(file));
      for (const componentPath of Object.values(config.usingComponents ?? {})) {
        const resolved = path.join('miniprogram', String(componentPath).replace(/^\//, ''));
        expect(exists(`${resolved}.json`), `${file} -> ${componentPath}`).toBe(true);
        expect(exists(`${resolved}.wxml`), `${file} -> ${componentPath}`).toBe(true);
        expect(exists(`${resolved}.ts`), `${file} -> ${componentPath}`).toBe(true);
      }
    }
  });

  it('WXML 中绑定的事件处理函数都已在同目录 TS 中定义', () => {
    const wxmlFiles = [
      ...collectFiles('miniprogram/pages', '.wxml'),
      ...collectFiles('miniprogram/components', '.wxml'),
    ];
    const eventPattern = /\b(?:bind|catch)(?::?[a-z]+)="([A-Za-z0-9_]+)"/g;
    const failures: string[] = [];

    for (const wxml of wxmlFiles) {
      const ts = wxml.replace(/\.wxml$/, '.ts');
      if (!exists(ts)) continue;
      const script = read(ts);
      const markup = read(wxml);
      for (const match of markup.matchAll(eventPattern)) {
        const handler = match[1];
        const declaration = new RegExp(
          `(?:^|\\n)\\s*(?:async\\s+)?${handler}\\s*\\(`,
          'm',
        );
        if (!declaration.test(script)) {
          failures.push(`${wxml}: ${handler}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('开发者工具配置启用了 TypeScript 与云函数目录', () => {
    const config = JSON.parse(read('project.config.json'));
    expect(config.setting.useCompilerPlugins).toContain('typescript');
    expect(config.miniprogramRoot).toBe('miniprogram/');
    expect(config.cloudfunctionRoot).toBe('cloudfunctions/');
    expect(config.appid).toBeTruthy();
  });

  it('必需文档存在', () => {
    for (const file of [
      'README.md',
      'ARCHITECTURE.md',
      'PRODUCT_REQUIREMENTS.md',
      'DEVELOPMENT.md',
      'DEPLOYMENT.md',
      'TESTING.md',
      'SECURITY.md',
      'AGENTS.md',
      '.env.example',
      'docs/DATA_SOURCES.md',
      'docs/RELEASE_CHECKLIST.md',
    ]) {
      expect(exists(file), file).toBe(true);
    }
  });

  it('小程序端不包含服务端密钥标识', () => {
    const files = collectFiles('miniprogram', '.ts').concat(
      collectFiles('miniprogram', '.json'),
    );
    for (const file of files) {
      const content = read(file);
      expect(content, file).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
      expect(content, file).not.toContain('TENCENTCLOUD_SECRET_KEY');
      expect(content, file).not.toContain('DEEPSEEK_API_KEY');
    }
  });

  it('拍照前存在微信隐私授权检查与同意按钮', () => {
    const captureTs = read('miniprogram/pages/capture/index.ts');
    const captureWxml = read('miniprogram/pages/capture/index.wxml');
    expect(captureTs).toContain('wx.getPrivacySetting');
    expect(captureWxml).toContain('open-type="agreePrivacyAuthorization"');
    expect(captureWxml).toContain('bindagreeprivacyauthorization="onPrivacyAgree"');
  });

  it('云函数入口与构建配置存在', () => {
    expect(exists('cloudfunctions/api/src/index.ts')).toBe(true);
    expect(exists('cloudfunctions/api/package.json')).toBe(true);
    expect(exists('scripts/build-cloud.mjs')).toBe(true);
    expect(exists('cloudfunctions/api/src/data/food-database.json')).toBe(true);
  });
});
