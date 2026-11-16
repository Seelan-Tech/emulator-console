import { S3Objects } from "@/features/s3/objects";

export default async function BucketPage({
  params,
  searchParams,
}: {
  params: Promise<{ bucket: string }>;
  searchParams: Promise<{ prefix?: string }>;
}) {
  const { bucket } = await params;
  const { prefix } = await searchParams;
  return <S3Objects bucket={decodeURIComponent(bucket)} prefix={prefix ?? ""} />;
}
