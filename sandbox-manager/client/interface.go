package client

import (
	"context"
	"time"
)

type SandboxClient interface {
	CreateClaim(ctx context.Context, name, namespace, template string) error
	DeleteClaim(ctx context.Context, name, namespace string) error
	GetStatus(ctx context.Context, name, namespace string) (*ClaimStatus, error)
	GetPodName(ctx context.Context, sandboxName, namespace string) (string, error)
	GetPodIP(ctx context.Context, sandboxName, namespace string) (string, error)
	WaitForReady(ctx context.Context, name, namespace string, timeout time.Duration) (bool, error)
	InjectEnv(ctx context.Context, claimName, namespace string, sshKeys []string, apiKey, apiBase string, extraEnv map[string]string) error
	ListClaims(ctx context.Context, namespace string) ([]ClaimInfo, error)
}

type ClaimStatus struct {
	Ready       bool   `json:"ready"`
	SandboxName string `json:"sandboxName,omitempty"`
}

type ClaimInfo struct {
	Name   string `json:"name"`
	Ready  bool   `json:"ready"`
	Status string `json:"status"`
}
