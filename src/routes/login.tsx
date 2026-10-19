import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { FADE } from "@/lib/motion";

export const Route = createFileRoute("/login")({ component: Login });

/** The card fades in once (FADE: opacity, 200ms ease-out): opacity only, so it is the same under reduced motion. */
const MotionCard = motion.create(Card);

type Problems = { email?: string; password?: string; form?: string };

/** What's wrong with the two fields before asking the server; nothing means they're worth sending. */
function check(email: string, password: string): Problems {
  return {
    email: /^\S+@\S+\.\S+$/.test(email) ? undefined : "Enter your email, like name@example.com.",
    password: password.length >= 8 ? undefined : "Use at least 8 characters.",
  };
}

/** One card on the canvas (DESIGN.md: a lifted surface, 12px radius, hairline): email and password, then sign in or
 * create the account with the same two fields. Checked on submit; each problem is said under its field, which takes
 * focus; a refusal from the server is said above the buttons. */
function Login() {
  const navigate = useNavigate();
  const [problems, setProblems] = useState<Problems>({});
  const [busy, setBusy] = useState<"in" | "up" | null>(null);

  async function submit(mode: "in" | "up", form: HTMLFormElement) {
    const data = new FormData(form);
    const email = String(data.get("email")).trim();
    const password = String(data.get("password"));
    const found = check(email, password);
    const first = (["email", "password"] as const).find((k) => found[k]);
    setProblems(found);
    if (first) return (form.elements.namedItem(first) as HTMLInputElement).focus();
    setBusy(mode);
    const { error } =
      mode === "in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: email.split("@")[0] });
    if (error) return setProblems({ form: error.message ?? error.statusText }), setBusy(null);
    await navigate({ to: "/" });
  }

  const invalid = (key: "email" | "password") => ({
    "aria-invalid": problems[key] ? true : undefined,
    "aria-describedby": problems[key] ? `${key}-error` : key === "password" ? "password-hint" : undefined,
    onChange: () => problems[key] && setProblems((p) => ({ ...p, [key]: undefined })),
  });

  return (
    <main className="bg-canvas flex min-h-svh items-center justify-center p-4">
      <MotionCard variants={FADE} initial="initial" animate="animate" className="bg-surface shadow-composer w-full max-w-sm gap-6 border-transparent py-8">
        <CardHeader className="gap-1 px-6 text-center">
          <CardTitle>
            <h1 className="text-2xl font-semibold">pi durable</h1>
          </CardTitle>
          <CardDescription className="text-base text-balance">Hand research to a few tireless bots. Sign in to see what they found.</CardDescription>
        </CardHeader>
        <CardContent className="px-6">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
              void submit(submitter.value as "in" | "up", e.currentTarget);
            }}
          >
            <FieldGroup className="gap-5">
              <Field data-invalid={problems.email ? true : undefined}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="email" autoFocus placeholder="name@example.com" {...invalid("email")} />
                <FieldError id="email-error">{problems.email}</FieldError>
              </Field>
              <Field data-invalid={problems.password ? true : undefined}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" name="password" type="password" autoComplete="current-password" {...invalid("password")} />
                {problems.password ? <FieldError id="password-error">{problems.password}</FieldError> : <FieldDescription id="password-hint">At least 8 characters.</FieldDescription>}
              </Field>
              <FieldError>{problems.form}</FieldError>
              <div className="flex flex-col gap-2 pt-1">
                <Button type="submit" value="in" disabled={busy !== null}>
                  {busy === "in" ? "Signing in…" : "Sign in"}
                </Button>
                <Button type="submit" value="up" variant="ghost" disabled={busy !== null}>
                  {busy === "up" ? "Creating account…" : "Create account"}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </MotionCard>
    </main>
  );
}
