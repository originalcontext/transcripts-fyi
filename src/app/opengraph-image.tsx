import { OG_SIZE, shareImage } from "@/lib/og/mark";

export const alt = "transcripts.fyi — understand a company through its earnings calls";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return shareImage({
    title: "Understand a company through its earnings calls.",
    description: "Twenty quarters, read one at a time, then drawn together into one interactive explainer of how the story actually changed.",
  });
}
