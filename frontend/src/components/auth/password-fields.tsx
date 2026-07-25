"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, X } from "lucide-react";

/** Mirror of the backend password policy (passwords.validate_password) so the
 *  user gets instant feedback; the server is still the authority. */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordIssue(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (new Set(password).size < 5) {
    return "Password must use at least 5 different characters.";
  }
  if (confirm && password !== confirm) {
    return "The two passwords don't match.";
  }
  return null;
}

/**
 * The "set a new password" pair (password + confirm) with live requirement
 * hints. Shared by the accept-invite and reset-password pages so the rules and
 * look are identical in both.
 */
export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  onSubmit,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  onSubmit?: () => void;
}) {
  const longEnough = password.length >= MIN_PASSWORD_LENGTH;
  const varied = new Set(password).size >= 5;
  const matches = confirm.length > 0 && password === confirm;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          placeholder="••••••••••••"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type="password"
          placeholder="••••••••••••"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
        />
      </div>
      <ul className="space-y-1 text-xs">
        <Req ok={longEnough}>At least {MIN_PASSWORD_LENGTH} characters</Req>
        <Req ok={varied}>Uses at least 5 different characters</Req>
        <Req ok={matches}>Both passwords match</Req>
      </ul>
    </div>
  );
}

function Req({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li
      className={
        ok ? "flex items-center gap-1.5 text-success" : "flex items-center gap-1.5 text-foreground-subtle"
      }
    >
      {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {children}
    </li>
  );
}
