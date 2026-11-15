# Backstage: notes for coding agents

This repository is the Backstage portal for AUGUR's repositories and deployments. AUGUR itself, its ADRs
and its guides are in the `augur` repository; read its AGENTS.md before changing how the portal reaches it.

## Rules
- The same rules as AUGUR: hosts, names and URLs come from config (`app-config*.yaml`), never literals from chat;
  a new dependency needs a record.
- Before a pull request: REVIEW.md. The paths it changes set its tier, which says what it needs before it
  merges (the description's sections, a `/code-review` run, high effort or more on what can't be undone); the Review check checks it.
- Merge your own pull request once CI and the Review check are green, after merging fresh `origin/main` into it.
- Nothing in the repository names the tool that wrote it: no assistant trailers on commits or attribution
  in pull requests, and no links to private chats.
