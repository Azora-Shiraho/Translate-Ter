const { execSync } = require('child_process');
const fs = require('fs');
const out = execSync('gh api repos/Azora-Shiraho/Translate-Ter/pulls/17/comments');
const comments = JSON.parse(out.toString());
let report = '';
comments.forEach((c, i) => {
  report += `\n--- Comment ${i + 1} ---\nFile: ${c.path}\nLine: ${c.line}\nBody:\n${c.body}\n`;
});
fs.writeFileSync('all_pr_comments.txt', report);
