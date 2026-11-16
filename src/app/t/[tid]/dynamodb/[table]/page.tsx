import { DynamoTableView } from "@/features/dynamodb/table-view";

export default async function DynamoTablePage({ params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  return <DynamoTableView table={decodeURIComponent(table)} />;
}
