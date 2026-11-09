# Tape Games — 单元测试覆盖矩阵

此文档记录**已提交的测试用例范围**，不等于测试已经执行或通过。真实 Socket.IO、钱包扩展和手机端验收属于集成/E2E 测试，不在本次单元测试内。

| 层级 | 文件 | 覆盖场景 |
| --- | --- | --- |
| 掼蛋发牌和规则 | `games/guandan/__tests__/rules.test.ts`, `rules-coverage.test.ts` | 两副牌 108 唯一 ID、四人 27 张、RNG、顺子、同花顺、炸弹优先级、三带二、三连对、钢板、级牌、非法组合 |
| 掼蛋状态机 | `games/guandan/__tests__/engine.test.ts`, `engine-boundaries.test.ts` | 轮流出牌、过牌、接风、同队双上、拒绝越权/非法动作、不可变状态、手牌隐藏 |
| 掼蛋整局与插件 | `games/guandan/__tests__/round-integration.test.ts`, `plugin.test.ts` | 四玩家确定性整局模拟、牌量守恒、插件注册、脱敏视图、团队胜负和断线判负解析 |
| 用户认证 | `packages/core/server/__tests__/user-store.test.ts` | 创建/重名/密码、Token 防篡改、刷新、畸形签名拒绝、昵称头像保存、积分余额与流水 |
| 钱包挑战 | `packages/core/server/__tests__/wallet-auth.test.ts` | nonce 随机性、过期、已消费拒绝、origin 校验、地址/链输入拒绝 |
| 钱包注册与关联 | `packages/core/server/__tests__/wallet-account.test.ts` | 首次注册/复登、跨大小写地址、资料持久化、地址唯一性、并发消耗 nonce、失败数据库回滚 |
| 钱包 Provider | `client/wallet.test.ts` | Binance/OKX/TP 识别、EVM 地址校验、EIP-1193 请求顺序、链 ID 和拒绝操作 |
| 房间与恢复 | `packages/core/server/__tests__/room-manager.test.ts` | 创建/加入/人数上限、准备、房主迁移、玩家离开、断线/重连、昵称变更 |

## 运行与验收

```bash
npm ci
npm run test
npm -w client run build
```

CI 的 `.github/workflows/ci.yml` 已配置 pull_request/main 的 test/build 检查。新增文件位于现有 Vitest 默认的 `**/*.test.ts` 发现路径；根 `npm run test` 已调用 core-server、guandan 及 client wallet 测试。

**钱包安全限制：** `wallet-account.test.ts` 注入了测试专用假验签器，仅用于状态/数据库逻辑；它**不能证明真实 ECDSA 签名验证安全**。生产调用始终从服务端加载已验证的 `viem`，若依赖不存在则拒绝注册登录。仍须正确安装并锁定 `viem`、验证真实 EIP-191/EIP-4361 签名、更新 `package-lock.json`，再做端到端验收。

**尚缺少的集成/E2E 覆盖**：四浏览器 Socket.IO 对战、断线重连的网络时序、移动端钱包扩展/钱包 DApp 浏览器、HTTPS/反向代理、并发压力，以及经典掼蛋未实现规则。不能将本次单测称为上线验收或真实钱包实测。

## 本次伴随测试修复

`UserStore.verifyToken` 在比较 HMAC 前增加了 64 位十六进制格式与时间戳严格校验，以免畸形输入使 `crypto.timingSafeEqual` 抛异常。失败统一返回 `AUTH_TOKEN_INVALID`，而不是导致服务器内部错误。

> 本工作环境不能联网获取 GitHub 完整仓库或下载 npm 依赖，新增测试已推送但**尚未实际执行**；GitHub CI 结果需单独核对。
