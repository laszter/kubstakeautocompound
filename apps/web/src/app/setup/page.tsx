import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell, SystemNotReadyAlert } from "@/components/auth-shell";
import { getAdminCredentialState } from "@/lib/auth";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "ตั้งรหัสผ่านผู้ดูแล · KUB Stake Auto-Compound" };

export default async function SetupPage() {
  const credential = await getAdminCredentialState();
  if (credential === "set") redirect("/login");

  // Unknown state: never show the form, a password may already exist.
  if (credential === "unavailable") {
    return (
      <AuthShell title="ตั้งรหัสผ่านผู้ดูแล" description="ยังตรวจสถานะรหัสผ่านไม่ได้ จึงยังตั้งรหัสผ่านไม่ได้">
        <SystemNotReadyAlert />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="ตั้งรหัสผ่านผู้ดูแล"
      description="ยังไม่มีรหัสผ่านในระบบ ตั้งครั้งเดียว แล้วครั้งต่อไปใช้รหัสนี้เข้าสู่ระบบ"
    >
      <SetupForm />
    </AuthShell>
  );
}
