import {
  Bell,
  CalendarClock,
  FunctionSquare,
  HardDrive,
  Inbox,
  KeyRound,
  KeySquare,
  Layers,
  Lock,
  type LucideIcon,
  ScrollText,
  Server,
  Settings2,
  Shield,
  Table2,
  Waves,
  Workflow,
} from "lucide-react";

import type { ServiceName } from "@/lib/aws";

export type ServiceMeta = {
  id: ServiceName;
  label: string;
  group: "Storage" | "Messaging" | "Compute" | "Security" | "Management";
  icon: LucideIcon;
  /** Route segment of the native screen under /t/:tid, once ported. */
  native?: string;
};

// Services with a `native` route have a dedicated screen; every service is reachable through the generic runner (/s/:svc).
export const SERVICES: ServiceMeta[] = [
  { id: "s3", label: "S3", group: "Storage", icon: HardDrive, native: "s3" },
  { id: "dynamodb", label: "DynamoDB", group: "Storage", icon: Table2, native: "dynamodb" },
  { id: "sqs", label: "SQS", group: "Messaging", icon: Inbox, native: "sqs" },
  { id: "sns", label: "SNS", group: "Messaging", icon: Bell, native: "sns" },
  { id: "eventbridge", label: "EventBridge", group: "Messaging", icon: CalendarClock, native: "eventbridge" },
  { id: "kinesis", label: "Kinesis", group: "Messaging", icon: Waves },
  { id: "lambda", label: "Lambda", group: "Compute", icon: FunctionSquare, native: "lambda" },
  { id: "sfn", label: "Step Functions", group: "Compute", icon: Workflow },
  { id: "ec2", label: "EC2", group: "Compute", icon: Server },
  { id: "secretsmanager", label: "Secrets Manager", group: "Security", icon: Lock, native: "secrets" },
  { id: "kms", label: "KMS", group: "Security", icon: KeySquare },
  { id: "iam", label: "IAM", group: "Security", icon: Shield },
  { id: "sts", label: "STS", group: "Security", icon: KeyRound },
  { id: "ssm", label: "SSM", group: "Management", icon: Settings2 },
  { id: "logs", label: "CloudWatch Logs", group: "Management", icon: ScrollText },
  { id: "cloudformation", label: "CloudFormation", group: "Management", icon: Layers },
];

export const GROUPS = ["Storage", "Messaging", "Compute", "Security", "Management"] as const;
export const serviceMeta = (id: string) => SERVICES.find((s) => s.id === id);

/** Where a service's link goes inside a target. */
export function serviceHref(base: string, s: ServiceMeta): string {
  return s.native ? `${base}/${s.native}` : `${base}/s/${s.id}`;
}

export const REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "eu-west-2",
  "eu-central-1",
  "ap-southeast-1",
  "ap-northeast-1",
];
