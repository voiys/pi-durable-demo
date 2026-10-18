import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function submit(mode: "in" | "up", form: FormData) {
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const { error } =
      mode === "in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: email.split("@")[0] });
    if (error) return setError(error.message ?? error.statusText);
    await navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>pi durable</CardTitle>
          <CardDescription>Sign in or create an account with email and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
              void submit(submitter.value as "in" | "up", new FormData(e.currentTarget));
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" minLength={8} required />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" value="in" className="flex-1">Sign in</Button>
              <Button type="submit" value="up" variant="outline" className="flex-1">Sign up</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
