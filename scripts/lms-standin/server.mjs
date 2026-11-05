#!/usr/bin/env node
// A stand-in Brightspace and Blackboard for testing the Campus OS Chrome
// extension on this computer, with nothing real behind it. Never point it
// at real data, and never run it anywhere public.
//
//   node scripts/lms-standin/server.mjs            (port 4010)
//
// It answers the API routes the extension reads, from the shapes in D2L's
// and Blackboard's API references, and only to a signed-in browser (a
// session cookie set by its own /login page), like a real school's site:
//   http://localhost:4010  → plays Brightspace  (/d2l/...)
//   http://127.0.0.1:4010  → plays Blackboard   (/learn/api/public/...)
// Two hosts so they're two origins, as two schools would be.
//
// Test switches (POST): /__admin/expire-sessions signs everyone out;
// /__admin/touch changes one file, to check that only it syncs again.

import http from "node:http";
import crypto from "node:crypto";
import JSZip from "jszip";

const PORT = Number(process.env.PORT || 4010);
const sessions = new Set();
let touched = 0;

/** A small real PDF with a line of text, so the app's PDF reader has something to read. */
function pdfWith(text) {
  const escaped = text.replace(/[()\\]/g, (c) => `\\${c}`);
  const stream = `BT /F1 14 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function docxWith(text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function pptxWith(text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

// Made-up course files. The big one is over one upload part (3.5 MB).
const big = Buffer.from(("Chapter 4 practice problems on enzymes and reaction rates. ".repeat(80) + "\n").repeat(1000));
const files = {
  "lecture1.pdf": { type: "application/pdf", data: () => pdfWith("Lecture 1: cells are the basic unit of life.") },
  "week2-slides.pptx": { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", data: () => pptxWith("Week 2 slides: mitosis and meiosis") },
  "lab-guide.docx": { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: () => docxWith("Lab guide: measure the reaction rate at three temperatures.") },
  "problems.txt": { type: "text/plain", data: () => big },
  "syllabus.pdf": { type: "application/pdf", data: () => pdfWith(`History 210 syllabus. Office hours Tue 2-3 PM. Version ${touched}.`) },
};
const modified = () => (touched ? `2026-11-0${Math.min(9, touched + 4)}T12:00:00.000Z` : "2026-09-01T12:00:00.000Z");

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  res.writeHead(status, { "content-type": isBuffer ? "application/octet-stream" : "application/json", ...headers });
  res.end(isBuffer ? body : JSON.stringify(body));
}

function signedIn(req) {
  const cookie = /(?:^|;\s*)standin_session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
  return Boolean(cookie && sessions.has(cookie));
}

async function sendFile(res, name) {
  const f = files[name];
  send(res, 200, await f.data(), { "content-type": f.type });
}

const brightspaceToc = () => ({
  Modules: [
    {
      ModuleId: 1,
      Title: "Week 1",
      Topics: [
        { TopicId: 11, Title: "Lecture 1", TypeIdentifier: "File", Url: "/content/enforced/101-BIO/lecture1.pdf", LastModifiedDate: "2026-09-01T12:00:00.000Z" },
        { TopicId: 12, Title: "Week 2 slides", TypeIdentifier: "File", Url: "/content/enforced/101-BIO/week2-slides.pptx", LastModifiedDate: "2026-09-08T12:00:00.000Z" },
        { TopicId: 13, Title: "Lab guide", TypeIdentifier: "File", Url: "/content/enforced/101-BIO/lab-guide.docx", LastModifiedDate: modified() },
        { TopicId: 14, Title: "Reading notes", TypeIdentifier: "File", Url: "/content/enforced/101-BIO/reading.html", LastModifiedDate: "2026-09-02T12:00:00.000Z" },
        { TopicId: 15, Title: "Textbook site", TypeIdentifier: "Link", Url: "https://publisher.example.com/biology" },
        { TopicId: 16, Title: "Answer key", TypeIdentifier: "File", Url: "/content/enforced/101-BIO/answer-key.pdf", LastModifiedDate: "2026-09-03T12:00:00.000Z" },
        { TopicId: 17, Title: "Practice problems", TypeIdentifier: "File", Url: "/content/enforced/101-BIO/problems.txt", LastModifiedDate: "2026-09-04T12:00:00.000Z" },
        { TopicId: 18, Title: "Week 3 quiz", TypeIdentifier: "Link", Url: "/d2l/lms/quizzing/user/quiz_summary.d2l?qi=3&ou=101" },
      ],
      Modules: [],
    },
  ],
});

async function brightspace(req, res, url) {
  const p = url.pathname;
  if (p === "/d2l/api/versions/") return send(res, 200, [{ ProductCode: "lp", LatestVersion: "1.47" }, { ProductCode: "le", LatestVersion: "1.74" }]);
  if (!signedIn(req)) return send(res, 401, { Message: "Unauthorized" });
  if (p === "/d2l/api/lp/1.47/users/whoami") return send(res, 200, { Identifier: "9", FirstName: "Sam", LastName: "Student", UniqueName: "sstudent" });
  if (p === "/d2l/api/lp/1.47/enrollments/myenrollments/") {
    return send(res, 200, {
      PagingInfo: { Bookmark: null, HasMoreItems: false },
      Items: [
        { OrgUnit: { Id: 101, Name: "Biology 101 (stand-in)", Code: "BIO-101", Type: { Id: 3, Code: "Course Offering" } }, Access: { IsActive: true, CanAccess: true } },
        { OrgUnit: { Id: 102, Name: "Chemistry 110 (stand-in)", Code: "CHEM-110", Type: { Id: 3, Code: "Course Offering" } }, Access: { IsActive: true, CanAccess: true } },
        { OrgUnit: { Id: 6606, Name: "Stand-in University", Code: "SU", Type: { Id: 1, Code: "Organization" } }, Access: { IsActive: true, CanAccess: true } },
      ],
    });
  }
  const now = Date.now();
  const inDays = (d) => new Date(now + d * 86400000).toISOString();
  if (p === "/d2l/api/le/1.74/101/dropbox/folders/") {
    return send(res, 200, [
      { Id: 7, Name: "Lab report 2", DueDate: inDays(3), CustomInstructions: { Html: "<p>Write up the enzyme lab.</p>", Text: "Write up the enzyme lab." }, Assessment: { ScoreDenominator: 20 }, GradeItemId: 55 },
      { Id: 8, Name: "Lab report 1", DueDate: inDays(-20), CustomInstructions: { Text: "First lab." }, GradeItemId: 54 },
    ]);
  }
  if (p === "/d2l/api/le/1.74/101/dropbox/folders/7/submissions/mysubmissions/") return send(res, 200, [{ Status: 0, Submissions: [] }]);
  if (p === "/d2l/api/le/1.74/101/quizzes/") return send(res, 200, { Objects: [{ QuizId: 3, Name: "Midterm Exam", DueDate: inDays(9), IsActive: true }], Next: null });
  if (p === "/d2l/api/le/1.74/101/grades/values/myGradeValues/") return send(res, 200, [{ GradeObjectIdentifier: "54", PointsNumerator: 18 }]);
  if (p === "/d2l/api/le/1.74/101/content/toc") return send(res, 200, brightspaceToc());
  if (p === "/d2l/api/le/1.74/102/dropbox/folders/") return send(res, 200, [{ Id: 9, Name: "Problem set 4", DueDate: inDays(5) }]);
  if (p === "/d2l/api/le/1.74/102/quizzes/") return send(res, 403, { Message: "Forbidden" });
  if (p === "/d2l/api/le/1.74/102/grades/values/myGradeValues/") return send(res, 403, {});
  if (p === "/d2l/api/le/1.74/102/content/toc") return send(res, 200, { Modules: [] });
  const topic = /^\/d2l\/api\/le\/1\.74\/101\/content\/topics\/(\d+)\/file$/.exec(p)?.[1];
  if (topic === "11") return sendFile(res, "lecture1.pdf");
  if (topic === "12") return sendFile(res, "week2-slides.pptx");
  if (topic === "13") return sendFile(res, "lab-guide.docx");
  if (topic === "14") return send(res, 200, Buffer.from("<html><body><h1>Reading notes</h1><p>Read chapter 2 on cell membranes before Thursday.</p></body></html>"), { "content-type": "text/html" });
  if (topic === "16") return send(res, 403, { Message: "Forbidden" });
  if (topic === "17") return sendFile(res, "problems.txt");
  return send(res, 404, { Message: "Not Found" });
}

async function blackboard(req, res, url) {
  const p = url.pathname;
  if (!signedIn(req)) return send(res, 401, { status: 401, message: "API request is not authenticated." });
  const now = Date.now();
  const inDays = (d) => new Date(now + d * 86400000).toISOString();
  if (p === "/learn/api/public/v1/users/me") return send(res, 200, { id: "_9_1", userName: "sstudent", name: { given: "Sam", family: "Student" } });
  if (p === "/learn/api/public/v1/users/_9_1/courses") {
    return send(res, 200, {
      results: [
        { courseId: "_5_1", availability: { available: "Yes" }, course: { id: "_5_1", courseId: "HIST-210", name: "History 210 (stand-in)", availability: { available: "Yes" }, externalAccessUrl: `${url.origin}/ultra/courses/_5_1/outline` } },
        { courseId: "_6_1", availability: { available: "No" }, course: { id: "_6_1", courseId: "OLD-1", name: "Old course", availability: { available: "No" } } },
      ],
    });
  }
  if (p === "/learn/api/public/v2/courses/_5_1/gradebook/columns") {
    return send(res, 200, {
      results: [
        { id: "_20_1", name: "Essay 1", grading: { type: "Attempts", due: inDays(4) }, score: { possible: 100 }, availability: { available: "Yes" } },
        { id: "_21_1", name: "Final Exam", grading: { type: "Manual", due: inDays(30) }, availability: { available: "Yes" } },
        { id: "_22_1", name: "Weighted Total", grading: { type: "Calculated" } },
      ],
    });
  }
  if (p === "/learn/api/public/v2/courses/_5_1/gradebook/users/_9_1") return send(res, 200, { results: [{ columnId: "_20_1", status: "NeedsGrading" }] });
  const base = "/learn/api/public/v1/courses/_5_1/contents";
  if (p === base) {
    return send(res, 200, {
      results: [
        { id: "_100_1", title: "Week 1", contentHandler: { id: "resource/x-bb-folder" }, hasChildren: true, availability: { available: "Yes" } },
        { id: "_102_1", title: "Syllabus", contentHandler: { id: "resource/x-bb-file" }, modified: touched ? modified() : "2026-08-20T10:00:00.000Z", availability: { available: "Yes" } },
      ],
    });
  }
  if (p === `${base}/_100_1/children`) {
    return send(res, 200, {
      results: [
        { id: "_110_1", title: "Read before class", contentHandler: { id: "resource/x-bb-document" }, body: "<p>Read the primary sources on the printing press for Tuesday's discussion.</p>", modified: "2026-09-02T10:00:00.000Z", availability: { available: "Yes" } },
        { id: "_111_1", title: "Archive website", contentHandler: { id: "resource/x-bb-externallink", url: "https://archive.example.org/press" }, availability: { available: "Yes" } },
      ],
    });
  }
  if (p === `${base}/_102_1/attachments`) return send(res, 200, { results: [{ id: "_7_1", fileName: "syllabus.pdf", mimeType: "application/pdf" }] });
  if (p === `${base}/_110_1/attachments`) return send(res, 200, { results: [] });
  // Like Blackboard, a download answers with a redirect to where the file really is.
  if (p === `${base}/_102_1/attachments/_7_1/download`) {
    res.writeHead(302, { location: "/bbcswebdav/xid-7_1/syllabus.pdf" });
    return res.end();
  }
  if (p === "/bbcswebdav/xid-7_1/syllabus.pdf") return sendFile(res, "syllabus.pdf");
  return send(res, 404, { status: 404, message: "Not found" });
}

const loginPage = (host) => `<!doctype html><title>Stand-in sign-in</title><body style="font-family:sans-serif;max-width:420px;margin:60px auto">
<h1>Stand-in ${host.startsWith("127.") ? "Blackboard" : "Brightspace"}</h1><p>A local test server. Any name signs in.</p>
<form method="post" action="/login"><input name="user" value="sam"> <button>Sign in</button></form></body>`;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname === "/login" && req.method === "POST") {
        const id = crypto.randomBytes(16).toString("hex");
        sessions.add(id);
        res.writeHead(303, { location: url.hostname === "127.0.0.1" ? "/ultra/course" : "/d2l/home", "set-cookie": `standin_session=${id}; HttpOnly; SameSite=Lax; Path=/` });
        return res.end();
      }
      if (url.pathname === "/__admin/expire-sessions" && req.method === "POST") {
        sessions.clear();
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/__admin/touch" && req.method === "POST") {
        touched++;
        return send(res, 200, { touched });
      }
      if (url.pathname.startsWith("/d2l/api/")) return await brightspace(req, res, url);
      if (url.pathname.startsWith("/learn/api/") || url.pathname.startsWith("/bbcswebdav/")) return await blackboard(req, res, url);
      if (url.pathname === "/login" || url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(loginPage(url.hostname));
      }
      // Pages the student lands on: shaped like the real sites' addresses.
      if (url.pathname.startsWith("/d2l/") || url.pathname.startsWith("/ultra/")) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><title>Stand-in home</title><body style="font-family:sans-serif;margin:60px"><h1>${signedIn(req) ? "Signed in" : "Signed out"}</h1></body>`);
      }
      send(res, 404, { message: "Not found" });
    } catch (err) {
      send(res, 500, { message: String(err) });
    }
  })
  .listen(PORT, () => console.log(`Stand-in LMS on http://localhost:${PORT} (Brightspace) and http://127.0.0.1:${PORT} (Blackboard)`));
