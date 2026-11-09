[**简体中文**](README.md) | [English](README.en.md)

# Tape Games | Tape 棋牌

**Tape Games** 是一个基于 [Tongzhuo](https://github.com/NFraw/Tongzhuo) 开源工程演进的多人在线棋牌游戏平台，面向 Web/H5、手机浏览器和 Electron 桌面端。项目采用 **TypeScript 单仓库 + 游戏插件架构 + 服务端权威判定 + Socket.IO 实时同步**，逐步扩展斗地主、四人掼蛋及更多棋牌和社交玩法。

> **开发状态：** 本仓库是持续开发中的开源项目，不能将已提交的功能等同于通过端到端验收。简化掼蛋已接入客户端和服务端，但完整四人实机联机、构建及断线验收尚待确认；经典掼蛋完整赛制未实现。三钱包连接入口已接入；钱包签名注册/登录代码正在开发分支中，**仍缺少验签依赖与实际验收，不可上线**；TapeAPI 3.0 仍处于集成设计阶段。

## 主要功能及成熟度

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 多人游戏大厅 | 已有实现 | 创建房间、邀请链接、准备、重连和游戏分发，仍需联机验收 |
| 斗地主 / Landlord | 已有插件 | 三人斗地主，PixiJS 牌面渲染与 CSS 降级 |
| 简化掼蛋 / Guandan Simple | 已接入、待验收 | 四人 2v2、两副 108 张、每人 27 张、出牌/过牌/接风、单局结算、响应式 H5 |
| 经典掼蛋 / Guandan Classic | 规划中 | 红桃逢人配、进贡还贡、抗贡、升级和过 A 尚未实现 |
| 晦明 / Huiming | 已有插件 | 2–4 人策略卡牌玩法 |
| 牛头人 / Nimmt! | 已有插件 | 多人策略卡牌玩法 |
| 账户与个人资料 | 已有实现 | SQLite 用户表、scrypt 密码哈希、HMAC 登录令牌 |
| Binance / OKX / TokenPocket | 连接入口已接入 | EIP-6963 或钱包注入式 EIP-1193 Provider；仅连接，不自动注册 |
| TapeAPI 3.0 | 设计中 | 待接入经过验证的 TapeAPI 3.x SDK 与只读链上数据服务 |
| Web3 钱包签名注册 | 开发中，尚未上线 | 已设计 EIP-4361 随机挑战、服务器验证和账号绑定；需要安装验签依赖并测试 |

## 技术组成

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| H5/Web 客户端 | React 19、TypeScript、Vite 6 | 单页应用、房间大厅、选牌与游戏页面 |
| 图形与动画 | PixiJS 8、GSAP 3、CSS | 现有游戏的 Canvas 渲染、动画及回退界面；简化掼蛋当前采用 React/CSS |
| 实时通信 | Socket.IO 4 | 房间事件、回合操作、状态广播、断线与恢复 |
| 服务器 | Node.js、Express、TypeScript | REST API、认证、房间与游戏插件生命周期 |
| 数据层 | SQLite、better-sqlite3、WAL | 用户、账号信息和积分流水；游戏实时状态以服务端内存为主 |
| 桌面端 | Electron 35 / electron-builder | 桌面打包（Electron 版本以 desktop/package.json 为准） |
| 测试与工程 | Vitest 3、npm workspaces、GitHub Actions | 规则测试、模块编译、前端构建 |
| 钱包连接 | EIP-1193 / EIP-6963 | 币安钱包、OKX Wallet、TokenPocket 的注入式 EVM 钱包发现和连接 |
| 钱包身份（规划） | EIP-4361 (SIWE) | 钱包签名验证、账户注册/绑定，不使用地址直登 |
| Tape 生态（规划） | TapeAPI 3.0 | 可验证的只读 API 调用、身份/回执能力；**目前尚未实际接入** |

## 系统架构

```text
                  Web / Mobile H5            Electron Desktop
                    React + Vite                 Electron
                         |                          |
                         +------ Client Shell ------+
                         |  大厅 / 游戏 UI / 钱包连接 |
                         +-------------+------------+
                                       |
                       HTTP REST / Socket.IO (WSS)
                                       |
                        Node.js + Express Backend
           +---------------------------+--------------------------+
           |                           |                          |
       UserStore/Auth             RoomManager                 PluginLoader
       SQLite / Tokens          房间 / 连接 / 重连            插件注册 / 调度
                                       |
                           GameServerPlugin 接口
                  +--------------------+-------------------+
                  |                    |                   |
              Landlord          Guandan Simple         Other Games
          斗地主规则引擎         四人状态机             晦明 / 牛头人
                  |                    |                   |
                  +--------- 按玩家生成脱敏状态 ------------+
                                       |
                       单独推送 game:stateUpdate

     Wallet (UI 已接入)                    TapeAPI 3.0 (未来)
     Binance / OKX / TP                   Verified Read Adapter
     EIP-6963 / EIP-1193                  无鉴权替代、无自动转账
```

核心流程：玩家通过 REST 登录后使用 Token 建立 Socket.IO 会话；客户端发送 `game:action`；服务端校验身份、房间成员、游戏阶段及动作合法性，调用游戏插件 `handleEvent`，再经 `getClientState` 为每位玩家生成**独立脱敏视图**。客户端不能直接裁决出牌结果，也不能获取其他玩家的私有手牌。现有协议对异常断线设有暂停/超时处理，实际跨设备稳定性仍需验证。

**游戏插件接口**：
- `GameServerPlugin`：`createInitialState`、`handleEvent`、`getClientState`、`checkGameEnd`；支持可选团队判负逻辑。
- `GameClientPlugin`：`GameComponent` 和可选的 PixiJS `renderer`。
- 前端插件由 `client/src/App.tsx` 动态加载；后端插件由 `server/src/index.ts` 注册。

## 目录结构

```text
GuanDan/                         # GitHub 仓库名保留，产品品牌 Tape Games
├── packages/core/
│   ├── shared/                  # 类型、卡牌工具、插件契约
│   ├── server/                  # Express、Socket.IO、UserStore、RoomManager
│   └── client/                  # Socket Hook、Canvas 基础组件
├── games/
│   ├── guandan/                 # 简化掼蛋规则、状态机、H5牌桌和单测
│   ├── landlord/                # 斗地主
│   ├── huiming/                 # 晦明
│   └── nimmt/                   # 牛头人
├── client/
│   └── src/wallet/             # 三钱包 Provider 发现/连接 UI
├── server/                      # Node.js 服务端入口
├── desktop/                     # Electron 应用
├── docs/                        # 架构、掼蛋与 Web3 设计
└── .github/workflows/           # CI 配置
```

## 开发与运行

建议使用 Node.js 24（与仓库 CI 配置一致）及 npm。项目需要先安装依赖：

```bash
git clone https://github.com/kenter1643/GuanDan.git
cd GuanDan
npm ci
npm run dev
```

开发服务端默认监听 **3000** 端口，Vite Web 客户端默认监听 **5173** 端口；本机访问 `http://localhost:5173`。手机在局域网中测试时，需要保证开发服务器可被局域网访问，并检查服务端/代理配置。正式部署必须使用 HTTPS/WSS。

```bash
npm run dev:server               # 单独启动服务端
npm run dev:client               # 单独启动 Web/H5
npm run test                     # 测试及掼蛋 TypeScript 检查
npm -w client run build          # Web 生产构建（TypeScript + Vite）
npm run build                    # 构建 Web 并复制到 server/public
npm run server                   # 启动服务端
```

> **验收门禁**：`npm ci`、`npm run test`、`npm -w client run build` 必须实际通过；还须四个独立用户完成建房、出牌、结算、断线重连及 iOS/Android 实机验证。仓库已有 CI 工作流，但不能仅凭工作流存在就宣称已通过测试。

## Web3 钱包与 TapeAPI 3.0

当前三种钱包入口依赖浏览器注入的 EIP-1193 Provider。部分手机浏览器没有注入钱包，需要使用钱包内置 DApp 浏览器；普通移动浏览器与钱包 App 的跨应用跳转/WalletConnect 方案尚未实现。钱包**连接成功不代表注册或登录成功**；只有服务端验证一次性签名后才可建立账户。当前主分支仍使用用户名密码登录；新的签名注册实现还需依赖和测试验收。

后续钱包注册须由服务器生成短时、一次性的 EIP-4361 签名挑战，校验签名、域名、链、地址、nonce 和过期时间，再进行 SQLite 账户绑定。**绝不请求助记词、私钥或不必要的代币授权。** TapeAPI 3.0 计划作为独立的已验签服务数据适配层，不替代钱包签名登录，也不在连接时自动发生支付或交易。

详见 [钱包与 TapeAPI 3.0 设计](docs/wallet-tapeapi-v3.md)。

## 设计和进度文档

- [架构设计](docs/architecture.md)
- [掼蛋阶段 1：规则基础](docs/guandan-stage1.md)
- [掼蛋阶段 2：服务端状态机](docs/guandan-stage2.md)
- [掼蛋阶段 3：H5 交互](docs/guandan-stage3.md)
- [掼蛋构建与联机验收清单](docs/guandan-validation.md)
- [钱包与 TapeAPI 3.0 设计](docs/wallet-tapeapi-v3.md)

## 单元测试

项目通过 Vitest 覆盖游戏规则/状态机、四人单副牌模拟、钱包挑战与账号生命周期、用户资料和房间重连。执行：

```bash
npm ci
npm run test
npm -w client run build
```

详细用例与尚未覆盖的真实钱包/Socket.IO 端到端验收见 [单元测试覆盖矩阵](docs/unit-test-matrix.md)。新增测试是否通过须以实际执行和 GitHub CI 结果为准；**不能仅凭测试代码存在宣称已验证**。

## 开源说明

本项目基于 [Tongzhuo](https://github.com/NFraw/Tongzhuo) 扩展，保留原始项目的 MIT 许可证及版权信息，详见 [LICENSE](LICENSE)。请确认自行添加的图片、音频、商标或其他素材具备相应许可；仓库不内置未经授权的第三方音频或美术资源。

**品牌：Tape Games（Tape 棋牌）。** 本次品牌调整不修改现有 npm workspace 内部包名（如 `@tongzhuo/*`）和 GitHub 仓库路径，以避免破坏导入、构建和历史链接。
