package client

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type mockEntry struct {
	name        string
	namespace   string
	template    string
	ready       bool
	sandboxName string
	podName     string
	createdAt   time.Time
}

type MockClient struct {
	mu      sync.RWMutex
	entries map[string]*mockEntry // key: "namespace/name"
}

func NewMockClient() *MockClient {
	return &MockClient{entries: make(map[string]*mockEntry)}
}

func (m *MockClient) key(name, namespace string) string {
	return namespace + "/" + name
}

func (m *MockClient) CreateClaim(ctx context.Context, name, namespace, template string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := m.key(name, namespace)
	entry := &mockEntry{
		name:        name,
		namespace:   namespace,
		template:    template,
		ready:       false,
		sandboxName: fmt.Sprintf("mock-sandbox-%s", name),
		podName:     fmt.Sprintf("mock-pod-%s", name),
		createdAt:   time.Now(),
	}
	m.entries[key] = entry

	go func() {
		time.Sleep(1500 * time.Millisecond)
		m.mu.Lock()
		defer m.mu.Unlock()
		if e, ok := m.entries[key]; ok {
			e.ready = true
		}
	}()

	return nil
}

func (m *MockClient) DeleteClaim(ctx context.Context, name, namespace string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.entries, m.key(name, namespace))
	return nil
}

func (m *MockClient) GetStatus(ctx context.Context, name, namespace string) (*ClaimStatus, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	entry, ok := m.entries[m.key(name, namespace)]
	if !ok {
		return &ClaimStatus{Ready: false}, nil
	}
	return &ClaimStatus{
		Ready:       entry.ready,
		SandboxName: entry.sandboxName,
	}, nil
}

func (m *MockClient) GetPodName(ctx context.Context, sandboxName, namespace string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, entry := range m.entries {
		if entry.sandboxName == sandboxName && entry.namespace == namespace {
			return entry.podName, nil
		}
	}
	return "", nil
}

func (m *MockClient) WaitForReady(ctx context.Context, name, namespace string, timeout time.Duration) (bool, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		status, err := m.GetStatus(ctx, name, namespace)
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

func (m *MockClient) InjectEnv(ctx context.Context, claimName, namespace string, sshKeys []string, apiKey, apiBase string, extraEnv map[string]string) error {
	return nil
}

func (m *MockClient) ListClaims(ctx context.Context, namespace string) ([]ClaimInfo, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []ClaimInfo
	for _, entry := range m.entries {
		if entry.namespace == namespace {
			status := "Creating"
			if entry.ready {
				status = "Ready"
			}
			result = append(result, ClaimInfo{
				Name:   entry.name,
				Ready:  entry.ready,
				Status: status,
			})
		}
	}
	return result, nil
}
