import { Suspense } from "react";

import { Essay } from "@/components/essay";
import type { Story } from "@/lib/types";
import storyJson from "@/data/red/story.json";

export const metadata = {
  title: "Who keeps coming back — Pulp Analytics",
  description:
    "Who gets billed together in horror, and who keeps directing the same people. A Pulp Analytics essay.",
};

export default function RedPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#07080b]" />}>
      <Essay story={storyJson as Story} />
    </Suspense>
  );
}
