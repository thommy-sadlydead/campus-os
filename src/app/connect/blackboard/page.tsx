import { FeedProviderPage } from "@/components/connect/FeedProviderPage";

// Reading the calendar feed and writing a term's due dates can take a bit.
export const maxDuration = 60;

export default function BlackboardPage() {
  return <FeedProviderPage provider="blackboard" />;
}
