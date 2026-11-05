// Registered only for the LMS sites the student allowed. Tells the service
// worker the student has the site open, so it can sync if it's been a
// while. Reads nothing from the page.
chrome.runtime.sendMessage({ type: "lms-visit" }).catch(() => {});
