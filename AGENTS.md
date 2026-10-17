# AGENTS.md

本文件面向后续在此仓库工作的 AI 编码代理与工程师。

## 1. 沟通

- 与用户的所有沟通、进度报告、总结使用简体中文。
- 代码标识符、命令、协议名、外部 API 字段可保留英文。
- 明确区分“已实现”“已自动化测试”“已在真实环境验证”。没有真实调用证据时，不得声称真实 AI、CloudBase、TTS 或审核已通过。

## 2. 项目位置与状态

- 项目根目录：`/Users/chadrayfoo/Projects/family-nutrition-assistant`
- 当前分支：由工作树决定；本地新仓库无远端。
- 当前版本：`0.4.0`
- M001–M004 代码已实现。
- 已通过：TypeScript、82 个 Vitest 用例、云函数 esbuild 打包。
- 未完成：微信开发者工具 UI 验证、真机、CloudBase、真实 DeepSeek、真实腾讯云 TTS、微信审核。
- 本机未安装微信开发者工具。
- 不要创建 CloudBase 环境、开通付费服务、调用付费 API、推送远端或发布小程序，除非用户明确授权。

## 3. 不可破坏的产品与安全不变量

1. **营养数值不由模型直接生成**。
   - 模型只提供食物、份量、做法、油盐风险等级。
   - 最终热量/蛋白质/脂肪必须来自 `domain/foodDatabase.ts` + `domain/nutrition.ts`。
2. **演示数据必须显式标记**。
   - `source: 'mock'` 必须在 UI 中显示“演示数据/演示模式”。
   - 本地演示模式与云端真实模式不得静默互相回退。
3. **密钥只在服务端**。
   - 不把 DeepSeek/TTS 密钥写入 `miniprogram/`、日志、测试快照或文档示例的真实值中。
4. **用户隔离**。
   - 所有数据查询必须带 `ownerOpenId`；不能信任客户端传入的 openid 或 conversationId。
5. **照片最小留存**。
   - 分析成功后按配置删除原图；餐次记录不保存照片。
   - 关闭删除策略时必须同时实现清理与说明，不能只改一个环境变量。
6. **医疗边界**。
   - 不添加诊断、处方、药物、极端节食、减重/治病承诺或精确“运动抵消热量”。
7. **不确定性透明**。
   - 不把估算写成精确测量；盐/油不输出伪造克数。
8. **不虚构实时进度百分比**。

## 4. 常用命令

```bash
npm install
npm run typecheck
npm test
npm run build:cloud
npm run check
```

任何代码改动完成后至少运行：

```bash
npm run typecheck && npm test && npm run build:cloud
```

如修改 WXML 绑定或页面文件，额外运行项目结构检查（若后续添加）。

## 5. 代码地图

```text
miniprogram/
  config.ts                  模式开关与固定参数（CLOUD_ENV_ID 空 = 本地演示）
  pages/                     7 个页面
  components/                6 个组件
  services/api.ts            统一 API 门面
  services/cloudApi.ts       云函数调用/上传/超时
  services/localApi.ts       本地演示实现
  types/contracts.ts         前后端共享契约
cloudfunctions/api/src/
  index.ts                   云函数入口
  router.ts                  action 白名单/错误映射
  domain/                    识别校验、食物库、营养、建议
  providers/                 DeepSeek、TTS、演示 AI
  handlers/                  上传、分析、聊天、语音、资料、维护
  repositories/              CloudBase 数据/存储
tests/                       自动化测试与内存实现
```

## 6. 修改指引

### 新增云函数 action

1. 在 `domain/schemas.ts` 添加 Zod 输入校验。
2. 在 `router.ts` 加入白名单与路由。
3. 在 `miniprogram/types/contracts.ts` 添加请求/响应类型。
4. 更新 `NutritionApi`、`CloudApi`、`LocalMockApi`。
5. 若非通用功能，考虑本地演示是否支持；不支持时明确报错并标记。
6. 添加至少：正常、非法输入、跨用户、失败路径测试。

### 修改模型输出契约

1. 更新 `domain/recognition.ts` 的 Zod schema 和 prompt。
2. 更新 `providers/deepseek.ts` 的测试 fixture。
3. 更新 mock AI 样例。
4. 确保没有引入模型直接营养数值。
5. 更新 ARCHITECTURE.md 的契约说明。

### 修改食物数据

1. 使用区间 `[min,max]`，min ≤ max。
2. 添加唯一 ID 与别名。
3. 运行 `npm test`。
4. 不得批量复制商业数据库。

### 修改 UI

1. 保持设计令牌与既有字号/间距。
2. 新交互必须有明确加载、失败与重试状态。
3. 演示数据保留明确标识。
4. 不在 WXML 中拼接未转义 HTML；WXML 文本绑定默认安全。
5. 检查键盘、安全区、触控尺寸和空状态。

## 7. 测试要求

- 不删除或弱化已有测试来“通过”。
- 不把 mock 输出断言成真实 AI 输出。
- 涉及外部服务的改动必须有 fake fetch / fake provider 测试。
- 涉及用户数据的改动必须有跨用户隔离测试。
- 涉及配额的改动必须验证“失败不消耗”或明确记录消耗策略。
- 当前无真实凭据时，在总结中明确哪些测试没跑。

## 8. 数据与密钥

- `.env*` 除 `.env.example` 外不得提交。
- `project.private.config.json` 不得提交。
- `cloudfunctions/api/index.js` 是构建产物，已忽略；部署前运行 `npm run build:cloud`。
- 不读取或复制用户家目录中的其它密钥文件到本项目。
- 不将真实密钥写入测试 fixture。

## 9. 当前已知风险

- CloudBase 事务与索引尚未真实验证。
- 进程内限流不是全局限流。
- 真实 DeepSeek/TTS 错误码与配额行为未验证。
- 微信开发者工具、真机 UI、权限和音频行为未验证。
- 发布合规、隐私指引与 AI 内容标识未完成。

## 10. 完成定义

一个任务只有在以下条件都满足时才可报告完成：

1. 代码已实现，且没有隐藏的 mock 冒充真实能力。
2. 类型检查通过。
3. 相关自动化测试通过。
4. 云函数构建通过（如涉及服务端）。
5. 文档同步更新。
6. 明确列出未验证的真实环境项、缺失凭据和风险。
