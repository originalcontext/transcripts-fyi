import { LoginForm } from "@/app/login/login-form";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/" } = await searchParams;
  return (
    <main className="mx-auto max-w-sm space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">transcripts.fyi</h1>
        <p className="text-sm text-neutral-500">Private preview — enter your invite code.</p>
      </header>
      <LoginForm next={next} />
    </main>
  );
}
