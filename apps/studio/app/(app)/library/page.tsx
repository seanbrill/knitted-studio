import { Suspense } from "react";
import { LibraryView } from "@/components/LibraryView";

export const metadata = { title: "Library" };

export default function Page() {
  return <Suspense><LibraryView /></Suspense>;
}
