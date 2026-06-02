# 手动操作 Sandbox 生命周期

本指南不依赖 DevPod，直接用 kubectl 完成 Sandbox 的创建、连接、销毁。

## 前置条件

- k3d 集群已启动，所有 Pod Running（`kubectl get pods -A` 确认）
- kubectl context 已切换到 `k3d-talos-local`

## 1. 创建沙箱

```bash
cat <<EOF | kubectl apply -f -
apiVersion: extensions.agents.x-k8s.io/v1alpha1
kind: SandboxClaim
metadata:
  name: my-sandbox
  namespace: sandbox-workspaces
spec:
  sandboxTemplateRef:
    name: claude-workspace
EOF
```

## 2. 等待就绪

```bash
kubectl wait sandboxclaim my-sandbox -n sandbox-workspaces --for=condition=Ready --timeout=120s
```

如果预热池有空闲沙箱，通常 5 秒内就绪；否则需要冷启动（约 30-60 秒）。

## 3. 查看沙箱状态

```bash
# 沙箱概况
kubectl get sandbox -n sandbox-workspaces

# 对应的 Pod
kubectl get pod -n sandbox-workspaces -l app=claude-workspace

# 沙箱详情（含 Pod 名称、IP）
kubectl get sandbox my-sandbox -n sandbox-workspaces -o wide
```

## 4. SSH 连入

```bash
# 获取 Pod 名称（Sandbox 名称即 Pod 名称）
POD=$(kubectl get sandboxclaim my-sandbox -n sandbox-workspaces -o jsonpath='{.status.sandbox.name}')

# 端口转发（后台运行）
kubectl port-forward $POD 2222:22 -n sandbox-workspaces &

# SSH 连接
ssh -p 2222 coder@localhost
```

> 如果提示 host key 验证失败，加 `-o StrictHostKeyChecking=no`。

## 5. 沙箱内操作

```bash
whoami              # coder
which claude        # /usr/bin/claude
echo $ANTHROPIC_BASE_URL  # http://new-api.system.svc.cluster.local:3000

# 启动 Claude
claude
```

## 6. VS Code Remote-SSH 连接

1. 安装 VS Code 扩展：Remote - SSH
2. 编辑 `~/.ssh/config`：

```
Host talos-sandbox
  HostName localhost
  Port 2222
  User coder
  StrictHostKeyChecking no
```

3. 确保端口转发在运行（步骤 4）
4. VS Code 命令面板 → `Remote-SSH: Connect to Host` → 选 `talos-sandbox`
5. 打开文件夹 `/home/coder`

## 7. 销毁沙箱

```bash
# 停止端口转发
kill %1

# 删除 SandboxClaim（Pod 和 PVC 一并回收）
kubectl delete sandboxclaim my-sandbox -n sandbox-workspaces
```

## 预热池相关

```bash
# 查看池状态（空闲数 / 目标数）
kubectl get sandboxwarmpool claude-pool -n sandbox-workspaces

# 手动调整池大小
kubectl patch sandboxwarmpool claude-pool -n sandbox-workspaces -p '{"spec":{"replicas":3}}'
```

## 常见问题

### SandboxClaim 一直 Pending

```bash
kubectl describe sandboxclaim my-sandbox -n sandbox-workspaces
kubectl get events -n sandbox-workspaces --sort-by='.lastTimestamp'
```

### SSH 连接被拒

确认 Pod 内 SSH 服务未崩溃：

```bash
kubectl logs $POD -n sandbox-workspaces --tail=20
```

如果看到 `sshd: no hostkeys available`，说明 SSH key 生成失败，检查 Pod 是否以非 root 用户运行了 `sudo ssh-keygen -A`。
