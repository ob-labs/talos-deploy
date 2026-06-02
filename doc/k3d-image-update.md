# k3d 镜像更新流程

## 问题

更新镜像后，k3d 节点仍使用旧镜像缓存。

## 流程

```bash
# 1. 构建
docker build -t localhost:32000/<name>:latest <dir>

# 2. 推到本地 registry（供 Pod 拉取）
docker push localhost:32000/<name>:latest

# 3. 导入 k3d 节点（如果设置了 IfNotPresent）
k3d image import localhost:32000/<name>:latest -c <cluster>

# 4. 重建 Pod
kubectl rollout restart deploy/<name> -n <namespace>
```

## 本机访问 vs 节点内访问

| 场景 | 地址 |
|------|------|
| 本机 docker push/pull | `localhost:32000` |
| k3d 节点内 Pod 拉取 | `talos-registry:5000`（k3d 自动 DNS） |

两者指向同一个 registry，但标签是独立的。SandboxTemplate 中应使用节点内可解析的地址。

## 清除节点缓存

如果 `k3d image import` 后仍拉到旧镜像，手动清除 containerd 缓存：

```bash
docker exec <node> ctr --namespace=k8s.io images rm <image-tag>
k3d image import <image-tag> -c <cluster>
```
