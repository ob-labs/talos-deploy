import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import API from "@/lib/api";

interface AccountPageProps {
  onLogout: () => void;
}

export function AccountPage({ onLogout }: AccountPageProps) {
  const [user, setUser] = useState<any>(null);

  useState(() => {
    API("/api/auth/status")
      .then((r) => r.json())
      .then((data) => setUser(data.user))
      .catch(() => onLogout());
  });

  const handleLogout = async () => {
    await API("/api/auth/logout", { method: "POST" }).catch(() => {});
    onLogout();
  };

  const handleSwitchAccount = async () => {
    await API("/api/auth/logout", { method: "POST" }).catch(() => {});
    onLogout();
  };

  if (!user) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-80">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="font-medium">{user.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-medium">{user.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <p className="font-medium capitalize">{user.role}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={handleSwitchAccount}>Switch Account</Button>
            <Button variant="destructive" className="flex-1" onClick={handleLogout}>Logout</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
