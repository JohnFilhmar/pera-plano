import type { Metadata } from "next";
import { getConfig } from "@peraplano/common";
import { BetaPage } from "@/components/pages/beta_page";
import { getMessages } from "@/messages/index";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: "en" }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const messages = getMessages(locale);
  return {
    title: `${messages.beta.title} — ${messages.meta.siteName}`,
    description: messages.beta.lede,
    alternates: { canonical: `${getConfig().publicBaseUrl}/${locale}/beta` },
  };
}

/**
 * Not wrapped in DocumentShell. The other five routes are documents and get a contents
 * rail; this one is a single argument ending in a form, and a table of contents beside it
 * would invite the reader to skip the part that says what the work involves.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "en" }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const submitted = typeof query["submitted"] === "string" ? query["submitted"] : undefined;
  return (
    <BetaPage
      messages={getMessages(locale)}
      config={getConfig()}
      locale={locale}
      submitted={submitted}
    />
  );
}
