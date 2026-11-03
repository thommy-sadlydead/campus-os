import { describe, expect, it } from "vitest";
import {
  contactFitsSchool,
  emailAsText,
  gmailLink,
  isEmailAddress,
  mailtoLink,
  outlookLink,
  schoolHost,
  schoolRequestEmail,
  suggestedContact,
} from "../src/lib/lms/school-request";

const base = {
  providerName: "Blackboard",
  studentName: "Sam Lee",
  appUrl: "https://app.campus-os.net",
  supportEmail: "support@example.com",
  blackboardAppId: "abc-123",
} as const;

describe("schoolHost", () => {
  it("takes the host of the LMS address", () => {
    expect(schoolHost("https://Learn.School.edu/ultra/calendar")).toBe("learn.school.edu");
    expect(schoolHost("https://www.school.edu")).toBe("school.edu");
    expect(schoolHost("not a url")).toBeNull();
  });
});

describe("isEmailAddress", () => {
  it("accepts an address and refuses anything else", () => {
    expect(isEmailAddress(" helpdesk@school.edu ")).toBe(true);
    expect(isEmailAddress("helpdesk@school")).toBe(false);
    expect(isEmailAddress("help desk@school.edu")).toBe(false);
    expect(isEmailAddress("")).toBe(false);
  });
});

describe("contactFitsSchool", () => {
  it("fits an address at the school's own domain", () => {
    expect(contactFitsSchool("helpdesk@school.edu", "learn.school.edu")).toBe(true);
    expect(contactFitsSchool("it@learn.school.edu", "learn.school.edu")).toBe(true);
    expect(contactFitsSchool("HelpDesk@School.edu", "d2l.school.edu")).toBe(true);
  });

  it("refuses an address anywhere else", () => {
    expect(contactFitsSchool("someone@gmail.com", "learn.school.edu")).toBe(false);
    expect(contactFitsSchool("it@otherschool.edu", "learn.school.edu")).toBe(false);
    // "chool.edu" is a suffix of the text but not a parent domain.
    expect(contactFitsSchool("x@chool.edu", "learn.school.edu")).toBe(false);
    expect(contactFitsSchool("x@edu", "learn.school.edu")).toBe(false);
  });

  it("never fits a school on the LMS company's hosting, where the address can't be checked", () => {
    expect(contactFitsSchool("help@brightspace.com", "school.brightspace.com")).toBe(false);
    expect(contactFitsSchool("help@school.edu", "school.blackboard.com")).toBe(false);
  });
});

describe("suggestedContact", () => {
  const at = (iso: string) => new Date(iso);

  it("suggests the address most students used", () => {
    const rows = [
      { contactEmail: "it@school.edu", updatedAt: at("2026-11-01T00:00:00Z") },
      { contactEmail: "helpdesk@school.edu", updatedAt: at("2026-11-02T00:00:00Z") },
      { contactEmail: "IT@school.edu", updatedAt: at("2026-10-01T00:00:00Z") },
    ];
    expect(suggestedContact(rows, "learn.school.edu")).toBe("it@school.edu");
  });

  it("breaks a tie with the latest, and skips addresses that don't fit the school", () => {
    const rows = [
      { contactEmail: "old@school.edu", updatedAt: at("2026-10-01T00:00:00Z") },
      { contactEmail: "new@school.edu", updatedAt: at("2026-11-01T00:00:00Z") },
      { contactEmail: "prank@gmail.com", updatedAt: at("2026-11-02T00:00:00Z") },
      { contactEmail: "prank@gmail.com", updatedAt: at("2026-11-02T00:00:00Z") },
      { contactEmail: null, updatedAt: at("2026-11-03T00:00:00Z") },
    ];
    expect(suggestedContact(rows, "learn.school.edu")).toBe("new@school.edu");
    expect(suggestedContact([], "learn.school.edu")).toBeNull();
  });
});

describe("schoolRequestEmail", () => {
  it("gives a Blackboard admin the Application ID and the developer's address", () => {
    const { subject, body } = schoolRequestEmail({ ...base, provider: "blackboard" });
    expect(subject).toBe("Request: turn on Campus OS in Blackboard");
    expect(body).toContain("Application ID abc-123");
    expect(body).toContain("End User Access set to Yes");
    expect(body).toContain("(support@example.com)");
    expect(body).toContain("https://app.campus-os.net/privacy");
    expect(body.endsWith("Thank you,\nSam Lee")).toBe(true);
  });

  it("says the developer will send the ID when there isn't one yet, and points to support without an address", () => {
    const { body } = schoolRequestEmail({ ...base, provider: "blackboard", blackboardAppId: null, supportEmail: null });
    expect(body).toContain("can send the Blackboard admin the Application ID");
    expect(body).toContain("https://app.campus-os.net/support");
  });

  it("describes Brightspace's OAuth registration, and signs off without a name when there isn't one", () => {
    const { subject, body } = schoolRequestEmail({ ...base, provider: "brightspace", providerName: "Brightspace", studentName: null });
    expect(subject).toBe("Request: turn on Campus OS in Brightspace");
    expect(body).toContain("Manage Extensibility");
    expect(body).not.toContain("abc-123");
    expect(body.endsWith("Thank you,")).toBe(true);
  });
});

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
