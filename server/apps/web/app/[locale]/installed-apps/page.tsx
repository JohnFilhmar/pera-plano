import type { Metadata } from "next";
import { getConfig } from "@peraplano/common";
import { InstalledAppsPage } from "@/components/pages/installed_apps_page";
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
    title: `${messages.installedApps.title} — ${messages.meta.siteName}`,
    alternates: { canonical: `${getConfig().publicBaseUrl}/${locale}/installed-apps` },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: "en" }> }) {
  const { locale } = await params;
  const messages = getMessages(locale);
  return (
    <DocumentShell messages={messages} locale={locale} path="/installed-apps">
      <InstalledAppsPage messages={messages} config={getConfig()} />
    </DocumentShell>
  );
}
