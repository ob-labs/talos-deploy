import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import API from "@/lib/api";

type ActionState = "idle" | "loading" | "confirm";

export function UserDashboard() {
  const [sandboxes, setSandboxes] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useState(() => {
    (async () => {
      const [statusResp, listResp] = await Promise.all([
        API("/api/auth/status"),
        API("/api/sandboxes"),
      ]);
      const statusData = await statusResp.json();
      const listData = await listResp.json();
      setUser(statusData.user);
      setSandboxes(listData.sandboxes || []);
      setLoading(false);
    })();
  });

  const [actionState, setActionState] = useState<{ id: number; type: "sleep" | "delete"; phase: ActionState } | null>(null);

  const refresh = async () => {
    const resp = await API("/api/sandboxes");
    const data = await resp.json();
    setSandboxes(data.sandboxes || []);
  };

  const handleAction = async (id: number, type: "sleep" | "delete") => {
    if (actionState?.id === id && actionState.type === type && actionState.phase === "confirm") {
      // Confirmed — execute
      setActionState({ id, type, phase: "loading" });
      if (type === "sleep") {
        await API(`/api/sandboxes/${id}/sleep`, { method: "POST" });
      } else {
        await API(`/api/sandboxes/${id}`, { method: "DELETE" });
      }
      setActionState(null);
      await refresh();
      return;
    }
    // First click — ask for confirmation
    setActionState({ id, type, phase: "confirm" });
  };

  const cancelAction = () => setActionState(null);

  const logout = async () => {
    await API("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;

  if (user?.status === "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-96 text-center p-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">Awaiting Approval</h2>
          <p className="text-sm text-muted-foreground mt-2">Your account is pending admin approval. You'll be able to use sandboxes once approved.</p>
          <Button variant="ghost" onClick={logout} className="mt-4">Logout</Button>
        </Card>
      </div>
    );
  }

  if (user?.status === "rejected") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-96 text-center p-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-destructive">Access Denied</h2>
          <p className="text-sm text-muted-foreground mt-2">Your account was not approved. Please contact an administrator.</p>
          <Button variant="ghost" onClick={logout} className="mt-4">Logout</Button>
        </Card>
      </div>
    );
  }

  const sb = sandboxes[0]; // One user = one sandbox

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-border px-6 py-3 flex items-center gap-4">
        <h1 className="font-bold text-lg">Talos Portal</h1>
        <span className="text-sm text-muted-foreground ml-auto">{user?.email}</span>
        <Button variant="ghost" size="sm" onClick={logout}>Logout</Button>
      </nav>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h2 className="text-lg font-semibold mb-4">My Sandbox</h2>

        {sb ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="font-mono text-sm">{sb.project}</span>
                <Badge variant={sb.status === "active" ? "success" : "secondary"}>
                  {sb.status === "active" ? "● Active" : "● Sleeping"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Claim Name</dt>
                  <dd className="font-mono text-xs mt-1">{sb.sandboxclaim_name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-1 capitalize">{sb.status}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last Active</dt>
                  <dd className="font-mono text-xs mt-1">{sb.last_active_at}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="font-mono text-xs mt-1">{sb.created_at}</dd>
                </div>
              </dl>

              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
                {sb.status === "active" && (
                  <ActionButton
                    id={sb.id}
                    type="sleep"
                    label="Sleep"
                    loadingLabel="Sleeping…"
                    confirmLabel="Confirm Sleep?"
                    actionState={actionState}
                    onAction={handleAction}
                    onCancel={cancelAction}
                  />
                )}
                <ActionButton
                  id={sb.id}
                  type="delete"
                  label="Delete"
                  loadingLabel="Deleting…"
                  confirmLabel="Confirm Delete?"
                  variant="destructive"
                  actionState={actionState}
                  onAction={handleAction}
                  onCancel={cancelAction}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">
              No sandbox yet. Use <code className="bg-muted px-1.5 py-0.5 rounded text-xs">tt up</code> to create one.
            </p>
          </Card>
        )}

        <p className="text-xs text-muted-foreground mt-4">
          Manage your sandbox from CLI: <code className="bg-muted px-1.5 py-0.5 rounded">tt up</code>
        </p>
      </div>
    </div>
  );
}

function ActionButton({
  id, type, label, loadingLabel, confirmLabel, variant, actionState, onAction, onCancel,
}: {
  id: number;
  type: "sleep" | "delete";
  label: string;
  loadingLabel: string;
  confirmLabel: string;
  variant?: "destructive" | "outline";
  actionState: { id: number; type: "sleep" | "delete"; phase: ActionState } | null;
  onAction: (id: number, type: "sleep" | "delete") => void;
  onCancel: () => void;
}) {
  const isActive = actionState?.id === id && actionState?.type === type;
  const isConfirming = isActive && actionState.phase === "confirm";
  const isLoading = isActive && actionState.phase === "loading";

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant={isConfirming ? "destructive" : (variant ?? "outline")}
        size="sm"
        disabled={isLoading || (actionState && !isActive)}
        onClick={() => onAction(id, type)}
      >
        {isLoading ? loadingLabel : isConfirming ? confirmLabel : label}
      </Button>
      {isConfirming && (
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      )}
    </div>
  );
}
