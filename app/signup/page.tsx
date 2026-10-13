import type { Metadata } from "next";
import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";
import AuthLayout from "@/components/auth/AuthLayout";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthLayout title="Create your account" subtitle="Keep your stats, avatar, boards and wallet on every device. Your guest games carry over.">
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </AuthLayout>
  );
}
