---
name: writing-a-skill
description: "Write a SKILL.md that actually gets chosen and is worth loading. Use when adding a skill to a plugin, or when a skill exists but the model never picks it."
---

# Writing a skill

A skill is a Markdown file with frontmatter. It costs almost nothing until it is
chosen, and nothing at all if it is never chosen — so the description is not
documentation, it is the whole selection mechanism.

```markdown
---
name: fix-failing-ci
description: "Diagnose a failing CI run and propose a fix. Use when a build is red, a test fails in CI but passes locally, or the user pastes a CI log."
---

# Fix failing CI

<the actual instructions>
```

## Only the description is loaded up front

Every installed skill contributes its name and description to the prompt on
every message. The body is read only when the skill is opened. That is why:

- **The description must say when to use the skill, not what it is.**
  `"Diagnose a failing CI run… Use when a build is red"` gets chosen.
  `"CI helper"` does not, because nothing in it matches a user's phrasing.
- **Keep it to one or two sentences.** It is paid for on every turn.
- **The body can be long.** It is paid for once, by the turn that needs it.

If a skill is never being picked, the description is almost always the reason.
Name the situations it applies to, in the words a user would use.

## Opting out of automatic selection

Some skills should only run when the user explicitly asks — a destructive
workflow, or one that only makes sense on request. Two spellings, both honoured:

```markdown
---
name: reset-everything
description: "Wipe local state and re-seed. Use only when the user asks for it by name."
disable-model-invocation: true
---
```

or, in an `agents/openai.yaml` sidecar beside the `SKILL.md` — the spelling
bundles written for other agents use, which Atlas honours too:

```yaml
policy:
  allow_implicit_invocation: false
```

An opted-out skill stays loadable by name but is left out of the prompt index,
so it costs nothing on turns that do not want it.

## Declaring the tools a skill needs

A plugin's MCP servers are not connected until something wants them. Loading any
skill from a plugin wakes that plugin's servers. If a skill needs a server from
a *different* plugin, say so:

```yaml
dependencies:
  tools:
    - type: "mcp"
      value: "neon"
```

Tools activated this way arrive on the **next** message, not the one that loaded
the skill — a turn's tool set is fixed before it starts.

## Writing the body

Write it for someone competent who has not seen this repository. What earns its
place:

- The exact commands, with the flags that matter.
- The order things must happen in, when order matters.
- What is easy to get wrong here specifically, and what to do instead.

What does not:

- Explaining what git or npm is.
- Repeating what the code already makes obvious.
- Restating the description at length.

A skill that is one screen of specifics beats one that is five screens of
context. The model already has context; what it lacks is your particulars.
