# VS Code Remote-SSH 连接沙箱

通过 VS Code Remote-SSH 直连沙箱，获得完整 IDE 体验。

## 前置条件

- 沙箱已创建并 Running（`tt up`，或参考 `doc/sandbox-lifecycle.md`）
- 本机有 SSH 密钥（没有则先生成：`ssh-keygen -t ed25519`）
- VS Code 已安装 [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) 扩展

## 1. 建立端口转发

`tt up` 会自动注入你的 SSH 公钥，无需手动操作。直接建立端口转发：

```bash
# 获取沙箱 Pod 名称
POD=$(kubectl get sandboxclaim tt-1-default -n sandbox-workspaces -o jsonpath='{.status.sandbox.name}')

# 建立端口转发
kubectl port-forward $POD 2222:22 -n sandbox-workspaces &
```

验证连接：

```bash
ssh -p 2222 coder@localhost
```

首次连接会提示确认 host key，输入 `yes`。

## 3. 配置 VS Code

编辑 `~/.ssh/config`：

```
Host talos-sandbox
  HostName localhost
  Port 2222
  User coder
  StrictHostKeyChecking no
  IdentityFile ~/.ssh/id_ed25519
```

VS Code 中操作：

1. `Cmd+Shift+P` → `Remote-SSH: Connect to Host` → 选择 `talos-sandbox`
2. 等待 VS Code 在远端安装 server
3. 打开文件夹 `/home/coder`

## 4. 多沙箱并行

如果同时使用多个沙箱，分配不同端口：

```bash
# 沙箱 1
kubectl port-forward pod-for-sandbox1 2222:22 -n sandbox-workspaces &

# 沙箱 2
kubectl port-forward pod-for-sandbox2 2223:22 -n sandbox-workspaces &
```

`~/.ssh/config` 对应多个条目：

```
Host talos-project-a
  HostName localhost
  Port 2222
  User coder

Host talos-project-b
  HostName localhost
  Port 2223
  User coder
```

## 5. ECS 场景（远程 k3s）

如果 k3s 运行在 ECS 上，需要先 SSH 到 ECS 建立 port-forward 隧道：

```bash
# 本机 → ECS → Pod
ssh -L 2222:localhost:2222 user@your-ecs-ip

# 在 ECS 上执行
kubectl port-forward $POD 2222:22 -n sandbox-workspaces &
```

本机 VS Code 配置与上面相同，`HostName localhost` 即可（通过 SSH 隧道转发）。

## 6. 断开与清理

```bash
# 停止端口转发
kill $(lsof -ti:2222)

# VS Code 中直接关闭窗口即可
```

## 常见问题

### Permission denied (publickey)

确认公钥已正确写入：
```bash
kubectl exec $POD -n sandbox-workspaces -- cat /home/coder/.ssh/authorized_keys
```

### Connection refused

确认 Pod 内 sshd 正在运行：
```bash
kubectl exec $POD -n sandbox-workspaces -- ps aux | grep sshd
```

### VS Code 连接超时

确认端口转发仍在运行：
```bash
lsof -ti:2222
```
