package client

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	extv1alpha1 "sigs.k8s.io/agent-sandbox/extensions/api/v1alpha1"
	extclientset "sigs.k8s.io/agent-sandbox/clients/k8s/extensions/clientset/versioned"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/remotecommand"
)

type K8sClient struct {
	extClient  extclientset.Interface
	coreClient *kubernetes.Clientset
	config     *rest.Config
	namespace  string
}

func NewK8sClient(kubeconfigPath, namespace string) (*K8sClient, error) {
	var config *rest.Config
	var err error

	if kubeconfigPath != "" {
		loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
		loadingRules.ExplicitPath = kubeconfigPath
		clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, &clientcmd.ConfigOverrides{})
		config, err = clientConfig.ClientConfig()
		if err != nil {
			return nil, fmt.Errorf("load kubeconfig: %w", err)
		}
		// Replace host for Docker → host access (e.g. 0.0.0.0 → host.docker.internal)
		if replace := os.Getenv("K8S_HOST"); replace != "" {
			config.Host = strings.Replace(config.Host, "0.0.0.0", replace, 1)
			config.Host = strings.Replace(config.Host, "127.0.0.1", replace, 1)
			config.Insecure = true
			config.TLSClientConfig.CAFile = ""
			config.TLSClientConfig.CAData = nil
		}
	} else {
		config, err = rest.InClusterConfig()
	}
	if err != nil {
		return nil, fmt.Errorf("build k8s config: %w", err)
	}

	extClient, err := extclientset.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create extensions client: %w", err)
	}

	coreClient, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create core client: %w", err)
	}

	return &K8sClient{
		extClient:  extClient,
		coreClient: coreClient,
		config:     config,
		namespace:  namespace,
	}, nil
}

func (k *K8sClient) CreateClaim(ctx context.Context, name, namespace, template string) error {
	claim := &extv1alpha1.SandboxClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Spec: extv1alpha1.SandboxClaimSpec{
			TemplateRef: extv1alpha1.SandboxTemplateRef{
				Name: template,
			},
		},
	}
	_, err := k.extClient.ExtensionsV1alpha1().SandboxClaims(namespace).Create(ctx, claim, metav1.CreateOptions{})
	return err
}

func (k *K8sClient) DeleteClaim(ctx context.Context, name, namespace string) error {
	return k.extClient.ExtensionsV1alpha1().SandboxClaims(namespace).Delete(ctx, name, metav1.DeleteOptions{})
}

func (k *K8sClient) GetStatus(ctx context.Context, name, namespace string) (*ClaimStatus, error) {
	claim, err := k.extClient.ExtensionsV1alpha1().SandboxClaims(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get claim %s/%s: %w", namespace, name, err)
	}

	ready := false
	for _, c := range claim.Status.Conditions {
		if c.Type == "Ready" && c.Status == "True" {
			ready = true
			break
		}
	}

	return &ClaimStatus{
		Ready:       ready,
		SandboxName: claim.Status.SandboxStatus.Name,
	}, nil
}

func (k *K8sClient) GetPodName(ctx context.Context, sandboxName, namespace string) (string, error) {
	// Try label selector first
	pods, err := k.coreClient.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labels.Set{"agents.x-k8s.io/sandbox": sandboxName}.String(),
	})
	if err == nil && len(pods.Items) > 0 {
		return pods.Items[0].Name, nil
	}

	// Fallback: find by name prefix
	allPods, err := k.coreClient.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", fmt.Errorf("list pods in %s for sandbox %s: %w", namespace, sandboxName, err)
	}
	for _, pod := range allPods.Items {
		if len(pod.Name) >= len(sandboxName) && pod.Name[:len(sandboxName)] == sandboxName && pod.Status.Phase == corev1.PodRunning {
			return pod.Name, nil
		}
	}
	return "", fmt.Errorf("no running pod found for sandbox %s in %s", sandboxName, namespace)
}

