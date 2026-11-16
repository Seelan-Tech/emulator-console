"use client";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useTarget } from "@/components/target-context";
import { callOp } from "@/lib/aws-client";

// JSON-serialized shapes (the SDK's Date fields arrive as ISO strings).
export type Bucket = { Name?: string; CreationDate?: string };
export type S3Object = { Key?: string; Size?: number; LastModified?: string };
type ListPage = {
  Contents?: S3Object[];
  CommonPrefixes?: { Prefix?: string }[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
};

export const PAGE_SIZE = 200;

export function useS3List(bucket: string, prefix: string) {
  const { tid, region } = useTarget();
  return useInfiniteQuery({
    queryKey: [tid, "s3", "ListObjectsV2", bucket, prefix, region],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      callOp<ListPage>(
        tid,
        "s3",
        "ListObjectsV2",
        { Bucket: bucket, Prefix: prefix, Delimiter: "/", MaxKeys: PAGE_SIZE, ContinuationToken: pageParam },
        region,
      ),
    getNextPageParam: (last) => (last.IsTruncated ? last.NextContinuationToken : undefined),
  });
}
