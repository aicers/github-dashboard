// Whether a release pull request's commit is the one release-please
// builds from its title and body, and what it would publish from them.
//
// Usage: node release-please-pull.js <release-please package> <version>
//        [--restore]
//   stdin:  the output of release-please-pull.sh: the pull request's
//           `title` and `body`, the `overflow` notes file its body links
//           to (null when it links none), the `files` its commit changed,
//           and the contents of the files release-please writes, `before`
//           (the commit's parent) and `after` (the commit), null when
//           missing
//   stdout: { "version", "notes", "notesDigest", "restorable",
//           "problems": ["..."] }; with `--restore`, the release notes
//           file to restore instead (see below)
//
// release-please tags a merged release pull request with the version in
// its title and publishes the notes in its body, both read when it tags,
// and it leaves an open one alone whenever its body is the one it would
// generate, whatever was pushed to its branch since. Neither the title
// nor the body nor the branch is bound to the others, so this checks that
// they agree: the title is `chore(main): release X.Y.Z`, the body holds
// release notes for X.Y.Z, and the commit changes exactly the files
// release-please writes, each to what release-please's own updaters of
// the pinned release make of the parent's content with that version and
// those notes. The commit is the release pull request's head, or for a
// merged one its squash merge commit.
//
// A body too long for a pull request holds only a link to a file of
// release notes on a branch of its own, and release-please reads that
// file in its place, both when it tags and when it compares an open
// release pull request with the one it would build. So the body is read
// here through release-please's own `FilePullRequestOverflowHandler`,
// served the file release-please-pull.sh read, and parsed again from its
// string form, as `findMergedReleasePullRequests` hands it to
// `buildRelease`. It is a problem when the handler asks for a branch other
// than the one read, or for none when one was read.
//
// release-please 17.6.0 uploads that file one byte per UTF-16 code unit
// (`Buffer.from(contents, 'binary')` in `createFileOnNewBranch`,
// `build/src/github-api.js`) and reads it back as UTF-8 (`parsedContent`
// of @google-automations/git-file-utils). Notes holding any character
// beyond Latin-1, such as the `⚠` of `### ⚠ BREAKING CHANGES`, therefore
// come back with U+FFFD in its place, and would be published so, while
// `CHANGELOG.md`, committed as UTF-8, holds them intact. So the file's
// bytes are decoded here as release-please decodes them. When they are
// exactly what that uploader makes of the body release-please builds
// from the notes the commit adds to `CHANGELOG.md`, the problem says so,
// and `restorable` is true if that is the only problem: the file then
// only needs restoring as UTF-8, which `--restore` prints, and
// release-please-notes.sh writes to its branch. release-please leaves the
// file alone after that as long as the release pull request is unchanged,
// since it compares the body it would build with the one it reads back.
//
// `problems` is empty when they agree. `version` and `notes` are what
// release-please would tag and publish, and `notesDigest` is the SHA-256
// of the notes, so that the Release it creates can be compared with them.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const [packageDir, expectedVersion, ...options] = process.argv.slice(2);
if (
  !packageDir ||
  !expectedVersion ||
  options.some((option) => option !== "--restore")
) {
  throw new Error(
    "usage: release-please-pull.js <release-please package> <version> [--restore]",
  );
}
const restore = options.includes("--restore");
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
const build = (file) => require(path.join(packageDir, "build", "src", file));
const { setLogger } = build("util/logger.js");
const { FilePullRequestOverflowHandler } = build(
  "util/pull-request-overflow-handler.js",
);
const { PullRequestBody } = build("util/pull-request-body.js");
const { PullRequestTitle } = build("util/pull-request-title.js");
const { Version } = build("version.js");
const { Changelog } = build("updaters/changelog.js");
const { PackageJson } = build("updaters/node/package-json.js");
const { ReleasePleaseManifest } = build("updaters/release-please-manifest.js");
const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  trace() {},
  child() {
    return quiet;
  },
};
// Some of release-please's parsing logs through its global logger, which
// would otherwise write to standard output.
setLogger(quiet);

