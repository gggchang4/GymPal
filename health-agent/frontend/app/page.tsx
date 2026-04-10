import { redirect } from "next/navigation";
import { appRoutes } from "@/lib/routes";

export default function HomePage() {
  redirect(appRoutes.chat);
}

