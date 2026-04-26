import { redirect } from "next/navigation";
import { appRoutes } from "@/lib/routes";
import { getServerAuthToken } from "@/lib/server-auth";

export default function HomePage() {
  redirect(getServerAuthToken() ? appRoutes.chat : appRoutes.login);
}