// What the node strategy writes for one package at the root, with no
// lockfile: `package-lock.json`, `npm-shrinkwrap.json`,
// `samples/package.json` and `changelog.json` do not exist here, and
// release-please writes none of them when they are missing.
const MANIFEST = ".release-please-manifest.json";
const WRITTEN = [MANIFEST, "CHANGELOG.md", "package.json"].sort();

const input = JSON.parse(fs.readFileSync(0, "utf8"));
if (
  typeof input?.title !== "string" ||
  typeof input.body !== "string" ||
  !Array.isArray(input.files) ||
  !input.files.every((file) => typeof file === "string") ||
  typeof input.before !== "object" ||
  typeof input.after !== "object" ||
  !(
    input.overflow === null ||
    (typeof input.overflow?.branch === "string" &&
      (input.overflow.base64 === null ||
        typeof input.overflow.base64 === "string"))
  )
) {
  throw new Error(
    "expected title, body, overflow, files, before and after on stdin",
  );
}
const before = (file) => input.before?.[file] ?? null;
const after = (file) => input.after?.[file] ?? null;
// The notes file's bytes, and its content as release-please reads it.
const overflowBytes =
  typeof input.overflow?.base64 === "string"
    ? Buffer.from(input.overflow.base64, "base64")
    : null;

// The body as release-please reads it back, or null when it cannot.
const readBody = async (problems) => {
  const requested = [];
  const github = {
    async getFileContentsOnBranch(file, branch) {
      requested.push(`${file} on ${branch}`);
      if (file !== "release-notes.md" || input.overflow?.branch !== branch) {
        throw new Error(
          `it reads ${file} on ${branch}, where ${input.overflow ? `release-notes.md on ${input.overflow.branch}` : "no file"} was read`,
        );
      }
      if (overflowBytes === null) {
        throw new Error(`${file} does not exist on ${branch}`);
      }
      return { parsedContent: overflowBytes.toString("utf8") };
    },
  };
  let body;
  try {
    body = await new FilePullRequestOverflowHandler(
      github,
      quiet,
    ).parseOverflow({ body: input.body });
  } catch (error) {
    problems.push(`release-please cannot read its body: ${error.message}`);
    return null;
  }
  if (input.overflow && requested.length === 0) {
    problems.push(
      `its body links to release-notes.md on ${input.overflow.branch}, which release-please does not read`,
    );
    return null;
  }
  return body ? PullRequestBody.parse(body.toString(), quiet) : undefined;
};

