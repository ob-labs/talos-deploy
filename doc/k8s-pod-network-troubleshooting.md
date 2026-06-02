# K8s 集群内 Pod 网络连通性排查

## 现象

Pod 内无法访问集群内部 Service，DNS 解析失败：
```
curl: (6) Could not resolve host: new-api.system.svc.cluster.local
```

## 根因分析

排查路径：`Pod 无法连通 Service` → `DNS 解析失败` → `resolv.conf 指向外部` → `controller 覆盖了 DNS 配置`

### 1. 检查 Pod 的 DNS 配置

```bash
kubectl exec <pod> -- cat /etc/resolv.conf
```

正常应指向 CoreDNS（如 `10.43.0.10`），如果指向 `8.8.8.8` 等外部 DNS，则集群内部域名全部无法解析。

### 2. 确认 CoreDNS 正常运行

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

CoreDNS Running 不代表 Pod 在用它，需要看 `resolv.conf`。

### 3. 定位谁覆盖了 DNS

检查 Pod spec 中的 `dnsPolicy` 和 `dnsConfig`：
```bash
kubectl get pod <pod> -o jsonpath='{.spec.dnsPolicy}'
kubectl get pod <pod> -o jsonpath='{.spec.dnsConfig}'
```

常见情况：
- `dnsPolicy: None` + `nameservers: [8.8.8.8]` → controller 注入了外部 DNS
- `dnsPolicy: Default` → 继承节点 resolv.conf，不走 CoreDNS

### 4. NetworkPolicy 阻断集群内流量

```bash
kubectl get networkpolicy -n <namespace> -o yaml
```

关注 egress 规则中是否有：
```yaml
ipBlock:
  cidr: 0.0.0.0/0
  except:
    - 10.0.0.0/8       # 阻断所有集群内部 IP
    - 172.16.0.0/12
    - 192.168.0.0/16
```

这会同时阻断 DNS（CoreDNS 的 ClusterIP 也在这些范围）。

## 解决方案

### 方案 A：在启动命令中修复 resolv.conf

当 controller 强制覆盖 `dnsPolicy` 且无法关闭时，在容器启动命令中写入正确的 resolv.conf：

```yaml
command:
  - /bin/sh
  - -c
  - |
    COREDNS_IP=$(kubectl get svc kube-dns -n kube-system -o jsonpath='{.spec.clusterIP}')
    echo "nameserver ${COREDNS_IP}" | sudo tee /etc/resolv.conf
    echo "search <namespace>.svc.cluster.local svc.cluster.local cluster.local" | sudo tee -a /etc/resolv.conf
    # ... 其余启动命令
```

CoreDNS 的 ClusterIP 通常是 `10.43.0.10`（k3d 默认），可通过 `kubectl get svc kube-dns -n kube-system` 确认。

### 方案 B：关闭 controller 自动 NetworkPolicy 管理

如果 controller 自动生成了过于严格的 NetworkPolicy，在 SandboxTemplate 中设置：

```yaml
spec:
  networkPolicyManagement: Unmanaged
```

然后自行编写精确的 NetworkPolicy，允许：
1. DNS 出站（UDP/TCP 53）
2. 访问需要的集群内 Service

```yaml
egress:
  # 允许 DNS
  - to: []
    ports:
      - port: 53
        protocol: UDP
      - port: 53
        protocol: TCP
  # 允许访问目标 namespace 的 Service
  - to:
      - namespaceSelector:
          matchLabels:
            name: system
    ports:
      - port: 3000
```

### 方案 C：在模板中显式指定 dnsPolicy（如果 controller 不覆盖）

```yaml
spec:
  podTemplate:
    spec:
      dnsPolicy: ClusterFirst
```

## 排查清单

遇到 Pod 无法访问集群内服务时，按顺序检查：

| # | 检查项 | 命令 |
|---|--------|------|
| 1 | Pod resolv.conf | `kubectl exec <pod> -- cat /etc/resolv.conf` |
| 2 | CoreDNS 状态 | `kubectl get pods -n kube-system -l k8s-app=kube-dns` |
| 3 | Pod dnsPolicy | `kubectl get pod <pod> -o jsonpath='{.spec.dnsPolicy}'` |
| 4 | NetworkPolicy | `kubectl get networkpolicy -n <ns> -o yaml` |
| 5 | 从 Pod 内测试连通性 | `kubectl exec <pod> -- curl -sv http://<svc>.<ns>.svc.cluster.local:<port>/` |
