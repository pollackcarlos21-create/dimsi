# 架构设计

## 1. 目标与边界

知食的目标是把“拍一张饭桌照片”变成一段普通家庭能看懂的饮食反馈，同时保证：

1. 营养数值由可审计的数据和计算产生，而不是模型自由生成。
2. DeepSeek、腾讯云 TTS 等密钥只存在于服务端。
3. 无任何凭据时，小程序仍能完整运行本地演示模式，且演示内容有明确标记。
4. 用户数据按微信身份隔离。
5. 分析结果存在不确定性时，优先扩大区间、解释原因，而不是伪造精度。

非目标：疾病诊断、治疗建议、精确营养处方、减重承诺、社交、排行、支付。

## 2. 总体架构

```text
┌────────────────────────── 微信小程序（原生 WXML/WXSS/TS） ──────────────────────────┐
│ 页面：首页 / 拍照 / 结果 / 助手 / 今天 / 设置 / 纠正                               │
│ 组件：餐次卡 / 语音播放器 / 聊天气泡 / 空状态 / 卡片 / 演示标识                    │
│                                                                                     │
│ services/api.ts ──► LocalMockApi（无凭据，完整本地演示）                            │
│                └─► CloudApi ──► wx.cloud.callFunction                              │
└───────────────────────────────────────┬─────────────────────────────────────────────┘
                                        │ 用户身份由 wxContext.OPENID 提供
                                        ▼
┌──────────────────────── 云函数 api（单入口路由，Node.js） ─────────────────────────┐
│ 鉴权 / 输入校验 / 用户隔离 / 每日配额 / 进程内短间隔限流 / 结构化日志               │
│                                                                                     │
│  handlers: prepareUpload, analyzeMeal, getMeal, listMeals, updateMealFoods,         │
│            deleteMeal, getConversation, chat, speakMeal, getProfile,                │
│            updateProfile, deleteAllData, health, cleanupExpired                     │
│                                                                                     │
│  providers: DeepSeekProvider / MockAiProvider / TencentTtsProvider                  │
│  domain:   recognition parser / food database / nutrition / advice                  │
│  repos:    CloudRepository / CloudStorageProvider                                   │
└───────────────┬───────────────────────────┬───────────────────────┬─────────────────┘
                ▼                           ▼                       ▼
        CloudBase          CloudBase Storage              DeepSeek API / 腾讯云 TTS
        Database           （临时照片）                    （服务端 HTTPS，带超时）
```

### 为什么使用单云函数路由

- 所有操作共用一次鉴权、输入校验、配额和日志策略，避免每个函数重复实现。
- 小程序端只有一个云函数名称，部署和回滚更简单。
- 共享领域代码（识别契约、营养计算、食物库）不会在多个函数间漂移。
- 后续拆分时，领域模块可直接迁移，不需要重写规则。

## 3. 模块边界

### 小程序端

| 模块 | 职责 |
|---|---|
| `pages/*` | 页面状态与交互，不直接访问云数据库/存储 |
| `services/CloudApi` | 调用云函数、校验响应信封、映射网络错误 |
| `services/LocalMockApi` | 完整本地演示，所有结果 `source=mock` |
| `components/VoicePlayer` | 懒加载 TTS、本地音频文件、播放控制与语速 |
| `utils/image` | `chooseMedia`、压缩、尺寸/大小校验、权限提示 |
| `utils/performance` | 仅本机保存的分析/TTS 时延诊断，不含照片或对话 |
| `types/contracts.ts` | 前后端共享的静态类型与 Schema 版本 |

`config.ts` 的 `CLOUD_ENV_ID` 是前端唯一的模式开关：

- 空字符串 → `LocalMockApi`，不会静默调用云函数。
- 非空 → `CloudApi`，云服务错误会明确显示，不会静默降级成演示数据。

### 云函数

