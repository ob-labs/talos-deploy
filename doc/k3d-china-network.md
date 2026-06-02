# k3d 国内网络问题排查

## 现象

Pod 卡在 `ContainerCreating` / `ImagePullBackOff`，events 显示拉镜像超时或 connection refused。

## 原因

k3d 节点是 Docker 容器，内部 kubelet 直连 Docker Hub，不走宿主机 Docker 的 registry mirror。

## 解决：手动导入镜像

宿主机能拉到的镜像，通过 `k3d image import` 注入节点：

```bash
# 1. 宿主机拉镜像（走 mirror）
docker pull <image>

# 2. 导入 k3d 集群
k3d image import <image> -c <cluster-name>
```

## 需要导入的镜像清单

| 来源 | 镜像 |
|------|------|
| kube-system | `rancher/mirrored-pause:3.6` |
| kube-system | `rancher/mirrored-coredns-coredns:<version>` |
| kube-system | `rancher/local-path-provisioner:<version>` |
| kube-system | `rancher/mirrored-metrics-server:<version>` |
| kube-system | `rancher/mirrored-library-busybox:<version>` |
| 业务 | 按需 |

查看 kube-system 实际需要的版本：

```bash
kubectl get pods -n kube-system -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'
```

## imagePullPolicy 注意事项

K8s 对 `:latest` 标签默认使用 `Always` 拉取策略，即使节点已有镜像也会去远端验证。导入镜像后如果 Pod 仍拉取失败，在 Deployment 或 SandboxTemplate 中显式设置：

```yaml
imagePullPolicy: IfNotPresent
```
