import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth-server";
import type { ReactNode } from "react";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const isAuth = await isAuthenticated();

  if (!isAuth) {
    redirect("/sign-in");
  }

  return <>{children}</>;
}
