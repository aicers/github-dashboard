// What release-please reads from a commit beyond its title.
//
// Usage: node release-please-reads.js <release-please package> <version>
//          <release-please-config.json>
//   stdin:  [{ "sha", "message", "pulls": [{ "number", "body" }] }]
//   stdout: [{ "sha", "findings": ["..."] }], in the order of stdin
//
// The release version and CHANGELOG.md are meant to follow each commit's
// title alone. release-please also reads the rest of the message, and a
// commit-override block in the body of the commit's pull request, which
// replaces the message. Rather than guess at what its parser takes from
// them, this runs that parser, `parseConventionalCommits` of the pinned
// release, on what release-please reads and on the title alone, and
// reports every commit for which the two differ in an entry that counts,
// its type, scope, description or breaking flag, or a note (`BREAKING
// CHANGE`, `Release-As`).
//
// An entry counts when it can change the release: its type has a
// CHANGELOG.md section, it is a `feat` or `feature` one (which raises the
// version), it is breaking, or it sets the version. Types are compared in
// any case. The parser also turns footers such as `Signed-off-by: ...`
// into entries of their own type; those appear nowhere and raise the
// version by no more than the title's own entry does, so they are left
// out, unless the title alone gives no entry at all. Issue references
// from footers such as `Closes #N` are not compared either: they only
// append `, closes #N` to the entry.
//
// Which of a commit's pull requests release-please takes depends on the
// batch of commits it reads, so the message is read with each of them,
// and with none when the commit has no pull request.

const fs = require("node:fs");
const path = require("node:path");

const [packageDir, expectedVersion, configPath] = process.argv.slice(2);
if (!packageDir || !expectedVersion || !configPath) {
  throw new Error(
    "usage: release-please-reads.js <release-please package> <version> <release-please-config.json>",
  );
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const sections = config["changelog-sections"];
if (
  !Array.isArray(sections) ||
  !sections.every((section) => typeof section?.type === "string")
) {
  throw new Error(`${configPath} has no changelog-sections with types`);
}
const counted = new Set([
  "feat",
  "feature",
  ...sections.map((section) => section.type.toLowerCase()),
]);
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
);
if (
  manifest.name !== "release-please" ||
  manifest.version !== expectedVersion
) {
  throw new Error(
    `expected release-please ${expectedVersion} in ${packageDir}, found ${manifest.name} ${manifest.version}`,
  );
}
const { parseConventionalCommits } = require(
  path.join(packageDir, "build", "src", "commit.js"),
);
// The parser logs only at debug level, about messages it cannot parse.
const quiet = { debug() {} };

function parse(sha, message, pull) {
  const commit = { sha, message, files: [] };
  if (pull) {
    commit.pullRequest = {
      sha,
      number: pull.number,
      title: "",
      body: pull.body,
      labels: [],
      files: [],
      headBranchName: "",
      baseBranchName: "",
    };
  }
  return parseConventionalCommits([commit], quiet).map((entry) => ({
    header: entry.message,
    type: entry.type,
    scope: entry.scope,
    bareMessage: entry.bareMessage,
    breaking: entry.breaking,
    notes: entry.notes.map((note) => ({ title: note.title, text: note.text })),
  }));
}

function counts(entry) {
  return (
    counted.has(entry.type.toLowerCase()) ||
    entry.breaking ||
    entry.notes.some((note) => note.title === "RELEASE AS")
  );
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function summarize(entries) {
  if (entries.length === 0) {
    return "no entry";
  }
  return entries
    .map((entry) => {
      const marks = [];
      if (entry.breaking) {
        marks.push("breaking");
      }
      for (const note of entry.notes) {
        if (note.title === "RELEASE AS") {
          marks.push(`Release-As ${oneLine(note.text)}`);
        }
      }
      const header = `"${oneLine(entry.header)}"`;
      return marks.length > 0 ? `${header} [${marks.join(", ")}]` : header;
    })
    .join(", ");
}

function overrideIn(body) {
  return (body.split("BEGIN_COMMIT_OVERRIDE")[1] || "")
    .split("END_COMMIT_OVERRIDE")[0]
    .trim();
}

function findings({ sha, message, pulls }) {
  const title = message.split(/\r?\n/)[0];
  const aloneAll = parse(sha, title);
  const relevant = (entries) =>
    aloneAll.length > 0 ? entries.filter(counts) : entries;
  const alone = relevant(aloneAll);
  const sources =
    pulls.length > 0
      ? pulls.map((pull) => ({
          pull,
          what: overrideIn(pull.body)
            ? `the commit override in the body of #${pull.number}`
            : `the message (pull request #${pull.number})`,
        }))
      : [{ pull: undefined, what: "the message" }];
  const found = [];
  for (const { pull, what } of sources) {
    const read = relevant(parse(sha, message, pull));
    if (JSON.stringify(read) !== JSON.stringify(alone)) {
      found.push(
        `from ${what} release-please reads ${summarize(read)}, where the title alone gives ${summarize(alone)}`,
      );
    }
  }
  return found;
}

const input = JSON.parse(fs.readFileSync(0, "utf8"));
if (!Array.isArray(input)) {
  throw new Error("expected a JSON array of commits on stdin");
}
const output = input.map((commit) => {
  if (
    typeof commit?.sha !== "string" ||
    typeof commit.message !== "string" ||
    !Array.isArray(commit.pulls) ||
    !commit.pulls.every(
      (pull) => Number.isInteger(pull?.number) && typeof pull.body === "string",
    )
  ) {
    throw new Error("each commit needs sha, message and pulls");
  }
  return { sha: commit.sha, findings: findings(commit) };
});
process.stdout.write(`${JSON.stringify(output)}\n`);
