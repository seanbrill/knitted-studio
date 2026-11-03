import { notFound } from "next/navigation";
import { KitView } from "@/components/KitView";

// A living specimen of every component in every state. Development only: it is
// not a product page, and the production build answers 404.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <KitView />;
}
