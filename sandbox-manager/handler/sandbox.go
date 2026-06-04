package handler

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"time"

	"sandbox-manager/client"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

type SandboxHandler struct {
	Client    client.SandboxClient
	Namespace string
}

type createReq struct {
	TemplateName string `json:"templateName"`
}

type envReq struct {
	SSHKeys  []string          `json:"sshKeys"`
	APIKey   string            `json:"apiKey"`
	APIBase  string            `json:"apiBase"`
	ExtraEnv map[string]string `json:"extraEnv,omitempty"`
}

func (h *SandboxHandler) Register(r chi.Router) {
	r.Post("/sandboxes", h.Create)
	r.Get("/sandboxes", h.List)
	r.Get("/sandboxes/{name}/status", h.GetStatus)
	r.Get("/sandboxes/{name}/pod", h.GetPod)
	r.Get("/sandboxes/{name}/ssh", h.SSHRelay)
	r.Post("/sandboxes/{name}/env", h.InjectEnv)
	r.Post("/sandboxes/{name}/wake", h.Wake)
	r.Delete("/sandboxes/{name}", h.Delete) // must be last — {name} is greedy
	r.Get("/health", h.Health)
}

func (h *SandboxHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.TemplateName == "" {
		req.TemplateName = "claude-workspace"
	}

	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "name query param required", http.StatusBadRequest)
		return
	}

	if err := h.Client.CreateClaim(r.Context(), name, h.Namespace, req.TemplateName); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"name": name, "namespace": h.Namespace})
}

func (h *SandboxHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, err := h.Client.ListClaims(r.Context(), h.Namespace)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"sandboxes": claims})
}

func (h *SandboxHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	status, err := h.Client.GetStatus(r.Context(), name, h.Namespace)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (h *SandboxHandler) GetPod(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	status, err := h.Client.GetStatus(r.Context(), name, h.Namespace)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if status.SandboxName == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sandbox not created yet"})
		return
	}
	podName, err := h.Client.GetPodName(r.Context(), status.SandboxName, h.Namespace)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if podName == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pod not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"podName": podName, "namespace": h.Namespace})
}

func (h *SandboxHandler) Delete(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.Client.DeleteClaim(r.Context(), name, h.Namespace); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *SandboxHandler) InjectEnv(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var req envReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if err := h.Client.InjectEnv(r.Context(), name, h.Namespace, req.SSHKeys, req.APIKey, req.APIBase, req.ExtraEnv); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *SandboxHandler) Wake(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.TemplateName == "" {
		req.TemplateName = "claude-workspace"
	}

	if err := h.Client.CreateClaim(r.Context(), name, h.Namespace, req.TemplateName); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *SandboxHandler) WaitForReady(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	ready, err := h.Client.WaitForReady(r.Context(), name, h.Namespace, 120*time.Second)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ready": ready})
}

func (h *SandboxHandler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *SandboxHandler) SSHRelay(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	// Resolve claim → sandbox → pod IP
	status, err := h.Client.GetStatus(r.Context(), name, h.Namespace)
	if err != nil {
		http.Error(w, "claim not found", http.StatusNotFound)
		return
	}
	if status.SandboxName == "" {
		http.Error(w, "sandbox not created yet", http.StatusNotFound)
		return
	}
	podIP, err := h.Client.GetPodIP(r.Context(), status.SandboxName, h.Namespace)
	if err != nil {
		http.Error(w, "pod not found", http.StatusNotFound)
		return
	}

	// Upgrade to WebSocket
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// Dial pod SSH via TCP
	tcpConn, err := net.DialTimeout("tcp", podIP+":22", 10*time.Second)
	if err != nil {
		log.Printf("tcp dial to %s:22 failed: %v", podIP, err)
		return
	}
	defer tcpConn.Close()

	log.Printf("SSH relay: %s → %s:22", name, podIP)

	// Bidirectional copy: WebSocket ↔ TCP
	done := make(chan struct{}, 2)

	// WebSocket → TCP
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if _, err := tcpConn.Write(msg); err != nil {
				return
			}
		}
	}()

	// TCP → WebSocket
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 32*1024)
		for {
			n, err := tcpConn.Read(buf)
			if err != nil {
				return
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				return
			}
		}
	}()

	<-done
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