| 模块 | 职责 |
|---|---|
| `router.ts` | action 白名单、请求 ID、异常映射、日志、响应信封 |
| `handlers/upload.ts` | 生成随机上传票据与云存储路径 |
| `handlers/analysis.ts` | 图片路径校验、下载、图片校验、AI、营养计算、保存、删除原图、纠正重算 |
| `handlers/chat.ts` | 聊天历史、饮食授权、上下文组装、会话持久化 |
| `handlers/speech.ts` | 从已保存餐次生成短摘要，调用 TTS |
| `handlers/profile.ts` | 可选资料、删除全部数据 |
| `handlers/maintenance.ts` | 过期上传清理，使用独立 secret |
| `providers/deepseek.ts` | 多模态识别、文本聊天、超时和一次 JSON 修复 |
| `providers/tencentTts.ts` | TC3-HMAC-SHA256 签名、MP3 合成 |
| `providers/mockAi.ts` | 服务端演示模式，返回固定识别示例 |
| `domain/foodDatabase.ts` | 别名归一化、食物匹配、同类回退 |
| `domain/nutrition.ts` | 区间计算、置信度、油盐提示 |
| `domain/advice.ts` | 规则化、非评判性的餐次建议 |
| `repositories/cloud*` | CloudBase 数据库/存储适配 |

## 4. 安全边界

1. **身份**：云函数从 `cloud.getWXContext().OPENID` 读取身份。客户端不能提交 `openid`。
2. **授权**：每一个餐次、会话、上传、用户资料查询都带 `ownerOpenId` 条件；不依赖客户端传入的 ID 做越权检查。
3. **上传**：
   - 客户端先调用 `prepareUpload` 获取随机票据。
   - 云存储路径为 `meal-images/<sha256(openid) 前 20 位>/<uuid>.<ext>`。
   - 分析时校验 `fileID` 必须以该票据的 `cloudPath` 结尾。
   - 服务端按真实文件头判断 JPEG/PNG，校验声明类型、尺寸、像素数和大小。
4. **密钥**：仅云函数环境变量。客户端源码、日志、错误响应和小程序包中均无 DeepSeek/TTS 密钥。
5. **隐私授权**：拍照页在调用 `wx.chooseMedia` 前读取 `wx.getPrivacySetting`，未授权时显示自定义隐私说明；用户通过 `open-type="agreePrivacyAuthorization"` 同意后才调用相机/相册。上线前仍需在微信后台配置并声明隐私保护指引。
6. **模型输出**：模型输出只作为不可信数据解析，通过 Zod 校验和字段截断；不参与数据库查询拼接，不执行任何指令。
7. **配额**：每日上传票据/分析/聊天/TTS 配额 + 同一实例短间隔限流；上传票据最多 10 个待处理项。
8. **日志**：只记录事件、耗时、错误码、哈希后的用户引用；不记录图片、base64、对话文本、密钥或完整 AI 响应。

## 5. 图片到结果的完整流程

```text
用户拍照/选图
  ↓ 客户端 chooseMedia、压缩到约 1280px 宽、JPG/PNG 校验
prepareUpload
  ↓ 云函数生成 uploadId + cloudPath，写入 uploads（15 分钟有效）
客户端 wx.cloud.uploadFile
  ↓ 返回 fileID
analyzeMeal(uploadId, fileID, mealType)
  ↓ 校验票据归属、过期时间与 fileID 路径
cloud.downloadFile
  ↓ 魔数、真实格式、解析尺寸、最大 5 MB、像素上限
DeepSeek Vision（服务端）
  ↓ 只返回食物/份量/做法/油盐风险等级（JSON）
严格解析 + 最多一次结构修复
  ↓ 食物别名匹配精选成分库
服务端营养计算
  ↓ 份量区间 × 每 100g 区间，向外取整；同类回退
规则化建议 + 油盐提示 + 不确定性说明
  ↓
写入 meals（不含图片）
  ↓
mark upload used
  ↓
按配置立即删除原图（默认）
```

### 模型输出契约（内部）

模型不能输出最终营养数值。识别契约示例：

```json
{
  "meal_name": "青椒肉丝配米饭",
  "foods": [
    {
      "name": "米饭",
      "category": "staple",
      "portion_g": 150,
      "portion_low_g": 120,
      "portion_high_g": 180,
      "confidence": "medium",
      "preparation": "steamed"
    }
  ],
  "oiliness": "medium",
  "saltiness_risk": "medium",
  "observation": "两盘家常菜。"
}
```

