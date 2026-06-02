# Talos Portal 用户指南

## 三种运行场景

| 场景 | 启动方式 | 说明 |
|------|---------|------|
| compose + mock | `docker compose up` | 日常开发，秒启动 |
| k3d 单机 | `./scripts/k3d-infra.sh` | 真实沙箱，架构与生产一致 |
| 线上部署 | `init-cluster.sh` → CI/CD 自动部署 | 部署到远程 K8s 集群 |

详见 [QUICKSTART.md](../QUICKSTART.md)

## 管理员初始化（场景 2/3）

```bash
# 部署基础设施
./scripts/k3d-infra.sh                # 场景 2：本地 k3d
./scripts/init-cluster.sh             # 场景 3：线上 ECS（首次）

# 配置 New API
# 浏览器打开 New API 控制台（见 QUICKSTART.md 端口表）
# 登录 root/123654 → 添加渠道 → 创建令牌(sk-xxx)
# 将令牌写入集群（场景 3 需要）：
kubectl create secret generic talos-portal-secrets \
  --from-literal=newapi-admin-token=sk-xxx \
  -n system --dry-run=client -o yaml | kubectl apply -f -
```

## 普通用户使用

```bash
# 1. 安装 CLI
cd server/cli && npm link

# 2. 登录（首次自动注册，浏览器打开）
tt login

# 3. 此时状态为 pending，需等管理员审批
```

## 管理员审批

两种方式二选一：

**白屏：** 浏览器打开 Portal → 用 admin@talos.dev / admin 登录 → Users 页面 → 点 Approve

**命令行：**

```bash
curl -X PUT http://localhost:3002/api/admin/users/2/approve \
  -H "Authorization: Bearer <admin_token>"
```

审批通过后自动调用 New API 创建令牌，注入到用户沙箱中（需已配置 `newapi-admin-token`，否则只审批不创建 Key，需手动补）。

## 创建沙箱并连接

```bash
# 创建沙箱 → 实时进度 → 自动 SSH 连入
tt up                     # 默认项目 "default"
tt up --project my-app    # 多项目
```

`tt up` 完成以下全部步骤：

1. 检查并上传 SSH 公钥
2. 创建沙箱（或唤醒休眠的沙箱）
3. 等待 Pod 就绪（通过 SSE 实时显示进度）
4. 注入环境变量（SSH Key + API Key）
5. 建立 port-forward
6. SSH 连入沙箱

退出 SSH 后 port-forward 自动清理。再次 `tt up` 重新连接。

## VS Code Remote-SSH

`tt up` 会自动配置 `~/.ssh/config`，VS Code 可直接使用：

```
Host tt-default
  HostName localhost
  Port <动态端口>
  User coder
  IdentityFile ~/.ssh/id_ed25519
```

`Cmd+Shift+P` → `Remote-SSH: Connect to Host` → `tt-default`

详见 [vscode-remote-ssh.md](./vscode-remote-ssh.md)

## 环境生命周期

```
tt up → 创建沙箱 → SSH 连入 → 正常使用
                              ↓
                    5h 不活跃自动休眠
                    （Pod 回收，PVC 保留）
                              ↓
          tt up → 自动唤醒（数据保留）→ SSH 连入
```

## 切换账号

已登录状态下执行 `tt login`，浏览器打开账户管理页：

- 显示当前账号信息
- 「切换账号」→ 清除登录态 → 跳转登录页
- 「退出登录」→ 清除登录态 → CLI 自动发起新登录

## 流程图

```
用户                    管理员                    K8s / Mock
 │                       │                        │
 │── tt login ──────────►│                        │
 │   (自动注册,pending)   │                        │
 │                       │── 白屏 Approve ───────►│
 │                       │   (创建 API Key)       │
 │◄── 可用 ──────────────│                        │
 │                       │                        │
 │── tt up ──────────────┼───────────────────────►│
 │   (上传公钥,创建Claim) │                        │── 分配 Pod / Mock Ready
 │   SSE 实时进度显示      │                        │── 注入 SSH Key + API Key
 │   自动 port-forward    │                        │
 │   自动 SSH 连入 ───────┼──────────────────────►│
 │                       │                        │
 │  (退出 SSH)            │                        │
 │                       │                        │
 │  ...5h 不活跃...       │                        │── 自动休眠（Pod 回收，PVC 保留）
 │                       │                        │
 │── tt up (唤醒) ───────┼───────────────────────►│
 │   (SSE 实时进度)       │                        │── 分配新 Pod，注入环境变量
 │   自动 SSH 连入 ───────┼──────────────────────►│
```

## ECS 场景

把 `localhost:3002` 换成 `<ECS_IP>:30002`，其余流程完全一致。

## 清理

```bash
./scripts/k3d-down.sh    # 删除 k3d 集群
docker compose down -v   # 停止 Docker Compose 并清理数据
```
