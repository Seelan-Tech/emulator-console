import { LambdaFunctionView } from "@/features/lambda/function-view";

export default async function LambdaFunctionPage({ params }: { params: Promise<{ fn: string }> }) {
  const { fn } = await params;
  return <LambdaFunctionView fn={decodeURIComponent(fn)} />;
}