服务端对类别/做法做白名单兜底，份量限制在 5–2000g，并把上下限限制在估算值的 0.5–1.5 倍范围内，避免异常宽区间。

### 客户端结果契约

客户端只接收服务端计算好的 `MealRecord`，包含：

- `foods[]`：展示名、命中名、类别、份量区间、置信度、是否同类回退
- `nutrition`：热量/蛋白质/脂肪的 min-max 区间
- `assessment`、`suggestions`、`nextMeal`、`activitySuggestion`
- `oilCaution`、`saltCaution`
- `source`：`ai` 或 `mock`（UI 必须体现）
- `warnings`、`timings`

完整结构见 `miniprogram/types/contracts.ts`。

## 6. 营养计算

对每个识别食物：

```text
分量下界 = 份量区间最小值
分量上界 = 份量区间最大值

热量下界 = 每100g热量下界 × 分量下界 / 100
热量上界 = 每100g热量上界 × 分量上界 / 100
```

蛋白质、脂肪同理。整餐求和后：

- 热量向外取整到 10 kcal；
- 蛋白质、脂肪向外取整到 1 g；
- 不输出伪小数精度。

### 油与盐

- 视觉模型和食物库只提供 `low/medium/high/unknown` 风险等级，不提供油克数或盐克数。
- 不把“烹饪油”简单等同于“总脂肪”，也不在脂肪数值外额外虚构一个油量。
- 提示文案明确说明照片无法测量实际油量/盐含量。
- 油盐提示只是建议入口，不是检测结果。

### 置信度

整体置信度受以下因素影响：

- 单项识别置信度；
- 是否存在同类回退；
- 热量区间宽度相对于中位数的比例。

出现足够多低把握/回退项时，UI 显示更宽的区间和“部分食物把握不大”的说明。

## 7. 食物成分数据

文件：`cloudfunctions/api/src/data/food-database.json`

- 范围：约 58 个常见中餐、主食、早餐、水果、饮品条目；每 100g 可食部的估算区间。
- 每个条目包含中英文内部 ID、别名、类别、默认份量、热量/蛋白质/脂肪区间、油腻和咸味风险。
- 类别回退包括主食、蔬菜、肉、禽、水产、蛋、豆制品、汤、水果、奶、坚果、糕点、饮品、混合菜、其他。
- 来源：中国居民膳食指南（2022）、中国食物成分表常见量级、USDA FoodData Central 交叉核对。
- 许可证：本精选数据集按 CC BY 4.0 提供；不复制商业数据库完整内容。
- 限制：中餐做法差异极大，数值仅供日常参考，不用于医疗、疾病管理或营养处方。

名称匹配：

1. 全角转半角、去空白/标点/括号补充说明。
2. 先精确别名匹配。
3. 再做最长别名包含匹配。
4. 若模型给出明确类别且别名匹配到不同类别，避免误配（例如“鸡蛋汤”不应变成“水煮蛋”）。
5. 未命中则使用同类回退，并降低置信度、返回 `note`。

## 8. 建议生成

建议由确定性规则生成，不让模型决定营养数值或健康结论。规则考虑：

- 是否包含主食、蔬菜、蛋白质来源；
- 蛋白质估算中位数；
- 热量估算中位数；
- 油/盐风险等级；
- 用户主动纠正后的重新计算。

文案原则：先肯定已经做到的部分，再给 1–4 条小建议；不羞辱、不制造焦虑、不把运动作为“抵消食物”的惩罚。

## 9. 数据模型（CloudBase）

所有集合仅由云函数访问，客户端安全规则应拒绝直接读写。

### `uploads`

| 字段 | 说明 |
|---|---|
| `_id` | 上传票据 UUID |
| `ownerOpenId` | 所属用户 |
| `cloudPath` | 预期云存储路径 |
| `declaredMimeType` | 客户端声明类型（服务端仍校验真实文件头） |
| `status` | `pending` / `processing` / `used`；分析开始时原子占用，防止并发重复扣费 |
| `createdAt` / `expiresAt` | 创建与过期（15 分钟） |
| `processingAt` | 处理中占用时间，超过 2 分钟可被安全回收 |
| `usedAt` / `mealId` / `fileID` | 使用后的幂等信息；`fileID` 也会在分析开始前记录，供失败/过期清理 |
| `imageDeletedAt` | 原图已删除时间 |

