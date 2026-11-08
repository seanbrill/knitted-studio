import { Suspense } from "react";
import { StockView } from "@/components/StockView";

export const metadata = { title: "Stock" };

export default function Page() {
  return <Suspense><StockView /></Suspense>;
}
