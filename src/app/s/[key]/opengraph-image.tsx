import { OG_SIZE, shareImage } from "@/lib/og/mark";
import { companyName } from "@/lib/tickers";

export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key.toUpperCase();
  const name = companyName(key);
  return shareImage({
    eyebrow: key,
    title: name ? `${name}, through five years of earnings calls.` : `${key}, through five years of earnings calls.`,
    description: "Twenty quarters read one at a time, then drawn together into one interactive explainer of how the story changed.",
  });
}