### `meals`

| 字段 | 说明 |
|---|---|
| `_id` | 餐次 ID |
| `ownerOpenId` | 所属用户 |
| `localDate` | 中国时区 YYYY-MM-DD |
| `createdAt` / `updatedAt` | ISO 时间 |
| `meal` | 完整 `MealRecord`（不含图片） |
| `uploadId` | 可选上传票据 ID |

### `users`

| 字段 | 说明 |
|---|---|
| `_id` | 随机 ID |
| `ownerOpenId` | 所属用户 |
| `profile` | 年龄段、活动水平、目标、口味、过敏、饮食历史授权 |
| `createdAt` / `updatedAt` | ISO 时间 |

### `conversations`

| 字段 | 说明 |
|---|---|
| `_id` | 会话 ID |
| `ownerOpenId` | 所属用户 |
| `messages` | 最多保留 40 条，每条含角色、文本、时间、来源 |
| `createdAt` / `updatedAt` | ISO 时间 |

### `usage_daily`

| 字段 | 说明 |
|---|---|
| `_id` | `<sha256(openid)_20位>_<date>_<bucket>` |
| `date` / `bucket` | 维度 |
| `count` | 已使用次数 |
| `updatedAt` | 更新时间 |

用量文档不保存 openid，只保存哈希文档 ID 与计数。清空用户数据时这些伪匿名成本计数会保留到自然过期，避免用户通过清空数据重置当日配额。

需要索引：

- `meals`: `ownerOpenId + localDate + createdAt`
- `uploads`: `ownerOpenId`、`expiresAt`
- `conversations`: `ownerOpenId + updatedAt`
- `users`: `ownerOpenId`
- `usage_daily`: 主键查询为主

### 小程序本地存储

| Key | 内容 |
|---|---|
| `zhishi.pendingMeal.v1` | 待分析照片临时路径、类型、压缩信息 |
| `zhishi.localSettings.v1` | 仅本机偏好（语速） |
| `zhishi.demoMeals.v1` / `demoProfile` / `demoConversation` | 仅本地演示模式 |
| `zhishi.analysisTimings.v1` / `ttsTimings.v1` | 不含 PII 的耗时诊断 |

## 10. API action 列表

| action | 鉴权 | 说明 |
|---|---|---|
| `health` | 是 | 返回是否配置 AI/TTS，不返回密钥 |
| `prepareUpload` | 是 | 创建上传票据 |
| `confirmUpload` | 是 | 上传后立即登记 fileID，供过期清理；失败时分析接口仍可补登记 |
| `analyzeMeal` | 是 | 原子占用票据、图片分析、营养计算、保存、清理原图 |
| `getMeal` / `listMeals` | 是 | 仅当前用户 |
| `updateMealFoods` | 是 | 用户纠正，服务端重新计算 |
| `deleteMeal` | 是 | 仅当前用户 |
| `getConversation` / `chat` | 是 | 会话按用户隔离 |
| `speakMeal` | 是 | 根据已保存餐次生成短语音 |
| `getProfile` / `updateProfile` | 是 | 可选用户资料 |
| `deleteAllData` | 是 | 删除当前用户所有记录、上传和资料 |
| `cleanupExpired` | 维护 secret | 清理过期上传，不向小程序开放 |

统一响应：

```json
{ "ok": true, "data": {}, "requestId": "uuid" }
```

```json
{
  "ok": false,
  "error": { "code": "RECOGNITION_FAILED", "message": "面向用户的中文说明", "retryable": true },
  "requestId": "uuid"
}
```

## 11. 语音合成

- 腾讯云 `TextToSpeech`，API 版本 `2019-08-23`，`tts.tencentcloudapi.com`。
- TC3-HMAC-SHA256 签名；`primaryLanguage=1`（中文）；默认 voice type `101001`，可通过环境变量更换。
- 只合成服务端根据餐次生成的短摘要（≤220 字），客户端不能提交任意朗读文本，避免滥用。
- 返回 MP3 base64，客户端写入 `wx.env.USER_DATA_PATH` 播放；不把音频长期保存在云存储。
- 播放器懒加载，文字结果先展示；TTS 失败只影响语音区域。
- 粤语扩展：内部接口已支持 `SpeechLanguage = mandarin | cantonese`，配置 `TTS_VOICE_TYPE_CANTONESE` 后即可接入对应音色；未配置时明确返回 `TTS_UNAVAILABLE`。

