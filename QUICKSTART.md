# Talos Portal Quickstart

## 项目结构

```
talos-deployment/
├── cli/               # CLI 工具（tt 命令）
├── server/            # Portal 服务端（API + Web）
│   └── web/           #   React 前端
├── sandbox-manager/   # Go 沙箱管理服务
├── images/workspace/  # 沙箱容器镜像
├── infra/             # Kubernetes 资源（kustomize）
├── scripts/           # 运维脚本
└── package.json       # 根级脚本管理
```

## 快速命令

```bash
npm run k3d              # 一键启动本地 k3d 环境
npm run k3d:down         # 销毁集群
npm run k3d:rebuild portal         # 重建某个组件
npm run build            # 构建所有
npm run dev:portal       # 本地开发 Portal
```

---

## 场景 1：k3d 单机（推荐）

所有服务运行在本地 k3d 集群，架构与生产环境一致。

### 前置条件

k3d（`brew install k3d`）、kubectl、Node.js 20+。

### 步骤

```bash
# 配置环境变量（首次）
cp .env.example .env     # 编辑填入 UPSTREAM_API_KEY 和 UPSTREAM_BASE_URL

# 一键启动（创建集群 + 构建镜像 + 部署所有服务）
npm run k3d

# Portal:  http://localhost:3080  (admin@talos.dev / admin)
# New API: http://localhost:3081  (root / 12345678)
```

### 使用

```bash
tt auth login             # 浏览器授权（首次）
tt up                     # 创建沙箱 → 实时进度 → 自动 SSH 连入
```

`tt up` 全流程：创建沙箱 → 等待 Pod 就绪 → 注入环境 → port-forward → SSH 连入。
沙箱 5 小时不活跃自动休眠，再次 `tt up` 自动唤醒（数据保留）。

### 开发迭代

修改代码后无需重建集群，单独重建组件：

```bash
npm run k3d:rebuild portal           # 重建 Portal
npm run k3d:rebuild sandbox-manager  # 重建 Sandbox Manager
npm run k3d:rebuild workspace        # 重建沙箱镜像
```

### VS Code Remote-SSH

`tt up` 自动配置 `~/.ssh/config`（`Host tt-default`），可在 VS Code 中使用：
`Cmd+Shift+P` → `Remote-SSH: Connect to Host` → `tt-default`

### 清理

```bash
npm run k3d:down           # 删除 k3d 集群
```

---

## 场景 2：线上部署（ECS）

所有服务部署到远程 ECS（k3s 单节点）。Push `main` 后 CI 自动构建镜像 + 部署。

### 架构

```
push main → CI 构建镜像 → 推送到镜像仓库
                              ↓
          CI 渲染 kustomize → 生成完整 YAML → SCP 到 ECS → kubectl apply
```

**ECS 上不需要 git、不需要 kustomize、不需要源码。** 只需要 k3s + kubectl（一次初始化）。

### 首次初始化 ECS（一次性操作）

```bash
# SSH 到 ECS
ssh root@<ECS_IP>

# 下载初始化脚本（或从仓库复制）
# 设置环境变量后运行
export REGISTRY=registry.cn-hangzhou.aliyuncs.com/yourns
export REGISTRY_USERNAME=xxx
export REGISTRY_PASSWORD=xxx
bash ecs-init.sh
```

`ecs-init.sh` 会自动完成：
1. 安装 k3s（单节点，无 traefik）
2. 配置私有镜像仓库认证（阿里云 ACR / Docker Hub）
3. 安装 agent-sandbox controller
4. 创建 namespace 和 secrets

初始化完成后，还需要配置上游 LLM API：

