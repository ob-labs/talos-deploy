import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import API from "@/lib/api";

interface LoginPageProps {
  onLogin: (role: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Support redirect after login (e.g., back to /auth/cli)
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next") || "/";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const resp = await API("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (!resp.ok) return setError(data.error || "Login failed");

    // Cookie is set by the server. Redirect if coming from CLI auth.
    if (next !== "/") {
      window.location.href = next;
      return;
    }
    onLogin(data.user.role);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-80">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Talos Portal</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full">Login</Button>
            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <a href="/register" className="text-primary hover:underline">Register</a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
