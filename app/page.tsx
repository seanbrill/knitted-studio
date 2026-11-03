import { Studio } from "@/components/Studio";
import { SAMPLE_PATTERN, SAMPLE_SWATCH } from "@/lib/sample";

export default function Page() {
  return <Studio pattern={SAMPLE_PATTERN} swatch={SAMPLE_SWATCH} />;
}
