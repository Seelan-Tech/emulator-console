import { redirect } from "next/navigation";

import { SecretView } from "@/features/secrets/secret-view";

// The name travels as a query parameter: secret names often contain "/", which dynamic segments mishandle.
export default async function SecretPage({
  params,
  searchParams,
}: {
  params: Promise<{ tid: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { tid } = await params;
  const { name } = await searchParams;
  if (!name) redirect(`/t/${tid}/secrets`);
  return <SecretView name={name} />;
}
