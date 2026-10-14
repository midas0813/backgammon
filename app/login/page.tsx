import type { Metadata } from "next";
import AuthLayout from "@/components/auth/AuthLayout";
import ConnectPanel from "@/components/auth/ConnectPanel";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthLayout title="Welcome back" subtitle="Connect the wallet you signed up with to continue.">
      <ConnectPanel />
    </AuthLayout>
  );
}
