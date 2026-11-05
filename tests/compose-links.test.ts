import { describe, expect, it } from "vitest";
import { emailAsText, gmailLink, mailtoLink, outlookLink } from "../src/lib/compose-links";

describe("compose links", () => {
  const email = { to: "it+lms@school.edu", cc: "support@example.com", subject: "Hi & thanks", body: "Line 1\nLine 2" };

  it("writes a mailto link with the address readable and everything else encoded", () => {
    expect(mailtoLink(email)).toBe(
      "mailto:it%2Blms@school.edu?cc=support%40example.com&subject=Hi%20%26%20thanks&body=Line%201%0D%0ALine%202"
    );
    expect(mailtoLink({ ...email, cc: null })).not.toContain("cc=");
  });

  it("opens Gmail's and Outlook's compose windows with the same email", () => {
    const gmail = new URL(gmailLink(email));
    expect(gmail.searchParams.get("to")).toBe("it+lms@school.edu");
    expect(gmail.searchParams.get("cc")).toBe("support@example.com");
    expect(gmail.searchParams.get("su")).toBe("Hi & thanks");
    expect(gmail.searchParams.get("body")).toBe("Line 1\nLine 2");
    const outlook = new URL(outlookLink(email));
    expect(outlook.searchParams.get("subject")).toBe("Hi & thanks");
    expect(outlook.searchParams.get("to")).toBe("it+lms@school.edu");
  });

  it("copies as plain text with the headers first", () => {
    expect(emailAsText(email)).toBe("To: it+lms@school.edu\nCc: support@example.com\nSubject: Hi & thanks\n\nLine 1\nLine 2");
    expect(emailAsText({ ...email, cc: null })).not.toContain("Cc:");
  });
});
