import type { Metadata } from "next";
import { getConfig } from "@peraplano/common";
import { MarketingPage } from "@/components/pages/marketing_page";
import { getMessages } from "@/messages/index";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: "en" }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const messages = getMessages(locale);
  return {
    title: `${messages.meta.siteName} — ${messages.meta.tagline}`,
    description: messages.meta.description,
    alternates: { canonical: `${getConfig().publicBaseUrl}/${locale}` },
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: "en" }> }) {
  const { locale } = await params;
  return <MarketingPage messages={getMessages(locale)} config={getConfig()} locale={locale} />;
}
