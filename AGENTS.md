# Repository instructions

For new feature work, use the repository's pinned
[`tlc-spec-lean`](.agents/skills/tlc-spec-lean/SKILL.md) skill. Read its instructions and
the active decisions in `.specs/STATE.md` before planning or implementing a feature.
Historical `tlc-spec-driven` artifacts remain the record of previously completed work;
do not rewrite them into the new workflow.

Run skill scripts from the repository root, for example:

```sh
python3 .agents/skills/tlc-spec-lean/scripts/validate_plan.py channel-transcript-library
```

The skill's origin, pinned revision, and integrity manifest are recorded in
[`.agents/skills/README.md`](.agents/skills/README.md).

Keep technical documentation, source code, identifiers, comments, and tests in English,
following AD-013. Preserve the documented exceptions for Portuguese domain content.
