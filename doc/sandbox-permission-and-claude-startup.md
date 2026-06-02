# 沙箱权限模型与 Claude 启动问题排查

## 系统设计

### 用户与文件权限

沙箱容器内有两个关键角色：

| 角色 | UID | 用途 |
|------|-----|------|
| `root` | 0 | 容器启动脚本（SSH keygen、DNS 配置、sshd） |
| `coder` | 1000 | 日常使用（SSH 登录、运行 claude、写代码） |

容器以 `coder` 身份运行（Dockerfile `USER coder`），启动脚本通过 `sudo` 提权完成初始化。用户 SSH 登录后也是 `coder`。

### PVC 持久化与权限风险

```
/home/coder        ← home PVC（10Gi），跨 Pod 生命周期持久化
/home/coder/projects ← projects PVC（50Gi）
```

PVC 不会随 Pod 销毁而清除。这意味着：

1. **上一轮 Pod 写入的文件会保留**——包括 `.claude.json`、`.claude/` 目录
2. **如果某个文件曾以 root 身份写入**，下一轮 Pod 中 `coder` 无法读写
3. **常见触发场景**：调试时通过 `kubectl exec` 以默认用户执行了 `sudo` 写操作，或容器启动脚本中 `sudo tee` 写入了 `/home/coder` 下的文件

### Claude Code 启动流程与网络依赖

```
Claude Code 启动
  ├─ 读取 ~/.claude.json（用户设置 / 会话状态）
  ├─ 读取 ~/.claude/settings.json
  ├─ 读取 /etc/profile.d/claude-env.sh（注入的 API key + base URL）
  ├─ 连接 ANTHROPIC_BASE_URL（New API）—— 正常 API 请求
  ├─ 连接 api.anthropic.com:443（遥测 / 特性标志）—— 不可用时阻塞
  └─ 进入交互循环
```

Claude Code 即使设置了 `ANTHROPIC_BASE_URL`，启动时仍会尝试直连 `api.anthropic.com` 做遥测和特性标志检查。在沙箱环境中：

- `api.anthropic.com` 网络可达，但沙箱的 API key 是 New API token，不是真实 Anthropic key
- 遥测请求会因认证失败而**阻塞或重试循环**，表现为 Claude 卡在启动阶段

解决方案是在容器环境变量中设置：

```yaml
- name: CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
  value: "1"
```

此变量会跳过所有非必要的网络请求（遥测、特性标志），仅保留 `ANTHROPIC_BASE_URL` 的 API 调用。

---

## 问题排查指南

### 现象：Claude 在沙箱里卡住 / 无响应

**快速诊断步骤：**

```bash
# 1. 进入沙箱 Pod
POD=$(kubectl get sandbox -n sandbox-workspaces -o jsonpath='{.items[0].metadata.name}')

# 2. 检查文件权限
kubectl exec -n sandbox-workspaces $POD -- ls -la /home/coder/.claude.json
kubectl exec -n sandbox-workspaces $POD -- ls -la /home/coder/.claude/
```

**如果看到 `root root` 而不是 `coder coder`：**

```bash
# 修复权限
kubectl exec -n sandbox-workspaces $POD -- sudo chown -R coder:coder /home/coder
```

> 正常情况下不需要手动修复——启动脚本已包含 `sudo chown -R coder:coder /home/coder`，每次 Pod 启动都会自动修正。

```bash
# 3. 检查环境变量是否注入
kubectl exec -n sandbox-workspaces $POD -- cat /etc/profile.d/claude-env.sh
# 应该看到 ANTHROPIC_API_KEY=sk-xxx... 而不是空的

# 4. 检查 Claude 能否连通 New API
kubectl exec -n sandbox-workspaces $POD -- bash -c '
  source /etc/profile.d/claude-env.sh
  curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
    http://new-api.system.svc.cluster.local:3000/v1/models
'
# 期望输出: 200
```

### 现象：Claude 能启动但请求一直重试 / 401

```bash
# 检查 New API 日志
kubectl logs -n system deploy/new-api --tail=20
# 如果看到 "record not found" 或 "Invalid token"：
#   说明 token 不存在或已被覆盖
```

**修复方式：** 通过 New API 管理界面（http://localhost:3081）重新创建 token，然后更新 Portal 数据库中的记录，或在 Portal 中删除用户的 `api_key` 让系统自动重新创建。

### 权限问题的防御设计

当前沙箱模板在每次 Pod 启动时执行：

```bash
sudo chown -R coder:coder /home/coder
```

这覆盖了 PVC 中所有残留文件的权限问题。如果你在修改启动脚本时移除了这行，遇到 Claude 静默失败（`strace` 显示 `EACCES Permission denied` on `.claude.json`），请把它加回去。
