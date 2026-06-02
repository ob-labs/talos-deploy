import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import API from "@/lib/api";

export function AdminDashboard() {
  const [tab, setTab] = useState<"users" | "sandboxes" | "usage">("users");

  const logout = async () => {
    await API("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-border px-6 py-3 flex items-center gap-4">
        <h1 className="font-bold text-lg">Talos Portal</h1>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="sandboxes">Sandboxes</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={logout}>Logout</Button>
      </nav>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {tab === "users" && <UsersTab />}
        {tab === "sandboxes" && <SandboxesTab />}
        {tab === "usage" && <UsageTab />}
      </div>
    </div>
  );
}

function UsersTab() {
  const [result, loading, load] = useFetch<{ users: any[] }>("/api/admin/users");
  if (loading || !result) return <p className="text-muted-foreground">Loading...</p>;
  const users = result.users || [];
  const pending = users.filter((u) => u.status === "pending");
  const others = users.filter((u) => u.status !== "pending");

  const approve = async (id: number) => {
    await API(`/api/admin/users/${id}/approve`, { method: "PUT" });
    load();
  };
  const reject = async (id: number) => {
    await API(`/api/admin/users/${id}/reject`, { method: "PUT" });
    load();
  };

  return (
    <div className="space-y-8">
      {pending.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Pending Approval ({pending.length})</h2>
          <div className="bg-white rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{u.created_at}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white mr-1" onClick={() => approve(u.id)}>Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => reject(u.id)}>Reject</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      <div>
        <h2 className="text-lg font-semibold mb-3">All Users ({users.length})</h2>
        <div className="bg-white rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>API Key</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {others.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell className="capitalize">{u.role}</TableCell>
                  <TableCell>
                    <Badge variant={u.status === "approved" ? "success" : u.status === "pending" ? "warning" : "destructive"}>
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {u.api_key ? u.api_key.slice(0, 14) + "…" : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function SandboxesTab() {
  const [result, loading] = useFetch<{ sandboxes: any[] }>("/api/admin/sandboxes");
  if (loading || !result) return <p className="text-muted-foreground">Loading...</p>;
  const sandboxes = result.sandboxes || [];

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">All Sandboxes ({sandboxes.length})</h2>
      <div className="bg-white rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sandboxes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No sandboxes</TableCell>
              </TableRow>
            ) : sandboxes.map((sb) => (
              <TableRow key={sb.id}>
                <TableCell className="font-mono text-xs">{sb.sandboxclaim_name}</TableCell>
                <TableCell>
                  {sb.user_email ? (
                    <span className="text-sm">{sb.user_name} <span className="text-muted-foreground text-xs">({sb.user_email})</span></span>
                  ) : (
                    <span className="text-muted-foreground">User #{sb.user_id}</span>
                  )}
                </TableCell>
                <TableCell>{sb.project}</TableCell>
                <TableCell>
                  <Badge variant={sb.status === "active" ? "success" : "secondary"}>
                    {sb.status}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{sb.last_active_at}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function UsageTab() {
  const [result, loading] = useFetch<{ usage: any[] }>("/api/admin/usage");
  if (loading || !result) return <p className="text-muted-foreground">Loading...</p>;
  const usage = result.usage || [];

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">API Token Usage</h2>
      <div className="bg-white rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-8">No usage data</TableCell>
              </TableRow>
            ) : usage.map((u) => (
              <TableRow key={u.userId}>
                <TableCell>{u.name}</TableCell>
                <TableCell className="text-right font-mono text-xs">{u.used?.toLocaleString() ?? "—"}</TableCell>
                <TableCell className="text-right font-mono text-xs">{u.remain?.toLocaleString() ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Inline useFetch for admin components (avoids circular imports)
function useFetch2<T>(url: string): [T | null, boolean, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const resp = await API(url);
    const json = await resp.json();
    setData(json);
    setLoading(false);
  };
  useState(() => { load(); });
  return [data, loading, load];
}

// Re-export with the correct name used in components above
function useFetch<T>(url: string): [T | null, boolean, () => void] {
  return useFetch2<T>(url);
}
