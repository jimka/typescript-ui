# Plan Frontmatter

Optional YAML at the top of a plan, declaring cross-plan relationships.

```yaml
---
depends-on: [plan-name, ...]      # must be in plans/implemented/ before this starts
touches-shared: [path, ...]       # files whose concurrent edit would conflict
---
```

When frontmatter is missing or incomplete, `/implement` derives values via its _Order derivation_ rules. Frontmatter is authoritative when present — derived values are not written back to plan files.
