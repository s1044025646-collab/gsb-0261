# 拼音声调标记转换与音节诊断后端

基于 TypeScript + Node.js + SQLite 的本地后端，提供 HTTP API 与 CLI。
只做**已分词拼音**的声调表示转换与诊断：不汉字转拼音、不自动分词、不判断多音字、不做输入法或词典纠错。

## 功能范围

- 输入：以空白（空格等）分隔的拼音音节，逐个处理。
- 两种写法互转：
  - **数字写法**：音节末尾跟声调数字 `1`-`4`，轻声统一为 `5`（如 `hao3`、`ma5`）。
  - **调号写法**：元音上带调号（如 `hǎo`、`ma`）。
- 每个音节返回：基础字母、声调（1-5）、调号承载字母及其位置、两种规范输出。
- 无调号的音节一律视为轻声（5）。
- SQLite 持久化每次请求的原始输入、参数与逐项结果，服务重启后历史仍在。

## 调号落点规则

按经典规则自行实现（未使用任何现成拼音库）：

1. 有 `a` 标 `a`（`hao3` → `hǎo`）；
2. 无 `a` 标 `e`（`ke4` → `kè`）；
3. `ou` 标在 `o` 上（`shou1` → `shōu`）；
4. 其余标**最后一个元音**（`liu2` → `liú`，`gui4` → `guì`）。

输入中调号标错元音（如 `haó`）时按上述规则归一化（→ `háo`）。

## ü 的口径

- 数字写法中 `ü` 可用 `v`、`u:` 或 `ü` 输入（`nv3` / `nu:3` / `nǚ` 等价）。
- 规范输出固定为：调号写法用 `ü`（`nǚ`），数字写法用 `v`（`nv3`）。
- `ü` 的两点是字母本身的一部分，不会被当作声调。

## 大小写约定

逐字母保留输入大小写：`Hao3` → `Hǎo`，`HAO3` → `HǍO`，`NV3` → `NǙ`。

## Unicode 处理

输入先做 NFC 归一化；预组合字符（`ǎ`）与"字母 + 组合调号"（`a` + U+030C）得到完全相同的规范结果。组合调号支持 U+0304（一声）、U+0301（二声）、U+030C（三声）、U+0300（四声）。

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `EMPTY_INPUT` | 输入为空或没有任何音节 |
| `INVALID_CHAR` | 非法字符（仅允许 a-z、ü、v、u:、声调数字、调号） |
| `MISSING_VOWEL` | 音节缺少元音（a/e/i/o/u/ü），如单独成音节的 m/n 不在范围内 |
| `MULTIPLE_TONES` | 一个音节出现多个声调（多个数字或多个调号） |
| `TONE_CONFLICT` | 数字声调与字母调号同时出现，互相冲突 |
| `TONE_OUT_OF_RANGE` | 声调数字越界（仅允许 1-5） |
| `TONE_DIGIT_POSITION` | 声调数字不在音节末尾 |

范围限定常见含 a/e/i/o/u/ü 的音节，不做完整汉语音系合法性审查；不在范围内的结构按上表明确报错并定位（`position` 为音节内字符偏移）。

## 运行要求

- Windows 本地，Node.js ≥ 22.5（使用内置 `node:sqlite`，无需原生编译、Docker、WSL 或任何在线服务）。
- 安装依赖：`npm install`（仅开发依赖 typescript / @types/node）。

## 常用命令

```bat
npm run build        :: 编译 TypeScript 到 dist/
npm test             :: 构建并运行全部测试
npm start            :: 启动 HTTP 服务（默认自动选择空闲端口）
node dist\cli.js serve --port=8080   :: 指定端口启动
npm run demo         :: 运行内置演示（hao3/liu2/gui4/nv3/lüe4/ma5 等）
node smoke-api.cjs   :: API 冒烟测试
```

端口配置：优先级 `--port=N` > 环境变量 `PORT` > 自动选择空闲端口（0）。
数据目录：项目内 `data/pinyin.db`，可用环境变量 `PINYIN_DB` 覆盖。

## CLI 用法

```bat
node dist\cli.js convert --to mark "hao3 liu2 gui4 nv3 lüe4 ma5"
node dist\cli.js convert --to number "hǎo liú guì nǚ lüè ma"
node dist\cli.js check "hao3 hǎo3"
node dist\cli.js diagnose "hao3 hao6 ma"
node dist\cli.js history 20
node dist\cli.js export csv
node dist\cli.js demo
```

批量诊断保留输入原有次序，并列出失败音节的序号。

## HTTP API

所有请求/响应均为 JSON（UTF-8）。

- `POST /api/convert` 体：`{"input": "hao3 ma5", "direction": "to-mark" | "to-number"}`
  成功返回 200 与 `output`；存在非法音节返回 422 与逐项 `syllables`。
- `POST /api/check` 体：`{"input": "..."}` 规范写法检查，返回 `normalized` 与逐项报告。
- `POST /api/diagnose` 体：`{"input": "..."}` 批量诊断，返回 `total`、`failed`（失败序号数组）与逐项报告，始终 200。
- `GET /api/history?limit=50` 历史列表（新→旧）。
- `GET /api/history/:id` 单条历史（含完整结果 JSON）。
- `GET /api/export?format=json|csv` 导出全部历史。
- `GET /api/health` 健康检查。

示例：

```bat
curl -X POST http://localhost:8080/api/convert -H "Content-Type: application/json" -d "{\"input\":\"hao3 liu2\",\"direction\":\"to-mark\"}"
```

## 项目结构

```
src/pinyin.ts   核心：音节解析、调号落点、双向转换、诊断
src/store.ts    SQLite 历史存储（node:sqlite）
src/server.ts   HTTP API
src/cli.ts      命令行入口与演示
test/           node:test 测试（固定预期 + 双向往返 + 错误码 + 存储）
data/           运行时生成的 SQLite 数据目录
```

## 明确不做的事

- 不把汉字转拼音，不推断汉字发音。
- 不自动分词、不判断多音字、不做输入法或词典纠错。
- 不处理单独成音节的 m/n 及罕见特殊元音，不做完整汉语音系审查。
