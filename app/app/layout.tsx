import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { ReactNode } from "react";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: headers(),
    query: { disableRefresh: true },
  });

  if (!session) {
    redirect("/sign-in");
  }

  return <>{children}</>;
}
