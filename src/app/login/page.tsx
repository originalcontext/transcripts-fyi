import type { Metadata } from "next";

import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string }>;
}) {
  const { next = "/", invite = "" } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold tracking-tight">transcripts.fyi</CardTitle>
          <CardDescription>Understand a company through its earnings calls.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} invite={invite} />
        </CardContent>
        <CardFooter className="justify-center text-xs text-muted-foreground">Private preview · invite only</CardFooter>
      </Card>
    </main>
  );
}
