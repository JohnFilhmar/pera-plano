import type { Metadata } from "next";
import { getConfig } from "@peraplano/common";
import { PrivacyPage } from "@/components/pages/privacy_page";
import { getMessages } from "@/messages/index";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: "en" }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const messages = getMessages(locale);
  return {
    title: `${messages.privacy.title} — ${messages.meta.siteName}`,
    alternates: { canonical: `${getConfig().publicBaseUrl}/${locale}/privacy` },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: "en" }> }) {
  const { locale } = await params;
  return <PrivacyPage messages={getMessages(locale)} config={getConfig()} />;
}
