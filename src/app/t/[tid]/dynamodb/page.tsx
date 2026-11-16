import { DynamoTables } from "@/features/dynamodb/tables";

export const metadata = { title: "DynamoDB" };

export default function DynamoPage() {
  return <DynamoTables />;
}
