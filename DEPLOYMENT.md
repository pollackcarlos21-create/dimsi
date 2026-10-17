# 部署指南

本指南描述如何把本地演示模式切换为真实的微信小程序 + CloudBase + DeepSeek + 腾讯云 TTS。

> 本仓库当前没有真实 CloudBase 环境、TTS 凭据或已授权的 DeepSeek 调用。以下步骤是部署说明，不代表已经验证过真实云资源。任何会产生费用的操作都应由项目所有者确认后执行。

## 1. 前置资源

| 资源 | 用途 | 必需 |
|---|---|---|
| 微信小程序账号与 AppID | 开发者工具、CloudBase、真机 | 云端模式必需 |
| CloudBase 环境 | 云函数、数据库、存储 | 云端模式必需 |
| DeepSeek API Key | 视觉识别与聊天 | 真实 AI 必需；缺失时服务端显式演示模式 |
| 腾讯云 SecretId/SecretKey | 普通话 TTS | 语音体验必需；缺失时文字仍可用 |
| 微信开发者工具 | 编译、部署、真机调试 | 必需 |

建议使用独立的生产小程序、独立 CloudBase 环境和独立腾讯云子账号，不要复用开发或其它项目的凭据。

## 2. 创建 CloudBase 环境

1. 使用正式 AppID 打开微信开发者工具。
2. 打开“云开发/CloudBase”面板，创建环境（建议生产环境独立）。
3. 记录环境 ID，例如 `zhishi-prod-1a2b3c`。
4. 创建以下集合：

```text
uploads
meals
conversations
users
usage_daily
```

5. 配置集合索引（控制台 → 数据库 → 索引）：

| 集合 | 索引字段 | 说明 |
|---|---|---|
| `meals` | `ownerOpenId` 升序、`localDate` 升序、`createdAt` 降序 | 今日列表 |
| `meals` | `ownerOpenId` 升序、`uploadId` 升序 | 分析失败/状态写入失败后的幂等恢复 |
| `uploads` | `ownerOpenId` 升序 | 用户上传查询 |
| `uploads` | `ownerOpenId` 升序、`status` 升序、`expiresAt` 升序 | 活跃上传票据计数 |
| `uploads` | `ownerOpenId` 升序、`_id` 升序 | 清空数据时按 ID 稳定分页 |
| `uploads` | `expiresAt` 升序 | 维护清理 |
| `conversations` | `ownerOpenId` 升序、`updatedAt` 降序 | 取最近会话 |
| `users` | `ownerOpenId` 升序 | 用户资料 |

索引为建议值；若控制台要求唯一索引，请确认 `conversations` / `users` 每个用户只有一条记录的业务约定后再启用。

6. **安全规则**：客户端不直接访问数据库，所有访问都经过云函数。请为上述集合配置“客户端不可读写”，或等价的仅服务端访问规则。具体规则语法以当前 CloudBase 控制台为准。

7. **云存储权限**：
   - 客户端需要调用 `wx.cloud.uploadFile` 上传临时图片；
   - 云函数需要下载、删除和查询临时文件；
   - 建议只允许已登录用户写入/读取自己上传的对象，禁止公开读取和匿名写入；
   - 不向客户端暴露其它用户的 fileID；
   - 具体规则以当前 CloudBase 控制台的能力为准，部署后用两个微信账号验证隔离。

## 3. 构建并部署云函数

```bash
cd /Users/chadrayfoo/Projects/family-nutrition-assistant
npm install
npm run check
npm run build:cloud
```

确认生成：

```text
cloudfunctions/api/index.js
cloudfunctions/api/package.json
cloudfunctions/api/config.json
```

在微信开发者工具中：

1. 展开 `cloudfunctions/api`。
2. 右键 → “上传并部署：云端安装依赖”。
3. 函数名应为 `api`。
4. 在云开发控制台把超时时间设置为 60 秒，内存建议 512 MB。
5. 运行环境选择 Node.js 18/20/22 中当前可用且受支持的 LTS（项目打包目标为 Node 18）。

云函数依赖只有 `wx-server-sdk`；`index.js` 已由 esbuild 打包，`zod` 等已被内联。仓库保留了 `cloudfunctions/api/package-lock.json` 以便云端按锁文件安装依赖。

