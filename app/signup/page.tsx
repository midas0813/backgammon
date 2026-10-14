import type { Metadata } from "next";
import AuthLayout from "@/components/auth/AuthLayout";
import ConnectPanel from "@/components/auth/ConnectPanel";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthLayout title="Create your account" subtitle="Your wallet is your account. Connect it and sign once — that's it.">
      <ConnectPanel />
    </AuthLayout>
  );
}
