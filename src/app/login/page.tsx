import { LoginForm } from "@/app/login/login-form";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string }>;
}) {
  const { next = "/", invite = "" } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">transcripts.fyi</h1>
          <p className="text-neutral-500">Understand a company through its earnings calls.</p>
        </header>
        <LoginForm next={next} invite={invite} />
      </div>
    </main>
  );
}
