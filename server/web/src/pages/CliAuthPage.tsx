import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import API from "@/lib/api";

export function CliAuthPage() {
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const port = params.get("port");
  const state = params.get("state");

  // Validate session on mount
  useState(() => {
    API("/api/auth/status")
      .then((r) => {
        if (!r.ok) {
          // Not logged in — redirect to login, then back here
          const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login?next=${returnTo}`;
          return;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${returnTo}`;
      });
  });

  const authorize = async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await API("/api/auth/cli-token", { method: "POST" });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Failed to generate token");
        setLoading(false);
        return;
      }

      // Send token to CLI callback via redirect (avoids Private Network Access blocking)
      const callbackUrl = `http://localhost:${port}?token=${encodeURIComponent(data.token)}&state=${encodeURIComponent(state!)}`;
      window.location.href = callbackUrl;
    } catch {
      setError("Authorization failed");
    } finally {
      setLoading(false);
    }
  };

  if (authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-96 text-center p-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">Authorized!</h2>
          <p className="text-sm text-muted-foreground mt-2">You can close this tab and return to your terminal.</p>
        </Card>
      </div>
    );
  }

  if (!user) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-96">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Authorize Talos CLI</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            <span className="font-medium">{user.email}</span> — allow Talos CLI to access your account?
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
            <p><span className="text-muted-foreground">Application:</span> Talos CLI</p>
            <p><span className="text-muted-foreground">Permissions:</span> Full account access</p>
          </div>
          <Button className="w-full" onClick={authorize} disabled={loading}>
            {loading ? "Authorizing..." : "Authorize"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
