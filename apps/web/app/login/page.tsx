import type { Metadata } from "next";
import { NEXT_PARAM } from "@/lib/auth/constants";
import { SIGN_IN_ERROR_PARAM } from "@/lib/auth/sign-in-errors";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * `?next=` and `?error=` are read here, on the server, and handed to the form as props: the page is rendered with the
 * brand frame and the form in its HTML (a client-side `useSearchParams` in the form bails the whole tree out to client
 * rendering, so nothing painted until the JavaScript had loaded, and a sign-in error was invisible until hydration).
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return <LoginForm nextParam={first(params[NEXT_PARAM])} errorParam={first(params[SIGN_IN_ERROR_PARAM])} />;
}
