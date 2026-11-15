import { createFileRoute, redirect } from "@tanstack/react-router";

// The store became the Library ("Bibliotecă"); old links and bookmarks keep working.
export const Route = createFileRoute("/_chat/marketplace")({
  beforeLoad: () => {
    throw redirect({ to: "/library", search: {}, replace: true });
  },
});
