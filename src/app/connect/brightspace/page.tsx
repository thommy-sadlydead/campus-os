import { SchoolLmsPage } from "@/components/connect/SchoolLmsPage";

// Reading the calendar feed and writing a term's due dates can take a bit.
export const maxDuration = 60;

export default function BrightspacePage() {
  return <SchoolLmsPage provider="brightspace" />;
}
