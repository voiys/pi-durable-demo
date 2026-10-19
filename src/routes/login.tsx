import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({ component: Login });

/** One card on the canvas (DESIGN.md: a lifted surface, 12px radius, hairline): email and password, then sign in or
 * create the account with the same two fields. Errors are said in words under the fields. */
function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"in" | "up" | null>(null);

  async function submit(mode: "in" | "up", form: FormData) {
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(mode);
    setError(null);
    const { error } =
      mode === "in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: email.split("@")[0] });
    if (error) return setError(error.message ?? error.statusText), setBusy(null);
    await navigate({ to: "/" });
  }

  return (
    <main className="bg-canvas flex min-h-svh items-center justify-center p-4">
      <Card className="bg-surface w-full max-w-sm gap-6 rounded-lg border-0 py-8 shadow-composer">
        <CardHeader className="gap-1 px-6 text-center">
          <CardTitle>
            <h1 className="text-2xl font-semibold">pi durable</h1>
          </CardTitle>
          <CardDescription className="text-base text-balance">Hand research to a few tireless bots. Sign in to see what they found.</CardDescription>
        </CardHeader>
        <CardContent className="px-6">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
              void submit(submitter.value as "in" | "up", new FormData(e.currentTarget));
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input id="email" name="email" type="email" autoComplete="email" autoFocus required aria-invalid={!!error} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" minLength={8} required aria-invalid={!!error} aria-describedby="password-hint" />
              <p id="password-hint" className="text-muted-foreground text-sm">
                At least 8 characters.
              </p>
            </div>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2 pt-2">
              <Button type="submit" value="in" disabled={busy !== null}>
                {busy === "in" ? "Signing in…" : "Sign in"}
              </Button>
              <Button type="submit" value="up" variant="ghost" disabled={busy !== null}>
                {busy === "up" ? "Creating account…" : "Create account"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
