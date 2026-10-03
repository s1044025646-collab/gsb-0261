# 拼音声调标记转换与音节诊断后端

纯本地运行的 TypeScript + Node.js + SQLite 后端，提供 **HTTP API 与 CLI** 两种使用方式。
只处理**已经分好词的拼音**（以空格分隔的音节），在「末尾数字声调」与「元音附调号」两种写法之间互转，并提供逐音节诊断、批量诊断、历史记录与导出。

> 范围声明：本服务**不**做汉字转拼音、不自动分词、不判断多音字、不提供输入法或词典纠错，
> 也不承担完整汉语音系合法性审查（不处理单独成音节的 m/n 及罕见特殊元音）。

## 环境要求

- Windows 本地运行，无需 Docker / WSL / 外部在线 API
- Node.js **>= 22.5**（使用内置 `node:sqlite`，零原生依赖；开发环境验证于 Node 25）
- 仅两个开发依赖：`typescript`、`@types/node`

## 快速开始

```powershell
npm install        # 安装开发依赖
npm run build      # 编译 TypeScript 到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API 服务（默认自动选择空闲端口）
npm run demo       # 运行内置演示
```

数据保存在项目内 `data/pinyin.db`（可用环境变量 `PINYIN_DATA_DIR` 覆盖），服务重启后历史记录仍可读取。

## 输入约定

- **分隔方式**：音节之间用一个或多个空格分隔；空输入报错 `EMPTY_INPUT`。
- **数字声调**：`1`-`4` 表示一至四声，`5` 表示轻声，必须且只能有一个、位于音节末尾（如 `hao3`、`ma5`）。
- **附调号**：预组合字符（如 `ǎ`）与「字母 + 组合调号」（如 `a` + U+030C）经 NFC 归一化后**结果完全相同**。
- **ü 的输入**：数字写法中可写 `v`、`u:` 或 `ü`（`nv3` / `nu:3` / `nü3` 等价）。
- **ü 的输出口径（固定规范形式）**：数字形式一律输出 `v`（`nv3`、`lve4`），附调号形式一律输出 `ü`（`nǚ`、`lüè`）。
- **轻声**：无调号、无数字的音节视为轻声（5）；轻声输出为不带调号的形式（`ma` / `ma5`）。
- **大小写约定**：全大写输入 → 全大写输出（`HAO3` → `HǍO`）；首字母大写 → 输出首字母大写（`Hao3` → `Hǎo`）；其余一律小写。

## 调号落点规则

1. 有 `a` 先标 `a`（`hao3` → `hǎo`）
2. 无 `a` 标 `e`（`lüe4` → `lüè`）
3. `ou` 标在 `o` 上（`kou1` → `kōu`）
4. 其余标**最后一个元音**（`liu2` → `liú`，`gui4` → `guì`）

调号落在错误元音上的输入（如 `haò`）会被拒绝并定位：`WRONG_TONE_POSITION`。

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `EMPTY_INPUT` | 输入为空 |
| `INVALID_CHAR` | 非法字符，或数字不在音节末尾 |
| `MISSING_VOWEL` | 缺少可标调元音（含单独成音节的 m/n） |
| `MULTIPLE_TONES` | 一个音节含多个调号或多个声调数字 |
| `TONE_CONFLICT` | 数字声调与字母调号同时出现 |
| `TONE_OUT_OF_RANGE` | 声调数字越界（仅允许 1-5） |
| `WRONG_TONE_POSITION` | 调号落点不符合规则 |

## HTTP API

```powershell
npm start                      # 默认端口 0（自动选空闲端口）
node dist/src/cli.js serve --port 8080
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/convert` | `{ "input": "hao3 ma5", "direction": "number-to-mark" }`，反向为 `mark-to-number` |
| POST | `/api/check` | `{ "input": "hǎo" }`，规范写法检查与逐音节诊断 |
| POST | `/api/diagnose` | `{ "items": ["liu2", "hǎo3"] }`，批量诊断，保留输入次序，`failed` 列出失败下标 |
| GET | `/api/history?limit=50` | 历史记录（含逐项结果） |
| GET | `/api/history/:id` | 单条历史记录 |
| GET | `/api/export?format=json` 或 `format=csv` | 导出历史 |

每个成功音节返回：`base`（基础字母）、`tone`（1-5）、`toneCarrier`（调号承载字母）、
`carrierIndex`（承载字母下标）、`numbered` / `marked`（两种规范写法）。

## CLI

```powershell
node dist/src/cli.js convert --to mark "hao3 liu2 gui4 nv3 lüe4 ma5"
node dist/src/cli.js convert --to number "hǎo liú"
node dist/src/cli.js check "hǎo ma"
node dist/src/cli.js diagnose "liu2" "hǎo3" "gui4"
node dist/src/cli.js history 20
node dist/src/cli.js export --format csv
node dist/src/cli.js serve --port 8080
node dist/src/cli.js demo
```

## 演示输出（`npm run demo`）

```
hao3 -> hǎo   调号落在 'a'
liu2 -> liú   调号落在 'u'
gui4 -> guì   调号落在 'i'
nv3  -> nǚ    调号落在 'ü'
lüe4 -> lüè   调号落在 'e'
ma5  -> ma    轻声
预组合 hǎo 与组合形式 a+U+030C 输出完全一致
```

## 项目结构

```
src/pinyin.ts   核心：解析、调号落点、双向转换、错误定位
src/store.ts    SQLite 持久化（node:sqlite）
src/server.ts   HTTP API
src/cli.ts      命令行入口
src/demo.ts     演示脚本
test/           node:test 测试（固定预期 + 双向往返）
data/           运行时生成的 SQLite 数据目录
```

## 已知限制

- 仅覆盖含 `a e i o u ü` 的常见音节结构；不支持 `m`/`n` 等单独成音节及罕见特殊元音。
- 不校验声母/韵母组合是否真实存在（如 `jua1` 不会被拒绝），只做结构层面的诊断。
- `node:sqlite` 在 Node 25 仍为实验特性，启动时会打印 ExperimentalWarning，不影响功能。
