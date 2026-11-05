import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { AuthShell, SystemNotReadyAlert } from "@/components/auth-shell";
import { getAdminCredentialState, hasSession } from "@/lib/auth";
import { safeErrorCode } from "@/lib/safe-error";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "เข้าสู่ระบบ · KUB Stake Auto-Compound" };

export default async function LoginPage() {
  const credential = await getAdminCredentialState();
  if (credential === "unset") redirect("/setup");

  let loggedIn = false;
  if (credential === "set") {
    try {
      loggedIn = await hasSession();
    } catch (err) {
      unstable_rethrow(err);
      // env/session misconfigured → still show the form; the login action reports the problem.
      console.error(`[login] reading session failed (${safeErrorCode(err)})`);
    }
  }
  if (loggedIn) redirect("/");

  return (
    <AuthShell
      title="เข้าสู่ระบบ"
      description="เข้าสู่ระบบเพื่อจัดการ wallet และ auto-compound บน KUB Chain (mainnet)"
    >
      {credential === "unavailable" ? <SystemNotReadyAlert /> : null}
      <LoginForm />
    </AuthShell>
  );
}