> 不要只上传 `src/`。CloudBase 运行的是打包后的 `index.js`。

## 4. 配置云函数环境变量

在云函数控制台 → 函数配置 → 环境变量中设置。不要把值写入代码仓库。

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
AI_MOCK_MODE=false

TENCENTCLOUD_SECRET_ID=...
TENCENTCLOUD_SECRET_KEY=...
TTS_REGION=ap-beijing
TTS_VOICE_TYPE=101001
TTS_ENDPOINT=https://tts.tencentcloudapi.com

DAILY_UPLOAD_LIMIT=30
DAILY_ANALYSIS_LIMIT=20
DAILY_CHAT_LIMIT=60
DAILY_TTS_LIMIT=40
AI_TIMEOUT_MS=30000
TTS_TIMEOUT_MS=12000
MAX_IMAGE_BYTES=5242880
DELETE_IMAGE_AFTER_ANALYSIS=true

LOG_HASH_PEPPER=请生成随机值
MAINTENANCE_SECRET=请生成足够长的随机值
```

说明：

- `AI_MOCK_MODE=false` 时，如果缺少 `DEEPSEEK_API_KEY`，服务端仍会进入显式演示模式并在结果中标记；不会伪装成真实 AI。
- 如果已配置 Key 但调用失败，返回错误，不会自动回退到演示结果。
- `LOG_HASH_PEPPER` 用于哈希日志中的用户引用，建议使用 32 字节以上随机值。
- `MAINTENANCE_SECRET` 只用于维护清理接口，不能下发到小程序。
- 修改环境变量后建议重新部署/重启函数实例。

### 腾讯云最小权限

为 TTS 创建独立的 CAM 子账号，仅授权语音合成所需接口（以腾讯云当前策略为准）。不要使用主账号密钥，也不要把 SecretKey 放入小程序或跨项目复用。

## 5. 配置小程序

修改：

```ts
// miniprogram/config.ts
export const CLOUD_ENV_ID = '你的-cloudbase-环境-id';
```

修改：

```json
// project.config.json
"appid": "你的小程序 AppID"
```

然后重新编译。`wx.cloud.init` 会在 `app.js` 启动时执行。

不要提交 `project.private.config.json`，其中可能包含本地环境信息（已在 `.gitignore` 忽略）。

## 6. 部署后验证

### 必须验证

1. 设置页“运行与性能诊断”：
   - 运行模式为 CloudBase 云端；
   - AI 状态与配置一致；
   - 语音状态与配置一致；
   - 不显示任何密钥。
2. 用两张不同照片各分析一次：
   - 结果 `source` 为 `ai`，UI 显示 AI 估算而非演示数据；
   - 食物列表、营养区间、油盐提示、建议均出现；
   - 云存储中原图已被删除；
   - `meals` 文档中不含图片二进制。
3. 用同一上传在失败/重试场景验证幂等与错误提示。
4. 语音：
   - 点击“听一听”后才生成；
   - 播放、暂停、重播、语速切换可用；
   - 故意移除 TTS 凭据后，文字结果仍完整。
5. 隔离：
   - 用微信账号 A 创建餐次；
   - 切换账号 B，确认看不到、不能修改 A 的记录；
   - B 清空数据不影响 A。
6. 配额：
   - 将每日分析上限临时设为 1，验证第二次请求返回配额提示；
   - 验证图片损坏不会消耗 AI 次数。
7. 隐私：
   - 清空全部数据后，数据库集合中当前用户记录消失；
   - 云存储中没有该用户未清理的图片（在维护任务运行后）。

### 建议验证

- 弱网、飞行模式、上传中断、AI 超时。
- 老年人字体大小和点击区域在真机上的体验。
- iOS/Android 上语速与音频焦点。
- 相册 HEIC/大图等格式的转换行为。
- 相机权限拒绝后的恢复路径。

## 7. 图片维护与清理

默认策略：

```text
DELETE_IMAGE_AFTER_ANALYSIS=true
```

分析成功后立即删除原图。分析失败时图片保留，上传票据 15 分钟后过期，供用户重试。

对于未完成分析、或临时关闭了自动删除而遗留的文件，可在云函数控制台使用测试事件调用维护接口：

```json
{
  "action": "cleanupExpired",
  "payload": {
    "secret": "与 MAINTENANCE_SECRET 相同的值",
    "limit": 50
  }
}
```

返回：

```json
{
  "ok": true,
  "data": { "deletedFiles": 0, "deletedRecords": 0, "failed": 0 },
  "requestId": "..."
}
```

注意：

- 这个接口不需要微信 OPENID，但必须提供正确 secret；
- 每次最多处理 100 条；
- 不要从小程序客户端调用；
- 如果使用定时触发器，必须确认触发器能携带 secret 或通过独立安全机制调用；仓库当前没有自动创建触发器；
- 如果关闭 `DELETE_IMAGE_AFTER_ANALYSIS`，必须自行实现并监控清理任务，否则可能违反隐私承诺；同时必须更新小程序中“分析完成后删除原图”的界面文案与隐私指引。
- “清空全部数据”若返回 `complete=false`，表示可见记录已删除，但部分上传文件/记录保留待清理。应检查云存储权限与维护任务，确认最终完成。
- 当前客户端上传不会绕过服务端配额，但恶意用户仍可能直接使用 `wx.cloud.uploadFile` 写存储；必须用云存储安全规则限制路径、登录状态与文件大小。

## 8. 成本构成

所有价格以 DeepSeek、腾讯云、微信/CloudBase 当前官方计费页为准。不要用本文件中的任何数字作为报价。

### DeepSeek

成本 ≈ 请求次数 × (输入 token + 输出 token) × 单价

输入包含：

- 系统 prompt 与图片 token；
- 用户文字；
- 聊天上下文/历史摘要。

输出包含：

- JSON 识别结果或聊天回复。

需要关注：

- 每次分析最多产生 2 次识别请求（JSON 修复重试）；
- 聊天上下文长度；
- 图片尺寸带来的视觉 token；
- 失败与重试。

### 腾讯云 TTS

成本 ≈ 合成字符数 × 单价（按服务商计费口径，可能包含免费额度）

本项目单次朗读最多 220 字，且按需生成；用户反复点重试会增加调用量。

### CloudBase

成本组成：

- 云函数调用次数与资源使用/时长；
- 数据库读写次数；
- 云存储容量、上传/下载流量；
- 日志与监控；
- 短信/其它可选服务（本项目未使用）。

### 其它

- 微信小程序主体认证/备案等合规成本；
- 域名/证书（本项目不依赖自有域名）；
- 监控告警与人工运维。

建议设置：

- DeepSeek 和腾讯云账户预算告警；
- CloudBase 用量告警；
- 每日配额；
- 异常错误率告警。

## 9. 发布合规清单

上线前至少完成：

- [ ] 微信小程序备案（按当前监管与平台要求）
- [ ] 微信隐私保护指引，声明相机、相册、云存储、AI 处理和第三方共享
- [ ] 用户协议与隐私政策
- [ ] AI 生成/合成内容标识与说明
- [ ] 第三方 DeepSeek / 腾讯云 TTS 的数据处理说明
- [ ] 用户删除数据路径验证
- [ ] 不宣称医疗诊断、减重或疾病预防
- [ ] 健康类内容人工抽查
- [ ] 弱网与真机测试
- [ ] 安全审查（密钥、权限、隔离、日志）
- [ ] 生产配额与成本告警
- [ ] 审核材料准备

未完成实际审核前，不得写“已通过微信官方审核”。

## 10. 回滚

- 保留上一版云函数 `index.js` 与小程序代码 tag。
- 云函数在控制台可回滚到上一版本；环境变量变更需同步回滚。
- 小程序通过开发者工具上传新版本，在后台选择回退版本（以微信平台能力为准）。
- 数据模型变更必须向后兼容；`MealRecord.schemaVersion` 当前为 2。

## 11. 部署边界

本仓库不会自行：

- 创建 CloudBase 环境；
- 开通 TTS；
- 调用付费 DeepSeek 接口；
- 发布小程序；
- 推送远端仓库。

这些操作需要项目所有者明确授权。
