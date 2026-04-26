import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appRoutes } from "@/lib/routes";

const authTokenCookieKey = "gympal-access-token";

export function getServerAuthToken() {
  return cookies().get(authTokenCookieKey)?.value;
}

export function requireServerAuthToken() {
  const token = getServerAuthToken();

  if (!token) {
    redirect(appRoutes.login);
  }

  return token;
}
