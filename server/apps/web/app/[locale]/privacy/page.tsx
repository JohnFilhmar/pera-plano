import type { Metadata } from "next";
import { getConfig } from "@peraplano/common";
import { PrivacyPage } from "@/components/pages/privacy_page";
import { DocumentShell } from "@/components/chrome/document_shell";
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
  const messages = getMessages(locale);
  return (
    <DocumentShell messages={messages} locale={locale} path="/privacy">
      <PrivacyPage messages={messages} config={getConfig()} />
    </DocumentShell>
  );
}