## 12. 失败与恢复

- AI 超时：返回 `AI_TIMEOUT`，可重试；重试优先复用上传票据，不重复上传。
- AI 输出不合法：最多修复一次；仍失败则 `RECOGNITION_FAILED`。
- 图片损坏/格式不符：`INVALID_IMAGE`，不消耗 AI 次数。
- 上传过期：`UPLOAD_EXPIRED`，要求重新拍照。
- TTS 未配置/失败：文字建议照常可用。
- 云函数未部署/未配置环境：明确显示配置错误，不静默切换成演示数据。
- 服务端演示模式：结果标记 `source=mock`，并追加“不是对这张照片的真实识别”的警告。
- 同一上传票据并发分析：先原子 `pending → processing`，只有一个请求调用 AI；其它请求返回可重试的“分析中”错误。崩溃/超时 2 分钟后可重新占用；若餐次已落库，则通过 `meal.uploadId` 恢复，避免重复餐次。
- 清空数据时若个别原图删除失败，会保留对应上传记录供维护任务重试，并在响应中返回 `complete=false`，客户端明确提示未完全清理。

## 13. 性能设计

- 客户端上传前压缩到约 1280px 宽、质量 72。
- DeepSeek 请求显式关闭 thinking 模式，并设置 `max_tokens`、JSON 模式；识别 prompt 简短且固定，以降低延迟与成本。
- 服务端返回分段耗时：`downloadMs`、`aiMs`、`calculationMs`、`totalMs`。
- 小程序记录拍照总耗时、图片压缩耗时、上传耗时、分析往返、总耗时和 TTS 生成耗时；设置页可查看本机诊断。
- 目标：照片到文字结果常见情况约 5 秒，但这是目标，不是保证；网络与模型延迟会波动。
- 不展示虚假进度百分比，只展示真实阶段。
- 分析结果不等待 TTS，语音按需生成。

## 14. 图片留存与删除

默认 `DELETE_IMAGE_AFTER_ANALYSIS=true`：

1. 分析成功后立即删除云存储原图；
2. `meals` 不保存照片；
3. 上传票据保留 `fileID` 与删除时间，用于幂等重试和审计；
4. 未完成分析的上传票据 15 分钟过期，可通过 `cleanupExpired` 清理。

如果改为保留图片，必须同时实现定时清理、用户说明和生命周期策略；当前默认策略是“最小留存”。

## 15. 技术决策与权衡

| 决策 | 原因 | 代价 |
|---|---|---|
| 单云函数路由 | 统一鉴权/配额/日志，部署简单 | 冷启动集中，后续需拆分热点 |
| 模型只识别食物 | 避免模型编造营养 | 食物库覆盖有限，需要回退 |
| 区间化输出 | 诚实处理份量与做法差异 | 不如单点数字直观 |
| 客户端先上传存储 | 避开云函数请求体限制 | 需要票据和路径校验 |
| TTS 返回 base64 临时文件 | 不在云端长期保存音频 | 响应体较大，适合短摘要 |
| 本地 Mock 独立实现 | 无凭据可运行、绝不冒充真实 | 演示与真实路径需保持契约一致 |
| 单会话按用户保存 | 简单、可清理 | 不支持多会话管理 |

## 16. 验证状态

已实际运行：

- `npm run typecheck`：通过
- `npm test`：10 个测试文件、82 个用例通过
- `npm run build:cloud`：生成约 243 KB 的 `cloudfunctions/api/index.js`

未实际运行：

- 微信开发者工具编译、模拟器与真机 UI
- CloudBase 真实数据库/存储联调
- DeepSeek 真实视觉请求（无已授权测试调用）
- 腾讯云 TTS 真实请求

这些项目需要在具备对应账号、凭据与开发者工具的环境中按 [TESTING.md](TESTING.md) 和 [DEPLOYMENT.md](DEPLOYMENT.md) 验证。
