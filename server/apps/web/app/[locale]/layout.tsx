import { notFound } from "next/navigation";
import { getConfig } from "@peraplano/common";
import { SiteFooter } from "@/components/chrome/site_footer";
import { SiteHeader } from "@/components/chrome/site_header";
import { SUPPORTED_LOCALES, getMessages, isSupportedLocale } from "@/messages/index";

/**
 * Every page under this segment renders the DPO and support contact in the footer, and
 * those values arrive from the environment at RUNTIME (see the spec's §5.3). Prerendering
 * this subtree would bake the dev "[ REQUIRED: … ]" markers into the image, which a
 * correctly configured production container would then happily serve. Do not remove this.
 */
export const dynamic = "force-dynamic";

export function generateStaticParams(): { locale: string }[] {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const messages = getMessages(locale);
  const config = getConfig();
  return (
    <>
      <SiteHeader messages={messages} locale={locale} localeCount={SUPPORTED_LOCALES.length} />
      <main id="content">{children}</main>
      <SiteFooter messages={messages} contacts={config.contacts} locale={locale} />
    </>
  );
}
