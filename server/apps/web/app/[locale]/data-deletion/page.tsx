import type { Metadata } from "next";
import { getConfig } from "@peraplano/common";
import { DataDeletionPage } from "@/components/pages/data_deletion_page";
import { getMessages } from "@/messages/index";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: "en" }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const messages = getMessages(locale);
  return {
    title: `${messages.dataDeletion.title} — ${messages.meta.siteName}`,
    alternates: { canonical: `${getConfig().publicBaseUrl}/${locale}/data-deletion` },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: "en" }> }) {
  const { locale } = await params;
  return <DataDeletionPage messages={getMessages(locale)} config={getConfig()} />;
}
