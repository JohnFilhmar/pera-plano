import { getMessages } from "@/messages/index";

export default async function HomePage({ params }: { params: Promise<{ locale: "en" }> }) {
  const { locale } = await params;
  return <h1>{getMessages(locale).meta.siteName}</h1>;
}
