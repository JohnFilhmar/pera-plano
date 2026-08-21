import type { Metadata } from "next";
import { getConfig } from "@peraplano/common";
import { SupportPage } from "@/components/pages/support_page";
import { getMessages } from "@/messages/index";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: "en" }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const messages = getMessages(locale);
  return {
    title: `${messages.support.title} — ${messages.meta.siteName}`,
    alternates: { canonical: `${getConfig().publicBaseUrl}/${locale}/support` },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: "en" }> }) {
  const { locale } = await params;
  return <SupportPage messages={getMessages(locale)} config={getConfig()} />;
}
