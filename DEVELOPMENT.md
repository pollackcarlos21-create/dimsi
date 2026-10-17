# 开发指南

## 1. 环境要求

- Node.js ≥ 20（本项目在 Node 24.14.0 上完成类型检查和测试）
- npm ≥ 10
- 微信开发者工具（本机当前未安装）
- 可选：CloudBase 环境、DeepSeek API Key、腾讯云 TTS 凭据

无需 Python；只有在重新生成 Tab 图标时才需要 Python + Pillow。

## 2. 本地安装与校验

```bash
cd /Users/chadrayfoo/Projects/family-nutrition-assistant
npm install
npm run check
```

命令说明：

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 小程序与云函数 TypeScript 检查 |
| `npm test` | Vitest 自动化测试 |
| `npm run build:cloud` | 用 esbuild 打包 `cloudfunctions/api/src/index.ts` |
| `npm run check` | 上述全部 |
| `npm run icons` | 重新生成 TabBar PNG 图标（需要 Pillow） |

当前基线：

```text
TypeScript: 通过
Vitest: 10 个文件 / 82 个用例通过
Cloud build: 通过
```

## 3. 在微信开发者工具中运行（本地演示）

1. 安装微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择本仓库根目录（不是 `miniprogram/` 子目录）。
4. AppID 可使用测试号或 `touristappid`。
5. 打开“详情 → 本地设置”，确认：
   - 使用 TypeScript 编译插件；
   - 增强编译开启；
   - 基础库版本不要低于项目设定的 `3.7.12`（如不可用，选择当前稳定版）。
6. 编译。

`miniprogram/config.ts` 的默认配置：

```ts
export const CLOUD_ENV_ID = '';
```

此时应用使用 `LocalMockApi`：

- 不需要 CloudBase；
- 不需要任何 API Key；
- 拍照仍会调用微信相机/相册，但分析结果是固定演示数据；
- 结果、列表、聊天、设置均可用；
- 所有演示结果显式标为“演示模式/演示数据”；
- TTS 不伪造音频，点击朗读会显示不可用说明。

### 演示模式重置

设置页 →“清空我的全部数据”，或在开发者工具中清除缓存。

## 4. 切换到云端模式

1. 完成 [DEPLOYMENT.md](DEPLOYMENT.md) 中的 CloudBase、云函数和安全规则配置。
2. 修改 `miniprogram/config.ts`：

```ts
export const CLOUD_ENV_ID = '你的-cloudbase-环境-id';
```

3. 修改 `project.config.json` 的 `appid` 为正式小程序 AppID。
4. 重新编译。
5. 进入设置页，展开“运行与性能诊断”，确认：
   - 运行模式为“CloudBase 云端”；
   - AI 服务状态符合云函数配置；
   - 语音服务状态符合 TTS 配置。

重要：模式不会静默降级。配置了环境 ID 但云函数不可用时，页面会显示真实错误，而不是偷偷返回演示数据。

## 5. 目录与代码约定

```text
miniprogram/
  pages/            页面四件套：.ts/.wxml/.wxss/.json
  components/       组件四件套
  services/         仅在此处发起 API 调用
  types/            共享契约和全局类型
  utils/            无状态工具
cloudfunctions/api/
  src/index.ts      云函数入口，只负责装配依赖
  src/router.ts     action 路由与错误映射
  src/domain/       纯业务规则，尽量无 CloudBase 依赖
  src/providers/    外部服务适配
  src/repositories/ CloudBase 适配
  src/handlers/     用例编排
tests/              Vitest
```

约定：

- 页面不直接调用 `wx.cloud.callFunction`；统一走 `services/api.ts`。
- 页面不自行计算营养；营养规则在服务端 `domain/nutrition.ts`。
- 模型输出的任何字段都不可信，必须先经过 `recognition.ts` 的 Zod 校验。
- 新增云函数 action 时必须同时更新：
  - `router.ts` 白名单；
  - `domain/schemas.ts` 输入校验；
  - `miniprogram/types/contracts.ts`；
  - 客户端 `NutritionApi`；
  - 测试。
