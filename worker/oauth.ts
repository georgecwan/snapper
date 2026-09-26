import { z } from "zod";
import {
  cookie,
  cookieName,
  localDev,
  pkceChallenge,
  randomToken,
  readCookie,
  signToken,
  verifyToken,
  type AuthEnv,
} from "./security.ts";

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 302, headers });
}

/** Called only after the HTTP boundary verifies the production configuration. */
export async function beginGitHubSignIn(env: AuthEnv): Promise<Response> {
  const state = randomToken();
  const verifier = randomToken();
  const token = await signToken(
    { kind: "oauth", state, verifier, exp: Math.floor(Date.now() / 1000) + 600 },
    env.SESSION_SECRET!,
  );
  const target = new URL("https://github.com/login/oauth/authorize");
  target.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
  target.searchParams.set(
    "redirect_uri",
    `${new URL(env.APP_ORIGIN!).origin}/api/snapper/auth/github/callback`,
  );
  target.searchParams.set("state", state);
  target.searchParams.set("code_challenge", await pkceChallenge(verifier));
  target.searchParams.set("code_challenge_method", "S256");
  return redirect(target.href, [cookie("oauth", token, false, 600)]);
}

/** A fetch dependency lets local tests exercise the real callback without provider credentials. */
export async function completeGitHubSignIn(
  request: Request,
  env: AuthEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const expired = cookie("oauth", "", false, 0);
  const failed = (message: string) =>
    redirect(`/?authError=${encodeURIComponent(message)}`, [expired]);
  const url = new URL(request.url);
  const token = await verifyToken(
    readCookie(request, cookieName("oauth", false)),
    env.SESSION_SECRET,
  );
  if (
    localDev(request, env) ||
    token?.kind !== "oauth" ||
    token.state !== url.searchParams.get("state") ||
    !url.searchParams.get("code")
  )
    return failed("Sign-in expired. Please try again.");
  try {
    const tokenResult = await fetcher("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: url.searchParams.get("code"),
        code_verifier: token.verifier,
        redirect_uri: `${new URL(env.APP_ORIGIN!).origin}/api/snapper/auth/github/callback`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const exchange = z
      .object({ access_token: z.string().min(1) })
      .safeParse(await tokenResult.json());
    if (!tokenResult.ok || !exchange.success)
      return failed("GitHub sign-in was unsuccessful. Please try again.");
    const userResult = await fetcher("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${exchange.data.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Snapper",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const account = z
      .object({ id: z.number().int().positive() })
      .safeParse(await userResult.json());
    if (!userResult.ok || !account.success)
      return failed("GitHub sign-in was unsuccessful. Please try again.");
    if (String(account.data.id) !== env.OWNER_GITHUB_ID)
      return failed("That GitHub account is not the owner.");
    const owner = await signToken(
      {
        kind: "owner",
        sub: String(account.data.id),
        exp: Math.floor(Date.now() / 1000) + 43_200,
      },
      env.SESSION_SECRET!,
    );
    return redirect("/", [expired, cookie("owner", owner, false, 43_200)]);
  } catch {
    // Provider outages and non-JSON error pages are sign-in failures, not API pages.
    // Do not log the authorization code, provider token or secret on this path.
    return failed("GitHub could not be reached. Please try signing in again.");
  }
}
