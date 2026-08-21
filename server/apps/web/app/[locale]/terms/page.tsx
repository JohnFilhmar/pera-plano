import type { Metadata } from "next";
import { getConfig } from "@peraplano/common";
import { TermsPage } from "@/components/pages/terms_page";
import { getMessages } from "@/messages/index";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: "en" }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const messages = getMessages(locale);
  return {
    title: `${messages.terms.title} — ${messages.meta.siteName}`,
    alternates: { canonical: `${getConfig().publicBaseUrl}/${locale}/terms` },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: "en" }> }) {
  const { locale } = await params;
  return <TermsPage messages={getMessages(locale)} config={getConfig()} />;
}
