import { notFound } from "next/navigation";
import { getConfig } from "@peraplano/common";
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
      {/* SiteHeader and SiteFooter arrive in Task 5. */}
      <main id="content">{children}</main>
      <span hidden data-locale={locale} data-base-url={config.publicBaseUrl}>
        {messages.meta.siteName}
      </span>
    </>
  );
}