func (k *K8sClient) WaitForReady(ctx context.Context, name, namespace string, timeout time.Duration) (bool, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		status, err := k.GetStatus(ctx, name, namespace)
		if err != nil {
			return false, err
		}
		if status.Ready {
			return true, nil
		}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
	return false, nil
}

func (k *K8sClient) InjectEnv(ctx context.Context, claimName, namespace string, sshKeys []string, apiKey, apiBase string, extraEnv map[string]string) error {
	status, err := k.GetStatus(ctx, claimName, namespace)
	if err != nil {
		return err
	}
	if status.SandboxName == "" {
		return nil
	}

	podName, err := k.GetPodName(ctx, status.SandboxName, namespace)
	if err != nil {
		return err
	}
	if podName == "" {
		return nil
	}

	container := "dev"

	// Inject SSH keys
	if len(sshKeys) > 0 {
		keysContent := ""
		for i, key := range sshKeys {
			if i > 0 {
				keysContent += "\\n"
			}
			keysContent += key
		}
		sshCmd := fmt.Sprintf(`mkdir -p /home/coder/.ssh && printf "%s" > /home/coder/.ssh/authorized_keys && chmod 600 /home/coder/.ssh/authorized_keys && chown coder:coder /home/coder/.ssh/authorized_keys && chmod 700 /home/coder/.ssh && sudo chmod 755 /home/coder`, keysContent)
		if err := k.execInPod(ctx, podName, namespace, container, sshCmd); err != nil {
			return fmt.Errorf("inject ssh keys: %w", err)
		}
	}

	// Inject env vars
	// ANTHROPIC_AUTH_TOKEN makes Claude Code use the token directly as Bearer (bypasses Anthropic account validation)
	// ANTHROPIC_API_KEY kept for compatibility with other tools
	envScript := fmt.Sprintf(`export ANTHROPIC_AUTH_TOKEN=%s\nexport ANTHROPIC_API_KEY=%s\nexport ANTHROPIC_BASE_URL=%s\n`, apiKey, apiKey, apiBase)
	for k, v := range extraEnv {
		envScript += fmt.Sprintf("export %s=%s\n", k, v)
	}
	envCmd := fmt.Sprintf(`printf "%s" | sudo tee /etc/profile.d/claude-env.sh >/dev/null && grep -q profile.d /home/coder/.bashrc || echo "source /etc/profile.d/claude-env.sh" >> /home/coder/.bashrc`, envScript)
	if err := k.execInPod(ctx, podName, namespace, container, envCmd); err != nil {
		return fmt.Errorf("inject env: %w", err)
	}

	return nil
}

func (k *K8sClient) ListClaims(ctx context.Context, namespace string) ([]ClaimInfo, error) {
	claims, err := k.extClient.ExtensionsV1alpha1().SandboxClaims(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	var result []ClaimInfo
	for _, c := range claims.Items {
		ready := false
		for _, cond := range c.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "True" {
				ready = true
				break
			}
		}
		status := "Creating"
		if ready {
			status = "Ready"
		}
		result = append(result, ClaimInfo{
			Name:   c.Name,
			Ready:  ready,
			Status: status,
		})
	}
	return result, nil
}

func (k *K8sClient) execInPod(ctx context.Context, podName, namespace, container, command string) error {
	req := k.coreClient.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(namespace).
		SubResource("exec").
		Param("container", container).
		Param("command", "/bin/bash").
		Param("command", "-c").
		Param("command", command).
		Param("stdout", "true").
		Param("stderr", "true")

	executor, err := remotecommand.NewSPDYExecutor(k.config, "POST", req.URL())
	if err != nil {
		return err
	}

	var stdout, stderr bytes.Buffer
	err = executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if err != nil {
		return fmt.Errorf("%w: %s", err, stderr.String())
	}
	return nil
}

// Compile-time check
var _ SandboxClient = (*K8sClient)(nil)