// The notes the commit adds to CHANGELOG.md, or null when they cannot be
// told apart: the text release-please's `Changelog` updater inserts
// before the first version heading, checked by running the updater on
// the parent's content with it.
const changelogNotes = (version) => {
  const old = before("CHANGELOG.md");
  const now = after("CHANGELOG.md");
  if (old === null || now === null) {
    return null;
  }
  const index = old.search(/\n###? v?[0-9[]/s);
  const head = old.slice(0, index);
  if (index <= 0 || head.trimStart() !== head) {
    return null;
  }
  const prefix = `${head}\n`;
  const suffix = `\n${old.slice(index).trimEnd()}\n`;
  if (
    now.length < prefix.length + suffix.length ||
    !now.startsWith(prefix) ||
    !now.endsWith(suffix)
  ) {
    return null;
  }
  const notes = now.slice(prefix.length, now.length - suffix.length);
  const built = new Changelog({
    version: Version.parse(version),
    changelogEntry: notes,
  }).updateContent(old, quiet);
  return notes && built === now ? notes : null;
};

// The body release-please builds for one package from the notes: what it
// writes to the notes file of an overflowed body. No header, footer or
// component is configured, so they are release-please's defaults, and a
// single release is written without its component.
const builtBody = (version, notes) =>
  new PullRequestBody([{ version: Version.parse(version), notes }]).toString();

const main = async () => {
  const problems = [];
  let version = null;
  let notes = null;
  let latin1 = false;
  let restored = null;
  let latin1Problem = null;

  const files = [...new Set(input.files)].sort();
  if (JSON.stringify(files) !== JSON.stringify(WRITTEN)) {
    problems.push(
      `it changes ${files.join(", ") || "no file"}, where release-please changes exactly ${WRITTEN.join(", ")}`,
    );
  }

  // The version is the one the commit writes into the manifest.
  try {
    const written = JSON.parse(after(MANIFEST) ?? "null");
    const value = written?.["."];
    if (typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value)) {
      version = value;
    } else {
      problems.push(`its ${MANIFEST} holds no X.Y.Z version for "."`);
    }
  } catch {
    problems.push(`its ${MANIFEST} is not JSON`);
  }

  if (version) {
    const expectedTitle = `chore(main): release ${version}`;
    const parsedTitle = PullRequestTitle.parse(
      input.title,
      undefined,
      undefined,
      quiet,
    );
    if (
      input.title !== expectedTitle ||
      parsedTitle?.getVersion()?.toString() !== version
    ) {
      problems.push(
        `its title is "${input.title}", where release-please tags ${version} only from "${expectedTitle}"`,
      );
    }

    const body = await readBody(problems);
    const data = body?.releaseData ?? [];
    // Whether the notes file is the body built from the notes in
    // CHANGELOG.md, as release-please's uploader stores it, and that
    // differs from the body itself.
    const fromChangelog = changelogNotes(version);
    const expectedFile =
      fromChangelog === null ? null : builtBody(version, fromChangelog);
    const stored =
      expectedFile === null ? null : Buffer.from(expectedFile, "latin1");
    latin1 =
      stored !== null &&
      overflowBytes?.equals(stored) === true &&
      !stored.equals(Buffer.from(expectedFile, "utf8"));
    if (latin1) {
      restored = expectedFile;
      latin1Problem = `its release notes file release-notes.md on ${input.overflow.branch} is the notes its CHANGELOG.md change adds, as release-please 17.6.0 uploads them, one byte per character, so that each character beyond Latin-1 in them (such as the ⚠ of "⚠ BREAKING CHANGES") reads back as U+FFFD and would be published so; restore the file as UTF-8 with .github/scripts/release-please-notes.sh ${Number.isInteger(input.number) ? input.number : "<pull request number>"}, then dispatch this workflow on main`;
      problems.push(latin1Problem);
    }
    // A body release-please cannot read (null) was reported above.
    if (body === null) {
      notes = null;
    } else if (
      data.length !== 1 ||
      data[0].component ||
      data[0].version?.toString() !== version ||
      !data[0].notes
    ) {
      problems.push(
        `its body does not hold release notes for ${version} alone, as release-please writes them`,
      );
    } else {
      notes = data[0].notes;
    }

    const parsed = Version.parse(version);
    const expect = (file, updater) => {
      const content = before(file);
      if (content === null) {
        problems.push(`${file} is missing before it`);
        return;
      }
      let built;
      try {
        built = updater.updateContent(content, quiet);
      } catch (error) {
        problems.push(`${file} before it cannot be updated: ${error.message}`);
        return;
      }
      if (after(file) !== built) {
        problems.push(
          `its ${file} is not what release-please writes for ${version}${file === "CHANGELOG.md" ? " from the notes in its body" : ""}`,
        );
      }
    };
    expect(
      MANIFEST,
      new ReleasePleaseManifest({
        version: parsed,
        versionsMap: new Map([[".", parsed]]),
      }),
    );
    expect("package.json", new PackageJson({ version: parsed }));
    // The notes file was reported above when it lost characters.
    if (notes && !latin1) {
      expect(
        "CHANGELOG.md",
        new Changelog({
          version: parsed,
          changelogEntry: notes,
        }),
      );
    }
  }

  const restorable = latin1 && problems.length === 1;
  if (restore) {
    if (!restorable) {
      throw new Error(
        `refusing to restore the release notes file: ${
          latin1
            ? problems.filter((problem) => problem !== latin1Problem).join("; ")
            : problems.length > 0
              ? problems.join("; ")
              : "release-please reads it as it is"
        }`,
      );
    }
    process.stdout.write(restored);
    return;
  }
  const notesDigest =
    notes === null
      ? null
      : crypto.createHash("sha256").update(notes, "utf8").digest("hex");
  process.stdout.write(
    `${JSON.stringify({ version, notes, notesDigest, restorable, problems })}\n`,
  );
};

main().catch((error) => {
  process.exitCode = 1;
  console.error(error);
});
