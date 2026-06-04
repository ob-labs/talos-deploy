package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"sandbox-manager/client"
	"sandbox-manager/handler"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	mode := env("SANDBOX_MODE", "mock")
	namespace := env("SANDBOX_NAMESPACE", "sandbox-workspaces")
	port := env("PORT", "8081")

	var sc client.SandboxClient
	switch mode {
	case "k8s":
		kubeconfig := os.Getenv("KUBECONFIG")
		k8sClient, err := client.NewK8sClient(kubeconfig, namespace)
		if err != nil {
			log.Fatalf("Failed to create K8s client: %v", err)
		}
		sc = k8sClient
		log.Printf("Running in k8s mode (namespace=%s)", namespace)
	default:
		sc = client.NewMockClient()
		log.Printf("Running in mock mode")
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	h := &handler.SandboxHandler{Client: sc, Namespace: namespace}
	h.Register(r)

	// Print registered routes for debugging
	walkFunc := func(method, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		log.Printf("  %s %s", method, route)
		return nil
	}
	if err := chi.Walk(r, walkFunc); err != nil {
		log.Printf("Error walking routes: %v", err)
	}

	addr := fmt.Sprintf(":%s", port)
	log.Printf("Sandbox Manager listening on %s (namespace=%s, mode=%s)", addr, namespace, mode)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal(err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
