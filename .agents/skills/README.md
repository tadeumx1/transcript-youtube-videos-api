# Repository skills

## tlc-spec-lean

The complete upstream skill is vendored under `tlc-spec-lean/`, including references,
Python validators, self-tests, and fixture artifacts. It is available to agents through
the repository's `.agents/skills` discovery directory and `AGENTS.md` instructions.

- Catalog: https://agent-skills.techleads.club/skills/tlc-spec-lean/
- Repository: https://github.com/tech-leads-club/agent-skills
- Revision: `120b67676388241b314699fa8fa9af25ada6d1d4`
- Upstream path: `packages/skills-catalog/skills/(development)/tlc-spec-lean`
- Declared version: `1.1.0`
- Downloaded: 2026-10-01
- Author: Tech Leads Club
- License: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), as declared in `SKILL.md`
- Modifications: none; repository provenance is stored outside the upstream directory.

`tlc-spec-lean.sha256` records all downloaded file hashes, relative to the repository root.
Verify the copy and execute its self-tests with:

```sh
sha256sum --check .agents/skills/tlc-spec-lean.sha256
PYTHONDONTWRITEBYTECODE=1 python3 .agents/skills/tlc-spec-lean/scripts/selftest.py
python3 .agents/skills/tlc-spec-lean/scripts/validate_plan.py channel-transcript-library
```

To retrieve the same files, download this exact revision from the upstream repository
and select the path above. Do not replace the pinned copy with a moving branch during
feature work. Review upstream changes before deliberately updating the revision and hashes.