- 演示输出必须保留 `source: 'mock'`，UI 必须显示演示标记。
- 不在日志、错误消息或测试快照里写入密钥、照片 base64、完整聊天内容。
- 所有时间戳用 ISO 8601；餐次“当天”按中国时区计算。
- 不引入不必要的 UI 框架或跨端框架。

## 6. 添加或修正食物数据

文件：`cloudfunctions/api/src/data/food-database.json`

新增条目时：

1. 提供唯一 `id`、标准名称、别名、类别、默认份量。
2. 每 100g 热量/蛋白质/脂肪用 `[下界, 上界]`，下界不得大于上界。
3. 油/盐风险仅使用 `low/medium/high/unknown`。
4. 记录来源或说明；不得从商业数据库批量复制。
5. 运行 `npm test`；`foodDatabase.test.ts` 会检查基本完整性。

注意：不要把模型输出中的营养数值写入数据库计算。营养区间必须来自经过整理的食物成分条目。

## 7. 云函数构建与部署

```bash
npm run build:cloud
```

产物：`cloudfunctions/api/index.js`（已 gitignore，但本地会存在）。

开发时云函数源文件是 TypeScript；CloudBase 部署的是打包后的 JS。`wx-server-sdk` 被保留为外部依赖，由云函数目录的 `package.json` 在云端安装：

```bash
cd cloudfunctions/api
npm install --omit=dev
```

不要在云函数 bundle 中打包 `wx-server-sdk`。`cloudfunctions/api/package-lock.json` 应随云函数目录一起部署，便于云端复现依赖版本。

## 8. 常见问题

### TypeScript 编译报找不到 `wx`

确认 `npm install` 已安装 `miniprogram-api-typings`，并使用根目录 `tsconfig.json`。开发者工具需要启用 TypeScript 插件。

### 页面显示“云服务尚未就绪”

- 检查 `CLOUD_ENV_ID` 是否填写；
- 检查 `app.js` 启动时 `wx.cloud.init` 是否成功；
- 检查 AppID 是否与 CloudBase 环境匹配；
- 检查云函数是否已部署。

### 上传失败

- 检查云存储权限与云函数权限；
- 检查照片大小是否超过 5MB；
- 确认客户端只上传 JPG/PNG；
- 在生产环境先按部署文档配置存储规则。

### DeepSeek 报 401/403

- 检查云函数环境变量是否生效；
- 检查 Key 是否具备 `deepseek-flash` 权限；
- 检查 Base URL 是否为 `https://api.deepseek.com`；
- 不要在浏览器或小程序端测试 Key。

### 语音不可用

- 检查 `TENCENTCLOUD_SECRET_ID/KEY`；
- 确认腾讯云账号已开通语音合成；
- 检查 CAM 权限、地域和音色 ID；
- 文字建议不依赖 TTS，仍应正常显示。

### 拍照/相册没有反应或提示隐私未授权

- 在微信公众平台配置《小程序用户隐私保护指引》，声明摄像头和选中的照片信息；
- 首次拍照时，知食会调用 `wx.getPrivacySetting` 检查状态，并显示自定义隐私说明；
- 用户同意后才能进入 `wx.chooseMedia`；
- 若提示 `errno 112`，通常是后台隐私指引未声明或尚未生效；
- 具体接口以微信官方文档为准。

### 演示数据出现在真实模式

不会静默混合。若结果标记 `source=mock`，表示服务端显式处于演示模式：

- `AI_MOCK_MODE=true`；或
- 云函数没有配置 DeepSeek Key。

检查云函数环境变量并重新部署/重启实例。

## 9. 本地数据与隐私

- 小程序本地只保存：待分析照片临时路径、语速偏好、演示数据、耗时诊断。
- 云端真实数据仅通过云函数访问。
- 分析成功后客户端删除本地临时照片，服务端删除云端原图。
- 清除数据会尝试删除本地上传记录引用的云端文件。

## 10. 开发限制

- 当前开发机没有微信开发者工具，因此无法在本次任务中执行模拟器/真机截图或 UI 自动化。
- 当前没有 CloudBase 环境、TTS 凭据，也没有对 DeepSeek 进行付费测试调用。
- 因此只能用类型检查、单元/集成测试和构建验证代码；真实联调需按部署文档完成。