```bash
# 获取已生成的 JWT secret
JWT_SECRET=$(k3s kubectl get secret talos-portal-secrets -n system -o jsonpath='{.data.jwt-secret}' | base64 -d)

# 更新 secrets（加入上游 API 配置）
k3s kubectl create secret generic talos-portal-secrets \
  --from-literal=jwt-secret="$JWT_SECRET" \
  --from-literal=upstream-api-key="你的 API Key" \
  --from-literal=upstream-base-url="https://open.bigmodel.cn/api/anthropic" \
  --from-literal=sandbox-default-opus-model="glm-5.1" \
  --from-literal=sandbox-default-sonnet-model="glm-5" \
  --from-literal=sandbox-default-haiku-model="glm-4.7" \
  --namespace system \
  --dry-run=client -o yaml | k3s kubectl apply -f -
```

### ECS 安全组

需要开放以下端口：

| 端口 | 用途 |
|------|------|
| 22 | SSH |
| 3080 | Portal Web |
| 3081 | New API |

### 配置 GitHub Secrets

在 GitHub Repo → Settings → Secrets and variables → Actions 添加：

| Secret | 说明 | 示例 |
|--------|------|------|
| `REGISTRY` | 镜像仓库地址 | `registry.cn-hangzhou.aliyuncs.com/yourns` |
| `REGISTRY_USERNAME` | 仓库用户名 | |
| `REGISTRY_PASSWORD` | 仓库密码 | |
| `ECS_HOST` | ECS 公网 IP | `47.xxx.xxx.xxx` |
| `ECS_USER` | SSH 用户 | `root` |
| `ECS_SSH_KEY` | SSH 私钥 | `-----BEGIN RSA...` |

### 自动部署流程

配置好 Secrets 后，每次 push 到 `main` 分支，GitHub Actions 会自动：

1. **构建** 3 个 Docker 镜像（workspace / portal / sandbox-manager）
2. **推送** 到镜像仓库
3. **渲染** kustomize（替换镜像地址）→ 生成完整 YAML
4. **SCP** YAML 到 ECS → `kubectl apply`

无需在 ECS 上装 git、kustomize 或 clone 代码。

### 手动部署（可选）

如果需要从本地手动触发部署：

```bash
# 方式 1：渲染 YAML 并直接远程部署
REGISTRY=xxx IMAGE_TAG=latest \
  ECS_HOST=1.2.3.4 ECS_USER=root \
  ./scripts/deploy.sh --remote

# 方式 2：只渲染 YAML，手动 SCP
REGISTRY=xxx IMAGE_TAG=latest ./scripts/deploy.sh --render > manifest.yaml
scp manifest.yaml root@<ECS_IP>:/opt/talos/
ssh root@<ECS_IP> "bash /opt/talos/scripts/deploy-remote.sh /opt/talos/manifest.yaml"
```

---

## CLI 命令参考

| 命令 | 说明 |
|------|------|
| `tt auth login` | 浏览器授权登录 |
| `tt auth` | 查看当前登录状态 |
| `tt auth logout` | 退出登录 |
| `tt login` | （兼容别名）同 `tt auth login` |
| `tt up` | 创建或唤醒沙箱，自动 SSH 连入。支持 `-p, --project <name>` |
| `tt --version` | 查看版本 |

### 环境生命周期

```
tt up → 创建/唤醒 → SSH 连入 → 退出 SSH
                                    ↓
                          5h 不活跃自动休眠
                                    ↓
                    tt up → 自动唤醒（数据保留）→ SSH 连入
```

---

## 默认账号

| 角色 | Email | 密码 |
|------|-------|------|
| Portal 管理员 | admin@talos.dev | admin |
| New API | root | 12345678 |

## 端口说明

| 端口 | 用途 | 配置项 |
|------|------|--------|
| 3080 | Portal Web | `PORTAL_PORT`（.env） |
| 3081 | New API | `NEWAPI_PORT`（.env） |
| 8081 | Sandbox Manager | 内部服务，无需配置 |

## 配置优先级

| 优先级 | 来源 | 内容 |
|--------|------|--------|
| 最高 | 环境变量（`.env`） | `UPSTREAM_API_KEY`、`TALOS_SERVER_URL` 等 |
| 中 | `~/.talos/config.json` | 登录态、server URL |
| 最低 | 代码默认值 | 端口、超时等 |
